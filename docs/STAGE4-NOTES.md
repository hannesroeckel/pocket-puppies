# Stage 4 — working notes (finishing agent)

Scratch file. Incremental, so a connection failure does not lose the findings.
Delete or fold into ARCHITECTURE.md §14 at the end.

## Inherited (verified by reading, not assumed)

- `src/state/walks.js` (340) — the walk MODEL. Progress is a pure function of
  `startedAt` + wall clock; nothing ticks. Clock-tamper guard already written
  (`walkProgress`, a `startedAt` in the future is clamped to now). Day rollover
  uses local `dayIndex`, checked on every read. **This is good code.**
- `src/dog/walk.js` (1152) — four beats, `COPY` table at the top, pronouns from
  `game.pron`. Leash-drop beat is the payload and it reads well on screen.
- `src/ui/routemap.js` (572) — the hand-drawn map.
- `SCHEMA_VERSION` 4 + v3→v4 migration present in `state/save.js`.

## Defects — REPRODUCED 2026-07-30

Harness `C:\tmp\pp4repro.py`, shots in `C:\tmp\pp4\shots\`.
Loop stopped before stepping (per the project warning).

### 1. Walk starts under the naming overlay — CONFIRMED
Fresh save, `__pp.walk(true)` returns `true`:
`{ walkBeat: "prep", namingOpen: true, namingLine: "Someone came for you." }`
Screenshot `d1-walk-under-naming.png`: the leash hangs, "The lead is out"
renders, the walk's X-cancel button draws — all *under* the naming scrim.

Reverse direction also confirmed: `__pp.openNaming('rename')` while
`walkBeat === 'prep'` → `{ walkBeat: "prep", namingOpen: true }`.

CAUSE: `room.js startWalk()` guards `walk.away`, `toy.busy`, `care.modal`,
`train.modal` — but **not** `naming.active`. And `naming.start()` is called at
three sites with no check on who owns the surface.

### 2. Anticipation copy illegible — CONFIRMED
`d2-hint-no-overlay.png`: "He cannot keep his feet still", `#fff0d4` at
alpha 0.72*0.88, 13px, drawn straight over the pale cream wall at y=82.
Cream on cream. Under the naming scrim (`d1-...`) it is worse — dark on dark.
y=82 is also only 62 virtual units clear of the target device's 20px top inset,
and **no walk/train/naming/toast/routemap text reads `view.safe` at all**.

### 3. Systemic: 32 `fillText` sites, no shared helper
Audited every call site. Findings:
- All 32 duplicate the same font stack literally.
- 13 of 32 have **no contrast treatment at all** beyond an opaque plate that
  happens to be there; 11 rely on a hand-tuned drop shadow.
- Only `ui/hud.js` (4 sites) reads `view.safe`. `naming.js`, `toast.js`,
  `routemap.js`, `train.js`, `walk.js`, `care.js` all use hard virtual y
  literals.
- `src/engine/draw.js` exports no text function whatsoever.
- Stage 3's cue legend: `dog/train.js` L1712/1720/1726, all `#fff2d6`, shadow
  only, backing is a 0.22→0.03 alpha gradient = effectively cream on cream.
- Naming title: `ui/naming.js` L265, `textAlign 'center'` at x=`VW/2`=195.

## Plan

1. `src/ui/text.js` — shared helper. Contrast guaranteed *by construction*:
   solve for the plate alpha such that the worst-case background (pure black
   or pure white showing through) still clears the target ratio. Safe-area
   aware y anchoring, auto-shrink to the safe horizontal band.
2. Overlay arbiter in `room.js` — one `surfaceOwner()` that all modal starts
   consult, both directions.
3. Route stage-4 copy through the helper; retrofit legend + naming title.
4. Gates: reload survival, clock tamper, migrations v1/v2/v3, discovery stats,
   frame times, reduced motion, dark mode, screenshots.

## Gate results

### Overlay arbiter (`C:\tmp\pp4gate1.py`)
First draft gave the layers a PRIORITY ORDER so "important" beats could
displace lesser ones. That table immediately grew the hole it was meant to
close — naming outranked the walk, so renaming from Settings while he was out
opened the overlay over the absence panel. Measured failing (B and C FAIL),
then deleted. **The surface is now exclusive**: if any layer owns it, nobody
else may take it; a beat that still wants to happen is queued via
`pendingNaming`. Re-verified below.

### GATE 2 — survives the app being FULLY CLOSED (`C:\tmp\pp4gate2.py`)
The page is **closed outright** (`pg.close()`) and a new one opened in the same
context, so the JS heap, every module and every spring is destroyed and rebuilt
from localStorage. Elapsed time faked by rewriting `startedAt`; never waited.

- 2a reopen MID-walk (150s of 300s): `away=true`, **prog 0.511** derived from
  the wall clock, route + seed survived, and `peekFinds` returned the
  IDENTICAL finds before and after the restart (`pinecone, metLurcher`).
- 2b shut for **NINE HOURS**: he is home, return beat plays, walk banked,
  `carried = [feather, tennis, buttercup]`, 11 coins paid, collection grew.

**20/20 checks PASS, zero page errors.**

### GATE 3 — clock moved BACKWARDS
`fakeClockBack(180)` (start time 3h in the future): progress 0, never negative,
never NaN, `skewMs` reported, `startedAt` clamped to now, walk intact, save
still loads afterwards. Poisoned record (`dur=NaN`, `startedAt=8.64e15`,
`seed=NaN`, `mix='nonsense'`) is repaired rather than fatal. **All PASS.**

