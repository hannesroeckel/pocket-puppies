/* ==========================================================================
   scenes/room.js — the main scene: a cozy room, the puppy, petting, the
   affection meter, and navigation.

   The room itself is baked into an offscreen canvas once per resize (it never
   animates), so the per-frame cost is one drawImage plus the dog. Same trick
   for the grain + vignette overlay.

   Scene contract (architecture §3): enter / exit / update / draw / pointer,
   plus the optional resize hook. Nothing here touches window listeners.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import {
  TAU, clamp, lerp, smooth, easeOutBack, hump, pt, ell, roundRect, rgba, makeOff,
} from '../engine/draw.js';
import { approach } from '../engine/spring.js';
import { createRng } from '../engine/rng.js';
import { createRig } from '../dog/rig.js';
import { createDogRenderer } from '../dog/draw.js';
import { createIdle } from '../dog/idle.js';
import { createPetting } from '../dog/pet.js';
import { createCare } from '../dog/care.js';
import { createToy } from '../dog/toy.js';
import { createReunion } from '../dog/reunion.js';
import { createTraining } from '../dog/train.js';
import { createVoice } from '../dog/voice.js';
import { createWalk } from '../dog/walk.js';
import { createContest } from '../dog/contest.js';
import { capitalise } from '../state/game.js';
import { createHud } from '../ui/hud.js';
import { createNav } from '../ui/nav.js';
import { createToasts } from '../ui/toast.js';
import { createSheet } from '../ui/sheet.js';
import { createNaming } from '../ui/naming.js';
import { createInstall } from '../ui/install.js';
import { createShop } from '../ui/shop.js';
import { createKennel } from '../ui/kennel.js';
import { createTrickList } from '../ui/tricklist.js';
import { createCollection } from '../ui/collection.js';
import { heartPath } from '../ui/meter.js';
import { drawBowl, drawFind } from './props.js';
/* THE REACHABLE PLAY AREA: the bound every interactive prop is clamped to, and
   the per-frame assertion that says so. See ui/reach.js. */
import reach from '../ui/reach.js';
import { exportSave, importSave, writeNow, clear as clearSave } from '../state/save.js';
import { decayLive, describeGap, reunionIntensity } from '../state/time.js';

const VW = BALANCE.view.W, VH = BALANCE.view.H, FLOOR = BALANCE.view.floorY;
const PA = BALANCE.particles;

/* Room art palette. Scene art, not a design tunable — see ARCHITECTURE §11. */
const C = {
  wallA: '#f9e9cd', wallB: '#f1d6ad', wallC: '#e2bb8c',
  floorA: '#d59a62', floorB: '#bd7f4d',
  base: '#f6e6ca', baseSh: '#d9b989',
  rug1: '#cf6e58', rug2: '#f3e0c2', rug3: '#bd5b4a', rug4: '#8fa89c',
  teal: '#87a89c', tealD: '#6c8b80', tealL: '#a9c4b8',
  frame: '#fdf6e6', frameSh: '#dcc4a0',
  heart: '#f2687e', heart2: '#ffa4b3',
};
const WIN = { x: 210, y: 104, w: 146, h: 214, r: 14 };

/* ==========================================================================
   Baked room art
   ========================================================================== */
function drawWindow(c) {
  const { x, y, w, h } = WIN;
  const bl = c.createRadialGradient(x + w / 2, y + h * 0.55, 20, x + w / 2, y + h * 0.55, w * 1.5);
  bl.addColorStop(0, 'rgba(255,240,199,0.55)');
  bl.addColorStop(0.45, 'rgba(255,236,190,0.20)');
  bl.addColorStop(1, 'rgba(255,236,190,0)');
  c.fillStyle = bl;
  c.fillRect(x - w, y - h * 0.35, w * 3, h * 2.1);

  c.fillStyle = C.frameSh; roundRect(c, x - 11, y - 11, w + 22, h + 22, WIN.r + 7); c.fill();
  c.fillStyle = C.frame; roundRect(c, x - 9, y - 13, w + 18, h + 22, WIN.r + 6); c.fill();

  c.save();
  roundRect(c, x, y, w, h, WIN.r); c.clip();
  const sky = c.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, '#bcdbe4'); sky.addColorStop(0.42, '#d9ebe6');
  sky.addColorStop(0.72, '#f0f0dc'); sky.addColorStop(1, '#f8ecc8');
  c.fillStyle = sky; c.fillRect(x, y, w, h);

  c.fillStyle = 'rgba(255,255,255,0.72)';
  ell(c, x + 42, y + 44, 30, 13); c.fill();
  ell(c, x + 66, y + 37, 22, 11); c.fill();
  ell(c, x + 104, y + 58, 24, 10); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.42)';
  ell(c, x + 30, y + 80, 34, 10); c.fill();

  c.fillStyle = '#b9cdb4';
  c.beginPath(); c.moveTo(x - 4, y + h * 0.70);
  c.quadraticCurveTo(x + w * 0.24, y + h * 0.55, x + w * 0.52, y + h * 0.70);
  c.quadraticCurveTo(x + w * 0.78, y + h * 0.84, x + w + 4, y + h * 0.66);
  c.lineTo(x + w + 4, y + h + 4); c.lineTo(x - 4, y + h + 4); c.closePath(); c.fill();
  c.fillStyle = '#a4bda1';
  c.beginPath(); c.moveTo(x - 4, y + h * 0.82);
  c.quadraticCurveTo(x + w * 0.38, y + h * 0.70, x + w + 4, y + h * 0.86);
  c.lineTo(x + w + 4, y + h + 4); c.lineTo(x - 4, y + h + 4); c.closePath(); c.fill();

  c.strokeStyle = 'rgba(108,124,96,0.85)'; c.lineWidth = 3.4; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x - 2, y + 16); c.quadraticCurveTo(x + 30, y + 26, x + 52, y + 14); c.stroke();
  c.lineWidth = 2.2;
  c.beginPath(); c.moveTo(x + 22, y + 22); c.quadraticCurveTo(x + 30, y + 40, x + 44, y + 46); c.stroke();
  const lv = [[8, 22, 7, 4, -0.4], [24, 16, 8, 4.4, 0.25], [38, 13, 7, 4, -0.2], [50, 16, 6, 3.4, 0.5],
    [30, 33, 6, 3.6, 0.8], [42, 45, 7, 4, 0.35], [16, 28, 6, 3.4, 0.9]];
  c.fillStyle = '#8fa886';
  for (const l of lv) { ell(c, x + l[0], y + l[1], l[2], l[3], l[4]); c.fill(); }

  const sh = c.createLinearGradient(x, y, x + w * 0.8, y + h);
  sh.addColorStop(0, 'rgba(255,255,255,0.34)');
  sh.addColorStop(0.4, 'rgba(255,255,255,0.05)');
  sh.addColorStop(1, 'rgba(255,255,255,0.16)');
  c.fillStyle = sh; c.fillRect(x, y, w, h);
  c.restore();

  c.strokeStyle = C.frame; c.lineWidth = 9;
  c.beginPath(); c.moveTo(x + w / 2, y - 2); c.lineTo(x + w / 2, y + h + 2); c.stroke();
  c.beginPath(); c.moveTo(x - 2, y + h * 0.46); c.lineTo(x + w + 2, y + h * 0.46); c.stroke();
  c.strokeStyle = 'rgba(220,196,160,0.55)'; c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(x + w / 2 + 4.5, y - 2); c.lineTo(x + w / 2 + 4.5, y + h + 2); c.stroke();
  c.beginPath(); c.moveTo(x - 2, y + h * 0.46 + 4.5); c.lineTo(x + w + 2, y + h * 0.46 + 4.5); c.stroke();
  c.strokeStyle = 'rgba(150,110,74,0.35)'; c.lineWidth = 2;
  roundRect(c, x, y, w, h, WIN.r); c.stroke();

  c.fillStyle = C.frame; roundRect(c, x - 19, y + h + 9, w + 38, 13, 5); c.fill();
  c.fillStyle = C.frameSh; roundRect(c, x - 19, y + h + 19, w + 38, 5, 2.5); c.fill();

  c.fillStyle = '#c98a63'; roundRect(c, x + w - 46, y + h - 16, 26, 25, 4); c.fill();
  c.fillStyle = '#b8794f'; roundRect(c, x + w - 49, y + h - 19, 32, 8, 3); c.fill();
  c.strokeStyle = '#7f9a76'; c.lineWidth = 2.4; c.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const a = -1.9 + i * 0.42;
    c.beginPath(); c.moveTo(x + w - 33, y + h - 16);
    c.quadraticCurveTo(x + w - 33 + Math.cos(a) * 12, y + h - 16 + Math.sin(a) * 16,
      x + w - 33 + Math.cos(a) * 20, y + h - 16 + Math.sin(a) * 24 - 6);
    c.stroke();
  }
  c.fillStyle = '#93ad86';
  for (let i = 0; i < 5; i++) {
    const a = -1.9 + i * 0.42;
    ell(c, x + w - 33 + Math.cos(a) * 21, y + h - 16 + Math.sin(a) * 25 - 7, 5.5, 3.4, a + 0.4); c.fill();
  }
}

function drawShelf(c) {
  const sx = 30, sy = 250, sw = 112;
  c.fillStyle = 'rgba(120,74,44,0.14)'; roundRect(c, sx + 16, sy - 96, 74, 84, 4); c.fill();
  c.fillStyle = '#c98f5f'; roundRect(c, sx + 12, sy - 100, 74, 84, 4); c.fill();
  c.fillStyle = '#fdf4e2'; roundRect(c, sx + 18, sy - 94, 62, 72, 2); c.fill();
  c.fillStyle = '#e9c9a2'; roundRect(c, sx + 22, sy - 90, 54, 64, 2); c.fill();
  c.fillStyle = '#c98a52';
  ell(c, sx + 49, sy - 42, 17, 13); c.fill();
  ell(c, sx + 49, sy - 58, 13, 12); c.fill();
  c.beginPath(); c.moveTo(sx + 39, sy - 66); c.lineTo(sx + 35, sy - 78); c.lineTo(sx + 45, sy - 71); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(sx + 59, sy - 66); c.lineTo(sx + 63, sy - 78); c.lineTo(sx + 53, sy - 71); c.closePath(); c.fill();
  c.fillStyle = '#fdf4e2'; ell(c, sx + 49, sy - 52, 6, 5); c.fill();
  c.fillStyle = '#4a352a';
  ell(c, sx + 44, sy - 60, 1.7, 2.1); c.fill();
  ell(c, sx + 54, sy - 60, 1.7, 2.1); c.fill();
  ell(c, sx + 49, sy - 54, 2.2, 1.7); c.fill();

  c.fillStyle = 'rgba(120,74,44,0.16)'; roundRect(c, sx - 2, sy + 8, sw + 4, 7, 3); c.fill();
  c.fillStyle = '#d19a68'; roundRect(c, sx - 4, sy, sw + 8, 9, 3); c.fill();
  c.fillStyle = '#e0ac7c'; roundRect(c, sx - 4, sy, sw + 8, 4, 2); c.fill();

  c.fillStyle = C.tealD; roundRect(c, sx + 4, sy - 26, 9, 26, 1.6); c.fill();
  c.fillStyle = '#cf6e58'; roundRect(c, sx + 14, sy - 31, 8, 31, 1.6); c.fill();
  c.fillStyle = '#e0b06a'; roundRect(c, sx + 23, sy - 22, 10, 22, 1.6); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.30)';
  roundRect(c, sx + 5.5, sy - 22, 6, 2.2, 1); c.fill();
  roundRect(c, sx + 15.5, sy - 26, 5, 2.2, 1); c.fill();

  c.fillStyle = '#c98a63'; roundRect(c, sx + 84, sy - 20, 22, 20, 4); c.fill();
  c.fillStyle = '#b8794f'; roundRect(c, sx + 81, sy - 23, 28, 7, 3); c.fill();
  c.strokeStyle = '#84a179'; c.lineWidth = 2; c.lineCap = 'round';
  const vines = [[0, 26, 10], [6, 40, -8], [-6, 32, 16]];
  for (const v of vines) {
    c.beginPath(); c.moveTo(sx + 95 + v[0], sy - 18);
    c.bezierCurveTo(sx + 95 + v[0] + v[2], sy - 18 + v[1] * 0.4, sx + 95 + v[0] - v[2], sy - 18 + v[1] * 0.7,
      sx + 95 + v[0] + v[2] * 0.5, sy - 18 + v[1]);
    c.stroke();
    c.fillStyle = '#93ad86';
    for (let lf = 1; lf <= 3; lf++) {
      const tt = lf / 3.4;
      ell(c, sx + 95 + v[0] + v[2] * tt * 1.1, sy - 18 + v[1] * tt, 4.6, 3, tt * 2); c.fill();
    }
    c.strokeStyle = '#84a179';
  }
}

function drawBone(c, bx, by, rot) {
  c.save(); c.translate(bx, by); c.rotate(rot);
  c.fillStyle = 'rgba(104,58,32,0.18)'; roundRect(c, -19, 3, 40, 8, 4); c.fill();
  c.fillStyle = '#f4e6cb';
  roundRect(c, -16, -4, 34, 9, 4.5); c.fill();
  ell(c, -16, -5, 7, 6); c.fill(); ell(c, -16, 3, 6.4, 5.6); c.fill();
  ell(c, 18, -5, 7, 6); c.fill(); ell(c, 18, 3, 6.4, 5.6); c.fill();
  c.strokeStyle = 'rgba(124,74,47,0.32)'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(-13, -8); c.quadraticCurveTo(-22, -9, -22, -3);
  c.quadraticCurveTo(-23, 4, -16, 4); c.stroke();
  c.fillStyle = 'rgba(210,180,140,0.5)'; roundRect(c, -8, 1.4, 20, 2.6, 1.3); c.fill();
  c.restore();
}

