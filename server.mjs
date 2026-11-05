// Local dev server: serves the game and runs the same API handler as the Vercel Functions (api/_core.mjs).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, sep } from 'node:path';
import { handle, fail } from './api/_core.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8123);
const origin = new URL(process.env.PUBLIC_ORIGIN || `http://localhost:${port}`);
const limits = new Map();
function limit(req, kind, max) {
  // ponytail: in-process rate limits, use a shared edge limiter before running multiple replicas.
  const now = Date.now(), key = `${req.socket.remoteAddress}:${kind}`;
  const item = limits.get(key);
  if (!item || item.until < now) limits.set(key, { n: 1, until: now + 60000 });
  else if (++item.n > max) throw fail('Too many requests. Try again in a minute.', 429);
}
setInterval(() => { const now = Date.now(); for (const [key, item] of limits) if (item.until < now) limits.delete(key); }, 60000).unref();
async function body(req) {
  let bytes = 0; const parts = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 3_000_000) throw fail('Replay is too large.', 413); parts.push(chunk); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw fail('Invalid JSON.'); }
}
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/')) {
      limit(req, 'api', 120);
      if (req.method === 'POST' && req.headers.origin !== origin.origin) throw fail('Request origin not allowed.', 403);
      const data = req.method === 'POST' ? await body(req) : undefined;
      return json(res, 200, await handle(url.pathname.slice(5), req.method, data, `http://127.0.0.1:${port}`));
    }
    if (!['GET', 'HEAD'].includes(req.method)) throw fail('Method not allowed.', 405);
    const allowed = { '/': 'index.html', '/index.html': 'index.html', '/game.mjs': 'game.mjs', '/game-core.mjs': 'game-core.mjs', '/haunt.mjs': 'haunt.mjs', '/token': 'token.html', '/token.html': 'token.html', '/assets/brand/wick-runner/skyline-art.png': 'assets/brand/wick-runner/skyline-art.png', '/vendor/privy.js': 'vendor/privy.js', '/brand/preview.png': 'assets/brand/wick-runner/og-2400x1260.png', '/assets/brand/wick-runner/og-2400x1260.png': 'assets/brand/wick-runner/og-2400x1260.png' };
    let path = allowed[url.pathname];
    if (url.pathname.startsWith('/vendor/three/')) {
      const relative = decodeURIComponent(url.pathname.slice(14));
      if (!/^(build|examples\/jsm)\/[A-Za-z0-9_./-]+\.js$/.test(relative) || relative.split('/').includes('..')) throw fail('Not found.', 404);
      path = 'node_modules/three/' + relative;
    }
    if (/^\/audio\/[a-z0-9_]+\.(mp3|json)$/.test(url.pathname)) path = url.pathname.slice(1); // game sounds (flat folder, no traversal)
    if (url.pathname === '/vendor/ethers.js') path = 'node_modules/ethers/dist/ethers.min.js';
    if (!path) throw fail('Not found.', 404);
    const absolute = resolve(root, path); if (!absolute.startsWith(root + sep)) throw fail('Not found.', 404);
    let content; try { content = await readFile(absolute); } catch { throw fail('Not found.', 404); }
    if (path === 'index.html' || path === 'game.mjs') content = Buffer.from(content.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/', '/vendor/three/').replaceAll('https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.min.js', '/vendor/ethers.js'));
    if (path === 'index.html') content = Buffer.from(content.toString().replaceAll('content="/assets/brand/wick-runner/og-2400x1260.png"', `content="${origin.origin}/assets/brand/wick-runner/og-2400x1260.png"`));
    res.writeHead(200, { 'Content-Type': path.endsWith('.png') ? 'image/png' : path.endsWith('.mp3') ? 'audio/mpeg' : path.endsWith('.json') ? 'application/json' : path.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': path.startsWith('node_modules') || path.endsWith('.mp3') ? 'public, max-age=86400' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (e) { if (!res.headersSent) json(res, e.status || 400, { error: e.status ? e.message : 'Request could not be completed.' }); else res.end(); if (!e.status) console.error(e); }
});
server.requestTimeout = 30000;
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Wick Runner: ${origin.origin}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { server.close(); process.exit(); });
