/**
 * Restart scheduling + state for dsh-restart-systemd.
 *
 * Two platform strategies, one state machine:
 *  - linux/WSL: \`systemctl --user restart dsh-web\` via \`ctx.subprocess\`.
 *  - win32: a detached PowerShell watcher that waits for this exact pid, then
 *    runs the configured launcher; this process leaves through \`appExit\`.
 *
 * Both write a one-shot flag before acting, keep a single-flight lock until the
 * act settles, and refuse requests for the residual window after a
 * plugin-driven boot. A \`when-idle\` request is queued instead of armed while
 * any agent is running; the queue re-checks idle after a settle window so a
 * finishing session cannot be interrupted by the next one starting.
 * @module dsh-restart-systemd/host/restart
 */

import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { resolveLauncher, startWatcher } from './windows.ts'

/** Service name the WebUI runs under (systemd user unit). */
export const SYSTEMD_UNIT = 'dsh-web'
/** Delay before the actual act, so the browser receives the 202 first. */
export const DELAY_MS = 3000
/** Re-click suppression window immediately after a plugin-driven boot. */
export const RESIDUAL_WINDOW_MS = 15000
/** How often a queued restart re-reads the agent registry. */
export const QUEUE_POLL_MS = 2000
/** Idle must hold this long before a queued restart fires. */
export const QUEUE_SETTLE_MS = 5000

/** Which restart the caller asked for. */
export type RestartMode = 'now' | 'when-idle'

/** The outcome of one schedule attempt. */
export type ScheduleResult =
  | { kind: 'scheduled'; delayMs: number }
  | { kind: 'queued'; waitingForSessions: number }
  | { kind: 'already-scheduled' }
  | { kind: 'suppressed' }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string }

/** The only payload the flag may contain. Extra legacy fields are ignored. */
export interface RestartFlag {
  reason: string
  ts: number
}

/** A restart waiting for every session to finish. */
export interface PendingRestart {
  reason: string
  requestedAt: number
  waitingForSessions: number
}

export interface RestartStatePaths {
  flag: string
  /** Old auto-resume marker; read only to remove a stale leftover once at boot. */
  legacyResume: string
}

/** Everything a caller may override; production passes nothing. */
export interface RestartOptions {
  delayMs?: number
  pollMs?: number
  settleMs?: number
  /** Platform override for tests; defaults to \`process.platform\`. */
  platform?: NodeJS.Platform
}

/** Resolve the restart state paths under the writable DSH home. */
export function restartStatePaths(home: string): RestartStatePaths {
  return {
    flag: join(home, 'dsh-restart.flag'),
    legacyResume: join(home, 'dsh-restart-resume.json'),
  }
}

/** Linux/WSL restart through systemd, Windows through the external watcher. */
export function platformSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'linux' || platform === 'win32'
}

/** The exact whitelisted argv used on Linux/WSL. No shell, no helper. */
export function restartArgv(): string[] {
  return ['systemctl', '--user', 'restart', SYSTEMD_UNIT]
}

/** Live single-flight, queue, and residual-window state for one plugin context. */
export class RestartScheduler {
  private timer: NodeJS.Timeout | undefined
  private disposed = false
  private readonly paths: RestartStatePaths
  private readonly ctx: Context
  private readonly home: string
  private readonly platform: NodeJS.Platform
  private readonly delayMs: number
  private readonly pollMs: number
  private readonly settleMs: number
  private suppressedUntil = 0
  private inFlight = false
  private initPromise: Promise<void> | undefined
  private pendingFlagTs: number | undefined
  private queued: PendingRestart | undefined
  private queueTimer: NodeJS.Timeout | undefined
  private queueWake: (() => void) | undefined

  constructor(ctx: Context, home: string, options: RestartOptions = {}) {
    this.ctx = ctx
    this.home = home
    this.platform = options.platform ?? process.platform
    this.paths = restartStatePaths(home)
    this.delayMs = options.delayMs ?? DELAY_MS
    this.pollMs = options.pollMs ?? QUEUE_POLL_MS
    this.settleMs = options.settleMs ?? QUEUE_SETTLE_MS
  }

  /**
   * Consume the boot flag exactly once. Requests await the same promise so a
   * request that arrives while boot state is still being read cannot race the
   * residual-window suppression.
   */
  initialize(): Promise<void> {
    if (this.initPromise === undefined) this.initPromise = this.consumeStaleState()
    return this.initPromise
  }