### Harness lesson worth keeping
`saver.flush()` early-returns when `dirty` is false, and poking `state`
directly never fires `onChange` — so `__pp.saveNow()` was a **silent no-op**
and gate 2a passed for the wrong reason until caught. `fakeWalkAway` and
`fakeClockBack` now call `saver.schedule()` themselves.

### GATE 4 — migrations (`C:\tmp\pp4gate45.py`)
Each legacy save is shaped the way that stage actually wrote it, injected into
localStorage before boot, then loaded for real. All three reach v4, keep the
dog, keep the name "Mochi", keep the bond (affection 0.63 -> 0.641, never
clawed back below the floor), and **can start a walk afterwards**.

Stage 3 specifics, all PASS: the junk find `not-a-real-find` is dropped from
the log; `daisy`/`conker` are kept AND seeded into `unlocks.items` so an old
save's shelf is populated; the legacy voice ENVELOPE (`{dur,loud,pitch}`) is
dropped while the real word is kept; a `{level:1}`-only trick derives reps.

### GATE 5 — discovery statistics
N=4000 full-length walks per route. **Zero empty-handed returns on any route.**

| find | park | high | river | woods |
|---|---|---|---|---|
| daisy | **37.4%** | 10.1% | 20.7% | 13.7% |
| metBeagle | **30.2%** | 13.7% | 8.8% | 6.8% |
| buttercup | **27.1%** | 6.3% | 25.7% | 11.0% |
| metPoodle | 8.9% | **37.1%** | 6.2% | 4.3% |
| glove | 5.9% | **34.3%** | 7.2% | 4.5% |
| bell | 6.2% | **30.1%** | 4.4% | 3.3% |
| squeaky | 6.1% | **26.3%** | 6.0% | 3.0% |
| pebble | 10.6% | 8.3% | **37.4%** | 8.0% |
| metSpaniel | 8.6% | 7.5% | **30.4%** | 8.3% |
| feather | 12.8% | 7.7% | **28.7%** | 15.7% |
| stick | 18.4% | 4.7% | 22.4% | **34.9%** |
| pinecone | 6.7% | 3.3% | 6.6% | **32.1%** |
| conker | 11.9% | 4.0% | 6.0% | **28.9%** |
| metLurcher | 6.3% | 5.2% | 8.4% | **28.8%** |
| bluebell | 8.0% | 3.4% | 10.8% | **28.7%** |
| coins/walk | 10 | **17** | 9 | 11 |

Each route has its own most-common find: park=daisy, high=metPoodle,
river=pebble, woods=stick. Length gates the tiers (20% walk = 1.0 items and
**zero** tier-2; full walk = 2.45 items, squeaky/bell appear). Past the daily
cap: 2.45 -> 1.45 items/walk and the top tier stops, but he still brings
something. **37/37 checks pass, zero page errors.**

### Contrast, measured (`ui/text.js auditContrast`)

| ink | plate | solved alpha | on black | on white | WORST |
|---|---|---|---|---|---|
| `#fff0d4` | `#241309` | 0.625 | 17.13 | 4.58 | **4.58** |
| `#fff3d8` | `#241309` | 0.619 | 17.51 | 4.58 | **4.58** |
| `#ffe9cd` | `#241309` | 0.640 | 16.29 | 4.58 | **4.58** |

BEFORE, the same cream on the cream wall: **1.22:1**. Known-background sites
need no plate: map title 7.61:1, find-card headline 10.45:1.

### Frame times (390x844, `--enable-gpu`, safe insets 20/40)

| beat | DPR | median | p95 | max | frame median |
|---|---|---|---|---|---|
| prepare | 2 | 2.5 ms | 4.6 ms | 6.1 ms | 16.7 ms |
| prepare | 3 | 2.6 ms | 4.3 ms | 5.3 ms | 16.7 ms |
| absence | 2 | 1.4 ms | 3.1 ms | 4.8 ms | 16.7 ms |
| absence | 3 | 1.3 ms | 2.5 ms | 4.0 ms | 16.7 ms |

Zero console errors, zero external requests, in light AND dark, normal and
`prefers-reduced-motion: reduce`.

## Progress log

- [x] read inherited code + SCOPE stage 4 + text-site audit
- [x] reproduce all three defects
- [x] defect 1 fixed — exclusive surface arbiter in room.js (both directions)
- [x] `src/ui/text.js` — contrast solver, safe area, shrink-to-fit
- [x] GATE 2 reload survival — 20/20 PASS
- [x] GATE 3 clock tamper — PASS
- [x] GATE 4 migrations v1/v2/v3 — PASS
- [x] GATE 5 discovery statistics — PASS (37/37 with gate 4)
- [x] walk copy + route map routed through text.js
- [x] retrofits: stage-3 cue legend, stage-3 hint line, naming title
- [x] frame times, reduced motion, dark mode, four-beat screenshots
- [x] ARCHITECTURE.md §14 written
- [x] all gates re-run green after the retrofits

### Not done (honest)
- `ui/toast.js`, `ui/sheet.js`, `ui/hud.js`, `ui/nav.js` are not yet routed
  through `ui/text.js`. The toast is the most visible of these — in
  `FINAL-beat1-prepare-light.png` the "Pip it is" toast is the lowest-contrast
  text left on screen. Obvious next retrofit.
- The route-map paper and the back/cancel tap targets use fixed virtual
  coordinates rather than deriving from the safe area. They clear a 20px inset
  but are not anchored to it; moving them means moving their hit tests too.
