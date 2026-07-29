# Pocket Puppies — Architecture & Build Contract

This document is the **contract**. Multiple agents build against it in parallel, so the
interfaces here are binding. If you need to change one, say so explicitly in your report
rather than changing it silently — someone else is coding against it right now.

---

## 0. Design north star

A Nintendogs that lives on a phone, built as a gift. Three principles that override
faithfulness to the original:

1. **The dog never resents her.** Nintendogs punished absence — dogs got filthy, sick,
   and forgot their names. That's the one part we deliberately do not reproduce. Affection
   has a **ratcheting floor** that rises permanently at bonding milestones and never falls
   below it. A two-week absence means a hungry, slightly grubby, *overjoyed-to-see-her* dog.
   Never a reproachful one.
2. **A session is 90 seconds or 20 minutes, both valid.** She should be able to open it,
   get one good moment (a stroke, a trick, a tail wag), and close it feeling good. Nothing
   may require a long session to avoid a penalty.
3. **Petting is the game.** Everything else is scaffolding around the core loop of touching
   a creature that responds. When trading off effort, petting quality wins.

---

## 1. Stack & constraints

- **No framework, no build step.** Vanilla ES modules served straight off GitHub Pages.
  A `git push` is a deploy. Keeps iteration instant and the thing alive in five years.
- **Canvas2D**, one canvas, one `requestAnimationFrame` loop.
- **No runtime network requests.** All art is code; all data is inlined JS. The service
  worker precaches everything so it works in a tunnel, on a plane, at her parents' house.
- **Target: iOS Safari on a mid-range phone, installed to the home screen.**
  - Cap DPR at ~2.25 (fill-rate protection; the spike proved this holds 60fps)
  - `touch-action: none` on the play surface; no hover dependence; no 300ms tap delay
  - Respect `env(safe-area-inset-*)` — the home bar overlaps the bottom of the screen
  - Audio needs a user gesture to start. Never autoplay; unlock on first tap.
  - `prefers-reduced-motion` must be honoured (calmer springs, no parallax, no shake)

## 2. File layout

```
/index.html            single entry; inlines the boot CSS, imports /src/main.js
/manifest.webmanifest
/sw.js                 service worker, precache-everything
/src
  main.js              boot: load save, install loop, mount first scene
  engine/
    loop.js            rAF, fixed-ish dt, scene dispatch, visibility handling
    spring.js          the spring primitive (from spike A) — substepped, delta-time
    input.js           pointer normalisation, gesture disambiguation, stroke tracking
    audio.js           gesture-gated WebAudio, tiny synthesised sfx (no asset files)
    draw.js            Canvas2D helpers: rounded paths, Catmull-Rom, gradients, shadows
    rng.js             seeded RNG (deterministic idle variety, testable)
  dog/
    rig.js             part hierarchy + spring set; poses via TARGETS only
    draw.js            renders a rig using a breed's silhouette + palette
    idle.js            the idle director (spontaneous actions, weighted, non-repeating)
    pet.js             stroke-impulse field, zone detection, per-zone responses
    breeds.js          BREEDS data table — the seam for adding breeds
    anim/              named action clips (yawn, shake, sit, stretch, bark...)
  state/
    game.js            the save object, mutations, derived getters
    save.js            localStorage persistence + export/import + migrations
    time.js            elapsed-time decay, day boundaries, time-of-day
    balance.js         ALL tunable numbers. No magic numbers anywhere else.
  scenes/
    room.js            main scene: the dog, the care actions, navigation
    walk.js            side-view walk + discovery
    train.js           trick teaching
    contest.js         disc / agility / obedience
    shop.js            items, toys, breeds
    kennel.js          adopt / switch dogs
  ui/
    hud.js, nav.js, sheet.js, toast.js, meter.js
```

## 3. The loop & scene contract

`engine/loop.js` owns the only rAF. Scenes are plain objects:

```js
export default {
  id: 'room',
  async enter(app, params) {},   // called once on mount; may await
  exit(app) {},                  // teardown: remove listeners, free canvases
  update(app, dt, t) {},         // dt in SECONDS, already clamped to <= 1/30
  draw(app, g) {},               // g = engine/draw.js wrapper bound to the 2D ctx
  pointer(app, ev) {},           // normalised: {type, x, y, id, dx, dy, speed}
}
```

