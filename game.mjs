import { RULES_VERSION, MAX_STEPS, utcDay, weekId, fmtUnits, quantizeYaw, validateRunLog, encodeArena, decodeArena, arenaIdentity, nextRunGoal, compareRuns, groundRouteCue, ghostSplitAtDistance, forwardSwingLaunch, distancePoints, styleAward, hazardPlan, hazardHits } from './game-core.mjs';
import { buildHaunt } from './haunt.mjs';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V3 = THREE.Vector3;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt)); // framerate-independent smoothing
const dampAngle = (a, b, k, dt) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * (1 - Math.exp(-k * dt)); };
const UP = new V3(0, 1, 0);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const VERIFY_MODE = new URLSearchParams(location.search).has('verify');

/* =====================================================================
   1. CHART DATA — seeded random walk with volatility regimes.
   Fixed seed = the "daily" course: everyone gets the same chart.
   ===================================================================== */
/* LEVELS — every in-game chart is a "token" with its own seed and personality.
   ENDLESS is seeded by today's UTC date (one shared daily market) and keeps getting harder. */
const LEVELS = [
  { sym: 'TRAIN', name: 'guided training', seed: 31337, len: 24, tutorial: true, stars: 0, vol: .8, bear: 0, breakT: 1.3, featEvery: 999, events: 0, forceEv: { 12: 'up', 20: 'down' }, theme: { sky: ['#0c0e15', '#151a26', '#1d2333'], fog: 0x171c28, rim: 0x7c95ff, up: 0x163a3a, down: 0x3a1a22, weather: { color: 0x8a93a8, size: .07, vy: .25 } }, music: { bpm: 90, roots: [55, 43.65, 49, 41.2], wave: 'triangle' } },
  { sym: 'CP01', stars: 1, name: 'first candles', tale: 'launch › range › breakout', story: [[.3, .5, .7], [.62, 0, .8], [1, .55, .9]], seed: 20261030, len: 1200, vol: 1, bear: 0, breakT: .9, featEvery: 6, events: .05, theme: { sky: ['#0c0e15', '#151a26', '#1d2333'], fog: 0x171c28, rim: 0x7c95ff, up: 0x163a3a, down: 0x3a1a22, weather: { color: 0x8a93a8, size: .07, vy: .25 } }, music: { bpm: 96, roots: [55, 43.65, 49, 41.2], wave: 'triangle' } },
  { sym: 'CP02', stars: 2, name: 'raid run', tale: 'pump › blow-off › dump › dead-cat bounce', story: [[.4, .6, 1], [.5, .9, 1.3], [.8, -.65, 1.2], [1, .3, 1]], seed: 7151, len: 1200, vol: 1.2, bear: .06, breakT: .8, featEvery: 5, events: .07, theme: { sky: ['#0f0a18', '#1b1330', '#2b1f45'], fog: 0x1c1430, rim: 0xb48cff, up: 0x24324a, down: 0x3d1d40, weather: { color: 0xc59bff, size: .09, vy: .7 } }, music: { bpm: 104, roots: [49, 41.2, 55, 36.7], wave: 'sawtooth' } },
  { sym: 'CP03', stars: 3, name: 'pfp season', tale: 'sideways chop › squeeze › parabola', story: [[.5, 0, 1.2], [.7, 0, .5], [1, .75, 1.2]], seed: 9283, len: 1200, vol: 1.4, bear: .1, breakT: .7, featEvery: 5, events: .09, theme: { sky: ['#130b0d', '#2a171a', '#4a2722'], fog: 0x2a1a1c, rim: 0xffa36b, up: 0x2a3a30, down: 0x4a2020, weather: { color: 0xff8a3d, size: .11, vy: 1.1 } }, music: { bpm: 90, roots: [65.4, 49, 55, 43.65], wave: 'triangle' } },
  { sym: 'CP04', stars: 4, name: 'guild wars', tale: 'bear trend › relief rally › capitulation › relief rally › final flush', story: [[.25, -.45, 1], [.38, .6, 1.2], [.65, -.5, 1.3], [.8, .55, 1.2], [1, -.35, 1.4]], seed: 4417, len: 1200, vol: 1.6, bear: .14, breakT: .6, featEvery: 4, events: .11, theme: { sky: ['#071014', '#0f1f25', '#173037'], fog: 0x10222a, rim: 0x5ad1ff, up: 0x12403c, down: 0x40161c, weather: { color: 0x9fd8ff, size: .05, vy: -11 } }, music: { bpm: 112, roots: [41.2, 36.7, 49, 32.7], wave: 'square' } },
  { sym: 'DAILY', name: 'endless daily chart', seed: +new Date().toISOString().slice(0, 10).replace(/-/g, ''), len: Infinity, endless: true, theme: { sky: ['#0a0d14', '#121a22', '#1b2a2a'], fog: 0x14201f, rim: 0xdcf513, up: 0x1d3d2c, down: 0x3a1c22, weather: { color: 0xdcf513, size: .06, vy: .4 } }, music: { bpm: 100, roots: [55, 61.7, 49, 46.2], wave: 'triangle' } },
  // WEEKLY CUP: one fixed chart per ISO week, 3 attempts, one life, its own board (see ECONOMY.md §6)
  { sym: 'CUP', period: weekId(), name: 'weekly cup', seed: +weekId().replace(/\D/g, '') * 13, len: 1200, cup: true, vol: 1.3, bear: .08, breakT: .75, featEvery: 5, events: .08, theme: { sky: ['#0e0c08', '#1c1910', '#2b2414'], fog: 0x1c1910, rim: 0xf5c542, up: 0x2a3a24, down: 0x3d1d16, weather: { color: 0xf5c542, size: .07, vy: .5 } }, music: { bpm: 108, roots: [49, 55, 41.2, 43.65], wave: 'sawtooth' } },
  { sym: 'SPRINT', name: 'endurance run', sprint: true, seed: 61337, len: 900, stars: 1, vol: .8, bear: 0, breakT: 1.1, featEvery: 12, events: 0, forceEv: { 12: 'up', 30: 'down', 44: 'up' }, theme: { sky: ['#0b1721', '#16343b', '#355252'], fog: 0x17343b, rim: 0x80e9cb, up: 0x254c4c, down: 0x4a2b38, weather: { color: 0xb1e7dc, size: .055, vy: .2 } }, music: { bpm: 110, roots: [55, 65.4, 49, 73.4], wave: 'triangle' }, tale: 'learn the rhythm › link the moves › finish strong' },
];
// HAUNT THE CHAIN (Oct 30 – Nov 6): night chart — red candles phase like ghosts, pumpkins replace orbs, the liquidation fog chases you
LEVELS.push({ sym: 'HAUNT', haunt: true, name: 'haunted chart', stars: 2, tale: 'midnight dump › ghost candles › outrun the fog', seed: 20261031, len: 600, vol: 1.2, bear: .1, breakT: .8, featEvery: 5, events: .08, theme: { sky: ['#07040c', '#170a20', '#2a1030'], fog: 0x1a0c22, rim: 0xff7a1a, up: 0x2a1a3a, down: 0x3d1408, weather: { color: 0xff9a3d, size: .08, vy: -.3 } }, music: { bpm: 104, roots: [43.65, 46.2, 41.2, 38.9], wave: 'sawtooth' } });
const SPRINT_ROUTES = [
  { name: 'Flowline', seed: 61337, featEvery: 12, forceEv: { 12: 'up', 30: 'down', 44: 'up' }, moves: [.55, .85, -.65, .7, -.45, .6, .9, -.55], note: 'Balanced rhythm · rails, springs and one big drop', phases: ['Find your rhythm', 'Link the moves', 'Finish strong'] },
  { name: 'Airline', seed: 71337, featEvery: 12, forceEv: { 8: 'up', 28: 'up', 44: 'down' }, moves: [.7, .35, -.4, .6, .5, -.3, .8, -.6], note: 'Climb and launch · read the springs before you leap', phases: ['Take the high line', 'Spring into the climb', 'Stick the descent'], sky: ['#171321', '#2c2440', '#4b425e'], fog: 0x2c2440, rim: 0xc9b5ff },
  { name: 'After Hours', seed: 91337, featEvery: 10, forceEv: { 10: 'down', 26: 'up', 46: 'up' }, moves: [.8, -.5, .4, -.55, .7, .4, -.35, .65], note: 'More connections · mix rails, wall-runs and swings', phases: ['Read the market', 'Keep the line alive', 'Make the last jump'], sky: ['#1b1510', '#372b24', '#5b4835'], fog: 0x372b24, rim: 0xffca8b },
];
let sprintPick = 0;
function makeSprintLevel(route = 0) {
  if (!Number.isInteger(route) || !SPRINT_ROUTES[route]) throw new Error('Unknown Sprint route');
  const base = LEVELS.find(l => l.sprint), r = SPRINT_ROUTES[route];
  return { ...base, ...r, name: `${r.name} · endurance run`, route, theme: { ...base.theme, sky: r.sky || base.theme.sky, fog: r.fog || base.theme.fog, rim: r.rim || base.theme.rim } };
}
let level = LEVELS[0];
/* TIMEFRAMES — the same chart read on a different candle size. Bigger candles = bigger moves: more volatility,
   more violent events, reds break sooner — and a bigger score multiplier. Training and the Cup are always 1H (fair boards). */
const TFS = [
  { id: '15m', ms: 9e5, vol: .75, events: .6, breakT: 1.15, mult: .8, note: 'calm chop' },
  { id: '1H', ms: 36e5, vol: 1, events: 1, breakT: 1, mult: 1, note: 'standard' },
  { id: '4H', ms: 1.44e7, vol: 1.3, events: 1.5, breakT: .88, mult: 1.3, note: 'big swings' },
  { id: '1D', ms: 8.64e7, vol: 1.6, events: 2, breakT: .78, mult: 1.6, note: 'violent moves' },
];
let tfPick = 1; // the player's chosen timeframe (saved); tfOf() applies it where the chart allows
const tfOf = lv => lv.arena ? TFS[lv.arena.f] : lv.tutorial || lv.cup || lv.sprint ? TFS[1] : TFS[tfPick];
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let rng = mulberry32(1);
const gauss = () => { let u = 0; while (!u) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); };
// Difficulty knobs at candle i. Endless ramps from VIBE-easy to harder than GUILD over ~400 candles.
function diff(i) {
  const k = Math.min(1, i / 400), tf = tfOf(level);
  const d = level.endless ? { vol: 1 + k * .8, bear: k * .16, breakT: .9 - k * .45, featEvery: k > .5 ? 4 : k > .2 ? 5 : 6, events: .04 + k * .08 } : level;
  const ramp = level.endless || level.tutorial ? 0 : Math.min(1, i / level.len); // finite charts get harder toward the finish
  return { vol: d.vol, bear: d.bear, breakT: d.breakT * tf.breakT * (1 - .25 * ramp), featEvery: d.featEvery, events: d.events * tf.events * (1 + .9 * ramp) };
}
const isPad = i => !level.tutorial && i % 32 === 16;

// Prices are in world units (y = price - 100). Each candle opens at the previous close,
// so a green candle's top is always above the previous candle and reds step down.
const candles = new Map(), mk = { price: 100, drift: 0, vol: 1, regime: 0 };
function nextCandle(i) {
  const d = diff(i);
  if (mk.regime-- <= 0) { // switch market regime: pump, dump or chop (bear shifts the odds toward dumps)
    if (level.story) { // campaign charts follow their market story: [until fraction, drift, volatility] segments
      const seg = level.story.find(q => i / level.len <= q[0]) || level.story.at(-1);
      mk.regime = 4 + Math.floor(rng() * 5); mk.drift = seg[1] + (rng() - .5) * .35; mk.vol = (.6 + rng() * .8) * seg[2] * d.vol;
    } else {
      mk.regime = 6 + Math.floor(rng() * 10);
      const r = rng(); mk.drift = r < .35 - d.bear ? .55 : r < .65 ? -.5 : 0; mk.vol = (.6 + rng() * 1.1) * d.vol;
    }
  }
  let move = (mk.drift + gauss() * mk.vol) * tfOf(level).vol; // the timeframe scales the whole move, trend and noise
  if (level.tutorial) move = [.4, .5, .35, -.35, .45, -.3][i % 6];
  if (level.sprint) { const moves = level.moves || SPRINT_ROUTES[0].moves; move = moves[i % moves.length]; }
  // market events: a violent pump (needs a spring) or a heavy dump (a long drop you land on)
  const fe = level.forceEv?.[i], ev = !!fe || (i > 6 && !isPad(i) && !isPad(i - 1) && rng() < d.events);
  if (ev) move = fe === 'up' ? (level.tutorial || level.sprint ? 3.2 : 4.5) : fe === 'down' ? (level.tutorial ? -3.5 : level.sprint ? -4 : -7) : rng() < .45 ? 3 + rng() * 3.5 : -(5 + rng() * 5);
  if (i < 3 || isPad(i)) move = Math.abs(move); // start + boost pads are always green
  const prevTop = i ? Math.max(candles.get(i - 1).o, candles.get(i - 1).c) : mk.price;
  let o, c;
  const tv = Math.max(1, tfOf(level).vol); // 4H / 1D candles move further: taller climbs (more springs) and deeper drops
  if (move >= 0) { o = mk.price; c = prevTop + clamp(move, .3, ev ? 6.5 : 2.2 * tv); }  // green: top always above the previous top (beyond 2.2 a spring is placed)
  else { o = mk.price - .15; c = o + clamp(move, ev ? -10 : -3.5 * tv, -.3); }          // red: opens a hair below the last close, so its top is lower
  const h = Math.max(o, c) + Math.abs(gauss()) * mk.vol * 1.4;
  const l = Math.min(o, c) - Math.abs(gauss()) * mk.vol * 1.2;
  candles.set(i, { o, h, l, c, v: Math.round((ev ? 2.2 : 1) * (1000 + rng() * 9000)), ev });
  mk.price = c;
}

/* =====================================================================
   RENDERER / SCENE / POST-PROCESSING (bloom does the neon glow)
   ===================================================================== */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const skyCanvas = document.createElement('canvas'); skyCanvas.width = 2; skyCanvas.height = 256;
scene.background = new THREE.CanvasTexture(skyCanvas); scene.background.colorSpace = THREE.SRGBColorSpace;
scene.fog = new THREE.FogExp2(0x171c28, 0.0075);
// Each chart has its own mood: sky gradient, fog, rim light and skyline candle colours.
function applyTheme(th) {
  const x = skyCanvas.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, th.sky[0]); g.addColorStop(.55, th.sky[1]); g.addColorStop(1, th.sky[2]);
  x.fillStyle = g; x.fillRect(0, 0, 2, 256); scene.background.needsUpdate = true;
  scene.fog.color.setHex(th.fog); rim.color.setHex(th.rim); skyUp.color.setHex(th.up); skyDown.color.setHex(th.down);
  dust.material.color.setHex(th.weather.color); dust.material.size = th.weather.size; dustVy = th.weather.vy; // ash / sparks / embers / rain
}
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 900);

