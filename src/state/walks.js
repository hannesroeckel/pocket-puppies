/* ==========================================================================
   state/walks.js — the WALK MODEL, and the reason a walk survives the app
   being killed.

   iOS SUSPENDS JAVASCRIPT ENTIRELY when the app is not foregrounded — timers
   do not throttle, they stop (docs/PLATFORM-RISKS.md risk 3). So there is no
   tick in here anywhere. A walk is three persisted numbers:

       startedAt   epoch ms
       dur         planned seconds
       seed        integer

   and everything else is a PURE FUNCTION of `now`:

       progress = (now - startedAt) / dur          clamped to 0..1
       finds    = seeded roll at that progress

   Which means: close the app, kill it from the switcher, come back in nine
   hours — he is home, with the same thing he would have brought home if she
   had watched the whole time. Resuming twice gives the identical result
   because the roll reads the persisted seed, never `Math.random`.

   AND `picked`, WHICH IS THE ONE THING WATCHING CHANGES (schema 11). The stroll
   (dog/stroll.js) lets her tap the things he passes, and what she taps is what
   he keeps. That has to be a fourth persisted field for exactly the reason the
   other three are persisted: the app can be closed in the middle of it, and a
   tap that only lived in a layer is a tap that never happened. It does not make
   the roll less pure — the picks are read off the record like the seed is — and
   an EMPTY `picked` falls straight back to the ordinary roll, so a walk nobody
   watched is worth precisely what it always was.

   THE CLOCK-TAMPER GUARD. A device clock that moves BACKWARDS (manual change,
   timezone travel, DST) would otherwise make `now - startedAt` negative and
   send the maths strange — or, worse, persist a corrupted `startedAt`. A
   `startedAt` in the future is never legitimate, so it is clamped to now: the
   walk restarts rather than the save breaking. `progress` can therefore never
   be negative and can never be NaN, whatever the clock does.

   DAY BOUNDARY. `walksToday` resets at LOCAL midnight (state/time.js
   `dayIndex`, which is timezone-aware and NOT UTC). It is checked here on
   every read as well as in `applyElapsed`, so the counter also rolls over for
   a session that is simply left open across midnight.
   ========================================================================== */
import BALANCE from './balance.js';
import { clamp } from '../engine/draw.js';
import { createRng } from '../engine/rng.js';
import { dayIndex } from './time.js';

const W = BALANCE.walk;
const F = W.find;

/** a finite number or the fallback — see state/game.js on why this is needed */
const num = (v, f = 0) => { const n = +v; return Number.isFinite(n) ? n : f; };

export const ROUTES = W.routes;
export const FINDS = W.finds;
/** find id -> spec, built once */
export const FIND_BY_ID = (() => {
  const m = {};
  for (const f of W.finds) m[f.id] = f;
  return m;
})();

/* ==========================================================================
   normalisation
   ========================================================================== */
/**
 * Normalise a route mix to weights summing to 1. Accepts a route id, a partial
 * map, or junk. Junk becomes an even walk round the park, because a walk that
 * refuses to start is worse than a walk that starts somewhere sensible.
 */
export function normMix(mix) {
  const out = {};
  let total = 0;
  if (typeof mix === 'string') {
    if (ROUTES.includes(mix)) return { [mix]: 1 };
    return { park: 1 };
  }
  if (mix && typeof mix === 'object') {
    for (const r of ROUTES) {
      const v = Math.max(0, num(mix[r], 0));
      if (v > 0) { out[r] = v; total += v; }
    }
  }
  if (total <= 0) return { park: 1 };
  for (const r in out) out[r] = out[r] / total;
  return out;
}

/** the dominant route of a mix — what the copy calls the walk */
export function dominant(mix) {
  const m = normMix(mix);
  let best = ROUTES[0], bv = -1;
  for (const r of ROUTES) if ((m[r] || 0) > bv) { bv = m[r] || 0; best = r; }
  return best;
}

