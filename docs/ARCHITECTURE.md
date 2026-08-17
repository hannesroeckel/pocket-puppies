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
  aptitude: { disc, agility, obedience },  // per-DOG jitter only — SEE §15.1 §2.
                                           // The 'from breed' half of this line was
                                           // REMOVED in stage 5 and must not come back.
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

---

## 11. Stage 1 (Foundation) — as built

Stage 1 is landed. This section is **authoritative** where it differs from the text above;
the differences are deliberate and listed here so stages 2-7 code against reality.

### 11.1 Contract changes

**A. There is no affection meter, and there must not be one.** §10's stage-1 line asked for
one; the design research reversed it. The original deliberately left the bond *un*inspectable
while hunger/thirst/fur were inspectable — you read affection off the animal's body (tail
amplitude and speed, ear position, approach vs retreat, eye contact). A bar turns that
reading into a number. `affection` still exists in state and still drives posture, tail,
ears, eyes and mouth; it is simply never drawn. `ui/meter.js` still exports
`drawAffectionMeter` but **nothing mounts it** — see the header comment there before reaching
for it. Needs *are* inspectable, in **words not bars**: `BALANCE.inspect` holds the
original's scales (`Full/Normal/Hungry/Famished`, etc.) and `game.describeNeed(key)`
resolves them.

**B. Petting has sweet spots AND bad spots.** §6 described petting as a deformation field;
that field is intact, but the zone model is now asymmetric, because pleasant-but-distinct
zones make petting "a +1 affection button with a nice shader":
- **sweet** — `ear` (behind the ears), `chin`, `neck` (base of the neck), `chest`
- **ok** — `head` (crown), `back`, `belly`
- **bad** — `muz` (muzzle/nose), `tail`, `paw` → irritation, recoil away from the finger,
  wide eyes, a sneeze, a head-shake, a paw pulled in
Bad spots pay almost no affection but **never subtract** — annoyed, never resentful
(principle 1). **Speed and rhythm are part of the mechanic**: slow long strokes build
`contentment`; frantic scribbling (direction reversals per second) builds `overstim` and
then `irritation`; repeated quick taps build `poke` and she backs off. A liked stroke makes
her **keep leaning for ~1.7s after you let go** (`BALANCE.pet.lean`).

Zones carry a `pri` (priority). In a near-frontal rig the head genuinely occludes the top of
the chest, so head zones must beat body zones where they overlap — priority mirrors draw
order, which is what the player sees. All ten zones resolve to themselves at their own centre
(verified).

**C. Eyes lead the head.** Called out as the single thing that reads as alive rather than
animated. Implemented as a real `pupilX`/`pupilY` spring pair whose target is the gaze while
`yaw`/`pitch` chase the same target more slowly; `dog/draw.js` slides the eye lens (and, at
half rate, the catchlight, and at 30%, the brow markings) inside the socket.
**Measured**, not assumed: pupils reach 63% of a step target in **~40ms**, the head in
**~133ms** — a ~3.5x lead. *Deviation:* the research asked for ~120ms on the head. Getting
there needs a near-critically-damped k≈306/d≈35 spring, which costs the springy overshoot
the human approved in the spike. 133ms preserves the character and keeps the ordering, which
is the part that does the work. The ears are an **asymmetric pair by construction** —
`earL`/`earR` have different stiffness and damping and independent fbm drift targets, so an
identical impulse produces two different curves and they can never move in lockstep.
**First visible reaction to touch is <80ms**: `pointerdown` applies *impulses* (ear kicks,
pupil kicks), not targets, so motion appears in frame 1-2 (measured: pupil moves 0.088 rad
at 17ms).

**D. Idle autonomy.** Three lanes run independently: `clips` (weighted, cooldown-gated),
`micro` (eight tiny self-initiated behaviours so there is never more than
`BALANCE.idle.maxIdleGap` = 3.4s of true stillness), and `reflex` (blink + per-ear twitch,
which never stop). Clips tagged `bid: true` are **bids for attention** (she holds eye
contact with the player); the director enforces roughly 1 in `bidEveryN` = 8. Measured over
180 simulated seconds: 40 clips, 13 unique, bid ratio 0.15, longest run of the same clip 1,
longest silence 3.42s.

**E. `scenes/*.js` may export an optional `resize(app)` hook.** The loop calls it on window
resize / orientation change. Additive to §3; scenes without it are unaffected.

**F. `app` carries two extra flags** beyond §3's list: `app.standalone`
(`navigator.standalone || display-mode: standalone`) and `app.storagePersisted`. See 11.4.

**G. "Every tunable in `balance.js`" means every *design* tunable.** Colour ramps, outlines
and marking geometry are **art data**, and live in `dog/breeds.js` (the dog) or as a scene
constant (`scenes/room.js`'s `C` room palette). Putting bezier control factors in
`balance.js` would make it unreadable without making anything tunable. Everything a designer
would plausibly want to turn — spring constants, zone radii and gains, decay rates, clip
durations and cooldowns, fur softness, affection economy — is in `balance.js`.

### 11.2 Interfaces stage 2+ codes against

```js
// state/game.js
createGame(state, { onChange })  ->  {
  state, dog, affection, affectionFloor, affectionPulse, mood,
  addAffection(delta, reason?),   // ratchet enforced INSIDE; never write dog.affection
  setAffection(v, reason?), drainAffection(dt), decayAffectionPulse(dt),
  addTrust(d), addNeed(key, delta), setNeed(key, v),
  addCoins(n), addTrainerPoints(n), setFlag(k,v), setSetting(k,v),
  log(kind, note), markSeen(now), describeNeed(key), touch(),
}
newState(now, opts) / newDog(now, opts)

// state/save.js
load() | writeNow(state) | clear() | migrate(raw) | MIGRATIONS  // add {2: fn} to bump
createSaver(getState) -> { schedule(), flush(), writes, pending, destroy() }
exportSave(state) -> 'PP1<base64>'   importSave(str) -> state   // throws on junk
requestPersistence() -> Promise<bool>   isStandalone() -> bool

// state/time.js
applyElapsed(game, now) -> { hours, cappedHours, capped, reunion, newDay, clockSkewMs }
timeOfDay(now) -> { t, phase, hour }   isNewDay(a,b)   dayIndex(ms)   describeGap(hours)

// engine
createLoop(app, g) -> { mount(scene, params), start, stop, resize, stepFixed(dt,n),
                        stepSim(dt,n), stats, resetStats, scene, t, frames }
createInput(canvas, view) -> { state, setHandler(fn), onFirstGesture(fn), tick(dt), destroy }
createAudio(settings) -> { unlock(), ready, play(name, opts), setEnabled(on), voices, pending }
createG(ctx, view) -> { ctx, view, toVirtual(scale?), toDevice(), roundRect, ell, crClosed, ... }
createRng(seed) -> { next, range, int, pick, chance, sign, span, fork, reseed }

// dog
createRig({ breed, reduced, rng }) -> { breed, dims, pal, sil, springs, pawLift, tail, fur,
    pose, gaze, x, y, s, t, drive, mo, base(mood, dt), update(dt),
    lookAtVirtual(vx,vy), headWorld(), blinkNow(n), shiver() }
createDogRenderer(rig) -> { draw(g, pet, affection) }
createIdle(rig, { rng, poi, spawn, sound }) -> { update(dt, st), play(id), cancel(gap),
    current, isBid, sinceBid, quiet, history }
createPetting(rig, { reduced, rng, hooks }) -> { down/move/up/cancel, apply(dt, mood),
    computeZones(), hitZone(lx,ly), deformPoint(...), level, glow, energy, zoneSprings,
    overstim, irritation, contentment, rhythm, sinceTouch, IN, zones, presses }
  hooks: { onAffection(amt, zone), onTapAffection(amt, zone), onSpawn(kind, lx, ly),
           onTap(zone, clipId, kind), onMiss(vx, vy) }
registerClip({ id, dur, cd, bid?, weight(ctx), init?(ctx), update(u, dt, ctx) })

// app.nav
app.nav = { has(id), register(id, scene), go(id, params) -> bool, current }
```

**Pose pipeline order — do not reorder.** `rig.base(mood, dt)` → `idle.update(dt, st)` →
`pet.apply(dt, mood)` → `rig.update(dt)` → `pet.computeZones()`. Every layer before
`rig.update` writes **targets only**.

**Coordinate spaces.** `scene.pointer` events are in **virtual design space** (390x844).
Rig-local is `(v - rig.x) / rig.s`. Zones, presses and silhouettes are all rig-local.

### 11.3 Breed seam

`BREEDS.shiba` is the one complete entry. Adding a breed is a data entry:
- `palette` supplies the **eight** canonical keys; the full render ramp (`coatHi`, `coatMid`,
  `coatDeep`, `creamMid`, `creamSh`, `line`, `inner`, `mouth`, ...) is **derived** by
  `derivePalette()` in `engine/draw.js`. `palette.extra` overrides any derived key.
- `proportions` carries §6's 15 keys plus `headW`/`headH` (the base head box that `headScale`
  multiplies) and an `anchors` block of attachment points expressed as fractions of the
  parent part's half-extent. Extension, documented here.
- `silhouette.front.{body,bib,head,muzzle,ear,earInner}` are normalised `0..1` outlines with
  an `origin` (the point that is the part's local 0,0) and an informational `box`.
  **`silhouette.side` is absent** — stage 4 adds it.
- `markings` is interpreted generically: `patch` (a named outline, with `deform` and
  `feather`), `ellipse` (with `at`/`size` as fractions of the part half-extent, `mirror`,
  `soft` for concentric feathering, and an optional `tag` the renderer animates — `cheek`,
  `brow`), `stocking`, `tailUnder`.
- `fur.clump.{body,head}.at` are parametric positions around the outline, resolved against
  the **live deformed** outline each frame.
- Capability differences are declarative tables in `dog/draw.js`: `FUR_TYPE`
  (`short|long|curly|wiry`) and `EAR_STYLE` (`prick|floppy`). **Never** branch on breed id.

### 11.4 iOS storage reality (supersedes §8's optimism)

Per `docs/PLATFORM-RISKS.md`: `navigator.storage.persist()` is **not a real mitigation on
iOS** — it is largely a Chromium/Gecko affordance. It is still called, guarded, and a `false`
return is the **normal** case surfaced as `app.storagePersisted`; nothing may depend on it.
What actually protects a save is being installed to the Home Screen (ITP exempts installed
web apps from the 7-day sweep) — surfaced as `app.standalone` for a later stage to explain —
and **export/import**, which is therefore a shipped stage-1 feature, not polish.
`state/time.js` includes a **clock-tamper guard**: a `lastSeenAt` in the future is clamped to
now rather than trusted, and the result is reported as `elapsed.clockSkewMs`.

### 11.5 Art fixes

1. **Fur no longer reads as nubs.** Clumps are resolved against the live deformed silhouette
   (so they follow curvature and every petting dent), drawn **inside a clip of the
   silhouette** so protrusion is impossible, and rendered as three thin fanned tapered
   strands at `BALANCE.fur.contrast` = 0.26 alpha with a shadow pass behind — a single wide
   lobe reads as a flat facet, which is the same failure in a different costume. The
   silhouette itself carries a deliberately tiny scallop (amp 0.34); above ~0.5 the head
   reads as a potato.
2. **The tail is anchored.** Its base sits at 60% of the body half-width *inside* the rump,
   the outline tapers to nothing over the first two joints, the tail gradient **starts at the
   rump's own shade** so the coat carries across the join, a soft radial root blend covers
   the seam, and the cream underside is a late, low-alpha sheen rather than a stripe.
3. **Proportions are puppy.** Head 1.12x (as wide as the body), legs shortened to 32 units
   and thickened, muzzle smaller and rounder, eyes larger (`eyeSize` 1.14) and set low
   (`anchors.eyeY` -0.04). Eye corner tilt dropped to 0.05 — the spike's 0.09 reads as a
   glare on a bigger eye.

### 11.6 Measured (headless Chromium, 390x844, `--enable-gpu`)

DPR is capped at `BALANCE.view.dprMax` = 2.25 by design (§1), so a DPR-3 device renders at
2.25. Per-frame work is the portable number; the rAF interval confirms presentation.

| | work median | work p95 | work max | rAF median | rAF p95 |
|---|---|---|---|---|---|
| DPR 2, idle | 1.2ms | 1.9ms | 2.7ms | 16.7ms | 16.8ms |
| DPR 2, mid-petting | 1.5ms | 1.9ms | 2.4ms | 16.7ms | 16.8ms |
| DPR 3→2.25, idle | 1.2ms | 1.9ms | 2.7ms | 16.7ms | 16.8ms |
| DPR 3→2.25, mid-petting | 1.6ms | 2.0ms | 4.8ms | 16.7ms | 16.8ms |

A 16.7ms rAF median with ~2ms of work means the frame budget is ~12% used and the loop is
vsync-locked at 60fps, idle and mid-petting, with roughly 8x headroom for stages 2-7.

Not measured on an iPhone. `docs/PLATFORM-RISKS.md` describes the probe that must confirm it.

### 11.7 Not built in stage 1

`sw.js` (stage 7 — a service worker caching a half-built game makes iteration miserable),
`scenes/{walk,train,contest,shop,kennel}.js` (nav toasts "coming soon" via
`app.nav.go()` returning false), `dog/rig.side.js` (stage 4), real audio (stage 7 fills
`audio.voices`; the room already calls `play()` with names — see `audio.pending` for the
list it owes), and the needs/reunion HUD (stage 2).

---

## 12. Stage 2 (Care + bonding) — as built

Stage 2 is landed. This section is **authoritative** where it differs from §11 and above.

### 12.1 THE BIG ONE: mood and affection are now two axes

Stage 1 conflated them, and the measured consequence was that ~50 strokes in one sitting
took the bond from 0.30 to 0.93. Research §2 prescribes two axes with different time
constants, and that is now what exists:

| | `mood` | `affection` | `trust` |
|---|---|---|---|
| speed | seconds | days | weeks |
| persisted | **no** | yes | yes |
| drives | **everything visible** — posture, tail amplitude/speed, ear height, eye openness, mouth, blush, breathing | the **mood baseline**, reunion intensity | stage 3's advanced tricks |
| drawn | never | never | never |

- `rig.base(mood, dt)` and `pet.apply(dt, mood)` read **`mood.mood`**, not `mood.affection`.
  `rig.drive.mood` is the fast channel; `rig.drive.affection` is kept alongside for anything
  that wants the long game. `dogRenderer.draw(g, pet, mood, coat)`'s third argument is now
  **mood**, not affection.
- Mood decays toward `baseBias + affection*baseFromAffection − unmet_needs*needWeight`. So a
  bonded dog *rests* happy and an unbonded one doesn't, which is where the bond is legible.
  Mood is **never persisted** — a mood that survives a cold start is a grudge.
- `BALANCE.affection.idleDrainPerSec` is now **0**. The per-second drift moved to mood.
  `game.drainAffection(dt)` is kept and is a no-op at that setting.

**The affection economy is metered in `state/game.js`, not by callers.** `addAffection()`
puts every positive delta through `meter()`: a per-session diminishing return
(`exp(−earnedThisSession / session.soft)`, converging on `session.cap`) and a hard
`day.cap`. `awardDay(kind)` pays the once-a-day bonuses — `showUp`, `reunion`,
`care:feed|water|wash|brush`, `toy` — which is how "distinct sessions beat session length"
is implemented. `addAffectionRaw()` bypasses the meter and is for migrations only.

Measured on the identical probe the human ran (10 zones x 5 strokes, one sitting):

| | stage 1 | stage 2 |
|---|---|---|
| affection | 0.300 → 0.932 (**+0.632**) | 0.300 → 0.320 (**+0.020**) |
| mood after ~1s of stroking | n/a | +0.11 |
| mood after ~3s of stroking | n/a | +0.26 |
| 0.06 → 0.75 at maximum daily play | one sitting | **13 days** |

### 12.2 Pipeline order — an explicit deviation

```
rig.base -> idle.update -> pet.apply -> care.apply -> toy.apply -> reunion.apply
         -> rig.update -> pet.computeZones
```

§6 puts the action clip *before* the petting overlay. `care.apply` runs **after** it, on
purpose: during feed and water the action owns the head and petting must not be able to yank
her muzzle out of the bowl; during wash and brush care writes almost no pose, so the whole
petting response still reads through. `reunion.apply` is last because it owns the entire
animal for six seconds, and `idle.update` is **skipped** while the reunion runs.

State machines (`reunion.update`, `care.update`, `toy.update`) run *before* the pose
pipeline, so the pose they drive is never a frame stale.

### 12.3 New interfaces

```js
// state/game.js  (additive; every stage-1 member still exists)
moodLevel, moodBaseline, addMood(d), setMood(v), dentMood(amt?), stepMood(dt)
addAffection(d, reason)     // now metered by session + day
addAffectionRaw(d, reason)  // unmetered — migrations only
awardDay(kind, now?) -> paid      noteTouch(now?)      bondLedger
fillNeed(action, delta)     // respects that action's ceiling (brush stops at "Clean")
appetite()                  // 0..1, from how hungry she is right now
dirt (live array), dirtMean, setDirt(i,v), soil(amount, rng), syncCleanliness()
gloss, addGloss(d), describeGloss()
isNamed, displayName, setName(name), pressingNeed()
DIRT_REGIONS                // exported const: how many dirt regions a coat has

// state/time.js
reunionIntensity(hours, affection) -> 0..1     decayLive(game, dt)
applyElapsed(...) now also returns `intensity`

// dog/pet.js  (additive)
pet.anchor(part) -> {x,y,hx,hy}   // rig-local; care places dirt + grain against these
pet.irritate(amount)              // register displeasure through the bad-spot channel
pet.ruffle(lx,ly,ux,uy,mag)
hooks: + onMood(amt, zone), onMoodDent(amt, zone)

// dog/rig.js  (additive)
rig.sy            // vertical scale — the FORESHORTENING channel, 1 by default
rig.home          // {x,y,s} resting placement, so a sequence can spring back
rig.drive.mood / .pant / .neck
pose.neckX, pose.neckY

// dog/care.js
createCare(rig, {game, pet, idle, rng, reduced, spawn, sound, toast}) -> {
  active, mode, phase, hint, coat, weight, modal, bowl, fill,
  start(kind), stop(), update(dt, mood), apply(dt, mood),
  pointer(ev, local) -> consumed, drawFront(g), drawOver(g),
  soil(amount), resetStroke(), debug }

// dog/toy.js
createToy(rig, {game, idle, rng, reduced, spawn, sound, toast, soil}) -> {
  toy, state, outcome, busy, held, depth,
  update(dt, mood), apply(dt, mood), pointer(ev, local) -> consumed, draw(g),
  throwUp(power), reset(toHome), debug }

// dog/reunion.js
createReunion(rig, {game, idle, rng, reduced, spawn, sound}) -> {
  active, phase, intensity, progress, shake,
  start(intensity, hours), stop(), update(dt), apply(dt, mood), drawOver(g), debug }

// ui/naming.js
createNaming({game, reduced, onName, onDone}) -> {
  isOpen, active, mode, asking, named,
  start(mode, view), close(), skip(), update(dt), draw(g, view),
  pointer(ev, view) -> consumed, submit(v), resize(view), debug }

// ui/hud.js  (additive)
hud.visible, hud.showNeeds(), hud.needsShowing, hud.hit(x,y) -> 'name'|null

// scenes/props.js  (new; shared by the room's decor and the care actions)
drawBowl(c,x,y,s,kind,fill,t,ripple)  drawSack  drawJug  drawBrush
drawSoap  drawBall  drawBone  drawDropRing  PC
```

`ui/sheet.js` rows accept an optional `right` string — the word-scale status of the need
that row serves. That is how the care sheet is the original's inspect screen.

### 12.4 Schema v2

`SCHEMA_VERSION = 2`, migration `MIGRATIONS[2]` in `state/save.js`. Added to each dog:

- `name` may be **`''`** — the puppy arrives unnamed and *she* names it. A save with no name
  is completely valid; nothing may substitute a placeholder, and `ui/hud.js` draws no name
  pill until there is one. `BALANCE.gift = { breedId, sex }` is the one-line change for the
  starter puppy until the human confirms breed and sex.
- `dirt[]` — per-region coat dirt, `DIRT_REGIONS` long. **Dirt accrues from ACTIVITY**
  (`BALANCE.needs.dirt.*`, paid by play and by stage 4's walks), not from the clock. The
  time-based `cleanliness` decay is a deliberate whisper (0.0015/h ≈ one word-step a
  fortnight) so a long absence reads as a dull coat and nothing more.
- `gloss` — raised by brushing along the grain, fades ~0.01/h.
- `bond` — `{day, earned, showedUp, care{}, session, sessionAt}`, the slow-axis ledger.

A stage-1 save keeps its dog, its affection, its floor and its name — including "Mochi",
which is now a name she chose rather than a default. Its dirt mask is seeded from the
cleanliness it already had, so a grubby stage-1 dog arrives visibly grubby. Verified: v1 →
v2 loads with `name='Mochi'`, `affection=0.614`, `dirt=0.62`, and the naming beat correctly
does not open.

### 12.5 Art additions in `dog/draw.js`

- **Dirt** is drawn in **part-local space** (`at x halfExtent`, the space the body and head
  groups are already in — no transform gymnastics), in three concentric passes,
  **on top of the rim light**. Under it, a filthy dog rendered as spotless.
- **Foam / wet / gloss.** Wet flattens the fur clumps (`drawFur(..., wet)`), which is most
  of what makes a wet dog read as wet rather than as a dog with a blue filter on it.
- **The neck bridge** (`rig.drive.neck`, 0..1). The frontal rig has no drawn neck; that is
  fine until a care action drives the head down into a bowl or the reunion scales her to
  2.35x, at which point any daylight between head and shoulders reads as the head having
  come off. Drawn between the body and the front legs, no outline pass.
- **`rig.sy`** is applied as `c.scale(rig.s, rig.s * rig.sy)`.

### 12.6 Frontal-camera geometry, learned the hard way

Two attempts at "her head is in the bowl" are worth recording, because the first is the
obvious one and it is wrong:

1. **Bowl on the floor in front of her paws, head dropped 132 rig units to reach it.**
   The head group ends up entirely over the body and the dog renders as a *disembodied head
   on the rug*. Caught by rendering it and looking; no amount of reading the code would have.
2. **What shipped:** the bowl comes UP to chest height (`stage.bowlTarget = [178, 644]`),
   the head drops only `care.headDown = 74` and pitches to `-0.62`, the placed bowl is drawn
   *in front of* the dog at 1.15x so its rim occludes the muzzle, and `drive.neck` bridges
   the shoulders. The whole animal stays in frame.

The same lesson applies to the toy chase and the reunion: on this rig, **depth is scale**.
`rig.s` shrinking with `rig.sy` squashing is what reads as running away; `rig.s` growing is
what reads as running at you. There is no gait cycle and none is needed.

### 12.7 Measured (headless Chromium, 390x844, `--enable-gpu`)

| | work median | work p95 | rAF median | rAF p95 |
|---|---|---|---|---|
| DPR 2, idle | 1.4ms | 2.3ms | 16.7ms | 16.8ms |
| DPR 2, mid-petting | 1.2ms | 2.2ms | 16.7ms | 16.8ms |
| DPR 2, wash + suds + droplets | 1.7ms | 3.8ms | 16.7ms | 16.7ms |
| DPR 3→2.25, idle | 1.5ms | 2.4ms | 16.7ms | 16.8ms |
| DPR 3→2.25, mid-petting | 1.4ms | 2.3ms | 16.7ms | 16.8ms |
| DPR 3→2.25, wash + suds + droplets | 1.6ms | 2.5ms | 16.7ms | 16.8ms |

Stage 2's heaviest new load (the bath: dirt mask, foam clusters, wet pass, gloss band and
~90 live particles) costs about **0.3ms** over stage 1. The loop is still vsync-locked with
roughly 7x headroom.

Idle mandates re-measured over 240 simulated seconds: 57 clips, 13 unique, longest repeat
run 1, **1 bid in 8.1** (research target ~1 in 8; stage 1 was 1 in 6.7 and adding stage 2's
clips pushed it to 1 in 5.6, so `BALANCE.idle.bidDampUntil` was added), longest true silence
**3.42s** (research target ~4s).

### 12.8 Not built in stage 2

Real audio (`audio.pending` now also owes `crunch`, `lap`, `water-pour`, `scrub`, `suds`,
`shake-big`, `brush`, `grumble-brush`, `toy-throw`, `toy-land`, `toy-grab`, `scamper`,
`yelp`, `huff`, `proud-yip`, `bark`, `boop`, `launch`, `perk`), a shop for care items
(brushes and shampoos are free and universal for now), and the install prompt.

---

## 13. Stage 3 (Training + tricks) — as built

Stage 3 is landed. This section is **authoritative** where it differs from §11, §12 and above.

### 13.1 Contract deviations

**A. Training is IN THE ROOM, not `scenes/train.js`.** §2 lists a separate scene; stage 2
already made care and play in-room for the same reason, and the reason is stronger here: the
ritual is *him, in his corner, with the same rig and the same petting field under it*.
Guiding a pose is a stroke, so it must dent his coat and find the sweet spots exactly as
petting does — which it cannot do across a scene boundary. `scenes/train.js` is therefore
**not built and should not be built**; `app.nav.has('train')` stays false and the Train nav
item calls `startTrain()` in the room. `dog/train.js` is the layer.

**B. Voice is `SpeechRecognition`, not an envelope sensor — and SCOPE stage 3 is superseded
here.** `docs/SCOPE.md` says the mic is "a **gesture sensor** (loudness/duration/pitch
envelope), never ASR". That was written against a prediction the real-device probe
**reversed** (see PLATFORM-RISKS, "MEASURED ON THE REAL DEVICE"): recognition *works* in the
installed PWA, and the raw microphone is what is broken — permission granted, live track,
**zero samples ever** (WebKit 185448). Envelope analysis is unbuildable because there is
nothing to analyse. `dog/voice.js` is single-shot recognition in the exact proven
configuration (`continuous:false`, `interimResults:false`, `maxAlternatives:1`), triggered
only from an explicit "call him" gesture, never ambient.

