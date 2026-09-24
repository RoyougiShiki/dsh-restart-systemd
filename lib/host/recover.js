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
import { readFile, unlink, stat } from 'node:fs/promises';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
/** The text of the auto-continue followup pushed to a resumed agent. */
export const CONTINUE_TEXT = 'Continue.';
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
export class Recovery {
    pending = new Set();
    resumePath;
    ctx;
    armed = false;
    constructor(ctx, resumePath) {
        this.ctx = ctx;
        this.resumePath = resumePath;
    }
    /**
     * Called once at plugin boot (after `consumeStaleState`). Loads the resume
     * snapshot if present and arms the `agent/created` capture. Must be invoked
     * before any agent is created, i.e. from the plugin `apply`, so the listener
     * is installed before the service starts restoring sessions.
     */
    arm() {
        if (this.armed)
            return () => undefined;
        this.armed = true;
        // Bind the listener once; the actual continue decisions happen in onAgent.
        // The listener body is braced so it returns `undefined` (the event's
        // declared return) rather than `void`.
        const detach = this.ctx.on('agent/created', (payload) => {
            this.onAgent(payload.agent);
            return undefined;
        });
        void this.loadAndListen();
        return detach;
    }
    /** Load the resume file into `pending`; the marker is consumed as it is read. */
    async loadAndListen() {
        let state = null;
        try {
            const raw = await readFile(this.resumePath, 'utf8');
            state = JSON.parse(raw);
        }
        catch {
            state = null;
        }
        // One-shot token: the ids live in memory from here on, so drop the file
        // immediately. Without this a later boot could re-arm from a stale marker.
        await this.safeUnlink();
        if (state === null || !Array.isArray(state.sessionIds) || state.sessionIds.length === 0) {
            // Nothing to resume (or a stray file with no list): stay idle.
            return;
        }
        for (const id of state.sessionIds)
            this.pending.add(id);
        this.ctx.logger.info(`dsh-restart-systemd: recovery armed for ${this.pending.size} session(s): ${[...this.pending].join(', ')}`);
    }
    /** Handle an `agent/created` event; only listed sessions are considered. */
    onAgent(agent) {
        if (!this.pending.has(agent.id))
            return;
        // Only auto-continue an agent whose last turn was actually interrupted —
        // a session that started cleanly (no open turn) needs no poke.
        if (!this.lastTurnInterrupted(agent)) {
            this.ctx.logger.info(`dsh-restart-systemd: agent ${agent.id} is in the resume list but its last turn was clean; skipping`);
            this.pending.delete(agent.id);
            return;
        }
        this.ctx.logger.info(`dsh-restart-systemd: resuming interrupted agent ${agent.id}`);
        try {
            agent.followup(createUserMessage({
                content: [{ type: 'text', text: CONTINUE_TEXT }],
                source: { kind: 'dsh-restart-systemd' },
            }));
        }
        catch (error) {
            this.ctx.logger.warn(`dsh-restart-systemd: followup failed for ${agent.id}: ${String(error)}`);
        }
        finally {
            // Drain on both outcomes so an id is never continued twice, however many
            // times its agent is created over this process's life.
            this.pending.delete(agent.id);
        }
    }
    /**
     * Whether the agent's most recent turn was cut short: a `turn/end` whose
     * reason is the `interrupted` closer the agent loop appends for a
     * crash-orphaned turn, or a `turn/start` with no subsequent `turn/end`.
     * Reads the agent's durable session event log through the public
     * `Session.snapshotEvents()` reader (the log itself is private).
     */
    lastTurnInterrupted(agent) {
        try {
            // Scan the restored log for how the last turn ended: `turn/start` never
            // followed by a `turn/end` means an open turn was cut short mid-flight;
            // otherwise the most recent `turn/end.reason.kind` tells us.
            let sawOpenTurn = false;
            let lastKind;
            for (const event of agent.session.snapshotEvents()) {
                if (event.type === 'turn/end') {
                    sawOpenTurn = false;
                    lastKind = event.data.reason.kind;
                }
                else if (event.type === 'turn/start') {
                    sawOpenTurn = true;
                }
            }
            if (sawOpenTurn)
                return true; // an open turn interrupted mid-flight
            return lastKind === 'interrupted';
        }
        catch {
            // If the log is not inspectable, err toward resuming an id the snapshot
            // explicitly listed as running at click time — a safe default.
            return true;
        }
    }
    async safeUnlink() {
        try {
            await stat(this.resumePath);
            await unlink(this.resumePath);
        }
        catch {
            // absent is fine
        }
    }
}
//# sourceMappingURL=recover.js.map