/**
 * Restart scheduling + state for dsh-restart-systemd (host half).
 *
 * Owns:
 *  - platform detection AND the exact spawn: `systemctl --user restart dsh-web`
 *    on WSL/Linux (the primary target), and a detached spawn of a helper on
 *    `win32` (the WSL path never reaches it — `process.platform` is `linux`
 *    inside WSL even though the OS is Windows underneath, so the systemctl
 *    branch is what actually runs on this machine).
 *  - the delayed schedule (respond 202 first, spawn after DELAY_MS so the
 *    browser gets its response and agent callbacks flush before the process
 *    dies) with single-flight dedup (a second POST while one is in flight →
 *    409).
 *  - flag-file three-in-one safety (`$DSH_HOME/dsh-restart.flag`: written
 *    before the spawn, consumed-and-deleted once at boot, never re-schedules)
 *    plus a residual-window probe that suppress re-clicks right after a
 *    plugin-driven restart, so a retry loop cannot ping-pong the service.
 *  - the restart-recover handoff: before spawning it snapshots the currently
 *    running agent session ids to `$DSH_HOME/dsh-restart-resume.json`; the
 *    boot side (recover.ts) reads it and later auto-continues each agent whose
 *    turn was interrupted.
 *
 * Spawn is a whitelisted argv array (no shell interpretation, no string
 * concat): `ctx.subprocess.spawn({ argv: [...], cwd, stdio, graceMs })`.
 * @module dsh-restart-systemd/host/restart
 */

