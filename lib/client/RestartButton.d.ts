/**
 * Sidebar-footer restart trigger for dsh-restart-systemd.
 *
 * Rendered into the official sidebar.footer.action seat. The component owns the
 * confirmation dialog, the queued-restart card, and the POST result bubble.
 *
 * The dialog offers two intents, which is the point of the plugin: "restart
 * now" interrupts whatever is running, "restart when idle" is handed to the
 * host and fires only after every session has finished, so the user can ask the
 * moment a plugin changed and stop thinking about it. It paints no recovery or
 * reconnect surface: once the request leaves, DSH's own ConnectionIndicator
 * owns the outage narration, and this plugin never reloads the page.
 * @module dsh-restart-systemd/client/RestartButton
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
/** Entry props: the footer seat's column state plus the standard locale seat. */
export interface RestartButtonProps extends PropsLocale<'restart-dsh'> {
    /** Whether the sidebar renders wide (false = 56px rail). */
    wide: boolean;
}
/** A restart glyph (circular arrows) matching the outline icon style. */
export declare function RestartGlyph({ size }: {
    size?: number;
}): import("react").JSX.Element;
/**
 * Render the restart trigger, its confirmation dialog, the queued card, and the
 * error bubble.
 * @param props - footer seat props plus the locale seat.
 * @returns the entry element tree.
 */
export declare function RestartButton({ wide, t }: RestartButtonProps): import("react").JSX.Element;
//# sourceMappingURL=RestartButton.d.ts.map