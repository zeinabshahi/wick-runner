import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { verifyMessage, Wallet, AbiCoder, keccak256, id as hashText, getBytes, JsonRpcProvider, Interface } from 'ethers';
// On-chain records: the verifier key signs each verified run so the player can record it on WickRunnerScores
// (contracts/). The database stays the source of truth; the chain is the player's public proof. Both use the same
// ranking (best per wallet, highest first, earlier record wins a tie) and the same ban list (contracts/admin.mjs).
const VERIFIER = process.env.VERIFIER_KEY ? new Wallet(process.env.VERIFIER_KEY) : null, SCORES = process.env.SCORES_ADDRESS?.toLowerCase();
const RPC = process.env.CHAIN_RPC || 'https://rpc.testnet.chain.robinhood.com', CHAIN_ID = 46630, ATTEST_TTL = 7 * 86400;
const runEvent = new Interface(['event Run(address indexed player, bytes32 indexed board, uint64 score, bytes32 indexed runId, bool newBest)']);
let chain = null; const provider = () => chain ||= new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
function attest(wallet, board, score, scoreId) {
  if (!VERIFIER || !SCORES) return null;
  const b = hashText(board), r = hashText(scoreId), deadline = Math.floor(Date.now() / 1000) + ATTEST_TTL;
  const h = keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'address', 'address', 'bytes32', 'uint64', 'bytes32', 'uint64'], [CHAIN_ID, SCORES, wallet, b, score, r, deadline]));
  return { board: b, score, runId: r, deadline, sig: VERIFIER.signMessageSync(getBytes(h)) };
}
import { chromium } from 'playwright';
import { RULES_VERSION, validateRunLog, weekId, utcDay } from './game-core.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8123);
const origin = new URL(process.env.PUBLIC_ORIGIN || `http://localhost:${port}`);
const dataDir = resolve(process.env.DATA_DIR || resolve(root, 'data'));
await mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(resolve(dataDir, 'parkour.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, wallet TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS challenges (token TEXT PRIMARY KEY, wallet TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, board TEXT NOT NULL, course TEXT NOT NULL, week TEXT NOT NULL, cup INTEGER NOT NULL, started INTEGER NOT NULL, used INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS scores (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, board TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL, time REAL NOT NULL, cleared INTEGER NOT NULL, log TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS score_board ON scores(board, score DESC);
  CREATE INDEX IF NOT EXISTS cup_attempts ON attempts(wallet, week, cup);
  CREATE TABLE IF NOT EXISTS banned (wallet TEXT PRIMARY KEY, reason TEXT, created INTEGER NOT NULL);`);
for (const col of ['tx TEXT', 'pos INTEGER']) try { db.exec('ALTER TABLE scores ADD COLUMN ' + col); } catch {} // on-chain tx and its order (block * 1e5 + log index); older databases lack them
const isBanned = w => !!db.prepare('SELECT 1 FROM banned WHERE wallet=?').get(w);
// Leaderboard: best per wallet, earlier record wins a tie, banned wallets hidden; onchain=1 counts only recorded runs (same as the contract's top()).
const boardQuery = onchain => { const t = onchain ? 'pos' : 'created'; return db.prepare(`SELECT s.name, s.score, s.wallet FROM scores s
  WHERE s.board=? ${onchain ? 'AND s.tx IS NOT NULL' : ''} AND s.wallet NOT IN (SELECT wallet FROM banned)
  AND NOT EXISTS (SELECT 1 FROM scores o WHERE o.board=s.board AND o.wallet=s.wallet ${onchain ? 'AND o.tx IS NOT NULL' : ''}
    AND (o.score > s.score OR (o.score = s.score AND (o.${t} < s.${t} OR (o.${t} = s.${t} AND o.id < s.id)))))
  ORDER BY s.score DESC, s.${t} ASC, s.id ASC LIMIT 10`); };
const random = () => randomBytes(32).toString('hex');
const hash = s => createHash('sha256').update(s).digest('hex');
const address = s => /^0x[0-9a-f]{40}$/i.test(s || '');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const limits = new Map();
function limit(req, kind, max) {
  // ponytail: in-process rate limits, use a shared edge limiter before running multiple replicas.
  const now = Date.now(), key = `${req.socket.remoteAddress}:${kind}`;
  const item = limits.get(key);
  if (!item || item.until < now) limits.set(key, { n: 1, until: now + 60000 });
  else if (++item.n > max) throw fail('Too many requests. Try again in a minute.', 429);
}
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of limits) if (item.until < now) limits.delete(key);
  for (const table of ['sessions', 'challenges']) db.prepare(`DELETE FROM ${table} WHERE expires < ?`).run(now);
}, 60000).unref();
function cookie(req, name) { return (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || ''; }
function session(req) {
  const row = db.prepare('SELECT wallet FROM sessions WHERE token=? AND expires>?').get(hash(cookie(req, 'cp_session')), Date.now());
  if (!row) throw fail('Sign in to submit a ranked run.', 401);
  return row.wallet;
}
function setCookie(res, name, value, seconds) { res.setHeader('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${origin.protocol === 'https:' ? '; Secure' : ''}`); }
async function body(req) {
  let bytes = 0; const parts = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 3_000_000) throw fail('Replay is too large.', 413); parts.push(chunk); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw fail('Invalid JSON.'); }
}
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
function currentCourse(course) {
  if (!course || !['TRAIN', 'CP01', 'CP02', 'CP03', 'CP04', 'DAILY', 'CUP', 'SPRINT', 'HAUNT', 'ARENA'].includes(course.sym)) throw fail('Unknown chart.');
  if (JSON.stringify(course).length > 14000 || !Number.isSafeInteger(course.seed)) throw fail('Invalid course configuration.');
  if (course.sym === 'SPRINT' && (!Number.isInteger(course.route ?? 0) || (course.route ?? 0) < 0 || (course.route ?? 0) > 2)) throw fail('Invalid Sprint route.');
  if (course.sym === 'DAILY' && course.seed !== +utcDay().replace(/-/g, '')) throw fail('The daily chart changed. Start a new run.');
  if (course.sym === 'CUP' && course.period !== weekId()) throw fail('The Cup changed. Start a new run.');
  if (course.sym === 'ARENA' && course.arena?.e && course.arena.e <= Date.now()) throw fail('This campaign ended. Practice is still available.');
}

