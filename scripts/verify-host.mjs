/**
 * Host-half verification for the restart surface.
 *
 * Two layers:
 *  - HTTP: the public route registered by apply(ctx) against a real loopback
 *    server — gate, body handling, single-flight, suppression, queue shape.
 *  - Scheduler: a directly constructed RestartScheduler with millisecond
 *    timings — the fixed systemctl argv, the platform matrix, the when-idle
 *    queue, and the Windows watcher handoff.
 *
 * No real systemctl, no real PowerShell, no real appExit and no real launcher:
 * ctx.subprocess and the detached spawner are hard stubs, and every DSH_HOME is
 * a throwaway directory created by this script.
 *
 * Run with npm run test:host after npm run build.
 */
import { createServer, request as httpRequest } from 'node:http'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const importHome = mkdtempSync(join(tmpdir(), 'dsh-restart-host-import-'))
process.env.DSH_HOME = importHome
const { apply, inject } = await import('../lib/index.js')
const { RestartScheduler, platformSupported, restartArgv } = await import('../lib/host/restart.js')
const {
  setDetachedSpawner,
  windowsWatcherScript,
  windowsWatcherShim,
  launcherCommand,
  psLiteral,
  vbsLiteral,
  powershellPath,
  wscriptPath,
  LAUNCHER_WAIT_MS,
} = await import('../lib/host/windows.js')

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const unhandled = []
process.on('unhandledRejection', (error) => unhandled.push(error))
const originalHome = process.env.DSH_HOME
const roots = []

function makeCtx(options = {}) {
  const captured = { routes: [], spawns: [], logs: [], effects: [], exits: [], services: {} }
  const logger = {
    info: (message) => captured.logs.push({ level: 'info', message }),
    warn: (message) => captured.logs.push({ level: 'warn', message }),
    error: (message) => captured.logs.push({ level: 'error', message }),
  }
  const ctx = {
    logger,
    get(name) {
      return captured.services[name]
    },
    effect(fn, label) {
      const cleanup = fn()
      captured.effects.push({ label, cleanup })
      return cleanup
    },
    webServer: {
      register(route) {
        captured.routes.push(route)
        return () => undefined
      },
    },
    subprocess: {
      spawn(spawnOptions) {
        captured.spawns.push(spawnOptions)
        return options.spawn ? options.spawn(spawnOptions) : { done: Promise.resolve({ exitCode: 0, signal: null }) }
      },
    },
  }
  captured.services.agents = options.agents
  captured.services.appExit = (code) => captured.exits.push(code)
  return { ctx, captured }
}

async function makeApp(options = {}) {
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'dsh-restart-host-'))
  roots.push(root)
  const home = options.home ?? root
  process.env.DSH_HOME = home
  const { ctx, captured } = makeCtx(options)
  apply(ctx)
  const route = captured.routes.find((entry) => entry.path === '/api/restart-dsh')
  if (!route) throw new Error('plugin did not register /api/restart-dsh')
  const server = createServer((req, res) => route.handler(req, res))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    root,
    home,
    ctx,
    captured,
    port,
    route,
    async close() {
      for (const effect of captured.effects.reverse()) {
        try { await effect.cleanup?.() } catch { /* cleanup is best effort */ }
      }
      await new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

function request(port, options = {}) {
  const method = options.method ?? 'POST'
  const path = options.path ?? '/api/restart-dsh'
  const body = options.body ?? (method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : '{}')
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) }
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json
        try { json = text === '' ? undefined : JSON.parse(text) } catch { json = undefined }
        resolve({ status: res.statusCode, text, json })
      })
    })
    req.once('error', reject)
    req.end(body)
  })
}

/** One scheduler with millisecond timings and a stub subprocess. */
function makeScheduler(options = {}) {
  const captured = { spawns: [], logs: [], exits: [], services: {} }
  const logger = {
    info: (message) => captured.logs.push({ level: 'info', message }),
    warn: (message) => captured.logs.push({ level: 'warn', message }),
    error: (message) => captured.logs.push({ level: 'error', message }),
  }
  const agents = options.agents
  const ctx = {
    logger,
    get(name) {
      if (name === 'agents') return agents
      if (name === 'appExit') return options.noAppExit ? undefined : (code) => captured.exits.push(code)
      return undefined
    },
    subprocess: {
      spawn(spawnOptions) {
        captured.spawns.push(spawnOptions)
        return options.spawn ? options.spawn(spawnOptions) : { done: Promise.resolve({ exitCode: 0, signal: null }) }
      },
    },
  }
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'dsh-restart-sched-'))
  roots.push(home)
  const scheduler = new RestartScheduler(ctx, home, {
    platform: options.platform ?? 'linux',
    delayMs: options.delayMs ?? 40,
    pollMs: options.pollMs ?? 20,
    settleMs: options.settleMs ?? 40,
  })
  return { scheduler, captured, home }
}

/** A registry stub whose agent statuses the test can flip. */
function makeAgents(statuses) {
  return { list: () => statuses.map((status, index) => ({ id: 'agent-' + index, status })) }
}

function runProbe(code) {
  return new Promise((resolve) => {
    let child
    try {
      child = execFile(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', code], {
        cwd: process.cwd(),
        maxBuffer: 2 * 1024 * 1024,
        timeout: 30_000,
      }, (error, stdout, stderr) => {
        let observed
        try { observed = JSON.parse(stdout.trim()) } catch { observed = undefined }
        resolve({ error, observed, stderr })
      })
    } catch (error) {
      // A sandbox that forbids starting a grandchild cannot run these probes.
      resolve({ error, observed: undefined, stderr: String(error), denied: error?.code === 'EPERM' })
      return
    }
    child.once('error', (error) => {
      if (error?.code === 'EPERM') resolve({ error, observed: undefined, stderr: String(error), denied: true })
    })
  })
}