/** blend a per-route multiplier table against a mix */
export function blend(mix, table, fallback = 1) {
  const m = normMix(mix);
  let v = 0;
  for (const r in m) v += m[r] * num(table[r], fallback);
  return v;
}

/**
 * The `walks` block, repaired in place. A save written by any earlier stage —
 * or hand-edited — comes back usable rather than defended against at nine read
 * sites.
 */
export function walkState(state, now = Date.now()) {
  if (!state.walks || typeof state.walks !== 'object') {
    state.walks = { lastWalkAt: 0, walksToday: 0, found: [], active: null, day: -1, total: 0 };
  }
  const w = state.walks;
  w.lastWalkAt = Math.max(0, num(w.lastWalkAt, 0));
  w.walksToday = Math.max(0, Math.round(num(w.walksToday, 0)));
  w.total = Math.max(0, Math.round(num(w.total, 0)));
  if (!Array.isArray(w.found)) w.found = [];
  /* LOCAL midnight, not UTC. Also catches a session left open past midnight,
     which the load-time path in state/time.js cannot see. */
  const today = dayIndex(num(now, Date.now()));
  if (Number.isFinite(today) && w.day !== today) {
    w.day = today;
    w.walksToday = 0;
  }
  if (w.active) w.active = normActive(w.active, now);
  return w;
}

/** repair an active-walk record, or drop it if it is not one */
function normActive(a, now = Date.now()) {
  if (!a || typeof a !== 'object') return null;
  const t = num(now, Date.now());
  const out = {
    id: typeof a.id === 'string' && a.id ? a.id : 'walk-' + t.toString(36),
    mix: normMix(a.mix || a.route),
    startedAt: Math.max(0, num(a.startedAt, t)) || t,
    dur: clamp(num(a.dur, W.map.dur[0]), 1, W.map.dur[1] * 4),
    seed: Math.abs(Math.round(num(a.seed, 1))) || 1,
    /* the drawn path, kept only so the absence beat can redraw her own line */
    path: Array.isArray(a.path)
      ? a.path.slice(0, W.map.maxPts)
        .filter((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]))
        .map((p) => [+p[0], +p[1]])
      : [],
    /* how many walks had already happened today when this one set off, so the
       over-cap thinning is decided by when he left, not by when she looks */
    dayCount: Math.max(0, Math.round(num(a.dayCount, 0))),
    /* ---- WHAT SHE TAPPED ON THE STROLL (schema 11) -------------------
       The finds she picked out of the grass while she was watching. It lives on
       the WALK rather than in the layer because the layer does not survive the
       app being closed and this must: losing what she chose would feel worse
       than never having offered. Ids only — everything else about a find is in
       `FIND_BY_ID`, and an id is the one part of it a save can be trusted with.
       Capped, deduped and filtered to real finds here, so `rollFinds` below can
       read it without defending itself. */
    picked: (Array.isArray(a.picked) ? a.picked : [])
      .filter((id) => typeof id === 'string' && FIND_BY_ID[id])
      .filter((id, i, all) => all.indexOf(id) === i)
      .slice(0, W.find.count.base + 3),
    /* set once the return beat has actually played, so a walk cannot be
       collected twice by two resumes racing each other */
    collected: !!a.collected,
  };
  out.route = dominant(out.mix);
  return out;
}

/* ==========================================================================
   start / progress / finish
   ========================================================================== */
/**
 * Set off. `mix` is a route id or a normalised coverage map; `dur` is real
 * seconds. Returns the active record (also stored on the state).
 */
export function startWalk(state, opts = {}) {
  const now = num(opts.now, Date.now());
  const w = walkState(state, now);
  const rng = opts.rng;
  const seed = Math.abs(Math.round(num(opts.seed,
    rng ? rng.int(1, 2147483646) : (now % 2147483647)))) || 1;
  w.active = normActive({
    id: 'walk-' + now.toString(36) + '-' + (seed % 997),
    mix: opts.mix || opts.route || 'park',
    startedAt: now,
    dur: clamp(num(opts.dur, W.map.dur[0]), W.map.dur[0] * 0.2, W.map.dur[1]),
    seed,
    path: opts.path || [],
    dayCount: w.walksToday,
    picked: [],
    collected: false,
  }, now);
  return w.active;
}

