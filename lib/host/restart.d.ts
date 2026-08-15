/**
 * Restart scheduling + state for dsh-restart-systemd (host half).
 *
 * Owns:
 *  - platform detection AND the exact spawn: `systemctl --user restart dsh-web`
 *    on WSL/Linux (the primary target), and a detached spawn of a helper on
 *    `win32` (the WSL path never reaches it — `process.platform` is `linux`
 *    inside WSL even though the OS is Windows underneath, so the systemctl
 *    branch is what actually runs on this machine).
 *  - the delayed schedule (respond 202 first, spawn after DELAY_MS so the
 *    browser gets its response and agent callbacks flush before the process
 *    dies) with single-flight dedup (a second POST while one is in flight →
 *    409).
 *  - flag-file three-in-one safety (`$DSH_HOME/dsh-restart.flag`: written
 *    before the spawn, consumed-and-deleted once at boot, never re-schedules)
 *    plus a residual-window probe that suppress re-clicks right after a
 *    plugin-driven restart, so a retry loop cannot ping-pong the service.
 *  - the restart-recover handoff: before spawning it snapshots the currently
 *    running agent session ids to `$DSH_HOME/dsh-restart-resume.json`; the
 *    boot side (recover.ts) reads it and later auto-continues each agent whose
 *    turn was interrupted.
 *
 * Spawn is a whitelisted argv array (no shell interpretation, no string
 * concat): `ctx.subprocess.spawn({ argv: [...], cwd, stdio, graceMs })`.
 * @module dsh-restart-systemd/host/restart
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SessionId } from '@deepseek-ai/dsh-session';
/** Service name the WebUI runs under (systemd user unit). */
export declare const SYSTEMD_UNIT = "dsh-web";
/** Delay before the actual spawn — lets the browser receive the 202 response first. */
export declare const DELAY_MS = 3000;
/**
 * After a plugin-driven boot (flag was consumed) the service must run this
 * long before another click is honored, otherwise a retry loop could
 * ping-pong the unit forever.
 */
export declare const RESIDUAL_WINDOW_MS = 15000;
/** A restart that was scheduled but not yet executed. */
export interface PendingRestart {
    reason: string;
    sessionIds: SessionId[];
    scheduledAt: number;
}
/** The outcome of a `scheduleRestart` call. */
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
/** The dsh-restart.flag payload (the resume list is a sibling file). */
export interface RestartFlag {
    reason: string;
    ts: number;
    sessionIds: SessionId[];
}
export interface RestartStatePaths {
    flag: string;
    resume: string;
}
/** Resolve the two state file paths under the (writable) DSH home. */
export declare function restartStatePaths(home: string): RestartStatePaths;
/**
 * True when this host run can restart via the managed path. On WSL/Linux we
 * drive `systemctl --user` directly; on win32 (non-WSL Windows) we spawn a
 * detached helper process that performs the restart and keeps running after
 * this one exits. Node reports `linux` inside WSL, so the systemctl branch is
 * what the primary target actually uses.
 */
export declare function platformIsManaged(): boolean;
/** Build the exact argv for the current platform. */
export declare function restartArgv(): string[];
/**
 * A platform guard so schedule() refuses platforms we cannot manage. macOS
 * would need launchctl; for now we keep the argv as systemctl for Linux/WSL
 * and only allow win32 + the systemctl platforms.
 */
export declare function platformSupported(): boolean;
/** The live single-flight/dedup state for one plugin context. */
export declare class RestartScheduler {
    private timer;
    private readonly paths;
    private readonly ctx;
    /** Prevents an auto-reload loop: set when a flag was consumed at a fresh boot. */
    private suppressedUntil;
    constructor(ctx: Context, home: string);
    consumeStaleState(): Promise<void>;
    /**
     * Snapshot the currently *running* agents into the resume file (the trigger
     * side of restart-recover). Only agents whose status is `running` are
     * recorded; idle agents do not need to be resumed because nothing was
     * interrupted.
     * @param agents - all live agents from the registry.
     */
    writeResumeState(agents: readonly Agent[], reason: string): Promise<void>;
    /**
     * Schedule a restart. Single-flight: a second call while one is in flight →
     * `already-scheduled` (HTTP 409). Returns 202-shaped info on success. The
     * actual spawn is deferred DELAY_MS so the HTTP response and any agent
     * callback flush lands before the process dies.
     * @param reason - human reason for the restart (audit log + flag).
     * @param agentRunner - how to enumerate live running agents.
     */
    schedule(reason: string, agentRunner: () => readonly Agent[]): ScheduleResult;
    /** Actually invoke the restart command (whitelisted argv, no shell). */
    private spawn;
    /** Best-effort, ignore-when-absent unlink. */
    private safeUnlink;
    /** Used by shutdown/unload to clear a pending timer. */
    dispose(): void;
}
//# sourceMappingURL=restart.d.ts.map