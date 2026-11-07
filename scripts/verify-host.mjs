/**
 * Host-half verification for the minimal systemd restart surface.
 *
 * Exercises the public HTTP route registered by apply(ctx) against a real
 * loopback HTTP server. Every subprocess.spawn is a hard stub; every
 * DSH_HOME is a throwaway directory/file created by this script.
 *
 * Run with npm run test:host after npm run build.
 */
import { createServer, request as httpRequest } from 'node:http'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const importHome = mkdtempSync(join(tmpdir(), 'dsh-restart-host-import-'))
process.env.DSH_HOME = importHome
const { apply, inject } = await import('../lib/index.js')

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

function makeCtx(spawnImpl) {
  const captured = { routes: [], spawns: [], logs: [], effects: [] }
  const logger = {
    info: (message) => captured.logs.push({ level: 'info', message }),
    warn: (message) => captured.logs.push({ level: 'warn', message }),
    error: (message) => captured.logs.push({ level: 'error', message }),
  }
  const ctx = {
    logger,
    on: () => () => undefined,
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
      spawn(options) {
        captured.spawns.push(options)
        return spawnImpl ? spawnImpl(options) : { done: Promise.resolve({ exitCode: 0, signal: null }) }
      },
    },
  }
  return { ctx, captured }
}

async function makeApp(options = {}) {
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'dsh-restart-host-'))
  roots.push(root)
  const home = options.home ?? root
  process.env.DSH_HOME = home
  const { ctx, captured } = makeCtx(options.spawn)
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
  const body = options.body ?? (method === 'GET' || method === 'HEAD' ? undefined : '{}')
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

function runProbe(code) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', code], {
      cwd: process.cwd(),
      maxBuffer: 2 * 1024 * 1024,
      timeout: 30_000,
    }, (error, stdout, stderr) => {
      let observed
      try { observed = JSON.parse(stdout.trim()) } catch { observed = undefined }
      resolve({ error, observed, stderr })
    })
  })
}

