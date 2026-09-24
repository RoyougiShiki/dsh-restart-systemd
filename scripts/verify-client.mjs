/**
 * Client-half verification for dsh-restart-systemd.
 *
 * There is no browser in CI and the plugin must not restart the live service,
 * so this script exercises the built client artifacts the way the real
 * environment does, in three passes:
 *
 *  1. **Loader wiring** — boot `lib/client/index.js` through a stand-in
 *     `window.__ModuleLoader__` (the exact handoff the DSH loader performs) and
 *     assert `apply(ctx)` registers the right slot, locale namespace, and
 *     `connection` hook face.
 *  2. **Restart-reload state machine** — drive `restartReloadDecision` through
 *     every connection transition, above all the guard that a `connected`
 *     reading *before* any observed outage must not reload the page (the host
 *     keeps answering from the pre-restart process during its ~3s delay).
 *  3. **Render + copy coverage** — server-render the component and assert every
 *     `t('restart.*')` key used anywhere in the client source exists in BOTH
 *     dictionaries, with no unused keys left behind.
 *
 * Run with `npm test` (which builds first).
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RestartButton, restartReloadDecision } from '../lib/client/RestartButton.js'

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

const here = (rel) => new URL(rel, import.meta.url)
const read = (rel) => readFileSync(here(rel), 'utf8')

// ---------------------------------------------------------------------------
console.log('\n[1/3] client bundle wiring')

let record
globalThis.window = { __ModuleLoader__: { load: (r) => { record = r } } }
new Function('window', read('../lib/client/index.js'))(globalThis.window)
check(record !== undefined, 'bundle self-registers through window.__ModuleLoader__.load')
check(record?.id === 'dsh-restart-systemd', `bundle id is dsh-restart-systemd (got ${record?.id})`)

// Runtime externals are exactly the loader's platform seed words.
const requires = new Set([...read('../lib/client/index.js').matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]))
check(
  [...requires].every((name) => ['react', 'react-dom', 'react/jsx-runtime'].includes(name)),
  `runtime requires are loader seed words only (got ${[...requires].join(', ')})`,
)

const reactStub = {
  createElement: () => null,
  useCallback: (fn) => fn,
  useEffect: () => undefined,
  useRef: () => ({}),
  useState: (value) => [value, () => undefined],
}
const connectionState = { getSnapshot: () => 'connected', subscribe: () => () => undefined }
const captured = { effects: [], locales: [], injects: [], registers: [] }
const ctx = {
  effect: (fn, label) => { captured.effects.push(label); return fn() },
  get: (name) => (name === 'connection' ? { state: connectionState } : undefined),
  locale: { register: (ns, dicts) => { captured.locales.push({ ns, dicts }); return () => undefined } },
  slots: {
    inject: (key, factory) => { captured.injects.push(key); return factory() },
    register: (options, component) => { captured.registers.push({ options, component }); return () => undefined },
  },
}
const clientExports = record.factory((name) => {
  if (name === 'react') return reactStub
  if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: 'f' }
  if (name === 'react-dom') return { createPortal: () => null }
  throw new Error(`unexpected runtime require: ${name}`)
})
clientExports.apply(ctx)

check(clientExports.inject.join(',') === 'slots,locale', `declared inject is slots,locale (got ${clientExports.inject})`)
check(captured.injects.includes('sidebar.footer.action'), 'registers into the sidebar.footer.action seat')
const [entry] = captured.registers
check(entry?.options?.id === 'dsh-restart-systemd', 'entry id is dsh-restart-systemd')
check(entry?.options?.locale === 'restart-dsh', 'entry declares the restart-dsh locale namespace')
check(typeof entry?.component === 'function', 'entry component is a function')
const face = entry?.options?.inject?.()
check(face?.hooks?.connectionState === connectionState, 'inject face exposes ctx.connection.state as connectionState')
check(captured.locales[0]?.ns === 'restart-dsh', 'registers the restart-dsh dictionary')

// ---------------------------------------------------------------------------
console.log('\n[2/3] restart-reload state machine')

/** @param state - connection state. @param flags - schedule/outage flags. */
const decide = (state, flags) => restartReloadDecision(state, flags)
const cases = [
  ['undefined state, nothing scheduled', undefined, { scheduled: false, sawOutage: false }, false, false],
  ['connected, nothing scheduled', 'connected', { scheduled: false, sawOutage: false }, false, false],
  ['connecting, nothing scheduled', 'connecting', { scheduled: false, sawOutage: false }, false, true],
  // The guard that matters: the pre-restart process still answers during the
  // host's ~3s scheduling delay, so this must NOT reload.
  ['scheduled + connected BEFORE any outage', 'connected', { scheduled: true, sawOutage: false }, false, false],
  ['scheduled + outage begins', 'connecting', { scheduled: true, sawOutage: false }, false, true],
  ['scheduled + still retrying', 'connecting', { scheduled: true, sawOutage: true }, false, true],
  ['scheduled + network reported offline', 'disconnected', { scheduled: true, sawOutage: true }, false, true],
  ['scheduled + recovered => reload', 'connected', { scheduled: true, sawOutage: true }, true, false],
  ['flags cleared, connected again', 'connected', { scheduled: false, sawOutage: false }, false, false],
  ['outage without a scheduled restart', 'connecting', { scheduled: false, sawOutage: false }, false, true],
  ['recovery without a scheduled restart', 'connected', { scheduled: false, sawOutage: true }, false, true],
]
for (const [label, state, flags, reload, sawOutage] of cases) {
  const got = decide(state, flags)
  check(got.reload === reload && got.sawOutage === sawOutage, `${label} -> reload=${got.reload} sawOutage=${got.sawOutage}`)
}

// ---------------------------------------------------------------------------
console.log('\n[3/3] render + copy coverage')

const { en, zh } = captured.locales[0].dicts
const t = (key) => {
  if (!(key in en)) throw new Error(`component asked for an unknown key: ${key}`)
  return en[key]
}
const useConnectionState = (select) => select('connected')

let html = ''
try {
  html = renderToStaticMarkup(createElement(RestartButton, { wide: true, useConnectionState, t }))
} catch (error) {
  check(false, `component renders (threw: ${error.message})`)
}
check(html.includes('dsh-restart-trigger'), 'wide mode renders the trigger')
check(html.includes('aria-label="Restart DeepSeek Harness"'), 'trigger carries the localized aria-label')
check(html.includes('title="Restart DeepSeek Harness"'), 'trigger carries the localized title')
check(!html.includes('<dialog'), 'idle state renders no dialog')
const rail = renderToStaticMarkup(createElement(RestartButton, { wide: false, useConnectionState, t }))
check(rail.includes('dsh-restart-trigger'), 'rail mode renders the trigger')

// Every copy key referenced anywhere in the client source, matched for both
// `t('restart.x')` and the ref-held `tRef.current('restart.x')` form.
const referenced = new Set()
for (const file of ['../src/client/RestartButton.tsx', '../src/client/index.ts']) {
  for (const match of read(file).matchAll(/\(\s*'(restart\.[A-Za-z.]+)'/g)) referenced.add(match[1])
}
check(referenced.size > 0, `found ${referenced.size} referenced copy keys`)
for (const key of [...referenced].sort()) {
  check(key in en && key in zh, `${key} exists in en + zh`)
}
const unused = Object.keys(en).filter((key) => !referenced.has(key))
check(unused.length === 0, `no unused dictionary keys (unused: ${unused.join(', ') || 'none'})`)

// ---------------------------------------------------------------------------
console.log(`\n${checks - failed}/${checks} checks passed`)
process.exit(failed === 0 ? 0 : 1)
