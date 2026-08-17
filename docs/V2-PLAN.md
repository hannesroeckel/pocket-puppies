# v2 — walking with him

Decided with Hannes, 2026-08-06. **Not before the gift ships.** She gets the current
game first; this becomes a second gift later ("he can go for walks with you now").

---

## The goal, in his words
> "improve the dogs motions so one could take an actual walk with him or one could see
> him from the side and him turning doing tricks, not only from the front"

Priority chosen: **walking with him.** Free rotation is desirable but secondary.

## Why this is blocked today
The dog is a single **near-frontal rig** — a deliberate stage-4 decision recorded in
`docs/SCOPE.md`. It's why walks are framed as *anticipation → absence → return with loot*
rather than a side-scroll: that reframing dodged the largest art task in the project and
was the right call for shipping. It is now the main ceiling on what the game can do.

## The three routes considered

| | What it gives | What it costs |
|---|---|---|
| **A — side-profile rig** | Real walking, side-on tricks, disc/agility staged side-on. **Chosen.** | Bounded: one new silhouette set + a gait cycle, per breed. Reuses the spring engine, breed palettes, proportions, idle director. No turning — front and side, cut between. |
| B — multi-angle 2D (front / ¾ / side, blended) | Genuine turning | Art cost multiplies by angles **and** by breeds. Three dogs makes this the worst value. |
| C — 3D dog, 2D room, toon-shaded | Everything: any angle, turning, gait, tricks in the round, disc catching. Every future feature gets cheaper. | Rebuild of the dog and revalidation of everything verified against him — petting zones, 18 idle clips, 8 tricks, care poses, reunion, 3 breeds. Weeks. |

**Note on C, if it's ever revisited:** Hannes rejected 3D early on, but that spike
(`spike-c-3d.html`, still in the repo) was soft-shaded and read like a vinyl toy — it was
never art-directed to *this* style. Flat toon shading with a hard outline and this warm
palette is precisely how you make 3D read as 2D illustration. The spike also already had a
procedural puppy on springs with petting zones and head tracking. So the earlier rejection
was of one execution, not of the approach.

## Route A — what building it actually involves
1. **`dog/rig.side.js`** — a profile part hierarchy. Reuses `engine/spring.js`, the idle
   director, breed `palette`/`proportions`/`markings`, and the mood model unchanged.
   Per `docs/ARCHITECTURE.md` §7, breed data was deliberately kept rig-agnostic with
   outlines namespaced under `silhouette.front` — **`silhouette.side` is the seam that was
   left for exactly this.**
2. **A real gait cycle** — walk and trot, with foot placement, weight shift and the
   secondary motion (ear and tail lag) that makes the frontal rig feel alive.
3. **A walk scene** — scrolling scenery, the leash, him pulling toward things, stopping to
   sniff, meeting other dogs.
4. **Reuse, don't rebuild:** the reframed walk (route map, discovery, return-with-loot) is
   good and stays — the side view becomes *what happens during* the absence beat rather
   than replacing the structure around it.

## Where AI image generation genuinely helps
Hannes has Runway and ChatGPT credits. The useful artefact is a **turnaround reference
sheet** — not frames used in the game (character consistency drifts, and we rejected
generated in-game art as "Style B" for that reason), but a **target to draw against**.

We have never had one, and it shows: the Schnoodle's eyebrows took four attempts partly
because nobody had a reference to aim at.

Suggested prompt, to be generated once per breed:

> A character turnaround reference sheet of a cute cartoon **[breed]** puppy, shown from
> four angles in a row on a plain background: front view, three-quarter view, full side
> profile, and rear view. Consistent character across all four. Soft cozy children's-book
> illustration style, warm flat colours with gentle shading and a clean outline, big dark
> round eyes, short muzzle, rounded proportions. Full body, standing, neutral pose, even
> lighting, no text.

Then a second sheet for motion: *the same puppy in side profile, in a walk cycle — four
stages of a step.*

Breeds: **schnoodle** (warm auburn `#b4703f`, the gift puppy — do this one first),
**cockapoo** (apricot/cream), **shiba** (orange-tan and cream).

