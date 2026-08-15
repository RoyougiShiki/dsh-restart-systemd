/**
 * dsh-restart-systemd — browser half. Registers the `restart-dsh` dictionaries
 * and mounts the sidebar-footer restart trigger into the official
 * `sidebar.footer.action` seat (the slot beside the Settings trigger where
 * remote-web-ui's phone icon lives). Follows the
 * remote-web-ui injection pattern: `ctx.slots.inject(key, () => ctx.slots.register(...))`.
 * @module dsh-restart-systemd/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Dictionary namespace owned by this plugin. */
export declare const NS = "restart-dsh";
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'restart-dsh': RestartDshKey;
    }
}
export type RestartDshKey = 'restart.label' | 'restart.confirm.title' | 'restart.confirm.body' | 'restart.cancel' | 'restart.proceed' | 'restart.busy' | 'restart.done' | 'restart.denied' | 'restart.failedHint' | 'restart.suppressed' | 'restart.unsupported';
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