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
needs the rig we didn't build. The uncertainty is the mechanic: sometimes it returns the toy,
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

**Obedience Trial (primary).** Judge calls a trick, dog performs it, scored on speed and
correctness. Pure frontal rig, zero new art, and it makes stage 3's training *matter* —
which is the real reason it's the one worth keeping.

**Disc, reframed.** Not a distance-fetch. She throws up-screen, the disc arcs back toward the
camera, and she times a tap for the dog's **leap and catch**. Frontal, dramatic, and it uses
the throw mechanic already built for toys in stage 2.

**Agility: cut.** Revisit only if everything else is finished and loved.

**Economy — deliberately compressed.** The original's five-rank ladders, trainer-point breed
grind, and hundreds of item SKUs were 2005 retention scaffolding for a device with no
notifications. Keep: coins from contests, a small curated shop (toys, treats, collars, a
little decor), and breed unlocks priced so a second dog is a genuine event. Cut: rank
ladders, the item long tail, the hotel, Bark Mode, trainer points as a multi-week grind.

## Stage 6 — Shop, kennel, breeds, personalisation

- **Breeds**: quality over roster size. The reference breed is the Shiba Inu. **Her dream
  breed is the priority addition** and should be the best-looking dog in the game.
  Target a handful of excellent breeds, not twenty mediocre ones.
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
