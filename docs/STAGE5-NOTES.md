# Stage 5 — working notes (contests + economy)

Scratch file, written as I go so a connection failure loses minutes, not work.
Fold into ARCHITECTURE.md §15 at the end.

## Inherited, verified by reading

- `dog/train.js` (1923) — `perform(id,{judged:true})` calls `start()` which runs
  the obedience roll and returns `null` on `ignore`. **But `notify()` still
  fires with `outcome:'ignore'`**, so `onPerform` is the reliable channel and a
  `null` return is not "nothing happened". The judge subscribes, it does not poll.
- `perf.latency` is set at `spec.poseAt`, from `perf.t` — measured from the
  *start of the performance*, so it includes the latency roll AND any posture
  chain. That last part turned out to matter a lot; see defect 3.
- `repertoire()` filters `reps > 0`, sorts by `reliability` descending. An
  untrained dog returns `[]` — the trial must handle that warmly.
- `chanceOf()` reads `dog.aptitude.obedience` (weight 0.10). `newDog` rolled that
  from `breed.aptitude.obedience + jitter` — the breed term SCOPE.md forbids.
- `scenes/room.js` `surfaceOwner()` / `surfaceBlockedFor()` — exclusive, no
  precedence. `startCare` / `startTrain` still used PRIVATE ifs; stage 4 only
  routed `startWalk` and `openNaming` through the arbiter.
- `spendCoins` did not exist. `addTrainerPoints` existed and **nothing ever
  called it** — the care-points currency was never earned by anything.

## Decisions

### Breed is cosmetic — the fix, and what happens to old saves
`newDog` now rolls `aptitude` as `0.5 + jitter`, no breed term. `MIGRATIONS[5]`
**re-centres** rather than re-rolls: `new = clamp(0.5 + (old - breed.aptitude[k]))`,
which recovers exactly the individual's jitter and discards exactly the bias.
For the Shiba (obedience 0.40) that lifts every existing dog from a 0.28–0.52
band to 0.38–0.62. `dog/breeds.js` keeps its `aptitude` block because the
migration needs it to undo the term; nothing else reads it.

### The trial loop
Judge calls a trick out loud → a call beat in which she MAY back him up with the
cue she taught (tap **or** voice, equal status) → `perform(id,{judged:true})` →
mark the round. Assisting is always optional and always positive; a hands-off
trial is winnable (measured: 11/12 firsts at Expert unassisted vs 12/12
assisted). **Touching HIM is what is forbidden**, which is what SCOPE says.

### Never a rebuke
No demotion at any score. `ignoreCredit` is non-zero. Past the daily cap the
ring is a practice round, not a closed door. A blocked entry gate turns the
button into the fix ("Feed him first") rather than greying it out. Checked the
whole `COPY` table: **not one line describes her.**

## Defects found by driving it — all fixed

### 1. Everything I taught vanished (harness, but it hid the rest)
`__pp.teach()` sends real pointer events, and `train.pointer` only consumes them
while `train.modal`. Without `__pp.train(true)` first, every signal fell through
to the petting field: `TAUGHT: {}`, `KNOWN: []`. Added `__pp.learn/learnAll`,
which put practice on the books through the real `trickRep`/`bindCue` mutators
(resetting the per-sitting counters so the reps are full value) — ~40x faster
than driving 200 drawn frames per rep, which is what makes a 70-trial sweep
practical.

### 2. Every drawn cue was swallowed as "hands off" — CONFIRMED, then fixed
`injectCue` passed the whole time; the **pointer path** failed. The hands-off
test was a box copied from training's `halo` (`|lx|<118 && ly>-330`), and the cue
pad's centre resolves to rig-local **y = −321.6**, i.e. inside it. So she got the
"hands off" line instead of the assist, every time. Replaced with
`pet.hitZone(lx,ly)` — the same per-zone test the petting field uses — so "she
touched him" now means precisely that, and the pad could then be widened from
150–400 to 108–470. **Only a real drawn path could catch this.**

