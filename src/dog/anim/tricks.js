/* ==========================================================================
   dog/anim/tricks.js — the trick roster: eight poses and the clips that get
   into and out of them.

   A COMPACT SET THAT EACH FEEL GOOD BEATS A LONG LIST (SCOPE.md stage 3).
   Sit, lie down, beg, shake, spin, jump, roll over, play dead. Research §5
   picks the frontal-safe ones and says "Shake and Beg are the two best tricks
   for this rig; lead with them" — so those two got the most attention.

   TWO RULES THIS FILE OBEYS
   -------------------------
   1. TARGETS ONLY. Every pose writer calls `spring.to()` / `spring.kick()` and
      writes the rig's own placement channels (`x`, `s`, `sx`, `sy`). It never
      assigns a final value, so a trick composes with the mood underneath and
      the petting overlay on top, and nothing ever pops.
   2. JOINTS, NEVER GEOMETRY. Nothing here knows what breed she is: no
      silhouettes, no ear outlines, no fur. `earBack` means "ears back"
      whether they are pricked or floppy, and the renderer decides what that
      looks like. A new breed must not need a new trick.

   THE POSE LIVES IN ONE PLACE. `TRICK_POSE[id](x, k, u)` is the single
   definition of what a trick looks like; the clip beside it only adds the
   impulses and the timing flourishes (blinks, ear kicks, sounds, sparkles).
   dog/train.js calls the same pose writer to HOLD a trick after the clip has
   finished — which is why a held sit looks identical to a fresh one, and why
   stage 5 can ask for a three-second hold and get one.

     x  { rig, s, pawLift, reduced, rng, sound, spawn, mo }
     k  0..1 blend — how much of this pose is being asked for
     u  0..1 progress through the MOVEMENT (1 = settled). Transient tricks
        (spin, jump, roll over) shape themselves along u and end where they
        started; postural ones (sit, lie down, beg, shake, play dead) settle
        and stay until k comes back down.
   ========================================================================== */
import BALANCE from '../../state/balance.js';
import { registerClip } from './index.js';
import { TAU, clamp, lerp, smooth, plateau, hump } from '../../engine/draw.js';
/* COPY ONLY — 'He' from 'he', for the `does` lines below. state/game.js does
   not import this module (see the roster note), so this direction is safe. */
import { capitalise } from '../../state/game.js';

const T = BALANCE.train;
const TR = BALANCE.rig.trick;
const LG = BALANCE.rig.leg;

/* ---- blend helpers ---------------------------------------------------- */
/** blend a spring's TARGET toward v by weight k */
const bias = (sp, v, k) => sp.to(sp.t * (1 - k) + v * k);
/** blend, but never pull the target below what another layer already asked */
const atLeast = (sp, v, k) => sp.to(Math.max(sp.t, sp.t * (1 - k) + v * k));

/* ==========================================================================
   THE ROSTER

   `prereq` is a POSTURE, not an XP gate — straight out of research §5, where
   Lie Down is "Sit + stroke the head" and Roll Over is "on the floor +
   horizontal motion". The physical posture is the dependency, and it teaches
   itself: you cannot roll a standing dog over, and trying reads as her not
   understanding rather than as a locked menu item.

     prereq  'stand' | 'sit' | 'down' | 'any'
     ends    the posture she is left in afterwards
     guide   the gesture on her body that INDUCES the pose (dog/train.js)
     poseAt  progress at which the pose has landed — this is where the reward
             window opens and where a contest's stopwatch stops

   TWO STRINGS PER TRICK, ANSWERING TWO DIFFERENT QUESTIONS. `does` is what he
   will do; `hint` is how to ask for it. The trick list (ui/tricklist.js) shows
   both, because "there is no trick list — training is guesswork"
   (docs/FEEDBACK-QUEUE.md 1b) was a player discovering an invisible ladder by
   waiting for the ghost hint to cycle round to it.

   `does` TAKES THE PRONOUNS, `hint` HAS NONE. A hint is an instruction to her
   and never names him, so it stays a plain string. What he does cannot be said
   without a pronoun, so it is a function of `game.pron` — the same rule
   dog/train.js's COPY block follows, for the same reason: the gift puppy is
   male and a later dog may not be.
   ========================================================================== */
