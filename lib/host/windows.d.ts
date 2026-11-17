/**
 * Windows self-restart support for dsh-restart-systemd.
 *
 * Windows has no service manager to call, and the DSH host exposes no
 * in-process self-restart hook: cordis-plugin-loader's `exit()` is a no-op and
 * the only graceful way out is `ctx.get('appExit')`. A restart therefore needs
 * a process that outlives this one, so this module writes a small PowerShell
 * watcher, starts it detached, and lets it start the replacement once this exact
 * process is gone.
 *
 * The replacement is one of two things:
 *  - `launcher`: the script configured in `$DSH_HOME/dsh-restart.json` (or
 *    `DSH_RESTART_WINDOWS_LAUNCHER`). A launcher owns log rotation, the token URL
 *    and its own progress window, so it is the nicer path when it exists.
 *  - `self`: this process's own command line, replayed with `process.execPath`.
 *    Needs no configuration and no knowledge of how DSH was started, which is
 *    what makes the button work for a hand-started `dsh web`.
 *
 * The watcher is never started directly: node cannot start `powershell.exe`
 * detached here - the child exits 0 without running a single line of the
 * script. A `wscript.exe` shim does work, and it is the same chain the desktop
 * launcher shortcut already uses, so the watcher is launched as
 * `wscript.exe dsh-restart-watcher.vbs` and the VBS then runs the PowerShell file.
 *
 * The watcher waits for one pid, never for a free port: a DSH started outside
 * the launcher also owns the port, so a port-based check would relaunch while
 * that process is still running.
 * @module dsh-restart-systemd/host/windows
 */
/** Environment variable that points at the launcher script or executable. */
export declare const LAUNCHER_ENV = "DSH_RESTART_WINDOWS_LAUNCHER";
/** File under `$DSH_HOME` holding `{ "windowsLauncher": "..." }`. */
export declare const CONFIG_FILE = "dsh-restart.json";
/** Where the watcher script is written (overwritten on every restart). */
export declare const WATCHER_FILE = "dsh-restart-watcher.ps1";
/** Where the wscript shim that starts the watcher is written. */
export declare const WATCHER_VBS_FILE = "dsh-restart-watcher.vbs";
/** Where the watcher appends its own progress log. */
export declare const WATCHER_LOG_FILE = "dsh-restart-watcher.log";
/**
 * Where a self relaunch sends the new host's stdout and stderr.
 *
 * A detached, hidden child has no console of its own, and the token URL the new
 * host prints at boot is the only way back into the Web UI. Overwritten on
 * every restart.
 */
export declare const RELAUNCH_OUT_FILE = "dsh-restart-relaunch.log";
/** Where a self relaunch sends the new host's stderr. */
export declare const RELAUNCH_ERR_FILE = "dsh-restart-relaunch.err.log";
/** How long the watcher waits for the old process before giving up. */
export declare const WATCH_TIMEOUT_SECONDS = 120;
/**
 * How long the watcher waits for the relaunch's exit code before leaving it.
 * Bounded on purpose: `Start-Process -Wait` returned only when the launcher's
 * own children finished too (measured: a launcher that spawned a 22s child
 * made the wait 22s), and a launcher's children include the new host.
 */
export declare const LAUNCHER_WAIT_MS = 180000;
/**
 * How long a self relaunch is watched for an early death.
 *
 * The replacement is the new host and is meant to outlive the watcher, so it is
 * never waited on to completion. Start-Process also cannot report the exit code
 * of a redirected child (it comes back empty), so only "it died within a few
 * seconds" is worth logging; the why is in `$DSH_HOME/dsh-restart-relaunch.err.log`.
 */
export declare const RELAUNCH_GRACE_SECONDS = 5;
/**
 * How long to watch a freshly spawned shim for an immediate failure before
 * trusting it. Only spawn errors (missing wscript.exe) show up this fast.
 */
export declare const EARLY_ERROR_MS = 300;
/** The subset of a detached child process this module needs. */
export interface DetachedChild {
    pid?: number;
    unref(): void;
    on(event: 'error', handler: (error: Error) => void): unknown;
}
/** Spawner seam: replaced in tests so no real process is created. */
export type DetachedSpawner = (command: string, args: string[], options: Record<string, unknown>) => DetachedChild;
/**
 * Replace the detached spawner (tests only).
 * @param replacement - the fake spawner, or undefined to restore the real one.
 */
export declare function setDetachedSpawner(replacement?: DetachedSpawner): void;
/** Absolute path of the Windows PowerShell host, resolved from %SystemRoot%. */
export declare function powershellPath(env?: NodeJS.ProcessEnv): string;
/** Absolute path of the Windows Script Host, resolved from %SystemRoot%. */
export declare function wscriptPath(env?: NodeJS.ProcessEnv): string;
/** Quote one PowerShell single-quoted literal. */
export declare function psLiteral(value: string): string;
/** Quote one VBScript string literal. */
export declare function vbsLiteral(value: string): string;
/**
 * Quote one argument the way Windows itself splits a command line.
 *
 * `Start-Process -ArgumentList` joins an array with single spaces and
 * quotes nothing, so an unquoted `C:Program Files...` would arrive as two
 * arguments. The rules below are the ones every CRT parser agrees on: quote when
 * the value is empty or holds whitespace / a quote, double the backslashes that
 * precede a quote, and double trailing backslashes so they cannot escape the
 * closing quote.
 * @param value - one argument, already unquoted.
 * @returns the argument as it must appear on a Windows command line.
 */
