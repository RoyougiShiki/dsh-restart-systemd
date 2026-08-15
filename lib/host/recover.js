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
/** How long to keep listening after boot for matching agents before giving up. */
export const RECOVERY_TIMEOUT_MS = 60_000;
/** Ids that still need a matching agent; drains as agents are continued. */
export class Recovery {
    pending = new Set();
    timer;
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
        const detach = this.ctx.on('agent/created', (payload) => this.onAgent(payload.agent));
        void this.loadAndListen();
        return detach;
    }
    /** Load the resume file into `pending`, then arm the timeout to clear it. */
    async loadAndListen() {
        let state = null;
        try {
            const raw = await readFile(this.resumePath, 'utf8');
            state = JSON.parse(raw);
        }
        catch {
            state = null;
        }
        if (state === null || !Array.isArray(state.sessionIds) || state.sessionIds.length === 0) {
            // Nothing to resume (or a stray file with no list): drop the file and idle.
            await this.safeUnlink();
            return;
        }
        for (const id of state.sessionIds)
            this.pending.add(id);
        this.ctx.logger.info(`dsh-restart-systemd: recovery armed for ${this.pending.size} session(s): ${[...this.pending].join(', ')}`);
        // Cleanup timeout: if some ids never come back (the session was deleted or
        // the run was headless), still drop the marker so stale state cannot linger.
        this.timer = setTimeout(() => {
            this.ctx.logger.info(`dsh-restart-systemd: recovery window closed with ${this.pending.size} un-matched session(s); clearing resume marker`);
            void this.safeUnlink();
            this.pending.clear();
        }, RECOVERY_TIMEOUT_MS);
    }
    /** Handle a fresh agent/created event during the recovery window. */
    onAgent(agent) {
        if (!this.pending.has(agent.id))
            return;
        // Only auto-continue an agent whose last turn was actually interrupted —
        // a session that started cleanly (no open turn) needs no poke.
        if (!this.lastTurnInterrupted(agent)) {
            this.ctx.logger.info(`dsh-restart-systemd: agent ${agent.id} is in the resume list but its last turn was clean; skipping`);
            this.pending.delete(agent.id);
            if (this.pending.size === 0)
                this.finish();
            return;
        }
        this.ctx.logger.info(`dsh-restart-systemd: resuming interrupted agent ${agent.id}`);
        try {
            agent.followup(createUserMessage({
                content: [{ type: 'text', text: CONTINUE_TEXT }],
                source: { kind: 'plugin', plugin: 'dsh-restart-systemd' },
            }));
        }
        catch (error) {
            this.ctx.logger.warn(`dsh-restart-systemd: followup failed for ${agent.id}: ${String(error)}`);
        }
        finally {
            this.pending.delete(agent.id);
            if (this.pending.size === 0)
                this.finish();
        }
    }
    /**
     * Whether the agent's most recent turn was cut short: a `turn/end` with
     * reason `interrupted`, or a `turn/start` with no subsequent clean
     * `turn/end`. Reads from the agent's durable session event log (the live
     * session projection exposes the last events).
     */
    lastTurnInterrupted(agent) {
        try {
            // `agent.session.events` is an immutable snapshot of the durable log
            // (restored after the restart). Scan it for how the last turn ended:
            // `turn/start` never followed by a `turn/end` means an open turn was cut
            // short mid-flight; otherwise the most recent `turn/end.reason` tells us.
            let sawOpenTurn = false;
            let lastReason;
            for (const event of agent.session.events) {
                if (event.type === 'turn/end') {
                    sawOpenTurn = false;
                    lastReason = String(event.data.reason);
                }
                else if (event.type === 'turn/start') {
                    sawOpenTurn = true;
                }
            }
            if (sawOpenTurn)
                return true; // an open turn interrupted mid-flight
            return lastReason === 'interrupted';
        }
        catch {
            // If the log is not inspectable, err toward resuming an id the snapshot
            // explicitly listed as running at click time — a safe default.
            return true;
        }
    }
    finish() {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        void this.safeUnlink();
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