export const TRICKS = {
  sit: {
    id: 'sit', name: 'Sit', order: 0,
    prereq: 'stand', ends: 'sit', guide: 'headDown',
    dur: T.clip.sit, poseAt: 0.56, transient: false,
    does: (P) => `${capitalise(P.they)} sit${P.s} down and wait${P.s}, looking up at you`,
    /* the one-line teaching prompt. NO PRONOUNS HERE — dog/train.js supplies
       them from game.pron at draw time (see COPY there). */
    hint: 'Stroke down over the top of the head',
  },
  lieDown: {
    id: 'lieDown', name: 'Lie down', order: 1,
    /* THE GESTURE IS AN L, AND IT IS ITS OWN SHAPE. It used to be `headDown` —
       the same stroke as the sit — told apart only by whether he happened to
       be sitting, which is hidden state and therefore invisible: "the moves lie
       down and sit are hard to distinguish when teaching the dog as one pulls
       down on the dog for both" (docs/FEEDBACK-QUEUE.md 1). This is the real
       hand signal for "down": palm down over the head, then a flat sweep along
       the floor. `prereq` stays 'sit' because that is still the posture he
       passes through — dog/train.js chains him through it. */
    prereq: 'sit', ends: 'down', guide: 'headSweep',
    dur: T.clip.lieDown, poseAt: 0.60, transient: false,
    does: (P) => `${capitalise(P.they)} fold${P.s} onto ${P.their} front, head still up`,
    /* "OUT TO ONE SIDE" RATHER THAN "ALONG THE FLOOR", which is what the real
       hand signal does and what this hint said first. On a frontal rig the flat
       leg is drawn across his chin, not along the rug, and the recogniser wants
       the sideways finish to be at least half the fall — so "along the floor"
       was asking her for a stroke that would fall too far to be accepted. It
       also says ONE side, not left: either direction reads. */
    hint: 'Stroke down over the head, then out to one side',
  },
  beg: {
    id: 'beg', name: 'Beg', order: 2,
    prereq: 'sit', ends: 'sit', guide: 'chinUp',
    dur: T.clip.beg, poseAt: 0.58, transient: false,
    does: (P) => `${capitalise(P.they)} sit${P.s} up tall and paw${P.s} at the air`,
    hint: 'Stroke up from the chest to the chin',
  },
  shake: {
    id: 'shake', name: 'Shake', order: 3,
    prereq: 'any', ends: 'keep', guide: 'pawWiggle',
    dur: T.clip.shake, poseAt: 0.46, transient: false,
    does: (P) => `${capitalise(P.they)} lift${P.s} a front paw for you to take`,
    hint: 'Take a front paw and wiggle it up and down',
  },
  spin: {
    id: 'spin', name: 'Spin', order: 4,
    prereq: 'stand', ends: 'stand', guide: 'floorCircle',
    dur: T.clip.spin, poseAt: 0.52, transient: true,
    does: (P) => `${capitalise(P.they)} turn${P.s} a whole circle on the spot`,
    hint: 'Circle a finger low down by the paws',
  },
  jump: {
    id: 'jump', name: 'Jump', order: 5,
    prereq: 'stand', ends: 'stand', guide: 'tapAbove',
    dur: T.clip.jump, poseAt: 0.44, transient: true,
    does: (P) => `${capitalise(P.they)} bounce${P.s} straight up off ${P.their} front paws`,
    hint: 'Tap a few times just above the head',
  },
  rollOver: {
    id: 'rollOver', name: 'Roll over', order: 6,
    prereq: 'down', ends: 'down', guide: 'bodyAcross',
    dur: T.clip.rollOver, poseAt: 0.52, transient: true,
    does: (P) => `${capitalise(P.they)} roll${P.s} right over and come${P.s} back up`,
    hint: 'Lying down, sweep a finger across the belly',
  },
  playDead: {
    id: 'playDead', name: 'Play dead', order: 7,
    prereq: 'down', ends: 'down', guide: 'flankHold',
    dur: T.clip.playDead, poseAt: 0.52, transient: false,
    does: (P) => `${capitalise(P.they)} flop${P.s} onto ${P.their} side and stay${P.s} put`,
    hint: 'Lying down, press and hold on the side',
  },
};

export const TRICK_IDS = Object.keys(TRICKS).sort((a, b) => TRICKS[a].order - TRICKS[b].order);

/* The roster is ALSO listed in BALANCE.train.roster, because state/game.js uses
   it to refuse junk trick ids without importing this module. Two lists can
   drift, so they are checked against each other at load rather than trusted. */
(() => {
  const declared = BALANCE.train.roster || [];
  const missing = TRICK_IDS.filter((id) => !declared.includes(id));
  const extra = declared.filter((id) => !TRICKS[id]);
  if (missing.length || extra.length) {
    throw new Error('trick roster out of sync with BALANCE.train.roster: '
      + `missing [${missing}] extra [${extra}]`);
  }
  /* EVERY TRICK OWES THE LIST TWO LINES. The trick list is the only place a
     player can find out what a trick even is, so a trick that ships without
     `does` or `hint` is one she can never learn about — the very hole 1b
     reported. Checked here rather than trusted, exactly as the roster is. */
  const mute = TRICK_IDS.filter((id) => typeof TRICKS[id].does !== 'function' || !TRICKS[id].hint);
  if (mute.length) {
    throw new Error(`trick(s) with nothing to say in the trick list: [${mute}]`);
  }
})();
export const trickName = (id) => (TRICKS[id] ? TRICKS[id].name : id);

