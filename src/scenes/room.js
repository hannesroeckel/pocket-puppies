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
import { createHud } from '../ui/hud.js';
import { createNav } from '../ui/nav.js';
import { createToasts } from '../ui/toast.js';
import { createSheet } from '../ui/sheet.js';
import { heartPath } from '../ui/meter.js';
import { exportSave, importSave, writeNow, clear as clearSave } from '../state/save.js';

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

function drawBowl(c, bx, by, s, teal) {
  c.save(); c.translate(bx, by); c.scale(s, s);
  c.fillStyle = 'rgba(104,58,32,0.20)'; ell(c, 2, 6, 34, 10); c.fill();
  const g = c.createLinearGradient(-30, -14, 30, 14);
  g.addColorStop(0, teal ? C.tealL : '#e5b98d');
  g.addColorStop(0.5, teal ? C.teal : '#d09a63');
  g.addColorStop(1, teal ? C.tealD : '#b57c47');
  c.fillStyle = g;
  c.beginPath(); c.moveTo(-30, -8);
  c.bezierCurveTo(-28, 10, -16, 18, 0, 18);
  c.bezierCurveTo(16, 18, 28, 10, 30, -8);
  c.closePath(); c.fill();
  c.fillStyle = teal ? '#f0f2e6' : '#f6e6c9'; ell(c, 0, -8, 30, 9.5); c.fill();
  c.fillStyle = teal ? C.tealD : '#a97141'; ell(c, 0, -7, 24.5, 7); c.fill();
  if (!teal) {
    c.fillStyle = '#a9743f'; ell(c, 0, -9, 21, 6.4); c.fill();
    c.fillStyle = '#c08a4d';
    const kb = [[-13, -11, 4.4], [-5, -13, 4.8], [4, -12, 4.4], [12, -10, 4], [-9, -8, 4.2],
      [1, -7.6, 4.6], [9, -8.4, 4.1], [-16, -8, 3.4], [16, -7.6, 3.2]];
    kb.forEach((k, i) => { ell(c, k[0], k[1], k[2], k[2] * 0.78, i * 0.7); c.fill(); });
    c.fillStyle = 'rgba(255,235,190,0.5)';
    for (let i = 0; i < kb.length; i += 2) { ell(c, kb[i][0] - 1, kb[i][1] - 1.4, kb[i][2] * 0.36, kb[i][2] * 0.26, 0); c.fill(); }
  } else {
    c.fillStyle = 'rgba(150,196,206,0.92)'; ell(c, 0, -8, 24, 7); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    ell(c, -8, -10, 8, 2.4, -0.15); c.fill();
    ell(c, 8, -7, 5, 1.6, 0.2); c.fill();
  }
  c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1.6;
  c.beginPath(); c.ellipse(0, -8, 30, 9.5, 0, Math.PI * 1.05, Math.PI * 1.85); c.stroke();
  c.restore();
}

function drawBall(c, bx, by, s) {
  c.save(); c.translate(bx, by); c.scale(s, s);
  c.fillStyle = 'rgba(104,58,32,0.22)'; ell(c, 2, 15, 16, 5); c.fill();
  const g = c.createRadialGradient(-6, -7, 2, 0, 0, 20);
  g.addColorStop(0, '#f7f0dd'); g.addColorStop(0.42, '#e8dcc0'); g.addColorStop(1, '#c9b28c');
  c.fillStyle = g; ell(c, 0, 0, 16, 16); c.fill();
  c.save(); ell(c, 0, 0, 16, 16); c.clip();
  c.fillStyle = '#cf6e58';
  c.beginPath(); c.moveTo(-18, -4); c.quadraticCurveTo(0, -11, 18, -4);
  c.lineTo(18, 4); c.quadraticCurveTo(0, -3, -18, 4); c.closePath(); c.fill();
  c.fillStyle = C.teal;
  c.beginPath(); c.moveTo(-18, 8); c.quadraticCurveTo(0, 1, 18, 8);
  c.lineTo(18, 13); c.quadraticCurveTo(0, 6, -18, 13); c.closePath(); c.fill();
  c.restore();
  c.strokeStyle = 'rgba(124,74,47,0.38)'; c.lineWidth = 1.6; ell(c, 0, 0, 16, 16); c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.6)'; ell(c, -6, -7, 4.6, 3.2, -0.6); c.fill();
  c.restore();
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

