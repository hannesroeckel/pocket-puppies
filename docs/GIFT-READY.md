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
| 2.3 | Nothing in the nav leads to a "coming soon" stub | ⬜ |
| 2.4 | A first session with no instructions is obvious — petting discoverable without a tutorial | ⬜ |
| 2.5 | Dark mode doesn't wash anything out (her phone is in dark mode) | partial |
| 2.6 | The Cockapoo is reachable — a real thing to save for, not a locked door | ⬜ |

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