import { readFile, writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Absolute directory of the compiled host entry (used to locate the Windows helper). */
const DIR = dirname(fileURLToPath(import.meta.url))

/** Service name the WebUI runs under (systemd user unit). */
export const SYSTEMD_UNIT = 'dsh-web'
/** Delay before the actual spawn — lets the browser receive the 202 response first. */
export const DELAY_MS = 3000
/**
 * After a plugin-driven boot (flag was consumed) the service must run this
 * long before another click is honored, otherwise a retry loop could
 * ping-pong the unit forever.
 */
export const RESIDUAL_WINDOW_MS = 15000

/** A restart that was scheduled but not yet executed. */
export interface PendingRestart {
  reason: string
  sessionIds: SessionId[]
  scheduledAt: number
}

/** The outcome of a `scheduleRestart` call. */
export type ScheduleResult =
  | { kind: 'scheduled'; delayMs: number }
  | { kind: 'already-scheduled' }        // single-flight: one is in flight
  | { kind: 'suppressed' }               // residual window right after a plugin boot
  | { kind: 'unsupported' }              // an unmanaged platform
  | { kind: 'error'; message: string }

/** The dsh-restart.flag payload (the resume list is a sibling file). */
export interface RestartFlag {
  reason: string
  ts: number
  sessionIds: SessionId[]
}

export interface RestartStatePaths {
  flag: string
  resume: string
}

/** Resolve the two state file paths under the (writable) DSH home. */
export function restartStatePaths(home: string): RestartStatePaths {
  return {
    flag: join(home, 'dsh-restart.flag'),
    resume: join(home, 'dsh-restart-resume.json'),
  }
}

/**
 * True when this host run can restart via the managed path. On WSL/Linux we
 * drive `systemctl --user` directly; on win32 (non-WSL Windows) we spawn a
 * detached helper process that performs the restart and keeps running after
 * this one exits. Node reports `linux` inside WSL, so the systemctl branch is
 * what the primary target actually uses.
 */
export function platformIsManaged(): boolean {
  return process.platform === 'win32' || process.platform === 'linux' || process.platform === 'darwin'
}

/** Build the exact argv for the current platform. */
export function restartArgv(): string[] {
  if (process.platform === 'win32') {
    // Windows (non-WSL) branch: resolve `process.execPath` and a bundled
    // restart helper, spawned detached so it outlives this process. The helper
    // path is resolved lazily (written at build/install time) and the spawn is
    // held until schedule() actually runs.
    return [process.execPath, join(DIR, '..', 'win-restart.mjs')]
  }
  // WSL / Linux / macOS: systemctl --user restart <unit>. macOS has no
  // systemctl; this branch still builds the argv and the caller guards it.
  return ['systemctl', '--user', 'restart', SYSTEMD_UNIT]
}

/**
 * A platform guard so schedule() refuses platforms we cannot manage. macOS
 * would need launchctl; for now we keep the argv as systemctl for Linux/WSL
 * and only allow win32 + the systemctl platforms.
 */
export function platformSupported(): boolean {
  // Windows detached-helper path plus Linux/WSL systemctl are supported.
  if (process.platform === 'win32') return true
  if (process.platform === 'linux') return true
  // macOS and other POSIX would need launchctl/other manager — not supported yet.
  return false
}

/** The live single-flight/dedup state for one plugin context. */
export class RestartScheduler {
  private timer: NodeJS.Timeout | undefined
  private readonly paths: RestartStatePaths
  private readonly ctx: Context
  /** Prevents an auto-reload loop: set when a flag was consumed at a fresh boot. */
  private suppressedUntil = 0

  constructor(ctx: Context, home: string) {
    this.ctx = ctx
    this.paths = restartStatePaths(home)
  }
  async consumeStaleState(): Promise<void> {
    let flag: RestartFlag | null = null
    try {
      const raw = await readFile(this.paths.flag, 'utf8')
      flag = JSON.parse(raw) as RestartFlag
    } catch {
      flag = null
    }
    if (flag !== null) {
      // A plugin-driven boot just happened. Suppress re-clicks for a window so
      // a retry loop cannot ping-pong the unit; deleting the flag makes it a
      // one-shot token that can never re-trigger a restart on its own.
      this.suppressedUntil = Date.now() + RESIDUAL_WINDOW_MS
      this.ctx.logger.info(`dsh-restart-systemd: consumed leftover restart flag from ${new Date(flag.ts).toISOString()} (reason=${flag.reason ?? 'unknown'})`)
      await this.safeUnlink(this.paths.flag)
      return
    }
    // No flag → no fresh plugin-driven boot occurred. If a stray resume marker
    // survives from a crashed/older run with no matching flag, drop it so it
    // cannot resurrect phantom agents on the next agent/created.
    await this.safeUnlink(this.paths.resume)
  }

  /**
   * Snapshot the currently *running* agents into the resume file (the trigger
   * side of restart-recover). Only agents whose status is `running` are
   * recorded; idle agents do not need to be resumed because nothing was
   * interrupted.
   * @param agents - all live agents from the registry.
   */
  async writeResumeState(agents: readonly Agent[], reason: string): Promise<void> {
    const running = agents.filter((agent) => agent.status === 'running')
    const sessionIds = running.map((agent) => agent.id)
    const flag: RestartFlag = { reason, ts: Date.now(), sessionIds }
    try {
      await writeFile(this.paths.flag, JSON.stringify(flag, null, 2), 'utf8')
    } catch (error) {
      this.ctx.logger.warn(`dsh-restart-systemd: failed to write flag file: ${String(error)}`)
      // A flag file write failure must not block the restart — best effort.
    }
    try {
      await writeFile(this.paths.resume, JSON.stringify({ ts: Date.now(), reason, sessionIds }, null, 2), 'utf8')
    } catch (error) {
      this.ctx.logger.warn(`dsh-restart-systemd: failed to write resume file: ${String(error)}`)
    }
    this.ctx.logger.info(`dsh-restart-systemd: recorded ${sessionIds.length} running agent(s) for resume: ${sessionIds.join(', ')}`)
  }

  /**
   * Schedule a restart. Single-flight: a second call while one is in flight →
   * `already-scheduled` (HTTP 409). Returns 202-shaped info on success. The
   * actual spawn is deferred DELAY_MS so the HTTP response and any agent
   * callback flush lands before the process dies.
   * @param reason - human reason for the restart (audit log + flag).
   * @param agentRunner - how to enumerate live running agents.
   */
  schedule(reason: string, agentRunner: () => readonly Agent[]): ScheduleResult {
    if (!platformSupported()) return { kind: 'unsupported' }
    if (this.timer !== undefined) return { kind: 'already-scheduled' }
    if (Date.now() < this.suppressedUntil) return { kind: 'suppressed' }

    void this.writeResumeState(agentRunner(), reason)

    // Fire the spawn after the browser has plenty of time to consume the 202.
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.spawn(process.platform)
    }, DELAY_MS)

    return { kind: 'scheduled', delayMs: DELAY_MS }
  }

  /** Actually invoke the restart command (whitelisted argv, no shell). */
  private spawn(_platform: NodeJS.Platform): void {
    const argv = restartArgv()
    const unit = SYSTEMD_UNIT
    this.ctx.logger.info(`dsh-restart-systemd: spawning restart for ${unit}: ${argv.join(' ')}`)
    try {
      // Whitelisted argv array — never shell-interpreted.
      const handle = this.ctx.subprocess.spawn({
        argv,
        cwd: process.cwd(),
        stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
        graceMs: 10_000,
      })
      void handle.done
        .then((outcome) => {
          this.ctx.logger.info(`dsh-restart-systemd: restart process exited code=${outcome.exitCode} signal=${outcome.signal ?? 'none'}`)
        })
        .catch((error) => {
          this.ctx.logger.warn(`dsh-restart-systemd: restart process failed: ${String(error)}`)
        })
    } catch (error) {
      this.ctx.logger.error(`dsh-restart-systemd: could not spawn restart: ${String(error)}`)
    }
  }

  /** Best-effort, ignore-when-absent unlink. */
  private async safeUnlink(path: string): Promise<void> {
    try {
      await unlink(path)
    } catch {
      // absent is fine
    }
  }

  /** Used by shutdown/unload to clear a pending timer. */
  dispose(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }
}
