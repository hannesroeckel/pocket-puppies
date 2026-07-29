# Platform risks — iOS Safari

Derived from `docs/nintendogs-design-reference.md` §3, which cites WebKit blog posts,
bugs.webkit.org and Apple Developer Forums. Read that section for sources.

---

## ✅ MEASURED ON THE REAL DEVICE — 2026-07-29

Probe run on the actual target phone, **installed to the Home Screen** (standalone):
**iPhone, iOS 18.7, Safari 26.5.2**, 393×852 @ dpr 3, 4 cores, dark mode on.

**Two of the predictions below were wrong, in opposite directions.** Trust this section
over the research where they conflict.

| Thing | Predicted | **Actually measured** |
|---|---|---|
| `SpeechRecognition` | blocked in installed PWAs | ✅ **WORKS** — returned a full accurate transcript |
| Raw mic samples | should work as fallback | ❌ **BROKEN** — granted, live track, **zero samples** (bug 185448) |
| `storage.persist()` | does nothing on iOS | ✅ **granted `true`**; quota 39 GB |
| Wake Lock | unavailable | ✅ **available** |
| Vibration / haptics | unavailable | ❌ confirmed unavailable |
| Frame time | unknown on real hw | ✅ **17.0 ms median AND p95** → dead-stable 59 fps at capped dpr 2.25 |
| `AudioContext` | starts suspended | ✅ confirmed; `resume()` in a gesture works |

**Consequences:**
1. **Voice is back on.** Use `SpeechRecognition` **single-shot** (`continuous:false`,
   `interimResults:false`, `maxAlternatives:1`) — the exact config proven to work. Trigger
   from an explicit gesture. It needs **network** (server-side), so it fails offline → must
   degrade silently to tap.
2. **The "mic as gesture sensor" plan is dead.** No samples means nothing to analyse. Anything
   needing raw audio (blowing into the mic, volume-reactive behaviour) is not viable.
3. **Perf budget confirmed** with real headroom. The dpr 2.25 cap is doing its job.
4. **No haptics.** Never design feedback that depends on vibration.
5. **The phone is in dark mode** — the game is a warm *light* design. Verify nothing inverts
   or washes out; `color-scheme: light` is set but worth eyeballing.
6. Storage is **healthier than feared**, but ship export/import anyway — see below.

> ⏳ **Still unconfirmed:** whether a save actually *survives* a week. The probe recorded its
> first run; re-running it after 8+ days will show a "survived since first run" figure. Until
> then, treat the 7-day eviction risk as unproven-but-plausible rather than settled.

---

## Risk 1 — Storage eviction (highest severity, above the microphone)

**Intelligent Tracking Prevention deletes all script-writable storage after 7 days of
Safari use without first-party interaction.** That means `localStorage` **and**
`IndexedDB` **and** the service worker registration. Not a quota issue — a deliberate
privacy sweep. A months-old bond, gone.

**Installed Home-Screen web apps are exempt.** This is the load-bearing fact.

Consequences, all binding:

1. **Installation is a data-integrity requirement, not a growth tactic.** The game must
   detect `display-mode: standalone` / `navigator.standalone`, and when running in a plain
   tab it must warmly, non-naggingly explain that adding it to the Home Screen is what
   keeps the puppy safe. Not a generic "install our app" banner — a specific, honest reason.
2. **Export/import is not optional.** A copy-pasteable save string is the only rescue path
   and the only way off this host. Ship it in stage 1, not as polish.
