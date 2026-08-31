/* ==========================================================================
   dog/sidesprite.js — THE PROFILE DOG, AS THE HUMAN DREW HIM.

   WHY THIS EXISTS AND `dog/side.js` DOES NOT DO THE JOB. The drawn profile went
   through seven batches of extraction so that it was built out of the frontal
   dog's own coat, legs, face and care washes — and it still was not good enough:

     "i built the side view of the schnoodle with chatgpt as yours looked bad.
      pull it from my downloads folder"

   Fair. The numbers were close (aspect 0.98 against my 1.12, legs 25% of height
   against my 30%) and the craft was not: his sheet has one confident contour with
   the texture inside it, articulated legs that clearly number four, a real neck
   and a chest tuck, and soft volume shading. So the sheets are the art now and
   this draws them.

   WHAT IT COSTS, WRITTEN DOWN SO NOBODY REDISCOVERS IT
   ---------------------------------------------------
   1. A SPRITE CANNOT CHANGE STATE. No mud, no suds, no wet cling, no collar or
      ribbon, and no per-dog palette jitter. The walk's RETURN is frontal, so a
      muddy dog still reads there; he just will not trot home dirty. That is the
      trade the human accepted knowingly.
   2. IT IS PER BREED. A breed with no sheet has no entry in `assets/side-meta.js`
      and `has()` returns false, so the caller falls back to `dog/side.js` — which
      is exactly why that file was kept rather than deleted.
   3. IT IS BYTES. 111KB and 100KB as WebP (923KB as PNG — the art is soft
      gradients over flat areas, PNG's worst case). Everything in this project is
      precached for offline, so every sheet is permanent cache weight.

   THE ONE THING THAT MUST MATCH `dog/side.js`: the signature. Both take
   `(g, { x, y, s, face, phase, run, alpha })` with `y` as THE GROUND HE STANDS
   ON, so a caller can swap one for the other without knowing which it has.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, hump, ell } from '../engine/draw.js';
import SIDE_SPRITES from '../assets/side-meta.js';

const S = BALANCE.side;

/** does this breed have a sheet at all? */
export function hasSideSprite(breedId) {
  return !!SIDE_SPRITES[breedId];
}

/* One Image per sheet for the whole session. Two dogs of the same breed must not
   fetch it twice, and a scene remount must not fetch it again either. */
const cache = new Map();

function sheet(meta) {
  let e = cache.get(meta.file);
  if (!e) {
    const img = new Image();
    e = { img, ready: false, failed: false };
    img.onload = () => { e.ready = true; };
    /* A MISSING SHEET IS NOT A CRASH. The caller asks `ready` and draws the drawn
       dog until (or unless) this arrives — offline-first means the fetch can fail
       on the very first run before the service worker has primed the cache. */
    img.onerror = () => { e.failed = true; };
    img.src = new URL('../assets/' + meta.file, import.meta.url).href;
    cache.set(meta.file, e);
  }
  return e;
}

