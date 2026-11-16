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

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  cancelQueuedRestart,
  fetchQueuedRestart,
  requestRestart,
  type QueuedRestart,
  type RestartApiResult,
  type RestartMode,
} from './api.ts'

/** Entry props: the footer seat's column state plus the standard locale seat. */
export interface RestartButtonProps extends PropsLocale<'restart-dsh'> {
  /** Whether the sidebar renders wide (false = 56px rail). */
  wide: boolean
}

/**
 * Nothing here narrates recovery. \`accepted\` is deliberately absent: a 202 for
 * "restart now" returns to \`idle\` so no card can outlive the page. \`queued\`
 * persists because the restart itself is still pending on the host.
 */
type Phase =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'requesting' }
  | { kind: 'queued'; waitingForSessions: number }
  | { kind: 'error'; message: string }

/** How often a live queued restart re-reads the host for its waiting count. */
const QUEUE_POLL_MS = 5000

/** A restart glyph (circular arrows) matching the outline icon style. */
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
const actionsStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }
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
const proceedStyle: CSSProperties = { ...buttonBase, borderColor: 'var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-primary)', background: 'transparent' }
const proceedIdleStyle: CSSProperties = { ...buttonBase, background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)' }

/** Anchored card near the trigger, never a mask. */
const cardStyle = (wide: boolean): CSSProperties => ({
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
})
const bubbleTextStyle: CSSProperties = { flex: '1 1 auto', color: 'var(--dsw-alias-label-error)', whiteSpace: 'pre-line' }
const queuedTextStyle: CSSProperties = { flex: '1 1 auto', color: 'var(--dsw-alias-label-primary)', whiteSpace: 'pre-line' }
const queuedTitleStyle: CSSProperties = { display: 'block', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const queuedBodyStyle: CSSProperties = { display: 'block', marginTop: 2, color: 'var(--dsw-alias-label-secondary)' }
const queuedCancelStyle: CSSProperties = {
  appearance: 'none',
  marginTop: 6,
  padding: 0,
  border: 'none',
  background: 'transparent',
  font: 'inherit',
  fontSize: 12,
  color: 'var(--dsw-alias-label-secondary)',
  textDecoration: 'underline',
  cursor: 'pointer',
}
const bubbleCloseStyle: CSSProperties = {
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
}

function SpinnerGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ animation: 'dsh-restart-spin 1s linear infinite' }}>
      <circle cx="8" cy="8" r="6" stroke="var(--dsw-alias-label-tertiary)" strokeWidth="2" opacity="0.35" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="var(--dsw-alias-label-secondary)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Render the restart trigger, its confirmation dialog, the queued card, and the
 * error bubble.
 * @param props - footer seat props plus the locale seat.
 * @returns the entry element tree.
 */
