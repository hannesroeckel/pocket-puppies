# Gift-ready checklist

The human decided (2026-07-30) to **hold the game back until it's genuinely gift-ready**
rather than share an early build. This is the bar. It is deliberately not "feature complete" —
it's "good enough to hand to someone as a present."

Status legend: ✅ done · 🔧 in progress · ⬜ not started

---

## 1. Blockers — it is not a gift until every one of these is true

| # | Requirement | Why it blocks | Status |
|---|---|---|---|
| 1.1 | **The gift puppy is a Schnoodle**, not the placeholder Shiba | Her dream breed. The first-launch naming moment is one-shot — spending it on the wrong dog cannot be undone | 🔧 brows |
| 1.2 | **Her progress cannot be silently deleted** | iOS wipes all site storage after 7 days of Safari use without a revisit. She could build a week of bond and lose it | ✅ `sw.js` precaches all 48 assets; the update path never wipes a save (15/15 checks, ARCHITECTURE §16.2) |
| 1.3 | **Installable to the home screen**, with an honest reason given | Installing is what exempts us from that storage wipe. It's a data-integrity requirement, not a growth tactic | ✅ real PNG icons + a quiet, twice-only, three-doors-out card (15/15, §16.3/§16.6) |
| 1.4 | **Sound exists** | The research called sparse foley the cheapest large win available; silence makes a pet game feel like a tech demo | 🔧 43 synthesised recipes, 65 names, per-dog voice (24/24 structural) — **but audibility needs a human ear on the phone**, §16.8 |
| 1.5 | **Works fully offline** | Promised in the architecture: a tunnel, a plane, her parents' house | ✅ network killed in Playwright, reloaded, boots and plays with zero requests (11/11, §16.7) |
| 1.6 | **Save export/import reachable in the UI** | The only rescue path if storage is ever lost, and the only way off this host | ✅ |
| 1.7 | **Verified on the real target iPhone**, installed, by a human | Everything so far is headless Chromium. Real Safari differs, and the mic already proved that | ⬜ |
| 1.8 | **No text unreadable anywhere** | `toast.js`, `hud.js`, `sheet.js`, `nav.js` still bypass `ui/text.js`; the toast is the lowest-contrast text on screen | ⬜ |

## 2. Quality bar — things that would make it feel unfinished

| # | Requirement | Status |
|---|---|---|
| 2.1 | The Schnoodle's face reads as *pleased to see you* — not sad, sly, or stuck-together | 🔧 |
| 2.2 | 60fps on her actual phone, including after 10 minutes of play (thermal throttling untested) | ⬜ |
| 2.3 | Nothing in the nav leads to a "coming soon" stub | ✅ Shop was the last one; 8 pills, 0 unavailable, and the toast line is gone (§17.6) |
| 2.4 | A first session with no instructions is obvious — petting discoverable without a tutorial | ⬜ |
| 2.5 | Dark mode doesn't wash anything out (her phone is in dark mode) | partial |
| 2.6 | The Cockapoo is reachable — a real thing to save for, not a locked door | ✅ 400 care points, day 2–3 of attentive play, adopted through a milestone beat, and 10M coins still cannot reach her. 🔧 she renders as the fallback breed until the breed branch lands (§17.7) |

## 3. Explicitly NOT required for the gift

Scope discipline. These are nice-to-haves that must not delay handing it over:

- Disc contest (Obedience is the one that must be right)
- Agility — cut entirely, see SCOPE.md
- More than two breeds beyond the Shiba
- Room decor variety, multiple rooms
- Notifications of any kind — **deliberately off**; the fastest way to turn a present into an obligation
- Multiple dogs at once beyond the Cockapoo
- Cloud save

## 4. The one-shot moments — get these right, they don't come back

1. **First launch.** An unnamed Schnoodle, and she names him. No UI clutter, no tutorial in front of it.
2. **The first reunion.** Comes 8+ hours after she first plays, so it lands on day two without her expecting it.
3. **The first time a trick works.** After the mis-association wobble, the moment he gets it.

