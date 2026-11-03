import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtUnits, weekId, utcDay, quantizeYaw, encodeArena, decodeArena, arenaIdentity, validateRunLog, nextRunGoal, compareRuns, groundRouteCue, ghostSplitAtDistance, forwardSwingLaunch, MAX_STEPS, RULES_VERSION, distancePoints, styleAward, hazardPlan, hazardHits } from '../game-core.mjs';

test('wallet amounts preserve zero decimals and large integers', () => {
  assert.equal(fmtUnits(123n, 0), '123');
  assert.equal(fmtUnits(12345n, 2), '123.45');
  assert.equal(fmtUnits(1000000000000000000000000n, 0), '1,000,000,000,000,000,000,000,000');
  assert.throws(() => fmtUnits(1n, -1));
});
test('UTC dates and ISO weeks work across the year boundary', () => {
  assert.equal(weekId(new Date('2027-01-01T00:00:00Z')), '2026-W53');
  assert.equal(weekId(new Date('2027-01-04T00:00:00Z')), '2027-W01');
  assert.equal(utcDay(new Date('2026-11-01T01:00:00+03:00')), '2026-10-31');
});
test('full Unicode arena configurations round-trip and campaigns have separate identities', () => {
  const c = { n: 'آرنای من', m: 'ب'.repeat(160), r: 'ق'.repeat(300), k: '0x' + '1'.repeat(40), cr: '0x' + '2'.repeat(40), sg: '0x' + '3'.repeat(130) };
  assert.ok(encodeArena(c).length > 1200);
  assert.deepEqual(decodeArena(encodeArena(c)), c);
  assert.notEqual(arenaIdentity(c), arenaIdentity({ ...c, k: '0x' + '4'.repeat(40) }));
  assert.notEqual(arenaIdentity(c), arenaIdentity({ ...c, r: 'Different rules' }));
  assert.equal(arenaIdentity(c), arenaIdentity({ ...c, sg: '' }));
  assert.throws(() => decodeArena('a'.repeat(8193)));
});
test('replay validation rejects malformed and unbounded inputs', () => {
  const log = { v: RULES_VERSION, board: `v${RULES_VERSION}:CP01`, course: { tf: 1 }, steps: 2, rle: [2, 0, 100, 1571, 5] };
  assert.equal(validateRunLog(log), log);
  assert.equal(validateRunLog({ ...log, rle: [2, 0, 0, 0, 16] }).steps, 2);
  for (const bad of [{ ...log, steps: 3 }, { ...log, steps: MAX_STEPS + 1 }, { ...log, rle: [2, 101, 0, 0, 0] }, { ...log, rle: [2, 0, 0, 0, 32] }, { ...log, rle: [2, 0, 0, Infinity, 0] }]) assert.throws(() => validateRunLog(bad));
  assert.equal(quantizeYaw(2 * Math.PI + Math.PI / 2), 1571);
});
test('run comparisons never call an incomplete run a faster clear', () => {
  const best = { score: 10000, time: 60, deaths: 2, cleared: true };
  const run = { score: 11000, time: 55, deaths: 1, cleared: true };
  assert.deepEqual(compareRuns(run, best), { score: 1000, time: -5, deaths: -1 });
  assert.deepEqual(compareRuns({ ...run, cleared: false }, best), { score: 1000, time: null, deaths: null });
  assert.deepEqual(compareRuns(run, { score: 9000 }), { score: 2000, time: null, deaths: null });
  assert.equal(compareRuns(run, null), null);
});

