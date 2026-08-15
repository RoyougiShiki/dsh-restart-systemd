/**
 * dsh-restart-systemd — host half.
 *
 * The node plane of the dual-face plugin: a loopback-fenced `/api/restart-dsh`
 * HTTP route plus a `/restart` cordis command, both of which schedule
 * `systemctl --user restart dsh-web` (WSL/Linux; a detached spawn helper on
 * Windows), with single-flight dedup (409 on a duplicate), a flag-file boot
 * token + residual-window probe for loop safety, and a restart-recover listener
 * that auto-continues agents whose turn the restart interrupted.
 *
 * Route path is deliberately OUTSIDE the `/plugins` prefix (official
 * client-modules owns `/plugins` for serving bundles; the restart route would
 * 405 there). We register the exact path `/api/restart-dsh` on the shared
 * webserver, mirroring how dsh-aionui-panel uses `/aionui-panel/*` and how
 * mcp-manager uses `/mcp-manager/*`.
 * @module dsh-restart-systemd
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { isLoopbackRequest, forbidden } from "./host/gate.js";
import { RestartScheduler, DELAY_MS } from "./host/restart.js";
import { Recovery } from "./host/recover.js";
/** Home that this plugin writes its state under. */
const HOME = resolveDshHome(undefined, process.env);
/** Required service seams from the root: webserver routes, subprocess spawn, prompt band. */
export const inject = ['webServer', 'subprocess', 'systemPrompt'];
/** Model-facing announcement of the restart surface (audit / self-help copy). */
export const RESTART_GUIDANCE = '本插件（dsh-restart-systemd）在 WebUI 左侧侧边栏底部“设置”按钮旁提供一个重启按钮，并注册 `/restart` 命令：点击/输入后二次确认，服务端返回 202 并延迟约 3s 执行 `systemctl --user restart dsh-web`（WSL/Linux；Windows 走 detached helper）。重启前会记录 running agent 的会话，重启后自动续接被中断的 turn。重复触发返回 409，非 loopback 来源返回 403。手动排障：journalctl --user -u dsh-web。';
/**
 * Mount the restart route, the /restart command, and the boot-time
 * consume/recover listeners.
 * @param ctx - context carrying webServer, subprocess, systemPrompt.
 */
export function apply(ctx) {
    const scheduler = new RestartScheduler(ctx, HOME);
    const recovery = new Recovery(ctx, joinStatePath('dsh-restart-resume.json'));
    ctx.effect(() => () => scheduler.dispose(), 'dsh-restart-systemd: scheduler cleanup');
    // Boot-time one-shot: consume (delete) a leftover flag token from a previous
    // plugin-driven restart and arm recovery for listed agents. Runs before any
    // session is restored, so the `agent/created` listener is already installed.
    ctx.effect(() => {
        void scheduler.consumeStaleState();
        return recovery.arm();
    }, 'dsh-restart-systemd: boot consume + recovery arm');
    const agentRunner = () => {
        // Enumerate live agents from the root registry. The agent service is a
        // root service (not injection-declared), so reach it through ctx.agents.
        try {
            const agents = ctx.agents;
            return agents?.list?.() ?? [];
        }
        catch {
            // ignore — best effort snapshot
            return [];
        }
    };
    // --- HTTP route: POST /api/restart-dsh ---
    const handler = (req, res) => {
        if (!isLoopbackRequest(req)) {
            forbidden(res);
            return;
        }
        if (req.method !== 'POST') {
            res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'method-not-allowed' }));
            return;
        }
        const contentType = req.headers['content-type'] ?? '';
        if (!contentType.toLowerCase().startsWith('application/json')) {
            res.writeHead(415, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'content-type-json-required' }));
            return;
        }
        void readBody(req).then((payload) => {
            const reason = typeof payload?.reason === 'string' && payload.reason !== '' ? payload.reason : 'webui-button';
            const result = scheduler.schedule(reason, agentRunner);
            switch (result.kind) {
                case 'scheduled': {
                    ctx.logger.info(`dsh-restart-systemd: restart scheduled (reason=${reason}) delayMs=${result.delayMs}`);
                    res.writeHead(202, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ scheduled: true, delayMs: result.delayMs, message: 'restart scheduled' }));
                    break;
                }
                case 'already-scheduled': {
                    res.writeHead(409, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: 'already-scheduled', message: 'a restart is already in flight' }));
                    break;
                }
                case 'suppressed': {
                    res.writeHead(429, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: 'suppressed', message: 'just restarted; please wait a moment before trying again' }));
                    break;
                }
                case 'unsupported': {
                    res.writeHead(501, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: 'unsupported-platform', message: `restart is not supported on ${process.platform}` }));
                    break;
                }
                case 'error': {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: 'restart-failed', message: result.message }));
                    break;
                }
            }
        });
    };
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/restart-dsh', handler }), 'dsh-restart-systemd: /api/restart-dsh route');
    // --- /restart command ---
    ctx.effect(() => ctx.commands.register({
        name: 'restart',
        description: 'Restart the DeepSeek Harness web service (systemctl --user restart dsh-web)',
        handler: () => {
            const result = scheduler.schedule('command', agentRunner);
            if (result.kind === 'scheduled') {
                ctx.logger.info('dsh-restart-systemd: /restart scheduled');
                return { kind: 'success', text: `Restart scheduled — the service will restart in ${Math.round(result.delayMs / 1000)}s and auto-reconnect.` };
            }
            if (result.kind === 'already-scheduled') {
                return { kind: 'error', text: 'A restart is already in flight; please wait.' };
            }
            if (result.kind === 'suppressed') {
                return { kind: 'error', text: 'The service just restarted via this plugin; please wait a moment before trying again.' };
            }
            return { kind: 'error', text: `Restart is not supported on this platform (${process.platform}); run: systemctl --user restart dsh-web` };
        },
    }), 'dsh-restart-systemd: /restart command');
    // --- announcement to agents (system-prompt section) ---
    ctx.effect(() => ctx.systemPrompt.section({
        name: 'plugin:dsh-restart-systemd',
        order: 215,
        text: RESTART_GUIDANCE,
    }), 'dsh-restart-systemd: prompt section');
}
/** Join one filename onto the resolved DSH home. */
function joinStatePath(name) {
    return HOME.endsWith('/') ? `${HOME}${name}` : `${HOME}/${name}`;
}
/** Read a small JSON body (capped at 1MB). */
async function readBody(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buffer = chunk;
        chunks.push(buffer);
        total += buffer.length;
        if (total > 1 << 20)
            return null;
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (text === '')
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=index.js.map