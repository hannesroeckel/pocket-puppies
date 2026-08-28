# Scope decisions & feature specs (stages 2–6)

Decided with the human on 2026-07-29, informed by `docs/nintendogs-design-reference.md`.
Read that document's §1 (ranked top-10) and §2 (affection) before building any of this —
they override anything here that contradicts them.

`docs/ARCHITECTURE.md` remains the binding *technical* contract. This document is the
binding *design* contract.

---

## The decision that shapes everything

The chosen art style has **one near-frontal camera**. Rather than build a second
side-profile rig, we **reframe the pillars to fit the camera we have.** Approved:

| Pillar | Decision |
|---|---|
| Care + bonding | Build fully. This is the game. |
| Training + tricks | Build fully, frontal rig suits it perfectly. |
| Walks | **Reframed** — draw a route → send-off → return with loot. No gait cycle. |
| Contests | **Obedience Trial** is primary (perfect frontal fit). **Disc** reframed as a frontal catch-and-leap timing game. **Agility cut** — its top-down route map *is* the mechanic and it fights this rig hardest. |

Consequence to hold onto: **no side-profile rig is being built.** If any later stage finds
itself wanting one, stop and raise it rather than quietly building one — it is the single
largest art task in the project and it was deliberately avoided.

> **RAISED AND APPROVED, 2026-08-20.** *"Actually I do want a side and back profile of the dogs
> ... these new views would make improve the game a lot"*. The rule did its job: stage 8 wanted
> a gait cycle for the disc game, stopped, and asked. There is a profile dog now — the human's
> own art (`src/assets/side-*.webp`) with a drawn fallback (`src/dog/side.js`) — and it is used
> for exactly one thing: **he trots out of the room when a walk begins** (ARCHITECTURE §33).
>
> What the approval did NOT change, and neither should anything later: the walk is still
> anticipation → absence → return, the **return is still frontal** (he comes home muddy, and a
> painted sheet cannot get dirty), and **agility is still cut**. The back view is still unbuilt.

## Design principles that outrank faithfulness

1. **The dog never resents her.** Affection has a ratcheting floor; decay is capped at 36h;
   a long absence produces a hungry, grubby, *ecstatic* dog. Never a reproachful one.
2. **No affection bar, ever.** The bond is read off the body — tail, ears, approach/retreat,
   eye contact, whether it obeys first time. Inspectable status uses **words** (`Full →
   Normal → Hungry → Famished`), never bars.
3. **A session is 90 seconds or 20 minutes, both valid.** Nothing may require a long session
   to avoid a penalty.
4. **Nothing gates on the microphone.** See `docs/PLATFORM-RISKS.md`. Tap is always an
   equal-status path, never a degraded fallback.
5. **Punish cruelty, not neglect.** The original specifically penalised teasing, hitting the
   pet with toys, and yanking the leash. Reproduce that as *immediate physical reaction*
   (recoil, flinch, retreat, a hurt look) — never as a persistent score penalty or guilt.
6. **Every mode says how it works, once.** Added after the fact, in the player's words: *"in
   general we should always include a tutorial for any feature/mode in the game."* One card,
   the first time she opens that mode, dismiss-only, with a `?` to see it again. Two things
   this principle explicitly does **not** license: a card in front of the first launch (§4.1
   of GIFT-READY: *"no UI clutter, no tutorial in front of it"*), and a card after a mistake —
   an explanation that arrives when she drops the disc **is** the game telling her she got it
   wrong, whatever the words say, and principle 1 outranks being helpful. Modes that already
   explain themselves get nothing: the shop is a priced list, the trick list *is* an
   explainer, and the paw-shake is a discovery on purpose (ARCHITECTURE §33).

---

## Stage 2 — Care + bonding

The care loop's job is to *reward returning, not attending*. Four actions, each 10–40s,
each physically interactive, each reusing the petting stroke field where possible.

