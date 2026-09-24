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

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsLocale, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { requestRestart, type RestartApiResult } from './api.ts'

/**
 * How long a scheduled restart may stay unconfirmed before the dialog reports
 * a timeout. Generous: it covers the host's ~3s scheduling delay plus a WSL
 * systemd unit restart, and the check only fires when the connection never
 * came back at all.
 */
const PENDING_TIMEOUT_MS = 45_000
/** How long a terminal result dialog stays up before dismissing itself. */
const RESULT_DISMISS_MS = 6000

/** Entry props: the footer seat's column state + the standard locale seat. */
export interface RestartButtonProps extends PropsLocale<'restart-dsh'> {
  /** Whether the sidebar renders wide (false = 56px rail). */
  wide: boolean
  /**
   * Selector hook over the client runtime's connection lifecycle, bound by the
   * slot renderer from this registration's injected `hooks` compartment. The
   * plugin reads it to know when a restart it scheduled has actually completed
   * — it never runs a probe of its own.
   */
  useConnectionState: SnapshotSelectorHook<ConnectionState | undefined>
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'pending' }     // host accepted; waiting for the service to come back
  | { kind: 'denied' }
  | { kind: 'failed'; message: string }

/** What one connection-state transition means for the restart reload. */
export interface ReloadDecision {
  /** Reload the page now. */
  reload: boolean
  /** The outage flag to carry into the next transition. */
  sawOutage: boolean
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
export function restartReloadDecision(
  state: ConnectionState | undefined,
  flags: { scheduled: boolean; sawOutage: boolean },
): ReloadDecision {
  if (state === 'disconnected' || state === 'connecting') {
    return { reload: false, sawOutage: true }
  }
  if (state === 'connected' && flags.scheduled && flags.sawOutage) {
    return { reload: true, sawOutage: false }
  }
  return { reload: false, sawOutage: flags.sawOutage }
}

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

function SpinnerGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ animation: 'dsh-restart-spin 1s linear infinite' }}>
      <circle cx="8" cy="8" r="6" stroke="var(--dsw-alias-label-tertiary)" strokeWidth="2" opacity="0.35" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="var(--dsw-alias-label-secondary)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