### 3. A trick with a prerequisite could never score speed marks
`perf.latency` includes the posture chain, so roll over (sit → lie down → roll)
arrived at 3.5–5.2s against `slow` = 2.90 → **zero speed marks, always**. Every
free round capped at 0.645 for that reason alone, and the free window is exactly
where deep tricks are supposed to pay. `train.js` now reports `chain` (the list
as asked, kept as `chain0` because the live one is `shift()`ed away) and
`state/contest.js chainPar()` allows for it. Free rounds went 0.645 → 0.906.

### 4. His mood collapsed over the course of a trial
Mood decays toward a baseline that a fresh dog's low affection puts at ~0.16, at
0.085/s. Measured over a Championship programme: **0.95 at the first call, ~0.25
by the last** — so the trial got harder as it went, the free window suffered
most, and she cannot pet him to fix it because that is the one thing a trial
forbids. The ring now HOLDS his mood at the level she brought him in with
(`holdMood`, `BALANCE.contest.ringLift`). It never lifts him above it, so a flat
dog still has a flat trial and the gate still gates.

### 5. Layout: the entry button was orphaned over the dog
Placed at a hard y=686 it floated over his paws with its label unreadable
against his coat, and the panel (centred 386) covered his face. The button is
now derived from the panel (`enterBox()`, one expression for the draw and the
hit test) and the panel moved to 330 so he is visible below it.

