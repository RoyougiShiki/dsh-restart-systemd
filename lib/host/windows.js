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
import { spawn as nodeSpawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
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
/**
 * Where a self relaunch sends the new host's stdout and stderr.
 *
 * A detached, hidden child has no console of its own, and the token URL the new
 * host prints at boot is the only way back into the Web UI. Overwritten on
 * every restart.
 */
export const RELAUNCH_OUT_FILE = 'dsh-restart-relaunch.log';
/** Where a self relaunch sends the new host's stderr. */
export const RELAUNCH_ERR_FILE = 'dsh-restart-relaunch.err.log';
/** How long the watcher waits for the old process before giving up. */
export const WATCH_TIMEOUT_SECONDS = 120;
/**
 * How long the watcher waits for the relaunch's exit code before leaving it.
 * Bounded on purpose: `Start-Process -Wait` returned only when the launcher's
 * own children finished too (measured: a launcher that spawned a 22s child
 * made the wait 22s), and a launcher's children include the new host.
 */
export const LAUNCHER_WAIT_MS = 180_000;
/**
 * How long a self relaunch is watched for an early death.
 *
 * The replacement is the new host and is meant to outlive the watcher, so it is
 * never waited on to completion. Start-Process also cannot report the exit code
 * of a redirected child (it comes back empty), so only "it died within a few
 * seconds" is worth logging; the why is in `$DSH_HOME/dsh-restart-relaunch.err.log`.
 */
export const RELAUNCH_GRACE_SECONDS = 5;
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
export function windowsArgument(value) {
    if (value !== '' && !/[\s"]/.test(value))
        return value;
    // Named instead of literal so this file needs no escaped backslashes.
    const backslash = String.fromCharCode(92);
    const quote = String.fromCharCode(34);
    let quoted = quote;
    let pending = 0;
    for (const character of value) {
        if (character === backslash) {
            pending += 1;
            quoted += character;
            continue;
        }
        if (character === quote) {
            quoted += backslash.repeat(pending + 1) + quote;
            pending = 0;
            continue;
        }
        pending = 0;
        quoted += character;
    }
    return quoted + backslash.repeat(pending) + quote;
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
/** A relaunch through the configured launcher script. */
export function launcherRelaunch(launcher, env = process.env) {
    const { file, argumentList } = launcherCommand(launcher, env);
    return { source: 'launcher', file, argumentList };
}
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
export function selfRelaunch(options) {
    // argv[0] is the executable doing the replay; argv[1] is the script to run.
    const rest = options.argv.slice(1);
    return {
        source: 'self',
        file: options.execPath,
        argumentList: rest.map(windowsArgument).join(' '),
        workingDirectory: options.cwd,
        stdoutPath: join(options.home, RELAUNCH_OUT_FILE),
        stderrPath: join(options.home, RELAUNCH_ERR_FILE),
    };
}
/** Whether a path exists; a permission error counts as "exists, untested". */
async function fileExists(path) {
    try {
        await access(path);
        return true;
    }
    catch (error) {
        return error.code !== 'ENOENT';
    }
}
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
export function relaunchInvocation(relaunch) {
    const args = relaunch.argumentList === '' ? '$null' : psLiteral(relaunch.argumentList);
    const extras = [];
    if (relaunch.workingDirectory !== undefined) {
        extras.push(' -WorkingDirectory ' + psLiteral(relaunch.workingDirectory));
    }
    if (relaunch.stdoutPath !== undefined) {
        extras.push(' -RedirectStandardOutput ' + psLiteral(relaunch.stdoutPath));
    }
    if (relaunch.stderrPath !== undefined) {
        extras.push(' -RedirectStandardError ' + psLiteral(relaunch.stderrPath));
    }
    // The two sources are watched differently on purpose. A launcher is expected
    // to exit, so its code is worth recording. The self relaunch *is* the new
    // host: it is meant to outlive the watcher, and Start-Process cannot report an
    // exit code for a redirected child anyway (it comes back empty), so only a
    // quick death is worth reporting there.
    const watch = relaunch.source === 'self'
        ? [
            '  Start-Sleep -Seconds ' + String(RELAUNCH_GRACE_SECONDS),
            '  if ($RelaunchProc.HasExited) {',
            "    Write-WatcherLog ('the replacement exited within " +
                String(RELAUNCH_GRACE_SECONDS) +
                "s; its output is in ' + " +
                psLiteral(relaunch.stderrPath ?? '') +
                ')',
            '  } else {',
            "    Write-WatcherLog ('the replacement is running (pid ' + $RelaunchProc.Id + ')')",
            '  }',
        ]
        : [
            '  if ($RelaunchProc.WaitForExit(' + String(LAUNCHER_WAIT_MS) + ')) {',
            "    Write-WatcherLog ('the relaunch exited with code ' + $RelaunchProc.ExitCode)",
            '  } else {',
            "    Write-WatcherLog ('the relaunch is still running after " +
                String(LAUNCHER_WAIT_MS / 1000) +
                "s; watcher is not waiting for it')",
            '  }',
        ];
    return [
        'try {',
        '  # ErrorAction Stop: $ErrorActionPreference is SilentlyContinue, and a',
        '  # swallowed Start-Process failure would look exactly like a launch.',
        '  $RelaunchProc = Start-Process -FilePath ' +
            psLiteral(relaunch.file) +
            ' -ArgumentList ' +
            args +
            extras.join('') +
            ' -PassThru -ErrorAction Stop',
        // Logged before waiting: whatever happens to this watcher afterwards, the
        // record already says the host was handed over instead of dying silently.
        "  Write-WatcherLog ('the relaunch was started (pid ' + $RelaunchProc.Id + ')')",
        ...watch,
        '} catch {',
        "  Write-WatcherLog ('the relaunch could not be started: ' + $_.Exception.Message)",
        '}',
    ];
}
/**
 * Build the watcher script body.
 * @param options - the pid to wait for, the relaunch plan, and the log path.
 * @returns the PowerShell source written next to the flag file.
 */
export function windowsWatcherScript(options) {
    const pid = Number.isInteger(options.pid) && options.pid > 0 ? options.pid : 0;
    return [
        '# dsh-restart-systemd watcher: relaunch DSH after the old process exits.',
        "$ErrorActionPreference = 'SilentlyContinue'",
        '$OldPid = ' + String(pid),
        '$RelaunchSource = ' + psLiteral(options.relaunch.source),
        '$RelaunchFile = ' + psLiteral(options.relaunch.file),
        '$LogPath = ' + psLiteral(options.logPath),
        'function Write-WatcherLog([string]$Message) {',
        "  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')",
        // UTF-8 so a non-ASCII path is still readable when the log is opened later.
        '  Add-Content -LiteralPath $LogPath -Value ($stamp + " " + $Message) -Encoding UTF8',
        '}',
        '$WatcherStart = Get-Date',
        "Write-WatcherLog ('watching pid ' + $OldPid + '; relaunch ' + $RelaunchSource + ' via ' + $RelaunchFile)",
        '$deadline = (Get-Date).AddSeconds(' + String(WATCH_TIMEOUT_SECONDS) + ')',
        '$warnedAccess = $false',
        'while ($true) {',
        '  $old = $null',
        '  $gone = $false',
        '  try {',
        // Only "no such process" proves the host is gone. An access-denied answer
        // proves nothing, and reading it as gone would start the replacement while
        // the host still owns the port: the new one fails on EADDRINUSE, and the
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
        "Write-WatcherLog 'old process is gone; starting the replacement'",
        ...relaunchInvocation(options.relaunch),
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
 * Resolve the launcher script or executable configured for this machine.
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
export async function resolveRelaunch(options) {
    const env = options.env ?? process.env;
    const launcher = await resolveLauncher({ home: options.home, env });
    if (launcher !== undefined) {
        if (await fileExists(launcher))
            return launcherRelaunch(launcher, env);
        options.onMissingLauncher?.(launcher);
    }
    return selfRelaunch({
        execPath: options.execPath ?? process.execPath,
        argv: options.argv ?? process.argv,
        cwd: options.cwd ?? process.cwd(),
        home: options.home,
    });
}
/**
 * Write the watcher script and its wscript shim, then start the shim detached
 * so it survives our exit. Throws when the shim cannot be started at all —
 * exiting into a dead host with no relaunch is the one failure worth refusing.
 * @param options - home, the relaunch plan, the pid to wait for, and an error hook.
 * @returns the script and shim paths, the log path, and the watcher pid.
 */
export async function startWatcher(options) {
    const env = options.env ?? process.env;
    const scriptPath = join(options.home, WATCHER_FILE);
    const shimPath = join(options.home, WATCHER_VBS_FILE);
    const logPath = join(options.home, WATCHER_LOG_FILE);
    const script = windowsWatcherScript({ pid: options.pid, relaunch: options.relaunch, logPath });
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