const errorStyle: CSSProperties = { margin: '4px 0 0', color: 'var(--dsw-alias-label-error)' }
const hintStyle: CSSProperties = { margin: '8px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }

/**
 * Render the restart trigger + confirm dialog.
 * @param props - the footer seat props plus the connection-state selector hook.
 * @returns the entry element tree.
 */
export function RestartButton({ wide, useConnectionState, t }: RestartButtonProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const proceedRef = useRef<HTMLButtonElement | null>(null)
  const actionsRef = useRef<{ close: () => void; confirm: () => void }>({ close: () => {}, confirm: () => {} })

  // True from the moment this page asked for a restart until the reload (or the
  // timeout) settles it. Kept in a ref, not state: the reload decision is made
  // inside the connection-state effect and must not re-run it.
  const scheduledRef = useRef(false)
  // Set once the runtime reports a lost generation. A later `connected` only
  // counts as "the service is back" after an outage was actually observed —
  // without this, a `connected` that arrives before the unit goes down would
  // reload the page against the still-running pre-restart process.
  const sawOutageRef = useRef(false)

  const connectionState = useConnectionState((state) => state)

  // Latest translate function, read by the timeout callback so that effect can
  // depend on the phase alone (a `t` identity change must not restart the
  // countdown).
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })

  // Debounce double-confirms: a second run() would hit already-scheduled and
  // race the phase transitions.
  const busyRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current)
      timer.current = undefined
    }
  }, [])

  // Hover/active/focus styles: inline styles cannot express :hover, so inject
  // one stylesheet matching the neighbouring remote-control icon. Any earlier
  // copy of this stylesheet is removed first, so a live-reconnected page that
  // still holds the previous generation's <style> cannot end up with both rule
  // sets applied.
  useEffect(() => {
    document.querySelectorAll('style[id^="dsh-restart-css"]').forEach((stale) => stale.remove())
    const style = document.createElement('style')
    style.id = 'dsh-restart-css-v4'
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

  useEffect(() => () => clearTimer(), [clearTimer])

  // The one thing the runtime cannot do for us: swap in the restarted host's
  // client bundles. The ConnectionController reconnects the transport but the
  // page keeps executing the pre-restart JavaScript, so a scheduled restart
  // reloads the page once — and only once — the connection has come back after
  // a real outage (see restartReloadDecision).
  useEffect(() => {
    const decision = restartReloadDecision(connectionState, {
      scheduled: scheduledRef.current,
      sawOutage: sawOutageRef.current,
    })
    sawOutageRef.current = decision.sawOutage
    if (!decision.reload) return
    scheduledRef.current = false
    // Settle the UI first: if the reload is ever deferred or blocked, the
    // trigger must not stay disabled with no way back.
    setOpen(false)
    setPhase({ kind: 'idle' })
    window.location.reload()
  }, [connectionState])

  // Timeout fallback: if the service never comes back, stop claiming progress
  // and point at the manual check instead of spinning forever. Depends on the
  // phase alone so a re-render cannot restart the countdown.
  useEffect(() => {
    if (phase.kind !== 'pending') return undefined
    const handle = window.setTimeout(() => {
      scheduledRef.current = false
      sawOutageRef.current = false
      setPhase({ kind: 'failed', message: tRef.current('restart.timeout') })
      setOpen(true)
    }, PENDING_TIMEOUT_MS)
    return () => window.clearTimeout(handle)
  }, [phase.kind])

  const close = useCallback(() => {
    // Dismissible even while a restart is in flight: the reload is driven by
    // refs, not by this dialog, so hiding the card never cancels the restart.
    // The pending phase itself is kept, so the trigger stays busy and the
    // timeout above still runs.
    clearTimer()
    setOpen(false)
    setPhase((current) => (current.kind === 'pending' ? current : { kind: 'idle' }))
  }, [clearTimer])

  const run = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    clearTimer()
    setPhase({ kind: 'pending' })
    const result: RestartApiResult = await requestRestart('webui-button')
    if (result.status === 'scheduled' || result.status === 'already-scheduled' || result.status === 'unreachable') {
      // The host owns the countdown from here (an unreachable request means it
      // may already have gone down mid-flight). Arm the reload and let the
      // runtime's connection indicator narrate the outage. Arming is safe even
      // if no restart actually happened: the reload needs an observed outage
      // first, and a healthy service never produces one.
      scheduledRef.current = true
      return
    }
    busyRef.current = false
    if (result.status === 'forbidden') {
      setPhase({ kind: 'denied' })
    } else if (result.status === 'suppressed') {
      setPhase({ kind: 'failed', message: t('restart.suppressed') })
    } else if (result.status === 'unsupported') {
      setPhase({ kind: 'failed', message: t('restart.unsupported') })
    } else {
      setPhase({ kind: 'failed', message: result.message })
    }
    // Auto-dismiss a terminal result after a beat (long enough to read it).
    timer.current = window.setTimeout(() => {
      setOpen(false)
      setPhase({ kind: 'idle' })
    }, RESULT_DISMISS_MS)
  }, [clearTimer, t])

  const confirm = useCallback(() => {
    // Keep the dialog open: pending must stay visible until the reload or the
    // timeout replaces it (previously setOpen(false) hid every later phase, so
    // the user saw nothing after confirming).
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
  const pending = phase.kind === 'pending'

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="dsh-restart-trigger"
      style={wide ? triggerStyle : triggerRailStyle}
      aria-label={label}
      aria-busy={pending || undefined}
      disabled={pending}
      title={pending ? t('restart.pendingShort') : label}
      onClick={() => {
        setPhase({ kind: 'confirming' })
        setOpen(true)
      }}
    >
      {pending ? <SpinnerGlyph size={wide ? 16 : 18} /> : <RestartGlyph size={wide ? 16 : 18} />}
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
        {phase.kind === 'pending' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} role="status">
            <SpinnerGlyph size={18} />
            <div>
              <p style={titleStyle}>{t('restart.pending')}</p>
              <p style={hintStyle}>{t('restart.pendingHint')}</p>
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