const race1ProbeCode = String.raw`import * as realFs from 'node:fs/promises'
import { mock } from 'node:test'
import http from 'node:http'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// The probe child pins the platform so the branch under test is not the host's.
Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
const unhandled = []
process.on('unhandledRejection', (error) => unhandled.push(String(error)))
let home
let server
let captured
try {
  home = mkdtempSync(join(tmpdir(), 'dsh-race1-'))
  process.env.DSH_HOME = home
  let releaseRead
  const readGate = new Promise((resolve) => { releaseRead = resolve })
  let readCalls = 0
  const fs = {
    ...realFs,
    readFile: async (path, options) => {
      readCalls += 1
      if (readCalls === 1) {
        await readGate
        const error = new Error('missing')
        error.code = 'ENOENT'
        throw error
      }
      return realFs.readFile(path, options)
    },
    writeFile: realFs.writeFile,
    unlink: realFs.unlink,
  }
  mock.module('node:fs/promises', { namedExports: fs })
  const { apply } = await import(process.cwd() + '/lib/index.js')
  captured = { routes: [], spawns: [], logs: [], effects: [] }
  const logger = {
    info: (message) => captured.logs.push(['info', message]),
    warn: (message) => captured.logs.push(['warn', message]),
    error: (message) => captured.logs.push(['error', message]),
  }
  const ctx = {
    logger,
    get() { return undefined },
    effect(fn, label) {
      const cleanup = fn()
      captured.effects.push({ label, cleanup })
      return cleanup
    },
    webServer: { register(route) { captured.routes.push(route); return () => undefined } },
    subprocess: {
      spawn(options) {
        captured.spawns.push(options)
        return { done: Promise.resolve({ exitCode: 0, signal: null }) }
      },
    },
  }
  apply(ctx)
  const route = captured.routes.find((entry) => entry.path === '/api/restart-dsh')
  if (!route) throw new Error('plugin did not register /api/restart-dsh')
  let routeCalls = 0
  server = http.createServer((req, res) => { routeCalls += 1; route.handler(req, res) })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  const responsePromise = new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method: 'POST', path: '/api/restart-dsh', headers: { 'content-type': 'application/json' } }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end('{}')
  })
  for (let i = 0; i < 50 && routeCalls === 0; i += 1) await sleep(10)
  await sleep(20)
  for (const effect of captured.effects.slice().reverse()) {
    try { await effect.cleanup?.() } catch { /* cleanup is best effort */ }
  }
  releaseRead()
  const response = await responsePromise.catch((error) => ({ status: 'request-error', text: String(error) }))
  await sleep(3300)
  console.log(JSON.stringify({
    race1: {
      routeStarted: routeCalls > 0,
      readCalls,
      responseStatus: response.status,
      responseText: response.text,
      spawnsAfterDispose: captured.spawns.length,
      flagAfter3s: existsSync(join(home, 'dsh-restart.flag')),
      logs: captured.logs,
    },
    unhandled: unhandled.length,
  }, null, 2))
} catch (error) {
  console.error(error.stack)
  process.exitCode = 1
} finally {
  if (server) await new Promise((resolve) => server.close(() => resolve()))
  if (home) rmSync(home, { recursive: true, force: true })
}`
const race2ProbeCode = String.raw`import * as realFs from 'node:fs/promises'
import { mock } from 'node:test'
import http from 'node:http'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// The probe child pins the platform so the branch under test is not the host's.
Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
const unhandled = []
process.on('unhandledRejection', (error) => unhandled.push(String(error)))
let home
let server
let captured
try {
  home = mkdtempSync(join(tmpdir(), 'dsh-race2-'))
  process.env.DSH_HOME = home
  let pauseFlagRead = false
  let releaseRead
  const readGate = new Promise((resolve) => { releaseRead = resolve })
  let flagReadStartedResolve
  const flagReadStarted = new Promise((resolve) => { flagReadStartedResolve = resolve })
  let flagReadCount = 0
  const fs = {
    ...realFs,
    readFile: async (path, options) => {
      if (pauseFlagRead && String(path).endsWith('dsh-restart.flag')) {
        const raw = await realFs.readFile(path, options)
        flagReadCount += 1
        flagReadStartedResolve()
        await readGate
        return raw
      }
      return realFs.readFile(path, options)
    },
    writeFile: realFs.writeFile,
    unlink: realFs.unlink,
  }
  mock.module('node:fs/promises', { namedExports: fs })
  const { apply } = await import(process.cwd() + '/lib/index.js')
  captured = { routes: [], spawns: [], logs: [], effects: [] }
  const logger = {
    info: (message) => captured.logs.push(['info', message]),
    warn: (message) => captured.logs.push(['warn', message]),
    error: (message) => captured.logs.push(['error', message]),
  }
  const ctx = {
    logger,
    get() { return undefined },
    effect(fn, label) {
      const cleanup = fn()
      captured.effects.push({ label, cleanup })
      return cleanup
    },
    webServer: { register(route) { captured.routes.push(route); return () => undefined } },
    subprocess: {
      spawn(options) {
        captured.spawns.push(options)
        return { done: Promise.resolve({ exitCode: 2, signal: null }) }
      },
    },
  }
  apply(ctx)
  const route = captured.routes.find((entry) => entry.path === '/api/restart-dsh')
  if (!route) throw new Error('plugin did not register /api/restart-dsh')
  server = http.createServer((req, res) => route.handler(req, res))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  const request = (reason) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method: 'POST', path: '/api/restart-dsh', headers: { 'content-type': 'application/json' } }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end(JSON.stringify({ reason }))
  })
  await sleep(120)
  pauseFlagRead = true
  const first = await request('first')
  await Promise.race([flagReadStarted, sleep(4500)])
  const flagReadObserved = flagReadCount > 0
  const duringCleanup = flagReadObserved ? await request('during-cleanup') : null
  const flagBeforeRelease = existsSync(join(home, 'dsh-restart.flag'))
  releaseRead()
  await sleep(100)
  const flagAfterRelease = existsSync(join(home, 'dsh-restart.flag'))
  const afterCleanup = flagReadObserved ? await request('after-cleanup') : null
  pauseFlagRead = false
  console.log(JSON.stringify({
    race2: {
      firstStatus: first.status,
      flagReadObserved,
      duringCleanupStatus: duringCleanup?.status ?? null,
      afterCleanupStatus: afterCleanup?.status ?? null,
      flagBeforeRelease,
      flagAfterRelease,
      spawns: captured.spawns.length,
      logs: captured.logs,
    },
    unhandled: unhandled.length,
  }, null, 2))
} catch (error) {
  console.error(error.stack)
  process.exitCode = 1
} finally {
  if (captured) for (const effect of captured.effects.slice().reverse()) {
    try { await effect.cleanup?.() } catch { /* cleanup is best effort */ }
  }
  if (server) await new Promise((resolve) => server.close(() => resolve()))
  if (home) rmSync(home, { recursive: true, force: true })
}`
const writeDisposeProbeCode = String.raw`import * as realFs from 'node:fs/promises'
import { mock } from 'node:test'
import http from 'node:http'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// The probe child pins the platform so the branch under test is not the host's.
Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
const unhandled = []
process.on('unhandledRejection', (error) => unhandled.push(String(error)))
let home
let server
let captured
try {
  home = mkdtempSync(join(tmpdir(), 'dsh-race3-'))
  process.env.DSH_HOME = home
  let releaseWrite
  const writeGate = new Promise((resolve) => { releaseWrite = resolve })
  let writeStartedResolve
  const writeStarted = new Promise((resolve) => { writeStartedResolve = resolve })
  let writeStartedValue = false
  const fs = {
    ...realFs,
    readFile: realFs.readFile,
    writeFile: async (path, data, options) => {
      await realFs.writeFile(path, data, options)
      writeStartedValue = true
      writeStartedResolve()
      await writeGate
    },
    unlink: realFs.unlink,
  }
  mock.module('node:fs/promises', { namedExports: fs })
  const { apply } = await import(process.cwd() + '/lib/index.js')
  captured = { routes: [], spawns: [], logs: [], effects: [] }
  const logger = {
    info: (message) => captured.logs.push(['info', message]),
    warn: (message) => captured.logs.push(['warn', message]),
    error: (message) => captured.logs.push(['error', message]),
  }
  const ctx = {
    logger,
    get() { return undefined },
    effect(fn, label) {
      const cleanup = fn()
      captured.effects.push({ label, cleanup })
      return cleanup
    },
    webServer: { register(route) { captured.routes.push(route); return () => undefined } },
    subprocess: {
      spawn(options) {
        captured.spawns.push(options)
        return { done: Promise.resolve({ exitCode: 0, signal: null }) }
      },
    },
  }
  apply(ctx)
  const route = captured.routes.find((entry) => entry.path === '/api/restart-dsh')
  if (!route) throw new Error('plugin did not register /api/restart-dsh')
  server = http.createServer((req, res) => route.handler(req, res))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  const responsePromise = new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method: 'POST', path: '/api/restart-dsh', headers: { 'content-type': 'application/json' } }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end(JSON.stringify({ reason: 'write-dispose' }))
  })
  await sleep(120)
  await Promise.race([writeStarted, sleep(2500)])
  for (const effect of captured.effects.slice().reverse()) {
    try { await effect.cleanup?.() } catch { /* cleanup is best effort */ }
  }
  releaseWrite()
  const response = await Promise.race([
    responsePromise.catch((error) => ({ status: 'request-error', text: String(error) })),
    sleep(5000).then(() => ({ status: 'timeout', text: 'timeout' })),
  ])
  await sleep(3300)
  console.log(JSON.stringify({
    writeDispose: {
      writeStarted: writeStartedValue,
      responseStatus: response.status,
      responseText: response.text,
      spawnsAfterDispose: captured.spawns.length,
      flagAfter3s: existsSync(join(home, 'dsh-restart.flag')),
      logs: captured.logs,
    },
    unhandled: unhandled.length,
  }, null, 2))
} catch (error) {
  console.error(error.stack)
  process.exitCode = 1
} finally {
  if (captured) for (const effect of captured.effects.slice().reverse()) {
    try { await effect.cleanup?.() } catch { /* cleanup is best effort */ }
  }
  if (server) await new Promise((resolve) => server.close(() => resolve()))
  if (home) rmSync(home, { recursive: true, force: true })
}`