## ✅ Reference sheets received — 2026-08-06

Hannes generated them in ChatGPT and dropped them in `refs/` (gitignored, local only):

- **`refs/schnoodle-turnaround.png`** — front, three-quarter, **full side profile**, rear.
  Consistent character across all four.
- **`refs/schnoodle-walkcycle.png`** — four side-profile frames of a step.

**What they give us.** The side profile is the silhouette the rig has never had, and the walk
sheet is a usable *look* reference for the gait. Colour and character match the in-game dog
closely: warm auburn curly coat, big round dark eyes with catchlights, short muzzle, dark
button nose, floppy curly ears framing the face, no contrasting eyebrows (which is the call
we made), fluffy up-curled tail.

**Two discrepancies to resolve deliberately rather than by accident:**

1. **Proportions differ.** The reference dog stands on noticeably **longer legs** with a more
   upright adult stance. The in-game dog is chunkier and shorter-legged — deliberately, for
   neoteny (see the cute-vs-angry audit in `dog/breeds.js`). **Match the game's proportions,
   not the reference's**, or the side view will not read as the same animal as the front view.
   Take the reference for silhouette, coat, ear and tail *shapes*; keep our leg length,
   head-to-body ratio and eye size.
2. **The reference reads more toy-poodle than schnoodle** — no beard or moustache at all. The
   in-game dog keeps a soft **same-colour** beard breaking his jaw line. Keep ours; it is what
   stops him being a plain doodle, and it costs nothing now that it is not a pale patch.

**On the walk sheet specifically:** the four frames are four attractive poses rather than a
rigorous contact → down → passing → up cycle, and the foot-falls do not read as a consistent
gait. Fine as a *look* target; the actual gait timing has to be built properly, not traced.

### v2 sheets — 2026-08-06, proportions corrected. **This is enough; stop iterating.**

`refs/schnoodle-turnaround-v2.png` and `refs/schnoodle-walkcycle-v2.png` (v1 kept alongside).

**Fixed, and this was the important one:** the proportions now match the game. Short stubby
legs, body low and chunky, large head. He reads as a puppy rather than a small adult dog, which
is exactly the neoteny the in-game rig was tuned for.

**Two residual drifts — accept them, don't spend more rounds on it:**
- **The ears got longer**, hanging well past the jaw as full curtains. That is drifting toward
  the *cockapoo's* ear treatment; ours is `ear: 'semi'` at `earH: 60`. Use v1's shorter, more
  semi-flopped ear as the shape reference and v2's body.
- **The beard still didn't land** — he still reads as a toy poodle around the muzzle. Since our
  beard is same-colour fur volume rather than a marking, an image model has almost nothing to
  latch onto. Build it from the existing in-game data instead; the reference can't help here.

**On the walk sheet: it is a bound/gallop, not a walk.** Frame 4 has all four feet off the
ground (a suspension phase, which a trot never has), and the frames don't share a ground line.
As noted before, the gait has to be authored with real timing regardless — so this is a *look*
reference for how the fur and silhouette behave in motion, and at that it is fine.

**Conclusion: sufficient. Further rounds have diminishing returns**, because everything still
wrong is either something the model can't express (same-colour beard) or something we have to
build properly anyway (gait timing).

Still worth generating later, at no urgency: the **cockapoo** turnaround, and a couple of
in-motion poses (sitting, lying, mid-trick in profile).

## Sequencing
1. Ship the gift.
2. Let her live with it for a while — what she actually does with it is better information
   than any plan here.
3. Then v2. ✅ Reference sheets are now in hand, so the first real step is
   `silhouette.side` for the schnoodle.

---

## The build sequence, audited — 2026-08-13

Written after the queue was cleared, and **deliberately without starting the rig.** The reason is
the reason this document already gives: v2 is the largest task in the project, it cannot be
verified in one sitting, and a half-built second rig in the tree is worse than none — `git push` is
the deploy and she is playing this on her Home Screen. So this section is the plan with real
numbers against it, and the code is untouched.