export function createSideSprite(rig) {
  const meta = SIDE_SPRITES[rig.breed.id];
  if (!meta) return null;
  const e = sheet(meta);
  const SP = S.sprite || {};

  /* WHAT KIND OF FOUR FRAMES THESE ARE. Measured off the sheet by
     `tools/side-meta.py` rather than typed, because it is a fact about the art:
     'bound' repeats a standing pose at frames 0 and 2, 'walk' is four different
     poses of an alternating cycle with no stand in it at all. */
  const isWalk = meta.cycle === 'walk';

  /**
   * WHICH FRAME.
   *
   * `run` 0 holds frame 0 rather than freezing wherever the cycle happened to be,
   * because a dog who stops mid-stride with one leg in the air is a statue. The
   * drawn profile solves the same problem by holding its loop at the gathered
   * key; this holds the pose the artist drew for standing still.
   *
   * ON A 'walk' SHEET THERE IS NO SUCH POSE. The Corgi's and the Golden's four
   * frames are all mid-stride, so frame 0 is a compromise and not a stand, and
   * `hasStand` says so rather than letting a caller assume otherwise. Nothing
   * reads it today — both callers pass `run: 1`, so the profile dog is never on
   * screen standing still — and that is precisely why it is published: the
   * assumption was load-bearing, undocumented, and true of three sheets out of
   * five. A caller that wants a STANDING profile should use `dog/side.js`, which
   * draws one at any breed.
   */
  function frameAt(phase, run) {
    if (run < 0.02) return 0;
    const n = meta.frames;
    const ph = ((phase % 1) + 1) % 1;
    return Math.min(n - 1, Math.floor(ph * n));
  }

  /**
   * DRAW HIM. `o = { x, y, s, face, phase, run, alpha }`, `y` is the ground.
   *
   * `s` is the rig's own scale, so the sprite is sized against the same number
   * the drawn dog is: `sprite.height` is how tall he is in virtual units at
   * `s === 1`, measured off the drawn profile so swapping between them does not
   * change how big the dog is.
   */
  function draw(gg, o = {}) {
    if (!e.ready) return false;
    const c = gg.ctx;
    const s = o.s === undefined ? rig.s : o.s;
    const face = (o.face || -1) < 0 ? -1 : 1;
    const run = clamp(o.run === undefined ? 1 : o.run, 0, 1);
    const a = o.alpha === undefined ? 1 : o.alpha;
    const f = frameAt(o.phase || 0, run);

    /* HOW TALL HE IS, PER BREED. `meta.height` is solved by
       `tools/sideheight.py` against two deliberately unrelated landmarks — his
       ground-to-belly clearance and his whole silhouette — calibrated so the
       Schnoodle, who is the gift puppy and is on her phone, does not move.

       FOUR OF THE FIVE ARE 250 FOR THREE DIFFERENT REASONS, which is why the
       generated file carries a note per breed rather than a bare number:
       the Schnoodle is the calibration anchor; the Shiba and the Cockapoo have
       frontal data older than their sheets and the two views disagree by 14% and
       20%, so NO single scale is correct and the tool declines to invent one;
       and the Corgi solves cleanly to 295.7 and was overruled on framing, since
       at that size he spans the whole screen in the room and widens the stroll's
       known find-occlusion. Only the Golden actually moves.

       `SP.height` remains the fallback for a sheet `sideheight.py` has never been
       run against — which is the behaviour every sheet had before 8.27.0. */
    const h = (meta.height || SP.height || 150) * s;
    const w = h * (meta.cellW / meta.cellH);
    /* the ground line inside the cell, in the same units */
    const footY = h * (meta.ground / meta.cellH);
    /* THE BOB IS OURS, NOT THE ARTIST'S. Every frame of every sheet is drawn
       flat on one ground line — the lowest paw is at `ground` in all twenty of
       them, measured, which is what makes them alignable — so the lift is
       applied here, on the same `gait.bob` the drawn profile uses. Zero while
       standing, or a stationary dog hovers.

       AND IT FOLLOWS THE SHEET'S OWN GAIT. A bound leaves the ground ONCE per
       cycle; an alternating walk rises TWICE, once under each diagonal pair, and
       by much less — a trot is a smooth gait and a bound is not. One hump per
       cycle on a walk sheet is not a smaller mistake than the wrong frame: he
       floats up for two frames and sinks for two, unrelated to what his legs are
       doing, which is the one thing a viewer reads instantly. */
    const cyc = ((o.phase || 0) % 1 + 1) % 1;
    const amp = isWalk ? (S.gait.bobWalk === undefined ? 4 : S.gait.bobWalk)
      : (S.gait.bob || 9);
    const lift = run < 0.02 ? 0
      : hump(isWalk ? (cyc * 2) % 1 : cyc) * amp * run;

    c.save();
    c.globalAlpha = a;
    c.translate(o.x || 0, o.y || 0);

    /* OUR OWN CONTACT SHADOW. The sheets' drawn ellipses were keyed out by the
       slicer on purpose: a painted shadow cannot shrink when he leaves the
       ground, and this one does. */
    /* against `amp`, NOT against `gait.bob`: the shadow shrinks by how far he
       ACTUALLY left the ground, and on a walk sheet that is a different number.
       Dividing by the bound's amplitude would give a walking dog a shadow that
       barely moves, which reads as a dog sliding rather than stepping. */
    const sh = clamp(1 - lift / Math.max(1, amp), 0.4, 1);
    c.save();
    c.globalAlpha = a * (S.shadow.alpha || 1) * sh;
    c.fillStyle = S.shadow.ink;
    ell(c, 0, 0, w * (SP.shadowW || 0.32) * sh, h * (SP.shadowH || 0.055) * sh);
    c.fill();
    c.restore();

    /* THE ART IS DRAWN FACING LEFT, and `dog/side.js`'s polygons are authored
       facing RIGHT — so the two files mirror on opposite conditions to mean the
       same thing by `face`. Getting this backwards is not subtle: he walks to the
       left with his tail leading. `face` is the direction he is GOING, in both. */
    c.scale(face < 0 ? 1 : -1, 1);
    c.drawImage(e.img,
      f * meta.cellW, 0, meta.cellW, meta.cellH,
      -w * (meta.centre / meta.cellW), -footY - lift, w, h);
    c.restore();
    return true;
  }

  return {
    draw,
    /** true once the sheet has decoded; the caller draws the drawn dog until then */
    get ready() { return e.ready; },
    get failed() { return e.failed; },
    get frames() { return meta.frames; },
    /** 'bound' or 'walk' — what kind of cycle the artist drew (side-meta.py) */
    get cycle() { return isWalk ? 'walk' : 'bound'; },
    /** is frame 0 a real standing pose? false on a 'walk' sheet — see frameAt */
    get hasStand() { return !isWalk; },
    frameAt,
    get debug() {
      return {
        breed: rig.breed.id, file: meta.file, ready: e.ready, failed: e.failed,
        cell: [meta.cellW, meta.cellH], ground: meta.ground, frames: meta.frames,
        cycle: isWalk ? 'walk' : 'bound', hasStand: !isWalk,
        bob: isWalk ? (S.gait.bobWalk === undefined ? 4 : S.gait.bobWalk)
          : (S.gait.bob || 9),
      };
    },
  };
}

export default createSideSprite;
