/**
 * Windows self-restart support for dsh-restart-systemd.
 *
 * Windows has no service manager to call, and the DSH host exposes no
 * in-process self-restart hook: cordis-plugin-loader's `exit()` is a no-op and
 * the only graceful way out is `ctx.get('appExit')`. A restart therefore needs
 * a process that outlives this one, so this module writes a small PowerShell
 * watcher, starts it detached, and hands the relaunch to the user's launcher
 * script once this exact process is gone.
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
/** How long the watcher waits for the old process before giving up. */
export declare const WATCH_TIMEOUT_SECONDS = 120;
/**
 * How long the watcher waits for the launcher's exit code before leaving it.
 * Bounded on purpose: `Start-Process -Wait` returned only when the launcher's
 * own children finished too (measured: a launcher that spawned a 22s child
 * made the wait 22s), and the launcher's children include the new host.
 */
export declare const LAUNCHER_WAIT_MS = 180000;
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
/** The program that runs a launcher of this kind, plus its argument string. */
export declare function launcherCommand(launcher: string, env?: NodeJS.ProcessEnv): {
    file: string;
    argumentList: string;
};
/**
 * The lines that actually run the launcher.
 *
 * The launcher runs as its own process instead of being dot-called: a launcher
 * that ends in `exit 1` would otherwise terminate the watcher itself and leave
 * no trace of why the host never came back. Running it separately keeps the
 * exit code, so the failure lands in the watcher log.
 *
 * Window style is deliberately passed to PowerShell (`-WindowStyle Hidden`)
 * rather than to Start-Process: the launcher is expected to show its own
 * progress window during a multi-minute cold start, and Start-Process's
 * -WindowStyle Hidden hides that window as well.
 */
export declare function launcherInvocation(launcher: string, env?: NodeJS.ProcessEnv): string[];
/**
 * Build the watcher script body.
 * @param options - the pid to wait for, the launcher to run, and the log path.
 * @returns the PowerShell source written next to the flag file.
 */
export declare function windowsWatcherScript(options: {
    pid: number;
    launcher: string;
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
 * Resolve the launcher script or executable to run after this process exits.
 * @param options - the DSH home and the process environment.
 * @returns the configured path, or undefined when nothing is configured.
 * @throws when the config file exists but cannot be read or parsed.
 */
export declare function resolveLauncher(options: {
    home: string;
    env?: NodeJS.ProcessEnv;
}): Promise<string | undefined>;
/**
 * Write the watcher script and its wscript shim, then start the shim detached
 * so it survives our exit. Throws when the shim cannot be started at all —
 * exiting into a dead host with no relaunch is the one failure worth refusing.
 * @param options - home, launcher path, the pid to wait for, and an error hook.
 * @returns the script and shim paths, the log path, and the watcher pid.
 */
export declare function startWatcher(options: {
    home: string;
    launcher: string;
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