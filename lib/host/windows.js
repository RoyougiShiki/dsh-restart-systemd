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
import { spawn as nodeSpawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
/** Environment variable that points at the launcher script or executable. */
export const LAUNCHER_ENV = 'DSH_RESTART_WINDOWS_LAUNCHER';
/** File under `$DSH_HOME` holding `{ "windowsLauncher": "..." }`. */
export const CONFIG_FILE = 'dsh-restart.json';
/** Where the watcher script is written (overwritten on every restart). */
export const WATCHER_FILE = 'dsh-restart-watcher.ps1';
/** Where the wscript shim that starts the watcher is written. */
export const WATCHER_VBS_FILE = 'dsh-restart-watcher.vbs';
/** Where the watcher appends its own progress log. */
export const WATCHER_LOG_FILE = 'dsh-restart-watcher.log';
/** How long the watcher waits for the old process before giving up. */
export const WATCH_TIMEOUT_SECONDS = 120;
/**
 * How long the watcher waits for the launcher's exit code before leaving it.
 * Bounded on purpose: `Start-Process -Wait` returned only when the launcher's
 * own children finished too (measured: a launcher that spawned a 22s child
 * made the wait 22s), and the launcher's children include the new host.
 */
export const LAUNCHER_WAIT_MS = 180_000;
/**
 * How long to watch a freshly spawned shim for an immediate failure before
 * trusting it. Only spawn errors (missing wscript.exe) show up this fast.
 */
export const EARLY_ERROR_MS = 300;
const realSpawner = (command, args, options) => nodeSpawn(command, args, options);
let spawner = realSpawner;
/**
 * Replace the detached spawner (tests only).
 * @param replacement - the fake spawner, or undefined to restore the real one.
 */
export function setDetachedSpawner(replacement) {
    spawner = replacement ?? realSpawner;
}
/** Absolute path of the Windows PowerShell host, resolved from %SystemRoot%. */
export function powershellPath(env = process.env) {
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
    return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
/** Absolute path of the Windows Script Host, resolved from %SystemRoot%. */
export function wscriptPath(env = process.env) {
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
    return join(root, 'System32', 'wscript.exe');
}
/** Quote one PowerShell single-quoted literal. */
export function psLiteral(value) {
    return "'" + value.split("'").join("''") + "'";
}
/** Quote one VBScript string literal. */
export function vbsLiteral(value) {
    return '"' + value.split('"').join('""') + '"';
}
/** The program that runs a launcher of this kind, plus its argument string. */
export function launcherCommand(launcher, env = process.env) {
    const quoted = '"' + launcher + '"';
    const lower = launcher.toLowerCase();
    if (lower.endsWith('.ps1')) {
        // -WindowStyle Hidden is a PowerShell argument, not a Start-Process
        // parameter: as an argument it hides only the console, so the launcher's
        // own progress window stays visible; as a Start-Process parameter it hides
        // that window too and a three-minute cold start looks like a hang.
        return {
            file: powershellPath(env),
            argumentList: '-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File ' + quoted,
        };
    }
    if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
        const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
        return { file: join(root, 'System32', 'cmd.exe'), argumentList: '/c ' + quoted };
    }
    return { file: launcher, argumentList: '' };
}
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
export function launcherInvocation(launcher, env = process.env) {
    const { file, argumentList } = launcherCommand(launcher, env);
    const args = argumentList === '' ? '$null' : psLiteral(argumentList);
    return [
        'try {',
        '  # ErrorAction Stop: $ErrorActionPreference is SilentlyContinue, and a',
        '  # swallowed Start-Process failure would look exactly like a launch.',
        '  $LauncherProc = Start-Process -FilePath ' +
            psLiteral(file) +
            ' -ArgumentList ' +
            args +
            ' -PassThru -ErrorAction Stop',
        // Logged before waiting: whatever happens to this watcher afterwards, the
        // record already says the host was handed over instead of dying silently.
        "  Write-WatcherLog ('the launcher was started (pid ' + $LauncherProc.Id + ')')",
        // Bounded wait instead of -Wait: -Wait can sit on the launcher's own
        // children (a browser window, the new host). The exit code is worth
        // recording, a watcher that never returns is not.
        '  if ($LauncherProc.WaitForExit(' + String(LAUNCHER_WAIT_MS) + ')) {',
        "    Write-WatcherLog ('the launcher exited with code ' + $LauncherProc.ExitCode)",
        '  } else {',
        "    Write-WatcherLog ('the launcher is still running after " +
            String(LAUNCHER_WAIT_MS / 1000) +
            "s; watcher is not waiting for it')",
        '  }',
        '} catch {',
        "  Write-WatcherLog ('the launcher could not be started: ' + $_.Exception.Message)",
        '}',
    ];
}
/**
 * Build the watcher script body.
 * @param options - the pid to wait for, the launcher to run, and the log path.
 * @returns the PowerShell source written next to the flag file.
 */
export function windowsWatcherScript(options) {
    const pid = Number.isInteger(options.pid) && options.pid > 0 ? options.pid : 0;
    return [
        '# dsh-restart-systemd watcher: relaunch DSH after the old process exits.',
        "$ErrorActionPreference = 'SilentlyContinue'",
        '$OldPid = ' + String(pid),
        '$Launcher = ' + psLiteral(options.launcher),
        '$LogPath = ' + psLiteral(options.logPath),
        'function Write-WatcherLog([string]$Message) {',
        "  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')",
        // UTF-8 so a non-ASCII path is still readable when the log is opened later.
        '  Add-Content -LiteralPath $LogPath -Value ($stamp + " " + $Message) -Encoding UTF8',
        '}',
        '$WatcherStart = Get-Date',
        "Write-WatcherLog ('watching pid ' + $OldPid + '; launcher ' + $Launcher)",
        '$deadline = (Get-Date).AddSeconds(' + String(WATCH_TIMEOUT_SECONDS) + ')',
        '$warnedAccess = $false',
        'while ($true) {',
        '  $old = $null',
        '  $gone = $false',
        '  try {',
        // Only "no such process" proves the host is gone. An access-denied answer
        // proves nothing, and reading it as gone would start the launcher while the
        // host still owns the port: the launcher answers "already running", and the
        // host then exits with nobody left to relaunch it.
        '    $old = Get-Process -Id $OldPid -ErrorAction Stop',
        '  } catch {',
        "    if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { $gone = $true }",
        '    elseif (-not $warnedAccess) {',
        '      $warnedAccess = $true',
        "      Write-WatcherLog ('could not query pid ' + $OldPid + ' (' + $_.Exception.Message + '); still watching')",
        '    }',
        '  }',
        '  if ($gone) { break }',
        '  if ($old -and $old.StartTime -gt $WatcherStart) {',
        "    Write-WatcherLog 'pid was reused by a newer process; treating the old one as gone'",
        '    break',
        '  }',
        '  if ((Get-Date) -gt $deadline) {',
        "    Write-WatcherLog 'timed out waiting for the old process'; exit 1",
        '  }',
        '  Start-Sleep -Milliseconds 500',
        '}',
        'Start-Sleep -Milliseconds 800',
        "Write-WatcherLog 'old process is gone; running the launcher'",
        ...launcherInvocation(options.launcher),
        "Write-WatcherLog 'watcher finished'",
        '',
    ].join('\n');
}
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
export function windowsWatcherShim(options) {
    const command = [
        options.powershell ?? 'powershell.exe',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy Bypass',
        '-WindowStyle Hidden',
        '-File ' + '"' + options.scriptPath + '"',
    ].join(' ');
    return [
        "' dsh-restart-systemd: runs the PowerShell watcher hidden, then waits for it.",
        "' wscript.exe is used because node cannot start powershell.exe detached here.",
        'Option Explicit',
        'Dim fso, shell, logPath, cmd, code',
        'Set fso = CreateObject("Scripting.FileSystemObject")',
        'logPath = ' + vbsLiteral(options.logPath),
        'Set shell = CreateObject("WScript.Shell")',
        'AppendLog "watcher shim started; launching the PowerShell watcher"',
        'cmd = ' + vbsLiteral(command),
        'code = shell.Run(cmd, 0, True)',
        'AppendLog "powershell watcher exited with code " & code',
        'WScript.Quit code',
        '',
        'Sub AppendLog(message)',
        '  On Error Resume Next',
        '  Dim f',
        '  Set f = fso.OpenTextFile(logPath, 8, True)',
        '  f.WriteLine Now & " " & message',
        '  f.Close',
        'End Sub',
        '',
    ].join('\r\n') + '\r\n';
}
/**
 * Resolve the launcher script or executable to run after this process exits.
 * @param options - the DSH home and the process environment.
 * @returns the configured path, or undefined when nothing is configured.
 * @throws when the config file exists but cannot be read or parsed.
 */
export async function resolveLauncher(options) {
    const env = options.env ?? process.env;
    const fromEnv = env[LAUNCHER_ENV];
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '')
        return fromEnv.trim();
    const configPath = join(options.home, CONFIG_FILE);
    let raw;
    try {
        raw = await readFile(configPath, 'utf8');
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT')
            return undefined;
        throw new Error('could not read ' + configPath + ': ' + String(error));
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw new Error(configPath + ' is not valid JSON: ' + String(error));
    }
    if (parsed === null || typeof parsed !== 'object') {
        throw new Error(configPath + ' must contain a JSON object with a windowsLauncher field');
    }
    const value = parsed.windowsLauncher;
    if (typeof value !== 'string' || value.trim() === '')
        return undefined;
    return value.trim();
}
/**
 * Write the watcher script and its wscript shim, then start the shim detached
 * so it survives our exit. Throws when the shim cannot be started at all —
 * exiting into a dead host with no relaunch is the one failure worth refusing.
 * @param options - home, launcher path, the pid to wait for, and an error hook.
 * @returns the script and shim paths, the log path, and the watcher pid.
 */
