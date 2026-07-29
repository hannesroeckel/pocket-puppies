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
