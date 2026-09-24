/**
 * dsh-restart-systemd — browser half. Registers the `restart-dsh` dictionaries
 * and mounts the sidebar-footer restart trigger into the official
 * `sidebar.footer.action` seat (the slot beside the Settings trigger where
 * remote-web-ui's phone icon lives). Follows the
 * remote-web-ui injection pattern: `ctx.slots.inject(key, () => ctx.slots.register(...))`.
 *
 * The registration injects the runtime's connection lifecycle
 * (`ctx.connection.state`) as a slot hook, so the button can reload the page
 * once a restart it scheduled has actually completed. Everything else about
 * the outage — the retry loop, the "重新连接中" indicator, the click-to-retry
 * affordance — belongs to the client runtime and is deliberately not
 * reimplemented here.
 * @module dsh-restart-systemd/client
 */

import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle, ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
// Side-effect type imports: these packages own the declaration merges this
// module depends on — the sidebar declares the `sidebar.footer.action` slot,
// the renderer declares `ctx.slots`, and the locale plugin declares `ctx.locale`.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { RestartButton } from './RestartButton.tsx'

/** Dictionary namespace owned by this plugin. */
export const NS = 'restart-dsh'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'restart-dsh': RestartDshKey
  }
}

export type RestartDshKey =
  | 'restart.label'
  | 'restart.confirm.title'
  | 'restart.confirm.body'
  | 'restart.cancel'
  | 'restart.proceed'
  | 'restart.pendingShort'
  | 'restart.pending'
  | 'restart.pendingHint'
  | 'restart.timeout'
  | 'restart.denied'
  | 'restart.failedHint'
  | 'restart.suppressed'
  | 'restart.unsupported'

/** English dictionary (key-set source of truth). */
export const en: Record<RestartDshKey, string> = {
  'restart.label': 'Restart DeepSeek Harness',
  'restart.confirm.title': 'Restart DeepSeek Harness service?',
  'restart.confirm.body': 'In-flight agent tasks will be interrupted and resumed automatically. The page reconnects on its own and reloads once the service is back.',
  'restart.cancel': 'Cancel',
  'restart.proceed': 'Restart',
  'restart.pendingShort': 'Restart in progress — waiting for the service to come back',
  'restart.pending': 'Restart requested',
  'restart.pendingHint': 'The service restarts in about 3 seconds. Reconnection is handled by the page itself; this dialog closes when it returns.',
  'restart.timeout': 'Timed out — the service did not come back in time.',
  'restart.denied': 'Restart is only available from this machine (loopback).',
  'restart.failedHint': 'If the service does not come back, run: systemctl --user status dsh-web',
  'restart.suppressed': 'The service just restarted; please wait a moment before trying again.',
  'restart.unsupported': 'Restart is not supported on this platform. Run: systemctl --user restart dsh-web',
}

/** Simplified Chinese dictionary. */
export const zh: Record<RestartDshKey, string> = {
  'restart.label': '重启 DeepSeek Harness',
  'restart.confirm.title': '重启 DeepSeek Harness 服务？',
  'restart.confirm.body': '进行中的 agent 任务将中断并自动续接。页面会自行重连，并在服务恢复后自动刷新。',
  'restart.cancel': '取消',
  'restart.proceed': '重启',
  'restart.pendingShort': '正在重启——等待服务恢复',
  'restart.pending': '已请求重启',
  'restart.pendingHint': '服务将在约 3 秒后重启。重连由页面自身处理，服务恢复后本提示自动关闭。',
  'restart.timeout': '等待超时——服务未在预期时间内恢复。',
  'restart.denied': '重启仅限本机访问（loopback）。',
  'restart.failedHint': '若服务未恢复，请手动执行：systemctl --user status dsh-web',
  'restart.suppressed': '服务刚刚重启，请稍候再试。',
  'restart.unsupported': '当前平台不支持重启，请手动执行：systemctl --user restart dsh-web',
}

export const dictionaries = { en, zh }

/**
 * A never-changing stand-in used when the client composition installs no
 * `connection` service. Keeping the shape identical means the registration's
 * inject face is the same either way; the button then simply never reloads.
 */
const NO_CONNECTION: HostObservable<ConnectionState | undefined> = {
  getSnapshot: () => undefined,
  subscribe: () => () => undefined,
}

/** Required services: locale for copy, slots for the footer seat. */
export const inject = ['slots', 'locale']

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-restart-systemd: dictionaries')

  // Read the connection service softly (never as a hard `inject`): a
  // composition without it still gets a working restart trigger, just without
  // the post-restart page reload.
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  const connectionState = connection?.state ?? NO_CONNECTION

  // Primary seat: sidebar footer actions (beside Settings — next to the
  // remote-web-ui phone icon). Ordered after remote-web-ui so it sits to its
  // right when the side-by-side order matters.
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'dsh-restart-systemd',
      order: 20,
      locale: NS,
      inject: () => ({ hooks: { connectionState } }),
    }, RestartButton),
  )
}
