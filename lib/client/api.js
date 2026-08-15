/**
 * Browser-side wire helper for the /api/restart-dsh surface. Plain same-origin
 * fetch with a JSON body (like remote-web-ui's pair-api / the connection
 * client). Returns classified outcomes so the button can render state.
 * @module dsh-restart-systemd/client/api
 */
/**
 * POST /api/restart-dsh, classifying HTTP codes into stable outcomes.
 * @param reason - why the restart was requested (audit + flag).
 * @returns the classified outcome.
 */
export async function requestRestart(reason = 'webui-button') {
    try {
        const response = await fetch('/api/restart-dsh', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reason }),
        });
        if (response.status === 202) {
            const body = (await response.json());
            return { status: 'scheduled', delayMs: body.delayMs ?? 3000 };
        }
        if (response.status === 409)
            return { status: 'already-scheduled' };
        if (response.status === 429)
            return { status: 'suppressed' };
        if (response.status === 403)
            return { status: 'forbidden' };
        if (response.status === 501)
            return { status: 'unsupported' };
        return { status: 'error', message: `restart request failed (HTTP ${response.status})` };
    }
    catch {
        // A network error usually means the service is already restarting / went
        // down before the response arrived — treat that as a scheduled event.
        return { status: 'error', message: 'request failed (service may already be restarting)' };
    }
}
/**
 * Poll until the WebUI is reachable again after a restart (the connection
 * client reconnects on its own; this is a best-effort probe for the button's
 * "reconnected" copy). Resolves true when a fetch to the same origin succeeds
 * within the timeout.
 * @param timeoutMs - how long to keep probing.
 * @returns true when the origin became reachable.
 */
export function waitForReconnect(timeoutMs = 20000, waitForRestart = false) {
    const started = Date.now();
    const deadline = started + timeoutMs;
    // Restart is scheduled with ~3s delay; any 200 observed after this point is
    // the restarted process (the pre-restart process would have died by then),
    // so it counts as reconnected even if the short down-window was missed.
    const RESTART_OBSERVED_MS = 4000;
    return new Promise((resolve) => {
        // sawDown flips once a probe fails — that is the moment the process is
        // actually going down (after the ~3s scheduling delay). Only a success
        // AFTER a failure counts as "reconnected"; a success before any failure
        // is just the still-alive pre-restart process and must not resolve early
        // (otherwise the card would close before the restart happens).
        let sawDown = false;
        const probe = async () => {
            if (Date.now() >= deadline) {
                resolve(false);
                return;
            }
            try {
                // Abort slow/hung probes so a dead connection cannot stall the loop.
                const controller = new AbortController();
                const to = window.setTimeout(() => controller.abort(), 2500);
                const res = await fetch('/', { method: 'GET', signal: controller.signal });
                window.clearTimeout(to);
                if (res.ok) {
                    if (!waitForRestart ||
                        sawDown ||
                        Date.now() - started >= RESTART_OBSERVED_MS) {
                        resolve(true);
                        return;
                    }
                }
            }
            catch {
                sawDown = true;
            }
            // Dense probing (~350ms) so the short WSL down-window is not missed.
            window.setTimeout(() => void probe(), 350);
        };
        void probe();
    });
}
//# sourceMappingURL=api.js.map