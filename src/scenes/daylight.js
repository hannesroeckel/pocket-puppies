/* ==========================================================================
   scenes/daylight.js — WHAT TIME IT IS, IN THE ROOM.

   WHY THIS EXISTS. `state/time.js` has computed `timeOfDay()` since stage 1 and
   its own docstring says the phase is "for lighting later". Later never came:
   the value was put on the app object at construction and read by nothing, so
   the room looked identical at breakfast and at bedtime. For a game whose whole
   design is about RETURNING — the reunion is called the highest-return asset in
   the project, and research §1.10 asks for "a cozy, static, ownable corner" —
   that is a large amount of warmth left on the floor.

   THIS IS A MODEL, NOT A PAINTER, AND THAT SPLIT IS DELIBERATE. It answers
   "what is the light doing at time t" and nothing else. `scenes/room.js` does
   the painting, because the room already owns its window — and the window is
   the hard part: its glazing bars are stroked OVER the glass, so anything that
   repainted the glass from another file would erase them and have to redraw
   them. Two files painting one window is one file too many, which is the same
   argument §32 makes about the ring's mat.

   IT IS BAKED, NOT WASHED OVER. The obvious implementation is a translucent
   wash drawn live on top of the finished room every frame. It was rejected:
   a wash cannot take the sunbeam OUT of a room, and at night the sunbeam is
   the thing that is wrong. Because the room re-bakes whenever `decorSig()`
   changes (the mechanism the rug, the garland and the portrait already use),
   the light can instead reach the art itself — the window's outdoor bloom and
   the pool of sun on the floorboards are scaled by `sun`, so at midnight they
   are simply not there and a lamp is on instead.

   THE COST OF BAKING IS A BUCKET. A continuous re-bake would mean rebuilding
   the room every frame, so `bucketOf` quantises the day into
   `BALANCE.room.light.buckets` steps and only a change of bucket rebuilds. At
   96 that is a step every fifteen minutes, against sessions the design says are
   "90 seconds or 20 minutes" — so most sessions cross no boundary at all, and
   one that does pays a few milliseconds of flat fills.

   THE DOG IS NOT RELIT. Same rule, verbatim, as the two outdoor places
   (§32 rule 2): his shading was tuned over eight stages and a background change
   may not touch it. So every number in here reaches the BAKED ROOM ONLY, and
   `tools/lightgate.py` proves it by rendering the same frozen dog at noon and
   at midnight and requiring his coat to be byte-identical. The consequence is
   the same one the park accepted: night is DIM AND WARM rather than dark and
   blue, because the room has to stay a place a warmly-lit dog can stand in.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, lerp, mix } from '../engine/draw.js';

const L = BALANCE.room.light;

/**
 * WHICH STEP OF THE DAY, for the bake signature. A change here rebuilds the
 * room; nothing else about the light is allowed to.
 */
export function bucketOf(t) {
  const n = Math.max(1, Math.round(L.buckets));
  return Math.floor(clamp(t, 0, 0.999999) * n);
}

/**
 * THE LIGHT AT `t`, where t is 0..1 through the local day (0 = midnight).
 *
 * Interpolated between the keyframes in `BALANCE.room.light.keys`, and it
 * WRAPS: the last key lerps back round to the first, so 23:50 and 00:10 are ten
 * minutes apart rather than a whole day.
 *
 * @returns {{sun,dim,lamp,skyA,skyTop,skyLow,star}}
 */
export function lightAt(t) {
  const keys = L.keys;
  const u = clamp(t, 0, 1);
  let a = keys[keys.length - 1];
  let b = keys[0];
  let k = 0;
  if (u < keys[0].at) {
    /* before the first key: come round from the last one, across midnight */
    const span = keys[0].at + (1 - a.at);
    k = span > 0 ? (u + (1 - a.at)) / span : 0;
  } else {
    for (let i = 0; i < keys.length; i++) {
      const cur = keys[i];
      const nxt = keys[i + 1];
      if (!nxt) {
        /* after the last key: round to the first, across midnight */
        a = cur; b = keys[0];
        const span = cur.at < 1 ? (1 - cur.at) + keys[0].at : 1;
        k = span > 0 ? (u - cur.at) / span : 0;
        break;
      }
      if (u >= cur.at && u < nxt.at) {
        a = cur; b = nxt;
        k = (u - cur.at) / Math.max(1e-6, nxt.at - cur.at);
        break;
      }
    }
  }
  k = clamp(k, 0, 1);
  return {
    sun: lerp(a.sun, b.sun, k),
    dim: lerp(a.dim, b.dim, k),
    lamp: lerp(a.lamp, b.lamp, k),
    skyA: lerp(a.skyA, b.skyA, k),
    skyTop: mix(a.skyTop, b.skyTop, k),
    skyLow: mix(a.skyLow, b.skyLow, k),
    star: lerp(a.star, b.star, k),
  };
}

/**
 * THE WASH AND THE LAMP, over the finished room art and nothing else.
 *
 * Called at the END of `buildRoom`, inside the bake, so it costs nothing per
 * frame and so it cannot reach the dog, the bowls, the ball or the sill — all
 * of which are drawn live, afterwards, and keep their own lighting.
 *
 * TWO PASSES AND NOT ONE, because one flat wash cannot say "night". A single
 * darkening fill makes a room that is the same picture with the brightness
 * turned down, which reads as a screenshot at dusk rather than as evening. The
 * cool wash takes the corners down and the warm pool brings the middle back up,
 * and the gap between them is what says a lamp is on.
 *
 * @param bounds { x0, x1, y0, y1 } the bled extent the room was baked across
 */
export function drawRoomLight(c, light, bounds) {
  const { x0, x1, y0, y1 } = bounds;
  const w = x1 - x0, h = y1 - y0;

  if (light.dim > 0.002) {
    c.save();
    c.globalAlpha = clamp(light.dim, 0, 1);
    c.fillStyle = L.coolInk;
    c.fillRect(x0, y0, w, h);
    c.restore();
  }

  if (light.lamp > 0.002) {
    /* WHERE THE LAMP IS, AND WHY THERE IS NO LAMP. This is light, not a
       fixture: a drawn lamp would be a new object in a composition that took
       eight stages to settle, and it would have to stand somewhere the dog,
       the rug, the bowls and the sill are not. The glow is centred high and
       slightly left of the window, so it is plainly not the window doing it —
       which is the only thing it has to say. */
    const cx = L.lampAt[0], cy = L.lampAt[1];
    const g = c.createRadialGradient(cx, cy, 12, cx, cy, L.lampR);
    g.addColorStop(0, `rgba(255,224,168,${(L.lampA * light.lamp).toFixed(3)})`);
    g.addColorStop(0.55, `rgba(255,216,156,${(L.lampA * light.lamp * 0.34).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,214,150,0)');
    c.save();
    c.fillStyle = g;
    c.fillRect(x0, y0, w, h);
    c.restore();
  }
}

export default { lightAt, bucketOf, drawRoomLight };
