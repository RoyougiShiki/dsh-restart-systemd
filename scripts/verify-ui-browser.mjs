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
 * service and never talks to 3081 or a profile.
 *
 * What it covers: the two intents (restart now ignores running sessions;
 * restart when idle queues them), the queued card's mark/dismiss/restore/cancel
 * path, re-reading a queued restart after a reload, the queue clearing when the
 * host reports it gone, every mapped error bubble, the dropped-request and
 * 10s-timeout unknowns, double activation, and both sidebar widths.
 */
import { spawn } from 'node:child_process'

const HELP = `Usage: node scripts/verify-ui-browser.mjs --url <fixture-url> [options]

Required:
  --url <url>              Fixture root, for example http://<fixture-host>:<port>

Options:
  --task-space <name>      Isolated ego TaskSpace name (default: dsh-restart-ui-check)
  --ego <command>          ego-browser executable (default: EGO_BROWSER or ego-browser)
  --timeout <ms>           Overall browser timeout (default: 180000)
  --dry-run                Print the generated ego script and exit
  --help                   Show this help

This script is intentionally not part of npm test. It needs the external
ego-browser CLI and a running ui-fixture server; see the README.`

function parseArgs(argv) {
  const options = { taskSpace: 'dsh-restart-ui-check', ego: process.env.EGO_BROWSER || 'ego-browser', timeoutMs: 180_000, dryRun: false }
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
  return `
const task = await taskSpace(${JSON.stringify(taskSpace)})
const page = task.page("p1")
const BASE = ${JSON.stringify(base)}
const results = []
let outcome
try {

function check(name, condition, detail) {
  if (!condition) throw new Error("CHECK FAILED: " + name + (detail ? " :: " + JSON.stringify(detail) : ""))
  results.push({ name, detail: detail ?? true })
}

async function setMode(mode, extra = "") {
  await page.fetch(BASE + "/__mode?mode=" + encodeURIComponent(mode) + "&reset=1" + extra)
}

async function seedQueued(waiting) {
  await page.fetch(BASE + "/__mode?reset=1&queued=1&waiting=" + String(waiting))
}

async function sessions(waiting, clear) {
  await page.fetch(BASE + "/__sessions?waiting=" + String(waiting) + (clear ? "&clear=1" : ""))
}

async function state() {
  const response = await page.fetch(BASE + "/__state")
  return JSON.parse(response.body)
}

async function bodyText() {
  return await page.evaluate(() => document.body.innerText)
}

async function dialogCount() {
  return await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length)
}

async function statusCount() {
  return await page.evaluate(() => document.querySelectorAll('[role="status"]').length)
}

async function statusText() {
  return await page.evaluate(() => document.querySelector('[role="status"]')?.innerText ?? null)
}

async function bubbleText() {
  return await page.evaluate(() => document.querySelector('[role="alert"]')?.innerText ?? null)
}

async function bubbleBox() {
  return await page.evaluate(() => {
    const el = document.querySelector('[role="alert"]')
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { width: Math.round(rect.width), height: Math.round(rect.height), parent: el.parentElement?.tagName ?? null }
  })
}

async function triggerMarked() {
  return await page.evaluate(() => document.querySelector(".dsh-restart-trigger")?.hasAttribute("data-dsh-restart-queued") === true)
}

async function triggerDisabled() {
  return await page.evaluate(() => document.querySelector(".dsh-restart-trigger")?.disabled === true)
}

async function openConfirm() {
  await page.click(".dsh-restart-trigger")
  await page.waitForSelector('[data-dsh-restart-action="cancel"]', { state: "visible", timeout: 5000 })
}

async function cancelConfirm() {
  await page.click('[data-dsh-restart-action="cancel"]')
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 5000 })
}

async function confirmMode(action) {
  await page.click('[data-dsh-restart-action="' + action + '"]')
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 5000 })
}

async function dismissCard(role) {
  await page.click('[role="' + role + '"] [data-dsh-restart-action="dismiss"]')
  await page.waitForSelector('[role="' + role + '"]', { state: "detached", timeout: 5000 })
}

async function waitForRequests(total, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const snapshot = await state()
    if (snapshot.count >= total) return snapshot
    await page.waitForTimeout(100)
  }
  return await state()
}

async function waitForStatusGone(timeout = 12000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if ((await statusCount()) === 0) return true
    await page.waitForTimeout(200)
  }
  return (await statusCount()) === 0
}

await page.goto(BASE + "/?wide=1&lang=zh", { timeout: 30000 })
await page.waitForSelector(".dsh-restart-trigger", { state: "visible", timeout: 15000 })
const label = await page.evaluate(() => document.querySelector(".dsh-restart-trigger")?.getAttribute("aria-label"))
check("wide trigger is rendered", !!label, label)
check("wide trigger has the Chinese label", label === "重启 DeepSeek Harness", label)
check("a fresh page shows no queued mark", (await triggerMarked()) === false)

await setMode("auto", "&waiting=2")
await openConfirm()
const confirmText = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "")
check("confirm body explains the interrupting mode", confirmText.includes("立即重启"), confirmText)
check("confirm body explains the waiting mode", confirmText.includes("等会话结束"), confirmText)
check("confirm body still warns about no auto-resume", confirmText.includes("不会自动续接"), confirmText)
const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('[data-dsh-restart-action]')).map((el) => el.getAttribute("data-dsh-restart-action")))
check("dialog offers cancel, restart-now and restart-when-idle", buttons.join(",") === "cancel,proceed,proceedIdle", buttons)
await cancelConfirm()
check("cancel sends zero requests", (await state()).count === 0, await state())

// restart-now must ignore running sessions: waiting=2 and still immediate.
await setMode("auto", "&waiting=2")
await openConfirm()
await confirmMode("proceed")
let current = await waitForRequests(1)
check("restart-now sends exactly one request", current.count === 1, current)
check("restart-now sends mode=now", current.lastMode === "now", current)
check("restart-now reason is webui-button", current.lastReason === "webui-button", current)
check("restart-now queues nothing even with sessions running", current.queued === null, current)
check("202 paints no dialog", (await dialogCount()) === 0)
check("202 paints no queued card", (await statusCount()) === 0)
check("202 paints no bubble", (await bubbleText()) === null)
check("202 leaves the trigger idle", (await triggerDisabled()) === false)
await page.waitForTimeout(1600)
check("no waiting surface appears after 202", (await dialogCount()) === 0 && (await statusCount()) === 0 && (await bubbleText()) === null)
const afterAcceptedText = await bodyText()
check("no accepted copy is ever painted", !afterAcceptedText.includes("重启请求已接受") && !afterAcceptedText.includes("约 3 秒") && !afterAcceptedText.includes("正在提交重启请求"), afterAcceptedText)

await setMode("auto", "&waiting=2")
await openConfirm()
await page.evaluate(() => {
  const proceed = document.querySelector('[data-dsh-restart-action="proceed"]')
  proceed.click()
  proceed.click()
})
await waitForRequests(1)
await page.waitForTimeout(600)
const afterDouble = await state()
check("double activation sends only one request", afterDouble.count === 1, afterDouble)
check("double activation paints no surface", (await dialogCount()) === 0 && (await statusCount()) === 0 && (await bubbleText()) === null)

// restart-when-idle with sessions running must queue, not restart.
await setMode("auto", "&waiting=2")
await openConfirm()
await confirmMode("proceedIdle")
await page.waitForSelector('[role="status"]', { state: "visible", timeout: 8000 })
current = await waitForRequests(1)
check("restart-when-idle sends mode=when-idle", current.lastMode === "when-idle", current)
check("restart-when-idle queues instead of firing", current.queued !== null && current.queued.waitingForSessions === 2, current.queued)
const queuedText = await statusText()
check("queued card announces the scheduled restart", queuedText.includes("已安排重启"), queuedText)
check("queued card promises the automatic restart", queuedText.includes("所有会话跑完后会自动重启"), queuedText)
check("queued card offers a cancel action", await page.evaluate(() => !!document.querySelector('[data-dsh-restart-action="cancelQueued"]')))
check("queued card is a status region, not an alert", (await statusCount()) === 1 && (await bubbleText()) === null)
check("queued card replaces the dialog", (await dialogCount()) === 0)
check("queued restart marks the trigger", (await triggerMarked()) === true)
check("queued restart does not disable the trigger", (await triggerDisabled()) === false)

await dismissCard("status")
check("dismissing the card leaves the trigger marked", (await triggerMarked()) === true)
await page.click(".dsh-restart-trigger")
await page.waitForSelector('[role="status"]', { state: "visible", timeout: 5000 })
check("re-clicking the trigger restores the card without a dialog", (await dialogCount()) === 0 && (await statusCount()) === 1)
check("restoring the card sends no extra request", (await state()).count === 1, await state())

// The cancel action must reach the host, not just hide the card.
const deletesBefore = (await state()).deletes
await page.click('[data-dsh-restart-action="cancelQueued"]')
await page.waitForSelector('[role="status"]', { state: "detached", timeout: 8000 })
const afterCancel = await state()
check("cancel sends one DELETE", afterCancel.deletes === deletesBefore + 1, afterCancel)
check("cancel clears the host queue", afterCancel.queued === null, afterCancel)
check("cancel unmarks the trigger", (await triggerMarked()) === false)
check("cancel leaves the trigger usable", (await triggerDisabled()) === false)
await openConfirm()
await cancelConfirm()
check("the dialog reopens after cancelling the queued restart", (await state()).count === 1, await state())

// An idle host must not queue: restart-when-idle with no sessions fires now.
await setMode("auto", "&waiting=0")
await openConfirm()
await confirmMode("proceedIdle")
current = await waitForRequests(1)
check("when-idle on an idle host sends one request", current.count === 1, current)
check("when-idle on an idle host fires immediately", current.queued === null, current)
check("when-idle on an idle host paints no card", (await statusCount()) === 0 && (await dialogCount()) === 0)

// A queued restart lives on the host, so a reloaded page must show it again.
await seedQueued(3)
await page.goto(BASE + "/?wide=1&lang=zh", { timeout: 30000 })
await page.waitForSelector('[role="status"]', { state: "visible", timeout: 10000 })
check("a reloaded page re-reads the queued restart", (await statusCount()) === 1)
check("reload paints the queued card without a new request", (await state()).count === 0, await state())
check("reload marks the trigger", (await triggerMarked()) === true)

// The queued card polls the host; when the last session ends the queue clears.
await sessions(0, true)
check("the queued card clears once the host queue is gone", await waitForStatusGone(12000), await state())
check("a cleared queue unmarks the trigger", (await triggerMarked()) === false)

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
  await confirmMode("proceed")
  await page.waitForSelector('[role="alert"]', { state: "visible", timeout: 8000 })
  const text = await bubbleText()
  check(item.mode + " shows its mapped copy", text.includes(item.expected), text)
  check(item.mode + " reports through a bubble, not a modal", (await dialogCount()) === 0)
  check(item.mode + " paints no queued card", (await statusCount()) === 0)
  const box = await bubbleBox()
  check(item.mode + " bubble is small and anchored", box !== null && box.width <= 400 && box.height <= 200 && box.parent === "BODY", box)
  check(item.mode + " sends exactly one request", (await state()).count === 1, await state())
  await dismissCard("alert")
  check(item.mode + " dismiss releases the trigger", (await triggerDisabled()) === false)
  check(item.mode + " dismiss leaves no queued mark", (await triggerMarked()) === false)
}

await setMode("close")
await openConfirm()
await confirmMode("proceed")
await page.waitForSelector('[role="alert"]', { state: "visible", timeout: 8000 })
let text = await bubbleText()
check("dropped request reports unknown", text.includes("无法确认重启请求是否被接受，请查看 DSH 连接状态；不要连续重试。"), text)
current = await state()
check("dropped request still reached the HTTP fixture", current.count >= 1, current)
await dismissCard("alert")
await openConfirm()
check("unknown terminal state can be reopened", await page.evaluate(() => !!document.querySelector('[data-dsh-restart-action="cancel"]')), true)
await cancelConfirm()
check("reopening after unknown sends no extra request", (await state()).count === current.count, await state())

await setMode("hang")
await openConfirm()
await confirmMode("proceed")
await page.waitForTimeout(300)
const during = await page.evaluate(() => ({
  disabled: document.querySelector(".dsh-restart-trigger")?.disabled,
  dialogs: document.querySelectorAll('[role="dialog"]').length,
  bubbles: document.querySelectorAll('[role="alert"]').length,
}))
check("requesting disables the trigger", during.disabled === true, during)
check("requesting paints no waiting dialog", during.dialogs === 0 && during.bubbles === 0, during)
const hangStart = Date.now()
await page.waitForSelector('[role="alert"]', { state: "visible", timeout: 15000 })
const elapsed = Date.now() - hangStart
text = await bubbleText()
check("timeout reports unknown", text.includes("无法确认重启请求是否被接受"), text)
check("timeout waited about 10s", elapsed >= 9500, elapsed)
check("timeout did not duplicate the request", (await state()).count === 1, await state())
await dismissCard("alert")

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
