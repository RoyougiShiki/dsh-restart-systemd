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
import type { Context as ClientContext } from '@deepseek-ai/cordis';
/** Dictionary namespace owned by this plugin. */
export declare const NS = "restart-dsh";
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'restart-dsh': RestartDshKey;
    }
}
export type RestartDshKey = 'restart.label' | 'restart.confirm.title' | 'restart.confirm.body' | 'restart.cancel' | 'restart.proceed' | 'restart.proceedIdle' | 'restart.requesting' | 'restart.conflict' | 'restart.suppressed' | 'restart.denied' | 'restart.unsupported' | 'restart.unknown' | 'restart.failed' | 'restart.close' | 'restart.queued.title' | 'restart.queued.body' | 'restart.queued.cancel';
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