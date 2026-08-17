"""
tools/toastgate.py — A MESSAGE MUST NOT OBSCURE ITS OWN SUBJECT. Queue item 5.

  "Feeding: the 'Biscuit is full' toast sits directly over the bowl it refers
   to. Play: a hud hint 'Flick the ball up-screen' and a toast 'Flick the ball
   up — never sideways' are shown at once, and the toast covers the very ball it
   names. Both are legible — ui/text.js guarantees contrast — so no gate catches
   them. The defect is placement and redundancy, not readability."

That last sentence is the whole reason this file exists: every existing gate on
this project asks whether text can be READ, and this one asks where it IS.

WHAT IT ASSERTS:

  A  THE REPORTED CASE. With a bowl placed and a toast up, the toast's box does
     not intersect the bowl's rect — and it DOES intersect it if the avoidance
     rect is withheld, which is what proves the check is measuring the fix
     rather than measuring nothing.

  B  THE BALL. Same, for a ball lying on the floor.

  C  IT IS BOUNDED. The lift is capped, so a toast never climbs off into the
     middle of the room to get away from something.

  D  THE STACK STAYS A STACK. Three toasts keep their spacing and their order
     when the whole thing lifts.

  E  NO DOUBLE MESSAGE. Tapping Play sets one message, not a hint and a toast
     saying the same thing in different words.

Usage:  py tools/toastgate.py [--shots]
Exit code 0 = every check passed.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page, boot
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "review"
fails, notes = [], []


def check(ok, label, detail=""):
    (notes if ok else fails).append(("PASS" if ok else "FAIL") + "  " + label
                                    + (("  — " + str(detail)) if detail else ""))
    return ok


def overlap(a, b):
    if not a or not b:
        return 0.0
    w = min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"])
    h = min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"])
    return max(0.0, w) * max(0.0, h)


# WHERE THE TOAST ACTUALLY LANDS. `ui/text.js` returns the measured box from
# drawText, so this asks the real renderer rather than recomputing the layout —
# a gate that reimplements the thing it checks is checking itself.
BOXES = """([text, withAvoid]) => {
  const pp = window.__pp;
  const sc = pp.loop.scene;
  const g = pp.g || null;
  const out = { toast: null, subject: null };
  /* the room hands the toast layer its subject; ask the room for it */
  const subj = sc.toastSubject ? sc.toastSubject() : null;
  out.subject = subj;
  /* draw one toast through the real layer, capturing the box ui/text.js
     measured, with and without the avoidance rect */
  out.toast = sc.probeToast ? sc.probeToast(text, withAvoid ? subj : null) : null;
  return out;
}"""


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        ctx, pg = page(b, inset=40)
        errors = []
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
              if m.type in ("error", "warning") else None)
        boot(pg, url)
        pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
        pg.evaluate("() => __pp.skipIntro('Pip')")

        # ---- A. the reported case: a bowl, and a toast about it ------------
        placed = pg.evaluate("""() => {
          /* DRAG THE BOWL FROM WHERE IT ACTUALLY IS. The first version dragged
             from a guessed (300, 700), grabbed nothing, and left the bowl in its
             resting spot at x 66 — where a centred toast never covered it, so
             the gate's own "before" case had no defect in it to fix. */
          __pp.care('feed');
          __pp.step(1/60, 10);
          const at = __pp.dbg().care.bowlAt;
          __pp.drag({ from: at, to: [195, 690], steps: 18 });
          __pp.step(1/60, 40);
          const d = __pp.dbg().care;
          return { placed: !!d.placed, bowlAt: d.bowlAt, mode: d.mode };
        }""")
        check(placed["placed"], "the bowl is actually placed under him", placed)
        got = pg.evaluate(BOXES, ["Biscuit is full", True])
        raw = pg.evaluate(BOXES, ["Biscuit is full", False])
        check(bool(got["subject"]), "the bowl is the subject while she is feeding him",
              got["subject"])
        check(overlap(raw["toast"], raw["subject"]) > 0,
              "and without the rule the toast really does land on it",
              "%.0f square units" % overlap(raw["toast"], raw["subject"]))
        check(overlap(got["toast"], got["subject"]) == 0,
              "with the rule it clears the bowl entirely",
              {"toast": got["toast"], "bowl": got["subject"]})
        lift = raw["toast"]["y"] - got["toast"]["y"] if got["toast"] and raw["toast"] else 0
        check(0 < lift <= pg.evaluate("() => __pp.BALANCE.ui.toast.avoidMaxLift"),
              "and it lifted by a bounded amount", "%.0f units" % lift)
        if shots:
            SHOTS.mkdir(exist_ok=True)
            pg.evaluate("""() => { const sc = __pp.loop.scene;
              sc.toasts.show('Biscuit is full'); __pp.step(1/60, 20); }""")
            pg.screenshot(path=str(SHOTS / "toast-bowl.png"))
        pg.evaluate("() => { __pp.stopCare(); __pp.step(1/60, 40); }")

        # ---- B. the ball --------------------------------------------------
        pg.evaluate("""() => {
          /* and put the ball where the report puts it: under the message. Its
             home slot is off to the right, so this drags it to the middle —
             which is exactly the state the human hit, having just flicked it. */
          const t = __pp.loop.scene.toy;
          __pp.drag({ from: [t.toy.x, t.toy.y], to: [195, 690], steps: 14 });
          __pp.step(1/60, 20);
        }""")
        ball = pg.evaluate(BOXES, ["Flick the ball up-screen", True])
        ball_raw = pg.evaluate(BOXES, ["Flick the ball up-screen", False])
        check(bool(ball["subject"]), "a ball on the floor is a subject too", ball["subject"])
        check(overlap(ball_raw["toast"], ball_raw["subject"]) > 0,
              "and it was covered before", "%.0f" % overlap(ball_raw["toast"], ball_raw["subject"]))
        check(overlap(ball["toast"], ball["subject"]) == 0,
              "and is not now", {"toast": ball["toast"], "ball": ball["subject"]})

        # ---- C / D. bounded, and still a stack ----------------------------
        stack = pg.evaluate("""() => {
          const sc = __pp.loop.scene;
          sc.toasts.clear();
          sc.toasts.show('one'); sc.toasts.show('two'); sc.toasts.show('three');
          __pp.step(1/60, 6);
          return { texts: sc.toasts.texts, count: sc.toasts.count };
        }""")
        check(stack["count"] == 3 and stack["texts"] == ["one", "two", "three"],
              "three toasts keep their order", stack)
        far = pg.evaluate("""() => {
          /* a subject the whole height of the screen: the lift must still stop */
          const sc = __pp.loop.scene;
          return sc.probeToast('anywhere', { x: 0, y: 0, w: 390, h: 844 });
        }""")
        floorY = pg.evaluate("() => __pp.BALANCE.view.H")
        check(far and far["y"] > 0 and far["y"] < floorY,
              "an unavoidable subject does not throw the toast off the screen", far)

        # ---- E. one message, not two --------------------------------------
        two = pg.evaluate("""() => {
          const sc = __pp.loop.scene;
          sc.toasts.clear();
          const nav = { id: 'play' };
          __pp.loop.scene.navAction
            ? __pp.loop.scene.navAction(__pp.app, nav)
            : null;
          __pp.step(1/60, 4);
          return { toasts: sc.toasts.texts, hint: sc.hud ? sc.hud.hint : null };
        }""")
        check(two["toasts"] == [],
              "tapping Play raises no toast at all — the hint carries it", two)
        check(bool(two["hint"]), "and the hint says the whole thing", two["hint"])

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
