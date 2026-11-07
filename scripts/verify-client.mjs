/**
 * Client-half wiring, render, and copy verification for the minimal restart
 * button. Real interaction is covered by the ego-browser fixture in
 * scripts/ui-fixture.mjs; this script does not pretend SSR is a browser.
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
check(entry?.options?.inject === undefined, 'entry no longer injects a connection hook')
check(captured.locales[0]?.ns === 'restart-dsh', 'registers the restart-dsh dictionary')

console.log('\n[2/4] no connection-driven reload or recovery surface')

const builtClient = read('../lib/client/index.js')
check(!builtClient.includes('useConnectionState'), 'built client has no useConnectionState hook')
check(!builtClient.includes('restartReloadDecision'), 'built client has no restartReloadDecision')
const buttonSource = read('../src/client/RestartButton.tsx')
const indexSource = read('../src/client/index.ts')
check(!buttonSource.includes('location.reload'), 'button source never reloads the page')
check(!buttonSource.includes('PENDING_TIMEOUT_MS'), 'button source has no recovery timeout')
check(!indexSource.includes('dsh-client-connection'), 'client index does not import the connection package')

console.log('\n[3/4] render + copy coverage')

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
const rail = renderToStaticMarkup(createElement(RestartButton, { wide: false, t }))
check(rail.includes('dsh-restart-trigger'), 'rail mode renders the trigger')

check(zh['restart.confirm.body'] === '重启将中断进行中的任务，不会自动续接。建议任务完成后操作。', 'Chinese confirm body matches the approved copy')
check(zh['restart.accepted'] === '重启请求已接受，后续连接状态由 DSH 显示', 'Chinese accepted copy matches the approved copy')
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

console.log('\n[4/4] source has no removed restart/recovery routes')

const hostSource = read('../src/index.ts')
check(!hostSource.includes("commands.register"), 'host no longer registers a command')
check(!hostSource.includes('Recovery'), 'host no longer uses Recovery')
check(!hostSource.includes('agentRunner'), 'host no longer snapshots agents')
check(!hostSource.includes('dsh-restart-resume.json'), 'host no longer has a resume route')
check(read('../src/host/restart.ts').includes("'systemctl', '--user', 'restart', SYSTEMD_UNIT"), 'host still uses the fixed systemctl argv')

console.log('\n' + (checks - failed) + '/' + checks + ' checks passed')
process.exit(failed === 0 ? 0 : 1)
