// Ranked play without a server to host: these run as Vercel Functions (api/*.mjs) and, for local dev, inside server.mjs.
// Anti-cheat stays strong and stateless:
//  1. runs/start hands out a ticket (wallet, board, course, start time) sealed with an HMAC, so nothing is stored.
//  2. runs/submit checks the ticket, that the run took at least as long in real time as it claims, then REPLAYS the
//     recorded inputs in headless Chromium against the published game and recomputes the score.
//  3. Only then it signs an attestation bound to that wallet; the contract accepts it once (run id = ticket hash),
//     only from that wallet, before it expires. Bans and the leaderboard live on-chain (contracts/admin.mjs).
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { Wallet, AbiCoder, keccak256, id, getBytes } from 'ethers';
import { RULES_VERSION, validateRunLog, weekId, utcDay } from '../game-core.mjs';

export const CHAIN_ID = 46630, SCORES = (process.env.SCORES_ADDRESS || '0x2417104586F701fD9AbBc7e068A461ad5766Fe89').toLowerCase();
const ATTEST_TTL = 7 * 86400, TICKET_TTL = 2 * 3600000;
export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const secret = () => { if (!process.env.VERIFIER_KEY) throw fail('Ranked play is not configured yet. Practice is always free.', 503); return process.env.VERIFIER_KEY; };
const mac = s => createHmac('sha256', 'wick-ticket:' + secret()).update(s).digest('base64url');
const isWallet = w => /^0x[0-9a-f]{40}$/.test(w || '');

export function makeTicket(wallet, board, course, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ w: wallet, b: board, c: course, t: now })).toString('base64url');
  return body + '.' + mac(body);
}
export function readTicket(ticket, now = Date.now()) {
  const [body, sig] = String(ticket || '').split('.'), good = body && sig && mac(body);
  if (!good || sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) throw fail('Run ticket is not valid.', 403);
  const t = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (now - t.t > TICKET_TTL) throw fail('Run ticket expired. Start a new ranked run.', 409);
  return t;
}
export function attest(wallet, board, score, runId, signer = new Wallet(secret()), now = Date.now()) {
  const b = id(board), deadline = Math.floor(now / 1000) + ATTEST_TTL;
  const h = keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'address', 'address', 'bytes32', 'uint64', 'bytes32', 'uint64'], [CHAIN_ID, SCORES, wallet, b, score, runId, deadline]));
  return { board: b, score, runId, deadline, sig: signer.signMessageSync(getBytes(h)) };
}

function checkCourse(course) {
  if (!course || !['TRAIN', 'CP01', 'CP02', 'CP03', 'CP04', 'DAILY', 'CUP', 'SPRINT', 'HAUNT', 'ARENA'].includes(course.sym)) throw fail('Unknown chart.');
  if (JSON.stringify(course).length > 14000 || !Number.isSafeInteger(course.seed) || !Number.isInteger(course.tf) || course.tf < 0 || course.tf > 3) throw fail('Invalid course configuration.');
  if (course.sym === 'SPRINT' && (!Number.isInteger(course.route ?? 0) || (course.route ?? 0) < 0 || (course.route ?? 0) > 2)) throw fail('Invalid Sprint route.');
  if (course.sym === 'DAILY' && course.seed !== +utcDay().replace(/-/g, '')) throw fail('The daily chart changed. Start a new run.');
  if (course.sym === 'CUP' && course.period !== weekId()) throw fail('The Cup changed. Start a new run.');
  if (course.sym === 'ARENA' && course.arena?.e && course.arena.e <= Date.now()) throw fail('This campaign ended. Practice is still available.');
}

let browser = null;
async function launch() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) { // serverless: bundled Chromium
    const { default: chromium } = await import('@sparticuz/chromium'), { chromium: pw } = await import('playwright-core');
    return pw.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  }
  const { chromium: pw } = await import('playwright-core'), { existsSync } = await import('node:fs');
  const local = process.env.CHROME_PATH || (process.platform === 'win32' ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) : undefined);
  return pw.launch({ ...(local ? { executablePath: local } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}
// Replays the inputs in the published game (gameOrigin) and returns its own result. Only the game and its CDN load.
export async function replay(log, gameOrigin) {
  browser ||= await launch();
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  try {
    await context.route('**/*', route => { const o = new URL(route.request().url()).origin; return o === gameOrigin || o === 'https://cdn.jsdelivr.net' ? route.continue() : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(45000);
    await page.goto(`${gameOrigin}/?verify=1`);
    await page.waitForFunction(() => !!window.__cp);
    return await page.evaluate(log => window.__cp.replayRun(log), log);
  } finally { await context.close(); }
}

// One handler for every endpoint, shared by the Vercel Functions and server.mjs.
export async function handle(path, method, body, gameOrigin) {
  if (method === 'GET' && path === 'status') return { online: !!process.env.VERIFIER_KEY, rules: RULES_VERSION, wallet: null, scores: SCORES };
  if (method === 'POST' && path === 'runs/start') {
    const wallet = String(body?.wallet || '').toLowerCase(), { board, course } = body || {};
    if (!isWallet(wallet) || typeof board !== 'string' || board.length > 12000) throw fail('Invalid course.'); checkCourse(course);
    return { id: makeTicket(wallet, board, course) };
  }
  if (method === 'POST' && path === 'runs/submit') {
    const { id: ticket, log, claimed } = body || {}, t = readTicket(ticket), now = Date.now();
    validateRunLog(log);
    if (t.b !== log.board || JSON.stringify(t.c) !== JSON.stringify(log.course)) throw fail('Run ticket does not match this replay.', 409);
    if (log.steps / 120 * 1000 > now - t.t + 2000) throw fail('Run timing is invalid.');
    let result;
    try { result = await replay(log, gameOrigin); } catch (e) { console.error(e); throw fail('Replay could not be verified. Please retry.', 422); }
    if (!result.complete || result.total !== claimed) throw fail('Replay did not match the completed run.', 422);
    const runId = '0x' + createHash('sha256').update(ticket).digest('hex'); // one record per ticket, enforced on-chain
    return { verified: true, score: result.total, attest: attest(t.w, log.board, result.total, runId) };
  }
  throw fail('Endpoint not found.', 404);
}

// Vercel Function adapter.
export const vercel = path => async (req, res) => {
  try {
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `https://${req.headers.host}`) throw fail('Request origin not allowed.', 403);
    const origin = process.env.PUBLIC_ORIGIN || `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || req.headers.host}`;
    const out = await handle(path, req.method, req.body, origin);
    res.setHeader('Cache-Control', 'no-store'); res.status(200).json(out);
  } catch (e) { if (!e.status) console.error(e); res.status(e.status || 400).json({ error: e.status ? e.message : 'Request could not be completed.' }); }
};