/** what posture a trick leaves her in, resolved against where she was */
export function endPosture(id, was) {
  const t = TRICKS[id];
  if (!t) return was;
  return t.ends === 'keep' ? was : t.ends;
}

/* ==========================================================================
   THE POSES
   ========================================================================== */
export const TRICK_POSE = {

  /* ---- SIT ------------------------------------------------------------
     The plainest trick in the game, so it has to be *clean*: square on the
     haunches, chest up, head level, eyes on the player, tail sweeping the
     floor behind her. Nothing else. */
  sit(x, k, u) {
    const { s } = x;
    if (k <= 0.001) return;
    const settle = smooth(clamp(u / 0.7, 0, 1));
    bias(s.sit, 1, k);
    bias(s.down, 0, k);
    /* a tiny tuck as the back end goes down, gone by the time she is settled */
    bias(s.squash, 0.05 * (1 - settle), k);
    bias(s.pitch, 0.14 + 0.10 * settle, k * 0.8);
    bias(s.headLift, 1.5 * settle, k);
    bias(s.perk, 0.28 * settle, k);
    bias(s.earBack, -0.06 * settle, k);
    bias(s.eyeOpen, 1.04, k * 0.6);
    bias(s.tailUp, 0.34 * settle, k);
    x.pawLift[0].to(x.pawLift[0].t * (1 - k));
    x.pawLift[1].to(x.pawLift[1].t * (1 - k));
  },

  /* ---- LIE DOWN -------------------------------------------------------
     The sphinx: body on the floor, front legs pushed forward toward the
     camera, chin low, ears soft. `down` does the body; dog/draw.js splays the
     legs and fades the haunches. */
  lieDown(x, k, u) {
    const { s } = x;
    if (k <= 0.001) return;
    const settle = smooth(clamp(u / 0.75, 0, 1));
    bias(s.sit, 1, k);
    bias(s.down, settle, k);
    bias(s.melt, 0.42 * settle, k);
    bias(s.squash, 0.06 * settle, k);
    /* head comes down with the shoulders, and the neck bridge keeps her whole:
       without it the head reads as having slid down the chest (§12.6) */
    bias(s.headLift, -7 * settle, k);
    bias(s.pitch, -0.10 * settle, k * 0.7);
    bias(s.perk, 0.05, k);
    bias(s.earBack, 0.26 * settle, k);
    bias(s.eyeOpen, 1 - 0.20 * settle, k * 0.7);
    bias(s.eyeSmile, 0.20 * settle, k * 0.6);
    bias(s.tailUp, -0.10 * settle, k);
    x.rig.drive.neck = Math.max(x.rig.drive.neck || 0, k * settle * 0.55);
    x.pawLift[0].to(x.pawLift[0].t * (1 - k));
    x.pawLift[1].to(x.pawLift[1].t * (1 - k));
  },

  /* ---- BEG ------------------------------------------------------------
     One of the two best tricks on this camera (research §5). She sits back,
     the chest comes up and both front paws hang and paddle. The paddle is the
     whole charm, so it keeps going for as long as she holds it. */
  beg(x, k, u) {
    const { s, rig } = x;
    if (k <= 0.001) return;
    const settle = smooth(clamp(u / 0.62, 0, 1));
    const dangle = Math.sin(rig.t * 5.4) * 0.12 * settle;
    bias(s.sit, 1, k);
    bias(s.down, 0, k);
    /* SHE HAS TO GET TALLER, or "both paws up" just reads as a dog standing on
       tiptoe. Negative squash stretches the body, `lift` raises the whole
       front end, and the head goes up and back to look at you over the top. */
    bias(s.squash, -0.17 * settle, k);
    bias(s.lift, 15 * settle, k);
    bias(s.pitch, 0.34 * settle, k * 0.9);
    bias(s.headLift, -1 * settle, k);
    bias(s.perk, 0.50 * settle, k);
    bias(s.earBack, -0.16 * settle, k);
    /* pleading, not smug: eyes WIDE and brows up. A high eyeSmile here reads
       as a smirk on a begging dog, which is a different animal entirely. */
    bias(s.eyeOpen, 1.16, k * 0.85);
    bias(s.eyeSmile, 0.14 * settle, k * 0.7);
    bias(s.brow, 0.85 * settle, k * 0.8);
    bias(s.smile, 0.68 * settle, k * 0.7);
    bias(s.mouth, (0.16 + 0.06 * Math.sin(rig.t * 8.2)) * settle, k * 0.7);
    bias(s.tongue, 0.45 * settle, k * 0.7);
    bias(s.tailUp, 0.34 * settle, k);
    bias(s.wagAmp, 0.36 * settle, k * 0.7);
    bias(s.wagSpd, 6.5 * settle, k * 0.7);
    /* BOTH PAWS UP AND TUCKED IN under the chin — high enough to clear the
       belly line and close enough together to read as begging rather than as a
       dog reaching for something. They paddle out of phase, so they are never
       a matched pair. */
    /* -0.62 put both paws on the same spot and they read as one; -0.44 keeps
       them together but distinguishable */
    bias(s.pawOut, -0.44, k);
    x.pawLift[0].to(lerp(x.pawLift[0].t, (2.95 + dangle) * settle, k));
    x.pawLift[1].to(lerp(x.pawLift[1].t, (2.76 - dangle) * settle, k));
    bias(s.hindKick, 0.10 * settle, k * 0.5);
    x.rig.drive.neck = Math.max(x.rig.drive.neck || 0, k * settle * 0.42);
  },

  /* ---- SHAKE ----------------------------------------------------------
     The other best trick here: the paw comes straight at the lens. She sits,
     offers one paw, and it hangs there waiting to be taken. */
  shake(x, k, u) {
    const { s, rig } = x;
    if (k <= 0.001) return;
    const settle = smooth(clamp(u / 0.5, 0, 1));
    const side = x.flags && x.flags.side !== undefined ? x.flags.side : 1;
    const other = side ? 0 : 1;
    const wave = Math.sin(rig.t * 4.6) * 0.14 * settle;
    bias(s.sit, 0.82, k * 0.9);
    bias(s.down, 0, k);
    bias(s.pitch, 0.20 * settle, k * 0.7);
    bias(s.tilt, (side ? 0.16 : -0.16) * settle, k * 0.7);
    bias(s.perk, 0.40 * settle, k);
    bias(s.earBack, -0.10 * settle, k);
    bias(s.eyeOpen, 1.10, k * 0.7);
    bias(s.eyeSmile, 0.26 * settle, k * 0.7);
    bias(s.smile, 0.66 * settle, k * 0.7);
    bias(s.mouth, 0.12 * settle, k * 0.6);
    bias(s.tailUp, 0.36 * settle, k);
    bias(s.wagAmp, 0.38 * settle, k * 0.7);
    bias(s.wagSpd, 7.5 * settle, k * 0.7);
    /* THE OFFERED PAW comes up and swings clear of the chest, so it is
       silhouetted against the room and reads as an offer rather than as a
       shifted weight. The other paw stays exactly where it is. */
    bias(s.pawOut, 1.0, k);
    x.pawLift[side].to(lerp(x.pawLift[side].t, (2.05 + wave) * settle, k));
    x.pawLift[other].to(x.pawLift[other].t * (1 - k * 0.8));
    /* she leans a little onto the standing side */
    bias(s.roll, (side ? -0.05 : 0.05) * settle, k * 0.6);
    bias(s.sway, (side ? -1.6 : 1.6) * settle, k * 0.5);
  },

  /* ---- SPIN -----------------------------------------------------------
     Frontal-camera spin. She trots a small circle rather than pirouetting on
     the spot, because ON THIS RIG DEPTH IS SCALE (§12.6): the far half of the
     circle is smaller, higher and squashed, which reads as "she went round"
     without ever needing a drawing of her back. */
  spin(x, k, u) {
    const { s, rig, reduced } = x;
    if (k <= 0.001) return;
    const S = TR.spin;
    /* ease in and out of the turn so it is a trot, not a metronome */
    const th = smooth(clamp((u - 0.10) / 0.78, 0, 1)) * TAU * S.turns;
    const env = plateau(u, 0.10, 0.16);
    const depth = (1 - Math.cos(th)) / 2;
    /* REDUCED MOTION HAS TO SOFTEN THE SCALE CHANGE, NOT JUST THE TRAVEL.
       The first version scaled `rx`/`ry` only, and measuring it showed the
       lateral travel halving (50px -> 21px) while the depth-driven scale swing
       stayed at 0.2098 in both modes — i.e. the LOOMING was untouched, and
       looming is the part that actually provokes motion sensitivity. */
    const soft = reduced ? 0.42 : 1;
    const rx = S.rx * soft;
    const ry = S.ry * soft;
    const dScale = S.scale * soft;
    const dSquash = S.squash * soft;
    const stride = Math.sin(th * 6.4);
    /* published so dog/train.js can scuff the floor along the path she took —
       the single biggest legibility win for a spin on a camera that cannot see
       her back */
    if (x.info) { x.info.spinTh = th; x.info.spinDepth = depth; x.info.spinEnv = env; }
    /* placement: blended toward home by k so an interrupted spin drifts back */
    rig.x = lerp(rig.x, rig.home.x + Math.sin(th) * rx * env, k);
    rig.y = lerp(rig.y, rig.home.y - depth * ry * env, k);
    rig.s = lerp(rig.s, rig.home.s * (1 - depth * dScale * env), k);
    rig.sy = lerp(rig.sy === undefined ? 1 : rig.sy,
      1 - depth * dSquash * env + stride * 0.02 * env * (reduced ? 0 : 1), k);
    /* the head leads the turn and the body leans into it, which is what makes
       the travel read as a TURN rather than as a sidestep */
    bias(s.yaw, clamp(-Math.sin(th) * 1.28, -1.3, 1.3) * env, k * 0.95);
    bias(s.tilt, Math.sin(th) * 0.14 * env, k * 0.7);
    bias(s.roll, -Math.sin(th) * S.lean * env * (reduced ? 0.4 : 1), k * 0.8);
    bias(s.sway, Math.sin(th) * 3.0 * env * (reduced ? 0 : 1), k * 0.6);
    bias(s.sit, 0, k);
    bias(s.down, 0, k);
    bias(s.squash, (0.05 + Math.abs(stride) * 0.03) * env, k * 0.8);
    bias(s.pitch, -0.16 * env, k * 0.6);
    bias(s.earBack, (0.30 + depth * 0.34) * env, k * 0.8);
    bias(s.eyeOpen, 1 - 0.14 * env, k * 0.5);
    bias(s.mouth, (0.20 + 0.08 * Math.abs(stride)) * env, k * 0.7);
    bias(s.tongue, 0.70 * env, k * 0.7);
    bias(s.smile, 0.80 * env, k * 0.6);
    bias(s.tailUp, 0.72 * env, k);
    bias(s.wagAmp, 0.44 * env, k * 0.8);
    bias(s.wagSpd, 9 * env, k * 0.8);
    /* the paws, alternating, and a little rump wobble */
    x.pawLift[0].to(lerp(x.pawLift[0].t, Math.max(0, stride) * 1.0 * env, k));
    x.pawLift[1].to(lerp(x.pawLift[1].t, Math.max(0, -stride) * 1.0 * env, k));
    bias(s.hindKick, 0.35 * env, k * 0.6);
    rig.drive.pant = Math.max(rig.drive.pant || 0, env * k * 0.5);
    if (!reduced) rig.drive.wiggle = Math.max(rig.drive.wiggle, env * k * 0.25);
  },

  /* ---- JUMP -----------------------------------------------------------
     Gather, up, tuck, land. `hop` takes the paws up with the body (dog/draw.js)
     and shrinks the contact shadow, which is what makes it a jump rather than
     a dog on stilts. */
  jump(x, k, u) {
    const { s, rig, reduced } = x;
    if (k <= 0.001) return;
    const gather = clamp(u / 0.22, 0, 1);
    const air = clamp((u - 0.20) / 0.60, 0, 1);
    /* asymmetric arc: quick up, slower down, like an actual jump */
    const alt = air <= 0 ? 0 : (air < 0.42 ? smooth(air / 0.42) : 1 - smooth((air - 0.42) / 0.58));
    const land = clamp((u - 0.80) / 0.20, 0, 1);
    bias(s.sit, 0, k);
    bias(s.down, 0, k);
    bias(s.hop, alt * (reduced ? 0.62 : 1), k);
    /* the gather squashes, the launch stretches, the landing squashes again */
    bias(s.squash, (u < 0.20 ? 0.10 * gather : -0.07 * alt) + 0.09 * hump(land), k);
    bias(s.pitch, (0.30 - 0.30 * alt) + 0.34 * alt, k * 0.7);
    bias(s.headLift, -3 * gather + 4 * alt, k);
    bias(s.perk, 0.55 * (1 - land), k);
    bias(s.earBack, -0.22 * alt, k * 0.8);
    bias(s.eyeOpen, 1.10, k * 0.6);
    bias(s.smile, 0.85 * alt, k * 0.7);
    bias(s.mouth, 0.30 * alt, k * 0.7);
    bias(s.tongue, 0.60 * alt, k * 0.6);
    bias(s.tailUp, 0.80 * alt, k);
    bias(s.wagAmp, 0.46 * alt, k * 0.7);
    bias(s.wagSpd, 11 * alt, k * 0.7);
    /* THE LEGS HAVE TO COME UP WITH HER. `hop` already lifts the paws with the
       body, but without a real tuck on top of it the legs hang straight down
       and she reads as a dog on a lift rather than a dog in the air. */
    const tuck = alt * 1.8;
    bias(s.pawOut, -0.34, k);
    x.pawLift[0].to(lerp(x.pawLift[0].t, tuck, k));
    x.pawLift[1].to(lerp(x.pawLift[1].t, tuck * 0.86, k));
    bias(s.hindKick, 0.30 * alt, k * 0.5);
  },

  /* ---- ROLL OVER ------------------------------------------------------
     Research warns that a dog rolling toward you is "a foreshortened mess" on
     a near-frontal camera. The fix is the same one the reunion uses: don't
     rotate a drawing of her front — NARROW IT. `rig.sx` squeezes the
     silhouette as she goes over, the body rotates, the legs come up, and she
     comes back the way she went. Verified by rendering it, not by reasoning. */
  rollOver(x, k, u) {
    const { s, rig, reduced } = x;
    if (k <= 0.001) return;
    const RO = TR.roll;
    const soft = reduced ? 0.55 : 1;
    /* one smooth over-and-back; the apex is where the tummy shows */
    const over = hump(clamp((u - 0.12) / 0.74, 0, 1));
    const dir = x.flags && x.flags.dir ? x.flags.dir : 1;
    bias(s.sit, 1, k);
    bias(s.down, 1, k);
    rig.sx = lerp(rig.sx === undefined ? 1 : rig.sx, 1 - over * RO.squashX * soft, k);
    bias(s.roll, dir * over * RO.rot * soft, k);
    /* the head follows the body over rather than leading it — a real dog's
       head is the last thing to go, and it keeps the face readable */
    bias(s.tilt, dir * over * 0.26 * soft, k * 0.8);
    bias(s.sway, dir * over * 7.0 * soft, k * 0.7);
    bias(s.squash, 0.10 * over, k * 0.8);
    bias(s.headLift, -5 * over, k);
    bias(s.pitch, -0.24 * over, k * 0.6);
    bias(s.earBack, 0.55 * over, k * 0.8);
    bias(s.eyeOpen, 1 - 0.48 * over, k * 0.7);
    bias(s.eyeSmile, 0.40 * over, k * 0.6);
    bias(s.mouth, 0.22 * over, k * 0.6);
    bias(s.tongue, 0.55 * over, k * 0.6);
    bias(s.tailUp, -0.22 * over, k);
    bias(s.wagAmp, 0.20, k * 0.5);
    /* all four legs come off the floor at the apex */
    x.pawLift[0].to(lerp(x.pawLift[0].t, over * RO.paws, k));
    x.pawLift[1].to(lerp(x.pawLift[1].t, over * RO.paws * 0.88, k));
    bias(s.hindKick, over * 0.85, k * 0.8);
    rig.drive.neck = Math.max(rig.drive.neck || 0, k * 0.45);
    if (!reduced) rig.drive.wiggle = Math.max(rig.drive.wiggle, over * k * 0.35);
  },

  /* ---- PLAY DEAD ------------------------------------------------------
     A flop onto the side: eyes shut, tongue out, one paw in the air, tail
     completely still. The stillness is the joke, so nothing here wags. */
  playDead(x, k, u) {
    const { s, rig, reduced } = x;
    if (k <= 0.001) return;
    const DD = TR.dead;
    const soft = reduced ? 0.7 : 1;
    const flop = smooth(clamp(u / 0.55, 0, 1));
    /* the last breath: a slow rise and fall, so she is dead, not switched off */
    const breath = Math.sin(rig.t * 1.5) * 0.02 * flop;
    bias(s.sit, 1, k);
    bias(s.down, 1, k);
    rig.sx = lerp(rig.sx === undefined ? 1 : rig.sx, 1 - flop * DD.squashX * soft, k);
    bias(s.roll, DD.rot * flop * soft, k);
    bias(s.tilt, DD.tilt * flop * soft, k * 0.9);
    bias(s.sway, 3.4 * flop * soft, k * 0.7);
    bias(s.melt, 0.85 * flop, k);
    bias(s.squash, 0.09 * flop + breath, k);
    bias(s.headLift, -9 * flop, k);
    bias(s.pitch, -0.30 * flop, k * 0.8);
    bias(s.earBack, 0.72 * flop, k);
    bias(s.eyeOpen, 1 - 0.94 * flop, k);
    bias(s.eyeSmile, 0, k * 0.8);
    bias(s.brow, 0.10, k * 0.5);
    bias(s.mouth, 0.26 * flop, k * 0.8);
    bias(s.tongue, 1.15 * flop, k * 0.9);
    bias(s.smile, 0.30, k * 0.5);
    /* dead still */
    bias(s.tailUp, -0.30 * flop, k);
    bias(s.wagAmp, 0.02, k);
    bias(s.wagSpd, 1.0, k);
    /* one paw left up in the air — the detail everybody laughs at */
    x.pawLift[1].to(lerp(x.pawLift[1].t, DD.paw * flop, k));
    x.pawLift[0].to(x.pawLift[0].t * (1 - k * 0.9));
    bias(s.hindKick, 0, k);
    rig.drive.neck = Math.max(rig.drive.neck || 0, k * flop * 0.5);
    rig.drive.pant = 0;
  },
};

