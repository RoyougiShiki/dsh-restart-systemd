/**
 * Browser-side wire helper for the /api/restart-dsh surface. Plain same-origin
 * fetch with a JSON body (like remote-web-ui's pair-api / the connection
 * client). Returns classified outcomes so the button can render state.
 *
 * There is deliberately NO reconnect probe here: the client runtime's own
 * ConnectionController already owns the connect/retry loop (exponential
 * backoff, base 500ms → cap 10s) and publishes its lifecycle on
 * `ctx.connection.state`, which the official ConnectionIndicator renders in
 * the sidebar footer. This module only asks the host to restart and reports
 * what the host answered.
 * @module dsh-restart-systemd/client/api
 */
export type RestartApiResult = {
    status: 'scheduled';
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
/** The request never completed — the service may already be going down. */
 | {
    status: 'unreachable';
} | {
    status: 'error';
    message: string;
};
/**
 * POST /api/restart-dsh, classifying HTTP codes into stable outcomes.
 * @param reason - why the restart was requested (audit + flag).
 * @returns the classified outcome.
 */
export declare function requestRestart(reason?: string): Promise<RestartApiResult>;
//# sourceMappingURL=api.d.ts.map