- `dt` is **clamped** (max 1/30s) so a backgrounded tab doesn't fling springs to infinity.
  This bit the 3D spike; do not skip it.
- Scenes must not touch `window` listeners directly — use `app.input`.
- `app` carries `{ game, input, audio, nav, canvas, dpr, reduced }`.

## 4. State shape (persisted)

```js
{
  v: 1,                      // schema version; save.js migrates forward
  createdAt, lastSeenAt,     // epoch ms — lastSeenAt drives elapsed decay
  player: { coins, trainerPoints },
  dogs: [Dog],
  activeDogId,
  inventory: { food:{}, care:{}, toys:[], accessories:[] },
  unlocks: { breeds:[], items:[], rooms:[] },
  contests: { disc:{rank,wins,lastEntryAt,entriesToday}, agility:{...}, obedience:{...} },
  walks: { lastWalkAt, walksToday, found:[] },
  flags: { seenIntro, namedFirstDog, ... },
  settings: { sound, reducedMotion, mic }
}

Dog = {
  id, name, breedId, sex, bornAt,
  needs:  { hunger, thirst, cleanliness, energy },   // 0..1, 1 = fully satisfied
  affection,        // 0..1 current
  affectionFloor,   // 0..1 ratchet — affection may NEVER be set below this
  trust,            // 0..1, slower than affection; gates advanced tricks
  tricks: { sit:{level:0..3, learnedAt, cue}, ... },
  aptitude: { disc, agility, obedience },  // rolled at adopt from breed + jitter
  wear: { collar, accessory },
  log: [ {at, kind, note} ],   // capped ring buffer; powers "remembers you" moments
}
```

**Rules that are not negotiable:**
- All need/affection writes go through `state/game.js` mutators. No scene pokes fields.
- `affection = Math.max(affectionFloor, next)` — enforced inside the mutator.
- Every tunable lives in `state/balance.js`. If you find yourself typing a number that
  a designer might want to change, it belongs there.

## 5. Time & decay

`state/time.js` runs on load: `elapsed = now - lastSeenAt`, then applies decay.

- Decay is **capped** — `min(elapsed, BALANCE.maxDecayHours)` (default 36h). Beyond the cap
  nothing further degrades. This is principle 1, in code.
- Needs decay; **affection does not decay below the floor**. A small "missed you" dip above
  the floor is fine and makes reunion feel good; erasing progress is not.
- Returning after >8h triggers a scripted **reunion**: the dog notices, runs at the camera,
  tail going. This should be the best-feeling animation in the game.
- Day boundary resets `walksToday` / `entriesToday`. Use local midnight, not UTC.

## 6. The dog rig (the part everyone depends on)

Extracted from `spike-a-2d.html`, which is the reference implementation for feel.
Preserve these properties — they are why it works:

- **Layered pose pipeline**: `base mood → idle director → action clip → petting overlay`.
  Every layer writes *targets only*, never final values. Springs resolve. Nothing pops.
- **Secondary motion**: ears take angular-velocity kicks derived from the head's actual
  measured per-frame rotation. The tail is a spring chain where each joint inherits the
  previous joint's deviation. This is most of the "alive" feeling — do not simplify it.
- **Pseudo-3D head turns**: feature parallax (muzzle > eyes > brows > ears move at different
  rates) plus far-side foreshortening and a silhouette skew.
- **Petting** is a decaying field of stroke impulses displacing resampled Catmull-Rom
  silhouette points, so the body genuinely dents and follows the finger.

### Known art defects to fix during extraction
1. **Fur clumps read as nubs.** The pale lobes along shoulders/haunches look like growths.
   Make them read as fur: soften, tuck inside the silhouette, follow body curvature, and
   drop their contrast against the coat.
2. **The tail looks detached** — gap at the base, and its banding reads as a separate object.
   Anchor it into the rump and carry the coat gradient across the join.
