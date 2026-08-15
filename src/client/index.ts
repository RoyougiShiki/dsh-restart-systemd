/**
 * dsh-restart-systemd — browser half. Registers the `restart-dsh` dictionaries
 * and mounts the sidebar-footer restart trigger into the official
 * `sidebar.footer.action` seat (the slot beside the Settings trigger where
 * remote-web-ui's phone icon lives). Follows the
 * remote-web-ui injection pattern: `ctx.slots.inject(key, () => ctx.slots.register(...))`.
 * @module dsh-restart-systemd/client
 */

import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
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
  | 'restart.busy'
  | 'restart.busyWait'
  | 'restart.busySlow'
  | 'restart.done'
  | 'restart.denied'
  | 'restart.failedHint'
  | 'restart.suppressed'
  | 'restart.unsupported'

/** English dictionary (key-set source of truth). */
export const en: Record<RestartDshKey, string> = {
  'restart.label': 'Restart DeepSeek Harness',
  'restart.confirm.title': 'Restart DeepSeek Harness service?',
  'restart.confirm.body': 'In-flight agent tasks will be interrupted and resumed automatically. The page will reconnect in a few seconds.',
  'restart.cancel': 'Cancel',
  'restart.proceed': 'Restart',
  'restart.busy': 'Restarting… the page will reconnect automatically.',
  'restart.busyWait': 'Still restarting, please wait…',
  'restart.busySlow': 'Taking longer than usual — if the page does not recover, refresh it.',
  'restart.done': 'Reconnected. The service restarted successfully.',
  'restart.denied': 'Restart is only available from this machine (loopback).',
  'restart.failedHint': 'If the service does not come back, run: systemctl --user status dsh-web',
  'restart.suppressed': 'The service just restarted; please wait a moment before trying again.',
  'restart.unsupported': 'Restart is not supported on this platform. Run: systemctl --user restart dsh-web',
}

/** Simplified Chinese dictionary. */
export const zh: Record<RestartDshKey, string> = {
  'restart.label': '重启 DeepSeek Harness',
  'restart.confirm.title': '重启 DeepSeek Harness 服务？',
  'restart.confirm.body': '进行中的 agent 任务将中断并自动续接，页面约几秒后自动重连。',
  'restart.cancel': '取消',
  'restart.proceed': '重启',
  'restart.busy': '正在重启…页面将自动重连。',
  'restart.busyWait': '仍在重启，请稍候…',
  'restart.busySlow': '耗时超出预期——若页面长时间未恢复，请刷新页面。',
  'restart.done': '已重连，服务重启成功。',
  'restart.denied': '重启仅限本机访问（loopback）。',
  'restart.failedHint': '若服务未恢复，请手动执行：systemctl --user status dsh-web',
  'restart.suppressed': '服务刚刚重启，请稍候再试。',
  'restart.unsupported': '当前平台不支持重启，请手动执行：systemctl --user restart dsh-web',
}

export const dictionaries = { en, zh }

/** Required services: locale for copy, slots for the footer seat. */
export const inject = ['slots', 'locale']

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-restart-systemd: dictionaries')

  // Primary seat: sidebar footer actions (beside Settings — next to the
  // remote-web-ui phone icon). Ordered after remote-web-ui so it sits to its
  // right when the side-by-side order matters.
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'dsh-restart-systemd',
      order: 20,
      locale: NS,
    }, RestartButton),
  )
}
