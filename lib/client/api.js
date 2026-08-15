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
export function waitForReconnect(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
        const probe = async () => {
            if (Date.now() >= deadline) {
                resolve(false);
                return;
            }
            try {
                const res = await fetch('/api/health', { method: 'GET' });
                if (res.ok || res.status < 500) {
                    resolve(true);
                    return;
                }
            }
            catch {
                // not up yet
            }
            setTimeout(() => void probe(), 1500);
        };
        void probe();
    });
}
//# sourceMappingURL=api.js.map