## 5. Current honest state

**Live and working:** petting with sweet/bad zones and rhythm, four care actions, mood/affection
split, the reunion, the naming beat, eight tricks with mis-association and mood/trust gating,
voice cues, walks with route-biased discovery, and a solved-contrast text system.

**Verified with numbers:** 60fps headless throughout (1.2–2.6ms median frame work), zero console
errors, zero external requests, v1→v4 save migrations each tested, walks survive a full app
close, real device measured 17.0ms median frame time with headroom.

**Remaining work to clear this checklist:** finish the Schnoodle's face, merge the breed branch,
stage 5 (contests + economy, in flight), stage 6 (shop + kennel so the Cockapoo is reachable),
stage 7 (service worker, install prompt, foley sound), the text retrofit, and a real-phone pass.

> Note: blocker 1.2's severity is still unconfirmed — the storage-eviction risk is documented
> but unproven on this device. Re-running `/probe.html` 8+ days after 2026-07-29 will show
> whether a save actually survived. Either way 1.2 and 1.3 get built; the probe just tells us
> how close we came to a real loss.

---

## 6. Stage 7 update — 2026-07-31

**Blockers 1.2, 1.3 and 1.5 are done and verified. 1.4 is built and structurally verified but
needs a human ear.** Full detail in `docs/ARCHITECTURE.md` §16.

What changed against this checklist:

- **1.2 / 1.5** — `/sw.js` precaches all 48 assets into one versioned cache and never writes to
  a cache at runtime, so a page load can never straddle two generations. Install is
  all-or-nothing, so a deploy caught mid-flight cannot half-update her. The swap happens only
  while the app is hidden and only after the save is flushed, so what she is playing never
  changes under her. **Measured: network killed, reloaded, boots and plays, zero network
  requests, save intact (11/11). v1 installed → v2 deployed under a live client → the update
  taken → name, bond, coins, trick ledger and his voice all survive (15/15).**
- **1.3** — the manifest's inline SVG data-URI icons are gone. iOS does not support SVG or
  `data:` icons for an installed web app and falls back to a **screenshot of the page**, so the
  home-screen tile really would have been a picture of a half-drawn room. Real PNGs
  (180 / 192 / 512 / maskable-512), drawn in code, committed as files, plus the
  `apple-touch-icon` link that is the actual fix. The prompt gives the true reason
  ("Keep Pip safe … in a browser tab, iPhone tidies away saved games after a week"), appears at
  most twice ever, has three ways out, and never appears when installed.
- **1.4** — `engine/audio.js` is no longer a stub. 43 synthesised recipes, 65 names, nothing
  owed (`audio.pending` is empty for the first time since stage 1), per-dog voices from a shared
  bank, and a sound toggle that disconnects the graph and survives reloads. **This is the one
  item not fully closed: audibility cannot be verified headlessly.** See §16.8 for what to
  listen for.
- **2.5 (dark mode)** — every stage-7 render was made in dark mode, and the install card was
  additionally checked in light mode and under `prefers-reduced-motion`.

Still open, unchanged by this stage: **1.1** (the Schnoodle), **1.7** (the real-phone pass, which
1.4 now depends on), **1.8** (already reported complete in ARCHITECTURE §15.7 — zero `fillText`
outside `ui/text.js`, and stage 7 added none), and all of §2 except 2.5.

**One new defect logged, not fixed:** the bowl floats in mid-air during feeding and drinking,
and the head has also already sunk into the torso for ~75% of those animations. Diagnosed,
measured frame by frame, and handed over with the specific trap that will catch the next
attempt — ARCHITECTURE §16.9. It belongs in §2 (quality bar) rather than §1: it looks wrong,
but it cannot lose her anything.

---

## 7. Stage 6 update — 2026-08-03

**The floating bowl is fixed, and 2.3 and 2.6 are closed.** Detail in `docs/ARCHITECTURE.md` §17.

