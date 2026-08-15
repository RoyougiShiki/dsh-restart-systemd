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
/**
 * Whether an HTTP request looks like it came from the machine itself.
 * @param request - the incoming request.
 * @returns true when the socket, Host, sec-fetch-site, and Origin are loopback/same-origin.
 */
export function isLoopbackRequest(request) {
    const address = request.socket.remoteAddress;
    if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1')
        return false;
    const host = request.headers.host;
    if (typeof host !== 'string')
        return false;
    let hostUrl;
    try {
        hostUrl = new URL(`http://${host}`);
    }
    catch {
        return false;
    }
    if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]')
        return false;
    if (request.headers['sec-fetch-site'] === 'cross-site')
        return false;
    const origin = request.headers.origin;
    if (origin === undefined)
        return true;
    try {
        return new URL(origin).host === hostUrl.host;
    }
    catch {
        return false;
    }
}
/** Write the shared non-loopback rejection (same body as dsh-ssh / dsh-aionui-panel). */
export function forbidden(res) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'forbidden: loopback-only' }));
}
//# sourceMappingURL=gate.js.map