- **Feed** — drag a bowl into place, tip kibble in, watch it eat (head-down loop, audible
  crunching, tail rising as it fills). Hunger word-state improves.
- **Water** — same shape; the slop of drinking is one of the named foley wins.
- **Wash** — **reuse the stroke field.** Scrubbing is petting with suds: dirt is a per-region
  mask that the stroke actually erases where she strokes. Shake-off at the end, spraying
  droplets, is the payoff animation.
- **Brush** — again the stroke field, along the coat's grain; strokes against the grain are
  a *bad spot* and get a complaint. Coat gloss rises visibly.

**Needs model** (all rates in `state/balance.js`, all invented — no public source exists):
`hunger`, `thirst`, `cleanliness`, `energy`, each 0..1. Dirt accrues from walks and play,
not merely from time. Sickness is **cut** — it exists only to punish, and punishing is
off-brief.

**The reunion is the highest-value asset in the project.** Returning after >8h: the dog
notices, its whole body commits, it bolts at the camera, tail going hard, and it takes a
moment to settle. Intensity scales by `time_away × affection`. Build it early, tune it
obsessively, give it more polish than anything except petting itself.

**Toys** (frontal-safe per §1 item 5): flick to throw **up-screen**, the toy arcs *away* from
the viewer scaling down, the dog turns and runs "into" the screen (vertical squash + scale
fakes the foreshortening), then returns growing larger. **Never throw laterally** — that
needs the rig we didn't build.

> **Amended for the disc, and only for the disc (ARCHITECTURE §33).** The player asked for
> the dog to *"actually catch the disc instead of just staying in place"*, so a disc now comes
> down up to 72 units to one side of him and he covers the ground to get under it. That is a
> **translate of `rig.x` with a bounce on it** — no gait cycle, no side of him ever drawn,
> nothing rotated — which is the same licence `TRICK_POSE.spin` takes to trot a circle and the
> reunion takes to cross the room. The consequence above still holds in full: **no
> side-profile rig is being built**, and a real run cycle would still need the raise this
> document asks for. The **ball** keeps the original ±46 and its "never sideways" hint, because
> a ball out of reach is a ball he cannot fetch. The uncertainty is the mechanic: sometimes it returns the toy,
sometimes it chews it, sometimes it loses interest halfway. A toy that always comes back is
a vending machine.

## Stage 3 — Training + tricks

Ritual: give the cue → guide the pose with a finger → reward at the right moment.

- **~3–4 repetitions** to learn, spread across sessions. Instant learning makes it a checkbox.
- **Keep the wobble.** A trick can be half-learned, and can be *mis-associated* with the
  wrong cue. This is charm, not a bug — the research is explicit about it.
- Trick reliability is gated by mood/affection: a happy dog obeys first time, a low-mood dog
  fails or "forgets."
- **Cue input**: tap/gesture is the primary and always-sufficient path. Mic is an opt-in
  extra used as a **gesture sensor** (loudness/duration/pitch envelope), never ASR — and
  its imprecision *is* the authentic mis-hearing.
- Shorten the ladder relative to the original: a compact set of tricks that each feel good
  beats a long list. Sit, lie down, shake, roll over, spin, jump, beg, play dead is plenty.

## Stage 4 — Walks, reframed

No walking animation. The beat is **anticipation → absence → return**, which is emotionally
stronger than a side-scroll and costs a fraction of the art.