**C. `train.apply` runs in `care.apply`'s slot, after `pet.apply`.** Same deviation from §6 as
stage 2's §12.2, same reason; training and care are mutually exclusive so they share the slot.
`toy.apply` is **skipped** while `train.busy` — it rewrites `rig.x/y/s/sy` back to home every
idle frame, which would fight the spin.

```
rig.base -> idle -> pet -> care -> train -> toy -> reunion -> rig.update -> pet.computeZones
```

**D. `BALANCE.train.roster` duplicates the trick id list.** `dog/anim/tricks.js` holds the
specs; `state/game.js` needs the ids to refuse junk trick records without importing the dog
layer into the state layer. The two are checked against each other at module load and throw if
they diverge, so they cannot silently drift.

### 13.2 Interfaces stage 4+ codes against

```js
// dog/train.js
createTraining(rig, { game, pet, idle, rng, reduced, voice, spawn, sound, toast,
                      busyElsewhere }) -> {
  active, modal, busy, weight, hint, listening,
  start(), stop(), update(dt, mood), apply(dt, mood),
  pointer(ev, local) -> consumed, drawFront(g), drawOver(g),
  heard(transcript) -> { kind:'teach'|'name'|'cue'|'unknown'|'nothing', ... },
  callHim() -> bool,                 // opens the mic for ONE utterance
  /* ---- the stage-5 obedience-trial surface ---- */
  perform(id, { judged=true, force }) -> performance|null,
  performance,                       // {trick, asked, state, outcome, correct, latency,
                                     //  reached, held, holdFor, holdKept, rewarded,
                                     //  quality, taught, judged, done}
  onPerform(fn) -> unsubscribe,      // every result as it lands
  chanceOf(id) -> { obey, hesitate, wrong, ignore, level, mood, trust,
                    distraction, expectLatency },
  holdFor(id) -> seconds,
  repertoire() -> [{ id, name, level, word, cue, cueWord, reps, asked, ok,
                     reliability, holdFor, prereq, transient }],  // best first
  roster, trickForCue(sig), cueFor(id), isLearned(id), posture,
  injectSignal(sig, conf), injectGuide(id, extra), injectReward(), cue, debug,
}

// dog/voice.js  — nothing in progression may depend on any of this
createVoice({ onHeard(transcript), onState(state) }) -> {
  supported, state, armed, listening, retired, offline, lastText, lastAt, heard, level,
  arm(on), listen() -> Promise<{ok, transcript, reason}>, abort(), update(dt),
  inject(text), simulate(reason), debug }
normWord(s)   wordSim(a, b)   utteranceSim(transcript, word)
matchWord(transcript, words) -> { sig, sim, second, ambiguous }

// state/game.js  (additive)
trickRecord(id), trick(id), tricks, trickLevel(id), isLearned(id), practised(), known(),
trickRep(id, quality, now) -> { reps, level, leveledUp, weight, damped, freshDay },
bindCue(id, sig, conf), nudgeCueConf(id, delta), forgetCue(id), tricksForCue(sig),
cueFor(id), noteAsk(id, ok), describeTrickLevel(id), describeCueConf(id),
cueVoice, wordFor(sig), spokenCues(), learnWord(sig, word), forgetWord(sig), clearVoice(),
num(v, fallback), clampNum(v, a, b, fallback), sanitiseDog(d)      // exported guards

// dog/anim/tricks.js
TRICKS, TRICK_IDS, TRICK_POSE[id](x, k, u), trickName(id), endPosture(id, was)
```

**What stage 5's obedience trial should use.** `repertoire()` gives what he can be asked for,
best first, with `reliability` (the live `p(obey)`) and `holdFor`, so a judge can pick a fair
trick and set a fair hold. `perform(id, {judged:true})` asks **by id**, bypassing cue
interpretation entirely — the judge says the word out loud, he does not have to read a hand —
and `judged` suppresses the treat, the reward window and the teaching hints so the performance
itself is what is scored. Subscribe with `onPerform`. **`latency` is the stopwatch**: it stops
at `TRICKS[id].poseAt`, the frame the pose actually lands, not when the clip ends. `correct`
is `trick === asked`. `held` / `holdKept` score the hold, and hold length grows with practice
depth (0.55s at level 0 → 3.25s at level 3), which is what research §5 says the trial is
really testing. `outcome` is `'obey'|'hesitate'|'wrong'|'ignore'|'guided'|'came'`.

### 13.3 Schema v3

`SCHEMA_VERSION = 3`, `MIGRATIONS[3]`. Added per dog: `tricks{}` (per trick: `level`, `reps`,
`cue`, `cueConf`, `learnedAt`, `lastAt`, `sessReps`, `sessAt`, `dayAt`, `asked`, `ok`) and
`cueVoice{}` (per signal slot: `{word, alts[], n}`).

`cueVoice` **briefly held a loudness/pitch envelope** during this stage's build, from the
approach that could not work on the device. `save.js`'s `normVoice()` drops any such entry
rather than migrating it — there is no meaningful conversion from an envelope to a word, and
the cost is re-teaching one word of an opt-in extra. Verified: a v1 (stage-1) save loads with
`name='Mochi'`, `affection=0.608`, `trust=0.225`, its `sit` at level 2 with `reps` derived
from `levelAt` and its `cue` preserved; a v2 (stage-2) save keeps its dirt, gloss and bond
ledger, and its legacy envelope is gone. Both then train normally.

### 13.4 Mutator hardening (not local to stage 3)

`engine/draw.js`'s `clamp` is `v < a ? a : (v > b ? b : v)`. **Every comparison against NaN is
false, so clamp passes NaN and `undefined` straight through.** `setMood(undefined)` therefore
wrote `undefined` into mood, and the damage surfaced frames later in the rig, or launches
later out of localStorage — never at the caller. Three layers now:

1. **`state/game.js`** — every numeric mutator runs its arguments through `num` / `clampNum`.
   The policy is **reject, not coerce**: a nonsense delta is a no-op returning the current
   value, because snapping to zero would look like progress being erased. Also fixed:
   `dayIndex(NaN)` returned NaN, and since `NaN !== NaN` the daily bond ledger "rolled over to
   a new day" on *every* call, silently uncapping the day cap the whole anti-grind design
   rests on. `awardDay` threw outright on a numeric `kind`. `trickRecord` now refuses ids
   outside `BALANCE.train.roster`; junk ids used to persist and show up both as rows in the
   cue legend and as askable entries in `repertoire()`, which stage 5 would have performed.
2. **`engine/spring.js`** — the worst instance, and the only one that never recovers. A spring
   is a feedback loop, so one NaN in `x`/`t`/`v` is permanent and **the whole animal
   disappears until relaunch**. `to`/`set`/`kick` reject bad input; `step` **self-heals**,
   turning a fatal bug into a one-frame glitch. `approach()` likewise, since it drives
   `rig.x/y/s`.
3. **`state/time.js`** — `now` / `lastSeenAt` guarded, because `lastSeenAt` is *persisted* and
   would survive the relaunch that should have cleared it.

`sanitiseDog()` runs once per load and repairs a save written by a build without the guards.
Verified by attacking every mutator with `undefined | null | NaN | ±Infinity | 'abc' | {} |
[] | ±999`, then poisoning every spring and `rig.x/y/s` directly: nothing throws, nothing in
state goes non-finite, no spring stays poisoned, and he still performs.

### 13.5 Player-facing copy

