/**
 * Client-half wiring, render, and copy verification.
 *
 * SSR is not a browser: real interaction is covered by the ego-browser fixture
 * in scripts/ui-fixture.mjs. This script proves the bundle's wiring (one seat,
 * locale-only inject, loader seed words), that the two restart modes exist in
 * the dialog and on the wire, that the queued card is a real state rather than
 * a decoration, and that no dictionary key is orphaned or missing.
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RestartButton } from '../lib/client/RestartButton.js'

let failed = 0
let checks = 0
const check = (condition, label) => {
  checks += 1
  if (condition) console.log('  ok   ' + label)
  else {
    failed += 1
    console.log('  FAIL ' + label)
  }
}
const here = (rel) => new URL(rel, import.meta.url)
const read = (rel) => readFileSync(here(rel), 'utf8')

console.log('\n[1/4] client bundle wiring')

let record
globalThis.window = { __ModuleLoader__: { load: (r) => { record = r } } }
new Function('window', read('../lib/client/index.js'))(globalThis.window)
check(record !== undefined, 'bundle self-registers through window.__ModuleLoader__.load')
check(record?.id === 'dsh-restart-systemd', 'bundle id is dsh-restart-systemd (got ' + record?.id + ')')

const requires = new Set([...read('../lib/client/index.js').matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]))
check(
  [...requires].every((name) => ['react', 'react-dom', 'react/jsx-runtime'].includes(name)),
  'runtime requires are loader seed words only (got ' + [...requires].join(', ') + ')',
)

const reactStub = {
  createElement: () => null,
  useCallback: (fn) => fn,
  useEffect: () => undefined,
  useRef: () => ({}),
  useState: (value) => [value, () => undefined],
}
const captured = { effects: [], locales: [], injects: [], registers: [] }
const ctx = {
  effect: (fn, label) => { captured.effects.push(label); return fn() },
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
  throw new Error('unexpected runtime require: ' + name)
})
clientExports.apply(ctx)

check(clientExports.inject.join(',') === 'slots,locale', 'declared inject is slots,locale (got ' + clientExports.inject + ')')
check(captured.injects.includes('sidebar.footer.action'), 'registers into the sidebar.footer.action seat')
const [entry] = captured.registers
check(entry?.options?.id === 'dsh-restart-systemd', 'entry id is dsh-restart-systemd')
check(entry?.options?.locale === 'restart-dsh', 'entry declares the restart-dsh locale namespace')
check(typeof entry?.component === 'function', 'entry component is a function')
check(entry?.options?.inject === undefined, 'entry does not inject a connection hook')
check(captured.locales[0]?.ns === 'restart-dsh', 'registers the restart-dsh dictionary')

console.log('\n[2/4] no connection-driven reload, recovery, or waiting surface')

const builtClient = read('../lib/client/index.js')
check(!builtClient.includes('useConnectionState'), 'built client has no useConnectionState hook')
check(!builtClient.includes('restartReloadDecision'), 'built client has no restartReloadDecision')
const buttonSource = read('../src/client/RestartButton.tsx')
const indexSource = read('../src/client/index.ts')
const apiSource = read('../src/client/api.ts')
check(!buttonSource.includes('location.reload'), 'button source never reloads the page')
check(!buttonSource.includes('PENDING_TIMEOUT_MS'), 'button source has no recovery timeout')
check(!indexSource.includes('dsh-client-connection'), 'client index does not import the connection package')
check(!/kind: 'accepted'/.test(buttonSource), 'button source has no accepted phase')
check(!buttonSource.includes('requestingHint') && !buttonSource.includes('acceptedHint'), 'button source references no wait/accept copy')
check(!indexSource.includes('requestingHint') && !indexSource.includes('acceptedHint'), 'dictionaries define no wait/accept copy')
check((buttonSource.match(/role="alert"/g) || []).length === 1, 'errors render through exactly one bubble role=alert')
check((buttonSource.match(/role="status"/g) || []).length === 1, 'the queued card is the only status surface')
check(buttonSource.includes("const dialog = phase.kind === 'confirming' && createPortal"), 'the only modal dialog is gated on the confirming phase')
check(buttonSource.includes("const bubble = phase.kind === 'error' && createPortal"), 'the error bubble is gated on the error phase')
check(!buttonSource.includes('setOpen'), 'the component no longer holds an open/closed modal flag')

console.log('\n[3/4] the two restart modes')

check(buttonSource.includes('requestRestart(mode,'), 'the component passes a mode to the API helper')
check(buttonSource.includes("confirm('now')") && buttonSource.includes("confirm('when-idle')"), 'the dialog offers both restart-now and restart-when-idle')
check(apiSource.includes("mode: RestartMode = 'now'"), 'the API helper defaults to the interrupting mode')
check(apiSource.includes("body: JSON.stringify({ reason, mode })"), 'the mode travels in the request body')
check(apiSource.includes("method: 'GET'") && apiSource.includes("method: 'DELETE'"), 'the helper also reads and cancels the queue')
check(!buttonSource.includes("mode: 'when-idle'") || buttonSource.includes('RestartMode'), 'the mode type is shared with the API helper')
check(apiSource.includes("status: 'queued'"), 'the API classifies a queued acceptance separately from an immediate one')

console.log('\n[4/4] render + copy coverage')

const { en, zh } = captured.locales[0].dicts
const t = (key) => {
  if (!(key in en)) throw new Error('component asked for an unknown key: ' + key)
  return en[key]
}

let html = ''
try {
  html = renderToStaticMarkup(createElement(RestartButton, { wide: true, t }))
} catch (error) {
  check(false, 'component renders (threw: ' + error.message + ')')
}
check(html.includes('dsh-restart-trigger'), 'wide mode renders the trigger')
check(html.includes('aria-label="Restart DeepSeek Harness"'), 'trigger carries the localized aria-label')
check(html.includes('title="Restart DeepSeek Harness"'), 'trigger carries the localized title')
check(!html.includes('<dialog'), 'idle state renders no dialog')
check(!html.includes('data-dsh-restart-queued'), 'idle state is not marked as queued')
const rail = renderToStaticMarkup(createElement(RestartButton, { wide: false, t }))
check(rail.includes('dsh-restart-trigger'), 'rail mode renders the trigger')

check(zh['restart.proceed'] === '立即重启', 'Chinese restart-now label is explicit about interrupting')
check(zh['restart.proceedIdle'] === '等会话结束后重启', 'Chinese restart-when-idle label is present')
check(zh['restart.confirm.body'].includes('立即重启') && zh['restart.confirm.body'].includes('等会话结束'), 'Chinese confirm body explains both modes')
check(zh['restart.queued.title'] === '已安排重启', 'Chinese queued title is present')
check(zh['restart.queued.body'].includes('所有会话跑完后会自动重启'), 'Chinese queued body promises the automatic restart')
check(zh['restart.queued.cancel'] === '取消这次重启', 'Chinese queued cancel is present')
check(zh['restart.unknown'] === '无法确认重启请求是否被接受，请查看 DSH 连接状态；不要连续重试。', 'Chinese unknown copy matches the approved copy')
check(zh['restart.conflict'] === '已有重启请求在处理。', 'Chinese conflict copy exists')

const referenced = new Set()
for (const file of ['../src/client/RestartButton.tsx', '../src/client/index.ts']) {
  for (const match of read(file).matchAll(/\(\s*'(restart\.[A-Za-z.]+)'/g)) referenced.add(match[1])
}
check(referenced.size > 0, 'found ' + referenced.size + ' referenced copy keys')
for (const key of [...referenced].sort()) {
  check(key in en && key in zh, key + ' exists in en + zh')
}
const unused = Object.keys(en).filter((key) => !referenced.has(key))
check(unused.length === 0, 'no unused dictionary keys (unused: ' + (unused.join(', ') || 'none') + ')')
check(Object.keys(en).length === Object.keys(zh).length, 'en and zh define the same number of keys')

// The served bundle is a build artifact: a stale one would ship old copy even
// though the sources are right, so decode it and look for this version's words.
const decodeEscapes = (text) => text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
const builtCopy = decodeEscapes(read('../lib/client.js'))
check(builtCopy.includes(zh['restart.proceedIdle']), 'built bundle carries the restart-when-idle label')
check(builtCopy.includes('所有会话跑完后会自动重启'), 'built bundle carries the queued copy')
check(builtCopy.includes('"when-idle"'), 'built bundle carries the when-idle mode')
// The only intended difference between the two artifacts is the emitted
// sourceMappingURL, which names each file.
const stripMap = (text) => text.replace(/\/\/# sourceMappingURL=\S+/g, '').replace(/\s+$/, '')
check(
  stripMap(builtCopy) === stripMap(decodeEscapes(read('../lib/client/index.js'))),
  'lib/client.js and lib/client/index.js are the same build',
)

const hostSource = read('../src/index.ts')
check(!hostSource.includes('commands.register'), 'host no longer registers a command')
check(!hostSource.includes('Recovery'), 'host no longer uses Recovery')
check(!hostSource.includes('dsh-restart-resume.json'), 'host no longer has a resume route')
check(read('../src/host/restart.ts').includes("'systemctl', '--user', 'restart', SYSTEMD_UNIT"), 'host still uses the fixed systemctl argv')
check(read('../src/host/windows.ts').includes('Get-Process -Id $OldPid'), 'the Windows watcher waits on the exact pid')

console.log('\n' + (checks - failed) + '/' + checks + ' checks passed')
process.exit(failed === 0 ? 0 : 1)