1. **Prepare** — leash comes out; the dog goes *electric* with anticipation (this is the
   payload of the whole feature, and it's a frontal animation we already have the rig for).
2. **Route** — she draws or picks a route on a cute hand-drawn map: park, high street, river,
   woods. Different routes bias what comes back. Duration is real time (a few minutes),
   or skippable.
3. **Absence** — the room is empty. Deliberately a little melancholy. She can close the app.
4. **Return** — the dog comes back muddier, tireder, happier, **carrying something**: a found
   gift, a new toy, a flower, a photo of a dog it met. Discovery lives here.

This preserves everything the pillar was asked for — route choice, finding items and gifts,
meeting other dogs, unlocking toys — while dodging the gait cycle entirely.

## Stage 5 — Contests + economy

Grounded in `docs/nintendogs-design-reference.md` §6 and §7. Read those first.

**A contest happens somewhere, and it is not the living room.** Added after the fact, because both
contests shipped as the room with its lights turned down and it read as a game with one room and
several moods. The obedience trial is held in a **show ring** — mown stripes, a rope, bunting, a
crowd — and the disc game in a **park**. Two places rather than one shared backdrop: a park is loose
and empty, a ring is watched, and sharing an outdoor photograph between them would say that competing
and playing are the same occasion. His floor line and his lighting are untouched by either
(ARCHITECTURE §32).

### Obedience Trial — the primary contest, and build this one properly

Perfect fit for the frontal rig, and it's the mechanical payoff of the whole training system.
One contest done beautifully beats three done thinly.

- **Score 0.00–10.00, two decimals.** The precision matters: it makes a 9.34 feel earned and a
  9.61 feel like a triumph.
- **Judged on performance *and* grooming.** Dirty or filthy deducts; clean or beautiful gives a
  bonus. This is the load-bearing design detail — it makes the stage-2 care loop *earn its
  place* rather than being a chore list. Bath before a trial should be an obvious good idea
  she works out herself.
- The judge calls tricks; some **held** for a duration, some as **sequences**. Hold length
  scales with how deeply the trick has been practised (stage 3 exposes `holdFor`).
- A **free-performance** window at the end, where the deeper tricks earn the big points.
- **She may not touch the dog during a trial.** In the original this was the point: it was the
  true test of whether training had actually worked. We can honour it literally — voice is
  confirmed working on the target device — with **tap cues at fully equal status**, never a
  degraded mode. What's forbidden during a trial is *petting him through it*, not tapping.

Use stage 3's interfaces: `repertoire()` for a fair trick-and-hold choice, `perform(id,
{judged:true})` which asks **by id** (the judge says the word aloud, so cue interpretation is
bypassed) and suppresses treats and hints, `onPerform` to subscribe, `latency` as the
stopwatch stopping at `poseAt`, `correct` as `trick === asked`, and `held`/`holdKept`.

### Disc — reframed as catch-and-leap ✅ BUILT (stage 9, ARCHITECTURE 31)

Not a distance fetch; that needs a rig we deliberately didn't build. She flicks the disc
**up-screen**, he tracks it upward from the front, and she **times a tap for the leap and
catch**. Score by height and airtime rather than distance zone. Reuses the frontal-safe throw
built for toys in stage 2. Ship it if budget allows; Obedience is the one that must be right.

### Agility — cut

Its top-down route map *is* the mechanic, so it fights this rig hardest, and it carries the
least emotional payload. If a movement contest is ever wanted, **Lure Coursing** is the better
candidate — a reel-and-chase framed as the dog running *toward the camera*, nearly free on a
frontal rig and genuinely tense.

### ⚠️ Breed is COSMETIC. This overrides ARCHITECTURE §4.

The architecture's `Dog.aptitude` says "rolled at adopt from breed + jitter". **Drop the breed
term.** The research found no sourced evidence Nintendogs modelled per-breed contest stats at
all, and that the folklore ("retrievers are better at disc") was probably just folklore.

Two reasons this matters more here than in the original:
1. It avoids a balancing problem we have no reason to take on.
2. **Her dream breeds must never be mechanically inferior.** The gift puppy is a Schnoodle and
   the Cockapoo is the reward for saving up. If either turns out to be a bad obedience dog,
   the game has told her her favourite dog is the wrong dog. Unacceptable.

Per-*dog* jitter is fine and good — it makes individuals feel individual. Per-*breed* bias is
forbidden.

### Economy — two currencies, and keep the separation verbatim

This is the strongest structural idea in the original and it costs nothing to reproduce:

| Currency | Earned by | Spends on |
|---|---|---|
| **Coins** | Contest placings; selling walk finds | Toys, treats, care tools, collars, decor |
| **Care points** | *Caring well* — feeding, washing, brushing, walks, training, turning up | Nothing directly. **Unlocks** breeds, decor, shop stock |

**Money is skill and luck; points are attentiveness.** She cannot buy her way to the Cockapoo,
and she cannot grind contests for a new rug. That separation is why the care loop had teeth
without being a shop. Keep it exactly.

### Classes — keep the shape, compress the grind hard

Five classes (Beginner → Open → Expert → Master → Championship), advancing on a **top-three
placing**. Championship needs a **≥9.00 average** to hold and **>9.60** to win — those
thresholds are worth keeping because they give the ceiling a real name.

Prize shape from the original, as a starting point for tuning: 100/50/30 → 200/100/60 →
300/150/90 → Master 400 → Championship 600.

But **compress the ladder ruthlessly.** The original's top breed sat at 50,000 trainer points
against a 200/day cap — a *months*-long grind built to retain a 2005 handheld player with no
notifications and no competition for attention. Target **days, not months**, to reach the
Championship. Entry gate stays (a hungry or parched dog shouldn't compete) but must read as
*looking after him*, never as a punishment.

### Non-negotiables
- **Losing must never feel like rebuke.** A bad score is him being distracted or her needing
  more practice — never the game telling her she's neglectful. No guilt, ever.
- No affection bar. Contest feedback is his body language plus the judge's number.
- Daily entry limits are fine as pacing, but never as a wall she hits and resents.
- Cut outright: rank ladders per contest type, the item long tail, the hotel, Bark Mode, and
  trainer points as a multi-week grind.

## Stage 6 — Shop, kennel, breeds, personalisation

- **Breeds**: quality over roster size. The reference breed is the Shiba Inu. **Her dream
  breed is the priority addition** and should be the best-looking dog in the game.
  Target a handful of excellent breeds, not twenty mediocre ones.
  - **Resolved, 8.23.0: three breeds, and all three are ownable.** "The reference breed"
    was read for eight stages as "the breed the renderer is *tested* against", which is
    how a finished, drawn, precached Shiba came to have no path into the game — not the
    gift, not on the care ladder, and one hardcoded adoptable breed in `economy.kennel`.
    He is the ladder's last row at **1600 care points** (`careWords`' threshold for
    *devoted*), the kennel holds **three**, and a breed is now a data row carrying its own
    `breedId` and `sex` so a fourth needs no UI change. That is the handful.
- **Kennel copy names no dog.** Every line on the adoption card and in its beat is a
  function of a ladder row and a pronoun table. This is not tidiness: the Cockapoo being
  spelled out in `ui/kennel.js`'s COPY was half of why there was nowhere to put a second
  adoptable breed.
- **The first-launch gift** — decided: the puppy arrives **unnamed**, and she names it.
  That naming moment is the emotional centre of first launch; give it room, don't rush it
  with UI chrome. Breed and sex still to be confirmed by the human.
- **Kennel**: adopting a second dog is a real milestone, not a menu.

## Stage 7 — PWA polish

Beyond the architecture doc's list, from research §1 item 9 — **sound is the cheapest large
win available.** Sparse and foley-forward, not musical: yips, whines, contented panting,
claw-clicks on floorboards, a toy squeak, the slop of drinking. Per-dog vocal identity by
pitch-shifting a shared bank costs nearly nothing and does enormous work for individuality.
All synthesised in WebAudio — no asset files. Mind the AudioContext unlock landmine in
`docs/PLATFORM-RISKS.md`, which silently kills all sound if unhandled.

Installation is a **data-integrity requirement**, not a growth tactic — see the storage
eviction risk. The install prompt must give the honest specific reason ("this keeps her
progress safe"), not a generic banner.
