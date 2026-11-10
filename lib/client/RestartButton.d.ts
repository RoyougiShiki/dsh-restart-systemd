/**
 * Sidebar-footer restart trigger for dsh-restart-systemd.
 *
 * Rendered into the official sidebar.footer.action seat. The component owns
 * only the confirmation dialog and the POST result bubble. It paints no
 * wait/recovery surface: while the request is in flight the trigger alone
 * carries the busy state, and after a 202 it goes back to idle because DSH's
 * own ConnectionIndicator narrates the outage and the reconnect.
 * @module dsh-restart-systemd/client/RestartButton
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
/** Entry props: the footer seat's column state plus the standard locale seat. */
export interface RestartButtonProps extends PropsLocale<'restart-dsh'> {
    /** Whether the sidebar renders wide (false = 56px rail). */
    wide: boolean;
}
/** A restart glyph (refresh/arrow bicycle) matching the outline icon style. */
export declare function RestartGlyph({ size }: {
    size?: number;
}): import("react").JSX.Element;
/**
 * Render the restart trigger, its confirmation dialog, and the error bubble.
 * @param props - footer seat props plus the locale seat.
 * @returns the entry element tree.
 */
export declare function RestartButton({ wide, t }: RestartButtonProps): import("react").JSX.Element;
//# sourceMappingURL=RestartButton.d.ts.map