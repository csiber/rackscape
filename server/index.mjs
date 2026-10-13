#!/usr/bin/env node
// Rackscape server: serves the built UI and /api/snapshot from Proxmox.
// Zero dependencies — Node 18+.
//
//   PVE_URL=https://pve.lan:8006 PVE_TOKEN='rackscape@pve!view=<uuid>' node server/index.mjs
//
// The API token never reaches the browser; the UI only sees the snapshot.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { timingSafeEqual } from 'node:crypto'
import { createProxmoxSource } from './proxmox.mjs'

const env = process.env
const PORT = Number(env.PORT ?? 8080)
const HOST = env.HOST ?? '0.0.0.0'
const ROOT = path.resolve(env.STATIC_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'))
const CACHE_MS = Number(env.CACHE_MS ?? 2000)
const AUTH = env.BASIC_AUTH ? Buffer.from(`Basic ${Buffer.from(env.BASIC_AUTH).toString('base64')}`) : null

const source = env.PVE_URL
  ? createProxmoxSource({
      url: env.PVE_URL,
      token: env.PVE_TOKEN ?? '',
      insecure: env.PVE_INSECURE === '1' || env.PVE_INSECURE === 'true',
      ca: env.PVE_CA ? fs.readFileSync(env.PVE_CA) : undefined,
      name: env.CLUSTER_NAME,
    })
  : null

if (source && !env.PVE_TOKEN) console.warn('[rackscape] PVE_URL set but PVE_TOKEN is empty — requests will fail')
if (!source) console.log('[rackscape] no PVE_URL — the UI will run in demo mode')

// One snapshot shared by every viewer, refreshed at most every CACHE_MS.
let cached = null
let cachedAt = 0
let inflight = null
let lastError = ''
async function getSnapshot() {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached
  inflight ??= source()
    .then((s) => {
      cached = s
      cachedAt = Date.now()
      lastError = ''
      return s
    })
    .catch((e) => {
      lastError = String(e.message ?? e)
      console.error('[rackscape]', lastError)
      if (cached) return cached // keep serving the last good one; the UI marks it stale
      throw e
    })
    .finally(() => (inflight = null))
  return inflight
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
}

function authorized(req) {
  if (!AUTH) return true
  const got = Buffer.from(req.headers.authorization ?? '')
  return got.length === AUTH.length && timingSafeEqual(got, AUTH)
}

function send(res, status, body, type, extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extra })
  res.end(body)
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x')
  let rel = decodeURIComponent(url.pathname)
  if (rel.endsWith('/')) rel += 'index.html'
  const file = path.resolve(ROOT, '.' + path.posix.normalize(rel))
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'forbidden', 'text/plain')
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback
      return fs.readFile(path.join(ROOT, 'index.html'), (e2, html) =>
        e2 ? send(res, 404, 'not found — run `npm run build` first', 'text/plain') : send(res, 200, html, MIME['.html'], { 'Cache-Control': 'no-cache' }),
      )
    }
    const immutable = rel.startsWith('/assets/')
    send(res, 200, data, MIME[path.extname(file)] ?? 'application/octet-stream', {
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
  })
}

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) return send(res, 401, 'auth required', 'text/plain', { 'WWW-Authenticate': 'Basic realm="rackscape"' })
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain')

  const { pathname } = new URL(req.url, 'http://x')
  if (pathname === '/api/snapshot') {
    if (!source) return send(res, 404, JSON.stringify({ error: 'no data source configured' }), MIME['.json'])
    try {
      return send(res, 200, JSON.stringify(await getSnapshot()), MIME['.json'], { 'Cache-Control': 'no-store' })
    } catch {
      return send(res, 502, JSON.stringify({ error: lastError }), MIME['.json'])
    }
  }
  if (pathname === '/healthz') return send(res, 200, JSON.stringify({ ok: true, source: source ? 'proxmox' : 'demo', lastError }), MIME['.json'])
  serveStatic(req, res)
})

server.listen(PORT, HOST, () => console.log(`[rackscape] http://${HOST}:${PORT}  (static: ${ROOT})`))
