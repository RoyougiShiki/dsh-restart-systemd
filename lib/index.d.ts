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
import type { Context } from '@deepseek-ai/cordis';
/** Only the webserver and subprocess seams are needed now. */
export declare const inject: readonly ["webServer", "subprocess"];
/** Mount the restart route and the boot-time flag consumer. */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map