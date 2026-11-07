#!/usr/bin/env node
/**
 * Standalone rerunnable UI verification for the restart button.
 *
 * This runner generates a browser script and feeds it to the ego-browser
 * `nodejs` command over stdin. It does not hard-code a browser path, a WSL
 * address, or a port. Pass the fixture URL and an isolated TaskSpace name:
 *
 *   node scripts/verify-ui-browser.mjs \
 *     --url http://<fixture-host>:<port> \
 *     --task-space dsh-restart-ui-check
 *
 * Optional:
 *   --ego <ego-browser-executable>   (default: EGO_BROWSER or ego-browser)
 *   --dry-run                        print the generated ego script only
 *
 * The fixture itself is started separately with `npm run fixture`. The
 * fixture binds 0.0.0.0 only so a browser on another host (for example the
 * Windows ego-browser) can reach a WSL-hosted fixture; it is not the DSH
 * service and never talks to 3080 or a profile.
 */
import { spawn } from 'node:child_process'

const HELP = `Usage: node scripts/verify-ui-browser.mjs --url <fixture-url> [options]

Required:
  --url <url>              Fixture root, for example http://<fixture-host>:<port>

Options:
  --task-space <name>      Isolated ego TaskSpace name (default: dsh-restart-ui-check)
  --ego <command>          ego-browser executable (default: EGO_BROWSER or ego-browser)
  --timeout <ms>           Overall browser timeout (default: 90000)
  --dry-run                Print the generated ego script and exit
  --help                   Show this help

This script is intentionally not part of npm test. It needs the external
ego-browser CLI and a running ui-fixture server; see the README.`

function parseArgs(argv) {
  const options = { taskSpace: 'dsh-restart-ui-check', ego: process.env.EGO_BROWSER || 'ego-browser', timeoutMs: 90_000, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--url') options.url = argv[++index]
    else if (arg === '--task-space') options.taskSpace = argv[++index]
    else if (arg === '--ego') options.ego = argv[++index]
    else if (arg === '--timeout') options.timeoutMs = Number(argv[++index])
    else throw new Error('unknown argument: ' + arg)
  }
  if (options.help) return options
  if (!options.url) throw new Error('--url is required')
  if (!options.taskSpace) throw new Error('--task-space must not be empty')
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('--timeout must be a positive number')
  return options
}