/* ==========================================================================
   THE CLIPS

   Registered with `weight: () => 0` so the idle director never starts one of
   its own accord — dog/train.js plays them. They carry the impulses and the
   one-shot flourishes; the POSE comes from TRICK_POSE above, written by the
   training layer, so a clip that gets interrupted can never leave her stuck
   halfway into a shape.
   ========================================================================== */
function trickClip(id) {
  const T2 = TRICKS[id];
  registerClip({
    id: 'trick.' + id,
    dur: T2.dur, cd: 0.2,
    weight: () => 0,
    init(ctx) { ctx.flags.side = ctx.rng.next() < 0.5 ? 0 : 1; ctx.flags.dir = ctx.rng.sign(); },
    update(u, dt, ctx) {
      const { s, flags } = ctx;
      /* --- the shared beats: she looks at the player and blinks into it --- */
      if (u < 0.06 && !flags.k0) {
        flags.k0 = 1;
        s.earL.kick(3.4); s.earR.kick(-3.0);
        s.perk.kick(1.6);
      }
      /* --- per-trick flourishes ---
         BLINKS GO BEFORE THE POSE LANDS, never on it. A blink lasts 140ms and
         `poseAt` is the frame a player looks at (and the frame a screenshot
         catches), so a blink there turns a bright-eyed sit into a squint. This
         was caught by rendering the poses and looking at them. */
      if (id === 'sit') {
        if (u > 0.24 && !flags.b) { flags.b = 1; ctx.blink(1); }
        if (u > 0.30 && !flags.p) { flags.p = 1; s.squash.kick(0.9); ctx.sound('sit-thump'); }
      } else if (id === 'lieDown') {
        if (u > 0.34 && !flags.p) { flags.p = 1; s.squash.kick(1.2); ctx.sound('flop'); }
        if (u > 0.80 && !flags.b) { flags.b = 1; ctx.blink(2); }
      } else if (id === 'beg') {
        if (u > 0.20 && !flags.k) {
          flags.k = 1;
          s.lift.kick(9); ctx.rig.pawLift[0].kick(6); ctx.rig.pawLift[1].kick(5);
          ctx.sound('yip');
        }
        if (u > 0.24 && !flags.b) { flags.b = 1; ctx.blink(1); }
      } else if (id === 'shake') {
        if (u > 0.14 && !flags.b) { flags.b = 1; ctx.blink(1); }
        if (u > 0.18 && !flags.k) {
          flags.k = 1;
          ctx.rig.pawLift[flags.side].kick(11);
          s.tilt.kick(flags.side ? 0.5 : -0.5);
          ctx.sound('paw-offer');
        }
      } else if (id === 'spin') {
        if (u > 0.08 && !flags.k) { flags.k = 1; ctx.sound('scamper'); }
        /* the ears fly outward through the turn */
        if (u > 0.10 && u < 0.90) {
          const f = Math.sin(u * TAU * 2.2);
          s.earL.kick(f * dt * 54); s.earR.kick(-f * dt * 48);
        }
        if (u > 0.88 && !flags.b) { flags.b = 1; ctx.blink(1); s.lift.kick(8); }
      } else if (id === 'jump') {
        if (u > 0.20 && !flags.k) {
          flags.k = 1;
          s.earL.kick(7.5); s.earR.kick(-6.8);
          s.lift.kick(6);
          ctx.sound('launch');
        }
        if (u > 0.78 && !flags.l) {
          flags.l = 1;
          s.squash.kick(2.0);
          s.earL.kick(-5.0); s.earR.kick(4.4);
          ctx.blink(1);
          ctx.sound('land');
          for (let i = 0; i < 3; i++) {
            ctx.spawn('spark', ctx.rig.pose.bodyX + ctx.rng.range(-30, 30), ctx.rng.range(-6, 6));
          }
        }
      } else if (id === 'rollOver') {
        if (u > 0.14 && !flags.k) { flags.k = 1; ctx.sound('flop'); s.squash.kick(1.4); }
        if (u > 0.10 && u < 0.86) {
          const f = Math.sin(u * TAU * 1.6);
          s.earL.kick(f * dt * 70); s.earR.kick(-f * dt * 62);
        }
        if (u > 0.86 && !flags.b) { flags.b = 1; ctx.blink(2); s.lift.kick(6); ctx.sound('shake'); }
      } else if (id === 'playDead') {
        if (u > 0.22 && !flags.k) {
          flags.k = 1;
          s.squash.kick(1.6);
          s.earBack.kick(2.2);
          ctx.blink(1);
          ctx.sound('flop');
        }
      }
    },
  });
}
for (const id of TRICK_IDS) trickClip(id);

