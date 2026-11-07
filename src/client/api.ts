/**
 * Browser-side wire helper for POST /api/restart-dsh.
 *
 * The request has its own 10s AbortController budget. That budget exists only
 * so a hung HTTP request becomes a visible "unknown" result; it does not wait
 * for the service to recover and there is no reconnect probe here.
 * @module dsh-restart-systemd/client/api
 */

export type RestartApiResult =
  | { status: 'accepted'; delayMs: number }
  | { status: 'already-scheduled' }
  | { status: 'suppressed' }
  | { status: 'forbidden' }
  | { status: 'unsupported' }
  /** The request never completed; acceptance is genuinely unknown. */
  | { status: 'unknown' }
  | { status: 'error'; message: string }

const REQUEST_TIMEOUT_MS = 10_000

/**
 * POST /api/restart-dsh and classify the host answer.
 * @param reason - why the restart was requested (audit + flag).
 * @returns the classified outcome.
 */
export async function requestRestart(reason = 'webui-button'): Promise<RestartApiResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch('/api/restart-dsh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
      signal: controller.signal,
    })

    if (response.status === 202) {
      let delayMs = 3000
      try {
        const body = (await response.json()) as { delayMs?: unknown }
        if (typeof body.delayMs === 'number') delayMs = body.delayMs
      } catch {
        // A 202 is still an accepted request even if its body is unreadable.
      }
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
    clearTimeout(timer)
  }
}
