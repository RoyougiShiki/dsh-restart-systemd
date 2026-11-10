import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { requestRestart } from "./api.js";
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
    cursor: 'pointer',
};
const triggerRailStyle = {
    ...triggerStyle,
    height: 36,
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
const actionsStyle = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 };
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
/** Error bubble: a small anchored note near the trigger, never a mask. */
const bubbleStyle = (wide) => ({
    position: 'fixed',
    left: wide ? 12 : 72,
    bottom: 72,
    zIndex: 50,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    width: 320,
    maxWidth: 'calc(100vw - 24px)',
    padding: '10px 12px',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 12,
    background: 'var(--dsw-alias-bg-layer-2)',
    boxShadow: 'var(--dsw-shadow-lv3)',
    fontSize: 13,
    lineHeight: 1.5,
});
const bubbleTextStyle = { flex: '1 1 auto', color: 'var(--dsw-alias-label-error)', whiteSpace: 'pre-line' };
const bubbleCloseStyle = {
    flex: 'none',
    appearance: 'none',
    background: 'transparent',
    border: 'none',
    padding: 0,
    width: 18,
    height: 18,
    lineHeight: '18px',
    fontSize: 15,
    cursor: 'pointer',
    color: 'var(--dsw-alias-label-tertiary)',
};
function SpinnerGlyph({ size = 16 }) {
    return (_jsxs("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", style: { animation: 'dsh-restart-spin 1s linear infinite' }, children: [_jsx("circle", { cx: "8", cy: "8", r: "6", stroke: "var(--dsw-alias-label-tertiary)", strokeWidth: "2", opacity: "0.35" }), _jsx("path", { d: "M14 8a6 6 0 0 0-6-6", stroke: "var(--dsw-alias-label-secondary)", strokeWidth: "2", strokeLinecap: "round" })] }));
}
/**
 * Render the restart trigger, its confirmation dialog, and the error bubble.
 * @param props - footer seat props plus the locale seat.
 * @returns the entry element tree.
 */
