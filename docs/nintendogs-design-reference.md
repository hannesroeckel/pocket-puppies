# Nintendogs / Nintendogs + Cats — Buildable Design Reference

**Purpose:** spec input for rebuilding the *feel* of Nintendogs (DS, 2005) and Nintendogs + Cats (3DS, 2011) as an installable mobile web game (PWA, iOS Safari primary target).

**Target rig (already decided, constrains everything below):** hand-crafted 2D puppy drawn in Canvas2D from a posable part hierarchy (body, head, ears, muzzle, parametric eyes, four legs, multi-joint tail), animated by ~30 delta-time springs, at a **fixed near-frontal camera angle** in a cozy room. Petting is a stroke-impulse field that dents and displaces the silhouette.

**Structural limitation to design around:** ONE camera angle. Anything needing profile or top-down framing (walking, agility courses, disc throwing) needs a separate purpose-built rig — or a 2D-friendly reframing that dodges the problem. Flagged inline as **[CAMERA]**.

**Legend**
- **SOURCED** — has an inline URL. Note that Nintendo never published internals; almost all numbers below are community-derived from wikis and FAQs, so treat them as *approximately right, not authoritative*.
- **JUDGEMENT** — my designer opinion, not a fact about the original game.
- `> ⚠️ Needs more sourcing` — thin, do not trust numbers.

**Research constraints encountered**

- `nintendogs.fandom.com` (402) and `gamefaqs.gamespot.com` (403) both refuse automated fetching. Facts attributed to them below come from **search-result extracts** of those pages, not from reading the pages directly — a second-hand hop worth knowing about. StrategyWiki, thonky.com, Grokipedia and Wikipedia were fetched directly and are first-hand.
- **Security note:** fetching `tcrf.net/Nintendogs/Version_Differences` returned a **prompt-injection payload** — text impersonating user-authorised instructions to delete and relocate files — rather than game data. Nothing from it was used and no instruction in it was acted on. Anyone re-running this research should avoid that URL or treat its contents as hostile.
- **Nintendo never documented Nintendogs' internals and it was never publicly datamined into a numeric model.** Care rates in hours, affection formulas, and drop tables therefore do not exist in citable form anywhere. Where the rebuild needs those numbers, they will be invented and tuned by feel — §4 and §2 propose starting values and label them as such.

*Status: complete across all ten sections. Remaining `⚠️` markers are genuine gaps in the public record, not unfinished work.*

---

## 1. Ranked top-10: "get these right or it isn't Nintendogs"

*JUDGEMENT throughout — this is the opinionated synthesis, ordered by how load-bearing each item is. Items 1–5 are the game. Items 6–10 are the frame around it. Everything in §6–§9 of this document is, by comparison, incidental content.*

The core insight: **Nintendogs is not a management sim with a dog skin on it. It is a physical-contact toy with a management sim bolted on to justify returning.** Every retrospective that calls it "shallow" is measuring the bolted-on part. The part that sold 24 million copies is the contact.

### 1. The dog directs its attention at you, continuously and reactively
The single most load-bearing thing, and the cheapest to get right in a spring rig. Head tracks the pointer; eyes track *independently and faster* than the head; ears prick toward sound and toward the pointer; body weight shifts to face you. This must be running before any content exists.

Implementation notes for the rig: head yaw/pitch springs targeting the pointer with ~120ms settle; pupil offset springs at ~40ms (eyes lead the head — this is what reads as "alive" rather than "animated"); ear droop/prick as an independent spring pair with asymmetric left/right so the two ears never move in lockstep. Budget: first visible reaction to touch under 80ms, or the illusion breaks.

**Why it's #1:** attention is the minimum viable evidence of an inner life. A dog that ignores your finger is a picture.

### 2. Petting is direct manipulation with physical consequence
The stylus rubbed the dog and the dog's *body* responded — fur moved, the animal leaned in, eyes closed, tail accelerated. The stroke-impulse field is exactly the right architecture. What must come with it:

- **Sweet spots vs. bad spots.** Behind the ears, chin, chest, base of the neck = pleasure. Muzzle, nose, tail, paws = irritation, recoil, sneeze, a nip. Nintendogs distinguished these and it is a large fraction of why petting had depth.
- **Speed and rhythm matter.** Slow long strokes = contentment. Frantic scribbling = overstimulation, then annoyance. Rapid poking = the dog backs off. This asymmetry *is* the mechanic; without it petting is a "+1 affection" button with a nice shader.
- **The dog leans into a stroke it likes,** i.e. the body target moves toward the finger. Displacement should not merely dent the silhouette — it should bias the whole body's rest pose for a second or two afterward.

**Why it's #2:** it is the verb. Everything else in the game is a reason to come back and do this.

