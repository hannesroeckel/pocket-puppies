/* ==========================================================================
   ui/routemap.js — BEAT 2 of the walk: the cute hand-drawn map.

   She PICKS or DRAWS a route. Route drawing is "the distinctive, memorable
   half of the mechanic and it needs no dog rig at all" (research §8 judgement
   1), so this beat is the whole of the original's map-screen character bought
   for the price of some ink.

   Two things the original did that are deliberately NOT reproduced:
     - the STAMINA BAR that made you restart from the house when your path was
       too long. "Frustrating and it teaches nothing" (research §8). A path is
       never rejected here; its length simply sets how long he is out.
     - the walk as a DAILY OBLIGATION. There is no scold, no streak, no badge.

   What IS reproduced: four places that bias what comes home, the drawn line
   itself, and the loop that always starts and ends at the house — because the
   emotional shape of the feature is that he leaves and he comes back.

   NO PLAYER-FACING STRING LIVES IN THIS FILE. Copy is injected via `copy`,
   which dog/walk.js's COPY object supplies, so every stage-4 word is in one
   place and every pronoun comes from `game.pron`.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { TAU, clamp, lerp, smooth, roundRect, ell } from '../engine/draw.js';
import { Spring } from '../engine/spring.js';
import { normMix, dominant, ROUTES } from '../state/walks.js';
import { inkLine, drawPawPrint } from '../scenes/props.js';
import { drawText } from './text.js';
/* CHROME ONLY. The map itself is a hand-drawn painting and stays in the `C`
   palette below (ui/tokens.js rule 2: tokenising a painting makes it beige).
   What comes from the token set is the furniture sitting ON the painting — the
   one primary action, which has to be the same object here as it is on the
   install card and in the ring. */
import { INK, SURF, PRESS } from './tokens.js';
import { primaryAction, createPresses } from './surface.js';

const W = BALANCE.view.W;
const H = BALANCE.view.H;
const M = BALANCE.ui.map;
const WK = BALANCE.walk;

/* ---- map art palette (scene art, not a design tunable — §11 G) --------- */
const C = {
  paper: '#fdf4e0', paper2: '#f6e7c6', edge: '#e0c79c',
  ink: '#6b3a24', inkSoft: 'rgba(107,58,36,0.34)', inkFaint: 'rgba(107,58,36,0.16)',
  grass: '#a8c48f', grassD: '#84a472', tree: '#7f9f74', treeD: '#5f7d57',
  water: '#9ccada', waterD: '#74a8bd',
  brick: '#dba97e', brickD: '#bd8759', awning: '#cf6e58', awning2: '#87a89c',
  fir: '#5f7d57', firD: '#456349',
  route: '#cf6e58', routeSel: '#b8452f',
  house: '#e8c79a', roof: '#c25b46', door: '#8b5a37',
  gold: '#e9954f',
};

/* ==========================================================================
   canonical loops — one per route, house -> place -> house
   ========================================================================== */
function loopFor(route) {
  const h = M.house;
  const b = M.blobs[route];
  const bx = b.at[0], by = b.at[1];
  /* bow the two halves out to opposite sides so the loop reads as a round trip
     rather than as a there-and-back line drawn twice */
  const dx = bx - h[0], dy = by - h[1];
  const nx = -dy, ny = dx;
  const L = Math.hypot(nx, ny) || 1;
  const bow = 0.28;
  const c1 = [h[0] + dx * 0.35 + (nx / L) * L * bow * 0.5, h[1] + dy * 0.35 + (ny / L) * L * bow * 0.5];
  const c2 = [h[0] + dx * 0.35 - (nx / L) * L * bow * 0.5, h[1] + dy * 0.35 - (ny / L) * L * bow * 0.5];
  const pts = [];
  const bez = (p0, p1, p2, n) => {
    for (let i = 0; i <= n; i++) {
      const u = i / n, v = 1 - u;
      pts.push([v * v * p0[0] + 2 * v * u * p1[0] + u * u * p2[0],
        v * v * p0[1] + 2 * v * u * p1[1] + u * u * p2[1]]);
    }
  };
  bez(h, c1, [bx, by], 15);
  bez([bx, by], c2, h, 15);
  return pts;
}
const LOOPS = (() => {
  const m = {};
  for (const r of ROUTES) m[r] = loopFor(r);
  return m;
})();