function buildScript(url, taskSpace) {
  const base = String(url).replace(/\/+$/, '')
  return `const task = await taskSpace(${JSON.stringify(taskSpace)})
const page = task.page("p1")
const BASE = ${JSON.stringify(base)}
const results = []
let outcome
try {

function check(name, condition, detail) {
  if (!condition) throw new Error("CHECK FAILED: " + name + (detail ? " :: " + JSON.stringify(detail) : ""))
  results.push({ name, detail: detail ?? true })
}

async function setMode(mode, reset = true) {
  await page.fetch(BASE + "/__mode?mode=" + mode + (reset ? "&reset=1" : ""))
}

async function state() {
  const response = await page.fetch(BASE + "/__state")
  return JSON.parse(response.body)
}

async function bodyText() {
  return await page.evaluate(() => document.body.innerText)
}

async function dialogText() {
  return await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? null)
}

async function openConfirm() {
  await page.click(".dsh-restart-trigger")
  await page.waitForSelector('[data-dsh-restart-action="cancel"]', { state: "visible", timeout: 5000 })
}

async function closeDialog() {
  await page.click('[data-dsh-restart-action="close"], [data-dsh-restart-action="cancel"]')
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 5000 })
}

async function confirmRestart() {
  await page.click('[data-dsh-restart-action="proceed"]')
}

await page.goto(BASE + "/?wide=1&lang=zh", { timeout: 30000 })
await page.waitForSelector(".dsh-restart-trigger", { state: "visible", timeout: 15000 })
const label = await page.evaluate(() => document.querySelector(".dsh-restart-trigger")?.getAttribute("aria-label"))
check("wide trigger is rendered", !!label, label)
check("wide trigger has the Chinese label", label === "重启 DeepSeek Harness", label)

await setMode("202")
await openConfirm()
check("confirm dialog explains no auto-resume", (await bodyText()).includes("重启将中断进行中的任务，不会自动续接。建议任务完成后操作。"), await bodyText())
await closeDialog()
check("cancel sends zero requests", (await state()).count === 0, await state())

await setMode("202")
await openConfirm()
await confirmRestart()
await page.waitForFunction(() => document.body.innerText.includes("重启请求已接受"), undefined, { timeout: 5000 })
let current = await state()
check("one confirm sends exactly one request", current.count === 1, current)
check("request reason is webui-button", current.lastReason === "webui-button", current)
check("accepted copy is present", (await bodyText()).includes("重启请求已接受，后续连接状态由 DSH 显示"), await dialogText())
await page.waitForTimeout(1200)
check("202 does not wait for recovery or dismiss itself", (await bodyText()).includes("重启请求已接受"), await bodyText())
await closeDialog()
check("accepted terminal state can be closed", (await state()).count === 1, await state())

await setMode("202")
await openConfirm()
await page.evaluate(() => {
  const proceed = document.querySelector('[data-dsh-restart-action="proceed"]')
  proceed.click()
  proceed.click()
})
await page.waitForFunction(() => document.body.innerText.includes("重启请求已接受"), undefined, { timeout: 5000 })
check("double activation sends only one request", (await state()).count === 1, await state())
await closeDialog()

const errorCases = [
  { mode: "409", expected: "已有重启请求在处理。" },
  { mode: "429", expected: "服务刚刚重启，请稍候再试。" },
  { mode: "403", expected: "重启仅限本机访问（loopback）。" },
  { mode: "501", expected: "当前平台不支持重启。" },
  { mode: "500", expected: "重启请求失败 (HTTP 500)" },
]
for (const item of errorCases) {
  await setMode(item.mode)
  await openConfirm()
  await confirmRestart()
  await page.waitForSelector('[data-dsh-restart-action="close"]', { state: "visible", timeout: 5000 })
  const text = await dialogText()
  check(item.mode + " shows its mapped copy", text.includes(item.expected), text)
  check(item.mode + " sends exactly one request", (await state()).count === 1, await state())
  await closeDialog()
}

await setMode("close")
await openConfirm()
await confirmRestart()
await page.waitForSelector('[data-dsh-restart-action="close"]', { state: "visible", timeout: 5000 })
let text = await dialogText()
check("dropped request reports unknown", text.includes("无法确认重启请求是否被接受，请查看 DSH 连接状态；不要连续重试。"), text)
current = await state()
check("dropped request still reached the HTTP fixture", current.count >= 1, current)
await closeDialog()
await openConfirm()
check("unknown terminal state can be reopened", await page.evaluate(() => !!document.querySelector('[data-dsh-restart-action="cancel"]')), true)
await closeDialog()
check("reopening after unknown sends no extra request", (await state()).count === current.count, await state())

await setMode("hang")
await openConfirm()
await confirmRestart()
await page.waitForTimeout(300)
const during = await page.evaluate(() => ({
  disabled: document.querySelector(".dsh-restart-trigger")?.disabled,
  proceed: !!document.querySelector('[data-dsh-restart-action="proceed"]'),
  cancel: !!document.querySelector('[data-dsh-restart-action="cancel"]'),
}))
check("requesting disables the trigger", during.disabled === true, during)
check("requesting removes proceed/cancel actions", during.proceed === false && during.cancel === false, during)
const hangStart = Date.now()
await page.waitForSelector('[data-dsh-restart-action="close"]', { state: "visible", timeout: 15000 })
const elapsed = Date.now() - hangStart
text = await dialogText()
check("timeout reports unknown", text.includes("无法确认重启请求是否被接受"), text)
check("timeout waited about 10s", elapsed >= 9500, elapsed)
check("timeout did not duplicate the request", (await state()).count === 1, await state())
await closeDialog()

await page.goto(BASE + "/?wide=0&lang=zh", { timeout: 30000 })
await page.waitForSelector(".dsh-restart-trigger", { state: "visible", timeout: 15000 })
await page.waitForTimeout(300)
const rail = await page.evaluate(() => ({
  htmlClass: document.documentElement.className,
  stageClass: document.getElementById("stage")?.className,
  label: document.querySelector(".dsh-restart-trigger")?.getAttribute("aria-label"),
}))
check("rail mode adds the html hook", rail.htmlClass.includes("dsh-restart-rail"), rail)
check("rail stage uses the rail class", rail.stageClass === "rail", rail)
check("rail trigger is rendered", rail.label === "重启 DeepSeek Harness", rail)

  outcome = { spaceId: task.spaceId, results, finalState: await state() }
} finally {
  try {
    await task.finish({ keep: [] })
    if (outcome !== undefined) outcome.finished = true
  } catch (error) {
    if (outcome === undefined) {
      console.error("task.finish failed: " + String(error))
    } else {
      outcome.finished = false
      outcome.finishError = String(error)
    }
  }
}

if (outcome !== undefined) console.log("RESULT_JSON " + JSON.stringify(outcome))
`
}

function runEgo(command, script, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, ['nodejs'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...result, stdout, stderr })
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({ code: null, timedOut: true })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => finish({ code: null, error }))
    child.once('close', (code, signal) => finish({ code, signal }))
    child.stdin.on('error', () => { /* the CLI may exit before consuming stdin */ })
    child.stdin.end(script)
  })
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(String(error.message || error))
    console.error(HELP)
    process.exitCode = 2
    return
  }
  if (options.help) {
    console.log(HELP)
    return
  }

  const script = buildScript(options.url, options.taskSpace)
  if (options.dryRun) {
    console.log(script)
    return
  }

  const result = await runEgo(options.ego, script, options.timeoutMs)
  if (result.error) {
    console.error('Could not start ego-browser (' + options.ego + '): ' + result.error.message)
    console.error('Install ego-browser or pass --ego <command>; this path is not hard-coded.')
    process.exitCode = 1
    return
  }
  if (result.timedOut) {
    console.error('ego-browser timed out after ' + options.timeoutMs + 'ms')
    process.exitCode = 1
    return
  }
  const marker = 'RESULT_JSON '
  const combined = result.stdout + '\n' + result.stderr
  const index = combined.lastIndexOf(marker)
  if (result.code !== 0 || index < 0) {
    console.error('Browser verification failed (exit=' + result.code + ').')
    if (result.stderr.trim()) console.error(result.stderr.trim())
    if (result.stdout.trim()) console.error(result.stdout.trim())
    process.exitCode = 1
    return
  }
  const payloadText = combined.slice(index + marker.length).split('\n')[0]
  let payload
  try {
    payload = JSON.parse(payloadText)
  } catch (error) {
    console.error('Could not parse browser result: ' + String(error))
    console.error(payloadText)
    process.exitCode = 1
    return
  }
  console.log(JSON.stringify({
    spaceId: payload.spaceId,
    checks: payload.results.length,
    results: payload.results,
    finalState: payload.finalState,
    finished: payload.finished,
    finishError: payload.finishError,
  }, null, 2))
  if (payload.finished !== true) {
    console.error('TaskSpace did not finish cleanly: ' + String(payload.finishError ?? 'unknown'))
    process.exitCode = 1
  } else {
    process.exitCode = 0
  }
}

await main()
