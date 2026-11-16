#!/usr/bin/env node
/**
 * Temporary browser fixture for the restart button.
 *
 * Serves a static React page plus a mock /api/restart-dsh that implements the
 * three-method contract (POST schedule, GET status, DELETE cancel) so the two
 * restart modes and the queued card can be driven from a browser. It never
 * talks to the real DSH, never starts systemctl or PowerShell, and never opens
 * the current GUI.
 * Usage: npm run fixture  (binds an ephemeral port on 0.0.0.0)
 */
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp } from 'node:fs/promises'
import { readFileSync } from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// A prebuilt bundle lets the fixture run where the esbuild binary cannot be
// started (for example a confined sandbox): pass FIXTURE_BUNDLE=<file> built by
// `esbuild scripts/ui-fixture-entry.tsx --bundle --format=iife --platform=browser --jsx=automatic`.
const prebuilt = process.env.FIXTURE_BUNDLE
let bundlePath
if (prebuilt) {
  bundlePath = path.resolve(prebuilt)
} else {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-restart-ui-fixture-'))
  bundlePath = path.join(outDir, 'fixture.js')
  // Imported lazily so a prebuilt bundle needs no esbuild at all.
  const esbuild = await import('esbuild')
  await esbuild.build({
    entryPoints: [path.join(root, 'scripts', 'ui-fixture-entry.tsx')],
    outfile: bundlePath,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'warning',
  })
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-restart-systemd UI fixture</title>
<style>
  :root {
    --dsw-alias-border-l2: #d8dce3;
    --dsw-alias-bg-layer-2: #ffffff;
    --dsw-alias-bg-layer-3: #ffffff;
    --dsw-alias-label-primary: #1f2329;
    --dsw-alias-label-secondary: #4e5969;
    --dsw-alias-label-tertiary: #86909c;
    --dsw-alias-label-error: #d54941;
    --dsw-alias-interactive-bg-hover: #eef0f3;
    --dsw-alias-interactive-bg-active: #e3e6ea;
    --dsw-alias-brand-primary: #3370ff;
    --dsw-shadow-lv3: 0 12px 32px rgba(31, 35, 41, 0.18);
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #f6f7f9; font: 14px/1.5 system-ui, sans-serif; }
  #stage { min-height: 100vh; display: flex; align-items: flex-start; justify-content: flex-start; padding: 24px; }
  .rail { width: 56px; min-height: calc(100vh - 48px); background: #fff; justify-content: center; align-items: flex-start; padding-top: 120px; padding-bottom: 16px; }
  .wide { width: min(420px, calc(100vw - 48px)); min-height: 160px; background: #fff; justify-content: center; align-items: flex-start; padding-top: 120px; padding-bottom: 16px; }
  .caption { position: fixed; top: 16px; left: 16px; color: #4e5969; font-size: 12px; }
</style>
</head>
<body>
<div id="stage"></div>
<div class="caption" id="caption"></div>
<script src="/fixture.js"></script>
</body>
</html>`

/** Scenario for POST: auto | 202 | queued | 409 | 429 | 403 | 501 | 500 | hang | close */
let mode = '202'
/** Running-session count the mock reports; with auto mode this decides queueing. */
let waiting = 1
let count = 0
let lastReason = ''
let lastMode = ''
let requests = []
/** Whether a queued restart is currently held by the mock host. */
let queued = null
/** How many cancels the mock has served, so the client cannot fake a cancel. */
let deletes = 0

function send(res, status, body, type = 'application/json') {
  const payload = Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(payload)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://fixture.local')

  if (url.pathname === '/' || url.pathname === '/index.html') {
    send(res, 200, html, 'text/html; charset=utf-8')
    return
  }
  if (url.pathname === '/fixture.js') {
    send(res, 200, readFileSync(bundlePath), 'text/javascript; charset=utf-8')
    return
  }
  if (url.pathname === '/__mode') {
    // Reset runs first so a caller can clear counters and then seed a queue.
    if (url.searchParams.get('reset') === '1') { count = 0; deletes = 0; requests = []; queued = null }
    if (url.searchParams.get('mode') !== null) mode = url.searchParams.get('mode')
    if (url.searchParams.get('waiting') !== null) waiting = Number(url.searchParams.get('waiting'))
    if (url.searchParams.get('queued') === '1') queued = { reason: 'seeded', requestedAt: Date.now(), waitingForSessions: waiting }
    send(res, 200, { mode, count, deletes, waiting, queued })
    return
  }
  if (url.pathname === '/__state') {
    send(res, 200, { mode, count, deletes, lastReason, lastMode, requests, waiting, queued })
    return
  }
  if (url.pathname === '/__sessions') {
    // Simulate the last running session finishing. With clear=1 the host also
    // fires the queued restart, so the queue is gone and GET reports null.
    waiting = Number(url.searchParams.get('waiting') ?? 0)
    if (url.searchParams.get('clear') === '1') queued = null
    send(res, 200, { waiting, queued })
    return
  }
  if (url.pathname === '/api/restart-dsh') {
    if (req.method === 'GET') {
      send(res, 200, { queued: queued ?? null, armed: false })
      return
    }
    if (req.method === 'DELETE') {
      deletes += 1
      const cancelled = queued !== null
      queued = null
      send(res, 200, { cancelled })
      return
    }
    if (req.method !== 'POST') {
      send(res, 405, { error: 'method-not-allowed' })
      return
    }
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      count += 1
      try {
        const body = JSON.parse(raw)
        lastReason = body.reason || ''
        lastMode = body.mode || ''
      } catch {
        lastReason = ''
        lastMode = ''
      }
      requests.push({ at: Date.now(), mode, reason: lastReason, requested: lastMode })
      if (mode === 'hang') return
      if (mode === 'close') { req.socket.destroy(); return }
      if (mode === 'auto') {
        // Mirrors the host: when-idle queues only while sessions are running,
        // and an idle host fires immediately; restart-now always fires now.
        if (lastMode === 'when-idle' && waiting > 0) {
          queued = { reason: lastReason, requestedAt: Date.now(), waitingForSessions: waiting }
          send(res, 202, { scheduled: true, queued: true, waitingForSessions: waiting })
          return
        }
        send(res, 202, { scheduled: true, delayMs: 3000 })
        return
      }
      if (mode === 'queued') {
        queued = { reason: lastReason, requestedAt: Date.now(), waitingForSessions: waiting }
        send(res, 202, { scheduled: true, queued: true, waitingForSessions: waiting })
        return
      }
      if (mode === '202') { send(res, 202, { scheduled: true, delayMs: 3000 }); return }
      if (mode === '409') { send(res, 409, { error: 'already-scheduled' }); return }
      if (mode === '429') { send(res, 429, { error: 'suppressed' }); return }
      if (mode === '403') { send(res, 403, { error: 'forbidden: loopback-only' }); return }
      if (mode === '501') { send(res, 501, { error: 'unsupported-platform' }); return }
      send(res, 500, { error: 'restart-failed' })
    })
    return
  }
  send(res, 404, { error: 'not-found' })
})

server.listen(0, '0.0.0.0', () => {
  const port = server.address().port
  const nets = os.networkInterfaces()
  let wslIp = '127.0.0.1'
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) wslIp = net.address
    }
  }
  console.log('FIXTURE_URL http://' + wslIp + ':' + port + '/')
  console.log('FIXTURE_LOCAL http://127.0.0.1:' + port + '/')
})
