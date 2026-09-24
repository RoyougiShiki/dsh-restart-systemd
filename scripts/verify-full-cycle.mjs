/**
 * Full-cycle verification of the host half — WITHOUT restarting dsh-web.
 *
 * The earlier harness only proved the WRITE side (a restart records the right
 * sessions). This one drives the entire cycle through a REAL cordis context:
 *
 *   restart writes snapshot+flag  →  plugin boots and consumes them  →
 *   arm() installs the listener   →  agent/created fires  →
 *   an interrupted session gets `Continue.`, a clean one is left alone.
 *
 * `subprocess.spawn` is stubbed, so no restart can physically happen.
 *
 *   node scripts/verify-full-cycle.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'

let failed = 0
let checks = 0
const check = (cond, label) => {
  checks++
  if (cond) console.log(`  ok   ${label}`)
  else { failed++; console.log(`  FAIL ${label}`) }
}
const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

const dir = mkdtempSync(join(tmpdir(), 'dsh-full-cycle-'))
// HOME is read at module load, so this must be set before the import below.
process.env.DSH_HOME = dir

const start = (t) => ({ type: 'turn/start', seq: t * 2, time: 0, data: { turn: t } })
const end = (t, kind) => ({ type: 'turn/end', seq: t * 2 + 1, time: 0, data: { turn: t, reason: { kind } } })

// Two live agents at "click" time: one will end up interrupted, one clean.
const RUNNING = [
  { id: 'session-interrupted', status: 'running' },
  { id: 'session-clean', status: 'running' },
]
// The logs they come back with after the restart.
const LOGS = {
  'session-interrupted': [start(1), end(1, 'completed'), start(2)], // open turn => was cut short
  'session-clean': [start(1), end(1, 'completed')],                // ended cleanly => must be left alone
}

/** Build the fake service bag the plugin declares in `inject`. */
function makeServices() {
  const captured = { spawns: [], commands: [] }
  return {
    captured,
    webServer: { register: () => () => undefined },
    subprocess: {
      spawn: (options) => {
        captured.spawns.push(options)
        return { done: Promise.resolve({ exitCode: 0, signal: null }) }
      },
    },
    systemPrompt: { section: () => () => undefined },
    commands: { register: (spec) => { captured.commands.push(spec); return () => undefined } },
    agents: { list: () => RUNNING },
  }
}

/** Load the plugin fresh (module-level HOME must already point at `dir`). */
async function loadPlugin() {
  const url = pathToFileURL(join(process.cwd(), 'lib/index.js')).href
  return import(`${url}?v=${Date.now()}`)
}

// ---------------------------------------------------------------------------
console.log('\n[1/3] the restart writes the snapshot (real plugin, stubbed spawn)')

{
  const svc = makeServices()
  const ctx = new Context()
  // Production topology: the registry is provided by a SIBLING plugin.
  await ctx.plugin({ inject: [], apply(scope) { scope.provide('agents', { list: () => RUNNING }) } })
  for (const name of ['webServer', 'subprocess', 'systemPrompt', 'commands']) ctx.provide(name, svc[name])

  const plugin = await loadPlugin()
  await ctx.plugin(plugin)
  check(svc.captured.commands.length === 1, 'plugin registered /restart')

  const result = svc.captured.commands[0].handler()
  check(result?.kind === 'success', `/restart reported success (${JSON.stringify(result)})`)
  await settle()

  const snapshot = JSON.parse(readFileSync(join(dir, 'dsh-restart-resume.json'), 'utf8'))
  check(
    snapshot.sessionIds.length === 2 && snapshot.sessionIds.includes('session-interrupted'),
    `snapshot records both running sessions (${JSON.stringify(snapshot.sessionIds)})`,
  )
  check(svc.captured.spawns.length === 0, 'spawn was never reached (no real restart possible)')
}

// ---------------------------------------------------------------------------
console.log('\n[2/3] the next boot consumes the flag and arms recovery')

{
  // Simulate the post-restart process: fresh context, same DSH_HOME. The flag
  // and snapshot written above are still on disk, exactly like a real restart.
  const svc = makeServices()
  const ctx = new Context()
  await ctx.plugin({ inject: [], apply(scope) { scope.provide('agents', { list: () => RUNNING }) } })
  for (const name of ['webServer', 'subprocess', 'systemPrompt', 'commands']) ctx.provide(name, svc[name])

  const plugin = await loadPlugin()
  await ctx.plugin(plugin)
  await settle()

  // The boot effect consumes both files.
  let flagGone = false
  let resumeGone = false
  try { readFileSync(join(dir, 'dsh-restart.flag')); } catch { flagGone = true }
  try { readFileSync(join(dir, 'dsh-restart-resume.json')); } catch { resumeGone = true }
  check(flagGone, 'boot consumed the restart flag')
  check(resumeGone, 'boot consumed the resume marker (one-shot)')

  // -------------------------------------------------------------------------
  console.log('\n[3/3] agent/created resumes ONLY the interrupted session')

  const followed = new Map()
  const makeAgent = (id) => ({
    id,
    status: 'idle',
    session: { snapshotEvents: () => LOGS[id] },
    followup: (message) => followed.set(id, message),
  })

  // Dispatch through the real cordis event bus, the way the host does.
  ctx.emit('agent/created', { agent: makeAgent('session-interrupted'), source: 'resume' })
  ctx.emit('agent/created', { agent: makeAgent('session-clean'), source: 'resume' })
  await settle()

  const resumed = followed.get('session-interrupted')
  check(resumed !== undefined, 'the interrupted session received a followup')
  check(
    resumed?.content?.[0]?.text === 'Continue.',
    `followup text is "Continue." (got ${JSON.stringify(resumed?.content?.[0]?.text)})`,
  )
  check(
    resumed?.source?.kind === 'dsh-restart-systemd',
    `followup carries the plugin's own source kind (got ${JSON.stringify(resumed?.source?.kind)})`,
  )
  check(!followed.has('session-clean'), 'the cleanly finished session was NOT poked')
}

rmSync(dir, { recursive: true, force: true })

console.log(`\n${checks - failed}/${checks} checks passed`)
process.exit(failed === 0 ? 0 : 1)
