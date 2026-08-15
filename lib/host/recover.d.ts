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
/** The text of the auto-continue followup pushed to a resumed agent. */
export declare const CONTINUE_TEXT = "Continue.";
/** How long to keep listening after boot for matching agents before giving up. */
export declare const RECOVERY_TIMEOUT_MS = 60000;
/** Payload of the resume snapshot file. */
export interface ResumeState {
    ts: number;
    reason?: string;
    sessionIds: SessionId[];
}
/** Ids that still need a matching agent; drains as agents are continued. */
export declare class Recovery {
    private readonly pending;
    private timer;
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
    /** Load the resume file into `pending`, then arm the timeout to clear it. */
    private loadAndListen;
    /** Handle a fresh agent/created event during the recovery window. */
    private onAgent;
    /**
     * Whether the agent's most recent turn was cut short: a `turn/end` with
     * reason `interrupted`, or a `turn/start` with no subsequent clean
     * `turn/end`. Reads from the agent's durable session event log (the live
     * session projection exposes the last events).
     */
    private lastTurnInterrupted;
    private finish;
    private safeUnlink;
}
//# sourceMappingURL=recover.d.ts.map