"""
tools/traingate.py — SIT AND LIE DOWN ARE DIFFERENT GESTURES, AND THE ROSTER IS
READABLE. The gate for docs/FEEDBACK-QUEUE.md items 1 and 1b.

WHAT IT ASSERTS, and why each one is here rather than being taken on trust:

  A  THE COLLISION IS GONE. For every posture he can be in, the plain downward
     stroke over the head is read as `headDown` and can only ever mean `sit`,
     and the L is read as `headSweep` and can only ever mean `lieDown`. The
     defect was not that lie down was hard to reach — it was that the SAME
     stroke meant two things depending on hidden state, so the assertion is
     about the reading, not about the outcome. `train.debug.lastGuide` exists
     for this: before it, what the recogniser made of a stroke could only be
     inferred from the performance that followed, by which point it had already
     been acted on.

  B  A SLOPPY SIT IS STILL A SIT. The L is told from the sit by how far
     sideways the stroke finishes, so there is a boundary, and a boundary
     nobody has measured is a boundary that is in the wrong place. This walks
     the drift from 0 to 34 units and reports where it flips.

  C  NOTHING REGRESSED. All eight tricks still teach through a real gesture
     path, the reward window still lands, and the trial still performs by id —
     which is the one path that must NOT go through cue interpretation.

  D  THE LIST SAYS SOMETHING. Every row has a name, what he does, how to ask,
     and a level word; the "he needs to be..." line appears for exactly the
     three tricks whose GESTURE needs a posture, and only while he is in the
     wrong one; and Done stays inside the safe area at every inset a shipping
     phone reports.

  F  HIS PAW, OUTSIDE A LESSON. A tap on a paw is a handshake and plays the
     shake clip; RUBBING one is still a bad spot; the muzzle is untouched. Queue
     item 3, and the thing that had to not break is the sweet/bad model.

  E  IT IS LOOKED AT. Four renders, because two confident numeric gates have
     passed on this project while the screen was visibly wrong (GIFT-READY §8).

Usage:  py tools/traingate.py [--shots]
Exit code 0 = every check passed.
"""
import sys, json, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page, boot
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "review"

fails = []
notes = []


def check(ok, label, detail=""):
    (notes if ok else fails).append(("PASS" if ok else "FAIL") + "  " + label
                                    + (("  — " + str(detail)) if detail else ""))
    return ok


# ---- the two strokes, drawn as real pointer paths on his head ---------------
STROKE = """([kind, drift]) => {
  const sc = window.__pp.loop.scene;
  const rig = sc.rig, pet = sc.pet;
  const toV = (lx, ly) => ({ x: rig.x + lx * rig.s, y: rig.y + ly * rig.s * (rig.sy || 1) });
  const head = pet.anchor('head');
  const send = (type, v) => sc.pointer(window.__pp.app,
    { type, x: v.x, y: v.y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: type === 'move' });
  const top = head.y - head.hy * 0.5;
  const bottom = top + head.hy * 1.3;
  const pts = [];
  if (kind === 'down') {
    /* the sit: straight down over the head, with `drift` units of sideways
       sloppiness spread along it */
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      pts.push(toV(head.x + drift * u, top + (bottom - top) * u));
    }
  } else {
    /* the lie down: the same fall, then `drift` units flat along the floor */
    for (let i = 0; i <= 10; i++) pts.push(toV(head.x, top + (bottom - top) * (i / 10)));
    for (let i = 1; i <= 8; i++) pts.push(toV(head.x - drift * (i / 8), bottom));
  }
  const before = sc.debug.train.guidesRead;
  send('down', pts[0]);
  window.__pp.loop.stepFixed(1/60, 1);
  for (let i = 1; i < pts.length; i++) { send('move', pts[i]); window.__pp.loop.stepFixed(1/60, 1); }
  send('up', pts[pts.length - 1]);
  window.__pp.loop.stepFixed(1/60, 1);
  const d = sc.debug.train;
  /* `read` false means the stroke never reached the recogniser at all, which is
     a different failure from being read as nothing — see the counters in
     dog/train.js's debug block. */
  return Object.assign({}, d.lastGuide, { read: d.guidesRead > before,
    touches: d.dogTouches, from: d.posture, start: pts[0], end: pts[pts.length - 1] });
}"""

