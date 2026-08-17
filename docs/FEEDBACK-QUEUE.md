# Player feedback queue

From Hannes playing the game on his iPhone, 2026-08-06. **All of this is queued behind
`fix/bowl-depth` and `feature/design-pass`** — both are currently editing `state/balance.js`,
`ui/shop.js` and the care/draw path, and a third concurrent agent would turn a clean merge
into a mess.

Ordered by value.

---

## 1. Sit and Lie down are indistinguishable when teaching ✅ FIXED on `feature/training-clarity` (cache 8.8.0)

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

> **Fixed.** Lie down has its own gesture: down over the head, then **out to one side** — an L,
> which is the real hand signal and is distinguishable by shape rather than by hidden state. The
> posture disambiguation is **deleted**: `headDown` means sit whatever he is doing (and says
> `need: 'stand'` when he is already sitting, instead of silently meaning something else), and
> `headSweep` means lie down whatever he is doing, with `chainFor` sitting him on the way. The
> ghost gesture now draws an obviously different figure, and the hint line follows it — it used
> to lag a whole cycle and captioned the L with *"Stroke down over the top of the head"*.
>
> **Measured:** `headDown` never yields a lie-down from any of the three postures, `headSweep`
> yields one from all three, a sit drawn with up to 34 units of sideways drift is still a sit, all
> eight tricks still teach through a real gesture path, and the trial still performs by id.
> 59 checks in **`tools/traingate.py`**, which is in the repo. Full write-up, including two failed
> detectors and three defects found only by rendering it, in ARCHITECTURE 21.

## 1b. There is no trick list — training is guesswork ✅ FIXED on `feature/training-clarity` (cache 8.8.0)

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

> **Fixed.** `src/ui/tricklist.js`, opened by a **Tricks** pill in the training chrome. Every
> trick, taught or not, with its name, **what he does** (a new `does:` field on each entry in
> `dog/anim/tricks.js`, pronoun-parameterised from `game.pron`), how to ask for it, and how well he
> knows it in words — the same five the cue legend uses, never a bar and never a count. The
> "he needs to be lying down first" line appears only while the posture is actually wrong and
> disappears the moment he moves, so nothing is ever drawn as a locked door. The legend and the
> list are kept separate, as this item asked.
>
> One extra defect fell out of it: **the ghost hint switched itself off for good** the first time
> she taught him anything, because it tested `!perf` and a finished performance is left in place
> for its result to be read. So "the only way to learn what exists is to stop and wait" was worse
> than reported — after the first lesson, waiting did not work either.

## 1c. The ball can land behind the nav bar and become unreachable ✅ FIXED on `fix/reachable-area` (cache 8.7.1)

> "sometimes when flicking the ball it is behind the navigation buttons which doesn't allow
> the player to reach it again"

**Confirmed, with numbers.** Design space is 390×844 (`BALANCE.view`). The nav is `h: 58`
(`BALANCE.ui.nav`) sitting above the device's bottom safe-area inset (40 on the target
iPhone), so **the nav's top edge lands around y ≈ 746**.

The toy's positions are hardcoded and none of them know the nav exists:

| where | value | verdict |
|---|---|---|
| `T.home` | `[330, 736]` | **10 units** above the nav — any variance tucks it under |
| `toy.y = 782` after `hitReaction()` (`dog/toy.js` ~176) | 782 | **inside the nav band — unreachable** |
| x clamps | `40–350`, `54–336` | irrelevant; the nav spans the full width |

So hitting him with the ball is the reliable way to lose it: he flinches, the ball drops "at
her feet" at y=782, and the nav swallows it. She cannot pick it up again.

**Fix — derive the bound, don't patch the number.** This is the same mistake as the bowl's
floor: a hardcoded constant with nothing tying it to the thing it must respect. Publish a
single **reachable play area** (bottom = nav top edge − margin, computed from the real nav
geometry *and* `env(safe-area-inset-bottom)`), and clamp **every** interactive prop to it —
the toy, both bowls, and anything a walk brings home. Then assert it: no interactive prop's
hit area may ever intersect the nav's rect, on any frame, at any safe-area inset.

Note the nav is being restructured from 8 pills to ~5 on `feature/design-pass`, which changes
its height — another reason the bound must be derived rather than typed in.