// The probe children use a temporary fs mock only; the plugin still runs
// through apply(ctx), the public HTTP route, and the subprocess stub.
const race1ProbeCode = String.raw`import * as realFs from 'node:fs/promises'
import { mock } from 'node:test'
import http from 'node:http'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
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
  console.log('\n[1/8] declaration and public route wiring')

  check(inject.join(',') === 'webServer,subprocess', 'inject declares only webServer,subprocess (got ' + JSON.stringify([...inject]) + ')')

  {
    const app = await makeApp()
    check(app.captured.routes.length === 1, 'apply registers exactly one route')
    check(app.captured.routes[0]?.kind === 'exact', 'route uses exact matching')
    check(app.captured.routes[0]?.path === '/api/restart-dsh', 'route path is /api/restart-dsh')
    await app.close()
  }

  // -------------------------------------------------------------------------
  console.log('\n[2/8] security and request-shape checks')

  {
    const app = await makeApp()
    const get = await request(app.port, { method: 'GET' })
    check(get.status === 405, 'GET is refused with 405 (got ' + get.status + ')')

    const wrongType = await request(app.port, { headers: { 'content-type': 'text/plain' } })
    check(wrongType.status === 415, 'non-JSON content-type is refused with 415 (got ' + wrongType.status + ')')

    const evilHost = await request(app.port, { headers: { host: 'evil.example' } })
    check(evilHost.status === 403, 'non-loopback Host is refused with 403 (got ' + evilHost.status + ')')

    const crossSite = await request(app.port, { headers: { 'sec-fetch-site': 'cross-site' } })
    check(crossSite.status === 403, 'cross-site fetch metadata is refused with 403 (got ' + crossSite.status + ')')

    const evilOrigin = await request(app.port, { headers: { origin: 'http://evil.example' } })
    check(evilOrigin.status === 403, 'foreign Origin is refused with 403 (got ' + evilOrigin.status + ')')

    const invalidJson = await request(app.port, { body: '{not json' })
    check(invalidJson.status === 400, 'malformed JSON is a controlled 400 (got ' + invalidJson.status + ')')

    const tooLarge = await request(app.port, { body: 'x'.repeat((1 << 20) + 1) })
    check(tooLarge.status === 413, 'oversized body is a controlled 413 (got ' + tooLarge.status + ')')

    const accepted = await request(app.port, { body: JSON.stringify({ reason: 'test' }) })
    check(accepted.status === 202, 'valid POST is accepted with 202 (got ' + accepted.status + ')')
    check(accepted.json?.scheduled === true, '202 body carries scheduled:true')
    check(accepted.json?.delayMs === 3000, '202 body carries delayMs=3000 (got ' + accepted.json?.delayMs + ')')
    check(app.captured.spawns.length === 0, 'no spawn happens during the HTTP response')
    await app.close()
  }

  // -------------------------------------------------------------------------
  console.log('\n[3/8] single-flight and the fixed systemd argv')

  {
    const app = await makeApp()
    const first = await request(app.port, { body: JSON.stringify({ reason: 'first' }) })
    const second = await request(app.port, { body: JSON.stringify({ reason: 'second' }) })
    check(first.status === 202, 'first request is 202 (got ' + first.status + ')')
    check(second.status === 409, 'duplicate while in flight is 409 (got ' + second.status + ')')
    check(second.json?.error === 'already-scheduled', '409 body names already-scheduled')
    check(app.captured.spawns.length === 0, 'duplicate did not spawn early')
    await app.close()
    check(app.captured.spawns.length === 0, 'dispose before the delay prevents spawn')
  }

  {
    const app = await makeApp()
    const started = Date.now()
    const response = await request(app.port, { body: JSON.stringify({ reason: 'timer' }) })
    check(response.status === 202, 'scheduled response is 202')
    check(app.captured.spawns.length === 0, 'spawn is delayed, not synchronous')
    await sleep(1200)
    check(app.captured.spawns.length === 0, 'no spawn after 1.2s')
    await sleep(2200)
    check(app.captured.spawns.length === 1, 'exactly one spawn after ~3s (got ' + app.captured.spawns.length + ')')
    const spawn = app.captured.spawns[0]
    check(JSON.stringify(spawn?.argv) === JSON.stringify(['systemctl', '--user', 'restart', 'dsh-web']), 'argv is the fixed systemctl call (got ' + JSON.stringify(spawn?.argv) + ')')
    check(spawn?.cwd === process.cwd(), 'cwd is the plugin process cwd (got ' + spawn?.cwd + ')')
    check(spawn?.stdio?.stdin === 'ignore', 'stdin is ignored')
    check(spawn?.stdio?.stdout === 'inherit', 'stdout is inherited')
    check(spawn?.stdio?.stderr === 'inherit', 'stderr is inherited')
    check(spawn?.graceMs === 10_000, 'graceMs is 10000 (got ' + spawn?.graceMs + ')')
    check(Date.now() - started >= 3000, 'the spawn waited for the 3000ms delay')
    await sleep(50)
    check(app.captured.logs.some((entry) => entry.message.includes('spawning restart')), 'spawn is logged')
    check(app.captured.logs.some((entry) => entry.message.includes('restart process exited')), 'done outcome is logged')
    await app.close()
  }

  // -------------------------------------------------------------------------
  console.log('\n[4/8] boot flag suppression and legacy cleanup')

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
  console.log('\n[5/8] flag-write failure is a real 500 and does not spawn')

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
  console.log('\n[6/8] platform rejection and spawn failure visibility')

  {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const app = await makeApp()
      const response = await request(app.port, { body: '{}' })
      check(response.status === 501, 'non-Linux is rejected with 501 (got ' + response.status + ')')
      check(response.json?.error === 'unsupported-platform', '501 body names unsupported-platform')
      check(app.captured.spawns.length === 0, 'non-Linux never spawns')
      await app.close()
    } finally {
      if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor)
    }
  }

  {
    const app = await makeApp({ spawn: () => { throw new Error('spawn boom') } })
    const response = await request(app.port, { body: '{}' })
    check(response.status === 202, 'spawn throw still happens after a 202')
    await sleep(3300)
    check(app.captured.logs.some((entry) => entry.level === 'error' && entry.message.includes('could not spawn')), 'spawn throw is logged as an error')
    check(app.captured.spawns.length === 1, 'the throwing spawn was attempted once')
    await app.close()
  }

  {
    const app = await makeApp({ spawn: () => ({ done: Promise.reject(new Error('done boom')) }) })
    const response = await request(app.port, { body: '{}' })
    check(response.status === 202, 'done rejection still happens after a 202')
    await sleep(3300)
    check(app.captured.logs.some((entry) => entry.level === 'warn' && entry.message.includes('restart process failed')), 'done rejection is logged as a warning')
    await app.close()
  }

  {
    const app = await makeApp({ spawn: () => ({ done: Promise.resolve({ exitCode: 2, signal: null }) }) })
    const response = await request(app.port, { body: '{}' })
    check(response.status === 202, 'non-zero exit still happens after a 202')
    await sleep(3300)
    check(app.captured.logs.some((entry) => entry.level === 'warn' && entry.message.includes('code=2')), 'non-zero exit is logged as a warning')
    check(!existsSync(join(app.home, 'dsh-restart.flag')), 'a failed spawn clears its own flag')
    await app.close()
  }

  // -------------------------------------------------------------------------
  console.log('\n[7/8] dispose and process-level rejection hygiene')

  {
    const app = await makeApp()
    const response = await request(app.port, { body: '{}' })
    check(response.status === 202, 'accepted before dispose')
    await app.close()
    await sleep(3300)
    check(app.captured.spawns.length === 0, 'dispose after acceptance prevents the delayed spawn')
  }

  // -------------------------------------------------------------------------
  console.log('\n[8/8] race probes for dispose and stale flag cleanup')
  {
    const [race1Run, race2Run, race3Run] = await Promise.all([
      runProbe(race1ProbeCode),
      runProbe(race2ProbeCode),
      runProbe(writeDisposeProbeCode),
    ])
    const race1 = race1Run.observed?.race1
    const race2 = race2Run.observed?.race2
    const race3 = race3Run.observed?.writeDispose
    if (!race1 || !race2 || !race3) {
      const tail = (stderr) => stderr.split('\n').filter(Boolean).slice(-5).join(' | ')
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