/* ---- "well? did I get it right?" -------------------------------------
   She performs, then looks straight at the player and waits. That is a BID
   FOR ATTENTION in exactly the sense research §1.4 means, so it is tagged and
   counts toward the director's 1-in-N quota. It is also the reward window
   made visible: the beat she is holding is the beat you are supposed to fill.
   ---------------------------------------------------------------------- */
registerClip({
  id: 'trick.ask', dur: T.clip.ask, cd: 0.5, bid: true,
  weight: () => 0,
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    ctx.lookAt(195, 1000);
    const env = plateau(u, 0.14, 0.30);
    atLeast(s.eyeOpen, 1 + 0.14 * env, 1);
    atLeast(s.brow, 0.80 * env, 1);
    atLeast(s.perk, 0.44 * env, 1);
    s.tilt.to(s.tilt.t + 0.12 * env * Math.sin(u * 3.4));
    atLeast(s.eyeSmile, 0.42 * env, 1);
    atLeast(s.smile, 0.66 * env, 1);
    atLeast(s.wagAmp, 0.42 * env, 1);
    atLeast(s.wagSpd, 9.5 * env, 1);
    if (u > 0.22 && !flags.b) { flags.b = 1; ctx.blink(1); }
    if (u > 0.5 && !flags.y) { flags.y = 1; ctx.sound('yip'); }
  },
});

