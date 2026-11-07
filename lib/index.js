/**
 * dsh-restart-systemd - host half.
 *
 * A loopback-fenced POST /api/restart-dsh route schedules exactly one
 * systemctl --user restart dsh-web on Linux/WSL. The route is deliberately
 * outside the /plugins prefix, which the official client-modules route owns.
 *
 * There is no slash command, no agent recovery, and no connection listener in
 * this half. The flag under $DSH_HOME is a safety token: it opens a residual
 * suppression window on the next boot and is deleted without ever triggering a
 * restart on its own.
 * @module dsh-restart-systemd
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { isLoopbackRequest, forbidden } from "./host/gate.js";
import { RestartScheduler } from "./host/restart.js";
/** Only the webserver and subprocess seams are needed now. */
export const inject = ['webServer', 'subprocess'];
/** Mount the restart route and the boot-time flag consumer. */
export function apply(ctx) {
    const scheduler = new RestartScheduler(ctx, resolveDshHome(undefined, process.env));
    ctx.effect(() => {
        // Start consuming boot state immediately, but expose the same promise to
        // requests so a request cannot race the residual-window suppression.
        void scheduler.initialize().catch((error) => {
            ctx.logger.warn('dsh-restart-systemd: boot state initialization failed: ' + String(error));
        });
        return () => scheduler.dispose();
    }, 'dsh-restart-systemd: boot flag + scheduler cleanup');
    const handler = (req, res) => {
        if (!isLoopbackRequest(req)) {
            forbidden(res);
            return;
        }
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method-not-allowed' });
            return;
        }
        const contentType = req.headers['content-type'] ?? '';
        if (!contentType.toLowerCase().startsWith('application/json')) {
            sendJson(res, 415, { error: 'content-type-json-required' });
            return;
        }
        void handleRequest(req, res, scheduler, ctx).catch((error) => {
            ctx.logger.error('dsh-restart-systemd: unhandled restart request error: ' + String(error));
            sendJson(res, 500, { error: 'restart-failed', message: 'restart request failed: ' + String(error) });
        });
    };
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/restart-dsh', handler }), 'dsh-restart-systemd: /api/restart-dsh route');
}
async function handleRequest(req, res, scheduler, ctx) {
    const body = await readBody(req);
    if (!body.ok) {
        sendJson(res, body.status, { error: body.error });
        return;
    }
    const payload = body.payload;
    const reason = typeof payload?.reason === 'string' && payload.reason !== '' ? payload.reason : 'webui-button';
    let result;
    try {
        result = await scheduler.schedule(reason);
    }
    catch (error) {
        ctx.logger.error('dsh-restart-systemd: restart scheduling threw: ' + String(error));
        result = { kind: 'error', message: String(error) };
    }
    switch (result.kind) {
        case 'scheduled': {
            ctx.logger.info('dsh-restart-systemd: restart scheduled (reason=' + reason + ') delayMs=' + result.delayMs);
            sendJson(res, 202, { scheduled: true, delayMs: result.delayMs, message: 'restart scheduled' });
            break;
        }
        case 'already-scheduled': {
            sendJson(res, 409, { error: 'already-scheduled', message: 'a restart is already in flight' });
            break;
        }
        case 'suppressed': {
            sendJson(res, 429, { error: 'suppressed', message: 'just restarted; please wait a moment before trying again' });
            break;
        }
        case 'unsupported': {
            sendJson(res, 501, { error: 'unsupported-platform', message: 'restart is not supported on ' + process.platform });
            break;
        }
        case 'error': {
            ctx.logger.error('dsh-restart-systemd: restart preparation failed: ' + result.message);
            sendJson(res, 500, { error: 'restart-failed', message: result.message });
            break;
        }
    }
}
function sendJson(res, status, body) {
    if (res.destroyed || res.writableEnded)
        return;
    try {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
    }
    catch {
        // The client may have disconnected while the restart was being prepared.
    }
}
/** Read a JSON body (capped at 1MB) and turn every malformed case into a 4xx. */
async function readBody(req) {
    try {
        const chunks = [];
        let total = 0;
        for await (const chunk of req) {
            const buffer = chunk;
            chunks.push(buffer);
            total += buffer.length;
            if (total > 1 << 20)
                return { ok: false, status: 413, error: 'body-too-large' };
        }
        const text = Buffer.concat(chunks).toString('utf8');
        if (text === '')
            return { ok: true, payload: null };
        try {
            return { ok: true, payload: JSON.parse(text) };
        }
        catch {
            return { ok: false, status: 400, error: 'invalid-json' };
        }
    }
    catch {
        return { ok: false, status: 400, error: 'invalid-body' };
    }
}
//# sourceMappingURL=index.js.map