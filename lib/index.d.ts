/**
 * dsh-restart-systemd - host half.
 *
 * A loopback-fenced \`/api/restart-dsh\` route schedules exactly one restart.
 * On Linux/WSL that is \`systemctl --user restart dsh-web\`; on Windows it is a
 * detached watcher that waits for this process to exit and then runs the
 * configured launcher. The route is deliberately outside the /plugins prefix,
 * which the official client-modules route owns.
 *
 * Two modes: \`now\` restarts after the fixed delay no matter what is running,
 * \`when-idle\` queues the request and fires only after every agent has been
 * idle for the settle window. The same path serves GET (queue status) and
 * DELETE (cancel the queued restart).
 *
 * There is no slash command, no agent recovery, and no connection listener in
 * this half. The flag under \`$DSH_HOME\` is a safety token: it opens a residual
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