function drawRug(c) {
  const cx = 192, cy = 698, rx = 196, ry = 84;
  c.save();
  c.fillStyle = 'rgba(104,58,32,0.13)'; ell(c, cx + 3, cy + 7, rx * 1.01, ry * 1.02); c.fill();
  c.strokeStyle = '#e9d3ac'; c.lineWidth = 3; c.lineCap = 'round';
  for (let f = 0; f < 30; f++) {
    const a = (f / 30) * TAU;
    const ex = cx + Math.cos(a) * rx, ey = cy + Math.sin(a) * ry;
    c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex + Math.cos(a) * 11, ey + Math.sin(a) * 7); c.stroke();
  }
  const g = c.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
  g.addColorStop(0, '#d97a62'); g.addColorStop(0.5, C.rug1); g.addColorStop(1, '#b85a48');
  c.fillStyle = g; ell(c, cx, cy, rx, ry); c.fill();
  c.fillStyle = C.rug2; ell(c, cx, cy, rx * 0.88, ry * 0.85); c.fill();
  c.fillStyle = C.rug4; ell(c, cx, cy, rx * 0.80, ry * 0.76); c.fill();
  c.fillStyle = C.rug2; ell(c, cx, cy, rx * 0.74, ry * 0.70); c.fill();
  const g2 = c.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
  g2.addColorStop(0, '#cf7460'); g2.addColorStop(1, C.rug3);
  c.fillStyle = g2; ell(c, cx, cy, rx * 0.64, ry * 0.60); c.fill();
  c.fillStyle = '#e2937c'; ell(c, cx, cy, rx * 0.30, ry * 0.30); c.fill();
  c.fillStyle = C.rug2; ell(c, cx, cy, rx * 0.22, ry * 0.22); c.fill();
  c.fillStyle = C.rug4; ell(c, cx, cy, rx * 0.11, ry * 0.11); c.fill();
  c.setLineDash([7, 9]); c.lineWidth = 2.2;
  c.strokeStyle = 'rgba(253,244,226,0.55)';
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
  let hud = null, nav = null, toasts = null, sheet = null;
  let roomCv = null, ovCv = null;
  const rng = createRng(BALANCE.rng.seed).fork(3);
  const roomRng = createRng(BALANCE.rng.roomSeed);
  const parts = [];
  const motes = [];
  let time = 0;
  let capture = '';
  let pressedNav = null;

  const POI = [
    { x: 66, y: 608, w: 1.3 },    // food bowl
    { x: 330, y: 730, w: 1.4 },   // ball
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
  function buildRoom(view) {
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

    drawRug(c);
    drawBowl(c, 66, 626, 0.86, false);
    drawBowl(c, 128, 604, 0.62, true);
    drawBall(c, 330, 736, 1.0);
    drawBone(c, 96, 792, -0.22);
    drawPouf(c);

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

  /* ---- settings sheet --------------------------------------------- */
  function openSettings() {
    sheet.open({
      title: 'Settings',
      rows: [
        { id: 'sound', label: app.game.state.settings.sound ? 'Sound: on' : 'Sound: off', note: 'Sounds arrive in a later update' },
        { id: 'export', label: 'Copy save code', note: 'Keep a backup of your bond' },
        { id: 'import', label: 'Load save code', note: 'Paste a code from another device' },
        { id: 'close', label: 'Done' },
      ],
    });
  }

  function sheetAction(id) {
    if (id === 'close' || id === '__backdrop') { sheet.close(); return; }
    if (id === 'sound') {
      const on = !app.game.state.settings.sound;
      app.game.setSetting('sound', on);
      app.audio.setEnabled(on);
      openSettings();
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
          onAffection: (amt) => {
            app.game.addAffection(amt);
            hud.bumpHint(app.game.affection);
          },
          onTapAffection: (amt, zid) => app.game.addAffection(amt, 'petted her ' + zid),
          onSpawn: (kind, lx, ly) => spawn(kind,
            rig.x + lx * rig.s + rng.range(-9, 9),
            rig.y + ly * rig.s + rng.range(-7, 7)),
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
      hud = createHud(app.game, { hint: 'Stroke the puppy', getTime: () => time });
      nav = createNav([
        { id: 'care', label: 'Care', available: app.nav.has('care') },
        { id: 'walk', label: 'Walk', available: app.nav.has('walk') },
        { id: 'train', label: 'Train', available: app.nav.has('train') },
        { id: 'play', label: 'Play', available: app.nav.has('contest') },
        { id: 'shop', label: 'Shop', available: app.nav.has('shop') },
        { id: 'settings', label: 'More', icon: 'settings', available: true },
      ], { safeBottom: app.view.safe.bottom / app.view.vs });

      scene.resize(app);

      /* settle one frame so the zones exist before the first touch */
      rig.gaze.yaw = 0.18; rig.gaze.pitch = 0.10;
      rig.base(app.game.mood, 1 / 60);
      rig.update(1 / 60);
      pet.computeZones();

      if (params && params.reunion) {
        toasts.show(app.game.dog.name + ' missed you');
        idle.play('wagBurst');
      }
    },

    exit() {
      roomCv = null; ovCv = null;
      parts.length = 0;
    },

    resize(a) {
      const view = a.view;
      buildRoom(view);
      buildOverlay(view);
      initMotes();
      if (nav) nav.layout(view.safe.bottom / view.vs);
      if (sheet) sheet.setInset(view.safe.bottom / view.vs);
    },

    update(a, dt, t) {
      time = t;
      const game = a.game;

      /* affection drifts toward the ratchet floor, never below it */
      game.drainAffection(dt);
      game.decayAffectionPulse(dt);

      /* --- the pose pipeline, in order --- */
      const mood = game.mood;
      rig.base(mood, dt);
      idle.update(dt, {
        affection: mood.affection,
        petLevel: pet.level,
        petDown: pet.IN.down,
        sinceTouch: pet.sinceTouch,
      });
      pet.apply(dt, mood);
      rig.update(dt);
      pet.computeZones();

      updateParts(dt);
      toasts.update(dt);
      sheet.update(dt);
      hud.update(dt);
    },

    draw(a, g) {
      const c = g.ctx;
      const view = a.view;

      c.setTransform(1, 0, 0, 1, 0, 0);
      if (roomCv) c.drawImage(roomCv, 0, 0);
      g.toVirtual();
      c.lineJoin = 'round'; c.lineCap = 'round';

      drawMotes(c, 1 / 60);
      dog.draw(g, pet, a.game.affection);
      drawParts(c);

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

      hud.draw(g, view);
      nav.draw(g);
      toasts.draw(g, nav.y - 22);
      sheet.draw(g);
    },

    pointer(a, ev) {
      const local = () => ({ x: (ev.x - rig.x) / rig.s, y: (ev.y - rig.y) / rig.s });

      if (ev.type === 'down') {
        if (sheet.isOpen) {
          capture = 'sheet';
          const row = sheet.hit(ev.x, ev.y);
          if (row) sheetAction(row.id);
          return;
        }
        const n = nav.hit(ev.x, ev.y);
        if (n) { capture = 'nav'; pressedNav = n; nav.pressed = n.id; return; }
        capture = 'dog';
        const l = local();
        pet.down(l.x, l.y, ev.x, ev.y);
        return;
      }

      if (ev.type === 'move') {
        if (capture !== 'dog') return;
        const l = local();
        pet.move(l.x, l.y, ev.x, ev.y);
        return;
      }

      if (ev.type === 'up') {
        if (capture === 'nav') {
          nav.pressed = '';
          const n = nav.hit(ev.x, ev.y);
          if (n && pressedNav && n.id === pressedNav.id) {
            if (n.id === 'settings') openSettings();
            else if (!a.nav.go(n.id)) toasts.show(n.label + ' — coming soon');
          }
          pressedNav = null;
        } else if (capture === 'dog') {
          pet.up(!ev.moved);
        }
        capture = '';
        return;
      }

      if (ev.type === 'cancel') {
        nav.pressed = ''; pressedNav = null;
        if (capture === 'dog') pet.cancel();
        capture = '';
      }
    },

    /* introspection for the dev harness */
    get debug() {
      const z = {};
      for (const id in pet.zoneSprings) z[id] = +pet.zoneSprings[id].x.toFixed(2);
      return {
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
      };
    },
    get rig() { return rig; },
    get pet() { return pet; },
    get idle() { return idle; },
    toast(msg) { if (toasts) toasts.show(msg); },
  };

  return scene;
}

export default createRoomScene;
