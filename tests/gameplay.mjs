import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : process.platform === 'win32' ? { channel: 'chrome' } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto('http://localhost:8123/?verify=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__cp);
  await page.keyboard.press('Enter');
  const controls = await page.evaluate(() => {
    const cp = window.__cp, p = cp.player;
    cp.settings.autoRun = true; cp.input.keys.clear(); cp.readMoveInput(); const auto = cp.input.iz;
    cp.input.keys.add('KeyS'); cp.readMoveInput(); const brake = cp.input.iz;
    cp.input.keys.clear(); cp.settings.autoRun = false; cp.readMoveInput(); const manual = cp.input.iz;
    cp.input.keys.add('KeyW'); cp.readMoveInput(); const forward = cp.input.iz;
    cp.setLevel(0); cp.restart(false);
    cp.colliders.length = 0;
    const ledge = { min: new cp.THREE.Vector3(-2, -2, -2), max: new cp.THREE.Vector3(2, 1, 0), type: 'plat', active: true };
    cp.colliders.push(ledge); p.pos.set(0, 0, .4); p.vel.set(0, -.2, -9); p.onGround = false; p.state = 'air';
    cp.moveAndCollide(1 / 60);
    return { auto, brake, manual, forward, vault: p.state === 'hang' && p.hang.vault, vaultSpeed: p.hang?.speed };
  });
  assert.deepEqual([controls.auto, controls.brake, controls.manual, controls.forward], [1, 0, 0, 1]);
  assert.ok(controls.vault, 'Running into a low ledge must vault rather than stop');
  assert.ok(controls.vaultSpeed >= 9, 'Vault must preserve approach speed');
  const passive = await page.evaluate(() => {
    const cp = window.__cp; cp.setLevel(0); cp.restart(false);
    for (let i = 0; i < 1800; i++) { if (cp.game.state === 'dead') cp.resolveDeath(); cp.simStep([0,100,0,0]); }
    return { style:cp.score.style, combo:cp.score.combo, pending:cp.score.pending, distance:cp.score.dist, skills:cp.game.runSkills };
  });
  assert.equal(passive.combo, 0); assert.equal(passive.pending, 0);
  assert.equal(passive.skills.bestBanked, 0); assert.equal(passive.skills.precise, 0);
  assert.ok(passive.style <= 60, 'Untouched auto-run must earn only small flat pickup points, never trick chains');
  console.log(`Passive auto-run: ${JSON.stringify(passive)}`);
  const jumps = await page.evaluate(() => {
    const cp = window.__cp, p = cp.player;
    const ground = () => {
      cp.restart(false); cp.colliders.length = 0;
      const floor = { min: new cp.THREE.Vector3(-100, -2, -100), max: new cp.THREE.Vector3(100, 0, 100), type: 'plat', active: true };
      cp.colliders.push(floor); p.pos.set(0, 0, 0); p.vel.set(0, 0, 0); p.onGround = true; p.ground = floor; p.lastGroundY = 0;
    };
    const jump = held => { ground(); let apex = 0; for (let i = 0; i < 150; i++) { cp.simStep([0, 0, 0, i === 0 ? 5 : held ? 1 : 0]); apex = Math.max(apex, p.pos.y); } return apex; };
    const tap = jump(false), hold = jump(true);
    ground(); cp.simStep([0, 0, 0, 0]); cp.colliders.length = 0;
    for (let i = 0; i < 12; i++) cp.simStep([0, 0, 0, 0]);
    cp.simStep([0, 0, 0, 5]); const coyote = p.vel.y > 0 && p.jumpsUsed === 1;
    ground(); p.pos.y = .55; p.vel.y = -4; p.onGround = false; p.jumpsUsed = 2; p.coyote = 0;
    let buffered = false;
    for (let i = 0; i < 28; i++) { cp.simStep([0, 0, 0, i === 0 ? 5 : 1]); if (p.vel.y > 0 && p.jumpsUsed === 1) buffered = true; }
    ground();
    for (let i = 0; i < 180; i++) cp.simStep([0, 0, 0, i === 0 || i === 30 ? 5 : 1]);
    const cleanFlips = cp.game.runSkills.flips;
    ground(); cp.simStep([0, 100, 0, 5]); cp.tick(0, performance.now());
    const dashReady = !document.querySelector('#dashDot').classList.contains('used');
    cp.simStep([0, 100, 0, 8]); cp.tick(0, performance.now());
    const dashSpent = document.querySelector('#dashDot').classList.contains('used');
    return { tap, hold, coyote, buffered, cleanFlips, dashReady, dashSpent };
  });
  assert.ok(jumps.tap > 1.2, JSON.stringify(jumps));
  assert.ok(jumps.hold > jumps.tap + .4, JSON.stringify(jumps));
  assert.ok(jumps.coyote, 'Jump shortly after leaving an edge should remain a first jump');
  assert.ok(jumps.buffered, 'An early press should jump on landing');
  assert.equal(jumps.cleanFlips, 1, 'A completed double-jump flip must appear in the movement review');
  assert.ok(jumps.dashReady && jumps.dashSpent, 'The HUD must distinguish an available air dash from one already used');
  console.log('Auto-run, brake, manual controls, low-ledge vault, minimum tap jump, variable height, coyote time and jump buffer: PASS');

  const routeBoards = new Set();
  for (const [level, route, mode = 'clean'] of [[0,0], [7,0], [7,1], [7,2], [0,0,'retry'], [0,0,'fall'], [7,0,'trap-hit'], [1,0,'checkpoint']]) {
    const run = await page.evaluate(({ level, route, mode }) => {
      const cp = window.__cp; cp.setLevel(level); if (level === 7) cp.setSprintRoute(route); cp.setTimeframe(1); cp.restart(false); cp.settings.autoRun = true; let held = false, needsDouble = false, cutHeight = Infinity;
      const visits = new Set(), passedHazards = new Set(), hazardSides = new Set(), hazardKinds = new Set(), trace = []; let firstFailure = null, retried = false;
      for (let i = 0; i < 190000 && cp.game.state !== 'win'; i++) {
        if (mode === 'checkpoint' && cp.chartIdx >= 250 || mode === 'trap-hit' && cp.game.state === 'dead') break;
        if (cp.game.state === 'dead') { if (!firstFailure) firstFailure = [...trace]; cp.resolveDeath(); }
        if (mode === 'retry' && !retried && cp.game.checkpoint && cp.chartIdx >= cp.game.checkpoint.i + 2) {
          retried = cp.retryCheckpoint(); cp.simStep(); continue;
        }
        const p = cp.player, floor = p.ground, edge = floor ? p.pos.z - floor.min.z : Infinity;
        if (p.state === 'swing') needsDouble = false; // A swing already provides a launch; do not repeat the approach's double-jump plan.
        const next = cp.platforms.get((floor?.plat?.i ?? -1) + 1);
        const gap = next && floor ? floor.min.z - next.col.max.z : 3;
        const atEdge = p.onGround && edge < 1.2 && !floor?.plat?.spring && (gap > .2 || next && next.top - floor.max.y > .6) && (!next || next.top - floor.max.y > -2 || gap > 4);
        if (atEdge) { needsDouble = !!next && (gap > 4 || next.top - floor.max.y > 2.15); cutHeight = next && gap < 4 && next.top - floor.max.y > 1.4 ? next.top + .7 : Infinity; }
        const wants = atEdge || needsDouble && !p.onGround && p.state === 'air' && p.jumpsUsed === 1 && p.airTime > .25 && p.vel.y < 4 && !(p.ballisticT > 0);
        const jump = wants && !held; held = wants && held ? false : true;
        const grab = p.state === 'swing' ? p.swingAcc < Math.PI * .8 : cp.platforms.get(Math.floor(cp.chartIdx) + 1)?.feature === 'pole';
        cp.readMoveInput();
        let obstacle = null, ahead = 20;
        for (const pl of cp.platforms.values()) if (pl.hazard) { const d = p.pos.z - pl.hazard.z; if (d > -1 && d < ahead) { ahead = d; obstacle = pl; } }
        if (obstacle && ahead < .7) { passedHazards.add(obstacle.i); hazardSides.add(obstacle.hazard.side); hazardKinds.add(obstacle.hazard.kind); }
        const target = obstacle && mode !== 'trap-hit' ? obstacle.hazard.side * 1.55 : 0;
        const steering = Math.max(-.8,Math.min(.8,(target-p.pos.x)*1.8));
        cp.simStep([mode === 'fall' && cp.score.deaths === 0 ? 100 : Math.round(steering * 100), 100, 0, (held && !(p.jumpsUsed === 2 && p.pos.y > cutHeight) ? 1 : 0) | (grab ? 2 : 0) | (jump ? 4 : 0)]);
        visits.add(Math.floor(cp.chartIdx));
        if (i % 12 === 0) { trace.push({ c: cp.chartIdx, p: p.pos.toArray().map(v => +v.toFixed(2)), v: p.vel.toArray().map(v => +v.toFixed(2)), state: p.state, ballistic: +p.ballisticT.toFixed(2), ground: p.ground?.plat?.i, spring: p.ground?.plat?.spring?.target.i }); if (trace.length > 24) trace.shift(); }
      }
      const state = cp.game.state, log = structuredClone(cp.runLog), result = cp.result(state === 'win');
      if (state === 'win') { cp.game.winT = 0; cp.tick(0, performance.now()); }
      const beforeProfile = localStorage.getItem('cp-profile');
      const earnedXP = +document.querySelector('#xpGain').textContent.match(/^\+([\d,]+) XP/)[1].replaceAll(',', '');
      const summary = { state, route, mode, retried, recordedRetry: log.rle.some((v, i) => i % 5 === 4 && (v & 16)), falls: [...cp.game.sectionFalls.values()].reduce((a,b) => a+b,0), insightVisible: !document.querySelector('#runInsight').hidden, comparisonVisible: !document.querySelector('#runComparison').hidden, board: cp.boardId(), next: cp.nextLevel(), displayedCandles: +document.querySelector('#stCandles').textContent, earnedXP, progress: document.querySelector('#prog').textContent, distance: cp.score.dist, time: cp.score.time, deaths: cp.score.deaths, candle: cp.chartIdx, visited: visits.size, total: result.total, ...(state !== 'win' ? { firstFailure } : {}) };
      cp.tick(.016, performance.now());
      const failureCandle = firstFailure?.at(-1)?.c ?? cp.chartIdx;
      return { ...summary, hazardStats:{ count:passedHazards.size,sides:[...hazardSides].sort(),kinds:[...hazardKinds].sort() }, retainedPlatforms:cp.counts.platforms, trapDeath:document.querySelector('#deathcard b')?.textContent === 'TRAP HIT', scoreBreakdown:[...document.querySelectorAll('#scoreParts dd')].map(el => el.textContent), ...(state !== 'win' ? { obstacles:[...cp.platforms.values()].filter(p => p.i >= failureCandle - 4 && p.i <= failureCandle + 3).map(p => ({ i:p.i, top:p.top, z:p.zc, green:p.green, pad:p.pad, feature:p.feature, spring:p.spring?.target.i, live:p.live?.base, back:p.col.max.z, front:p.col.min.z })) } : {}), log, beforeProfile, skills:structuredClone(cp.game.runSkills), skillChips:document.querySelectorAll('#skillValues span').length };
    }, { level, route, mode });
    if (mode === 'fall') {
      await mkdir('artifacts', { recursive: true }); await page.waitForTimeout(1100);
      for (const [width, height] of [[1280,720], [390,844], [844,390]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => window.__cp.tick(.016, performance.now()));
        await page.waitForTimeout(550);
        const layout = await page.evaluate(() => {
          const button = document.querySelector('#again'), details = document.querySelector('.resultDetails');
          const rect = button.getBoundingClientRect(); details.scrollTop = details.scrollHeight;
          return { visible: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth, reachable: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button, scrolls: details.scrollHeight > details.clientHeight && details.scrollTop > 0 };
        });
        assert.ok(layout.visible && layout.reachable && layout.scrolls, JSON.stringify({ width, height, layout }));
        await page.locator('.resultDetails').evaluate(el => el.scrollTop = 0);
        await page.screenshot({ path: `artifacts/run-review-${width}.png` });
      }
      await page.setViewportSize({ width:1280, height:720 });
    }
    const verified = await page.evaluate(({ log, beforeProfile }) => {
      const replay = window.__cp.replayRun(log);
      return { replay, replaySkills:structuredClone(window.__cp.game.runSkills), unchangedProfile: beforeProfile === localStorage.getItem('cp-profile') };
    }, { log: run.log, beforeProfile: run.beforeProfile });
    Object.assign(run, verified); delete run.log; delete run.beforeProfile;
    console.log(`Course ${level}, route ${route} smoke run: ${JSON.stringify(run)}`);
    if (mode === 'checkpoint' || mode === 'trap-hit') {
      assert.equal(run.replay.total, run.total); assert.equal(run.replay.deaths, run.deaths);
      if (mode === 'checkpoint') { assert.ok(run.candle >= 250 || run.deaths === 1 && run.state !== 'play', 'One life: a fall ends the run'); assert.ok(run.deaths <= 1); assert.ok(run.retainedPlatforms < 140); }
      else { assert.equal(run.state,'dead'); assert.ok(run.trapDeath); assert.equal(run.deaths,1); }
      continue;
    }
    assert.ok(run.retainedPlatforms < 140, 'Long routes must discard old scenery while preserving respawn terrain');
    assert.equal(run.state, 'win', `Course ${level} should be traversable with timed jumps`);
    assert.equal(run.next, level === 0 ? 'SPRINT' : level === 1 ? 'CP02' : 'CP01');
    assert.equal(run.displayedCandles, level === 0 ? 24 : level === 1 ? 1200 : 900);
    assert.equal(run.earnedXP, Math.round(Math.min(run.total / 40, run.displayedCandles * 4 + 80)), 'XP must respect both earned score and the progress cap');
    assert.equal(run.progress, '100%');
    assert.ok(run.unchangedProfile);
    assert.equal(run.skillChips, 3);
    assert.equal(run.scoreBreakdown.length, 7);
    assert.equal(+run.scoreBreakdown[6].replaceAll(',', ''), run.total, 'The disclosed score must match the actual run');
    assert.deepEqual(run.skills, run.replaySkills, 'Movement feedback must describe the same actions in live play and replay');
    assert.ok(run.skills.bestBanked > 0 && run.skills.flips >= 0);
    assert.equal(run.replay.total, run.total);
    assert.ok(run.replay.cleared);
    assert.ok(run.time < (level === 0 ? 45 : level === 1 ? 1700 : 1400), 'Courses must stay within their expected duration');
    assert.ok(run.deaths <= (level === 1 ? 6 : 2), 'Routes must stay reasonably forgiving');
    if (mode === 'retry') { assert.ok(run.retried && run.recordedRetry); assert.equal(run.deaths, 1); assert.equal(run.falls, 0); assert.ok(run.comparisonVisible); }
    if (mode === 'fall') { assert.equal(run.falls, 1); assert.ok(run.insightVisible); assert.ok(run.comparisonVisible); }
    if (level === 7) { routeBoards.add(run.board); assert.ok(run.hazardStats.count >= 5); assert.deepEqual(run.hazardStats.sides,[-1,1]); assert.deepEqual(run.hazardStats.kinds,['laser','mine']); }
  }
  assert.equal(routeBoards.size, 3, 'Sprint routes need separate boards');
} finally { await browser.close(); }