> **Fixed.** `src/ui/reach.js` publishes one reachable play area, its bottom derived from the
> nav's real hit rect (itself derived from `BALANCE.ui.nav` + `env(safe-area-inset-bottom)`)
> minus `BALANCE.ui.reach.margin`. `ui/nav.js` imports its own geometry from there, so the bar
> and the bound cannot drift apart. Every interactive prop is authored as an offset from
> `rig.floorV` and passed through `reach.clampY()`; a per-frame assertion (`reach.tick()`)
> reports any prop whose hit area intersects the bar. **Zero live violations at insets 0, 20, 40
> and 80, in every prop state.** Reproduced the flinch case and proved the ball is pickable
> afterwards with a real pointer. Full write-up, including three further defects found on the
> way and five things left imperfect, in ARCHITECTURE 20.
>
> Two things in the report above were understated: the ball's **home** was already 61% behind
> the bar on first launch (its centre pressed MORE), and the **successful** fetch drop at
> `y = 792` was worse than the flinch drop at 82%. "Bring him home" during a walk was also
> losing 37 of its 46 units to the bar, so tapping it opened Training; that is fixed too.

## 2. More to buy in the shop ✅ FIXED on `feature/shop-stock` (cache 8.11.0)

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

> **Fixed.** Four rows, each with an effect the gate measures rather than a note that describes one:
> **the good kibble** (a bowl fills 1.45× as much of him), **a detangling comb** (1.7× gloss on a
> curly coat, and deliberately nothing extra on the Shiba — `fur.type`, not a breed-id check),
> **rose soap** (gloss fades at 0.55× per hour away, which is what makes it show up in an obedience
> score days later, since grooming is marked), and **a rope tug** (he brings it back less and settles
> down to tug it more — the first toy in the game that plays differently at all).
>
> Twelve rows now, and the shop still does not scroll: row height came down 58 → 54 so header + 12
> rows + Done = 758 against a 804 floor. **The catalogue is full** — the next thing added has to
> replace something.
>
> **Decor is still out**, as this note demanded: it stays on the care-point ladder, so coins cannot
> buy a nicer room. ARCHITECTURE 24.

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

## 4. Per-dog reunion timing ✅ FIXED on `feature/per-dog-time` (cache 8.9.0)

`applyElapsed` decays only the **active** dog (`addNeed` → `dog()`), which is right: the
ignored dog never starves. But `lastSeenAt` is stored **once for the whole save**, not per dog.

So if she plays with the Cockapoo daily for a fortnight and then switches back to him, the
game thinks she was here yesterday and **he greets her flatly after two weeks apart** — exactly
the moment the reunion exists for, and the research calls it the highest return-on-effort
asset in the project.

**Fix:** per-dog `lastSeenAt`, stamped when she switches away; trigger the reunion on whichever
gap is longer.

> **Fixed.** Every dog carries his own `lastSeenAt`, stamped when she switches away from him and
> when she is with him; `state.lastSeenAt` stays the app's clock. The reunion runs on **whichever
> gap is longer**, and it now fires on a swap as well as on a launch — which is where this item
> actually bites. Measured: app shut for 12 minutes, his own gap a fortnight, reunion at k 0.48.
> Schema v7; every dog's clock is seeded from the app clock so the migration cannot invent a gap.
> ARCHITECTURE 22.

## 5. Toasts land on top of the thing they are describing

Noticed in two places, so it is a pattern rather than a one-off:

- Feeding: the **"Biscuit is full"** toast sits directly over the bowl it refers to.
- Play: a hud hint *"Flick the ball up-screen"* and a toast *"Flick the ball up — never
  sideways"* are shown at once, and **the toast covers the very ball it names**.

Both are legible — `ui/text.js` guarantees contrast — so no gate catches them. The defect is
placement and redundancy, not readability: a message should not obscure its own subject.

**Fix:** give the toast a placement rule that avoids the active prop's rect (it can already be
asked for — `props.js` publishes the bowl's draw args, and `toy.toy` carries the ball's
position), and de-duplicate the Play hint/toast pair down to one message.

Reported by the stage agent as deliberately out of scope, since deduplicating touches
toy/hint sequencing rather than a token.

---

# Second round of feedback — 2026-08-07

## 6. Walk finds partly work, but the room becomes a junkyard ✅ FIXED on `feature/find-collection` (cache 8.10.0)

> "It would be great if the items the dog collects during a walk were also ones that one could
> then use afterwards. Currently, they are only being collected in the room without being able
> to use them. and when the room fills up it just gets messy. we also need a storage for these
> items that hides them from the room if wanted."