const hemi = new THREE.HemisphereLight(0xdfe6f5, 0x1a1d29, 1.4); scene.add(hemi);
// Sun casts real soft shadows; its shadow box follows the runner (see updateCamera).
const rim = new THREE.DirectionalLight(0x7c95ff, .9); scene.add(rim, rim.target);
const skyUp = new THREE.MeshBasicMaterial({ color: 0x163a3a }), skyDown = new THREE.MeshBasicMaterial({ color: 0x3a1a22 });
const skyline = new THREE.Group(); scene.add(skyline);
{
  const mg = skyUp, mr = skyDown;
  for (let i = 0; i < 70; i++) {
    const h = 6 + Math.random() * 30, up = Math.random() < .55, b = new THREE.Mesh(new THREE.BoxGeometry(4, h, 4), up ? mg : mr);
    b.position.set((i % 2 ? 1 : -1) * (45 + Math.random() * 70), (Math.random() - .5) * 30, -260 + i * 7.4 + Math.random() * 3);
    b.add(new THREE.Mesh(new THREE.BoxGeometry(.5, h + 8 + Math.random() * 10, .5), up ? mg : mr)); // wick
    skyline.add(b);
  }
}
const haunt = buildHaunt(THREE, isTouch ? .5 : 1); scene.add(haunt.group); // phones get half the scenery
const sun = new THREE.DirectionalLight(0xfff4e0, 1.8); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 60 });
sun.shadow.bias = -.0005; sun.shadow.normalBias = .02; scene.add(sun, sun.target);
const playerLight = new THREE.PointLight(0xffffff, 2, 8, 1.6); scene.add(playerLight);
const districtGrid = new THREE.GridHelper(240, 48, 0x36535d, 0x263b49);
districtGrid.material.transparent = true; districtGrid.material.opacity = .23; districtGrid.material.depthWrite = false; scene.add(districtGrid);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.3, 0.4, 0.75); // subtle: only the brightest accents bloom
composer.addPass(bloom);
// Lens pass: soft vignette, speed-driven chromatic aberration, gentle filmic grade and grain.
const lens = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uAb: { value: 0 }, uTime: { value: 0 }, uDesat: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAb, uTime, uDesat; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - .5; float r = dot(d, d);
      vec3 c = vec3(texture2D(tDiffuse, vUv - d * uAb).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + d * uAb).b);
      c = mix(c, vec3(dot(c, vec3(.299, .587, .114))) * .8, uDesat);   // death: colour drains out
      c *= mix(1.0, .72, smoothstep(.15, .65, r));                 // vignette
      c = mix(c, c * vec3(1.03, 1.0, .96), .5);                    // slightly warm highlights
      c += (h(vUv * 900. + uTime) - .5) * .008;                    // film grain
      gl_FragColor = vec4(c, 1.0); }`,
});
composer.addPass(lens);
const smaa = new SMAAPass(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
composer.addPass(smaa);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth / 2, innerHeight / 2);
  smaa.setSize(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
});


/* =====================================================================
   PARTICLES — one pooled additive Points system for every effect
   (trail, dust, sparks, cracks, shatter, pickups). Fading = colour→0.
   ===================================================================== */
const MAXP = 3000;
const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3), pVel = new Float32Array(MAXP * 3);
const pBase = new Float32Array(MAXP * 3), pLife = new Float32Array(MAXP), pMax = new Float32Array(MAXP), pGrav = new Float32Array(MAXP);
let pHead = 0;
pPos.fill(-9999);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const dotTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, '#fff'); gr.addColorStop(.3, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: .26, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
particles.frustumCulled = false; scene.add(particles);
const _c = new THREE.Color();

function emit(x, y, z, vx, vy, vz, hex, life, grav = 0) {
  const i = pHead; pHead = (pHead + 1) % MAXP; const j = i * 3;
  _c.setHex(hex);
  pPos[j] = x; pPos[j + 1] = y; pPos[j + 2] = z; pVel[j] = vx; pVel[j + 1] = vy; pVel[j + 2] = vz;
  pBase[j] = _c.r; pBase[j + 1] = _c.g; pBase[j + 2] = _c.b; pLife[i] = pMax[i] = life; pGrav[i] = grav;
}
function burst(x, y, z, n, hex, spd, life, grav = 0, up = 0) {
  for (let k = 0; k < n; k++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u), v = spd * (.4 + Math.random() * .6);
    emit(x, y, z, s * Math.cos(th) * v, u * v + up, s * Math.sin(th) * v, hex, life * (.5 + Math.random() * .5), grav);
  }
}
function updateParticles(dt) {
  for (let i = 0; i < MAXP; i++) {
    if (pLife[i] <= 0) continue;
    const j = i * 3;
    pLife[i] -= dt;
    if (pLife[i] <= 0) { pPos[j + 1] = -9999; pCol[j] = pCol[j + 1] = pCol[j + 2] = 0; continue; }
    pVel[j + 1] -= pGrav[i] * dt;
    const drag = Math.exp(-1.5 * dt); pVel[j] *= drag; pVel[j + 2] *= drag;
    pPos[j] += pVel[j] * dt; pPos[j + 1] += pVel[j + 1] * dt; pPos[j + 2] += pVel[j + 2] * dt;
    const f = pLife[i] / pMax[i];
    pCol[j] = pBase[j] * f; pCol[j + 1] = pBase[j + 1] * f; pCol[j + 2] = pBase[j + 2] * f;
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}
function clearParticles() { pLife.fill(0); pPos.fill(-9999); pCol.fill(0); }

/* =====================================================================
   AUDIO — tiny Web Audio synth, no assets. Starts on first click.
   ===================================================================== */
const Sfx = {
  ctx: null,
  init() {
    if (VERIFY_MODE || !recording) return;
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = .55; this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain(); this.musicBus = this.ctx.createGain(); this.sfxBus.connect(this.master); this.musicBus.connect(this.master);
    this.setVolumes(this.vol[0], this.vol[1]); this.loadBank();
    const len = this.ctx.sampleRate; this.noiseBuf = this.ctx.createBuffer(1, len, len);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // looping grind hiss, gated by grindGain
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 4;
    // looping wind, louder in long falls and at boost speed
    const ws = this.ctx.createBufferSource(); ws.buffer = this.noiseBuf; ws.loop = true;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650;
    this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0; ws.connect(lp).connect(this.windGain).connect(this.sfxBus); ws.start();
    this.grindGain = this.ctx.createGain(); this.grindGain.gain.value = 0;
    src.connect(bp).connect(this.grindGain).connect(this.sfxBus); src.start();
  },
  vol: [.6, .8], MUSIC_BOOST: 1.8, // the music files sit at -16 LUFS; without this boost the bed hid under the effects
  setVolumes(music, sfx) { this.vol = [music, sfx]; if (this.ctx) { this.musicBus.gain.value = this.paused ? 0 : music * this.MUSIC_BOOST; this.sfxBus.gain.value = sfx; } },
  tone(f, d, type = 'square', v = .1, f2 = f, delay = 0, out = this.sfxBus) {
    if (!this.ctx) return; const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = type;
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g).connect(out); o.start(t); o.stop(t + d + .02);
  },
  noise(d, v = .2, freq = 1000, type = 'lowpass', delay = 0, out = this.sfxBus) {
    if (!this.ctx) return; const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    s.connect(f).connect(g).connect(out); s.start(t, Math.random() * .5); s.stop(t + d + .02);
  },
  wind(v) { if (this.ctx) this.windGain.gain.setTargetAtTime(v, this.ctx.currentTime, .12); },
  // RECORDED SOUND — real samples from audio/sounds.json (CC0 / CC BY, credits in audio/CREDITS.md), several takes per sound.
  // Every method below falls back to its synth voice while samples load or if a file is missing.
  bank: {}, tracks: {},
  async loadBank() {
    try {
      const list = await (await fetch('audio/sounds.json')).json();
      await Promise.all(Object.entries(list).map(async ([k, files]) => {
        if (k.startsWith('music_')) { this.tracks[k] = files; return; } // long tracks stream through an <audio> element
        this.bank[k] = (await Promise.all(files.map(f => fetch('audio/' + f).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b)).catch(() => null)))).filter(Boolean);
      }));
      this.setScene(this.scene);
    } catch (e) {}
  },
  play(k, v = 1, rate = 1, delay = 0, out = this.sfxBus) {
    const b = this.bank[k]; if (!this.ctx || !b?.length) return false;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = b[Math.floor(Math.random() * b.length)]; s.playbackRate.value = rate * (.95 + Math.random() * .1); // take + pitch variation: no machine-gun repeats
    g.gain.value = v; s.connect(g).connect(out); s.start(this.ctx.currentTime + delay); return true;
  },
  // per-mode bed: 'main' or 'haunt' picks the music track and the ambience loop
  setScene(sc = 'main') {
    this.scene = sc; if (!this.ctx) return;
    const list = this.tracks['music_' + sc] || this.tracks.music_main;
    if (list?.length && !this.musicEl) { this.musicEl = new Audio(); this.musicEl.loop = true; this.ctx.createMediaElementSource(this.musicEl).connect(this.musicBus); }
    if (list?.length) { const want = 'audio/' + list[0]; if (!this.musicEl.src.endsWith(want)) this.musicEl.src = want; this.syncMusic(); }
    const amb = this.bank[sc === 'haunt' ? 'amb_haunt' : 'amb_wind'];
    if (this.ambSrc) { this.ambSrc.stop(); this.ambSrc = null; }
    if (amb?.length) { const a = this.ctx.createBufferSource(), g = this.ctx.createGain(); a.buffer = amb[0]; a.loop = true; this.ambLevel = sc === 'haunt' ? .35 : .12; g.gain.value = this.paused ? 0 : this.ambLevel; a.connect(g).connect(this.sfxBus); a.start(); this.ambSrc = a; this.ambGain = g; }
  },
  get fileMusic() { return !!this.musicEl?.src; },
  syncMusic() { // fades, never hard cuts: down in 0.35 s (then the element pauses), back up in 0.6 s
    if (!this.ctx) return; const on = !this.muted && !this.paused && this.musicOn, g = this.musicBus.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(on ? this.vol[0] * this.MUSIC_BOOST : 0, now + (on ? .6 : .35));
    clearTimeout(this.pauseT); if (!this.musicEl?.src) return;
    if (on) this.musicEl.play().catch(() => {}); else this.pauseT = setTimeout(() => this.musicEl.pause(), 400);
  },
  step() { this.noise(.05, .03, 700 + Math.random() * 500); },
  grind(on) { // real metal-scrape loop once loaded, the filtered-noise hiss until then
    if (!this.ctx) return; const b = this.bank.grind?.[0], now = this.ctx.currentTime;
    if (b && !this.grindLoop) { const s = this.ctx.createBufferSource(); s.buffer = b; s.loop = true; this.grindLoopGain = this.ctx.createGain(); this.grindLoopGain.gain.value = 0; s.connect(this.grindLoopGain).connect(this.sfxBus); s.start(); this.grindLoop = s; }
    this.grindGain.gain.setTargetAtTime(on && !b ? .14 : 0, now, .03); this.grindLoopGain?.gain.setTargetAtTime(on ? .55 : 0, now, .03);
  },
  jump() { this.play('jump', .45) || this.tone(300, .12, 'square', .05, 620); },
  djump() { if (this.play('djump', .4)) return; this.tone(500, .16, 'triangle', .09, 1200); this.tone(750, .12, 'sine', .05, 1500, .03); },
  land(i) { this.play('land', clamp(i / 35, .12, .9), 1.1 - clamp(i / 120, 0, .25)) || this.noise(.08 + i / 250, clamp(i / 70, .04, .3), 450); },
  perfect() { if (this.play('perfect', .45)) return; this.tone(880, .14, 'sine', .1); this.tone(1320, .25, 'sine', .1, 1320, .07); },
  clutch() { this.tone(660, .1, 'square', .06, 990); },
  crack() { this.play('crack', .35, 1.2) || this.noise(.06, .12, 3000, 'highpass'); },
  shatter() { if (!this.play('glass', .75)) this.noise(.6, .45, 1400); this.tone(140, .5, 'sawtooth', .08, 35); },
  collect() { if (this.play('coin', .5)) return; this.tone(1046, .08, 'sine', .1); this.tone(1568, .15, 'sine', .1, 2093, .06); },
  boost() { if (this.play('boost', .55)) return; this.tone(180, .45, 'sawtooth', .1, 900); this.noise(.4, .15, 4000, 'highpass'); },
  wall() { this.tone(220, .2, 'triangle', .08, 440); },
  dash() { this.noise(.25, .2, 2500, 'bandpass'); this.tone(400, .15, 'sine', .06, 200); },
  slide() { this.noise(.4, .12, 800); },
  spring() { if (this.play('spring', .6)) return; this.tone(180, .4, 'sine', .14, 720); this.tone(360, .3, 'triangle', .05, 1100, .03); },
  roll() { this.noise(.4, .14, 600); this.tone(140, .25, 'sine', .08, 90); },
  thud() { this.play('thud', .8) || (this.tone(90, .35, 'sine', .25, 35), this.noise(.3, .3, 300)); },
  launch() { this.tone(400, .22, 'square', .06, 1000); },
  death() { if (this.play('death', .7)) return; this.tone(400, .6, 'sawtooth', .12, 50); this.noise(.5, .3, 600); },
  gameover() { this.play('death', .5, .7); this.play('gameover', 1, 1, .15) || this.tone(220, 1.2, 'sawtooth', .08, 55, .35); },
  checkpoint() { this.play('checkpoint', .5) || this.tone(988, .2, 'sine', .07); },
  // pause / quit: the whole mix stops (music too) and picks up again on resume
  setPaused(on, quiet = false) { this.paused = on; if (!this.ctx) return; if (!quiet) this.play(on ? 'pause' : 'resume', .5); if (on) { this.grind(false); this.wind(0); } this.syncMusic(); if (this.ambSrc) this.ambGain.gain.setTargetAtTime(on ? 0 : this.ambLevel, this.ctx.currentTime, .08); },
  bank() { if (this.play('bank', .45)) return; [523, 659, 784].forEach((f, i) => this.tone(f, .12, 'square', .05, f, i * .07)); },
  climb() { this.noise(.18, .1, 900); this.tone(220, .2, 'triangle', .05, 330); },
  flowOn() { [659, 880, 1175].forEach((f, i) => this.tone(f, .2, 'triangle', .06, f * 1.5, i * .06)); },
  flip() { if (this.play('flip', .4)) return; this.noise(.35, .12, 1400, 'bandpass'); this.tone(320, .3, 'sine', .04, 700); },
  count(go) { if (this.play(go ? 'go' : 'tick', go ? .55 : .45)) return; this.tone(go ? 880 : 440, go ? .35 : .15, 'square', .06, go ? 1320 : 440); },
  // PARKOUR DRIVE — a procedural 32-bar track: intro › drive › drop › breakdown › build, then round again.
  // Tempo = the chart's BPM + 36 (≈126–148). Kick ducks everything else (sidechain pump); flow state forces the drop's energy.
  muted: false,
  tempo() { return (level.music?.bpm || 96) + 36; },
  startMusic() {
    if (this.musicOn || !this.ctx) return; this.musicOn = true; this.syncMusic(); let i = 0, next = this.ctx.currentTime + .1;
    this.duck = this.ctx.createGain(); this.duck.connect(this.musicBus);
    setInterval(() => { while (next < this.ctx.currentTime + .25) { this.beat(i++, next - this.ctx.currentTime); next += 60 / this.tempo() / 4; } }, 50);
  },
  synth(f, d, type, v, cut, delay, f2 = f) { // oscillator through a resonant lowpass that closes over the note
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), fl = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    fl.type = 'lowpass'; fl.Q.value = 7; fl.frequency.setValueAtTime(cut, t); fl.frequency.exponentialRampToValueAtTime(Math.max(90, cut * .12), t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(fl).connect(g).connect(this.duck); o.start(t); o.stop(t + d + .02);
  },
  beat(i, d) {
    if (this.muted || this.paused || this.fileMusic) return;
    const mu = level.music || { roots: [55, 43.65, 49, 41.2] }, st = i % 16, bar = Math.floor(i / 16) % 32, root = mu.roots[Math.floor(i / 16) % 4];
    const sec = bar < 4 ? 'intro' : bar < 16 ? 'drive' : bar < 24 ? 'drop' : bar < 28 ? 'break' : 'build', hype = sec === 'drop' || flow;
    const t = this.ctx.currentTime + d, M = this.musicBus, D = this.duck, barLen = 240 / this.tempo();
    // KICK: four on the floor (plus a push on the "and" of 4 in the drop); silent in the breakdown. Ducks the rest.
    if (sec !== 'break' && (st % 4 === 0 || (hype && st === 14))) {
      this.tone(160, .3, 'sine', .34, 40, d, M); this.noise(.012, .07, 4500, 'highpass', d, M);
      D.gain.cancelScheduledValues(t); D.gain.setValueAtTime(.3, t); D.gain.linearRampToValueAtTime(1, t + .17);
    }
    // SNARE on 2 and 4; in the build a roll that speeds up (quarters › eighths › sixteenths) and swells
    if ((sec === 'drive' || sec === 'drop') && (st === 4 || st === 12)) { this.noise(.17, .2, 1900, 'bandpass', d, M); this.tone(210, .09, 'triangle', .09, 150, d, M); }
    if (sec === 'build' && (bar < 30 ? st % 4 === 0 : bar < 31 ? st % 2 === 0 : true)) this.noise(.07, .05 + (bar - 28) * .035 + st * .002, 1900, 'bandpass', d, M);
    // RISER into the drop: filtered noise sweeping up across the 4-bar build
    if (sec === 'build' && bar === 28 && st === 0) {
      const n = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain(); n.buffer = this.noiseBuf; n.loop = true;
      f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(7000, t + barLen * 4);
      g.gain.setValueAtTime(.001, t); g.gain.exponentialRampToValueAtTime(.09, t + barLen * 4 - .05); g.gain.linearRampToValueAtTime(0, t + barLen * 4);
      n.connect(f).connect(g).connect(M); n.start(t); n.stop(t + barLen * 4 + .05);
    }
    // HATS: 16ths with accented off-beats (8ths in the intro); open hat on every off-beat in the drop
    if (sec !== 'intro' || st % 2 === 0) this.noise(.025, st % 4 === 2 ? .05 : .02, 9000, 'highpass', d, D);
    if (hype && st % 4 === 2) this.noise(.13, .035, 6500, 'highpass', d, D);
    // BASS: driving 8ths with an octave jump, the filter opens up in the drop
    if (sec !== 'break' && sec !== 'intro' && st % 2 === 0) this.synth(root * (st % 8 === 6 ? 2 : 1), .17, 'sawtooth', .14, hype ? 1500 : 650, d);
    if (sec === 'intro' && st % 4 === 0) this.synth(root, .3, 'sawtooth', .1, 400, d);
    // LEAD: a 2-bar minor-pentatonic riff — call-and-answer in the drive, full in the drop, an octave up in flow
    const riff = [0, -1, 0, 2, -1, 3, -1, 2, 4, -1, 3, 2, -1, 0, -1, 1, 0, -1, 0, 2, -1, 3, -1, 5, 4, -1, 3, -1, 2, -1, 1, -1];
    const n = riff[i % 32], scale = [1, 1.189, 1.335, 1.498, 1.782, 2];
    if (n >= 0 && (sec === 'drop' || (sec === 'drive' && bar % 4 >= 2) || (flow && sec !== 'break')))
      this.synth(root * 8 * scale[n] * (flow ? 2 : 1), .14, 'square', .04, 3200, d);
    // BREAKDOWN: a wide sustained minor chord and a slow pulse, room to breathe before the build
    if (sec === 'break' && st === 0) [1, 1.189, 1.498, 2].forEach(m => this.synth(root * 4 * m, barLen * .95, 'sawtooth', .022, 2200, d));
    if (sec === 'break' && st % 4 === 2) this.synth(root * 8 * scale[(i >> 2) % 5], .2, 'triangle', .03, 2500, d);
  },
  // short fanfare when a chart is cleared
  win() { this.play('fw_boom', .6); this.play('fw_crackle', .45, 1, .2); if (this.play('win', .8)) return; [523, 659, 784, 1047].forEach((f, i) => this.tone(f, .22, 'square', .06, f, i * .09)); [1047, 1319, 1568].forEach(f => this.tone(f, .9, 'triangle', .04, f, .36)); },

};

/* =====================================================================
   2. COURSE GENERATION — streamed: candles are built ~60 ahead of the
   runner and (in endless) disposed ~30 behind, so a run can go forever.
   Body top/bottom = open/close, thin cylinders = wicks, long upper wicks
   are swing poles. Every Nth gap is a "feature gap" (rail / wall / pole).
   Everything a candle creates is tagged with its index `ci` for cleanup.
   ===================================================================== */
const PLAT_W = 5, PLAT_D = 5.6, GAP = 2.0, SLOT = PLAT_D + GAP;
const course = new THREE.Group(); scene.add(course);
const platforms = new Map(), colliders = [], rails = [], poles = [], orbs = [];
let finishZ = -Infinity, spawn = new V3(), gen;

// Matte "trading terminal" palette (TradingView-style green/red), only accents glow.
const RED_GLOW = .04;
const matGreen = new THREE.MeshStandardMaterial({ color: 0x26a69a, emissive: 0x26a69a, emissiveIntensity: .06, roughness: .85, metalness: 0 });
const matRed = new THREE.MeshStandardMaterial({ color: 0xef5350, emissive: 0xff3030, emissiveIntensity: RED_GLOW, roughness: .85, metalness: 0 });
const edgeInk = new THREE.LineBasicMaterial({ color: 0x15161a }); // dark ink outlines, same style as the vibers
const wickGreen = new THREE.MeshLambertMaterial({ color: 0x26a69a });
const wickRed = new THREE.MeshLambertMaterial({ color: 0xef5350 });
const poleMat = new THREE.MeshLambertMaterial({ color: 0xf5c542, emissive: 0x3a2a00 });
const railMat = new THREE.MeshLambertMaterial({ color: 0xc9d1dc, emissive: 0x202830 });
const padMat = new THREE.MeshBasicMaterial({ color: 0x2962ff });
const orbMat = new THREE.MeshLambertMaterial({ color: 0xf5c542, emissive: 0x6a4a00 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2e39, roughness: .9, transparent: true, opacity: .6 });
const wallEdge = new THREE.LineBasicMaterial({ color: 0x5d6475 });
const padStartMat = new THREE.MeshStandardMaterial({ color: 0x363a45, roughness: .9 });
const maMat = new THREE.MeshBasicMaterial({ color: 0xff9800 });
const lipLive = new THREE.MeshStandardMaterial({ color: 0xdcf513, emissive: 0xdcf513, emissiveIntensity: .4, roughness: .6 }); // blinking top = live candle
const liveCandles = [];
function killLive(pl) { // freeze a live candle back at its base height
  Object.assign(pl, { top: pl.live.base, bot: pl.live.baseBot }); pl.col.max.y = pl.top; pl.col.min.y = pl.bot;
  pl.group.position.y = (pl.top + pl.bot) / 2; pl.lipLive.material = pl.green ? lipGreen : lipRed; pl.live = null;
}
const lipGreen = new THREE.MeshStandardMaterial({ color: 0x5fd6c8, roughness: .6 }), lipRed = new THREE.MeshStandardMaterial({ color: 0xff8a85, roughness: .6 });
const springMat = new THREE.MeshLambertMaterial({ color: 0xdcf513, emissive: 0x2a3000 });
const _v = new V3();

function box(w, h, d, mat, edgeMat) {
  const g = new THREE.BoxGeometry(w, h, d), m = new THREE.Mesh(g, mat);
  if (edgeMat) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat));
  return m;
}
function cyl(a, b, r, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6), mat);
  m.position.copy(a).add(b).multiplyScalar(.5);
  m.quaternion.setFromUnitVectors(UP, _v.copy(b).sub(a).normalize());
  return m;
}
function put(obj, parent = course) { obj.userData.ci = gen.i; parent.add(obj); return obj; } // add + tag with current candle index
function addOrb(x, y, z) {
  const m = put(level.haunt ? haunt.lantern(.36) : new THREE.Mesh(new THREE.OctahedronGeometry(.38), orbMat)); m.position.set(x, y, z);
  orbs.push({ mesh: m, base: y, taken: false, ci: gen.i });
}
function poleRings(x, z, yb, yt) { // stacked rings mark a grabbable pole
  for (let y = yb + 1.5; y < yt; y += 2) {
    const r = put(new THREE.Mesh(new THREE.TorusGeometry(.32, .04, 6, 16), poleMat));
    r.rotation.x = Math.PI / 2; r.position.set(x, y, z);
  }
}

function buildFeature(type, a, b) {
  const zA = a.col.min.z, zB = b.col.max.z, midZ = (zA + zB) / 2, ci = gen.i; // a's front edge, b's back edge
  if (type === 'rail') {
    const s = new V3(a.x, a.top + .8, zA + 1.4), e = new V3(b.x, b.top + .7, zB - .8); // ends near b's back edge so you land on b
    put(cyl(s, e, .09, railMat)); put(cyl(new V3(s.x, a.top, s.z), s, .05, railMat)); put(cyl(new V3(e.x, b.top, e.z), e, .05, railMat));
    const dir = e.clone().sub(s), len = dir.length(); dir.normalize();
    rails.push({ a: s, b: e, dir, len, ci });
    for (const t of [.3, .5, .7]) { _v.copy(s).addScaledVector(dir, len * t); addOrb(_v.x, _v.y + 1.1, _v.z); }
  } else if (type === 'wall') {
    const side = -1, wx = a.x + side * 2.9; // always on the far side so it never blocks the chart-view camera
    const z0 = zB + 1.5, z1 = zA + 1, y0 = Math.min(a.top, b.top) - 4, y1 = Math.max(a.top, b.top) + 5;
    put(box(.5, y1 - y0, z1 - z0, wallMat, wallEdge)).position.set(wx, (y0 + y1) / 2, (z0 + z1) / 2);
    for (let y = y0 + 1; y < y1; y += 1.5) put(box(.52, .05, z1 - z0, poleMat)).position.set(wx, y, (z0 + z1) / 2); // stripes read as runnable
    colliders.push({ min: new V3(wx - .25, y0, z0), max: new V3(wx + .25, y1, z1), type: 'wall', active: true, ci });
    for (const t of [.25, .5, .75]) addOrb(wx - side * 1, Math.max(a.top, b.top) + 2.4, lerp(zA, zB, t));
  } else { // free-floating wick pole in the middle of the gap
    const px = (a.x + b.x) / 2, yb = Math.min(a.top, b.top) - 3, yt = Math.max(a.top, b.top) + 5.5;
    put(cyl(new V3(px, yb, midZ), new V3(px, yt, midZ), .14, poleMat));
    poleRings(px, midZ, yb, yt);
    poles.push({ x: px, z: midZ, yb, yt, active: true, ci });
    for (let k = 0; k < 3; k++) { const an = k / 3 * Math.PI * 2; addOrb(px + Math.cos(an) * 2, a.top + 2.5, midZ + Math.sin(an) * 2); }
  }
}

// Build candle gen.i (plus its feature gap, orbs and chart-backdrop pieces). Returns false at the end of a finite chart.
function genCandle() {
  const i = gen.i, prev = gen.prev, x = 0;
  if (i >= level.len) return false;
  nextCandle(i);
  const k = candles.get(i), d = diff(i), green = k.c >= k.o;
  const top = Math.max(k.o, k.c) - 100, bodyH = Math.max(top - (Math.min(k.o, k.c) - 100), .35), bot = top - bodyH;
  const hi = k.h - 100, lo = k.l - 100;
  const climb = prev ? top - (prev.live ? prev.live.base : prev.top) : 0;

  // Candles sit on a uniform time axis like a real chart: one row, fixed slot width.
  // Big moves (features, boost pads) skip one slot — an empty "gap day" on the chart.
  let gap = 0, feature = null;
  if (prev) {
    gap = GAP;
    if (prev.pad) gap += SLOT;
    else if (i > 4 && i % d.featEvery === 2 && !k.ev && climb <= 2.2 && climb > -3.6) { feature = ['rail', 'wall', 'pole'][gen.nFeat++ % 3]; gap += SLOT; }
  }
  const depth = PLAT_D, zBack = gen.cursor - gap, zFront = zBack - depth, zc = (zBack + zFront) / 2;
  gen.cursor = zFront;

  const mat = green ? matGreen : matRed.clone(); // reds get their own material so each can pulse
  if (!green) mat.userData.perCandle = true;
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(PLAT_W, bodyH, depth, 3, Math.min(.14, bodyH / 2 - .02)), mat); mesh.castShadow = mesh.receiveShadow = true;
  var lip = new THREE.Mesh(new THREE.BoxGeometry(PLAT_W - .3, .03, depth - .3), green ? lipGreen : lipRed); lip.position.y = bodyH / 2 + .005; lip.receiveShadow = true; mesh.add(lip);
  const group = put(new THREE.Group()); group.position.set(x, (top + bot) / 2, zc); group.add(mesh);
  const wm = green ? wickGreen : wickRed, h2 = bodyH / 2;
  if (hi - top > .3) group.add(cyl(new V3(0, h2, 0), new V3(0, h2 + hi - top, 0), .08, wm));
  if (bot - lo > .3) group.add(cyl(new V3(0, -h2, 0), new V3(0, -h2 - (bot - lo), 0), .08, wm));

  if (level.haunt && !green) { const f = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(2.2, PLAT_W * .6), Math.min(2.2, bodyH * .9)), haunt.ghostFace); f.position.z = depth / 2 + .02; mesh.add(f); } // ghost candles have faces
  if (level.haunt && green && i % 3 === 1) { const l = haunt.lantern(.32); l.position.set((i % 2 ? 1 : -1) * (PLAT_W / 2 - .35), h2 + .27, depth / 2 - .4); l.rotation.y = (i % 2 ? -1 : 1) * .4; group.add(l); }
  const plat = { i, green, x, zc, top, bot, depth, group, mesh, mat, crackT: -1, broken: false, breakT: d.breakT, pad: isPad(i), pole: null };
  if (hi - top > 2.4) { // long upper wick = grabbable pole
    plat.pole = { x, z: zc, yb: top, yt: hi, active: true, plat, ci: i };
    poles.push(plat.pole);
    const r = new THREE.Mesh(new THREE.TorusGeometry(.32, .04, 6, 16), poleMat); r.rotation.x = Math.PI / 2; r.position.set(0, h2 + hi - top - .6, 0); group.add(r);
  }
  if (plat.pad) {
    const pad = box(3, .1, 2.4, padMat); pad.position.y = h2 + .06; group.add(pad);
    for (const s of [-1, 1]) { const c = box(1.2, .12, .18, orbMat); c.position.set(s * .4, h2 + .1, 0); c.rotation.y = s * .7; group.add(c); }
    plat.padMesh = pad;
  }
  plat.col = { min: new V3(x - PLAT_W / 2, bot, zFront), max: new V3(x + PLAT_W / 2, top, zBack), type: 'plat', plat, active: true, ci: i };
  // Surface markings carry the same information as color: safe bars versus a cracked X.
  const markMat = green ? lipGreen : lipRed;
  for (const side of [-1, 1]) {
    const mark = new THREE.Mesh(new THREE.BoxGeometry(green ? .065 : 1.1, .025, green ? depth * .65 : .065), markMat);
    mark.position.set(green ? side * (PLAT_W / 2 - .3) : 0, bodyH / 2 + .035, green ? 0 : side * .03);
    if (!green) mark.rotation.y = side * Math.PI / 4;
    mesh.add(mark);
  }
  colliders.push(plat.col);
  platforms.set(i, plat);

  if (climb > 2.2) addSpring(prev, plat); // too high to jump: a spring on the previous candle's front edge
  if (prev?.live && (top - prev.live.base > 1.2 || feature)) killLive(prev); // keep the next step reachable and features attached
  // LIVE candle: the forming candle of the chart — its body bobs up and down while you're on it
  const liveRng = mulberry32(level.seed ^ Math.imul(i + 1, 0x9e3779b1));
  if (!feature && !plat.pad && !k.ev && !level.tutorial && !level.sprint && i > 8 && Math.abs(climb) < 1 && liveRng() < (level.endless ? .16 : .13)) {
    plat.live = { base: top, baseBot: bot, amp: .9, ph: liveRng() * 6.28 }; plat.lipLive = lip; lip.material = lipLive;
    liveCandles.push(plat);
  }
  if (feature) { buildFeature(feature, prev, plat); plat.feature = feature; }
  else if (prev && i % 5 === 0) for (const t of [.25, .5, .75]) addOrb(lerp(prev.x, x, t), Math.max(prev.top, top) + 1.4 + Math.sin(t * Math.PI) * 1.4, lerp(prev.col.min.z, zBack, t));

  // chart backdrop pieces for this candle: volume bar, time grid line + date every 5th, MA(9) segment
  const vh = k.v / 10000 * 2.2;
  put(new THREE.Mesh(new THREE.BoxGeometry(.1, vh, PLAT_D * .8), green ? volGreen : volRed), volumeBars).position.set(BACK_X + .1, vh / 2, zc);
  if (i % 6 === 0) { // time axis: a label every 6 candles — clock time, or the date at midnight (always the date on 1D)
    const d = new Date(START_TIME + i * tfOf(level).ms), hh = d.getUTCHours(), mm = d.getUTCMinutes();
    put(textSprite(hh || mm ? String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') : d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })), dateAxis).position.set(BACK_X, -.6, zc);
    put(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(BACK_X, top - 40, zc), new V3(BACK_X, top + 40, zc)]), gridMat));
  }
  const win = Array.from({ length: Math.min(9, i + 1) }, (_, n) => candles.get(i - n)), ma = new V3(-PLAT_W / 2 - .3, win.reduce((a, q) => a + q.c, 0) / win.length - 100, zc);
  if (gen.ma) put(cyl(gen.ma, ma, .06, maMat));
  gen.ma = ma;

  // checkpoint: the first safe green candle at/after every 25th candle (finite charts only)
  if (!oneLife() && i > 0 && i % (level.tutorial ? 8 : level.sprint ? 12 : 25) === 0) gen.wantCheck = true;
  if (gen.wantCheck && green && !plat.live && !plat.pad && !k.ev) { gen.wantCheck = false; addCheckpoint(plat); }
  if (!level.tutorial && prev && prev.green && !prev.check && !prev.pad && !prev.spring && !prev.live && !prev.feature && !feature && Math.abs(climb) < 1.4) {
    const plan = hazardPlan(level.seed, prev.i);
    if (plan) {
      let clear = true;
      for (let back = 1; back <= 8; back++) { const approach = platforms.get(prev.i - back); if (approach?.pad || approach?.spring || back <= 4 && approach?.feature) clear = false; }
      if (clear) buildHazard(prev, plan);
    }
  }
  gen.prev = plat; gen.i++;
  if (gen.i === level.len) buildFinish();
  return true;
}
/* HAZARDS — premium laser gates and hover-mine fields. The footprint (centre ±1.475, 7 high for lasers, .55 for mines)
   is fixed by hazardHits in game-core, so the look can change but the hit box never does. All parts are shared
   geometry/materials; hazardFx lists the moving parts, animated on game time in updateHazards. */
const hazardRed = new THREE.MeshLambertMaterial({ color:0xff5268, emissive:0x7b1020 });
const HZ = (() => {
  const stripes = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 32; const x = c.getContext('2d'); x.fillStyle = '#16080c'; x.fillRect(0, 0, 128, 32); x.fillStyle = '#ff3b55'; for (let k = -2; k < 10; k++) { x.beginPath(); x.moveTo(k * 16, 32); x.lineTo(k * 16 + 8, 32); x.lineTo(k * 16 + 24, 0); x.lineTo(k * 16 + 16, 0); x.fill(); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); return t; })();
  const scan = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 128; const x = c.getContext('2d'); for (let y = 0; y < 128; y += 4) { x.fillStyle = `rgba(255,70,95,${y % 8 ? .05 : .16})`; x.fillRect(0, y, 4, 2); } const t = new THREE.CanvasTexture(c); t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 6); return t; })();
  const glow = o => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, ...o });
  return {
    metal: new THREE.MeshStandardMaterial({ color: 0x5d6678, metalness: .22, roughness: .38, emissive: 0x1c2029 }), // no env map to reflect: low metalness keeps the gunmetal readable
    trim: new THREE.MeshStandardMaterial({ color: 0xaab3c4, metalness: .3, roughness: .3 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xff2d4b, toneMapped: false }),
    core: glow({ color: 0xffd6de }), halo: glow({ color: 0xff2d4b, opacity: .38 }), field: glow({ map: scan, color: 0xff3b55, opacity: .5, side: THREE.DoubleSide }),
    floor: new THREE.MeshStandardMaterial({ map: stripes, roughness: .7, metalness: .2 }), ring: glow({ color: 0xff2d4b, opacity: .6, side: THREE.DoubleSide }),
    pylon: new THREE.CylinderGeometry(.13, .19, 7.2, 6), plinth: new THREE.CylinderGeometry(.34, .4, .3, 6), band: new THREE.TorusGeometry(.27, .035, 6, 18),
    cap: new THREE.CylinderGeometry(.24, .16, .26, 6), emitter: new THREE.SphereGeometry(.11, 12, 8), strip: new THREE.BoxGeometry(.035, 6.4, .05),
    beamCore: new THREE.CylinderGeometry(.018, .018, 2.7, 6), beamHalo: new THREE.CylinderGeometry(.075, .075, 2.7, 8, 1, true),
    mine: new THREE.IcosahedronGeometry(.25, 1), spike: new THREE.ConeGeometry(.045, .2, 5), mineBelt: new THREE.TorusGeometry(.26, .04, 6, 20), ringFlat: new THREE.RingGeometry(.32, .42, 28),
  };
})();
for (const g of Object.values(HZ)) if (g.isBufferGeometry) g.userData.shared = true; // reused by every gate: never disposed with a candle
const hazardFx = [];
function buildHazard(pl, plan) {
  pl.hazard = { ...plan, z:pl.zc };
  const group = new THREE.Group(), center = -plan.side * 1.025, base = (pl.top - pl.bot) / 2, fx = { group, kind: plan.kind, ph: pl.i * 1.7 };
  pl.group.add(group); group.position.y = base;
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(2.95, .85), HZ.floor); deck.rotation.x = -Math.PI / 2; deck.position.set(center, .032, 0); group.add(deck); // just above the candle's top lip
  if (plan.kind === 'laser') {
    for (const x of [center - 1.35, center + 1.35]) {
      const add = (geo, mat, y, o = {}) => { const m = new THREE.Mesh(geo, mat); m.position.set(x + (o.dx || 0), y, o.dz || 0); if (o.rx) m.rotation.x = o.rx; group.add(m); return m; };
      add(HZ.plinth, HZ.trim, .15); add(HZ.pylon, HZ.metal, 3.75); add(HZ.band, HZ.lamp, .34, { rx: Math.PI / 2 }); add(HZ.band, HZ.lamp, 7.1, { rx: Math.PI / 2 });
      add(HZ.cap, HZ.trim, 7.42); add(HZ.emitter, HZ.lamp, 7.62);
      add(HZ.strip, HZ.lamp, 3.7, { dx: x < center ? .15 : -.15 }); // inner light strip, facing the gap
    }
    const field = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 6.8), HZ.field); field.position.set(center, 3.6, 0); group.add(field);
    fx.beams = [];
    for (let y = .55; y < 7; y += 1.05) { const g = new THREE.Group(), c = new THREE.Mesh(HZ.beamCore, HZ.core), h = new THREE.Mesh(HZ.beamHalo, HZ.halo); g.add(c, h); g.rotation.z = Math.PI / 2; g.position.set(center, y, 0); group.add(g); fx.beams.push(h); }
    const scanner = new THREE.Group(); scanner.add(new THREE.Mesh(HZ.beamCore, HZ.core), new THREE.Mesh(HZ.beamHalo, HZ.halo)); scanner.rotation.z = Math.PI / 2; scanner.position.x = center; group.add(scanner); fx.scanner = scanner;
  } else {
    fx.mines = [];
    for (const x of [center - .85, center, center + .85]) {
      const m = new THREE.Group(), body = new THREE.Mesh(HZ.mine, HZ.metal), belt = new THREE.Mesh(HZ.mineBelt, HZ.lamp); belt.rotation.x = Math.PI / 2; m.add(body, belt);
      for (let k = 0; k < 10; k++) { const sp = new THREE.Mesh(HZ.spike, HZ.trim), d = new THREE.Vector3(Math.sin(k * 2.4) * Math.cos(k), Math.cos(k * 1.3), Math.sin(k) * Math.cos(k * 2.4)).normalize(); sp.position.copy(d).multiplyScalar(.27); sp.quaternion.setFromUnitVectors(UP, d); m.add(sp); }
      m.position.set(x, .34, 0); group.add(m);
      const ring = new THREE.Mesh(HZ.ringFlat, HZ.ring); ring.rotation.x = -Math.PI / 2; ring.position.set(x, .03, 0); group.add(ring);
      fx.mines.push({ m, ring, x });
    }
  }
  const arrow = textSprite(plan.side > 0 ? 'RIGHT →' : '← LEFT','#d9f66f',null,.45); arrow.position.set(plan.side * 1.55,.75,1.3); group.add(arrow);
  const lane = box(.8,.035,3.6,lipGreen); lane.position.set(plan.side * 1.55,.03,.4); group.add(lane);
  hazardFx.push(fx);
}
function updateHazards(t) { // beams shimmer, a scanner sweeps the gate, mines bob, spin and pulse; drops gates that left the course
  keepIf(hazardFx, f => f.group.parent?.parent);
  const pulse = .5 + .5 * Math.sin(t * 6);
  HZ.halo.opacity = .3 + .12 * Math.sin(t * 23) + .06 * Math.sin(t * 9); HZ.ring.opacity = .35 + .4 * pulse; HZ.field.opacity = .35 + .15 * pulse; HZ.field.map.offset.y = -t * .6;
  for (const f of hazardFx) {
    if (f.scanner) f.scanner.position.y = .5 + (Math.sin(t * 1.8 + f.ph) * .5 + .5) * 6.3;
    if (f.mines) f.mines.forEach((q, k) => { q.m.position.y = .34 + Math.sin(t * 2.6 + k * 2 + f.ph) * .06; q.m.rotation.y = t * 1.4 + k; q.m.rotation.x = Math.sin(t + k) * .3; q.ring.scale.setScalar(1 + .25 * ((t * 1.5 + k * .33) % 1)); });
  }
}
function upcomingHazard() {
  let found = null, distance = 22;
  for (const pl of platforms.values()) if (pl.hazard && !pl.broken) { const d = player.pos.z - pl.hazard.z; if (d > -.65 && d < distance) { found = pl; distance = d; } }
  return found;
}
// Spring: coil + plate near the front edge of candle `a`, aimed at candle `b`.
function addSpring(a, b) {
  const g = new THREE.Group(), z = a.col.min.z + 1.3;
  g.position.set(0, (a.top - a.bot) / 2, z - a.zc); a.group.add(g);
  g.add(box(1.5, .08, 1.5, padStartMat, edgeInk));
  const coil = new THREE.Group(); g.add(coil);
  for (let n = 0; n < 4; n++) { const r = new THREE.Mesh(new THREE.TorusGeometry(.42, .055, 6, 18), railMat); r.rotation.x = Math.PI / 2; r.position.y = .12 + n * .1; coil.add(r); }
  const plate = box(1.3, .1, 1.3, springMat, edgeInk); plate.position.y = .5; g.add(plate);
  a.spring = { z, target: b, coil, plate, anim: -1 };
}
// Checkpoint flag on the back edge of a candle: grey until you reach it, lime once it's yours.
const checkOff = new THREE.MeshLambertMaterial({ color: 0x5d6475 }), checkOn = new THREE.MeshBasicMaterial({ color: 0xdcf513 });
function addCheckpoint(pl) {
  const g = new THREE.Group(); g.position.set(-1.9, (pl.top - pl.bot) / 2, 0); pl.group.add(g);
  g.add(cyl(new V3(0, 0, 0), new V3(0, 2.2, 0), .04, railMat));
  const flag = new THREE.Mesh(new THREE.BoxGeometry(.04, .38, .62), checkOff); flag.position.set(0, 2, .32); g.add(flag);
  pl.check = { flag, n: ++gen.nCheck };
}
function buildFinish() {
  const zBack = gen.cursor - 3, depth = 20, top = gen.prev.top;
  put(box(10, 1.5, depth, padStartMat, wallEdge)).position.set(0, top - .75, zBack - depth / 2);
  colliders.push({ min: new V3(-5, top - 1.5, zBack - depth), max: new V3(5, top, zBack), type: 'plat', active: true, ci: gen.i });
  finishZ = zBack - 5;
  put(new THREE.Mesh(new THREE.TorusGeometry(5, .25, 8, 48), poleMat)).position.set(0, top + 3, finishZ);
}
function disposeObj(o) {
  o.parent?.remove(o);
  const geometries = new Set(), materials = new Set();
  o.traverse(n => { if (n.geometry && !n.geometry.userData.shared) geometries.add(n.geometry); if (n.isSprite || n.material?.userData?.perCandle) materials.add(n.material); });
  geometries.forEach(g => g.dispose());
  materials.forEach(m => { m.map?.dispose(); m.dispose(); });
}
// Throw away the whole course and build the start of `level` again (used on every (re)start).
function resetCourse() {
  for (const g of [course, volumeBars, dateAxis]) [...g.children].forEach(disposeObj);
  platforms.clear(); candles.clear(); bouncing.clear();
  for (const a of [colliders, rails, poles, orbs, liveCandles]) a.length = 0;
  rng = mulberry32(level.seed + TFS.indexOf(tfOf(level)) * 7919 - 7919); Object.assign(mk, { price: 100, drift: 0, vol: 1, regime: 0 });
  gen = { i: 0, cursor: 0, prev: null, nFeat: 0, ma: null, cut: 0, nCheck: 0, wantCheck: false }; finishZ = -Infinity;
  for (let n = 0; n < 70; n++) genCandle();
  // neutral start block right behind the first candle
  const t0 = platforms.get(0).top, gi = gen.i; gen.i = 0;
  put(box(PLAT_W, 1.5, 12, padStartMat, wallEdge)).position.set(0, t0 - .75, 6);
  colliders.push({ min: new V3(-PLAT_W / 2, t0 - 1.5, 0), max: new V3(PLAT_W / 2, t0, 12), type: 'plat', active: true, ci: 0 });
  gen.i = gi;
  spawn.set(0, t0, 8);
  setWatermark(level); applyTheme(level.theme);
  haunt.group.visible = !!level.haunt; skyline.visible = !level.haunt; hemi.intensity = 1.4; Sfx.setScene(level.haunt ? 'haunt' : 'main');
  syncHauntCrew();
}
// The Haunt crew (Bones, Jack) only runs the Halloween course, and the Halloween course only the Haunt crew; each side remembers its last pick.
function syncHauntCrew() {
  document.querySelectorAll('.viber').forEach(b => b.hidden = !!b.dataset.haunt !== !!level.haunt); // Halloween: only the Haunt crew
  if (!!VIBERS[viberIdx].haunt === !!level.haunt) return;
  const key = level.haunt ? 'cp-viber-haunt' : 'cp-viber-main', ok = VIBERS.map((v, i) => i).filter(i => !!VIBERS[i].haunt === !!level.haunt);
  let m = ok[0]; try { const s = Math.trunc(+localStorage.getItem(key)); if (ok.includes(s)) m = s; } catch (e) {} setViber(m);
}
const keepIf = (a, f) => { let j = 0; for (const x of a) if (f(x)) a[j++] = x; a.length = j; }; // in-place filter
// Keep ~60 candles built ahead of the runner; in endless, drop everything ~30 candles behind.
function streamCourse(cur) {
  for (let n = 0; n < 4 && gen.i < level.len && gen.i < cur + 60; n++) genCandle();
  const cut = oneLife() ? Math.floor(cur) - 30 : Math.min(Math.floor(cur) - 30, game.checkpoint?.i ?? 0);
  if (cut <= gen.cut) return;
  gen.cut = cut;
  for (const [i, pl] of platforms) if (i < cut) { bouncing.delete(pl); platforms.delete(i); }
  for (const i of candles.keys()) if (i < cut) candles.delete(i);
  if (game.tricks) for (const key of game.tricks.keys()) if (+key.split(':')[0] < cut) game.tricks.delete(key);
  for (const g of [course, volumeBars, dateAxis]) for (const o of [...g.children]) if (o.userData.ci < cut) disposeObj(o);
  const alive = x => x.ci >= cut;
  keepIf(colliders, alive); keepIf(liveCandles, pl => pl.i >= cut); keepIf(rails, alive); keepIf(poles, alive); keepIf(orbs, alive);
}

/* =====================================================================
   CHART BACKDROP — the course is drawn *inside* a trading chart:
   price grid + time grid on a back plane, a price axis and date axis
   that follow the runner, volume bars, MA(9) line, and a live
   last-price line with its blue label (TradingView-style).
   ===================================================================== */
const BACK_X = -12, START_TIME = Date.UTC(2026, 9, 1); // charts are 1H: one candle per hour
const gridMat = new THREE.LineBasicMaterial({ color: 0x232733 });
const volGreen = new THREE.MeshBasicMaterial({ color: 0x26a69a, transparent: true, opacity: .35, fog: false });
const volRed = new THREE.MeshBasicMaterial({ color: 0xef5350, transparent: true, opacity: .35, fog: false });

/* PALETTE — standard green/red, or a colour-blind-friendly blue/orange (≈8% of men can't tell red from green). */
const PAL = { upCss: '#26a69a', dnCss: '#ef5350' };
function applyPalette(cb) {
  const up = cb ? 0x3b82f6 : 0x26a69a, dn = cb ? 0xf59e0b : 0xef5350;
  PAL.upCss = '#' + up.toString(16).padStart(6, '0'); PAL.dnCss = '#' + dn.toString(16).padStart(6, '0');
  matGreen.color.setHex(up); matGreen.emissive.setHex(up); wickGreen.color.setHex(up); volGreen.color.setHex(up);
  matRed.color.setHex(dn); wickRed.color.setHex(dn); volRed.color.setHex(dn);
  lipGreen.color.setHex(up).lerp(new THREE.Color(0xffffff), .3); lipRed.color.setHex(dn).lerp(new THREE.Color(0xffffff), .3);
  for (const pl of platforms.values()) if (!pl.green) pl.mat.color.setHex(dn); // reds have their own material each
  document.documentElement.style.setProperty('--green', PAL.upCss); document.documentElement.style.setProperty('--red', PAL.dnCss);
}
const buzz = ms => { if (isTouch && settings.haptics && navigator.vibrate) navigator.vibrate(ms); }; // short haptic tap on phones

function textSprite(text, color = '#787b86', bg = null, h = .85) {
  const c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = '40px ui-monospace, monospace'; c.width = Math.ceil(x.measureText(text).width) + 20; c.height = 56;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, toneMapped: false, depthWrite: false }));
  s.scale.set(h * c.width / c.height, h, 1); s.userData = { c, x, tex, color, bg };
  setSpriteText(s, text);
  return s;
}
function setSpriteText(s, text) {
  const { c, x, tex, color, bg } = s.userData;
  x.clearRect(0, 0, c.width, c.height);
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); }
  x.font = '40px ui-monospace, monospace'; x.fillStyle = color; x.textBaseline = 'middle'; x.fillText(text, 10, c.height / 2 + 2);
  tex.needsUpdate = true;
}
// Price grid + price labels are a fixed window that slides with the camera and snaps to whole prices.
const priceAxis = new THREE.Group(), priceGrid = new THREE.Group(), dateAxis = new THREE.Group(), volumeBars = new THREE.Group();
const AXIS_N = 20;
{
  const pts = [];
  for (let j = -AXIS_N; j <= AXIS_N; j++) pts.push(BACK_X, j, 80, BACK_X, j, -80);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  priceGrid.add(new THREE.LineSegments(g, gridMat), new THREE.LineSegments(g, gridMat).translateX(-2 * BACK_X)); // a chart wall on each side of the course
  for (let j = -AXIS_N; j <= AXIS_N; j++) { const s = textSprite('000.00'); s.position.set(BACK_X, j, 0); priceAxis.add(s); }
  scene.add(priceGrid, priceAxis, volumeBars, dateAxis);
}
let axisBase = NaN;
const lastPriceLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(0, 0, 60), new V3(0, 0, -60)]), new THREE.LineDashedMaterial({ color: 0x2962ff, dashSize: .5, gapSize: .4, fog: false }));
lastPriceLine.computeLineDistances(); scene.add(lastPriceLine);
const lastPriceLabel = textSprite('000.00', '#ffffff', '#2962ff'); scene.add(lastPriceLabel);
let lastPriceText = '', lastPriceAt = 0;
// TradingView-style watermark on the chart wall: "<SYM> · simulated chart"
const watermark = (() => {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(24, 6), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: .03, depthWrite: false, fog: false }));
  m.rotation.y = Math.PI / 2; scene.add(m); return m;
})();
function setWatermark(lv) {
  const t = watermark.material.map, x = t.image.getContext('2d');
  x.clearRect(0, 0, 1024, 256); x.fillStyle = '#ffffff'; x.textBaseline = 'middle';
  x.font = '700 150px "Space Grotesk", sans-serif'; x.fillText(`${lv.sym}`, 20, 110);
  x.font = '500 54px "JetBrains Mono", monospace'; x.fillText(`${tfOf(lv).id} · simulated · ${lv.arena ? lv.name + ' · community arena' : lv.name}`, 26, 215); t.needsUpdate = true;
}
document.fonts?.ready.then(() => setWatermark(level)); // redraw once web fonts load
// Slow-drifting dust motes around the camera for depth and atmosphere
const DUST_N = 300, dustPos = new Float32Array(DUST_N * 3);
for (let i = 0; i < DUST_N; i++) dustPos.set([(Math.random() - .5) * 30, (Math.random() - .5) * 20, (Math.random() - .5) * 50], i * 3);
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
let dustVy = .25;
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x8a93a8, size: .07, transparent: true, opacity: .5, depthWrite: false }));
dust.frustumCulled = false; scene.add(dust);
function updateChartBackdrop(dt) {
  const p = player, price = (p.pos.y + 100).toFixed(2);
  const chase = camMode === 'chase', R_X = -BACK_X; // behind view: price axis, price line, volume and time live on the right wall
  watermark.position.set(BACK_X + .05, camera.position.y + 1, camera.position.z - (chase ? 26 : 0));
  dust.position.set(p.pos.x, camera.position.y, camera.position.z);
  for (let i = 0; i < DUST_N; i++) { // drift up slowly, wrap inside the box
    dustPos[i * 3 + 1] += dt * dustVy * (.7 + (i % 5) * .15);
    if (dustPos[i * 3 + 1] > 10) dustPos[i * 3 + 1] -= 20; else if (dustPos[i * 3 + 1] < -10) dustPos[i * 3 + 1] += 20;
    dustPos[i * 3] += Math.sin(i + dustPos[i * 3 + 1]) * dt * .05;
  }
  dustGeo.attributes.position.needsUpdate = true;
  sun.position.set(p.pos.x + 6, p.pos.y + 16, p.pos.z + 4); sun.target.position.copy(p.pos);
  rim.position.set(p.pos.x - 10, p.pos.y + 6, p.pos.z - 3); rim.target.position.copy(p.pos);
  lens.uniforms.uTime.value = performance.now() / 1000;
  lens.uniforms.uDesat.value = damp(lens.uniforms.uDesat.value, game.state === 'dead' ? .85 : 0, 6, dt);
  // far skyline of giant faint candles: wraps around the camera, drifts at half speed in height (parallax)
  skyline.position.y = camera.position.y * .5;
  for (const m of skyline.children) { if (m.position.z - camera.position.z > 260) m.position.z -= 520; else if (m.position.z - camera.position.z < -260) m.position.z += 520; }
  const base = Math.round(camera.position.y);
  priceGrid.position.set(0, base, camera.position.z);
  if (base !== axisBase) { // recycle only labels that left the window — re-uploading all 41 textures caused frame spikes
    const used = new Set(), free = [];
    for (const s of priceAxis.children) { const lv = s.userData.lv; if (lv !== undefined && Math.abs(lv - base) <= AXIS_N && !used.has(lv)) used.add(lv); else free.push(s); }
    // after a respawn the camera jumps ~80 levels: relabel at most 5 per frame, nearest first, and finish on later frames
    let n = 0;
    for (let d = 0; d <= AXIS_N && free.length && n < 5; d++) for (const lv of d ? [base - d, base + d] : [base]) if (!used.has(lv) && free.length && n < 5) { const s = free.pop(); s.userData.lv = lv; s.position.y = lv; setSpriteText(s, (lv + 100).toFixed(2)); used.add(lv); n++; }
    if (used.size >= 2 * AXIS_N + 1) axisBase = base;
  }
  const bottom = chase ? p.pos.y - 5.5 : camera.position.y - (camera.position.x - BACK_X) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) + 1.2; // bottom of view
  dateAxis.position.set(chase ? 2 * R_X : 0, bottom, 0); volumeBars.position.set(chase ? 2 * R_X - .2 : 0, bottom + .2, 0);
  lastPriceLine.position.set(chase ? R_X - .2 : BACK_X + .2, p.pos.y, p.pos.z);
  lastPriceLabel.position.set(chase ? R_X - .3 : BACK_X + .3, p.pos.y, priceAxis.position.z);
  if (price !== lastPriceText && performance.now() - lastPriceAt > 120) { // redraw (texture upload) at most ~8×/s
    lastPriceText = price; lastPriceAt = performance.now(); setSpriteText(lastPriceLabel, price.padStart(6, ' '));
  }
}

/* Debris pool for shattering red candles */
const debrisMat = new THREE.MeshBasicMaterial({ color: 0xef5350 });
const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
const debris = Array.from({ length: 60 }, () => { const m = new THREE.Mesh(debrisGeo, debrisMat); m.visible = false; scene.add(m); return { m, vel: new V3(), spin: new V3(), life: 0 }; });
let debrisHead = 0;

function shatter(pl) {
  pl.broken = true; pl.group.visible = false; pl.col.active = false; if (pl.pole) pl.pole.active = false;
  const p = player;
  for (let k = 0; k < 16; k++) {
    const d = debris[debrisHead]; debrisHead = (debrisHead + 1) % debris.length;
    d.m.visible = true; d.life = 1.6;
    d.m.position.set(pl.x + (Math.random() - .5) * PLAT_W, lerp(pl.bot, pl.top, Math.random()), pl.zc + (Math.random() - .5) * pl.depth);
    d.m.scale.setScalar(.3 + Math.random() * .6);
    d.vel.set((Math.random() - .5) * 8, Math.random() * 6, (Math.random() - .5) * 8);
    d.spin.set(Math.random() * 8, Math.random() * 8, Math.random() * 8);
  }
  for (let k = 0; k < 90; k++) emit(pl.x + (Math.random() - .5) * PLAT_W, pl.top, pl.zc + (Math.random() - .5) * pl.depth, (Math.random() - .5) * 10, Math.random() * 8, (Math.random() - .5) * 10, 0xef5350, 1.2, 14);
  const near = p.pos.distanceTo(_v.set(pl.x, pl.top, pl.zc));
  if (near < 18) { shake(.55 * (1 - near / 18) + .1); hitStop = .04; }
  Sfx.shatter();
}

/* =====================================================================
   6. PLAYER MODEL — Skyline couriers, four voxel silhouettes
   (a procedural Group with named animation pivots and shared courier gear).
   Anatomy: big wide HEAD on a smaller BODY, stubby ARMS on the body,
   chunky FEET underneath, a TOP piece and a face. Front is +z.
   Pivots: root › flip (spin) › rig › hips › { body, head › top, armL/R, legL/R }.
   ===================================================================== */
const VIBERS = [
  { name: 'Scout', bio: 'SCOUT / the rooftop courier. Find the line. Keep your momentum.', accent: 0xd9f66f, head: 0x553627, body: 0x4a3125, arm: 0x553627, cuff: 0xd5e2e8, feet: 0x29343e, sole: 0xd9f66f, top: 'hood', band: 0xd9d3c3, belt: 0x8e9aa8, face: 'mask', eye: 0xabf0a2, item: 'scanner', bg: '#d9e4ee' },
  { name: 'Flux', bio: 'FLUX / the night-shift skater. Every rail is a shortcut.', accent: 0x81e9db, head: 0x2a4f3f, body: 0x24473a, arm: 0x2a4f3f, cuff: 0xd5e2e8, feet: 0x282c31, sole: 0x81e9db, top: 'cap', cap: 0x356243, face: 'goggles', frame: 0x7de8d8, eye: 0xe9e4d4, tie: 0x15161a, bg: '#d9e4ee' },
  { name: 'Relay', bio: 'RELAY / the signal runner. Quiet focus. Clean connections.', accent: 0xffc65e, head: 0xd5e2e8, body: 0x192c45, panel: 0xd5e2e8, arm: 0x253e59, cuff: 0xd5e2e8, cuffH: .14, feet: 0x162438, sole: 0xffc65e, top: 'comms', face: 'signal', eye: 0x9eeaff, bg: '#d9e4ee' },
  { name: 'Ember', bio: 'EMBER / the rooftop artist. Leave a bright line behind.', accent: 0xff859c, head: 0xa8513e, body: 0x202a36, arm: 0xa8513e, cuff: 0xd5e2e8, cuffBand: 0x15161a, feet: 0x162438, sole: 0xff859c, top: 'mohawk', hair: 0x573a3b, face: 'big', eye: 0xdedacd, item: 'canister', bg: '#d9e4ee' },
  // Haunt the Chain crew
  { name: 'Bones', haunt: true, bio: 'BONES / HAUNT CREW. The liquidation fog never caught him. Twice.', accent: 0x9dff6a, head: 0xece6d2, body: 0x17191f, arm: 0x17191f, cuff: 0xe2dbc4, feet: 0x17191f, sole: 0x9dff6a, face: 'skull', eye: 0x9dff6a, bg: '#2a2438' },
  { name: 'Jack', haunt: true, bio: 'JACK / HAUNT CREW. Carved on a red candle, lit by a green one.', accent: 0xffa62e, head: 0xf2801f, body: 0x2f6b3a, arm: 0x2f6b3a, cuff: 0xf2801f, feet: 0x1f2a22, sole: 0xffa62e, top: 'stem', stem: 0x6b5a2a, leaf: 0x86c442, face: 'jack', eye: 0xffd84a, bg: '#2a2438' },
];
const INK = 0x15161a, OUTLINE = new THREE.LineBasicMaterial({ color: INK });
// Toon shading (3 crisp light bands) + an inverted-hull ink outline: the thick, even black silhouette of the art.
const toonRamp = (() => { const t = new THREE.DataTexture(new Uint8Array([105, 185, 255]), 3, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
const lamCache = {}, lam = c => lamCache[c] ||= new THREE.MeshToonMaterial({ color: c, gradientMap: toonRamp });
const HULL = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
function blk(parent, w, h, d, color, x, y, z, ink = true) { // one outlined block (ink=false: small face details, a thick rim would swallow them)
  const g = new THREE.BoxGeometry(w, h, d), m = new THREE.Mesh(g, lam(color));
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), OUTLINE));
  if (ink) { const hull = new THREE.Mesh(g, HULL); hull.scale.set(1 + .03 / w, 1 + .03 / h, 1 + .03 / d); m.add(hull); } // ink rim, thinner than the 4 cm wraps (bands, caps) so it never pokes through them
  m.position.set(x, y, z); parent.add(m); return m;
}
const tint = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();           // k<1 darker, k>1 lighter
function buildRunner(v, addToScene = true) {
  // flip pivot sits at the body's centre so flips spin around the middle, not the feet
  const root = new THREE.Group(), flip = new THREE.Group(), rig = new THREE.Group();
  root.add(flip); flip.position.y = .8; flip.add(rig); rig.position.y = -.8;
  const HIP = .2, BW = .72, BH = .42, BD = .6, HW = 1, HH = .96, HD = .86, FZ = HD / 2, eyes = [];
  const hips = new THREE.Group(); hips.position.y = HIP; rig.add(hips);
  // body (narrower than the head, like the art) and the big head on top of it
  blk(hips, BW, BH, BD, v.body, 0, BH / 2, 0);
  const head = new THREE.Group(); head.position.y = BH; hips.add(head);
  if (v.face === 'jack') { // a round pumpkin from five lobes: tallest and deepest in the middle, the ink seams between them are the ribs
    [[-.4, .2, .74, .72], [-.2, .2, .9, .84], [0, .2, .96, HD], [.2, .2, .9, .84], [.4, .2, .74, .72]].forEach(([x, w, h, d], k) => blk(head, w, h, d, k % 2 ? tint(v.head, .92) : v.head, x, .04 + h / 2 + (.96 - h) / 2 * .4, 0));
  } else if (v.face === 'skull') { // cranium, cheek band and a narrower jaw: reads as a skull, not a box
    blk(head, HW, .66, HD, v.head, 0, .63, 0);
    blk(head, HW - .08, .14, HD - .06, tint(v.head, .93), 0, .23, .02);
    blk(head, .74, .22, .7, tint(v.head, .9), 0, .09, .05);
  } else blk(head, HW, HH, HD, v.head, 0, HH / 2, 0);
  if (v.face !== 'mask' && !v.haunt) blk(head, HW + .004, .066, HD + .004, tint(v.head, 1.15), 0, HH - .028, 0);       // lighter top rim; sits a hair proud so it never z-fights the head
  const eye = (...a) => { const m = blk(head, ...a, false); eyes.push(m); return m; };
  let capeRef = null;
  const glows = [], glow = m => { const c = m.material.color.getHex(); m.material = new THREE.MeshBasicMaterial({ color: c }); m.userData.c = c; glows.push(m); return m; }; // unlit (reads in the dark), own material so it can flicker
  const pupils = [], pupil = (...a) => { const m = eye(...a); m.userData.base = m.position.clone(); pupils.push(m); return m; }; // eyes that look where the head looks

  if (v.face === 'mask') { // Scout: cream headband, two black eye blocks with green pupils, grey band + mouth plate
    blk(head, .8, .09, .06, v.band, 0, .76, FZ + .08, false);
    for (const s of [-1, 1]) { blk(head, .48, .36, .08, INK, s * .25, .46, FZ + .04); pupil(.13, .13, .04, v.eye, s * .25 - .06, .49, FZ + .1); } // one wide mask, eyes glancing left
    blk(head, HW + .04, .12, HD + .04, v.belt, 0, .06, 0);
    for (const s of [-1, 1]) blk(hips, .2, .1, .04, v.belt, s * .105, BH - .08, BD / 2 + .02); // grey teeth plate under the band
  }
  if (v.face === 'goggles') { // Flux: big mint goggle frames with cream lenses, little cream dots above
    for (const s of [-1, 1]) {
      blk(head, .42, .4, .1, v.frame, s * .24, .38, FZ + .05); blk(head, .29, .27, .045, INK, s * .24, .38, FZ + .11, false); pupil(.14, .11, .025, v.eye, s * .24, .4, FZ + .145);
      blk(head, .1, .1, .09, v.eye, s * .33, .68, FZ - .02);
    }
    blk(hips, .26, .07, .04, v.tie, 0, BH - .06, BD / 2 + .02); blk(hips, .08, .26, .04, v.tie, 0, BH - .22, BD / 2 + .02); // black tie / zip
    for (const s of [-1, 1]) blk(hips, .08, .08, .05, v.tie, s * .065, BH - .37, BD / 2 + .025);       // the two little cubes at its tip
  }
  if (v.face === 'signal') {
    // A single dark visor, focused cyan eyes and an asymmetric signal earpiece.
    blk(head, HW + .015, .06, HD + .015, v.body, 0, .75, 0, false);
    blk(head, .9, .39, .09, v.body, 0, .47, FZ + .045);
    blk(head, .78, .26, .035, INK, 0, .47, FZ + .105, false);
    for (const side of [-1, 1]) eye(.2, .065, .025, v.eye, side * .23, .48, FZ + .135);
    blk(head, .25, .08, .055, v.body, 0, .14, FZ + .04, false);
    for (let n = 0; n < 3; n++) blk(head, .035, .035, .025, v.accent, .22 + n * .065, .2, FZ + .06, false);
    for (const side of [-1,1]) blk(head, .12, .3, .34, v.body, side * .55, .46, -.02);
    blk(head, .035, .17, .19, v.accent, -.625, .46, -.02, false);
    blk(head, .62, .26, .045, v.body, 0, .38, -FZ - .025);
    for (let n = 0; n < 3; n++) { const h = .045 + n * .05; blk(head, .07, h, .025, v.eye, -.17 + n * .17, .31 + h / 2, -FZ - .06, false); }
    blk(hips, .3, .21, .055, v.panel, 0, .23, BD / 2 + .025);
    blk(hips, .14, .04, .025, v.body, 0, .25, BD / 2 + .065, false);
    for (const side of [-1,1]) blk(hips, .07, .21, .055, v.accent, side * .14, .24, -.54);
  }
  if (v.face === 'big') { // Ember: big cream eyes glancing down-left, black nose, salmon lip + one white tooth, black shirt with a salmon print
    for (const s of [-1, 1]) { eye(.28, .27, .08, v.eye, s * .25, .5, FZ + .05); pupil(.1, .12, .035, INK, s * .25 - .035, .48, FZ + .11); }
    blk(head, .14, .14, .12, INK, 0, .23, FZ + .06);
    blk(head, .13, .1, .1, v.hair, 0, .09, FZ + .05);
    blk(head, .08, .08, .06, v.eye, 0, -.02, FZ + .04, false);
    blk(hips, .24, .13, .04, v.accent, 0, BH - .14, BD / 2 + .02);                    // shirt print
  }

  if (v.face === 'skull') { // Bones: a skull that glows from within, in a black bomber with toxic-green trim
    const shade = tint(v.head, .84), deep = tint(v.head, .62), JZ = .4; // JZ: jaw front
    blk(head, .92, .07, .06, shade, 0, .74, FZ + .015, false);                                          // brow ridge
    for (const sd of [-1, 1]) {
      blk(head, .32, .28, .06, INK, sd * .22, .55, FZ + .02);                                            // socket
      glow(blk(head, .16, .14, .02, 0x2f8a1e, sd * .22, .55, FZ + .055, false));                        // inner glow
      pupil(.09, .09, .03, v.eye, sd * .22, .56, FZ + .07); glow(eyes[eyes.length - 1]);
      blk(head, .16, .06, .04, shade, sd * .32, .33, FZ + .01, false);                                  // cheekbone
    }
    blk(head, .1, .1, .05, INK, 0, .37, FZ + .015, false);                                               // nose
    blk(head, .56, .1, .04, INK, 0, .16, JZ + .03, false);                                               // mouth slot
    for (let n = -2; n <= 2; n++) { blk(head, .08, .06, .03, v.head, n * .105, .19, JZ + .055, false); blk(head, .08, .05, .03, shade, n * .105, .12, JZ + .055, false); }
    blk(head, .02, .2, .02, deep, .3, .82, FZ + .012, false); blk(head, .08, .02, .02, deep, .26, .72, FZ + .012, false); // crack
    // jacket: open front shows the ribcage, glowing green zip edges and collar
    blk(hips, .36, BH - .08, .03, v.head, 0, BH / 2 + .02, BD / 2 + .01, false);
    for (let n = 0; n < 3; n++) for (const sd of [-1, 1]) blk(hips, .13, .025, .02, INK, sd * .085, BH - .1 - n * .08, BD / 2 + .03, false);
    blk(hips, .04, .26, .02, tint(v.head, 1.05), 0, BH - .18, BD / 2 + .035, false);                     // sternum
    for (const sd of [-1, 1]) glow(blk(hips, .025, BH - .06, .02, v.accent, sd * .2, BH / 2 + .02, BD / 2 + .02, false));
    for (const sd of [-1, 1]) { const c = blk(hips, .22, .1, .14, v.body, sd * .24, BH + .02, BD / 2 - .06); c.rotation.z = sd * -.3; }   // popped collar
    glow(blk(hips, BW + .02, .035, BD + .02, v.accent, 0, .045, 0, false));                              // hem piping
  }
  if (v.face === 'jack') { // Jack: carved, candle-lit, in a vine-green coat and a tattered cape
    const dark = 0x4a1c05, F = FZ + .002;
    for (const sd of [-1, 1]) {
      blk(head, .36, .28, .025, dark, sd * .21, .56, F + .01, false);                                    // scorched eye cut
      glow(blk(head, .3, .07, .05, v.eye, sd * .21, .49, F + .03, false)); glow(blk(head, .2, .07, .05, v.eye, sd * .21, .56, F + .03, false)); glow(blk(head, .09, .07, .05, 0xfff2b0, sd * .21, .63, F + .03, false));
    }
    blk(head, .14, .1, .025, dark, 0, .39, F + .01, false); glow(blk(head, .1, .07, .05, v.eye, 0, .39, F + .03, false)); // nose
    blk(head, .62, .22, .025, dark, 0, .21, F + .01, false); glow(blk(head, .54, .13, .05, v.eye, 0, .21, F + .03, false)); // grin
    for (const x of [-.18, 0, .18]) blk(head, .07, .06, .055, v.head, x, .25, F + .04, false);
    for (const x of [-.09, .09]) blk(head, .07, .05, .055, v.head, x, .17, F + .04, false);
    for (const sd of [-1, 1]) { const c = blk(hips, .26, .05, .16, v.leaf, sd * .15, BH - .01, BD / 2 - .02, false); c.rotation.z = sd * .25; } // leaf collar
    blk(hips, .03, BH - .1, .02, v.accent, 0, BH / 2, BD / 2 + .012, false);
    for (const y of [.26, .14]) blk(hips, .06, .06, .03, 0xf3d9a0, .07, y, BD / 2 + .02, false);
  }
  // Reflective courier harness and compact pack give the crew a shared district identity.
  if (!v.haunt) blk(hips, .5, .34, .22, tint(v.body, .7), 0, BH / 2, -.4); // the Haunt crew carries its own back piece (below)
  if (v.face !== 'skull') for (const side of [-1, 1]) { blk(hips, .075, .3, .035, v.accent, side * .22, BH / 2, BD / 2 + .04); blk(head, .16, .07, .035, v.accent, side * .32, .1, FZ + .06); } // Bones shows his ribcage instead
  // Shared pack clasp and reflective boot trim tie the crew together from behind.
  if (!v.haunt) { blk(hips, .24, .055, .035, v.accent, 0, BH / 2 + .08, -.53, false); for (const side of [-1,1]) blk(hips, .055, .055, .035, 0xd5e2e8, side * .15, BH / 2 - .06, -.53, false); }
  // BACKS of the Haunt crew: the camera rides behind the runner, so this is what players see most
  const BZ = -FZ - .02; // just behind the back of the head
  if (v.face === 'skull') {
    // jacket back: a glowing spine and ribs, like an x-ray
    const bz = -BD / 2 - .012;
    glow(blk(hips, .05, BH - .06, .02, v.accent, 0, BH / 2 + .02, bz, false));
    for (let n = 0; n < 3; n++) for (const sd of [-1, 1]) { const r = glow(blk(hips, .22, .03, .02, v.accent, sd * .13, BH - .1 - n * .09, bz, false)); r.rotation.z = sd * -.18; }
    glow(blk(hips, .16, .05, .02, v.accent, 0, .1, bz, false));                                          // pelvis
    // back of the skull: a glowing fracture
    [[-.24, .78, .18, .035], [-.14, .69, .035, .18], [-.04, .61, .18, .035], [.06, .53, .035, .16], [.15, .46, .18, .035]].forEach(([x, y, w, h]) => { blk(head, w + .035, h + .035, .015, INK, x, y, BZ + .006, false); glow(blk(head, w, h, .02, v.eye, x, y, BZ, false)); });
  }
  if (v.face === 'jack') {
    // a carved bat through the back of the pumpkin, lit from inside
    blk(head, .6, .3, .02, 0x4a1c05, 0, .58, BZ + .008, false);
    glow(blk(head, .12, .16, .03, v.eye, 0, .58, BZ, false));
    for (const sd of [-1, 1]) { glow(blk(head, .04, .05, .03, v.eye, sd * .04, .68, BZ, false)); glow(blk(head, .14, .07, .03, v.eye, sd * .13, .62, BZ, false)); glow(blk(head, .1, .06, .03, v.eye, sd * .24, .57, BZ, false)); glow(blk(head, .05, .05, .03, v.eye, sd * .28, .52, BZ, false)); }
    // tattered cape on its own pivot at the shoulders, so it can stream behind on the run
    const cape = new THREE.Group(); cape.position.set(0, BH - .02, -BD / 2 - .03); hips.add(cape); capeRef = cape;
    const outer = 0x183d28, lining = v.accent;
    blk(cape, .84, .5, .035, outer, 0, -.25, -.02); blk(cape, .8, .46, .02, lining, 0, -.24, .015, false);   // outer + orange lining
    [[-.33, .12], [-.17, .2], [0, .1], [.17, .22], [.33, .13]].forEach(([x, h]) => blk(cape, .15, h, .035, outer, x, -.5 - h / 2, -.02)); // ragged hem
    for (const sd of [-1, 1]) blk(cape, .08, .08, .05, v.leaf, sd * .36, -.02, 0, false);               // leaf clasps
    for (const sd of [-1, 1]) blk(cape, .06, .52, .03, lining, sd * .4, -.26, -.05, false);           // orange piping down the edges
    blk(cape, .86, .05, .03, lining, 0, -.02, -.05, false);
    for (const [x, y] of [[-.22, -.2], [.18, -.32], [-.05, -.4], [.3, -.14], [-.32, -.36]]) glow(blk(cape, .05, .05, .02, 0xffd84a, x, y, -.05, false)); // ember sparks in the cloth
    // little lantern on the hip
    const iron = 0x24402a; blk(hips, .16, .03, .16, iron, -.5, .34, .02); blk(hips, .16, .03, .16, iron, -.5, .12, .02);
    glow(blk(hips, .11, .17, .11, 0xff9a2e, -.5, .23, .02)); blk(hips, .03, .09, .03, iron, -.5, .41, .02, false);
  }
  // TOP piece on its own pivot so it can jiggle
  const top = new THREE.Group(); top.position.y = HH; head.add(top); // rides on the head, so it follows nods and looks
  if (v.top === 'hood') { blk(top, 1.1, .16, .96, v.body, 0, .02, -.03); for (const side of [-1, 1]) blk(head, .13, .65, .28, v.body, side * .54, .5, .25); blk(top, .36, .045, .14, v.accent, 0, .12, .35); }
  if (v.top === 'cap') { blk(top, HW + .06, .22, HD + .06, v.cap, 0, -.05, 0); blk(top, .55, .1, .5, v.cap, 0, .11, -.04); blk(top, .4, .06, .36, v.cap, HW / 2 + .12, .0, .08); } // cap band wraps the head top, like the art
  if (v.top === 'comms') {
    blk(top, 1.06, .1, .94, v.head, 0, -.02, -.025);
    const brow = blk(top, .94, .085, .2, v.body, 0, -.15, .44); brow.rotation.x = -.15;
    blk(top, .075, .25, .075, v.body, -.46, .13, -.27);
    blk(top, .13, .055, .13, v.accent, -.46, .285, -.27);
    blk(top, .32, .035, .2, v.accent, .12, .055, -.18, false);
  }
  if (v.top === 'stem') { // twisted stem, a leaf and a curl of vine
    const st = blk(top, .14, .16, .14, v.stem, 0, .08, 0); st.rotation.y = .4; const tip = blk(top, .11, .1, .11, tint(v.stem, .8), .03, .2, .02); tip.rotation.z = -.35;
    const lf = blk(top, .26, .035, .16, v.leaf, .19, .1, .06); lf.rotation.z = -.35; blk(top, .1, .02, .02, tint(v.leaf, .75), .19, .125, .06, false).rotation.z = -.35;
    [[-.12, .05], [-.18, .1], [-.16, .16], [-.1, .17]].forEach(([x, y]) => blk(top, .045, .045, .045, v.leaf, x, y, -.06, false));
  }
  if (v.top === 'mohawk') [[.2, .24], [.06, .38], [-.08, .46], [-.22, .32]].forEach(([z, h]) => blk(top, .11, h, .11, v.hair, 0, h / 2, z)); // chunky strips, tallest toward the back

  // ARMS hang from the body's sides; FEET are chunky blocks under it
  const limb = (x, y, parts) => { const p = new THREE.Group(); p.position.set(x, y, 0); parts(p); hips.add(p); return p; };
  const arm = s => limb(s * (BW / 2 + .11), BH - .04, p => {
    const ch = v.cuffH || .12;
    blk(p, .2, .38 - ch, .28, v.arm, 0, -(.38 - ch) / 2, 0); blk(p, .22, ch, .3, v.cuff, 0, -.37 + ch / 2, 0);
    if (v.face === 'signal' && s < 0) blk(p, .14, .08, .035, v.eye, 0, -.29, .17, false);
    if (v.cuffBand) blk(p, .22, .05, .3, v.cuffBand, 0, -.37 + ch + .02, 0);           // Ember: red › black band › cream
    if (s > 0 && v.item === 'scanner') { blk(p, .19, .25, .13, 0x192c45, .06, -.3, .08); blk(p, .12, .13, .025, v.accent, .06, -.29, .16, false); }
  });
  const leg = s => limb(s * .19, 0, p => {
    if (v.ankle) blk(p, .12, .1, .12, v.ankle, 0, -.05, 0);
    blk(p, .32, v.ankle ? .1 : .2, .44, v.feet, 0, v.ankle ? -.15 : -.1, .05);
    if (v.sole) blk(p, .34, .09, .46, v.sole, 0, -.165, .05);                         // Flux's thick mint soles
  });
  if (v.item === 'canister') { blk(hips, .25, .4, .25, v.accent, -.43, .32, -.35); blk(hips, .13, .08, .15, INK, -.43, .56, -.35); blk(hips, .07, .05, .08, 0xd5e2e8, -.43, .62, -.31, false); }

  const R = { root, flip, flipT: -1, flipDur: 1, flipAxis: 'x', flipDir: 1, rig, hips, head, top, j: 0, jv: 0, jr: 0, jrv: 0, pvy: 0, phz: 0, lastStep: 0, hipBase: HIP,
    legL: leg(1), legR: leg(-1), armL: arm(1), armR: arm(-1), phase: 0, eyes, pupils, glows, cape: capeRef, blinkSeed: Math.random() * 3 };
  if (v.face === 'jack') { const l = new THREE.PointLight(0xffa040, 1.4, 3.2, 2); l.position.set(0, HH * .45, FZ + .5); head.add(l); R.candle = l; } // the candle spills warm light on the course
  root.scale.setScalar(1.06);
  root.traverse(o => { if (o.isMesh) o.castShadow = o.material !== HULL; }); // outlines don't need their own shadow
  if (addToScene) scene.add(root);
  return R;
}
let viberIdx = 0;
try { viberIdx = clamp(Math.trunc(+localStorage.getItem('cp-viber') || 0), 0, VIBERS.length - 1); } catch (e) {}
let runner = buildRunner(VIBERS[viberIdx]);
buildPicker();


function setViber(i) {
  viberIdx = i; disposeObj(runner.root); runner = buildRunner(VIBERS[i]);
  try { localStorage.setItem('cp-viber', i); localStorage.setItem(VIBERS[i].haunt ? 'cp-viber-haunt' : 'cp-viber-main', i); } catch (e) {}
  document.querySelectorAll('.viber').forEach((b, j) => b.classList.toggle('on', j === i));
  if ($('runnerNote')) $('runnerNote').textContent = VIBERS[i].bio;
}
/* Character-select thumbnails: render each viber once (3/4 front view) into an <img>. */
function buildPicker() {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); r.setSize(160, 160);
  const cam = new THREE.PerspectiveCamera(28, 1, .1, 20); cam.position.set(2.7, 2.3, 4.6); cam.lookAt(0, 1.05, 0);
  const pick = $('pick');
  VIBERS.forEach((v, i) => {
    const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2)); const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(3, 5, 4); sc.add(dl);
    const model = buildRunner(v, false).root; sc.add(model); r.render(sc, cam);
    const b = document.createElement('button'); b.className = 'viber' + (i === viberIdx ? ' on' : ''); b.style.background = v.bg;
    b.innerHTML = `<img src="${r.domElement.toDataURL()}" alt=""><span>${v.name}</span>`;
    if (v.haunt) b.dataset.haunt = '1';
    b.addEventListener('click', e => { e.stopPropagation(); if (profile.xp >= VIBER_XP[i] && !!v.haunt === !!level.haunt) setViber(i); });
    pick.append(b); disposeObj(model);
  });
  r.dispose();
  syncHauntCrew();
}

/* Ribbon trail: camera-facing strip through the last N positions */
const TRAIL_N = 34;
const trailPts = Array.from({ length: TRAIL_N }, () => new V3());
const trailGeo = new THREE.BufferGeometry();
const trailPos = new Float32Array(TRAIL_N * 6), trailCol = new Float32Array(TRAIL_N * 6);
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
{ const idx = []; for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } trailGeo.setIndex(idx); }
const trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
trail.frustumCulled = false; scene.add(trail);

/* =====================================================================
   INPUT — keyboard, mouse look (pointer lock), touch joystick/buttons.
   Jump/slide are buffered so early presses still count.
   ===================================================================== */
const COYOTE = .16, BUFFER = .18;
const input = { keys: new Set(), jumpHeld: false, grabHeld: false, ix: 0, iz: 0, stickX: 0, stickY: 0 };
let jumpBuf = 0, slideBuf = 0, yaw = 0, pitch = .1;
let camMode = 'chase'; // gameplay is always seen from behind the runner; other angles are used only for cinematic moments

function press(act) {
  Sfx.init();
  if (act === 'jump') { if (!input.jumpHeld) input.pJump = true; input.jumpHeld = true; } // applied at the next physics step (see simStep)
  if (act === 'slide') input.pSlide = true;
  if (act === 'grab') input.grabHeld = true;
  if (act === 'brake') input.brakeHeld = true;
}
function release(act) {
  if (act === 'jump') input.jumpHeld = false;
  if (act === 'grab') input.grabHeld = false;
  if (act === 'brake') input.brakeHeld = false;
}
const keyAct = { Space: 'jump', ShiftLeft: 'slide', ShiftRight: 'slide', KeyC: 'slide', KeyE: 'grab' };
addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('#terms:not(.hidden), #arenaMaker:not(.hidden), #settings:not(.hidden)')) return;
  if ((game.state === 'play' || game.state === 'count') && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  input.keys.add(e.code);
  if (e.repeat) return;
  if (keyAct[e.code] && (game.state === 'play' || game.state === 'count')) press(keyAct[e.code]);
  if (e.code === 'Enter' && !$('landing').classList.contains('hidden')) { enterGame(); return; }
  if (e.code === 'Enter' && game.state === 'menu') $('go').click();
  if (e.code === 'KeyR' && game.state !== 'menu') { $('pause').classList.add('hidden'); beginRun(); }
  if (e.code === 'Escape') { if (!$('settings').classList.contains('hidden')) closeSettings(); else if (game.state === 'pause') resume(); else if (game.state === 'play' || game.state === 'count') pause(); else if (game.state === 'end') showMenu(); }
  if (e.code === 'KeyM') { Sfx.muted = !Sfx.muted; Sfx.syncMusic(); popup(Sfx.muted ? 'MUSIC OFF' : 'MUSIC ON', '#d1d4dc'); }
  if (e.code === 'KeyG') toggleGhost();
  if (e.code === 'KeyV') toggleAutoRun();
  if (e.code === 'KeyF') { yaw = 0; pitch = .1; }
});
addEventListener('keyup', e => { input.keys.delete(e.code); if (keyAct[e.code]) release(keyAct[e.code]); });
function clearInput() { input.keys.clear(); input.jumpHeld = input.grabHeld = input.brakeHeld = input.pJump = input.pSlide = input.pReset = false; input.ix = input.iz = input.stickX = input.stickY = 0; input.resetTouch?.(); }
addEventListener('blur', () => { clearInput(); pause(); });
const canvas = renderer.domElement;
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * .0022 * settings.sens; pitch = clamp(pitch + e.movementY * .0018 * settings.sens, -.35, .6);
});
const lockMouse = () => { if (!isTouch && settings.mouseLook && camMode === 'chase') canvas.requestPointerLock()?.catch?.(() => {}); };
canvas.addEventListener('click', () => { if (game.state === 'play') lockMouse(); });

function readMoveInput() {
  const k = input.keys;
  let ix = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  let iz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  ix += input.stickX;
  if (settings.autoRun) {
    iz = k.has('KeyS') || k.has('ArrowDown') ? 0 : 1;
    if (input.stickY < -.18) iz = clamp(1 + input.stickY, 0, 1);
    if (!settings.mouseLook && Math.abs(ix) < .12 && player.state === 'air') ix = clamp(-player.pos.x * .45, -.75, .75);
    ix *= .6; // Steering remains a correction, rather than a full-speed turn off the narrow course.
  } else iz += input.stickY;
  if (input.brakeHeld) iz = 0;
  input.ix = clamp(ix, -1, 1); input.iz = clamp(iz, -1, 1);
}

if (isTouch) {
  $('touch').classList.remove('hidden'); document.body.classList.add('touch');
  $('go').textContent = 'Tap to run →';
  const knob = $('stick').querySelector('i');
  let stickId = null, sx = 0, sy = 0, lookId = null, lx = 0, ly = 0;
  input.resetTouch = () => { stickId = lookId = null; knob.style.transform = ''; document.querySelectorAll('.tbtn').forEach(b => b.classList.remove('held')); };
  document.querySelectorAll('.tbtn').forEach(b => {
    b.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); if (!['play', 'count'].includes(game.state)) return; b.classList.add('held'); press(b.dataset.act); }, { passive: false });
    const endButton = e => { if (e.targetTouches?.length) return; b.classList.remove('held'); release(b.dataset.act); };
    b.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); endButton(e); }, { passive: false });
    b.addEventListener('touchcancel', endButton, { passive: true });
  });
  addEventListener('touchstart', e => {
    for (const t of e.changedTouches) {
      if (game.state !== 'play' || t.target.closest('.tbtn, button, input, .overlay, #landing')) continue;
      if (t.clientX < innerWidth * .45 && stickId === null) { stickId = t.identifier; sx = t.clientX; sy = t.clientY; }
      else if (settings.mouseLook && lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
    }
  }, { passive: true });
  addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        const dx = clamp((t.clientX - sx) / 50, -1, 1), dy = clamp((t.clientY - sy) / 50, -1, 1);
        input.stickX = dx; input.stickY = -dy; knob.style.transform = `translate(${dx * 40}px,${dy * 40}px)`;
      } else if (t.identifier === lookId) {
        yaw -= (t.clientX - lx) * .006; pitch = clamp(pitch + (t.clientY - ly) * .004, -.35, .6); lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: true });
  const end = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { stickId = null; input.stickX = input.stickY = 0; knob.style.transform = ''; }
      if (t.identifier === lookId) lookId = null;
    }
  };
  addEventListener('touchend', end); addEventListener('touchcancel', end);
}

/* =====================================================================
   SCORE / COMBO / HUD helpers
   Every trick bumps the combo; points are multiplied by (1 + combo·0.25)
   and held "pending" until you stay grounded for 0.4s (banked) or die.
   ===================================================================== */
const score = { dist: 0, style: 0, pending: 0, combo: 0, time: 0, deaths: 0 };
const pops = $('pops'), comboEl = $('combo');
const actionCue = { label: '', detail: '', color: '#d9f66f', until: 0 };
function showAction(label, detail = '', color = '#d9f66f') {
  if (!recording || VERIFY_MODE) return;
  Object.assign(actionCue, { label, detail, color, until: score.time + .8 });
  if (!settings.calm) $('actionFeedback').animate([{ opacity: .3, translate: '0 7px' }, { opacity: 1, translate: '0 0' }], { duration: 160, easing: 'ease-out' });
}
function popup(text, color = '#4fc3f7', big = false) {
  if (!recording) return;
  const el = document.createElement('div'); el.className = 'pop' + (big ? ' big' : ''); el.textContent = text; el.style.color = color;
  pops.prepend(el); setTimeout(() => el.remove(), 1000);
  while (pops.children.length > 5) pops.lastChild.remove();
}
// FLOW STATE: chain 10 tricks without banking → ×1.5 points, lime screen edge and a music lift.
let flow = false;
function setFlow(on) {
  if (flow === on) return;
  flow = on; $('flowfx').classList.toggle('on', on);
  if (on) { showAction('FLOW STATE', 'STYLE BONUS ×1.5', '#d9f66f'); Sfx.flowOn(); shake(.1); }
}
const QUIET = new Set(['ORB', 'SLIDE', 'VAULT', 'CLIMB', 'LEDGE GRAB', 'AIR SPIN', 'RAIL HOP', 'JUMP', 'LONG JUMP']);
function trick(name, pts, color, quiet) {
  const key = `${chartIdx}:${name}`, seen = game.tricks?.get(key) || 0;
  if (seen >= 3) return; // Repeat practice is free; farming one obstacle does not grow the score forever.
  const award = styleAward(name, pts, player.styleIntent);
  game.tricks?.set(key, seen + 1);
  missionEvent(name === 'STUCK IT' ? 'FLIP' : name);
  if (!award.points) return;
  if (!award.link) { score.style += award.points; return; } // Pickups never create a skill chain or Flow.
  score.combo++;
  if (game.runSkills) {
    if (name === 'STUCK IT') game.runSkills.flips++;
    if (name === 'PERFECT LANDING') game.runSkills.precise++;
  }
  const v = Math.round(pts * (1 + score.combo * .25) * (flow ? 1.5 : 1));
  if (!flow && score.combo >= 10) setFlow(true);
  score.pending += v;
  if (!quiet && !QUIET.has(name) && score.combo !== 10) showAction(name === 'STUCK IT' ? 'CLEAN FLIP' : name, `+${v.toLocaleString()} STYLE`, color || '#d9f66f');
}
function bankCombo() {
  if (game.runSkills) game.runSkills.bestBanked = Math.max(game.runSkills.bestBanked, score.combo);
  if (score.combo >= 3) { showAction(`${score.combo}-MOVE LINE`, `+${Math.round(score.pending).toLocaleString()} BANKED`, '#ffd23f'); Sfx.bank(); }
  missionEvent('COMBO', score.combo);
  score.style += Math.round(score.pending); score.pending = 0; score.combo = 0; setFlow(false);
}
const flashEl = $('flash');
function flash(color, op = .5) {
  flashEl.style.transition = 'none'; flashEl.style.background = color; flashEl.style.opacity = op;
  void flashEl.offsetWidth; flashEl.style.transition = 'opacity .35s'; flashEl.style.opacity = 0;
}
let trauma = 0, hitStop = 0, landPunch = 0, fovKick = 0;
const shake = t => { if (!settings.calm) trauma = Math.min(1, trauma + t * .5); }; // kept subtle; off with Reduce motion

/* =====================================================================
   3. PLAYER CONTROLLER — kinematic, fixed 120Hz step, AABB collision.
   States: ground/air (implicit via onGround) + wallrun flag, 'grind', 'swing'.
   ===================================================================== */
// tuned for a calmer, controllable pace
const HANG_Y = 1.6, CLIMB_T = .34, VAULT_T = .24;
const GRAV = 28, JUMP_V = 11.5, DJUMP_V = 10.5, RUN_MAX = 9.2, BOOST_MAX = 11.2, HALF = .35, PH = 1.8;
const player = {
  pos: new V3(), vel: new V3(), state: 'air', onGround: false, ground: null, lastGroundY: 0,
  coyote: 0, jumpsUsed: 0, canCut: false, airTime: 0, slideT: 0, dashUsed: false, boostT: 0, padCd: 0,
  wallrun: false, wallT: 0, wallContact: 0, wallNormal: 0, wallCd: 0,
  rail: null, railT: 0, railSpeed: 0, railCd: 0,
  pole: null, poleAng: 0, poleR: 1, swingSpeed: 0, swingSign: 1, swingAcc: 0, poleCd: 0,
  comboGround: 0, squash: 0, heading: Math.PI, hangCd: 0, hang: null,
};
const _f = new V3(), _r = new V3(), _wish = new V3();
let landedOn = null, wishLen = 0;

function overlaps(c, P) {
  return P.x + HALF > c.min.x && P.x - HALF < c.max.x && P.y + PH > c.min.y && P.y < c.max.y && P.z + HALF > c.min.z && P.z - HALF < c.max.z;
}
// Move one axis, then push out of anything we now overlap. Includes step-up and a ledge mantle assist.
function moveAxis(axis, d) {
  if (!d) return;
  const p = player, P = p.pos; P[axis] += d;
  for (const c of colliders) {
    if (!c.active || !overlaps(c, P)) continue;
    if (axis === 'y') {
      if (d < 0) { P.y = c.max.y; landedOn = c; } else P.y = c.min.y - PH;
      p.vel.y = 0;
      continue;
    }
    const step = c.max.y - P.y;
    if (c.type === 'plat' && step > 0 && step <= .6) { P.y = c.max.y; continue; } // small lip: just step up
    P[axis] = d > 0 ? c.min[axis] - HALF - 1e-4 : c.max[axis] + HALF + 1e-4;
    const approachSpeed = Math.hypot(p.vel.x, p.vel.z);
    p.vel[axis] = 0;
    if (c.type === 'wall' && axis === 'x') { p.wallContact = .06; p.wallNormal = d > 0 ? -1 : 1; }
    else if (c.type === 'plat' && p.state === 'air' && p.hangCd <= 0 && step > .6 && step < 1.4 && approachSpeed > 4.5) startVault(c, axis, Math.sign(d), approachSpeed);
    else if (c.type === 'plat' && !p.onGround && p.state === 'air' && p.hangCd <= 0 && step > .6 && step < 2.2 && p.vel.y < 4) startHang(c, axis, Math.sign(d)); // ledge grab
  }
}
function moveAndCollide(dt) {
  const p = player, wasGround = p.onGround, impactVy = p.vel.y;
  moveAxis('x', p.vel.x * dt); moveAxis('z', p.vel.z * dt);
  landedOn = null; moveAxis('y', p.vel.y * dt);
  p.onGround = !!landedOn; p.ground = landedOn;
  if (p.onGround) { p.lastGroundY = p.pos.y; if (!wasGround) onLand(landedOn, impactVy); }
}

function onLand(c, vy) {
  const p = player, impact = -vy;
  if (impact > 8 && p.airTime > .15) airWave(p.pos.x, p.pos.y + .03, p.pos.z, 0x81e9db);
  p.squash = clamp(impact / 60, .05, .2); landPunch = settings.calm ? 0 : clamp(impact / 40, 0, .6); if (impact > 12) buzz(Math.min(30, impact));
  shake(clamp(impact / 120, .02, .2)); Sfx.land(impact);
  burst(p.pos.x, p.pos.y + .1, p.pos.z, Math.round(clamp(impact * .5, 3, 12)), 0x9aa3b5, impact * .2, .45, 2, 1);
  const hs = Math.hypot(p.vel.x, p.vel.z), R = runner;
  if (R.airFlip) {
    R.airFlip = false;
    if (!R.flipGround && R.flipStart >= 0 && (score.time - R.flipStart) / R.flipDur < .82) showAction('EARLY LANDING', 'Give the flip a little more air', '#a1afbf');
    else { trick('STUCK IT', 75, '#dcf513'); R.react = { kind: 'nod', t: 0 }; }
  }
  if (impact > 19 && hs > 4) { // parkour roll: tuck and roll forward, momentum kept
    startFlip('x', 1, .55, true); p.vel.x *= .9; p.vel.z *= .9; p.squash = 0;
    trick('PARKOUR ROLL', 100, '#dcf513'); Sfx.roll(); shake(.15);
  } else if (impact > 19) { // standing drop: superhero landing, a short stun
    p.stunT = .4; p.squash = .25; trick('SUPERHERO LANDING', 75, '#f5c542'); shake(.5); Sfx.thud();
    for (let k = 0; k < 30; k++) { const a = k / 30 * Math.PI * 2; emit(p.pos.x, p.pos.y + .05, p.pos.z, Math.cos(a) * 7, .5, Math.sin(a) * 7, 0x9aa3b5, .6, 1); }
  }
  const pl = c.plat;
  if (pl) { pl.bv = (pl.bv || 0) - impact * .02; bouncing.add(pl); } // the candle dips under you and springs back
  if (!pl || p.airTime < .3) return;
  const dz = Math.abs(p.pos.z - pl.zc), edge = pl.depth / 2 - dz;
  if (dz < .7) { trick('PERFECT LANDING', 200, '#26a69a'); Sfx.perfect(); runner.react = { kind: 'pump', t: 0 }; }
  else if (edge < .5) { trick('CLUTCH!', 150, '#ffd23f'); shake(.45); Sfx.clutch(); runner.react = { kind: 'wobble', t: 0 }; }
}

function step(dt) {
  const p = player;
  p.jumpAge = (p.jumpAge || 0) + dt;
  jumpBuf -= dt; slideBuf -= dt; p.hangCd -= dt; p.railCd -= dt; p.poleCd -= dt; p.boostT -= dt; p.wallContact -= dt; p.wallCd -= dt; p.padCd -= dt; p.ballisticT -= dt; p.stunT -= dt;

  // camera-relative wish direction
  if (camMode === 'chart') { _f.set(0, 0, -1); _wish.set(-input.iz, 0, -input.ix); } // 2.5D: A/D run along the chart, W/S move in depth
  else {
    _f.set(-Math.sin(simYaw), 0, -Math.cos(simYaw)); _r.set(Math.cos(simYaw), 0, -Math.sin(simYaw));
    _wish.set(0, 0, 0).addScaledVector(_f, input.iz).addScaledVector(_r, input.ix);
  }
  wishLen = Math.min(1, _wish.length()); if (wishLen > .01) _wish.normalize();

  if (p.state === 'hang') return stepHang(dt);
  if (p.state === 'grind') return stepGrind(dt);
  if (p.state === 'swing') return stepSwing(dt);

  const grounded = p.onGround;
  if (grounded) { p.coyote = COYOTE; p.jumpsUsed = 0; p.dashUsed = false; p.airTime = 0; p.styleIntent = false; }
  else { p.coyote -= dt; p.airTime += dt; }

  let hx = p.vel.x, hz = p.vel.z, hs = Math.hypot(hx, hz);

  // --- slide (ground) / air dash ---
  if (slideBuf > 0) {
    if (grounded && hs > 4 && p.slideT <= 0) {
      p.styleIntent = true;
      const s = Math.max(hs, 11.5) / hs; hx *= s; hz *= s; p.slideT = .7; slideBuf = 0;
      trick('SLIDE', 50, '#26a69a', true); Sfx.slide();
      burst(p.pos.x, p.pos.y + .1, p.pos.z, 14, 0x26a69a, 4, .5, 2);
    } else if (!grounded && !p.dashUsed && !p.wallrun) {
      p.styleIntent = true;
      let dx = _f.x, dz = _f.z;
      if (wishLen > .01) { dx = _wish.x; dz = _wish.z; } else if (hs > 1) { dx = hx / hs; dz = hz / hs; }
      const sp = Math.max(hs, 12); hx = dx * sp; hz = dz * sp;
      p.vel.y = Math.max(p.vel.y, 3); p.dashUsed = true; slideBuf = 0;
      trick('AIR SPIN', 75, '#4fc3f7'); Sfx.dash(); shake(.12); startFlip('y', 1, .4);
      burst(p.pos.x, p.pos.y + 1, p.pos.z, 24, 0x4fc3f7, 6, .4);
    }
  }
  p.slideT -= dt;
  const sliding = grounded && p.slideT > 0;
  hs = Math.hypot(hx, hz);

  // --- horizontal acceleration: snappy on ground, decent air control, overspeed bleeds slowly ---
  const maxS = p.boostT > 0 ? BOOST_MAX : RUN_MAX;
  if (sliding) {
    const k = Math.exp(-1 * dt); hx *= k; hz *= k;
    if (wishLen > .01) { hx += _wish.x * 8 * dt; hz += _wish.z * 8 * dt; }
  } else if (p.stunT > 0) { const k = Math.exp(-14 * dt); hx *= k; hz *= k; // hard landing: legs absorb, no control for a moment
  } else if (wishLen > .01 && !(p.ballisticT > 0)) { // spring flights are ballistic so they land where aimed
    const cap = Math.max(maxS * wishLen, hs - (grounded ? 16 : 5) * dt);
    let dx = _wish.x * cap - hx, dz = _wish.z * cap - hz;
    const dl = Math.hypot(dx, dz), maxD = (grounded ? 52 : 28) * dt;
    if (dl > maxD) { dx *= maxD / dl; dz *= maxD / dl; }
    hx += dx; hz += dz;
  } else if (grounded) { const k = Math.exp(-13 * dt); hx *= k; hz *= k; }

  // --- wall run: touch a wall while airborne and moving → low gravity, forward speed held ---
  if (!grounded && p.wallContact > 0 && !p.wallrun && p.wallCd <= 0 && hs > 5) {
    p.wallrun = true; p.wallT = 1.7; p.vel.y = clamp(p.vel.y, 2, 4); p.jumpsUsed = 1;
    trick('WALL RUN', 150, '#f5c542'); Sfx.wall(); shake(.12);
  }
  if (p.wallrun) {
    p.wallT -= dt;
    if (grounded || p.wallT <= 0 || p.wallContact <= 0) { p.wallrun = false; p.wallCd = .25; hx = p.wallNormal * 4; }
    else {
      hx = -p.wallNormal * 3; // stick into the wall so contact persists
      hz = (Math.sign(hz) || -1) * Math.max(Math.abs(hz), 7.5);
      if (Math.random() < .5) emit(p.pos.x - p.wallNormal * HALF, p.pos.y + .3, p.pos.z, p.wallNormal * 2, Math.random() * 3, -hz * .1, 0xf5c542, .4, 6);
    }
  }

  // --- gravity, variable jump height (release cuts upward speed), faster fall ---
  let vy = p.vel.y;
  if (!input.jumpHeld && p.canCut && p.jumpAge >= .12 && vy > 0) { vy *= .55; p.canCut = false; }
  if (vy <= 0) p.canCut = false;
  let g = GRAV; if (p.wallrun) g *= .3; else if (vy < 0) g *= 1.3;
  vy -= g * dt; if (p.wallrun) vy = Math.max(vy, -2.5); vy = Math.max(vy, -48);

  // --- jumps: wall jump > ground/coyote jump > double jump (all read the jump buffer) ---
  if (jumpBuf > 0) {
    if (p.wallrun) {
      p.styleIntent = true;
      vy = 11; hx = p.wallNormal * 7; p.wallrun = false; p.wallCd = .35; p.jumpsUsed = 1; p.canCut = true; p.jumpAge = 0; jumpBuf = 0;
      trick('WALL FLIP', 125, '#f5c542'); Sfx.jump(); Sfx.flip(); shake(.18); startFlip('z', p.wallNormal, .5);
      burst(p.pos.x, p.pos.y + 1, p.pos.z, 20, 0xf5c542, 6, .45);
    } else if (grounded || p.coyote > 0) {
      p.styleIntent = true;
      vy = JUMP_V;
      if (sliding) { hx *= 1.12; hz *= 1.12; p.slideT = 0; trick('LONG JUMP', 100, '#26a69a'); }
      else if (hs > 8) trick('JUMP', 50, null, true);
      p.jumpsUsed = 1; p.coyote = 0; p.onGround = false; p.canCut = true; p.jumpAge = 0; jumpBuf = 0; p.squash = -.2;
      tip('flip', 'Press <kbd>Space</kbd> again in the air to <b>flip</b> — direction picks front / back / side');
      Sfx.jump(); burst(p.pos.x, p.pos.y + .05, p.pos.z, 10, 0x9aa3b5, 3, .4, 1);
    } else if (p.jumpsUsed < 2) {
      p.styleIntent = true;
      vy = DJUMP_V; p.jumpsUsed = 2; p.canCut = true; p.jumpAge = 0; jumpBuf = 0; p.squash = -.2;
      if (wishLen > .01) { const sp = Math.max(hs, 8.5); hx = _wish.x * sp; hz = _wish.z * sp; } // air redirect
      // The flip follows your input like a real traceur: stepping sideways = side flip,
      // carrying speed = front flip, standing / backing off = backflip.
      const side = camMode === 'chart' ? input.iz : input.ix, fwd = Math.hypot(hx, hz);
      if (Math.abs(side) > .5) { startFlip('z', -Math.sign(side), .62); trick('SIDE FLIP', 110, '#dcf513'); }
      else if (fwd > 4) { startFlip('x', 1, .62); trick('FRONT FLIP', 100, '#dcf513'); }
      else { startFlip('x', -1, .62); trick('BACKFLIP', 120, '#dcf513'); }
      runner.airFlip = true; fovKick = settings.calm ? 0 : 2; buzz(12);
      Sfx.djump(); Sfx.flip();
      airWave(p.pos.x, p.pos.y + .05, p.pos.z); // the "air step" you kick off from
    }
  }

  p.vel.set(hx, vy, hz);
  moveAndCollide(dt);

  // --- things that happen while standing on a platform ---
  if (p.onGround) {
    const pl = p.ground.plat;
    if (pl?.check && game.checkpoint !== pl) { game.checkpoint = pl; pl.check.flag.material = checkOn; popup(`CHECKPOINT ${pl.check.n}`, '#d1d4dc'); Sfx.collect(); }
    if (pl && !pl.green && pl.crackT < 0) { pl.crackT = 0; Sfx.crack(); tip('red', '<b style="color:var(--red)">Red candles crack</b> — keep moving!'); }
    if (pl && pl.pad && p.padCd <= 0 && Math.abs(p.pos.x - pl.x) < 1.7 && Math.abs(p.pos.z - pl.zc) < 1.4) launchPad();
    if (pl && pl.spring) tip('spring', 'Big pump ahead — run onto the <b style="color:var(--lime)">spring</b>');
    if (pl && pl.spring && p.padCd <= 0 && Math.abs(p.pos.z - pl.spring.z) < .9 && Math.abs(p.pos.x) < 1.2) launchSpring(pl.spring);
    if (!sliding) p.comboGround += dt;
    if (score.combo > 0 && p.comboGround > .4) bankCombo();
  } else p.comboGround = 0;

  if (!p.onGround && p.railCd <= 0 && p.vel.y <= 1) tryCatchRail();
  if (!p.onGround && p.poleCd <= 0 && input.grabHeld) tryGrabPole();
}

/* Ledge hang: running/falling into a candle face whose top is too high to step up
   grabs the edge with both hands. Hold toward it (or press jump) to pull up, away / slide to drop. */
// Vault: at speed, low ledges are cleared with a one-hand lazy vault that keeps your momentum.
function startVault(c, axis, dir, approachSpeed) {
  const p = player, sp = Math.max(approachSpeed, 6);
  p.state = 'hang'; p.wallrun = false; p.vel.set(0, 0, 0);
  p.hang = { c, axis, dir, t: 0, climb: 0, vault: true, speed: sp, y0: p.pos.y, face: dir > 0 ? c.min[axis] : c.max[axis] };
  trick('VAULT', 60, '#d1d4dc'); Sfx.climb();
}
function startHang(c, axis, dir) {
  const p = player;
  tip('hang', 'Hanging! Hold <b>forward</b> or <kbd>Space</kbd> to climb up');
  p.state = 'hang'; p.wallrun = false; p.vel.set(0, 0, 0); p.jumpsUsed = 0; p.dashUsed = false;
  p.hang = { c, axis, dir, t: 0, climb: -1, face: dir > 0 ? c.min[axis] : c.max[axis] };
  trick('LEDGE GRAB', 50, '#d1d4dc', true); Sfx.land(8); shake(.06);
  burst(p.pos.x, c.max.y, p.pos.z, 8, 0x9aa3b5, 2, .4, 3);
}
function stepHang(dt) {
  const p = player, h = p.hang, c = h.c;
  if (!c.active) { p.state = 'air'; p.hangCd = .3; return; } // the red candle broke under your hands
  h.t += dt; p.lastGroundY = c.max.y;
  const into = (h.axis === 'x' ? _wish.x : _wish.z) * h.dir * wishLen;
  if (h.climb < 0) {
    p.pos.y = damp(p.pos.y, c.max.y - HANG_Y, 18, dt);
    if (jumpBuf > 0 || (h.t > .2 && into > .3)) { if (jumpBuf > 0) p.styleIntent = true; h.climb = 0; jumpBuf = 0; Sfx.climb(); }
    else if (into < -.3 || slideBuf > 0) { p.state = 'air'; p.hangCd = .4; slideBuf = 0; p.pos[h.axis] -= h.dir * .15; }
    return;
  }
  // climb: pull the body up first (hands push down), then step forward onto the top
  h.climb += dt;
  const dur = h.vault ? VAULT_T : CLIMB_T, k = Math.min(1, h.climb / dur), up = 1 - Math.pow(1 - Math.min(1, k / .65), 3), fwd = clamp((k - .45) / .55, 0, 1);
  p.pos.y = lerp(h.vault ? h.y0 : c.max.y - HANG_Y, c.max.y + .02 + (h.vault ? Math.sin(k * Math.PI) * .25 : 0), up);
  p.pos[h.axis] = h.face - h.dir * (HALF + 1e-3) + h.dir * (HALF + .7) * fwd;
  if (k >= 1) { p.state = 'air'; p.vel.set(0, 0, 0); p.vel[h.axis] = h.dir * (h.vault ? h.speed : 3); p.hangCd = .3; if (!h.vault) trick('CLIMB', 25, '#d1d4dc', true); }
}

// Spring: computes the exact launch that lands you in the middle of the target candle.
function launchSpring(sp) {
  const p = player, b = sp.target, g = GRAV, apex = 1.6;
  const vy = Math.sqrt(2 * g * (b.top - p.pos.y + apex)), t = vy / g + Math.sqrt(2 * apex / (g * 1.3));
  p.vel.set((b.x - p.pos.x) / t, vy, (b.zc - p.pos.z) / t);
  p.onGround = false; p.ballisticT = t; p.padCd = .5; p.jumpsUsed = 1; p.canCut = false; p.squash = -.25; sp.anim = 0;
  trick('SPRING', 75, '#dcf513'); Sfx.spring(); buzz(25); shake(.2);
  burst(p.pos.x, p.pos.y + .3, p.pos.z, 30, 0xdcf513, 6, .5, 4, 3);
}
function launchPad() {
  const p = player, hs = Math.hypot(p.vel.x, p.vel.z);
  const dx = hs > 1 ? p.vel.x / hs : 0, dz = hs > 1 ? p.vel.z / hs : -1;
  p.vel.set(dx * 19, 14, dz * 19); p.onGround = false; p.boostT = 2.2; p.padCd = .5; p.jumpsUsed = 1;
  trick('BOOST', 100, '#4fc3f7'); Sfx.boost(); shake(.2);
  burst(p.pos.x, p.pos.y + .2, p.pos.z, 50, 0x4fc3f7, 10, .6, 0, 4);
}

/* Grind: snap to the nearest point of a rail when falling onto it, slide along it. */
function tryCatchRail() {
  const p = player;
  for (const r of rails) {
    const t = _v.copy(p.pos).sub(r.a).dot(r.dir) / r.len;
    if (t < 0 || t > .95) continue;
    _v.copy(r.a).addScaledVector(r.dir, r.len * t);
    const dxz = Math.hypot(p.pos.x - _v.x, p.pos.z - _v.z), dy = p.pos.y - _v.y;
    if (dxz < 1 && dy > -.5 && dy < 1.2) {
      p.state = 'grind'; p.rail = r; p.railT = t; p.wallrun = false; p.slideT = 0; p.onGround = false;
      p.railSpeed = Math.max(p.vel.x * r.dir.x + p.vel.z * r.dir.z, 8) + 1;
      trick('GRIND', 150, '#c9d1dc'); Sfx.grind(true); shake(.12);
      return;
    }
  }
}
function stepGrind(dt) {
  const p = player, r = p.rail;
  p.railSpeed = clamp(p.railSpeed + (-r.dir.y * 18 + 1) * dt, 6, 15); // downhill = faster
  p.railT += p.railSpeed * dt / r.len;
  p.pos.copy(r.a).addScaledVector(r.dir, r.len * Math.min(p.railT, 1));
  p.vel.copy(r.dir).multiplyScalar(p.railSpeed);
  p.lastGroundY = p.pos.y;
  if (p.styleIntent) score.pending += 60 * dt * (1 + score.combo * .25);
  if (Math.random() < .6) emit(p.pos.x, p.pos.y, p.pos.z, (Math.random() - .5) * 4, Math.random() * 4, -r.dir.z * 4, Math.random() < .5 ? 0xffd23f : 0xc9d1dc, .35, 12);
  if (jumpBuf > 0) {
    p.styleIntent = true;
    exitGrind(); p.vel.y = 12; p.jumpsUsed = 1; p.canCut = true; p.jumpAge = 0; jumpBuf = 0;
    trick('RAIL HOP', 75, '#c9d1dc'); Sfx.jump();
  } else if (p.railT >= 1) { exitGrind(); p.vel.y = Math.max(p.vel.y, 1); }
}
function exitGrind() { const p = player; p.state = 'air'; p.railCd = .35; p.airTime = 0; p.jumpsUsed = 1; Sfx.grind(false); }

/* Swing: hold grab near a pole → orbit it, rising slightly; release to launch along the tangent. */
function tryGrabPole() {
  const p = player;
  for (const pl of poles) {
    if (!pl.active) continue;
    const dx = p.pos.x - pl.x, dz = p.pos.z - pl.z, d = Math.hypot(dx, dz);
    if (d < 1.8 && p.pos.y > pl.yb - 1 && p.pos.y < pl.yt - 1) {
      p.styleIntent = true;
      p.state = 'swing'; p.pole = pl; p.poleR = clamp(d, .9, 1.4); p.poleAng = Math.atan2(dz, dx);
      p.swingSpeed = Math.max(Math.hypot(p.vel.x, p.vel.z), 7);
      p.swingSign = dx * p.vel.z - dz * p.vel.x >= 0 ? 1 : -1; p.swingAcc = 0; p.wallrun = false;
      trick('SWING', 150, '#f5c542'); Sfx.wall(); shake(.15);
      return;
    }
  }
}
function stepSwing(dt) {
  const p = player, pl = p.pole;
  if (!pl.active || !input.grabHeld || jumpBuf > 0 || p.swingAcc > Math.PI * 4) return releaseSwing();
  p.swingSpeed = Math.min(p.swingSpeed + 3 * dt, 12);
  const w = p.swingSign * p.swingSpeed / p.poleR;
  p.poleAng += w * dt; p.swingAcc += Math.abs(w) * dt;
  p.pos.set(pl.x + Math.cos(p.poleAng) * p.poleR, Math.min(p.pos.y + 1.2 * dt, pl.yt - 1.9), pl.z + Math.sin(p.poleAng) * p.poleR);
  p.vel.set(-Math.sin(p.poleAng) * w * p.poleR, 0, Math.cos(p.poleAng) * w * p.poleR);
  p.lastGroundY = p.pos.y;
  if (Math.random() < .4) emit(pl.x, p.pos.y + 1.7, pl.z, (Math.random() - .5) * 3, Math.random() * 2, (Math.random() - .5) * 3, 0xf5c542, .4, 4);
}
function releaseSwing() {
  const p = player, hs = Math.hypot(p.vel.x, p.vel.z) || 1, s = p.swingSpeed * 1.15;
  p.vel.x *= s / hs; p.vel.z *= s / hs; p.vel.y = 11;
  p.state = 'air'; p.poleCd = .4; p.jumpsUsed = 1; p.canCut = true; p.jumpAge = 0; jumpBuf = 0; p.airTime = 0;
  trick('FRONTFLIP LAUNCH', 125, '#f5c542'); Sfx.launch(); Sfx.flip(); shake(.2); startFlip('x', 1, .6);
  burst(p.pos.x, p.pos.y + 1, p.pos.z, 20, 0xf5c542, 6, .4);
}

/* =====================================================================
   GAME FLOW + META — menu, countdown, death, run end.
   Profile (XP, cleared charts), unlocks and leaderboards are stored in
   this browser for now; ECONOMY.md describes the server / on-chain side.
   ===================================================================== */
const game = { state: 'menu', deadT: 0 };
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null || (Array.isArray(d) ? !Array.isArray(v) : d !== null && typeof v !== typeof d) ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const profile = store.get('cp-profile', { xp: 0, cleared: [] });
profile.xp = Number.isFinite(profile.xp) && profile.xp >= 0 ? profile.xp : 0;
profile.cleared = Array.isArray(profile.cleared) ? profile.cleared.filter(x => typeof x === 'string') : [];
if (profile.missions && (!profile.missions.prog || !Array.isArray(profile.missions.done))) delete profile.missions;
if (profile.season && (!Number.isFinite(profile.season.sp) || !Number.isFinite(profile.season.daySp))) delete profile.season;
if (!Array.isArray(profile.cosmetics)) profile.cosmetics = ['default'];
// v2: charts were renamed to CP01–CP04 (clearly simulated, no token-like tickers); carry old progress over
{ const OLD = { VIBE: 'CP01', RAID: 'CP02', PFP: 'CP03', GUILD: 'CP04' };
  try { for (const [o, n] of Object.entries(OLD)) for (const k of ['cp-board-', 'cp-ghost-']) { const v = localStorage.getItem(k + o); if (v !== null && localStorage.getItem(k + n) === null) localStorage.setItem(k + n, v); localStorage.removeItem(k + o); } } catch (e) {}
  profile.cleared = profile.cleared.map(x => OLD[x] || x); }
let playerName = store.get('cp-name', 'viber' + Math.floor(100 + Math.random() * 900));
store.set('cp-name', playerName); // keep the generated name stable across visits
const VIBER_XP = [0, 300, 900, 2000, 0, 0]; // the Haunt crew is free for the event // XP needed to unlock each viber
const levelUnlocked = value => { const lv = typeof value === 'number' ? LEVELS[value] : value; if (!lv) return false; if (lv.tutorial || lv.sprint || lv.haunt || lv.sym === 'CP01') return true; const i = LEVELS.findIndex(l => l.sym === lv.sym); return profile.cleared.includes(lv.endless || lv.cup ? 'CP01' : LEVELS[i - 1]?.sym); };
const nextLevel = lv => lv.arena || lv.endless || lv.cup ? null : lv.tutorial ? makeSprintLevel(sprintPick) : lv.sprint ? LEVELS[1] : LEVELS[LEVELS.findIndex(l => l.sym === lv.sym) + 1];
const boardId = lv => `v${RULES_VERSION}:` + (lv.arena ? `ARENA-${lv.arenaId}` : (lv.endless ? `DAILY-${lv.seed}` : lv.cup ? `CUP-${lv.period}` : lv.sprint && lv.route ? `SPRINT-R${lv.route + 1}` : lv.sym) + (tfOf(lv).id === '1H' ? '' : '@' + tfOf(lv).id)); // each timeframe has its own board
// Local personal bests stay available independently of the shared, verified board.
const Board = {
  top: id => store.get('cp-board-' + id, []).filter(e => e && typeof e.name === 'string' && typeof e.viber === 'string' && Number.isFinite(e.score) && e.score >= 0),
  submit(id, e) { const l = Board.top(id); l.push(e); l.sort((a, b) => b.score - a.score); l.length = Math.min(l.length, 10); store.set('cp-board-' + id, l); return l.indexOf(e); },
};
let rankedSession = null, onlineAvailable = false, rankedTicket = null, startingRun = false, onlineBoardRequest = 0;
async function api(path, data) {
  const r = await fetch('/api/' + path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(45000), ...(data === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Service unavailable'); return j;
}
function courseConfig() { return { sym: level.arena ? 'ARENA' : level.sym, tf: TFS.indexOf(tfOf(level)), seed: level.seed, period: level.period || '', arena: level.arena || null, ...(level.sprint ? { route: level.route || 0 } : {}) }; }
function renderOnline() {
  $('onlineTitle').textContent = rankedSession ? 'Your next run can count.' : 'Practice makes a cleaner line.';
  $('onlineStatus').textContent = onlineAvailable ? rankedSession ? `Signed in ${rankedSession.slice(0, 6)}…${rankedSession.slice(-4)} · every ranked run is replayed, then you can record it on-chain` : 'Sign in with email to play ranked and record your runs on-chain. Practice needs nothing.' : 'Practice mode · ranked play opens when the verifier is configured.';
  $('rankedLogin').hidden = !!rankedSession; $('rankedLogin').disabled = !onlineAvailable;
  $('rankedMode').disabled = !onlineAvailable || !rankedSession;
  if (!rankedSession) $('rankedMode').checked = false;
  $('rankedLogout').classList.toggle('hidden', !rankedSession);
}
async function loadOnlineBoard() {
  if (VERIFY_MODE) return;
  const id = ++onlineBoardRequest, board = boardId(level); $('onlineBoard').textContent = 'Loading on-chain records…';
  try {
    // The board is read straight from WickRunnerScores.top(), so it survives any server restart; names come from the server when it has them.
    const { Interface, id: hashText } = await loadEthers(), abi = new Interface(['function top(bytes32) view returns (tuple(address player,uint64 score,uint64 seq)[])']);
    const [rows] = abi.decodeFunctionResult('top', await ethCall(SCORES.address, abi.encodeFunctionData('top', [hashText(board)])));
        const entries = rows.map(r => { const w = r.player.toLowerCase(), short = w.slice(0, 6) + '…' + w.slice(-4); return { wallet: short, name: w === rankedSession ? 'You' : 'Runner', score: Number(r.score) }; });
    if (id !== onlineBoardRequest) return;
    $('onlineBoard').replaceChildren();
    if (!entries.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No on-chain records yet. Record a verified run to set the first line.'; $('onlineBoard').append(li); }
    for (const [i, e] of entries.entries()) { const li = document.createElement('li'); for (const value of [i + 1, e.name, e.wallet, e.score.toLocaleString()]) { const span = document.createElement('span'); span.textContent = value; li.append(span); } $('onlineBoard').append(li); }
  } catch (e) { if (id === onlineBoardRequest) $('onlineBoard').textContent = 'Shared board unavailable. Your local bests are saved.'; }
}
async function beginRun() {
  if (startingRun) return; startingRun = true; $('go').disabled = true; rankedTicket = null;
  try {
    refreshCalendar(true);
    if ($('rankedMode').checked) {
      if (!rankedSession) throw new Error('Sign in before starting a ranked run.');
      if (game.state === 'play' || game.state === 'count') pause();
      const chosenBoard = boardId(level);
      rankedTicket = await api('runs/start', { wallet: rankedSession, board: chosenBoard, course: courseConfig() });
      if (chosenBoard !== boardId(level)) throw new Error('The chart changed while starting. Please start again.');
    }
    Sfx.init(); Sfx.startMusic(); restart(); $('pause').classList.add('hidden');
  } catch (e) { if (game.state === 'pause') $('pause').classList.remove('hidden'); $('onlineStatus').textContent = e.message; popup(e.message, '#ff7878'); }
  finally { startingRun = false; $('go').disabled = false; }
}
$('rankedLogin').onclick = async () => {
  const b = $('rankedLogin'); b.disabled = true;
  try {
    rankedSession = await emailLogin(); renderOnline(); // the email wallet is the ranked identity; only it can record its runs on-chain
  } catch (e) { $('onlineStatus').textContent = e.code === 4001 ? 'Sign-in cancelled. You can keep practicing.' : e.message; }
  finally { b.disabled = !onlineAvailable; }
};
$('rankedLogout').onclick = async () => { try { await WickWallet.logout(); rankedSession = null; renderOnline(); } catch { $('onlineStatus').textContent = 'Could not sign out. Please retry.'; } };
$('submitRanked').onclick = async () => {
  const b = $('submitRanked'); b.disabled = true; b.textContent = 'Verifying replay…';
  const run = game.lastRun;
  try { const r = await api('runs/submit', { id: run.ticket, log: run.log, claimed: run.total, name: playerName }); run.ticket = null; if (game.lastRun === run) b.textContent = '✓ Server verified'; if (r.attest && game.lastRun === run) offerOnchain(r.attest); }
  catch (e) { if (game.lastRun === run) { b.textContent = 'Retry submission'; popup(e.message, '#ff7878'); b.disabled = false; } }
};
/* ON-CHAIN RECORD — a server-verified run can be written to WickRunnerScores on Robinhood Chain testnet.
   The player sends the transaction (testnet gas only); the contract accepts only runs the verifier signed. */
const SCORES = { address: '0x2417104586F701fD9AbBc7e068A461ad5766Fe89' }; // WickRunnerScores on Robinhood Chain testnet
// EMAIL LOGIN — Privy (vendor/privy.js, built from wallet/privy.js) signs players in by email and gives each an
// embedded wallet on Robinhood Chain testnet. That wallet signs the ranked/arena messages and sends on-chain records.
let privyAppId = 'cmw0uhw8m03h00gl7m03nwytr', privyWatching = false; // public client id; works without the score server
async function emailLogin() {
  if (!privyAppId) throw new Error('Email sign-in is not configured yet. Practice is always free.');
  if (!window.WickWallet) await new Promise((res, rej) => { // ~6 MB, so it loads only when someone signs in
    const el = document.createElement('script'); el.src = './vendor/privy.js'; el.onload = res; el.onerror = () => rej(new Error('Sign-in did not load. Check your connection; practice is always free.')); document.head.append(el);
  });
  if (!privyWatching) { privyWatching = true; WickWallet.onChange(onPrivyChange); }
  await WickWallet.init(privyAppId); return WickWallet.login();
}
function offerOnchain(a) {
  if (!SCORES.address || !window.WickWallet?.address()) return;
  const b = $('recordOnchain'); b.classList.remove('hidden'); b.disabled = false; b.textContent = 'Record on-chain (testnet)';
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Confirm the transaction…';
    try {
      const { Interface } = await loadEthers();
      const data = new Interface(['function record(bytes32,uint64,bytes32,uint64,bytes)']).encodeFunctionData('record', [a.board, a.score, a.runId, a.deadline, a.sig]);
      const eth = await WickWallet.provider(), from = WickWallet.address();
      const tx = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: SCORES.address, data }] });
      b.textContent = '✓ Recorded on-chain'; b.onclick = () => window.open(`${CHAIN.explorer}/tx/${tx}`, '_blank', 'noopener'); b.disabled = false;
    } catch (e) { b.textContent = e.code === 4001 ? 'Record on-chain (testnet)' : 'Retry on-chain record'; b.disabled = false; if (e.code !== 4001) popup(e.message?.slice(0, 90) || 'Transaction failed', '#ff7878'); }
  };
}
tfPick = clamp(store.get('cp-tf', 1) | 0, 0, TFS.length - 1);
sprintPick = clamp(store.get('cp-sprint-route', 0) | 0, 0, SPRINT_ROUTES.length - 1);
{ let sv = store.get('cp-level', 'TRAIN'); if (typeof sv === 'number') sv = ['CP01', 'CP02', 'CP03', 'CP04', 'DAILY'][sv] || 'CP01'; // older saves stored an index
  const i = LEVELS.findIndex(l => l.sym === sv); if (i >= 0 && levelUnlocked(i)) level = LEVELS[i].sprint ? makeSprintLevel(sprintPick) : LEVELS[i]; }

/* GHOST — your best run on each chart is recorded (20 samples/s) and replayed as a see-through viber. */
const GHOST_HZ = 20, GHOST_MAX = 36000;
let ghostRec = [], ghostTimes = [], ghost = null, ghostData = null, splitI = 0, ghostI = 0;
const ghostKey = () => 'cp-ghost-' + boardId(level);
function buildGhost() {
  if (ghost) { ghost.root.traverse(o => { if (o.material) { o.material.userData = { ...o.material.userData, perCandle: true }; } }); disposeObj(ghost.root); ghost = null; }
  ghostData = store.get(ghostKey(), null);
  if (!ghostData || !Array.isArray(ghostData.f) || ghostData.f.length < 8 || ghostData.f.length % 4 || !ghostData.f.every(Number.isFinite) || !Array.isArray(ghostData.t) || ghostData.t.length !== ghostData.f.length / 4 || !ghostData.t.every((v, i, a) => Number.isFinite(v) && (i === 0 || v > a[i - 1]))) ghostData = null;
  if (!ghostData) return;
  ghost = buildRunner(VIBERS[ghostData.viber] || VIBERS[0]);
  ghost.root.traverse(o => { o.castShadow = false; if (o.material) { o.material = o.material.clone(); Object.assign(o.material, { transparent: true, opacity: .28, depthWrite: false }); } });
  const tag = textSprite('BEST', '#dcf513'); tag.position.y = 2.2; tag.scale.multiplyScalar(.6); ghost.root.add(tag);
}
function updateGhost() {
  const p = player;
  if (!ghost) return;
  const f = ghostData.f, times = ghostData.t, n = times.length;
  if (score.time < times[ghostI]) ghostI = 0;
  while (ghostI < n - 2 && times[ghostI + 1] <= score.time) ghostI++;
  const i = ghostI, j = Math.min(i + 1, n - 1), k = clamp((score.time - times[i]) / Math.max(.001, times[j] - times[i]), 0, 1);
  ghost.root.visible = settings.ghost && game.state === 'play' && score.time >= times[0] && score.time < times[n - 1]; // only while racing (it would cover the intro shot)
  const px = ghost.root.position.z;
  ghost.root.position.set(lerp(f[i * 4], f[j * 4], k), lerp(f[i * 4 + 1], f[j * 4 + 1], k), lerp(f[i * 4 + 2], f[j * 4 + 2], k));
  ghost.root.rotation.y = f[i * 4 + 3];
  ghost.phase += Math.abs(ghost.root.position.z - px) * 1.6; // steps with distance covered — same stepping cycle as the runner
  const s = Math.sin(ghost.phase), c = Math.cos(ghost.phase);
  ghost.legL.position.set(ghost.legL.position.x, Math.max(0, c) * .2, s * .32); ghost.legR.position.set(ghost.legR.position.x, Math.max(0, -c) * .2, -s * .32);
  ghost.legL.rotation.x = -c * .45; ghost.legR.rotation.x = c * .45; ghost.armL.rotation.x = s * .95; ghost.armR.rotation.x = -s * .95;
}

/* DAILY MISSIONS — 3 a day (same for everyone, seeded by date); progress is saved, XP paid on completion. */
const MISSION_POOL = [
  { id: 'FLIP', text: 'Stick 10 flips', goal: 10, xp: 150 },
  { id: 'PARKOUR ROLL', text: 'Roll out of 3 heavy dumps', goal: 3, xp: 150 },
  { id: 'SPRING', text: 'Ride 4 springs', goal: 4, xp: 120 },
  { id: 'GRIND', text: 'Grind 3 rails', goal: 3, xp: 120 },
  { id: 'ORB', text: 'Collect 40 orbs', goal: 40, xp: 150 },
  { id: 'VAULT', text: 'Vault 6 ledges', goal: 6, xp: 120 },
  { id: 'PERFECT LANDING', text: 'Stick 5 perfect landings', goal: 5, xp: 150 },
  { id: 'WALL RUN', text: 'Wall-run 4 times', goal: 4, xp: 120 },
  { id: 'LEDGE GRAB', text: 'Grab 5 ledges', goal: 5, xp: 100 },
  { id: 'COMBO', text: 'Bank a x8 combo', goal: 8, xp: 200, best: true },
  { id: 'CLEAR', text: 'Clear any chart', goal: 1, xp: 250 },
  { id: 'DAILY', text: 'Survive 50 candles in DAILY', goal: 50, xp: 300, best: true },
];
let today = utcDay();
const dailyMissions = () => { const r = mulberry32(+today.replace(/-/g, '') * 7), pool = [...MISSION_POOL], out = []; while (out.length < 3) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]); return out; };
let missions = dailyMissions();
if (profile.missions?.day !== today) { profile.missions = { day: today, prog: {}, done: [] }; store.set('cp-profile', profile); }
function missionEvent(id, n = 1) {
  if (!recording) return;
  refreshCalendar();
  const m = missions.find(q => q.id === id), ms = profile.missions;
  if (!m || ms.done.includes(id)) return;
  ms.prog[id] = m.best ? Math.max(ms.prog[id] || 0, n) : (ms.prog[id] || 0) + n;
  if (ms.prog[id] >= m.goal) { ms.done.push(id); profile.xp += m.xp; addSP(m.xp); popup(`MISSION DONE · +${m.xp} XP`, '#dcf513', true); Sfx.bank(); }
  store.set('cp-profile', profile);
}
function renderMissions() {
  const ms = profile.missions;
  $('missions').innerHTML = missions.map(m => {
    const v = Math.min(m.goal, ms.prog[m.id] || 0), done = ms.done.includes(m.id);
    return `<div class="ms${done ? ' done' : ''}"><span>${done ? '✓ ' : ''}${m.text}</span><small>${v}/${m.goal} · +${m.xp} XP · SP</small><i style="width:${v / m.goal * 100}%"></i></div>`;
  }).join('');
}

/* SEASONS — a weekly competitive layer on top of permanent XP (see ECONOMY.md).
   Season Points (SP) come from runs and missions with a daily cap, so skill matters more than hours.
   Tiers unlock cosmetic trails here; with a backend, the tier would also set the share of a weekly incentive pool (eligibility never guaranteed). */
const SP_DAILY_CAP = 1500;
const TIERS = [
  { name: 'Bronze', sp: 0, color: '#c08457' },
  { name: 'Silver', sp: 1000, color: '#c9d1dc', trail: 'silver' },
  { name: 'Gold', sp: 3000, color: '#f5c542', trail: 'gold' },
  { name: 'Platinum', sp: 6000, color: '#7fd8cf', trail: 'mint' },
  { name: 'Diamond', sp: 8000, color: '#b48cff', trail: 'violet' },
];
const TRAILS = { default: [.85, .88, .95], silver: [.79, .82, .86], gold: [.96, .77, .26], mint: [.5, .85, .81], violet: [.7, .55, 1] };
if (profile.season?.id !== weekId()) profile.season = { id: weekId(), sp: 0, day: today, daySp: 0 };
let season = profile.season;
if (season.day !== today) { season.day = today; season.daySp = 0; }
profile.cosmetics ||= ['default']; profile.trail ||= 'default';
store.set('cp-profile', profile);
const tierOf = sp => TIERS.reduce((t, x) => sp >= x.sp ? x : t, TIERS[0]);
function addSP(n) { // Season progression has the same cap and scoring for every player.
  refreshCalendar();
  const gained = Math.max(0, Math.min(n, SP_DAILY_CAP - season.daySp)), before = tierOf(season.sp);
  season.sp += gained; season.daySp += gained;
  const after = tierOf(season.sp);
  if (after.trail && !profile.cosmetics.includes(after.trail)) profile.cosmetics.push(after.trail);
  store.set('cp-profile', profile);
  return { gained, capped: gained < n, promoted: after !== before ? after : null };
}
function seasonEndsIn() { // seasons roll over Monday 00:00 UTC
  const now = new Date(), d = (8 - (now.getUTCDay() || 7)) % 7 || 7;
  const h = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d) - now) / 36e5);
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
function renderSeason() {
  const t = tierOf(season.sp), nx = TIERS[TIERS.indexOf(t) + 1];
  $('seasonTitle').textContent = `Season ${season.id}`; $('seasonEnds').textContent = `ends in ${seasonEndsIn()}`;
  $('tierBadge').textContent = t.name; $('tierBadge').style.color = t.color;
  $('seasonBar').style.width = (nx ? (season.sp - t.sp) / (nx.sp - t.sp) : 1) * 100 + '%';
  $('seasonSp').textContent = `${season.sp.toLocaleString()} SP`;
  $('seasonNext').textContent = nx ? `${(nx.sp - season.sp).toLocaleString()} SP to ${nx.name} · unlocks the ${nx.trail} trail` : 'Top tier reached this season';
  $('seasonDaily').textContent = `Today ${season.daySp.toLocaleString()} / ${SP_DAILY_CAP.toLocaleString()} SP`;
  $('trails').innerHTML = Object.keys(TRAILS).map(k => {
    const own = profile.cosmetics.includes(k), c = TRAILS[k].map(v => Math.round(v * 255)).join(',');
    return `<button class="trail${profile.trail === k ? ' on' : ''}${own ? '' : ' lock'}" data-trail="${k}"><i style="background:rgb(${c})"></i>${k}</button>`;
  }).join('');
  $('trails').querySelectorAll('.trail').forEach(b => b.onclick = e => {
    e.stopPropagation(); if (!profile.cosmetics.includes(b.dataset.trail)) return;
    profile.trail = b.dataset.trail; store.set('cp-profile', profile); renderSeason();
  });
}


function renderMenu() {
  refreshCalendar(true);
  const box = $('levels'); box.innerHTML = '';
  const arenas = recentArenas(); if (level.arena && !arenas.some(c => arenaCode(c) === arenaCode(level.arena))) arenas.unshift(level.arena);
  for (const c of arenas.slice(0, 3)) { // community arenas the player opened, newest first
    const lv = level.arena && arenaCode(level.arena) === arenaCode(c) ? level : arenaLevel(c), b = document.createElement('button'), best = Board.top(boardId(lv))[0];
    b.className = 'lvl arena-card' + (lv === level ? ' on' : ''); b.style.setProperty('--b', c.c1); b.style.setProperty('--a', c.c2);
    const mono = document.createElement('i'); mono.className = 'mk-mono'; mono.textContent = c.t.slice(0, 2);
    const t = document.createElement('b'); t.textContent = `${c.n} · $${c.t}`; const sub = document.createElement('small'); sub.textContent = `arena · ${TFS[c.f].id} · ${ARENA_STORIES[c.s].tale} · ${Math.max(600,c.l)} candles`;
    const b2 = document.createElement('small'); b2.textContent = (best ? `best ${best.score.toLocaleString()} · ` : '') + (c.e ? `campaign ${arenaStatus(c).text} · ` : '') + 'unverified community arena';
    b.append(mono, t, sub, b2); b.onclick = e => { e.stopPropagation(); level = lv; renderMenu(); }; box.append(b);
  }
  LEVELS.forEach((base, i) => {
    const lv = base.sprint ? makeSprintLevel(sprintPick) : base;
    const lock = !levelUnlocked(i), best = Board.top(boardId(lv))[0], b = document.createElement('button');
    b.className = 'lvl' + (lv === level || lv.sprint && level.sprint ? ' on' : '') + (lock ? ' lock' : '');
    const st = lv.endless ? -1 : clamp(((profile.stars || {})[boardId(lv)] || 0) | 0, 0, 3);
    b.innerHTML = `<b>${lv.sym}${st >= 0 && !lock ? ` <span class="stars">${'★'.repeat(st)}<i>${'★'.repeat(3 - st)}</i></span>` : ''}</b><span>${lv.name}</span>${lv.tale ? `<small class="tale">${lv.tale}</small>` : ''}
      <small>${lv.haunt ? '🎃 Haunt the Chain · ghost candles + chasing fog' : lv.endless ? '∞ candles · new chart daily' : lv.cup ? `3 ranked starts / week · unlimited practice` : lv.tutorial ? `${lv.len} candles · guided, with live hints` : lv.len + ' candles · difficulty ' + '▮'.repeat(lv.stars) + '▯'.repeat(4 - lv.stars)}</small>
      <small>${lock ? '🔒 clear ' + (lv.endless || lv.cup ? 'CP01' : LEVELS[i - 1].sym) + ' to unlock' : best ? 'best ' + best.score.toLocaleString() + ' · ' + best.name.replace(/[<&>]/g, '') : 'no runs yet'}</small>`;
    b.onclick = e => { e.stopPropagation(); if (lock) return; level = lv; store.set('cp-level', lv.sym); renderMenu(); };
    box.append(b);
  });
  $('sprintRoutes').hidden = !level.sprint;
  if (level.sprint) {
    $('sprintRouteButtons').innerHTML = SPRINT_ROUTES.map((r, i) => `<button data-route="${i}" aria-pressed="${i === sprintPick}">${r.name}<small>${i === 0 ? 'BALANCED' : i === 1 ? 'AIRTIME' : 'CONNECTIONS'}</small></button>`).join('');
    $('sprintRouteNote').textContent = SPRINT_ROUTES[sprintPick].note;
    $('sprintRouteButtons').querySelectorAll('button').forEach(b => b.onclick = () => { sprintPick = +b.dataset.route; level = makeSprintLevel(sprintPick); store.set('cp-sprint-route', sprintPick); store.set('cp-level', 'SPRINT'); renderMenu(); });
  }
  $('tfRow').innerHTML = TFS.map((f, j) => `<button class="${f === tfOf(level) ? 'on' : ''}" data-tf="${j}" ${level.tutorial || level.cup || level.sprint || level.arena ? 'disabled' : ''}><b>${f.id}</b><small>${f.note}${f.mult !== 1 ? ' · ×' + f.mult : ''}</small></button>`).join('')
    + (level.tutorial || level.cup || level.sprint || level.arena ? `<span class="lbl">this ${level.arena ? 'arena' : 'chart'} is always ${tfOf(level).id}</span>` : '');
  $('tfRow').querySelectorAll('button').forEach(b => b.onclick = e => { e.stopPropagation(); tfPick = +b.dataset.tf; store.set('cp-tf', tfPick); renderMenu(); });
  document.querySelectorAll('.viber').forEach((b, j) => { b.classList.toggle('lock', profile.xp < VIBER_XP[j]); b.dataset.need = `🔒 ${VIBER_XP[j]} XP`; });
  $('xp').textContent = `${profile.xp.toLocaleString()} XP`;
  $('lvlbadge').textContent = `LV ${Math.floor(Math.sqrt(profile.xp / 100)) + 1}`;
  $('pname').value = playerName;
  renderMissions(); renderSeason(); renderOnline(); loadOnlineBoard();
  $('runnerNote').textContent = VIBERS[viberIdx].bio;
  const top = Board.top(boardId(level)).slice(0, 5);
  $('mbTitle').textContent = `Local bests · ${level.sym}` + (level.endless ? ' today' : '');
  $('menuBoard').innerHTML = top.length ? top.map((e, i) => `<li class="${e.name === playerName ? 'you' : ''}"><span>${i + 1}</span><span>${e.name.replace(/[<&>]/g, '')}</span><span>${e.viber.replace(/[<&>]/g, '')}</span><b>${e.score.toLocaleString()}</b></li>`).join('')
    : '<li class="empty">No runs yet — be the first.</li>';
}
function showMenu() {
  Sfx.setPaused(true, true); // the menu is silent
  document.body.classList.remove('results');
  game.state = 'menu'; Sfx.grind(false);
  $('end').classList.add('hidden'); $('start').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  renderMenu();
}

/* DEATH FX — visual only (driven by the death timer, never the sim, so replays are unaffected):
   red flash › the runner bursts into its own coloured blocks › shockwave ring, shake and a camera punch-in. */
const bits = [], bitGeo = new THREE.BoxGeometry(.22, .22, .22), _q = new V3();
const shock = new THREE.Mesh(new THREE.TorusGeometry(1, .06, 6, 40), new THREE.MeshBasicMaterial({ color: 0xff5268, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
shock.rotation.x = Math.PI / 2; shock.visible = false; scene.add(shock);
const deathFx = { t: -1, popped: false };
function runnerTint(on) {
  runner.root.traverse(o => { const m = o.material; if (!m?.emissive) return; m.userData.e0 ??= [m.emissive.getHex(), m.emissiveIntensity]; if (on) { m.emissive.setHex(0xff2a3a); m.emissiveIntensity = .9; } else { m.emissive.setHex(m.userData.e0[0]); m.emissiveIntensity = m.userData.e0[1]; } });
}
function startDeathFx() { if (VERIFY_MODE && !recording) return; deathFx.t = 0; deathFx.popped = false; runnerTint(true); if (!settings.calm) fovKick -= 7; document.body.classList.add('dying'); }
function popRunner() {
  deathFx.popped = true; const p = player.pos, cols = [];
  runner.root.traverse(o => { if (o.isMesh && o.material !== HULL && o.material?.color) cols.push(o.material.color.getHex()); });
  for (let k = 0; k < 30; k++) {
    let d = bits[k]; if (!d) { d = { m: new THREE.Mesh(bitGeo, new THREE.MeshLambertMaterial()), v: new V3(), s: new V3() }; scene.add(d.m); bits.push(d); }
    d.m.material.color.setHex(cols[k % cols.length] ?? 0xffffff); d.m.visible = true; d.m.scale.setScalar(.5 + Math.random());
    d.m.position.set(p.x + (Math.random() - .5) * .7, p.y + .2 + Math.random() * 1.3, p.z + (Math.random() - .5) * .7);
    d.v.set((Math.random() - .5) * 10, 3 + Math.random() * 8, (Math.random() - .5) * 10 + player.vel.z * .3); d.s.set(Math.random() * 14, Math.random() * 14, Math.random() * 14);
  }
  runner.root.visible = false;
  burst(p.x, p.y + .9, p.z, 80, 0xff5268, 10, .9, 6); burst(p.x, p.y + .9, p.z, 34, 0xffffff, 6, .45);
  shock.position.set(p.x, p.y + .9, p.z); shock.scale.setScalar(.3); shock.visible = true; shock.material.opacity = 1;
  shake(.7); hitStop = .07; Sfx.play('thud', .9); Sfx.play('glass', .45, 1.35);
}
/* WIN FX — fireworks (whistle up, burst, crackle) and confetti around the dancing runner; visual + audio only. */
const winFx = { t: -1, next: 0, rockets: [] }, FW_MAIN = [0xdcf513, 0x26a69a, 0xff5268, 0x7c5cff, 0xffb02e, 0x5ad1ff], FW_HAUNT = [0xff7a1a, 0x9b5cff, 0x7dff4a, 0xffb02e, 0xe0d8ff];
function updateWinFx(dt) {
  const on = game.state === 'win' || game.state === 'end' && game.won;
  if (!on || settings.calm) { winFx.rockets.length = 0; return; }
  const p = player.pos, FW = level.haunt ? FW_HAUNT : FW_MAIN; winFx.t += dt; // pumpkin orange, witch purple, slime green in HAUNT
  if ((winFx.next -= dt) <= 0 && winFx.t < 14) {
    winFx.next = .35 + Math.random() * .5;
    winFx.rockets.push({ x: p.x + (Math.random() - .5) * 16, y: p.y, z: p.z - 4 - Math.random() * 12, vy: 15 + Math.random() * 5, fuse: .55 + Math.random() * .3, c: FW[Math.floor(Math.random() * FW.length)] });
    Sfx.play('fw_launch', .3);
  }
  for (let k = winFx.rockets.length - 1; k >= 0; k--) {
    const r = winFx.rockets[k]; r.y += r.vy * dt; r.vy -= 9 * dt; emit(r.x, r.y, r.z, (Math.random() - .5), -2, (Math.random() - .5), 0xffe7a0, .35, 0);
    if ((r.fuse -= dt) <= 0) {
      burst(r.x, r.y, r.z, 110, r.c, 11, 1.5, 4); burst(r.x, r.y, r.z, 40, 0xffffff, 6, .7, 2);
      Sfx.play('fw_boom', .45); Sfx.play('fw_crackle', .3, 1, .25); winFx.rockets.splice(k, 1);
    }
  }
  for (let k = 0; k < 2; k++) if (Math.random() < .6) emit(p.x + (Math.random() - .5) * 8, p.y + 6 + Math.random() * 3, p.z + (Math.random() - .5) * 8, (Math.random() - .5) * 1.5, -1.5 - Math.random(), (Math.random() - .5) * 1.5, FW[Math.floor(Math.random() * FW.length)], 3, .4); // confetti
}
function updateDeathFx(dt) {
  updateWinFx(dt);
  if (deathFx.t >= 0 && (deathFx.t += dt) > .3 && !deathFx.popped) popRunner();
  if (shock.visible) { shock.scale.multiplyScalar(1 + dt * 9); if ((shock.material.opacity -= dt * 2.4) <= 0) shock.visible = false; }
  for (const d of bits) if (d.m.visible) {
    d.v.y -= 22 * dt; d.m.position.addScaledVector(d.v, dt); _q.copy(d.s).multiplyScalar(dt); d.m.rotation.x += _q.x; d.m.rotation.y += _q.y; d.m.rotation.z += _q.z;
    if (d.m.position.y < player.pos.y - 40) d.m.visible = false;
  }
}
function clearDeathFx() { if (deathFx.t < 0 && runner.root.visible) return; deathFx.t = -1; runner.root.visible = true; runnerTint(false); for (const d of bits) d.m.visible = false; shock.visible = false; document.body.classList.remove('dying'); }
function resetPlayer() {
  const p = player; game.fogZ = null; clearDeathFx();
  p.styleIntent = false;
  p.pos.copy(spawn); p.vel.set(0, 0, 0); p.state = 'air'; p.onGround = false; p.lastGroundY = spawn.y;
  Object.assign(p, { coyote: 0, jumpsUsed: 0, canCut: false, airTime: 0, slideT: 0, dashUsed: false, boostT: 0, padCd: 0,
    wallrun: false, wallT: 0, wallContact: 0, wallCd: 0, railCd: 0, poleCd: 0, hangCd: 0, ballisticT: 0, stunT: 0, comboGround: 0, squash: 0, heading: Math.PI });
  trailPts.forEach(v => v.copy(p.pos).add(_v.set(0, 1.1, 0)));
  runner.flip.rotation.set(0, 0, 0); runner.flipT = -1; runner.flipStart = -1; runner.airFlip = false; runner.flipGround = false;
}
function refreshCalendar(charts = false) {
  const day = utcDay(), week = weekId();
  if (today !== day) { today = day; missions = dailyMissions(); profile.missions = { day, prog: {}, done: [] }; }
  if (season.id !== week) season = profile.season = { id: week, sp: 0, day, daySp: 0 };
  if (season.day !== day) { season.day = day; season.daySp = 0; }
  if (charts) {
    const daily = LEVELS.find(l => l.endless), cup = LEVELS.find(l => l.cup);
    daily.seed = +day.replace(/-/g, ''); cup.period = week; cup.seed = +week.replace(/\D/g, '') * 13;
  }
  store.set('cp-profile', profile);
}
function restart(countdown = true, replay = false) {
  if (Sfx.paused) Sfx.setPaused(false, true);
  if (!replay) refreshCalendar(true);
  if (level.cup && !replay) { // practice limit; the shared service enforces ranked attempts independently
    // Unlimited practice; ranked starts are limited by the server.
    profile.cup = { week: weekId(), used: cupUsed() + 1 }; store.set('cp-profile', profile);
  }
  Sfx.init();
  resetCourse(); chartIdx = 0; chartView = 0;
  for (const d of debris) { d.life = 0; d.m.visible = false; }
  clearParticles(); Sfx.grind(false);
  Object.assign(score, { dist: 0, style: 0, pending: 0, combo: 0, time: 0, deaths: 0 }); game.checkpoint = null; game.tricks = new Map(); game.sectionFalls = new Map();
  game.runSkills = { flips:0, precise:0, bestBanked:0 };
  actionCue.until = 0;
  clearTimeout(tipTimer); $('tip').classList.add('hidden');
  resetPlayer(); clearInput(); yaw = 0; trauma = 0; hitStop = 0; jumpBuf = slideBuf = acc = 0;
  camBase.set(0, 0, 0); chartHi = chartLo; // snap camera + mini-chart scale on respawn instead of easing across the map
  ghostRec = []; ghostTimes = []; ghostI = 0; buildGhost(); splitI = 0; setFlow(false);
  if (countdown) tip('move-v3', settings.autoRun ? 'Auto-run ON · steer left / right · JUMP to clear the gaps' : isTouch ? 'Joystick to run · JUMP to jump' : '<kbd>W</kbd> run · <kbd>A</kbd><kbd>D</kbd> steer · <kbd>Space</kbd> jump');
  runLog = { v: RULES_VERSION, board: boardId(level), course: courseConfig(), steps: 0, rle: [] }; simYaw = yaw;
  game.won = false; game.seg = -1; document.body.classList.remove('results');
  game.state = countdown ? 'count' : 'play'; game.countT = 1.2; game.countN = 0; // 3·2·1 then GO
  $('start').classList.add('hidden'); $('end').classList.add('hidden'); $('deathcard').classList.add('hidden');
}
// Death: the runner keeps falling and tumbling while the camera holds still, the picture drains of colour
// for a beat, then you respawn at the last checkpoint (+3 s) — or the run ends in DAILY.
function die(retry = false, cause = '') {
  if (game.state !== 'play') return;
  if (!retry) { const size = level.tutorial ? 8 : level.sprint ? 20 : 25, section = Math.floor(chartIdx / size); game.sectionFalls.set(section, (game.sectionFalls.get(section) || 0) + 1); }
  setFlow(false); score.deaths++; score.pending = 0; score.combo = 0;
  game.state = 'dead'; game.deadT = game.deadDur = oneLife() ? 1.6 : .5; startDeathFx(); // long enough to watch the burst
  Sfx.grind(false); Sfx.setPaused(true, true); Sfx.death(); shake(.35); buzz([40, 40, 80]); // the music drops out under the death
  const cp = !oneLife() && game.checkpoint;
  $('deathcard').innerHTML = `<b>${retry ? 'CHECKPOINT RETRY' : 'LIQUIDATED'}</b><span>${level.cup ? `Cup attempt over at candle ${Math.floor(chartIdx)}` : oneLife() ? `GAME OVER · candle ${Math.floor(chartIdx)}` : cp ? `Back to checkpoint ${cp.check.n} · +3 s` : 'Back to the start'}</span>`;
  $('deathcard').classList.remove('hidden');
  if (cause.startsWith('Laser')) Sfx.play('zap', .8); else if (cause.startsWith('Mine')) Sfx.play('thud', 1);
  if (cause) { $('deathcard').querySelector('b').textContent = level.haunt && cause.startsWith('The liquidation fog') ? 'HAUNTED' : 'TRAP HIT'; $('deathcard').querySelector('span').textContent = `${cause} · ${oneLife() ? 'Run over' : cp ? 'Checkpoint retry +3s' : 'Back to the start'}`; }
}
function unbreak(q) {
  Object.assign(q, { broken: false, crackT: -1 }); q.group.visible = true; q.col.active = true;
  if (q.pole) q.pole.active = true; q.mesh.position.set(0, 0, 0); if (!q.green) { q.mat.emissiveIntensity = RED_GLOW; q.mat.opacity = 1; q.ghost = false; }
}
// Death before the first checkpoint: reset in place instead of rebuilding 70 candles (that rebuild was a visible hitch).
function quickRestart() {
  Sfx.setPaused(false, true);
  for (const q of platforms.values()) if (q.broken || q.crackT >= 0) unbreak(q);
  for (const o of orbs) { o.taken = false; o.mesh.visible = true; }
  Object.assign(score, { dist: 0, style: 0, pending: 0, combo: 0 }); score.time += 3;
  game.tricks.clear();
  resetPlayer(); chartIdx = 0; camBase.set(0, 0, 0); trauma = 0; ghostRec = []; ghostTimes = []; ghostI = 0; splitI = 0; game.state = 'play';
}
function respawn(cp) {
  Sfx.setPaused(false, true);
  const p = player;
  for (const q of platforms.values()) if (q.i > cp.i && (q.broken || q.crackT >= 0)) unbreak(q); // the course ahead is whole again
  resetPlayer(); p.pos.set(cp.x, cp.top + .02, cp.zc); p.lastGroundY = cp.top;
  trailPts.forEach(v => v.copy(p.pos).add(_v.set(0, 1.1, 0)));
  score.time += 3; camBase.set(0, 0, 0); trauma = 0; game.state = 'play';
}
// A short victory beat; the celebration continues beside the results.
function finish() {
  if (game.state !== 'play') return;
  game.state = 'win'; game.won = true; game.winT = 3.6; winFx.t = 0; winFx.next = .2; game.winT0 = performance.now() / 1000;
  player.vel.set(0, 0, 0); setFlow(false); Sfx.win(); popup('CHART CLEARED', '#dcf513', true); buzz(40);
}
// End of a run: finite charts end when cleared (deaths just respawn), endless ends on death.
function endRun(cleared) {
  game.state = 'end'; Sfx.grind(false); if (cleared) Sfx.bank(); else Sfx.gameover();
  const candlesRun = cleared ? level.len : Math.floor(chartIdx);
  const { tf, par, timeBonus, clean, dist, total, deathCut } = runResult(cleared), t = fmtTime(score.time);
  const parts = $('scoreParts'); parts.replaceChildren();
  for (const [label, value] of [['Distance · 2 pts/m', dist.toLocaleString()], ['Banked moves & pickups', score.style.toLocaleString()], ['Time bonus', timeBonus.toLocaleString()], ['Clean finish', clean.toLocaleString()], ['Timeframe', `×${tf.mult}`], ['Death penalty', `${deathCut ? '−' : ''}${Math.round(deathCut * 100)}%`], ['Final score', total.toLocaleString()]]) {
    const term = document.createElement('dt'), amount = document.createElement('dd'); term.textContent = label; amount.textContent = value; parts.append(term, amount);
  }
  $('scoreMath').open = false;
  game.lastRun = { log: runLog, total, cleared, board: boardId(level), ticket: rankedTicket?.id || null }; rankedTicket = null;
  $('submitRanked').classList.toggle('hidden', !game.lastRun.ticket); $('submitRanked').disabled = false; $('submitRanked').textContent = 'Submit ranked run'; $('recordOnchain').classList.add('hidden'); // what a shared board will submit for server-side replay
  // STARS (finite charts): ★ clear · ★★ clear under par · ★★★ under par with no deaths — best kept per chart and timeframe
  const stars = cleared && !level.endless ? 1 + (score.time <= par) + (score.time <= par && !score.deaths) : 0;
  const starsKey = boardId(level), starsBefore = (profile.stars ||= {})[starsKey] || 0;
  if (stars > starsBefore) profile.stars[starsKey] = stars;
  const boost = holderBoost(), xp = Math.round(Math.min(total / 40, candlesRun * 4 + (cleared ? 80 : 0)) * (1 + boost)), before = profile.xp, newChart = cleared && !level.arena && !profile.cleared.includes(level.sym);
  const nextLv = nextLevel(level), unlocksNext = newChart && nextLv && !levelUnlocked(nextLv);
  profile.xp += xp; if (newChart) profile.cleared.push(level.sym);
  store.set('cp-profile', profile);
  const previousEntry = Board.top(boardId(level))[0], previousBest = previousEntry?.score || 0;
  const id = boardId(level), entry = { name: playerName, score: total, candles: candlesRun, viber: VIBERS[viberIdx].name, time: +score.time.toFixed(3), deaths: score.deaths, cleared, stars, date: Date.now() };
  const rank = Board.submit(id, entry);
  const comparison = compareRuns(entry, previousEntry), comparisonBox = $('comparisonValues');
  $('runComparison').hidden = !comparison; comparisonBox.replaceChildren();
  if (comparison) for (const [label, delta, lower, suffix] of [['Score', comparison.score, false, ''], ['Time', comparison.time, true, 's'], ['Deaths', comparison.deaths, true, '']]) {
    const chip = document.createElement('span'), value = delta === null ? '—' : `${delta > 0 ? '+' : ''}${label === 'Time' ? delta.toFixed(2) : delta.toLocaleString()}${suffix}`;
    chip.textContent = `${label} ${value}`; chip.className = delta === null || delta === 0 ? '' : (lower ? delta < 0 : delta > 0) ? 'better' : 'worse'; comparisonBox.append(chip);
  }
  const weakest = [...game.sectionFalls.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  $('runInsight').hidden = !weakest;
  if (weakest) { const size = level.tutorial ? 8 : level.sprint ? 20 : 25; $('runInsight').textContent = `Practice focus: candles ${weakest[0] * size + 1}–${Math.min(level.len, (weakest[0] + 1) * size)} · ${weakest[1]} fall${weakest[1] > 1 ? 's' : ''}. ${weakest[0] === 0 || oneLife() ? 'Use Run again to practice your line.' : 'On your next run, use Retry checkpoint from Pause while working on this section.'}`; }
  const skills = game.runSkills, skillValues = $('skillValues'); skillValues.replaceChildren();
  for (const [label, value] of [['Best banked link', skills.bestBanked], ['Clean flips', skills.flips], ['Perfect landings', skills.precise]]) {
    const chip = document.createElement('span'); chip.textContent = `${label} · ${value}`; skillValues.append(chip);
  }
  $('skillTip').textContent = !skills.flips ? 'Try a second jump on a wide gap. Leave enough airtime to finish the flip.' : !skills.precise ? 'Aim your landing toward the middle of the candle. Use the landing ring to adjust.' : skills.bestBanked < 10 ? 'For Flow, link 10 moves before banking. A safe landing protects the style you earned.' : 'Flow line banked. Try the same route with fewer inputs and a cleaner time.';

  if (cleared) missionEvent('CLEAR'); if (level.endless) missionEvent('DAILY', candlesRun);
  if (!ghostData || total > ghostData.score) store.set(ghostKey(), { score: total, viber: viberIdx, f: ghostRec, t: ghostTimes }); // new personal best → new ghost

  $('endTitle').textContent = (cleared ? `${level.sym} · CHART CLEARED` : `GAME OVER · ${level.sym} · CANDLE ${candlesRun}`) + (level.cup ? ` · ${game.lastRun.ticket ? 'RANKED' : 'PRACTICE'}` : '');
  $('endTitle').classList.toggle('bad', !cleared);
  $('stTime').textContent = t; $('stCandles').textContent = candlesRun; $('stStyle').textContent = score.style.toLocaleString(); $('stBonus').textContent = (timeBonus + clean).toLocaleString();
  countUp($('finalScore'), total);
  $('finalBest').innerHTML = rank === 0 ? '<span class="newbest">NEW #1 ON THIS CHART!</span>' : rank > 0 ? `RANK #${rank + 1}` : 'NOT IN THE TOP 10';
  if (score.deaths) $('finalBest').innerHTML += ` · ${score.deaths} death${score.deaths > 1 ? 's' : ''} (−${Math.round(deathCut * 100)}%)`;
  if (tf.mult !== 1) $('finalBest').innerHTML += ` · ${tf.id} ×${tf.mult}`;
  if (level.arena?.e) $('finalBest').innerHTML += ` · campaign ${arenaStatus(level.arena).open ? arenaStatus(level.arena).text : 'ended — practice run'}`;
  if (!level.endless) $('finalBest').innerHTML = `<span class="stars">${'★'.repeat(stars)}<i>${'★'.repeat(3 - stars)}</i></span>${stars > starsBefore && stars ? ' <b>NEW BEST STARS</b>' : ''}<br>`
    + `<small class="goals">★ clear · ★★ under ${fmtTime(par).slice(0, -3)} · ★★★ under ${fmtTime(par).slice(0, -3)}, no deaths</small><br>` + $('finalBest').innerHTML;
  const unlockedViber = VIBER_XP.findIndex(v => before < v && profile.xp >= v), sp = addSP(Math.round(total / 100));
  $('xpGain').innerHTML = `+${xp.toLocaleString()} XP · ${profile.xp.toLocaleString()} total` + (boost ? ` · <b>+${Math.round(boost * 100)}% holder boost</b>` : '')
    + (unlocksNext ? ' · <b>NEW CHART UNLOCKED</b>' : '')
    + (unlockedViber > 0 ? ` · <b>${VIBERS[unlockedViber].name.toUpperCase()} UNLOCKED</b>` : '')
    + `<br>+${sp.gained.toLocaleString()} SP${sp.capped ? ' (daily cap reached)' : ''} · ${tierOf(season.sp).name} ${season.sp.toLocaleString()} SP`
    + (sp.promoted ? ` · <b>PROMOTED TO ${sp.promoted.name.toUpperCase()}</b>` : '');
  $('nextGoal').textContent = nextRunGoal({ cleared, candles: candlesRun, length: level.len, deaths: score.deaths, time: score.time, par, total, best: previousBest, sprint: !!level.sprint, tutorial: !!level.tutorial });
  $('nextRoute').classList.toggle('hidden', !cleared || !level.sprint);
  $('nextRoute').textContent = level.sprint ? `Try ${SPRINT_ROUTES[((level.route || 0) + 1) % SPRINT_ROUTES.length].name} →` : 'Next Sprint route';
  $('boardTitle').textContent = `LOCAL BESTS · ${level.sym}` + (level.endless ? ' · TODAY' : '');
  $('board').innerHTML = Board.top(id).map((e, i) => `<li class="${i === rank ? 'me' : ''}"><span>${e.name.replace(/[<&>]/g, '')}</span><span>${e.viber.replace(/[<&>]/g, '')}</span><b>${e.score.toLocaleString()}</b></li>`).join('');
  $('cardImg').src = makeShareCard({ arena: level.arena, sym: level.sym, cleared, time: t, score: total, candles: candlesRun, tier: tierOf(season.sp).name });
  $('share').textContent = `I ${cleared ? 'cleared' : 'reached ' + candlesRun + ' candles on'} ${level.sym} ${tf.id}${stars ? ' ' + '★'.repeat(stars) : ''} in ${t}.\n${total.toLocaleString()} pts in Wick Runner. Can you beat my line?\n#WickRunner #Parkour` + (level.arena ? ' ' + arenaLink(level.arena) : '');
  $('next').textContent = nextLv ? `Play ${nextLv.sym} →` : 'Next chart';
  $('next').classList.toggle('hidden', !cleared || !nextLv || !levelUnlocked(nextLv));
  $('end').classList.remove('hidden'); $('end').classList.toggle('over', !cleared); document.body.classList.add('results'); document.body.classList.remove('dying');
  if (document.pointerLockElement) document.exitPointerLock();
}
function countUp(el, n) { // score ticks up with an ease-out; a timer guarantees the final value even if frames stop
  const t0 = performance.now();
  const f = () => { const k = Math.min(1, (performance.now() - t0) / 900); el.textContent = Math.round(n * (1 - Math.pow(1 - k, 3))).toLocaleString(); if (k < 1) requestAnimationFrame(f); };
  f(); setTimeout(() => el.textContent = n.toLocaleString(), 950);
}
const fmtTime = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;

