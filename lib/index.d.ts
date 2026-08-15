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
/** Required service seams from the root: webserver routes, subprocess spawn, prompt band, commands. */
export declare const inject: readonly ["webServer", "subprocess", "systemPrompt", "commands"];
/** Model-facing announcement of the restart surface (audit / self-help copy). */
export declare const RESTART_GUIDANCE = "\u672C\u63D2\u4EF6\uFF08dsh-restart-systemd\uFF09\u5728 WebUI \u5DE6\u4FA7\u4FA7\u8FB9\u680F\u5E95\u90E8\u201C\u8BBE\u7F6E\u201D\u6309\u94AE\u65C1\u63D0\u4F9B\u4E00\u4E2A\u91CD\u542F\u6309\u94AE\uFF0C\u5E76\u6CE8\u518C `/restart` \u547D\u4EE4\uFF1A\u70B9\u51FB/\u8F93\u5165\u540E\u4E8C\u6B21\u786E\u8BA4\uFF0C\u670D\u52A1\u7AEF\u8FD4\u56DE 202 \u5E76\u5EF6\u8FDF\u7EA6 3s \u6267\u884C `systemctl --user restart dsh-web`\uFF08WSL/Linux\uFF1BWindows \u8D70 detached helper\uFF09\u3002\u91CD\u542F\u524D\u4F1A\u8BB0\u5F55 running agent \u7684\u4F1A\u8BDD\uFF0C\u91CD\u542F\u540E\u81EA\u52A8\u7EED\u63A5\u88AB\u4E2D\u65AD\u7684 turn\u3002\u91CD\u590D\u89E6\u53D1\u8FD4\u56DE 409\uFF0C\u975E loopback \u6765\u6E90\u8FD4\u56DE 403\u3002\u624B\u52A8\u6392\u969C\uFF1Ajournalctl --user -u dsh-web\u3002";
/**
 * Mount the restart route, the /restart command, and the boot-time
 * consume/recover listeners.
 * @param ctx - context carrying webServer, subprocess, systemPrompt.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map