/* ---- CONFUSION, NOT REBUKE -------------------------------------------
   Played when she does the wrong thing, mishears a signal, or has attached a
   cue to the wrong trick. It must read as HER being puzzled, never as a
   failure state: head tilt, ears at odds with each other, a look at your hand
   and then away, one soft whine. No cowering, no flattening, nothing that
   looks like being told off — the dog never resents her, and she must never
   feel told off either.
   ---------------------------------------------------------------------- */
registerClip({
  id: 'trick.confused', dur: T.clip.confused, cd: 0.5,
  weight: () => 0,
  init(ctx) { ctx.flags.d = ctx.rng.sign(); ctx.flags.poi = ctx.rng.pick(ctx.poi); },
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    const env = plateau(u, 0.16, 0.28);
    /* looks at your hand... then at something else entirely... then back */
    if (u < 0.34) ctx.lookAt(195, 995);
    else if (u < 0.66) ctx.lookAt(flags.poi.x, flags.poi.y);
    else ctx.lookAt(195, 990);
    s.tilt.to(s.tilt.t * (1 - env) + flags.d * 0.30 * env);
    atLeast(s.eyeOpen, 1.08, env);
    atLeast(s.brow, 0.92 * env, 1);
    atLeast(s.perk, 0.20 * env, 1);
    /* one ear up, one ear out: the universal "eh?" */
    if (u > 0.12 && !flags.e) {
      flags.e = 1;
      (flags.d < 0 ? s.earL : s.earR).kick(5.5 * -flags.d);
      s.earBack.kick(-1.2);
    }
    s.wagAmp.to(0.16 + 0.10 * env);
    s.wagSpd.to(2.2);
    if (u > 0.30 && !flags.b) { flags.b = 1; ctx.blink(1); }
    if (u > 0.44 && !flags.w) { flags.w = 1; ctx.sound('whine'); }
  },
});