$('go').addEventListener('click', beginRun);
try { localStorage.removeItem('cp-mute'); } catch (e) {} // M mutes for this visit only; a remembered mute silently hid the music on later visits
$('again').addEventListener('click', beginRun);
$('menu').addEventListener('click', showMenu);
$('nextRoute').addEventListener('click', () => { sprintPick = ((level.route || 0) + 1) % SPRINT_ROUTES.length; level = makeSprintLevel(sprintPick); store.set('cp-sprint-route', sprintPick); store.set('cp-level', 'SPRINT'); renderMenu(); beginRun(); });
$('next').addEventListener('click', () => { const next = nextLevel(level); if (!next) return; level = next; store.set('cp-level', level.sym); renderMenu(); beginRun(); });
$('copy').addEventListener('click', e => {
  e.stopPropagation();
  navigator.clipboard?.writeText($('share').textContent).then(() => { $('copy').textContent = 'Copied ✓'; setTimeout(() => $('copy').textContent = 'Copy text', 1200); });
});
$('pname').addEventListener('input', e => { playerName = e.target.value.trim().slice(0, 16) || playerName; store.set('cp-name', playerName); });
$('pname').addEventListener('keydown', e => e.stopPropagation()); // typing a name must not move the runner

/* SHARE CARD — a 1200×630 image of the run (score, chart, character) to post on X; drawn locally, nothing is uploaded. */
function makeShareCard(info) {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 630; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1200, 630); g.addColorStop(0, '#0d1017'); g.addColorStop(1, '#161c28'); x.fillStyle = g; x.fillRect(0, 0, 1200, 630);
  x.strokeStyle = 'rgba(255,255,255,.05)'; for (let y = 60; y < 630; y += 60) { x.beginPath(); x.moveTo(0, y); x.lineTo(1200, y); x.stroke(); }
  // the chart you ran, as small candles along the bottom
  const ks = [...candles.entries()].filter(([i]) => i < Math.max(10, info.candles + 1)).slice(-60).map(([, k]) => k), lo = Math.min(...ks.map(k => k.l)), hi = Math.max(...ks.map(k => k.h));
  const py = v => 590 - (v - lo) / Math.max(hi - lo, 1) * 170, cw = 1120 / ks.length;
  ks.forEach((k, i) => { const up = k.c >= k.o, cx = 40 + i * cw + cw / 2; x.strokeStyle = x.fillStyle = up ? PAL.upCss : PAL.dnCss; x.globalAlpha = .55;
    x.beginPath(); x.moveTo(cx, py(k.h)); x.lineTo(cx, py(k.l)); x.stroke(); const t = py(Math.max(k.o, k.c)); x.fillRect(cx - cw * .3, t, cw * .6, Math.max(2, py(Math.min(k.o, k.c)) - t)); });
  x.globalAlpha = 1;
  const ar = info.arena, acc = ar ? ar.c2 : '#dcf513';
  if (ar) { const glow = x.createRadialGradient(1000, 0, 0, 1000, 0, 700); glow.addColorStop(0, ar.c1 + '66'); glow.addColorStop(1, ar.c1 + '00'); x.fillStyle = glow; x.fillRect(0, 0, 1200, 630); }
  x.fillStyle = acc; x.beginPath(); x.roundRect(60, 56, 44, 44, 12); x.fill();
  if (ar) { x.fillStyle = '#0b0d14'; x.font = '800 16px "JetBrains Mono", monospace'; x.textAlign = 'center'; x.fillText(ar.t.slice(0, 2), 82, 84); x.textAlign = 'left'; }
  x.fillStyle = '#eceae3'; x.font = '700 30px "Space Grotesk", sans-serif'; x.fillText(ar ? `${ar.n} arena` : 'Wick Runner', 120, 88);
  x.fillStyle = '#8b91a1'; x.font = '500 22px "JetBrains Mono", monospace'; x.fillText(`${info.sym} · ${info.cleared ? 'CHART CLEARED' : 'RUN OVER'} · ${info.time}`, 60, 170);
  x.fillStyle = '#eceae3'; x.font = '700 132px "JetBrains Mono", monospace'; x.fillText(info.score.toLocaleString(), 52, 300);
  x.fillStyle = acc; x.font = '600 26px "Space Grotesk", sans-serif'; x.fillText(ar ? `${info.candles} candles · Wick Runner · community arena` : `${info.candles} candles · ${info.tier} tier`, 60, 350);
  x.fillStyle = '#5d6475'; x.font = '500 16px "JetBrains Mono", monospace'; x.fillText('simulated chart · launching on vibe/vibe (testnet) · not financial advice', 60, 616);
  const img = document.querySelectorAll('.viber img')[viberIdx];
  if (img?.complete) { x.save(); x.beginPath(); x.roundRect(820, 60, 320, 320, 28); x.clip(); x.fillStyle = VIBERS[viberIdx].bg; x.fillRect(820, 60, 320, 320); x.drawImage(img, 820, 60, 320, 320); x.restore(); }
  return c.toDataURL('image/png');
}
$('saveCard').addEventListener('click', e => { e.stopPropagation(); const a = document.createElement('a'); a.href = $('cardImg').src; a.download = 'wick-runner-run.png'; a.click(); });
$('shareX').addEventListener('click', e => { e.stopPropagation(); open('https://x.com/intent/post?text=' + encodeURIComponent($('share').textContent), '_blank', 'noopener'); });


