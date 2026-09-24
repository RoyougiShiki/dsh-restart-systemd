/**
 * Browser-side wire helper for the /api/restart-dsh surface. Plain same-origin
 * fetch with a JSON body (like remote-web-ui's pair-api / the connection
 * client). Returns classified outcomes so the button can render state.
 *
 * There is deliberately NO reconnect probe here: the client runtime's own
 * ConnectionController already owns the connect/retry loop (exponential
 * backoff, base 500ms → cap 10s) and publishes its lifecycle on
 * `ctx.connection.state`, which the official ConnectionIndicator renders in
 * the sidebar footer. This module only asks the host to restart and reports
 * what the host answered.
 * @module dsh-restart-systemd/client/api
 */

export type RestartApiResult =
  | { status: 'scheduled'; delayMs: number }
  | { status: 'already-scheduled' }
  | { status: 'suppressed' }
  | { status: 'forbidden' }
  | { status: 'unsupported' }
  /** The request never completed — the service may already be going down. */
  | { status: 'unreachable' }
  | { status: 'error'; message: string }

/**
 * POST /api/restart-dsh, classifying HTTP codes into stable outcomes.
 * @param reason - why the restart was requested (audit + flag).
 * @returns the classified outcome.
 */
export async function requestRestart(reason = 'webui-button'): Promise<RestartApiResult> {
  try {
    const response = await fetch('/api/restart-dsh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    if (response.status === 202) {
      const body = (await response.json()) as { delayMs?: number }
      return { status: 'scheduled', delayMs: body.delayMs ?? 3000 }
    }
    if (response.status === 409) return { status: 'already-scheduled' }
    if (response.status === 429) return { status: 'suppressed' }
    if (response.status === 403) return { status: 'forbidden' }
    if (response.status === 501) return { status: 'unsupported' }
    return { status: 'error', message: `restart request failed (HTTP ${response.status})` }
  } catch {
    // A network error usually means the service is already restarting / went
    // down before the response arrived. Reported separately from an HTTP
    // failure so the caller can keep waiting instead of declaring defeat.
    return { status: 'unreachable' }
  }
}