  /**
   * Read a leftover restart flag (including the old shape with sessionIds),
   * open the residual window, and remove both the flag and the obsolete
   * auto-resume marker. The flag is a safety token, never a recovery record.
   */
  async consumeStaleState(): Promise<void> {
    let raw: string | undefined
    try {
      raw = await readFile(this.paths.flag, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') this.log('warn', 'dsh-restart-systemd: could not read restart flag: ' + String(error))
    }

    if (raw !== undefined) {
      this.suppressedUntil = Date.now() + RESIDUAL_WINDOW_MS
      let reason = 'unknown'
      let stamp = 'unknown'
      try {
        const parsed = JSON.parse(raw) as Partial<RestartFlag>
        if (parsed !== null && typeof parsed === 'object') {
          if (typeof parsed.reason === 'string' && parsed.reason !== '') reason = parsed.reason
          if (typeof parsed.ts === 'number' && Number.isFinite(parsed.ts)) stamp = new Date(parsed.ts).toISOString()
        }
      } catch {
        this.log('warn', 'dsh-restart-systemd: leftover restart flag was malformed; suppressing for the residual window')
      }
      this.log('info', 'dsh-restart-systemd: consumed leftover restart flag from ' + stamp + ' (reason=' + reason + ')')
    }

    await this.safeUnlink(this.paths.flag)
    await this.safeUnlink(this.paths.legacyResume)
  }

  /** Whether a restart is armed: flag written, act running, or timer pending. */
  isArmed(): boolean {
    return this.timer !== undefined || this.inFlight
  }

  /** The queued restart, when one is waiting for sessions to finish. */
  pending(): PendingRestart | undefined {
    return this.queued === undefined ? undefined : { ...this.queued }
  }

  /** Drop a queued restart. */
  cancelPending(): boolean {
    if (this.queued === undefined) return false
    this.queued = undefined
    this.clearQueueTimer()
    this.log('info', 'dsh-restart-systemd: queued restart cancelled')
    return true
  }

  /**
   * Schedule one restart. The method is async because preparation can fail:
   * the single-flight lock is taken first, then the flag write is awaited, and
   * only a successful write arms the delayed act.
   *
   * \`when-idle\` only queues when the agent registry reports running agents; an
   * unreadable registry is an error rather than a silent immediate restart,
   * because interrupting live work is exactly what this mode exists to avoid.
   */
  async schedule(reason: string, mode: RestartMode = 'now'): Promise<ScheduleResult> {
    if (!platformSupported(this.platform)) return { kind: 'unsupported' }
    if (this.disposed) return { kind: 'error', message: 'restart scheduler is disposed' }
    if (this.inFlight || this.timer !== undefined || this.queued !== undefined) return { kind: 'already-scheduled' }

    this.inFlight = true
    try {
      await this.initialize()
      if (this.disposed) {
        this.inFlight = false
        return { kind: 'error', message: 'restart scheduler was disposed before scheduling' }
      }
      if (Date.now() < this.suppressedUntil) {
        this.inFlight = false
        return { kind: 'suppressed' }
      }

      if (mode === 'when-idle') {
        const busy = this.countBusyAgents()
        if (busy === undefined) {
          this.inFlight = false
          return { kind: 'error', message: 'the agent registry is unavailable; cannot wait for sessions to finish' }
        }
        if (busy > 0) {
          this.queued = { reason, requestedAt: Date.now(), waitingForSessions: busy }
          this.inFlight = false
          this.log('info', 'dsh-restart-systemd: restart queued until sessions finish (' + busy + ' running)')
          this.armQueuePoll()
          return { kind: 'queued', waitingForSessions: busy }
        }
      }

      return await this.armNow(reason)
    } catch (error) {
      this.inFlight = false
      return { kind: 'error', message: 'restart scheduling failed: ' + String(error) }
    }
  }

  /**
   * Write the flag and install the delayed act. The caller holds the
   * single-flight lock (\`inFlight\`).
   */
  private async armNow(reason: string): Promise<ScheduleResult> {
    const flagTs = Date.now()
    const flag: RestartFlag = { ts: flagTs, reason }
    try {
      await writeFile(this.paths.flag, JSON.stringify(flag, null, 2), 'utf8')
    } catch (error) {
      this.inFlight = false
      return { kind: 'error', message: 'failed to write restart flag: ' + String(error) }
    }

    if (this.disposed) {
      await this.clearOwnFlag(flagTs)
      this.inFlight = false
      return { kind: 'error', message: 'restart scheduler was disposed during flag write' }
    }

    this.pendingFlagTs = flagTs
    try {
      this.timer = setTimeout(() => {
        this.timer = undefined
        const pending = this.pendingFlagTs
        this.pendingFlagTs = undefined
        if (pending === undefined) {
          this.inFlight = false
          return
        }
        if (this.disposed) {
          this.inFlight = false
          void this.clearOwnFlag(pending).catch((error) => {
            this.log('warn', 'dsh-restart-systemd: could not clear restart flag after dispose: ' + String(error))
          })
          return
        }
        void this.act(pending).catch((error) => {
          this.log('error', 'dsh-restart-systemd: restart attempt failed unexpectedly: ' + String(error))
          this.inFlight = false
        })
      }, this.delayMs)
    } catch (error) {
      this.pendingFlagTs = undefined
      await this.clearOwnFlag(flagTs)
      this.inFlight = false
      return { kind: 'error', message: 'failed to schedule restart: ' + String(error) }
    }

    return { kind: 'scheduled', delayMs: this.delayMs }
  }

  /**
   * Count agents whose status is \`running\`.
   * @returns the count, or undefined when no registry is reachable.
   */
  private countBusyAgents(): number | undefined {
    try {
      const registry = this.ctx.get('agents') as { list?: () => unknown } | undefined
      if (registry === undefined || registry === null || typeof registry.list !== 'function') return undefined
      const agents = registry.list()
      if (!Array.isArray(agents)) return undefined
      let busy = 0
      for (const agent of agents) {
        const status = (agent as { status?: unknown } | null)?.status
        if (status === 'running') busy += 1
      }
      return busy
    } catch (error) {
      this.log('warn', 'dsh-restart-systemd: could not read the agent registry: ' + String(error))
      return undefined
    }
  }

  /** The queued restart re-checks the registry on this timer. */
  private armQueuePoll(): void {
    this.clearQueueTimer()
    this.queueTimer = setTimeout(() => {
      this.queueTimer = undefined
      void this.pollQueue().catch((error) => {
        this.log('warn', 'dsh-restart-systemd: queued restart poll failed: ' + String(error))
        if (!this.disposed && this.queued !== undefined) this.armQueuePoll()
      })
    }, this.pollMs)
  }

  /** Cancel any armed queue timer and wake a sleeping settle window. */
  private clearQueueTimer(): void {
    if (this.queueTimer !== undefined) {
      clearTimeout(this.queueTimer)
      this.queueTimer = undefined
    }
    const wake = this.queueWake
    this.queueWake = undefined
    if (wake !== undefined) wake()
  }

  /** Sleep for the settle window, letting dispose or cancel end the wait. */
  private settle(): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        if (this.queueWake === finish) this.queueWake = undefined
        if (this.queueTimer !== undefined) {
          clearTimeout(this.queueTimer)
          this.queueTimer = undefined
        }
        resolve()
      }
      this.queueWake = finish
      this.queueTimer = setTimeout(finish, this.settleMs)
    })
  }

  /** One queue step: keep waiting, or fire once idle has settled. */
  private async pollQueue(): Promise<void> {
    if (this.disposed || this.queued === undefined) return

    const busy = this.countBusyAgents()
    if (busy === undefined) {
      this.log('warn', 'dsh-restart-systemd: agent registry unreadable; the queued restart keeps waiting')
      this.armQueuePoll()
      return
    }
    if (busy > 0) {
      this.queued.waitingForSessions = busy
      this.armQueuePoll()
      return
    }

    await this.settle()
    if (this.disposed || this.queued === undefined) return

    const again = this.countBusyAgents()
    if (again === undefined) {
      this.log('warn', 'dsh-restart-systemd: agent registry unreadable after the settle window; the queued restart keeps waiting')
      this.armQueuePoll()
      return
    }
    if (again > 0) {
      this.queued.waitingForSessions = again
      this.log('info', 'dsh-restart-systemd: a session started during the settle window; the queued restart keeps waiting')
      this.armQueuePoll()
      return
    }

    const reason = this.queued.reason
    this.queued = undefined
    this.inFlight = true
    this.log('info', 'dsh-restart-systemd: all sessions are idle; running the queued restart (reason=' + reason + ')')
    const result = await this.armNow(reason)
    if (result.kind !== 'scheduled') {
      this.log('error', 'dsh-restart-systemd: queued restart could not be armed: ' + JSON.stringify(result))
    }
  }

  /** Perform the platform act; failures are logged, never rethrown. */
  private async act(flagTs: number): Promise<void> {
    try {
      if (this.platform === 'win32') {
        await this.actWindows(flagTs)
        return
      }
      await this.actSystemd(flagTs)
    } finally {
      this.inFlight = false
    }
  }

  /** Invoke the fixed systemctl argv through the subprocess seam. */
  private async actSystemd(flagTs: number): Promise<void> {
    try {
      const argv = restartArgv()
      this.log('info', 'dsh-restart-systemd: spawning restart for ' + SYSTEMD_UNIT + ': ' + argv.join(' '))
      const handle = this.ctx.subprocess.spawn({
        argv,
        cwd: process.cwd(),
        stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
        graceMs: 10_000,
      })
      await handle.done.then(
        async (outcome) => {
          const signal = outcome.signal ?? 'none'
          if (outcome.exitCode === 0) {
            this.log('info', 'dsh-restart-systemd: restart process exited code=0 signal=' + signal)
          } else {
            this.log('warn', 'dsh-restart-systemd: restart process exited code=' + String(outcome.exitCode) + ' signal=' + signal)
            await this.clearOwnFlag(flagTs)
          }
        },
        async (error) => {
          this.log('warn', 'dsh-restart-systemd: restart process failed: ' + String(error))
          await this.clearOwnFlag(flagTs)
        },
      )
    } catch (error) {
      this.log('error', 'dsh-restart-systemd: could not spawn restart: ' + String(error))
      await this.clearOwnFlag(flagTs)
    }
  }

  /**
   * Hand the relaunch to a detached watcher, then leave through appExit.
   * Nothing is started unless the watcher was spawned first: a failed handoff
   * must leave this process alive with an actionable log, never a dead host and
   * no relaunch.
   */
  private async actWindows(flagTs: number): Promise<void> {
    let launcher: string | undefined
    try {
      launcher = await resolveLauncher({ home: this.home })
    } catch (error) {
      this.log('error', 'dsh-restart-systemd: could not read the Windows launcher config: ' + String(error))
      await this.clearOwnFlag(flagTs)
      return
    }
    if (launcher === undefined) {
      this.log(
        'error',
        'dsh-restart-systemd: no Windows launcher is configured; put {"windowsLauncher":"<path to start-dsh-native.ps1>"} in ' +
          join(this.home, 'dsh-restart.json') + ', or export DSH_RESTART_WINDOWS_LAUNCHER',
      )
      await this.clearOwnFlag(flagTs)
      return
    }

    let exit: ((code: number) => void) | undefined
    try {
      exit = this.ctx.get('appExit') as ((code: number) => void) | undefined
    } catch {
      exit = undefined
    }
    if (typeof exit !== 'function') {
      this.log('error', 'dsh-restart-systemd: the appExit service is unavailable; refusing to leave without a relaunch')
      await this.clearOwnFlag(flagTs)
      return
    }

    let watcherPid: number | undefined
    try {
      const started = await startWatcher({
        home: this.home,
        launcher,
        pid: process.pid,
        onError: (error) => {
          this.log('warn', 'dsh-restart-systemd: watcher process error: ' + String(error))
        },
      })
      watcherPid = started.watcherPid
      this.log(
        'info',
        'dsh-restart-systemd: watcher started pid=' +
          String(watcherPid ?? '?') +
          ' shim=' +
          started.shimPath +
          ' script=' +
          started.scriptPath,
      )
    } catch (error) {
      this.log('error', 'dsh-restart-systemd: could not start the Windows watcher: ' + String(error))
      await this.clearOwnFlag(flagTs)
      return
    }

    // The flag stays on disk on purpose: the next boot consumes it and opens
    // the residual suppression window.
    this.log('info', 'dsh-restart-systemd: exiting so the watcher can run the launcher (' + launcher + ')')
    try {
      exit(0)
    } catch (error) {
      this.log('error', 'dsh-restart-systemd: appExit threw: ' + String(error))
    }
  }

  /** Remove the flag only when it is still the one written for this attempt. */
  private async clearOwnFlag(flagTs: number): Promise<void> {
    try {
      const raw = await readFile(this.paths.flag, 'utf8')
      const parsed = JSON.parse(raw) as Partial<RestartFlag>
      if (parsed !== null && typeof parsed === 'object' && parsed.ts === flagTs) await this.safeUnlink(this.paths.flag)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log('warn', 'dsh-restart-systemd: could not clear restart flag: ' + String(error))
      }
    }
  }

  /** Best-effort, ignore-when-absent unlink. */
  private async safeUnlink(path: string): Promise<void> {
    try {
      await unlink(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log('warn', 'dsh-restart-systemd: could not remove ' + path + ': ' + String(error))
      }
    }
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    try {
      this.ctx.logger[level](message)
    } catch {
      // Logging must never break scheduling or escape a timer.
    }
  }

  /** Permanently close this scheduler; an accepted timer or queue is dropped. */
  dispose(): void {
    this.disposed = true
    this.queued = undefined
    this.clearQueueTimer()
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
      const pending = this.pendingFlagTs
      this.pendingFlagTs = undefined
      if (pending !== undefined) {
        void this.clearOwnFlag(pending).catch((error) => {
          this.log('warn', 'dsh-restart-systemd: could not clear restart flag after dispose: ' + String(error))
        })
      }
    }
    this.inFlight = false
  }
}
