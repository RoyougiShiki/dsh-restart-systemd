/**
 * Sidebar-footer restart trigger for dsh-restart-systemd.
 *
 * Rendered into the official sidebar.footer.action seat. The component owns
 * only the confirmation dialog and the POST result display. It never waits for
 * recovery, never reloads the page, and never reads a connection service.
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
 * Render the restart trigger and its result dialog.
 * @param props - footer seat props plus the locale seat.
 * @returns the entry element tree.
 */
export declare function RestartButton({ wide, t }: RestartButtonProps): import("react").JSX.Element;
//# sourceMappingURL=RestartButton.d.ts.map