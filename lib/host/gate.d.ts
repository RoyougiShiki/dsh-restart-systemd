/**
 * Loopback trust fence for the /api/restart-dsh route.
 *
 * Copied from dsh-aionui-panel's `src/host/gate.ts` fence (the same judgment
 * dsh-ssh and remote-web-ui apply): a loopback socket address AND a loopback
 * Host header, plus browser same-origin markers. The restart route schedules a
 * full service restart, so a LAN-exposed dsh web must never serve it to an
 * unpaired device. The socket address is authoritative; X-Forwarded-For is
 * never trusted.
 * @module dsh-restart-systemd/host/gate
 */
import type { IncomingMessage } from 'node:http';
import type { ServerResponse } from 'node:http';
/**
 * Whether an HTTP request looks like it came from the machine itself.
 * @param request - the incoming request.
 * @returns true when the socket, Host, sec-fetch-site, and Origin are loopback/same-origin.
 */
export declare function isLoopbackRequest(request: IncomingMessage): boolean;
/** Write the shared non-loopback rejection (same body as dsh-ssh / dsh-aionui-panel). */
export declare function forbidden(res: ServerResponse): void;
//# sourceMappingURL=gate.d.ts.map