export declare function windowsArgument(value: string): string;
/** Which replacement the watcher starts. */
export type RelaunchSource = 'launcher' | 'self';
/** Everything the watcher needs to start the replacement host. */
export interface WatcherRelaunch {
    /** Where this plan came from; only used for logging. */
    source: RelaunchSource;
    /** The program to start: powershell.exe for a .ps1 launcher, node.exe for self. */
    file: string;
    /** One already-quoted argument string, the shape Start-Process wants. */
    argumentList: string;
    /** Working directory for the replacement, or undefined to inherit. */
    workingDirectory?: string;
    /** Where the replacement's stdout goes (self relaunch only). */
    stdoutPath?: string;
    /** Where the replacement's stderr goes (self relaunch only). */
    stderrPath?: string;
}
/** The program that runs a launcher of this kind, plus its argument string. */
export declare function launcherCommand(launcher: string, env?: NodeJS.ProcessEnv): {
    file: string;
    argumentList: string;
};
/** A relaunch through the configured launcher script. */
export declare function launcherRelaunch(launcher: string, env?: NodeJS.ProcessEnv): WatcherRelaunch;
/**
 * A relaunch that replays this process's own command line.
 *
 * This is what makes the button work no matter how DSH was started: the argv
 * the host already has is exactly the argv the replacement needs, so no
 * launcher, no service manager and no knowledge of the install layout is
 * involved. Output goes to files under `$DSH_HOME` because a detached, hidden
 * child has no console to print the token URL to.
 * @param options - this process's execPath / argv / cwd, plus the DSH home.
 * @returns the plan the watcher replays.
 */
export declare function selfRelaunch(options: {
    execPath: string;
    argv: readonly string[];
    cwd: string;
    home: string;
}): WatcherRelaunch;
/**
 * The lines that actually start the replacement.
 *
 * The replacement runs as its own process instead of being dot-called: a
 * launcher that ends in `exit 1` would otherwise terminate the watcher itself
 * and leave no trace of why the host never came back. Running it separately
 * keeps the exit code, so the failure lands in the watcher log.
 *
 * Window style is deliberately passed to PowerShell (`-WindowStyle Hidden`) rather
 * than to Start-Process: a launcher is expected to show its own progress window
 * during a multi-minute cold start, and Start-Process's -WindowStyle Hidden
 * hides that window as well.
 * @param relaunch - the plan built by `resolveRelaunch`.
 * @returns the PowerShell lines, ready to join into the watcher script.
 */
export declare function relaunchInvocation(relaunch: WatcherRelaunch): string[];
/**
 * Build the watcher script body.
 * @param options - the pid to wait for, the relaunch plan, and the log path.
 * @returns the PowerShell source written next to the flag file.
 */
export declare function windowsWatcherScript(options: {
    pid: number;
    relaunch: WatcherRelaunch;
    logPath: string;
}): string;
/**
 * Build the wscript shim that starts the PowerShell watcher hidden.
 *
 * node's `spawn('powershell.exe', ..., { detached: true })` hands back a pid and
 * exits 0 without executing the script, so the launch is delegated to Windows
 * Script Host. The shim logs before and after, so a broken chain shows up in
 * the watcher log instead of failing silently.
 *
 * The file is written as UTF-16LE with a BOM: wscript decodes BOM-less scripts
 * with the ANSI code page, which mangles any non-ASCII path in the command.
 * @param options - the watcher script, the log it appends to, and the
 *   PowerShell to run (absolute, so PATH inside wscript does not matter).
 * @returns the VBScript source.
 */
export declare function windowsWatcherShim(options: {
    scriptPath: string;
    logPath: string;
    powershell?: string;
}): string;
/**
 * Resolve the launcher script or executable configured for this machine.
 * @param options - the DSH home and the process environment.
 * @returns the configured path, or undefined when nothing is configured.
 * @throws when the config file exists but cannot be read or parsed.
 */
export declare function resolveLauncher(options: {
    home: string;
    env?: NodeJS.ProcessEnv;
}): Promise<string | undefined>;
/**
 * Decide how the watcher will start the replacement.
 *
 * A configured launcher wins, because it also rotates logs, prints the token
 * URL and shows its own progress window. Everything else - no config, or a
 * config that points at a launcher which no longer exists - falls back to
 * replaying this process's own command line, so the button keeps working after
 * the launcher is moved, replaced, or never used in the first place.
 * @param options - the DSH home, this process's execPath / argv / cwd, and a
 *   hook for the "configured launcher is missing" warning.
 * @returns the plan to hand to `startWatcher`.
 * @throws when the config file exists but cannot be read or parsed.
 */
export declare function resolveRelaunch(options: {
    home: string;
    env?: NodeJS.ProcessEnv;
    execPath?: string;
    argv?: readonly string[];
    cwd?: string;
    onMissingLauncher?: (path: string) => void;
}): Promise<WatcherRelaunch>;
/**
 * Write the watcher script and its wscript shim, then start the shim detached
 * so it survives our exit. Throws when the shim cannot be started at all —
 * exiting into a dead host with no relaunch is the one failure worth refusing.
 * @param options - home, the relaunch plan, the pid to wait for, and an error hook.
 * @returns the script and shim paths, the log path, and the watcher pid.
 */
export declare function startWatcher(options: {
    home: string;
    relaunch: WatcherRelaunch;
    pid: number;
    env?: NodeJS.ProcessEnv;
    onError?: (error: Error) => void;
}): Promise<{
    scriptPath: string;
    shimPath: string;
    logPath: string;
    watcherPid: number | undefined;
}>;
//# sourceMappingURL=windows.d.ts.map