/* SETTINGS — quality presets, volumes, mouse sensitivity, FPS counter. Saved per browser. */
let autoQ = isTouch ? 'low' : 'medium', appliedGraphics = ''; // Start responsive; high quality remains an explicit option.
const settings = Object.assign({ autoRun: true, mouseLook: false, ghost: true, quality: 'auto', music: .6, sfx: .8, sens: 1, fps: false, cb: false, haptics: true, calm: matchMedia('(prefers-reduced-motion: reduce)').matches }, store.get('cp-settings', {}));
function applySettings() {
  const q = settings.quality === 'auto' ? autoQ : settings.quality, pr = q === 'high' ? Math.min(devicePixelRatio, 2) : q === 'medium' ? Math.min(devicePixelRatio, 1.25) : 1;
  const graphics = `${q}:${pr}:${innerWidth}:${innerHeight}`;
  if (graphics !== appliedGraphics) {
    appliedGraphics = graphics;
    renderer.setPixelRatio(pr); composer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
    smaa.setSize(innerWidth * pr, innerHeight * pr);
    sun.castShadow = q !== 'low'; sun.shadow.mapSize.setScalar(q === 'high' ? 2048 : 1024); sun.shadow.map?.dispose(); sun.shadow.map = null;
    smaa.enabled = q !== 'low'; lens.enabled = q !== 'low'; bloom.enabled = q !== 'low';
  }
  Sfx.setVolumes(settings.music, settings.sfx);
  $('fps').classList.toggle('hidden', !settings.fps);
  document.querySelectorAll('[data-q]').forEach(b => b.classList.toggle('on', b.dataset.q === settings.quality));
  $('setMusic').value = settings.music; $('setSfx').value = settings.sfx; $('setSens').value = settings.sens; $('setFps').checked = settings.fps;
  $('setAutoRun').checked = settings.autoRun; $('setMouseLook').checked = settings.mouseLook;
  $('autoRunToggle').textContent = `Auto-run ${settings.autoRun ? 'ON' : 'OFF'}`;
  $('autoRunToggle').setAttribute('aria-pressed', String(settings.autoRun));
  if (!settings.mouseLook) { if (document.pointerLockElement) document.exitPointerLock(); yaw = 0; pitch = .1; }
  $('setGhost').checked = settings.ghost; $('pGhost').textContent = `Best-run ghost: ${settings.ghost ? 'on' : 'off'}`;
  $('setCb').checked = settings.cb; $('setCalm').checked = settings.calm; $('setHaptics').checked = settings.haptics; $('hapticsRow').classList.toggle('hidden', !isTouch);
  applyPalette(settings.cb);
  store.set('cp-settings', settings);
  if (game.state === 'pause') composer.render();
}
let settingsFrom = 'menu';
function openSettings(from) { settingsFrom = from; $('settings').classList.remove('hidden'); }
function closeSettings() { $('settings').classList.add('hidden'); }
// One keyboard/focus policy for all blocking dialogs, including fields inside the arena form.
const modalIds = ['pause', 'settings', 'arenaMaker', 'terms'], previousFocus = new Map();
const topModal = () => modalIds.map($).filter(el => !el.classList.contains('hidden')).at(-1);
function dismissModal(el) {
  if (el.id === 'pause') resume(); else el.classList.add('hidden');
}
for (const id of modalIds) {
  const el = $(id); el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', ({ pause: 'Game paused', settings: 'Game settings', arenaMaker: 'Community arena', terms: 'Terms and privacy' })[id]);
  new MutationObserver(() => {
    if (!el.classList.contains('hidden')) { previousFocus.set(id, document.activeElement); el.querySelector('button:not(:disabled),input,a[href]')?.focus({ preventScroll: true }); }
    else { const target = previousFocus.get(id); if (target?.isConnected) target.focus({ preventScroll: true }); previousFocus.delete(id); }
  }).observe(el, { attributes: true, attributeFilter: ['class'] });
}
document.addEventListener('keydown', e => {
  const modal = topModal(); if (!modal) return;
  if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); dismissModal(modal); return; }
  if (e.code !== 'Tab') return;
  const focusable = [...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href],summary,[tabindex="0"]')].filter(el => el.getClientRects().length);
  const first = focusable[0], last = focusable.at(-1);
  if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
}, true);
document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => { settings.quality = b.dataset.q; applySettings(); }));
$('setMusic').addEventListener('input', e => { settings.music = +e.target.value; applySettings(); });
$('setSfx').addEventListener('input', e => { settings.sfx = +e.target.value; applySettings(); Sfx.collect(); });
$('setSens').addEventListener('input', e => { settings.sens = +e.target.value; applySettings(); });
$('setAutoRun').addEventListener('change', e => { settings.autoRun = e.target.checked; applySettings(); });
$('setMouseLook').addEventListener('change', e => { settings.mouseLook = e.target.checked; applySettings(); });
$('autoRunToggle').addEventListener('click', toggleAutoRun);
function toggleAutoRun() { settings.autoRun = !settings.autoRun; applySettings(); popup(`AUTO-RUN ${settings.autoRun ? 'ON' : 'OFF'}`, '#d9f66f'); }
$('setFps').addEventListener('change', e => { settings.fps = e.target.checked; applySettings(); });
$('setCb').addEventListener('change', e => { settings.cb = e.target.checked; applySettings(); });
$('setGhost').addEventListener('change', e => { settings.ghost = e.target.checked; applySettings(); });
$('pGhost').addEventListener('click', toggleGhost);
function toggleGhost() { settings.ghost = !settings.ghost; applySettings(); popup(`GHOST ${settings.ghost ? 'ON' : 'OFF'}`, '#d1d4dc'); }
$('setCalm').addEventListener('change', e => { settings.calm = e.target.checked; applySettings(); });
$('setHaptics').addEventListener('change', e => { settings.haptics = e.target.checked; applySettings(); buzz(20); });
$('setClose').addEventListener('click', closeSettings);
$('gear').addEventListener('click', () => openSettings('menu'));

