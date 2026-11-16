/**
 * Browser-side wire helper for /api/restart-dsh.
 *
 * Three calls share the same loopback-fenced route: POST asks for a restart
 * (immediately or once sessions are idle), GET reports a queued restart, and
 * DELETE cancels one. Each call has its own 10s AbortController budget so a
 * hung request becomes a visible "unknown" result; nothing here waits for the
 * service to come back and there is no reconnect probe.
 * @module dsh-restart-systemd/client/api
 */

/** Which restart the user asked for. */
export type RestartMode = 'now' | 'when-idle'

export type RestartApiResult =
  | { status: 'accepted'; delayMs: number }
  | { status: 'queued'; waitingForSessions: number }
  | { status: 'already-scheduled' }
  | { status: 'suppressed' }
  | { status: 'forbidden' }
  | { status: 'unsupported' }
  /** The request never completed; acceptance is genuinely unknown. */
  | { status: 'unknown' }
  | { status: 'error'; message: string }

/** A restart the host is holding until every session goes idle. */
export interface QueuedRestart {
  reason: string
  requestedAt: number
  waitingForSessions: number
}

const REQUEST_TIMEOUT_MS = 10_000

function budget(): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

/**
 * POST /api/restart-dsh and classify the host answer.
 * @param mode - restart now, or queue until sessions are idle.
 * @param reason - why the restart was requested (audit + flag).
 * @returns the classified outcome.
 */
export async function requestRestart(mode: RestartMode = 'now', reason = 'webui-button'): Promise<RestartApiResult> {
  const { signal, done } = budget()
  try {
    const response = await fetch('/api/restart-dsh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason, mode }),
      signal,
    })

    if (response.status === 202) {
      let body: { delayMs?: unknown; queued?: unknown; waitingForSessions?: unknown } = {}
      try {
        body = (await response.json()) as typeof body
      } catch {
        // A 202 is still an accepted request even if its body is unreadable.
      }
      if (body.queued === true) {
        const waiting = typeof body.waitingForSessions === 'number' ? body.waitingForSessions : 0
        return { status: 'queued', waitingForSessions: waiting }
      }
      const delayMs = typeof body.delayMs === 'number' ? body.delayMs : 3000
      return { status: 'accepted', delayMs }
    }
    if (response.status === 409) return { status: 'already-scheduled' }
    if (response.status === 429) return { status: 'suppressed' }
    if (response.status === 403) return { status: 'forbidden' }
    if (response.status === 501) return { status: 'unsupported' }
    return { status: 'error', message: 'HTTP ' + response.status }
  } catch {
    return { status: 'unknown' }
  } finally {
    done()
  }
}

/**
 * Read the queued restart, so a reloaded page still shows the pending state.
 * @returns the queued restart, null when none is queued, or undefined when the
 *   host could not be asked.
 */
export async function fetchQueuedRestart(): Promise<QueuedRestart | null | undefined> {
  const { signal, done } = budget()
  try {
    const response = await fetch('/api/restart-dsh', { method: 'GET', headers: { accept: 'application/json' }, signal })
    if (response.status !== 200) return undefined
    const body = (await response.json()) as { queued?: unknown }
    if (body === null || typeof body !== 'object') return undefined
    const queued = body.queued
    if (queued === null || queued === undefined) return null
    if (typeof queued !== 'object') return undefined
    const record = queued as { reason?: unknown; requestedAt?: unknown; waitingForSessions?: unknown }
    return {
      reason: typeof record.reason === 'string' ? record.reason : 'unknown',
      requestedAt: typeof record.requestedAt === 'number' ? record.requestedAt : 0,
      waitingForSessions: typeof record.waitingForSessions === 'number' ? record.waitingForSessions : 0,
    }
  } catch {
    return undefined
  } finally {
    done()
  }
}

/**
 * Cancel the queued restart.
 * @returns true when the host had one to cancel, false otherwise.
 */
export async function cancelQueuedRestart(): Promise<boolean> {
  const { signal, done } = budget()
  try {
    const response = await fetch('/api/restart-dsh', { method: 'DELETE', signal })
    if (response.status !== 200) return false
    const body = (await response.json()) as { cancelled?: unknown }
    return body?.cancelled === true
  } catch {
    return false
  } finally {
    done()
  }
}
