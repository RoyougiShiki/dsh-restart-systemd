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
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  transition: 'background-color 120ms ease, color 120ms ease',
}
// Collapsed 56px rail: keep the same 36x36 round glyph as the wide seat so
// the restart button stays visually identical to the phone icon next to it
// (footer action slots stack vertically in rail mode — no full-width block).
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
const successStyle: CSSProperties = { margin: '4px 0 0', color: 'var(--dsw-alias-state-success-primary, #3fb950)' }
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
  const timer = useRef<number | undefined>(undefined)

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
      await waitForReconnect(45000)
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
    setOpen(false)
    if (phase.kind !== 'busy') setPhase({ kind: 'idle' })
  }, [phase.kind])

  const run = useCallback(async () => {
    setPhase({ kind: 'busy' })
    const result: RestartApiResult = await requestRestart('webui-button')
    if (result.status === 'already-scheduled') {
      setPhase({ kind: 'done' })
      // already in flight — tie into the reconnect probe anyway
    } else if (result.status === 'scheduled') {
      // Remember the restart across a possible page reload so the boot path
      // can show a "service restarted" toast even if the UI tree reloads.
      try { sessionStorage.setItem('dsh-restart-pending', '1') } catch { /* ignore */ }
      // The service will go down shortly; the connection client reconnects on
      // its own. Show a brief "triggered", then flip to "reconnected" once we
      // can reach the origin again.
      await waitForReconnect(45000)
      setPhase({ kind: 'done' })
    } else if (result.status === 'forbidden') {
      setPhase({ kind: 'denied' })
    } else if (result.status === 'suppressed') {
      setPhase({ kind: 'failed', message: t('restart.suppressed') })
    } else if (result.status === 'unsupported') {
      setPhase({ kind: 'failed', message: t('restart.unsupported') })
    } else {
      setPhase({ kind: 'failed', message: result.message })
    }
    // Auto-dismiss the result dialog after a beat.
    timer.current = window.setTimeout(() => {
      setOpen(false)
      setPhase({ kind: 'idle' })
    }, 3500)
  }, [t])

  const confirm = useCallback(() => {
    // Keep the dialog open: busy → reconnected → done must stay visible
    // (previously setOpen(false) hid every later phase, so the user saw
    // nothing after confirming).
    void run()
  }, [run])

  const label = t('restart.label')

  return (
    <>
      <button
        type="button"
        style={wide ? triggerStyle : triggerRailStyle}
        aria-label={label}
        title={label}
        onClick={() => {
          setPhase({ kind: 'confirming' })
          setOpen(true)
        }}
      >
        <RestartGlyph size={wide ? 16 : 18} />
      </button>
      {open && createPortal((
        <div style={overlayStyle} role="presentation">
          <div style={maskStyle} aria-hidden="true" onClick={close} />
          <div style={dialogStyle} role="dialog" aria-modal="true" aria-label={label}>
            {phase.kind === 'confirming' && (
              <>
                <p style={titleStyle}>{t('restart.confirm.title')}</p>
                <p style={bodyStyle}>{t('restart.confirm.body')}</p>
                <div style={actionsStyle}>
                  <button type="button" style={cancelStyle} onClick={close}>{t('restart.cancel')}</button>
                  <button type="button" style={proceedStyle} onClick={confirm}>{t('restart.proceed')}</button>
                </div>
              </>
            )}
            {phase.kind === 'busy' && (
              <p style={titleStyle}>{t('restart.busy')}</p>
            )}
            {phase.kind === 'done' && (
              <p style={successStyle}>{t('restart.done')}</p>
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
      ), document.body)}
    </>
  )
}
