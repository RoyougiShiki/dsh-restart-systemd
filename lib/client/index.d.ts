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
import type { Context as ClientContext } from '@deepseek-ai/cordis';
/** Dictionary namespace owned by this plugin. */
export declare const NS = "restart-dsh";
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'restart-dsh': RestartDshKey;
    }
}
export type RestartDshKey = 'restart.label' | 'restart.confirm.title' | 'restart.confirm.body' | 'restart.cancel' | 'restart.proceed' | 'restart.pendingShort' | 'restart.pending' | 'restart.pendingHint' | 'restart.timeout' | 'restart.denied' | 'restart.failedHint' | 'restart.suppressed' | 'restart.unsupported';
/** English dictionary (key-set source of truth). */
export declare const en: Record<RestartDshKey, string>;
/** Simplified Chinese dictionary. */
export declare const zh: Record<RestartDshKey, string>;
export declare const dictionaries: {
    en: Record<RestartDshKey, string>;
    zh: Record<RestartDshKey, string>;
};
/** Required services: locale for copy, slots for the footer seat. */
export declare const inject: string[];
/** Apply the browser half. */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map