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

Still worth generating later, at no urgency: the **cockapoo** turnaround, and a couple of
in-motion poses (sitting, lying, mid-trick in profile).

## Sequencing
1. Ship the gift.
2. Let her live with it for a while — what she actually does with it is better information
   than any plan here.
3. Then v2. ✅ Reference sheets are now in hand, so the first real step is
   `silhouette.side` for the schnoodle.