### 6. Boot failures caught by `node --check` on **.mjs** copies
`node --check foo.js` parses as a script, and two real errors only surface in
module mode: prose accidentally left outside a `/* */` (an "Unexpected template
string" from a stray backtick) and `makeSprings` throwing on spring names
missing from `BALANCE.springs`. Copying `src/**/*.js` to `.mjs` and checking
those is now the pre-flight.

## GATE 2 — scoring (`C:\tmp\pp5\gate2.py`)

### The model, exactly (state/contest.js is pure, so this is noise-free)

Grooming delta, in SCORE POINTS, signed around a Normal coat:

| coat | Gleaming | Glossy | Normal | Dull |
|---|---|---|---|---|
| Beautiful | +0.75 | +0.68 | +0.60 | +0.50 |
| Clean | +0.45 | +0.38 | +0.30 | +0.20 |
| Normal | +0.15 | +0.08 | 0.00 | −0.10 |
| Dirty | −0.40 | −0.47 | −0.55 | −0.65 |
| Filthy | −0.95 | −1.02 | −1.10 | −1.20 |

**THE HEADLINE — identical performance, different coat (gloss Normal):**

| performance | Beautiful | Clean | Normal | Dirty | Filthy | swing |
|---|---|---|---|---|---|---|
| 1.00 | **10.00** | 9.70 | 9.40 | 8.85 | **8.30** | 1.70 |
| 0.95 | **9.53** | 9.23 | 8.93 | 8.38 | **7.83** | 1.70 |
| 0.85 | 8.59 | 8.29 | 7.99 | 7.44 | 6.89 | 1.70 |
| 0.70 | 7.18 | 6.88 | 6.58 | 6.03 | 5.48 | 1.70 |

A flawless run on a NORMAL coat lands at 9.40, so **>9.60 — the Championship
win — is arithmetically unreachable on a dirty dog however well he performs.**
That is the care loop earning its place, in one number.

Holds — the share of each class's asked hold that each practice level can manage
(`holdFor` runs 0.55 → 1.45 → 2.35 → 3.25s):

| class | asks | lv0 | lv1 | lv2 | lv3 |
|---|---|---|---|---|---|
| Beginner | 0.90 | 0.611 | 1.000 | 1.000 | 1.000 |
| Open | 1.40 | 0.393 | 1.000 | 1.000 | 1.000 |
| Expert | 2.00 | 0.275 | 0.725 | 1.000 | 1.000 |
| Master | 2.60 | 0.212 | 0.558 | 0.904 | 1.000 |
| Championship | 3.10 | 0.177 | 0.468 | 0.758 | **1.000** |

Trick depth — the free window's multiplier: `sit`/`lieDown` 0.550→0.775,
`shake`/`beg`/`spin`/`jump` 0.663→0.887, `rollOver`/`playDead` 0.775→**1.000**.

### Live, end to end (Expert class, 12 real trials each)

| condition | n | mean | median | min | max | top-3 | 1st |
|---|---|---|---|---|---|---|---|
| clean+gleaming, happy, lv2, assisted | 12 | **9.72** | 9.77 | 8.75 | 9.90 | 12 | 12 |
| **FILTHY**+dull, happy, lv2, assisted | 12 | **6.50** | 6.86 | 2.31 | 7.88 | 3 | 0 |
| clean+gleaming, happy, lv2, **hands off** | 12 | 9.12 | 9.16 | 7.54 | 9.82 | 11 | 11 |
| clean+gleaming, **FLAT mood**, lv2, assisted | 12 | 6.67 | 7.00 | 3.70 | 8.61 | 4 | 3 |
| clean+gleaming, happy, **lv1**, assisted | 12 | 8.27 | 8.22 | 7.17 | 9.42 | 10 | 6 |
| clean+gleaming, happy, **lv3**, assisted | 12 | 9.70 | 10.00 | 7.36 | 10.00 | 11 | 11 |

- **Grooming, live: 9.72 → 6.50** (a 3.22 swing; 1.70 of it is the grooming mark
  itself and the rest is a filthy dog also being a *distracted* one, since
  `pressingNeed()` feeds `train.obey.distract.need`). Top-three 12/12 → 3/12.
- **Mood: 9.72 → 6.67.** Top-three 12/12 → 4/12.
- **Assisting is worth ~0.60** and is never required: 11/12 firsts hands-off.
- Depth at Expert saturates (lv2 already meets a 2.00s hold), which is why the
  ladder's discrimination lives in the top two classes — see the hold table.

Free window, Championship, maxed dog, 10 trials each:
**`sit` → mean 9.16, 5/10 firsts. `rollOver` → mean 9.89, 9/10 firsts.**
Her choice in the free window is worth four places.

### The ladder, as arithmetic (`ladderDays`, 3 entries/day)

| p(top-three per entry) | entries expected | DAYS to the Championship |
|---|---|---|
| 0.50 | 8.00 | **2.67** |
| 0.60 | 6.67 | 2.22 |
| 0.75 | 5.33 | 1.78 |
| 0.90 | 4.44 | 1.48 |

Four promotions at a top-three placing, five classes. **Days, not months.**
Prizes 100/50/30 → 200/100/60 → 300/150/90 → 400/200/120 → 600/300/180.

## GATE 3/4/5 — `C:\tmp\pp5\gate345.py` — **63 PASS, 0 FAIL**

- **spendCoins hardening**: `undefined | null | NaN | ±Infinity | 'abc' | {} | [] |
  -50 | -1e9` are all no-ops; coins never move and never go non-finite.
  Overspend refused with the shortfall reported. A negative cost is not a refund.
  **`spendCoins(null)` initially returned `{ok:true, spent:0}`** because `ok()`
  coerces and `+null` is a finite 0 — so a shop with a missing price handed the
  item over free. It now demands a real `number`, stricter than the rest of the
  file, because money is where a coercion is worse than a refusal.
- **The separation**: 10,000,000 coins unlocks **nothing** and the Cockapoo stays
  locked. 400 care points unlocks it. No `spendCarePoints`, no exchange function
  (asserted by enumerating the game API). `awardCare('contest')` = **0**. A
  finished trial moved 100 coins and **0** care points.
- An attentive day earns **220** care points against a 240 cap.
- **Migrations**: v1/v2/v3/v4 each reach v5, keep the dog/name/bond, keep coins,
  carry the points, drop `agility`, repair the obedience record, keep tricks and
  dirt and gloss and finds — and **can enter and finish a trial afterwards**
  (scores 4.61 / 7.52 / 8.33 / 8.33 — all Dirty-coat dogs, coherently).
  The aptitude re-centring is exact: `{0.60, 0.66, 0.34}` → `{0.55, 0.44, 0.44}`.
- **Surface, both directions**: the contest cannot open over naming / walk / away;
  naming, walk, care and train each **cannot** open over the contest, and the
  trial is untouched by all four attempts.

## GATE 6/7 — frames, dark mode, reduced motion

Worst rAF p95 across every beat: **16.80 ms** — vsync-locked 60fps at DPR 2 and 3.
Work median 1.6–3.0 ms, p95 ≤ 5.9 ms. One 17.8 ms work spike at DPR 3 as the
result card first fills the text-width cache; no frame dropped for it.
A whole trial completes and scores in all four light/dark × normal/reduced
combinations, zero errors, zero external requests.

**Harness lesson worth keeping:** `resetStats()` before `loop.start()` makes the
first rAF interval span the whole synchronous setup burst — it reported a
2483 ms p95. Start, settle 400 ms, *then* reset.

## The ui/text.js retrofit, finished

The brief asked for toast/hud/sheet/nav. Auditing afterwards found **nine more
`fillText` calls** in `dog/care.js`, `dog/train.js` and `ui/naming.js`, so those
are done too. **There are now zero `fillText` calls outside `ui/text.js`.**

- `care.js` hint — bare cream + a drop shadow over room art. Same defect as the
  hud hint. Solved plate.
- `train.js` cue legend — the block already had a solved plate and `drawPlate`
  *returns its colour precisely so the caller can pass it as `over`*; that path
  was documented in stage 4 and never taken. Also: the right column was
  positioned off the frame and its last glyph landed a unit or two past the
  plate's edge, which made `over` very nearly a lie — it is derived from the
  plate now.
- `naming.js` — **a real latent failure.** Stage 4 gave the title `plate:'none'`
  on purpose (a pill over the emotional centre of first launch is chrome where
  there must be none) but `plate:'none'` with no `over` guarantees *nothing*, and
  the scrim's top band resolved to only ~0.36 alpha at the copy's y — cream over
  the pale wall and the sunlit window computes to about **2.0:1**. The fix is not
  a pill: `SCRIM_A = plateAlpha('#fff3d8', '#1a0d06')` = **0.602**, and the beat's
  own scrim is drawn at that alpha. The scrim does the plate's job as art, and
  the guarantee is measured (**4.58:1**) rather than hoped for.
  Also swept: "Her new name" was a hardcoded pronoun on a male gift puppy.

Contrast, measured, worst anywhere **4.58:1** against a 4.5 target — full table
in ARCHITECTURE §15.7.

## Reproduced numbers (second independent run)

| condition (Expert, 12 trials) | mean | top-3 | 1st |
|---|---|---|---|
| clean+gleaming, happy, lv2, assisted | 9.57 | 12 | 11 |
| FILTHY+dull, happy, lv2, assisted | **6.50** | 2 | 0 |
| clean+gleaming, happy, lv2, hands off | 9.40 | 12 | 12 |
| clean+gleaming, FLAT mood, lv2 | 6.72 | 3 | 2 |
| lv1 | 8.31 | 9 | 7 |
| lv3 | 9.93 | 12 | 12 |

Free window at Championship: `sit` 9.16 / 5 firsts, `rollOver` 9.77 / 9 firsts.
The grooming and mood effects reproduce to within 0.15 across runs.

## Progress log

- [x] read SCOPE §5, ARCHITECTURE §13.2/§14.2, reference §6/§7, train.js,
      room.js, game.js, balance.js, save.js, text.js, main.js
- [x] BALANCE.contest + BALANCE.economy + the ring springs
- [x] state/contest.js (the pure model)
- [x] state/game.js — spendCoins, care points, contest mutators, aptitude
- [x] state/save.js v5 + the aptitude re-centring migration
- [x] dog/train.js — shared recogniser, boost/hurry/hold, chain reporting
- [x] dog/contest.js (the layer)
- [x] scenes/room.js wiring through the arbiter (care + train now routed too)
- [x] main.js drivers
- [x] GATE 0 boot: zero errors, zero external requests
- [x] GATE 1 a whole trial, every beat, promotion + prize banked
- [x] GATE 2 scoring: grooming / mood / depth / assist, model + live
- [x] ui/text.js retrofit: toast, hud, sheet, nav — AND care, the cue legend,
      and the naming beat. Zero `fillText` outside the helper now.
- [x] GATE 3 currencies provably separate — 10M coins unlocks nothing
- [x] GATE 4 migrations v1/v2/v3/v4 — each loads, migrates, and can run a trial
- [x] GATE 5 exclusive surface, both directions — 63/63 with gates 3 and 4
- [x] GATE 6/7 frames DPR 2/3, dark mode, reduced motion, cropped screenshots
- [x] ARCHITECTURE §15
- [x] all gates re-run green after the retrofits (63/63, 9/9, scoring reproduced)