**Partly already true, which is why it reads as inconsistent.** `state/game.js` ~947 does route a
find with a `toy` field into `inventory.toys` *and* makes it the toy on the rug, and `dog/toy.js`
~519 plays whatever he carried home. So the four **toy** finds (stick, pinecone, tennis, squeaky)
genuinely are usable.

Everything else is not. `walks.found` is a dated log and `unlocks.items` the authoritative set,
but a flower, a feather, a buttercup or a photo of a dog he met has **no use and no home** — it
just accumulates on the floor. So some finds are real and some are litter, with nothing telling
her which.

**Two things to build:**
1. **A place to keep them.** A storage/collection surface — a shelf, a box, a little album — that
   holds finds and lets her choose what is out on display. The room should be *hers to arrange*,
   not a floor that silently fills. Bear in mind decor is care-point-earned, not bought (rule in
   §2 above); found items are a third category and should not become a coin shop by accident.
2. **A use, or an honest purpose, for every find.** The project rule already applies here — stage
   6 cut two unlock rows for being inert, on the principle that *an earned reward that does
   nothing is worse than one never promised*. So either a find is playable (toys), wearable,
   displayable, sellable for coins, or it is a **keepsake with a stated purpose** (an album of
   dogs he met is a lovely thing; an anonymous flower on the rug is not).

Also worth checking: whether finds ever stop spawning once she owns them, or whether she gets
the same buttercup forever.

> **Fixed.** `src/ui/collection.js`, opened by tapping the window sill his things stand on.
> **On the sill** is what she has put out (capped at seven, and a full sill refuses rather than
> pushing the oldest thing off), **in the box** is everything else, and one tap moves a thing
> either way. **Dogs he has met** is the album, naming each dog and the route he met them on.
>
> And every find now has a purpose: a toy he fetches, a photo is a dog he met, an ornament is out
> or put away — and **a duplicate of anything pays coins**, which it only did for toys before. So
> the second walk down the same road pays more than the first, and nothing he carries home is
> inert. On your other question: no, finds did NOT stop spawning once owned, and the same buttercup
> really could come home for ever. Owned finds are weighted down to 0.45 now rather than excluded,
> so something new comes first without the woods running out of woods things.
>
> Toys and photos no longer take an ornament's place on the shelf. Decor stays on the care-point
> ladder, untouched — finds are a third category and arranging them costs nothing.
>
> One thing this turned up that was bigger than the item: `loop.resize()` was never called after
> the scene mounted, so `setInset` had been **dead for the sheet, the shop, the kennel and the
> trick list** for the whole session on a phone that is never rotated. ARCHITECTURE 23.

## 7. The other dog does not get hungry while she is away from it ✅ FIXED on `feature/per-dog-time` (cache 8.9.0)

> "when switching between dog, it seems like one just picks up where one left the dog, although
> it should be hungry and thirsty after a certain time, which it is not"

**He is right, and I called this a feature earlier.** When he asked what happens on adopting a
second dog, I checked `applyElapsed` → `addNeed` → `dog()` and reported that only the *active*
dog decays, framing it as consistent with "he never resents her". That conflated two different
things:

- **Needs** (hunger, thirst, cleanliness, energy) are *physical and recoverable* — they should
  pass with time for **every** dog, and a bowl of food fixes them in seconds. Freezing them makes
  the second dog a doll rather than an animal.
- **The bond** (affection, trust) is *emotional and not recoverable* — that is what the ratcheting
  floor protects, and it must stay protected for both dogs.

So the principle was never "nothing changes while she is away"; it was "the relationship is never
taken away from her". Needs decaying is not punishment.

**Fix:** decay needs for **all** dogs in `applyElapsed`, not just the active one, keeping the
existing 36h cap so a fortnight away is no worse than a day and a half. Leave affection floors
alone. Pairs directly with item 4 (per-dog `lastSeenAt`) — do them together, since both stem from
the same root: **the save tracks time once globally when it needs to track it per dog.**

> **Fixed, and you were right.** `applyElapsed` and `decayLive` decay **every** dog through
> `addNeedAll`, with the 36-hour cap intact for all of them, so the dog she is not looking at gets
> hungry, thirsty and dull-coated like an animal instead of waiting frozen like a doll. Affection,
> the floor and trust are untouched and are deliberately not reachable from that path: needs are
> physical and recoverable, the bond is not. Done together with item 4, as this note asked.
> ARCHITECTURE 22.
