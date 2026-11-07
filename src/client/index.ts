/**
 * dsh-restart-systemd - browser half. Registers the restart dictionaries and
 * mounts the sidebar-footer trigger into the official sidebar.footer.action
 * seat. The button only asks the host for a restart and reports the host's
 * answer; DSH own connection indicator owns outage/reconnect narration.
 * @module dsh-restart-systemd/client
 */

import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Side-effect type imports: these packages own the declaration merges this
// module depends on (the footer slot, ctx.slots, and ctx.locale).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
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
  | 'restart.requesting'
  | 'restart.requestingHint'
  | 'restart.accepted'
  | 'restart.acceptedHint'
  | 'restart.conflict'
  | 'restart.suppressed'
  | 'restart.denied'
  | 'restart.unsupported'
  | 'restart.unknown'
  | 'restart.failed'
  | 'restart.close'

/** English dictionary (key-set source of truth). */
export const en: Record<RestartDshKey, string> = {
  'restart.label': 'Restart DeepSeek Harness',
  'restart.confirm.title': 'Restart the DeepSeek Harness service?',
  'restart.confirm.body': 'Restarting will interrupt in-flight tasks and will not resume them automatically. Please restart after your tasks are done.',
  'restart.cancel': 'Cancel',
  'restart.proceed': 'Restart',
  'restart.requesting': 'Submitting restart request...',
  'restart.requestingHint': 'This only submits the request; it does not wait for recovery.',
  'restart.accepted': 'Restart request accepted. Connection status is shown by DSH.',
  'restart.acceptedHint': 'The service will restart in about 3 seconds.',
  'restart.conflict': 'A restart request is already in progress.',
  'restart.suppressed': 'The service just restarted; please wait a moment before trying again.',
  'restart.denied': 'Restart is only available from this machine (loopback).',
  'restart.unsupported': 'Restart is not supported on this platform.',
  'restart.unknown': 'Could not confirm whether the restart request was accepted. Check the DSH connection status; do not retry repeatedly.',
  'restart.failed': 'Restart request failed',
  'restart.close': 'Close',
}

/** Simplified Chinese dictionary. */
export const zh: Record<RestartDshKey, string> = {
  'restart.label': '重启 DeepSeek Harness',
  'restart.confirm.title': '重启 DeepSeek Harness 服务？',
  'restart.confirm.body': '重启将中断进行中的任务，不会自动续接。建议任务完成后操作。',
  'restart.cancel': '取消',
  'restart.proceed': '重启',
  'restart.requesting': '正在提交重启请求…',
  'restart.requestingHint': '这里只提交请求，不等待服务恢复。',
  'restart.accepted': '重启请求已接受，后续连接状态由 DSH 显示',
  'restart.acceptedHint': '服务将在约 3 秒后重启。',
  'restart.conflict': '已有重启请求在处理。',
  'restart.suppressed': '服务刚刚重启，请稍候再试。',
  'restart.denied': '重启仅限本机访问（loopback）。',
  'restart.unsupported': '当前平台不支持重启。',
  'restart.unknown': '无法确认重启请求是否被接受，请查看 DSH 连接状态；不要连续重试。',
  'restart.failed': '重启请求失败',
  'restart.close': '关闭',
}

export const dictionaries = { en, zh }

/** Required services: locale for copy, slots for the footer seat. */
export const inject = ['slots', 'locale']

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-restart-systemd: dictionaries')

  // Primary seat: sidebar footer actions, beside Settings and the
  // remote-web-ui phone icon. No connection service is injected or read.
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'dsh-restart-systemd',
      order: 20,
      locale: NS,
    }, RestartButton),
  )
}