export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return L;
}

/**
 * Which places a drawn path went through. Each recorded point that falls
 * inside a blob (expanded by `touchR`) is a vote, so a path that only clips
 * the corner of the woods still comes back with a pinecone or two.
 */
export function coverage(pts) {
  const votes = {};
  let any = 0;
  for (const p of pts) {
    for (const r of ROUTES) {
      const b = M.blobs[r];
      const dx = (p[0] - b.at[0]) / (b.r[0] + WK.map.touchR);
      const dy = (p[1] - b.at[1]) / (b.r[1] + WK.map.touchR);
      if (dx * dx + dy * dy <= 1) { votes[r] = (votes[r] || 0) + 1; any++; }
    }
  }
  if (!any) {
    /* she drew a line that missed everything — send him to whatever it came
       nearest, because refusing the drawing would be the stamina bar again */
    let best = ROUTES[0], bd = Infinity;
    const mid = pts.length ? pts[(pts.length / 2) | 0] : [W / 2, H / 2];
    for (const r of ROUTES) {
      const b = M.blobs[r];
      const d = Math.hypot(mid[0] - b.at[0], mid[1] - b.at[1]);
      if (d < bd) { bd = d; best = r; }
    }
    return { [best]: 1 };
  }
  return normMix(votes);
}

/** length -> real seconds out */
export function durationFor(len) {
  const u = clamp(len / WK.map.lenFull, 0, 1);
  return Math.round(lerp(WK.map.dur[0], WK.map.dur[1], u));
}

/* ==========================================================================
   the overlay
   ========================================================================== */
