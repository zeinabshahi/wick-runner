// Rules shared by the browser, score service and regression checks.
export const RULES_VERSION = 5;
export function hazardPlan(seed, i) {
  if (i < 19 || i % 7 !== 5) return null;
  const n = Math.floor(i / 7);
  return { side:(n ^ (n >> 1) ^ seed) & 1 ? 1 : -1, kind:(n + Math.floor(n / 3)) % 3 === 0 ? 'mine' : 'laser' };
}
export function hazardHits(h, x, y, z, top) {
  return x > -2.85 && x < 2.85 && Math.abs(z - h.z) < .65 && y < top + (h.kind === 'laser' ? 7 : .55) && y + 1.8 > top && (h.side > 0 ? x - .35 < .45 : x + .35 > -.45);
}
export const distancePoints = distance => Math.floor(Math.max(0, distance) * 2);
export const styleAward = (name, points, intentional) => name === 'ORB' ? { points:10, link:false } : { points:intentional ? points : 0, link:!!intentional };
export const MAX_STEPS = 120 * 60 * 30;
export const MAX_ARENA_CODE = 8192;
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
export function weekId(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7)).padStart(2, '0')}`;
}
export function fmtUnits(v, dec) {
  if (!Number.isInteger(dec) || dec < 0 || dec > 255) throw new Error('Invalid token decimals');
  const s = v.toString().padStart(dec + 1, '0');
  if (!dec) return BigInt(s).toLocaleString('en-US');
  const f = s.slice(-dec).replace(/0+$/, '').slice(0, 2);
  return BigInt(s.slice(0, -dec)).toLocaleString('en-US') + (f ? '.' + f : '');
}
export const quantizeYaw = yaw => Math.round(Math.atan2(Math.sin(yaw), Math.cos(yaw)) * 1000);
export function validateRunLog(log) {
  if (!log || log.v !== RULES_VERSION || typeof log.board !== 'string' || log.board.length > 12000 ||
      !log.course || !Number.isInteger(log.course.tf) || log.course.tf < 0 || log.course.tf > 3 ||
      !Number.isSafeInteger(log.steps) || log.steps < 1 || log.steps > MAX_STEPS ||
      !Array.isArray(log.rle) || log.rle.length % 5 || log.rle.length > MAX_STEPS * 5) throw new Error('Invalid replay');
  if (log.course.sym === 'SPRINT' && log.course.route !== undefined && (!Number.isInteger(log.course.route) || log.course.route < 0 || log.course.route > 2)) throw new Error('Invalid Sprint route');
  let steps = 0;
  for (let k = 0; k < log.rle.length; k += 5) {
    const [n, x, z, yaw, bits] = log.rle.slice(k, k + 5);
    if (![n, x, z, yaw, bits].every(Number.isSafeInteger) || n < 1 || n > MAX_STEPS ||
        Math.abs(x) > 100 || Math.abs(z) > 100 || Math.abs(yaw) > 3142 || bits < 0 || bits > 31) throw new Error('Invalid replay input');
    steps += n;
  }
  if (steps !== log.steps) throw new Error('Replay length mismatch');
  return log;
}
export const encodeArena = c => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(c)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function decodeArena(code) {
  if (typeof code !== 'string' || !code.length || code.length > MAX_ARENA_CODE || !/^[A-Za-z0-9_-]+$/.test(code)) throw new Error('Invalid arena link');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0))));
}
// All campaign fields and the publisher separate boards; signatures themselves do not change identity.
export const arenaIdentity = c => { const { sg, ...identity } = c; return encodeArena(identity); };

export function nextRunGoal({ cleared, candles, length, deaths, time, par, total, best = 0, sprint = false, tutorial = false }) {
  if (!cleared) return `Next goal: clear ${Math.min(length, candles + 5)} candles. Watch the next-gap cue and keep a jump in reserve.`;
  if (deaths === 1) return 'Next goal: finish without a death. Keep your full score and turn this into a clean line.';
  if (deaths > 0) return `Next goal: finish with ${deaths - 1} or fewer deaths. Each clean section protects your score.`;
  if (time > par) return `Next goal: cut ${Math.ceil(time - par)} seconds to beat par. Link your moves instead of stopping on each candle.`;
  if (best > 0 && total <= best) return `Next goal: earn ${Math.round(best - total + 1).toLocaleString('en-US')} more points to beat your best. Link 10 moves for Flow.`;
  if (tutorial) return 'Training complete. Take your timing into Sprint and take on a long endurance line.';
  return sprint ? 'Clean line mastered. Race your ghost or try the next Sprint route.' : 'Clean line mastered. Race your ghost or take on the next chart.';
}

export function compareRuns(current, previous) {
  if (!previous || !Number.isFinite(previous.score)) return null;
  const bothCleared = current.cleared === true && previous.cleared === true;
  return {
    score: current.score - previous.score,
    time: bothCleared && Number.isFinite(previous.time) ? current.time - previous.time : null,
    deaths: bothCleared && Number.isInteger(previous.deaths) ? current.deaths - previous.deaths : null,
  };
}

export function groundRouteCue(here, next, edge, speed) {
  if (!here) return { text:'KEEP RUNNING · STEER LEFT / RIGHT', danger:false };
  if (!here.green && here.crackT >= 0) return { text:`RED BREAKS IN ${Math.max(0, here.breakT - here.crackT).toFixed(1)}s · JUMP OFF`, danger:true };
  if (here.spring) return { text:'SPRING AHEAD · RUN ONTO THE PLATE', danger:false };
  if (here.pad && edge > here.depth / 2) return { text:'BLUE BOOST PAD · RUN THROUGH THE CENTER', danger:false };
  if (!next) return { text:'FINISH GATE AHEAD · KEEP RUNNING', danger:false };
  const near = edge <= Math.max(2.5, speed * .45), rise = next.top - here.top;
  const move = next.feature === 'rail' ? 'JUMP ONTO THE RAIL' : next.feature === 'wall' ? 'DOUBLE JUMP OR RIDE THE LEFT WALL' : next.feature === 'pole' ? 'JUMP + HOLD GRAB · RELEASE TO LAUNCH' : rise > 1.4 ? 'HIGH STEP · KEEP A SECOND JUMP READY' : rise < -2 ? 'BIG DROP · RUN OFF THE EDGE' : next.col && here.col && here.col.min.z - next.col.max.z <= .25 && rise <= .6 ? 'CONNECTED STEP · KEEP RUNNING' : !next.green ? 'JUMP THE GAP · RED BREAKS' : 'JUMP THE GAP · HOLD FOR HEIGHT';
  return { text:near ? move : `${Math.ceil(edge)}m AHEAD · ${move}`, danger:false };
}

export const forwardSwingLaunch = (vx, vz) => vz < -Math.hypot(vx, vz) * .75;

// The cursor follows first crossings, including ghosts that backtrack after a death.
export function ghostSplitAtDistance(frames, times, distance, cursor = 0) {
  let i = Math.min(cursor, times.length - 1);
  if (i < 0) return { index:0, time:null };
  while (i < times.length && -frames[i * 4 + 2] < distance) i++;
  if (i === times.length) return { index:i - 1, time:null };
  if (!i) return { index:0, time:times[0] };
  const from = -frames[(i - 1) * 4 + 2], to = -frames[i * 4 + 2];
  return { index:i, time:times[i - 1] + (times[i] - times[i - 1]) * Math.max(0, Math.min(1, (distance - from) / Math.max(.001, to - from))) };
}
