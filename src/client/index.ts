/**
 * dsh-restart-systemd - browser half. Registers the restart dictionaries and
 * mounts the sidebar-footer trigger into the official sidebar.footer.action
 * seat.
 *
 * Two user intents share one trigger: restart now (interrupting whatever runs)
 * and restart once every session is idle. The second one is the point of the
 * plugin: the user can ask for the restart the moment the plugin changed and
 * walk away, instead of having to remember to come back after the session ends.
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
  | 'restart.proceedIdle'
  | 'restart.requesting'
  | 'restart.conflict'
  | 'restart.suppressed'
  | 'restart.denied'
  | 'restart.unsupported'
  | 'restart.unknown'
  | 'restart.failed'
  | 'restart.close'
  | 'restart.queued.title'
  | 'restart.queued.body'
  | 'restart.queued.cancel'

/** English dictionary (key-set source of truth). */
export const en: Record<RestartDshKey, string> = {
  'restart.label': 'Restart DeepSeek Harness',
  'restart.confirm.title': 'Restart the DeepSeek Harness service?',
  'restart.confirm.body': '“Restart now” interrupts in-flight tasks and will not resume them automatically. “Restart when idle” waits until every session has finished.',
  'restart.cancel': 'Cancel',
  'restart.proceed': 'Restart now',
  'restart.proceedIdle': 'Restart when idle',
  'restart.requesting': 'Submitting restart request...',
  'restart.conflict': 'A restart request is already in progress.',
  'restart.suppressed': 'The service just restarted; please wait a moment before trying again.',
  'restart.denied': 'Restart is only available from this machine (loopback).',
  'restart.unsupported': 'Restart is not supported on this platform.',
  'restart.unknown': 'Could not confirm whether the restart request was accepted. Check the DSH connection status; do not retry repeatedly.',
  'restart.failed': 'Restart request failed',
  'restart.close': 'Close',
  'restart.queued.title': 'Restart scheduled',
  'restart.queued.body': 'The restart runs as soon as every session has finished. You can close this window; nothing else is required.',
  'restart.queued.cancel': 'Cancel the scheduled restart',
}

/** Simplified Chinese dictionary. */
export const zh: Record<RestartDshKey, string> = {
  'restart.label': '重启 DeepSeek Harness',
  'restart.confirm.title': '重启 DeepSeek Harness 服务？',
  'restart.confirm.body': '「立即重启」会中断进行中的任务且不会自动续接；「等会话结束」会等到所有会话都跑完再重启。',
  'restart.cancel': '取消',
  'restart.proceed': '立即重启',
  'restart.proceedIdle': '等会话结束后重启',
  'restart.requesting': '正在提交重启请求…',
  'restart.conflict': '已有重启请求在处理。',
  'restart.suppressed': '服务刚刚重启，请稍候再试。',
  'restart.denied': '重启仅限本机访问（loopback）。',
  'restart.unsupported': '当前平台不支持重启。',
  'restart.unknown': '无法确认重启请求是否被接受，请查看 DSH 连接状态；不要连续重试。',
  'restart.failed': '重启请求失败',
  'restart.close': '关闭',
  'restart.queued.title': '已安排重启',
  'restart.queued.body': '所有会话跑完后会自动重启。可以直接关掉这个窗口，不需要再回来点一次。',
  'restart.queued.cancel': '取消这次重启',
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
