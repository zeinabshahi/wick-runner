import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet, AbiCoder, keccak256, id, getBytes, verifyMessage } from 'ethers';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';

const dir = await mkdtemp(join(tmpdir(), 'parkour-test-'));
const base = 'http://localhost:8124';
const verifier = Wallet.createRandom();
const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '8124', PUBLIC_ORIGIN: base, DATA_DIR: dir, VERIFIER_KEY: verifier.privateKey, CHROME_PATH: process.env.CHROME_PATH || '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let browser, cookie = '';
const request = async (path, data) => {
  const r = await fetch(base + '/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers: { origin: base, cookie, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const next = r.headers.get('set-cookie'); if (next) cookie = next.split(';')[0];
  return { status: r.status, data: await r.json() };
};
try {
  let ready = false;
  for (let n = 0; n < 50; n++) { try { await fetch(base + '/api/status'); ready = true; break; } catch { await delay(200); } }
  assert.ok(ready, 'Test service should start');
  const brandedPage = await (await fetch(base + '/')).text();
  assert.match(brandedPage, /<title>Wick Runner/);
  assert.ok(brandedPage.includes(`content="${base}/assets/brand/wick-runner/link-card-1200x630.png"`));
  const card = await fetch(base + '/assets/brand/wick-runner/link-card-1200x630.png');
  assert.equal(card.status, 200); assert.equal(card.headers.get('content-type'), 'image/png');
  const cardBytes = Buffer.from(await card.arrayBuffer()); assert.equal(cardBytes.readUInt32BE(16),1200); assert.equal(cardBytes.readUInt32BE(20),630);
  assert.equal((await request('runs/start', {})).status, 400);
  const wallet = Wallet.createRandom().address.toLowerCase();
  assert.equal((await request('status')).data.online, true);
  assert.equal((await fetch(base + '/data/parkour.sqlite')).status, 404);
  assert.equal((await fetch(base + '/vendor/three/build/%2e%2e%2f%2e%2e%2f%2e%2e%2fdata/parkour.sqlite')).status, 404);

  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : process.platform === 'win32' ? { channel: 'chrome' } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto(base + '/?verify=1'); await page.waitForFunction(() => !!window.__cp);
  const meta = await page.evaluate(() => { const cp = window.__cp; cp.setLevel(5); cp.restart(false); return { board: cp.boardId(), course: cp.courseConfig() }; });
  const ticket = await request('runs/start', { wallet, ...meta }); assert.equal(ticket.status, 200);
  const run = await page.evaluate(() => {
    const cp = window.__cp; cp.restart(false); cp.input.ix = .5; cp.input.iz = 1;
    while (cp.game.state === 'play' && cp.runLog.steps < 4000) cp.simStep();
    const log = structuredClone(cp.runLog), result = cp.result(false);
    return { log, total: result.total, state: cp.game.state };
  });
  assert.equal(run.state, 'dead');
  assert.ok(run.total > 0, 'A nonzero run must be replayed by the service');
  await delay(run.log.steps / 120 * 1000); // A valid ticket cannot claim more play time than elapsed wall time.
  const forged = await request('runs/submit', { id: ticket.data.id, log: run.log, claimed: run.total + 999999, name: 'Service test' });
  assert.equal(forged.status, 422, JSON.stringify(forged));
  const valid = await request('runs/submit', { id: ticket.data.id, log: run.log, claimed: run.total, name: 'Service test' });
  assert.equal(valid.status, 200, JSON.stringify(valid));
  assert.equal(valid.data.verified, true);
  const a = valid.data.attest; // must be exactly what WickRunnerScores.record() checks
  const h = keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'address', 'address', 'bytes32', 'uint64', 'bytes32', 'uint64'], [46630, '0x2417104586F701fD9AbBc7e068A461ad5766Fe89', wallet, id(meta.board), run.total, a.runId, a.deadline]));
  assert.equal(verifyMessage(getBytes(h), a.sig), verifier.address); assert.equal(a.score, run.total);
  const forgedTicket = ticket.data.id.slice(0, -2) + (ticket.data.id.endsWith('AA') ? 'BB' : 'AA');
  assert.equal((await request('runs/submit', { id: forgedTicket, log: run.log, claimed: run.total })).status, 403);
  for (const route of [0, 1, 2]) {
    const sprint = await page.evaluate(route => { const cp = window.__cp; cp.setLevel(7); cp.setSprintRoute(route); cp.restart(false); return { board: cp.boardId(), course: cp.courseConfig() }; }, route);
    assert.equal((await request('runs/start', { wallet, ...sprint })).status, 200, 'Every Sprint route must support ranked tickets');
  }
  const memory = await page.evaluate(() => { const cp = window.__cp; cp.setLevel(5); cp.restart(false); for (let i = 0; i < 1000; i++) cp.streamCourse(i); return cp.counts; });
  assert.ok(memory.platforms <= 100 && memory.candles <= 100, JSON.stringify(memory));
  console.log('Forged score rejection, valid replay, contract-ready attestation, forged ticket rejection, private files and bounded endless course: PASS');
} finally {
  await browser?.close(); child.kill();
  await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
  await rm(dir, { recursive: true, force: true });
}