/* ---- taking the treat ------------------------------------------------ */
registerClip({
  id: 'trick.nom', dur: T.reward.nomDur, cd: 0.2,
  weight: () => 0,
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    const env = plateau(u, 0.12, 0.34);
    atLeast(s.mouth, (0.30 + 0.22 * Math.abs(Math.sin(u * 26))) * env, 1);
    atLeast(s.tongue, 0.85 * env, 1);
    atLeast(s.eyeSmile, 0.70 * env, 1);
    atLeast(s.smile, 0.85 * env, 1);
    s.noseTw.to(Math.sin(u * 40) * 0.6 * env);
    atLeast(s.wagAmp, 0.52 * env, 1);
    atLeast(s.wagSpd, 12 * env, 1);
    if (u > 0.10 && !flags.k) { flags.k = 1; s.lift.kick(10); ctx.sound('crunch'); }
    if (u > 0.55 && !flags.b) { flags.b = 1; ctx.blink(2); }
  },
});

/* ---- the hesitation --------------------------------------------------
   A low-mood dog does not no-op. "A no-op reads as a bug; a hesitation reads
   as a personality" (research §2). She looks at you, looks away, thinks about
   it, and then usually does it anyway.
   ---------------------------------------------------------------------- */
registerClip({
  id: 'trick.hesitate', dur: 1.0, cd: 0.2,
  weight: () => 0,
  init(ctx) { ctx.flags.poi = ctx.rng.pick(ctx.poi); },
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    if (u < 0.42) ctx.lookAt(195, 992);
    else if (u < 0.78) ctx.lookAt(flags.poi.x, flags.poi.y);
    else ctx.lookAt(195, 992);
    const env = plateau(u, 0.2, 0.3);
    s.perk.to(s.perk.t + 0.12 * env);
    atLeast(s.brow, 0.55 * env, 1);
    s.tilt.to(s.tilt.t + 0.10 * env * Math.sin(u * 2.2));
    if (u > 0.5 && !flags.b) { flags.b = 1; ctx.blink(1); }
  },
});

export default TRICKS;
