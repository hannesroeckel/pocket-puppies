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

## 3. Remaining, in build order

| # | piece | notes |
|---|---|---|
| 1 | `src/dog/stroll.js` | the beat: scroll, the dog trotting at a fixed x, drifting finds, taps, hand-off |
| 2 | the offer | `rollFinds(active, 1.0)` at Set off decides *what* is offered; her taps decide what he *keeps* |
| 3 | persistence | `state.walks.active.picked = []`, **schema 11 + migration**. Without it, closing the app mid-stroll loses her taps, and losing what she chose would feel worse than never offering |
| 4 | kindness | if `picked` is empty — she tapped nothing, or closed the app — the return falls back to the full roll: *he found something himself*. "Losing must never feel like rebuke" |
| 5 | the arbiter | one line in `scenes/room.js` `surfaceOwner()`, or care/train/walk will open over it (§14.1) |
| 6 | `walk.js` | the departure hands to the stroll; the stroll's end sets `away = true` |
| 7 | `tools/strollgate.py` | it must prove it can fail; and drive `scene.pointer`, not the layer's own handler (the 8.16.1 lesson) |

## 4. The three things most likely to go wrong

- **taps on a moving target.** A find drifting past at ~90 units/s with a 20-unit radius is a hard
  tap on a phone. The hit box must be generous and time-based (a window either side), the same way
  the disc's catch window is ±0.16s rather than a pixel test.
- **the stroll must be interruptible.** She can leave, and the walk must continue as a normal
  absence. That is the same "leaving mid-departure is safe" case `walkgate` already covers.
- **it must not add time to the walk.** The clock starts at Set off. If the stroll ran on its own
  clock the walk would get longer every time she watched it.