Every stage-3 string is in **`COPY` at the top of `dog/train.js`**, and only there. Each is a
function taking `P = game.pron`, so **no pronoun is hardcoded** — the gift puppy is male and a
later dog may not be. `TRICKS[id].hint` in `dog/anim/tricks.js` carries the eight teaching
prompts and is deliberately pronoun-free. The **only** place the microphone is named to the
player is `voiceRow()` in `scenes/room.js`. One pre-existing stage-2 string in `room.js`
(`startTrain`'s "gone after the ball") was pronoun-parameterised in passing; the rest of the
older strings are being swept separately.

### 13.6 Measured

Headless Chromium, 390x844, `--enable-gpu`. DPR capped at 2.25 by design.

| | work median | work p95 | work max | rAF median | rAF p95 |
|---|---|---|---|---|---|
| DPR 2, idle | 2.1ms | 3.9ms | 4.8ms | 16.7ms | 16.7ms |
| DPR 2, training, waiting | 1.9ms | 3.3ms | 4.1ms | 16.7ms | 16.7ms |
| DPR 2, mid-spin (heaviest) | 1.7ms | 3.2ms | 4.2ms | 16.7ms | 16.8ms |
| DPR 3→2.25, idle | 1.9ms | 3.7ms | 4.6ms | 16.7ms | 16.7ms |
| DPR 3→2.25, training, waiting | 1.7ms | 3.2ms | 4.2ms | 16.7ms | 16.7ms |
| DPR 3→2.25, mid-spin (heaviest) | 2.1ms | 3.8ms | 6.1ms | 16.7ms | 16.8ms |

Vsync-locked at 60fps throughout, ~8x headroom. Stage 3 costs roughly nothing over stage 2.

**Learning**, mood 0.85 / trust 0.7, `sit`, quality-weighted reps (`levelAt = [3, 5, 8]`):

| | rep 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| across sessions | 1.25 | 2.50 | **3.75 → knows it** | 5.00 *steady* | 6.25 |
| crammed in one sitting | 1.25 | 2.25 | 2.60 | 2.95 | **3.30 → knows it** |

**3 reps spread across sessions, 5 if you cram.** Reliability rises 0.561 → 0.693 → 0.807 →
0.923 and hold length 0.55s → 1.45s → 2.35s → 3.25s.

**Mis-association**, 40 lessons per condition: **5%** with a crisp signal, a happy bonded dog
and an instant treat; **48%** with a sloppy signal, flat mood, no trust and a late treat
(`confuse.max` is 0.44). It always mis-files onto a trick he *already knows*, never noise.
Recovered in **3 patient correct reps** (`recover.perRep` 0.12, `clearAt` 0.14).

**Obedience gating**, `sit` at level 2, 120 asks per condition:

| condition | mood | trust | model p(obey) | obeyed | hesitated | wrong | ignored | median latency |
|---|---|---|---|---|---|---|---|---|
| flat mood, no trust | 0.05 | 0.02 | 0.467 | 59/120 | 17 | 13 | 31 | 1.60s |
| low | 0.25 | 0.15 | 0.555 | 69/120 | 19 | 7 | 25 | 1.48s |
| middling | 0.55 | 0.45 | 0.706 | 79/120 | 14 | 10 | 17 | 1.32s |
| happy + bonded | 0.95 | 0.90 | 0.913 | 109/120 | 7 | 3 | 1 | 1.10s |

Gated on `game.moodLevel` and `dog.trust`. **Control:** moving affection 0.10 → 0.99 at fixed
mood/trust leaves `p(obey)` at 0.7055 — identical, so affection provably does not leak in.
Distraction subtracts: content 0.896 → famished 0.776.

**Come-when-called** (his name, heard): 48/60 at mood 0.95 / trust 0.85 (`p` 0.858) vs 16/60
at mood 0.05 / trust 0.02 (`p` 0.228). Recognition accuracy appears nowhere in that roll.

**Tap-only**: all **8/8** guide gestures are recognised and performed from a real synthesised
pointer path, from the posture each requires, with voice fully off.

### 13.7 Not built in stage 3

Advanced trick *compositions* (research §5's "component tricks performed immediately after one
another") — the roster is eight standalone tricks, and the composition timing window is a
stage-5 question if the trial wants it. A per-dog trick cap (research suggests ~8; the roster
is exactly 8, so it does not bind yet). Real audio: `audio.pending` now also owes `cue`,
`trick-*`, `trick-done`, `sit-thump`, `flop`, `paw-offer`, `land`, `praise`, `whine`.

---

## 14. Stage 4 (Walks + discovery) — as built

Four beats, **not one frame of gait**. `anticipation -> absence -> return`, exactly as
SCOPE.md reframed it. The near-frontal rig was never extended, no side profile was built, and
depth on the return is scale (§12.6) as it is for the reunion and the toy chase.

### 14.1 Contract deviations

**1. There is no `scenes/walk.js`. The walk lives in the room.**
§2's file layout implies a walk scene. Three of the four beats *are* the room — prepare is him
going electric in front of the same rig, absence is this room with him missing, and the return
is him coming back into it. Unmounting the room would throw away the rig, the baked room
canvas and the continuity between the beats, and would buy nothing: only the map is a
full-surface overlay, and it is one. `dog/walk.js` is a LAYER, like `dog/train.js`.

**2. `walk.apply()` runs in the care/train slot, and `toy.apply` is skipped while it owns
the animal.** Prepare and return own the body the way a care action does. Same precedent and
same reason as stage 3 skipping `toy.apply` during a spin (§12.2).

**3. THE SURFACE IS EXCLUSIVE, and that is new shared machinery in `scenes/room.js`.**
A defect got through without it: `startWalk()` guarded toy, care and training but not the
NAMING beat, so on a fresh save the leash-drop anticipation played *underneath* "He's yours."
— two modal states stacked, on first launch.

The fix is `surfaceOwner()` / `surfaceBlockedFor()`: one arbiter, consulted by every modal
start, in **both** directions. A first draft gave the layers a precedence order so important
beats could displace lesser ones; that table immediately grew the hole it was meant to close
(naming outranked the walk, so renaming from Settings while he was out opened the overlay over
the absence panel — measured failing, then deleted). **Nothing displaces anything.** A beat
that still wants to happen is queued via `pendingNaming` and drains when the surface frees.

Stage 5 MUST route contest entry through `surfaceBlockedFor('contest')` rather than adding
another private `if`. That is the whole point of it existing.

**4. `src/ui/text.js` is new, and it is not local to stage 4.**
Three legibility failures shipped on this project, all the same failure: canvas text drawn
straight over background art with no contrast guarantee and no safe-area awareness. Measured,
the stage-4 anticipation line was **1.22:1** against the cream wall (WCAG AA is 4.5:1). A drop
shadow — the previous mitigation, twice — is a *hope* that the art behind is light.

`ui/text.js` makes the contrast a guarantee by construction: given an ink and a plate colour
it **solves** for the smallest plate alpha at which the ink clears the target against the
WORST POSSIBLE background. Because luminance is monotonic per channel, pure black and pure
white showing through the plate are genuinely the extremes, so clearing both clears everything
— including art nobody has drawn yet, a dark-mode phone, or a scrim another layer adds later.
Cream `#fff0d4` on the standard dark plate solves to alpha 0.625 and delivers **4.58:1**.

It also converts `env(safe-area-inset-*)` (already in `view.safe`) into virtual units and
anchors copy to the safe edge, and shrinks type to fit rather than letting it clip.

`over` is the escape hatch: a caller that has already drawn an opaque card says so, the
contrast is checked against that colour exactly, and **no plate is added** — which is how the
route map keeps its hand-drawn paper. A translucent ink is composited over the known
background before measuring, because `rgba(107,58,36,0.66)` on the map paper is truly 4.58:1,
not the 7.61:1 its nominal colour claims.

Retrofitted beyond stage 4: stage 3's **cue legend** (via `drawPlate`, one plate under a block
that interleaves drawn glyphs with two text columns) and its **hint line**, and the **naming
title**. Tunables in `BALANCE.ui.text`; raising `contrast` there really does make everything
more legible rather than just darker.

**HONEST LIMIT:** the guarantee is defined at the text's full opacity. Text mid-fade is
unavoidably low-contrast — contrast against a background you are dissolving into is not a
thing that exists. `fade` is for transitions, never as a style.

**5. `walksToday` is not trusted across the v3->v4 bump.** It belonged to a day index that was
never recorded, so it is stamped with today rather than counting an old day's walks against
this one. Worst case is one extra walk on update day, which is a gift, not a loss.

### 14.2 Interfaces stage 5 codes against

Stage 5 spends what stage 4 produces. All of it is already persisted and migrated.

- `game.state.player.coins` — **the currency.** Paid by `game.addCoins(n)` on every return;
  route-biased (high street ~17/walk, river ~9). Stage 5 needs a `spendCoins(n)` that refuses
  to go negative; it does not exist yet and should live beside `addCoins` in `state/game.js`.
- `game.findCollection()` -> `Set` of find ids ever brought home. Drawn on the window sill by
  `room.js drawSill()`. `BALANCE.walk.finds` is the table: `{id, kind, tier, w, toy, met}`,
  where `kind` is `flower|toy|keep|gift|photo`.
- `state.inventory.toys` / `state.inventory.activeToy` — a `toy` find joins `toys` and becomes
  the toy on the rug. A shop that sells toys must push here and respect `activeToy`.
- `state.unlocks.items` — the authoritative collected set (`walks.found` is the dated log,
  capped at `BALANCE.walk.find.logCap`).
- `game.walkProgress(now)` -> `{active, progress, remainMs, done, skewMs, clamped}`. **The
  only progress function.** A contest that runs over wall-clock time should copy this shape
  rather than inventing a timer: nothing ticks, and that is why a walk survives being killed.
- `state/walks.js rollFinds(active, progress, {owned})` — deterministic from the seed. A
  contest reward roll should take the same shape so it is replay-safe.
- `walk.onHome(cb)` — fires when a return has landed; `cb({after, carried})`.
- `game.awardDay(kind)` — the once-a-day bond ledger. Stage 5 must award through it, not by
  writing affection.

Test drivers on `window.__pp`: `walk`, `fizz`, `waggle`, `clip`, `route`, `drawRoute`,
`setOff`, `fakeWalkAway`, `fakeClockBack`, `bringHome`, `runHome`, `peekFinds`, `walkState`,
`surface`, `openNaming`. **`fakeWalkAway`/`fakeClockBack` now call `saver.schedule()`**: they
write `state` directly, so `onChange` never fires and a following `saveNow()` was a silent
no-op — which made a reload test pass for the wrong reason until it was caught.

### 14.3 Measured (headless Chromium, 390x844, `--enable-gpu`)

Safe-area insets forced to the target device's **20px top / 40px bottom**.

| beat | DPR | work median | work p95 | work max | frame median |
|---|---|---|---|---|---|
| prepare (busiest) | 2 | 1.9 ms | 4.0 ms | 5.3 ms | 16.7 ms |
| prepare (busiest) | 3 | 2.3 ms | 5.3 ms | 6.6 ms | 16.7 ms |
| absence | 2 | 1.1 ms | 2.8 ms | 3.7 ms | 16.7 ms |
| absence | 3 | 1.5 ms | 2.8 ms | 6.4 ms | 16.7 ms |

Solid 60fps throughout. Zero console errors, zero external requests, verified in **dark mode**
and with `prefers-reduced-motion: reduce`.

Gates: a walk survives the page being **closed outright** and reopened (mid-walk, progress
0.511 derived from the wall clock; and after nine hours shut, where he is simply home with
what he found). Same seed -> identical finds across a full restart. A backwards clock is
absorbed, and a poisoned walk record is repaired rather than fatal. Stage-1/2/3 saves each
migrate and can start a walk afterwards. Discovery is route-biased over N=4000 walks/route
with zero empty-handed returns. See `docs/STAGE4-NOTES.md` for the numbers.

### 14.4 Not built in stage 4

The **route-map paper is positioned in fixed virtual space**, not anchored to the safe area —
acceptable because its top edge sits 70 virtual units down, well clear of a 20px inset, but a
smaller device would want it anchored. The **back/cancel buttons** (`BALANCE.ui.map.back`,
and training's at `342,62`) are tap targets rather than text and still use hard coordinates;
they clear the 20px inset but are not derived from it, and the hit tests would have to move
with them. `ui/toast.js`, `ui/sheet.js`, `ui/hud.js` and `ui/nav.js` were **not yet routed
through `ui/text.js`** — the toast was the most visible of these. **Stage 5 finished all
four; see §15.7.** There are now zero `fillText` calls outside `ui/text.js`. Real audio: `audio.pending` now also owes `perk`, `scamper`, `toy-land`,
`proud-yip`. No walk *history* screen — `walks.found` is a dated log nothing reads yet.

---

## 15. Stage 5 (Contests + economy) — as built

The **Obedience Trial**, scored 0.00–10.00 to two decimals, judged on performance *and*
grooming. **Disc was not built** and **Agility is cut** — the human's instruction partway
through was explicit that depth on Obedience beats breadth, and the game is now being held
back until it is gift-ready rather than shown early. If a later stage wants Disc, SCOPE.md
§"Disc — reframed as catch-and-leap" is still the design; nothing here blocks it.

### 15.1 Contract deviations

**1. There is no `scenes/contest.js`. The trial lives in the room.**
Fourth time, same reason (§13.1 A, §14.1 1): it is him, on this rig, in this room, with the
same springs and the same petting field. Research §6.3 calls a near-frontal camera a "perfect
fit" for a dog performing at a judge, so there is nothing to reframe. The room is *dressed* as
a ring instead — cooled and dimmed, a spotlight drawn **under** him (so the room dims and he
does not, which is what a spotlight actually is), a mat on the rug, a judge's board. That is a
contest for the cost of four gradients. `dog/contest.js` is a LAYER, and `contest.apply()`
runs in the care/train/walk slot.

**2. `BREEDS[x].aptitude` IS NO LONGER READ TO CREATE A DOG. This overrides §4.**
§4 said aptitude is "rolled at adopt from breed + jitter". SCOPE.md stage 5 drops the breed
term, and the reason is specific rather than aesthetic: the gift puppy is a Schnoodle and the
Cockapoo is the saving-up reward, so if either were a mechanically worse obedience dog the
game would have told her that her favourite dog is the wrong dog.

`newDog` now rolls `0.5 + jitter`. `state/game.js` **no longer imports `dog/breeds.js` at
all** — the state layer's only knowledge of breed is an id it stores. The one remaining read
of `breed.aptitude` in the codebase is in `state/save.js`, and it exists purely to *undo* the
term: `MIGRATIONS[5]` **re-centres** rather than re-rolls,

```
new = clamp(0.5 + (old - breed.aptitude[k]), 0, 1)
```

which recovers exactly the individual's jitter and discards exactly the breed bias. Verified
on all four legacy shapes: `{disc 0.60, agility 0.66, obedience 0.34}` →
`{0.55, 0.44, 0.44}`. Per-*dog* variation is kept and is worth at most ±0.12 of a
0.10-weighted term in the obedience roll and ±0.12 of ten points in a score
(`BALANCE.contest.poise`). It can flavour a dog; it can never decide a class.

**3. `startCare` and `startTrain` now go through `surfaceBlockedFor()` too.**
Stage 4 built the arbiter but only routed `startWalk` and `openNaming` through it; care and
training kept private `if (naming.active) … if (walk.busy) …` guards. That is why neither of
them knew the ring existed until one line was added to each. `blockedToast(owner)` is the
single place a refusal is spoken, and it is deliberately **silent** for `naming` and
`reunion` — a toast over the one moment that must have no chrome is worse than saying nothing,
which is the precedent stage 4 set in `startWalk`. `surfaceOwner()` gained `'contest'`, and
that one line is what makes the guard work in *both* directions.

**4. Three additions to stage 3's published surface (§13.2).** All additive.
- `perform(id, { boost, hurry, hold })`. `boost` (0..0.6) is the steadying cue: it shifts
  probability out of the three failure outcomes into obeying, **in proportion**, so only how
  *often* he fails moves and not the shape of how he fails. `hurry` takes seconds off the
  latency roll, floored at 0.18s so an answer never becomes instant. `hold` overrides the pose
  hold; a contest passes `min(holdFor(id), asked)` so a round never drags when the judge asks
  for less than he has.
- `onPerform` results now carry **`chain`** (the posture chain as asked), plus `holdFor` and
  `holdKept`. `chain` is load-bearing — see 15.4 defect 2.
- `classifyPath(g, sinceTap)` and `createSignalReader()` are **exported from `dog/train.js`**.
  The gesture recogniser was lifted out of `createTraining` so the ring can read a cue without
  the training UI being up. A second recogniser in `dog/contest.js` would have been two
  definitions of what a circle is, which is the class of drift this project has already paid
  for once (`BALANCE.train.roster` vs `dog/anim/tricks.js`).

**5. `player.trainerPoints` is renamed `player.carePoints`, and the currency is now earned.**
"Trainer points" described the wrong thing — they are not earned by training, they are earned
by looking after him. Nothing had ever paid any out, so in practice this renamed a zero, but a
hand-edited or imported save may carry one and `MIGRATIONS[5]` moves the value across.
`addTrainerPoints` survives as a documented alias so §11.2's published surface still holds.

**6. `contests.agility` is deleted from the save.** Agility is cut, and a dead key in a save
file is a promise to build it. `contests.disc` stays: it is reframed, not cut.

**7. No active-trial record is persisted, on purpose.** A walk survives the app being killed
because absence *is* the mechanic (§14.1). A trial is 45–90 seconds of her actually watching
him, and resuming one from a cold start would be strange. So **an abandoned trial costs
nothing** — the entry is only counted when the trial finishes, she can never lose an entry to
a crash or a phone call or changing her mind, and there is no trial state to migrate.

### 15.2 The trial, and what she does in it

Judge calls a trick out loud → a **call beat** (`beats.call`, which *is* the assist window) in
which she may back him up with the signal she taught → `perform(id, {judged:true})` asks **by
id**, bypassing cue interpretation because the judge said the word → `onPerform` delivers what
is scored → the round is marked 0..1.

Programme by class: `call` / `hold` / `seq` / `free`, from `BALANCE.contest.programme`.
The **free window** is the one real decision in a trial and it is hers: up to four chips,
deepest first, and the deeper the trick the more the same execution is worth. Tapping a chip
both chooses and counts as the cue — asking for the shape twice would be bookkeeping. Letting
the window lapse is never a fail state: the judge nods him on and he does his best thing.

**She may not touch him.** In the original that was the point — it was the true test of
whether the training had worked. Honoured literally: a touch on him is absorbed and gets one
warm line, once (verified: `pet.level` stays 0.000). What is **not** forbidden is *tapping* —
SCOPE.md is explicit that "what's forbidden during a trial is petting him through it, not
tapping" — which is why the cue pad exists and why voice is an equal-status extra rather than
a requirement. A hands-off trial is winnable: 11/12 firsts at Expert unassisted against 12/12
assisted, so assisting is worth about 0.60 points and never more than a courtesy.

`scenes/room.js` routes a heard word to `contest.heard` while the ring owns the surface,
instead of `train.heard` — the latter would try to teach or ask and start a second performance
on top of the judged one.

### 15.3 Scoring

```
score = performance01 * perfSpan + groomDelta + poiseDelta      clamped 0..10, 2 dp
```

`perfSpan` is **9.40, not 10**, and that is the whole design: a flawless run on a *Normal*
coat lands at 9.40, so the last 0.60 has to come from grooming, and **>9.60 — the
Championship win — is arithmetically unreachable on a dirty dog however well he performs.**
That is the stage-2 care loop earning its place, in one number.

`groomDelta` is a **signed** delta around a Normal coat, and its thresholds mirror
`BALANCE.inspect` exactly so the word the judge says and the mark he gives can never disagree.
Range **+0.75 (Beautiful + Gleaming) to −1.20 (Filthy + Dull)** — a 1.95-point swing, more
than a whole class of the ladder.

The **hold** round is where practice depth becomes the ladder: the judge's asked duration
belongs to the **class**, not to the dog (a standard is a standard), and `holdFor` runs
0.55 → 1.45 → 2.35 → 3.25s. So a level-1 trick comfortably meets Open's 1.40s and manages
0.468 of the Championship's 3.10s. Scoring reads `held / asked` and **not** `holdKept` —
that flag means "he held it as long as *he* can", which would award full marks to a dog who
managed 0.55s of a 3.10s hold, i.e. exactly the thing the round exists to measure.

`state/contest.js` is **pure**: no drawing, no ticking, and it does not import the dog layer
(clip durations come from `BALANCE.train.clip`, keeping the same state/dog separation
`state/walks.js` keeps). That is what makes a clean and a filthy dog at identical performance
comparable with zero noise, and what makes a 70-trial sweep practical.

### 15.4 Defects found by driving it, and what they cost

**1. Every drawn cue was swallowed as "hands off".** `injectCue` passed the whole time; the
*pointer path* failed. The hands-off test was a box copied from training's `halo`
(`|lx| < 118 && ly > -330`) — which is deliberately generous because it means "her personal
space", not "her body" — and the cue pad's centre resolves to rig-local **y = −321.6**, inside
it. Replaced with `pet.hitZone(lx, ly)`, the same per-zone test the petting field uses, so
"she touched him" now means precisely that; the pad could then widen from 150–400 to 108–470.
**Only driving a real synthesised gesture caught this.**

**2. A trick with a posture prerequisite could never score speed marks.** `perf.latency` runs
from the start of the performance, and `chainFor` makes him sit and then lie down before he can
roll over — so a roll over arrived at 3.5–5.2s against `mark.slow` = 2.90 and scored **zero
speed marks, every single time**, purely for being a trick with a prerequisite. Every free
round capped at 0.645 for that reason alone, and the free window is exactly where deep tricks
are supposed to pay. `train.js` now reports the chain and `chainPar()` allows for it, because a
judge does not penalise a dog for lying down first. Free rounds went 0.645 → 0.906.

**3. His mood collapsed over the course of a trial.** Mood decays toward a baseline that a
fresh dog's low affection puts at ~0.16, at 0.085/s. Measured over a Championship programme:
**0.95 at the first call, ~0.25 by the last** — so the trial got harder as it went, the free
window suffered most, and she cannot cheer him up because petting is the one thing a trial
forbids. `holdMood` now holds him at the level she brought him in with and **never above it**,
so a flat dog still has a flat trial and the gate still gates; what it stops is the trial being
a war of attrition against its own length.

**4. `spendCoins(null)` handed the item over for free.** `ok()` coerces before testing, so
`+null` and `+''` are a finite 0 and the `cost === 0` early-return reported success. Money is
the one field where a coercion is worse than a refusal, so `spendCoins` is **stricter than the
rest of the file**: it demands a real `number` and rejects everything else.

**5. Layout.** The entry button was placed at a hard `y: 686` and floated over his paws with
its label unreadable against his coat; the panel covered his face. The button is now derived
from the panel (`enterBox()` — one expression for the draw *and* the hit test) and the panel
moved clear of his head. Both found by cropping in, neither visible in a whole-screen render.

**6. `node --check` is not enough.** It parses `.js` as a script, and two real boot failures
only surface in module mode: prose left outside a `/* */` (reported as "Unexpected template
string") and `makeSprings` throwing on names missing from `BALANCE.springs`. Copying
`src/**/*.js` to `.mjs` and checking those is the pre-flight now.

### 15.5 Schema v5

`SCHEMA_VERSION = 5`, `MIGRATIONS[5]`. Three changes: the aptitude re-centring (15.1 §2),
`trainerPoints` → `carePoints` plus a fresh `player.careDay` ledger, and `contests` reshaped
for the ladder with `agility` dropped. `contestState()` repairs and day-rolls the obedience
record on **every read**, exactly as `walkState` does, and `fillDefaults` calls it plus guards
`player.coins` / `player.carePoints` — a NaN in `carePoints` would silently lock or unlock
every breed in the game.

Verified individually, **63/63 checks, zero page errors**: v1, v2, v3 and v4 each reach v5,
keep the dog and the name and the bond (the ratchet is the invariant, not the raw number —
stage 2's capped "missed you" dip legitimately moves 0.610 → 0.604), keep coins, carry the
points across, drop agility, repair the obedience record into the Beginner class, keep the
trick ledger and the dirt and gloss and the found items and the active toy — **and can enter
and finish a trial afterwards**. That last check initially failed because the *reunion* owned
the surface after a 600-day absence, which is the arbiter working rather than a bug.

### 15.6 Interfaces stage 6 codes against

Stage 6 builds the shop and the kennel. Everything it needs is here and persisted.

```js
// state/game.js — THE ECONOMY
get coins                      // integer, never negative, never NaN
addCoins(n)
spendCoins(n) -> { ok, coins, spent, short }   // `short` = how much is missing,
                                               // so a shop says "82 more", not "no"
canAfford(n) -> bool                           // pure; writes nothing

get carePoints                 // the ONLY thing that unlocks content
addCarePoints(n)               // raw; migrations and tests only
awardCare(kind, now?) -> paid  // through the daily ledger + cap
careLedger(now?) / get careToday
careUnlocks() -> { points, unlocked:[{id,kind,at,name}], next:{...,short}, word }
isUnlocked(id) -> bool         // reads carePoints and NOTHING ELSE
describeCare() -> word

// state/game.js — CONTESTS
get contest                    // the repaired, day-rolled obedience record
contestClass() -> { id, name, index, top, hold, prize, rival, entries, wins,
                    best, won, standing:{avg, holding, n, need} }
get contestEntriesLeft
recordContest({score, placing, prize, practice, promoted, won}, now)

// state/contest.js — the pure model
CLASSES / CLASS_IDS / CLASS_BY_ID / classAt(i) / classIndex(id) / isTop(i)
contestState(state, now?)      // repair + day roll; call on every read
entryCheck(game, {knows, now}) -> { ok, reason, need, practice }
buildProgramme(classId, repertoire, rng) -> rounds     // deterministic from a seed
askedHold(classId) / chainPar(ids) / depthOf(id, lv) / freeMul(id, lv)
markAsk(result, {hold, par}) / markRound(round, results) / performance(rounds, marks)
groomDelta(cleanliness, gloss) / poiseDelta(aptitude)
finalScore({performance, cleanliness, gloss, aptitude}) -> 0.00..10.00
scoreBreakdown(...) -> { performance, perfPoints, groom, poise, total }
rollRivals(classId, rng, field) / placeIn(score, rivals) / promotes(placing)
prizeFor(classId, placing) / champStanding(scores) / winsChampionship(score)
ladderDays(pPlace, perDay) -> { promotions, entriesExpected, days }

// dog/contest.js
createContest(rig, { game, pet, idle, train, voice, rng, reduced,
                     spawn, sound, toast, onNeed }) -> {
  active, modal, busy, owns, beat, phase, weight, hint, listening, COPY,
  start(), stop(quiet?), update(dt, mood), apply(dt, mood),
  pointer(ev, local) -> consumed, heard(text), listen(),
  drawBack(g), drawFront(g), drawOver(g),
  enterRing(), asking(), choices(), choose(id), injectCue(sig), check(),
  result, debug }

// dog/train.js  (additive to §13.2)
perform(id, { judged, force, boost, hurry, hold })
classifyPath(g, sinceTap) / createSignalReader() -> { tick, down, move, up, cancel }
```

**THE THING STAGE 6 MUST NOT DO.** Do not sell an unlock for coins, and do not add
`spendCarePoints` or any exchange between the two currencies. The separation is the strongest
structural idea in the original (research §7) and it is what gives the care loop teeth without
turning it into a bill: **sell OBJECTS for coins; gate CONTENT on care points.** It is enforced
today only by there being no code to break it — `careUnlocks()` and `isUnlocked()` do not
mention `coins`, and nothing converts either way. Verified: 10,000,000 coins unlocks nothing
and leaves the Cockapoo locked; 400 care points unlocks it. A finished trial moves coins and
**zero** care points (`BALANCE.economy.care.contest` is literally `0`).

`BALANCE.economy.unlocks` is the table stage 6 should read, with `kind` naming which surface
owns each row (`decor` / `breed` / `stock` / `room`). The Cockapoo sits at 400, which an
attentive day of ~205 care points reaches on day 2–3.

Test drivers on `window.__pp`: `ring`, `ringCheck`, `enterRing`, `asking`, `choices`,
`cueRing`, `cueDraw`, `chooseFree`, `runTrial`, `ringState`, `purse`, `coins`, `addCoins`,
`spendCoins`, `canAfford`, `carePoints`, `addCarePoints`, `awardCare`, `isUnlocked`,
`careUnlocks`, `setClass`, `setCoat`, `setNeed`, `learn`, `learnAll`.
`__pp.version` is `5`.

### 15.7 `ui/text.js` retrofit finished

`ui/toast.js`, `ui/hud.js`, `ui/nav.js` and `ui/sheet.js` are now routed through the helper.
**Every one of them has zero `fillText` calls; `ui/text.js` is the only place canvas text is
drawn in the game.** The toast was the one stage 4 named — it drew `#ffeccd` at
`globalAlpha 0.88` over a pill whose alpha somebody had liked the look of, and measured its own
width so long copy could run off a narrow screen. The hud's **hint line** was the real defect:
bare cream over whatever art was behind, with a drop shadow standing in for a guarantee.

Measured with `auditContrast` / `inkFor`, every ink stage 5 draws:

| what | mode | plate alpha | ratio |
|---|---|---|---|
| the standard ink (toast, hint, ring hint) | solved plate | 0.625 | **4.58** |
| button label on the ribbon red | over | — | 4.72 |
| button label on the teal "do this first" | over | — | 4.91 |
| card ink on the result / entry card | over | — | 10.28 |
| nav label on its pill | over | — | 8.98 |
| sheet row ink | over | — | 9.08 |
| hud name pill + needs panel | over | — | 9.15 |
| judge board — the class line | over | — | 7.56 |
| judge board — THE CALL | over | — | 13.26 |
| card secondary lines | over | — | 5.51 |
| a NEGATIVE grooming line | over | — | 5.04 |
| a POSITIVE grooming line | over | — | 4.68 |

**Worst ratio anywhere: 4.58** against a 4.5 target. All pass.

### 15.8 Measured

Headless Chromium, 390x844, `--enable-gpu`, safe insets forced to the target device's
20px top / 40px bottom. DPR capped at 2.25 by design.

| beat | DPR | work median | work p95 | work max | rAF median | rAF p95 |
|---|---|---|---|---|---|---|
| room idle | 2 | 3.0 ms | 4.9 ms | 5.6 ms | 16.70 | 16.70 |
| ring: entry panel | 2 | 1.8 ms | 2.8 ms | 3.0 ms | 16.70 | 16.70 |
| ring: mid-trial (Championship) | 2 | 2.0 ms | 2.8 ms | 3.5 ms | 16.70 | 16.80 |
| ring: free-window chips | 2 | 1.6 ms | 2.4 ms | 3.3 ms | 16.70 | 16.80 |
| ring: result card | 2 | 2.0 ms | 2.8 ms | 3.2 ms | 16.70 | 16.80 |
| room idle | 3 | 1.9 ms | 3.1 ms | 3.6 ms | 16.70 | 16.80 |
| ring: entry panel | 3 | 1.8 ms | 2.5 ms | 5.3 ms | 16.70 | 16.70 |
| ring: mid-trial (Championship) | 3 | 1.9 ms | 2.7 ms | 5.5 ms | 16.70 | 16.80 |
| ring: free-window chips | 3 | 2.2 ms | 4.3 ms | 4.6 ms | 16.70 | 16.80 |
| ring: result card | 3 | 2.2 ms | 5.9 ms | 17.8 ms | 16.70 | 16.70 |

**Worst rAF p95 across every beat: 16.80 ms — vsync-locked at 60fps throughout**, with
roughly 6x headroom. The one 17.8 ms work spike is a single frame at DPR 3 as the result card
first measures its type and fills the width cache; no frame was dropped for it (rAF p95 stayed
at 16.70). Stage 5 costs about nothing over stage 4.

Zero console errors and **zero external requests** in every run, in light and dark, at normal
and `prefers-reduced-motion: reduce` — a whole trial completes and scores in all four
combinations.

**Scoring, the headline.** Identical performance, different coat (gloss Normal):

| performance | Beautiful | Clean | Normal | Dirty | Filthy | swing |
|---|---|---|---|---|---|---|
| 1.00 | **10.00** | 9.70 | 9.40 | 8.85 | **8.30** | 1.70 |
| 0.95 | **9.53** | 9.23 | 8.93 | 8.38 | **7.83** | 1.70 |
| 0.85 | 8.59 | 8.29 | 7.99 | 7.44 | 6.89 | 1.70 |

Live, 12 real trials per condition at Expert: clean+gleaming **9.72 mean, 12/12 firsts**;
FILTHY+dull **6.50 mean, 0/12 firsts** (a 3.22 swing — 1.70 is the grooming mark, the rest is
a filthy dog also being a *distracted* one, since `pressingNeed()` feeds
`train.obey.distract.need`); flat mood **6.67, 3/12**; level 1 instead of 2 **8.27, 6/12**;
hands off **9.12, 11/12**. Free window at Championship: `sit` → 9.16 mean and 5/10 firsts,
`rollOver` → 9.89 and 9/10. Her choice in the free window is worth four places.

**The ladder.** Four promotions at a top-three placing, three entries a day:

| p(top-three per entry) | entries expected | days to the Championship |
|---|---|---|
| 0.50 | 8.00 | **2.67** |
| 0.75 | 5.33 | 1.78 |

**Days, not months**, against the original's 50,000 trainer points at 200/day. An attentive
day earns ~205 care points against a 240 cap, so the unlock ladder is 90 → day 1,
220 → day 2, **the Cockapoo at 400 → day 2–3**, 1600 → day ~8.

Full numbers, including the per-round marks and the hold ladder, in `docs/STAGE5-NOTES.md`.

### 15.9 Not built in stage 5

- **Disc (catch-and-leap) is not built.** Deliberate: the instruction was depth over breadth,
  and Obedience got the whole budget. SCOPE.md's design for it still stands.
- **Agility is cut and must not be built.**
- **No rival dog is ever drawn.** The field is four numbers and a name each, which is enough
  for a placing to mean something and costs nothing. If a later stage wants to *show* them it
  needs a second rig, and that is the thing this project has consistently refused.
- **The Championship standing is a standing, not a rank she can lose.** There is no demotion
  at any score, by design (SCOPE: losing must never feel like rebuke). `champStanding()`
  reports `holding: false` and the card says something warm about him; nothing is taken away.
- **`BALANCE.economy.unlocks` is a table nothing consumes yet.** `careUnlocks()` returns it
  and `isUnlocked()` answers for it, but no shop, kennel or decor surface exists to read them
  — that is stage 6's job, and the rows carry a `kind` so it knows which surface owns each.
- **A trial charges no needs at all**, unlike every other activity. Deliberate: the entry gate
  already requires a fed and watered dog, so charging thirst would gate the second trial of the
  day behind the first. That is a punishment loop.
- **The ring's `back` button and the free-window chips use fixed virtual coordinates**, the
  same honest limit stage 4 recorded for the route map. They clear a 20px inset but are not
  derived from it. The panel and card *are* derived from their own geometry, and all their
  copy goes through `ui/text.js`, which anchors to the safe band.
- Real audio: `audio.pending` now also owes the ring's `perk`, `cue`, `praise` and
  `proud-yip` uses (all names stage 3 already registered).

---

## 16. Stage 7 (PWA + sound) — as built

Stage 7 clears **four of the eight gift blockers**: 1.2 (progress cannot be silently
deleted), 1.3 (installable, with an honest reason), 1.4 (sound exists) and 1.5 (works fully
offline). This section is **authoritative** where it differs from anything above.

### 16.1 Contract deviations

**1. `engine/sfx.js` is a new file, and `engine/audio.js` is now only policy.**
§2's file layout lists `audio.js` alone. It is split because the two halves are different
kinds of thing: `audio.js` is *plumbing and policy* (the graph, the gesture unlock, the
toggle, the throttle, the polyphony cap), and `sfx.js` is the **bank** — 43 synth recipes plus
the family resolvers, which is closer to art data than to engine code. Keeping them together
made one 900-line file in which the one genuinely dangerous part (the unlock) was buried.
Both are precached.

**2. The synth frequencies are ART DATA and live in `engine/sfx.js`, not `balance.js`.**
This is the same call §11.1(G) made for colour ramps in `dog/breeds.js` and marking geometry
in `dog/draw.js`. `BALANCE.audio` holds every number a *designer* would turn — master volume,
the per-name retrigger floors, the per-family gain trims, how far apart two dogs' voices can
sit, the panting cadence, the limiter. The bandpass centre frequencies and envelope shapes are
in the recipes, because nobody adjusts a formant from a spreadsheet and moving ~200 of them
into `balance.js` would make that file unreadable without making anything tunable.

**3. `createAudio` takes a second argument. Additive; §11.2's published surface still holds.**
`createAudio(settings, { getDogId })`. Passing a *getter* rather than an id is deliberate:
stage 6's kennel will switch the active dog, and the voice must switch with it.

**4. There is NO `SCHEMA_VERSION` bump. `SCHEMA_VERSION` stays 5.**
Nothing stage 7 added is a new *required* field:
- **His voice is derived, not stored.** `voiceFor(dog.id)` hashes the already-persisted id, so
  the voice costs zero save bytes, is identical in every session for ever, and travels
  correctly with an exported/imported save.
- **The install card's state is three keys in `flags`** (`installShown`, `installAskedAt`,
  `installNever`) plus one (`launches`) written by the room. `flags` is a free-form dict that
  `fillDefaults` already merges forward, so a v1–v5 save gains them by default on load and an
  older build reading a newer save simply ignores them. A bump with an empty migration would
  have been ceremony.
- `settings.sound` already existed and was already persisted and defaulted.

Verified: v1, v2, v3, v4 and v5 all still load, migrate, keep the dog / name / ratchet / coins
/ trick ledger, drop `agility`, get a voice, make a sound, register the worker, and can still
be petted. **42/42 checks.**

**5. The install card is a SURFACE, and it is in `surfaceOwner()`.**
Routed through `surfaceBlockedFor()` exactly as §14.1 requires, and placed **last** in the
owner list so it is the least important thing on screen and can never displace a beat. Being
in the list is what makes the guard work in both directions: the naming beat, the reunion, the
walk, care, training and the trial all refuse to open over it without a line being added to
any of them. Measured: during the reunion the card reports `eligible: false`,
`blockedBy: 'reunion'`.

**6. `main.js` gained a lifecycle section and an unlock RETRY.**
`input.onFirstGesture` alone was not enough — see 16.4. A capture-phase `pointerdown` /
`touchend` pair on `window` re-attempts the unlock until `ctx.state` is genuinely `running`,
then removes itself.

**7. `main.js` makes exactly one network request at runtime, and it is same-origin.**
`reg.update()` on foreground, throttled to once every four hours, to notice a deploy while an
installed PWA sits in the app switcher for days. It is `sw.js` and nothing else, it fails
silently offline, and it is the mechanism §1's "a `git push` is a deploy" depends on. Zero
*external* requests remains true and is asserted in every run.

**8. `tools/` is a new directory and is NOT part of the shipped game.**
`tools/make-icons.html` (the icon generator — the icons are drawn in code and committed as
real PNGs) and `tools/check-precache.py` (diffs the hand-written PRECACHE list in `sw.js`
against the tree). Both are excluded from the precache; `check-precache.py` knows the
exclusions.

### 16.2 The service worker, and why the update path is shaped this way

`/sw.js`. Three rules, each load-bearing, all explained at length in its header:

- **One generation per cache, and a page load never straddles two.** Everything is precached
  into `pp-cache-v<VERSION>` during `install`, and **nothing is ever added to a cache at
  runtime.** Runtime caching is exactly the mechanism that mixes generations, and with ~40
  unbundled ES modules "half old, half new" would be `room.js` from v3 calling into `train.js`
  from v4 — a throw somewhere deep that looks like a broken puppy.
- **Install is all-or-nothing.** Each asset is fetched individually with `cache: 'reload'` and
  a single failure throws, which fails the install, deletes the partial cache and leaves the
  **previous** worker active with the **previous** cache. So a deploy she catches mid-flight
  (GitHub Pages publishes files one at a time) cannot produce a broken generation.
- **The update lands between sessions, never during one.** There is deliberately **no
  unconditional `skipWaiting()`**. A new worker waits; the current session finishes entirely on
  the version it started with, so what she is playing cannot change under her. `main.js` posts
  `skip-waiting` only on `visibilitychange` → hidden, **after** flushing the save, and reloads
  on the resulting `controllerchange` **only while hidden** and **only if there was already a
  controller** (the first-ever registration claiming the page is not an update). A reload there
  is safe because the save is already on disk and all offline progression is a pure function of
  the wall clock (§5) — indistinguishable from her closing and reopening the app.

`caches.delete` is only ever called on keys carrying the `pp-cache-v` prefix, so a cache
belonging to anything else on the origin is left alone. The save lives in localStorage, which
no cache operation can reach. **There is no `push` and no `notificationclick` handler and
there must never be one** (GIFT-READY §3).

`VERSION` in `sw.js` must be bumped on every deploy. That one string is the whole update path.

### 16.3 Icons — what iOS actually does, measured against the docs

The manifest previously carried **inline SVG data-URI icons**. iOS does not reliably use
manifest icons for an installed web app and does not support SVG or `data:` for them at all;
with no raster `apple-touch-icon` it falls back to **a screenshot of the page**, which on a
canvas game is a picture of a half-drawn room. That alone would have made the gift feel
unfinished. Now:

- `icons/apple-touch-icon-180.png` — linked from `index.html`, full-bleed, deliberately **not**
  pre-rounded (iOS applies its own squircle; a pre-rounded icon under an OS mask gets its
  corners cut twice and looks chipped).
- `icons/icon-192.png`, `icons/icon-512.png` — manifest `any`, rounded tile.
- `icons/icon-maskable-512.png` — manifest `maskable`, face inside the guaranteed 80% circle.

Drawn in code in `tools/make-icons.html` and committed as real files, same-origin, no network.
The face is **breed-neutral** (floppy ears, curly-suggestive coat, a crown tuft) because the
breed art is being reworked in parallel and the icon must encode no rig geometry — and because
both target breeds (Schnoodle, Cockapoo) have dropped ears, a prick ear would have dated the
icon to the placeholder Shiba. Two art passes were needed: pass 1 read as a **teddy bear**
(round high ears, a hard outline circle drawn over the muzzle) and pass 2's crown tuft read as
**a row of beads** until the lobes were jittered and tucked behind the skull.

### 16.4 THE LANDMINE, and the three things that actually defuse it

`AudioContext` starts **suspended** on iOS and must be `resume()`d inside a real user gesture,
or every sound in the game fails **silently, for ever**. Confirmed on the target device.

1. **Nothing is constructed before a gesture.** Measured: before any touch the context is
   `state: 'none'`, `built: false`, and **all 66 names refuse to play** — and trying does not
   create a context. There is no ambience to autoplay.
2. **`unlock()` does not trust `resume()`.** It re-reads `ctx.state` afterwards. A resolved
   promise is not a running context on iOS.
3. **It retries on every gesture until it takes.** The first touch of a session can land while
   the page is still becoming interactive, and a resume that quietly failed leaves no trace.

Plus: on `visibilitychange` → visible the context is resumed (iOS suspends it when
backgrounded, and Safari has its own `interrupted` state), and if that is refused the gesture
listeners are re-armed. Measured: `none` → one tap → `running`, `connected: true`,
`masterGain: 0.62`.

**The toggle genuinely silences, three independent ways**: `play()` returns early before
building anything, the master gain goes to 0, **and the master node is disconnected from the
output**. Measured with sound off: nothing plays, and `countNodes` reports **0 nodes even
built**. It survives a reload (`settings.sound`) and the graph comes back disconnected.

**No haptics anywhere.** `navigator.vibrate` is confirmed absent on the target device, which is
why `boop`, `sit-thump`, `flop` and `land` carry the physical thump in the sound itself.

### 16.5 The sound bank

**43 recipes; 65 names resolve.** All synthesised — no asset files (§1). Sparse and
foley-forward: there is **no music in the game and there should never be**. Even the moment a
trick lands (`trick-done`) is him being pleased plus his tail hitting the floor, not a chime —
a reward jingle would be the one musical thing in a foley game and would turn "he did it" into
"you scored".

| family | names |
|---|---|
| **vocal** (all per-dog) | `yip` `bark` `whine` `huff` `yelp` `praise` `proud-yip` `sneeze` `nip` `pant` `grumble` |
| **body foley** | `sit-thump` `flop` `land` `launch` `scamper` `shake` `shake-big` `boop` `perk` `paw-offer` |
| **her hand** | `pat` `pat-sweet` `pat-soft` `cue` |
| **food & water** | `bowl-lift` `bowl-set` `kibble-pour` `eat-start` `crunch` `lick` `lap` `water-on` `water-pour` |
| **bath & brush** | `scrub` `suds` `brush` `grumble-brush` |
| **the toy** | `toy-pick` `toy-grab` `toy-drop` `toy-throw` `toy-land` |
| **the payoff** | `trick-done` |
| **families** | `pet-<10 zones>` · `grumble-<muz\|tail\|paw\|brush>` · `trick-<8 tricks>` |

Research §1.9's shopping list is covered item by item: yips, whines, contented panting, **the
claw-click of paws on floorboards** (`scamper` — 5–8 irregular claw transients, uneven on
purpose because a metronome reads as a machine), **a toy squeak** (a fast pitch rise is what
makes rubber read as rubber), **the slop of drinking water** (`lap`), the crunch of eating, the
swish of a brush, and water in the bath.

`audio.pending` — the ledger every earlier stage used to record what it was owed — is now
**empty**. Nothing is outstanding.

**PER-DOG VOICE IDENTITY.** Every vocal goes through one `vocal()` function, and the per-dog
voice is applied **inside it and nowhere else** — which is what makes "his voice" a property of
the animal rather than of 40 recipes that would drift apart. Five axes, derived from a
mulberry32 PRNG seeded with an FNV-1a hash of the dog's persisted `id`:

| axis | spread | what it does |
|---|---|---|
| `pitch` | ±4.5 semitones | the obvious one |
| `bright` | ±0.22 | formant placement — a small dog is not just a high dog |
| `rasp` | 0.10–0.42 | how much breath is in his voice |
| `wob` | 0.35–1.25 | vibrato depth, most audible in a whine |
| `len` | 0.90–1.12 | speech rate, so two dogs' yips never share a grid |

Measured over five ids: five distinct voices, **5.86 semitones of pitch spread**, and the same
id gives a bit-identical voice every call and across a service-worker update.

**Contented panting** is the one sound that repeats without her doing anything, so it is the
one that could become irritating. It is driven off `rig.drive.pant` — a state stage 2 already
animates, so it cannot desynchronise from his sides moving — gated above 0.34, jittered
2.6–4.8s apart, and skipped while he is out of the room or while a beat wants quiet.

Safety: a **retrigger floor** per name (petting taps faster than an ear enjoys), a **polyphony
cap** of 22 recipes per 0.35s, a **DynamicsCompressor** limiter after the master (a dozen
overlapping voices on a phone speaker do not sound loud, they sound broken), and `play()`
swallows every throw because it is reached from the animation clips and a thrown synth would
be a dropped frame at best.

### 16.6 The install prompt

`src/ui/install.js`. It is allowed to exist only because it is **true**: in a browser tab ITP
really does delete her save, and installing really is the fix. `"Keep Pip safe"` /
`"Add him to your home screen and he stays put."` / `"In a browser tab, iPhone tidies away
saved games after a week."` / `"Tap Share, then Add to Home Screen."` All copy is in one `COPY`
block, all of it goes through `ui/text.js`, and every pronoun comes from `game.pron`.

Three doors, none of them punished: **Got it**, **Not now**, **Don't ask again** — and tapping
the scrim is the same as Not now. It appears **at most twice, ever**, `gapDays` apart, never
when standalone (checked live, every frame — it even closes itself if she installs while it is
up), and never over another surface. On Chromium a captured `beforeinstallprompt` makes the
primary button really install; on iOS there is no such path, which is why the copy names the
Share sheet.

**An `Add to home screen` row in Settings is there for ever**, which is what lets "Don't ask
again" cost her nothing: the card never has to nag because the honest reason stays one tap
away. When standalone that row becomes a statement (`Saved to your home screen`).

**A design error worth recording.** The first draft gated the card on `affection >= 0.34`.
Affection is metered per session and per day (§12.1), so that threshold is roughly **four days
of play** — the prompt would have arrived *after* the seven-day storage window it exists to
beat. **A gate that protects a save must never be slower than the thing that deletes it.** It
now triggers on him being **named** (before that there is nothing to protect and the naming
beat must own the screen), after 80s in-scene on the first launch and 22s on any later one,
using a new `flags.launches` counter.

**A layout defect only the render caught.** At the original card height the "Tap Share, then
Add to Home Screen." line — the only *actionable* line on the card — ran **underneath the
buttons**. The button row is now placed first and the copy laid out in what is left, so a line
cannot end up under a button. Same lesson as §15.4 defect 5, third time on this project.

### 16.7 Measured

Headless Chromium, 390x844, `--enable-gpu`, safe insets forced to the target device's
20px top / 40px bottom, **dark mode**. DPR capped at 2.25 by design.

| beat | DPR | work median | work p95 | work max | frame median | frame p95 |
|---|---|---|---|---|---|---|
| room idle, sound on | 2 | 2.2 ms | 3.5 ms | 5.9 ms | 16.70 | 16.80 |
| bath + scrubbing (loudest) | 2 | 2.1 ms | 3.0 ms | 5.3 ms | 16.70 | 16.80 |
| install card over the room | 2 | 1.9 ms | 2.6 ms | 3.8 ms | 16.70 | 16.70 |
| room idle, sound on | 3 | 1.9 ms | 3.3 ms | 4.6 ms | 16.70 | 16.80 |
| bath + scrubbing (loudest) | 3 | 2.2 ms | 3.4 ms | 8.5 ms | 16.70 | 16.70 |
| install card over the room | 3 | 1.7 ms | 2.5 ms | 3.0 ms | 16.70 | 16.80 |

**Worst frame p95 across every beat: 16.80 ms — vsync-locked at 60fps throughout.**

**An honesty note about that table, because the number moved.** A later re-run of the identical
script on the same machine reported work medians of 2.6–4.1 ms and occasional `frame p95` of
33.3 ms (exactly 2x vsync). That is **host noise, not the game** — and rather than assert it,
it was measured. `C:\tmp\pp7\perfab.py` interleaves sound-ON and sound-OFF samples three times
each **inside one process**, so host drift cannot masquerade as a difference between the two
conditions:

| | work median | best frame p95 |
|---|---|---|
| sound ON | 2.80 ms | 16.70 ms |
| sound OFF | 2.70 ms | 16.80 ms |

**Sound costs +0.10 ms of frame work.** The 33 ms outliers appear in **both** conditions, which
is what identifies them as the host rather than the feature — a real regression cannot be
absent from the condition that triggers it. WebAudio synthesis runs off the main thread; all
this file's `play()` does on the main thread is build a handful of nodes.

**Offline — the load-bearing gate. 11/11.** Load online, precache 48 entries into
`pp-cache-v7.0.0`, then `context.set_offline(True)` (verified genuinely dead with a
cross-origin probe) and reload. The game boots, the dog is still named, the bond survived,
petting works (`pet` 0.996), a feed action runs, sound plays, **zero requests reach the
network**, zero console errors.

**The update path. 15/15.** v1 installed and serving → deploy v2 (a changed module *and* a
bumped `VERSION`) under a live client → the update is detected as waiting, **the live session
stays entirely on v1 modules and the v1 worker**, both generations sit in separate caches,
and she can still play mid-deploy → `skip-waiting` → the old cache is deleted → next launch is
wholly v2 → **her name, bond, coins, trick ledger and his voice all survive** → and the new
generation works offline too.

**Sound. 24/24.** Silent before a gesture (all 66 names refuse; no context created), `running`
after one tap, every name in the bank schedules real nodes (**307 source nodes started across
the bank**; `shake-big` is the richest at 20), `audio.pending` empty, five dogs get five
voices, the same dog gets the same voice, the toggle disconnects and builds no nodes, it
survives a reload, gameplay fires sounds for real with zero failures, and a sound repeated in
the same frame is refused.

**The install prompt. 16/16.** Not eligible on a fresh save, blocked by the arbiter during the
reunion, appears after the first-launch wait, all three doors work, it does not come straight
back, "Don't ask again" is permanent even with the counters reset, the Settings row still
opens it, it never drifts open over an open sheet, and it is never eligible when standalone.
Rendered and eyeballed in dark mode, light mode and `prefers-reduced-motion`.

**A second defect the render caught, and the distinction it taught.** Screenshotting the
Settings sheet showed the card sitting **on top of it**, swallowing every touch meant for its
rows. Two fixes, and they are not the same fix: the sheet is now a term in the `blocked`
predicate at install's one call site (it is deliberately *not* in the shared `surfaceOwner()`,
because the sheet's own rows call `startCare`/`startTrain` and putting it in the arbiter would
have it block the very things it exists to launch) — **and** the card now **retracts** when
something else takes the surface, rather than only refusing to open. `eligible()` gating
*opening* is not the same guarantee as not being stacked; a card that was already up needed the
second rule. Retracting is deliberately not counted as one of the two asks: she never saw it.

**Legacy saves. v1, v2, v3, v4, v5 → all load.** See 16.1 §4.

### 16.8 Not built in stage 7, and one thing left broken

- **AUDIBILITY IS UNVERIFIED.** Nothing in a headless browser can tell you whether a synth
  patch sounds like a dog. Everything above is *structural*: the graph exists, nodes start,
  the state transitions correctly, the toggle disconnects. **A human has to put this on the
  real phone with the ringer up and listen.** Expect to retune `BALANCE.audio.master`, the
  per-family `gain` trims and possibly a few formants by ear. The most likely candidates for
  sounding wrong are `whine` (easy to make plaintive rather than asking), `grumble` (must read
  as annoyed, never as a growl — principle 1 in a sound) and `pant` (the only repeating sound).
- **The iPhone silent switch mutes WebAudio too.** Not worked around — the workarounds are
  hacks. Instead the Settings sound row says so in words, once. Worth a human check.
- **No `prefers-reduced-motion` variant of the panting cadence.** Sound is not motion, so it is
  unchanged; the card's slide travel *is* reduced (26 → 6 virtual units).
- **`BALANCE.audio.maxVoices` counts RECIPES, not nodes.** 22 recipes in 0.35s is generous for
  real play, but `shake-big` alone is 42 nodes, so a pathological pile-up is ~880 nodes. The
  per-name retrigger floors make that unreachable in practice; it is not defended against
  directly.
- **THE FLOATING BOWL DURING FEED AND WATER IS NOT FIXED.** Diagnosed and measured, not
  repaired — see 16.9.

### 16.9 The floating bowl — diagnosis, and the trap for whoever fixes it

Reported by the human: during feeding and drinking the bowl hangs in mid-air at chest height.
Confirmed, and it is **worse than reported: both stage-2 failure modes are present at once.**

Stepped frame by frame (247 feed frames, 243 water frames — `C:\tmp\pp7\bowl.py`):

| | feed | water |
|---|---|---|
| bowl y, throughout | 644 (fixed) | 644 (fixed) |
| paw / floor contact | ~690 | ~690 |
| **frames with head-bottom below body-bottom** | **184 / 247** | **164 / 243** |

So the bowl's base floats roughly 40 virtual units clear of the floor, **and** the head has
already sunk into the torso for three quarters of the animation — the very bug the 74-unit
compromise was meant to avoid. §12.6's account is accurate about *why* 132 units failed, but 74
did not actually escape it; it made it milder and bought a floating bowl in exchange. `wash`
and `brush` are **clean** — neither floats a prop nor loses the neck. The defect is specific to
the two bowl-presenting actions.

**What the fix has to be** (per the human's guidance, and I agree after measuring): the bowl
goes on the floor between the front paws, and the **body / chest / shoulders** drive down and
forward as the primary motion with neck extension and head pitch secondary. Head travel alone
cannot get there — that is exactly what 132 units proved.

**THE TRAP, and it is not obvious.** `scenes/room.js` has

```js
if (!reunion.active && !train.busy && !walk.busy && !contest.busy) toy.apply(dt, mood);
```

`care.modal` is **not** in that list, and `toy.apply` **rewrites `rig.x/y/s` back to home every
idle frame** and runs *after* `care.apply` in the pipeline. So any attempt to lower the body by
writing `rig.y` from `care.js` will be silently overwritten every frame and will look like the
pose code simply not working. Stages 3, 4 and 5 each hit this and each added their layer to
that guard; care must do the same. Everything must stay **pose targets only** (§6) — no
final-value writes — and care must spring the rig back to `rig.home` on the way out, which the
`w` weight blend already gives it.

Useful starting numbers: `BALANCE.care.stage.bowlTarget` is `[178, 644]` and wants to go to
roughly `[178, 700]`; `placedScale` 1.15 wants to go **up** (a bowl on the floor is nearer the
camera, and §12.6's "depth is scale" applies to props too); and `headDown` should come **down**
from 74, not up, once the body is carrying the travel. Verify with `C:\tmp\pp7\bowl.py`, which
already reports both failure modes per frame and crops screenshots at the deepest part of the
action — the endpoints look fine in both the broken and the working case, which is why it steps
rather than samples.

> **FIXED IN STAGE 6.** Both failure modes are gone and both are asserted per frame, on every
> frame, for feed and water. The trap above was real and is now closed: `care.active` is in the
> `toy.apply` guard, and the eating pose does write `rig.y`/`rig.s`. The starting numbers
> suggested here turned out to be the wrong *kind* of number — see §17.2. Verify with
> `C:\tmp\pp8\bowl2.py` (per-frame) and `C:\tmp\pp8\breedproof.py` (per breed).

---

## 17. Stage 6 (shop + kennel) and the floating bowl — as built

Two pieces of work: the reported floating-bowl defect (§16.9) and stage 6's economy surfaces.

### 17.1 The floating bowl — what it actually was

Three separate faults, and only the first was the one in the handover.

**1. The guard.** `scenes/room.js` omitted care from the `toy.apply` guard, so any `rig.x/y/s`
written by `care.apply` was overwritten on the same frame. Fixed; the guard now reads

```js
if (!reunion.active && !train.busy && !walk.busy && !contest.busy && !care.active) toy.apply(...)
```

`care.active` rather than `care.modal` on purpose: `modal` goes false the instant the action
ends, which would snap the placement home in the middle of the return. **Confirmed surviving to
the frame:** the eating pose moves `rig.y` 706 → 713 and `rig.s` 1.34 → 1.38, measured live, and
returns to exactly `rig.home` afterwards (assertion D, 0 failing frames).

**2. The bowl's position was a literal.** `bowlTarget: [178, 644]` had nothing in the program
tying it to the floor, so nobody could check it and it drifted 40 units into the air. It is now
**solved**, in `dog/care.js solveBowl()`, and the base cannot be written without the floor being
in the expression:

```
floor   = rig.stance({}).pawSole            -> where his paws stand
targetY = floor - BOWL_BASE * scale         -> so base == floor, by construction
scale   = (floor - (muzzleAtEatingDepth - dipInto)) / (BOWL_BASE - BOWL_WELL)
```

`scenes/props.js` now publishes `BOWL_BASE` / `BOWL_WELL` / `BOWL_TOP` next to the path that
draws them, and `dog/rig.js` publishes `pose.pawY` / `pose.pawSole` — the floor line was
previously derived privately inside `dog/draw.js`, which is why stage 7 could only say the bowl
floated by "about 40": the reference it compared against was the paw's **anchor**, which is
most of a paw above the rug.

**3. The head-only reach.** `headDown: 74` was 99 virtual units of a 100-unit head-to-belly
budget, which is the sunken head in one line. The body now carries the travel: `sit` to 1.0 and
`down` to 0.92 (a deep sphinx), plus a small forward commitment, and the head finishes the reach.
`sit` and `down` are the only channels that move the torso's bottom edge — `squash` cannot,
because `rig.update` compensates it to keep the paws planted — and `down` brings the front-paw
splay, the leg bow and the hind tuck for free, so the crouch cost the renderer nothing new.

### 17.2 Why the pose is derived rather than tuned

The handover's suggested numbers (`bowlTarget` y ~700, `placedScale` up, `headDown` down) were
all correct in direction and all the wrong *kind* of number: absolute units measured against the
Shiba, which is the only breed in the tree. With three breeds landing that differ in muzzle
length, ear type and body mass, every one of them would have been wrong for two dogs.

So `dog/rig.js` gained **`stance(dims, channels)`** — the same arithmetic `rig.update` uses,
resolved from plain numbers, so a caller can ask where a posture would put a muzzle without
running a frame and without knowing the breed. BALANCE now holds **shares and depths** instead:

| was | is | why |
|---|---|---|
| `headDown: 74` (units) | `headDownShare: 0.77` | a share of *this dog's* head-to-belly room |
| — | `headMaxShare: 0.82` | a hard ceiling, clamped where the value is USED |
| — | `bobPeak: 1.4` | the deepest frame of a bite, which the ceiling must budget for |
| `bowlTarget[1]` (literal) | derived from `pawSole` | the base is the floor by construction |
| `placedScale: 1.15` | derived from the muzzle | 1.399 on the Shiba, solved not typed |
| — | `dipInto: 16` | how deep his nose goes — about the bowl, not the dog |

**Two mistakes worth recording, both found by the breed sweep rather than by looking:**

- Budgeting the bob at *solve* time by subtracting a guess from the ceiling is much weaker than
  clamping the total at *apply* time. The first version left a chest 25% shallower than the
  Shiba's with **0.8 virtual units** of clearance at the bottom of a bite. The Shiba passed only
  because it had room to spare, and a bound that holds for the dog you tested is not a bound.
- `rig.headRoom` (standing) flatters by ~7 rig units: folding into the stoop moves the belly and
  the chin by different amounts before the head has dropped at all. The budget is now measured in
  the crouch it is spent in.

### 17.3 Stage 6 — the shop and the kennel

Two in-room modal surfaces, `ui/shop.js` and `ui/kennel.js`, both in `surfaceOwner()` rather than
behind a private `if` (§14.1), both consuming every pointer while up. **One currency each, and
that is the design, not a layout accident:** the shop draws a coin purse and never mentions care
points; the kennel draws her care standing and has no price on it anywhere.

The rule is enforced in `state/game.js buyItem()`, not trusted:

1. an id in `BALANCE.economy.unlocks` is refused **before a coin moves** — checked ahead of the
   catalogue lookup, so an unlock id appearing in the shop table by mistake is still refused;
2. a row's `needs` gate reads `isUnlocked`, which reads `carePoints` and nothing else;
3. there is still no `spendCarePoints` and there must never be one. Passing 400 does not consume
   400 — care points are a lifetime total that gates content, not a balance.

`BALANCE.economy.unlocks` was **trimmed from six rows to four**. `bedBasket` and `roomSeaside`
described things GIFT-READY §3 rules out, and a reward she has *earned* that does nothing is
worse than one never promised. Every remaining row is consumed by real code: `collarRed` →
`ui/kennel.js` + `dog/draw.js`, `rugBlue` → the room repaints its rug, `cockapoo` → the adoption,
`treatsGood` → a shop row coins alone can never reach. Nothing is lost: unlocks are **derived**
from `carePoints` on every read and were never stored.

Adopting runs a short beat (knock → reveal → settle) and then hands her to the room, which opens
the naming beat by itself because she has no name. The kennel deliberately does not own the most
important moment it causes. The dog is created at the **reveal**, not at the tap, so an
interrupted beat cannot leave a half-written adoption in the save. Swapping dogs remounts the
room scene, because `enter()` builds the rig, the renderer, petting, idle and every care layer
from `game.dog` — mutating `activeDogId` under a live scene would leave one dog's rig wearing
another dog's state.

### 17.4 Schema v6

The state shape **did not grow** — `inventory.food` / `.care` / `.accessories`, `unlocks.items`,
`dogs[]`, `activeDogId` and `dog.wear` were all stage 1's and have been merged forward since.
What changed is that stage 6 is the first code that *writes* to them, and a reader that only ever
read them tolerated types a writer cannot: `inv.food[id] = n` against a string does nothing and
reports nothing. So `MIGRATIONS[6]` coerces the three containers, integer-ises the counts, drops
a legacy `collar: 'red'` (not a real id, and it would have drawn as the *earned* red collar she
had never earned), and guarantees the active dog's breed is in `unlocks.breeds`.

### 17.5 Contract deviations

1. **`dog/care.js` writes back into `BALANCE`.** `solveBowl()` sets `ST.bowlTarget[1]`,
   `ST.placedScale` and `ST.bowlFloorY` so anything reading BALANCE sees the truth — the drop
   ring, the snap radius, the prop chase and the harness all do. The alternative was a second
   source of truth for where the bowl is, which is the defect being fixed. The authored inputs
   (`bowlFloorY` fallback, `dipInto`, `scaleRange`, the shares) all still live in BALANCE.
2. **The bowl's own offsets live in `scenes/props.js`, not BALANCE.** `BOWL_BASE` / `BOWL_WELL` /
   `BOWL_TOP` are properties of the path that draws the bowl and would drift from it if they were
   filed anywhere else. They are exported, which is what makes them checkable.
3. **`dog/rig.js` gained a second resolver.** `stance()` duplicates the load-bearing part of
   `rig.update`'s arithmetic. The two share their literals (`SIT_DROP`, `SIT_HEAD`) and
   `bowl2.py` asserts per frame that the prediction matches the live pose within 3 units
   (measured: 0.00–0.17). Drift is possible in principle and would fail the gate.
4. **The nav went to eight pills**, 40.5 virtual units each, under the 44 tap-target guideline.
   `ui/nav.js` already makes the whole band a hit target and gives the gaps to the nearest pill,
   so a thumb between two buttons presses one of them rather than poking the dog.
5. **The shop does not scroll**, which is a constraint on the catalogue rather than a thing to
   solve with a scroll view. Eight rows fit in 604 of 844.
6. **The shop sells no decor**, against the brief's "toys, treats, care tools, collars, a little
   decor". Decor is where `BALANCE.economy.unlocks` already put it — `rugBlue` is earned, not
   bought — and putting two currencies on the same shelf is the confusion the one absolute rule
   exists to prevent. Collars appear on both sides deliberately: a plain one is an object and
   costs coins, the red one is earned and cannot be bought at any price. Same neck, no exchange.
7. **`BALANCE.ui.wear` holds the collar colours**, read by both `dog/draw.js` and the two
   surfaces, because a shop swatch that did not match the collar on the dog would be a lie in the
   one place the player is deciding.

### 17.6 Measured

Headless Chromium, 390x844, `--enable-gpu`, dark mode.

**The bowl, per frame** (`C:\tmp\pp8\bowl2.py`, 975 feed frames / 1026 water frames, stepped one
at a time from care opening to care closing — not sampled):

| assertion | feed | water |
|---|---|---|
| A bowl base on the floor, every frame | **PASS** 805/805, gap 0.00 | **PASS** 856/856, gap 0.00 |
| B head clear of the belly, every frame | **PASS** 805/805, min 18.38 | **PASS** 856/856, min 19.05 |
| frames with the head sunk through the belly | **0** (was 184/247) | **0** (was 164/243) |
| C bowl on the same floor as his paws | PASS | PASS |
| D `rig.x/y/s` handed back to home exactly | PASS | PASS |
| E `stance()` predicts the live pose (<=3.0) | PASS, err <=0.17 | PASS, err <=0.05 |
| muzzle depth into the food | 18.4 | 18.1 |

`wash` and `brush` unchanged: 0 sunk frames, 0 placement drift, min chest 83.5 / 87.0.

**Per breed** (`C:\tmp\pp8\breedproof.py`, the Shiba plus eight deliberate distortions —
+-70% muzzle, +-35% chest, +-60% leg, +30% head, and a heavy short-legged combination): **9/9 pass
both invariants.** Bowl-base gap exactly 0.000 in every case; chest visible under the chin at the
deepest bite 11.5–24.0 virtual units. Three cases hit the bowl's scale clamp, where the bowl
becomes the nearest sane size rather than the exact one — the nose sits at a different depth, but
the base cannot leave the floor.

**Stage 6 gate** (`C:\tmp\pp8\stage6.py`, `stage6b.py`):

| check | result |
|---|---|
| 10,000,000 coins: unlocks, adoption, gated row | nothing, refused, refused |
| every `unlocks` id offered to `buyItem` | 4/4 refused, reason `unlock`, 0 coins moved |
| buying an object | -55 coins, **0** care points |
| giving a treat | 0 coins, **0** care points |
| adopting | **0** coins, **0** care points, roster 1 -> 2 |
| nav ids | 8, **0** unavailable, no "coming soon" reachable |
| `surfaceBlockedFor`, both directions | 10/10 |
| v1->v6 ... v5->v6 | 5/5, name / coins / care points / tricks / ledger intact |
| console errors, external requests | 0, 0 |

**The Cockapoo maths.** Gate 400 care points. A day is worth, through the real `awardCare`
ledger: minimal (turn up, feed, water) **65**; attentive (turn up, all four care actions, a
petting session, a walk, two toys, four training reps) **234** on paper and **214** actually paid,
the difference being the daily cap biting; devoted **240** (the cap). So **day 2** for an
attentive player, day 3 with a lighter second day, day 7 for someone barely looking after him. A
contest pays **0**, so the ring cannot shorten it by a single day. Playing the same day twice pays
**6** more, not 214 — the once-a-day set holds.

**Frame times** (median / p95 of frame work, ms):

| beat | DPR 2 | DPR 3 |
|---|---|---|
| room idle | 1.8 / 2.6 | 1.8 / 2.7 |
| shop open | 1.8 / 2.8 | 2.1 / 2.8 |
| kennel open | 1.9 / 3.0 | 2.3 / 3.0 |
| feeding (the stoop) | 1.7 / 3.0 | 2.1 / 3.7 |

rAF interval median **16.7 ms** and p95 **16.7–16.8 ms** in all eight, i.e. 60fps with the frame
~85% idle. Reduced motion and light mode both re-run through the full per-frame bowl gate and the
whole stage-6 screenshot pass: identical results, 0 errors.

### 17.7 Not done, and known-imperfect

- **The Cockapoo renders as the fallback breed.** `dog/breeds.js` contains only `shiba`; the
  Schnoodle and Cockapoo art is being built in parallel. State is correct — she is stored as
  `breedId: 'cockapoo'`, `sex: 'f'`, with her own needs, bond and pronouns — and `getBreed` falls
  back to the Shiba silhouette until the data entry lands, at which point she renders correctly
  with **no code change**. That is the §11.3 breed seam working, but it does mean that today the
  two dogs look alike and her kennel portrait uses the Shiba palette.
- **The eating pose was verified against one real breed.** The nine-way sweep is arithmetic on
  synthetic proportions, not nine rendered dogs; only the Shiba was rendered and looked at. When
  the breed branch merges, re-run `bowl2.py` per breed and *look*.
- **The adoption beat has not been seen by a human**, and it is a one-shot moment.
- Nav pills are 40.5 units wide; that wants a thumb on the real device.
- `treatsGood` at 1100 care points is roughly a five-day goal and nobody has played that far.
- Blocker 1.7 (the real-phone pass) is untouched and still gates 1.4 and 2.2.

---

## 18. Stage 8 (the floating bowl, again — and the silent switch) — as built

Two defects reported from the real device by the person the game is for. One was a real geometry
bug that a previous stage had "verified"; the other was not a bug at all.

### 18.1 What §17 actually shipped

§17.7 ended with an instruction to whoever merged the breed branch: *only the Shiba was rendered
and looked at; when the breed branch merges, re-run `bowl2.py` per breed and look.* The breed
branch merged. Nobody looked. The bowl shipped hovering at the dog's muzzle on all three breeds,
and `bowl2.py` reported **`A_bowlBaseOnFloor`: PASS, 805/805 frames, gap 0.001, tolerance 1.0**
the whole time.

### 18.2 The floating bowl — root cause

**The assertion was true and useless.** `A` compared `bowlBaseY` against `bowlFloorY`. But
`solveBowl()` computed the bowl's y *as* `bowlFloorY - BOWL_BASE * placedScale` and then wrote
`bowlFloorY` back into `BALANCE` (deviation 17.5.1). So `A` compared the bowl's base against the
number the base had been computed from. It was 0 by construction, on every frame, for any pose,
for any breed, and for any value of the bug. **An invariant that closes over its own reference
frame is worse than no check at all, because it produces confident per-frame numbers** — which
were relayed to the human as verification.

**The floor was defined from the wrong pose.** `bowlFloorY` came from `rig.stance({})` — the
**standing** dog. The eating pose is `sit: 1.0, down: 0.92` plus a forward lean into `rig.y` /
`rig.s`, and those move where the paws are *drawn*: `sitLift` (6) + `downPawY` (5) + the
paw-radius growth + `fwd` (7) put the drawn sole **23.3–26.2 virtual units below the line the bowl
was standing on.** Measured on the running game, all three breeds (`C:\tmp\pp8\floor1.py`):

| breed | bowl base | drawn sole | gap | published sole | published vs drawn |
|---|---|---|---|---|---|
| shiba | 719.78 | 743.12 | **+23.34** | 743.12 | 0.00 |
| cockapoo | 720.69 | 746.89 | **+26.20** | 744.15 | **+2.74** |
| schnoodle | 720.01 | 745.34 | **+25.33** | 743.38 | **+1.96** |

**A second, breed-specific divergence.** The right-hand column is its own bug. `pose.pawSole` —
the number everything outside the renderer treats as "where the floor is" — was computed as
`legW * 1.06 * (1 + down*0.10)`, while `dog/draw.js`'s `drawLeg` sizes the paw as
`legW * 1.06 * (...) * dims.pawScale`. The two doodle crosses have deliberately oversized paws
(cockapoo 1.16, schnoodle 1.12), so on the two breeds shipping *alongside* the Shiba the rig
published a floor 2.0 and 2.7 units above the paw a player can see. The Shiba, `pawScale`
undefined, was the one breed where the two agreed — so tuning against it hid this completely.

**The fix: contact is the invariant.** A floor is a property of the room, not of the dog's
transform. `dog/rig.js` now owns one room floor line, `rig.floorV`, derived from `rig.place` and
the dog's own standing paw, and `rig.update()` resolves the **planted** sole against it when the
layer owning the pose says the paws are planted (`rig.plantShare`, a per-frame drive like
`drive.neck`). The legs take up the difference. `pawRadius()` / `soleFor()` /
`plantedSoleLocal()` are the single copy of the three expressions that had drifted.

**Why the paws move and not the bowl.** Lowering the bowl to the paws instead was tried and
rendered (`pawPlant: 0`, `cmp-*-p00-*`). It needs scale **2.30–2.56** against a `scaleRange`
ceiling of 1.95, so it clamps on all three breeds: the base does stay on the floor, but the food
surface stops meeting his nose and the crop shows a trough swallowing his paws with his muzzle
resting *above* the rim. Planting the paws needs **1.40 / 1.52 / 1.65** — comfortably in range, and
essentially the scale that was already there, because the bowl was never the wrong size. It was
standing on a floor 25 units too high.

### 18.3 The silent switch — not a defect

Sound was audible on the laptop and silent on the iPhone. The cause was the physical ringer
switch, exactly as §16.8 documents. **Nothing in `engine/audio.js` or `engine/sfx.js` was broken.**

Overriding it is a deliberate product decision, taken because the recipient normally keeps her
phone on silent, so the alternative is a pet that is permanently mute for the one person this was
built for. `engine/audio.js` starts a quarter-second of **generated silence** on a looping
`playsinline` `<audio>` element inside the same gesture that resumes the `AudioContext`, which
moves iOS's audio session from *ambient* to *playback*. Behind
`BALANCE.audio.overrideSilentSwitch`, default `true`. The silence is a data URI, so it costs no
asset, no fetch and no precache entry.

Guardrails, because this deliberately overrides a device setting:

- **the in-game toggle is the authority.** `setEnabled(false)` *releases* the session (stops the
  element, drops its source, removes it from the document) rather than muting it, on top of the
  existing gain-0 + disconnect + `play()` early-return. It persists in `state.settings.sound`.
- **nothing sounds unprompted.** No element and no context before the first gesture.
- **`visibilitychange` to hidden** releases the session *and* suspends the graph, so a
  backgrounded game holds no audio session. A puppy barking from her pocket in a meeting is the
  failure this risks, so it is not left to iOS suspending our JS for us.
- the Settings row no longer tells her the ringer switch mutes the game, and points at itself.

### 18.4 Contract deviations

1. **17.5.1 stands and is unchanged** — `solveBowl()` still writes `placedScale`, `bowlFloorY` and
   `bowlTarget[1]` back into `BALANCE`. `bowlFloorY` is now the *planted eating sole*, which with
   `pawPlant: 1` is `rig.floorV` exactly.
2. **17.5.3 is partly repaid.** `stance()` is still a second resolver, but the paw/floor
   arithmetic it duplicated is now one shared expression, and the solve's *prediction* of the sole
   is asserted against the live pose per frame (`G`, error 0.000 on all six runs).
3. **The eating solve moved out of the closure.** `solveEatGeometry()` is exported from
   `dog/care.js` and `main.js`'s `solveFor()` calls it. It previously held a hand-copy of the same
   arithmetic while its comment claimed it ran "the same arithmetic, not a copy" — the two had
   diverged, which is the deviation this removes.
4. **`main.js` imports `dog/care.js`.** Needed for (3). `main.js` is the top of the tree.
5. **`rig.plantShare` is a drive, not a pose channel.** It is written every frame by the layer that
   owns the pose and read by `rig.update()`, like `drive.neck` and `wear`. It is **0 everywhere
   except the two bowl actions**, so every other scene's paws are byte-identical to stage 7; that
   is asserted (`framesClaimingPaws: 0` for wash and brush on all three breeds). Planting is
   therefore *not* yet the global truth the room deserves — see 18.6.
6. **`engine/audio.js` creates a DOM element.** The only DOM node any engine module makes. It has
   to be an `<audio>` element in the document for the session category to flip, and it is removed
   again when sound is switched off.
7. **`breedProportions()` was dead.** It read `window.__ppBreeds`, which is assigned nowhere in the
   tree, so it always returned null and the breed-independence sweep had silently been testing only
   distortions of whichever dog was loaded — never the three breeds that ship. It now reads
   `getBreed()`.

### 18.5 Measured, and looked at

The distinction matters more than the numbers, because the numbers are what lied last time.

**Looked at** (rendered, cropped, viewed): the eating phase for shiba, cockapoo and schnoodle; the
drinking phase for all three; the rejected `pawPlant: 0` alternative on the schnoodle; a
labelled-rules overlay of every candidate floor line; and a tight crosshair crop proving
`BOWL_BASE` marks the bowl's real underside and `pose.pawSole` marks the real paw bottom. In all
six shipping renders the base is down on the rug between the planted paws and the nose is *in* the
food (`muzIntoBowl` 18.0–19.0).

**Only measured** (never rendered): the six clamped distortion cases in `breedproof.py`; frame
timings; the audio structure.

**The corrected gate** (`C:\tmp\pp8\bowl3.py`, 3 breeds x feed+water, ~975–1026 frames each,
stepped one frame at a time, not sampled) — all PASS:

- `A_baseOnLiveDrawnSole` — the base against the **live drawn sole on the same frame**, on exactly
  the frames `drawFront` puts a bowl on screen. Gap **-0.588 … +0.007** against a 1.5 tolerance.
- `B_plantedSoleOnRoomFloor` — the planted sole stays on `rig.floorV` in every pose.
  `soleStandingRange == soleEatingRange` exactly, **`standToEatShift: 0.0`** on all three breeds.
- `C_publishedSoleIsTheDrawnPaw` — `pose.pawSole` vs `drawLeg`'s own expression: worst error
  **0.0000** (was 2.74 on the cockapoo).
- `D_scaleNeverClamped` — 1.399 / 1.521 / 1.647, `raw == scale`.
- `E_headClearOfTorso` — chest visible >= 17.7 (required 12).
- `F_placementHandedBack` — `rig.y/s` and `plantShare` all back to rest.
- `G_stancePredictsReality` — sole error **0.000**, body/head/muzzle <= 0.19.
- wash + brush unregressed on all three breeds; `framesClaimingPaws: 0`.

**Audio** (`C:\tmp\pp8\audio8.py`, 33 checks, all PASS): nothing exists before a gesture; one
gesture arms context *and* a looping, playsinline, un-muted, data-URI element; the toggle releases
it completely and refuses `play()`; the choice survives a reload; hidden releases the session and
suspends the context; returning re-arms both; `overrideSilentSwitch: false` starts no element and
leaves sound working. **126 requests, all local; zero audio asset requests.**

**Frames** (`stage6b.py`, 390x844, `--enable-gpu`): worst work p95 **3.3 ms** across eight beats
including *feeding (the stoop)* at DPR 2 and 3; rAF median **16.7 ms** throughout — 60fps.
v1 to v6 migrations all pass. `stage6.py`: currencies, nav, `surfaceBlockedFor` all PASS.
Zero console errors and zero external requests in every run above.
`sw.js` `VERSION` **8.0.0 to 8.1.0**; `PRECACHE` unchanged and verified
(`py tools/check-precache.py` — 49 entries, matches the tree).

### 18.6 Not done, and known-imperfect

- **Planting is scoped to the two bowl actions, not to the room.** The floor *should* be the floor
  in every pose, and `rig.floorV` now exists to make that possible — but switching it on globally
  changes every sit and lie-down in the game (tricks, idle, contest, reunion), and the scenes that
  carry the dog elsewhere (`walk.js`, `toy.js`, `reunion.js`) would each need to say so or have
  their paws pinned to a floor they have left. That is a bigger visual audit than this defect
  warranted. Consequence today: a dog sitting next to a placed bowl *after* the action has ended
  has his paws ~7.5 units below its base — invisible, because `drawFront` stops drawing the bowl
  the moment `mode` clears, which is why `A` is asserted on exactly that window.
- **`scaleRange` cannot absorb extreme proportions.** Six of nine synthetic distortions clamp. All
  three shipping breeds sit mid-range, and the clamp is now a loud failure rather than a silent
  fallback, so a future breed that cannot be fed will say so instead of floating.
- **The silent-switch override is unproven.** Headless Chromium cannot flip an iOS audio session
  and cannot hear anything. Every precondition and every guardrail is verified; that the session
  category actually changes, and that the game is actually audible on a silenced iPhone, needs the
  real device. This is the one item here that a human ear must close.
- **Nobody has looked at the landing spring.** The bowl dips up to ~0.6 units past the sole over
  ~7 frames as it settles; it is reported separately by the gate rather than tolerated, but it was
  measured, not viewed.
- Blocker 1.7 (the real-phone pass) is still untouched and still gates this.

---

## 19. Stage 8b (the bowl he eats *out of*) — as built

Stage 8 put the bowl's base on the floor and got his muzzle 18 units inside it. Every number was
right. The human opened it on his iPhone and said:

> "the dog still seems to eat from behind the bowl and not from the bowl. also the bowl is not on
> the floor but over his paws"

Both halves of that are one defect, and it is not a geometry defect. `care.drawFront` ran *after*
`dog.draw` in `scenes/room.js`, so the **entire** bowl — vessel, interior, far rim and the food
surface — was painted on top of him. The nose really was inside the bowl; it was simply covered by
a full ellipse of kibble. 805 frame assertions passed, a reviewer looked at the render and called
it correct, and the defect shipped anyway.

### 19.1 The lesson, stated once

**Position and compositing are different properties, and only one of them had ever been tested.**
A geometric invariant cannot see draw order. `muzIntoBowl` was 18.4 before this change and 18.4
after it; the picture went from wrong to right without that number moving at all. Any check that
would have caught this has to read the rendered canvas.

### 19.2 The bowl is split across the dog

A near-frontal bowl is three layers deep, not one sprite. `scenes/props.js` `drawBowl` now takes a
`layer` argument — `'back' | 'front' | 'all'` — and remains the single source of the bowl's shape:

- **`'back'`**, from the new `care.drawBehind(g)`, *before* the dog: shadow, vessel, interior wall,
  contents, far rim.
- **`'front'`**, from `care.drawFront(g)`, *after* the dog: the same paint again, **clipped** to
  `bowlNearPath()` — the near rim plus the outer wall beneath it. It re-paints rather than drawing
  its own shape, so the two halves cannot drift apart and there is no seam to antialias. It skips
  only the contact shadow and the contents, which are translucent and would double-darken.
- **`'all'`** is unchanged behaviour, for a bowl with nothing of his in front of it: the two resting
  bowls by the wall, and a bowl in her hand mid-drag. `bowlIsSplit()` is the single predicate.

The muzzle then descends *between* the two: occluded by the near rim, occluding the food. That is
the whole fix, and it is also what fixed the paws — they are part of the dog, so they now draw over
the bowl's far side and only the near lip crosses them.

Two smaller compositing errors of the same family went with it: the brushed-out **fur pile** moved
to `drawBehind` (it lies on the rug; drawn after him it was fur stuck to his back), and the poured
**kibble and water particles** now draw before the near rim, so food landing in the bowl goes under
the lip instead of over it.

### 19.3 The occlusion gate (`C:\tmp\pp8\occl.py`)

The gate renders the **same simulation frame four times**, suppressing one layer at a time, and does
set logic on device pixels. No colour table — a pixel belongs to a layer iff removing that layer
changes it:

| render | what is suppressed |
|---|---|
| `A`   | nothing (what he sees) |
| `Bf`  | `care.drawFront` |
| `Bfb` | `drawFront` **and** `drawBehind` |
| `OLD` | stage 8's order re-created: the whole bowl after the dog |

Over pixels inside both the well and the muzzle ellipse: `M` = muzzle drawn over the food *and*
surviving; `R` = muzzle pixels the near rim's own rasterised footprint takes back; `F` = muzzle
pixels lost to anything that is **not** the near rim — the defect, required to be exactly zero.

`OLD` is the part that matters. It runs on the *same frame* as `A`, so the gate proves it can
**see** the defect rather than merely failing to find it: stage 8's order buries 4.8k–5.9k muzzle
pixels under food and leaves 0–1 showing; the split inverts both to 0 and 1.6k–4.8k.

### 19.4 Contract deviations

- **The requested placement change was not made, because it contradicts the floor invariant.**
  The brief asked for the bowl to sit "low and far enough forward that the paws are visible beside
  it". It cannot, without giving up `rig.floorV`. The chain is fully pinned: `scale =
  (floorV − (muzBottomV − dipInto)) / (BOWL_BASE − BOWL_WELL)`, and every input is fixed — `floorV`
  by the invariant, `muzBottomV` by the per-breed head drop, `dipInto = 16` by `muzIntoBowl` 18–19,
  and the 30:26 aspect by the art. So the bowl's screen width is determined: **84.0 / 91.2 / 98.8**
  units (shiba / cockapoo / schnoodle) against a gap between his front paws of **55.7 / 46.3 /
  50.1**. The bowl is 1.5–2.0× wider than the gap, and its base and his paw soles are on the *same*
  screen line, hence the same depth — so they interpenetrate, and any composite has to pick a
  winner. Moving it "forward" requires the floor to become a depth→screen-y **plane** rather than a
  line (the room has the ratio implicitly: `stoop.fwd 7` per `stoop.near 0.030`), which means
  `bowlBaseY ≠ rig.floorV`. That is precisely the invariant stage 8 established, so it was left
  alone and reported instead. **The layering achieved the requested reading without it**: each
  paw's outer half is ≥99% visible, and whole-paw visibility went from 21–29% to 48–59%.
- **Whole-paw visibility is geometrically bounded, so the gate asserts the outer half.** With the
  bowl necessarily wider than the gap, "no paw more than half hidden" is not achievable for the
  schnoodle (47.8% worst). The honest formalisation of "beside, not underneath" is that the outer
  half of each paw survives untouched, which it does. The whole-paw figure is reported, not gated.
- **The far rim is behind the *whole* dog, not just the muzzle.** Strictly, the bowl's far rim is
  nearer than his cheeks and should cross them. It does not: there are two hooks, not a depth
  buffer. Consequence: with his head down, the bowl reads as an open crescent rather than a full
  ellipse. Judged the better trade — the alternative puts a rim line across his nose, which is the
  original defect wearing a hat.
  > **THIS DEVIATION WAS THE DEFECT. See §19.5.** "Behind the whole dog" is fine while his head is
  > down — and the sentence above only ever considered that case. It is wrong the moment he sits
  > up, because then the thing behind which the far rim sits is his *chest*, and the bowl reads as
  > half-buried in him. Upright is most of the time. There are now **three** hooks, and the middle
  > one is between his body and his head.
- **The kibble spread was widened** (`wide` 1.12–1.22, mound rx 21→23.4) so a little food still
  reads around his muzzle. Safe by construction now: the contents are painted before he is and can
  no longer land on his nose whatever their extent. Cosmetic, and the only art change here.
- **`sw.js` 8.1.0 → 8.2.0.** No file was added or renamed, so `PRECACHE` is untouched and
  `tools/check-precache.py` still reports 49 entries matching the tree — but three modules changed,
  and a compositing fix served from the old cache ships to nobody.
- **The gate's own first cut was wrong twice, and both are worth recording.** It used
  `isPointInPath` for the near-rim footprint; that returned false for every pixel, silently driving
  `R` to 0 and making `F` count the rim itself. It now rasterises the path and reads the mask back.
  Before that it identified the rim by `A != Bf`, which also caught the **water drips** — they are
  drawn inside `drawFront` too — and mis-scored 132 drinking frames. A gate that fails in the
  reassuring direction is the exact failure mode this section exists to document.

### 19.5 The depth seam: the split moves between his body and his head

§19.2 was reverted. It has now landed again, at the right depth.

**What the human saw the second time.** "now the bowl looks like it is partially inside the dog" —
with a screenshot of him sitting upright after finishing, the placed bowl in front of him at floor
level, and its upper/far portion hidden behind his chest. §19.2 was correct in intent (the food used
to be painted over his muzzle) and correct to split the vessel. It hooked the far half in through
`care.drawBehind`, which runs *before the whole dog*, so the far rim, the interior wall and the food
were composited behind his **torso** as well as his head.

**Why nobody caught it, and this is the part that matters.** Every render checked for §19.2 was an
*eating* frame, where the defect is invisible: his head is down over the bowl and his body is up and
behind it. The upright/"full" state with a bowl on the floor — the most ordinary state a bowl can be
in — had never been rendered by anyone. The gate in §19.3 was sound and passed honestly; it simply
only ever looked at the muzzle and the well, and the defect was in his chest.

**The correct model.** The bowl stands on the floor *in front of* him, so it is nearer the camera
than his torso. Therefore: nothing on his torso may ever occlude any part of the bowl, and the only
thing that may is his muzzle, while it descends into the vessel.

**The fix: `dog/draw.js` publishes a depth slot.** `draw(g, pet, mood, coat, mid)` calls `mid(g)`
between the body pass and the head pass, in the *caller's* coordinate space:

```
tail, hind legs, haunches, body, tail root, neck, FRONT LEGS, ruff, collar, chest shadow
                              -> mid(g) <-
                       head, muzzle, ears, face, furnishings
```

`care.drawBehind` splits in two accordingly. The fur pile stays under all of him (a pile of shed fur
on the rug really is behind his paws); the vessel, its interior, its far rim and the food move to
`care.drawMid`, which `scenes/room.js` hands to the slot. `care.drawFront` is unchanged, so the near
rim still comes back over his muzzle and the nose still sits *between* the two halves — the eating
composite of §19.2 is preserved exactly, because the head's relationship to both halves never moved.
Only the torso's did.

Chosen over the cheaper alternative (gate the split on the pose, drawing the whole bowl in front of
him while he is upright) because that has a switch point, and a switch point in compositing is a pop
waiting for the one frame nobody rendered — which is the mistake being fixed. The slot is right at
every pose and every intermediate frame, and it is the general answer for any prop at chest depth.

**It is a pure reordering.** The slot swaps only the transform matrix (`getTransform` /
`setTransform`, with an arithmetic fallback) and touches no other context field, so nothing about
how any part of him looks on its own can move. `tools/dogalone.py` proves it rather than arguing it:
the pre-fix tree and this one are served side by side, the same script is run in both with all three
care prop layers suppressed, and the whole canvas is SHA-256'd every frame.

**The gate that would have caught it: `tools/bowlpixels.py`.** Two things §19.3's gate did not do.

1. It drives the **whole action** and asserts on **every frame** — placed-and-upright, pouring,
   approaching, eating/drinking, licking/shaking, **finished and sat back up**, fading, at rest —
   for all three breeds and both feed and water. Not a sample.
2. The assertion is **no pixel of his torso may survive inside the bowl's outline**. The slot is
   its own probe: `R` (before the dog), `M0` (top of the slot: room + torso), `M1` (bottom of the
   slot: + the far half) and `A` (final) are all grabbed from one real render, so nothing drifts
   between them. `torso(p) = M0[p] != R[p]`; the defect is `torso(p)` and `A[p] == M0[p]` — his body
   painted it and nothing ever painted over it.

`--old` re-creates §19.2's order on the same frames, so the gate proves it can *see* the defect
rather than merely failing to find it.

Three things learned while writing it, all recorded because each made the gate lie for a while:

- A mask built from geometry alone kept testing a **phantom** bowl after the action closed and the
  bowl had gone, reading the dog standing where a bowl used to be as ~20k defective pixels. The mask
  is now the published silhouette ANDed with the bowl the game actually drew, from
  `care.debug.bowlDraw` — empty exactly when there is no bowl on screen.
- Laying that bowl down at the care fade's own alpha meant that at alpha 0.993 only the
  double-painted rim overlap reached 255, silently shrinking the mask to a third of the bowl on
  precisely the "placed, upright, not yet eating" beat. The fade is now one frame-level gate, not a
  per-pixel one.
- A pixel the far half demonstrably repainted cannot be a depth defect whatever colour the final
  image ends up — the shiba's cream chest against the bowl's cream ties on a handful of pixels per
  frame. Those are counted and named as colour ties instead of being folded into either answer.

**`sw.js` 8.2.0 → 8.4.0**, not 8.2.1: the revert shipped as 8.3.0, so the generation has to land
above what is live or the phones that took the revert would never fetch this. No file added or
renamed; `PRECACHE` still 49 entries matching the tree.

#### 19.5.1 What was actually measured

| gate | result |
|---|---|
| `tools/bowlpixels.py` (current order) | **0** torso pixels inside the bowl's outline, on every checked frame of all six actions — shiba/cockapoo/schnoodle x feed/water, 1,391–1,423 checked frames each, every phase from `place` to `finish`. Zero console errors. |
| `tools/bowlpixels.py --old` (§19.2's order, same frames) | schnoodle feed **8,641 px = 39.8%** of the bowl buried at `finish`; water **9,898 px = 45.6%**. And **0 while eating** — which is exactly why every eating render passed and the defect shipped twice. |
| `tools/dogalone.py` (lockstep, whole-page PNG bytes, DPR 3) | 830 frames per breed, all three breeds, **0 differing frames**, clocks matched. |
| dark mode | the canvas is **byte-identical** to light at both the placed-upright and the finish beat, with and without reduced motion (the app pins `color-scheme: light`). |
| frame cost, bowl split, real loop | DPR 2: median 2.0–2.2 ms, p95 3.7–4.5 ms. DPR 3: median 2.1–2.3 ms, p95 3.6–5.3 ms. Budget is 16.7 ms. Zero external requests. |
| v1–v6 saves | all six migrate, minimal and realistic, name and coins preserved; v2–v6 boot and feed with the bowl split. (v1 refuses to start care on this tree **and on the pre-fix tree** — pre-existing, not this change.) |
| offline | boots and plays with the network killed, `pp-cache-v8.4.0`, 50 entries. |

The eating composite was checked against the reference it was built to match
(the right-hand panel of `C:	mp\pp8\shots\PAIRZOOM-shiba-feed.png`): muzzle
down inside the vessel, near rim crossing in front of it, mouth and food
visible behind the rim, both front paws whole and beside it. Unchanged — which
is what the model predicts, because the head's relationship to both halves of
the bowl never moved. Only the torso's did.


---

## 20. The reachable play area (`fix/reachable-area`) — as built

**The bug he found on his own phone, and the shape of it.**

> "sometimes when flicking the ball it is behind the navigation buttons which doesn't allow
> the player to reach it again"

The reliable way to trigger it was to **hit him with the ball**. He flinches, and `hitReaction()`
deliberately drops the ball at her feet so he does not cheerfully fetch the thing that just hit
him — at a hardcoded `toy.y = 782`. On the target iPhone the nav's hit rect starts at y **730**,
and `scenes/room.js` offers a `down` to `nav.hit()` **before** `toy.pointer()`, so a touch on the
ball pressed **TRAIN**. Nothing could recover it: the unprompted retrieval only fired below
`y < 660` and `reset(true)` has no callers. **The price of an accidental hit was losing the toy
permanently** — from a dog whose whole design says he must never resent her.

Three more, found while reproducing it and not in the report:

- `T.home` = `[330, 736]`. **61% of the ball's grab ellipse was behind the bar on first launch**
  and its centre pressed **MORE**. Rendered: the ball was a sliver poking above the MORE pill.
- `drop()`'s **successful** fetch, `toy.y = 792`, was the worst of the three at **82%**.
- `BALANCE.ui.away.bringHome` at y 744, h 46 spans 721..767 against a hit rect starting at 730,
  and `walk.away` is dispatched *after* `nav.hit`. **37 of its 46 units opened Training or Walk.**
  Tapping "Bring him home" opened Training.

### 20.1 Why a number was never going to fix it

The nav's top edge is not a constant. It is derived from `env(safe-area-inset-bottom)`, so it is
y **768** on a phone with no notch and **734** on the target iPhone — a 34-unit range — and stage
9 moved it again by taking the bar from eight pills to five and `h` from 58 to 60. Three hardcoded
ball positions were being compared, by nobody, against a line that moves with the device *and*
with the design.

This is 18.2's lesson in a second place. `rig.floorV` fixed it for the floor by publishing one
line everything resolves against; **`src/ui/reach.js` does the same for the bottom of what a thumb
can touch.**

### 20.2 Two lines, deliberately not one

| | `rig.floorV` | `reach.bottom` |
|---|---|---|
| question | where things **stand** | where a thumb **stops** |
| space | room, fake perspective | view |
| varies with | breed (719.8-723.1) | device inset (+/-34) |
| role | an **anchor** to author against | a **bound**, nothing else |

They cannot be merged, and the reason is the interesting part: **on the target phone the bound is
above the floor.** `reach.bottom` is 722, `rig.floorV` is 719.8-723.1, and once a prop's hit
radius comes off that, *nothing can sit on the floor toward the viewer and still be touchable*.
The foreground below the reach line belongs to the nav. So the sharing is a **contract** rather
than a merge: props are authored as offsets from `rig.floorV` and every one is passed through
`reach.clampY()` before it is written. Where there is room the authored design is byte-for-byte
what it was; where there is not, the bound wins.

`ui/nav.js` imports `navFaceTop()` and `navRect()` from `ui/reach.js` rather than keeping its own
copy, and `nav.hit()` tests the same rect the props are kept out of. That is the part that makes
this hold rather than merely fix today's numbers.

### 20.3 The per-frame assertion

Every module owning something touchable registers a probe (`reach.watch`), and `reach.tick()` —
called in `room.update` **after** the state machines have written this frame's positions and
before anything draws them — runs the lot and accumulates the worst overlap per prop-and-state.
It **never logs and never throws**: a console error in her hands is worse than the defect it would
report. `window.__pp.reach.report()` is what the gate reads; `snapshot()` is every prop's rect this
frame whether or not it offends.

`liveHits` counts props the nav can **actually** steal. `anyHits` also counts props on surfaces
where the nav is absent — the placed bowl, floor-anchored by four consecutive bowl fixes, is the
honest exemption and is reported as a number rather than asserted away in a comment.

### 20.4 What the assertion caught that the eye did not

1. `createToy` ran during `scene.enter` and captured `restY('home')` against the **boot-time**
   bound. A real phone can deliver the inset later (rotation, Safari chrome settling), so at inset
   40 the ball sat 26 units inside the bar until something dropped it. The same defect one layer
   up. The clamp is now re-asserted every frame in the states where the toy owns its position.
2. Clamping the **care** props' drag range to the reach line **killed feeding at inset 80**: the
   bowl's drop target is `rig.floorV - BOWL_BASE*scale`, which sits *below* the reach line there,
   so the target could not be reached and `placed` stayed false. Care hides the nav and takes the
   pointer before it, so the care ranges are its own business; only the two **resting** bowls the
   room draws are clamped.
3. `abandoned = toy.y < 660` was a *fourth* absolute coordinate — it meant "76 units above the
   then-hardcoded home of 736". With home derived, a ball at his feet at inset 80 read as abandoned
   and he fetched it unprompted on a loop. Now `BALANCE.toy.awayAbove`, relative to the home slot.

And one the assertion could not catch, which only rendering found: with the slots lifted above
`rig.y - 8`, `room.js` sorted a ball dropped at his feet **behind** him, and at `rig.x + 44` it
vanished into his silhouette. Reachable and invisible. The sort line is now `toy.restLine`.

### 20.5 What was measured

| gate | result |
|---|---|
| reach gate, insets **0 / 20 / 40 / 80**, every prop state (`C:\tmp\pp11\reachgate.py`) | ~2,900 audited frames each. **`liveHits` 0 at every inset.** Zero page errors, zero console warnings, zero external requests, zero 4xx. |
| flinch reproduction | before: ball at (222, **782**), 82% of its grab ellipse inside the bar, tapping its centre opened **TRAIN**, ball invisible in the render. After: (222, **694**), `reachClear` 0.00, a real pointer at its centre **picks it up** (`heldOnTap: true`, `navActive: ""`). |
| dragging it under the bar on purpose | a drag to y=843 lands at 694 and is still pickable, at every inset. |
| the throw, unregressed | `fly -> chase -> back -> settle` all reached at every inset; lands up-screen at (314, 470); tease -> **refuse** still fires. |
| bowls, `C:\tmp\pp8\bowl3.py` (cloned to run against this tree), 3 breeds x feed+water, **at inset 0 and again at inset 40** | all of A-G **PASS**, ~975-1,024 frames each. `standToEatShift` **0.0**; `muzIntoBowl` **18.0-18.8**; base on the live drawn sole **-0.588 .. +0.012** against a 1.5 tolerance; `scale == rawScale`; wash and brush unregressed. Identical numbers at both insets. |
| frame cost, real loop, inset 40 verified | DPR 2: median 2.4-3.1 ms, p95 3.7-4.4, max 4.9. DPR 3: median 2.2-2.6 ms, p95 3.3-4.1, max 4.2. Budget 16.7 ms. |
| cost of the assertion itself | `reach.tick()` **0.68-1.68 microseconds** per call over 20,000 calls with 3 probes - about 0.01% of a frame. |
| `prefers-reduced-motion` / dark mode | boot clean, `reach.bottom` 722, `liveHits` 0, ball at (330, 694). |
| v1-v6 saves | all six migrate to v6 through the real `load()` path, keep "Mochi" and her affection, and **the ball is pickable on every one**. |
| `tools/check-precache.py` | OK, 52 entries, matching the tree. Cache **8.7.1**. |

### 20.6 Left imperfect, stated plainly

- **The four resting slots collapse to one depth on a notched phone.** `feet` (+70), `flinch`
  (+60), `own` (+26) and `home` (+14) are offsets below `rig.floorV`; at inset 40 the bound binds
  and all four land at 693.84. The x offsets still carry "she gave it to you" versus "she kept it";
  the y nuance is gone. It is not recoverable — the foreground below the reach line is the nav's.
- **The placed bowl overlaps the nav's rect above about inset 61.** Its base is pinned to
  `rig.floorV` and must stay there (four bowl fixes). Care neither draws nor hit-tests the nav, so
  nothing is stealable; it is reported as `anyHits`, never `liveHits`. No shipping phone reports
  an inset near 61.
- **The dog's own paw and belly petting zones still overlap the bar** by about six units at their
  bottom edge, and `pet.down` is dispatched after `nav.hit`. He is not a prop, he cannot be lost,
  and his placement is the room's whole composition. Measured, not clamped, and deliberately not
  registered as a probe — a `live` flag that fails on the dog would make the gate mean less.
- **"Bring him home" moved from y 744 to 699**, which is the lowest legal position for it, and it
  now sits over the lower part of the dent in the rug — a thing `BALANCE.ui.away`'s own comment
  says it was moved *down* to avoid. There is no y that both clears the bar and misses the dent.
  At 744 it also visibly overlapped the pill row, so 699 is better on both counts.
- **Dropped walk finds land clear of the bar (y 702) but are still drawn in `walk.drawBack`**, i.e.
  behind the dog, and they land at x 196+/-34 which is inside his silhouette. Whether one is
  visible depends on the glyph (a stick pokes out; a feather does not). **Pre-existing** — at the
  old y 726 they were behind him *and* half under the bar — and deliberately not changed here,
  because reordering the walk's draw passes late would put the carry arc at risk.

---

## 21. Training clarity (`feature/training-clarity`) — as built

Queue items 1 and 1b, which are one defect seen from two sides: **the training screen never
said what it contained.** Sit and lie down were the same gesture told apart by hidden state, and
the eight teaching prompts only ever surfaced as a ghost figure that cycled round after three
seconds of stillness. He did the gesture and could not tell what he was teaching.

Cache **8.8.0** — `src/ui/tricklist.js` is a new module and `scenes/room.js` imports it
unconditionally, so a phone that took this generation without it in `PRECACHE` would resolve the
import online and get a blank screen on a plane. `py tools/check-precache.py` expects 53.

### 21.1 The lie-down is its own shape now

| | guide | what she draws |
|---|---|---|
| `sit` | `headDown` | down over the top of the head, and stop |
| `lieDown` | `headSweep` | down over the head, then **out to one side** — an L |

**And the posture disambiguation is deleted, which was the point.** `headDown` means sit from any
posture; if he is not standing it returns `need: 'stand'` rather than quietly meaning a different
trick. `headSweep` means lie down from any posture, and `chainFor` sits him on the way, because a
chain is him getting into position and not a lock. `teachable()` therefore offers the lie-down
from a stand — the one deliberate widening; nothing else moved.

`GUIDE_NEEDS` (`dog/train.js`) is the new single answer to *what the gesture needs*, which is not
what the trick needs: `sit` wants a stand, `rollOver` and `playDead` want him already on the
floor, and the other five are readable from anywhere. `classifyGuide` returns its `need` from
that table and the trick list reads the same table, so the list and the recogniser cannot come to
different answers about what she can teach this second. That drift *is* the defect this section
is about, one level up.

### 21.2 Two failed detectors, because the path's points are not kept

`cap` stores displacement and travel, not a point list, so "find the corner of the L" has to be
done incrementally. Both first attempts failed, and the way they failed is the useful part:

1. **Elbow = the first point `fall` units below the start.** On a real stroke that is near the TOP
   of the descent, so the rest of the fall counted against the flat leg: a clean 69-down-60-across
   L measured `fall 13.8, drop 55.3, flat 60` and was rejected for 60 < 55.3 x 1.15.
2. **Elbow = the deepest point, frozen once the hand moved sideways from it.** The flat leg runs at
   *constant depth*, so every segment of it tied the deepest point and dragged the elbow along
   underneath the finger. The sideways distance from it was always zero; the corner never latched.

So the corner is not measured. **The shape is: it started over his head, it fell, and it finished
out to the side** — `fall 13`, `flat 17`, and `outShare 0.5`, which is what keeps a sloppy sit out.
Measured: a sit drawn with up to **34 units of sideways drift over a 69-unit fall is still read as
a sit**, which is more tolerance than a player will ever use.

### 21.3 The trick list

`ui/tricklist.js`, opened by a pill in the training chrome, closed by Done, by the backdrop, or by
anything that leaves training (derived from `train.modal`, not called from each of those sites).
Four lines per row, and a fifth when it applies:

    name          "Lie down"
    what he does  "He folds onto his front, head still up"    <- TRICKS[id].does(P), NEW
    how to ask    "Stroke down over the head, then out to one side"
    how well      "learning"   <- BALANCE.train.words.level, the SAME five the legend uses
    why not now   "He needs to be lying down first"   <- only while the posture is wrong

**No bars and no counts.** "0/8 learned" would turn a thing she does with him into a completion
list. Nothing is greyed out either: a trick he could do two seconds from now is not locked, so the
row's face stays lit and the reason sits underneath it in a quieter ink.

`train.lessons()` is the new interface — deliberately **not** `repertoire()`, which hides
everything he has never done because a judge may only ask for what he knows. Answering both
questions from one call would have quietly widened what a trial can ask for.

`does` is a function of `game.pron` (it cannot be said without a pronoun); `hint` stays a plain
string (an instruction to her never names him). The roster self-check now fails at load if a trick
ships without either, on the same principle as the `BALANCE.train.roster` check: a trick with
nothing to say in the list is one she can never find out about.

### 21.4 Three defects found by rendering it, not by measuring it

Every one of these passed the gate before it was looked at.

1. **The untaught rows said "He has not tried this one yet" instead of what he does.** On first
   open all eight rows said that and not one said what a trick *was* — the original defect wearing
   a new coat. The right-hand word already carries "new".
2. **The hint line lagged the ghost by a whole cycle** (`if (!hint || hintT > T.hintCycle)`), so
   the lie-down's L was drawn under *"Stroke down over the top of the head"*. Two lessons that look
   alike is the defect; saying the wrong one out loud is the same defect with more confidence. The
   words follow the figure now.
3. **The L was drawn across his muzzle and read as a cross on his face.** The corner moved below
   the chin so the flat leg crosses the cream of his chest, where a dotted line can be seen. Both
   versions measure identically; only one of them can be read.

And one the gate found: **the ghost hint switched itself off permanently** the first time she
taught him anything. It tested `!perf`, and `perf` is left in place — done — for the result to be
read off it. So the one piece of discoverability the screen had was gone for the rest of the
session after the first lesson, which is half of why the roster was "just a guessing". It now
tests `!(perf && !perf.done)` and is suppressed only while he is mid-answer.

### 21.5 The pill claims a touch that starts on it and nothing else

Everything below the signal pad is inside his halo, and the lie-down's flat leg sweeps across
exactly that band. A button that swallowed `move` and `up` as well — which is what the call bubble
does, because a bubble is only ever tapped — would throw away any stroke that happened to end over
it. `down` only, and only when no stroke is already in flight.

### 21.6 What was measured (`py tools/traingate.py [--shots]`)

**59 checks, 0 failures, three consecutive runs.** The gate is IN THE REPO, unlike the reach and
occlusion gates, which live in `C:\tmp` and so cannot be re-run by anyone, including whoever wrote
them. `tools/_drive.py` is the shared driver; it uses the system Chrome, because this machine's
network refuses Playwright's own browser download.

| check | result |
|---|---|
| the collision, from all three postures | `headDown` never yields `lieDown` in any posture; from a sit or a down it returns `need: 'stand'`. `headSweep` yields `lieDown` from all three. |
| the boundary | a sit drifting sideways stays a sit to **34 units** over a 69-unit fall |
| the whole ritual, all 8 tricks | a real gesture path plus a real reward lands a rep for every one, with one cue each |
| the trial | `perform('lieDown', {judged: true})` still answers by id, bypassing cue interpretation |
| the list | 8 rows, every one with name + does + hint + level word; standing, only `rollOver` and `playDead` say he needs to be elsewhere; lying down, only `sit` does |
| Done, at insets **0 / 20 / 40 / 80** | bottom at 734 against floors of 844 / 824 / 804 / 764; rows never below 78 tall |
| reach gate (ARCHITECTURE 20) | `liveHits` **0** over 6,934 audited frames, with the pill and the list live |
| frame cost, list open, real loop | median **1.40 ms**, p95 2.70, against 16.7 |
| errors / network | zero page errors, zero console warnings, zero external requests |
| looked at | `review/train-screen.png`, `train-tricklist.png`, `train-ghost-sit.png`, `train-ghost-lieDown.png` |

Three things in the gate itself were wrong before they were right, and all three would have
reported a green screen while measuring nothing:

- it posed him by stepping a fixed number of frames, but `posture` is derived from the rig's
  springs and lags the request;
- it drew the next stroke while he was still owed a treat, and a touch then **is** the treat
  (dog/train.js says so at the top of `pointer`, and is right), so the recogniser never saw it;
- the install card became eligible partway through, correctly took the surface, and swallowed a
  stroke — which read as a flaky failure that moved between runs until `dogTouches` showed the
  touch never reaching the recogniser at all.

`train.debug` gained `lastGuide`, `guidesRead` and `dogTouches` for exactly that: what the
recogniser made of a stroke used to be inferable only from the performance that followed, by which
point it had already been acted on.

### 21.7 Left imperfect, stated plainly

- **A diagonal counts as a lie-down.** The detector asks only that the stroke fell and finished out
  to the side, so one long diagonal from his crown to his shoulder reads as the L. It is forgiving
  in the direction a player would want, and the rival gestures are safe (a sweep across the body
  starts on body zones, not the head), but it is not the figure the ghost draws.
- **The ghost is still faint on fur.** `hintAlpha` is 0.34 for all eight figures and was chosen by
  looking; the L is legible over his chest at that alpha and was not over his muzzle, which is why
  the geometry moved rather than the alpha. In one still frame the two vertical legs look alike —
  it is the travelling fingertip that sells the corner, and a still cannot show that.
- **`lessons()` is rebuilt every frame the panel is open**, because the posture line is live. Eight
  objects and eight strings per frame against a 1.40 ms frame; the eight rows of type drawn beside
  it cost far more.
- **The hint copy says "out to one side" rather than "along the floor"**, which is what the real
  hand signal does. On a frontal rig the flat leg is drawn at his chest, and a fall all the way to
  the rug would need a sideways sweep wider than the screen to clear `outShare`. The words describe
  what she can actually draw.
- **Nothing here has been on the phone.** Blocker 1.7 still gates this as it gates everything.

---

## 22. Per-dog time (`feature/per-dog-time`) — as built

Queue items 4 and 7, which are one root cause: **the save tracked time once, and it needed to
track it twice.** `lastSeenAt` answered "when was the app last open?" and was then used to answer
"how long has she been away from this dog?" — a different question with a different answer the
moment there are two dogs.

Cache **8.9.0**, schema **v7**.

### 22.1 Two clocks, because there are two questions

| clock | answers | advances |
|---|---|---|
| `state.lastSeenAt` | when the app was last open | every launch, for everybody |
| `dog.lastSeenAt` | when she was last with **this** dog | only for the dog in the room |

`markSeen()` stamps both, and is the only thing that does. `switchDog()` stamps the dog she is
**leaving** and deliberately not the one she is arriving at — stamping the arrival there would
destroy the very number the greeting is chosen from, which `scenes/room.js` reads on the remount.

### 22.2 Needs pass for every dog; the bond does not

`applyElapsed` and `decayLive` now go through `addNeedAll` / `addGlossAll` rather than `addNeed`,
which resolved to `dog()` and so only ever touched the one in the room. The distinction is the
whole of item 7, and it was reported as a *feature* first time round:

- **Needs are physical and recoverable.** They should pass with time for every dog, and a bowl of
  food fixes them in seconds. Freezing them made the second dog a doll rather than an animal.
- **The bond is emotional and not recoverable.** Affection, the ratcheting floor and trust are not
  in `addNeedAll` and must never be. "He never resents her" was never "nothing changes while she
  is away"; it was "the relationship is never taken away from her".

The 36-hour cap binds for the inactive dog exactly as for the active one — measured, both dogs
identical at 36 hours and at 14 days.

### 22.3 The reunion runs on the longer gap

`applyElapsed` returns `hours` as **max(app gap, this dog's gap)**, with `appHours` and `dogHours`
kept separate because the decay and the day boundary are computed from the app's clock and would
be wrong if they quietly took the longer one.

And the beat now fires **on a swap**, which is where item 4 actually bites: play with the Cockapoo
daily for a fortnight, pick him up, and he gets the reunion the absence earned rather than the
warm one-liner that was the only thing a swap could produce. Measured: app closed 12 minutes,
his own gap a fortnight, and the switch plays the reunion at **k = 0.48**. Switching to a dog she
was just with stays a quiet hello.

### 22.4 A duplicate key that was silently the loser

The per-dog stamp was written as a second `markSeen` in `createGame`'s api literal, forty lines
above the `markSeen` that was already there. **A duplicate key in an object literal is the last
one, silently**, so the new method was dead the moment it was typed: the reunion fired, the clock
never advanced, and nothing anywhere said so. Caught because the gate asserted the stamp rather
than trusting it. One method now stamps both clocks, and a sweep for other duplicate api methods
came back empty.

### 22.5 Schema v7, and the one real migration risk

Every dog gets `lastSeenAt` **seeded from the app clock**. That is the only seeding that cannot
lie: an old save genuinely does not know when she last picked up each dog, and seeding 0 or
`bornAt` would fire a full-intensity reunion for a dog she had been playing with a minute before
she updated. Seeding from `lastSeenAt` means the first launch after the migration greets everybody
exactly as the old build would have, and the clocks diverge from there.

### 22.6 What was measured (`py tools/timegate.py`)

**20 checks, 0 failures.**

| check | result |
|---|---|
| a day away, both dogs | hunger 0.820 → 0.196 and thirst 0.860 → 0.000 for the active dog **and** for the one she is not looking at |
| the bond, both dogs | affection never below the floor, at any gap |
| the 36-hour cap, both dogs | 14 days is bit-identical to 36 hours (0.0640) |
| the reunion on his own clock | app shut 0.20 h, his gap 336 h → reunion plays at k 0.48, and his clock is stamped once he has been seen |
| a swap that is not an absence | quiet hello, no beat |
| v6 → v7 | migrates, keeps name/coins/affection, and every dog lands **5 minutes** of gap — the app clock — rather than an invented fortnight |
| v1…v7 | all migrate to v7 through the real table |
| the training gate | 59/59 still pass |

### 22.7 Left imperfect

- **The inactive dog's needs advance on the app's clock, not his own.** Offline decay uses the app
  gap for everybody, so a dog she has not picked up in a fortnight is exactly as hungry as the one
  she plays with daily. That is deliberate — the cap makes both of them "hungry" long before the
  difference could matter, and giving each dog his own decay clock would need a third timestamp to
  avoid double-decaying. Revisit only if a third dog ever exists.
- **A swap does not re-run `applyElapsed`.** The needs decay that happens on a swap is whatever the
  live decay has accumulated, which is nothing much. Correct today, because a swap does not
  advance the wall clock, but worth remembering if a swap ever becomes something she does after a
  long absence inside one session.
- **Nothing here has been on the phone.** She has two dogs only if she has saved 400 care points.

---

## 23. The collection (`feature/find-collection`) — as built

Queue item 6, which was two complaints wearing one coat: **the room had no storage, and most
finds had no purpose.** Walks worked — he goes out and comes back carrying something — but only
the four toy finds were ever usable, and the room drew the last seven distinct finds and silently
dropped the rest. So the collection filled up and then began losing things out of the back, and
"some finds are real and some are litter, with nothing telling her which".

Cache **8.10.0**, schema **v8**, new module `src/ui/collection.js`.

### 23.1 Every find now answers "what is this for"

| kind | count | purpose |
|---|---|---|
| toy | 4 | he fetches it — already true, untouched |
| photo | 4 | a dog he met, named in the album with **where** they met |
| flower / keep / gift | 9 | it is nice to look at, and she chooses whether it is out |
| **any duplicate** | — | a few coins |

The duplicate rule is the one that retires the word "litter". `rollFinds` paid `dupCoins` only for
a duplicate **toy**, so a second daisy or a second photo of the same beagle was worth precisely
nothing — and SCOPE stage 5 had already said coins come from "contest placings; selling walk
finds". Now every duplicate sells, which means the second walk down the same road pays *more* than
the first (measured: 10 coins → 16).

Fresh finds still come first: an owned find is weighted to `ownedWeight` 0.45 rather than removed.
Removing them would make a completed collection stop paying out and would have the woods hand back
things the woods do not have.

### 23.2 The sill is hers to arrange

`walks.display` is the list of what is standing on the window sill, in her order, capped at
`onShow` 7. Tapping the sill in the room opens the panel; tapping a thing puts it away, tapping a
thing in the box puts it out. A full sill **refuses politely** rather than pushing the oldest thing
off the end, which is the behaviour that made the old room feel like a floor filling up.

A new find goes out by itself if there is room, so she never has to open a panel to have a room
worth looking at — but it never displaces anything. Toys and photos are deliberately not shelvable:
a toy lives on the rug because that is where a toy is, and a photo is in the album. Before this
they took ornament slots, which is why nine finds could fill a seven-slot shelf and leave nothing
visible from the last walk.

`walk.COPY.shelfEmpty` / `shelfSome` were written for this tap in **stage 4** and had never been
wired to anything at all.

### 23.3 The album

`metDogs` walks the dated log and `unlocks.items` together, so a meeting older than the 40-entry
log cap is still in the album; each row names the dog and the route he met them on. The queue asked
for exactly this and said why: "an album of dogs he met is a lovely thing; an anonymous flower on
the rug is not."

### 23.4 A dead `setInset`, found by asking a panel what it knew

The gate checks Done against the safe area at four insets. Chasing a failure there turned up
something bigger: **`loop.resize()` was never called after `mount`**, and `scene.resize` is the only
thing that hands the safe-area inset to a panel. So `setInset` had been dead for the whole session
for `ui/sheet.js`, `ui/shop.js`, `ui/kennel.js` and `ui/tricklist.js` — on a phone held one way up,
nothing ever fires `resize`. Every one of them clamps *against* the inset rather than laying out
from it, which is why it never looked broken: the failure is a Done button or a bottom row up to 40
units lower than it should be, and it only bites on a notched phone. One `loop.resize()` after
mount fixes all of them.

The gate's own inset lever was wrong in the same shape, and worse, because it silently turned every
"at inset 40" claim in this project into "at inset 0": it set the probe's padding from an init
script on `DOMContentLoaded`, and a **module script is deferred**, so `main.js` runs first with
`readyState === 'interactive'` and had already measured the probe. `tools/_drive.py` now sets the
padding and dispatches a real `resize`, then asserts the game read the value back.

### 23.5 Three defects found by rendering it

1. **"ON THE SILL" was drawn on top of the stitched divider** — the section label was positioned
   relative to the shelf below it rather than to the header above it.
2. **Every name in the box was painted through its glyph.** A find is drawn from about 20 units
   *above* its anchor to 11 below (`drawSill` puts the contact shadow at +11), so the anchor is near
   the base and "centre it in the slot" is the wrong instinct. Nudged twice, then measured.
3. **The panel was full-height like the shop**, which with two things in the box left two thirds of
   the screen as an empty cream field and Done stranded in the middle of it. It is now as tall as
   its contents, clamped to the screen — a real bottom sheet.

And one in the harness: the boot veil is lifted by a **CSS transition**, which runs on real time
and does not care that rAF is stubbed, so a prompt screenshot caught the splash still half over the
game. It is removed now rather than faded.

### 23.6 What was measured (`py tools/findsgate.py [--shots]`)

**28 checks, 0 failures.**

| check | result |
|---|---|
| duplicates | the same route walked twice pays **more** the second time; non-toy duplicates are among what pays |
| the sill | fills to 7 by itself and stops; the overflow waits in the box; a full sill refuses |
| toys and photos | never take an ornament's slot |
| arranging | put away → in the box; put back → on the shelf; the room draws exactly that |
| the album | every dog he met, named |
| the tap | tapping the sill opens the panel with the same arrangement the room shows |
| insets **0 / 20 / 40 / 80** | the panel is told the inset (0/20/40/80 read back) and Done is inside the safe area at all four |
| v7 → v8 | seeds `display` with the seven things the room was already drawing |
| v1…v8 | all migrate to the current schema |
| the other gates | traingate 59/59, timegate 20/20 |
| looked at | `review/collection.png`, `review/collection-room.png` |

### 23.7 Left imperfect

- **A name in the box sits close under its glyph.** Legible and no longer overlapping, but the
  bell's clapper nearly touches the type. The glyphs were drawn for a shelf 16 units tall, not for
  a labelled slot, and giving them a proper bounding box is a `scenes/props.js` job rather than a
  layout tweak.
- **Nothing is wearable.** A red ribbon and a little brass bell are obvious collar accessories, and
  `dog.wear.accessory` and `inventory.accessories` already exist — but nothing renders an accessory
  yet, so making them wearable would promise something invisible. Deliberately left; it is the
  natural next thing if item 6 gets a second pass.
- **Selling is automatic, not a choice.** A duplicate becomes coins at the moment he brings it
  home; she never decides to sell a keepsake. That is deliberate — a "sell this thing he found you"
  button is a different game — but it does mean the coins arrive without a story.
- **The sill is one shelf.** Nine ornaments and seven slots means two things are always in the box.
  A second surface (the mantel, the floor by the bed) is where this goes next, and it belongs on
  the care-point decor ladder rather than here.

---

## 24. Four more things in the shop (`feature/shop-stock`) — as built

Queue item 2, under the rule the item itself sets and which is the binding one: **every item must
do something.** Stage 6 cut two unlock rows for being empty, on the principle that an earned reward
that does nothing is worse than one never promised. So the work here is four *effects*; the rows
are the easy half.

Cache **8.11.0**. No schema change.

| row | cost | what it actually changes | where |
|---|---|---|---|
| The good kibble | 65 | each mouthful fills **1.45×** as much of him | `dog/care.js` feed |
| A detangling comb | 80 | brushing a **curly** coat gains gloss **1.7×** — and nothing extra on a short one | `dog/care.js` brush |
| Rose soap | 70 | gloss decays at **0.55×** per hour away | `state/time.js` |
| A rope tug | 50 | he brings it back **less** and settles down to tug it **more** | `dog/toy.js` |

### 24.1 The comb is gated on the coat, which is the honest version of the note

"For a curly coat the brush cannot reach" would be a lie if it were a flat multiplier, so it reads
`rig.breed.fur.type !== 'short'` — the breed's own declaration, not a breed-id special case. Two of
the three breeds are doodles and the soft brush was tuned on the Shiba, so the comb is *for* them.
On the Shiba it is deliberately no better, and the gate asserts that too.

It also takes the **best** tool rather than the product of them: owning the brush as well must not
double anything.

### 24.2 The rope tug is the first toy that behaves like itself

`rollOutcome` weighed mood, trust and energy and knew nothing about the object, so "a new toy" was
a new silhouette and nothing else. `BALANCE.toy.kinds` is a table of multipliers on the three
weights, defaulting to 1 — so every toy that shipped before behaves exactly as it did, and the ball
is deliberately **not in the table at all**. A rope tug is for tugging (fetch ×0.55, chew ×1.9); a
stick is the opposite (fetch ×1.25); a squeaky duck is somewhere between.

The weights are now computed by one function that both the roll and the debug block read, because
a gate that samples forty throws is measuring the RNG as much as the design. Measured on the rule
itself: fetch share **0.298 → 0.134** from ball to rope, chew **0.425 → 0.662**.

### 24.3 Twelve rows, and the shop still does not scroll

The no-scroll rule is a design constraint with arithmetic behind it, so the arithmetic moved with
it: header 62 + 12 × **54** + Done 40 + 8 of gap = **758**, against a floor of 804 on the target
phone. At the old row height of 58 the twelfth row left six units, which is not a margin.
**The catalogue is now full** — the next thing added has to replace something, and that is written
into balance.js beside the number.

### 24.4 Two gate bugs worth recording, because both would have passed as truth

1. **"Ten million coins bought four care unlocks."** They did not: `buyItem` reports a refusal as an
   *object* — `{ok: false, reason: 'unlock'}` — which is perfectly truthy, and the check was
   `!!buyItem(id)`. The same call reported the coins untouched in the very same result. The check
   now asserts the **state**: not one coin moves, and nothing enters the inventory or the unlock set.
2. **"He brings the rope back less often than the ball" — from a sample of nothing.** Forty throws
   per toy took ten minutes and returned `{none: 40}` twice, because the loop watched for an
   `outcome` that had already been cleared. And when it was replaced by reading the odds, the stick
   came back *lower* than the ball: `setActiveToy` refuses an id that is not in `inventory.toys`
   and refuses it **silently**, so the gate had compared the rope tug against itself. The debug
   block now publishes `variant` — what he is actually holding — and the gate asserts it.

### 24.5 One defect found by rendering it

**The rope tug appeared on the shelf as a striped ball.** `glyphFor` tested `kind === 'toy'` before
any id, so the generic ball glyph won and the new art was never called. Nothing about the row was
wrong. Ids are asked first now, and the kind branches are the fallback they were always meant to be.

### 24.6 What was measured (`py tools/shopgate.py [--shots]`)

**26 checks, 0 failures.**

| check | result |
|---|---|
| the kibble | a bowl restores **0.60** of him against 0.41 with the ordinary stuff |
| the comb, curly | gloss per brushing session up **1.7×**; owning the brush too adds nothing |
| the comb, short coat | no change at all on the Shiba (within 2%) |
| rose soap | gloss lost over 12 hours away **0.0083 → 0.0046** |
| the rope tug | fetch share 0.298 → 0.134, chew 0.425 → 0.662; the stick goes the other way |
| the currency wall | 10,000,000 coins: no unlock claims success, zero coins move, inventory and unlocks byte-identical |
| no scroll, insets 0/20/40/80 | 758 against floors of 844 / 824 / 804 / 764 |
| looked at | `review/shop.png` |

### 24.7 Left imperfect

- **Rose soap and oatmeal soap are the same drawing.** `drawSoap` takes no colour, so the two rows
  differ only in their words. It wants a tint parameter, which is a props change rather than a shop
  one.
- **The comb is the brush at a different angle.** Recognisable in context, and honest about being
  the same class of object, but it is not really a comb.
- **No decor, and that is deliberate.** He asked for room decoration; it stays on the care-point
  ladder, because coins buying a nicer room is the one thing the two-currency split exists to
  prevent. The right home for it is a decor row in `economy.unlocks`, not a row in here.
- **Nothing new is wearable.** A bandana and a bow were on his list; `dog.wear.accessory` exists but
  nothing renders an accessory, so they would be a promise of something invisible.

---

## 25. A message must not obscure its subject (`feature/toast-placement`) — as built

Queue item 5, and the reason it took a new gate rather than a fix: **both reported cases were
perfectly legible.** `ui/text.js` guarantees contrast, so every text gate on this project passed
them. The defect is *placement*, which nothing was asking about.

Cache **8.12.0**. No schema change.

### 25.1 The stack lifts off its subject, and only if it is on it

`toasts.draw(g, baseY, avoid)` takes the rect of the thing the message is about. If the stack's box
overlaps it **on both axes**, the whole stack rises by exactly the overlap plus `avoidGap`, capped
at `avoidMaxLift` 96.

- **The whole stack, as one.** Three toasts keep their spacing and their order; nothing reorders or
  jumps relative to anything else.
- **Up, not down.** Everything a toast talks about is near the bottom of the screen — the bowls, the
  ball, the nav — and the room above him is empty wall.
- **Bounded.** A toast that climbs onto his face to get out of the way of a bowl has solved nothing,
  so past the cap it is better to overlap a little than to land somewhere absurd.

Only the room knows what the subject *is*, so `toastSubject()` lives there: the bowl while she is
feeding or watering him, otherwise the ball if it is lying about being interactive (not while he is
carrying or chasing it — then the message is about *him*, and following a moving ball would make the
stack jitter). Deliberately **not the dog**: he is most of the screen, and a toast that will not
overlap him has nowhere left to be.

### 25.2 Two of my own bugs, both caught by the gate

1. **It moved for things it was never on top of.** The first version compared only the vertical
   bands, so a ball resting at x 310 — well to the right of a centred 185-unit toast that never
   touched it — pushed the stack 65 units up the screen. Moving out of the way of something you
   were not covering is its own defect: the message ends up somewhere unexpected for no reason a
   player could see.
2. **The bowl's rect was a third of the bowl.** `bowlRect` was `[34, 30, 12]` — 68 units wide
   against a bowl that is drawn about 190 wide. The toast cleared it anyway, so the gate passed
   while the rect was describing something much smaller than the thing it was protecting. Measured
   off the render and corrected to `[95, 34, 14]`.

And one in the gate: its "before" case had no defect in it. It dragged the bowl from a guessed
`(300, 700)`, grabbed nothing, and left the bowl in its resting slot at x 66, where a centred toast
never covered it — so "without the rule the toast lands on the bowl" reported **0 square units of
overlap** and was correct to. It now drags from `care.debug.bowlAt` and asserts `placed` first.

### 25.3 One message, not two

Tapping **Play** set a hud hint *and* a toast that said the same thing in different words, in the
same frame — and the toast landed on the ball it was naming. The hint is the one to keep: it lives
at the top of the screen, it stays up while she works out what to do, and it cannot cover anything.
So it now carries the whole sentence and the toast is gone.

### 25.4 What was measured (`py tools/toastgate.py [--shots]`)

**13 checks, 0 failures.** Every "after" claim is paired with a "before" that reproduces the
reported overlap, because a placement gate that cannot show the defect is not measuring the fix.

| check | result |
|---|---|
| the bowl, before | the toast overlapped it by **68 square units** with the rule withheld |
| the bowl, after | **0**, having lifted 85 units — inside the 96 cap |
| the ball, before | **600 square units** of overlap |
| the ball, after | **0**, lifted 69 |
| a subject the size of the screen | lift stops at the cap and the toast stays on screen |
| three toasts | order and spacing preserved through the lift |
| tapping Play | zero toasts, one hint, and the hint says the whole thing |
| looked at | `review/toast-bowl.png` |

### 25.5 Left imperfect

- **Only two things are ever subjects.** The bowl and the ball, because those are the two that were
  reported. A walk find dropped on the rug, the leash during the prepare beat and the treat during
  training are all things a message could sit on, and none of them is registered. The mechanism
  takes any rect, so each is one line in `toastSubject()` when somebody notices.
- **The lift is instant, not sprung.** The stack jumps to its lifted position the frame the subject
  appears. In practice the subject appears at the same moment as the toast, so there is nothing to
  see — but a bowl placed *while* a toast is up will make it hop.
- **It cannot move sideways.** A subject in the middle of the screen and a short toast could simply
  sit beside each other. Lifting is one rule that works everywhere, which is worth more than a
  cleverer one that has two cases to get wrong.

---

## 26. He gives you his paw (`feature/paw-shake`) — as built

Queue item 3, which asked a question before it asked for anything: *"for tricks it should be
possible to shake the paw of the dog as a move."* Three possible readings were recorded, and two of
them are now answered:

1. **He had not found the trick.** `shake` has existed since stage 3 — order 3, guide `pawWiggle`.
   It was invisible because nothing in the game listed the tricks; the trick list (ARCHITECTURE 21)
   fixes that, and `shake` is on it with its gesture spelled out.
2. **He tried it and it did not respond.** It responds: `tools/traingate.py` teaches all eight
   tricks through real gesture paths, `shake` among them.
3. **He meant a direct interaction — tap his paw, he offers it.** That did not exist. It does now.

Cache **8.13.0**. No schema change.

### 26.1 Resolved by gesture, not by moving the zone

The item flagged the risk itself: *"his paws are currently a bad petting zone (rubbing them makes
him pull away), so a handshake affordance would need to coexist with that without muddling the
sweet/bad model."*

So the paw stays a **bad** zone and nothing about stroking changes. What changed is that a **tap**
is not a rub:

| gesture on a paw | before | now |
|---|---|---|
| rub / stroke | pulls it away, mood down | **unchanged** — pulls it away, mood down |
| tap | irritation (a poke on a bad spot) | he looks down, ears up, and **gives you his paw** |

Two different things to do with a paw, two different answers, and the sweet/bad model is untouched
— a bad zone is about *rubbing*, which is what it always meant.

`dog/pet.js` owns the physical half (the look down, the ears, the pleased kick) because it owns the
body. `scenes/room.js` plays the clip, because whether he can shake is a *training* question and the
petting layer has no business knowing about tricks. The clip is `trick.shake` — the one stage 3
already tuned — so a handshake she asked for and one he performed on cue are the same animation.

**He offers it whether or not he has learned the trick.** A puppy paws at you long before it means
anything, and discovering that is nicer than being told.

### 26.2 The bug: it charged him for the handshake

The first version was inserted above the *second* `kind === 'bad'` test in `tapReact` — the one that
picks the body's reaction — and the *first* one, four lines earlier, had already paid the bad-touch
mood dent. So a handshake cost **−0.05** and then handed back **+0.012**, and taking his paw made
him measurably less happy than not touching him at all. Caught by measuring the mood delta against
a no-touch control rather than by reading the diff.

### 26.3 What was measured (`py tools/traingate.py`, section F)

**63 checks, 0 failures** (four new).

| check | result |
|---|---|
| tap a paw | plays `trick.shake` |
| …and the mood | **+0.0102** against a control of **0.0000** |
| rub a paw | **−0.0816** — still a bad spot |
| tap the muzzle | **−0.0517** and a sneeze — the other bad spots are untouched |

### 26.4 Left imperfect

- **He does not put the paw *in* her hand.** `trick.shake` lifts and wiggles the paw where the rig
  puts it, not where her finger is. The rig has no reach-to-a-point, and giving it one is the
  side-profile-rig class of work.
- **Nothing is learned from it.** A tapped handshake is not a rep: it does not go in the trick
  ledger and it will not improve his `shake`. That is deliberate — practice is the ritual (cue,
  guide, reward), and letting a tap count would make the training screen the slower way to do the
  same thing — but it does mean the two paths never meet.
- **It has no cooldown of its own.** Tapping his paw repeatedly plays the clip repeatedly; the
  general poke/overstimulation model is what eventually damps it, and that model was tuned for
  jabbing a nose rather than for shaking a paw.
