/**
 * Browser-side wire helper for the /api/restart-dsh surface. Plain same-origin
 * fetch with a JSON body (like remote-web-ui's pair-api / the connection
 * client). Returns classified outcomes so the button can render state.
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
/**
 * Poll until the WebUI is reachable again after a restart (the connection
 * client reconnects on its own; this is a best-effort probe for the button's
 * "reconnected" copy). Resolves true when a fetch to the same origin succeeds
 * within the timeout.
 * @param timeoutMs - how long to keep probing.
 * @returns true when the origin became reachable.
 */
export declare function waitForReconnect(timeoutMs?: number, initialWaitMs?: number): Promise<boolean>;
//# sourceMappingURL=api.d.ts.map