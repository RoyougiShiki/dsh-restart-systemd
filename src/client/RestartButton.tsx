/**
 * Sidebar-footer restart trigger for dsh-restart-systemd.
 *
 * Rendered into the official sidebar.footer.action seat. The component owns
 * only the confirmation dialog and the POST result display. It never waits for
 * recovery, never reloads the page, and never reads a connection service.
 * @module dsh-restart-systemd/client/RestartButton
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { requestRestart, type RestartApiResult } from './api.ts'

/** Entry props: the footer seat's column state plus the standard locale seat. */
export interface RestartButtonProps extends PropsLocale<'restart-dsh'> {
  /** Whether the sidebar renders wide (false = 56px rail). */
  wide: boolean
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'requesting' }
  | { kind: 'accepted' }
  | { kind: 'error'; message: string }

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
const proceedStyle: CSSProperties = { ...buttonBase, background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)' }
const errorStyle: CSSProperties = { margin: '4px 0 0', color: 'var(--dsw-alias-label-error)' }
const hintStyle: CSSProperties = { margin: '8px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }

function SpinnerGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ animation: 'dsh-restart-spin 1s linear infinite' }}>
      <circle cx="8" cy="8" r="6" stroke="var(--dsw-alias-label-tertiary)" strokeWidth="2" opacity="0.35" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="var(--dsw-alias-label-secondary)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Render the restart trigger and its result dialog.
 * @param props - footer seat props plus the locale seat.
 * @returns the entry element tree.
 */
export function RestartButton({ wide, t }: RestartButtonProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [open, setOpen] = useState(false)
  const busyRef = useRef(false)
  const actionsRef = useRef<{ close: () => void; confirm: () => void }>({ close: () => {}, confirm: () => {} })

  // Hover/active/focus styles live in one injected stylesheet because inline
  // styles cannot express :hover. The previous generation's rules are removed
  // first so a live-reconnected page cannot apply both sets.
  useEffect(() => {
    document.querySelectorAll('style[id^="dsh-restart-css"]').forEach((stale) => stale.remove())
    const style = document.createElement('style')
    style.id = 'dsh-restart-css-v5'
    style.textContent = [
      '.dsh-restart-trigger{background:transparent;color:var(--dsw-alias-label-secondary);transition:background-color 120ms ease,color 120ms ease,box-shadow 120ms ease}',
      '.dsh-restart-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsh-restart-trigger:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
      '.dsh-restart-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-brand-primary);outline:none}',
      '.dsh-restart-rail [class*=footerActions]{flex-direction:column!important;align-items:center;row-gap:4px}',
      '@keyframes dsh-restart-spin{to{transform:rotate(360deg)}}',
    ].join('\n')
    document.head.appendChild(style)
    return () => style.remove()
  }, [])

  // Tag <html> while the rail layout is active so the footer seat stacks
  // vertically. Wide mode removes the tag and restores the shell row.
  useEffect(() => {
    if (wide) return undefined
    document.documentElement.classList.add('dsh-restart-rail')
    return () => document.documentElement.classList.remove('dsh-restart-rail')
  }, [wide])

  const close = useCallback(() => {
    busyRef.current = false
    setOpen(false)
    setPhase({ kind: 'idle' })
  }, [])

  const run = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setPhase({ kind: 'requesting' })

    let result: RestartApiResult
    try {
      result = await requestRestart('webui-button')
    } catch {
      result = { status: 'unknown' }
    }
    busyRef.current = false

    if (result.status === 'accepted') {
      setPhase({ kind: 'accepted' })
      setOpen(true)
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
    setOpen(true)
  }, [t])

  const confirm = useCallback(() => {
    void run()
  }, [run])

  // Keep the latest callbacks reachable from the document-level delegation
  // listener (some portal/rail compositions do not deliver synthetic clicks).
  useEffect(() => {
    actionsRef.current = { close, confirm }
  })

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const element = target?.closest?.('[data-dsh-restart-action]') as HTMLElement | null
      if (!element) return
      event.preventDefault()
      event.stopPropagation()
      const action = element.getAttribute('data-dsh-restart-action')
      if (action === 'cancel' || action === 'close') actionsRef.current.close()
      else if (action === 'proceed') actionsRef.current.confirm()
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  const label = t('restart.label')
  const requesting = phase.kind === 'requesting'

  const trigger = (
    <button
      type="button"
      className="dsh-restart-trigger"
      style={wide ? triggerStyle : triggerRailStyle}
      aria-label={label}
      aria-busy={requesting || undefined}
      disabled={requesting}
      title={requesting ? t('restart.requesting') : label}
      onClick={() => {
        setPhase({ kind: 'confirming' })
        setOpen(true)
      }}
    >
      {requesting ? <SpinnerGlyph size={wide ? 16 : 18} /> : <RestartGlyph size={wide ? 16 : 18} />}
    </button>
  )

  const dialog = open && createPortal((
    <div style={overlayStyle} role="presentation">
      <div style={maskStyle} aria-hidden="true" onClick={requesting ? undefined : close} />
      <div style={dialogStyle} role="dialog" aria-modal="true" aria-label={label}>
        {phase.kind === 'confirming' && (
          <>
            <p style={titleStyle}>{t('restart.confirm.title')}</p>
            <p style={bodyStyle}>{t('restart.confirm.body')}</p>
            <div style={actionsStyle}>
              <button type="button" data-dsh-restart-action="cancel" style={cancelStyle} onClick={close}>{t('restart.cancel')}</button>
              <button type="button" data-dsh-restart-action="proceed" style={proceedStyle} onClick={confirm}>{t('restart.proceed')}</button>
            </div>
          </>
        )}
        {phase.kind === 'requesting' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} role="status">
            <SpinnerGlyph size={18} />
            <div>
              <p style={titleStyle}>{t('restart.requesting')}</p>
              <p style={hintStyle}>{t('restart.requestingHint')}</p>
            </div>
          </div>
        )}
        {phase.kind === 'accepted' && (
          <>
            <p style={titleStyle}>{t('restart.accepted')}</p>
            <p style={hintStyle}>{t('restart.acceptedHint')}</p>
            <div style={actionsStyle}>
              <button type="button" data-dsh-restart-action="close" style={cancelStyle} onClick={close}>{t('restart.close')}</button>
            </div>
          </>
        )}
        {phase.kind === 'error' && (
          <>
            <p style={errorStyle}>{phase.message}</p>
            <div style={actionsStyle}>
              <button type="button" data-dsh-restart-action="close" style={cancelStyle} onClick={close}>{t('restart.close')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  ), document.body)

  return (
    <>
      {trigger}
      {dialog}
    </>
  )
}
