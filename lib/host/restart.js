/**
 * Restart scheduling + state for the minimal dsh-restart-systemd host half.
 *
 * The only supported runtime is a Linux/WSL systemd user unit. The scheduler
 * writes a one-shot flag before the delayed spawn, keeps a single-flight lock
 * until the spawn settles, and refuses requests for the residual window after
 * a plugin-driven boot. It never resumes agents and never reads a session
 * snapshot.
 * @module dsh-restart-systemd/host/restart
 */
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
/** Service name the WebUI runs under (systemd user unit). */
export const SYSTEMD_UNIT = 'dsh-web';
/** Delay before the actual spawn, so the browser receives the 202 first. */
export const DELAY_MS = 3000;
/** Re-click suppression window immediately after a plugin-driven boot. */
export const RESIDUAL_WINDOW_MS = 15000;
/** Resolve the restart state paths under the writable DSH home. */
export function restartStatePaths(home) {
    return {
        flag: join(home, 'dsh-restart.flag'),
        legacyResume: join(home, 'dsh-restart-resume.json'),
    };
}
/** Only a Linux/WSL systemd user unit is managed by this plugin. */
export function platformSupported() {
    return process.platform === 'linux';
}
/** The exact whitelisted argv. No shell, no helper, no platform branch. */
export function restartArgv() {
    return ['systemctl', '--user', 'restart', SYSTEMD_UNIT];
}
/** Live single-flight and residual-window state for one plugin context. */
export class RestartScheduler {
    timer;
    disposed = false;
    paths;
    ctx;
    suppressedUntil = 0;
    inFlight = false;
    initPromise;
    pendingFlagTs;
    constructor(ctx, home) {
        this.ctx = ctx;
        this.paths = restartStatePaths(home);
    }
    /**
     * Consume the boot flag exactly once. Requests await the same promise so a
     * request that arrives while boot state is still being read cannot race the
     * residual-window suppression.
     */
    initialize() {
        if (this.initPromise === undefined)
            this.initPromise = this.consumeStaleState();
        return this.initPromise;
    }
    /**
     * Read a leftover restart flag (including the old shape with sessionIds),
     * open the residual window, and remove both the flag and the obsolete
     * auto-resume marker. The flag is a safety token, never a recovery record.
     */
    async consumeStaleState() {
        let raw;
        try {
            raw = await readFile(this.paths.flag, 'utf8');
        }
        catch (error) {
            const code = error.code;
            if (code !== 'ENOENT')
                this.log('warn', 'dsh-restart-systemd: could not read restart flag: ' + String(error));
        }
        if (raw !== undefined) {
            this.suppressedUntil = Date.now() + RESIDUAL_WINDOW_MS;
            let reason = 'unknown';
            let stamp = 'unknown';
            try {
                const parsed = JSON.parse(raw);
                if (parsed !== null && typeof parsed === 'object') {
                    if (typeof parsed.reason === 'string' && parsed.reason !== '')
                        reason = parsed.reason;
                    if (typeof parsed.ts === 'number' && Number.isFinite(parsed.ts))
                        stamp = new Date(parsed.ts).toISOString();
                }
            }
            catch {
                this.log('warn', 'dsh-restart-systemd: leftover restart flag was malformed; suppressing for the residual window');
            }
            this.log('info', 'dsh-restart-systemd: consumed leftover restart flag from ' + stamp + ' (reason=' + reason + ')');
        }
        await this.safeUnlink(this.paths.flag);
        await this.safeUnlink(this.paths.legacyResume);
    }
    /**
     * Schedule one restart. The method is async because preparation can fail:
     * the single-flight lock is taken first, then the flag write is awaited, and
     * only a successful write installs the delayed spawn and returns 202-shaped
     * information. A failed write returns error without spawning.
     */
    async schedule(reason) {
        if (!platformSupported())
            return { kind: 'unsupported' };
        if (this.disposed)
            return { kind: 'error', message: 'restart scheduler is disposed' };
        if (this.inFlight || this.timer !== undefined)
            return { kind: 'already-scheduled' };
        this.inFlight = true;
        try {
            await this.initialize();
            if (this.disposed) {
                this.inFlight = false;
                return { kind: 'error', message: 'restart scheduler was disposed before scheduling' };
            }
            if (Date.now() < this.suppressedUntil) {
                this.inFlight = false;
                return { kind: 'suppressed' };
            }
            const flagTs = Date.now();
            const flag = { ts: flagTs, reason };
            try {
                await writeFile(this.paths.flag, JSON.stringify(flag, null, 2), 'utf8');
            }
            catch (error) {
                this.inFlight = false;
                return { kind: 'error', message: 'failed to write restart flag: ' + String(error) };
            }
            if (this.disposed) {
                await this.clearOwnFlag(flagTs);
                this.inFlight = false;
                return { kind: 'error', message: 'restart scheduler was disposed during flag write' };
            }
            this.pendingFlagTs = flagTs;
            try {
                this.timer = setTimeout(() => {
                    this.timer = undefined;
                    const pending = this.pendingFlagTs;
                    this.pendingFlagTs = undefined;
                    if (pending === undefined) {
                        this.inFlight = false;
                        return;
                    }
                    if (this.disposed) {
                        this.inFlight = false;
                        void this.clearOwnFlag(pending).catch((error) => {
                            this.log('warn', 'dsh-restart-systemd: could not clear restart flag after dispose: ' + String(error));
                        });
                        return;
                    }
                    void this.spawn(pending).catch((error) => {
                        this.log('error', 'dsh-restart-systemd: restart attempt failed unexpectedly: ' + String(error));
                        this.inFlight = false;
                    });
                }, DELAY_MS);
            }
            catch (error) {
                this.pendingFlagTs = undefined;
                await this.clearOwnFlag(flagTs);
                this.inFlight = false;
                return { kind: 'error', message: 'failed to schedule restart: ' + String(error) };
            }
            return { kind: 'scheduled', delayMs: DELAY_MS };
        }
        catch (error) {
            this.inFlight = false;
            return { kind: 'error', message: 'restart scheduling failed: ' + String(error) };
        }
    }
    /** Invoke the fixed systemctl argv; failures are logged, never rethrown. */
    async spawn(flagTs) {
        try {
            const argv = restartArgv();
            this.log('info', 'dsh-restart-systemd: spawning restart for ' + SYSTEMD_UNIT + ': ' + argv.join(' '));
            const handle = this.ctx.subprocess.spawn({
                argv,
                cwd: process.cwd(),
                stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
                graceMs: 10_000,
            });
            await handle.done.then(async (outcome) => {
                const signal = outcome.signal ?? 'none';
                if (outcome.exitCode === 0) {
                    this.log('info', 'dsh-restart-systemd: restart process exited code=0 signal=' + signal);
                }
                else {
                    this.log('warn', 'dsh-restart-systemd: restart process exited code=' + String(outcome.exitCode) + ' signal=' + signal);
                    await this.clearOwnFlag(flagTs);
                }
            }, async (error) => {
                this.log('warn', 'dsh-restart-systemd: restart process failed: ' + String(error));
                await this.clearOwnFlag(flagTs);
            });
        }
        catch (error) {
            this.log('error', 'dsh-restart-systemd: could not spawn restart: ' + String(error));
            await this.clearOwnFlag(flagTs);
        }
        finally {
            this.inFlight = false;
        }
    }
    /** Remove the flag only when it is still the one written for this attempt. */
    async clearOwnFlag(flagTs) {
        try {
            const raw = await readFile(this.paths.flag, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed !== null && typeof parsed === 'object' && parsed.ts === flagTs)
                await this.safeUnlink(this.paths.flag);
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                this.log('warn', 'dsh-restart-systemd: could not clear restart flag: ' + String(error));
            }
        }
    }
    /** Best-effort, ignore-when-absent unlink. */
    async safeUnlink(path) {
        try {
            await unlink(path);
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                this.log('warn', 'dsh-restart-systemd: could not remove ' + path + ': ' + String(error));
            }
        }
    }
    /** Clear a pending timer; an accepted but not-yet-spawned flag is removed. */
    log(level, message) {
        try {
            this.ctx.logger[level](message);
        }
        catch {
            // Logging must never break scheduling or escape a timer.
        }
    }
    /** Permanently close this scheduler; an accepted timer is cleared and its flag is removed. */
    dispose() {
        this.disposed = true;
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
            const pending = this.pendingFlagTs;
            this.pendingFlagTs = undefined;
            if (pending !== undefined) {
                void this.clearOwnFlag(pending).catch((error) => {
                    this.log('warn', 'dsh-restart-systemd: could not clear restart flag after dispose: ' + String(error));
                });
            }
        }
        this.inFlight = false;
    }
}
//# sourceMappingURL=restart.js.map