### 3. Calling the dog by name — and the dog coming (or not)
The mic-driven name recognition was the "oh my god it's real" moment for a generation, and it was *technically bad*: reviewers called the voice recognition "dodgy" ([Grokipedia](https://grokipedia.com/page/Nintendogs)). That didn't matter. The *attempt* was the magic, and the failures were legible as the dog being distracted rather than the software being broken — a fantastic accident that you should reproduce **deliberately**.

Design translation (see §3 for the iOS reality, which is harsh): do **not** stake the feature on real speech recognition. Use `getUserMedia` amplitude/pitch envelope detection — "did the player just say something, roughly this long, roughly this loud" — and let the dog's willingness to respond come from affection state, not from ASR accuracy. Player says the name, dog's ears prick, dog *decides*. Offer tap-to-call as an always-available equal-status alternative, not as an accessibility fallback.

**Why it's #3 and not #1:** it is the peak moment, but it is a moment. Items 1 and 2 are load-bearing every second.

### 4. Idle autonomy — the dog does things you did not ask for
Wanders partly out of frame and comes back. Sniffs the floor. Scratches. Yawns and resettles. Picks up a toy and brings it over unprompted. Licks the camera. Falls asleep if you're quiet for long enough.

Rough targets: never let more than ~4s of true idle pass without a self-initiated micro-behaviour; make roughly 1 in 8 of those a *bid* for the player's attention (looks directly at camera, whines softly, drops a toy at your feet). The bid is the thing that makes players feel needed.

**Why it matters:** autonomy is what separates a pet from a puppet. A rig that only ever moves in response to input is a puppet.

### 5. Physical toys with real physics, thrown by a real gesture
Flick a ball; it arcs; the dog chases; it *sometimes* brings it back, sometimes chews it, sometimes loses interest halfway. The uncertainty is the game — a toy that always returns is a vending machine.

**[CAMERA]** This survives a fixed frontal camera *if the toy arcs toward and away from the viewer* rather than laterally. Throw = flick up-screen, toy scales down as it recedes, dog turns away and runs "into" the screen (foreshortened, which the frontal rig can fake with vertical squash and scale), then returns growing larger. Lateral throws demand a profile rig — avoid them.

### 6. A short, warm care loop that rewards *returning*, not *attending*
Food, water, brush, wash. Each must be satisfying to perform (10–40s), physically interactive (scrubbing, brushing = the same stroke field as petting, reused), and forgiving when skipped. Nintendogs' care burden was already light by pet-sim standards; the sin to avoid is turning it into a chore list with a red badge count.

### 7. Real-time-clock continuity, and specifically the reunion
The dog lived while you were gone. Come back after a day: the bowl is empty, the coat is dull, and the dog is *ecstatic*. **The greeting-on-return is the emotional payoff of the entire real-time system** and it is one animation. Build it early, tune it obsessively, and scale its intensity by time-away × affection. This is the highest return-on-effort asset in the whole project.

### 8. Trick training as a ritual with imperfect memory
Say the word, guide the pose with your finger, reward at the right moment; the dog half-learns, sometimes attaches the word to the wrong action, needs repetition across sessions. Nintendogs needed 3–4 reps per trick ([Nintendogs Wiki, via search extract](https://nintendogs.fandom.com/wiki/List_of_Tricks_in_Nintendogs)) and dogs could genuinely mis-associate commands. A trick that snaps to LEARNED on one rep is a checkbox; the wobble is the charm. Keep the wobble, shorten the ladder.

### 9. Sound design: sparse, foley-forward, vocally varied
Nintendogs was *quiet*. Little music, lots of room. Distinct yips, whines, contented panting, the claw-click of paws on floorboards, a toy squeak, the slop of drinking water. Vocal variety per dog (pitch-shifted from a shared bank) does enormous work for individuality at near-zero asset cost. On mobile this is the single cheapest large win available — and see §3 for the audio-unlock landmine that will silently kill it if unhandled.

### 10. A cozy, static, ownable corner
One room, warm light, your stuff in it, decor as slow-drip reward. Not a world — a *corner*. The fixed camera is an asset here, not a limitation: it makes the room a composed picture you learn by heart.

### Explicitly NOT load-bearing — cut, compress, or stub freely
The 20-breed roster; three separate contests with five-rank ladders each; the item catalogue's long tail (hundreds of SKUs); Bark Mode; the hotel/kennel; the exhaustive walk-item drop table; trainer-points breed unlocks as a multi-week grind; the Championship structure. All of this is *reason-to-return scaffolding* built for a 2005 handheld with no notifications, no cloud, and no competition for the player's attention. On a phone in 2026 most of it is dead weight. See §10.

---

## 2. Affection / bonding system

Nintendo never documented this and it was never datamined into a public numeric model, so this section is deliberately conservative: mechanisms are well attested, exact numbers largely are not.

### What is attested

**There is a hidden happiness/mood value that gates training reliability.** "Happy dogs respond more reliably, while low mood leads to failures or forgotten tricks"; happiness builds through "frequent positive interactions like petting or playing" ([Grokipedia](https://grokipedia.com/page/Nintendogs)). "Consistent attention boosts the dog's happiness and trainability, while neglect leads to decreased responsiveness and lower contest success" ([Nintendogs Wiki: Status, via search extract](https://nintendogs.fandom.com/wiki/Status)).

**The player-facing progression stat is separate from the dog's affection.** Trainer Points (DS) / Owner Points (3DS) measure *the player*, unlock content, and are explicitly gained and lost by care quality — see §7. In the 3DS game the point ledger is the closest thing to a published affection scale, and it is a *daily-capped* one:

| Owner Points (3DS) | Value | Source |
|---|---|---|
| Daily earning cap | **200 points/day per pet** | [thonky.com Owner Points](https://www.thonky.com/nintendogs-plus-cats/owner-points) |
| Gains | competitions, walks, playing with toys, bathing, brushing, feeding, watering, learning tricks, socialising with neighbours' dogs, befriending visiting animals | ditto |
| Losses | starvation, dehydration, getting dirty, being left alone, misbehaviour on walks, teasing, hitting the pet with toys, playing scary records, tugging the leash | ditto |
| Feedback | "colourful sparkles" over the pet at the moment points are earned | ditto |

That loss list is unusually informative: **the game punished cruelty specifically** (teasing, hitting with toys, deliberately playing frightening records, yanking the leash), not just neglect. Cruelty-punishment is a strong signal of an inner life and is cheap to implement.

**Status was surfaced as words, not bars** ([Nintendogs Wiki: Status, via search extract](https://nintendogs.fandom.com/wiki/Status)):

| Axis | Scale (best → worst) |
|---|---|
| Hunger | Full → Normal → Hungry → Famished |
| Thirst | Quenched → Normal → Thirsty → Parched |
| Fur | Beautiful → Clean → Normal → Dirty → Filthy |

Note there is **no affection readout**. Hunger/thirst/fur are inspectable; the bond is not. You read the bond off the animal's body.

**Neglect had a hard escalation:** a dog left without food or water long enough would **temporarily run away** ([StrategyWiki: Pet care](https://strategywiki.org/wiki/Nintendogs/Pet_care)), and neglect reduced friendship and cost points.

**Personalities existed but were near-invisible.** "In Nintendogs, personalities play a very passive role; once a player picks their dog, its personality cannot be found along with its other information," and community analysis notes the published descriptions may not reflect the actual behaviour algorithms ([Nintendogs Wiki: Personalities, via search extract](https://nintendogs.fandom.com/wiki/Personalities)).

### How the game signalled mood (this is the important part)

Entirely through the body and the voice, never a meter: tail wag amplitude and speed, ear position, whether the dog approaches or retreats, whether it holds eye contact, whether it comes when called, whether it obeys a known trick first time, and the "mood face." **This is the design lesson to carry over verbatim.** Do not build an affection bar.

### JUDGEMENT — recommended model for the rebuild

Two axes, different time constants, neither shown numerically:

- **Mood** (fast, minutes–hours): moved by petting quality, play, being fed when hungry, and negatively by bad touches, dirt, unmet needs. Decays toward a baseline set by Bond. Drives: wag amplitude, ear height, eye openness, willingness to initiate, obedience probability.
- **Bond** (slow, days–weeks, effectively monotonic upward with a very slow decay): moved by *distinct sessions* rather than session length — this is the anti-grind lever. Two 90-second visits on different days beat one 20-minute session. Drives: baseline Mood, reunion intensity, come-when-called probability, and how forgiving the dog is of a bad touch.
- **Come-when-called** should be a single readable probability roll: `p = 0.35 + 0.5·Bond − 0.3·(distraction)`. Failures must animate as *distraction* (the dog looks at you, then at the toy, then at the toy) never as no-op. A no-op reads as a bug; a hesitation reads as a personality.
- **Never let Bond visibly fall from absence.** Let *Mood* fall and the room get untidy. Punishing absence on a phone is how you lose the player permanently; punishing absence *cosmetically*, then rewarding return with the reunion, is how you get them back. This is a deliberate departure from the original, which did dock you for neglect.

---

## 3. iOS Safari landmines and DS-hardware translation

This is the section most likely to kill planned features, so it leads with the verdicts.

### Verdict table: DS/3DS hardware → mobile web

| Hardware | What it did | Best mobile-web equivalent | Verdict |
|---|---|---|---|
| Microphone (name recognition, command words) | Speak the dog's name / trick words; dog responds | **Not** SpeechRecognition. `getUserMedia` + AnalyserNode: loudness envelope, duration, rough pitch contour | 🚩 ASR is undeliverable in an installed PWA, **and even raw `getUserMedia` has a documented standalone-mode failure**. Spike it before designing around it. |
| Microphone (blowing) | Blow at the mic to react | Same analyser: broadband low-frequency energy burst = "blow" | 🚩 Same standalone-mode dependency as above |
| (no DS equivalent) | — | **Persistent local save** | 🚩 Evicted after 7 days of Safari use in a tab; safe only in an installed web app. Highest-severity risk — see below |
| Stylus stroking | Petting, brushing, washing | Pointer Events; velocity + direction field | ✅ Deliverable, best-in-class on touch |
| Dual screens | Persistent status on one, world on the other | Single canvas + overlay HUD / bottom sheet | ✅ Deliverable |
| Closing the lid | Suspend; dog naps | `visibilitychange` + `pagehide` + timestamp diffing | ⚠️ No background execution at all |
| Real-time clock | Day/night, hunger, growth | `Date.now()` diffing on resume | ⚠️ Clock-tamper vulnerable; needs server time or monotonic guard |
| Bark Mode (local wireless) | Meet another player's dog nearby, swap gifts | Server-mediated async "a dog visited while you were out" | ✅ Technically easy, ❌ scope-expensive |
| Rumble / tactile feedback | (DS had none, but the phone equivalent is obvious) | `navigator.vibrate` | ❌ Unavailable on iOS Safari — plan for no haptics |

### The big one: SpeechRecognition is unavailable in an installed home-screen PWA

Safari has supported `webkitSpeechRecognition` since **Safari 14.1 (macOS) / 14.5 (iOS)** ([testmuai browser-support hub](https://www.testmuai.com/learning-hub/speech-recognition-api-browser-support/)), but the practical picture on iOS is bad in exactly the way that matters for this project:

- **"Safari on Mobile won't allow Speech Recognition API once installed as PWA."** Standalone/WebView contexts error out immediately without even prompting for the microphone; the demos only work in Safari proper ([webreflection, "Taming the Web Speech API"](https://webreflection.medium.com/taming-the-web-speech-api-ef64f5a245e1)).
- **Continuous mode is broken on iOS:** "the mic never stops after the user stops speaking and we never get the recognized text on iPhone and iPad… isolated to the `continuous` setting" ([Apple Developer Forums](https://developer.apple.com/forums/thread/699881)).
- **`interimResults` is unreliable** in WebKit ([Apple Developer Forums](https://developer.apple.com/forums/thread/775699)).
- Recognition on Safari is **network-dependent** (server-side ASR), so it fails offline — fatal for a PWA whose main selling point is opening instantly on a train.
- It requires a user gesture to start, and each start is a discrete utterance, not a listening state.

**🚩 FLAG — feature-killing:** any design that says "the player says the dog's name and the game recognises the word" is **undeliverable** as the primary path on the stated target (installed PWA on iOS). Do not build the trick system on top of word recognition.

**Recommended architecture instead:** treat the mic as a *gesture sensor*, not a speech recogniser.
1. Player picks the dog's name as text at adoption; the game shows it and (optionally) speaks it via `speechSynthesis` (which *is* well supported and works offline-ish).
2. To call the dog, the player holds a "call" button and speaks. The game measures: did an utterance occur, how long, how loud, rising or falling pitch. That's enough to distinguish "a call" from silence, and enough to let *volume* and *warmth* matter.
3. Trick commands are bound to *utterance slots* — the game remembers "utterance A ≈ 700ms, falling pitch" for `sit`. Matching by crude envelope similarity gives you genuine mis-association behaviour for free, which is exactly the charm from §1.8. **This is better than real ASR for this game**, because perfect recognition removes the wobble.
4. Always offer the tap/gesture path at equal status.

### `getUserMedia` on iOS — worse than expected, and this compounds the problem above

- Supported in **Mobile Safari since iOS 11**, requiring a **secure context (HTTPS)** (except localhost) and a **user interaction** to trigger ([webrtcHacks: Guide to Safari WebRTC](https://webrtchacks.com/guide-to-safari-webrtc/); [CyberAngles](https://www.cyberangles.org/blog/can-you-access-the-iphone-camera-from-mobile-safari/)).
- **🚩 But: getUserMedia has a longstanding failure in standalone (home-screen) mode.** WebKit bug **185448**, "getUserMedia not working in apps added to home screen that run in standalone mode" — "the feature does not seem to work in standalone mode, in case of PWA. **The browser just doesn't ask for permissions and acts as if there is no camera**" ([bugs.webkit.org 185448](https://bugs.webkit.org/show_bug.cgi?id=185448); [Apple Developer Forums](https://developer.apple.com/forums/thread/89981)).
- **This is the compounding risk of the whole project.** The stated target is an *installed PWA on iOS*, and that is precisely the context where microphone capture has the worst track record — both the high-level SpeechRecognition API and the low-level `getUserMedia` fallback have documented standalone-mode failures. Audio input regressions on iOS are also still being filed recently ([Apple Developer Forums, iOS 26.1 beta: "Safari audio input is broken"](https://developer.apple.com/forums/thread/802555)).
- **Mandatory build action:** before committing any design work to voice, build a 30-minute spike — a page that calls `getUserMedia({audio:true})` behind a button, logs the result, and is tested (a) in a Safari tab and (b) added to the Home Screen and launched standalone, on current iOS. Treat "mic works in standalone" as an **unproven assumption**, not a given.
- Design so that **mic denial or absence is a non-event**: every voice affordance must have a touch equivalent of equal status, and the game must never gate progression on audio input.
- Holding a live `MediaStream` open keeps the orange mic indicator lit and drains battery. Acquire on demand, `stop()` all tracks the instant the utterance ends.
- Permission grants are **not shared** between the installed app and the same origin in a Safari tab — expect users to be prompted in both places.

### Audio autoplay — will silently kill §1.9 if unhandled

- `AudioContext` is created in the **`suspended`** state and must be `resume()`d from inside a real user-gesture handler. Do this on the very first touch, unconditionally, before anything else.
- Autoplaying sound without a gesture is blocked. Looping ambience must start on first interaction.
- iOS respects the **hardware mute switch** for HTML `<audio>`; a muted phone yields a silent, seemingly-broken pet. Consider a one-time "turn your ringer on" nudge, and never make sound load-bearing for comprehension.
- Play all SFX through a single pre-unlocked WebAudio graph with a pool of buffers. Do not create `Audio` elements per bark.

### Background execution — there is none

- When the tab is hidden or the app is backgrounded, iOS **suspends JavaScript**. `setInterval`/`setTimeout`/`requestAnimationFrame` stop; they do not merely throttle. There is no reliable "grow the dog while closed" tick.
- **Therefore: model all offline progression as a pure function of elapsed wall-clock time,** computed once on resume. `visibilitychange` → read `Date.now()`, diff against the persisted `lastSeenAt`, integrate hunger/thirst/dirt/mood forward, then play the reunion. This is strictly better than a tick loop anyway.
- Guard against clock tampering: persist a monotonically-increasing `maxSeenAt` and reject `Date.now()` values earlier than it; optionally sanity-check against a server timestamp when online. Cap the integrated deltas (e.g. treat any gap > 48h as 48h) so a returning player is never punished proportionally to a two-month absence.
- `pagehide` is more reliable than `beforeunload` on iOS for persisting state. Also persist on every `visibilitychange` → hidden, and opportunistically after any meaningful state change — iOS can kill a backgrounded web app with no further events.

### Notifications

**SOURCED and confirmed.** Web Push landed on iOS/iPadOS **16.4**, and the restrictions are hard ([WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/); [PushEngage setup docs](https://www.pushengage.com/documentation/setting-up-web-push-notifications-for-ios-ipad/)):

- **The user must add the site to the Home Screen and open it by tapping its icon.** An in-browser Safari tab on iOS gets no push at all.
- The **Web App Manifest must set `display` to `standalone` or `fullscreen`**, or push is unavailable.
- `Notification.requestPermission()` **must be called in response to a direct user interaction** — a tap on your own "turn on reminders" button. You cannot auto-trigger the prompt on launch.
- Once granted, the web app appears in iOS Notification Settings like a native app.

**Practical consequence — this shapes the retention design.** The "your puppy misses you" nudge **exists only for players who install**, so the install prompt is a *retention mechanism*, not a nicety. Sequence it: earn the install (after the first successful trick or the first reunion), then ask for notifications separately once the player has a reason to want them. Never ask for both cold on first load.

**Badging** (`navigator.setAppBadge`) works in installed iOS web apps. **JUDGEMENT: do not put a badge count on care needs.** A red "1" on a pet is guilt, and guilt is the top reason people delete pet games. Use the badge for gifts and good news only, or not at all.

Also note **Declarative Web Push** (iOS 18.4+) as a lower-effort path that does not require a service worker to be woken for every message — worth checking if the push volume is trivial, which here it is (one nudge a day).

### Storage — can localStorage be evicted?

**SOURCED and confirmed — and the answer materially changes the architecture.**

- **In an in-browser Safari tab: storage CAN be deleted.** WebKit's ITP removes **all** of a site's script-writable storage after **seven days of Safari use without user interaction on that site**. The affected forms are explicitly **IndexedDB, LocalStorage, Media keys, SessionStorage, and Service Worker registrations** ([WebKit: Tracking Prevention](https://webkit.org/tracking-prevention/); [WebKit: Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)).
- Crucially, **"7 days of browser use" is not 7 calendar days** — the counter tracks days Safari is actually used, so a player who takes a month off may still be inside the window. It is a *use*-based clock, which makes the risk harder to reason about, not easier.
- Note that **switching store does not help**: IndexedDB is on the deletion list alongside localStorage. Choosing IndexedDB buys quota, not durability.
- **Installed home-screen web apps ARE exempt.** "The first-party domain of home screen web applications is exempt from ITP's 7-day cap on all script-writable storage" — such web apps are not part of Safari, keep their own day-of-use counter that resets with actual use, and their first-party data is not expected to be deleted ([WebKit: Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/); see also [Apple Developer Forums: Safari iOS PWA Data Persistence Beyond 7 Days](https://developer.apple.com/forums/thread/710157)).
- `navigator.storage.persist()` exists but Safari does not grant persistence the way Chromium does; do not rely on it.

**🚩 Highest-severity risk in the project — higher than the microphone.** A hand-raised pet lost to storage eviction is catastrophic and unrecoverable; it is the one failure mode that turns a delighted player into someone who will never reinstall. Three converging conclusions:

1. **Installation is not a growth tactic here, it is a data-integrity requirement.** Note that installation is *also* what unlocks push (§ above) and *also* what removes the browser chrome — three independent reasons pointing the same way. Design the first session to earn the install before the player has anything worth losing.
2. **Until the player installs, treat the save as ephemeral.** Consider deliberately keeping the pre-install experience short and low-investment (a "meet the puppy" prologue) so that nothing precious is at risk in the tab.
3. **Ship cloud save behind an optional lightweight identity earlier than feels justified.** Even a single opaque token + a JSON blob endpoint is enough, and it also solves device upgrades — which iOS home-screen web apps handle poorly.

### Smaller iOS gotchas relevant to this specific game

- **No Vibration API** → no haptic thump when the dog bumps the camera. Compensate with audio and with visual "weight" (camera shake, brief scale overshoot).
- **No Fullscreen API on iPhone.** Installed standalone display mode is the only way to lose the browser chrome; in a tab you must live with the URL bar and its show/hide resize events. Handle `visualViewport` resizes or the canvas will letterbox mid-pet.
- **`touch-action: none` and `overscroll-behavior`** on the canvas, plus preventing default on `touchmove`, or petting will rubber-band-scroll the page. Also disable the double-tap-to-zoom and the long-press callout (`-webkit-touch-callout: none`, `user-select: none`).
- **Safe-area insets** — the home indicator sits exactly where a bottom toy tray wants to go.
- **DeviceMotion/Orientation needs an explicit permission request from a user gesture** (iOS 13+), so any "tilt to roll the ball" idea carries a prompt.
- **Wake Lock:** `navigator.wakeLock` is not available on iOS Safari; the screen will dim during a long petting session. There are hacky workarounds (silent looping video); none are dependable.
- **Memory ceilings:** iOS Safari kills tabs that grow large. Watch total canvas/offscreen-canvas bytes; a spring rig with lots of layered offscreen buffers at 3× DPR on a large phone adds up faster than you'd expect. Cap the backing-store scale at ~2.5× DPR.

---

## 4. Care mechanics

### Status axes

Three inspectable axes, each a discrete word-scale rather than a bar ([Nintendogs Wiki: Status, via search extract](https://nintendogs.fandom.com/wiki/Status)):

| Axis | Levels (best → worst) | Gate |
|---|---|---|
| Hunger | Full → Normal → Hungry → Famished | A hungry dog **cannot enter competitions** |
| Thirst | Quenched → Normal → Thirsty → Parched | A **parched** pet cannot be entered in competitions |
| Fur | Beautiful → Clean → Normal → Dirty → Filthy | Directly scored in the Obedience Trial |

### Rates and consequences

- **Hunger ran on the real clock and on exertion.** Dogs "would get hungry several times in a real-world day, and would grow hungry faster if you did activities like walking or athletic competitions" ([search extract of Nintendogs Wiki care pages](https://nintendogs.fandom.com/wiki/Care)). "Hungry" typically arrived on returning from a walk or contest.
- **Portion size scaled with hunger:** a Hungry dog eats a lot; a **Famished** dog will usually eat an entire bowl ([ditto](https://nintendogs.fandom.com/wiki/Food)).
- **Neglect escalation:** a dog left without food or water too long will **temporarily run away**, and neglect reduces friendship and costs Trainer/Owner Points ([StrategyWiki: Pet care](https://strategywiki.org/wiki/Nintendogs/Pet_care)).
- **Hunger changed walk behaviour:** hungry dogs "tend to look for trash to eat instead of presents on walks" ([ditto](https://strategywiki.org/wiki/Nintendogs/Pet_care)) — a lovely piece of systemic design, where an unmet need rewrites the dog's goals in a different activity.
- **Sickness existed and was a short-term state caused by an action, not a disease system:** "If your dog eats the trash it will become sick for a short amount of time" ([StrategyWiki: Walks](https://strategywiki.org/wiki/Nintendogs/Walks)). There is **no vet** in the DS game; care is preventative.
- **Toileting** happened on walks: "Your dog will urinate or poop at least once during your walk," poop must be tapped to collect or other trainers react badly, and urine spots show as blue dots on the map ([StrategyWiki: Walks](https://strategywiki.org/wiki/Nintendogs/Walks)).

### Food and drink catalogue

Prices vary by source because the wikis quote *purchase* prices while some FAQ item lists quote *resale* prices — flagged where it matters.

| Item | Game | Price | Unlock |
|---|---|---|---|
| Dry Food | DS | $1.50 buy | available from start ([Nintendogs Wiki: Dry Food, via search extract](https://nintendogs.fandom.com/wiki/Dry_Food_(Dog))) |
| Dog Food Can (wet) | DS | $3.00 buy | 300 Trainer Points ([ditto](https://nintendogs.fandom.com/wiki/Wet_Food_(Dog_Food_Can))) |
| Natural Dog Food Bag | DS | $5.00 buy | 10,000 Trainer Points ([ditto](https://nintendogs.fandom.com/wiki/Natural_Dog_Food_Bag)) |
| Water | DS / 3DS | cheapest drink, $1 in 3DS | from start |
| Milk | DS | — | unlocked with Trainer Points |
| Dry Food | 3DS | $3 buy / $1 resale | from start |
| Wet Food | 3DS | $5, high calorie | — |
| Premium Canned Food | 3DS | $7 | 5,000 Owner Points or 19 days played |
| Formula | 3DS | $3 | — |

Drinks in both games were essentially water and milk, with better drinks unlocked by points ([StrategyWiki: Pet care](https://strategywiki.org/wiki/Nintendogs/Pet_care)).

**Note the shape of this economy: food costs single-digit dollars while contest wins pay $100–600.** Care was never a money sink. Money existed for toys and vanity. Preserve that — a care loop that costs money is a care loop that feels like rent.

### Washing and brushing

- Shampoo and brushing raise cleanliness from Filthy up toward Beautiful; **different tools reach different maximum levels**, so the cheap brush can't get you to Beautiful ([StrategyWiki: Pet care](https://strategywiki.org/wiki/Nintendogs/Pet_care)).
- **The right brush for the coat:** wire brush for long-haired breeds, rubber brush for short-haired ([ditto](https://strategywiki.org/wiki/Nintendogs/Pet_care)). Brush prices were steep relative to food — Wire Brush $16.00, Rubber Brush $12.00 ([Neoseeker item list](https://www.neoseeker.com/nintendogs-labrador/faqs/108502-nintendogs-item.html)); short-hair shampoo about $0.50.
- **Cleanliness is scored:** "A filthy or dirty dog will have points subtracted from their score in an obedience trial," and clean or beautiful dogs get **bonus** points ([StrategyWiki: Pet care](https://strategywiki.org/wiki/Nintendogs/Pet_care)). This is the one place where care and competition are mechanically coupled, and it is a good coupling — grooming before a contest is a legible ritual.
- Dirt accumulated from time and from walks (outdoors, mud, rain areas of the map).

### Sleeping and time of day

The DS game ran on the system clock, gave the room day/night lighting, and dogs would sleep — closing the lid suspended play. Beyond that, published detail is thin.
> ⚠️ Needs more sourcing — exact hunger decay rates in hours, exact dirt accumulation rates, day/night thresholds, and the length of the "temporarily ran away" state are not documented in any source found. Any numbers used in the rebuild will be invented; tune them by feel.

### JUDGEMENT — recommended rates for the rebuild

Designed for a phone player with 2–3 short sessions a day, and for *forgiveness*:

| Axis | Rate | Notes |
|---|---|---|
| Hunger | Full → Hungry in ~10h, Hungry → Famished in ~14h more | One feed per session is always enough; two feeds are never needed |
| Exertion bonus | Play/walk adds ~2h of hunger | Preserves the original's "hungry after a walk" beat |
| Thirst | Slightly faster than hunger, ~8h to Thirsty | So that a single visit usually has *one* obvious need, not none and not three |
| Fur | Normal → Dirty in ~3 days, plus a step per walk | Grooming is a weekly ritual, not a daily tax |
| Floor of harm | Needs bottom out at "sad and messy". **Never sick, never runs away, never dies** | Non-negotiable for a modern phone audience |
| Reunion | Scales with `min(hours_away, 48)` × Bond | The payoff, not the punishment |

---

## 5. Training and tricks

### How teaching actually worked (DS)

Two-stage, and the two-stage structure is the design: **you first cause the behaviour physically, then attach a word to it.**

1. **Induce the pose with the stylus.** Each basic trick has a specific stroke on the dog's body (list below).
2. **A lightbulb icon appears** in the top-right of the touch screen the moment the dog performs an action. Tapping it opens the mic so the player can **speak the command word** for what just happened ([Nintendogs Wiki: List of Tricks, via search extract](https://nintendogs.fandom.com/wiki/List_of_Tricks_in_Nintendogs)).
3. **Repeat 3–4 times** (Grokipedia says 3–5) and the dog learns to perform it on that spoken word ([ditto](https://nintendogs.fandom.com/wiki/List_of_Tricks_in_Nintendogs); [Grokipedia](https://grokipedia.com/page/Nintendogs)).
4. **Reward with a treat** occasionally; also practise *holding* poses, because contests require holds ([thonky: Teaching Your Puppy Tricks](https://www.thonky.com/nintendogs-plus-cats/teaching-your-puppy-tricks)).

**The word is arbitrary.** The game binds whatever you said to the action you just caused — which is precisely why mis-association was possible and common: say the wrong word at the lightbulb, or let the dog do something else in the gap, and the binding is wrong. Recovering required re-teaching. **JUDGEMENT: this is one of the best mechanics in the game and it is nearly free to implement.** Reproduce it deliberately (see §3 for doing it with envelope matching instead of ASR).

**Advanced tricks are compositions, and the timing window is the skill:** they "require multiple tricks to be done in a specific order… the component tricks must be performed immediately after one another — without petting or rewarding the dog — or else it will perform the commands as separate tricks" ([Nintendogs Wiki, via search extract](https://nintendogs.fandom.com/wiki/List_of_Tricks_in_Nintendogs)). Advanced tricks "strictly require the use of voice commands" — you cannot compose them by stylus.

**Capacity:** roughly 48 possible tricks across the game, with each individual dog able to master up to **15** ([Grokipedia](https://grokipedia.com/page/Nintendogs)). A hard per-dog cap is a strong design choice — it makes a trick set an *identity* rather than a completion list.

### Basic tricks (stylus-induced) — DS

All gestures per [Nintendogs World trick list](http://nintendogsworld.blogspot.com/2009/12/basics-and-advance-tricks-list.html):

| Trick | Gesture | Prerequisite state |
|---|---|---|
| Sit | Stroke the head top → bottom | standing |
| Stand / Beg | Pet the throat so the head tilts up, then stroke the throat bottom → top (or touch the belly and slide up to the neck) | — |
| Lie Down | Stroke the head top → bottom | **while sitting** |
| Roll Over | Horizontal stylus motion across the body | **while lying on the floor** |
| On Its Back | Horizontal stylus motion across the body | **while lying on its side** |
| Jump | Repeatedly tap above the dog's head (more likely if the tail is wagging) | — |
| Shake | Grab a paw and move it up and down | standing or sitting |
| Run in a Circle | Grab the tail and hold it in front of the dog's face — it chases it | — |

Note the **dependency chain**: Sit → Lie Down → Roll Over / On Its Back. The physical posture is the prerequisite, not an XP gate. Also note that **Jump is probabilistic and mood-gated** ("more inclined if it's consistently wagging its tail") — the mood system reaching into training, exactly as in §2.

### Advanced tricks (voice compositions) — DS

| Advanced trick | Composition |
|---|---|
| Handstand | lie on stomach → stand/beg |
| Back Flip | on its back → jump |
| Back Flip from Sitting | sit → jump |
| Spin while standing | stand/beg → run in a circle |
| Break Dancing | on its back → run in a circle |
| Hop | dance → jump (needs stand + dance) |

### Nintendogs + Cats (3DS) trick roster

Sit down, Right paw, Left paw, Lie down, Play dead, Spin, Roll over, Sit up, Say please, Stand up, Cheer, Sneeze, Beg, Handstand, Breakdance, Howl ([thonky](https://www.thonky.com/nintendogs-plus-cats/teaching-your-puppy-tricks)). Teaching moved partly to **luring with a treat** — e.g. Spin is taught by holding a treat low near the paws and waving it side to side — which is a more legible, more real-world-accurate metaphor than stroking a posture into existence.

### Feeding into contests

Tricks are the entire content of the Obedience Trial (§6): the judge calls specific tricks, sometimes as sequences, sometimes to be *held* for a duration, then gives a free-performance window where advanced tricks score best. "The more a trick is practiced, the longer the dog will hold the trick" ([Nintendogs Wiki: Obedience Trial, via search extract](https://nintendogs.fandom.com/wiki/Obedience_Trial)) — so practice depth, not just breadth, is scored.

### JUDGEMENT — for the rebuild

- **Keep:** stylus-induced pose → attach-a-word → repetition → mis-association risk. Keep the per-dog cap (make it ~8, not 15). Keep posture-chaining as the dependency system; it teaches itself.
- **Compress:** 48 tricks → ~10. The long tail was collection, not play.
- **[CAMERA] warning:** Roll Over, On Its Back and Break Dancing all read badly from a near-frontal camera — a dog rolling toward you is a foreshortened mess. Either give the trick performance its own slightly-raised ¾ framing (a single alternate camera preset for "performance mode" is far cheaper than a second rig), or pick a trick list that reads frontally: Sit, Lie Down, Beg/Stand, Shake (excellent frontally — the paw comes at the camera), Jump, Spin (yaw only), Play Dead, Howl, Sneeze, Head Tilt. **Shake and Beg are the two best tricks for this rig; lead with them.**

---

## 6. Contests

All three DS contests share the same ladder: **five classes — Beginner, Open, Expert, Master, Championship** — and you advance only by placing **1st, 2nd or 3rd** ([Nintendogs Wiki: Competitions / Disc Competition, via search extracts](https://nintendogs.fandom.com/wiki/Competitions)). Entry requires a dog that is **not hungry and not parched** (§4).

### Prize money (Disc Competition; the other two follow the same shape)

| Class | 1st | 2nd | 3rd |
|---|---|---|---|
| Beginner | $100 | $50 | $30 |
| Open | $200 | $100 | $60 |
| Expert | $300 | $150 | $90 |
| Master | $400 | — | — |
| Championship | $600 | — | — |

Source: [search extract of Nintendogs Wiki Disc Competition / GameFAQs contests FAQ](https://nintendogs.fandom.com/wiki/Disc_Competition). 2nd/3rd values for Master and Championship were not recovered.
> ⚠️ Needs more sourcing — Master/Championship placings below 1st, and whether Agility and Obedience use an identical purse, are unconfirmed. The GameFAQs contests FAQ (`gamefaqs.gamespot.com/ds/926849-nintendogs-dachshund-and-friends/faqs/38824`) almost certainly has the full table but returns 403 to automated fetching; a human should open it.

### 6.1 Disc Competition

**Rules:** throw a flying disc; the dog must catch it before it hits the ground.

**Scoring** ([Nintendogs Wiki, via search extract](https://nintendogs.fandom.com/wiki/Disc_Competition); [thonky: Disc Competition](https://www.thonky.com/nintendogs-plus-cats/disc-competition)):
- Points by the **field zone in which the catch happens** — farther from the thrower = more points.
- **+1 point** if the catch is made **in mid-air**.
- **Zero** if the dog drops it or misses before it lands.
- 3DS adds **glowing zone bonuses** (all classes above junior) and **sand traps** that slow the dog — avoid throwing into them, though a brief transit isn't badly penalised.
- 3DS disc tiers: basic flying discs → Novice discs (Pizza, Pot Lid, Lollipop) → Pro Discs.

**[CAMERA] — this is the hardest contest for the frontal rig.** Real disc play is a long lateral or receding field. Two 2D-friendly framings:
1. **Over-the-shoulder receding throw** — camera behind the player, dog runs into depth. Needs a *scale-and-squash* pseudo-3D treatment of the same part hierarchy, which is achievable but is effectively a second rig.
2. **JUDGEMENT — better: make it a catch game, not a fetch game.** Keep the frontal camera. The player flicks the disc *up and away*; the dog is shown from the front, tracking upward, and the interaction becomes *timing the leap* rather than judging distance. Scoring by height and airtime instead of by distance zone. This preserves the verb (throw, dog leaps, catch) and the tension, discards the geometry the rig can't do, and reuses the existing legs/tail springs for the leap.

### 6.2 Agility Trial

**Rules:** navigate an obstacle course — jumps, see-saws, tunnels, tyres, weave poles — in a **specified order shown on an overhead map** on the top screen, as fast as possible ([Nintendogs Wiki: Agility Trial, via search extract](https://nintendogs.fandom.com/wiki/Agility_Trial)).

**Scoring:**
| Event | Effect |
|---|---|
| Failing an obstacle, or taking it out of order | **−5 points** |
| Each second over the **standard time** | **−1 point** |
| Exceeding the **time limit** (a separate, longer cap) | fail to qualify |
| Tie | broken by the faster course time |

Promotion needs a finish inside the time limit with faults minimised.

**[CAMERA] — undeliverable on the main rig, and the top-down map is the whole mechanic.** The original literally used the second screen for an overhead route map; the game *is* spatial routing. Options:
1. Build a small dedicated top-down/side-on agility rig (a simplified silhouette dog, not the 30-spring hero rig). Real cost, real content.
2. **JUDGEMENT — recommended: cut Agility entirely for v1.** It's the contest with the least emotional payload, the highest rig cost, and the most "video game" feel. If a movement-skill contest is wanted later, ship **Lure Coursing** instead (below) — a reel-and-chase, which can be framed as a dog running *toward the camera* after a lure the player controls. That framing is nearly free on a frontal rig and is genuinely tense.

### 6.3 Obedience Trial

**Rules:** the judge (Ted Rumsworth in the 3DS version) calls tricks; the dog must perform the named commands within a **time limit**, sometimes as **sequences**, sometimes **held** for a duration; then a **free-performance** window. **You cannot touch the dog during an Obedience Trial** ([Nintendogs Everything](https://nintendogseverything.weebly.com/competition-trials.html)) — voice only, which is what made it the true test of training.

**Scoring** ([Nintendogs Wiki: Obedience Trial, via search extract](https://nintendogs.fandom.com/wiki/Obedience_Trial)):
- **0.00 – 10.00**, two decimal places.
- Judged on **performance *and* grooming**. Dirty/filthy → points deducted; clean/beautiful → bonus ([StrategyWiki: Pet care](https://strategywiki.org/wiki/Nintendogs/Pet_care)).
- Hold duration scales with how much the trick has been practised.
- Free performance is where **advanced tricks** earn the big points.
- **Championship thresholds:** maintain a **≥ 9.00 average** to stay in the Championship; **> 9.60** to win it.
- 3DS Obedience Trial required the physical **AR Cards** bundled with the 3DS ([thonky: Obedience Trial](https://www.thonky.com/nintendogs-plus-cats/obedience-trial)) — a hardware dependency with no web analogue and no reason to reproduce.

**[CAMERA] — perfect fit.** A stationary dog performing tricks facing the judge/camera is exactly what a near-frontal rig is for. **JUDGEMENT: make Obedience the *only* contest in v1.** It uses the hero rig at full quality, it is the mechanical payoff of the training system, and grooming already feeds it, so the care loop earns its place too. One contest, done beautifully, beats three done thinly.

### 6.4 Nintendogs + Cats: Lure Coursing (replaced Agility)

Player operates a **fishing-reel-style lure** ([thonky: Lure Coursing](https://www.thonky.com/nintendogs-plus-cats/lure-coursing)): clockwise reels the toy toward the player, counter-clockwise pushes it back toward the dog; a **horn** button signals a jump or prompts release. Keep the lure at an optimal distance — too far and the dog loses interest, too close and jumps fail. Advanced courses add **path crossings** (collide with other dogs if you mismanage speed) and **hurdles** cleared on the horn. Practice at the downtown Gym, reached on walks.

> ⚠️ Needs more sourcing — no scoring formula, class list, promotion rule or purse for Lure Coursing was found in any accessible source.

### Breed / stat suitability

> ⚠️ Needs more sourcing — the community consensus (small agile breeds favour Agility, retriever-types favour Disc, poodles/shepherds favour Obedience) is widely repeated but I found **no sourced evidence that Nintendogs modelled per-breed contest stats at all**. Given that personalities were confirmed "very passive" and possibly not statistically significant ([Nintendogs Wiki: Personalities, via search extract](https://nintendogs.fandom.com/wiki/Personalities)), the likeliest truth is that breed was **cosmetic** and the differences players felt were folklore. **JUDGEMENT: treat breed as cosmetic in the rebuild too** — it avoids a balancing problem and avoids telling players their favourite dog is the wrong dog.

### Daily entry limits

> ⚠️ Needs more sourcing — a limit of three contest entries per dog per day is widely repeated in community guides but I could not confirm it in this pass.

---

## 7. Economy and unlocks

### Two parallel currencies, and this is the key structural idea

| Currency | Earned by | Spends on |
|---|---|---|
| **Money ($)** | Contest prizes ($30–$600); selling found items at the Secondhand Shop | Toys, food, care tools, accessories, furniture |
| **Trainer Points** (DS) / **Owner Points** (3DS) | *Caring well* — see below | Nothing directly; they **unlock** breeds, interiors, shop stock, and the ability to teach advanced tricks |

**Money is skill/luck; Points are attentiveness.** You cannot buy your way to a new breed and you cannot grind contests for a new room. That separation is why the care loop had teeth without being monetised — and it's a pattern worth keeping verbatim.

### Trainer Points (DS)

Trainer Points measure the player's rank as a trainer and gate breeds, interiors, local-store stock, and advanced-trick teaching ([Nintendogs Wiki: Trainer Points, via search extract](https://nintendogs.fandom.com/wiki/Trainer_Points)).

**Breed unlock thresholds** ([ditto](https://nintendogs.fandom.com/wiki/Nintendogs_Trainer_Points_Unlockables)):

| Trainer Points | Breed unlocked |
|---|---|
| 2,000 | Miniature Pinscher |
| 4,000 | Siberian Husky |
| 8,000 | Toy Poodle |
| 10,000 | Golden Retriever |
| 14,000 | Miniature Schnauzer |
| 16,000 | Beagle |
| 20,000 | Pembroke Welsh Corgi |
| 22,000 | Shih Tzu |
| 30,000 | Shiba Inu |
| 35,000 | Pug |
| 45,000 | Labrador Retriever |
| 50,000 | Miniature Dachshund |

(Which of these are already starters depends on your cartridge — see §9.)

**Interiors** unlocked on the same ladder: Desktop at 6,000, Seaside at 12,000, others at higher increments ([ditto](https://nintendogs.fandom.com/wiki/Nintendogs_Trainer_Points_Unlockables)). **Shop stock** too: Dog Food Can at 300 TP, Natural Dog Food Bag at 10,000 TP (§4).

**Item-based unlocks bypassing points:** the **Fireman's Hat** unlocks the **Dalmatian** (in Chihuahua, Dachshund and Labrador versions); the **Jack Russell Book** unlocks the **Jack Russell Terrier** in all versions ([ditto](https://nintendogs.fandom.com/wiki/Nintendogs_Trainer_Points_Unlockables)).

**Scale check:** the top breed sits at 50,000 points. Set against the 3DS game's explicit **200 points/day cap**, a ladder of that shape is a *months*-long grind. See §10.

### Owner Points (3DS)

Capped at **200 points per day per pet**; unlock milestones run from **450 to 11,400** points, which the guide maps to roughly **day 4 through day 34** of play ([thonky: Owner Points](https://www.thonky.com/nintendogs-plus-cats/owner-points)):

| Points | ≈ Days | Unlocks |
|---|---|---|
| 450–600 | 4–5 | Furniture; first new breeds (Yorkshire Terrier, Great Dane, Pug…) |
| 850–1,100 | 6–7 | Food items, collars, accessories |
| 1,350–5,800 | 8–21 | Advanced furniture, more breeds, Mario Kart items |
| 6,200–11,400 | 22–34 | Rare items, special interiors, high-end accessories |

The 3DS redesign is much gentler: **a full unlock ladder in ~34 days rather than the DS's implicit months**, and the days column shows Nintendo explicitly designing against the calendar. That is the right instinct and the rebuild should go further still.

### Item catalogue (DS)

Items come from the Pet Supply store, the Discount Shop, and pickups on walks ([Neoseeker item list](https://www.neoseeker.com/nintendogs-labrador/faqs/108502-nintendogs-item.html); [GameFAQs item list](https://gamefaqs.gamespot.com/ds/926849-nintendogs-dachshund-and-friends/faqs/38926)). Categories: food & drink, treats, care items (shampoos, brushes), toys, discs, hats, ribbons, collars, leashes, furniture, "records" (music boxes), and valuables that exist only to be sold.

Representative prices (⚠️ the Neoseeker list is labelled **selling** prices, so several of these are resale not purchase — e.g. Dry Food $0.60 there vs $1.50 purchase from the wiki. Treat as relative magnitudes):

| Category | Cheap end | Expensive end |
|---|---|---|
| Food / treats | Dog Biscuit $0.10, Water Bottle $0.20, Dry Food $0.60 | Natural Dog Food Bag $2.00 |
| Care items | Short-Hair Shampoo $0.50 | Rubber Brush $12.00, Wire Brush $16.00 |
| Toys & discs | Tennis Ball $2.00, Blue Flying Disc $2.40, Rubber Bone $1.60 | RC Helicopter $200.00, Combat Copter $300.00 |
| Hats & accessories | Red Ribbon $2.40, Checked Ribbon $4.00, Shower Cap $2.00 | Fireman's Hat $30.00, Tiara/Crown $30.00, Viking Hat $40.00 |
| Novelty / karts | — | Mario Kart / Bowser Kart / Peach Kart $100.00 each |
| Furniture & clocks | Tissue Box $1.00 | Smart Clock $16.00, Dartboard $10.00 |
| Records | "Dog's Theme" Box $6.00, Nintendogs Soundtrack $5.00, Mystical Records $9.00 | — |
| Pure valuables | — | Promise Ring $1,000.00, **Gold Bar $2,000.00** |

The spread is instructive: **the entire care kit costs less than one Beginner-class win, while the aspirational objects cost 3–5 Championship wins.** Gold Bars and Promise Rings are found-on-walks lottery tickets, not purchases — the walk is the slot machine.

### Dogs, capacity, and the hotel

- **Capacity: 3 dogs at home, plus 5 at the dog hotel, for 8 total** — confirmed independently by [Wikipedia](https://en.wikipedia.org/wiki/Nintendogs) and [Grokipedia](https://grokipedia.com/page/Nintendogs), and the 3-at-home cap again by [Nintendogs Wiki: Kennel (via search extract)](https://nintendogs.fandom.com/wiki/Kennel). Hotel dogs are **stored, not cared for** — the game let you collect without multiplying the care burden, which is the single smartest scoping decision in its design. **JUDGEMENT: copy this exactly.** Cap active pets at 2–3 and make everything beyond that a stable you visit, or the care loop scales into a job.
- Dogs are bought from the **Kennel** (Shopping → Kennel → Buy).
- **Puppy prices: most dogs cost $500–$600 depending on breed. The player starts with $1,000 and must buy a dog immediately** ([Nintendogs Wiki: Money / Kennel, via search extract](https://nintendogs.fandom.com/wiki/Money)).
- The kennel's three display dogs — Lucky (miniature dachshund), Maxwell (Chihuahua), Daisy (Labrador retriever) — **cannot be bought**, which is a nice piece of restraint: the shop window is set dressing, not stock.

**Read the opening economy carefully, because it is doing something clever.** You start with $1,000, a puppy costs $500–600, so **after your first dog you have roughly $400–500 and no income** until you place in a contest. That single number is why the early game feels like it has stakes: your second dog is genuinely out of reach, and the only route to one is *training the first one well*. **JUDGEMENT: reproduce this exact shape.** Give the player enough for one dog plus a little, and make the second dog the first real goal. Do not start them rich.

### JUDGEMENT — for the rebuild

- **Keep the two-currency split.** Money from contests/finds → things. Care-points → new content. It's elegant and it makes care *matter* without making care a bill.
- **Collapse the unlock ladder to ~2 weeks, not 34 days and certainly not months.** Front-load: something new on day 1, 2, 3, then weekly.
- **Kill the daily point cap or raise it well above what one session can earn.** A cap that a devoted player hits in 4 minutes teaches them to stop playing — the exact opposite of what you want on a platform where session length is the metric.
- **Cut the item long tail hard.** ~25 objects total: 6 toys, 4 care tools, 6 accessories, 6 furniture pieces, 3 rooms. Every object should be recognisable in silhouette from across the room.

---

## 8. Walks

The walk was the DS game's exploration/loot layer and its second-screen showpiece.

### How it worked ([StrategyWiki: Walks](https://strategywiki.org/wiki/Nintendogs/Walks); [Nintendogs Wiki: Walk, via search extract](https://nintendogs.fandom.com/wiki/Walk))

- **Route drawing:** you draw a path on a map that must **start at your house and return to it**. Path length is limited by a **stamina bar** (bottom-left); run out while drawing and you must restart from the house.
- **Stamina grows with use:** "Every walk your dog takes will increase how far it can walk on future outings." A dog "should go for a walk at least once a day."
- **Four map areas:** Neighborhood, Mountains, Downtown, Seaside. (The 3DS game put the Gym downtown for Lure Coursing practice.)
- **Random `?` boxes** on the map: route through one and you get either a **present** or a **conversation with another trainer walking their dog**.
- **Loot geography:** presents get **rarer the farther from home** they are — a clean risk/stamina gradient. Presents also spawn in **unmarked** spots, which are **rarer but predictable**: the exact positions reroll each walk, but always inside predetermined areas.
- **Pedometer integration:** using the DS Pedometer, real-world step count raised item rarity — "walking over a thousand steps can grant an accessory" ([Nintendogs Wiki: Pedometer, via search extract](https://nintendogs.fandom.com/wiki/Pedometer)).
- **Movement control during the walk:** slide the stylus quickly to the **right** side of the screen to run; release or drag **left** to stop.
- **The leash interaction:** if the dog is hungry it hunts for **trash**; eating trash makes it **sick for a short time**; you pull it away by **dragging the stylus away from the trash toward the right**. Tugging the leash *unnecessarily* costs Owner Points in the 3DS game (§2), so the leash is a two-sided tool — correction that is itself punishable if overused. Excellent design.
- **Toileting:** at least one pee or poop per walk; tap the poop to collect it or other trainers disapprove; pee shows as blue dots on the map.

> ⚠️ Needs more sourcing — walk **duration** in real minutes, and whether a **hard daily walk limit** existed, were not confirmed. Community guides commonly say three walks per day; I found no citable confirmation. Present drop tables per area were not recovered.

### JUDGEMENT — for the rebuild

**[CAMERA] The walk is the single worst fit for the hero rig.** The original is a side-scrolling dog on a leash — a pure profile view, and the one silhouette the frontal rig fundamentally cannot produce. Do not build a walk rig for v1. Three framings that dodge it, in ascending cost:

1. **The walk as a map-and-return interstitial (recommended for v1).** Player draws the route on the map — which is the *distinctive*, memorable half of the mechanic and needs no dog rig at all. Then a short stylised transition (paw prints tracking along the drawn line, the dog's silhouette as a simple cut-out, or just the map with vignettes), and the dog **returns to the frontal room** muddy, tired, hungry, with something in its mouth. **Framing the walk as departure-and-return converts it from an animation problem into an emotional beat**, and the return-with-a-gift is a strictly better payoff than watching a side-scroller.
2. **Encounter cards.** Route events (another dog, a `?` box, trash) resolve as small frontal-camera vignettes: the other dog appears facing you, your dog reacts. Reuses the hero rig at full quality; a second dog is just a re-skinned instance.
3. **A dedicated profile rig** — only if walks prove to be the retention driver. Two rigs is a real, ongoing content tax; defer the decision until there's data.

**Keep:** route drawing, the rarity-by-distance gradient, unmarked-secret spots, come-home-with-loot, the poop-collection gag (it's genuinely funny and it's the most-remembered detail in every retrospective), and the leash as a correctable-but-punishable tool. **Cut:** stamina-gated redraw friction (frustrating and it teaches nothing), and the walk as a *daily obligation*.

---

## 9. Breeds

**20 breeds in the DS game.** Every breed except the Jack Russell Terrier is either a starter in some version or unlockable with Trainer Points ([Nintendogs Wiki: Dog Breeds, via search extract](https://nintendogs.fandom.com/wiki/Dog_Breeds)).

### Versions

| Version | Region | Notes |
|---|---|---|
| Nintendogs: Chihuahua & Friends | worldwide | |
| Nintendogs: Labrador & Friends | worldwide | |
| Nintendogs: Dachshund & Friends | worldwide | |
| Nintendogs: Dalmatian & Friends | Europe | listed on [StrategyWiki: Dog Breeds](https://strategywiki.org/wiki/Nintendogs/Dog_Breeds) |
| Nintendogs: Shiba & New Friends | Japan | |
| Nintendogs: Best Friends | US / AUS | |

Each version ships **6 starter breeds**, plus 2 cross-version unlockables ([StrategyWiki: Dog Breeds](https://strategywiki.org/wiki/Nintendogs/Dog_Breeds)).

### Starter rosters (partial — recovered in this pass)

| Version | Starters |
|---|---|
| Chihuahua & Friends | Chihuahua, German Shepherd, Boxer, Cavalier King Charles Spaniel, Yorkshire Terrier (+1 not recovered) |
| Labrador & Friends | Labrador Retriever, Miniature Schnauzer, Toy Poodle, Pembroke Welsh Corgi, Miniature Pinscher, Shiba Inu |
| Dachshund & Friends | Miniature Dachshund, Golden Retriever, Beagle, Pug, Siberian Husky, Shih Tzu |

Source: [search extract of Nintendogs Wiki Starter Breeds](https://nintendogs.fandom.com/wiki/Starter_Breeds).

**Cross-version unlocks:** Dalmatian via the **Fireman's Hat** (Chihuahua/Dachshund/Labrador versions); Jack Russell Terrier via the **Jack Russell Book** (all versions) — §7.

**Trainer-point unlock ladder** — see the table in §7. Note the reciprocity: a breed that is free on one cartridge costs 45,000–50,000 points on another (Labrador Retriever, Miniature Dachshund sit at the top of the ladder precisely because they're the marquee starters elsewhere). **The unlock ladder is a cross-sell mechanic, not a difficulty curve** — worth knowing before you copy its shape.

### The 20 breeds (assembled from partial sources — treat membership as solid, per-version mapping as incomplete)

Confirmed as appearing in the DS game across versions: Chihuahua, Miniature Dachshund, Labrador Retriever, Golden Retriever, German Shepherd, Boxer, Cavalier King Charles Spaniel, Yorkshire Terrier, Miniature Schnauzer, Toy Poodle, Pembroke Welsh Corgi, Miniature Pinscher, Shiba Inu, Beagle, Pug, Siberian Husky, Shih Tzu, Shetland Sheepdog, Dalmatian, Jack Russell Terrier ([StrategyWiki](https://strategywiki.org/wiki/Nintendogs/Dog_Breeds); [Nintendogs Wiki: Dog Breeds, via search extract](https://nintendogs.fandom.com/wiki/Dog_Breeds)).

> ⚠️ Needs more sourcing — that list reaches 20 but the Shetland Sheepdog's inclusion and the exact per-version mapping for the Dalmatian & Friends / Shiba & New Friends / Best Friends editions are not confirmed, nor is the sixth Chihuahua & Friends starter.

**Development note worth knowing:** Nintendo originally planned **fifteen** breed-specific versions and cut back to three because "the debugging process for each version was deemed too time-consuming to be feasible" ([Wikipedia: Nintendogs](https://en.wikipedia.org/wiki/Nintendogs)). This confirms the reading above: the version split was a **retail segmentation strategy**, not a design one. There is no design reason to inherit any of it.

### Per-breed differences

> ⚠️ See the §6 note. Coat length demonstrably mattered (wire brush for long-haired, rubber for short-haired — §4), and size/appearance/voice pitch differed. Beyond that I found **no sourced evidence of per-breed stats**, and the wiki explicitly downplays personality as "very passive." **JUDGEMENT: breed in Nintendogs is best understood as cosmetic + coat-type, and the rebuild should model exactly that** — coat length (drives the brush choice and the fur silhouette), size, ear shape, muzzle length, colour, and voice pitch. All of which are, conveniently, *parameters on a part hierarchy* — a 2D posable rig can produce a plausible breed roster from ~8 numbers and a palette, which is the strongest content-efficiency argument available for the chosen art direction.

### 3DS additions

Nintendogs + Cats added **cats** (three breeds) plus a revised dog roster with version-exclusive unlocks (Yorkshire Terrier, Great Dane, Pug and others appearing on the Owner-Point ladder from ~450 points — §7). Cats were low-maintenance, non-trainable, non-competing companions.
> ⚠️ Needs more sourcing — the full 3DS breed roster per version (French Bulldog / Golden Retriever / Toy Poodle editions) was not recovered.

---

## 10. What was criticised or tedious

### The consistent criticisms

- **Repetition.** "Repetitive daily tasks, such as walking and feeding… could feel monotonous over extended playtime and limit long-term depth for more experienced gamers" ([Grokipedia: Nintendogs](https://grokipedia.com/page/Nintendogs)). More pointedly: "the tasks required for training are exceptionally repetitive and in their abundance belie the lack of varied content," and players described "being trapped in an endless cycle of feeding, washing, walking and training your dog and entering them into competitions."
- **No progression ceiling, and no ending.** "The game doesn't really have any sort of plot or real progression after you reach the Championship level contests." A contemporary reviewer criticised the "game's lack of an ending" outright ([Wikipedia: Nintendogs](https://en.wikipedia.org/wiki/Nintendogs)). Once you top the ladder, the game has nothing further to say. **JUDGEMENT: this critique is half wrong and worth arguing with.** A pet game *should not* end. The real failure was that the game stopped offering *new small things* — the fix is a slow, endless trickle of novelty (a new toy, a seasonal decoration, a visiting dog, a new trick to attempt), not a final boss.
- **Dodgy voice recognition.** Command misinterpretation was a standard complaint ([Grokipedia](https://grokipedia.com/page/Nintendogs)).
- **Slow pace / thin content for adults.** "The lack of content and slow pace is likely to put off most adult gamers."
- **The sequel lost the feeling.** On Nintendogs + Cats: it "lacks the emotional connection, polish, depth, and attention to detail that made Nintendogs feel so special" ([GamingBolt review](https://gamingbolt.com/nintendogs-cats-review)) — a warning that more breeds, more species and better graphics did *not* preserve the magic. Whatever the magic was, it was not content volume.

**Against that, the commercial and critical record:** ~23.96 million units across the three DS versions (second-best-selling DS game); Metacritic 83/100 for both Dachshund & Friends and Labrador & Friends; Famitsu 40/40; IGN 8.8 describing "obsessive compulsive behaviors you never knew you had" ([Grokipedia](https://grokipedia.com/page/Nintendogs)). Retrospectives now credit it as the origin point of the **cozy games** genre ([Grokipedia](https://grokipedia.com/page/Nintendogs); [The Oxford Student](https://www.oxfordstudent.com/2021/06/06/in-memory-of-nintendogs/)).

### What players actually stopped doing after ~two weeks (JUDGEMENT, inferred)

The drop-off pattern in the complaints is consistent and diagnostic: **players kept petting and stopped doing everything else.** Walks became a stamina-gated chore once the interesting loot was found; contests became a money faucet you stopped needing once you owned the toys you wanted; training stopped once the dog hit its 15-trick cap or you had enough for Championship; the trainer-point ladder became visibly unreachable (50,000 points against a small daily earn rate). What survived was the two minutes of contact — which is precisely the §1 top-5.

### Recommendations for the rebuild

| Original | Problem | Do this instead |
|---|---|---|
| 3 contests × 5 classes × 3 placings | Content-thin ladder padded by repetition; two of the three need camera angles the rig doesn't have | **One contest (Obedience), 3 classes.** Frontal-camera-native, uses training and grooming, ships at full fidelity |
| Trainer Points to 50,000 with a small daily earn | Visibly unreachable → players disengage | **Full unlock ladder in ~14 days.** Something new on days 1/2/3, then weekly |
| 200 points/day hard cap (3DS) | Teaches the player to stop playing | **No cap**, or a cap far above one session's earn. Diminishing returns, never a wall |
| Daily walk obligation with stamina-gated route redraw | Chore; the friction teaches nothing | Walk is **optional, ~60s, always yields something**. Keep route-drawing; drop the redraw punishment |
| Neglect → runs away, gets sick, loses points | Guilt. On a phone, guilt → uninstall | Needs bottom out at **sad and untidy**. Never sick, never gone. Absence costs *cosmetics*, return pays *reunion* |
| ~48 tricks, 15 per dog | Collection grind | **~10 tricks, ~8 per dog.** Depth via hold-duration and reliability, not breadth |
| Hundreds of items | Long tail nobody sees | **~25 objects**, each silhouette-legible |
| 20 breeds gated across 6 cartridges | Cross-sell artefact | **6–8 visually distinct breeds**, all reachable in two weeks. Generate them from rig parameters (§9) |
| Real-time clock, no notifications | Nothing brought players back | Real-time clock **plus** one gentle daily push, **plus** the reunion. Install-gated on iOS (§3) |
| Voice recognition as a hard dependency | Failed often; undeliverable in an iOS PWA anyway | **Mic as gesture sensor**, tap always available at equal status (§3) |
| Bark Mode | Required physical proximity | Async "a neighbour's dog came by while you were out" — one visitor, one gift, no matchmaking |

**The one-line thesis for the rebuild:** the original spread ~2 minutes of world-class interaction across ~40 minutes of scaffolding, because in 2005 the scaffolding was the only thing that could make you come back tomorrow. In 2026 a notification and a good reunion animation do that job. **So cut the scaffolding to a quarter and spend everything on the contact.**

---

## Open questions for a human with a browser

Two high-value sources refused automated fetching and are worth 10 minutes each:

1. **`gamefaqs.gamespot.com/ds/926849-nintendogs-dachshund-and-friends/faqs/38824`** (403) — the contests FAQ. Should settle: the full prize table including Master/Championship 2nd/3rd, whether all three contests share a purse, daily entry limits, and any per-breed contest guidance.
2. **`nintendogs.fandom.com`** (402) — pages `Care`, `Status`, `Walk`, `Present`, `Personalities`, `Starter_Breeds`, `Dog_Breeds`. Should settle: hunger/thirst/dirt rates in hours, present drop tables per walk area, the full 20-breed roster with per-version availability, and whether personalities have any modelled effect.
3. **`tcrf.net/Nintendogs/Version_Differences`** — likely the most authoritative cross-version breed/item table available.

And one engineering spike that must happen before any voice design work:

4. **The standalone-mode microphone spike (§3).** A single HTML page: a button calling `getUserMedia({audio:true})`, logging success/failure and the resulting track settings. Test in a Safari tab *and* added to the Home Screen and launched standalone, on current iOS. If it fails standalone, the entire voice layer becomes touch-only and §5 needs rewriting around gesture-taught tricks.
