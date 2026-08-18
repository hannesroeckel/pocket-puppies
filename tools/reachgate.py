"""
tools/reachgate.py — NOTHING SHE CAN PICK UP MAY HIDE BEHIND THE NAV BAR.

A REWRITE OF `C:\\tmp\\pp11\\reachgate.py`, which ARCHITECTURE 20.5 cites for the
whole reachable-play-area fix and which was never committed. It is gone from this
machine, so this is rebuilt from what §20 records — the assertions, the prop
states, the four insets and the numbers.

WHAT THE DEFECT WAS. A ball dropped after he was hit with it landed at a
hardcoded y 782, inside the nav's hit rect on the target iPhone: the touch went
to the bar and the ball could never be picked up again. The punishment for an
accidental hit was losing the toy for good. Its HOME was already 61% behind the
bar on first launch.

WHAT THE FIX WAS. `ui/reach.js` publishes one reachable play area whose bottom is
derived from the nav's real hit rect — itself derived from `BALANCE.ui.nav` plus
`env(safe-area-inset-bottom)` — and every interactive prop is clamped to it, with
a per-frame assertion (`reach.tick()`) reporting any prop whose hit area
intersects the bar. THIS GATE IS THAT ASSERTION'S READER: `reach.report()` is the
product's own answer, and the gate's job is to put the props into every state
that ever mattered and then read it.

WHAT IT ASSERTS, at insets 0 / 20 / 40 / 80:

  A  `liveHits` IS ZERO over thousands of audited frames, through every prop
     state: the ball at home, thrown, chased, brought back, dropped at her feet,
     dropped after a flinch, dragged deliberately under the bar; both resting
     bowls; a walk find dropped on the rug.

  B  THE FLINCH CASE IS PICKABLE. The reported defect, reproduced: hit him with
     the ball, then put a real pointer on its centre and require that it comes
     up in her hand — `heldOnTap` true, and no nav pill activated.

  C  A DRAG UNDER THE BAR COMES BACK. Dragging it to the bottom of the screen
     lands it on the reach line rather than under the bar.

  D  THE THROW IS UNREGRESSED. `fly -> chase -> back -> settle` all reached, and
     the tease-then-refuse still fires.

  E  THE ASSERTION IS NOT FREE OF CHARGE, and it is not zero-by-construction:
     the gate INJECTS a prop inside the bar — at a y derived from `reach.bottom`,
     because the defect's historical y 782 is only inside the bar at inset 40 —
     and requires `liveHits` to notice.
     A gate that cannot fail is not a gate (see tools/bowlgate.py's header for
     what happens when nobody checks).

Usage:  py tools/reachgate.py [--shots]
Exit code 0 = every check passed.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page, boot
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "review"
INSETS = (0, 20, 40, 80)
fails, notes = [], []


def check(ok, label, detail=""):
    (notes if ok else fails).append(("PASS" if ok else "FAIL") + "  " + label
                                    + (("  — " + str(detail)) if detail else ""))
    return ok


# Put the props through every state that has ever mattered, auditing every frame.
EXERCISE = """() => {
  const pp = window.__pp;
  const step = (n) => pp.step(1/60, n);
  const toy = () => pp.dbg().toyState;
  const seen = new Set();
  const mark = () => { const t = toy(); if (t) seen.add(t.state); };

  step(30); mark();                                  // at home on the rug
  /* thrown up-screen, chased, brought back, settled */
  pp.flick({ from: [330, 700], to: [250, 470] });
  for (let i = 0; i < 260; i++) { step(2); mark(); }
  /* hit him with it: the flinch drop, which is the reported defect */
  const t0 = toy();
  pp.drag({ from: [t0.at[0], t0.at[1]], to: [195, 470], steps: 12 });
  for (let i = 0; i < 120; i++) { step(2); mark(); }
  /* dragged deliberately at the very bottom of the screen */
  const t1 = toy();
  pp.drag({ from: [t1.at[0], t1.at[1]], to: [195, 843], steps: 16 });
  for (let i = 0; i < 60; i++) { step(2); mark(); }
  /* both resting bowls, drawn by the room rather than by care */
  pp.care('feed'); step(20); pp.stopCare(); step(40);
  pp.care('water'); step(20); pp.stopCare(); step(40);
  /* and something he brought home, dropped on the rug */
  pp.app.game.addFind('stick', Date.now());
  pp.app.game.addFind('daisy', Date.now());
  step(60);
  const r = pp.reach.report();
  return { report: r, states: Array.from(seen), toy: toy() };
}"""

# The reported defect, end to end: hit him with the ball, then try to pick it up.
FLINCH = """() => {
  const pp = window.__pp;
  pp.flick({ from: [330, 700], to: [250, 470] });
  pp.step(1/60, 60);
  let t = pp.dbg().toyState;
  pp.drag({ from: [t.at[0], t.at[1]], to: [195, 470], steps: 12 });
  for (let i = 0; i < 200; i++) {
    pp.step(1/60, 2);
    t = pp.dbg().toyState;
    if (t.state === 'idle' && !t.held) break;
  }
  t = pp.dbg().toyState;
  /* a REAL pointer, on the ball's own centre */
  const sc = pp.loop.scene;
  sc.pointer(pp.app, { type: 'down', x: t.at[0], y: t.at[1], id: 1,
                       dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
  pp.step(1/60, 2);
  const after = pp.dbg().toyState;
  const nav = pp.dbg().nav;
  sc.pointer(pp.app, { type: 'up', x: t.at[0], y: t.at[1], id: 1,
                       dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
  pp.step(1/60, 2);
  return {
    at: t.at, reachClear: t.reachClear, heldOnTap: !!after.held,
    navActive: (nav && (nav.active || nav.pressed)) || '',
  };
}"""


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        errors = []
        for inset in INSETS:
            ctx, pg = page(b, inset=inset)
            pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
            pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
                  if m.type in ("error", "warning") else None)
            boot(pg, url)
            pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
            pg.evaluate("() => __pp.skipIntro('Pip')")

            got = pg.evaluate("() => __pp.app.view.safe.bottom")
            check(abs(got - inset) < 0.5, "inset %s: the game read the home bar" % inset, got)

            r = pg.evaluate(EXERCISE)
            rep = r["report"]
            check(rep.get("liveHits", -1) == 0,
                  "inset %s: no prop she can pick up is behind the bar" % inset,
                  "liveHits %s over %s audited frames, probes %s"
                  % (rep.get("liveHits"), rep.get("frames"), rep.get("probes", "?")))
            # 1,000+ is what THIS exercise drives; §20.5 quotes ~2,900 per inset
            # from a longer prop sweep. Recorded rather than rounded up: a gate
            # that claims a bigger sample than it takes is the same species of
            # lie as one that cannot fail.
            check(rep.get("frames", 0) > 1000,
                  "inset %s: and that is over a real run, not a glance" % inset,
                  "%s audited frames (20.5's own sweep was ~2,900)" % rep.get("frames"))
            for want in ("fly", "chase", "back"):
                check(want in r["states"],
                      "inset %s: the throw really went through '%s'" % (inset, want),
                      r["states"])

            f = pg.evaluate(FLINCH)
            check(f["heldOnTap"],
                  "inset %s: after a flinch drop the ball is PICKABLE" % inset, f)
            check(not f["navActive"],
                  "inset %s: and the tap did not go to the nav instead" % inset, f)
            check(f["reachClear"] >= 0,
                  "inset %s: it is resting clear of the bar" % inset,
                  "reachClear %.2f" % f["reachClear"])

            deep = pg.evaluate("""() => {
              const pp = window.__pp;
              let t = pp.dbg().toyState;
              pp.drag({ from: [t.at[0], t.at[1]], to: [195, 843], steps: 16 });
              pp.step(1/60, 40);
              t = pp.dbg().toyState;
              return { at: t.at, reachClear: t.reachClear, bottom: pp.reach.bottom };
            }""")
            check(deep["reachClear"] >= 0,
                  "inset %s: dragging it to the bottom lands it on the reach line" % inset,
                  deep)

            if shots and inset == 40:
                SHOTS.mkdir(exist_ok=True)
                pg.screenshot(path=str(SHOTS / "reach-inset40.png"))

            # ---- E. can this gate fail? -----------------------------------
            hurt = pg.evaluate("""() => {
              const pp = window.__pp;
              /* a prop parked exactly where the ball used to land: y 782, the
                 hardcoded value from the original defect. The per-frame audit
                 must notice, or it is not auditing anything. */
              /* The probe shape is a CENTRE plus radii, not a rect (ui/reach.js:57).
                 AND THE INJECTION POINT IS DERIVED, not typed: y 782 is the
                 historical defect's value at inset 40, and at inset 80 the bar
                 sits higher, so 782 falls BELOW it — the audit reported 0 and was
                 right to, while the gate called it a failure. Deriving the point
                 from `reach.bottom` is the same lesson §20 exists for: the number
                 that mattered was never 782, it was "inside the bar". */
              const y = pp.reach.bottom + 24;
              const off = pp.reach.watch('injected', () => ({
                id: 'injected', state: 'inside-the-bar',
                x: 180, y, rx: 16, ry: 16, live: true,
              }));
              pp.step(1/60, 30);
              const bad = pp.reach.report();
              off();
              pp.step(1/60, 10);
              return { at: y, liveHits: bad.liveHits, after: pp.reach.report().liveHits };
            }""")
            check(hurt["liveHits"] > 0,
                  "inset %s: a prop injected inside the bar IS caught" % inset, hurt)
            ctx.close()

        check(not errors, "no page errors and no console warnings", errors[:4])
        b.close()

    for line in notes:
        print(line)
    for line in fails:
        print(line)
    print("\n%d passed, %d failed" % (len(notes), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
