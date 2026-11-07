/**
 * dsh-restart-systemd - browser half. Registers the restart dictionaries and
 * mounts the sidebar-footer trigger into the official sidebar.footer.action
 * seat. The button only asks the host for a restart and reports the host's
 * answer; DSH own connection indicator owns outage/reconnect narration.
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
export type RestartDshKey = 'restart.label' | 'restart.confirm.title' | 'restart.confirm.body' | 'restart.cancel' | 'restart.proceed' | 'restart.requesting' | 'restart.requestingHint' | 'restart.accepted' | 'restart.acceptedHint' | 'restart.conflict' | 'restart.suppressed' | 'restart.denied' | 'restart.unsupported' | 'restart.unknown' | 'restart.failed' | 'restart.close';
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