- **The bowl.** He now folds his front end down — shoulders and chest first, neck and muzzle
  second — and eats from a bowl standing on the rug between his front paws. Both failure modes
  are asserted **on every frame of the whole animation**, not sampled: the bowl's base is on the
  floor on 805/805 feed and 856/856 water frames (gap 0.00), and the head sinks through the belly
  on **0** frames, down from 184/247 and 164/243. The head-drop is now a share of each dog's own
  head-to-belly room rather than a count of pixels measured on the Shiba, so it holds for breeds
  nobody has drawn yet — checked against eight synthetic proportion distortions, 9/9 pass.
- **2.3.** The Shop was the only "coming soon" left, and it is a real surface now. The nav has
  eight pills, none unavailable, and `navAction`'s toast line has been replaced with a silent
  programmer backstop — nothing a player can reach promises a feature.
- **2.6.** The Cockapoo costs **400 care points and no coins**, reachable on day 2–3 of attentive
  play. Verified that 10,000,000 coins unlocks nothing, cannot adopt her, and cannot buy any row
  in the unlocks table; that buying an object and giving a treat both move **zero** care points;
  and that adopting spends nothing at all. Adopting runs a short beat and then hands her to the
  room, which opens the naming beat by itself.
- **2.5 (dark mode)** re-checked: the full per-frame bowl gate and the whole stage-6 screenshot
  pass were run in dark mode, in light mode and under `prefers-reduced-motion`, with identical
  results and no errors. The earned blue rug is deliberately the cooler of the two, because the
  warm rug is the brightest thing on screen at night.

**Still open:** **1.1** (the Schnoodle — the breed branch), **1.7** (the real-phone pass, which
1.4 and 2.2 depend on), **2.1**, **2.2**, **2.4**. And one honest gap inside 2.6: the Cockapoo is
reachable, adoptable and correct in the save, but until the breed data lands she renders with the
Shiba's silhouette, so the two dogs currently look alike.

---

## 8. Status as of 2026-08-04 — seven of eight blockers cleared

The table in §1 above is now out of date in several rows; **this section is authoritative.**

| # | Blocker | Status |
|---|---|---|
| 1.1 | Gift puppy is a Schnoodle | ✅ **Merged.** `feature/curly-breeds` landed at `25d9ae4`; `BALANCE.gift.breedId` is `schnoodle`. A fresh save opens on a warm auburn Schnoodle in the naming beat. |
| 1.2 | Progress cannot be silently deleted | ✅ |
| 1.3 | Installable, with an honest reason | ✅ |
| 1.4 | Sound exists | ✅ built. iPhone silence turned out to be **the ringer switch, not a bug**. Now overridden behind `audio.overrideSilentSwitch` (default `true`) because she usually keeps her phone silent; the in-game toggle is an absolute kill switch. **Audibility still needs a human ear.** |
| 1.5 | Works fully offline | ✅ |
| 1.6 | Save export/import in the UI | ✅ |
| 1.7 | **Verified on the real iPhone, installed, by a human** | ✅ **Closed — the gift shipped, it is on her Home Screen, and she is playing it (§9).** |
| 1.8 | No unreadable text | ✅ verified independently — zero `fillText` outside `ui/text.js`; the only two remaining matches are comments describing the old code. |

**Quality bar:** 2.1 ✅ (warm auburn, eyebrows removed on request, reads cute), 2.3 ✅,
2.5 ✅, 2.6 ✅ **fully** — the Cockapoo now renders as herself (pale apricot, long fringed
ears), verified post-merge and clearly distinct from the Schnoodle. 2.2 and 2.4 still need
a real device and a real first-time player.

### The floating bowl — reopened and properly fixed
Hannes saw the bowl still hovering and sent a screenshot. **He was right and the previous
"verified" claim was wrong**, in a way worth recording:

> The assertion `A_bowlBaseOnFloor` passed 805/805 frames at gap 0.001 — because it compared
> the bowl's base against **the very number the bowl's position was computed from**. Zero by
> construction, for any pose, any breed, any size of bug. Meanwhile the eating pose put the
> dog's drawn paws 23–26 units lower.