/**
 * SHE SPOTTED SOMETHING AND HE PICKED IT UP. Called once per tap on the stroll
 * (dog/stroll.js) and never anywhere else.
 *
 * It is a mutator on the active record rather than a field the layer keeps
 * because the app can be closed mid-stroll — iOS suspends JS entirely — and a
 * tap that is only in a layer is a tap that never happened.
 *
 * @returns true if this pick was new (i.e. worth persisting)
 */
export function pickFind(state, id, now = Date.now()) {
  const w = walkState(state, now);
  const a = w.active;
  if (!a || !FIND_BY_ID[id]) return false;
  if (!Array.isArray(a.picked)) a.picked = [];
  if (a.picked.indexOf(id) >= 0) return false;
  /* the same cap `normActive` enforces, applied here too so a caller cannot
     grow the list past it between two repairs */
  if (a.picked.length >= W.find.count.base + 3) return false;
  a.picked.push(id);
  return true;
}

/**
 * Where the walk has got to. THE ONLY progress function — nothing accumulates.
 * @returns {{active, progress, remainMs, elapsedS, done, skewMs, clamped}}
 */
export function walkProgress(state, now = Date.now()) {
  const t = num(now, Date.now());
  const w = walkState(state, t);
  const a = w.active;
  if (!a) return { active: null, progress: 0, remainMs: 0, elapsedS: 0, done: false, skewMs: 0, clamped: false };

  /* ---- CLOCK-TAMPER GUARD -------------------------------------------
     A start time in the future cannot be legitimate. Rather than trust the
     delta (which would be negative, and would make `progress` negative and
     every downstream lerp nonsense), clamp the start to now and let the walk
     restart. The save stays valid and the worst case is that he is out a few
     minutes longer than she expected. */
  let skew = 0;
  if (a.startedAt > t + BALANCE.time.clockSkewGraceMs) {
    skew = a.startedAt - t;
    a.startedAt = t;
  }
  const elapsedMs = Math.max(0, t - a.startedAt);
  const dur = Math.max(1, a.dur);
  const progress = clamp(elapsedMs / (dur * 1000), 0, 1);
  return {
    active: a,
    progress,
    remainMs: Math.max(0, dur * 1000 - elapsedMs),
    elapsedS: elapsedMs / 1000,
    done: progress >= 1,
    skewMs: skew,
    clamped: elapsedMs > dur * 1000,
  };
}

/**
 * Finish the walk: clear the active record and bank the counters. Does NOT
 * apply needs, dirt, affection or inventory — dog/walk.js does that through
 * state/game.js's mutators, because those are the ratcheted ones.
 */
export function endWalk(state, now = Date.now()) {
  const t = num(now, Date.now());
  const w = walkState(state, t);
  if (!w.active) return null;
  const done = w.active;
  w.active = null;
  w.lastWalkAt = t;
  w.walksToday = Math.max(0, w.walksToday) + 1;
  w.total = Math.max(0, w.total) + 1;
  return done;
}

/** drop the active walk without banking it (used by import / wipe paths) */
export function cancelWalk(state) {
  const w = walkState(state);
  w.active = null;
  return w;
}

/* ==========================================================================
   DISCOVERY — seeded, so it is identical however many times it is resumed
   ========================================================================== */
