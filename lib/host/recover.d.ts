/**
 * restart-recover for dsh-restart-systemd (host half): the read/consume side
 * that resumes agents whose turn was cut short by the service restart.
 *
 * Flow (mirrors fakechris/dsh-harness-ops):
 *  1. The trigger side (restart.ts) wrote `$DSH_HOME/dsh-restart-resume.json`
 *     with the session ids of every agent that was running at click time.
 *  2. After the service restarts, this plugin boots, `consumeStaleState`
 *     deletes the flag token, and `startRecovery` loads the resume list.
 *  3. On each `agent/created` we check whether the new agent's session id is on
 *     the list AND whether its last turn was interrupted (a `turn/end` with
 *     reason `interrupted`, or a bare `turn/start` with no clean `turn/end`).
 *     If so, we enqueue an agent followup ("Continue") and drop the id from the
 *     list so it is never auto-resumed twice. Idle/completed sessions are left
 *     untouched. Once every listed id is matched (or a timeout elapses) we
 *     delete the resume file.
 *
 * We intentionally only resume ids that are BOTH on the snapshot list AND
 * observed to have been interrupted, so a session that finished gracefully
 * before the restart (and therefore is not in the snap's "running" set, and
 * does not show an interrupted last turn) is never poked.
 * @module dsh-restart-systemd/host/recover
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'dsh-restart-systemd': {
            kind: 'dsh-restart-systemd';
        };
    }
}
/** The text of the auto-continue followup pushed to a resumed agent. */
export declare const CONTINUE_TEXT = "Continue.";
/** Payload of the resume snapshot file. */
export interface ResumeState {
    ts: number;
    reason?: string;
    sessionIds: SessionId[];
}
/**
 * Ids that still need a matching agent; drains as agents are continued.
 *
 * ## Why there is no recovery deadline
 *
 * A session is only restored when something opens it — the browser reconnecting
 * on its own, or the user coming back to that conversation later. An earlier
 * version gave up 60s after boot, which quietly made late restores
 * unrecoverable: the marker had already been cleared by the time
 * `agent/created` finally fired. (Observed on this machine: the session was
 * restored 2h25m after the restart and received no continuation.)
 *
 * The pending set therefore lives for the whole process, and the gate that
 * actually protects against poking the wrong session is
 * {@link Recovery.lastTurnInterrupted}: a session the user has since resumed
 * by hand ends its turn as `completed`/`aborted`/… and is skipped, so only a
 * turn still sitting interrupted gets continued. The marker file itself is
 * consumed (deleted) the moment it is read, exactly like the restart flag, so
 * it can never arm a later boot.
 */
export declare class Recovery {
    private readonly pending;
    private readonly resumePath;
    private readonly ctx;
    private armed;
    constructor(ctx: Context, resumePath: string);
    /**
     * Called once at plugin boot (after `consumeStaleState`). Loads the resume
     * snapshot if present and arms the `agent/created` capture. Must be invoked
     * before any agent is created, i.e. from the plugin `apply`, so the listener
     * is installed before the service starts restoring sessions.
     */
    arm(): () => void;
    /** Load the resume file into `pending`; the marker is consumed as it is read. */
    private loadAndListen;
    /** Handle an `agent/created` event; only listed sessions are considered. */
    private onAgent;
    /**
     * Whether the agent's most recent turn was cut short: a `turn/end` whose
     * reason is the `interrupted` closer the agent loop appends for a
     * crash-orphaned turn, or a `turn/start` with no subsequent `turn/end`.
     * Reads the agent's durable session event log through the public
     * `Session.snapshotEvents()` reader (the log itself is private).
     */
    private lastTurnInterrupted;
    private safeUnlink;
}
//# sourceMappingURL=recover.d.ts.map