# The profile dog — the plan, and why the first attempt was thrown away

Raised and approved on 2026-08-20, eight stages after `docs/SCOPE.md` said it would have to be:

> *"Actually I do want a side and back profile of the dogs, we even had a image with chatgpt
> generated for this as a reference. these new views would make improve the game a lot"*

Reference: [`docs/reference/side-run-cycle.png`](reference/side-run-cycle.png) — four frames of the
cockapoo bounding to the left.

Scope agreed: **the side view only, proved on one feature (the walk)**. The back view and agility
wait.

---

## 1. The first attempt, and the verdict

`src/dog/side.js` on `feature/side-profile` (`4d17722`) is a complete procedural profile dog: body,
head, one ear, muzzle, nose, eye, brow, mouth, tongue, four legs, tail, contact shadow, and a
four-key bound driven by a phase. It renders. The verdict on it, from the person it is for:

> *"that looks horrible. cant we do it from scratch wihtout the reference image?"*

**It looks bad, and the reference is not why.** The mistake is one line of judgement: it draws the
coat with a *second, simplified renderer* written inside `side.js` — one sine-modulated outline plus
a few interior arcs. The frontal dog's coat is four layers (scalloped mass, a fringe of many small
lobes straddling the rim, flyaway curls, interior C-arcs), plus gradient shading and a real contour,
tuned across eight stages against defects that were only ever found by looking (ARCHITECTURE §6 art
defect 1: "fur reading as nubs"). `side.js` reuses the frontal coat's *numbers* and none of its
*drawing*, so it reads as a knock-off of our own dog — because that is exactly what it is.

**What the reference is and is not.** It is a different illustration style from our dog: different
outline weight, different coat treatment, slightly different proportions. As a *rendering* target it
would pull the profile away from the frontal dog it has to match. As a *pose* reference — what the
legs do, how the back arcs, where the tail sits in a bound — it is good and it stays.

> The thing that must look like the same dog is **our** dog. The reference tells us how he moves.

---

## 2. The plan

### 2.1 Extract the parts (the whole risk lives here)

`src/dog/draw.js` is 2381 lines: 30 helpers closed over `rig`, the resolved palette, the fur type
and baked gradient state (69 references). The extraction pulls the part-drawing out so **both views
call the same code**:

| extract | why it is needed in profile |
|---|---|
| `buildFluff` / `fluffMass` / `drawFur` / `drawFringe` / `drawFlyaway` | the coat. This is the whole point |
| `drawEye` (+ the highlight) | one eye instead of two, and the highlight is most of what makes him a puppy |
| `drawNose`, `drawMouth` | the muzzle tip |
| `drawEar` / `drawEarChain` | one ear as a silhouette, the far one omitted |
| `drawLeg`, `lobe` | four legs, no joints (the reference has none) |
| `drawTail`, `drawTailRoot` | held up and curled, and it is a real feature in profile |
| `initGrads` and the palette derivation | shading, or he is flat |

**This is a pure refactor and it must be provable as one.** `tools/bowlpixels.py` and
`tools/breedproof.py` (358 checks) exist for exactly this: if the frontal dog comes out
pixel-identical, the extraction was safe; if it does not, something broke and it says so
immediately. Nothing else in the plan may start until that is green.

**It is a fresh-context job.** Half-extracted is the worst state `draw.js` can be in, because the
gates only mean anything on a finished one. Start it first, finish it, prove it, commit it alone.

### 2.2 Compose the profile from those parts

Rewrite `side.js` as *composition* rather than drawing: the same fluff, the same eye, the same nose,
placed in profile geometry. `BALANCE.side` already holds that geometry as **multipliers on
`breed.proportions`**, never absolutes — so a Shiba in profile and a Shiba face-on cannot become two
different dogs, and the three breeds derive for free. Those multipliers are the art direction and
they are what the render-and-adjust loop tunes.

Known-wrong from the first render (`review/side-cockapoo.png`), in the order that matters:

1. the **ear** is a plank hanging past his belly and drawn over the front legs
2. **no contour** — he has no outline, so he reads as a blob rather than a drawing
3. the **legs** are too long and thin; the body too short and too high off the ground
4. the **scallop** is too fine to read as curl at this size
5. **no neck** — the head is a ball on the chest, too low and too far forward
6. the **eye** is twice its size (scaled off a frontal eye, where you see two small ones in a wide face)
7. the **tail** is a nub, not a held plume

### 2.3 The gait

`BALANCE.side.gait` drives it and already works: a bound (both fronts together), the far leg of each
pair lagging `lagFar` behind the near one, one body bob per cycle, legs shortening as they swing
under him. The standing pose is deliberately **not authored separately** — it is the loop held at its
gathered key, which is what stops a dog who stops mid-stride from snapping into a different animal.

### 2.4 The turn

**A hop-turn**: he bounces on the spot and lands in profile. There is no ¾ view in the reference and
inventing one is where this gets expensive; a puppy spinning on the spot is a real thing and it is
honest about not having intermediate frames. Interpolating between two silhouettes is the option
that looks like a glitch.

*(If a five-angle turnaround still ever gets generated — front, ¾, side, ¾-rear, back, one standing
pose — it would answer this properly, and the back view with it. A video would not: generated video
drifts frame to frame, so it cannot be a contract.)*

### 2.5 Then the walk

Only after the profile stands still and looks right. `dog/walk.js`'s own header will need rewriting —
it currently says a gait cycle must not be built without re-reading SCOPE, which was true until
2026-08-20.

---

## 3. What must not regress

- **The frontal dog is pixel-identical** after the extraction. Non-negotiable, and mechanically
  checkable.
- **`rig.floorV` does not move.** Everything — the bowl's base, every planted paw, the reach line —
  resolves against it, exactly as the outdoor places had to (§32.2 rule 1).
- **He is not relit.** Same rule, same reason (§32.2 rule 2).
- **One source of truth for size.** `breed.proportions` for how big he is, `BALANCE.side` for what
  changes when you walk around him.
- **Not in `sw.js`'s PRECACHE until it ships.** `check-precache` will report `src/dog/side.js`
  missing while this branch is unmerged, and that is correct — there is no reason to ship dead art.

## 4. Where things stand

| | |
|---|---|
| branch | `feature/side-profile`, unpushed, not merged |
| master | clean, 8.18.0 live and unaffected — nothing imports `side.js` |
| render loop | `py tools/sideshots.py [--breed x] [--scale n]` → `review/side-<breed>.png`, drawn at the reference's exact size and grid |
| next step | §2.1, on a fresh context, finished and proven before anything else begins |
