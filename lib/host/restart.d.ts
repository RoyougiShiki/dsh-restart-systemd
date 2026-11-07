/**
 * Restart scheduling + state for the minimal dsh-restart-systemd host half.
 *
 * The only supported runtime is a Linux/WSL systemd user unit. The scheduler
 * writes a one-shot flag before the delayed spawn, keeps a single-flight lock
 * until the spawn settles, and refuses requests for the residual window after
 * a plugin-driven boot. It never resumes agents and never reads a session
 * snapshot.
 * @module dsh-restart-systemd/host/restart
 */
import type { Context } from '@deepseek-ai/cordis';
/** Service name the WebUI runs under (systemd user unit). */
export declare const SYSTEMD_UNIT = "dsh-web";
/** Delay before the actual spawn, so the browser receives the 202 first. */
export declare const DELAY_MS = 3000;
/** Re-click suppression window immediately after a plugin-driven boot. */
export declare const RESIDUAL_WINDOW_MS = 15000;
/** The outcome of one schedule attempt. */
export type ScheduleResult = {
    kind: 'scheduled';
    delayMs: number;
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
export interface RestartStatePaths {
    flag: string;
    /** Old auto-resume marker; read only to remove a stale leftover once at boot. */
    legacyResume: string;
}
/** Resolve the restart state paths under the writable DSH home. */
export declare function restartStatePaths(home: string): RestartStatePaths;
/** Only a Linux/WSL systemd user unit is managed by this plugin. */
export declare function platformSupported(): boolean;
/** The exact whitelisted argv. No shell, no helper, no platform branch. */
export declare function restartArgv(): string[];
/** Live single-flight and residual-window state for one plugin context. */
export declare class RestartScheduler {
    private timer;
    private disposed;
    private readonly paths;
    private readonly ctx;
    private suppressedUntil;
    private inFlight;
    private initPromise;
    private pendingFlagTs;
    constructor(ctx: Context, home: string);
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
    /**
     * Schedule one restart. The method is async because preparation can fail:
     * the single-flight lock is taken first, then the flag write is awaited, and
     * only a successful write installs the delayed spawn and returns 202-shaped
     * information. A failed write returns error without spawning.
     */
    schedule(reason: string): Promise<ScheduleResult>;
    /** Invoke the fixed systemctl argv; failures are logged, never rethrown. */
    private spawn;
    /** Remove the flag only when it is still the one written for this attempt. */
    private clearOwnFlag;
    /** Best-effort, ignore-when-absent unlink. */
    private safeUnlink;
    /** Clear a pending timer; an accepted but not-yet-spawned flag is removed. */
    private log;
    /** Permanently close this scheduler; an accepted timer is cleared and its flag is removed. */
    dispose(): void;
}
//# sourceMappingURL=restart.d.ts.map