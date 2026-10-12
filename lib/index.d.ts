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
import type { Context } from '@deepseek-ai/cordis';
/**
 * Required service seams from the root: webserver routes, subprocess spawn,
 * prompt band, commands, and the live agent registry.
 *
 * `agents` is NOT optional. Cordis resolves services only for declared
 * dependencies, so reading `ctx.agents` without it throws — and because the
 * snapshot helper caught that throw, every restart recorded ZERO sessions and
 * auto-resume silently never ran. Declaring it is what makes the registry
 * reachable.
 */
export declare const inject: readonly ["webServer", "subprocess", "commands", "agents"];
/**
 * Mount the restart route, the /restart command, and the boot-time
 * consume/recover listeners.
 *
 * Contributes nothing to the model's prompt: the restart surface is a human
 * affordance (a sidebar button plus a slash command), and the slash-command
 * registry is contractually outside model requests. See README "不写入系统提示词".
 * @param ctx - context carrying webServer, subprocess, commands, agents.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map