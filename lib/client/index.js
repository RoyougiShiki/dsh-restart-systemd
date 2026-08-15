/**
 * dsh-restart-systemd — browser half. Registers the `restart-dsh` dictionaries
 * and mounts the sidebar-footer restart trigger into the official
 * `sidebar.footer.action` seat (the slot beside the Settings trigger where
 * remote-web-ui's phone icon lives), plus a fallback entry into the
 * conversation-session header utilities band when present. Follows the
 * remote-web-ui injection pattern: `ctx.slots.inject(key, () => ctx.slots.register(...))`.
 * @module dsh-restart-systemd/client
 */
import { createElement } from 'react';
import { RestartButton } from "./RestartButton.js";
/** Dictionary namespace owned by this plugin. */
export const NS = 'restart-dsh';
/** English dictionary (key-set source of truth). */
export const en = {
    'restart.label': 'Restart DeepSeek Harness',
    'restart.confirm.title': 'Restart DeepSeek Harness service?',
    'restart.confirm.body': 'In-flight agent tasks will be interrupted and resumed automatically. The page will reconnect in a few seconds.',
    'restart.cancel': 'Cancel',
    'restart.proceed': 'Restart',
    'restart.busy': 'Restarting… the page will reconnect automatically.',
    'restart.done': 'Reconnected. The service restarted successfully.',
    'restart.denied': 'Restart is only available from this machine (loopback).',
    'restart.failedHint': 'If the service does not come back, run: systemctl --user status dsh-web',
    'restart.suppressed': 'The service just restarted; please wait a moment before trying again.',
    'restart.unsupported': 'Restart is not supported on this platform. Run: systemctl --user restart dsh-web',
};
/** Simplified Chinese dictionary. */
export const zh = {
    'restart.label': '重启 DeepSeek Harness',
    'restart.confirm.title': '重启 DeepSeek Harness 服务？',
    'restart.confirm.body': '进行中的 agent 任务将中断并自动续接，页面约几秒后自动重连。',
    'restart.cancel': '取消',
    'restart.proceed': '重启',
    'restart.busy': '正在重启…页面将自动重连。',
    'restart.done': '已重连，服务重启成功。',
    'restart.denied': '重启仅限本机访问（loopback）。',
    'restart.failedHint': '若服务未恢复，请手动执行：systemctl --user status dsh-web',
    'restart.suppressed': '服务刚刚重启，请稍候再试。',
    'restart.unsupported': '当前平台不支持重启，请手动执行：systemctl --user restart dsh-web',
};
export const dictionaries = { en, zh };
/** Required services: locale for copy, slots for the footer seat. */
export const inject = ['slots', 'locale'];
/** Apply the browser half. */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-restart-systemd: dictionaries');
    // Primary seat: sidebar footer actions (beside Settings — next to the
    // remote-web-ui phone icon). Ordered after remote-web-ui so it sits to its
    // right when the side-by-side order matters.
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'dsh-restart-systemd',
        order: 20,
        locale: NS,
    }, RestartButton));
    // Fallback / alternate seat: the conversation-session header utilities band.
    // That seat passes its own owner props (no `wide`), so wrap the button with
    // wide=true to avoid dropping into the rail variant inside the header.
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'dsh-restart-systemd',
        order: 90,
        locale: NS,
    }, (props) => createElement(RestartButton, { wide: props.wide ?? true, t: props.t })));
}
//# sourceMappingURL=index.js.map