function drawPouf(c) {
  c.save();
  c.fillStyle = 'rgba(88,48,26,0.22)'; ell(c, -6, 836, 116, 26); c.fill();
  const g = c.createLinearGradient(-70, 760, 60, 870);
  g.addColorStop(0, C.tealL); g.addColorStop(0.5, C.teal); g.addColorStop(1, C.tealD);
  c.fillStyle = g; ell(c, -14, 830, 106, 58); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.16)'; ell(c, -32, 812, 52, 20, -0.24); c.fill();
  c.strokeStyle = 'rgba(70,92,84,0.45)'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(-118, 826); c.quadraticCurveTo(-16, 796, 88, 830); c.stroke();
  c.setLineDash([5, 7]); c.lineWidth = 1.6; c.strokeStyle = 'rgba(253,244,226,0.5)';
  c.beginPath(); c.moveTo(-116, 834); c.quadraticCurveTo(-16, 804, 86, 838); c.stroke();
  c.setLineDash([]);
  c.restore();
}

/* THE RUG'S TWO PALETTES. `rugBlue` is a CARE unlock (220 points) and this is
   what it buys — the one reward in the table that changes the room itself.
   Coins cannot reach it: nothing in the shop names `rugBlue`, and
   `game.buyItem` refuses any id that appears in the unlocks table. */
const RUG = {
  warm: { edge: '#e9d3ac', a: '#d97a62', mid: '#cf6e58', b: '#b85a48',
          band: '#f3e0c2', ring: '#8fa89c', in1: '#cf7460', in2: '#bd5b4a',
          heart: '#e2937c', stitch: 'rgba(253,244,226,0.55)' },
  /* cooler, softer, and DARKER-MODE FRIENDLY: the warm rug is the brightest
     thing on screen at night, which is why the blue one is the reward rather
     than a second red */
  blue: { edge: '#cfd9d2', a: '#6f93a8', mid: '#5d8399', b: '#4a6c80',
          band: '#e6ecdf', ring: '#8fa89c', in1: '#6d94a4', in2: '#4f7385',
          heart: '#8fb3bd', stitch: 'rgba(240,248,244,0.55)' },
};

function drawRug(c, pal) {
  const R = pal || RUG.warm;
  const cx = 192, cy = 698, rx = 196, ry = 84;
  c.save();
  c.fillStyle = 'rgba(104,58,32,0.13)'; ell(c, cx + 3, cy + 7, rx * 1.01, ry * 1.02); c.fill();
  c.strokeStyle = R.edge; c.lineWidth = 3; c.lineCap = 'round';
  for (let f = 0; f < 30; f++) {
    const a = (f / 30) * TAU;
    const ex = cx + Math.cos(a) * rx, ey = cy + Math.sin(a) * ry;
    c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex + Math.cos(a) * 11, ey + Math.sin(a) * 7); c.stroke();
  }
  const g = c.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
  g.addColorStop(0, R.a); g.addColorStop(0.5, R.mid); g.addColorStop(1, R.b);
  c.fillStyle = g; ell(c, cx, cy, rx, ry); c.fill();
  c.fillStyle = R.band; ell(c, cx, cy, rx * 0.88, ry * 0.85); c.fill();
  c.fillStyle = R.ring; ell(c, cx, cy, rx * 0.80, ry * 0.76); c.fill();
  c.fillStyle = R.band; ell(c, cx, cy, rx * 0.74, ry * 0.70); c.fill();
  const g2 = c.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
  g2.addColorStop(0, R.in1); g2.addColorStop(1, R.in2);
  c.fillStyle = g2; ell(c, cx, cy, rx * 0.64, ry * 0.60); c.fill();
  c.fillStyle = R.heart; ell(c, cx, cy, rx * 0.30, ry * 0.30); c.fill();
  c.fillStyle = R.band; ell(c, cx, cy, rx * 0.22, ry * 0.22); c.fill();
  c.fillStyle = R.ring; ell(c, cx, cy, rx * 0.11, ry * 0.11); c.fill();
  c.setLineDash([7, 9]); c.lineWidth = 2.2;
  c.strokeStyle = R.stitch;
  c.beginPath(); c.ellipse(cx, cy, rx * 0.955, ry * 0.94, 0, 0, TAU); c.stroke();
  c.strokeStyle = 'rgba(120,66,42,0.22)';
  c.beginPath(); c.ellipse(cx, cy, rx * 0.70, ry * 0.655, 0, 0, TAU); c.stroke();
  c.setLineDash([]);
  c.strokeStyle = 'rgba(120,66,42,0.10)'; c.lineWidth = 2;
  for (let s = 0; s < 16; s++) {
    const a = (s / 16) * TAU;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * rx * 0.24, cy + Math.sin(a) * ry * 0.24);
    c.lineTo(cx + Math.cos(a) * rx * 0.62, cy + Math.sin(a) * ry * 0.58);
    c.stroke();
  }
  c.globalAlpha = 0.07; c.strokeStyle = '#6b3a24'; c.lineWidth = 1;
  for (let w = -rx; w < rx; w += 6) {
    c.beginPath(); c.moveTo(cx + w, cy - ry); c.lineTo(cx + w, cy + ry); c.stroke();
  }
  c.globalAlpha = 1;
  c.restore();
}

function buildGrain(rng) {
  const S = 140, g = makeOff(S, S), gc = g.getContext('2d');
  const img = gc.createImageData(S, S), d = img.data;
  for (let i = 0; i < S * S; i++) {
    const warm = rng.next() > 0.5;
    d[i * 4 + 0] = warm ? 255 : 120;
    d[i * 4 + 1] = warm ? 238 : 72;
    d[i * 4 + 2] = warm ? 205 : 44;
    d[i * 4 + 3] = Math.floor(Math.pow(rng.next(), 1.7) * 38);
  }
  gc.putImageData(img, 0, 0);
  return g;
}

/* ==========================================================================
   The scene
   ========================================================================== */
