#!/usr/bin/env node
/**
 * Temporary browser fixture for the restart button.
 *
 * Serves a static React page plus a mock POST /api/restart-dsh. It never talks
 * to the real DSH, never starts systemctl, and never opens the current GUI.
 * Usage: npm run fixture  (binds an ephemeral port on 0.0.0.0)
 */
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import * as esbuild from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-restart-ui-fixture-'))
const bundlePath = path.join(outDir, 'fixture.js')

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

let mode = '202'
let count = 0
let lastReason = ''
let requests = []

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
    mode = url.searchParams.get('mode') || '202'
    if (url.searchParams.get('reset') === '1') { count = 0; requests = [] }
    send(res, 200, { mode, count })
    return
  }
  if (url.pathname === '/__state') {
    send(res, 200, { mode, count, lastReason, requests })
    return
  }
  if (url.pathname === '/api/restart-dsh') {
    if (req.method !== 'POST') {
      send(res, 405, { error: 'method-not-allowed' })
      return
    }
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      count += 1
      try { lastReason = JSON.parse(raw).reason || '' } catch { lastReason = '' }
      requests.push({ at: Date.now(), mode, reason: lastReason })
      if (mode === 'hang') return
      if (mode === 'close') { req.socket.destroy(); return }
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
