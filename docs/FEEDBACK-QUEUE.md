# Player feedback queue

From Hannes playing the game on his iPhone, 2026-08-06. **All of this is queued behind
`fix/bowl-depth` and `feature/design-pass`** — both are currently editing `state/balance.js`,
`ui/shop.js` and the care/draw path, and a third concurrent agent would turn a clean merge
into a mess.

Ordered by value.

---

## 1. Sit and Lie down are indistinguishable when teaching ⚠️ real design flaw

> "the moves lie down and sit are hard to distinguish when teaching the dog as one pulls
> down on the dog for both"

**Confirmed in code.** Both use the same guide, `headDown`, and are told apart *only* by his
current posture (`train.js` ~728: `stand → sit`, `sit → lieDown`):

| trick | guide | prereq | hint |
|---|---|---|---|
| `sit` | `headDown` | `stand` | "Stroke down over the top of the head" |
| `lieDown` | `headDown` | `sit` | "From a sit, stroke down over the head **again**" |

It was deliberate — the DS original worked this way — but the disambiguation is invisible, and
a design that needs explaining has failed. He did the gesture and couldn't tell what he was
teaching.

**Fix:** give them distinct *shapes*, matching real hand signals.
- **Sit** — unchanged: a short downward stroke over the head.
- **Lie down** — a downward stroke that **continues into a flat sweep along the floor** (an
  L). That is the actual "down" signal (palm down, sweep to the floor), it is distinguishable
  by shape rather than hidden state, and the ghost gesture hint already drawn in
  `train.drawFront` would show an obviously different figure.

Then **delete the posture-based disambiguation** — it exists only to prop up the collision.
Safe for the obedience contest, which performs by id (`perform(id, {judged:true})`) and never
goes through cue interpretation.

## 1b. There is no trick list — training is guesswork ⚠️ same root cause as 1

> "we also need more descriptions for the player regarding the tricks. currently its just a
> guessing"

**Confirmed.** The teaching prompts exist (`TRICKS[id].hint`) but the *only* way they surface
is the **ghost gesture hint**: `train.js` ~1274 waits for `sinceInput > T.hintAfter`, then
cycles through teachable tricks one at a time. So a player learns what's possible by stopping
and waiting. There is no list, no picker, and nothing that says what a trick even *is*.

Combined with issue 1 (sit and lie down sharing a gesture), the training screen currently
asks her to discover an invisible ladder by trial and error.

**Fix — a real trick list in the Train screen.** For each trick:

| element | example | source |
|---|---|---|
| name | "Lie down" | `TRICKS[id].name` — exists |
| what he does | "He settles onto his front, head up." | **needs authoring** — no such field today |
| how to ask | "From a sit, stroke down and sweep along the floor." | `TRICKS[id].hint` — exists, update for issue 1 |
| how well he knows it | not a bar — words, e.g. "getting it" / "knows it" / "knows it cold" | `repertoire()` exposes live `reliability` |
| locked, and why | "Teach him to sit first." | `prereq` — exists |

Notes:
- **No XP bars.** Progress in words, consistent with the no-bond-meter rule.
- Keep the ghost gesture hint — it's good discoverability *during* teaching. This is about
  knowing what exists *before* you start.
- Add a `does:` field to each entry in `dog/anim/tricks.js` and keep the copy pronoun-
  parameterised from `game.pron` (the pattern is already established in `train.js`'s `COPY`).
- The mis-association cue legend already exists and is separate — it shows what he *thinks* a
  word means. Don't merge the two; they answer different questions.

## 2. More to buy in the shop

Current stock is 8: chew bone 55, biscuits 25, good treats 60, softer brush 70, oatmeal soap
45, blue collar 35, green collar 35, collar with tag 90.

**The binding rule:** every item must *do something*. Stage 6 cut two unlock rows for being
empty, on the principle that an earned reward that does nothing is worse than one never
promised (§17.5). Do not add anything cosmetic-but-inert.

Proposed, each with a real effect:
- **Detangling comb** — meaningful now that two of three breeds are curly-coated
- **Frisbee** and **rope tug** — different throw arcs and different odds of return, so play varies
- **Plush toy** — carried and slept with rather than fetched
- **Better kibble** — fills more, visibly preferred
- **Bandana**, **bow**, more collar colours
- **Scented shampoos** — gloss lasts longer, which feeds the obedience score since grooming is marked

> ⚠️ **Decor stays OUT of the shop.** He also asked for room decoration, but stage 6
> deliberately kept decor on the **care-point** ladder so she cannot buy her way to a nicer
> room — "sell objects for coins, gate content on care points". Add decor to the care-point
> unlocks instead. Changing that rule needs an explicit decision, not a quiet drift.

## 3. Paw-shake as a direct interaction — needs confirmation from him

> "for tricks it should be possible to shake the paw of the dog as a move"

**`shake` already exists** — trick order 3, guide `pawWiggle`, hint *"Take a front paw and
wiggle it up and down"*. It's gated behind learning one other trick first, so he may simply
not have reached it.

Two possibilities, and I've asked which:
- He hadn't found it → nothing to build; possibly surface the trick ladder more clearly.
- He tried it and it didn't respond → **that's a bug**, investigate.
- He meant a *direct* interaction (tap his paw, he offers it) → new, and a nice idea. Note his
  paws are currently a **bad** petting zone (rubbing them makes him pull away), so a
  handshake affordance would need to coexist with that without muddling the sweet/bad model.

## 4. Per-dog reunion timing — found while answering a question, not reported

`applyElapsed` decays only the **active** dog (`addNeed` → `dog()`), which is right: the
ignored dog never starves. But `lastSeenAt` is stored **once for the whole save**, not per dog.

So if she plays with the Cockapoo daily for a fortnight and then switches back to him, the
game thinks she was here yesterday and **he greets her flatly after two weeks apart** — exactly
the moment the reunion exists for, and the research calls it the highest return-on-effort
asset in the project.

**Fix:** per-dog `lastSeenAt`, stamped when she switches away; trigger the reunion on whichever
gap is longer.