/**
 * Roll what he brings home.
 *
 * ROUTE BIAS is the whole mechanic: the weight of a find is its per-route
 * weight blended against the route mix, so a walk in the woods really does
 * come back with pinecones and a walk down the high street really does come
 * back with coins and a lost glove.
 *
 * WALK LENGTH gates the tiers — the original's "presents get rarer the farther
 * from home" gradient (research §8), translated from map distance to duration.
 *
 * HE ALWAYS BRINGS SOMETHING. `count.base` is 1 and nothing may reduce it.
 *
 * WHAT SHE TAPPED WINS. If the walk record carries `picked` — the finds she
 * spotted while she was watching the stroll — then those ARE what comes home and
 * the roll below is not consulted for the finds at all. Two things follow, and
 * both are the point:
 *
 *   - it is still a pure function of the record, so resuming twice still gives
 *     the identical result. The picks are persisted state like the seed is.
 *   - AN EMPTY `picked` FALLS BACK TO THE FULL ROLL, silently. She tapped
 *     nothing, or she closed the app before she tapped anything, and he found
 *     something himself. Losing must never feel like rebuke, so there is no
 *     branch anywhere that pays out less because she did not watch.
 *
 * The coins are rolled the same way in both cases: money is dropped in the
 * gutter, not spotted in the grass, so it is not hers to choose.
 *
 * @param active   the active-walk record
 * @param progress 0..1
 * @param opts     { owned: Set|Array of ids already collected, ignorePicked }
 * @returns {{finds:[{id,kind,tier,met,toy,fresh}], coins:number, route, mix, chosen}}
 */
export function rollFinds(active, progress, opts = {}) {
  const a = normActive(active);
  if (!a) return { finds: [], coins: 0, route: '', mix: {}, chosen: false };
  const p = clamp(num(progress, 0), 0, 1);
  const owned = opts.owned instanceof Set ? opts.owned : new Set(opts.owned || []);
  /* the seed makes this deterministic; the progress is folded in so that
     collecting the same walk early and late are different rolls, not the same
     roll truncated */
  const rng = createRng(a.seed ^ Math.round(p * 10000) * 7919);

  /* how many */
  let count = F.count.base;
  if (p >= F.count.at[0]) count++;
  if (p >= F.count.at[1] && rng.chance(F.count.bonusChance)) count++;

  /* how far from home he got, in tiers */
  let maxTier = 0;
  for (let i = 0; i < F.tierAt.length; i++) if (p >= F.tierAt[i]) maxTier = i;
  /* the fourth walk of the day is a shorter, calmer business */
  const over = a.dayCount >= W.perDay;
  if (over) {
    maxTier = Math.min(maxTier, F.overCapTier);
    count = Math.max(F.count.base, count - 1);
  }

  /* ---- WHAT SHE SPOTTED, IF SHE SPOTTED ANYTHING -------------------
     Taken whole, before the roll runs, and NOT re-gated by `maxTier` or by
     `count`: the offer she was tapping was itself rolled from this record
     (dog/stroll.js asks for `progress` 1 with `ignorePicked`), so anything in
     here is something this walk was always going to be able to hand over.
     Re-checking it against the progress she actually got would mean taking back
     the thing she chose, which is the one outcome the stroll exists to avoid. */
  const chosen = opts.ignorePicked ? [] : a.picked;
  if (chosen.length) {
    const finds = chosen.map((id) => {
      const f = FIND_BY_ID[id];
      return {
        id: f.id, kind: f.kind, tier: f.tier,
        met: f.met || '', toy: f.toy || '',
        fresh: !owned.has(f.id),
      };
    });
    return { finds, coins: coinsFor(a, p, finds), route: a.route, mix: a.mix, chosen: true };
  }

  const picked = [];
  const taken = new Set();
  for (let n = 0; n < count; n++) {
    const pool = [];
    let total = 0;
    for (const f of FINDS) {
      if (f.tier > maxTier) continue;
      if (taken.has(f.id)) continue;           // not the same thing twice in one walk
      /* SOMETHING NEW COMES FIRST. Owned finds are weighted down, not removed:
         removing them would make a full collection stop paying out and would
         make the woods hand back things the woods do not have. */
      let wt = blend(a.mix, f.w, 0);
      if (owned.has(f.id)) wt *= num(F.ownedWeight, 1);
      if (!(wt > 0)) continue;
      total += wt;
      pool.push([f, total]);
    }
    if (!pool.length) break;
    const r = rng.next() * total;
    let hit = pool[pool.length - 1][0];
    for (const [f, acc] of pool) if (r <= acc) { hit = f; break; }
    taken.add(hit.id);
    picked.push({
      id: hit.id, kind: hit.kind, tier: hit.tier,
      met: hit.met || '', toy: hit.toy || '',
      /* the first time this thing has ever come home — what makes it an unlock
         rather than a duplicate */
      fresh: !owned.has(hit.id),
    });
  }

  return { finds: picked, coins: coinsFor(a, p, picked), route: a.route, mix: a.mix, chosen: false };
}

