/**
 * Host-half verification for dsh-restart-systemd.
 *
 * The client half is covered by verify-client.mjs; this covers the host
 * decision that the DSH 0.1.7-rc.1 upgrade silently broke. `lastTurnInterrupted`
 * reads the restored session log to decide whether an agent may be
 * auto-continued, and its failure mode is dangerous in BOTH directions:
 *
 *  - too eager → a cleanly finished session gets poked with a spurious turn;
 *  - too shy   → an interrupted turn is never resumed (the feature silently dies).
 *
 * The pre-upgrade code read `agent.session.events`, which no longer exists; the
 * resulting TypeError was swallowed by the surrounding try/catch, so the method
 * returned `true` unconditionally. These cases pin the real per-reason behaviour
 * so that regression cannot come back unnoticed.
 *
 * Run with `npm test` (which builds first).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Recovery, CONTINUE_TEXT, RECOVERY_TIMEOUT_MS } from '../lib/host/recover.js'

let failed = 0
let checks = 0
/** @param condition - assertion outcome. @param label - what is being asserted. */
function check(condition, label) {
  checks++
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failed++
  console.log(`  FAIL ${label}`)
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-restart-verify-'))
const resumePath = join(dir, 'dsh-restart-resume.json')

/** A minimal ctx: logger sink + a no-op event bus. */
function makeCtx() {
  const logs = []
  return {
    logs,
    logger: {
      info: (m) => logs.push(m),
      warn: (m) => logs.push(m),
      error: (m) => logs.push(m),
    },
    on: () => () => undefined,
  }
}

/**
 * Build a Recovery whose `agent/created` listener we capture and drive by hand.
 * @param events - the session log the fake agent should expose, or 'throw'.
 * @param statePath - resume-snapshot file this instance should load.
 */
function makeRecovery(events, statePath = resumePath) {
  const ctx = makeCtx()
  const followed = []
  let listener
  const capturing = {
    ...ctx,
    on: (_event, fn) => {
      listener = fn
      return () => undefined
    },
  }
  const recovery = new Recovery(capturing, statePath)
  const agent = {
    id: 'session-under-test',
    session: {
      snapshotEvents() {
        if (events === 'throw') throw new Error('log unavailable')
        return events
      },
    },
    followup: (message) => followed.push(message),
  }
  return {
    recovery,
    ctx,
    agent,
    followed,
    /** The listener arm() installed, once arm() has run. */
    get listener() {
      return listener
    },
  }
}

/** Let arm()'s asynchronous resume-file read settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

const start = (turn) => ({ type: 'turn/start', seq: turn * 2, time: 0, data: { turn } })
const end = (turn, kind) => ({ type: 'turn/end', seq: turn * 2 + 1, time: 0, data: { turn, reason: { kind } } })

// ---------------------------------------------------------------------------
console.log('\n[1/2] lastTurnInterrupted reads the restored log correctly')

const cases = [
  ['open turn (crash mid-flight)', [start(1), end(1, 'completed'), start(2)], true],
  ['last turn closed as interrupted', [start(1), end(1, 'interrupted')], true],
  ['last turn completed cleanly', [start(1), end(1, 'completed')], false],
  ['last turn aborted by the user', [start(1), end(1, 'aborted')], false],
  ['last turn blocked', [start(1), end(1, 'blocked')], false],
  ['last turn errored', [start(1), end(1, 'error')], false],
  ['last turn hit max-tokens', [start(1), end(1, 'max-tokens')], false],
  ['empty log', [], false],
  ['unreadable log => safe default is to resume', 'throw', true],
]
for (const [label, events, expected] of cases) {
  const { recovery, agent } = makeRecovery(events)
  // The method is private to TypeScript only; at runtime it is a normal member.
  const got = recovery.lastTurnInterrupted(agent)
  check(got === expected, `${label} -> ${String(got)}`)
}

// ---------------------------------------------------------------------------
console.log('\n[2/2] end-to-end arm(): only interrupted sessions get a followup')

const interruptLog = [start(1), end(1, 'completed'), start(2)]
const cleanLog = [start(1), end(1, 'completed')]
writeFileSync(resumePath, JSON.stringify({ ts: Date.now(), reason: 'webui-button', sessionIds: ['session-under-test'] }), 'utf8')

const interrupted = makeRecovery(interruptLog)
interrupted.recovery.arm()
// arm() loads the resume snapshot asynchronously; the listener is installed
// synchronously but `pending` is empty until that read lands.
await settle()
check(typeof interrupted.listener === 'function', 'arm() installs an agent/created listener')

interrupted.listener({ agent: interrupted.agent })
check(interrupted.followed.length === 1, `interrupted agent got exactly one followup (got ${interrupted.followed.length})`)
const message = interrupted.followed[0]
check(message?.content?.[0]?.text === CONTINUE_TEXT, `followup text is ${JSON.stringify(CONTINUE_TEXT)}`)
check(
  message?.source?.kind === 'dsh-restart-systemd',
  `followup carries the plugin's own source kind (got ${JSON.stringify(message?.source?.kind)})`,
)
check(
  !('plugin' in (message?.source ?? {})),
  'followup no longer uses the removed shared `plugin` kind',
)

// A clean session listed in the snapshot must never be poked.
const cleanPath = join(dir, 'clean.json')
writeFileSync(cleanPath, JSON.stringify({ ts: Date.now(), sessionIds: ['session-under-test'] }), 'utf8')
const clean = makeRecovery(cleanLog, cleanPath)
clean.recovery.arm()
await settle()
clean.listener({ agent: clean.agent })
check(clean.followed.length === 0, 'cleanly finished session is never auto-continued')

// An id absent from the snapshot is never touched either.
const unlistedPath = join(dir, 'unlisted.json')
writeFileSync(unlistedPath, JSON.stringify({ ts: Date.now(), sessionIds: ['some-other-session'] }), 'utf8')
const unlisted = makeRecovery(interruptLog, unlistedPath)
unlisted.recovery.arm()
await settle()
unlisted.listener({ agent: unlisted.agent })
check(unlisted.followed.length === 0, 'session absent from the snapshot is never auto-continued')

check(RECOVERY_TIMEOUT_MS > 0, `recovery window is a positive duration (${RECOVERY_TIMEOUT_MS}ms)`)

rmSync(dir, { recursive: true, force: true })

// ---------------------------------------------------------------------------
console.log(`\n${checks - failed}/${checks} checks passed`)
process.exit(failed === 0 ? 0 : 1)
