import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : process.platform === 'win32' ? { channel: 'chrome' } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8123/?verify=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__cp, { timeout: 45000 });
  assert.match(await page.title(), /^Wick Runner/);
  assert.equal(await page.locator('meta[name="twitter:card"]').getAttribute('content'), 'summary_large_image');
  assert.match(await page.locator('meta[name="twitter:image"]').getAttribute('content'), /^http:\/\/localhost:8123\/assets\/brand\/wick-runner\/link-card-1200x630\.png$/);
  for (const [level, tf, turns] of [[1,1,false], [1,1,true], [2,2,true], [4,3,true]]) {
    const result = await page.evaluate(({ level, tf, turns }) => {
      const cp = window.__cp; cp.setLevel(level); cp.setTimeframe(tf); cp.restart(false);
      for (let i = 0; i < 7200; i++) {
        if (cp.game.state === 'dead') cp.resolveDeath();
        cp.setYaw(turns ? Math.sin(i / 200) * .45 : 0);
        cp.input.ix = i % 300 < 30 ? .1 : 0; cp.input.iz = 1;
        cp.input.jumpHeld = i % 90 < 45; cp.input.pJump = i % 90 === 0 || i % 90 === 25;
        cp.input.pSlide = i % 250 === 0; cp.simStep();
      }
      const log = structuredClone(cp.runLog), expectedPosition = cp.player.pos.toArray(), expectedDeaths = cp.score.deaths, expectedTime = cp.score.time;
      const expected = cp.result(false), before = localStorage.getItem('cp-profile'), actual = cp.replayRun(log), after = localStorage.getItem('cp-profile');
      return { expected: expected.total, actual, expectedPosition, expectedDeaths, expectedTime, unchangedProfile: before === after };
    }, { level, tf, turns });
    assert.equal(result.actual.total, result.expected, JSON.stringify(result));
    assert.deepEqual(result.actual.position, result.expectedPosition);
    assert.equal(result.actual.deaths, result.expectedDeaths);
    assert.ok(Math.abs(result.actual.time - result.expectedTime) < .001);
    assert.ok(result.unchangedProfile, 'Replay must not mutate progression');
    console.log(`Replay level ${level}, timeframe ${tf}, ${turns ? 'with turning' : 'straight'}: PASS`);
  }
  const previewMatches = await page.evaluate(() => { const cp = window.__cp; cp.setLevel(1); cp.restart(false); const actual = [...cp.candles.values()]; return JSON.stringify(actual) === JSON.stringify(cp.previewCandles(cp.level).slice(0, actual.length)); });
  assert.ok(previewMatches, 'Chart preview must match the actual seeded course');
  const arena = await page.evaluate(() => { const cp = window.__cp; const c = cp.sanitizeArena({ n: 'آرنای من', m: 'ب'.repeat(160), r: 'ق'.repeat(300) }); return !!cp.parseArena(cp.arenaCode(c)); });
  assert.ok(arena);
  const calendar = await page.evaluate(() => {
    const NativeDate = Date;
    try {
      window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2027-01-04T00:01:00Z'])); } static now() { return +new NativeDate('2027-01-04T00:01:00Z'); } };
      window.__cp.refreshCalendar(true); return window.__cp.calendar;
    } finally { window.Date = NativeDate; }
  });
  assert.equal(calendar.day, '2027-01-04'); assert.equal(calendar.season, '2027-W01'); assert.equal(calendar.daily, 20270104); assert.equal(calendar.cup, '2027-W01');
  const traps = await page.evaluate(() => {
    document.querySelector('#landing').classList.add('hidden');
    const cp = window.__cp; cp.setLevel(7); cp.setSprintRoute(0); cp.restart(false);
    const pl = [...cp.platforms.values()].find(pl => pl.hazard?.kind === 'laser');
    if (!pl) throw new Error('The opening section must introduce a laser gate');
    const p = cp.player; p.pos.set(0,pl.top+.02,pl.zc); p.lastGroundY = pl.top; p.vel.set(0,0,0); cp.simStep([0,0,0,0]);
    const hit = cp.game.state === 'dead';
    cp.restart(false); const safe = cp.platforms.get(pl.i); p.pos.set(safe.hazard.side*1.55,safe.top+.02,safe.zc); p.lastGroundY = safe.top; p.vel.set(0,0,0); cp.simStep([0,0,0,0]);
    const avoided = cp.game.state === 'play'; p.pos.set(0,safe.top,safe.zc+9); cp.tick(.016,performance.now());
    return { hit,avoided };
  });
  assert.deepEqual(traps,{ hit:true,avoided:true });
  await mkdir('artifacts',{ recursive:true }); await page.screenshot({ path:'artifacts/laser-gate.png' });
  await page.goto('http://localhost:8123/', { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => !!window.__cp);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/desktop.png' });
  assert.equal(await page.locator('.hero-art').evaluate(el => getComputedStyle(el).borderTopWidth), '0px');
  for (const section of ['#how','#moves','#routes','#season','#arenas','#token','#faq']) {
    await page.locator(section).scrollIntoViewIfNeeded();
    assert.ok(await page.locator(section).evaluate(el => el.scrollWidth <= innerWidth), `${section} must fit the viewport`);
    await page.screenshot({ path:`artifacts/landing-${section.slice(1)}.png` });
  }
  await page.locator('[data-quick-route="1"]').click();
  await page.waitForFunction(() => window.__cp.game.state === 'play');
  assert.equal(await page.evaluate(() => window.__cp.level.route), 1, 'Landing route buttons must open the selected course');
  await page.locator('#pauseGame').click(); await page.locator('#pQuit').click();
  await page.locator('[data-route="0"]').click(); await page.locator('#start .brand').click();
  await page.locator('[data-play]').first().click();
  await page.screenshot({ path: 'artifacts/menu.png' });
  await page.locator('#go').click(); await page.waitForFunction(() => window.__cp.game.state === 'play');
  await page.keyboard.down('w'); await page.waitForTimeout(1200); await page.keyboard.up('w');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__cp.game.state), 'pause');
  assert.ok(await page.locator('#pCheckpoint').isDisabled(), 'Checkpoint retry must wait for a real checkpoint');
  await page.locator('#pResume').click(); await page.screenshot({ path: 'artifacts/game.png' });
  await page.waitForFunction(() => window.__cp.game.state === 'play');
  await page.locator('#pauseGame').click(); await page.locator('#pQuit').click();
  await page.locator('#start .brand').click(); await page.locator('[data-quick]').first().click();
  await page.waitForFunction(() => window.__cp.game.state === 'play');
  assert.equal(await page.evaluate(() => window.__cp.level.sym), 'SPRINT');
  assert.equal(await page.evaluate(() => document.pointerLockElement), null, 'Quick play must not capture the cursor');
  await page.waitForFunction(() => window.__cp.score.dist > 4);
  await page.keyboard.down('s'); await page.waitForFunction(() => Math.abs(window.__cp.player.vel.z) < .5);
  await page.screenshot({ path: 'artifacts/sprint.png' });
  await page.keyboard.down('Space'); await page.waitForFunction(() => window.__cp.player.jumpsUsed === 1);
  await page.keyboard.up('Space'); await page.keyboard.press('Space');
  await page.waitForFunction(() => !document.querySelector('#actionFeedback').hidden && document.querySelector('#actionName').textContent.length > 0);
  await page.screenshot({ path: 'artifacts/sprint-feedback.png' });
  await page.keyboard.up('s'); await page.locator('#pauseGame').click();
  await page.locator('#pQuit').click();
  assert.equal(await page.locator('#sprintRouteButtons button').count(), 3);
  const firstBoard = await page.evaluate(() => window.__cp.boardId());
  await page.locator('[data-route="1"]').click();
  assert.equal(await page.evaluate(() => window.__cp.level.route), 1);
  assert.notEqual(await page.evaluate(() => window.__cp.boardId()), firstBoard);
  await page.locator('#go').click(); await page.waitForFunction(() => window.__cp.game.state === 'play');
  await page.locator('#pauseGame').click(); await page.locator('#pQuit').click();
  await page.screenshot({ path: 'artifacts/sprint-routes.png' });
  await page.close(); // Release the desktop WebGL contexts before emulating a phone on software rendering.
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage(); mobile.on('pageerror', e => errors.push(e.message));
  await mobile.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await mobile.goto('http://localhost:8123/', { waitUntil: 'domcontentloaded' }); await mobile.waitForFunction(() => !!window.__cp);
  assert.ok(await mobile.evaluate(() => document.querySelector('#landing').scrollWidth <= innerWidth + 1));
  for (const section of ['#landing .hero','#how','#moves','#routes','#season','#arenas','#token','#faq']) assert.ok(await mobile.locator(section).evaluate(el => el.scrollWidth <= innerWidth), `${section} must fit mobile`);
  await mobile.screenshot({ path: 'artifacts/mobile.png' });
  await mobile.locator('[data-arena-new]').first().tap();
  assert.ok(await mobile.locator('#arenaMaker').isVisible());
  await mobile.locator('#mkName').fill('My community');
  await mobile.keyboard.press('Escape');
  assert.ok(await mobile.locator('#arenaMaker').isHidden());
  await mobile.locator('[data-play]').first().tap();
  assert.ok(await mobile.locator('#start').evaluate(el => getComputedStyle(el).touchAction === 'pan-y'));
  await mobile.locator('#go').tap(); await mobile.waitForFunction(() => window.__cp.game.state === 'play');
  assert.equal(await mobile.evaluate(() => document.pointerLockElement), null);
  const jump = mobile.locator('.tbtn[data-act="jump"]');
  const brake = mobile.locator('.tbtn[data-act="brake"]');
  await brake.dispatchEvent('touchstart');
  assert.equal(await mobile.evaluate(() => { window.__cp.readMoveInput(); return window.__cp.input.iz; }), 0);
  assert.ok(await brake.evaluate(el => el.classList.contains('held')));
  await brake.dispatchEvent('touchcancel');
  assert.equal(await mobile.evaluate(() => { window.__cp.readMoveInput(); return window.__cp.input.iz; }), 1);
  await jump.dispatchEvent('touchstart'); assert.ok(await mobile.evaluate(() => window.__cp.input.jumpHeld));
  await jump.dispatchEvent('touchcancel'); assert.equal(await mobile.evaluate(() => window.__cp.input.jumpHeld), false);
  await jump.dispatchEvent('touchstart');
  await jump.evaluate(el => { const remaining = new Touch({ identifier:22, target:el }); el.dispatchEvent(new TouchEvent('touchend', { bubbles:true, cancelable:true, targetTouches:[remaining] })); });
  assert.ok(await mobile.evaluate(() => window.__cp.input.jumpHeld), 'One finger lifting must not release another finger still holding jump');
  await jump.dispatchEvent('touchcancel');
  assert.equal(await jump.evaluate(el => el.classList.contains('held')), false);
  const touchRecovery = await mobile.evaluate(() => {
    const cp = window.__cp, surface = document.querySelector('canvas');
    const touch = (type, id, x, y) => { const event = new Event(type); Object.defineProperty(event, 'changedTouches', { value:[{ identifier:id, clientX:x, clientY:y, target:surface }] }); window.dispatchEvent(event); };
    touch('touchstart', 10, 50, 600); touch('touchmove', 10, 90, 600);
    const steered = cp.input.stickX > .5;
    window.dispatchEvent(new Event('blur'));
    const paused = cp.game.state === 'pause', cleared = cp.input.stickX === 0 && document.querySelector('#stick i').style.transform === '';
    return { steered, paused, cleared };
  });
  assert.deepEqual(touchRecovery, { steered:true, paused:true, cleared:true });
  await mobile.locator('#pResume').tap();
  const recovered = await mobile.evaluate(() => {
    const cp = window.__cp, surface = document.querySelector('canvas');
    for (const [type, x] of [['touchstart',50], ['touchmove',90]]) { const event = new Event(type); Object.defineProperty(event, 'changedTouches', { value:[{ identifier:11, clientX:x, clientY:600, target:surface }] }); window.dispatchEvent(event); }
    return cp.input.stickX > .5;
  });
  assert.ok(recovered, 'A new finger must steer after focus loss without waiting for the old touch to end');
  await mobile.locator('#pauseGame').tap(); assert.equal(await mobile.evaluate(() => window.__cp.game.state), 'pause');
  await mobile.screenshot({ path: 'artifacts/mobile-game.png' });
  await mobileContext.close();
  assert.deepEqual(errors, []);
  console.log('Desktop, mobile, controls, Unicode arena and console checks: PASS');
} finally { await browser.close(); }
