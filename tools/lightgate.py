"""
tools/lightgate.py — THE ROOM KNOWS WHAT TIME IT IS (8.30.0).

`src/scenes/daylight.js` plus the light-aware half of `scenes/room.js`.
`state/time.js` has computed `timeOfDay()` since stage 1 with a docstring saying
the phase was "for lighting later"; later never came, and the room looked the
same at breakfast as at bedtime.

WHAT IT ASSERTS, and every one is either a rule the feature was built around or
a way it could quietly stop being true:

  A  MIDDAY DRAWS NOTHING. The afternoon room is the one that has always been
     there. Asserted twice over: the light state at noon is exactly neutral
     (sun 1, everything else 0), and the whole daytime plateau renders the wall
     no differently than holding the light still does, so "flat" is a measured
     property and not a hope. It is held against the box's OWN drift rather
     than against zero because a capture separated by a redraw is separated by
     a frame of the dog's springs — see the long note at the check itself, and
     D below, which had to learn the same lesson first.
     (The stronger version of this was run once by hand and is recorded in
     ARCHITECTURE §40: the noon room on 8.30.0 against the 8.29.0 room, from a
     git worktree of the previous release — 0 pixels of 514,800 differ.)

  B  ...AND NIGHT DOES NOT. It is darker, the window is darker with it, and the
     sun is genuinely absent rather than merely dimmed.

  C  THE WINDOW IS NOT A LAMP. A window at night must be darker than the wall
     around it. Getting this backwards is the single most obvious way for a
     day/night feature to look wrong, and no amount of "it's dimmer overall"
     catches it.

  D  THE DOG IS NOT RELIT. §32 rule 2, verbatim, and the reason this feature is
     baked into the room rather than washed over the finished frame. The same
     frozen dog is captured at noon and at midnight and his coat must come out
     BYTE-IDENTICAL — the technique `placegate` uses for the park, for the same
     reason: comparing two different moments compares two poses and says nothing
     about light.

  E  IT WRAPS. 23:50 and 00:10 are ten minutes apart, not a whole day. The
     keyframe walk in `lightAt` has a hand-written case for crossing midnight
     and that is exactly the kind of arithmetic that is wrong in one direction
     only.

  F  THE BUCKET IS WHAT REBUILDS. Two times inside one bucket must produce the
     identical room and two times across a boundary must not — which is what
     makes "the day moving on does not rebuild the room every frame" a fact
     rather than an intention.

  G  IT CAN FAIL. A gate that cannot fail is decoration (§27). The byte test is
     shown to tell two parts of the same dog apart before it is trusted to say
     two lightings are the same.

Usage:  py tools/lightgate.py [--shots]
Exit code 0 = every check passed.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page, boot
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "review"
fails, notes = [], []

NOON, NIGHT = 0.54, 0.94


def check(ok, label, detail=""):
    (notes if ok else fails).append(("PASS" if ok else "FAIL") + "  " + label
                                    + (("  — " + str(detail)) if detail else ""))
    return ok


# Byte and mean readers over a VIRTUAL rect, and the setter that moves the sun.
# `at()` re-bakes through the room's own `decorSig` path — the same one the rug
# uses — by stepping a frame, so nothing here reaches past the seam it is
# testing.
HELPERS = """() => {
  const pp = window.__pp;
  const cv = document.querySelector('canvas');
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const dev = (r) => {
    const v = pp.app.view;
    const x0 = Math.max(0, Math.round((v.offX + r[0] * v.vs) * v.dpr));
    const y0 = Math.max(0, Math.round((v.offY + r[1] * v.vs) * v.dpr));
    const w = Math.min(cv.width - x0, Math.round(r[2] * v.vs * v.dpr));
    const h = Math.min(cv.height - y0, Math.round(r[3] * v.vs * v.dpr));
    return [x0, y0, Math.max(1, w), Math.max(1, h)];
  };
  window.__lg = {
    mean(r) {
      const [x, y, w, h] = dev(r);
      const d = cx.getImageData(x, y, w, h).data;
      let R = 0, G = 0, B = 0;
      for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i+1]; B += d[i+2]; }
      const n = d.length / 4;
      return { r: +(R/n).toFixed(1), g: +(G/n).toFixed(1), b: +(B/n).toFixed(1),
               lum: +((R * 0.299 + G * 0.587 + B * 0.114) / n).toFixed(1) };
    },
    bytes(r) {
      const [x, y, w, h] = dev(r);
      const d = cx.getImageData(x, y, w, h).data;
      let s = '';
      for (let i = 0; i < d.length; i += 4) s += String.fromCharCode(d[i], d[i+1], d[i+2]);
      return s;
    },
    diff(a, b) {
      let n = 0;
      for (let i = 0; i < a.length; i += 3) {
        if (a[i] !== b[i] || a[i+1] !== b[i+1] || a[i+2] !== b[i+2]) n++;
      }
      return n;
    },
    /* MOVE THE SUN AROUND A FROZEN FRAME. 1e-6 runs update (which is where the
       room notices its signature changed and rebuilds) without advancing the
       dog, so a byte comparison of a living animal means something. */
    at(t) {
      pp.BALANCE.room.light.forceT = t;
      pp.loop.stepFixed(1e-6, 1);
      return t;
    },
  };
  return true;
}"""


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        errors = []
        ctx, pg = page(b, inset=40)
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
              if m.type == "error" else None)
        boot(pg, url)
        pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
        pg.evaluate("() => __pp.skipIntro('Pip')")
        pg.evaluate("() => __pp.app.nav.go('room', { switched: true })")
        pg.wait_for_function("() => window.__pp.loop.scene.rig")
        pg.evaluate("() => __pp.step(1/60, 40)")
        pg.evaluate(HELPERS)

        # ---- the model, before any pixels ---------------------------------
        model = pg.evaluate("""async () => {
          const m = await import('/src/scenes/daylight.js');
          const noon = m.lightAt(0.54);
          const mid = m.lightAt(0.0);
          /* E: across midnight. 0.999 and 0.001 are ~2.9 minutes apart. */
          const before = m.lightAt(0.999), after = m.lightAt(0.001);
          const gap = Math.max(
            Math.abs(before.sun - after.sun), Math.abs(before.dim - after.dim),
            Math.abs(before.lamp - after.lamp), Math.abs(before.skyA - after.skyA));
          return {
            noon, mid, gap: +gap.toFixed(4),
            buckets: [m.bucketOf(0), m.bucketOf(0.5), m.bucketOf(0.999)],
            plateau: [m.lightAt(0.47), m.lightAt(0.60)],
          };
        }""")
        n = model["noon"]
        check(n["sun"] == 1 and n["dim"] == 0 and n["lamp"] == 0
              and n["skyA"] == 0 and n["star"] == 0,
              "MIDDAY IS NEUTRAL — every light term is off, so the afternoon "
              "room is the one that has always been there", n)
        check(model["mid"]["sun"] == 0,
              "and at midnight the sun is ABSENT, not merely dimmed — which is "
              "the whole reason this is baked rather than washed over",
              model["mid"])
        check(model["gap"] < 0.02,
              "E: IT WRAPS — 23:58 and 00:01 are three minutes apart, not a day",
              "largest jump across midnight %s" % model["gap"])
        check(model["buckets"][0] == 0 and model["buckets"][2] == 95
              and model["buckets"][1] == 48,
              "the day quantises into the buckets the rebuild is gated on",
              model["buckets"])

        # ---- A: the daytime plateau is genuinely flat ---------------------
        # The wall above the dog: room art, no dog, no props, no chrome.
        WALL = [24, 350, 150, 60]
        WIN = [210, 104, 146, 214]
        # HOW MUCH THIS BOX MOVES ON ITS OWN, with the light held still, over
        # the same one and two redraws the plateau capture is separated by.
        #
        # SAME ARGUMENT AS `drift` BELOW, and it is here for the same reason: a
        # capture separated by a `stepFixed` is separated by a frame of the
        # dog's springs, and "the wall above the dog" is not as far above him as
        # the rect comment claims once his ears are at the top of their travel.
        # Asserting `== 0` passed on the machine this was written on, where the
        # whole plateau came back bit-identical, and failed on CI at FOUR pixels
        # of 36,000 — with `ab` (one redraw apart) at 0 and `ac` (two apart) at
        # 4, which is drift's signature and not light's: it grows with REDRAWS,
        # not with the hour. The same rasterizer reports 55 pixels of spring
        # drift on the torso where this machine reports 4, so the effect is ~14x
        # more visible there and crosses a whole pixel where here it does not.
        #
        # The claim is unweakened. `lightAt` interpolates the plateau between
        # two keys that are IDENTICAL (`balance.js` at 0.46 and 0.62), so a real
        # light change across it would not be four pixels — noon to midnight
        # moves 36,000 in this very box, four orders of magnitude clear of the
        # dog's heartbeat.
        wallDrift = pg.evaluate("""(r) => {
          const a = (__lg.at(0.54), __lg.bytes(r));
          __pp.loop.stepFixed(1e-6, 1);
          const b = __lg.bytes(r);
          __pp.loop.stepFixed(1e-6, 1);
          const c = __lg.bytes(r);
          return { one: __lg.diff(a, b), two: __lg.diff(a, c) };
        }""", WALL)
        flat = pg.evaluate("""(r) => {
          const a = (__lg.at(0.50), __lg.bytes(r));
          const b = (__lg.at(0.54), __lg.bytes(r));
          const c = (__lg.at(0.60), __lg.bytes(r));
          return { ab: __lg.diff(a, b), ac: __lg.diff(a, c) };
        }""", WALL)
        check(flat["ab"] <= wallDrift["one"] and flat["ac"] <= wallDrift["two"],
              "A: THE WHOLE DAYTIME PLATEAU IS ONE PICTURE — 12:00, 13:00 and "
              "14:24 differ by no more than the box does with the light held "
              "still", "%s across the plateau, against %s from the dog alone "
              "over the same redraws" % (flat, wallDrift))

        # ---- B / C: night ---------------------------------------------------
        lit = pg.evaluate("""(o) => {
          __lg.at(0.54);
          const dayWall = __lg.mean(o.wall), dayWin = __lg.mean(o.win);
          __lg.at(0.94);
          const nightWall = __lg.mean(o.wall), nightWin = __lg.mean(o.win);
          return { dayWall, dayWin, nightWall, nightWin };
        }""", {"wall": WALL, "win": WIN})
        check(lit["nightWall"]["lum"] < lit["dayWall"]["lum"] - 8,
              "B: THE ROOM IS DARKER AT NIGHT",
              "wall %.1f by day, %.1f at night"
              % (lit["dayWall"]["lum"], lit["nightWall"]["lum"]))
        check(lit["nightWin"]["lum"] < lit["dayWin"]["lum"] - 40,
              "and the window goes down with it, hard",
              "window %.1f by day, %.1f at night"
              % (lit["dayWin"]["lum"], lit["nightWin"]["lum"]))
        check(lit["nightWin"]["lum"] < lit["nightWall"]["lum"],
              "C: THE WINDOW IS NOT A LAMP — at night it is DARKER than the wall "
              "around it, which is the obvious way to get this backwards",
              "window %.1f vs wall %.1f"
              % (lit["nightWin"]["lum"], lit["nightWall"]["lum"]))

        # ---- F: the bucket is what rebuilds --------------------------------
        buck = pg.evaluate("""(r) => {
          /* two times inside ONE bucket (1/96 = 0.010417 wide) */
          const a = (__lg.at(0.700), __lg.bytes(r));
          const b = (__lg.at(0.708), __lg.bytes(r));
          /* ...and one clearly the other side of a boundary */
          const c = (__lg.at(0.760), __lg.bytes(r));
          return { inside: __lg.diff(a, b), across: __lg.diff(a, c) };
        }""", WALL)
        check(buck["inside"] == 0,
              "F: two times inside one bucket are the same room — the day moving "
              "on does not rebuild it every frame", buck)
        check(buck["across"] > 0,
              "...and CONTROL: across a boundary it really does change", buck)

        # ---- D: THE DOG IS NOT RELIT ---------------------------------------
        torso = pg.evaluate("""() => {
          const rig = __pp.loop.scene.rig, s = rig.s;
          return [rig.x - 26 * s, rig.y - 120 * s, 52 * s, 48 * s];
        }""")
        ctrl = pg.evaluate("""(t) => {
          __lg.at(0.54);
          const a = __lg.bytes(t);
          const b = __lg.bytes([t[0], t[1] + 30, t[2], t[3]]);
          return __lg.diff(a, b);
        }""", torso)
        check(ctrl > 0,
              "G CONTROL: the byte test can tell two parts of him apart",
              "%s pixels" % ctrl)
        # HOW MUCH HE MOVES ON HIS OWN, over the same number of redraws — because
        # he is not actually frozen. `stepFixed(1e-6, 1)` is the smallest step
        # that still runs the update where the room notices its signature
        # changed, and a living dog's springs are not bit-stable across even
        # that: measured at 4 pixels of a 17,922-pixel box over two steps.
        #
        # So the round trip below is held against THAT rather than against zero.
        # Asserting `== 0` passed for one step and failed for two, which is a
        # check reporting the dog's own heartbeat and calling it a lighting bug.
        drift = pg.evaluate("""(t) => {
          __lg.at(0.54);
          const a = __lg.bytes(t);
          __pp.loop.stepFixed(1e-6, 1);
          __pp.loop.stepFixed(1e-6, 1);
          const b = __lg.bytes(t);
          return __lg.diff(a, b);
        }""", torso)
        # ONE PAIR OF CAPTURES, TWO BOXES, AND THAT IS THE WHOLE CLAIM: the same
        # move from noon to midnight must change the ROOM and leave the DOG
        # alone. Reading both out of the same two frames is what makes this
        # self-controlling — a light that had quietly stopped working would take
        # the wall assertion down with it, so "his coat did not change" can never
        # pass by nothing having happened.
        #
        # An earlier version instead moved the sun there and BACK and asked for
        # his coat to return exactly. It does not, and should not be expected to:
        # each redraw advances his springs, and the round trip drifted 29 pixels
        # against 4 for a bare pair of steps. That check was reporting a living
        # animal's heartbeat and calling it a lighting bug.
        relit = pg.evaluate("""(o) => {
          __lg.at(0.54);
          const noonDog = __lg.bytes(o.torso), noonWall = __lg.bytes(o.wall);
          __lg.at(0.94);
          const nightDog = __lg.bytes(o.torso), nightWall = __lg.bytes(o.wall);
          return { dog: __lg.diff(noonDog, nightDog),
                   wall: __lg.diff(noonWall, nightWall) };
        }""", {"torso": torso, "wall": WALL})
        check(relit["wall"] > 1000,
              "the same move from noon to midnight DOES repaint the room — "
              "so the next check cannot pass by nothing having happened",
              "%s wall pixels changed" % relit["wall"])
        check(relit["dog"] <= drift,
              "D: ...AND HIS COAT IS UNCHANGED ACROSS IT — the dog is not relit "
              "(§32 rule 2)",
              "%s pixels differ, against %s from his own springs over the same "
              "redraws and %s for the fault injection"
              % (relit["dog"], drift, ctrl))

        if shots:
            SHOTS.mkdir(exist_ok=True)
            for name, t in (("dawn", 0.31), ("day", 0.54), ("dusk", 0.79), ("night", 0.94)):
                pg.evaluate("(t) => { __lg.at(t); __pp.step(1/60, 4); }", t)
                pg.screenshot(path=str(SHOTS / ("light-%s.png" % name)))

        check(not errors, "no page errors", errors[:4])
        ctx.close()
        b.close()

    for line in notes:
        print(line)
    for line in fails:
        print(line)
    print("\n%d passed, %d failed" % (len(notes), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