export function RestartButton({ wide, t }: RestartButtonProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  // The queued restart outlives the card: dismissing it hides the note but
  // keeps the trigger marked, so the pending restart is never forgotten.
  const [queuedCardShown, setQueuedCardShown] = useState(true)
  const busyRef = useRef(false)
  const actionsRef = useRef<{ cancel: () => void; confirm: (mode: RestartMode) => void; dismiss: () => void; cancelQueued: () => void }>({
    cancel: () => {},
    confirm: () => {},
    dismiss: () => {},
    cancelQueued: () => {},
  })

  // Hover/active/focus styles live in one injected stylesheet because inline
  // styles cannot express :hover. Older generations are removed first so a
  // hot-reloaded page cannot end up applying both sets.
  useEffect(() => {
    document.querySelectorAll('style[id^="dsh-restart-css"]').forEach((stale) => stale.remove())
    const style = document.createElement('style')
    style.id = 'dsh-restart-css-v7'
    style.textContent = [
      '.dsh-restart-trigger{background:transparent;color:var(--dsw-alias-label-secondary);transition:background-color 120ms ease,color 120ms ease,box-shadow 120ms ease}',
      '.dsh-restart-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsh-restart-trigger:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
      '.dsh-restart-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-brand-primary);outline:none}',
      '.dsh-restart-trigger[data-dsh-restart-queued]{color:var(--dsw-alias-brand-primary)}',
      '.dsh-restart-rail [class*=footerActions]{flex-direction:column!important;align-items:center;row-gap:4px}',
      '@keyframes dsh-restart-spin{to{transform:rotate(360deg)}}',
    ].join('\n')
    document.head.appendChild(style)
    return () => style.remove()
  }, [])

  // Tag <html> while the rail layout is active so the footer seat stacks
  // vertically; wide mode removes the tag and restores the shell row.
  useEffect(() => {
    if (wide) return undefined
    document.documentElement.classList.add('dsh-restart-rail')
    return () => document.documentElement.classList.remove('dsh-restart-rail')
  }, [wide])

  // A queued restart lives on the host, so a reloaded page picks it up again
  // instead of pretending nothing is scheduled.
  useEffect(() => {
    let alive = true
    void fetchQueuedRestart().then((queued: QueuedRestart | null | undefined) => {
      if (!alive || queued === null || queued === undefined) return
      setPhase((current) => (current.kind === 'idle' ? { kind: 'queued', waitingForSessions: queued.waitingForSessions } : current))
    })
    return () => {
      alive = false
    }
  }, [])

  // Keep the queued count current while a queued restart is pending.
  useEffect(() => {
    if (phase.kind !== 'queued') return undefined
    const timer = setInterval(() => {
      void fetchQueuedRestart().then((queued: QueuedRestart | null | undefined) => {
        if (queued === null) {
          setPhase({ kind: 'idle' })
          return
        }
        if (queued === undefined) return
        setPhase((current) => (current.kind === 'queued' ? { kind: 'queued', waitingForSessions: queued.waitingForSessions } : current))
      })
    }, QUEUE_POLL_MS)
    return () => clearInterval(timer)
  }, [phase.kind])

  const cancel = useCallback(() => {
    setPhase({ kind: 'idle' })
  }, [])

  const dismiss = useCallback(() => {
    setPhase((current) => (current.kind === 'error' ? { kind: 'idle' } : current))
    setQueuedCardShown(false)
  }, [])

  const cancelQueued = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      const cancelled = await cancelQueuedRestart()
      setPhase(cancelled ? { kind: 'idle' } : { kind: 'error', message: t('restart.failed') })
    } finally {
      busyRef.current = false
    }
  }, [t])

  const run = useCallback(async (mode: RestartMode) => {
    if (busyRef.current) return
    busyRef.current = true
    setPhase({ kind: 'requesting' })

    let result: RestartApiResult
    try {
      result = await requestRestart(mode, 'webui-button')
    } catch {
      result = { status: 'unknown' }
    }
    busyRef.current = false

    if (result.status === 'accepted') {
      // A 202 needs no surface of its own: the trigger returns to idle and DSH
      // reports the disconnect and the reconnect by itself.
      setPhase({ kind: 'idle' })
      return
    }
    if (result.status === 'queued') {
      setQueuedCardShown(true)
      setPhase({ kind: 'queued', waitingForSessions: result.waitingForSessions })
      return
    }

    let message: string
    if (result.status === 'already-scheduled') message = t('restart.conflict')
    else if (result.status === 'suppressed') message = t('restart.suppressed')
    else if (result.status === 'forbidden') message = t('restart.denied')
    else if (result.status === 'unsupported') message = t('restart.unsupported')
    else if (result.status === 'unknown') message = t('restart.unknown')
    else message = t('restart.failed') + ' (' + result.message + ')'

    setPhase({ kind: 'error', message })
  }, [t])

  const confirm = useCallback((mode: RestartMode) => {
    // The dialog closes first so the user never watches a waiting dialog.
    setPhase({ kind: 'requesting' })
    void run(mode)
  }, [run])

  // Keep the latest callbacks reachable from the document-level delegation
  // listener (some portal/rail compositions do not deliver synthetic clicks).
  useEffect(() => {
    actionsRef.current = { cancel, confirm, dismiss, cancelQueued }
  })

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const element = target?.closest?.('[data-dsh-restart-action]') as HTMLElement | null
      if (!element) return
      event.preventDefault()
      event.stopPropagation()
      const action = element.getAttribute('data-dsh-restart-action')
      if (action === 'cancel') actionsRef.current.cancel()
      else if (action === 'proceed') actionsRef.current.confirm('now')
      else if (action === 'proceedIdle') actionsRef.current.confirm('when-idle')
      else if (action === 'dismiss') actionsRef.current.dismiss()
      else if (action === 'cancelQueued') void actionsRef.current.cancelQueued()
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  const label = t('restart.label')
  const requesting = phase.kind === 'requesting'
  const queued = phase.kind === 'queued'

  const trigger = (
    <button
      type="button"
      className="dsh-restart-trigger"
      style={wide ? triggerStyle : triggerRailStyle}
      aria-label={label}
      aria-busy={requesting || undefined}
      data-dsh-restart-queued={queued ? 'true' : undefined}
      disabled={requesting}
      title={queued ? t('restart.queued.title') : requesting ? t('restart.requesting') : label}
      onClick={() => {
        if (queued) {
          setQueuedCardShown(true)
          return
        }
        setPhase({ kind: 'confirming' })
      }}
    >
      {requesting ? <SpinnerGlyph size={wide ? 16 : 18} /> : <RestartGlyph size={wide ? 16 : 18} />}
    </button>
  )

  const dialog = phase.kind === 'confirming' && createPortal((
    <div style={overlayStyle} role="presentation">
      <div style={maskStyle} aria-hidden="true" onClick={cancel} />
      <div style={dialogStyle} role="dialog" aria-modal="true" aria-label={label}>
        <p style={titleStyle}>{t('restart.confirm.title')}</p>
        <p style={bodyStyle}>{t('restart.confirm.body')}</p>
        <div style={actionsStyle}>
          <button type="button" data-dsh-restart-action="cancel" style={cancelStyle} onClick={cancel}>{t('restart.cancel')}</button>
          <button type="button" data-dsh-restart-action="proceed" style={proceedStyle} onClick={() => confirm('now')}>{t('restart.proceed')}</button>
          <button type="button" data-dsh-restart-action="proceedIdle" style={proceedIdleStyle} onClick={() => confirm('when-idle')}>{t('restart.proceedIdle')}</button>
        </div>
      </div>
    </div>
  ), document.body)

  const queuedCard = phase.kind === 'queued' && queuedCardShown && createPortal((
    <div style={cardStyle(wide)} role="status">
      <span style={queuedTextStyle}>
        <span style={queuedTitleStyle}>{t('restart.queued.title')}</span>
        <span style={queuedBodyStyle}>{t('restart.queued.body')}</span>
        <button
          type="button"
          data-dsh-restart-action="cancelQueued"
          style={queuedCancelStyle}
          onClick={() => void cancelQueued()}
        >
          {t('restart.queued.cancel')}
        </button>
      </span>
      <button
        type="button"
        data-dsh-restart-action="dismiss"
        style={bubbleCloseStyle}
        aria-label={t('restart.close')}
        title={t('restart.close')}
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  ), document.body)

  const bubble = phase.kind === 'error' && createPortal((
    <div style={cardStyle(wide)} role="alert">
      <span style={bubbleTextStyle}>{phase.message}</span>
      <button
        type="button"
        data-dsh-restart-action="dismiss"
        style={bubbleCloseStyle}
        aria-label={t('restart.close')}
        title={t('restart.close')}
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  ), document.body)

  return (
    <>
      {trigger}
      {dialog}
      {queuedCard}
      {bubble}
    </>
  )
}
