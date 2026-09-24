/**
 * Decisive verification of the `agents` injection fix — WITHOUT restarting dsh-web.
 *
 * Background: every restart recorded an empty resume snapshot
 * (`sessionIds: []`), so auto-resume never fired.
 *
 * The first hypothesis — "reading ctx.agents without declaring it throws" — was
 * tested and REFUTED in the easy case: cordis resolves an undeclared service by
 * walking the fiber's ANCESTOR chain, so a provider sitting on an ancestor is
 * reachable without any declaration. The real profile loads bundles as
 * siblings, so the topology below (provider = sibling, not ancestor) is the one
 * that mirrors production.
 *
 * This harness loads the REAL plugin into a REAL cordis context, stubs
 * `subprocess.spawn` (a restart is therefore impossible), and invokes the
 * `/restart` command callback to see what the plugin actually records.
 *
 *   node scripts/verify-agents-inject.mjs
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

// ---------------------------------------------------------------------------
console.log('\n[1/2] topology: when is `agents` reachable without declaring it?')

/** Provider on an ANCESTOR (the easy case). */
async function probeAncestor(injectList) {
  const ctx = new Context()
  ctx.provide('agents', { list: () => [] })
  let outcome
  await ctx.plugin({ inject: injectList, apply(scope) {
    try { scope.agents.list(); outcome = 'reachable' } catch (error) { outcome = `threw: ${error.message}` }
  } })
  return outcome
}

/** Provider as a SIBLING plugin — how the real profile is composed. */
async function probeSibling(injectList) {
  const ctx = new Context()
  await ctx.plugin({ inject: [], apply(scope) { scope.provide('agents', { list: () => [] }) } })
  let outcome
  await ctx.plugin({ inject: injectList, apply(scope) {
    try { scope.agents.list(); outcome = 'reachable' } catch (error) { outcome = `threw: ${error.message}` }
  } })
  return outcome
}

const ancestorUndeclared = await probeAncestor([])
check(ancestorUndeclared === 'reachable', `ancestor provider, undeclared -> reachable (${ancestorUndeclared})`)

const siblingUndeclared = await probeSibling([])
check(siblingUndeclared !== 'reachable', `SIBLING provider, undeclared -> NOT reachable (${siblingUndeclared})`)

const siblingDeclared = await probeSibling(['agents'])
check(siblingDeclared === 'reachable', `SIBLING provider, declared -> reachable (${siblingDeclared})`)

// ---------------------------------------------------------------------------
console.log('\n[2/2] the real plugin: does it record running sessions?')

const dir = mkdtempSync(join(tmpdir(), 'dsh-agents-inject-'))
// Point the plugin's state files at a throwaway home so live ~/.dsh is untouched.
process.env.DSH_HOME = dir

const LIVE_AGENTS = [
  { id: 'session-alpha', status: 'running' },
  { id: 'session-beta', status: 'idle' },
  { id: 'session-gamma', status: 'running' },
]

const captured = { spawns: [], commands: [] }
const ctx = new Context()
// Mirror production: the agent registry is provided by a sibling plugin, not
// by an ancestor of the plugin under test.
await ctx.plugin({ inject: [], apply(scope) {
  scope.provide('agents', { list: () => LIVE_AGENTS })
} })
ctx.provide('webServer', { register: () => () => undefined })
ctx.provide('subprocess', {
  spawn: (options) => {
    captured.spawns.push(options)
    return { done: Promise.resolve({ exitCode: 0, signal: null }) }
  },
})
ctx.provide('systemPrompt', { section: () => () => undefined })
ctx.provide('commands', { register: (spec) => { captured.commands.push(spec); return () => undefined } })

const plugin = await import(pathToFileURL(join(process.cwd(), 'lib/index.js')).href)
check(plugin.inject.includes('agents'), `plugin inject declares agents (${JSON.stringify([...plugin.inject])})`)

await ctx.plugin(plugin)
check(captured.commands.length === 1, `plugin registered the /restart command (${captured.commands.length})`)

// Invoke the command callback: the real agentRunner + writeResumeState path.
// `spawn` is stubbed, so no restart can occur.
const result = captured.commands[0].handler()
check(result?.kind === 'success', `/restart reported success (${JSON.stringify(result)})`)

// writeResumeState is fire-and-forget; let it land before reading.
await settle()
const snapshot = JSON.parse(readFileSync(join(dir, 'dsh-restart-resume.json'), 'utf8'))
check(
  Array.isArray(snapshot.sessionIds) && snapshot.sessionIds.length === 2,
  `snapshot records the 2 running sessions (got ${JSON.stringify(snapshot.sessionIds)})`,
)
check(snapshot.sessionIds.includes('session-alpha'), 'snapshot includes session-alpha')
check(snapshot.sessionIds.includes('session-gamma'), 'snapshot includes session-gamma')
check(!snapshot.sessionIds.includes('session-beta'), 'snapshot excludes the idle session-beta')
check(captured.spawns.length === 0, 'no spawn happened (the stub was never reached)')

rmSync(dir, { recursive: true, force: true })

console.log(`\n${checks - failed}/${checks} checks passed`)
process.exit(failed === 0 ? 0 : 1)