3. **Proportions are chunky-adult, not puppy.** Bigger head relative to body, shorter and
   stubbier legs, softer muzzle, larger eyes set lower.

### Breed seam

```js
BREEDS.shiba = {
  id, name,
  palette:      { coat, coatShade, cream, nose, eye, tongue, blush, pad },
  proportions:  { headScale, bodyW, bodyH, legLen, legW, earH, earW, muzzleW, muzzleH,
                  eyeSize, eyeSpacing, tailCurl, tailLen, neckRuff },
  silhouette:   { body:[...], head:[...], ear:[...] },  // normalised 0..1 outlines
  markings:     [ {shape, where, color} ],              // urajiro, saddle, blaze, socks
  fur:          { type:'short'|'long'|'curly'|'wiry', clump },
  temperament:  { energy, focus, friendliness },        // drives idle mix + training
  aptitude:     { disc, agility, obedience },           // contest bias
}
```

Adding a breed must mean **adding a data entry**, not editing the renderer. Where the
renderer can't yet express a breed (floppy ears, long coat), extend it with a *declarative*
capability (`ear:'floppy'`, `fur:'long'`) rather than special-casing a breed by id.

## 7. Camera problem (read before building walks or contests)

The rig is near-frontal only. Walks, agility and disc need other framings. **Do not attempt
to rotate the frontal rig.** The approved plan:

- **Room / train / obedience** — existing frontal rig.
- **Walk** — a separate **side-profile rig** (`dog/rig.side.js`), sharing the spring engine,
  idle director, breed palette and proportions, but with its own silhouettes and a real gait
  cycle. This is the single largest new art task.
- **Disc / agility** — reuse the **side rig**, staged as a side-on arena. Framing chosen
  specifically so the frontal rig's absence never shows.

Breed data must serve both rigs: keep `palette`/`proportions`/`markings` rig-agnostic and put
outlines under `silhouette.front` / `silhouette.side`.

## 8. Persistence & the localStorage risk

iOS can evict web storage for infrequently-used sites, and a home-screen PWA is *safer* but
not immune. Mitigations, all required:

- Write on every meaningful mutation, debounced (~800ms), plus on `visibilitychange` hidden
  and on `pagehide`. Never rely on `beforeunload` alone on iOS — it's unreliable.
- Ask for `navigator.storage.persist()` after the first real interaction.
- Ship **export/import**: a copy-paste save string (base64 JSON) in settings, so a bond
  built over months can be rescued. Also the only migration path off this host.
- Version every save (`v`) and write forward-migrations in `save.js`. Never break an old save.

## 9. Feature-flagged risky capabilities

Anything permission-gated must be **additive** — the game must be complete and lovely with
all of it switched off, and better with it on.

- **Microphone / name recognition.** Nintendogs' signature was calling the dog by name.
  `SpeechRecognition` on iOS Safari is unreliable and permission-gated. Plan: default the
  game to a tap/gesture cue, and offer voice as an opt-in extra behind a clear prompt.
  If it fails, degrade silently to taps. Never block progress on it.
- **Notifications** ("your puppy misses you"): do not ship without asking. It's the fastest
  way to make a gift feel like an obligation. Off by default, opt-in only.
- **Blowing into the mic** (bubbles, the DS trick): opt-in, needs `getUserMedia`.

## 10. Build order

1. **Foundation** — extract the spike into the module layout; `loop`, `spring`, `input`,
   `draw`, `rig`, `dog/draw`, `idle`, `pet`, `game`, `save`, `time`, `balance`. Room scene
   renders the dog with petting at parity with the spike, plus the three art fixes. **Gate:
   visually indistinguishable-or-better than the spike, still 60fps, saves and reloads.**
2. **Care + bonding** — feed, water, wash, brush, needs, mood, reunion, HUD.
3. **Training** — trick system, teaching flow, cues.
4. **Side rig + walk** — gait cycle, route, discovery.
5. **Contests** — disc, agility, obedience on the side rig; economy.
6. **Shop, kennel, breeds, personalisation.**
7. **PWA polish** — manifest, service worker, icons, audio, reduced motion, install prompt.

Each stage must leave the game **playable and shippable**. She may see it at any point.