test('route advice puts a cracking floor first and previews the actual obstacle', () => {
  const here = { green:true, top:0, col:{ min:{ z:-5 } } }, next = { green:true, top:0, col:{ max:{ z:-5.1 } } };
  assert.match(groundRouteCue(here, next, 1, 9).text, /KEEP RUNNING/);
  assert.match(groundRouteCue(here, { ...next, feature:'pole' }, 6, 9).text, /6m AHEAD.*HOLD GRAB/);
  assert.match(groundRouteCue(here, { ...next, top:3 }, 2, 9).text, /SECOND JUMP READY/);
  assert.match(groundRouteCue(here, { ...next, top:-4 }, 2, 9).text, /RUN OFF/);
  assert.deepEqual(groundRouteCue({ ...here, green:false, crackT:.8, breakT:1, spring:{} }, next, 6, 0), { text:'RED BREAKS IN 0.2s · JUMP OFF', danger:true });
  assert.match(groundRouteCue(here, null, 1, 9).text, /FINISH GATE/);
  assert.match(groundRouteCue({ ...here, pad:true, depth:5.6 }, next, 4, 9).text, /BLUE BOOST PAD/);
  assert.equal(forwardSwingLaunch(2,-9), true);
  assert.equal(forwardSwingLaunch(9,-2), false);
  assert.equal(forwardSwingLaunch(0,9), false);
  assert.equal(forwardSwingLaunch(0,0), false);
});

test('ghost pace interpolates first crossings and clears a stale split beyond the best distance', () => {
  const frames = [0,0,0,0, 0,0,-10,0, 0,0,-2,0, 0,0,-12,0], times = [0,1,5,6];
  assert.deepEqual(ghostSplitAtDistance(frames,times,5), { index:1,time:.5 });
  assert.deepEqual(ghostSplitAtDistance(frames,times,11,1), { index:3,time:5.9 });
  assert.deepEqual(ghostSplitAtDistance(frames,times,13,3), { index:3,time:null });
  assert.deepEqual(ghostSplitAtDistance([],[],5), { index:0,time:null });
});
test('next-run goals stay achievable and reflect the actual result', () => {
  const run = { cleared: true, candles: 60, length: 60, deaths: 0, time: 55, par: 75, total: 10000, best: 10200, sprint: true };
  assert.match(nextRunGoal(run), /201 more points/);
  assert.match(nextRunGoal({ ...run, cleared: false, candles: 59 }), /clear 60 candles/);
  assert.match(nextRunGoal({ ...run, deaths: 3 }), /2 or fewer deaths/);
  assert.match(nextRunGoal({ ...run, time: 80.2 }), /cut 6 seconds/);
  assert.match(nextRunGoal({ ...run, best: 0 }), /next Sprint route/);
  const log = { v: RULES_VERSION, board: `v${RULES_VERSION}:SPRINT`, course: { sym: 'SPRINT', tf: 1, route: 3 }, steps: 1, rle: [1, 0, 100, 0, 0] };
  assert.throws(() => validateRunLog(log));
});

test('passive traversal and pickups cannot create skill chains under the new rules', () => {
  assert.equal(distancePoints(100), 200);
  assert.deepEqual(styleAward('ORB',100,false), { points:10,link:false });
  for (const move of ['VAULT','CLIMB','PERFECT LANDING','SPRING','GRIND']) {
    assert.deepEqual(styleAward(move,200,false), { points:0,link:false });
    assert.deepEqual(styleAward(move,200,true), { points:200,link:true });
  }
  assert.throws(() => validateRunLog({ v:3, board:'v3:TRAIN', course:{tf:1}, steps:1, rle:[1,0,100,0,0] }));
});

test('hazards are seeded, leave a safe side, and lasers cannot be cleared by an ordinary jump', () => {
  assert.equal(hazardPlan(61337,6),null);
  assert.deepEqual(hazardPlan(61337,19),hazardPlan(61337,19));
  assert.equal(new Set([19,26,33,40,47].map(i => hazardPlan(61337,i).side)).size,2);
  for (const side of [-1,1]) {
    const h = { side,kind:'laser',z:-100 };
    assert.equal(hazardHits(h,0,0,-100,0),true);
    assert.equal(hazardHits(h,0,4,-100,0),true);
    assert.equal(hazardHits(h,side*1.55,0,-100,0),false);
    assert.equal(hazardHits(h,0,0,-98,0),false);
    assert.equal(hazardHits({ ...h,kind:'mine' },0,1,-100,0),false);
  }
});