export async function startWatcher(options) {
    const env = options.env ?? process.env;
    const scriptPath = join(options.home, WATCHER_FILE);
    const shimPath = join(options.home, WATCHER_VBS_FILE);
    const logPath = join(options.home, WATCHER_LOG_FILE);
    const script = windowsWatcherScript({ pid: options.pid, launcher: options.launcher, logPath });
    const shim = windowsWatcherShim({ scriptPath, logPath, powershell: powershellPath(env) });
    // PowerShell 5.1 reads a BOM-less file as ANSI and wscript reads a BOM-less
    // file the same way, so a home directory such as C:\Users\张三\.dsh would turn
    // every non-ASCII path into mojibake. A UTF-8 BOM and UTF-16LE are the two
    // encodings both hosts honour, so the files are written with them.
    await writeFile(scriptPath, '\uFEFF' + script, 'utf8');
    await writeFile(shimPath, '\uFEFF' + shim, 'utf16le');
    let earlyError;
    const child = spawner(wscriptPath(env), ['//Nologo', shimPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        cwd: options.home,
    });
    child.on('error', (error) => {
        earlyError = error;
        options.onError?.(error);
    });
    child.unref();
    // A missing or blocked wscript.exe only surfaces asynchronously. Exiting
    // before that turn would leave the host dead with nobody to relaunch it, so
    // give the spawn one short turn to fail and turn that into a refusal.
    await new Promise((resolve) => {
        const timer = setTimeout(resolve, EARLY_ERROR_MS);
        if (typeof timer === 'object' && timer !== null && 'unref' in timer)
            timer.unref();
    });
    if (earlyError !== undefined) {
        throw new Error('could not start ' + wscriptPath(env) + ': ' + earlyError.message);
    }
    return { scriptPath, shimPath, logPath, watcherPid: child.pid };
}
//# sourceMappingURL=windows.js.map