/**
 * Browser-side wire helper for POST /api/restart-dsh.
 *
 * The request has its own 10s AbortController budget. That budget exists only
 * so a hung HTTP request becomes a visible "unknown" result; it does not wait
 * for the service to recover and there is no reconnect probe here.
 * @module dsh-restart-systemd/client/api
 */
export type RestartApiResult = {
    status: 'accepted';
    delayMs: number;
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
/**
 * POST /api/restart-dsh and classify the host answer.
 * @param reason - why the restart was requested (audit + flag).
 * @returns the classified outcome.
 */
export declare function requestRestart(reason?: string): Promise<RestartApiResult>;
//# sourceMappingURL=api.d.ts.map