export function createRouteMap(opts = {}) {
  const reduced = !!opts.reduced;
  const copy = opts.copy || {};
  const onSetOff = opts.onSetOff || (() => {});
  const onCancel = opts.onCancel || (() => {});

  const slide = new Spring(0, reduced ? 90 : 128, reduced ? 20 : 15);
  let open = false;
  let t = 0;
  let mix = { park: 1 };
  let path = LOOPS.park.slice();
  let dur = durationFor(pathLength(LOOPS.park));
  let drawn = false;                 // she drew it herself rather than tapping
  let cap = '';                      // '' | 'draw' | 'go' | 'back'
  /* the Set-off button's tactile press. `cap` already knows the finger is down
     on it; this turns that boolean into the 100ms compression the rest of the
     game's controls have. */
  const presses = createPresses(opts.reduced);
  let live = [];                     // the path being drawn right now
  let travel = 0;
  let downAt = null;
  let flash = 0;                     // the "route set" pulse

  function pick(route, silent) {
    if (!ROUTES.includes(route)) return false;
    mix = { [route]: 1 };
    path = LOOPS[route].slice();
    dur = durationFor(pathLength(path));
    drawn = false;
    if (!silent) flash = 1;
    return true;
  }

  function setPath(pts) {
    const clean = (pts || []).filter((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]));
    if (clean.length < 2) return false;
    const len = pathLength(clean);
    if (len < WK.map.minLen) return false;
    mix = coverage(clean);
    /* thin it to the persisted cap so the save never carries a thousand points */
    const step = Math.max(1, Math.ceil(clean.length / WK.map.maxPts));
    path = clean.filter((p, i) => i % step === 0 || i === clean.length - 1);
    dur = durationFor(len);
    drawn = true;
    flash = 1;
    return true;
  }

  /* ---- geometry -------------------------------------------------------- */
  const goBox = () => ({
    x: (W - M.setOff.w) / 2, y: M.setOff.y - M.setOff.h / 2,
    w: M.setOff.w, h: M.setOff.h, r: M.setOff.r,
  });
  const inGo = (x, y) => {
    const b = goBox();
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  };
  const inBack = (x, y) => Math.hypot(x - M.back.x, y - M.back.y) <= M.back.r + 12;
  const blobHit = (x, y) => {
    for (const r of ROUTES) {
      const b = M.blobs[r];
      const dx = (x - b.at[0]) / (b.r[0] * 0.5 + WK.map.tapR);
      const dy = (y - b.at[1]) / (b.r[1] * 0.5 + WK.map.tapR);
      if (dx * dx + dy * dy <= 1) return r;
    }
    return '';
  };

  /* ==================================================================== */
  /*  art                                                                 */
  /* ==================================================================== */
  function drawPaper(c) {
    const a = clamp(slide.x, 0, 1);
    c.fillStyle = `rgba(48,24,12,${(0.52 * a).toFixed(3)})`;
    c.fillRect(0, 0, W, H);
    const top = M.top - 26 + (1 - a) * 40;
    /* THE PAPER HAS TO REACH PAST THE SET-OFF PILL. `cardTail` was a hardcoded
       96 here, which put the paper's bottom edge at 770 while the pill —
       centred at setOff.y=754, 50 tall, plus the 4-unit tactile edge under it —
       ends at 781. The primary action of the whole beat hung 11 units off the
       bottom of its own card, over the dimmed room. Rendered and seen; no gate
       measures a button against the card it sits on. Now a tunable, because
       every number that positions something belongs in state/balance.js. */
    const h = M.bottom - M.top + M.cardTail;
    const g = c.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0, C.paper); g.addColorStop(0.6, C.paper); g.addColorStop(1, C.paper2);
    c.fillStyle = g;
    roundRect(c, M.pad, top, W - M.pad * 2, h, 14); c.fill();
    /* torn-ish edge + fold crease, so it reads as paper not as a panel */
    c.strokeStyle = C.edge; c.lineWidth = 1.6;
    roundRect(c, M.pad, top, W - M.pad * 2, h, 14); c.stroke();
    c.strokeStyle = 'rgba(180,140,96,0.20)'; c.lineWidth = 1.1;
    c.beginPath(); c.moveTo(M.pad + 6, top + h * 0.46); c.lineTo(W - M.pad - 6, top + h * 0.46 - 3); c.stroke();
    c.beginPath(); c.moveTo(W / 2 + 4, top + 6); c.lineTo(W / 2 - 2, top + h - 6); c.stroke();
    /* grid, very faint */
    c.strokeStyle = 'rgba(180,140,96,0.10)'; c.lineWidth = 0.8;
    for (let x = M.pad + 24; x < W - M.pad; x += 26) {
      c.beginPath(); c.moveTo(x, top + 4); c.lineTo(x, top + h - 4); c.stroke();
    }
    for (let y = top + 24; y < top + h; y += 26) {
      c.beginPath(); c.moveTo(M.pad + 4, y); c.lineTo(W - M.pad - 4, y); c.stroke();
    }
  }

  function drawPark(c, b) {
    const [x, y] = b.at;
    c.fillStyle = C.grass;
    ell(c, x, y, b.r[0], b.r[1]); c.fill();
    c.fillStyle = C.grassD;
    ell(c, x - 8, y + b.r[1] * 0.42, b.r[0] * 0.72, b.r[1] * 0.34); c.fill();
    /* a little path across it */
    c.strokeStyle = 'rgba(253,244,224,0.7)'; c.lineWidth = 4.2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x - b.r[0] * 0.8, y + 14);
    c.quadraticCurveTo(x, y - 6, x + b.r[0] * 0.8, y + 10); c.stroke();
    /* three round trees */
    const trees = [[-30, -18, 15], [6, -26, 12], [30, -6, 13]];
    for (const [tx, ty, tr] of trees) {
      c.strokeStyle = '#9b6a3d'; c.lineWidth = 3.0;
      c.beginPath(); c.moveTo(x + tx, y + ty + tr * 0.7); c.lineTo(x + tx, y + ty + tr * 1.5); c.stroke();
      c.fillStyle = C.treeD; ell(c, x + tx, y + ty + 2, tr, tr * 0.92); c.fill();
      c.fillStyle = C.tree; ell(c, x + tx - 1.6, y + ty, tr * 0.92, tr * 0.84); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.22)'; ell(c, x + tx - tr * 0.4, y + ty - tr * 0.4, tr * 0.34, tr * 0.24, -0.5); c.fill();
    }
    /* a bench */
    c.fillStyle = '#a5773f';
    roundRect(c, x - 6, y + 26, 20, 3.2, 1.6); c.fill();
    roundRect(c, x - 6, y + 21, 20, 2.6, 1.3); c.fill();
  }

  function drawHigh(c, b) {
    const [x, y] = b.at;
    c.fillStyle = '#e6d3b4';
    ell(c, x, y, b.r[0], b.r[1]); c.fill();
    /* the road */
    c.strokeStyle = '#c9b391'; c.lineWidth = 13;
    c.beginPath(); c.moveTo(x - b.r[0] * 0.9, y + 22); c.lineTo(x + b.r[0] * 0.9, y + 18); c.stroke();
    c.strokeStyle = 'rgba(253,244,224,0.8)'; c.lineWidth = 1.6; c.setLineDash([5, 6]);
    c.beginPath(); c.moveTo(x - b.r[0] * 0.85, y + 22); c.lineTo(x + b.r[0] * 0.85, y + 18); c.stroke();
    c.setLineDash([]);
    /* a row of shopfronts */
    const shops = [[-34, 26, C.awning], [-6, 32, C.awning2], [22, 24, C.awning]];
    for (const [sx, sh, aw] of shops) {
      c.fillStyle = C.brickD; roundRect(c, x + sx, y + 8 - sh, 24, sh, 2); c.fill();
      c.fillStyle = C.brick; roundRect(c, x + sx + 1.4, y + 9 - sh, 21, sh - 2, 2); c.fill();
      c.fillStyle = '#9ec4cd'; roundRect(c, x + sx + 4, y + 12 - sh, 14, sh * 0.34, 1.4); c.fill();
      /* the awning: the thing that makes it read as a high street */
      c.fillStyle = aw;
      c.beginPath();
      c.moveTo(x + sx - 1, y + 8 - sh * 0.42);
      c.lineTo(x + sx + 25, y + 8 - sh * 0.42);
      c.lineTo(x + sx + 22, y + 14 - sh * 0.42);
      c.lineTo(x + sx + 2, y + 14 - sh * 0.42);
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.28)';
      c.fillRect(x + sx + 4, y + 8 - sh * 0.42, 4, 6);
      c.fillRect(x + sx + 13, y + 8 - sh * 0.42, 4, 6);
    }
    /* a lamp post */
    c.strokeStyle = '#7c6a54'; c.lineWidth = 2.0;
    c.beginPath(); c.moveTo(x + b.r[0] * 0.62, y + 16); c.lineTo(x + b.r[0] * 0.62, y - 6); c.stroke();
    c.fillStyle = C.gold; ell(c, x + b.r[0] * 0.62, y - 8, 3.4, 4.0); c.fill();
  }

  function drawRiver(c, b) {
    const [x, y] = b.at;
    c.fillStyle = '#cfdcbc';
    ell(c, x, y, b.r[0], b.r[1]); c.fill();
    /* the water, winding */
    const band = (col, w) => {
      c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x - b.r[0] * 0.95, y - 14);
      c.bezierCurveTo(x - 18, y - 2, x + 14, y + 6, x + b.r[0] * 0.95, y + 22);
      c.stroke();
    };
    band(C.waterD, 20); band(C.water, 15);
    c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(x - b.r[0] * 0.7, y - 12);
    c.bezierCurveTo(x - 16, y - 1, x + 12, y + 7, x + b.r[0] * 0.72, y + 18);
    c.stroke();
    /* the bridge */
    c.strokeStyle = '#a5773f'; c.lineWidth = 3.4;
    c.beginPath(); c.arc(x - 4, y + 8, 15, Math.PI * 1.08, Math.PI * 1.92); c.stroke();
    c.strokeStyle = '#c69456'; c.lineWidth = 1.8;
    c.beginPath(); c.arc(x - 4, y + 10, 15, Math.PI * 1.08, Math.PI * 1.92); c.stroke();
    /* reeds + a duck */
    c.strokeStyle = C.grassD; c.lineWidth = 1.8;
    for (let i = 0; i < 5; i++) {
      const rx = x - 26 + i * 5.4;
      c.beginPath(); c.moveTo(rx, y + 26); c.lineTo(rx + (i % 2 ? 2.4 : -2.4), y + 13); c.stroke();
    }
    c.fillStyle = '#f6f0dc'; ell(c, x + 22, y + 12, 5.0, 3.6); c.fill();
    c.fillStyle = '#e8b93f';
    c.beginPath(); c.moveTo(x + 26.6, y + 10.6); c.lineTo(x + 30, y + 11.4); c.lineTo(x + 26.6, y + 12.4); c.closePath(); c.fill();
    c.fillStyle = '#6b7f5a'; ell(c, x + 25, y + 8.6, 2.6, 2.4); c.fill();
  }

  function drawWoods(c, b) {
    const [x, y] = b.at;
    c.fillStyle = '#8fae7c';
    ell(c, x, y, b.r[0], b.r[1]); c.fill();
    c.fillStyle = '#7d9d6c';
    ell(c, x + 6, y + b.r[1] * 0.40, b.r[0] * 0.76, b.r[1] * 0.36); c.fill();
    /* a track winding in */
    c.strokeStyle = 'rgba(200,166,120,0.85)'; c.lineWidth = 4.0; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x - 4, y + b.r[1] * 0.85);
    c.quadraticCurveTo(x + 10, y + 8, x - 6, y - b.r[1] * 0.6); c.stroke();
    /* conifers */
    const firs = [[-34, 6, 1.15], [-16, -14, 0.95], [12, -20, 1.05], [30, 2, 1.20], [-2, 12, 0.85], [22, -30, 0.75]];
    for (const [fx, fy, k] of firs) {
      const bx = x + fx, by = y + fy;
      c.strokeStyle = '#7d5527'; c.lineWidth = 2.6 * k;
      c.beginPath(); c.moveTo(bx, by + 16 * k); c.lineTo(bx, by + 22 * k); c.stroke();
      for (let tier = 0; tier < 3; tier++) {
        const ty = by + 14 * k - tier * 9 * k;
        const tw = (14 - tier * 3.2) * k;
        c.fillStyle = tier === 2 ? C.fir : C.firD;
        c.beginPath();
        c.moveTo(bx, ty - 13 * k); c.lineTo(bx + tw, ty); c.lineTo(bx - tw, ty); c.closePath(); c.fill();
      }
    }
    /* a couple of mushrooms, because woods */
    c.fillStyle = '#f3e6cd'; roundRect(c, x + 38, y + 20, 2.6, 5, 1.2); c.fill();
    c.fillStyle = '#c25b46'; ell(c, x + 39.3, y + 20, 4.6, 3.0); c.fill();
  }

  const PLACE = { park: drawPark, high: drawHigh, river: drawRiver, woods: drawWoods };

  function drawHouse(c) {
    const [x, y] = M.house;
    c.fillStyle = 'rgba(104,58,32,0.16)'; ell(c, x + 2, y + 17, 24, 6); c.fill();
    c.fillStyle = C.house; roundRect(c, x - 18, y - 6, 36, 22, 3); c.fill();
    c.fillStyle = C.roof;
    c.beginPath(); c.moveTo(x - 22, y - 5); c.lineTo(x, y - 22); c.lineTo(x + 22, y - 5); c.closePath(); c.fill();
    c.fillStyle = '#a94d3c';
    c.beginPath(); c.moveTo(x - 22, y - 5); c.lineTo(x, y - 22); c.lineTo(x - 2, y - 22); c.lineTo(x - 24, y - 5); c.closePath(); c.fill();
    c.fillStyle = C.door; roundRect(c, x - 5, y + 3, 10, 13, 1.6); c.fill();
    c.fillStyle = C.gold; ell(c, x + 2.4, y + 9.6, 1.1, 1.1); c.fill();
    c.fillStyle = '#9ec4cd'; roundRect(c, x - 15, y - 1, 7, 7, 1.2); c.fill();
    roundRect(c, x + 8, y - 1, 7, 7, 1.2); c.fill();
    /* two paw prints leaving the door, so the house reads as HIS house */
    drawPawPrint(c, x + 12, y + 22, 1.0, 0.4, 0.55);
    drawPawPrint(c, x + 19, y + 26, 1.0, 0.5, 0.38);
  }

  /* ==================================================================== */
  const api = {
    get isOpen() { return open; },
    get active() { return open || slide.x > 0.01; },
    get mix() { return { ...mix }; },
    get route() { return dominant(mix); },
    get dur() { return dur; },
    get path() { return path.map((p) => [Math.round(p[0]), Math.round(p[1])]); },
    get drawn() { return drawn; },

    open(view) {
      open = true;
      t = 0;
      cap = '';
      live = [];
      slide.to(1);
      /* default to the last place he enjoyed, or the park */
      if (!ROUTES.includes(dominant(mix))) pick('park', true);
      return true;
    },
    close() { open = false; slide.to(0); live = []; cap = ''; },
    pick, setPath,

    update(dt) {
      slide.step(dt);
      if (open) t += dt;
      if (flash > 0) flash = Math.max(0, flash - dt * 2.4);
      presses.set('go', cap === 'go');
      presses.update(dt);
    },

    /* ---- input ------------------------------------------------------- */
    pointer(ev) {
      if (!open || slide.x < 0.3) return false;
      const { x, y } = ev;
      if (ev.type === 'down') {
        if (inBack(x, y)) { cap = 'back'; return true; }
        if (inGo(x, y)) { cap = 'go'; return true; }
        cap = 'draw';
        live = [[x, y]];
        travel = 0;
        downAt = [x, y];
        return true;
      }
      if (ev.type === 'move') {
        if (cap !== 'draw') return cap !== '';
        const last = live[live.length - 1];
        const d = Math.hypot(x - last[0], y - last[1]);
        if (d >= WK.map.sample) {
          travel += d;
          live.push([x, y]);
          if (live.length > 400) live.shift();
        }
        return true;
      }
      if (ev.type === 'up' || ev.type === 'cancel') {
        const was = cap;
        cap = '';
        if (ev.type === 'cancel') { live = []; return true; }
        if (was === 'back') { if (inBack(x, y)) onCancel(); return true; }
        if (was === 'go') {
          if (inGo(x, y)) onSetOff(api.mix, dur, api.path);
          return true;
        }
        if (was === 'draw') {
          /* a short scribble is a TAP — pick the place under her finger */
          if (travel < WK.map.minLen) {
            const r = blobHit(downAt ? downAt[0] : x, downAt ? downAt[1] : y);
            if (r) pick(r);
          } else {
            /* the loop must come home, so the house is stitched on both ends */
            const full = [M.house.slice()].concat(live, [M.house.slice()]);
            setPath(full);
          }
          live = [];
          return true;
        }
        return true;
      }
      return false;
    },

    /* ---- draw -------------------------------------------------------- */
    draw(g, view) {
      if (slide.x < 0.002) return;
      const c = g.ctx;
      const a = clamp(slide.x, 0, 1);
      const ph = t * M.wobbleRate;
      const wob = reduced ? 0 : M.wobble;
      c.save();
      c.globalAlpha = 1;
      drawPaper(c);
      c.save();
      c.globalAlpha = a;
      c.translate(0, (1 - a) * 26);

      /* the four places */
      for (const r of ROUTES) {
        const b = M.blobs[r];
        const sel = (mix[r] || 0) > 0.02;
        c.save();
        c.globalAlpha = a * (sel ? 1 : 0.78);
        PLACE[r](c, b);
        c.restore();
      }

      drawHouse(c);

      /* every route she could take, faint */
      c.lineCap = 'round';
      for (const r of ROUTES) {
        if ((mix[r] || 0) > 0.02) continue;
        c.strokeStyle = C.inkFaint; c.lineWidth = 2.6;
        c.setLineDash([4, 8]);
        inkLine(c, LOOPS[r], wob * 0.6, ph + r.length);
        c.stroke();
      }
      c.setLineDash([]);

      /* the route she has actually chosen */
      const shown = live.length > 1 ? live : path;
      c.strokeStyle = 'rgba(255,248,232,0.85)'; c.lineWidth = 7.0;
      inkLine(c, shown, wob, ph); c.stroke();
      c.strokeStyle = live.length > 1 ? C.route : C.routeSel;
      c.lineWidth = 3.4 + flash * 1.6;
      c.setLineDash([9, 6]);
      c.lineDashOffset = -t * 22;
      inkLine(c, shown, wob, ph); c.stroke();
      c.setLineDash([]);
      /* paw prints along it, spaced out, so the line reads as a walk */
      if (shown.length > 3) {
        const n = Math.min(10, Math.max(3, Math.floor(shown.length / 3)));
        for (let i = 1; i < n; i++) {
          const q = shown[Math.floor((i / n) * (shown.length - 1))];
          const q2 = shown[Math.min(shown.length - 1, Math.floor((i / n) * (shown.length - 1)) + 1)];
          const rot = Math.atan2(q2[1] - q[1], q2[0] - q[0]) + Math.PI / 2;
          drawPawPrint(c, q[0], q[1], 0.92, rot, a * 0.5);
        }
      }

      /* ---- the place labels, LAST, so an inked route can never be drawn
             across a word (it was, and it made three of the four unreadable) - */
      c.globalAlpha = a;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      for (const r of ROUTES) {
        const b = M.blobs[r];
        const sel = (mix[r] || 0) > 0.02;
        c.font = '700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const label = (copy.routeName ? copy.routeName(r) : r);
        const lw = c.measureText(label).width + 16;
        const ly = b.at[1] + b.r[1] + 13;
        c.fillStyle = sel ? '#fff8ea' : 'rgba(255,248,232,0.92)';
        roundRect(c, b.at[0] - lw / 2, ly - 9, lw, 18, 9); c.fill();
        c.strokeStyle = sel ? C.routeSel : C.inkFaint; c.lineWidth = sel ? 1.6 : 1.0;
        roundRect(c, b.at[0] - lw / 2, ly - 9, lw, 18, 9); c.stroke();
        drawText(g, label, {
          x: b.at[0], y: ly + 0.5, size: 12, weight: 700,
          ink: sel ? C.routeSel : C.ink, over: '#fff8ea',
          maxWidth: lw - 6, fade: a,
        });
      }

      /* ---- chrome ----
         All of it through ui/text.js with `over` set to the PAPER, so the
         contrast is checked against the thing it is actually drawn on and no
         scrim is added over the hand-drawn map — the paper is the charm of the
         beat. `paper2` is the darker end of the paper's gradient, i.e. the
         worst case of the two. */
      if (copy.mapTitle) {
        drawText(g, copy.mapTitle(), {
          y: M.titleY, size: 16, weight: 700, ink: C.ink, over: C.paper2, fade: a,
        });
      }
      if (copy.mapHint) {
        /* this one is translucent, and its TRUE contrast on the paper is 4.58,
           not the 7.61 its nominal colour suggests — the helper composites the
           alpha before measuring rather than flattering it */
        drawText(g, copy.mapHint(), {
          y: M.hintY, size: 11.5, weight: 500,
          ink: 'rgba(107,58,36,0.66)', over: C.paper2, fade: a,
        });
      }

      /* the readout: where, and how long, IN WORDS. Above the button, not
         behind it — at M.bottom+32 the Set-off pill sat on top of the words. */
      const line = copy.mapChoice ? copy.mapChoice(dominant(mix), mix, dur, drawn) : '';
      if (line) {
        drawText(g, line, {
          y: M.choiceY, size: 13, weight: 700, ink: C.ink, over: C.paper2, fade: a,
        });
      }

      /* SET OFF — the primary action, and the SAME OBJECT as the install
         card's "Got it" and the ring's "Into the ring". It used to be gold
         `#e9954f` with a 1.4px stroke and a hue shift on press; that made it
         the third distinct primary treatment in the game and it read as a
         different product's button sitting on our map. `cap === 'go'` already
         knew the thumb was down, so it now compresses like everything else. */
      const b = goBox();
      const bf = primaryAction(c, {
        x: b.x, y: b.y - PRESS.edge / 2, w: b.w, h: b.h, r: b.r,
        p: presses.at('go'), fade: a,
      });
      drawText(g, copy.setOff ? copy.setOff() : 'Set off', {
        y: bf.y + bf.h / 2 + 0.5, size: 15, weight: 700,
        ink: INK.onStrong, over: SURF.chipStrong,
        maxWidth: b.w - 24, fade: a,
      });

      /* back */
      c.fillStyle = 'rgba(255,248,232,0.9)';
      c.beginPath(); c.arc(M.back.x, M.back.y, M.back.r, 0, TAU); c.fill();
      c.strokeStyle = C.inkSoft; c.lineWidth = 1.3;
      c.beginPath(); c.arc(M.back.x, M.back.y, M.back.r, 0, TAU); c.stroke();
      c.strokeStyle = C.ink; c.lineWidth = 2.2; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(M.back.x + 4, M.back.y - 6); c.lineTo(M.back.x - 4, M.back.y);
      c.lineTo(M.back.x + 4, M.back.y + 6); c.stroke();

      c.restore();
      c.restore();
    },

    get debug() {
      return {
        open, slide: +slide.x.toFixed(3), route: dominant(mix),
        mix: Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, +v.toFixed(3)])),
        dur, drawn, pts: path.length, live: live.length, travel: Math.round(travel),
      };
    },
  };

  return api;
}

export default createRouteMap;