POSE = """(want) => {
  /* Put him in a posture WITHOUT going through the recogniser under test.

     TWO THINGS THIS HAS TO WAIT FOR, and both of them cost a false failure
     first:

       1. THE PERFORMANCE IN FLIGHT. `posture` is derived from the rig's own
          springs, so it still reads 'stand' for a few frames after he has been
          asked to sit. Stepping a fixed number of frames and then reading it
          posed him wrong and the stroke that followed measured nothing.
       2. THE TREAT. While he is waiting for one, a touch on him IS the treat
          and never a stroke — dog/train.js says so at the top of `pointer`,
          and it is right. So the next gesture was being eaten as a reward, and
          the recogniser never saw it.

     ALWAYS VIA A STAND, too: guiding a lie-down at a dog who is already lying
     down leaves him standing. */
  const pp = window.__pp;
  const t = pp.loop.scene.train;
  const step = (n) => pp.loop.stepFixed(1/60, n);
  const dbg = () => pp.loop.scene.debug.train;
  const settle = () => {
    let guard = 0;
    while (guard++ < 400) { const pf = dbg().perf; if (!pf || pf.done) break; step(6); }
    step(140);                     // > BALANCE.train.reward.window, so the treat lapses
  };
  /* ASK, SETTLE, CHECK, AND ASK AGAIN IF IT DID NOT TAKE — bounded at three
     tries. A guide is not a command: it can land on a dog who is mid-clip, and
     a transient trick (a jump, a spin) passes back through a stand on its way
     out, so one attempt is not a guarantee of the pose. Three unchecked
     attempts is what a harness that reports its own pose can afford; silently
     measuring the wrong posture is not. */
  const to = (want) => {
    for (let tries = 0; tries < 3; tries++) {
      settle();
      const now = dbg().posture;
      if (now === want) return true;
      if (want === 'stand') t.injectGuide('jump');
      else if (want === 'sit') t.injectGuide(now === 'stand' ? 'sit' : 'jump');
      else t.injectGuide(now === 'stand' ? 'lieDown' : 'jump');
    }
    settle();
    return dbg().posture === want;
  };
  to(want);
  return dbg().posture;
}"""


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        ctx, pg = page(b, inset=40)
        errors, requests = [], []
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
              if m.type in ("error", "warning") else None)
        pg.on("request", lambda r: requests.append(r.url)
              if not r.url.startswith(url) and not r.url.startswith("data:") else None)
        boot(pg, url)
        pg.evaluate("() => __pp.skipIntro('Pip')")
        # THE INSTALL CARD IS NOT PART OF THIS TEST AND WILL EAT IT. It becomes
        # eligible after a couple of minutes of play, and the settling this gate
        # does adds up to minutes — so partway through section A it opened, took
        # the surface (correctly: it is in the arbiter), and swallowed the next
        # stroke. Read as a flaky failure that moved between runs until
        # `dogTouches` showed the touch never reaching the recogniser at all.
        # `installNever` is the flag her own "Don't ask again" sets.
        pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
        TRAIN_ON = "() => { if (!__pp.dbg().train.on) __pp.train(true); return __pp.dbg().train.on; }"
        pg.evaluate(TRAIN_ON)

        # ---- A. the collision is gone -------------------------------------
        for posture in ("stand", "sit", "down"):
            got = pg.evaluate(POSE, posture)
            check(got == posture, "posed as %s" % posture, got)
            d = pg.evaluate(STROKE, ["down", 0])
            check(d["guide"] == "headDown" and d["trick"] in ("sit", ""),
                  "from a %s, the plain stroke is headDown and never lieDown" % posture, d)
            check(d["trick"] != "lieDown",
                  "from a %s, the plain stroke cannot mean lie down" % posture, d)
            if posture != "stand":
                check(d["need"] == "stand",
                      "from a %s, the plain stroke asks for a stand" % posture, d)

            pg.evaluate(POSE, posture)
            l = pg.evaluate(STROKE, ["L", 60])
            check(l["guide"] == "headSweep" and l["trick"] == "lieDown",
                  "from a %s, the L is headSweep -> lieDown" % posture, l)

        # ---- B. where the boundary actually is ----------------------------
        flip = None
        for drift in range(0, 36, 2):
            pg.evaluate(POSE, "stand")
            d = pg.evaluate(STROKE, ["down", drift])
            if d["trick"] == "lieDown" or d["guide"] == "headSweep":
                flip = drift
                break
        check(flip is None or flip >= 30,
              "a sit drawn sloppily stays a sit", "flips to lie down at %s units of drift" % flip)

        # ---- C. nothing regressed -----------------------------------------
        pg.evaluate("() => { __pp.train(false); localStorage.clear(); }")
        pg.reload()
        pg.wait_for_function("() => window.__pp && window.__pp.loop && window.__pp.loop.scene")
        pg.evaluate("() => __pp.skipIntro('Pip')")
        pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
        pg.evaluate(TRAIN_ON)
        # EACH GESTURE IS DRAWN FROM THE POSTURE IT IS READ IN. `__pp.guide`
        # synthesises the path from the live anchors but does not put him in the
        # pose it belongs to, so a beg drawn at a lying dog aims at a chest that
        # has moved and correctly means nothing. Pre-existing, and not what this
        # branch changed — but it was hidden before, because teaching a "lie
        # down" left him SITTING and the beg that followed happened to work.
        FROM = {"sit": "stand", "lieDown": "stand", "beg": "sit", "shake": "stand",
                "spin": "stand", "jump": "stand", "rollOver": "down", "playDead": "down"}
        # ONE SIGNAL PER TRICK, as a player would. Teaching all eight against a
        # single tap is a pathological input the game models faithfully — eight
        # meanings for one cue is exactly the mis-association it is built to
        # produce — so the later reps were landing on the wrong trick and
        # `playDead` never got one. The point of this section is that the RITUAL
        # still works, not that confusion still works.
        SIG = {"sit": "tap", "lieDown": "down", "beg": "up", "shake": "left",
               "spin": "circle", "jump": "double", "rollOver": "right", "playDead": "hold"}
        for tid in ["sit", "lieDown", "beg", "shake", "spin", "jump", "rollOver", "playDead"]:
            check(pg.evaluate(POSE, FROM[tid]) == FROM[tid],
                  "posed as %s to teach %s" % (FROM[tid], tid))
            before = pg.evaluate("(id) => (__pp.dbg().train.tricks[id] || {reps: 0}).reps", tid)
            pg.evaluate("([id, sig]) => __pp.teach(id, { signal: sig })", [tid, SIG[tid]])
            after = pg.evaluate("(id) => (__pp.dbg().train.tricks[id] || {reps: 0}).reps", tid)
            check((after or 0) > (before or 0), "a whole teaching rep still lands: %s" % tid,
                  "%s -> %s" % (before, after))
        pg.evaluate(POSE, "stand")
        got = pg.evaluate("() => __pp.perform('lieDown', { judged: true })")
        check(bool(got) and got.get("asked") == "lieDown",
              "the trial still performs lie down BY ID, bypassing the cue", got)

        # ---- D. the list -------------------------------------------------
        pg.evaluate(TRAIN_ON)
        check(pg.evaluate(POSE, "stand") == "stand", "standing, to read the list")
        pg.evaluate("() => __pp.loop.scene.train.pointer("
                    "{ type: 'down', x: __pp.BALANCE.ui.train.tricks.open.x + 10,"
                    "  y: __pp.BALANCE.ui.train.tricks.open.y + 10 }, { x: 0, y: 0 })")
        pg.evaluate("() => __pp.step(1/60, 30)")
        tl = pg.evaluate("() => __pp.dbg().tricks")
        check(tl["open"], "the pill opens the list", tl["open"])
        check(len(tl["rows"]) == 8, "every trick is on it", len(tl["rows"]))
        for r in tl["rows"]:
            check(bool(r["does"]) and bool(r["hint"]) and bool(r["know"]),
                  "row %s says what he does, how to ask, and how well he knows it" % r["id"],
                  r)
        gated = sorted([r["id"] for r in tl["rows"] if r["needs"]])
        check(gated == ["playDead", "rollOver"],
              "standing, only the two floor tricks say he needs to be somewhere else", gated)
        check(all(not r["needs"] for r in tl["rows"] if r["id"] == "sit"),
              "sit does not ask him to stand while he is standing")

        # the same list with him lying down: the gate flips the other way.
        # THROUGH `POSE`, not a pair of fixed step counts — `posture` lags the
        # request by a few frames and the first version read it too early.
        check(pg.evaluate(POSE, "down") == "down", "lying down, to read the list again")
        tl2 = pg.evaluate("() => __pp.dbg().tricks")
        gated2 = sorted([r["id"] for r in tl2["rows"] if r["needs"]])
        check(gated2 == ["sit"], "lying down, it is the SIT that needs him somewhere else", gated2)

        # Done stays reachable at every inset a shipping phone reports
        b2 = browser(p)
        for inset in (0, 20, 40, 80):
            c2, p2 = page(b2, inset=inset)
            boot(p2, url)
            p2.evaluate("() => __pp.skipIntro('Pip')")
            p2.evaluate("() => __pp.app.game.setFlag('installNever', true)")
            p2.evaluate("() => { if (!__pp.dbg().train.on) __pp.train(true); }")
            p2.evaluate("() => __pp.loop.scene.train.pointer("
                        "{ type: 'down', x: __pp.BALANCE.ui.train.tricks.open.x + 10,"
                        "  y: __pp.BALANCE.ui.train.tricks.open.y + 10 }, { x: 0, y: 0 })")
            p2.evaluate("() => __pp.step(1/60, 40)")
            d = p2.evaluate("() => __pp.dbg().tricks")
            cl = d["close"]
            floor = 844 - inset
            check(cl["y"] + cl["h"] <= floor,
                  "inset %s: Done is clear of the home bar" % inset,
                  "bottom %.1f vs floor %s" % (cl["y"] + cl["h"], floor))
            check(d["rowH"] > 40, "inset %s: the rows still have room" % inset, d["rowH"])
            c2.close()
        b2.close()

        # ---- E. renders, to be looked at ----------------------------------
        if shots:
            SHOTS.mkdir(exist_ok=True)
            c3, p3 = page(b, inset=40)
            boot(p3, url)
            p3.evaluate("() => __pp.skipIntro('Pip')")
            p3.evaluate("() => __pp.app.game.setFlag('installNever', true)")
            p3.evaluate("() => { if (!__pp.dbg().train.on) __pp.train(true); }")
            p3.evaluate("() => __pp.step(1/60, 60)")
            p3.screenshot(path=str(SHOTS / "train-screen.png"))
            # THE GHOST HINT, which is what makes the two lessons tell apart on
            # screen. Cycles through `teachable()` every `hintCycle` seconds, so
            # this steps until each of the two it is asked for comes round.
            want = {"sit", "lieDown"}
            for i in range(40):
                p3.evaluate("() => __pp.step(1/60, 60)")
                hp = p3.evaluate("() => __pp.dbg().train.hintPose")
                if hp in want:
                    # LET THE FADE FINISH. The ghost ramps in over 0.8s and the
                    # hint plate ramps with it, so a shot taken on the frame the
                    # pose changes shows an empty plate and no figure — which is
                    # what the first pair of renders were, and they proved
                    # nothing at all.
                    p3.evaluate("() => __pp.step(1/60, 70)")
                    if p3.evaluate("() => __pp.dbg().train.hintPose") == hp:
                        p3.screenshot(path=str(SHOTS / ("train-ghost-%s.png" % hp)))
                        want.discard(hp)
                if not want:
                    break
            check(not want, "both ghost gestures were drawn", "missing %s" % want)
            p3.evaluate("() => __pp.loop.scene.train.pointer("
                        "{ type: 'down', x: __pp.BALANCE.ui.train.tricks.open.x + 10,"
                        "  y: __pp.BALANCE.ui.train.tricks.open.y + 10 }, { x: 0, y: 0 })")
            p3.evaluate("() => __pp.step(1/60, 40)")
            p3.screenshot(path=str(SHOTS / "train-tricklist.png"))
            c3.close()
            notes.append("PASS  renders written to review/")

        # ---- F. HIS PAW, OUTSIDE A LESSON (queue item 3) -------------------
        # The trick always existed; taking his paw in the room did not. The one
        # thing that had to not break is the sweet/bad model: a tap is an offer
        # to shake, a RUB is still a bad spot, and the two must not blur.
        def one(action):
            c2, p2 = page(b, inset=40)
            boot(p2, url)
            p2.evaluate("() => __pp.app.game.setFlag('installNever', true)")
            p2.evaluate("() => __pp.skipIntro('Pip')")
            p2.evaluate("() => __pp.step(1/60, 30)")
            m0 = p2.evaluate("() => __pp.app.game.moodLevel")
            if action:
                p2.evaluate(action)
            clip = p2.evaluate("() => __pp.loop.scene.idle.current")
            m1 = p2.evaluate("() => __pp.app.game.moodLevel")
            c2.close()
            return round(m1 - m0, 5), clip

        ctrl, _ = one(None)
        paw, pawClip = one("() => __pp.tap({ zone: 'paw' })")
        muz, muzClip = one("() => __pp.tap({ zone: 'muz' })")
        rub, _ = one("() => __pp.stroke({ zone: 'paw', amp: 26, steps: 30 })")
        check(pawClip == "trick.shake", "tapping his paw plays the shake", pawClip)
        check(paw > ctrl, "and it pleases him rather than costing him mood",
              "%+.4f against a control of %+.4f" % (paw, ctrl))
        check(rub < ctrl - 0.02, "rubbing a paw is STILL a bad spot",
              "%+.4f" % rub)
        check(muz < ctrl - 0.02 and muzClip == "sneeze",
              "and the muzzle is still a bad spot too", "%+.4f, %s" % (muz, muzClip))

        # ---- G. the two standing invariants this branch could have broken ----
        # THE REACH ASSERTION (ARCHITECTURE 20). The trick-list pill is a new
        # interactive rect and the list is a new full surface, so the per-frame
        # audit that no prop's hit area intersects the nav bar is re-read here
        # rather than assumed to be somebody else's business.
        rep = pg.evaluate("() => __pp.reach.report()")
        check(rep.get("liveHits", -1) == 0, "reach: no prop is behind the nav bar",
              {k: rep.get(k) for k in ("liveHits", "anyHits", "frames") if k in rep})
        # FRAME COST with the list open, measured on the real loop.
        pg.evaluate("() => __pp.resetStats()")
        pg.evaluate("() => __pp.step(1/60, 300)")
        st = pg.evaluate("() => __pp.stats()")
        med, p95 = st.get("workMedian", 99), st.get("workP95", 99)
        check(med < 8.0, "frame cost with the list open stays well inside budget",
              "median %.2f ms, p95 %.2f, of a 16.7 ms budget" % (med, p95))

        check(not errors, "no page errors and no console warnings", errors[:4])
        check(not requests, "no external requests", requests[:4])
        b.close()

    for line in notes:
        print(line)
    for line in fails:
        print(line)
    print("\n%d passed, %d failed" % (len(notes), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