/**
 * COINS. The high street is where money is dropped, so this is the route blend
 * against how far he got — and it is a function rather than a tail because BOTH
 * ways of deciding the finds end in it, and money that depended on which of them
 * ran would be the walk paying differently for being watched.
 */
function coinsFor(a, p, finds) {
  const per = num(F.coins.per[0], 0) + (num(F.coins.per[1], 0) - num(F.coins.per[0], 0)) * p;
  let coins = Math.round(per * blend(a.mix, F.coins.route, 1));
  /* ANY duplicate is a pleasant duplicate and pays a few coins instead. This
     tested `f.toy`, so a second daisy or a second photo of the same beagle was
     worth nothing at all — the "litter" half of queue item 6. */
  for (const f of finds) if (!f.fresh) coins += F.dupCoins;
  return Math.max(0, coins);
}

/** words, not a countdown clock */
export function describeRemaining(progress) {
  const p = clamp(num(progress, 0), 0, 1);
  for (const [at, word] of W.away.words) if (p >= at) return word;
  return W.away.words[W.away.words.length - 1][1];
}

/**
 * WHAT BELONGS ON THE SILL. Toys live on the rug (they are what he fetches)
 * and photos live in the album (they are dogs he met, not ornaments), so the
 * sill is flowers, keepsakes and little gifts — the things whose only purpose
 * is to be nice to look at, which is a real purpose and the reason they need a
 * place of their own rather than a pile.
 */
export const SHELVABLE = new Set(['flower', 'keep', 'gift']);
export function isShelvable(id) {
  const f = FIND_BY_ID[id];
  return !!f && SHELVABLE.has(f.kind);
}
/** the dogs he has met, in the order he met them — the album */
export function metDogs(state) {
  const seen = [];
  const w = walkState(state);
  for (const it of w.found) {
    const id = it && (typeof it === 'string' ? it : it.id);
    const f = id && FIND_BY_ID[id];
    if (!f || !f.met) continue;
    const at = (it && it.at) || 0;
    const route = (it && it.route) || '';
    const had = seen.find((x) => x.met === f.met);
    if (had) { had.times++; if (at && at > had.at) { had.at = at; had.route = route || had.route; } }
    else seen.push({ id, met: f.met, at, route, times: 1 });
  }
  /* a photo she owns but whose meeting predates the capped log still belongs
     in the album — `unlocks.items` is the authoritative set (`collected`) */
  const items = state.unlocks && Array.isArray(state.unlocks.items) ? state.unlocks.items : [];
  for (const id of items) {
    const f = FIND_BY_ID[id];
    if (!f || !f.met) continue;
    if (!seen.some((x) => x.met === f.met)) seen.push({ id, met: f.met, at: 0, route: '', times: 1 });
  }
  return seen;
}

/** every distinct find id he has ever brought home (the collection) */
export function collected(state) {
  const out = new Set();
  const w = walkState(state);
  for (const it of w.found) {
    const id = it && (typeof it === 'string' ? it : it.id);
    if (id && FIND_BY_ID[id]) out.add(id);
  }
  /* `unlocks.items` is the authoritative set; `found` is the dated log */
  const items = state.unlocks && Array.isArray(state.unlocks.items) ? state.unlocks.items : [];
  for (const id of items) if (FIND_BY_ID[id]) out.add(id);
  return out;
}

export default {
  ROUTES, FINDS, FIND_BY_ID, normMix, dominant, blend, walkState,
  startWalk, walkProgress, endWalk, cancelWalk, pickFind, rollFinds,
  describeRemaining, collected,
};
