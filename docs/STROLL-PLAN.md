# The stroll — a walk she watches, and taps

Asked for on 2026-08-25:

> *"cant we now not use the side profile to have an actual walk instead of just sending the dogs
> away?"*

and, given four options, the chosen one:

> **Watched, and she taps things he passes** — the travelling scene, but interactive: a butterfly, a
> puddle, a stick, another dog. What she taps is what he brings home, so finds become **discovered**
> rather than awarded by a timer.

---

## 1. What must survive, and why

These are not my preferences; they are what the walk's existing design buys, and the plan keeps all
three:

- **the absence.** The room goes quiet and cool, there is a dent in the rug and a few tufts of fur.
  It is the only sad moment in the game and it is what makes the reunion land.
- **the frontal return.** He comes home muddy, and mud is a per-region wash on a *drawn* dog — a
  painted sheet cannot get dirty (ARCHITECTURE §33.3). The one beat where his state is the payload
  must not be a sprite.
- **close-the-app progress.** A walk is a pure function of wall-clock time (`state/walks.js`). iOS
  suspends JS completely; nothing ticks a walk forward.

So the shape is: **lead → map → he walks out of the room → THE STROLL → absence → frontal return.**
The stroll is ~25–40s at the *start* of the walk, inside its duration, not added to it.

## 2. Done (cache 8.21.0+)

**`scenes/outdoors.js` `drawStrip(c, w, h, o)`** — the park as a **seamless tile**, and it had to be a
new function rather than `drawPark` with an offset:

`drawPark` places everything by absolute x — hills at `sin(x * 0.008)`, clumps at `i * (w / 26)`,
tufts at random x. Scrolling that means redrawing 26 clumps and 150 tufts every frame (the most
expensive thing in the game, §32.2 rule 3) or tiling a bake whose edges do not match, which is a seam
sliding past every few seconds.

`drawStrip` is periodic **by construction**: every wave is a whole number of cycles across the tile
(`sin(2π k u)`, which closes on itself at u = 1), and every scattered thing sits at a hashed `u` and is
drawn again one tile over when it straddles the join. Verified by putting the join on screen and
sliding it — `review/stroll-0..3.png`.

## 3. Built (cache 8.22.0)

All seven, in the order they were planned. `src/dog/stroll.js`, and the road it draws is
`drawStrip` blitted as **two parallax planes out of one bake** — the sky, hills and treeline at a
third of the speed of the ground he is walking on. Two canvases would have been the obvious way and
would have cost a second full-screen bitmap; §32.2's rule (iOS caps *total* canvas memory, and the
failure is a blank white rectangle rather than an error) says no. It works out of one because
`drawStrip` lays the grass down as a full-width fill **after** the hills and the treeline, so
nothing survives across the horizon and the two halves can be blitted at two rates with no shape to
cut in half. The tile is released the moment the beat fades out.

| # | piece | as built |
|---|---|---|
| 1 | `src/dog/stroll.js` | the beat, ~30s, capped at a third of the walk it begins |
| 2 | the offer | `game.walkOffer()` → `rollFinds(active, 1, {ignorePicked:true})` at the top of the stroll |
| 3 | persistence | `walks.active.picked`, **schema 11**, written on the tap and not at the end |
| 4 | kindness | empty `picked` falls through to the ordinary roll, inside `rollFinds` itself |
| 5 | the arbiter | not a line in `surfaceOwner()` after all — one word in `walk.modal`, which the arbiter already asks. The layer states its own fact (§14.1) |
| 6 | `walk.js` | `stroll.begin()` at the end of the departure, and it may **decline**; `onEnd` sets `away` |
| 7 | `tools/strollgate.py` | 37 checks, four of them controls |

## 4. The three things most likely to go wrong — and what actually did

The three were right, and all three are now gates rather than intentions: the tap window is
`hitR` 62 × `hitRy` 46 (about 0.7s of drift either side, the same shape of answer as the disc's
±0.16s); leaving is checked three ways (the way out, leaving the screen, the walk ending underneath
it); and "watching adds nothing" is asserted as *same duration, same `startedAt`*.

What actually went wrong was none of them:

- **THE TILE HAD A SEAM, AND IT HAD BEEN SIGNED OFF AS SEAMLESS.** §2 above says "verified by
  putting the join on screen and sliding it". It was — over **grass**. Three things in `drawStrip`
  were not periodic at all: the clouds were drawn once and clipped, the hill polyline sampled
  `x += 6` so at any tile width that is not a multiple of 6 the closing edge cut a notch out of the
  skyline, and the tufts and daisies had a comment saying they were wrapped and no code that wrapped
  them. `strollgate` now draws the tile twice side by side and asserts that **the join is an
  ordinary pixel column** — measured against the busiest ordinary column in the same picture, so it
  cannot be satisfied by a tile with no detail in it. It caught the notch after the clouds were
  fixed, which an eye would not have.
- **THE DEPTH WORK WAS INVISIBLE ON THE FIRST WALK IT RENDERED.** A per-find hash is uniform on
  average and says nothing about any one walk: that seed drew 0.99, 0.93, 0.96 — three finds at the
  same distance. And because each find is a tap target passed through `reach.clampY()`, all three
  then clamped to the *same y*. The depth range is stratified now, and both are asserted.
- **THE DOG FILLED THE FRAME.** `rig.place.scale` is 1.34 and the sheets are 250 units tall, so at
  the room's scale he is 335 units of an 844-unit screen — right for a close-up pet sim, wrong for a
  travelling shot with no road left to walk along. 0.62 on the road; the dissolve carries it.

## 5. Left imperfect

- **An untaken find is hidden behind him for about a second** at its closest approach, because it
  passes at his own x and the reach line will not let a tap target sit below 676 (his feet are at
  ~696), so nothing can pass in *front* of him. She has ~5 seconds of it on screen either side, and a
  dog walking past something does occlude it — but it means the moment of "he's right next to it" is
  the one moment she cannot see it.

  The *confirmation* is not left imperfect, and it was the same defect one step worse: the tap lands
  where he is, so the first render drew the pop, the arc **and** the sparks behind the dog — she
  touched the thing she was told to touch and nothing happened. `drawFront` is three passes now
  (untaken finds → him → what she just took) and the taken pass draws its own ring at her finger,
  because the room's particles are drawn before this layer and are behind him too.
- **No explainer card.** `howtoContext()` gives the stroll nothing, so the one hint line is the whole
  teaching. That is deliberate for now — a card over a scene she is meant to be watching is the
  thing `ui/howto.js` exists to avoid — but if the hint turns out not to be enough it is one line in
  `howtoContext()` and one entry in `HOWTO`.
- **What she taps is not re-gated by how far he actually got.** Tap three things and bring him home
  after twenty seconds and you keep all three, including tier-2 finds a twenty-second walk would
  never roll. It is deliberate: re-checking her picks against the progress she got would mean taking
  back the thing she chose, which is the one outcome this beat exists to avoid. If it ever reads as
  an exploit, the honest fix is to reveal the offer more slowly, not to confiscate.