/* TOKEN — read-only on-chain link (Builder Foundry Playbook 05: "your token in the product").
   One config block, so testnet → mainnet is a one-line change. The game only READS the public
   wallet address, token decimals and balance: it never asks for a signature, approval or transaction. */
const CHAIN = { id: 46630, name: 'Robinhood Chain Testnet', rpc: 'https://rpc.testnet.chain.robinhood.com', explorer: 'https://explorer.testnet.chain.robinhood.com' };
// TOKEN CONFIG — the ONLY place official links live. Fill these from our own vibe/vibe token page after launch;
// the site shows the buy button and contract address only when both pass the checks in tokenLinks().
const TOKEN = {
  symbol: 'WRUN',
  address: '0x5d075DF76bDfC91f005Ca8b45FaeE38D5a4eCa8F', // $WRUN on Robinhood Chain testnet (1B supply, 18 decimals)
  page: 'https://testnet.vibevibe.fun/token/0x5d075DF76bDfC91f005Ca8b45FaeE38D5a4eCa8F',      // 'https://testnet.vibevibe.fun/…' our token page (the bonding curve, and the pool link after graduation)
  graduated: false, // flip to true after graduation (trading then runs on the Uniswap v4 pool, still reached from the token page)
  // HOLDER BOOST — on cosmetic XP only (progression), never on leaderboard scores: boards stay pure skill.
  // ponytail: fresh balance only for cosmetic XP; sustained-ownership perks require snapshots.
  boostTiers: [[1e6, .3], [1e5, .2], [1e4, .1]] // [minimum tokens held, boost]
};
let heldTokens = 0;
const holderBoost = () => { if (Date.now() - balanceReadAt > 60000) return 0; for (const [min, b] of TOKEN.boostTiers) if (heldTokens >= min) return b; return 0; };
// Never show a buy link that isn't a well-formed address on a vibe/vibe page: a typo or tampered config must fail closed.
const tokenLinks = () => {
  const okAddr = /^0x[0-9a-fA-F]{40}$/.test(TOKEN.address || '');
  let okPage = false; try { const u = new URL(TOKEN.page); okPage = u.protocol === 'https:' && /(^|\.)vibevibe\.fun$/.test(u.hostname); } catch (e) {}
  return okAddr && okPage ? { address: TOKEN.address, page: TOKEN.page } : null;
};
function renderToken() {
  const L = tokenLinks();
  $('tkStatus').textContent = !L ? 'Not launched' : TOKEN.graduated ? 'Graduated · Uniswap v4' : 'Live · bonding curve';
  $('tkStatus').classList.toggle('live', !!L);
  $('tkAddrRow').hidden = $('tkBuy').hidden = !L;
  if (!L) return;
  $('tkLead').textContent = '$WRUN is the Wick Runner token. This is the only official contract and buy link. Check the address matches before you buy.';
  $('tkAddr').textContent = L.address; $('tkExplorer').href = `${CHAIN.explorer}/token/${L.address}`; $('tkBuy').href = L.page;
}
$('tkCopy').addEventListener('click', () => { const L = tokenLinks(); if (L) navigator.clipboard?.writeText(L.address).then(() => { $('tkCopy').textContent = 'Copied ✓'; setTimeout(() => $('tkCopy').textContent = 'Copy', 1200); }); });
renderToken();

