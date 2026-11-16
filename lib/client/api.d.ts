/**
 * Browser-side wire helper for /api/restart-dsh.
 *
 * Three calls share the same loopback-fenced route: POST asks for a restart
 * (immediately or once sessions are idle), GET reports a queued restart, and
 * DELETE cancels one. Each call has its own 10s AbortController budget so a
 * hung request becomes a visible "unknown" result; nothing here waits for the
 * service to come back and there is no reconnect probe.
 * @module dsh-restart-systemd/client/api
 */
/** Which restart the user asked for. */
export type RestartMode = 'now' | 'when-idle';
export type RestartApiResult = {
    status: 'accepted';
    delayMs: number;
} | {
    status: 'queued';
    waitingForSessions: number;
} | {
    status: 'already-scheduled';
} | {
    status: 'suppressed';
} | {
    status: 'forbidden';
} | {
    status: 'unsupported';
}
/** The request never completed; acceptance is genuinely unknown. */
 | {
    status: 'unknown';
} | {
    status: 'error';
    message: string;
};
/** A restart the host is holding until every session goes idle. */
export interface QueuedRestart {
    reason: string;
    requestedAt: number;
    waitingForSessions: number;
}
/**
 * POST /api/restart-dsh and classify the host answer.
 * @param mode - restart now, or queue until sessions are idle.
 * @param reason - why the restart was requested (audit + flag).
 * @returns the classified outcome.
 */
export declare function requestRestart(mode?: RestartMode, reason?: string): Promise<RestartApiResult>;
/**
 * Read the queued restart, so a reloaded page still shows the pending state.
 * @returns the queued restart, null when none is queued, or undefined when the
 *   host could not be asked.
 */
export declare function fetchQueuedRestart(): Promise<QueuedRestart | null | undefined>;
/**
 * Cancel the queued restart.
 * @returns true when the host had one to cancel, false otherwise.
 */
export declare function cancelQueuedRestart(): Promise<boolean>;
//# sourceMappingURL=api.d.ts.map