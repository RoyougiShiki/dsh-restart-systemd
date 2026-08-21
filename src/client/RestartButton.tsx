/**
 * Sidebar-footer restart trigger for dsh-restart-systemd.
 *
 * Rendered into the official `sidebar.footer.action` seat (the slot beside the
 * Settings trigger — where remote-web-ui's phone icon lives), so it appears
 * next to the phone icon in the dark-theme footer row. Behavior:
 *  - wide column  → an icon button sized to the settings rail;
 *  - collapsed 56px rail → a single square icon; the whole footer-action seat
 *    is flipped to a centered vertical column while in rail mode.
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

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { requestRestart, waitForReconnect, type RestartApiResult } from './api.ts'

/** Entry props: the footer seat's column state + the standard locale seat. */
export interface RestartButtonProps extends PropsLocale<'restart-dsh'> {
  /** Whether the sidebar renders wide (false = 56px rail). */
  wide: boolean
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'busy' }        // request accepted, waiting for reconnect
  | { kind: 'done' }        // reconnect observed
  | { kind: 'denied' }
  | { kind: 'failed'; message: string }

/** A restart glyph (refresh/arrow bicycle) matching the outline icon style. */
export function RestartGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 4.6A6 6 0 0 1 13.5 8M13.5 8l-2.1-2.2M13.5 8l-2.2 2.1M13.5 11.4A6 6 0 0 1 2.5 8M2.5 8l2.2 2.2M2.5 8l2.1-2.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Visual state (background/color/hover) lives in the injected `.dsh-restart-trigger`
// stylesheet — inline styles would out-prioritise the :hover rules.
const triggerStyle: CSSProperties = {
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
}
// Collapsed 56px rail: keep the same 36x36 round glyph as the wide seat. Rail
// stacking of the whole footer-action seat is handled by the injected
// `dsh-restart-rail` stylesheet rule (see the mount effects below).
const triggerRailStyle: CSSProperties = {
  ...triggerStyle,
  height: 36,
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}
const maskStyle: CSSProperties = { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }
const dialogStyle: CSSProperties = {
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
}
const titleStyle: CSSProperties = { margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const bodyStyle: CSSProperties = { margin: '0 0 16px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-line' }
const actionsStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 }
const buttonBase: CSSProperties = {
  appearance: 'none',
  font: 'inherit',
  cursor: 'pointer',
  border: '1px solid transparent',
  borderRadius: 8,
  padding: '6px 16px',
  fontSize: 13,
  lineHeight: 1.5,
}
const cancelStyle: CSSProperties = { ...buttonBase, borderColor: 'var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)', background: 'transparent' }
const proceedStyle: CSSProperties = { ...buttonBase, background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)' }
const successCardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  margin: '4px 0 0',
  padding: '10px 14px',
  borderRadius: 12,
  background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary, #3fb950) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary, #3fb950) 28%, transparent)',
}
const successTitleStyle: CSSProperties = { margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const successSubStyle: CSSProperties = { margin: '2px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }

function SpinnerGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ animation: 'dsh-restart-spin 1s linear infinite' }}>
      <circle cx="8" cy="8" r="6" stroke="var(--dsw-alias-label-tertiary)" strokeWidth="2" opacity="0.35" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="var(--dsw-alias-label-secondary)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function CheckGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="color-mix(in srgb, var(--dsw-alias-state-success-primary, #3fb950) 18%, transparent)" />
      <path d="M4.5 8.2l2.3 2.3 4.7-5" stroke="var(--dsw-alias-state-success-primary, #3fb950)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
const errorStyle: CSSProperties = { margin: '4px 0 0', color: 'var(--dsw-alias-label-error)' }
const hintStyle: CSSProperties = { margin: '8px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }

/**
 * Render the restart trigger + confirm dialog.
 * @param props - the footer seat props.
 * @returns the entry element tree.
 */
export function RestartButton({ wide, t }: RestartButtonProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [open, setOpen] = useState(false)
  const [busyAt, setBusyAt] = useState(0)
  const [, setBusyTick] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const proceedRef = useRef<HTMLButtonElement | null>(null)
  const actionsRef = useRef<{ close: () => void; confirm: () => void }>({ close: () => {}, confirm: () => {} })

  // Re-render every second while busy so the staged copy can switch.
  useEffect(() => {
    if (phase.kind !== 'busy') return
    const iv = window.setInterval(() => setBusyTick((n) => n + 1), 1000)
    return () => window.clearInterval(iv)
  }, [phase.kind])

  // Hover/active/focus styles: inline styles cannot express :hover, so inject
  // one stylesheet (idempotent) matching the neighbouring remote-control icon.
  useEffect(() => {
    // Versioned stylesheet id: a live-reconnected page may still hold an old
    // injected <style> (same id check would skip the new rules and the button
    // would fall back to the browser default background). Remove all known
    // prior versions, then inject the current one.
    for (const oldId of ['dsh-restart-css', 'dsh-restart-css-v2']) {
      document.getElementById(oldId)?.remove()
    }
    const style = document.createElement('style')
    style.id = 'dsh-restart-css-v3'
    style.textContent = [
      '.dsh-restart-trigger{background:transparent;color:var(--dsw-alias-label-secondary);transition:background-color 120ms ease,color 120ms ease,box-shadow 120ms ease}',
      '.dsh-restart-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsh-restart-trigger:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
      '.dsh-restart-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-brand-primary);outline:none}',
      // Rail layout fix: the shell renders every `sidebar.footer.action`
      // registrant into one flex ROW and never stacks them when the sidebar
      // collapses (its collapsed CSS only changes justify-content/width).
      // Each registrant is expected to handle its own rail layout —
      // remote-web-ui wraps its icons in a column-reverse row — so a second
      // bare entry beside it overflows the 36px rail content box and gets
      // clipped. While this plugin renders in rail mode it tags <html> with
      // `dsh-restart-rail`, flipping the whole seat to a centered vertical
      // column so every footer action stacks like the phone/update pair does.
      '.dsh-restart-rail [class*=footerActions]{flex-direction:column!important;align-items:center;row-gap:4px}',
      '@keyframes dsh-restart-spin{to{transform:rotate(360deg)}}',
    ].join('\n')
    document.head.appendChild(style)
  }, [])

  // Tag <html> while this entry renders in rail mode so the injected
  // `dsh-restart-rail` rule stacks the whole footer-action seat vertically
  // (see the stylesheet above). The class is removed again as soon as the
  // sidebar goes wide, restoring the shell's horizontal row.
  useEffect(() => {
    if (wide) return undefined
    document.documentElement.classList.add('dsh-restart-rail')
    return () => document.documentElement.classList.remove('dsh-restart-rail')
  }, [wide])

  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
  }, [])

  // Boot fallback: if the page reloaded while the service was restarting
  // (sessionStorage marker set before the request), probe until the origin
  // is back and surface a "service restarted" dialog.
  useEffect(() => {
    let pending = false
    try { pending = sessionStorage.getItem('dsh-restart-pending') === '1' } catch { /* ignore */ }
    if (!pending) return
    void (async () => {
      await waitForReconnect(20000)
      try { sessionStorage.removeItem('dsh-restart-pending') } catch { /* ignore */ }
      setPhase({ kind: 'done' })
      setOpen(true)
      timer.current = window.setTimeout(() => {
        setOpen(false)
        setPhase({ kind: 'idle' })
      }, 3500)
    })()
  }, [])

  const close = useCallback(() => {
    // A restart in flight must not be dismissible — closing the dialog would
    // hide the progress and the success card that follows.
    if (phase.kind === 'busy') return
    setOpen(false)
    setPhase({ kind: 'idle' })
  }, [phase.kind])

  // Debounce double-confirms: a second run() would hit already-scheduled and
  // flip the phase to done prematurely.
  const busyRef = useRef(false)

  const run = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setPhase({ kind: 'busy' })
    setBusyAt(Date.now())
    const result: RestartApiResult = await requestRestart('webui-button')
    if (result.status === 'already-scheduled') {
      busyRef.current = false
      setPhase({ kind: 'done' })
      // already in flight — tie into the reconnect probe anyway
    } else if (result.status === 'scheduled') {
      // Remember the restart across a possible page reload so the boot path
      // can show a "service restarted" toast even if the UI tree reloads.
      try { sessionStorage.setItem('dsh-restart-pending', '1') } catch { /* ignore */ }
      // The service will go down shortly; the connection client reconnects on
      // its own. Show a brief "triggered", then flip to "reconnected" once we
      // can reach the origin again — waitForRestart makes the probe resolve
      // only after a real down-then-up cycle, not against the pre-restart
      // process still being alive during the scheduling delay.
      const reconnected = await waitForReconnect(20000, true)
      // Main flow completed — clear the reload fallback marker so a later page
      // load does not re-show a stale card.
      try { sessionStorage.removeItem('dsh-restart-pending') } catch { /* ignore */ }
      if (reconnected) {
        setPhase({ kind: 'done' })
        // Force a full page reload: auto-reconnect alone keeps running the old
        // pre-restart JS bundle, which is why fixes only appear after manual F5.
        window.setTimeout(() => window.location.reload(), 800)
      } else {
        setPhase({ kind: 'failed', message: t('restart.failedHint') })
      }
    } else if (result.status === 'forbidden') {
      busyRef.current = false
      setPhase({ kind: 'denied' })
    } else if (result.status === 'suppressed') {
      busyRef.current = false
      setPhase({ kind: 'failed', message: t('restart.suppressed') })
    } else if (result.status === 'unsupported') {
      busyRef.current = false
      setPhase({ kind: 'failed', message: t('restart.unsupported') })
    } else {
      busyRef.current = false
      setPhase({ kind: 'failed', message: result.message })
    }
    // Auto-dismiss the result dialog after a beat (long enough to read the
    // success card).
    timer.current = window.setTimeout(() => {
      setOpen(false)
      setPhase({ kind: 'idle' })
    }, 5000)
  }, [t])

  const confirm = useCallback(() => {
    // Keep the dialog open: busy → reconnected → done must stay visible
    // (previously setOpen(false) hid every later phase, so the user saw
    // nothing after confirming).
    void run()
  }, [run])

  // Keep the latest actions in a ref so a single document-level listener can
  // always reach the current close/confirm callbacks (survives reconnects and
  // DOM replacement without needing per-button listeners).
  useEffect(() => {
    actionsRef.current = { close, confirm }
  })

  // Some DSH slot/portal compositions (especially the collapsed rail) can
  // prevent React synthetic events from reaching this component. Use
  // document-level delegation keyed on data attributes so the dialog buttons
  // work even after the page auto-reconnects without a full reload.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const el = target?.closest?.('[data-dsh-restart-action]') as HTMLElement | null
      if (!el) return
      e.preventDefault()
      e.stopPropagation()
      const action = el.getAttribute('data-dsh-restart-action')
      if (action === 'cancel') actionsRef.current.close()
      else if (action === 'proceed') actionsRef.current.confirm()
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  const label = t('restart.label')

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="dsh-restart-trigger"
      style={wide ? triggerStyle : triggerRailStyle}
      aria-label={label}
      aria-busy={phase.kind === 'busy' || undefined}
      disabled={phase.kind === 'busy'}
      title={phase.kind === 'busy' ? t('restart.busy') : label}
      onClick={() => {
        // Custom styled confirm. The forced full-page reload after restart
        // ensures the new client bundle is loaded, so this dialog should no
        // longer suffer the stale-JS/portal problems seen before.
        setPhase({ kind: 'confirming' })
        setOpen(true)
      }}
    >
      {phase.kind === 'busy' ? <SpinnerGlyph size={wide ? 16 : 18} /> : <RestartGlyph size={wide ? 16 : 18} />}
    </button>
  )

  const dialog = open && createPortal((
    <div style={overlayStyle} role="presentation">
      <div style={maskStyle} aria-hidden="true" onClick={close} />
      <div style={dialogStyle} role="dialog" aria-modal="true" aria-label={label}>
        {phase.kind === 'confirming' && (
          <>
            <p style={titleStyle}>{t('restart.confirm.title')}</p>
            <p style={bodyStyle}>{t('restart.confirm.body')}</p>
            <div style={actionsStyle}>
              <button ref={cancelRef} type="button" data-dsh-restart-action="cancel" style={cancelStyle} onClick={close}>{t('restart.cancel')}</button>
              <button ref={proceedRef} type="button" data-dsh-restart-action="proceed" style={proceedStyle} onClick={confirm}>{t('restart.proceed')}</button>
            </div>
          </>
        )}
        {phase.kind === 'busy' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SpinnerGlyph size={18} />
            <div>
              <p style={titleStyle}>{t('restart.busy')}</p>
              {busyAt > 0 && Date.now() - busyAt > 15000 && (
                <p style={hintStyle}>{t('restart.busySlow')}</p>
              )}
              {busyAt > 0 && Date.now() - busyAt > 5000 && Date.now() - busyAt <= 15000 && (
                <p style={hintStyle}>{t('restart.busyWait')}</p>
              )}
            </div>
          </div>
        )}
        {phase.kind === 'done' && (
          <div style={successCardStyle} role="status">
            <CheckGlyph size={18} />
            <div>
              <p style={successTitleStyle}>{t('restart.done')}</p>
              <p style={successSubStyle}>DeepSeek Harness</p>
            </div>
          </div>
        )}
        {phase.kind === 'denied' && (
          <p style={errorStyle}>{t('restart.denied')}</p>
        )}
        {phase.kind === 'failed' && (
          <>
            <p style={errorStyle}>{phase.message}</p>
            <p style={hintStyle}>{t('restart.failedHint')}</p>
          </>
        )}
      </div>
    </div>
  ), document.body)

  // Always render in our own slot/root. Portaling the trigger into the
  // neighbour's remote-control stack caused unreliable events/state updates
  // after reconnect, so we accept the default slot position for reliability.
  return (
    <>
      {trigger}
      {dialog}
    </>
  )
}