function tempHome(prefix = 'dsh-restart-host-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

function cleanupRoots() {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  rmSync(importHome, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
}

try {
  // -------------------------------------------------------------------------
  console.log('\n[1/10] declaration and public route wiring')

  check(inject.join(',') === 'webServer,subprocess', 'inject declares only webServer,subprocess (got ' + JSON.stringify([...inject]) + ')')
  check(platformSupported('linux') === true && platformSupported('win32') === true, 'linux and win32 are both supported platforms')
  check(platformSupported('darwin') === false, 'darwin is not a supported platform')
  check(JSON.stringify(restartArgv()) === JSON.stringify(['systemctl', '--user', 'restart', 'dsh-web']), 'the Linux argv stays the fixed systemctl call')

  {
    const app = await makeApp()
    check(app.captured.routes.length === 1, 'apply registers exactly one route')
    check(app.captured.routes[0]?.kind === 'exact', 'route uses exact matching')
    check(app.captured.routes[0]?.path === '/api/restart-dsh', 'route path is /api/restart-dsh')
    check(app.captured.spawns.length === 0, 'applying the plugin never spawns anything')
    await app.close()
  }

  // -------------------------------------------------------------------------
  console.log('\n[2/10] security fence, body handling, and the status route')

  {
    const app = await makeApp()
    const put = await request(app.port, { method: 'PUT' })
    check(put.status === 405, 'unsupported method is refused with 405 (got ' + put.status + ')')

    const idle = await request(app.port, { method: 'GET' })
    check(idle.status === 200, 'GET reports status with 200 (got ' + idle.status + ')')
    check(idle.json?.queued === null, 'GET reports no queued restart on a fresh host')
    check(idle.json?.armed === false, 'GET reports nothing armed on a fresh host')

    const headIdle = await request(app.port, { method: 'HEAD' })
    check(headIdle.status === 200, 'HEAD mirrors GET (got ' + headIdle.status + ')')

    const wrongType = await request(app.port, { headers: { 'content-type': 'text/plain' } })
    check(wrongType.status === 415, 'non-JSON content-type is refused with 415 (got ' + wrongType.status + ')')

    const evilHost = await request(app.port, { headers: { host: 'evil.example' } })
    check(evilHost.status === 403, 'non-loopback Host is refused with 403 (got ' + evilHost.status + ')')

    const crossSite = await request(app.port, { headers: { 'sec-fetch-site': 'cross-site' } })
    check(crossSite.status === 403, 'cross-site fetch metadata is refused with 403 (got ' + crossSite.status + ')')

    const evilOrigin = await request(app.port, { headers: { origin: 'http://evil.example' } })
    check(evilOrigin.status === 403, 'foreign Origin is refused with 403 (got ' + evilOrigin.status + ')')

    const guardedGet = await request(app.port, { method: 'GET', headers: { host: 'evil.example' } })
    check(guardedGet.status === 403, 'the status route is behind the same fence (got ' + guardedGet.status + ')')

    const invalidJson = await request(app.port, { body: '{not json' })
    check(invalidJson.status === 400, 'malformed JSON is a controlled 400 (got ' + invalidJson.status + ')')

    const tooLarge = await request(app.port, { body: 'x'.repeat((1 << 20) + 1) })
    check(tooLarge.status === 413, 'oversized body is a controlled 413 (got ' + tooLarge.status + ')')

    const badMode = await request(app.port, { body: JSON.stringify({ mode: 'sometime' }) })
    check(badMode.status === 400, 'an unknown mode is a controlled 400 (got ' + badMode.status + ')')
    check(badMode.json?.error === 'invalid-mode', 'invalid-mode names itself')
    await app.close()
  }

  // -------------------------------------------------------------------------
  console.log('\n[3/10] single-flight over the public route')

  {
    const app = await makeApp()
    const first = await request(app.port, { body: JSON.stringify({ reason: 'first' }) })
    const second = await request(app.port, { body: JSON.stringify({ reason: 'second' }) })
    check(first.status === 202, 'first request is 202 (got ' + first.status + ')')
    check(second.status === 409, 'duplicate while in flight is 409 (got ' + second.status + ')')
    check(second.json?.error === 'already-scheduled', '409 body names already-scheduled')
    const armed = await request(app.port, { method: 'GET' })
    check(armed.json?.armed === true, 'GET reports the armed restart')
    await app.close()
  }

  // -------------------------------------------------------------------------
  console.log('\n[4/10] boot flag suppression and legacy cleanup')

  {
    const home = tempHome()
    writeFileSync(join(home, 'dsh-restart.flag'), JSON.stringify({ ts: Date.now(), reason: 'old', sessionIds: ['ignored'] }), 'utf8')
    writeFileSync(join(home, 'dsh-restart-resume.json'), JSON.stringify({ ts: Date.now(), reason: 'old', sessionIds: ['ignored'] }), 'utf8')
    const app = await makeApp({ home })
    const response = await request(app.port, { body: JSON.stringify({ reason: 'after-boot' }) })
    check(response.status === 429, 'a fresh boot suppresses re-clicks with 429 (got ' + response.status + ')')
    check(response.json?.error === 'suppressed', '429 body names suppressed')
    check(!existsSync(join(home, 'dsh-restart.flag')), 'boot consumes the flag')
    check(!existsSync(join(home, 'dsh-restart-resume.json')), 'boot removes the legacy resume file')
    check(app.captured.spawns.length === 0, 'suppressed request never spawns')
    await app.close()
  }

  // -------------------------------------------------------------------------
  console.log('\n[5/10] flag-write failure is a real 500 and does not spawn')

  {
    const root = tempHome()
    const home = join(root, 'home-is-a-file')
    writeFileSync(home, 'not a directory', 'utf8')
    const app = await makeApp({ root, home })
    const response = await request(app.port, { body: JSON.stringify({ reason: 'write-fails' }) })
    check(response.status === 500, 'flag write failure returns 500 (got ' + response.status + ')')
    check(response.json?.error === 'restart-failed', '500 body names restart-failed')
    check(typeof response.json?.message === 'string' && response.json.message.includes('flag'), '500 message mentions the flag write')
    check(app.captured.spawns.length === 0, 'failed preparation never spawns')
    await app.close()
  }

  // -------------------------------------------------------------------------
  console.log('\n[6/10] the Linux act: fixed argv, delayed, logged')

  {
    const { scheduler, captured } = makeScheduler({ delayMs: 60 })
    const result = await scheduler.schedule('linux-branch')
    check(result.kind === 'scheduled' && result.delayMs === 60, 'schedule reports the delay it will use')
    check(captured.spawns.length === 0, 'spawn is delayed, not synchronous')
    await sleep(30)
    check(captured.spawns.length === 0, 'no spawn before the delay elapses')
    await sleep(90)
    check(captured.spawns.length === 1, 'exactly one spawn after the delay (got ' + captured.spawns.length + ')')
    const spawn = captured.spawns[0]
    check(JSON.stringify(spawn?.argv) === JSON.stringify(['systemctl', '--user', 'restart', 'dsh-web']), 'argv is the fixed systemctl call (got ' + JSON.stringify(spawn?.argv) + ')')
    check(spawn?.cwd === process.cwd(), 'cwd is the plugin process cwd')
    check(spawn?.stdio?.stdin === 'ignore' && spawn?.stdio?.stdout === 'inherit' && spawn?.stdio?.stderr === 'inherit', 'stdio is ignore/inherit/inherit')
    check(spawn?.graceMs === 10_000, 'graceMs is 10000 (got ' + spawn?.graceMs + ')')
    check(captured.logs.some((entry) => entry.message.includes('spawning restart')), 'spawn is logged')
    check(captured.logs.some((entry) => entry.message.includes('restart process exited')), 'done outcome is logged')
    check(captured.exits.length === 0, 'the Linux branch never calls appExit')
    scheduler.dispose()
  }

  {
    // A failed spawn must not take the host down and must leave no flag.
    const { scheduler, captured, home } = makeScheduler({
      delayMs: 20,
      spawn: () => ({ done: Promise.reject(new Error('done boom')) }),
    })
    const accepted = await scheduler.schedule('done-boom')
    check(accepted.kind === 'scheduled', 'a rejected spawn is still accepted at schedule time')
    await sleep(80)
    check(captured.logs.some((entry) => entry.level === 'warn' && entry.message.includes('restart process failed')), 'spawn rejection is logged as a warning')
    check(!existsSync(join(home, 'dsh-restart.flag')), 'a failed spawn clears its own flag')
    check(captured.exits.length === 0, 'a failed spawn does not exit')
    scheduler.dispose()
  }

  {
    const { scheduler, captured } = makeScheduler({
      delayMs: 20,
      spawn: () => ({ done: Promise.resolve({ exitCode: 2, signal: null }) }),
    })
    await scheduler.schedule('nonzero')
    await sleep(80)
    check(captured.logs.some((entry) => entry.level === 'warn' && entry.message.includes('code=2')), 'non-zero exit is logged as a warning')
    scheduler.dispose()
  }

  {
    const { scheduler, captured } = makeScheduler({ delayMs: 20, spawn: () => { throw new Error('spawn boom') } })
    await scheduler.schedule('spawn-throw')
    await sleep(80)
    check(captured.logs.some((entry) => entry.level === 'error' && entry.message.includes('could not spawn')), 'a throwing spawn is logged as an error')
    scheduler.dispose()
  }

  // -------------------------------------------------------------------------
  console.log('\n[7/10] platform matrix and the Windows watcher handoff')

  {
    const app = await makeApp()
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    try {
      const app2 = await makeApp()
      const response = await request(app2.port, { body: '{}' })
      check(response.status === 501, 'an unsupported platform is rejected with 501 (got ' + response.status + ')')
      check(response.json?.error === 'unsupported-platform', '501 body names unsupported-platform')
      check(app2.captured.spawns.length === 0, 'an unsupported platform never spawns')
      await app2.close()
    } finally {
      if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor)
    }
    await app.close()
  }

  {
    // No launcher configured: refuse loudly, keep the host alive, clear the flag.
    const { scheduler, captured, home } = makeScheduler({ platform: 'win32', delayMs: 20 })
    setDetachedSpawner(() => {
      captured.detached = (captured.detached ?? 0) + 1
      return { pid: 4242, unref() {}, on() {} }
    })
    try {
      const result = await scheduler.schedule('win32-no-launcher')
      check(result.kind === 'scheduled', 'a Windows restart is accepted before the launcher is checked')
      await sleep(90)
      check(captured.exits.length === 0, 'no launcher means no exit')
      check((captured.detached ?? 0) === 0, 'no launcher means no watcher')
      check(captured.logs.some((entry) => entry.level === 'error' && entry.message.includes('no Windows launcher is configured')), 'the missing launcher is logged as an error with the fix')
      check(!existsSync(join(home, 'dsh-restart.flag')), 'the refused attempt clears its own flag')
    } finally {
      setDetachedSpawner(undefined)
      scheduler.dispose()
    }
  }

  {
    // A configured launcher: start the watcher first, then leave through appExit.
    const home = mkdtempSync(join(tmpdir(), 'dsh-restart-win32-'))
    roots.push(home)
    const launcher = join(home, 'start-dsh-native.ps1')
    writeFileSync(join(home, 'dsh-restart.json'), JSON.stringify({ windowsLauncher: launcher }), 'utf8')
    const { scheduler, captured } = makeScheduler({ platform: 'win32', delayMs: 20, home })
    const spawned = []
    setDetachedSpawner((command, args, spawnOptions) => {
      spawned.push({ command, args, options: spawnOptions })
      return { pid: 777, unref() {}, on() {} }
    })
    try {
      const result = await scheduler.schedule('win32-launcher')
      check(result.kind === 'scheduled', 'a Windows restart is accepted with a launcher configured')
      // startWatcher watches the shim for an early spawn error before reporting
      // success, so the exit lands after that window, not immediately.
      await sleep(700)
      check(spawned.length === 1, 'exactly one watcher process is started (got ' + spawned.length + ')')
      const watcher = spawned[0]
      // node cannot start powershell.exe detached on Windows (the child exits 0
      // without running the script), so the launch goes through wscript.exe,
      // which is also the chain the desktop launcher shortcut already uses.
      check(watcher?.command === wscriptPath(), 'the watcher is started through wscript.exe (got ' + watcher?.command + ')')
      check(
        watcher?.args?.includes('//Nologo') && String(watcher?.args?.at(-1)).endsWith('dsh-restart-watcher.vbs'),
        'the watcher runs as a VBS shim (got ' + JSON.stringify(watcher?.args) + ')',
      )
      check(!String(watcher?.command).toLowerCase().endsWith('powershell.exe'), 'node never starts powershell.exe directly - that path is silently a no-op here')
      check(watcher?.options?.detached === true, 'the watcher is detached so it survives this process')
      check(watcher?.options?.stdio === 'ignore' && watcher?.options?.windowsHide === true, 'the watcher is silent and hidden')
      check(captured.exits.length === 1 && captured.exits[0] === 0, 'the host leaves through appExit(0) after the watcher starts (got ' + JSON.stringify(captured.exits) + ')')
      check(existsSync(join(home, 'dsh-restart.flag')), 'the flag stays on disk for the next boot to consume')

      const scriptPath = join(home, 'dsh-restart-watcher.ps1')
      check(existsSync(scriptPath), 'the PowerShell watcher script is written next to the flag')
      const script = readFileSync(scriptPath, 'utf8').replace(/^\uFEFF/, '')
      check(script.includes('Get-Process -Id $OldPid'), 'the watcher waits on the exact pid, not on the port')
      check(script.includes("$OldPid = " + String(process.pid)), 'the watcher waits for this very process')
      check(script.includes(psLiteral(launcher)), 'the watcher holds the launcher path as a quoted literal')
      check(
        script.includes('Start-Process -FilePath ' + psLiteral(powershellPath())),
        'a .ps1 launcher runs as its own PowerShell process, not dot-called',
      )
      check(!script.includes('& $Launcher'), 'the launcher is never dot-called - its exit would kill the watcher')
      check(script.includes('-PassThru'), 'the watcher keeps the launcher handle so it can read the exit code')
      check(
        !script.includes('-Wait'),
        '-Wait is avoided: it can sit on the launcher children (browser, new host) and the watcher would never return',
      )
      check(
        script.includes('$LauncherProc.WaitForExit(' + String(LAUNCHER_WAIT_MS) + ')'),
        'the launcher wait is bounded instead of unbounded',
      )
      check(
        script.includes("Write-WatcherLog ('the launcher was started (pid '"),
        'the handoff is logged before waiting, so a later hang still leaves a record',
      )
      // A TypeScript expression that leaks into the PowerShell source is a
      // syntax error at runtime, and nothing else would catch it here.
      check(!/\bString\(|\bundefined\b|\[object Object\]|\$\{/.test(script), 'the script is PowerShell, with no TypeScript leftovers')
      check(
        !/-PassThru -WindowStyle Hidden/.test(script),
        'Start-Process does not hide the launcher window (a cold start would look hung)',
      )
      check(
        script.includes("Write-WatcherLog ('the launcher exited with code '"),
        "the launcher's exit code lands in the watcher log",
      )
      check(
        script.includes("Write-WatcherLog ('the launcher could not be started: '"),
        'a launcher that cannot even start is logged instead of passing as success',
      )
      check(
        !/(\$LauncherProc\.ExitCode\s+-ne\s+\$null|\$null\s+-ne\s+\$LauncherProc\.ExitCode)/.test(script),
        'the exit-code check does not rely on a null sentinel',
      )
      check(
        /\$old = Get-Process -Id \$OldPid -ErrorAction Stop/.test(script),
        'the pid query is told to throw so a failure cannot be read as "process is gone"',
      )
      check(
        script.includes("Category -eq 'ObjectNotFound'"),
        'only "no such process" counts as gone - access denied must keep waiting',
      )
      check(
        script.includes('could not query pid'),
        'a pid query that keeps failing is logged instead of silently blocking the relaunch',
      )
      check(!script.includes('Get-NetTCPConnection') && !script.includes('netstat'), 'the watcher never infers absence from the port')

      const shimPath = join(home, 'dsh-restart-watcher.vbs')
      check(existsSync(shimPath), 'the wscript shim is written next to the watcher script')
      // The shim is UTF-16LE with a BOM; decode it the way wscript does.
      const shim = readFileSync(shimPath, 'utf16le').replace(/^\uFEFF/, '')
      check(shim.includes(vbsLiteral(scriptPath)), 'the shim names the PowerShell script it starts')
      check(
        shim.includes(powershellPath()) && shim.includes('-WindowStyle Hidden'),
        'the shim starts the absolute PowerShell path hidden (no PATH dependence inside wscript)',
      )
      check(shim.includes('shell.Run(cmd, 0, True)'), 'the shim waits for the watcher instead of returning at once')
      check(shim.includes('On Error Resume Next'), 'a shim logging failure cannot kill the reload')
      check(/\r\n/.test(shim), 'the shim is written with CRLF line endings')
      check(
        readFileSync(shimPath).subarray(0, 2).equals(Buffer.from([0xff, 0xfe])),
        'the shim is written as UTF-16LE with a BOM so wscript does not decode it as ANSI',
      )
      check(
        readFileSync(scriptPath).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
        'the PowerShell script carries a UTF-8 BOM so 5.1 does not decode it as ANSI',
      )
    } finally {
      setDetachedSpawner(undefined)
      scheduler.dispose()
    }
  }

  {
    // The shim is the single point of failure: if wscript cannot run the
    // watcher, nothing else in the chain notices.
    const scriptPath = 'C:\\Users\\dev\\.dsh\\dsh-restart-watcher.ps1'
    const logPath = 'C:\\Users\\dev\\.dsh\\dsh-restart-watcher.log'
    const shim = windowsWatcherShim({ scriptPath, logPath })
    check(shim.startsWith("'"), 'the shim opens with a VBScript comment, not a BOM or a stray token')
    check(shim.includes('Option Explicit'), 'the shim runs with Option Explicit')
    check(shim.includes(vbsLiteral(logPath)), 'the shim logs to the same file the watcher uses')
    check(shim.includes('"C:\\Users\\dev\\.dsh\\dsh-restart-watcher.ps1"'), 'the script path is quoted so spaces and backslashes survive')
    check(!/powershell\.exe"\s+-File\s+'/.test(shim), 'the shim does not use PowerShell quoting for the path')
    const quoted = windowsWatcherShim({ scriptPath: 'C:\\a "b"\\watch.ps1', logPath })
    check(quoted.includes('"C:\\a ""b""\\watch.ps1"'), 'double quotes inside a path are doubled for VBScript')
    check(vbsLiteral('a"b') === '"a""b"', 'vbsLiteral doubles embedded quotes')

    const ps1 = launcherCommand('F:\\ai\\launchers\\start.ps1')
    check(ps1.file === powershellPath(), 'a .ps1 launcher runs through PowerShell')
    check(ps1.argumentList.includes('-File') && ps1.argumentList.includes('start.ps1'), 'a .ps1 launcher is passed as -File')
    check(
      ps1.argumentList.includes('-WindowStyle Hidden'),
      "the console is hidden through a PowerShell argument so the launcher's own progress window still shows",
    )
    check(ps1.argumentList.includes('-STA'), 'the launcher keeps the apartment state the desktop shortcut gives it')
    const bat = launcherCommand('F:\\ai\\launchers\\start.cmd')
    check(String(bat.file).toLowerCase().endsWith('cmd.exe'), 'a .cmd launcher runs through cmd.exe')
    check(bat.argumentList.startsWith('/c '), 'a .cmd launcher is passed as /c')
    const exe = launcherCommand('F:\\ai\\launchers\\start.exe')
    check(exe.file === 'F:\\ai\\launchers\\start.exe' && exe.argumentList === '', 'any other launcher runs as itself')
  }

  {
    // The detached spawn itself failing must leave the host alive.
    const home = mkdtempSync(join(tmpdir(), 'dsh-restart-win32-fail-'))
    roots.push(home)
    writeFileSync(join(home, 'dsh-restart.json'), JSON.stringify({ windowsLauncher: 'C:\\launchers\\start.ps1' }), 'utf8')
    const { scheduler, captured } = makeScheduler({ platform: 'win32', delayMs: 20, home })
    setDetachedSpawner(() => { throw new Error('detach boom') })
    try {
      await scheduler.schedule('win32-detach-fail')
      await sleep(90)
      check(captured.exits.length === 0, 'a failed watcher start does not exit')
      check(captured.logs.some((entry) => entry.level === 'error' && entry.message.includes('could not start the Windows watcher')), 'the failed watcher start is logged as an error')
      check(!existsSync(join(home, 'dsh-restart.flag')), 'a failed watcher start clears its own flag')
    } finally {
      setDetachedSpawner(undefined)
      scheduler.dispose()
    }
  }

  {
    // A real spawner reports a missing wscript.exe asynchronously; that must
    // become a refusal, not an exit into a host nobody will relaunch.
    const home = mkdtempSync(join(tmpdir(), 'dsh-restart-win32-early-'))
    roots.push(home)
    writeFileSync(join(home, 'dsh-restart.json'), JSON.stringify({ windowsLauncher: 'C:\\launchers\\start.ps1' }), 'utf8')
    const { scheduler, captured } = makeScheduler({ platform: 'win32', delayMs: 20, home })
    setDetachedSpawner(() => {
      const handlers = []
      return {
        pid: 12,
        unref() {},
        on(_event, handler) {
          handlers.push(handler)
          // Same turn ordering as a real ENOENT: the error lands after the
          // process object exists and before any timer fires.
          setTimeout(() => handler(Object.assign(new Error('spawn wscript.exe ENOENT'), { code: 'ENOENT' })), 5)
        },
      }
    })
    try {
      await scheduler.schedule('win32-early-error')
      await sleep(900)
      check(captured.exits.length === 0, 'an asynchronous spawn failure does not exit the host')
      check(
        captured.logs.some((entry) => entry.level === 'error' && entry.message.includes('could not start the Windows watcher')),
        'an asynchronous spawn failure is logged as an error',
      )
      check(!existsSync(join(home, 'dsh-restart.flag')), 'an asynchronous spawn failure clears its own flag')
    } finally {
      setDetachedSpawner(undefined)
      scheduler.dispose()
    }
  }

  {
    // No appExit service: refusing is safer than a dead host with no relaunch.
    const home = mkdtempSync(join(tmpdir(), 'dsh-restart-win32-noexit-'))
    roots.push(home)
    writeFileSync(join(home, 'dsh-restart.json'), JSON.stringify({ windowsLauncher: 'C:\\launchers\\start.ps1' }), 'utf8')
    const { scheduler, captured } = makeScheduler({ platform: 'win32', delayMs: 20, home, noAppExit: true })
    let watchers = 0
    setDetachedSpawner(() => {
      watchers += 1
      return { pid: 9, unref() {}, on() {} }
    })
    try {
      await scheduler.schedule('win32-no-appexit')
      await sleep(90)
      check(watchers === 0, 'without appExit no watcher is started')
      check(captured.logs.some((entry) => entry.level === 'error' && entry.message.includes('appExit')), 'the missing appExit service is named in an error')
      check(!existsSync(join(home, 'dsh-restart.flag')), 'the refused attempt clears its own flag')
    } finally {
      setDetachedSpawner(undefined)
      scheduler.dispose()
    }
  }

  // -------------------------------------------------------------------------
  console.log('\n[8/10] the when-idle queue')

  {
    const statuses = ['running', 'idle']
    const app = await makeApp({ agents: makeAgents(statuses) })
    const queued = await request(app.port, { body: JSON.stringify({ reason: 'idle-request', mode: 'when-idle' }) })
    check(queued.status === 202, 'a when-idle request with a running session is accepted (got ' + queued.status + ')')
    check(queued.json?.scheduled === true && queued.json?.queued === true, 'the 202 says it is queued rather than armed')
    check(queued.json?.waitingForSessions === 1, 'the 202 reports the running session count (got ' + queued.json?.waitingForSessions + ')')
    const status = await request(app.port, { method: 'GET' })
    check(status.json?.queued?.reason === 'idle-request', 'GET returns the queued restart')
    check(status.json?.armed === false, 'a queued restart is not armed')
    const second = await request(app.port, { body: JSON.stringify({ mode: 'when-idle' }) })
    check(second.status === 409, 'a second request while queued is 409 (got ' + second.status + ')')
    const cancelled = await request(app.port, { method: 'DELETE' })
    check(cancelled.status === 200 && cancelled.json?.cancelled === true, 'DELETE cancels the queued restart')
    const afterCancel = await request(app.port, { method: 'GET' })
    check(afterCancel.json?.queued === null, 'the queue is empty after the cancel')
    const nothing = await request(app.port, { method: 'DELETE' })
    check(nothing.json?.cancelled === false, 'a second DELETE reports nothing to cancel')
    await app.close()
  }

  {
    // Fast queued run: waits while running, fires after idle + settle.
    const statuses = ['running']
    const { scheduler, captured } = makeScheduler({ agents: makeAgents(statuses), delayMs: 20, pollMs: 15, settleMs: 30 })
    const result = await scheduler.schedule('queued-run', 'when-idle')
    check(result.kind === 'queued' && result.waitingForSessions === 1, 'a running session queues the restart')
    check(scheduler.pending()?.reason === 'queued-run', 'the pending restart is readable')
    await sleep(120)
    check(captured.spawns.length === 0, 'the restart does not fire while the session runs')
    statuses.length = 0
    await sleep(160)
    check(captured.spawns.length === 1, 'the restart fires once every session is idle (got ' + captured.spawns.length + ')')
    check(scheduler.pending() === undefined, 'the queue is empty after firing')
    check(captured.logs.some((entry) => entry.message.includes('all sessions are idle')), 'the firing is logged')
    scheduler.dispose()
  }

  {
    // A session starting inside the settle window pushes the restart back.
    const statuses = ['running']
    const { scheduler, captured } = makeScheduler({ agents: makeAgents(statuses), delayMs: 20, pollMs: 15, settleMs: 200 })
    await scheduler.schedule('settle-recheck', 'when-idle')
    statuses.length = 0
    await sleep(50)
    statuses.push('running')
    await sleep(260)
    check(captured.spawns.length === 0, 'a session starting during the settle window postpones the restart (got ' + captured.spawns.length + ')')
    check(scheduler.pending() !== undefined, 'the postponed restart is still queued')
    statuses.length = 0
    await sleep(400)
    check(captured.spawns.length === 1, 'the postponed restart fires once idle holds (got ' + captured.spawns.length + ')')
    scheduler.dispose()
  }

  {
    // Cancelling a queue must not leave a timer that fires later.
    const statuses = ['running']
    const { scheduler, captured } = makeScheduler({ agents: makeAgents(statuses), delayMs: 20, pollMs: 15, settleMs: 20 })
    await scheduler.schedule('cancel-me', 'when-idle')
    check(scheduler.cancelPending() === true, 'cancelPending reports the cancel')
    check(scheduler.cancelPending() === false, 'cancelling twice reports nothing to cancel')
    statuses.length = 0
    await sleep(150)
    check(captured.spawns.length === 0, 'a cancelled restart never fires')
    scheduler.dispose()
  }

  {
    // The registry is required for when-idle; missing it must not restart blind.
    const { scheduler, captured } = makeScheduler({ delayMs: 20 })
    const result = await scheduler.schedule('no-registry', 'when-idle')
    check(result.kind === 'error' && result.message.includes('agent registry'), 'a missing agent registry is an error, not an immediate restart')
    await sleep(60)
    check(captured.spawns.length === 0, 'the missing registry never spawns')
    const now = await scheduler.schedule('plain-now')
    check(now.kind === 'scheduled', 'a plain now request still works without any registry')
    await sleep(80)
    check(captured.spawns.length === 1, 'the plain now request still spawns')
    scheduler.dispose()
  }

  {
    // An idle host restarts immediately in when-idle mode.
    const { scheduler, captured } = makeScheduler({ agents: makeAgents(['idle', 'idle']), delayMs: 20 })
    const result = await scheduler.schedule('already-idle', 'when-idle')
    check(result.kind === 'scheduled', 'when-idle on an idle host arms immediately (got ' + result.kind + ')')
    await sleep(80)
    check(captured.spawns.length === 1, 'the immediate when-idle restart spawns')
    scheduler.dispose()
  }

  // -------------------------------------------------------------------------
  console.log('\n[9/10] dispose and determinism')

  {
    const { scheduler, captured } = makeScheduler({ delayMs: 40 })
    const accepted = await scheduler.schedule('dispose-before-delay')
    check(accepted.kind === 'scheduled', 'accepted before dispose')
    scheduler.dispose()
    await sleep(90)
    check(captured.spawns.length === 0, 'dispose after acceptance prevents the delayed spawn')
    const again = await scheduler.schedule('after-dispose')
    check(again.kind === 'error', 'a disposed scheduler refuses new requests')
  }

  {
    const { scheduler, captured } = makeScheduler({ agents: makeAgents(['running']), delayMs: 20, pollMs: 15 })
    await scheduler.schedule('dispose-queued', 'when-idle')
    scheduler.dispose()
    await sleep(120)
    check(captured.spawns.length === 0, 'dispose drops a queued restart')
  }

  // -------------------------------------------------------------------------
  console.log('\n[10/10] race probes for dispose and stale flag cleanup')
  {
    const [race1Run, race2Run, race3Run] = await Promise.all([
      runProbe(race1ProbeCode),
      runProbe(race2ProbeCode),
      runProbe(writeDisposeProbeCode),
    ])
    const denied = race1Run.denied === true || race2Run.denied === true || race3Run.denied === true
    if (denied) {
      // The probes start a grandchild node process; a confined sandbox forbids
      // that. Say so loudly instead of inventing a pass or a failure.
      console.log('  SKIP race probes: this sandbox forbids starting a child node process (spawn EPERM)')
      console.log('       run `npm run test:host` from an unrestricted shell to cover them')
    } else {
      const race1 = race1Run.observed?.race1
      const race2 = race2Run.observed?.race2
      const race3 = race3Run.observed?.writeDispose
      if (!race1 || !race2 || !race3) {
        const tail = (stderr) => String(stderr).split('\n').filter(Boolean).slice(-5).join(' | ')
        console.log('  probe stderr race1: ' + tail(race1Run.stderr))
        console.log('  probe stderr race2: ' + tail(race2Run.stderr))
        console.log('  probe stderr race3: ' + tail(race3Run.stderr))
      }
      check(
        race1?.routeStarted === true && race2?.firstStatus === 202 && race2?.flagReadObserved === true && race3?.writeStarted === true,
        'race probes reached the public route, blocked the stale read, and paused a flag write (route=' + race1?.routeStarted + ', first=' + race2?.firstStatus + ', read=' + race2?.flagReadObserved + ', write=' + race3?.writeStarted + ')',
      )
      check(
        race1?.spawnsAfterDispose === 0,
        'dispose after boot initialization cannot install a late timer (spawns=' + race1?.spawnsAfterDispose + ')',
      )
      check(
        race3?.responseStatus === 500,
        'dispose during flag write returns a controlled 500 (got ' + race3?.responseStatus + ')',
      )
      check(
        race3?.spawnsAfterDispose === 0,
        'dispose during flag write leaves no timer (spawns=' + race3?.spawnsAfterDispose + ')',
      )
      check(
        race3?.flagAfter3s === false,
        'dispose during flag write clears the attempt flag (flag=' + race3?.flagAfter3s + ')',
      )
      check(
        race2?.duringCleanupStatus === 409,
        'cleanup keeps single-flight: duplicate during cleanup is 409 (got ' + race2?.duringCleanupStatus + ')',
      )
      check(
        race2?.afterCleanupStatus === 202,
        'retry after cleanup is accepted with 202 (got ' + race2?.afterCleanupStatus + ')',
      )
      check(
        (race1Run.observed?.unhandled ?? 1) === 0 && (race2Run.observed?.unhandled ?? 1) === 0 && (race3Run.observed?.unhandled ?? 1) === 0,
        'race probes have no unhandled rejections (race1=' + race1Run.observed?.unhandled + ', race2=' + race2Run.observed?.unhandled + ', race3=' + race3Run.observed?.unhandled + ')',
      )
    }
  }

  {
    const app = await makeApp()
    let held
    const responsePromise = new Promise((resolve, reject) => {
      held = httpRequest({
        hostname: '127.0.0.1',
        port: app.port,
        method: 'POST',
        path: '/api/restart-dsh',
        headers: { 'content-type': 'application/json', 'content-length': '2' },
      }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
      })
      held.once('error', reject)
      held.write('{')
    })
    await sleep(30)
    for (const effect of app.captured.effects.slice().reverse()) {
      try { await effect.cleanup?.() } catch { /* cleanup is best effort */ }
    }
    held.end('}')
    const response = await responsePromise.catch((error) => ({ status: 'request-error', text: String(error) }))
    check(response.status === 500, 'readBody race: dispose during readBody returns a controlled 500 (got ' + response.status + ')')
    await sleep(3300)
    check(app.captured.spawns.length === 0, 'dispose while reading the request body cannot install a late timer (spawns=' + app.captured.spawns.length + ')')
    await app.close()
  }

  check(unhandled.length === 0, 'no unhandled rejections (got ' + unhandled.length + ')')
} finally {
  cleanupRoots()
}

console.log('\n' + (checks - failed) + '/' + checks + ' checks passed')
process.exit(failed === 0 ? 0 : 1)
