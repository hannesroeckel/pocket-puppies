# Platform risks — iOS Safari

Derived from `docs/nintendogs-design-reference.md` §3, which cites WebKit blog posts,
bugs.webkit.org and Apple Developer Forums. Read that section for sources.

**Everything here must be confirmed on the actual target phone** using `/probe.html`,
run twice: once in a Safari tab, once installed to the Home Screen. Two of these risks
behave *differently* in those two modes, which is exactly why the probe exists.

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

## Risk 2 — Voice is the feature most likely to die

- `SpeechRecognition` is **explicitly blocked in installed PWAs** — it errors without even
  prompting. `continuous` mode is broken on iOS; `interimResults` is unreliable; it needs
  the network. So the mode we *must* ship in is the mode where it *doesn't work*.
- The fallback is also suspect: WebKit bug 185448 has `getUserMedia` failing in standalone
  mode, behaving "as if there is no camera." Granted-but-silent streams are the failure
  shape — which is why `probe.html` doesn't just check permission, it verifies real audio
  samples flow.

**Design response — and this one is an improvement, not a concession:** treat the mic as a
**gesture sensor** (loudness, duration, pitch envelope), never as speech recognition. Crude
envelope matching gives us *authentic mis-association* — the dog mishearing its name is the
charm of the original, not a bug in it. The touch/tap cue path stays at fully equal status,
never a degraded mode, and nothing in progression may depend on the mic.

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

| Capability | Status on iOS |
|---|---|
| Web Push | Needs Home-Screen install + `display: standalone` + a user gesture |
| `AudioContext` | Starts **suspended**; must `resume()` inside a gesture or all sound silently dies |
| Vibration API | **Unavailable** — no haptics. Don't design feedback that needs it |
| Fullscreen API | **Unavailable** on iPhone (installing is the substitute) |
| Wake Lock | **Unavailable** — the screen will sleep during a long cuddle |
| `beforeunload` | Unreliable. Save on `visibilitychange`→hidden and `pagehide` instead |

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
