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
| 1.2 | **Her progress cannot be silently deleted** | No service worker exists yet. iOS wipes all site storage after 7 days of Safari use without a revisit. She could build a week of bond and lose it | ⬜ |
| 1.3 | **Installable to the home screen**, with an honest reason given | Installing is what exempts us from that storage wipe. It's a data-integrity requirement, not a growth tactic | ⬜ |
| 1.4 | **Sound exists** | `engine/audio.js` is a 58-line stub. The research called sparse foley the cheapest large win available; silence makes a pet game feel like a tech demo | ⬜ |
| 1.5 | **Works fully offline** | Promised in the architecture: a tunnel, a plane, her parents' house | ⬜ |
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
