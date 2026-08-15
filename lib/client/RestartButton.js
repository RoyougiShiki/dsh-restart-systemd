import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Sidebar-footer restart trigger for dsh-restart-systemd.
 *
 * Rendered into the official `sidebar.footer.action` seat (the slot beside the
 * Settings trigger — where remote-web-ui's phone icon lives), so it appears
 * next to the phone icon in the dark-theme footer row. Behavior:
 *  - wide column  → an icon button sized to the settings rail;
 *  - collapsed 56px rail → a single square icon.
 * On click it shows a confirm dialog (restarting drops in-flight agent work
 * which then auto-resumes), POSTs /api/restart-dsh, and reports state:
 * "already triggered", "reconnected", or a failure hint pointing at
 * `systemctl --user status dsh-web`.
 *
 * All styling rides the shell's design tokens (`--dsw-alias-*`), so it matches
 * the dark/light theme automatically. Inline `style` objects are used instead
 * of a CSS module so the client half stays runnable from a plain `tsc` emit
 * (no CSS-bundling step) — the same reason the glyph is a hand-drawn SVG.
 *
 * @module dsh-restart-systemd/client/RestartButton
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { requestRestart, waitForReconnect } from "./api.js";
/** A restart glyph (refresh/arrow bicycle) matching the outline icon style. */
export function RestartGlyph({ size = 16 }) {
    return (_jsx("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: _jsx("path", { d: "M2.5 4.6A6 6 0 0 1 13.5 8M13.5 8l-2.1-2.2M13.5 8l-2.2 2.1M13.5 11.4A6 6 0 0 1 2.5 8M2.5 8l2.2 2.2M2.5 8l2.1-2.2", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" }) }));
}
const triggerStyle = {
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    border: 'none',
    borderRadius: '50%',
    padding: 0,
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
    transition: 'background-color 120ms ease, color 120ms ease',
};
const triggerRailStyle = {
    ...triggerStyle,
    width: '100%',
    height: 40,
    borderRadius: 10,
};
const overlayStyle = {
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
};
const maskStyle = { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' };
const dialogStyle = {
    position: 'relative',
    boxSizing: 'border-box',
    width: 400,
    maxWidth: 'calc(100vw - 48px)',
    padding: '20px 22px',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 16,
    background: 'var(--dsw-alias-bg-layer-2)',
    boxShadow: 'var(--dsw-shadow-lv3)',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: 14,
    lineHeight: 1.55,
};
const titleStyle = { margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' };
const bodyStyle = { margin: '0 0 16px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-line' };
const actionsStyle = { display: 'flex', justifyContent: 'flex-end', gap: 8 };
const buttonBase = {
    appearance: 'none',
    font: 'inherit',
    cursor: 'pointer',
    border: '1px solid transparent',
    borderRadius: 8,
    padding: '6px 16px',
    fontSize: 13,
    lineHeight: 1.5,
};
const cancelStyle = { ...buttonBase, borderColor: 'var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)', background: 'transparent' };
const proceedStyle = { ...buttonBase, background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)' };
const successStyle = { margin: '4px 0 0', color: 'var(--dsw-alias-state-success-primary, #3fb950)' };
const errorStyle = { margin: '4px 0 0', color: 'var(--dsw-alias-label-error)' };
const hintStyle = { margin: '8px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' };
/**
 * Render the restart trigger + confirm dialog.
 * @param props - the footer seat props.
 * @returns the entry element tree.
 */
export function RestartButton({ wide, t }) {
    const [phase, setPhase] = useState({ kind: 'idle' });
    const [open, setOpen] = useState(false);
    const timer = useRef(undefined);
    useEffect(() => () => {
        if (timer.current !== undefined)
            window.clearTimeout(timer.current);
    }, []);
    const close = useCallback(() => {
        setOpen(false);
        if (phase.kind !== 'busy')
            setPhase({ kind: 'idle' });
    }, [phase.kind]);
    const run = useCallback(async () => {
        setPhase({ kind: 'busy' });
        const result = await requestRestart('webui-button');
        if (result.status === 'already-scheduled') {
            setPhase({ kind: 'done' });
            // already in flight — tie into the reconnect probe anyway
        }
        else if (result.status === 'scheduled') {
            // The service will go down shortly; the connection client reconnects on
            // its own. Show a brief "triggered", then flip to "reconnected" once we
            // can reach the origin again.
            await waitForReconnect(45000);
            setPhase({ kind: 'done' });
        }
        else if (result.status === 'forbidden') {
            setPhase({ kind: 'denied' });
        }
        else if (result.status === 'suppressed') {
            setPhase({ kind: 'failed', message: t('restart.suppressed') });
        }
        else if (result.status === 'unsupported') {
            setPhase({ kind: 'failed', message: t('restart.unsupported') });
        }
        else {
            setPhase({ kind: 'failed', message: result.message });
        }
        // Auto-dismiss the result toast after a beat.
        timer.current = window.setTimeout(() => {
            setOpen(false);
            setPhase({ kind: 'idle' });
        }, 2600);
    }, [t]);
    const confirm = useCallback(() => {
        setOpen(false);
        void run();
    }, [run]);
    const label = t('restart.label');
    return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", style: wide ? triggerStyle : triggerRailStyle, "aria-label": label, title: label, onClick: () => {
                    setPhase({ kind: 'confirming' });
                    setOpen(true);
                }, children: _jsx(RestartGlyph, { size: wide ? 16 : 18 }) }), open && createPortal((_jsxs("div", { style: overlayStyle, role: "presentation", children: [_jsx("div", { style: maskStyle, "aria-hidden": "true", onClick: close }), _jsxs("div", { style: dialogStyle, role: "dialog", "aria-modal": "true", "aria-label": label, children: [phase.kind === 'confirming' && (_jsxs(_Fragment, { children: [_jsx("p", { style: titleStyle, children: t('restart.confirm.title') }), _jsx("p", { style: bodyStyle, children: t('restart.confirm.body') }), _jsxs("div", { style: actionsStyle, children: [_jsx("button", { type: "button", style: cancelStyle, onClick: close, children: t('restart.cancel') }), _jsx("button", { type: "button", style: proceedStyle, onClick: confirm, children: t('restart.proceed') })] })] })), phase.kind === 'busy' && (_jsx("p", { style: titleStyle, children: t('restart.busy') })), phase.kind === 'done' && (_jsx("p", { style: successStyle, children: t('restart.done') })), phase.kind === 'denied' && (_jsx("p", { style: errorStyle, children: t('restart.denied') })), phase.kind === 'failed' && (_jsxs(_Fragment, { children: [_jsx("p", { style: errorStyle, children: phase.message }), _jsx("p", { style: hintStyle, children: t('restart.failedHint') })] }))] })] })), document.body)] }));
}
//# sourceMappingURL=RestartButton.js.map