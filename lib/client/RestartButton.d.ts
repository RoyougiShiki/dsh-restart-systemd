/**
 * Sidebar-footer restart trigger for dsh-restart-systemd.
 *
 * Rendered into the official `sidebar.footer.action` seat (the slot beside the
 * Settings trigger — where remote-web-ui's phone icon lives), so it appears
 * next to the phone icon in the dark-theme footer row. Behavior:
 *  - wide column  → an icon button sized to the settings rail;
 *  - collapsed 56px rail → a single square icon; the whole footer-action seat
 *    is flipped to a centered vertical column while in rail mode.
 * On click it shows a confirm dialog, POSTs /api/restart-dsh, and reports the
 * host's answer ("already in flight", loopback denial, unsupported platform, …).
 *
 * ## Who owns the reconnect UX
 *
 * The plugin does NOT probe, poll, or render the outage itself. The client
 * runtime's ConnectionController owns the connect/retry loop (exponential
 * backoff, base 500ms → cap 10s) and publishes its lifecycle on
 * `ctx.connection.state`; the official ConnectionIndicator renders it in the
 * settings row of this same sidebar foot ("连接异常，点击立即重连" /
 * "重新连接中" / "连接成功"), and clicking it forces an immediate retry. This
 * component only *consumes* that state for one purpose the runtime cannot
 * serve: a full page reload once the service is back, because the runtime
 * reconnects the transport but keeps running the pre-restart client bundle.
 *
 * All styling rides the shell's design tokens (`--dsw-alias-*`), so it matches
 * the dark/light theme automatically. Inline `style` objects are used instead
 * of a CSS module so the client half stays runnable from a plain `tsc` emit
 * (no CSS-bundling step) — the same reason the glyph is a hand-drawn SVG.
 *
 * @module dsh-restart-systemd/client/RestartButton
 */
import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client';
import type { PropsLocale, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
/** Entry props: the footer seat's column state + the standard locale seat. */
export interface RestartButtonProps extends PropsLocale<'restart-dsh'> {
    /** Whether the sidebar renders wide (false = 56px rail). */
    wide: boolean;
    /**
     * Selector hook over the client runtime's connection lifecycle, bound by the
     * slot renderer from this registration's injected `hooks` compartment. The
     * plugin reads it to know when a restart it scheduled has actually completed
     * — it never runs a probe of its own.
     */
    useConnectionState: SnapshotSelectorHook<ConnectionState | undefined>;
}
/** What one connection-state transition means for the restart reload. */
export interface ReloadDecision {
    /** Reload the page now. */
    reload: boolean;
    /** The outage flag to carry into the next transition. */
    sawOutage: boolean;
}
/**
 * Decide what a connection-state transition means for a restart this page
 * scheduled. Pure, so the guard that matters most — never reloading before the
 * service has actually gone down — is testable without a browser.
 *
 * A `connected` reading only proves the origin answers; during the host's ~3s
 * scheduling delay it still answers from the pre-restart process. The reload
 * therefore requires the recovery *edge*: an observed outage first, then
 * `connected`.
 *
 * @param state - the runtime's current connection lifecycle state.
 * @param flags - whether this page scheduled a restart, and whether an outage
 *   has already been observed since then.
 * @returns whether to reload, and the outage flag for the next transition.
 */
export declare function restartReloadDecision(state: ConnectionState | undefined, flags: {
    scheduled: boolean;
    sawOutage: boolean;
}): ReloadDecision;
/** A restart glyph (refresh/arrow bicycle) matching the outline icon style. */
export declare function RestartGlyph({ size }: {
    size?: number;
}): import("react").JSX.Element;
/**
 * Render the restart trigger + confirm dialog.
 * @param props - the footer seat props plus the connection-state selector hook.
 * @returns the entry element tree.
 */
export declare function RestartButton({ wide, useConnectionState, t }: RestartButtonProps): import("react").JSX.Element;
//# sourceMappingURL=RestartButton.d.ts.map