export function createRoomScene() {
  let app = null;
  let rig = null, dog = null, idle = null, pet = null;
  let care = null, toy = null, reunion = null, naming = null;
  let train = null, voice = null, walk = null, contest = null;
  let hud = null, nav = null, toasts = null, sheet = null, install = null;
  let shop = null, kennel = null, tricks = null, collection = null;
  let roomCv = null, ovCv = null;
  /* the last view wrapper handed to draw(). Text cannot be measured without
     one, and the toast probe is asked outside of a draw. */
  let lastG = null;
  /* CONTENTED PANTING (research §1.9). Driven off the rig's own `drive.pant`
     channel rather than by a clip, because panting is a STATE he is in, not an
     event that happens. Sparse and jittered: this is the only sound in the game
     that repeats without her doing anything, which makes it the only one that
     can become irritating. */
  let pantIn = 0;
  const rng = createRng(BALANCE.rng.seed).fork(3);
  const roomRng = createRng(BALANCE.rng.roomSeed);
  const parts = [];
  const motes = [];
  let time = 0;
  let capture = '';
  let pressedNav = null;
  let pendingNaming = false;
  let sheetKind = '';           // 'care' | 'settings'
  let hintBeforeWalk = '';      // the hint line, parked while he is out

  /* WHERE HIS EYES WANDER WHEN NOBODY IS DOING ANYTHING.
     The ball's entry was a SIXTH hardcoded copy of the ball's position — (330,
     730), which was already 6 units off the 736 it was meant to name and would
     now be 40 off, so he would idly stare at a patch of rug where the ball used
     to be. It is a live getter onto the real toy instead. `rng.pick()` hands the
     whole object back and the caller reads `.x`/`.y` off it, so a getter is all
     this took. */
  const POI = [
    { x: 66, y: 608, w: 1.3 },    // food bowl
    { get x() { return toy ? toy.toy.x : 330; },
      get y() { return toy ? toy.toy.y : 700; }, w: 1.4 },   // the ball, live
    { x: 283, y: 212, w: 1.2 },   // window
    { x: 96, y: 786, w: 0.9 },    // bone
    { x: 126, y: 230, w: 0.8 },   // shelf plant
    { x: 190, y: 900, w: 1.6 },   // the viewer
  ];

  /* ---- particles --------------------------------------------------- */
  function spawn(kind, vx, vy, size) {
    const scale = app && app.reduced ? BALANCE.reducedMotion.particleScale : 1;
    if (parts.length > PA.max * scale) parts.shift();
    const heart = kind === 'heart';
    parts.push({
      k: heart ? 0 : 1, x: vx, y: vy,
      s: size || (heart ? rng.span(PA.heartSize) * (0.7 + (app ? app.game.affection : 0) * 0.6) : rng.span(PA.sparkSize)),
      vx: rng.span(PA.vx), vy: rng.span(PA.vy),
      life: 0, dur: heart ? rng.span(PA.heartDur) : rng.span(PA.sparkDur),
      rot: rng.range(-0.4, 0.4), rv: rng.range(-1.4, 1.4), ph: rng.range(0, TAU),
      hue: rng.next() < 0.35 ? 1 : 0,
    });
  }
  function ringPuff(vx, vy) {
    parts.push({ k: 2, x: vx, y: vy, s: 6, vx: 0, vy: 0, life: 0, dur: PA.ringDur, rot: 0, rv: 0, ph: 0, hue: 0 });
  }
  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.dur) { parts.splice(i, 1); continue; }
      if (p.k !== 2) {
        p.x += (p.vx + Math.sin(p.ph + p.life * PA.swayRate) * PA.sway) * dt;
        p.y += p.vy * dt;
        p.vy += PA.gravity * dt;
        p.rot += p.rv * dt;
      }
    }
  }
  function sparkPath(c, x, y, s, rot) {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.beginPath();
    c.moveTo(0, -s);
    c.quadraticCurveTo(s * 0.17, -s * 0.17, s, 0);
    c.quadraticCurveTo(s * 0.17, s * 0.17, 0, s);
    c.quadraticCurveTo(-s * 0.17, s * 0.17, -s, 0);
    c.quadraticCurveTo(-s * 0.17, -s * 0.17, 0, -s);
    c.closePath(); c.restore();
  }
  function drawParts(c) {
    for (const p of parts) {
      const u = p.life / p.dur;
      if (p.k === 0) {
        const a = u < 0.16 ? smooth(u / 0.16) : 1 - smooth((u - 0.16) / 0.84);
        const s = p.s * (u < 0.18 ? easeOutBack(u / 0.18, 2.4) : 1 + (u - 0.18) * 0.30);
        c.globalAlpha = a * 0.94;
        heartPath(c, p.x, p.y, s, p.rot + Math.sin(p.ph + p.life * 2.2) * 0.16);
        c.fillStyle = p.hue ? C.heart2 : C.heart; c.fill();
        c.globalAlpha = a * 0.5;
        heartPath(c, p.x - p.s * 0.22, p.y - p.s * 0.30, s * 0.30, p.rot);
        c.fillStyle = 'rgba(255,255,255,0.8)'; c.fill();
      } else if (p.k === 1) {
        const a = hump(u);
        c.globalAlpha = a * 0.95;
        sparkPath(c, p.x, p.y, p.s * (0.5 + a * 0.8), p.rot + p.life * 2.0);
        c.fillStyle = p.hue ? '#fff4c8' : '#ffe9a8'; c.fill();
      } else {
        const a = 1 - u;
        c.globalAlpha = a * 0.5;
        c.strokeStyle = 'rgba(255,240,205,0.95)'; c.lineWidth = 2.4 * a;
        ell(c, p.x, p.y, p.s + u * PA.ringGrow, (p.s + u * PA.ringGrow) * 0.34); c.stroke();
      }
    }
    c.globalAlpha = 1;
  }

  /* ---- dust motes in the light beam -------------------------------- */
  function initMotes() {
    motes.length = 0;
    const n = Math.round(PA.motes * (app && app.reduced ? BALANCE.reducedMotion.moteScale : 1));
    for (let i = 0; i < n; i++) {
      motes.push({
        x: roomRng.range(20, 360), y: roomRng.range(120, 760), r: roomRng.range(0.8, 2.3),
        sp: roomRng.span(PA.moteSpeed), ph: roomRng.range(0, TAU), a: roomRng.range(0.12, 0.42),
      });
    }
  }
  function drawMotes(c, dt) {
    c.fillStyle = '#fff3ce';
    for (const m of motes) {
      m.y -= m.sp * dt * PA.moteRise;
      m.x -= m.sp * dt * PA.moteDrift;
      m.ph += dt * 1.7;
      if (m.y < 90) { m.y = 790; m.x = rng.range(60, 380); }
      if (m.x < -20) m.x = 380;
      const band = clamp(1 - Math.abs((m.x + (m.y - 140) * 0.42) - 300) / 210, 0, 1);
      c.globalAlpha = m.a * band * (0.55 + 0.45 * Math.sin(m.ph));
      if (c.globalAlpha > 0.01) { ell(c, m.x, m.y, m.r, m.r); c.fill(); }
    }
    c.globalAlpha = 1;
  }

  /* ---- baked layers ----------------------------------------------- */
  /* pronoun-parameterised, like every other line the room says */
  const rugToast = (P) => `A new rug turned up for ${P.them}`;

  /** which rug is on the floor. A CARE unlock, read from carePoints only. */
  function rugPalette() {
    return (app && app.game && app.game.isUnlocked('rugBlue')) ? RUG.blue : RUG.warm;
  }
  /* the room art is a prebuilt offscreen canvas, so the rug changing means
     rebuilding it — once, on the frame the unlock lands, not every frame */
  let rugShown = '';

  function buildRoom(view) {
    rugShown = (app && app.game && app.game.isUnlocked('rugBlue')) ? 'blue' : 'warm';
    roomRng.reseed(BALANCE.rng.roomSeed);
    roomCv = makeOff(view.cw, view.ch);
    const c = roomCv.getContext('2d');
    c.setTransform(view.dpr * view.vs, 0, 0, view.dpr * view.vs, view.dpr * view.offX, view.dpr * view.offY);
    c.lineJoin = 'round'; c.lineCap = 'round';
    const BX = view.bleedX + 8, BY = view.bleedY + 8;
    const x0 = -BX, x1 = VW + BX, w = x1 - x0;

    const g = c.createLinearGradient(0, -BY, 0, FLOOR + 10);
    g.addColorStop(0, C.wallA); g.addColorStop(0.5, C.wallB); g.addColorStop(1, C.wallC);
    c.fillStyle = g; c.fillRect(x0, -BY, w, FLOOR + BY + 2);

    c.save(); c.globalAlpha = 0.05; c.fillStyle = '#b0774a';
    for (let sx = x0; sx < x1; sx += 28) c.fillRect(sx, -BY, 11, FLOOR + BY);
    c.restore();
    const wf = c.createLinearGradient(0, FLOOR - 120, 0, FLOOR);
    wf.addColorStop(0, 'rgba(150,96,58,0)'); wf.addColorStop(1, 'rgba(150,96,58,0.16)');
    c.fillStyle = wf; c.fillRect(x0, FLOOR - 120, w, 120);

    drawWindow(c);
    drawShelf(c);

    c.save();
    c.beginPath();
    c.moveTo(WIN.x - 6, WIN.y + 6);
    c.lineTo(WIN.x + WIN.w + 6, WIN.y + 6);
    c.lineTo(WIN.x + WIN.w - 104, VH + 40);
    c.lineTo(WIN.x - 262, VH + 40);
    c.closePath();
    const lg = c.createLinearGradient(WIN.x + WIN.w, WIN.y, WIN.x - 170, VH - 40);
    lg.addColorStop(0, 'rgba(255,241,197,0.40)');
    lg.addColorStop(0.35, 'rgba(255,235,183,0.20)');
    lg.addColorStop(0.75, 'rgba(255,230,178,0.07)');
    lg.addColorStop(1, 'rgba(255,230,178,0)');
    c.fillStyle = lg; c.fill();
    c.restore();

    c.fillStyle = C.base; c.fillRect(x0, FLOOR - 27, w, 27);
    c.fillStyle = 'rgba(255,255,255,0.42)'; c.fillRect(x0, FLOOR - 27, w, 4);
    c.fillStyle = C.baseSh; c.fillRect(x0, FLOOR - 7, w, 7);
    c.fillStyle = 'rgba(110,64,38,0.30)'; c.fillRect(x0, FLOOR - 1.6, w, 2.6);

    const fg = c.createLinearGradient(0, FLOOR, 0, VH + BY);
    fg.addColorStop(0, '#dda469'); fg.addColorStop(0.34, C.floorA);
    fg.addColorStop(0.75, C.floorB); fg.addColorStop(1, '#a86f42');
    c.fillStyle = fg; c.fillRect(x0, FLOOR, w, VH + BY - FLOOR);

    c.save();
    c.strokeStyle = 'rgba(150,92,52,0.34)'; c.lineWidth = 1.4;
    const rows = []; let yy = FLOOR, k = 0;
    while (yy < VH + BY) { rows.push(yy); yy += 7 + Math.pow(k, 1.55) * 2.6; k++; }
    for (let r = 1; r < rows.length; r++) {
      c.beginPath(); c.moveTo(x0, rows[r]); c.lineTo(x1, rows[r]); c.stroke();
      c.strokeStyle = 'rgba(255,226,182,0.22)';
      c.beginPath(); c.moveTo(x0, rows[r] + 1.6); c.lineTo(x1, rows[r] + 1.6); c.stroke();
      c.strokeStyle = 'rgba(150,92,52,0.34)';
    }
    c.strokeStyle = 'rgba(150,92,52,0.26)'; c.lineWidth = 1.2;
    for (let r = 1; r < rows.length; r++) {
      const span = rows[r] - rows[r - 1];
      const step = 60 + span * 3.2;
      const jitter = ((r * 37) % 53) / 53 * step;
      for (let jx = x0 + jitter; jx < x1; jx += step) {
        c.beginPath(); c.moveTo(jx, rows[r - 1]); c.lineTo(jx, rows[r]); c.stroke();
      }
    }
    c.globalAlpha = 0.10; c.strokeStyle = '#8d5730'; c.lineWidth = 1;
    for (let i = 0; i < 70; i++) {
      const gy = FLOOR + Math.pow(roomRng.next(), 0.7) * (VH + BY - FLOOR);
      const gx = x0 + roomRng.next() * w, gl = 20 + roomRng.next() * 90;
      c.beginPath(); c.moveTo(gx, gy);
      c.quadraticCurveTo(gx + gl * 0.5, gy + roomRng.range(-1.4, 1.4), gx + gl, gy); c.stroke();
    }
    c.globalAlpha = 1;
    c.restore();

    c.save();
    c.beginPath(); c.rect(x0, FLOOR, w, VH + BY - FLOOR); c.clip();
    const pg = c.createRadialGradient(150, 700, 20, 150, 700, 300);
    pg.addColorStop(0, 'rgba(255,240,196,0.34)');
    pg.addColorStop(0.5, 'rgba(255,236,188,0.13)');
    pg.addColorStop(1, 'rgba(255,236,188,0)');
    c.fillStyle = pg;
    c.save(); c.translate(150, 700); c.scale(1, 0.5); c.translate(-150, -700);
    c.fillRect(-200, 400, 900, 600);
    c.restore();
    c.restore();

    drawRug(c, rugPalette());
    drawBone(c, 96, 792, -0.22);
    drawPouf(c);
    /* The bowls and the ball are NOT baked any more: they are the same objects
       the care actions and the toy pick up, so they have to be live. She drags
       the bowl that was already sitting by the wall. */

    const ao = c.createLinearGradient(0, FLOOR, 0, FLOOR + 70);
    ao.addColorStop(0, 'rgba(110,60,32,0.26)'); ao.addColorStop(1, 'rgba(110,60,32,0)');
    c.fillStyle = ao; c.fillRect(x0, FLOOR, w, 70);
  }

  function buildOverlay(view) {
    ovCv = makeOff(view.cw, view.ch);
    const c = ovCv.getContext('2d');
    const grain = buildGrain(createRng(BALANCE.rng.roomSeed + 5));
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 0.55;
    c.fillStyle = c.createPattern(grain, 'repeat');
    c.fillRect(0, 0, view.cw, view.ch);
    c.globalAlpha = 1;

    c.setTransform(view.dpr * view.vs, 0, 0, view.dpr * view.vs, view.dpr * view.offX, view.dpr * view.offY);
    const BX = view.bleedX + 8, BY = view.bleedY + 8;
    const vg = c.createRadialGradient(VW / 2, VH / 2 * 0.92, VH * 0.24, VW / 2, VH / 2, VH * 0.78);
    vg.addColorStop(0, 'rgba(70,34,14,0)');
    vg.addColorStop(0.62, 'rgba(70,34,14,0.05)');
    vg.addColorStop(1, 'rgba(62,28,12,0.30)');
    c.fillStyle = vg; c.fillRect(-BX, -BY, VW + BX * 2, VH + BY * 2);
    const bs = c.createLinearGradient(0, VH - 118, 0, VH + BY);
    bs.addColorStop(0, 'rgba(58,28,12,0)');
    bs.addColorStop(0.55, 'rgba(58,28,12,0.14)');
    bs.addColorStop(1, 'rgba(52,24,10,0.44)');
    c.fillStyle = bs; c.fillRect(-BX, VH - 118, VW + BX * 2, VH + BY - (VH - 118));
    const ts = c.createLinearGradient(0, -BY, 0, 120);
    ts.addColorStop(0, 'rgba(255,240,206,0.20)');
    ts.addColorStop(1, 'rgba(255,240,206,0)');
    c.fillStyle = ts; c.fillRect(-BX, -BY, VW + BX * 2, 120 + BY);
  }

  /* ---- copy swept in passing (stage 4) ---------------------------------
     These are stage-1/2 strings that hardcoded "her". The gift puppy is a MALE
     Schnoodle, so "Stroke her" was simply wrong on screen — caught by looking
     at a stage-4 screenshot. Parameterised here the way stage 3 did with its
     one inherited string (ARCHITECTURE §13.5); the rest of the older copy is
     still being swept separately. Stage 4's OWN copy is all in `COPY` at the
     top of dog/walk.js. */
  const strokeHint = () => {
    const P = app.game.pron;
    return app.game.isNamed ? `Stroke ${P.them}` : 'Stroke the puppy';
  };

  /* ---- care sheet: THE INSPECT SCREEN ------------------------------
     Four actions, and beside each one the WORD-SCALE state of the need it
     serves — `Full`, `Quenched`, `Clean`, `Bouncy`. This is the original's
     status readout: words, never bars, and no affection row of any kind. */
  function openCare() {
    const g = app.game;
    sheetKind = 'care';
    const P = g.pron;
    sheet.open({
      title: `How ${P.is} ${P.they}?`,
      rows: [
        { id: 'feed', label: 'Feed', note: 'Pour a bowl', right: g.describeNeed('hunger') },
        { id: 'water', label: 'Water', note: `Fill ${P.their} bowl`, right: g.describeNeed('thirst') },
        { id: 'wash', label: 'Wash', note: 'Scrub the dirt out', right: g.describeNeed('cleanliness') },
        { id: 'brush', label: 'Brush', note: 'With the grain', right: g.describeGloss() },
        { id: 'close', label: 'Done' },
      ],
    });
  }

  /* ---- the More sheet (stage 9) ---------------------------------------
     The four destinations the nav shed when it went from eight pills to five.
     A sheet rather than a grid or a second bar because all four of these were
     ALREADY sheet-shaped surfaces, so nothing changes register on the way in —
     and because the sheet's rows have room for a line of copy, which is more
     than the 40-unit pills they replace ever had.

     Every row here routes to the same function the old pill called. There is no
     second path to any of these surfaces and no logic lives in this sheet. */
  function openMore() {
    sheetKind = 'more';
    sheet.open({
      title: 'More',
      rows: [
        { id: 'shop', label: 'Shop', note: 'Food, toys and something to wear' },
        { id: 'dogs', label: 'Dogs', note: 'Who is home, and who is waiting' },
        { id: 'ring', label: 'The ring', note: 'Disc, agility and obedience' },
        { id: 'settings', label: 'Settings', note: 'Sound, name and saving' },
        { id: 'close', label: 'Done' },
      ],
    });
  }

  function navAction(a, n) {
    /* HE IS OUT. Everything in-room is unavailable, said once and warmly —
       never as an error, and the walk button is how you get him back.
       `more` passes because Settings lives behind it now, and renaming lives
       behind Settings: the away state used to let 'settings' through for
       exactly this reason and the exemption moved with the surface. The rows
       INSIDE More still go through the arbiter, so Shop/Dogs/Ring each refuse
       with the away line rather than opening over an absent dog. */
    if (walk && walk.away && n.id !== 'more' && n.id !== 'walk') {
      toasts.show(walk.COPY.awayBusy(a.game.pron));
      return;
    }
    if (n.id === 'care') { openCare(); return; }
    if (n.id === 'more') { openMore(); return; }
    if (n.id === 'settings') { openSettings(); return; }
    if (n.id === 'train') { startTrain(); return; }
    if (n.id === 'walk') { startWalk(); return; }
    if (n.id === 'ring') { startContest(); return; }
    if (n.id === 'shop') { openShop(); return; }
    if (n.id === 'dogs') { openKennel(); return; }
    if (n.id === 'play') {
      /* Play is not a scene: the ball is in the room. Point at it and get out
         of the way — flicking it up-screen is the whole interface. */
      if (toy.busy) {
        const P = a.game.pron;
        toasts.show(`${capitalise(P.they)} ${P.has} gone after it`);
        return;
      }
      /* ONE MESSAGE, NOT TWO. This set a hud hint AND a toast that said the
         same thing in different words, at the same moment, and the toast landed
         on the ball it was naming (docs/FEEDBACK-QUEUE.md 5). The hint is the
         one to keep: it lives at the top of the screen, it stays up while she
         works out what to do, and it cannot cover anything. */
      hud.setHint('Flick the ball up-screen — never sideways');
      return;
    }
    /* NO "COMING SOON" ANY MORE (GIFT-READY quality item 2.3). Every id in
       the nav is handled above; `shop` was the last stub and stage 6 built it.
       This line is now a programmer's backstop for an id nobody wired, not a
       thing a player can reach — so it says nothing rather than promising a
       feature. Reaching it is a bug, and a silent one is better than a lie. */
    if (!a.nav.go(n.id)) blockedToast('');
  }

  /** open the shop — through the arbiter, never a private `if` */
  function openShop() {
    if (sheet.isOpen) sheet.close();
    const why = shop.toggle();
    if (why) blockedToast(why);
  }

  /** open the kennel — same route */
  function openKennel() {
    if (sheet.isOpen) sheet.close();
    const why = kennel.toggle();
    if (why) blockedToast(why);
  }

  /* ---- THE SURFACE ARBITER --------------------------------------------
     ONE place decides who owns the whole screen, and every modal beat asks it
     before taking over. It exists because a real defect got through without
     it: on a fresh save `startWalk()` checked toy, care and training but not
     the NAMING beat, so the leash-drop anticipation played underneath "He's
     yours." — two modal states stacked, the first thing she would ever see.

     The guard has to work in BOTH directions, and that is the part a per-site
     `if` always gets wrong. It is not enough for the walk to refuse while
     naming is open; naming must also refuse while the walk owns the surface,
     or renaming from Settings while he is out at the park stacks the same two
     layers the other way up.

     THE SURFACE IS EXCLUSIVE. A first draft of this gave the layers a
     precedence order so that "important" beats could displace lesser ones —
     and that priority table immediately grew the very hole it was meant to
     close: naming outranked the walk, so renaming from Settings while he was
     out at the park opened the overlay on top of the absence panel. Verified
     failing, then deleted.

     There is no ranking now. If any layer owns the screen, no other layer may
     take it. A beat that still wants to happen is QUEUED (see `openNaming`)
     rather than allowed to barge, which is both simpler and the behaviour
     every one of these cases actually wanted. */

  /** who owns the whole surface right now, or '' */
  function surfaceOwner() {
    if (naming && naming.active) return 'naming';
    if (reunion && reunion.active) return 'reunion';
    /* STAGE 5: the ring is a full surface, and it is in this list rather than
       behind a private `if` in `startContest` — which is the whole point of
       the arbiter existing (ARCHITECTURE §14.1). Being here is what makes the
       guard work in the OTHER direction too: naming, the walk, care and
       training all consult `surfaceBlockedFor`, so none of them can open over
       a trial without a single line being added to any of them. */
    if (contest && contest.modal) return 'contest';
    if (walk && walk.modal) return 'walk';
    if (walk && walk.away) return 'away';
    /* STAGE 7: the install card. LAST in this list on purpose — it is the least
       important thing on the screen and must never be able to displace a beat.
       It is here rather than behind a private `if` for the same reason the ring
       is (§14.1): being in the list is what makes the guard work in BOTH
       directions, so care, training, the walk, the trial and the naming beat all
       refuse to open over it without a line being added to any of them. */
    /* STAGE 6: the shop and the kennel. Both are full surfaces, and both are
       here rather than behind a private `if` for exactly the reason §14.1
       gives — being in this list is what makes the guard work in BOTH
       directions. The kennel's `busy` is checked as well as its `modal`
       because the adoption beat must survive the panel closing under it: it is
       the one moment in stage 6 that is a one-shot. */
    if (kennel && (kennel.modal || kennel.busy)) return 'kennel';
    if (shop && shop.modal) return 'shop';
    if (collection && collection.modal) return 'collection';
    if (install && install.modal) return 'install';
    return '';
  }

  /**
   * May `who` take the surface? Returns '' if yes, otherwise the id of the
   * layer standing in the way — so the caller can decide whether to toast,
   * to queue, or to stay silent.
   */
  function surfaceBlockedFor(who) {
    const owner = surfaceOwner();
    if (!owner || owner === who) return '';
    return owner;
  }

  /**
   * The one line said when a layer is refused because something else owns the
   * screen. There is exactly one of these so every refusal sounds the same,
   * and it is DELIBERATELY SILENT during naming and the greeting: a toast over
   * the one moment that must have no chrome at all is worse than saying
   * nothing, and stage 4 established that precedent in `startWalk`.
   */
  function blockedToast(owner) {
    if (!owner || owner === 'naming' || owner === 'reunion') return;
    if (owner === 'walk' || owner === 'away') {
      toasts.show(walk.COPY.awayBusy(app.game.pron));
      return;
    }
    if (owner === 'contest') {
      toasts.show(contest.COPY.ringBusy(app.game.pron));
      return;
    }
    toasts.show('One thing at a time');
  }

  /**
   * Open the naming beat, but only if nothing else owns the screen. If
   * something does, it is QUEUED rather than dropped: `pendingNaming` already
   * exists for exactly this and is drained in update() the moment the surface
   * frees up, so a rename asked for during a walk still happens — just after
   * he is home, which is when she can see him anyway.
   */
  function openNaming(mode) {
    if (!naming) return false;
    if (surfaceBlockedFor('naming')) {
      if (!app.game.isNamed) pendingNaming = true;
      else toasts.show(walk && walk.away
        ? walk.COPY.awayBusy(app.game.pron)
        : 'One thing at a time');
      return false;
    }
    naming.start(mode || 'first', app.view);
    return true;
  }

  /** start a care action, closing anything that would fight it */
  function startCare(kind) {
    /* THROUGH THE ARBITER, not a private `if`. Stage 4 only routed the walk
       and the naming beat through it and left care and training with their own
       hand-rolled guards — which is why neither of them knew about the ring
       until this line existed. */
    const blocked = surfaceBlockedFor('care');
    if (blocked) { blockedToast(blocked); return false; }
    if (toy && toy.busy) {
      const P = app.game.pron;
      toasts.show(`${capitalise(P.they)} ${P.is} busy with the ball`);
      return false;
    }
    if (train && train.modal) train.stop();
    if (care.mode === kind) { care.stop(); return false; }
    pet.cancel();
    care.resetStroke();
    return care.start(kind);
  }

  /** enter training mode, closing anything that would fight it */
  function startTrain() {
    if (!train) return false;
    /* the toggle-off comes FIRST: pressing Train while training is closing it,
       not asking permission to open it */
    if (train.modal) { train.stop(); return false; }
    const blocked = surfaceBlockedFor('train');
    if (blocked) { blockedToast(blocked); return false; }
    if (toy && toy.busy) {
      const P = app.game.pron;
      toasts.show(`${capitalise(P.they)} ${P.has} gone after the ball`);
      return false;
    }
    if (care.modal) care.stop();
    pet.cancel();
    return train.start();
  }

  /* ---- WALKS (stage 4) -------------------------------------------------
     The walk is IN THE ROOM, like care and training, and for a stronger
     version of the same reason: three of its four beats ARE the room. Prepare
     is him going electric in front of the same rig, absence is this room with
     him missing, and the return is him coming back into it. Only the map is a
     full-surface overlay, and unmounting the room to draw it would throw away
     the rig, the baked room canvas and the continuity between the beats.
     `scenes/walk.js` is therefore not built — see ARCHITECTURE §14. */
  function startWalk() {
    if (!walk) return false;
    /* THE GUARD THAT WAS MISSING. The naming beat and the greeting both own
       the whole surface; starting the leash beat underneath either of them
       stacks two modal states. Silent rather than toasted: during first-run
       naming a toast would be chrome over the one moment that must have none. */
    if (walk.away) return false;                 // the away panel owns this
    if (walk.beat === 'prep' || walk.beat === 'map') { walk.stop(); return false; }
    const blocked = surfaceBlockedFor('walk');
    if (blocked) { blockedToast(blocked); return false; }
    if (toy && toy.busy) {
      const P = app.game.pron;
      toasts.show(`${capitalise(P.they)} ${P.has} gone after the ball`);
      return false;
    }
    if (care.modal) care.stop();
    if (train.modal) train.stop();
    pet.cancel();
    return walk.start();
  }

  /* ---- CONTESTS (stage 5) ----------------------------------------------
     The Obedience Trial is IN THE ROOM for the same reason care, training and
     the walk are: it is him, on this rig, in this room, and research §6.3
     calls a near-frontal camera a "perfect fit" for a dog performing at a
     judge. The room is DRESSED as a ring rather than replaced by one, so the
     rig, the baked canvas and the petting field all survive.
     `scenes/contest.js` is therefore not built — see ARCHITECTURE §15. */
  function startContest() {
    if (!contest) return false;
    /* the toggle-off first, as with training */
    if (contest.modal) { contest.stop(true); return false; }
    const blocked = surfaceBlockedFor('contest');
    if (blocked) { blockedToast(blocked); return false; }
    if (toy && toy.busy) {
      const P = app.game.pron;
      toasts.show(`${capitalise(P.they)} ${P.has} gone after the ball`);
      return false;
    }
    if (care.modal) care.stop();
    if (train.modal) train.stop();
    pet.cancel();
    return contest.start();
  }

  /** the reunion, in one place, because the walk's return can also trigger it */
  function playReunion(intensity, hours) {
    reunion.start(intensity, hours);
    app.game.awardDay('reunion');
    app.game.log('reunion', 'away ' + describeGap(hours || 8));
    const P = app.game.pron;
    const nm2 = app.game.isNamed ? app.game.dog.name : capitalise(P.they);
    toasts.show(nm2 + ' missed you', 2.6);
  }

  /**
   * WHAT HE HAS BROUGHT HOME, on the window sill. This is what makes a find a
   * real unlock rather than a line of text: the collection is in the world, it
   * grows, and it is the slow-drip decor reward research §1.10 asks for.
   * Drawn live rather than baked, because it changes.
   */
  /**
   * THE SILL'S HIT RECT, derived from where the things are actually drawn.
   * The shelf has moved once already, and a tap target kept in step by hand is
   * the same class of defect as the ball behind the nav bar (ARCHITECTURE 20).
   */
  function sillRect() {
    const SH = BALANCE.walk.shelf;
    const T = BALANCE.ui.collection.tapPad;
    return {
      x: SH.at[0] - T[3], y: SH.at[1] - T[0],
      w: (SH.max - 1) * SH.step + T[1] + T[3], h: T[0] + T[2],
    };
  }

  /**
   * THE RECT A TOAST MUST KEEP OFF (queue item 5).
   *
   * Care first: while she is feeding or watering him the bowl IS the subject,
   * and "Biscuit is full" sitting on top of it was the reported defect. Then
   * the ball, but only while it is lying about being interactive — once he has
   * it in his mouth or is chasing it, a message is about HIM and the ball is
   * moving anyway, so following it would make the stack jitter.
   *
   * Deliberately not the dog: he is most of the screen, and a toast that will
   * not overlap him has nowhere left to be.
   */
  function toastSubject() {
    const d = care && care.debug;
    if (d && (d.mode === 'feed' || d.mode === 'water') && d.bowlAt) {
      const B = BALANCE.ui.toast.bowlRect;
      return { x: d.bowlAt[0] - B[0], y: d.bowlAt[1] - B[1], w: B[0] * 2, h: B[1] + B[2] };
    }
    if (toy && toy.toy && !toy.busy && !toy.toy.held) {
      const T = BALANCE.ui.toast.toyRect;
      return { x: toy.toy.x - T[0], y: toy.toy.y - T[1], w: T[0] * 2, h: T[1] * 2 };
    }
    return null;
  }

  /** is a virtual point inside a rect? */
  function inRect(r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  function drawSill(c) {
    const SH = BALANCE.walk.shelf;
    /* WHAT SHE HAS PUT OUT, not the last seven of everything. The room used to
       draw `findCollection().slice(-max)`, so the eighth find silently pushed
       the first one off the shelf and there was no way to say which seven you
       wanted (docs/FEEDBACK-QUEUE.md 6). */
    const items = app.game.onShow();
    if (!items.length) return;
    for (let i = 0; i < items.length; i++) {
      const x = SH.at[0] + i * SH.step;
      /* a soft contact shadow, or they float */
      c.fillStyle = 'rgba(104,58,32,0.16)';
      ell(c, x + 1, SH.at[1] + 11, 8, 2.6); c.fill();
      drawFind(c, items[i], x, SH.at[1], SH.scale, time + i);
    }
  }

  /* ---- settings sheet --------------------------------------------- */
  /**
   * The voice row's wording, which is the ONLY place in the game the
   * microphone is ever mentioned. It is an extra, so it is described as one —
   * and when it cannot work here it says so plainly, once, and stops offering
   * (docs/PLATFORM-RISKS.md). Pronouns come from per-dog data at draw time.
   */
  function voiceRow() {
    const P = app.game.pron;
    if (!voice || !voice.supported) {
      return { id: 'voice-off', label: 'Voice cues: not available', note: 'This device cannot listen — taps do everything' };
    }
    if (voice.retired) {
      return { id: 'voice-off', label: 'Voice cues: not available', note: 'Listening did not work here — taps do everything' };
    }
    if (voice.state === 'denied') {
      return { id: 'voice-off', label: 'Voice cues: blocked', note: 'The microphone was declined — taps work just as well' };
    }
    if (voice.armed) {
      return {
        id: 'voice', label: 'Voice cues: on',
        note: `Tap the bubble while training and say a word — ${P.they} learn${P.s} it`,
      };
    }
    return { id: 'voice', label: 'Voice cues: off', note: 'Optional extra — every trick works by hand alone' };
  }

  /**
   * The sound row. Its note used to tell her the phone's silent switch would mute
   * the game as well, which was true and is now deliberately false: the game
   * overrides the ringer switch on purpose, because the recipient keeps her phone
   * on silent and would otherwise never hear the puppy at all
   * (BALANCE.audio.overrideSilentSwitch, ARCHITECTURE §18.3).
   *
   * SO THE NOTE HAS TO SAY SO. Overriding a device setting without telling her
   * is the rude version; telling her, and making THIS ROW the way to stop it, is
   * not. The off note promises completeness because the toggle really does
   * release the audio session rather than muting it.
   */
  function soundRow() {
    const on = !!app.game.state.settings.sound;
    const over = !!BALANCE.audio.overrideSilentSwitch;
    return {
      id: 'sound',
      label: on ? 'Sound: on' : 'Sound: off',
      note: on
        ? (over ? 'Yips, paws and water — plays even on silent. Turn off here'
          : 'Yips, paws and water. Your phone’s silent switch mutes it too')
        : 'Everything is silent',
    };
  }

  /**
   * The install row, and it exists so the CARD never has to nag. The card asks
   * at most twice; this row is here for ever, so "Don't ask again" costs her
   * nothing and the honest reason stays one tap away. Hidden entirely when she
   * is already installed — a row telling her to do what she has done reads as
   * the game not knowing where it is.
   */
  function installRow() {
    if (app.standalone) {
      return {
        id: 'installed',
        label: 'Saved to your home screen',
        note: `${capitalise(app.game.pron.they)} ${app.game.pron.is} safe here`,
      };
    }
    return {
      id: 'install',
      label: 'Add to home screen',
      note: 'In a browser tab, iPhone tidies away saved games after a week',
    };
  }

  function openSettings() {
    const g = app.game;
    sheetKind = 'settings';
    sheet.open({
      title: 'Settings',
      rows: [
        {
          id: 'name',
          label: g.isNamed ? 'Name: ' + g.dog.name : `Name ${g.pron.them}`,
          note: g.isNamed ? 'Tap to rename'
            : `${capitalise(g.pron.they)} ${g.pron.is} still waiting for a name`,
        },
        soundRow(),
        voiceRow(),
        installRow(),
        { id: 'export', label: 'Copy save code', note: 'Keep a backup of your bond' },
        { id: 'import', label: 'Load save code', note: 'Paste a code from another device' },
        { id: 'close', label: 'Done' },
      ],
    });
  }

  function sheetAction(id) {
    if (id === 'close' || id === '__backdrop') { sheet.close(); return; }
    /* ---- the More sheet's four destinations ----------------------------
       Each goes through the SAME function the nav pill used to call, so the
       arbiter still arbitrates and there is exactly one path to each surface.
       That is what keeps the away state correct without a line being added
       here: while he is out, Shop/Dogs/Ring each get refused with the away
       toast by `surfaceOwner()` returning 'away', and Settings — which is the
       one you actually want out there, because renaming is behind it — opens. */
    if (id === 'shop') { sheet.close(); openShop(); return; }
    if (id === 'dogs') { sheet.close(); openKennel(); return; }
    if (id === 'ring') { sheet.close(); startContest(); return; }
    /* not `sheet.close()` first: `openSettings()` swaps the open sheet's rows,
       so More -> Settings is one panel changing its mind rather than a panel
       sliding out and a second sliding in behind it */
    if (id === 'settings') { openSettings(); return; }
    if (id === 'feed' || id === 'water' || id === 'wash' || id === 'brush') {
      sheet.close();
      startCare(id);
      return;
    }
    if (id === 'name') {
      sheet.close();
      /* through the arbiter: Settings is reachable while he is out on a walk,
         and renaming from there used to open the naming overlay on top of the
         absence panel */
      openNaming('rename');
      return;
    }
    if (id === 'sound') {
      const on = !app.game.state.settings.sound;
      app.game.setSetting('sound', on);
      app.audio.setEnabled(on);
      /* one sound, so "on" is audibly on rather than a word on a screen. It is
         inside a tap, so the context is unlocked by definition. */
      if (on) app.audio.play('yip');
      openSettings();
      return;
    }
    /* ---- the install explanation, reachable for ever ------------------
       Through the layer's own `force()`, not by poking `open`, so the one
       "never when standalone" check still runs. */
    if (id === 'install') {
      sheet.close();
      if (install) install.force();
      return;
    }
    if (id === 'installed') {
      /* a statement, not a switch — the same shape as the `voice-off` row */
      return;
    }
    /* ---- the microphone: opt-in, and it degrades in silence -----------
       Toggling the row only records the PREFERENCE. It deliberately does not
       open the microphone: the permission prompt belongs to the gesture that
       presses "call him" while training, because that is the moment where the
       player has asked a question and is waiting for an answer. */
    if (id === 'voice') {
      const on = !voice.armed;
      voice.arm(on);
      app.game.setSetting('mic', on);
      if (on) {
        const P = app.game.pron;
        toasts.show(`Tap the bubble while training and say a word to ${P.them}`);
      }
      openSettings();
      return;
    }
    if (id === 'voice-off') {
      /* nothing to toggle — the row is a statement, not a switch */
      return;
    }
    if (id === 'export') {
      const code = exportSave(app.game.state);
      sheet.promptText({
        title: 'Your save code', value: code, readOnly: true,
        onSubmit: () => toasts.show('Save code copied'),
      });
      return;
    }
    if (id === 'import') {
      sheet.promptText({
        title: 'Paste a save code', placeholder: 'PP1...',
        onSubmit: (txt) => {
          try {
            const next = importSave(txt);
            writeNow(next);
            toasts.show('Save loaded — reloading');
            setTimeout(() => location.reload(), 420);
            return true;
          } catch (e) {
            toasts.show("That code doesn't look right");
            return false;
          }
        },
      });
    }
  }

  /* ================================================================== */
  const scene = {
    id: 'room',

    async enter(a, params) {
      app = a;
      time = 0;
      parts.length = 0;

      rig = createRig({ reduced: app.reduced, breed: app.game.dog.breedId, rng });
      dog = createDogRenderer(rig);
      pet = createPetting(rig, {
        reduced: app.reduced, rng,
        hooks: {
          /* TWO AXES. `onMood` is the fast one you can see; `onAffection` is
             the slow bond, and state/game.js meters it through the session and
             day caps so a marathon cannot substitute for coming back. */
          onMood: (amt) => app.game.addMood(amt),
          onMoodDent: (amt) => app.game.dentMood(amt),
          onAffection: (amt) => {
            app.game.addAffection(amt);
            hud.bumpHint(app.game.affection);
          },
          onTapAffection: (amt, zid) => app.game.addAffection(amt, 'petted her ' + zid),
          onSpawn: (kind, lx, ly) => spawn(kind,
            rig.x + lx * rig.s + rng.range(-9, 9),
            rig.y + ly * rig.s + rng.range(-7, 7)),
          /* ---- HE GIVES YOU HIS PAW (queue item 3) --------------------
             `dog/pet.js` decides that a TAP on a paw is a handshake rather than
             a poke and does the looking-down half; this plays the shake itself,
             because whether he has a `shake` to play is a training question and
             the petting layer has no business knowing about tricks.

             The clip is the one stage 3 already tuned, so a handshake she asked
             for by tapping and one he performed on cue are the same animation —
             which is the point. He offers it whether or not he has LEARNED the
             trick: a puppy paws at you long before it means anything, and
             discovering that is nicer than being told. */
          onPawShake: () => {
            idle.cancel(1.4);
            idle.play('trick.shake');
            app.audio.play('perk');
            const h = rig.headWorld();
            for (let i = 0; i < (app.reduced ? 2 : 4); i++) {
              spawn('heart', h.x + rng.range(-22, 22), h.y + rng.range(-18, 8));
            }
          },
          onTap: (zid, clip, kind) => {
            idle.cancel(rng.span(BALANCE.idle.gapAfterTap));
            if (clip) idle.play(clip);
            app.audio.play((kind === 'bad' ? 'grumble-' : 'pet-') + zid);
          },
          onMiss: (vx, vy) => {
            ringPuff(vx, vy);
            idle.cancel(rng.span(BALANCE.idle.gapAfterPoke));
          },
        },
      });
      idle = createIdle(rig, {
        rng, poi: POI,
        spawn: (kind, lx, ly) => spawn(kind, rig.x + lx * rig.s, rig.y + ly * rig.s),
        sound: (name) => app.audio.play(name),
      });

      toasts = createToasts();
      sheet = createSheet({ reduced: app.reduced });
      shop = createShop({
        game: app.game, reduced: app.reduced,
        sound: (name) => app.audio.play(name),
        toast: (msg) => toasts.show(msg),
        blocked: (who) => surfaceBlockedFor(who),
        /* a treat is a real beat: he takes it, and the reward clip stage 3
           already owns is what "he took it" looks like */
        onTreat: () => {
          /* HE TAKES IT. `trick.nom` is the reward clip stage 3 already owns —
             the chew, the swallow, the pleased look — so a treat looks exactly
             like the thing a treat is, with no new animation. The hearts and
             the mood come from the same place training's reward puts them. */
          idle.cancel(1.4);
          idle.play('trick.nom');
          const h = rig.headWorld();
          const n = app.reduced ? 3 : 6;
          for (let i = 0; i < n; i++) spawn('heart', h.x + rng.range(-26, 26), h.y + rng.range(-26, 6));
          rig.blinkNow(1);
        },
      });
      kennel = createKennel({
        game: app.game, reduced: app.reduced,
        sound: (name) => app.audio.play(name),
        toast: (msg) => toasts.show(msg),
        blocked: (who) => surfaceBlockedFor(who),
        /* SWAPPING DOGS REMOUNTS THE ROOM. `enter()` builds the rig, the
           renderer, petting, idle and every care layer from `game.dog`, so a
           different breed with different needs only actually arrives by going
           through there. Mutating `activeDogId` under a live scene would leave
           one dog's rig wearing another dog's state. */
        onSwitch: (id, d) => {
          app.nav.go('room', { switched: true, dogId: id });
        },
        onAdopted: (id) => {
          app.nav.go('room', { adopted: true, dogId: id });
        },
      });
      hud = createHud(app.game, { hint: 'Stroke the puppy', getTime: () => time });

      care = createCare(rig, {
        game: app.game, pet, idle, rng, reduced: app.reduced,
        spawn: (kind, vx, vy) => spawn(kind, vx, vy),
        sound: (name) => app.audio.play(name),
        toast: (msg) => toasts.show(msg),
      });
      toy = createToy(rig, {
        game: app.game, idle, rng, reduced: app.reduced,
        spawn: (kind, vx, vy) => spawn(kind, vx, vy),
        sound: (name) => app.audio.play(name),
        toast: (msg) => toasts.show(msg),
        soil: (amount) => care.soil(amount),
      });
      reunion = createReunion(rig, {
        game: app.game, idle, rng, reduced: app.reduced,
        spawn: (kind, vx, vy) => spawn(kind, vx, vy),
        sound: (name) => app.audio.play(name),
      });

      /* ---- TRAINING (stage 3) ------------------------------------------
         Training is IN THE ROOM, not a separate scene: the ritual is her, in
         her corner, with the same rig and the same petting field under it.
         (Deviation from ARCHITECTURE §2's `scenes/train.js` — documented in
         §13. Stage 2 made care and play in-room for the same reason.)

         VOICE IS OPT-IN AND ADDITIVE. The training layer never asks whether
         recognition exists: it takes hand signals, and a heard word simply
         arrives as one more signal if it happens to be working. Nothing is
         ever listening on its own — one press, one utterance (dog/voice.js). */
      voice = createVoice({
        /* A HEARD WORD BELONGS TO WHOEVER OWNS THE SCREEN. In the ring it is a
           steadying cue for the trick the judge just called; handing it to
           `train.heard` there would try to teach or to ask and would start a
           second performance on top of the judged one. */
        onHeard: (text) => {
          if (contest && contest.owns) { contest.heard(text); return; }
          if (train) train.heard(text);
        },
        onState: () => {
          /* only ever surfaced where she went looking for it */
          if (sheetKind === 'settings' && sheet.isOpen) openSettings();
        },
      });
      /* restore the opt-in across sessions. `arm` never prompts. */
      if (app.game.state.settings.mic) voice.arm(true);
      train = createTraining(rig, {
        game: app.game, pet, idle, rng, reduced: app.reduced, voice,
        spawn: (kind, vx, vy) => spawn(kind, vx, vy),
        sound: (name) => app.audio.play(name),
        toast: (msg) => toasts.show(msg),
        /* she will not be asked to learn anything while she is eating, being
           washed, or off after the ball */
        busyElsewhere: () => !!(care.modal || (toy && toy.busy) || reunion.active),
        openTricks: () => { if (tricks) tricks.start(); },
      });
      /* ---- THE TRICK LIST -------------------------------------------
         A sub-surface of training rather than a destination of its own: it is
         opened from the pill in the training chrome, it closes with training,
         and it is NOT in `surfaceOwner` — training already holds the screen
         while it is up, and adding a second entry for a panel that can only
         exist inside the first would let training refuse to open over its own
         list. Everything it says comes from dog/train.js, live, so there is no
         second answer to what he knows. */
      tricks = createTrickList({
        reduced: app.reduced,
        sound: (name) => app.audio.play(name),
        lessons: () => train.lessons(),
        copy: train.COPY,
        pron: () => app.game.pron,
      });
      /* ---- THE COLLECTION (queue item 6) ----------------------------
         Opened by tapping the sill his things stand on. It reads its three
         lists straight out of state/game.js, so what is on the shelf in the
         room and what the panel says is on the shelf are the same array. */
      collection = createCollection({
        game: app.game, reduced: app.reduced,
        sound: (name) => app.audio.play(name),
        toast: (msg) => toasts.show(msg),
        nameOf: (id) => walk.COPY.findName(id).replace(/^an? /, ''),
        metName: (met) => (walk.COPY.met[met] || met).replace(/^an? /, ''),
      });
      /* ---- WALKS (stage 4) ------------------------------------------
         Four beats, no gait cycle, and the absence beat is a pure function of
         the wall clock so it survives the app being killed (state/walks.js). */
      walk = createWalk(rig, {
        game: app.game, pet, idle, rng, reduced: app.reduced,
        spawn: (kind, vx, vy) => spawn(kind, vx, vy),
        sound: (name) => app.audio.play(name),
        toast: (msg) => toasts.show(msg),
        busyElsewhere: () => !!(care.modal || train.modal || (toy && toy.busy) || reunion.active),
      });
      /* if she had been away long enough to earn a reunion AND he was out on a
         walk, the walk's return lands first and the reunion follows it: he
         trots in with something, drops it, and THEN realises she is there.
         Playing both at once would have them fight for the same body. */
      walk.onHome(({ after }) => { if (after > 0) playReunion(after, (app.elapsed || {}).hours || 8); });

      /* ---- CONTESTS (stage 5) ---------------------------------------
         The trial drives dog/train.js rather than the rig: it asks BY ID with
         `judged:true`, subscribes to `onPerform`, and scores what comes back.
         It is handed `voice` so a spoken cue can steady him — an extra at
         exactly equal status with the hand, and never a requirement. */
      contest = createContest(rig, {
        game: app.game, pet, idle, train, voice, rng, reduced: app.reduced,
        spawn: (kind, vx, vy) => spawn(kind, vx, vy),
        sound: (name) => app.audio.play(name),
        toast: (msg) => toasts.show(msg),
        /* A SHUT GATE HANDS HER THE FIX. The trial says what is wanted; the
           room is the only thing allowed to take the surface, so the routing
           lives here. The layer has already released the surface by now. */
        onNeed: (reason) => {
          if (reason === 'hunger') startCare('feed');
          else if (reason === 'thirst') startCare('water');
          else if (reason === 'untrained') startTrain();
        },
      });

      naming = createNaming({
        game: app.game, reduced: app.reduced,
        onName: (name) => {
          /* the puppy reacts to hearing it for the first time */
          idle.cancel(2.2);
          idle.play('wagBurst');
          app.game.addMood(0.35);
          rig.shiver();
          const h = rig.headWorld();
          for (let i = 0; i < (app.reduced ? 3 : 7); i++) {
            spawn('heart', h.x + rng.range(-26, 26), h.y + rng.range(-24, 4));
          }
          app.audio.play('yip');
        },
        onDone: (name) => {
          if (name) toasts.show(name + ' it is');
          hud.setHint(strokeHint());
        },
      });

      /* ---- INSTALLING TO THE HOME SCREEN (stage 7) --------------------
         The card is the mitigation for the highest-severity risk in the project
         (PLATFORM-RISKS Risk 1: ITP deletes all script-writable storage after
         seven days of Safari use, and installed web apps are exempt). It is
         handed the room's own arbiter rather than deriving its own guard, and
         `standalone` is passed as a LIVE getter — a cached boolean would be
         read once at boot and the card would appear inside the installed app,
         which is the one place it must never be. */
      install = createInstall({
        game: app.game,
        reduced: app.reduced,
        standalone: () => !!app.standalone,
        /* THE ARBITER, PLUS THE SHEET. `surfaceOwner()` deliberately does not
           know about the bottom sheet — the sheet's own rows call `startCare`
           and `startTrain`, so putting it in the arbiter would have it block
           the things it exists to launch. But the install card CAN otherwise
           drift open on top of an open Settings sheet and then swallow every
           touch meant for it, which is the same "two modal states stacked"
           defect §14.1 was written for. Caught by rendering the sheet and
           looking. So the extra term lives HERE, at this one caller, rather
           than in the shared arbiter. `force()` (the Settings row) does not
           consult this, and the row closes the sheet before opening the card. */
        blocked: (who) => (sheet && sheet.isOpen ? 'sheet' : surfaceBlockedFor(who)),
        toast: (msg) => toasts.show(msg),
      });

      /* ---- FIVE PILLS (stage 9) ------------------------------------------
         Was eight, at 40.5 virtual units each — under the 44 tap-target
         guideline, which stage 6 noted and shipped anyway. Five give 68.4.

         The four that stay on the bar are the four you press DURING something:
         feeding, playing, training, going out. The four that moved behind
         `More` — shop, kennel, ring, settings — are all destinations you
         choose deliberately, and all four were already sheet-shaped surfaces,
         so the extra tap lands on a surface of the same kind rather than
         changing what they feel like.

         NOTHING BECAME UNREACHABLE (gift-ready item 2.3): every id below and
         every id in `openMore()` is handled in `navAction`/`sheetAction`, and
         `More` is reachable while he is out on a walk so Settings — and
         therefore renaming — stays available in the one state where the rest of
         the room is not. */
      nav = createNav([
        /* care, play, training and WALKS are in-room features, not scenes */
        { id: 'care', label: 'Care', available: true },
        { id: 'play', label: 'Play', available: true },
        { id: 'train', label: 'Train', available: true },
        { id: 'walk', label: 'Walk', available: true },
        { id: 'more', label: 'More', icon: 'more', available: true },
      ], {
        safeBottom: app.view.safe.bottom / app.view.vs,
        reduced: app.reduced,
      });

      /* ---- THE PER-FRAME REACHABLE-AREA ASSERTION ----------------------
         Every module that owns something the player can touch hands over a
         probe, and `reach.tick()` (in `update`, below) runs the lot once a
         frame. It never logs and never throws — a console error in her hands is
         worse than the defect it would report — it accumulates the worst
         overlap per prop-and-state into counters `window.__pp.reach.report()`
         reads.

         WHY THIS AND NOT A ONE-OFF CHECK: the ball's positions were wrong for
         two stages and every numeric gate the project ran passed, because no
         gate knew the two numbers were related. A prop that drifts under the bar
         in some state nobody thought to screenshot now shows up as a count.

         The DOG is deliberately not registered. The bottom of his paw and belly
         petting zones do overlap the bar by about six units, but he is not a
         prop, he cannot be lost, and his placement is the room's whole
         composition — see docs/FEEDBACK-QUEUE.md. Measured, not clamped. */
      reach.resetProbes();
      reach.resetAudit();
      reach.watch('toy', () => toy.reachProbe());
      reach.watch('care', () => care.reachProbe());
      reach.watch('walk', () => walk.reachProbe());

      scene.resize(app);

      /* settle one frame so the zones exist before the first touch */
      rig.gaze.yaw = 0.18; rig.gaze.pitch = 0.10;
      rig.base(app.game.mood, 1 / 60);
      rig.update(1 / 60);
      pet.computeZones();

      hud.setHint(strokeHint());

      /* ---- THE SLOW AXIS PAYS FOR TURNING UP --------------------------
         "Bond is moved by distinct sessions rather than session length"
         (research §2). Showing up at all on a new day is worth about half of
         what a whole session of petting can pay. */
      app.game.awardDay('showUp');

      /* ---- HOW MANY TIMES SHE HAS OPENED IT --------------------------
         One integer in `flags`, which the save already merges forward, so no new
         required field and no schema bump. `ui/install.js` is the only reader:
         the first launch is a one-shot moment and the install card waits a long
         time on it, but from the second launch on she has already met him and
         the seven-day storage clock is running, so the wait is short. */
      /* NOT ON A REMOUNT. Swapping dogs and adopting both re-enter this scene,
         and `ui/install.js` reads this counter to decide how long to wait
         before asking to be installed — so counting a dog swap as a launch
         would bring the install card forward for no reason. */
      if (!(params && (params.switched || params.adopted))) {
        app.game.setFlag('launches', (+(app.game.state.flags.launches) || 0) + 1);
      }

      /* ---- WAS HE OUT? --------------------------------------------------
         THE "SURVIVES BEING FULLY CLOSED" PATH, and there is only one of it.
         Nothing ticked while the app was shut; `walkProgress` derives where the
         walk got to from the persisted `startedAt` and the wall clock. If it
         finished while she was away, he is simply home — which is a lovely way
         to open the app — and the walk's return plays instead of the standalone
         reunion, absorbing it if one was due. */
      const el = app.elapsed || {};
      const wp = app.game.walkProgress();
      if (wp.active) {
        if (wp.done) {
          walk.arrive({ after: params && params.reunion ? (el.intensity !== undefined ? el.intensity : 0.5) : 0 });
          toasts.show(walk.COPY.homeWhileAway(app.game.pron, app.game.isNamed ? app.game.dog.name : ''), 2.4);
        } else {
          walk.resume();
        }
      } else if (params && params.reunion) {
        /* ---- the reunion ---------------------------------------------- */
        playReunion(el.intensity !== undefined ? el.intensity : 0.5, el.hours || 8);
      } else if (!app.game.isNamed) {
        /* First launch — OR the Cockapoo's first moment, which is the same
           beat and deliberately reuses it: she has no name, so she gets named.
           The kennel does not own the most important thing it causes. */
        openNaming('first');
      } else if (params && params.switched) {
        /* ---- A SWAP, AND IT MAY BE A REUNION (queue item 4) -------------
           This was always the warm one-liner, because the only gap the game
           could measure was the app's — so picking a dog up after a fortnight
           of playing with the other one got the same "he is here" as picking
           him up after five minutes. The gap is his own now, and if it is a
           real absence he gets the beat the absence earned.

           `markSeen` comes AFTER the gap is read, and only here: reading it in
           `switchDog` would have stamped the arrival before anyone could ask
           how long he had been waiting. */
        const gap = app.game.gapHoursFor(app.game.dog.id);
        if (gap >= BALANCE.time.reunionAfterHours) {
          playReunion(reunionIntensity(gap, app.game.affection), gap);
        } else {
          const P = app.game.pron;
          toasts.show(`${app.game.dog.name} ${P.is} here`, 2.2);
          idle.cancel(1.2);
          rig.blinkNow(2);
        }
        app.game.markSeen();
      }
      /* if she came back to an unnamed puppy, name it once the greeting lands */
      if (!app.game.isNamed && (reunion.active || walk.active)) pendingNaming = true;
    },

    exit() {
      roomCv = null; ovCv = null;
      parts.length = 0;
      /* the naming beat owns a real DOM input; it must not outlive the scene */
      if (naming) naming.close();
      if (care) care.stop();
      if (train) train.stop();
      /* `walk.stop()` tears the LAYER down and deliberately leaves an active
         walk alone — he is still out, and the save says so. */
      if (walk) walk.stop();
      /* an abandoned trial costs nothing and banks nothing (state/contest.js) */
      if (contest) contest.stop(true);
      /* the microphone must never outlive the scene that asked for it: a live
         mic indicator on a puppy game would be alarming, and correctly so */
      if (voice) voice.abort();
      /* the install card holds a `beforeinstallprompt` listener on `window` */
      if (install) install.destroy();
      /* the kennel's adoption beat must not straddle a remount: it has already
         written the dog by the time it hands over, and the room it hands to is
         the one being built */
      if (shop) shop.stop();
      if (kennel) { kennel.stop(); }
      if (tricks) tricks.stop();
      if (collection) collection.stop();
    },

    resize(a) {
      const view = a.view;
      buildRoom(view);
      buildOverlay(view);
      initMotes();
      if (nav) nav.layout(view.safe.bottom / view.vs);
      if (sheet) sheet.setInset(view.safe.bottom / view.vs);
      if (shop) shop.setInset(view.safe.bottom / view.vs);
      if (kennel) kennel.setInset(view.safe.bottom / view.vs);
      if (tricks) tricks.setInset(view.safe.bottom / view.vs);
      if (collection) collection.setInset(view.safe.bottom / view.vs);
      if (naming) naming.resize(view);
    },

    update(a, dt, t) {
      time = t;
      const game = a.game;

      /* ---- the two axes ----------------------------------------------
         MOOD drifts toward the baseline affection sets (fast, seconds).
         AFFECTION does not drift at all any more: it is the slow axis and it
         only moves when something actually happens. */
      game.stepMood(dt);
      game.drainAffection(dt);
      game.decayAffectionPulse(dt);
      /* the original ran on the real clock, so needs move while she watches */
      decayLive(game, dt);

      /* ---- state machines, before the pose they drive ---- */
      reunion.update(dt);
      care.update(dt, game.mood);
      toy.update(dt, game.mood);
      train.update(dt, game.mood);
      walk.update(dt, game.mood);
      contest.update(dt, game.mood);

      /* NOTHING THE PLAYER CAN TOUCH MAY SIT UNDER THE NAV — asserted here,
         every frame, AFTER the state machines have written this frame's prop
         positions and before anything draws them. The pose pipeline below moves
         the dog, never a prop, so this is the last word on where things are.

         It was above this block first, which audited LAST frame's positions and
         so reported one violation every time the safe-area inset changed — the
         ball genuinely was under the bar for the single frame between the inset
         arriving and the toy's own clamp catching up. Auditing the frame that is
         about to be drawn makes the count mean what it says.

         Six or seven rect tests. See the note in `enter` and ui/reach.js. */
      reach.tick();

      /* --- the pose pipeline, in order ---
         base -> idle -> pet -> care -> train -> toy -> reunion -> resolve
         Care sits AFTER petting on purpose (see dog/care.js), TRAINING sits in
         the same slot as care (they are mutually exclusive), and the reunion
         sits last because it owns the whole animal for six seconds.

         `toy.apply` is SKIPPED while a trick owns her: it rewrites rig.x/y/s/sy
         back to home on every idle frame, which would fight the spin. Same
         reason the reunion skips it. */
      const mood = game.mood;
      /* what he is wearing, told to the rig once a frame. A bought or earned
         collar is only a reward if it is ON him in the room. */
      rig.wear = game.worn;
      rig.base(mood, dt);
      /* the idle director is skipped while he is OUT: an invisible dog quietly
         playing clips would still spawn particles and call for sounds */
      if (!reunion.active && !walk.hidesDog) {
        idle.update(dt, {
          affection: mood.mood,
          petLevel: pet.level,
          petDown: pet.IN.down,
          sinceTouch: pet.sinceTouch,
        });
      }
      pet.apply(dt, mood);
      care.apply(dt, mood);
      train.apply(dt, mood);
      /* the walk shares the care/train slot: prepare and return own the body
         the way a care action does, and the three are mutually exclusive */
      walk.apply(dt, mood);
      /* ...and so does the trial, which writes almost nothing: the point of a
         trial is that dog/train.js is doing the work */
      contest.apply(dt, mood);
      /* `toy.apply` rewrites rig.x/y/s back to home every idle frame, which
         would fight the return's arrival exactly as it fights the spin.

         `care.active` JOINED THIS LIST IN STAGE 6, and its absence was the
         defect behind the floating bowl (ARCHITECTURE §16.9). Stages 3, 4 and
         5 each added themselves here the moment they moved the rig; care never
         had, so every attempt to lower the dog's body for a floor-level bowl
         was silently erased on the very frame it was written, and it looked
         like the pose code simply not working. Whoever ended up moving the
         bowl up to chest height instead was fighting this line, not geometry.
         It is `active` rather than `modal` so the stoop's forward lean gets to
         spring back on the way OUT too — `modal` goes false the moment the
         action ends, which would snap the placement home mid-return. */
      if (!reunion.active && !train.busy && !walk.busy && !contest.busy
          && !care.active) toy.apply(dt, mood);
      reunion.apply(dt, mood);
      rig.update(dt);
      pet.computeZones();

      /* the naming beat waits for the greeting — and now for the walk too —
         to finish landing. `surfaceBlockedFor` is the same check the other
         direction uses, so the two can never disagree. */
      if (pendingNaming && !surfaceBlockedFor('naming')) {
        pendingNaming = false;
        if (!game.isNamed) naming.start('first', a.view);
      }
      naming.update(dt);

      /* ---- CONTENTED PANTING ------------------------------------------
         Off `rig.drive.pant`, which stage 2 already drives from exertion and
         mood, so this needs no new state and cannot desynchronise from the
         animation: if his sides are moving, he is breathing audibly. Skipped
         while he is out of the room, and while anything owns the surface for a
         beat that wants quiet. */
      const PA7 = BALANCE.audio.pant;
      if (PA7.enabled && !walk.hidesDog && !naming.active && !contest.modal) {
        const p = rig.drive.pant || 0;
        if (p > PA7.at) {
          pantIn -= dt;
          if (pantIn <= 0) {
            a.audio.play('pant', { gain: PA7.gain * Math.min(1, p) });
            pantIn = rng.range(PA7.every[0], PA7.every[1]);
          }
        } else {
          /* re-arm with a partial delay, so he does not pant the instant he
             crosses the threshold after resting */
          pantIn = Math.min(pantIn <= 0 ? PA7.every[0] : pantIn, PA7.every[1]);
        }
      }

      updateParts(dt);
      toasts.update(dt);
      sheet.update(dt);
      shop.update(dt);
      kennel.update(dt);
      /* THE LIST CANNOT OUTLIVE TRAINING. It is opened from the training
         chrome and reads live out of that layer, so anything that leaves
         training — the X, the nav, a walk coming home, the scene changing —
         has to take the list with it. Derived from `train.modal` rather than
         called from each of those sites, which is the mistake the surface
         arbiter exists to stop being made one `if` at a time. */
      if (tricks.isOpen && !train.modal) tricks.stop();
      tricks.update(dt);
      collection.update(dt);
      /* THE REWARD LANDS IN THE WORLD, on the frame she earns it. `rugBlue` is
         the only unlock that changes the prebuilt room art, so this is the one
         place that has to notice. */
      const wantRug = a.game.isUnlocked('rugBlue') ? 'blue' : 'warm';
      if (roomCv && wantRug !== rugShown) {
        buildRoom(a.view);
        toasts.show(rugToast(a.game.pron));
      }
      /* the install card. Its own `eligible()` is the whole cadence policy, and
         it consults the arbiter, so there is nothing to guard here. */
      install.update(dt, a.view);
      install.tick();
      /* the hint line belongs to a dog who is here. Saved and put back rather
         than rebuilt, so the progressive hint stage is not lost. */
      if (walk.away && hud.hint) { hintBeforeWalk = hud.hint; hud.setHint(''); }
      else if (!walk.away && hintBeforeWalk && !hud.hint) { hud.setHint(hintBeforeWalk); hintBeforeWalk = ''; }
      hud.update(dt);
      /* the tactile press is a 100ms tween, so the nav needs a clock */
      nav.update(dt);
      /* WHICH PILL IS LIT. The mock's selected-nav-pill state, and with five
         pills there is finally room for it to be worth having: it answers "what
         am I in the middle of" without a word of copy. Derived from what is
         actually open rather than from the last thing tapped, so closing a
         surface any other way (backdrop, Done, he came home) unlights it. */
      nav.active = care.mode ? 'care'
        : (train.modal ? 'train'
          : (walk.away || walk.modal ? 'walk'
            : (toy.busy ? 'play'
              : ((sheet.isOpen && (sheetKind === 'more' || sheetKind === 'settings'))
                || shop.modal || kennel.modal || contest.modal ? 'more'
                : (sheet.isOpen && sheetKind === 'care' ? 'care' : '')))));
      /* chrome gets out of the way for the beats that need the whole screen */
      hud.visible = !naming.active && !care.modal && !train.modal && !reunion.active
        && !walk.modal && !contest.modal && !install.modal;
    },

    draw(a, g) {
      lastG = g;
      const c = g.ctx;
      const view = a.view;

      /* THE REUNION SHAKES THE CAMERA, NOT THE DOG. iOS has no haptics, so the
         nose-on-the-lens thump has to be sold with scale and a screen shake
         (PLATFORM-RISKS). The room and the dog shift together; the vignette and
         grain deliberately do NOT, because they are lens-fixed. */
      const sk = reunion.shake;
      const shaking = sk.x !== 0 || sk.y !== 0;

      c.setTransform(1, 0, 0, 1, 0, 0);
      if (shaking) c.translate(sk.x * view.vs * view.dpr, sk.y * view.vs * view.dpr);
      if (roomCv) c.drawImage(roomCv, 0, 0);
      c.setTransform(1, 0, 0, 1, 0, 0);
      g.toVirtual();
      if (shaking) c.translate(sk.x, sk.y);
      c.lineJoin = 'round'; c.lineCap = 'round';

      drawMotes(c, walk.hidesDog ? (1 / 60) * BALANCE.walk.away.moteSlow : 1 / 60);

      /* what he has brought home, on the sill. Drawn before the melancholy
         wash, so an empty room dims his collection along with everything else. */
      drawSill(c);

      /* the empty-room wash and today's treasures on the rug */
      walk.drawBack(g);
      /* THE RING WASH GOES UNDER HIM. That is what makes the spotlight a
         spotlight: the room dims, and the dog drawn after it does not. */
      contest.drawBack(g);

      /* The resting bowls, hidden while a care action has picked one up. Both
         sit clear of the dog's silhouette — a bowl tucked behind her body is a
         bowl she can never be seen to drag. */
      /* THROUGH THE REACHABLE PLAY AREA, like everything else the player can
         see and touch. These two are drawn while the nav IS on screen, so the
         bound applies even though the room never hit-tests them; at every inset
         a phone reports it is a no-op and they do not move. `bowlGrabRy()` is
         care.js's own grab half-height, so the number the drawing respects and
         the number the drag respects are the same number. */
      const SG = BALANCE.care.stage;
      const bry = SG.grabR / SG.grabAspect;
      if (care.mode !== 'feed') {
        drawBowl(c, SG.bowlHome[0], reach.clampY(SG.bowlHome[1], bry), SG.bowlScale, 'food', 0, time);
      }
      if (care.mode !== 'water') {
        drawBowl(c, SG.waterHome[0], reach.clampY(SG.waterHome[1], bry), SG.bowlScale * 0.78, 'water', 0.5, time);
      }

      /* THE TOY, IN FRONT OF HIM OR BEHIND HIM. The line is the ball's own
         resting depth (`toy.restLine`), not the rig origin: `rig.y - 8` was 698,
         which sat below every resting slot only while the ball's home was a
         hardcoded 736. With the slots derived from the reachable play area they
         rose above it, and a ball dropped at his feet after a flinch was sorted
         BEHIND him and vanished into his silhouette. See `restLine` in
         dog/toy.js. */
      const toyBehind = toy.toy.y < toy.restLine - 2 || toy.depth > 0.02;
      if (toyBehind) toy.draw(g);

      /* THE CARE PROPS THAT GO UNDER ALL OF HIM: the brushed-out fur pile,
         which really is on the rug behind his paws. The BOWL is not here —
         see below. */
      care.drawBehind(g);

      /* THE BOWL IS THREADED THROUGH HIM AT THREE DEPTHS (§19.5). His muzzle
         goes 18 units into a placed bowl, so the vessel cannot be on one side
         of him — but it cannot be behind ALL of him either, because it stands
         on the floor NEARER THE CAMERA THAN HIS CHEST. So `care.drawMid` goes
         into `dog.draw`'s mid slot, which sits between his body and his head:
         the far rim, the interior and the food land over his torso and under
         his muzzle, and `care.drawFront` puts the NEAR rim back over him
         below. Behind the whole dog (where this used to be) his chest cut the
         vessel in half the moment he sat up, which is the defect the human
         found on his phone.
         HE IS NOT HERE while he is away: the room is the whole point of the
         absence beat, and the dog is simply not drawn. */
      /* The slot is handed over ONLY when there is actually a vessel to thread
         through him. `care.bowlSplit` is `bowlIsSplit()` itself, not a copy of
         its condition, and `drawMid` re-asks it anyway, so the two cannot
         drift apart. Passing it unconditionally cost nothing visible but was
         not free: entering the slot swaps the transform out and back, and a
         re-derived matrix rounds the odd antialiased fur edge one bit
         differently, which showed up as four pixels of ±1 on a frame with no
         bowl in it at all. With no bowl there is now no slot, so the dog is
         byte-for-byte what he was before §19.5 by construction rather than by
         measurement — and `getTransform` is off the per-frame path for all the
         time he is not being fed. */
      const bowlSlot = care.bowlSplit ? care.drawMid : null;
      if (!walk.hidesDog) dog.draw(g, pet, a.game.moodLevel, care.coat, bowlSlot);
      /* he is away, so nothing of his is in front of anything: the slot still
         has to be run or the bowl would lose its far half entirely */
      else care.drawMid(g);
      drawParts(c);

      if (!toyBehind) toy.draw(g);
      care.drawFront(g);
      /* the treat, the reward ring and the ghost gesture hints sit in FRONT of
         her, the way the bowl does */
      train.drawFront(g);
      /* the lead, the collar, and whatever he has in his mouth */
      walk.drawFront(g);

      /* hand glow */
      const gl = pet.glow;
      if (gl > 0.02) {
        const U = BALANCE.ui.handGlow;
        const r = U.r + pet.level * U.rPet;
        const rg = c.createRadialGradient(a.input.state.lastX, a.input.state.lastY, 2,
          a.input.state.lastX, a.input.state.lastY, r);
        rg.addColorStop(0, `rgba(255,246,214,${(U.alpha * gl).toFixed(3)})`);
        rg.addColorStop(0.42, `rgba(255,238,196,${(0.11 * gl).toFixed(3)})`);
        rg.addColorStop(1, 'rgba(255,238,196,0)');
        c.fillStyle = rg;
        c.beginPath(); c.arc(a.input.state.lastX, a.input.state.lastY, r, 0, TAU); c.fill();
      }

      c.setTransform(1, 0, 0, 1, 0, 0);
      if (ovCv) c.drawImage(ovCv, 0, 0);
      g.toVirtual();

      reunion.drawOver(g);
      care.drawOver(g);
      train.drawOver(g);
      hud.draw(g, view);
      if (!naming.active && !care.modal && !train.modal && !reunion.active
        && !walk.modal && !contest.modal && !install.modal
        && !shop.modal && !kennel.modal) nav.draw(g);
      /* WHAT THE MESSAGE IS ABOUT, if anything: the bowl she is using, or the
         ball if it is loose on the floor. The room is the only layer that knows
         which of them is the current subject, so it is the room that says. */
      toasts.draw(g, nav.y - 22, toastSubject());
      /* the map is a full-surface overlay, so it goes over the nav — and the
         absence panel and the find card go over everything but the sheet */
      walk.drawOver(g);
      /* the judge's board, the chips and the result card, likewise */
      contest.drawOver(g);
      /* THE TRICK LIST, over the training chrome that opened it. Below the
         sheet and everything after it, because none of those can be open at
         the same time as training — the ordering here is what that claim looks
         like if it is ever wrong. */
      tricks.draw(g);
      collection.draw(g);
      sheet.draw(g);
      /* the shop and the kennel sit ABOVE the sheet and BELOW the install card,
         which is the same order surfaceOwner() puts them in */
      shop.draw(g);
      kennel.draw(g);
      /* the install card sits over the sheet (it is opened FROM the sheet) and
         under the naming beat, which the arbiter already makes mutually
         exclusive — the ordering is belt and braces, not a second guard */
      install.draw(g, view);
      naming.draw(g, view);
    },

    pointer(a, ev) {
      /* rig-local coords. NOTE rig.x/y/s move during a chase and the reunion,
         so this must be computed per event, never cached. */
      const local = () => ({ x: (ev.x - rig.x) / rig.s, y: (ev.y - rig.y) / (rig.s * (rig.sy || 1)) });

      /* the naming beat owns the whole surface while it is up */
      if (naming.active) { naming.pointer(ev, a.view); return; }

      /* THE INSTALL CARD, and it consumes EVERYTHING while it is up — including
         a touch that lands on him. A touch falling through a scrim to the
         petting field is the same defect the ring had to fix (§15.4 defect 1),
         and here it would also mean she can pet a dog she cannot see. */
      if (install.isOpen) {
        install.pointer(ev);
        capture = install.isOpen ? 'install' : '';
        return;
      }
      if (capture === 'install') { capture = ''; if (ev.type !== 'down') return; }

      /* THE KENNEL AND THE SHOP, and they consume EVERYTHING while they are up
         — including a touch that lands on him. A touch falling through a scrim
         to the petting field is the defect the ring had to fix (§15.4 defect 1)
         and the install card had to fix again; here it would also mean petting
         a dog she cannot see, and during the adoption beat it would mean
         petting a dog who is not in the room yet. The kennel is first because
         its beat outranks everything, its own `stop()` refuses while `busy`. */
      if (kennel.isOpen || kennel.busy) {
        kennel.pointer(ev);
        capture = (kennel.isOpen || kennel.busy) ? 'kennel' : '';
        return;
      }
      if (capture === 'kennel') { capture = ''; if (ev.type !== 'down') return; }
      if (shop.isOpen) {
        shop.pointer(ev);
        capture = shop.isOpen ? 'shop' : '';
        return;
      }
      if (capture === 'shop') { capture = ''; if (ev.type !== 'down') return; }

      /* THE TRICK LIST, and it consumes EVERYTHING while it is up — the same
         rule the shop, the kennel and the install card each had to be given.
         It is drawn over a scrim, so a touch falling through it would be a
         stroke on a dog she cannot see, and a stroke on the training screen is
         not inert: it is read as a guide gesture. */
      if (tricks.isOpen) {
        tricks.pointer(ev);
        capture = tricks.isOpen ? 'tricks' : '';
        return;
      }
      if (capture === 'tricks') { capture = ''; if (ev.type !== 'down') return; }

      /* THE COLLECTION, and it consumes everything while it is up — the same
         rule every full surface in here is given. */
      if (collection.isOpen) {
        collection.pointer(ev);
        capture = collection.isOpen ? 'collection' : '';
        return;
      }
      if (capture === 'collection') { capture = ''; if (ev.type !== 'down') return; }

      if (ev.type === 'down') {
        if (sheet.isOpen) {
          capture = 'sheet';
          const row = sheet.hit(ev.x, ev.y);
          /* acknowledge the touch BEFORE acting on it: `sheetAction` may close
             or re-open the sheet in the same frame, and a press that lands after
             that is a press on a row that no longer exists */
          if (row) sheet.press(row.id);
          if (row) sheetAction(row.id);
          return;
        }
        /* THE RING FIRST, and it consumes EVERYTHING while it owns the
           surface — including touches on him. Letting one fall through to the
           petting field would be petting him through a trial, which is the one
           thing a trial forbids (SCOPE stage 5). */
        if (contest.owns) {
          contest.pointer(ev, local());
          capture = 'contest';
          return;
        }
        /* THE WALK NEXT while it owns the surface: the leash beat, the map and
           the return each own the whole screen for a few seconds. */
        if (walk.owns) {
          if (walk.pointer(ev, local())) { capture = 'walk'; return; }
        }
        /* CARE FIRST. Feed and water consume the drag; wash and brush pass it
           straight through, so the petting field still does the real work. */
        if (care.modal) {
          const l0 = local();
          if (care.pointer(ev, l0)) { capture = 'care'; return; }
          capture = 'dog';
          a.game.noteTouch();
          pet.down(l0.x, l0.y, ev.x, ev.y);
          return;
        }
        /* TRAINING FIRST, and the same shape as wash and brush: a signal drawn
           in the pad is consumed, but a touch on HER passes straight through to
           the petting field, so guiding her into a pose still dents her coat,
           still finds the sweet spots, and still reads as touching a dog. */
        if (train.modal) {
          const l0 = local();
          if (train.pointer(ev, l0)) { capture = 'train'; return; }
          capture = 'dog';
          a.game.noteTouch();
          pet.down(l0.x, l0.y, ev.x, ev.y);
          return;
        }
        /* THE SILL OPENS THE COLLECTION. Before the nav pills, because it sits
           well above them, and before the dog, because it is up on the wall
           where no petting stroke starts. `walk.COPY.shelfSome` was written
           for this tap in stage 4 and had never been wired to anything. */
        if (!walk.away && collection && inRect(sillRect(), ev.x, ev.y)) {
          capture = 'collection';
          collection.start();
          return;
        }
        if (hud.hit(ev.x, ev.y)) { capture = 'hud'; hud.pressed = true; hud.showNeeds(); return; }
        const n = nav.hit(ev.x, ev.y);
        if (n) { capture = 'nav'; pressedNav = n; nav.pressed = n.id; return; }
        /* HE IS OUT. The chrome above still works — she can change a setting or
           bring him home — but nothing else does: letting a touch fall through
           to the petting field would register strokes on a dog who is not here. */
        if (walk.away) { walk.pointer(ev, local()); capture = 'walk'; return; }
        /* the ball, before the dog: it sits in front of her on the floor */
        if (!reunion.active && toy.pointer(ev, local())) { capture = 'toy'; return; }
        capture = 'dog';
        /* a touch after a long quiet gap starts a new petting session, which is
           what the per-session diminishing return is measured against */
        a.game.noteTouch();
        const l = local();
        pet.down(l.x, l.y, ev.x, ev.y);
        return;
      }

      if (ev.type === 'move') {
        if (capture === 'contest') { contest.pointer(ev, local()); return; }
      if (capture === 'walk') { walk.pointer(ev, local()); return; }
        if (capture === 'toy') { toy.pointer(ev, local()); return; }
        if (capture === 'care') { care.pointer(ev, local()); return; }
        if (capture === 'train') { train.pointer(ev, local()); return; }
        if (capture !== 'dog') return;
        const l = local();
        /* wash and brush read the same stroke the petting field reads */
        if (care.modal) care.pointer(ev, l);
        /* ...and so does a guide gesture */
        if (train.modal) train.pointer(ev, l);
        pet.move(l.x, l.y, ev.x, ev.y);
        return;
      }

      if (ev.type === 'up') {
        /* the name pill's press releases wherever the thumb goes: the panel is
           already open by then, so there is nothing to confirm on release */
        hud.pressed = false;
        if (capture === 'contest') { contest.pointer(ev, local()); capture = ''; return; }
      if (capture === 'walk') { walk.pointer(ev, local()); capture = ''; return; }
        if (capture === 'toy') { toy.pointer(ev, local()); capture = ''; return; }
        if (capture === 'care') { care.pointer(ev, local()); capture = ''; return; }
        if (capture === 'train') { train.pointer(ev, local()); capture = ''; return; }
        if (capture === 'nav') {
          nav.pressed = '';
          const n = nav.hit(ev.x, ev.y);
          if (n && pressedNav && n.id === pressedNav.id) navAction(a, n);
          pressedNav = null;
        } else if (capture === 'dog') {
          if (care.modal) care.pointer(ev, local());
          /* the guide is decided on release: it is the whole stroke that means
             something, not the last frame of it */
          if (train.modal) train.pointer(ev, local());
          pet.up(!ev.moved);
        }
        capture = '';
        return;
      }

      if (ev.type === 'cancel') {
        nav.pressed = ''; pressedNav = null; hud.pressed = false;
        if (capture === 'contest') contest.pointer(ev, local());
        else if (capture === 'walk') walk.pointer(ev, local());
        else if (capture === 'toy') toy.pointer(ev, local());
        else if (capture === 'care') care.pointer(ev, local());
        else if (capture === 'train') train.pointer(ev, local());
        else if (capture === 'dog') {
          if (train.modal) train.pointer(ev, local());
          pet.cancel();
        }
        capture = '';
      }
    },

    /* introspection for the dev harness */
    get debug() {
      const z = {};
      for (const id in pet.zoneSprings) z[id] = +pet.zoneSprings[id].x.toFixed(2);
      return {
        /* ---- stage 2: the two axes, side by side ---- */
        mood: +app.game.moodLevel.toFixed(3),
        moodBase: +app.game.moodBaseline.toFixed(3),
        bond: app.game.bondLedger,
        needs: {
          hunger: +app.game.dog.needs.hunger.toFixed(3),
          thirst: +app.game.dog.needs.thirst.toFixed(3),
          cleanliness: +app.game.dog.needs.cleanliness.toFixed(3),
          energy: +app.game.dog.needs.energy.toFixed(3),
        },
        words: {
          hunger: app.game.describeNeed('hunger'),
          thirst: app.game.describeNeed('thirst'),
          cleanliness: app.game.describeNeed('cleanliness'),
          energy: app.game.describeNeed('energy'),
          gloss: app.game.describeGloss(),
        },
        care: care.debug,
        toyState: toy.debug,
        train: train.debug,
        walk: walk.debug,
        contest: contest.debug,
        reunion: reunion.debug,
        naming: naming.debug,
        install: install ? install.debug : null,
        audio: app.audio && app.audio.debug ? app.audio.debug : null,
        /* who owns the whole screen. Two modal layers stacked is a defect that
           is invisible in a number unless the number exists, so here it is. */
        surface: surfaceOwner(),
        pendingNaming,
        named: app.game.isNamed,
        name: app.game.dog.name,
        neck: +(rig.drive.neck || 0).toFixed(3),
        pant: +(rig.drive.pant || 0).toFixed(3),
        needsShowing: hud.needsShowing,
        aff: +app.game.affection.toFixed(3), floor: +app.game.affectionFloor.toFixed(3),
        pet: +pet.level.toFixed(3), energy: +pet.energy.toFixed(3), zone: pet.IN.zone,
        kind: pet.IN.kind, z,
        irritation: +pet.irritation.toFixed(3), overstim: +pet.overstim.toFixed(3),
        contentment: +pet.contentment.toFixed(3), rhythm: pet.rhythm,
        yaw: +rig.pose.yaw.toFixed(2), pitch: +rig.pose.pitch.toFixed(2),
        pupil: [+rig.pose.pupilX.toFixed(3), +rig.pose.pupilY.toFixed(3)],
        pupilRaw: [+rig.springs.pupilX.x.toFixed(3), +rig.springs.pupilY.x.toFixed(3)],
        ear: [+rig.springs.earL.x.toFixed(3), +rig.springs.earR.x.toFixed(3)],
        sit: +rig.springs.sit.x.toFixed(2), eye: +rig.pose.eyeOpenEff.toFixed(2),
        /* stage 3's posture channels, so a trick pose is verifiable by number
           as well as by eye */
        downS: +rig.springs.down.x.toFixed(2), hopS: +rig.springs.hop.x.toFixed(2),
        sx: +(rig.sx === undefined ? 1 : rig.sx).toFixed(3),
        pawL: +rig.pawLift[0].x.toFixed(2), pawR: +rig.pawLift[1].x.toFixed(2),
        roll: +rig.springs.roll.x.toFixed(3), tilt: +rig.springs.tilt.x.toFixed(3),
        smile: +rig.springs.eyeSmile.x.toFixed(2), mouth: +rig.springs.mouth.x.toFixed(2),
        wag: +rig.springs.wagSpd.x.toFixed(2), amp: +rig.springs.wagAmp.x.toFixed(2),
        melt: +rig.springs.melt.x.toFixed(2),
        presses: pet.presses.length, parts: parts.length, clip: idle.current,
        isBid: idle.isBid, sinceBid: idle.sinceBid, quiet: +idle.quiet.toFixed(2),
        headXY: [+rig.pose.headX.toFixed(1), +rig.pose.headY.toFixed(1)],
        bodyXY: [+rig.pose.bodyX.toFixed(1), +rig.pose.bodyY.toFixed(1)],
        muzXY: [+rig.pose.muzX.toFixed(1), +rig.pose.muzY.toFixed(1)],
        tailMid: rig.pose.tailNodes[3]
          ? [+rig.pose.tailNodes[3].x.toFixed(1), +rig.pose.tailNodes[3].y.toFixed(1)] : null,
        zones: pet.zones.map((q) => ({ id: q.id, kind: q.kind, x: +q.x.toFixed(1), y: +q.y.toFixed(1), r: q.r })),
        scale: rig.s, origin: [rig.x, rig.y],
        /* ---- stage 6 ---- */
        shop: shop ? shop.debug : null,
        kennel: kennel ? kennel.debug : null,
        tricks: tricks ? tricks.debug : null,
        collection: collection ? collection.debug : null,
        wear: rig.wear || '',
        rug: rugShown,
        navIds: nav ? nav.items.map((i) => i.id) : [],
        navUnavailable: nav ? nav.items.filter((i) => i.available === false).map((i) => i.id) : [],
        owner: surfaceOwner(),
      };
    },
    get rig() { return rig; },
    /* the renderer itself, for `tools/bowlpixels.py`'s face seam (§19.7): the
       muzzle assertion has to know which pixels his FACE painted, and only the
       renderer knows where the face ends and the ears begin */
    get dog() { return dog; },
    get pet() { return pet; },
    get idle() { return idle; },
    get care() { return care; },
    get toy() { return toy; },
    get reunion() { return reunion; },
    get naming() { return naming; },
    get hud() { return hud; },
    get train() { return train; },
    get voice() { return voice; },
    get walk() { return walk; },
    get contest() { return contest; },
    get install() { return install; },
    get shop() { return shop; },
    get kennel() { return kennel; },
    /* the two stage-9 panels, exposed for the same reason every layer above is:
       a gate drives the real thing or it is not driving anything */
    get tricks() { return tricks; },
    get toasts() { return toasts; },
    get hud() { return hud; },
    /* the two halves of the toast placement rule, for tools/toastgate.py: what
       the message is about, and where it would land. Both go through the real
       code path — `probe` shares `liftFor` and `measure` with the live draw. */
    toastSubject,
    probeToast(text, avoid) {
      return lastG ? toasts.probe(lastG, nav.y - 22, avoid, text) : null;
    },
    navAction: (a, n) => navAction(a, n),
    get collection() { return collection; },
    /* drivers the verification harness needs; see window.__pp in main.js */
    openShop() { openShop(); return shop.isOpen; },
    openKennel() { openKennel(); return kennel.isOpen; },
    startCare(kind) { return startCare(kind); },
    stopCare() { care.stop(); },
    startTrain() { return startTrain(); },
    stopTrain() { if (train) train.stop(); },
    startWalk() { return startWalk(); },
    /** the arbiter, exposed so main.js's drivers cannot route around it */
    openNaming(mode) { return openNaming(mode); },
    surfaceOwner() { return surfaceOwner(); },
    stopWalk() { if (walk) walk.stop(); },
    startContest() { return startContest(); },
    stopContest() { if (contest) contest.stop(true); },
    playReunion(intensity, hours) {
      if (naming.active) naming.skip();
      return reunion.start(intensity, hours);
    },
    openCare() { openCare(); },
    openSettings() { openSettings(); },
    /* stage 9: the More sheet, and the nav itself — so the verification harness
       presses the pill the player presses rather than a guessed coordinate, and
       so "nothing is unreachable" can be checked by walking the real rows. */
    openMore() { openMore(); },
    get nav() { return nav; },
    get sheet() { return sheet; },
    get sheetKind() { return sheetKind; },
    toast(msg) { if (toasts) toasts.show(msg); },
  };

  return scene;
}

export default createRoomScene;