### What the audit found

| fact | measured |
|---|---|
| the seam | **one line**: `dog/rig.js:219`, `const F = breed.silhouette.front;` |
| what it reads | **six shapes**: `body`, `bib`, `head`, `muzzle`, `ear`, `earInner` |
| `silhouette.side` | **absent, and documented as absent** — `dog/breeds.js:20` still says "stage 4 adds the side rig", which is the note stage 4 left when it reframed walks instead |
| clips that would need porting | **26** registered (20 in `anim/index.js`, 6 in `anim/tricks.js`) |
| clips that touch geometry | **none.** They write joints — `earBack` means "ears back" whichever way he is facing |
| the renderer | `dog/draw.js`, **2,343 lines**, painting from `silhouette.front` |
| the rig | `dog/rig.js`, 683 lines, 38 springs |

**The good news is the seam is real.** One line, six shapes, and no clip anywhere knows what a
breed looks like. The reframing that dodged the side rig in stage 4 did not leave a mess behind it.

**The bad news is that the seam is not where the work is.** `silhouette.side` is a data addition —
18 outlines, six per breed, and the reference sheets for the Schnoodle are already in `refs/`. What
it hands to is a **2,343-line renderer written for one camera**: the bib, the fur clumping, the ear
lobes with their shadow ridges, the eye catchlights, the muzzle block, the markings pass and the
per-frame occlusion split from ARCHITECTURE 19 are all front-view painting. A `silhouette.side`
with nothing to draw it is a data file nobody reads.

### The order to do it in, and the gate for each step

Each step is shippable on its own and none of them breaks the front rig, which is the constraint
that matters: she is playing the frontal game right now.

1. **`silhouette.side` for the Schnoodle, and nothing that reads it.** Six outlines drawn against
   `refs/schnoodle-turnaround-v2.png`, plus a harness page that draws the raw shapes at rest.
   *Gate:* the outlines close, they sit inside their boxes, and `dog/dogalone.py` proves the FRONT
   dog is byte-identical — a data addition must be invisible.
2. **A side renderer, at rest only.** No gait, no clips: one standing profile that reads as the same
   animal as the front view. This is the honest size of the job, and it is where a week goes.
   *Gate:* renders of front and side side by side, on all three breeds, looked at — and the
   proportions rule from the reference-sheet note above enforced (our leg length, not the sheet's).
3. **The pose channels, one at a time.** `sit`, `down`, `headLift`, `earBack`, `tailWag` — the
   channels the 26 clips already write. Port them in the order the idle director uses them.
   *Gate:* every clip driven at 0.0/0.5/1.0 blend on the side rig with no NaN, no part detaching,
   and a render per clip.
4. **The gait.** Contact → down → passing → up, with foot placement, weight shift, and the ear and
   tail lag that makes the frontal rig feel alive. The walk sheet in `refs/` is a bound, not a walk
   (recorded above), so the timing is authored, not traced.
   *Gate:* foot-slip measured against ground speed — the one number that says a gait is real rather
   than a slide — plus frame cost, because this runs alongside scrolling scenery.
5. **The walk scene.** Scrolling room→street, the leash, him pulling toward things, stopping to
   sniff, meeting another dog. It slots INSIDE the absence beat that already exists: the route map,
   the discovery and the return-with-loot all stay exactly as they are.
   *Gate:* the walk still survives a full app close (the stage-4 promise), and the reframed beats
   still fire when she skips the side view.

### What I would not do

- **Do not touch `dog/draw.js`'s front path.** Add `drawSide` beside it. The front dog is the gift,
  it has been through four bowl fixes and a design pass, and it is on her phone.
- **Do not port the trick clips to the side rig at all**, at least not first. Tricks are performed
  to camera and the frontal rig suits them (SCOPE's reason for choosing it). A side rig is for
  *walking*, which is what was actually asked for.
- **Do not start it while anything in `docs/FEEDBACK-QUEUE.md` is open.** As of today nothing is,
  which is the first time that has been true.