export function RestartButton({ wide, t }) {
    const [phase, setPhase] = useState({ kind: 'idle' });
    const busyRef = useRef(false);
    const actionsRef = useRef({
        cancel: () => { },
        confirm: () => { },
        dismiss: () => { },
    });
    // Hover/active/focus styles live in one injected stylesheet because inline
    // styles cannot express :hover. The previous generation's rules are removed
    // first so a live-reconnected page cannot apply both sets.
    useEffect(() => {
        document.querySelectorAll('style[id^="dsh-restart-css"]').forEach((stale) => stale.remove());
        const style = document.createElement('style');
        style.id = 'dsh-restart-css-v6';
        style.textContent = [
            '.dsh-restart-trigger{background:transparent;color:var(--dsw-alias-label-secondary);transition:background-color 120ms ease,color 120ms ease,box-shadow 120ms ease}',
            '.dsh-restart-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
            '.dsh-restart-trigger:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
            '.dsh-restart-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-brand-primary);outline:none}',
            '.dsh-restart-rail [class*=footerActions]{flex-direction:column!important;align-items:center;row-gap:4px}',
            '@keyframes dsh-restart-spin{to{transform:rotate(360deg)}}',
        ].join('\n');
        document.head.appendChild(style);
        return () => style.remove();
    }, []);
    // Tag <html> while the rail layout is active so the footer seat stacks
    // vertically. Wide mode removes the tag and restores the shell row.
    useEffect(() => {
        if (wide)
            return undefined;
        document.documentElement.classList.add('dsh-restart-rail');
        return () => document.documentElement.classList.remove('dsh-restart-rail');
    }, [wide]);
    const cancel = useCallback(() => {
        setPhase({ kind: 'idle' });
    }, []);
    const dismiss = useCallback(() => {
        setPhase((current) => (current.kind === 'error' ? { kind: 'idle' } : current));
    }, []);
    const run = useCallback(async () => {
        if (busyRef.current)
            return;
        busyRef.current = true;
        setPhase({ kind: 'requesting' });
        let result;
        try {
            result = await requestRestart('webui-button');
        }
        catch {
            result = { status: 'unknown' };
        }
        busyRef.current = false;
        // A 202 needs no surface of its own: the trigger returns to idle and DSH
        // reports the disconnect and the reconnect by itself.
        if (result.status === 'accepted') {
            setPhase({ kind: 'idle' });
            return;
        }
        let message;
        if (result.status === 'already-scheduled')
            message = t('restart.conflict');
        else if (result.status === 'suppressed')
            message = t('restart.suppressed');
        else if (result.status === 'forbidden')
            message = t('restart.denied');
        else if (result.status === 'unsupported')
            message = t('restart.unsupported');
        else if (result.status === 'unknown')
            message = t('restart.unknown');
        else
            message = t('restart.failed') + ' (' + result.message + ')';
        setPhase({ kind: 'error', message });
    }, [t]);
    const confirm = useCallback(() => {
        // Close first so the user never sees a waiting dialog while the POST flies.
        setPhase({ kind: 'requesting' });
        void run();
    }, [run]);
    // Keep the latest callbacks reachable from the document-level delegation
    // listener (some portal/rail compositions do not deliver synthetic clicks).
    useEffect(() => {
        actionsRef.current = { cancel, confirm, dismiss };
    });
    useEffect(() => {
        const handler = (event) => {
            const target = event.target;
            const element = target?.closest?.('[data-dsh-restart-action]');
            if (!element)
                return;
            event.preventDefault();
            event.stopPropagation();
            const action = element.getAttribute('data-dsh-restart-action');
            if (action === 'cancel')
                actionsRef.current.cancel();
            else if (action === 'proceed')
                actionsRef.current.confirm();
            else if (action === 'dismiss')
                actionsRef.current.dismiss();
        };
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, []);
    const label = t('restart.label');
    const requesting = phase.kind === 'requesting';
    const trigger = (_jsx("button", { type: "button", className: "dsh-restart-trigger", style: wide ? triggerStyle : triggerRailStyle, "aria-label": label, "aria-busy": requesting || undefined, disabled: requesting, title: requesting ? t('restart.requesting') : label, onClick: () => {
            setPhase({ kind: 'confirming' });
        }, children: requesting ? _jsx(SpinnerGlyph, { size: wide ? 16 : 18 }) : _jsx(RestartGlyph, { size: wide ? 16 : 18 }) }));
    const dialog = phase.kind === 'confirming' && createPortal((_jsxs("div", { style: overlayStyle, role: "presentation", children: [_jsx("div", { style: maskStyle, "aria-hidden": "true", onClick: cancel }), _jsxs("div", { style: dialogStyle, role: "dialog", "aria-modal": "true", "aria-label": label, children: [_jsx("p", { style: titleStyle, children: t('restart.confirm.title') }), _jsx("p", { style: bodyStyle, children: t('restart.confirm.body') }), _jsxs("div", { style: actionsStyle, children: [_jsx("button", { type: "button", "data-dsh-restart-action": "cancel", style: cancelStyle, onClick: cancel, children: t('restart.cancel') }), _jsx("button", { type: "button", "data-dsh-restart-action": "proceed", style: proceedStyle, onClick: confirm, children: t('restart.proceed') })] })] })] })), document.body);
    const bubble = phase.kind === 'error' && createPortal((_jsxs("div", { style: bubbleStyle(wide), role: "alert", children: [_jsx("span", { style: bubbleTextStyle, children: phase.message }), _jsx("button", { type: "button", "data-dsh-restart-action": "dismiss", style: bubbleCloseStyle, "aria-label": t('restart.close'), title: t('restart.close'), onClick: dismiss, children: "\u00D7" })] })), document.body);
    return (_jsxs(_Fragment, { children: [trigger, dialog, bubble] }));
}
//# sourceMappingURL=RestartButton.js.map