A second bug hid underneath it: `pose.pawSole` omitted `dims.pawScale`, which the renderer
applies. The two doodles have oversized paws — but the **Shiba doesn't**, so the one breed
everything had been tuned against was the only one where the two agreed.

Fixed at the reference frame: `rig.floorV` is now a single room-space floor line that both the
bowl and the dog's planted paw resolve against, with the legs absorbing the difference.
`standToEatShift` is now exactly **0.0**. Eating and drinking were **rendered and looked at on
all three breeds** — which is the check that actually works.

### Standing lesson
Twice now a confident numeric gate has passed while the screen was visibly wrong. Numbers
verify what you pointed them at; only looking verifies what she'll see. Every visual claim in
this project needs a render someone actually viewed.

---

## 9. The gift has shipped — 2026-08-13

**Hannes reports the game is gifted and running on her phone in Safari.** So blocker **1.7 is
closed**: it asked for the real target iPhone, installed, exercised by a human, and the strongest
possible version of that has happened — a real player has it. Section 8's table is superseded on
that row only.

This section is authoritative for what 1.7 leaving the list does and does not settle.

### 9.1 It closes 1.7. It does not settle the three items that were waiting behind it

| # | Requirement | Status now |
|---|---|---|
| 1.4 | Sound is audible on the phone | ⬜ **still unconfirmed.** Built and structurally verified (43 recipes, 24/24), the ringer switch is overridden, but nobody has reported hearing it. One question to her answers this. |
| 2.2 | 60fps on her phone, including after ten minutes | ⬜ **still unmeasured.** A real device was once measured at 17.0 ms median with headroom; sustained play and thermal throttling never were. What matters now is whether she has noticed it getting sticky. |
| 2.4 | A first session with no instructions is obvious | ⬜ **answerable for the first time, and only once.** Whether she found petting without being told is a fact about a moment that has already happened. Ask before the memory of it goes. |

None of these needs a build. They need her, or a question to her.

### 9.2 She is installed, so Risk 1 does not apply

**Confirmed with Hannes: it is on the Home Screen, not in a Safari tab.** That is the answer the
whole storage argument was waiting on.

`docs/PLATFORM-RISKS.md` Risk 1 — ITP deleting `localStorage`, `IndexedDB` and the service worker
registration together after 7 days of Safari use without first-party interaction — **exempts
installed Home-Screen web apps.** So the highest-severity risk in the project, the one blockers
1.2 and 1.3 were built against and the one the honest install card exists to talk her into, is
retired in practice. A fortnight away from the game now costs a hungry, grubby, delighted dog and
nothing else, which is exactly what the design promised.

Two consequences worth having written down:

1. **The offline promise is real for her, not just in a harness.** An installed app with a
   registered service worker holding a complete precache is the configuration §16.7 measured:
   network killed, reloaded, boots and plays, zero requests. The tunnel, the plane and her
   parents' house are covered.
2. **Export is now a backup, not a rescue path.** It stops being the thing standing between her
   and a silent wipe, and becomes what it should be: the way off this host, and the answer if the
   app is ever deleted from the Home Screen — which takes its storage with it, exemption or no.
   Still worth doing once, and no longer urgent.

Nothing here needs building. It needed asking.

### 9.3 Deploying is now a live act

`git push` is the deploy (ARCHITECTURE §1), and there is a real player on the other end of it. The
service worker's rules were built for exactly this and hold: one generation per cache, install is
all-or-nothing, the swap happens only while the app is hidden and only after the save is flushed,
and the update path has never wiped a save in 15/15 checks. **But the cache version must move on
every deploy** — a phone holding `pp-cache-v8.7.1` serves 8.7.1 for ever otherwise.

`feature/training-clarity` is committed and **not pushed**. It carries cache 8.8.0 and a new
precached module, so landing it is a real update to a game someone is playing, and it is Hannes's
call when that happens.