3. `navigator.storage.persist()` — **assume it does nothing here.** It is largely a
   Chromium/Gecko affordance; do not treat a `false` return as an error, and never rely on
   it. Call it guarded, log the result, move on. (The architecture doc originally implied
   this was a real mitigation on iOS. It isn't.)
4. Consider a lightweight cloud save (or at minimum an automatic reminder to export)
   earlier than the feature list would suggest.

## Risk 2 — Voice — ⚠️ SUPERSEDED BY MEASUREMENT, SEE TOP OF FILE

**The prediction below was wrong and is kept only for the record.** Real recognition
**works** on the target device; the **raw mic is what's broken**. Build voice with
`SpeechRecognition` single-shot, not with envelope detection.

~~Original prediction:~~ `SpeechRecognition` is *explicitly blocked in installed PWAs*;
`continuous` mode is broken on iOS; `interimResults` is unreliable; it needs the network.
The fallback was also suspect: WebKit bug 185448 has `getUserMedia` failing in standalone,
behaving "as if there is no camera."

**What actually holds:**
- `SpeechRecognition` single-shot works and transcribes accurately, *even installed*.
- `getUserMedia` **does** exhibit bug 185448 here — permission granted, live track, no samples.
  So the envelope/gesture-sensor idea is unbuildable.
- `continuous` mode remains untested and unproven — **don't use it**. Single-shot only.
- Recognition is **server-side, so it needs network.** This game must work offline, so voice
  must degrade silently to tap whenever it's unavailable.

**What survives from the original design thinking, and still matters most:** the dog decides
whether to come based on **mood and trust**, never on recognition accuracy. She calls, his
ears prick, and he chooses. A mishearing must read as *him being distracted*, never as broken
software — that legibility was the accident that made the original magic. Tap stays fully
equal-status, and nothing in progression may depend on voice.

## Risk 3 — No background execution

iOS **suspends JavaScript entirely** when the app isn't foregrounded. Timers don't throttle,
they stop. So:

- All offline progression is a **pure function of elapsed wall-clock time**, computed once on
  resume. Never an accumulating tick.
- Include a **monotonic clock-tamper guard** (a `lastSeenAt` that moves backwards means the
  device clock changed; clamp rather than trust it).
- Cap catch-up at 36–48h so a long absence is never punished proportionally. This aligns with
  the "the dog never resents her" principle in the architecture doc.

## Other confirmed limits

| Capability | Status on iOS | Measured? |
|---|---|---|
| Web Push | Needs Home-Screen install + `display: standalone` + a user gesture | `PushManager` present ✅ |
| `AudioContext` | Starts **suspended**; must `resume()` inside a gesture or all sound silently dies | ✅ confirmed exactly this |
| Vibration API | **Unavailable** — no haptics. Don't design feedback that needs it | ✅ confirmed absent |
| Fullscreen API | **Unavailable** on iPhone (installing is the substitute) | not probed |
| Wake Lock | ~~Unavailable~~ → **available** on iOS 18.7 | ✅ present |
| `beforeunload` | Unreliable. Save on `visibilitychange`→hidden and `pagehide` instead | — |
| `OffscreenCanvas` | Available — usable for pre-baking sprites | ✅ present |
| Safe-area insets | 20px top / 40px bottom on this device; usable viewport 393×793 | ✅ measured |

## Camera-angle verdicts (from §1/§10 of the reference)

The chosen art style has one near-frontal rig. The research recommends:

- **Obedience Trial** — perfect fit for the frontal rig. Should be the primary contest.
- **Agility** — its top-down route map *is* the mechanic; it fights this rig hardest.
- **Disc** — reframe as a frontal *catch-and-leap timing* game rather than a distance-fetch.
- **Walks** — reframe as draw-the-route → departure → **return with loot**, which converts an
  animation problem into an emotional beat.

> These are scope-shaping recommendations, **not yet decisions.** All four pillars were
> explicitly requested. Awaiting a call on how faithful vs. how well-fitted to be — see the
> open questions in the conversation.

## The probe

`/probe.html` (+ `probe.webmanifest`) tests all of the above on real hardware: display mode,
localStorage/IndexedDB, `persist()`, quota, service worker, Push, SpeechRecognition,
`getUserMedia` **including whether samples actually flow**, AudioContext state before and
after a gesture, haptics, wake lock, safe-area insets, and 180 frames of real canvas
fill-rate load for median/p95 frame time. It emits a copy-pasteable result blob.

Live: `https://hannesroeckel.github.io/pocket-puppies/probe.html`
