/**
 * Restart scheduling + state for dsh-restart-systemd.
 *
 * Two platform strategies, one state machine:
 *  - linux/WSL: \`systemctl --user restart dsh-web\` via \`ctx.subprocess\`.
 *  - win32: a detached PowerShell watcher that waits for this exact pid, then
 *    replays the launch command (or the configured launcher) after this pid
 *
 * Both write a one-shot flag before acting, keep a single-flight lock until the
 * act settles, and refuse requests for the residual window after a
 * plugin-driven boot. A \`when-idle\` request is queued instead of armed while
 * any agent is running; the queue re-checks idle after a settle window so a
 * finishing session cannot be interrupted by the next one starting.
 * @module dsh-restart-systemd/host/restart
 */
import type { Context } from '@deepseek-ai/cordis';
/** Service name the WebUI runs under (systemd user unit). */
export declare const SYSTEMD_UNIT = "dsh-web";
/** Delay before the actual act, so the browser receives the 202 first. */
export declare const DELAY_MS = 3000;
/** Re-click suppression window immediately after a plugin-driven boot. */
export declare const RESIDUAL_WINDOW_MS = 15000;
/** How often a queued restart re-reads the agent registry. */
export declare const QUEUE_POLL_MS = 2000;
/** Idle must hold this long before a queued restart fires. */
export declare const QUEUE_SETTLE_MS = 5000;
/** Which restart the caller asked for. */
export type RestartMode = 'now' | 'when-idle';
/** The outcome of one schedule attempt. */
export type ScheduleResult = {
    kind: 'scheduled';
    delayMs: number;
} | {
    kind: 'queued';
    waitingForSessions: number;
} | {
    kind: 'already-scheduled';
} | {
    kind: 'suppressed';
} | {
    kind: 'unsupported';
} | {
    kind: 'error';
    message: string;
};
/** The only payload the flag may contain. Extra legacy fields are ignored. */
export interface RestartFlag {
    reason: string;
    ts: number;
}
/** A restart waiting for every session to finish. */
export interface PendingRestart {
    reason: string;
    requestedAt: number;
    waitingForSessions: number;
}
export interface RestartStatePaths {
    flag: string;
    /** Old auto-resume marker; read only to remove a stale leftover once at boot. */
    legacyResume: string;
}
/** Everything a caller may override; production passes nothing. */
export interface RestartOptions {
    delayMs?: number;
    pollMs?: number;
    settleMs?: number;
    /** Platform override for tests; defaults to \`process.platform\`. */
    platform?: NodeJS.Platform;
}
/** Resolve the restart state paths under the writable DSH home. */
export declare function restartStatePaths(home: string): RestartStatePaths;
/** Linux/WSL restart through systemd, Windows through the external watcher. */
export declare function platformSupported(platform?: NodeJS.Platform): boolean;
/** The exact whitelisted argv used on Linux/WSL. No shell, no helper. */
export declare function restartArgv(): string[];
/** Live single-flight, queue, and residual-window state for one plugin context. */
export declare class RestartScheduler {
    private timer;
    private disposed;
    private readonly paths;
    private readonly ctx;
    private readonly home;
    private readonly platform;
    private readonly delayMs;
    private readonly pollMs;
    private readonly settleMs;
    private suppressedUntil;
    private inFlight;
    private initPromise;
    private pendingFlagTs;
    private queued;
    private queueTimer;
    private queueWake;
    constructor(ctx: Context, home: string, options?: RestartOptions);
    /**
     * Consume the boot flag exactly once. Requests await the same promise so a
     * request that arrives while boot state is still being read cannot race the
     * residual-window suppression.
     */
    initialize(): Promise<void>;
    /**
     * Read a leftover restart flag (including the old shape with sessionIds),
     * open the residual window, and remove both the flag and the obsolete
     * auto-resume marker. The flag is a safety token, never a recovery record.
     */
    consumeStaleState(): Promise<void>;
    /** Whether a restart is armed: flag written, act running, or timer pending. */
    isArmed(): boolean;
    /** The queued restart, when one is waiting for sessions to finish. */
    pending(): PendingRestart | undefined;
    /** Drop a queued restart. */
    cancelPending(): boolean;
    /**
     * Schedule one restart. The method is async because preparation can fail:
     * the single-flight lock is taken first, then the flag write is awaited, and
     * only a successful write arms the delayed act.
     *
     * \`when-idle\` only queues when the agent registry reports running agents; an
     * unreadable registry is an error rather than a silent immediate restart,
     * because interrupting live work is exactly what this mode exists to avoid.
     */
    schedule(reason: string, mode?: RestartMode): Promise<ScheduleResult>;
    /**
     * Write the flag and install the delayed act. The caller holds the
     * single-flight lock (\`inFlight\`).
     */
    private armNow;
    /**
     * Count agents whose status is \`running\`.
     * @returns the count, or undefined when no registry is reachable.
     */
    private countBusyAgents;
    /** The queued restart re-checks the registry on this timer. */
    private armQueuePoll;
    /** Cancel any armed queue timer and wake a sleeping settle window. */
    private clearQueueTimer;
    /** Sleep for the settle window, letting dispose or cancel end the wait. */
    private settle;
    /** One queue step: keep waiting, or fire once idle has settled. */
    private pollQueue;
    /** Perform the platform act; failures are logged, never rethrown. */
    private act;
    /** Invoke the fixed systemctl argv through the subprocess seam. */
    private actSystemd;
    /**
     * Hand the relaunch to a detached watcher, then leave through appExit.
     * Nothing is started unless the watcher was spawned first: a failed handoff
     * must leave this process alive with an actionable log, never a dead host and
     * no relaunch.
     */
    private actWindows;
    /** Remove the flag only when it is still the one written for this attempt. */
    private clearOwnFlag;
    /** Best-effort, ignore-when-absent unlink. */
    private safeUnlink;
    private log;
    /** Permanently close this scheduler; an accepted timer or queue is dropped. */
    dispose(): void;
}
//# sourceMappingURL=restart.d.ts.map