/* ARENAS — a community's own branded chart and leaderboard, shared as one link (#arena=<code>).
   The link carries the whole setup, so it is UNTRUSTED input: every field is re-validated by sanitizeArena()
   and only ever rendered with textContent. Arenas are always labelled "unverified community arena". */
const ARENA_STORIES = {
  launch: { label: 'Launch', tale: 'launch › range › breakout', story: [[.3, .5, .7], [.62, 0, .8], [1, .55, .9]] },
  pump: { label: 'Pump & dump', tale: 'pump › blow-off › dump › bounce', story: [[.4, .6, 1], [.5, .9, 1.3], [.8, -.65, 1.2], [1, .3, 1]] },
  squeeze: { label: 'Squeeze', tale: 'chop › squeeze › parabola', story: [[.5, 0, 1.2], [.7, 0, .5], [1, .75, 1.2]] },
  bear: { label: 'Bear market', tale: 'bear trend › relief rally › capitulation', story: [[.35, -.45, 1], [.55, .6, 1.2], [1, -.5, 1.3]] },
  wild: { label: 'Wild', tale: 'pure volatility', story: null },
};
const ARENA_LENS = [600, 900, 1200];
const hexOk = c => /^#[0-9a-f]{6}$/i.test(c || '');
const cleanText = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
function sanitizeArena(c) {
  c = c && typeof c === 'object' ? c : {};
  const end = Number(c.e), f = Number(c.f);
  return { n: cleanText(c.n, 24) || 'Community', t: String(c.t ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'ARENA',
    c1: hexOk(c.c1) ? c.c1.toLowerCase() : '#7c5cff', c2: hexOk(c.c2) ? c.c2.toLowerCase() : '#dcf513',
    s: Object.hasOwn(ARENA_STORIES, c.s) ? c.s : 'launch', f: Number.isInteger(f) ? clamp(f, 0, TFS.length - 1) : 1, l: [...ARENA_LENS,60,110,170].includes(+c.l) ? +c.l : 900,
    e: end > 1.7e12 && end < 4.1e12 ? Math.round(end) : 0, x: /^[A-Za-z0-9_]{1,15}$/.test(c.x || '') ? c.x : '', m: cleanText(c.m, 160),
    r: cleanText(c.r, 300), k: /^0x[0-9a-fA-F]{40}$/.test(c.k || '') ? c.k.toLowerCase() : '',
    tg: /^[A-Za-z0-9_]{5,32}$/.test(c.tg || '') ? c.tg : '', dc: /^[A-Za-z0-9-]{2,32}$/.test(c.dc || '') ? c.dc : '', w: safeHttps(c.w),
    cr: /^0x[0-9a-fA-F]{40}$/.test(c.cr || '') ? c.cr.toLowerCase() : '', sg: /^0x[0-9a-fA-F]{130}$/.test(c.sg || '') ? c.sg : '' };
}
function safeHttps(u) { try { const x = new URL(u); return x.protocol === 'https:' && u.length <= 100 ? x.href : ''; } catch (e) { return ''; } }
const arenaCode = encodeArena;
function parseArena(code) { try { return sanitizeArena(decodeArena(code)); } catch (e) { return null; } }
const arenaLink = c => `${location.origin}${location.pathname}#arena=${arenaCode(c)}`;
const fnv = str => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
// Campaign status from the optional end date: "3d 4h left", "ends in 5h", or ended (still playable as practice).
function arenaStatus(c) {
  if (!c.e) return { open: true, text: 'open' };
  const ms = c.e - Date.now(); if (ms <= 0) return { open: false, text: 'ended' };
  const h = Math.floor(ms / 36e5); return { open: true, text: h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h left` : h ? `${h}h left` : `${Math.ceil(ms / 6e4)}m left` };
}
const mixHex = (a, b, k) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
// An arena becomes a level like any other: its own seed (from its setup), story, timeframe, sky tinted by the brand colors (a quiet tint, not a neon wash).
function arenaLevel(c) {
  const id = arenaIdentity(c), courseSeed = fnv(JSON.stringify([c.n, c.t, c.s, c.f, c.l])), st = ARENA_STORIES[c.s], hx = h => parseInt(h.slice(1), 16), base = '#0b0d14';
  return { sym: c.t, name: c.n, arena: c, arenaId: id, seed: courseSeed % 1e9, len: Math.max(600,c.l), vol: 1.1, bear: .06, breakT: .85, featEvery: 5, events: .07,
    story: st.story, tale: st.tale,
    theme: { sky: [mixHex(base, c.c1, .04), mixHex(base, c.c1, .08), mixHex(base, c.c1, .14)], fog: hx(mixHex(base, c.c1, .07)), rim: hx(c.c2), up: 0x163a3a, down: 0x3a1a22, weather: { color: hx(c.c2), size: .07, vy: .5 } },
    music: { bpm: 106, roots: [55, 43.65, 49, 41.2] } };
}
// Run the real chart generator for an arena (same candles as the course), then put the game's state back.
function previewCandles(lv) {
  const saved = { level, rng, mk: { ...mk }, cs: new Map(candles) };
  candles.clear(); level = lv; rng = mulberry32(lv.seed + TFS.indexOf(tfOf(lv)) * 7919 - 7919); Object.assign(mk, { price: 100, drift: 0, vol: 1, regime: 0 });
  for (let i = 0; i < lv.len; i++) nextCandle(i);
  const out = [...candles.values()]; candles.clear();
  level = saved.level; rng = saved.rng; Object.assign(mk, saved.mk); for (const [i, k] of saved.cs) candles.set(i, k);
  return out;
}
function drawArenaChart(cv, ks, c) {
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, lo = Math.min(...ks.map(k => k.l)), hi = Math.max(...ks.map(k => k.h));
  const py = v => H - 18 - (v - lo) / Math.max(hi - lo, 1) * (H - 40), cw = (W - 24) / ks.length;
  x.clearRect(0, 0, W, H);
  x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = 1; for (let y = 30; y < H; y += 45) { x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
  x.fillStyle = 'rgba(255,255,255,.05)'; x.font = '800 92px "Space Grotesk", sans-serif'; x.textBaseline = 'middle'; x.fillText(c.t, 18, H / 2);
  ks.forEach((k, i) => { const up = k.c >= k.o, cx = 12 + i * cw + cw / 2; x.strokeStyle = x.fillStyle = up ? PAL.upCss : PAL.dnCss;
    x.beginPath(); x.moveTo(cx, py(k.h)); x.lineTo(cx, py(k.l)); x.stroke(); const t = py(Math.max(k.o, k.c)); x.fillRect(cx - cw * .32, t, Math.max(1.5, cw * .64), Math.max(2, py(Math.min(k.o, k.c)) - t)); });
  x.strokeStyle = c.c2; x.lineWidth = 2; x.beginPath(); // MA(9) in the accent color
  ks.forEach((k, i) => { const w = ks.slice(Math.max(0, i - 8), i + 1), m = w.reduce((a, q) => a + q.c, 0) / w.length, X = 12 + i * cw + cw / 2; i ? x.lineTo(X, py(m)) : x.moveTo(X, py(m)); }); x.stroke();
}
let arenaDraft = {}, arenaMode = 'make';
function arenaChips(el, items, cur, on) {
  el.innerHTML = '';
  for (const [v, label] of items) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (v === cur) b.className = 'on'; b.onclick = e => { e.preventDefault(); on(v); }; el.append(b); }
}
function renderArenaMaker() {
  const c = sanitizeArena(arenaDraft), lv = arenaLevel(c), card = $('mkCard');
  card.style.setProperty('--b', c.c1); card.style.setProperty('--a', c.c2);
  $('mkMono').textContent = c.t.slice(0, 2); $('mkPName').textContent = c.n;
  $('mkPSub').textContent = `$${c.t} · ${TFS[c.f].id} · ${ARENA_STORIES[c.s].tale}`;
  $('mkPLen').textContent = Math.max(600,c.l); $('mkPEnd').textContent = arenaStatus(c).text; $('mkPEnd').style.color = arenaStatus(c).open ? '' : 'var(--red)';
  const best = Board.top(boardId(lv))[0]; $('mkPBoard').textContent = best ? best.score.toLocaleString() : '—';
  $('mkPNote').hidden = !c.m; $('mkPNote').textContent = c.m;
  const edit = (key, value) => { arenaDraft[key] = value; arenaDraft.sg = arenaDraft.cr = ''; renderArenaMaker(); };
  arenaChips($('mkStory'), Object.entries(ARENA_STORIES).map(([k, v]) => [k, v.label]), c.s, v => edit('s', v));
  arenaChips($('mkTf'), TFS.map((f, j) => [j, f.id]), c.f, v => edit('f', v));
  arenaChips($('mkLen'), ARENA_LENS.map(n => [n, String(n)]), Math.max(600,c.l), v => edit('l', v));
  drawArenaChart($('mkChart'), previewCandles(lv), c);
  renderArenaPage(c, lv);
}

/* VERIFIED ARENAS — the creator proves two things, and every visitor re-checks both on-chain when the link opens:
   (1) the signing wallet created the arena's token (explorer creator record, or owner()), and
   (2) that wallet holds at least WRUN_MIN $WRUN. The signature covers the whole arena setup (SHA-256), so editing a
   signed link breaks the badge. A static site can't *stop* anyone from making an unverified arena — it can only refuse
   to call it verified, which is what this does. */
const WRUN_MIN = 1e6;
const arenaPayload = c => { const { sg, cr, ...rest } = c; return JSON.stringify(rest); };
async function arenaMessage(c) {
  const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(arenaPayload(c))))].map(b => b.toString(16).padStart(2, '0')).join('');
  // Keep the signed protocol label stable for existing community links.
  return `Wick Runner arena\nToken: ${c.k}\nArena: ${h}\n\nSigning proves I created this token and publish this arena. It is free and moves no funds.`;
}
const utf8hex = str => '0x' + [...new TextEncoder().encode(str)].map(b => b.toString(16).padStart(2, '0')).join('');
let ethersLib = null; const loadEthers = async () => ethersLib ||= await import('https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.min.js');
async function tokenCreators(addr) { // the explorer's creator record, plus owner() if the token has one
  const out = [];
  const isAddr = v => /^0x[0-9a-fA-F]{40}$/.test(v || ''), get = path => fetch(`${CHAIN.explorer}/api/v2/${path}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json());
  try {
    const j = await get(`addresses/${addr}`); if (isAddr(j.creator_address_hash)) out.push(j.creator_address_hash.toLowerCase());
    // launchpad tokens (vibe/vibe) are deployed by a factory contract: the real creator is the wallet that sent the creation transaction
    const tx = j.creation_transaction_hash || j.creation_tx_hash;
    if (/^0x[0-9a-fA-F]{64}$/.test(tx || '')) { const t = await get(`transactions/${tx}`); if (isAddr(t.from?.hash)) out.push(t.from.hash.toLowerCase()); }
  } catch (e) {}
  try { const o = await ethCall(addr, '0x8da5cb5b'); if (/^0x[0-9a-fA-F]{64}$/.test(o || '') && !/^0x0+$/.test(o)) out.push('0x' + o.slice(-40).toLowerCase()); } catch (e) {}
  return out;
}
async function holdsWrun(addr) { if (!tokenLinks()) return null; const { dec, bal } = await readTokenBalance(addr); return bal >= BigInt(WRUN_MIN) * 10n ** BigInt(dec); } // null = $WRUN not live yet
async function verifyArena(c) {
  const r = { sig: false, creator: false, holds: null, ok: false };
  if (!c.k || !c.sg || !c.cr) return r;
  try { const { verifyMessage } = await loadEthers(); r.sig = verifyMessage(await arenaMessage(c), c.sg).toLowerCase() === c.cr; } catch (e) {}
  if (!r.sig) return r;
  r.creator = (await tokenCreators(c.k)).includes(c.cr);
  try { r.holds = await holdsWrun(c.cr); } catch (e) { r.holds = null; }
  r.ok = r.creator && r.holds === true; return r;
}
function setChecks(list) {
  $('mkChecks').innerHTML = '';
  for (const [text, ok] of list) { const li = document.createElement('li'); li.textContent = text; if (ok !== null) li.className = ok ? 'ok' : 'bad'; $('mkChecks').append(li); }
}
const DEFAULT_CHECKS = [['Your wallet created or owns this token', null], ['It holds at least 1,000,000 $WRUN', null], ['One free signature (no transaction)', null]];
$('mkSign').addEventListener('click', async () => {
  const c = sanitizeArena(arenaDraft);
  if (!c.k) return setChecks([['Enter your token contract first', false]]);
  let addr; try { addr = await emailLogin(); } catch (e) { return setChecks([[e.message || 'Sign-in cancelled', false]]); }
  setChecks([['Checking on-chain…', null]]);
  const isCreator = (await tokenCreators(c.k)).includes(addr);
  let holds = null; try { holds = await holdsWrun(addr); } catch (e) {}
  const list = [[`${addr.slice(0, 6)}…${addr.slice(-4)} created or owns this token`, isCreator], [holds === null ? '$WRUN is not live yet — the holding check opens at launch' : 'Holds at least 1,000,000 $WRUN', holds]];
  if (!isCreator || holds !== true) return setChecks([...list, ['Signature', null]]);
  try {
    const sg = await (await WickWallet.provider()).request({ method: 'personal_sign', params: [utf8hex(await arenaMessage(c)), addr] });
    arenaDraft.cr = addr; arenaDraft.sg = sg; setChecks([...list, ['Signed — your invite link now carries the verified badge', true]]); renderArenaMaker();
  } catch (e) { setChecks([...list, ['Signature cancelled', false]]); }
});
let verifyRun = 0;
async function renderBadge(c) {
  const id = ++verifyRun, b = $('mkBadge'); b.className = 'mk-badge'; b.textContent = c.sg ? 'Checking verification…' : 'Unverified community arena';
  if (!c.sg) return;
  const r = await verifyArena(c); if (id !== verifyRun) return;
  b.classList.toggle('ok', r.ok);
  b.textContent = r.ok ? '✓ Verified · signed by the token publisher' : r.sig && r.creator && r.holds === null ? 'Token publisher confirmed · $WRUN check opens at launch' : 'Unverified community arena';
}
function renderArenaPage(c, lv) {
  $('mkRulesBox').hidden = !c.r; $('mkPRules').textContent = c.r;
  const so = $('mkSocials'); so.innerHTML = '';
  for (const [label, href] of [['X', c.x && `https://x.com/${c.x}`], ['Telegram', c.tg && `https://t.me/${c.tg}`], ['Discord', c.dc && `https://discord.gg/${c.dc}`], ['Website', c.w]])
    if (href) { const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = label + ' ↗'; so.append(a); }
  $('mkTokenBox').hidden = !c.k; $('mkPToken').textContent = c.k; $('mkPToken').href = c.k ? `${CHAIN.explorer}/token/${c.k}` : '#';
  const ol = $('mkBoard'); ol.innerHTML = '';
  for (const [i, e] of Board.top(boardId(lv)).slice(0, 10).entries()) {
    const li = document.createElement('li'); for (const v of [i + 1, e.name, e.viber]) { const sp = document.createElement('span'); sp.textContent = v; li.append(sp); }
    const b = document.createElement('b'); b.textContent = e.score.toLocaleString(); li.append(b); ol.append(li);
  }
  renderBadge(c);
}
function openArenaMaker(mode, cfg) {
  arenaMode = mode; arenaDraft = { ...sanitizeArena(cfg) };
  $('mkName').value = arenaDraft.n; $('mkTicker').value = arenaDraft.t; $('mkC1').value = arenaDraft.c1; $('mkC2').value = arenaDraft.c2;
  $('mkEnd').value = arenaDraft.e ? new Date(arenaDraft.e).toISOString().slice(0, 10) : ''; $('mkX').value = arenaDraft.x; $('mkNote').value = arenaDraft.m;
  $('mkRules').value = arenaDraft.r; $('mkToken').value = arenaDraft.k; $('mkTg').value = arenaDraft.tg; $('mkDc').value = arenaDraft.dc; $('mkWeb').value = arenaDraft.w; setChecks(DEFAULT_CHECKS);
  document.querySelector('.maker').classList.toggle('invite', mode === 'invite');
  $('mkEdit').hidden = mode !== 'invite'; $('mkCopy').hidden = $('mkPost').hidden = false;
  $('arenaMaker').classList.remove('hidden'); renderArenaMaker();
}
const ARENA_FIELDS = { mkName: 'n', mkTicker: 't', mkC1: 'c1', mkC2: 'c2', mkX: 'x', mkNote: 'm', mkRules: 'r', mkToken: 'k', mkTg: 'tg', mkDc: 'dc', mkWeb: 'w' };
for (const id in ARENA_FIELDS) $(id).addEventListener('input', e => { arenaDraft[ARENA_FIELDS[id]] = /^mk(X|Tg)$/.test(id) ? e.target.value.replace(/^@/, '') : e.target.value; arenaDraft.sg = arenaDraft.cr = ''; renderArenaMaker(); }); // any edit voids the signature
$('mkEnd').addEventListener('input', e => { arenaDraft.e = e.target.value ? Date.parse(e.target.value + 'T23:59:59Z') : 0; arenaDraft.sg = arenaDraft.cr = ''; renderArenaMaker(); });
for (const id of ['mkName', 'mkTicker', 'mkX', 'mkNote', 'mkEnd', 'mkRules', 'mkToken', 'mkTg', 'mkDc', 'mkWeb']) $(id).addEventListener('keydown', e => e.stopPropagation()); // typing must not steer the runner
const recentArenas = () => store.get('cp-arenas', []).map(parseArena).filter(Boolean);
function rememberArena(c) { const code = arenaCode(c), l = store.get('cp-arenas', []).filter(x => x !== code); l.unshift(code); store.set('cp-arenas', l.slice(0, 6)); }
function playArena(c) {
  level = arenaLevel(c); rememberArena(c);
  $('arenaMaker').classList.add('hidden'); history.replaceState(null, '', '#arena=' + arenaCode(c));
  Sfx.init(); enterGame(); renderMenu(); $('go').click();
}
$('mkPlay').addEventListener('click', () => playArena(sanitizeArena(arenaDraft)));
$('mkCopy').addEventListener('click', () => navigator.clipboard?.writeText(arenaLink(sanitizeArena(arenaDraft))).then(() => { $('mkCopy').textContent = 'Link copied ✓'; setTimeout(() => $('mkCopy').textContent = 'Copy invite link', 1400); }));
$('mkPost').addEventListener('click', () => { const c = sanitizeArena(arenaDraft);
  const text = `${c.n} is open in Wick Runner.\nRun the $${c.t} chart and beat my line.\nFree browser parkour.\n#WickRunner #Parkour`;
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(arenaLink(c))}`, '_blank', 'noopener'); });
$('mkEdit').addEventListener('click', () => openArenaMaker('make', { ...sanitizeArena(arenaDraft), n: '', t: '', x: '', m: '', e: 0, r: '', k: '', tg: '', dc: '', w: '', sg: '', cr: '' }));
$('mkClose').addEventListener('click', () => $('arenaMaker').classList.add('hidden'));
document.querySelectorAll('[data-arena-new]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openArenaMaker('make', { n: '', t: '', s: 'launch', f: 1, l: 110 }); }));
// fictional example arenas (no real projects): open as invites
const ARENA_EXAMPLES = [
  { n: 'Moon Guild', t: 'MOON', c1: '#7c5cff', c2: '#dcf513', s: 'launch', f: 1, l: 110, m: 'Weekly guild race — top 10 get the Moon role' },
  { n: 'Degen Dojo', t: 'DOJO', c1: '#ff5d73', c2: '#ffd23f', s: 'pump', f: 2, l: 110, m: 'Survive the dump. Screenshot your best run in #arena' },
  { n: 'Frost Pack', t: 'FROST', c1: '#3fb8ff', c2: '#e9f6ff', s: 'bear', f: 3, l: 170, m: 'Only the brave clear a 1D bear market' },
].map(sanitizeArena);
for (const c of ARENA_EXAMPLES) { const b = document.createElement('button'); b.style.setProperty('--c', c.c1); const i = document.createElement('i'); i.textContent = c.t.slice(0, 2);
  b.append(i, c.n); b.onclick = () => openArenaMaker('invite', c); $('arenaExamples').append(b); }
{ const m = location.hash.match(/^#arena=([A-Za-z0-9_-]+)$/), c = m && parseArena(m[1]); if (c) openArenaMaker('invite', c); } // opened from an invite link
let wallet = null, walletInfo = '', balanceReadAt = 0, walletReadId = 0;
async function rpc(method, params) {
  const r = await fetch(CHAIN.rpc, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
}
const ethCall = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
async function readTokenBalance(addr) {
  const dec = parseInt(await ethCall(TOKEN.address, '0x313ce567'), 16);                                        // decimals(): read, never assume
  if (!Number.isInteger(dec) || dec < 0 || dec > 255) throw new Error('Invalid token decimals');
  const bal = BigInt(await ethCall(TOKEN.address, '0x70a08231' + addr.slice(2).toLowerCase().padStart(64, '0'))); // balanceOf(addr)
  return { dec, bal };
}
async function connectWallet() {
  try { await updateWallet([await emailLogin()]); }
  catch (e) { walletInfo = (e.message || 'Sign-in cancelled').slice(0, 80); }
  renderWallet();
}
async function updateWallet(accounts) {
  const id = ++walletReadId; heldTokens = 0; balanceReadAt = 0;
  wallet = /^0x[0-9a-f]{40}$/i.test(accounts?.[0] || '') ? accounts[0] : null;
  walletInfo = wallet ? 'Signed in · reading balances…' : ''; wcWrun = wcEth = '…';
  renderWallet(); if (wallet) readWalletCard(wallet);
  if (!wallet || !tokenLinks()) return;
  try {
    const { dec, bal } = await readTokenBalance(wallet); if (id !== walletReadId) return;
    heldTokens = Number(bal / 10n ** BigInt(dec)); balanceReadAt = Date.now();
    walletInfo = `${fmtUnits(bal, dec)} ${TOKEN.symbol}` + (holderBoost() ? ` · +${Math.round(holderBoost() * 100)}% XP only` : '');
  } catch (e) { if (id !== walletReadId) return; walletInfo = 'Balance unavailable · play continues without a holder boost'; }
  renderWallet();
}
function clearRankedSession() { rankedSession = null; renderOnline(); }
// Account changes come from Privy (email login + embedded wallet); browser-extension wallets are never used.
let lastPrivyAddr = null;
function onPrivyChange(a) { if (a === lastPrivyAddr) return; lastPrivyAddr = a; updateWallet(a ? [a] : []); if (rankedSession && rankedSession !== a) clearRankedSession(); }
setInterval(() => { if (wallet && !document.hidden && tokenLinks()) updateWallet([wallet]); }, 45000);
function renderWallet() {
  $('walletBtn').textContent = wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Sign in with email';
  $('walletInfo').textContent = wallet ? walletInfo : 'Email sign-in · secure wallet by Privy';
  $('walletCard').hidden = !wallet; if (!wallet) return;
  const links = tokenLinks();
  $('wcAddr').textContent = wallet; $('wcExplorer').href = `${CHAIN.explorer}/address/${wallet}`;
  $('wcBuy').hidden = !links; if (links) $('wcBuy').href = links.page;
  $('wcWrun').textContent = wcWrun; $('wcEth').textContent = wcEth;
}
let wcWrun = '…', wcEth = '…';
async function readWalletCard(addr) { // read-only: both balances straight from the chain
  try { const wei = BigInt(await rpc('eth_getBalance', [addr, 'latest'])); wcEth = fmtUnits(wei, 18); } catch { wcEth = 'unavailable'; }
  try { if (tokenLinks()) { const { dec, bal } = await readTokenBalance(addr); wcWrun = fmtUnits(bal, dec); } } catch { wcWrun = 'unavailable'; }
  if (wallet === addr) renderWallet();
}
$('walletBtn').addEventListener('click', e => { e.stopPropagation(); if (wallet) $('walletCard').hidden = !$('walletCard').hidden; else connectWallet(); });
$('wcCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(wallet); $('wcCopy').textContent = 'Copied'; setTimeout(() => $('wcCopy').textContent = 'Copy', 1500); } catch {} });
$('wcOut').addEventListener('click', async () => { try { await WickWallet.logout(); } catch {} });
$('termsBtn').addEventListener('click', () => $('terms').classList.remove('hidden'));
$('termsClose').addEventListener('click', () => $('terms').classList.add('hidden'));


/* PAUSE — Esc (or switching tabs) freezes the run; resume, restart, settings or quit. */
function pause() { if (game.state !== 'play' && game.state !== 'count') return; game.paused = game.state; game.state = 'pause'; clearInput(); Sfx.setPaused(true); $('pause').classList.remove('hidden'); $('pCheckpoint').disabled = !game.checkpoint || oneLife(); if (document.pointerLockElement) document.exitPointerLock(); }
function resume() { if (game.state !== 'pause') return; game.state = game.paused; Sfx.setPaused(false); $('pause').classList.add('hidden'); closeSettings(); lockMouse(); }
function retryCheckpoint() { if (!game.checkpoint || oneLife() || !['play', 'pause'].includes(game.state)) return false; if (game.state === 'pause') resume(); input.pReset = true; return true; }
$('pCheckpoint').addEventListener('click', retryCheckpoint);
$('pResume').addEventListener('click', resume);
$('pauseGame').addEventListener('click', pause);
$('pRestart').addEventListener('click', () => { $('pause').classList.add('hidden'); beginRun(); });
$('pSettings').addEventListener('click', () => openSettings('pause'));
$('pQuit').addEventListener('click', () => { $('pause').classList.add('hidden'); showMenu(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
let fpsAcc = 0, fpsN = 0;


/* =====================================================================
   PER-FRAME WORLD UPDATE — red candle cracking, debris, orbs, pickups
   ===================================================================== */
// Air-step shockwave: a flat lime ring that expands and fades under the feet on a double jump.
const waves = [], waveGeo = new THREE.RingGeometry(.42, .5, 40);
for (let i = 0; i < 4; i++) { // pooled up front, so the first double jump never compiles a shader mid-run
  const m = new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  m.rotation.x = -Math.PI / 2; m.userData.t = 1; m.frustumCulled = false; scene.add(m); waves.push(m);
}
let waveNext = 0;
function airWave(x, y, z, color = 0xd9f66f) { const m = waves[waveNext++ % waves.length]; m.material.color.setHex(color); m.position.set(x, y, z); m.userData.t = 0; }
// One-time contextual tips for new players (each shows once, ever).
const seenTips = new Set(store.get('cp-tips', []));
let tipTimer = 0;

// TRAINING COACH: one live hint about whatever is right in front of you (training chart only).
function coachHint() {
  const i = Math.floor(chartIdx), a = platforms.get(i), b = platforms.get(i + 1), k = (h, t) => isTouch ? t : h;
  if (!a || !b) return 'Run through the gate to finish training!';
  if (a.spring) return 'Big rise ahead — run onto the <b>spring</b>';
  if (a.pad) return 'Run over the blue <b>boost pad</b>';
  if (b.feature === 'rail') return 'Jump and land on the <b>rail</b> to grind across';
  if (b.feature === 'wall') return k('Jump, then hold <kbd>A</kbd> toward the wall on your left to <b>wall-run</b>', 'Jump, then push the stick <b>left</b> toward the wall to <b>wall-run</b>');
  if (b.feature === 'pole') return k('Jump, hold <kbd>E</kbd> near the pole, release to launch', 'Jump, hold <b>GRAB</b> near the pole, release to launch');
  if (b.top - a.top > 1.3) return k('High step — <kbd>Space</kbd> twice to <b>double jump</b>', 'High step — <b>JUMP</b> twice to double jump');
  if (b.top - a.top < -3.5) return 'Big drop — keep running and you\u2019ll <b>roll</b> out of it';
  if (!b.green) return '<b style="color:var(--red)">Red</b> candles crack — don\u2019t stop on them';
  return k(settings.autoRun ? '<kbd>A</kbd><kbd>D</kbd> steer · <kbd>Space</kbd> jump · <kbd>S</kbd> brake' : '<kbd>W</kbd> run · <kbd>Space</kbd> jump · hold for higher', settings.autoRun ? 'Auto-run ON · steer with the stick · <b>JUMP</b> for gaps' : 'Stick to run · <b>JUMP</b> to jump');
}
const oneLife = () => !level.tutorial; // one life: a death is game over (training keeps its retries)
function tip(id, html) {
  if (!recording || VERIFY_MODE || level.tutorial || seenTips.has(id)) return; // Replays do not consume the player's learning tips.
  seenTips.add(id); store.set('cp-tips', [...seenTips]);
  const el = $('tip'); el.innerHTML = html; el.classList.remove('hidden'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(tipTimer); tipTimer = setTimeout(() => el.classList.add('hidden'), 4200);
}
// LANDING MARKER: while airborne, trace the current arc forward and mark where it meets a candle top.
// Judging distance from behind is hard; this small lime ring makes jumps readable.
const landRing = new THREE.Mesh(new THREE.RingGeometry(.3, .4, 32), new THREE.MeshBasicMaterial({ color: 0xdcf513, transparent: true, opacity: .6, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
landRing.rotation.x = -Math.PI / 2; landRing.visible = false; scene.add(landRing);
const landingArcPositions = new Float32Array(91 * 3), landingArcGeo = new THREE.BufferGeometry();
landingArcGeo.setAttribute('position', new THREE.BufferAttribute(landingArcPositions, 3));
const landingArc = new THREE.Line(landingArcGeo, new THREE.LineBasicMaterial({ color: 0x81e9db, transparent: true, opacity: .4, depthWrite: false }));
landingArc.frustumCulled = false; landingArc.visible = false; scene.add(landingArc);
let landingStatus = '';
function updateLandingMarker(t) {
  const p = player; landRing.visible = landingArc.visible = false; landingStatus = '';
  if (game.state !== 'play' || p.onGround || p.state !== 'air' || p.wallrun) return;
  let x = p.pos.x, y = p.pos.y, z = p.pos.z, vy = p.vel.y, vx = p.vel.x, vz = p.vel.z, canCut = p.canCut;
  const dt = .025; let count = 1, color = 0x8b91a1;
  landingArcGeo.attributes.position.setXYZ(0, x, y + .06, z);
  for (let i = 0; i < 90; i++) {
    const future = (i + 1) * dt;
    if (canCut && !input.jumpHeld && p.jumpAge + future >= .12 && vy > 0) { vy *= .55; canCut = false; }
    if (wishLen > .01 && p.ballisticT <= future) {
      const speed = Math.hypot(vx, vz), max = p.boostT > future ? BOOST_MAX : RUN_MAX;
      const cap = Math.max(max * wishLen, speed - 5 * dt);
      let dx = _wish.x * cap - vx, dz = _wish.z * cap - vz;
      const d = Math.hypot(dx, dz), limit = 28 * dt;
      if (d > limit) { dx *= limit / d; dz *= limit / d; }
      vx += dx; vz += dz;
    }
    vy = Math.max(-48, vy - GRAV * (vy < 0 ? 1.3 : 1) * dt);
    const ny = y + vy * dt; x += vx * dt; z += vz * dt;
    landingArcGeo.attributes.position.setXYZ(count++, x, ny + .06, z);
    if (vy < 0) for (const c of colliders) {
      const pl = c.plat;
      if (!c.active || c.type !== 'plat' || x + HALF <= c.min.x || x - HALF >= c.max.x || z + HALF <= c.min.z || z - HALF >= c.max.z || pl && pl.crackT >= 0 && pl.crackT + future >= pl.breakT) continue;
      const top = pl?.live ? pl.live.base + Math.sin((score.time + future) * 1.6 + pl.live.ph) * pl.live.amp : c.max.y;
      if (y >= top - .05 && ny <= top) {
        const edge = Math.min(x - c.min.x, c.max.x - x, z - c.min.z, c.max.z - z);
        landingStatus = pl && !pl.green ? 'red' : edge < .55 ? 'edge' : pl?.pad ? 'pad' : 'center';
        color = landingStatus === 'red' ? 0xff7878 : landingStatus === 'edge' ? 0xffd23f : landingStatus === 'pad' ? 0x4fc3f7 : 0x81e9db;
        landRing.position.set(x, top + .04, z); landRing.scale.setScalar(settings.calm ? 1.15 : 1.15 + Math.sin(t * 8) * .06);
        landRing.material.color.setHex(color); landRing.visible = true;
        landingArcGeo.attributes.position.setXYZ(count - 1, x, top + .06, z);
        break;
      }
    }
    if (landRing.visible) break;
    y = ny; if (y < p.lastGroundY - 25) break;
  }
  if (!landingStatus) landingStatus = 'miss';
  landingArc.material.color.setHex(color); landingArcGeo.setDrawRange(0, count);
  landingArcGeo.attributes.position.needsUpdate = true; landingArc.visible = true;
}

const bouncing = new Set();
const hauntFx = { flash: 0, next: 4 };
function updateWorld(dt, t) {
  updateHazards(t);
  if (haunt.group.visible) {
    const f = haunt.update(dt, t, camera.position, settings.calm ? null : hemi); // calm mode: no lightning
    if (f && !hauntFx.flash) Sfx.play('thunder', .7, 1, .35 + Math.random() * .5); hauntFx.flash = f;
    if ((hauntFx.next -= dt) < 0) { hauntFx.next = 5 + Math.random() * 7; const r = Math.random(); Sfx.play(r < .5 ? 'bat' : r < .8 ? 'ghost' : 'howl', r < .5 ? .35 : .25); }
  }
  districtGrid.position.set(0, player.pos.y - 18, Math.round(player.pos.z / 5) * 5);
  lipLive.emissiveIntensity = .25 + .35 * (Math.sin(t * 6) > 0 ? 1 : 0); // "LIVE" blink
  for (const pl of liveCandles) if (pl.live && !pl.broken) pl.group.position.y = (pl.top + pl.bot) / 2 + (pl.bo || 0); // positions come from simWorld
  for (const w of waves) {
    if (w.userData.t >= .4) { w.material.opacity = 0; continue; }
    w.userData.t += dt; const k = Math.min(1, w.userData.t / .4);
    w.scale.setScalar(1 + k * 2.5); w.material.opacity = .3 * (1 - k);
  }
  for (const pl of bouncing) {
    pl.bo = (pl.bo || 0) + pl.bv * dt; pl.bv += (-pl.bo * 260 - pl.bv * 13) * dt;
    pl.group.position.y = (pl.top + pl.bot) / 2 + pl.bo;
    if (Math.abs(pl.bo) < 1e-3 && Math.abs(pl.bv) < 1e-2) { pl.bo = pl.bv = 0; pl.group.position.y = (pl.top + pl.bot) / 2; bouncing.delete(pl); }
  }
  for (const pl of platforms.values()) {
    if (pl.crackT < 0 || pl.broken) continue;
    const k = pl.crackT / pl.breakT; // the timer itself runs in simWorld
    pl.mesh.position.set((Math.random() - .5) * .14 * k, (Math.random() - .5) * .06 * k, (Math.random() - .5) * .14 * k);
    pl.mat.emissiveIntensity = RED_GLOW + k * .9 * (.6 + .4 * Math.sin(t * 40));
    if (Math.random() < .6) emit(pl.x + (Math.random() - .5) * PLAT_W, pl.top + .05, pl.zc + (Math.random() - .5) * pl.depth, 0, 1 + Math.random() * 2, 0, 0xef5350, .5, -1);
    if (Math.random() < dt * 8) Sfx.crack();
  }
  for (const d of debris) {
    if (d.life <= 0) continue;
    d.life -= dt; d.vel.y -= 20 * dt; d.m.position.addScaledVector(d.vel, dt);
    d.m.rotation.x += d.spin.x * dt; d.m.rotation.y += d.spin.y * dt;
    d.m.scale.multiplyScalar(Math.exp(-.8 * dt));
    if (d.life <= 0) d.m.visible = false;
  }
  for (const pl of platforms.values()) if (pl.padMesh) pl.padMesh.material.color.setHSL(.5, 1, .45 + .15 * Math.sin(t * 8));
  for (const pl of platforms.values()) {
    const sp = pl.spring; if (!sp || sp.anim < 0) continue;
    sp.anim += dt * 3; const k = Math.sin(Math.min(1, sp.anim) * Math.PI) * Math.exp(-sp.anim * 1.5);
    sp.plate.position.y = .5 + k * .7; sp.coil.scale.y = 1 + k * 1.6;
    if (sp.anim >= 2) { sp.anim = -1; sp.plate.position.y = .5; sp.coil.scale.y = 1; }
  }
  if (level.haunt) {
    for (const pl of platforms.values()) if (!pl.green && pl.mat.userData.perCandle) { pl.mat.transparent = true; pl.mat.opacity += ((pl.ghost ? .12 : pl.ghostWarn ? (Math.sin(t * 40) > 0 ? .35 : .9) : 1) - pl.mat.opacity) * Math.min(1, dt * 20); }
    if (!fogWall) { fogWall = haunt.fogBank(); scene.add(fogWall); } // soft layered mist, not a flat sheet
    fogWall.visible = game.fogZ != null; if (fogWall.visible) { fogWall.position.set(player.pos.x, player.pos.y - 2, game.fogZ); fogWall.children.forEach((m, k) => { m.position.x = Math.sin(t * .5 + k) * 3; m.material.opacity = .5 + Math.sin(t * 1.3 + k * 2) * .15; }); }
  } else if (fogWall) fogWall.visible = false;
  for (const o of orbs) {
    if (o.taken) continue;
    o.mesh.rotation.y += dt * 2.5; o.mesh.position.y = o.base + Math.sin(t * 3 + o.base) * .2;
  }
}
function checkPickupsAndBounds() {
  const p = player;
  if (level.haunt && game.fogZ != null && p.pos.z > game.fogZ) { die(false, 'The liquidation fog caught you · keep moving'); return; }
  for (const pl of platforms.values()) if (pl.hazard && !pl.broken && hazardHits(pl.hazard,p.pos.x,p.pos.y,p.pos.z,pl.top)) { die(false,`${pl.hazard.kind === 'laser' ? 'Laser gate' : 'Mine'} · use the ${pl.hazard.side > 0 ? 'RIGHT' : 'LEFT'} lane`); return; }
  _v.copy(p.pos); _v.y += .9;
  for (const o of orbs) {
    if (o.taken || _o.set(o.mesh.position.x, o.base, o.mesh.position.z).distanceToSquared(_v) > 2.2) continue; // rest position: the bob is visual only
    o.taken = true; o.mesh.visible = false;
    trick('ORB', 100, '#f5c542'); Sfx.collect();
    burst(o.mesh.position.x, o.mesh.position.y, o.mesh.position.z, 26, 0xf5c542, 5, .5);
  }
  score.dist = Math.max(score.dist, -p.pos.z);
  if (p.pos.y < p.lastGroundY - 22) die();
  else if (p.pos.z < finishZ && Math.abs(p.pos.x) <= 5 && p.pos.y >= gen.prev.top - 1 && p.pos.y <= gen.prev.top + 8) finish();
}

/* =====================================================================
   PLAYER VISUALS — procedural run cycle, air tuck, slide, wallrun lean,
   grind stance, swing pose, squash & stretch; ribbon trail.
   ===================================================================== */
const pose = { legL: 0, legR: 0, armL: 0, armR: 0, armLz: 0, armRz: 0, rigX: 0, rigY: 0, rigZ: 0, hipY: .85 };
const feet = { lz: 0, ly: 0, rz: 0, ry: 0, run: false }; // foot offsets for the stepping run cycle (reused every frame)
function startFlip(axis, dir, dur, ground = false) { Object.assign(runner, { flipStart: score.time, flipT: 0, flipDur: dur, flipAxis: axis, flipDir: dir || 1, flipGround: ground }); }
function updateRunner(dt, t) {
  const p = player, R = runner;
  R.root.position.copy(p.pos);
  const hs = Math.hypot(p.vel.x, p.vel.z);
  if (hs > .5) {
    let h = Math.atan2(p.vel.x, p.vel.z);
    if (camMode === 'chart') h += clamp((Math.PI / 2 - h + Math.PI * 3) % (Math.PI * 2) - Math.PI, -.6, .6); // turn the face a bit toward the side camera
    p.heading = dampAngle(p.heading, h, 8, dt);
  } else if (p.state === 'hang') p.heading = dampAngle(p.heading, Math.atan2(p.hang.axis === 'x' ? p.hang.dir : 0, p.hang.axis === 'z' ? p.hang.dir : 0), 14, dt); // face the wall
  else if (camMode === 'chart') p.heading = dampAngle(p.heading, Math.PI / 2, 4, dt); // idle: look at the player
  R.root.rotation.y = p.heading;

  // Target pose per state; joints ease toward it. Short-legged vibers take quick, small
  // steps with a side-to-side waddle; idle breathes; airborne poses follow vertical speed.
  const T = { legL: 0, legR: 0, armL: 0, armR: 0, armLz: .12, armRz: -.12, rigX: 0, rigY: 0, rigZ: 0, hipY: .85 };
  feet.lz = feet.ly = feet.rz = feet.ry = 0; feet.run = false;
  const act = {}; // per-frame acting overrides for head / top piece (personality, celebrations)
  const sliding = p.onGround && p.slideT > 0;
  // Flips: spin the pivot one full turn with ease-out (fast start, soft finish). Landing mid-flip finishes it quickly.
  let flipping = R.flipT >= 0;
  if (flipping) {
    R.flipT += dt * (p.onGround && !R.flipGround ? 4 : 1);
    const k = Math.min(1, R.flipT / R.flipDur), e = R.flipGround ? 1 - Math.pow(1 - k, 3) : k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    R.flip.rotation.set(0, 0, 0); R.flip.rotation[R.flipAxis] = R.flipDir * Math.PI * 2 * e;
    if (k >= 1) { R.flipT = -1; R.flip.rotation.set(0, 0, 0); flipping = false; }
  }
  if (game.state === 'win' || (game.state === 'end' && game.won)) { // victory dance: four moves, one per bar, on a ~132 BPM pulse
    const b = t * 2.2, hop = Math.abs(Math.sin(b * Math.PI)), sw = Math.sin(b * Math.PI), move = Math.floor(b / 4) % 4;
    if (move === 0) Object.assign(T, { armL: -2.9, armR: -2.9, armLz: .3 + hop * 1.1, armRz: -.3 - hop * 1.1, legL: -.35 * hop, legR: -.35 * hop, hipY: .85 + hop * .22 });              // jumping jacks
    else if (move === 1) { Object.assign(T, { armL: sw > 0 ? -3 : -.3, armR: sw > 0 ? -.3 : -3, armLz: sw > 0 ? .5 : .2, armRz: sw > 0 ? -.2 : -.5, legL: -.2 * hop, legR: 0, hipY: .85 + hop * .06 }); act.roll = sw * .16; } // disco point
    else if (move === 2) { Object.assign(T, { armL: -1.6, armR: -1.6, armLz: 1.5, armRz: -1.5, legL: -.4 * hop, legR: -.4 * hop, hipY: .9 + hop * .15 }); act.yaw = (b % 4) / 4 * Math.PI * 2; } // spin, arms out
    else { const r = Math.sin(b * Math.PI * 2); Object.assign(T, { legL: r * .9, legR: -r * .9, armL: -r * 1.1 - .4, armR: r * 1.1 - .4, armLz: .25, armRz: -.25, hipY: .85 + hop * .1 }); act.pitch = .08; } // running man
    p.heading = dampAngle(p.heading, Math.atan2(camera.position.x - p.pos.x, camera.position.z - p.pos.z), 6, dt);
  }
  else if (game.state === 'dead') { // tumbling, arms and legs flailing
    R.flip.rotation.x -= dt * 4.5;
    Object.assign(T, { armL: -2.6 + Math.sin(t * 14) * .7, armR: -2.6 - Math.sin(t * 14) * .7, armLz: .95, armRz: -.95, legL: Math.sin(t * 12) * .8, legR: -Math.sin(t * 12) * .8, rigX: .2 });
  }
  else if (flipping && R.flipGround) Object.assign(T, { legL: -1.9, legR: -1.8, armL: -1.6, armR: -1.5, armLz: .3, armRz: -.3, rigX: .4, hipY: .5 }); // ground roll: tight ball, low
  else if (flipping && R.flipAxis !== 'y') {
    const k = R.flipT / R.flipDur;
    if (k < .2) Object.assign(T, { armL: -2.8, armR: -2.8, armLz: 1, armRz: -1, legL: .15, legR: .1, rigX: -.1, hipY: .9 });          // launch: reach up
    else if (k < .74) Object.assign(T, { legL: -1.9, legR: -1.8, armL: -1.25, armR: -1.15, armLz: .3, armRz: -.3, rigX: .3, hipY: .95 }); // tight tuck
    else Object.assign(T, { legL: -.45, legR: -.25, armL: -.3, armR: -.3, armLz: 1.25, armRz: -1.25, rigX: .05, hipY: .88 });         // open + spot landing
  }
  else if (flipping) Object.assign(T, { armLz: 1.5, armRz: -1.5, legL: -.3, legR: .3 });                                            // arms out spin
  else if (p.state === 'grind') Object.assign(T, { rigY: 1.2, rigZ: Math.sin(t * 9) * .04 + Math.sin(t * 2.3) * .08, legL: -.35, legR: .35, armLz: 1.1 + Math.sin(t * 4.5) * .3, armRz: -1.1 + Math.sin(t * 4.5 + 1) * .3, hipY: .76 }); // balancing
  else if (p.state === 'hang' && p.hang.vault) { // lazy vault: one hand plants on the ledge, legs swing past to the side
    const k = Math.min(1, p.hang.climb / VAULT_T);
    Object.assign(T, { armL: -1.4 + k * 1.1, armR: -.6, armRz: -.9, legL: -1.3, legR: -1.0, rigX: .35, rigZ: .55 * Math.sin(k * Math.PI), hipY: .82 });
  }
  else if (p.stunT > 0) Object.assign(T, { legL: -1.5, legR: 1.0, armL: -.4, armR: 1.3, armRz: -.4, rigX: .45, hipY: .5 }); // superhero landing: knee and fist down
  else if (p.state === 'hang' && p.hang.climb < 0) // dangling: arms up on the ledge, legs swing a little
    Object.assign(T, { armL: -2.95, armR: -2.95, armLz: 1.1, armRz: -1.1, /* stubby arms can't reach over the big head: raised arms splay out to the sides instead */ legL: Math.sin(t * 3) * .25 - .1, legR: -Math.sin(t * 3) * .25 - .1, rigX: -.08 });
  else if (p.state === 'hang') { // climbing: hands push down as the body rises, one knee comes up onto the ledge
    const k = Math.min(1, p.hang.climb / CLIMB_T);
    Object.assign(T, { armL: lerp(-2.95, -.3, k), armR: lerp(-2.95, -.4, Math.max(0, k - .1)), legL: k < .7 ? -1.5 * Math.sin(k / .7 * Math.PI) : 0, legR: .35 * k, rigX: .45 * Math.sin(k * Math.PI), hipY: .85 });
  }
  else if (p.state === 'swing') Object.assign(T, { armL: -2.9, armR: -2.7, armLz: 1, armRz: -1, legL: -.5 + Math.sin(t * 6) * .3, legR: .2 - Math.sin(t * 6) * .3, rigX: .2 });
  else if (sliding) Object.assign(T, { rigX: -.7, legL: -1.2, legR: -.9, armL: -.5, armR: .4, armLz: .5, armRz: -.5, hipY: .62 });
  else if (!p.onGround && !p.wallrun) {
    const up = clamp(p.vel.y / 10, -1, 1); // +1 rising … -1 falling, blends smoothly through the apex
    Object.assign(T, { legL: lerp(-.9, -.6, up), legR: lerp(-.5, .4, up), armL: lerp(-.4, -2.2, (up + 1) / 2), armR: lerp(-.4, -2.2, (up + 1) / 2),
      armLz: lerp(1.1, .3, (up + 1) / 2), armRz: -lerp(1.1, .3, (up + 1) / 2), rigX: lerp(.05, .15, (up + 1) / 2) });
  } else {
    const amp = clamp(hs / RUN_MAX, 0, 1);
    R.phase += dt * (hs * 1.35 + (hs > .3 ? 2.2 : 0)); // cadence tuned to the slower, natural run
    const s = Math.sin(R.phase), c = Math.cos(R.phase);
    if (Math.sign(s) !== R.lastStep && amp > .25 && p.onGround) { // a foot hits the ground
      R.lastStep = Math.sign(s); Sfx.step();
      emit(p.pos.x + R.lastStep * .2, p.pos.y + .05, p.pos.z, (Math.random() - .5), .6, p.vel.z * -.05, 0x6f788c, .4, 1);
      R.hpv = (R.hpv || 0) + .9 * amp; p.squash = Math.max(p.squash, .045 * amp); // the big head nods and the body gives a little on every footfall
    }
    // STEPS, not a pendulum: stubby feet slide back flat while planted, then lift and swing forward (a cycling motion).
    // The body is lowest as the feet pass (weight over the planted foot) and highest with the feet spread (push-off).
    if (amp > .05) {
      const stride = .32 * Math.min(1, amp * 1.3), lift = .2 * Math.min(1, amp * 1.5);
      Object.assign(feet, { lz: s * stride, ly: Math.max(0, c) * lift, rz: -s * stride, ry: Math.max(0, -c) * lift, run: true });
      Object.assign(T, { legL: -c * .45 * amp, legR: c * .45 * amp,                    // toes tip up on the swing, push off behind
        armL: s * .95 * amp, armR: -s * .95 * amp, armLz: .2 + .12 * amp, armRz: -.2 - .12 * amp,
        rigX: .05 + .07 * amp, rigZ: -s * .06 * amp, rigY: s * .08 * amp, hipY: .85 + (Math.abs(s) - .5) * .12 * amp });
    }
    // let go at speed: skid to a stop — lean back, lead foot braced, arms out front for balance. The stop itself takes
    // only ~0.1 s, so the pose holds a beat longer to read.
    if (p.onGround && !p.wallrun && hs > 4 && wishLen < .1) R.skidHold = .28;
    if (R.skidHold > 0 && p.onGround && wishLen < .1) {
      R.skidHold -= dt; feet.run = true;
      Object.assign(feet, { lz: .3, ly: 0, rz: -.12, ry: 0 });
      Object.assign(T, { legL: .35, legR: -.1, armL: -1.1, armR: -.9, armLz: .5, armRz: -.5, rigX: -.2, rigY: 0, rigZ: 0, hipY: .72 });
      if (hs > 1 && (R.skidT = (R.skidT || 0) + dt) > .04) { R.skidT = 0; emit(p.pos.x + (Math.random() - .5) * .4, p.pos.y + .05, p.pos.z - .3, (Math.random() - .5), .5, p.vel.z * .2, 0x6f788c, .35, 1); }
    } else R.skidHold = 0;
    if (amp > .05 && p.boostT > 0) Object.assign(T, { armL: 1.1, armR: 1.1, armLz: .35, armRz: -.35, rigX: .32 }); // boost: arms swept back
    if (amp > .05) { T.rigX += clamp((R.acc || 0) * .008, -.08, .1); T.rigZ += R.bank || 0; } // lean into speed-ups, bank into turns
    else if (!(R.skidHold > 0)) Object.assign(T, { hipY: .85 + Math.sin(t * 2.2) * .012, armLz: .14 + Math.sin(t * 2.2) * .03, armRz: -.14 - Math.sin(t * 2.2) * .03 }); // idle breathing
    if (amp <= .05 && (R.idleT || 0) > 3) { // got bored — each viber in its own way
      const who = VIBERS[viberIdx].name;
      if (who === 'Scout') Object.assign(T, { armL: -2.5, armLz: .55 });                                        // scanner held near the shoulder
      else if (who === 'Flux') { if (t % 4 < .9) Object.assign(T, { armR: -2.55, armRz: -.5 }); T.legR = -Math.max(0, Math.sin(t * 9)) * .3; } // pushes the goggles up, taps a foot
      else if (who === 'Relay') { const check = Math.max(0, Math.sin(t * .9)); T.armL = -check * 1.2; act.pitch = check * .12; act.yaw = Math.sin(t * .6) * .14; } // checks the wrist terminal, then scans the skyline
      else act.pitch = .14 * Math.max(0, Math.sin(t * (level.music?.bpm || 96) / 60 * Math.PI));            // nodding to the music's beat
    }
    if (p.wallrun) Object.assign(T, { rigZ: p.wallNormal * .4, armRz: -1.3 }); // lean in, hand trailing along the wall
    const g = p.onGround && p.ground && p.ground.max; // teeter: standing still on a candle edge, arms windmill
    if (g && amp <= .05 && Math.min(p.pos.z - g.min.z, g.max.z - p.pos.z) < .45)
      Object.assign(T, { armL: -1.6 + Math.sin(t * 13) * 1.3, armR: -1.6 + Math.sin(t * 13 + Math.PI) * 1.3, armLz: .9, armRz: -.9, rigX: Math.sin(t * 6) * .18 });
  }
  if (R.react) { // short reactions: fist pump on a perfect landing, a nod for "stuck it", arms windmilling on a clutch save
    R.react.t += dt; const k = R.react.t;
    if (R.react.kind === 'pump' && k < .5) Object.assign(T, { armR: -2.95, armRz: -1.05 });
    else if (R.react.kind === 'nod' && k < .35) act.pitch = Math.sin(k / .35 * Math.PI) * .35;
    else if (R.react.kind === 'wobble' && k < .6) Object.assign(T, { armL: -1.6 + Math.sin(t * 16) * 1.2, armR: -1.6 - Math.sin(t * 16) * 1.2, armLz: .9, armRz: -.9 });
    else R.react = null;
  }
  const ease = feet.run ? 30 : 14; // the run cycle is fast: heavy smoothing would blur and delay every step
  for (const k in pose) pose[k] = damp(pose[k], T[k], ease, dt);
  R.legL.rotation.x = pose.legL; R.legR.rotation.x = pose.legR;
  R.legL.position.z = damp(R.legL.position.z, feet.lz, 30, dt); R.legL.position.y = damp(R.legL.position.y, feet.ly, 30, dt);
  R.legR.position.z = damp(R.legR.position.z, feet.rz, 30, dt); R.legR.position.y = damp(R.legR.position.y, feet.ry, 30, dt);
  R.armL.rotation.x = pose.armL; R.armR.rotation.x = pose.armR; R.armL.rotation.z = pose.armLz; R.armR.rotation.z = pose.armRz;
  R.rig.rotation.set(pose.rigX, pose.rigY, pose.rigZ); R.hips.position.y = R.hipBase + (pose.hipY - .85) * .55; // the new vibers have short legs, so crouches are shallower
  p.squash = damp(p.squash, 0, 8, dt);
  R.rig.scale.set(1 + p.squash * .5, 1 - p.squash, 1 + p.squash * .5);
  // jelly top: vertical speed changes squash it, horizontal ones tip it; damped springs settle it
  const dvy = p.vel.y - R.pvy, dvz = Math.hypot(p.vel.x, p.vel.z) - R.phz; R.pvy = p.vel.y; R.phz = Math.hypot(p.vel.x, p.vel.z);
  R.jv -= clamp(dvy, -25, 25) * .07; R.jrv -= clamp(dvz, -15, 15) * .12;
  R.jv += (-R.j * 140 - R.jv * 8) * dt; R.j += R.jv * dt; R.jrv += (-R.jr * 110 - R.jrv * 7) * dt; R.jr += R.jrv * dt;
  R.top.scale.y = 1 + clamp(R.j, -.4, .4); R.top.rotation.x = clamp(R.jr, -.5, .5) + pose.rigZ * .3;
  // body dynamics for next frame's pose: forward acceleration and turning speed
  R.acc = damp(R.acc || 0, dvz / Math.max(dt, 1e-3), 6, dt);
  const dh = ((p.heading - (R.prevH ?? p.heading)) + Math.PI * 3) % (Math.PI * 2) - Math.PI; R.prevH = p.heading;
  R.bank = damp(R.bank || 0, clamp(-dh / Math.max(dt, 1e-3) * .1, -.3, .3), 8, dt);
  // HEAD ACTING: the head rides its own spring (nods on landings, lags on take-offs and speed-ups),
  // glances around when you stand still, looks down at the landing when falling; pupils follow.
  R.idleT = hs < .3 && p.onGround && game.state === 'play' ? (R.idleT || 0) + dt : 0;
  let lookY = 0, lookX = 0;
  if (R.idleT > 1.2) lookY = Math.sin(t * .8) * .6 * (Math.sin(t * .27) > -.2 ? 1 : 0);
  if (!p.onGround && p.vel.y < -6 && game.state === 'play') lookX = .35;
  R.hpv = (R.hpv || 0) + clamp(dvy, -25, 25) * .025 - clamp(dvz, -15, 15) * .03;
  R.hp = R.hp || 0; R.hpv += (-(R.hp - lookX) * 90 - R.hpv * 10) * dt; R.hp += R.hpv * dt;
  R.head.rotation.x = clamp(R.hp, -.45, .5) - (feet.run ? pose.rigX * .6 : 0); // running: the head stays up, eyes on the course
  R.head.rotation.y = damp(R.head.rotation.y, lookY, 4, dt);
  R.head.rotation.z = damp(R.head.rotation.z, -pose.rigZ * .5, 6, dt); // keeps the eyes level when the body leans
  if (act.pitch !== undefined) R.head.rotation.x = act.pitch;
  if (act.yaw !== undefined) R.head.rotation.y = damp(R.head.rotation.y, act.yaw, 18, dt);
  if (act.roll !== undefined) R.head.rotation.z = damp(R.head.rotation.z, act.roll, 10, dt);
  R.top.rotation.z = damp(R.top.rotation.z, act.top ?? act.topZ ?? 0, 14, dt);
  if (R.cape) R.cape.rotation.x = damp(R.cape.rotation.x, -(.12 + clamp(Math.hypot(p.vel.x, p.vel.z) / 20, 0, 1) * .75 + (p.onGround ? 0 : .2)) + Math.sin(t * 9) * .04, 7, dt); // the cape streams with speed
  for (const q of R.pupils) { q.position.x = q.userData.base.x + R.head.rotation.y * .07; q.position.y = q.userData.base.y - R.head.rotation.x * .06; }
  if (R.glows.length) { // candle flicker for Jack, a slow soul-pulse for Bones
    const f = R.candle ? .82 + .12 * Math.sin(t * 11.3) * Math.sin(t * 7.1 + 1) + .06 * Math.sin(t * 23) : .8 + .2 * Math.sin(t * 2.4);
    for (const g of R.glows) g.material.color.setHex(g.userData.c).multiplyScalar(f);
    if (R.candle) R.candle.intensity = 1.4 * f;
  }
  Sfx.wind(game.state === 'play' ? clamp((-p.vel.y - 9) / 40, 0, .12) + (p.boostT > 0 ? .03 : 0) : 0);
  const blink = (t + R.blinkSeed) % 3.4 < .11; // blink every few seconds
  // expressions: wide eyes when falling fast, squint on a hard landing or while stunned, a bit bigger mid-flip
  const ex = game.state === 'dead' || p.stunT > 0 || p.squash > .15 ? .35 : (!p.onGround && p.vel.y < -12) ? 1.4 : R.flipT >= 0 ? 1.15 : 1;
  R.ex = damp(R.ex || 1, ex, 12, dt);
  for (const e of R.eyes) { e.scale.y = blink ? .15 : R.ex; e.scale.x = Math.max(1, R.ex * .9); }

  playerLight.position.copy(p.pos).y += 1.5;
  playerLight.color.setHex(p.boostT > 0 ? 0xf5c542 : 0x4fc3f7);

  // ribbon trail
  const last = trailPts.pop(); last.copy(p.pos); last.y += 1.1; trailPts.unshift(last);
  const col = TRAILS[profile.trail] || TRAILS.default;
  for (let i = 0; i < TRAIL_N; i++) {
    const a = trailPts[i], b = trailPts[Math.min(i + 1, TRAIL_N - 1)], prev = trailPts[Math.max(i - 1, 0)];
    _f.copy(prev).sub(b); _r.copy(camera.position).sub(a); _f.cross(_r);
    const len = _f.length(), f = 1 - i / (TRAIL_N - 1), w = .1 * f;
    if (len > 1e-5) _f.multiplyScalar(w / len); else _f.set(0, w, 0);
    const o = i * 6; trailPos[o] = a.x + _f.x; trailPos[o + 1] = a.y + _f.y; trailPos[o + 2] = a.z + _f.z; trailPos[o + 3] = a.x - _f.x; trailPos[o + 4] = a.y - _f.y; trailPos[o + 5] = a.z - _f.z;
    const c = f * f * clamp(hs / 10, 0, 1) * .18;
    trailCol[o] = trailCol[o + 3] = col[0] * c; trailCol[o + 1] = trailCol[o + 4] = col[1] * c; trailCol[o + 2] = trailCol[o + 5] = col[2] * c;
  }
  trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true;
}

/* =====================================================================
   4. CAMERA — chase cam: FOV widens with speed, pulls back in the air,
   punches in on landings, rolls on wall-runs, trauma-based shake.
   ===================================================================== */
let airPull = 0, camRoll = 0;
const camBase = new V3(), lookAt = new V3();
const _ray = new V3(), _dir = new V3();
function rayBox(o, d, len, c) { // distance along the ray to an axis-aligned box, or Infinity
  let t0 = 0, t1 = len;
  for (const ax of ['x', 'y', 'z']) {
    if (Math.abs(d[ax]) < 1e-6) { if (o[ax] < c.min[ax] || o[ax] > c.max[ax]) return Infinity; continue; }
    let ta = (c.min[ax] - o[ax]) / d[ax], tb = (c.max[ax] - o[ax]) / d[ax];
    if (ta > tb) { const q = ta; ta = tb; tb = q; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return Infinity;
  }
  return t0;
}
const portraitPull = () => 1 / Math.max(.7, Math.min(1, camera.aspect)); // portrait phones: cinematic shots step back so the runner clears the touch controls
function updateCamera(dt) {
  const p = player, hs = Math.hypot(p.vel.x, p.vel.z);
  airPull = damp(airPull, p.onGround ? 0 : clamp(p.airTime * 1.5, 0, 1.2), 3, dt);
  landPunch = damp(landPunch, 0, 6, dt);
  if (camMode === 'chart') { // side-on: the course reads left→right like a chart, a little ahead of the runner
    const narrow = Math.min(1, camera.aspect); // portrait phones: pull back and centre the runner more
    const dist = (11 + hs * .15 + airPull * 1.5 - landPunch) / Math.max(.6, narrow);
    _v.set(p.pos.x + dist, p.pos.y + 2.6 + airPull * .6, p.pos.z - 4 * narrow); // runner sits left of centre, upcoming candles on the right
    lookAt.set(p.pos.x, p.pos.y + 1.2 + clamp(p.vel.y * .12, -2.5, .8), 0); // peek down into big drops
  } else {
    // high, slightly pulled-back chase cam: the runner sits low in frame and the next candles stay visible
    const far = 1 / Math.max(.75, Math.min(1, camera.aspect)); // portrait phones: a little further back
    const dist = (7.4 + hs * .08 + airPull * .3 - landPunch * .35) * far, height = 4.0 + airPull * .2 + pitch * 2;
    _v.set(p.pos.x + Math.sin(yaw) * dist, p.pos.y + height, p.pos.z + Math.cos(yaw) * dist);
    lookAt.set(p.pos.x - Math.sin(yaw) * 8, p.pos.y + .7 + clamp(p.vel.y * .04, -.6, .4), p.pos.z - Math.cos(yaw) * 8);
    // spring arm: cast a ray from the runner's head to the camera; if a candle is in the way
    // (typically the taller one you just dropped from), pull the camera in to just in front of it
    _ray.set(p.pos.x, p.pos.y + 1.2, p.pos.z); _dir.copy(_v).sub(_ray); const len = _dir.length(); _dir.divideScalar(len);
    let hit = len, box = null;
    for (const c of colliders) {
      if (!c.active || c.type !== 'plat' || c.max.z < p.pos.z - 1 || c.min.z > _v.z + 1) continue;
      const tHit = rayBox(_ray, _dir, len, c); if (tHit > .05 && tHit < hit) { hit = tHit; box = c; } // t≈0: the ray starts inside the ledge you hang from — that one isn't blocking the view
    }
    if (box) { // first try lifting the camera so it looks over the candle (hanging off a ledge, standing under a taller one)
      const lift = _ray.y + (box.max.y + .4 - _ray.y) * len / Math.max(hit, .3);
      if (lift - _v.y < 4) _v.y = Math.max(_v.y, lift); // too tall to look over: pull in instead (a camera inside the runner's head is worse)
      else _v.copy(_ray).addScaledVector(_dir, Math.max(1.2, hit - .35));
    }
  }
  if (game.state === 'dead') { _v.copy(camBase); lookAt.set(p.pos.x, p.pos.y + 1, p.pos.z); } // camera holds and watches the fall
  // CINEMATIC SHOTS (gameplay itself is always from behind):
  //  · countdown: face to face with the runner, then a swing around its side into the chase position at GO
  //  · victory / results: a slow orbit around the runner celebrating at the finish
  if (game.state === 'count') {
    const far = portraitPull();
    _v.set(p.pos.x, p.pos.y + 4.2, p.pos.z + 8.2 * far);
    lookAt.set(p.pos.x, p.pos.y + .8, p.pos.z - 8);
  }
  if (game.state === 'win' || (game.state === 'end' && game.won)) {
    const a = .8 + (settings.calm ? 0 : (performance.now() / 1000 - game.winT0) * .45);
    const W = 4.6 * portraitPull(); _v.set(p.pos.x + Math.sin(a) * W, p.pos.y + 1.8, p.pos.z - Math.cos(a) * W);
    lookAt.set(p.pos.x, p.pos.y + 1.1, p.pos.z);
  }
  if (game.state === 'menu') { // attract mode: slow fly-over along the chart behind the menu
    const z = settings.calm ? 6 : 6 - (performance.now() / 1000 * 2.5) % 360; let pl = platforms.values().next().value;
    for (const q of platforms.values()) if (q.zc >= z) pl = q;
    _v.set(14, pl.top + 4, z); lookAt.set(0, pl.top + 1, 0);
  }
  if (camBase.lengthSq() === 0 || Math.abs(camBase.z - _v.z) > 60) camBase.copy(_v);
  camBase.x = damp(camBase.x, _v.x, 8, dt); camBase.z = damp(camBase.z, _v.z, 8, dt); camBase.y = damp(camBase.y, _v.y, 5, dt); // follows closely, no felt lag
  if (camMode === 'chart' || game.state === 'menu') lookAt.z = camBase.z; // look straight sideways so the backdrop reads flat, like a chart
  trauma = Math.max(0, trauma - 1.5 * dt);
  const s = trauma * trauma;
  camera.position.set(camBase.x + (Math.random() - .5) * s, camBase.y + (Math.random() - .5) * s, camBase.z + (Math.random() - .5) * s);
  camera.lookAt(lookAt);
  camRoll = damp(camRoll, p.wallrun && camMode === 'chase' ? -p.wallNormal * .14 : 0, 6, dt);
  camera.rotateZ(camRoll + (Math.random() - .5) * .06 * s);
  const baseFov = camMode === 'chart' ? (camera.aspect < 1 ? 62 : 55) : 70;
  camera.fov = damp(camera.fov, baseFov + clamp((hs - 6) * .8, 0, 8) + (p.boostT > 0 ? 3 : 0), 2.5, dt) + fovKick * dt * 6;
  camera.updateProjectionMatrix();
  // results after a win: the card covers one side (the bottom on portrait screens), so frame the dancing runner in the free part
  if (game.state === 'end' && game.won) { const W = innerWidth, H = innerHeight, tall = H > W; camera.setViewOffset(W, H, tall ? 0 : -W * .22, tall ? H * .3 : 0, W, H); }
  else if (camera.view?.enabled) camera.clearViewOffset();
  // price axis sits at the right edge of the view (screen-right = -z in chart view)
  const halfW = (camera.position.x - BACK_X) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
  if (camMode === 'chase') priceAxis.position.set(2 * -BACK_X, 0, camera.position.z - 22); // right wall, a little ahead
  else priceAxis.position.set(0, 0, camera.position.z - halfW + 2.6);
  const sparse = camera.aspect < 1; for (const s of priceAxis.children) s.visible = !sparse || (s.userData.lv & 1) === 0; // fewer labels on narrow screens
  priceAxis.visible = lastPriceLabel.visible = game.state !== 'menu';
}

/* HUD */
const el = { score: $('score'), time: $('time'), speed: $('speed'), bar: $('sbar').firstElementChild, prog: $('prog'), ticker: $('ticker'), progbar: $('progbar').firstElementChild };
const cupUsed = () => profile.cup?.week === weekId() ? profile.cup.used : 0;
// Write to the DOM only when a value actually changes: rewriting text/HTML every frame churns layout and GC.
const hudCache = new Map();
function hud(node, key, v) { const id = node.id + key; if (hudCache.get(id) === v) return; hudCache.set(id, v); if (key === 'html') node.innerHTML = v; else if (key === 'text') node.textContent = v; else node.style[key] = v; }
function updateHUD() {
  const playing = game.state === 'play';
  $('routeCue').hidden = $('airCharge').hidden = !playing;
  if (playing) {
    const floor = player.ground, here = floor?.plat, next = platforms.get(here ? here.i + 1 : player.onGround ? 0 : chartIdx + 1);
    const edge = floor ? Math.max(0, player.pos.z - floor.min.z) : 0;
    const groundCue = groundRouteCue(here, next, edge, Math.hypot(player.vel.x, player.vel.z));
    let cue = player.state === 'grind' ? 'ON THE RAIL · JUMP TO EXIT' : player.state === 'swing' ? forwardSwingLaunch(player.vel.x, player.vel.z) ? 'RELEASE GRAB NOW · FORWARD LAUNCH' : 'HOLD GRAB · SWING TOWARD THE NEXT CANDLE' : player.state === 'hang' ? 'HOLD FORWARD · CLIMB THROUGH' : !player.onGround ? landingStatus === 'red' ? 'RED LANDING · KEEP MOVING' : landingStatus === 'edge' ? 'EDGE LANDING · STEER TO THE CENTER' : landingStatus === 'pad' ? 'BLUE PAD LANDING · AIM FOR THE CENTER' : landingStatus === 'miss' ? player.jumpsUsed < 2 ? 'ADJUST YOUR JUMP · NO LANDING YET' : 'STEER TOWARD A CANDLE' : player.jumpsUsed < 2 ? 'AIRBORNE · SECOND JUMP READY' : 'LOOK AHEAD · STICK THE LANDING' : groundCue.text;
    $('routeCue').classList.toggle('danger', player.onGround && groundCue.danger);
    const obstacle = upcomingHazard();
    if (obstacle && !(player.onGround && groundCue.danger)) {
      const h = obstacle.hazard, safe = h.side * player.pos.x > .85;
      cue = `${h.kind === 'laser' ? 'LASER GATE' : 'MINES'} · ${safe ? 'HOLD' : 'MOVE'} ${h.side > 0 ? 'RIGHT' : 'LEFT'} · ${Math.max(0,Math.ceil(player.pos.z - h.z))}m`;
      $('routeCue').classList.toggle('danger', !safe);
    }
    hud($('nextMove'), 'text', cue); hud($('runModeTag'), 'text', settings.autoRun ? 'AUTO-RUN' : 'MANUAL');
    const used = player.onGround ? 0 : Math.max(player.jumpsUsed, player.coyote > 0 ? 0 : 1);
    $('airCharge').querySelectorAll('[data-jump]').forEach((dot, i) => dot.classList.toggle('used', i < used));
    const actionReady = player.onGround ? player.slideT <= 0 && Math.hypot(player.vel.x, player.vel.z) > 4 : !player.dashUsed && !player.wallrun && player.state === 'air';
    $('dashDot').classList.toggle('used', !actionReady);
    hud($('dashLabel'), 'text', player.onGround ? 'SLIDE' : 'DASH');
  }
  const tipEl = $('tip');
  const actionVisible = playing && actionCue.until > score.time;
  $('actionFeedback').hidden = !actionVisible;
  if (actionVisible) { hud($('actionName'), 'text', actionCue.label); hud($('actionDetail'), 'text', actionCue.detail); hud($('actionName'), 'color', actionCue.color); }
  hud(tipEl, 'visibility', actionVisible ? 'hidden' : '');
  if (level.tutorial && game.state === 'play') { hud(tipEl, 'html', coachHint()); tipEl.classList.remove('hidden'); }
  else if (level.tutorial) tipEl.classList.add('hidden');
  const p = player, hs = Math.hypot(p.vel.x, p.vel.z), cb = $('combobar');
  hud(el.score, 'text', (distancePoints(score.dist) + score.style + Math.round(score.pending)).toLocaleString());
  hud(cb, 'opacity', score.combo > 0 ? '1' : '0');
  hud(cb.firstElementChild, 'width', Math.round((p.onGround && p.state === 'air' ? Math.max(0, 1 - p.comboGround / .4) : 1) * 100) + '%');
  comboEl.classList.toggle('idle', score.combo === 0);
  hud(comboEl, 'html', score.combo > 0 ? `${score.combo} LINK<small>×${((1 + score.combo * .25) * (flow ? 1.5 : 1)).toFixed(2)} · ${flow ? 'FLOW' : Math.max(0, 10 - score.combo) + ' TO FLOW'}</small>` : 'JUMP · SLIDE · SWING FOR STYLE');
  hud(el.time, 'text', fmtTime(score.time));
  // split vs your best-run ghost: when did the ghost reach the distance you're at now?
  const sp = $('split');
  if (settings.ghost && ghostData && game.state === 'play' && score.dist > 5) {
    const crossing = ghostSplitAtDistance(ghostData.f, ghostData.t, score.dist, splitI); splitI = crossing.index;
    const d = crossing.time === null ? null : score.time - crossing.time;
    hud(sp, 'text', d === null ? 'BEYOND YOUR BEST DISTANCE' : (d < 0 ? '−' : '+') + Math.abs(d).toFixed(1) + 's vs best-score run'); sp.className = 'num ' + (d !== null && d < 0 ? 'ahead' : 'behind');
  } else hud(sp, 'text', '');
  const k = candles.get(chartIdx), pc = candles.get(chartIdx - 1)?.c ?? k.o, pct = (k.c - pc) / pc * 100;
  hud(el.ticker, 'text', `${level.sprint ? 'SPRINT / ' + SPRINT_ROUTES[level.route || 0].name : level.sym} ${tfOf(level).id} · SIM  ${k.c.toFixed(2)}  ${pct >= 0 ? '▲ +' : '▼ '}${pct.toFixed(2)}%`);
  hud(el.ticker, 'color', pct >= 0 ? PAL.upCss : PAL.dnCss);
  hud(el.speed, 'text', String(Math.round(hs * 3.6)));
  hud(el.bar, 'width', Math.round(clamp(hs / 26 * 100, 0, 100)) + '%');
  const progress = game.won ? 1 : clamp(currentCandle() / level.len, 0, 1);
  hud(el.progbar, 'width', Math.round((level.endless ? (chartIdx % 50) / 50 : progress) * 100) + '%');
  hud(el.prog, 'text', level.endless ? `CANDLE ${Math.floor(chartIdx) + 1}` : Math.round(progress * 100) + '%');
}

/* =====================================================================
   LIVE MINI CHART — the real candle chart of this course, scrolling with
   the runner: past candles solid, upcoming ones dimmed, broken reds hollow,
   a dot for where the runner is (x = progress, y = height as price).
   ===================================================================== */
const chartCv = $('chart'), cx = chartCv.getContext('2d');
let chartIdx = 0, chartView = 0, chartLo = 0, chartHi = 1;
function currentCandle() { // fractional candle index under the runner
  const z = player.pos.z;
  while (chartIdx > gen.cut && platforms.get(chartIdx).col.max.z < z) chartIdx--;
  while (chartIdx < gen.i - 1 && platforms.get(chartIdx + 1).col.max.z >= z) chartIdx++;
  const a = platforms.get(chartIdx).col.max.z, b = chartIdx < gen.i - 1 ? platforms.get(chartIdx + 1).col.max.z : a - 10;
  return chartIdx + clamp((a - z) / (a - b), 0, 1);
}
function drawChart(dt) {
  const r = chartCv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
  if (chartCv.width !== Math.round(r.width * dpr)) { chartCv.width = Math.round(r.width * dpr); chartCv.height = Math.round(r.height * dpr); }
  const W = r.width, H = r.height, AX = 44, PAD = 14, span = W < 260 ? 26 : 40;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.fillStyle = 'rgba(19,23,34,.88)'; cx.fillRect(0, 0, W, H);
  chartView = damp(chartView, currentCandle(), 8, dt);
  const first = chartView - span * .65, i0 = Math.max(gen.cut, Math.floor(first)), i1 = Math.min(gen.i - 1, Math.ceil(first + span));
  let lo = Infinity, hi = -Infinity;
  for (let i = i0; i <= i1; i++) { lo = Math.min(lo, candles.get(i).l); hi = Math.max(hi, candles.get(i).h); }
  if (chartHi <= chartLo + 1) { chartLo = lo; chartHi = hi; } // first frame: snap instead of easing in from 0
  chartLo = damp(chartLo, lo, 4, dt); chartHi = damp(chartHi, hi, 4, dt);
  const cw = (W - AX) / span, py = v => PAD + (chartHi - v) / Math.max(chartHi - chartLo, 1) * (H - PAD * 2);
  cx.strokeStyle = '#2a2e39'; cx.lineWidth = 1; cx.font = '9px monospace'; cx.fillStyle = '#787b86';
  for (let g = 0; g <= 3; g++) { // grid + price axis
    const v = lerp(chartHi, chartLo, g / 3), y = py(v);
    cx.beginPath(); cx.moveTo(0, y); cx.lineTo(W - AX, y); cx.stroke(); cx.fillText(v.toFixed(2), W - AX + 4, y + 3);
  }
  for (let i = i0; i <= i1; i++) {
    const k = candles.get(i), x = (i - first) * cw, green = k.c >= k.o, pl = platforms.get(i);
    cx.globalAlpha = i > chartView + .5 ? .35 : 1;
    cx.strokeStyle = cx.fillStyle = green ? PAL.upCss : PAL.dnCss;
    cx.beginPath(); cx.moveTo(x, py(k.h)); cx.lineTo(x, py(k.l)); cx.stroke();
    const yt = py(Math.max(k.o, k.c)), bh = Math.max(1, py(Math.min(k.o, k.c)) - yt);
    if (pl.broken) cx.strokeRect(x - cw * .35, yt, cw * .7, bh); else cx.fillRect(x - cw * .35, yt, cw * .7, bh);
  }
  cx.globalAlpha = 1;
  const nx = (chartView - first) * cw, ny = py(player.pos.y + 100);
  cx.setLineDash([3, 3]); cx.strokeStyle = '#5d6475'; cx.beginPath(); cx.moveTo(nx, 0); cx.lineTo(nx, H); cx.moveTo(0, ny); cx.lineTo(W - AX, ny); cx.stroke(); cx.setLineDash([]);
  cx.fillStyle = '#2962ff'; cx.fillRect(W - AX, ny - 7, AX, 14); cx.fillStyle = '#fff'; cx.fillText((player.pos.y + 100).toFixed(2), W - AX + 4, ny + 3);
  cx.beginPath(); cx.arc(nx, ny, 4, 0, Math.PI * 2); cx.fillStyle = '#fff'; cx.fill(); cx.strokeStyle = '#2962ff'; cx.lineWidth = 2; cx.stroke();
  cx.fillStyle = '#d1d4dc'; cx.font = 'bold 10px monospace'; cx.fillText(`${level.sym} · SIMULATED · ${tfOf(level).id}`, 6, 11);
}

/* =====================================================================
   MAIN LOOP — fixed 120Hz physics with accumulator; hit-stop slows time.
   ===================================================================== */
const STEP = 1 / 120;
let chartFrame = 0, lastT = performance.now(), acc = 0, autoT = 0, autoN = 0;
resetCourse(); resetPlayer(); renderMenu();
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden || !$('landing').classList.contains('hidden') || game.state === 'pause') { lastT = now; return; }
  const real = (now - lastT) / 1000;
  // Auto quality: after 4 s of real play below ~42 FPS, step down one tier (High → Medium → Low).
  if (settings.quality === 'auto' && game.state === 'play' && real < .25) {
    autoT += real; autoN++;
    if (autoT > 4) { if (autoN / autoT < 42 && autoQ !== 'low') { autoQ = autoQ === 'high' ? 'medium' : 'low'; applySettings(); popup(`Graphics → ${autoQ} for smoother play`, '#8b91a1'); } autoT = autoN = 0; }
  }
  tick(Math.min(real, .05), now); lastT = now;
}

/* DETERMINISTIC SIMULATION — everything that decides a run happens here, in fixed 1/120 s steps, fed only by
   the per-step inputs recorded below (stick, quantized yaw, jump/grab held, jump/slide pressed). Frame rate,
   rendering and particles never touch it, so replayRun(log) lands on exactly the same result: the base for
   server-verified leaderboards (a server replays the log and accepts the score only if it matches). */
let simYaw = 0, runLog = null, recording = true;
const _o = new V3();
function simStep(sample = null) {
  if (game.state !== 'play') return;
  const [ix, iz, yq, bits] = sample || [Math.round(input.ix * 100), Math.round(input.iz * 100), quantizeYaw(yaw),
    (input.jumpHeld ? 1 : 0) | (input.grabHeld ? 2 : 0) | (input.pJump ? 4 : 0) | (input.pSlide ? 8 : 0) | (input.pReset ? 16 : 0)];
  if (recording && runLog) logSample(ix, iz, yq, bits);
  applySample(ix, iz, yq, bits);
  if ((bits & 16) && game.checkpoint && !oneLife()) { jumpBuf = slideBuf = 0; die(true); return; }
  step(STEP); score.time += STEP; simWorld(STEP);
  if (game.state === 'play') checkPickupsAndBounds();
  currentCandle(); streamCourse(chartIdx);
  if (recording && runLog.steps % 6 === 0 && ghostTimes.length < GHOST_MAX) { ghostRec.push(+player.pos.x.toFixed(2), +player.pos.y.toFixed(2), +player.pos.z.toFixed(2), +player.heading.toFixed(2)); ghostTimes.push(score.time); }
  if (recording && runLog?.steps >= MAX_STEPS && game.state === 'play') die();
}
function applySample(ix, iz, yq, bits) {
  input.ix = ix / 100; input.iz = iz / 100; simYaw = yq / 1000; input.jumpHeld = !!(bits & 1); input.grabHeld = !!(bits & 2);
  if (bits & 4) jumpBuf = BUFFER; if (bits & 8) slideBuf = BUFFER; input.pJump = input.pSlide = input.pReset = false;
}
function logSample(ix, iz, yq, bits) { // run-length encoded: [count, ix, iz, yaw, bits, …]
  const r = runLog.rle, n = r.length;
  if (n && r[n - 4] === ix && r[n - 3] === iz && r[n - 2] === yq && r[n - 1] === bits) r[n - 5]++; else r.push(1, ix, iz, yq, bits);
  runLog.steps++;
}
let fogWall = null;
function simWorld(dt) {
  for (const pl of liveCandles) { // LIVE candles bob on game time
    if (!pl.live || pl.broken) continue;
    const off = Math.sin(score.time * 1.6 + pl.live.ph) * pl.live.amp;
    pl.top = pl.live.base + off; pl.bot = pl.live.baseBot + off; pl.col.max.y = pl.top; pl.col.min.y = pl.bot;
  }
  for (const pl of platforms.values()) if (pl.crackT >= 0 && !pl.broken && (pl.crackT += dt) >= pl.breakT) shatter(pl); // red candles break
  if (!level.haunt) return;
  for (const pl of platforms.values()) if (!pl.green && !pl.broken && pl.i > 3) {
    // fair ghosts: they phase in the distance, flicker first, and lock solid once the runner is within reach (ahead or on it)
    const w = Math.sin(score.time * 1.6 + pl.i * 2.4), near = player.pos.z - pl.zc < 16 && player.pos.z - pl.zc > -pl.depth;
    pl.ghost = w < -.78 && pl.crackT < 0 && !near; pl.ghostWarn = !pl.ghost && w < -.5 && w > -.78; pl.col.active = !pl.ghost;
  }
  if (score.time > 3) game.fogZ = Math.min(game.fogZ ?? player.pos.z + 26, player.pos.z + 26) - dt * FOG_SPEED; // leash: it never falls far behind
}
const FOG_SPEED = 8;
function resolveDeath() { // after the death beat: respawn at the checkpoint, back to the start, or (one life) end the run
  $('deathcard').classList.add('hidden');
  if (oneLife() || runLog?.steps >= MAX_STEPS) endRun(false); else if (game.checkpoint) respawn(game.checkpoint); else quickRestart();
}
function runResult(cleared) {
  bankCombo();
  const tf = tfOf(level), par = level.len * (level.tutorial ? 2.2 : level.sprint ? 1.15 : 1.5);
  const timeBonus = cleared ? Math.max(0, Math.round((par - score.time) * 60)) : 0;
  const clean = cleared && !score.deaths ? level.len * 25 : 0;                         // no-death run bonus
  const deathCut = Math.min(.48, score.deaths * .06);                                  // each death −6 % (max −48 %): clean runs rank higher
  const dist = distancePoints(score.dist), total = Math.round((dist + score.style + timeBonus + clean) * tf.mult * (1 - deathCut));
  return { tf, par, timeBonus, clean, dist, total, deathCut };
}
// Replay a recorded run on a freshly built course (same level/timeframe) and return its result. Used to verify scores.
function replayRun(log) {
  validateRunLog(log);
  const savedLevel = level, savedTf = tfPick;
  try {
    recording = false; tfPick = log.course.tf;
    if (log.course.sym === 'ARENA') level = arenaLevel(sanitizeArena(log.course.arena));
    else if (log.course.sym === 'SPRINT') level = makeSprintLevel(log.course.route ?? 0);
    else { const base = LEVELS.find(l => l.sym === log.course.sym); if (!base) throw new Error('Unknown chart'); level = { ...base }; }
    if (level.endless) { if (!/^\d{8}$/.test(String(log.course.seed))) throw new Error('Invalid daily seed'); level.seed = log.course.seed; }
    if (level.cup) { if (!/^\d{4}-W\d{2}$/.test(log.course.period)) throw new Error('Invalid Cup period'); level.period = log.course.period; level.seed = +level.period.replace(/\D/g, '') * 13; }
    if (level.seed !== log.course.seed || TFS.indexOf(tfOf(level)) !== log.course.tf || boardId(level) !== log.board) throw new Error('Replay course mismatch');
    restart(false, true); let consumed = 0;
    const r = log.rle;
    for (let k = 0; k < r.length; k += 5) for (let c = 0; c < r[k]; c++) {
      if (game.state === 'win' || (game.state === 'dead' && oneLife())) throw new Error('Inputs after run end');
      if (game.state === 'dead') game.checkpoint ? respawn(game.checkpoint) : quickRestart();
      simStep(r.slice(k + 1, k + 5)); consumed++;
      if (consumed === MAX_STEPS && game.state === 'play') die();
    }
    const cleared = game.state === 'win', complete = cleared || (game.state === 'dead' && (oneLife() || consumed === MAX_STEPS));
    const res = runResult(cleared);
    return { total: res.total, time: +score.time.toFixed(3), deaths: score.deaths, cleared, complete, steps: consumed, position: player.pos.toArray(), style: score.style };
  } finally { recording = true; level = savedLevel; tfPick = savedTf; clearInput(); game.state = 'menu'; }
}
function tick(dt, now) {
  if (hitStop > 0) { hitStop -= dt; dt *= .08; }
  if (oneLife() && game.state === 'dead' && game.deadT > game.deadDur - .45 && !settings.calm) dt *= .35; // a real slow-motion beat as you go down
  fpsAcc += dt; fpsN++; if (fpsAcc > .5) { $('fps').textContent = Math.round(fpsN / fpsAcc) + ' FPS'; fpsAcc = fpsN = 0; }
  if (game.state === 'pause') dt = 0; // frozen: only render
  fovKick = damp(fovKick, 0, 5, dt); updateDeathFx(dt);
  const t = now / 1000;
  if (game.state === 'play') {
    readMoveInput();
    acc += dt;
    while (acc >= STEP && game.state === 'play') { simStep(); acc -= STEP; } // stop at a death/finish: no steps past the end
    if (game.state !== 'play') acc = 0;
    if (level.sprint && game.state === 'play') {
      const phase = Math.min(2, Math.floor(chartIdx / 20));
      if (phase > game.seg) { game.seg = phase; if (phase > 0) showAction(`SECTION ${phase + 1} / 3`, level.phases?.[phase] || 'Keep your line', '#d9f66f'); }
    }
    if (level.story && game.state === 'play') { // announce each new phase of the chart's market story
      const seg = level.story.findIndex(q => chartIdx / level.len <= q[0]);
      if (seg > game.seg) { game.seg = seg; popup(level.tale.split(' › ')[seg].toUpperCase(), '#d1d4dc'); }
    }
  } else if (game.state === 'dead') {
    const p = player; game.deadT -= dt;
    p.vel.y -= GRAV * 1.3 * dt; p.pos.addScaledVector(p.vel, dt); // keep falling (no collisions) while the camera holds
    if (game.deadT <= 0) resolveDeath();
  } else if (game.state === 'win') {
    game.winT -= dt; if (game.winT <= 0) endRun(true);
  } else if (game.state === 'count') {
    game.countT -= dt;
    if (level.arena && $('arenaBanner').hidden) { // branded intro for arena runs
      const c = level.arena, ab = $('arenaBanner'); ab.style.setProperty('--b', c.c1); ab.style.setProperty('--a', c.c2);
      ab.querySelector('i').textContent = c.t.slice(0, 2); ab.querySelector('b').textContent = `${c.n} arena`;
      ab.querySelector('span').textContent = c.m || `$${c.t} · ${ARENA_STORIES[c.s].tale}`; ab.hidden = false;
      setTimeout(() => ab.hidden = true, 4200);
    }
    const n = game.countT > 0 ? Math.ceil(game.countT / .4) : 0, el = $('count');
    if (n !== game.countN) { game.countN = n; el.textContent = n || 'GO!'; el.classList.remove('beat'); void el.offsetWidth; el.classList.add('beat'); Sfx.count(!n); }
    if (n === 0) { game.state = 'play'; setTimeout(() => { if (game.countN === 0) el.textContent = ''; }, 600); }
  }
  if (dt > 0) { updateWorld(dt, t); updateParticles(dt); updateRunner(dt, t); }
  updateLandingMarker(t);
  updateGhost();
  updateCamera(dt);
  updateChartBackdrop(dt);
  updateHUD();
  if ((chartFrame ^= 1)) drawChart(dt * 2);
  composer.render();
}

/* LANDING — the first screen: a live 3D hero of the runner on a green candle (a looping routine of idle, backflip,
   dance moves, a spin and each viber's own signature move; the head follows the pointer; tap to drop in the next character). Its own small renderer, which only animates while the landing is visible. */
const heroState = { i: VIBERS[viberIdx].haunt ? 0 : viberIdx };
const hero = (() => {
  if (VERIFY_MODE) return { start() {} };
  const cv = $('heroCanvas'), r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.toneMapping = THREE.ACESFilmicToneMapping;
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xdfe6f5, 0x1a1d29, 1.7));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 7, 5); sc.add(key);
  const back = new THREE.DirectionalLight(0x7c95ff, 1.6); back.position.set(-5, 3, -4); sc.add(back);
  const cam = new THREE.PerspectiveCamera(28, 1, .1, 60); cam.position.set(5.2, 2.4, 8.6); cam.lookAt(0, .45, 0);
  const candle = (h, w, col, x, z, top) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, w, 3, .07), new THREE.MeshStandardMaterial({ color: col, roughness: .8 }));
    const grp = new THREE.Group(); grp.position.set(x, 0, z); sc.add(grp);
    m.position.y = top - h / 2; grp.add(m);
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, h + .9, 6), new THREE.MeshLambertMaterial({ color: col })); wick.position.y = top - h / 2 + .1; grp.add(wick);
    return grp;
  };
  candle(1.5, 1.7, 0x26a69a, 0, 0, 0);            // the runner's candle
  // the background candles drift up and down slowly, like a live chart ticking
  const live = [candle(1.1, 1.0, 0xef5350, -2.3, -1.8, -.9), candle(1.4, 1.0, 0x26a69a, 2.3, -2.2, -.4), candle(.9, .8, 0xef5350, -3.8, -3.6, -1.6), candle(1.8, .9, 0x26a69a, 3.9, -4.2, .5)];
  // voxel dust kicked up when the backflip lands
  const dust = Array.from({ length: 8 }, () => { const d = new THREE.Mesh(new THREE.BoxGeometry(.09, .09, .09), new THREE.MeshBasicMaterial({ color: 0xd8dce6, transparent: true, opacity: 0 })); sc.add(d); return d; });
  let dustT = -1, lastCyc = 0, lastNow = 0;
  // soft contact shadow on the candle top, fading as the runner leaves the ground
  const shTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .005; sc.add(shadow);
  let R = null, dropT = -1e9, mx = 0, my = 0;
  const setViberHero = i => { if (R) disposeObj(R.root); R = buildRunner(VIBERS[i], false); sc.add(R.root); $('heroName').textContent = VIBERS[i].name; };
  setViberHero(heroState.i);
  cv.addEventListener('click', () => { heroState.i = (heroState.i + 1) % VIBERS.filter(v => !v.haunt).length; setViberHero(heroState.i); dropT = performance.now(); }); // the next viber drops in
  cv.addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); cv.click(); } });
  addEventListener('pointermove', e => { const b = cv.getBoundingClientRect(); mx = clamp((e.clientX - b.left) / b.width * 2 - 1, -1, 1); my = clamp((e.clientY - b.top) / b.height * 2 - 1, -1, 1); });
  let running = false, t0 = performance.now();
  function frameHero(now) {
    if ($('landing').classList.contains('hidden')) { running = false; return; }
    requestAnimationFrame(frameHero);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * r.getPixelRatio()) || cv.height !== Math.round(h * r.getPixelRatio())) { r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    // 14.5 s routine: idle › backflip › step-touch with claps › spin › arm wave › the viber's own signature move › idle
    const t = settings.calm ? 0 : (now - t0) / 1000, cyc = t % 14.5, k = clamp((cyc - 2) / .95, 0, 1), breathe = Math.sin(t * 2.2);
    const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2, tuck = Math.sin(k * Math.PI);
    const env = (a, b) => clamp((cyc - a) / .3, 0, 1) * clamp((b - cyc) / .3, 0, 1); // eases each dance in and out
    const A = env(3.1, 6.4), sp = clamp((cyc - 6.4) / .9, 0, 1), spe = sp * sp * (3 - 2 * sp), B = env(7.4, 10.4), S = env(10.6, 13.9);
    const step = Math.sin(t * Math.PI * 2), bounce = Math.abs(step), sway = Math.sin(t * Math.PI), q = t * Math.PI * 2;
    const who = VIBERS[heroState.i].name; let g;
    if (who === 'Scout') g = { rigY: Math.sin(t * .8) * .15, armLx: -1.1, armLz: .3, armRx: -.3, armRz: -.2, headX: .1, headY: Math.sin(t * .8) * .14 };                     // checking the route scanner
    else if (who === 'Flux') g = { x: Math.sin(t * 1.4) * .4, rigX: -.12, legL: -.5 * Math.max(0, step), legR: -.5 * Math.max(0, -step), top: Math.sin(t * 3) * .25, armLz: .5, armRz: -.5 }; // moonwalk glide, tipping the cap
    else if (who === 'Relay') g = { armLx: -1.35 + Math.sin(t * 2) * .16, armRx: -.35, armLz: .35, armRz: -.2, headY: Math.sin(t * .8) * .25, headX: .08, rigY: Math.sin(t * .8) * .12 }; // a calm wrist-terminal check and signal wave
    else g = { armLx: -.5, armLz: .25, armRx: -1.1 + Math.sin(t * 3) * .22, armRz: -.45 + Math.sin(t * 2) * .12, headX: .06, headY: Math.sin(t * 2) * .15, rigY: Math.sin(t) * .12 }; // Ember traces a paint stroke
    const G = key => (g[key] || 0) * S, out = Math.sin(sp * Math.PI), idle = 1 - Math.max(A, B, S, tuck, out);
    const crouch = cyc > 1.65 && cyc < 2 ? Math.sin((cyc - 1.65) / .35 * Math.PI / 2) : 0; // arms swing back as it crouches for the flip
    // tapping drops the next viber in from above: a fall, then a squash on landing
    const dk = (now - dropT) / 1000, fall = dk < .35 ? 2.4 * (1 - (dk / .35) ** 2) : 0;
    // squash on the drop-in landing, a crouch before the backflip (anticipation) and a squash when it lands
    const sq = (dk > .35 && dk < .7 ? Math.sin((dk - .35) / .35 * Math.PI) * .2 : 0) + Math.sin(clamp((cyc - 1.65) / .35, 0, 1) * Math.PI / 2) * (cyc < 2 ? .14 : 0)
      + (cyc > 2.95 && cyc < 3.3 ? Math.sin((cyc - 2.95) / .35 * Math.PI) * .16 : 0);
    if (lastCyc < 2.95 && cyc >= 2.95) dustT = 0; lastCyc = cyc;                       // flip landed: kick up dust
    if (dustT >= 0) { dustT += Math.min(.05, (now - lastNow) / 1000); dust.forEach((d, i) => { const a = i / 8 * Math.PI * 2, rr = .35 + dustT * 1.4;
      d.position.set(R.root.position.x + Math.cos(a) * rr, .05 + Math.sin(dustT * 5) * .12, Math.sin(a) * rr); d.material.opacity = Math.max(0, .7 - dustT * 1.6); d.rotation.y = dustT * 4; });
      if (dustT > .5) dustT = -1; }
    lastNow = now;
    live.forEach((c, i) => { c.position.y = Math.sin(t * (.35 + i * .07) + i * 1.9) * .14; });
    R.rig.scale.set(1 + sq * .5, 1 - sq, 1 + sq * .5);
    R.root.position.y = tuck * 1.25 + out * .3 + fall;
    R.root.position.x = step * .22 * A + sway * .16 * B + G('x');
    R.root.rotation.y = .55 + Math.sin(t * .5) * .35 * (1 - Math.max(A, B, S)) + spe * Math.PI * 2;
    R.flip.rotation.x = -Math.PI * 2 * e;
    R.rig.rotation.z = -step * .1 * A + sway * .12 * B; R.rig.rotation.y = G('rigY'); R.rig.rotation.x = G('rigX');
    R.hips.position.y = R.hipBase + breathe * .012 * (1 - tuck) - bounce * .06 * A;
    R.legL.rotation.x = -1.7 * tuck - .5 * Math.max(0, step) * A - .3 * Math.max(0, step) * B + G('legL');
    R.legR.rotation.x = -1.6 * tuck - .5 * Math.max(0, -step) * A - .3 * Math.max(0, -step) * B + G('legR');
    const flipArm = k > 0 ? -1.3 * tuck - (k < .2 ? 1.5 : 0) : 0;
    // dance B waves the arms out to the sides: straight up they'd vanish inside the big head
    R.armL.rotation.x = flipArm - 1.3 * A - .3 * B + G('armLx') + crouch * .9; R.armR.rotation.x = flipArm - 1.3 * A - .3 * B + G('armRx') + crouch * .9;
    R.armL.rotation.z = .14 + breathe * .03 + (.45 * bounce - .1) * A + 1.3 * out + (1.2 + .5 * step) * B + G('armLz');
    R.armR.rotation.z = -.14 - breathe * .03 - (.45 * bounce - .1) * A - 1.3 * out - (1.2 - .5 * step) * B + G('armRz');
    R.top.rotation.z = G('top');
    // between moves the head (and pupils) follow the pointer
    R.head.rotation.x = .12 * bounce * A + .1 * bounce * B + G('headX') + my * .3 * idle;
    R.head.rotation.y = G('headY') + mx * .6 * idle; R.head.rotation.z = step * .12 * A - sway * .1 * B;
    for (const p of R.pupils) { p.position.x = p.userData.base.x + R.head.rotation.y * .07; p.position.y = p.userData.base.y - R.head.rotation.x * .06; }
    const air = R.root.position.y; shadow.position.x = R.root.position.x; shadow.scale.setScalar(1 - Math.min(.5, air * .3)); shadow.material.opacity = 1 - Math.min(.85, air * .5);
    const blink = (t % 3.3) < .1; for (const ey of R.eyes) ey.scale.y = blink ? .15 : 1;
    r.render(sc, cam);
  }
  return { start() { if (!running) { running = true; requestAnimationFrame(frameHero); } } };
})();
function showLanding() { $('landing').classList.remove('hidden'); $('landing').scrollTop = 0; hero.start(); }
function enterGame() { $('landing').classList.add('hidden'); if (profile.xp >= VIBER_XP[heroState.i] && heroState.i !== viberIdx) setViber(heroState.i); }
document.querySelectorAll('[data-play]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); Sfx.init(); enterGame(); }));
document.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', e => {
  if (b.dataset.quickRoute !== undefined) { sprintPick = Number(b.dataset.quickRoute); store.set('cp-sprint-route', sprintPick); }
  e.preventDefault(); level = makeSprintLevel(sprintPick); tfPick = 1; settings.autoRun = true; applySettings();
  $('rankedMode').checked = false; enterGame(); renderMenu(); beginRun();
}));
document.querySelectorAll('[data-terms]').forEach(b => b.addEventListener('click', () => $('terms').classList.remove('hidden')));
document.querySelector('#start .brand').addEventListener('click', showLanding);
hero.start();

applySettings();
for (const d of debris) d.m.visible = true; // hidden objects are skipped by compile, so show them for this one call
if (!VERIFY_MODE) renderer.compile(scene, camera); // pre-compile shaders so nothing compiles mid-run
for (const d of debris) d.m.visible = false;
if (!VERIFY_MODE) requestAnimationFrame(frame);
$('loading').remove();

window.__cp = { buildRunner, VIBERS, setViber, THREE, get runner() { return runner; }, setLevel(i) { level = LEVELS[i].sprint ? makeSprintLevel(sprintPick) : LEVELS[i]; }, get chartIdx() { return chartIdx; }, get dbg() { return { wish: _wish.toArray(), wishLen, camMode }; }, get scene() { return scene; }, get cam() { return camera.position; }, get settings() { return settings; }, rayBox, player, platforms, candles, previewCandles, get level() { return level; }, colliders, rails, poles, orbs, game, score, restart, input, press, release, step, moveAndCollide, readMoveInput, streamCourse,
  simStep, courseConfig, setSprintRoute(i) { const chosen = makeSprintLevel(i); sprintPick = i; if (level.sprint) level = chosen; }, nextLevel: () => nextLevel(level)?.sym, boardId: () => boardId(level), refreshCalendar, parseArena, arenaCode, arenaLevel, setYaw(v) { yaw = v; }, setTimeframe(i) { tfPick = clamp(i | 0, 0, 3); }, get calendar() { return { day: today, season: season.id, daily: LEVELS.find(l => l.endless).seed, cup: LEVELS.find(l => l.cup).period }; }, get counts() { return { platforms: platforms.size, candles: candles.size, colliders: colliders.length, textures: renderer.info.memory.textures }; },
  advance(sec) { for (let s = 0; s < sec; s += 1 / 60) tick(1 / 60, performance.now()); }, // test hook: run frames without rAF
  get finishZ() { return finishZ; }, get lastRun() { return game.lastRun; }, get runLog() { return runLog; }, result: runResult, retryCheckpoint, resolveDeath, replayRun, tick, get camera() { return camera; }, render: () => composer.render(), Sfx, setArena(c) { level = arenaLevel(sanitizeArena(c)); }, // camera/render/Sfx: frame-by-frame video capture (video/capture.mjs)
  verifyArena, arenaMessage, sanitizeArena, tokenCreators };
if (!VERIFY_MODE) api('status').then(s => { if (s.scores) SCORES.address ||= s.scores; onlineAvailable = s.online && s.rules === RULES_VERSION; renderOnline(); loadOnlineBoard(); }).catch(() => renderOnline());