let browser, busy = false;
const localBrowser = process.env.CHROME_PATH || (process.platform === 'win32' ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) : undefined);
async function verify(log) {
  if (busy) throw fail('The verifier is busy. Try submitting again shortly.', 503);
  busy = true; let context;
  try {
    browser ||= await chromium.launch({ ...(localBrowser ? { executablePath: localBrowser } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    // Trusted local game only; all dependencies are served locally for verification.
    await context.route('**/*', route => new URL(route.request().url()).origin === `http://127.0.0.1:${port}` ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    await page.goto(`http://127.0.0.1:${port}/?verify=1`);
    await page.waitForFunction(() => !!window.__cp);
    return await page.evaluate(log => window.__cp.replayRun(log), log);
  } finally { await context?.close(); busy = false; }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/')) {
      limit(req, 'api', 120);
      if (req.method === 'POST' && req.headers.origin !== origin.origin) throw fail('Request origin not allowed.', 403);
      if (req.method === 'GET' && url.pathname === '/api/status') {
        let wallet = null; try { wallet = session(req); } catch {}
        return json(res, 200, { online: true, wallet, rules: RULES_VERSION, privy: process.env.PRIVY_APP_ID || null, scores: SCORES || null });
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/challenge') {
        limit(req, 'auth', 12); const { wallet } = await body(req); if (!address(wallet)) throw fail('Invalid wallet.');
        const token = random(), nonce = random().slice(0, 24), now = new Date();
        const message = `${origin.host} wants you to sign in with your Ethereum account:\n${wallet}\n\nSign in to Wick Runner ranked play. No transaction or token approval.\n\nURI: ${origin.origin}\nVersion: 1\nChain ID: 46630\nNonce: ${nonce}\nIssued At: ${now.toISOString()}\nExpiration Time: ${new Date(+now + 300000).toISOString()}`;
        db.prepare('INSERT INTO challenges VALUES (?,?,?,?)').run(hash(token), wallet.toLowerCase(), message, +now + 300000);
        setCookie(res, 'cp_challenge', token, 300); return json(res, 200, { message });
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/verify') {
        limit(req, 'auth', 12); const { signature } = await body(req);
        const token = hash(cookie(req, 'cp_challenge')), row = db.prepare('SELECT * FROM challenges WHERE token=? AND expires>?').get(token, Date.now());
        db.prepare('DELETE FROM challenges WHERE token=?').run(token);
        if (!row || typeof signature !== 'string' || signature.length > 150 || verifyMessage(row.message, signature).toLowerCase() !== row.wallet) throw fail('Sign-in expired or signature did not match.', 401);
        const sid = random(); db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(sid), row.wallet, Date.now() + 86400000);
        setCookie(res, 'cp_session', sid, 86400); return json(res, 200, { wallet: row.wallet });
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        db.prepare('DELETE FROM sessions WHERE token=?').run(hash(cookie(req, 'cp_session'))); setCookie(res, 'cp_session', '', 0); return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/boards') {
        const board = url.searchParams.get('board'); if (!board || board.length > 12000) throw fail('Invalid board.');
        const entries = boardQuery(url.searchParams.get('onchain') === '1').all(board).map(({ wallet, ...r }) => ({ ...r, wallet: wallet.slice(0, 6) + '…' + wallet.slice(-4) }));
        return json(res, 200, { entries });
      }
      if (req.method === 'POST' && url.pathname === '/api/runs/start') {
        const wallet = session(req); limit(req, 'start', 10); if (isBanned(wallet)) throw fail('This wallet is suspended from ranked play.', 403); const { board, course } = await body(req); currentCourse(course);
        if (typeof board !== 'string' || board.length > 12000 || !Number.isInteger(course.tf) || course.tf < 0 || course.tf > 3) throw fail('Invalid course.');
        const cup = course.sym === 'CUP' ? 1 : 0;
        if (cup && db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE wallet=? AND week=? AND cup=1').get(wallet, weekId()).n >= 3) throw fail('All 3 ranked Cup attempts used. Practice runs are unlimited.', 409);
        const id = random(); db.prepare('INSERT INTO attempts(id,wallet,board,course,week,cup,started) VALUES (?,?,?,?,?,?,?)').run(id, wallet, board, JSON.stringify(course), weekId(), cup, Date.now());
        return json(res, 200, { id });
      }
      if (req.method === 'POST' && url.pathname === '/api/runs/submit') {
        const wallet = session(req); limit(req, 'submit', 5); if (isBanned(wallet)) throw fail('This wallet is suspended from ranked play.', 403); const { id, log, claimed, name } = await body(req); validateRunLog(log);
        const row = db.prepare('SELECT * FROM attempts WHERE id=? AND wallet=? AND used=0').get(id, wallet);
        if (!row || row.board !== log.board || row.course !== JSON.stringify(log.course)) throw fail('Run ticket does not match this replay.', 409);
        if (Date.now() - row.started > 2 * 3600000 || log.steps / 120 * 1000 > Date.now() - row.started + 2000) throw fail('Run timing is invalid.');
        currentCourse(log.course);
        let result;
        try { result = await verify(log); } catch (e) { if (e.status) throw e; console.error(e); throw fail('Replay could not be verified. Please retry.', 422); }
        if (!result.complete || result.total !== claimed) throw fail('Replay did not match the completed run.', 422);
        const displayName = String(name || 'Runner').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Runner';
        db.exec('BEGIN IMMEDIATE');
        try {
          const changed = db.prepare('UPDATE attempts SET used=1 WHERE id=? AND used=0').run(id).changes;
          if (!changed) throw fail('Run already submitted.', 409);
          db.prepare('INSERT INTO scores(id,wallet,board,name,score,time,cleared,log,created) VALUES (?,?,?,?,?,?,?,?,?)').run(id, wallet, log.board, displayName, result.total, result.time, +result.cleared, JSON.stringify(log), Date.now());
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        return json(res, 200, { verified: true, score: result.total, attest: attest(wallet, log.board, result.total, id) });
      }
      if (req.method === 'POST' && url.pathname === '/api/runs/onchain') { // the player reports their record tx; we check the receipt ourselves
        const wallet = session(req); limit(req, 'onchain', 10); const { id, tx } = await body(req);
        if (!SCORES || typeof id !== 'string' || !/^0x[0-9a-f]{64}$/i.test(tx || '')) throw fail('Invalid record.');
        const row = db.prepare('SELECT id, board, score FROM scores WHERE id=? AND wallet=?').get(id, wallet); if (!row) throw fail('Score not found.', 404);
        const rc = await provider().getTransactionReceipt(tx).catch(() => null); if (!rc) throw fail('Transaction not confirmed yet. Try again shortly.', 409);
        const log = rc.status === 1 && rc.logs.find(l => l.address.toLowerCase() === SCORES && l.topics[0] === runEvent.getEvent('Run').topicHash);
        const ev = log && runEvent.parseLog(log);
        if (!ev || ev.args.player.toLowerCase() !== wallet || ev.args.runId !== hashText(row.id) || ev.args.board !== hashText(row.board) || Number(ev.args.score) !== row.score) throw fail('That transaction does not record this run.', 422);
        db.prepare('UPDATE scores SET tx=?, pos=? WHERE id=?').run(tx.toLowerCase(), rc.blockNumber * 1e5 + log.index, row.id);
        return json(res, 200, { recorded: true });
      }
      throw fail('Endpoint not found.', 404);
    }
    if (!['GET', 'HEAD'].includes(req.method)) throw fail('Method not allowed.', 405);
    const allowed = { '/': 'index.html', '/index.html': 'index.html', '/game.mjs': 'game.mjs', '/game-core.mjs': 'game-core.mjs', '/haunt.mjs': 'haunt.mjs', '/vendor/privy.js': 'vendor/privy.js', '/brand/preview.png': 'assets/brand/wick-runner/link-card-1200x630.png', '/assets/brand/wick-runner/link-card-1200x630.png': 'assets/brand/wick-runner/link-card-1200x630.png' };
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
    if (path === 'index.html') content = Buffer.from(content.toString().replaceAll('content="/assets/brand/wick-runner/link-card-1200x630.png"', `content="${origin.origin}/assets/brand/wick-runner/link-card-1200x630.png"`));
    res.writeHead(200, { 'Content-Type': path.endsWith('.png') ? 'image/png' : path.endsWith('.mp3') ? 'audio/mpeg' : path.endsWith('.json') ? 'application/json' : path.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': path.startsWith('node_modules') || path.endsWith('.mp3') ? 'public, max-age=86400' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (e) { if (!res.headersSent) json(res, e.status || 400, { error: e.status ? e.message : 'Request could not be completed.' }); else res.end(); if (!e.status) console.error(e); }
});
server.requestTimeout = 30000;
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Wick Runner: ${origin.origin}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { server.close(); await browser?.close(); db.close(); process.exit(); });
