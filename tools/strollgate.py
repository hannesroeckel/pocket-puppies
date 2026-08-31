"""
tools/strollgate.py — THE WALK SHE WATCHES, AND TAPS.

Beat 2.75 (`src/dog/stroll.js`, 8.22.0). He walks out of the room, onto a road
that goes past him, and the things he passes are hers to tap — what she taps is
what he brings home, so a find is DISCOVERED rather than awarded by a timer.

WHAT IT ASSERTS, and every one of these is either a rule the beat was built
around or a way it could quietly stop being true:

  A  THE ROAD IS ONE TILE WIDE, WHICH IS WHY IT HAS NO SEAM. `drawStrip` is
     periodic by construction, and the beat blits it wrapped at exactly the
     canvas width. If the bake is ever a different width from the wrap, the
     periodicity is silently thrown away and a seam slides past every few
     seconds — a defect that is invisible in any single frame and obvious in
     motion, i.e. exactly the kind a gate has to hold instead of an eye.

  B  IT IS INSIDE THE WALK, NEVER ADDED TO IT. The clock started at Set off.
     Watching may not lengthen the walk, may not move `startedAt`, and may not
     leave progress at 1 — and it may not run past the end of a walk that
     finishes underneath it.

  C  WHAT SHE TAPS IS PERSISTED THE INSTANT SHE TAPS IT, on the WALK RECORD and
     not in the layer. iOS suspends JS entirely; a tap that only lived in a
     layer is a tap that never happened. Checked through a real reload.

  D  ...AND IT IS WHAT COMES HOME. The picks are the finds, whatever the roll
     would have said.

  E  KINDNESS. She tapped nothing, or she never watched: he still brings
     something home, and the roll is exactly the one the walk always had. Losing
     must never feel like rebuke (SCOPE principle 5).

  F  THE TAP IS THE ONE A THUMB MAKES. Driven as a pointer event through
     `scene.pointer`, never `stroll.take()` — 8.16.1's lesson: a gate that
     drives a layer's own handler proves the handler and proves nothing about
     whether the touch ever reaches it.

  G  ...AND A MISS IS A MISS. The generous hit window must still be a window: a
     tap well away from a find takes nothing, and does not fall through to the
     petting field and stroke a dog who is a hundred yards up the road.

  H  IT IS INTERRUPTIBLE, THREE WAYS. The way out, leaving the scene, and the
     walk ending underneath it — all three land in the same absence, with her
     taps kept.

  I  THERE IS NEVER TWO OF HIM, and the room's things stay in the room. The
     frontal dog is hidden for every frame, and the sill, the bowls, the ball
     and the dust are all sent home by `outdoors()` (§32.3).

  J  IT CAN FAIL. A gate that cannot fail is decoration (§27) — the controls
     here tap thin air and ask for a find that does not exist, and both are
     asserted to come back empty-handed.

Usage:  py tools/strollgate.py [--shots]
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


# Out of the room and onto the road, in one call. `wait` is REAL time, not
# stepped time: an <img> decode needs event-loop turns and `_drive.PIN` freezes
# the clock the loop runs on (the lesson `walkgate` learned first).
ONTO_ROAD = """(dur) => {
  const pp = window.__pp;
  pp.setOff(null, dur || undefined);
  let g = 0;
  while (g++ < 400 && pp.dbg().walk.leaving) pp.step(1/60, 1);
  return pp.dbg().walk;
}"""


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        errors = []

        def fresh(breed="schnoodle", wait=900):
            ctx, pg = page(b, inset=40)
            pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
            pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
                  if m.type == "error" else None)
            boot(pg, url)
            pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
            pg.evaluate("() => __pp.skipIntro('Pip')")
            pg.evaluate("(bd) => { __pp.app.game.state.dogs[0].breedId = bd; }", breed)
            pg.evaluate("() => __pp.app.nav.go('room', { switched: true })")
            pg.wait_for_function("() => window.__pp.loop.scene.rig")
            pg.evaluate("() => __pp.step(1/60, 30)")
            pg.evaluate("() => __pp.loop.scene.startWalk()")
            pg.evaluate("() => __pp.step(1/60, 40)")
            if wait:
                pg.wait_for_timeout(wait)
            return ctx, pg

        # ---- A0 : THE TILE REALLY IS SEAMLESS, IN PIXELS -------------------
        #
        # `drawStrip` is periodic BY CONSTRUCTION and was reviewed as four static
        # screenshots with the join slid past (`review/stroll-0..3.png`) — and it
        # still shipped a seam. Every wave closed on itself and every tree clump
        # was redrawn one tile over, but the CLOUDS were drawn once and clipped,
        # so a cloud straddling the join became a hard vertical line down two
        # thirds of the screen. The review shots had put the join over grass.
        #
        # So it is asserted rather than looked at: draw the tile TWICE, side by
        # side, and compare how much the picture changes from one pixel column to
        # the next AT THE JOIN against how much it changes in an ordinary stretch
        # of the same picture. A seamless tile makes the join an ordinary column;
        # a clipped shape makes it the biggest step in the image.
        ctx, pg = fresh(wait=0)
        seam = pg.evaluate("""async () => {
          const mod = await import('/src/scenes/outdoors.js');
          const W = 520, H = 900;
          const cv = document.createElement('canvas');
          cv.width = W * 2; cv.height = H;
          const c = cv.getContext('2d');
          const opts = { floorY: H * 0.62 };
          c.save(); mod.drawStrip(c, W, H, opts); c.restore();
          c.save(); c.translate(W, 0); mod.drawStrip(c, W, H, opts); c.restore();
          const img = c.getImageData(0, 0, W * 2, H).data;
          /* mean per-channel change between column x and column x+1 */
          const step = (x) => {
            let s = 0;
            for (let y = 0; y < H; y++) {
              const a = (y * W * 2 + x) * 4, b = (y * W * 2 + x + 1) * 4;
              s += Math.abs(img[a] - img[b]) + Math.abs(img[a+1] - img[b+1])
                 + Math.abs(img[a+2] - img[b+2]);
            }
            return s / H / 3;
          };
          let join = 0;
          for (let x = W - 3; x <= W + 1; x++) join = Math.max(join, step(x));
          /* the control: the busiest ordinary column in the middle of a tile,
             which is where the tufts and the treeline are */
          let worst = 0;
          for (let x = Math.round(W * 0.25); x < Math.round(W * 0.75); x++) {
            worst = Math.max(worst, step(x));
          }
          return { join: +join.toFixed(3), worst: +worst.toFixed(3) };
        }""")
        check(seam["worst"] > 0.5,
              "control: the tile has real detail to be discontinuous IN", seam)
        check(seam["join"] <= seam["worst"] * 1.35,
              "THE JOIN IS AN ORDINARY COLUMN — the tile is seamless in pixels, "
              "not just in intention",
              "join %.2f vs busiest ordinary column %.2f" % (seam["join"], seam["worst"]))
        ctx.close()

        # ---- A : the road, and the reason it has no seam ------------------
        ctx, pg = fresh()
        road = pg.evaluate(ONTO_ROAD)
        geom = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene;
          const v = pp.app.view;
          const d0 = pp.dbg().walk.stroll;
          const xs = [d0.dist];
          /* THE DISSOLVE IS NOT COUNTED, AND THAT IS THE POINT. `outdoors` is
             "the road has all but replaced the room" — the same > 0.5 test the
             park and the ring use — so while the two are crossfading the room's
             own things are still on a screen that is still mostly the room, and
             they SHOULD be. Sampled after the fade has landed. */
          const fadeIn = pp.dbg().walk.stroll.w;
          pp.step(1/60, 45);
          let hidden = 0, out = 0, frames = 0;
          for (let i = 0; i < 120; i++) {
            pp.step(1/60, 1);
            const d = pp.dbg().walk.stroll;
            xs.push(d.dist);
            if (sc.walk.hidesDog) hidden++;
            if (sc.walk.outdoors) out++;
            frames++;
          }
          const d = pp.dbg().walk.stroll;
          return {
            tile: d.tile, cw: v.cw, ch: v.ch,
            first: xs[0], last: xs[xs.length - 1],
            rising: xs.every((x, i) => i === 0 || x >= xs[i - 1]),
            hidden, out, frames, fadeIn,
            depths: pp.dbg().walk.stroll.items.map((it) => it.depth),
            ys: pp.dbg().walk.stroll.items.map((it) => it.y),
            modal: sc.walk.modal, owns: sc.walk.owns,
            owner: sc.debug.owner || '',
          };
        }""")
        check(bool(road["stroll"]["on"]), "he walks out of the room and onto a road",
              road["stroll"])
        check(geom["tile"] and geom["tile"][0] == geom["cw"],
              "the bake is EXACTLY one canvas wide — which is what makes the wrap seamless",
              "tile %s vs canvas %s" % (geom["tile"], geom["cw"]))
        check(geom["tile"] and 0 < geom["tile"][2] < geom["ch"],
              "and the horizon it splits the two parallax planes on is inside it",
              geom["tile"])
        check(geom["rising"] and geom["last"] > geom["first"] + 50,
              "the road really goes past him, one way",
              "%s -> %s" % (geom["first"], geom["last"]))
        check(geom["hidden"] == geom["frames"],
              "the frontal dog is hidden for every frame — never two of him",
              "%s of %s" % (geom["hidden"], geom["frames"]))
        check(geom["out"] == geom["frames"],
              "and the room's own things (sill, bowls, ball, dust) are sent home",
              "%s of %s" % (geom["out"], geom["frames"]))
        check(geom["fadeIn"] < 0.5,
              "control: the road really did dissolve in rather than cut",
              geom["fadeIn"])
        # ---- the depth spread, which is invisible in any one frame ---------
        # A plain per-find hash is uniform on average and says nothing about ONE
        # walk: the seed this was first rendered with drew 0.99, 0.93 and 0.96,
        # so all three finds sat at the same distance AND — because each is a tap
        # target passed through `reach.clampY` — at the same clamped y. Two bugs
        # in one frame, neither of them visible in that frame.
        if len(geom["depths"]) > 1:
            check(max(geom["depths"]) - min(geom["depths"]) > 0.25,
                  "the finds are at REAL different distances, not three on one line",
                  geom["depths"])
            check(len(set(geom["ys"])) == len(geom["ys"]),
                  "...and the reach clamp is a guard, not the thing choosing where they sit",
                  geom["ys"])
        check(geom["modal"] and geom["owns"] and geom["owner"] == "walk",
              "it owns the surface, so nothing can open over it (§14.1)", geom)

        # ---- C(part) / F : she taps one, through a REAL pointer event ------
        offered = pg.evaluate("() => __pp.dbg().walk.stroll.items.map((i) => i.id)")
        check(len(offered) >= 1, "the walk offers her something to find", offered)
        tap = pg.evaluate("() => __pp.strollTap(0)")
        check(tap and tap["tapped"] and tap["took"],
              "a tap where the find is being drawn picks it up", tap)
        check(tap and tap["onRecord"] == [offered[0]],
              "and it is on the WALK RECORD immediately, not in the layer", tap)

        # ---- G / J : a miss is a miss, and this gate can fail --------------
        miss = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene;
          const before = pp.dbg().walk.picked.slice();
          /* A PRESS IS THE TELL. `scenes/room.js` calls `pet.down()` only when a
             touch has fallen all the way through every layer, and that pushes a
             press onto the petting field that lives for several frames — so a
             press appearing here IS the fall-through, named. */
          const petBefore = sc.debug.presses;
          /* thin air: high in the sky, nowhere near any find and nowhere near
             the way out in the opposite corner */
          const send = (type) => sc.pointer(pp.app, {
            type, x: 350, y: 120, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
          send('down');
          pp.step(1/60, 1);
          const petAfter = sc.debug.presses;
          send('up');
          pp.step(1/60, 2);
          return {
            before, after: pp.dbg().walk.picked.slice(),
            petBefore, petAfter,
            stillOn: pp.dbg().walk.stroll.on,
          };
        }""")
        check(miss["before"] == miss["after"],
              "CONTROL: a tap on thin air takes nothing — the window really is a window",
              miss)
        check(miss["petAfter"] == miss["petBefore"],
              "and it does not fall through and stroke a dog who is up the road", miss)
        check(miss["stillOn"], "and it does not end the beat either", miss)
        nosuch = pg.evaluate("() => __pp.strollTap(9)")
        check(nosuch and not nosuch["tapped"] and not nosuch["took"],
              "CONTROL: asking for a find that was never offered comes back empty-handed",
              nosuch)


        # ---- C : IT SURVIVES THE APP BEING CLOSED (schema 11) --------------
        pg.evaluate("() => __pp.saveNow()")
        pg.reload()
        pg.wait_for_function("() => window.__pp && window.__pp.loop && window.__pp.loop.scene")
        pg.evaluate("() => { const b = document.getElementById('boot'); if (b) b.remove(); }")
        pg.evaluate("() => __pp.step(1/60, 30)")
        after = pg.evaluate("""() => {
          const pp = window.__pp;
          const d = pp.dbg().walk;
          return { picked: pp.app.game.walkPicked, away: d.away, v: pp.app.game.state.v,
                   active: !!pp.app.game.walkActive };
        }""")
        check(after["picked"] == [offered[0]],
              "SHE CLOSED THE APP MID-STROLL AND HER TAP IS STILL THERE", after)
        check(after["v"] >= 11, "and the save is schema 11 or later", after["v"])
        check(after["away"] and after["active"],
              "the walk itself carries on as an ordinary absence", after)

        # ---- D : what she tapped is what comes home ------------------------
        home = pg.evaluate("""() => {
          const pp = window.__pp;
          pp.loop.scene.walk.bringHome();
          pp.step(1/60, 8);
          const d = pp.dbg().walk;
          return { carried: d.carried, card: d.card,
                   collection: d.collection };
        }""")
        check(home["carried"] == [offered[0]],
              "WHAT SHE SPOTTED IS WHAT HE BRINGS HOME", home["carried"])
        check(home["card"] and any("spotted" in ln for ln in home["card"]),
              "and the card says so — the one place the difference is said out loud",
              home["card"])
        ctx.close()

        # ---- E : KINDNESS. She tapped nothing. ----------------------------
        ctx, pg = fresh()
        pg.evaluate(ONTO_ROAD)
        kind = pg.evaluate("""() => {
          const pp = window.__pp;
          const offered = pp.dbg().walk.stroll.items.map((i) => i.id);
          pp.strollThrough();                       // watched it all, touched nothing
          const picked = pp.app.game.walkPicked;
          pp.loop.scene.walk.bringHome();
          pp.step(1/60, 8);
          const d = pp.dbg().walk;
          return { offered, picked, carried: d.carried, card: d.card, away: d.away };
        }""")
        check(kind["picked"] == [],
              "control: she really did tap nothing", kind["picked"])
        check(len(kind["carried"]) >= 1,
              "HE STILL BRINGS SOMETHING HOME — losing must never feel like rebuke",
              kind["carried"])
        check(kind["card"] and not any("spotted" in ln for ln in kind["card"]),
              "and the card does not claim she spotted it", kind["card"])
        ctx.close()

        # ---- B : it is INSIDE the walk ------------------------------------
        ctx, pg = fresh()
        clock = pg.evaluate("""() => {
          const pp = window.__pp;
          pp.setOff();
          const a0 = pp.app.game.walkActive;
          const at0 = { dur: a0.dur, startedAt: a0.startedAt };
          let g = 0;
          while (g++ < 400 && pp.dbg().walk.leaving) pp.step(1/60, 1);
          const onRoad = pp.dbg().walk.stroll;
          pp.strollThrough();
          const a1 = pp.app.game.walkActive;
          const wp = pp.app.game.walkProgress();
          return {
            at0, at1: a1 ? { dur: a1.dur, startedAt: a1.startedAt } : null,
            strollDur: onRoad.dur, walkDur: at0.dur,
            progress: wp.progress, done: wp.done,
          };
        }""")
        check(clock["at1"] and clock["at0"]["dur"] == clock["at1"]["dur"]
              and clock["at0"]["startedAt"] == clock["at1"]["startedAt"],
              "WATCHING ADDS NOTHING TO THE WALK — same duration, same start",
              [clock["at0"], clock["at1"]])
        check(clock["strollDur"] <= clock["walkDur"] * 0.34 + 0.001,
              "and it is never more than a third of the walk it begins",
              "%.1fs of %.1fs" % (clock["strollDur"], clock["walkDur"]))
        check(not clock["done"] and clock["progress"] < 1,
              "he is still out when the road ends — the absence is still the point",
              "progress %.3f" % clock["progress"])
        ctx.close()

        # ---- H1 : the way out, as a real tap ------------------------------
        ctx, pg = fresh()
        pg.evaluate(ONTO_ROAD)
        left = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene;
          const B = pp.BALANCE.ui.map.back;
          const send = (type) => sc.pointer(pp.app, {
            type, x: B.x, y: B.y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
          const on = pp.dbg().walk.stroll.on;
          send('down'); send('up');
          pp.step(1/60, 40);
          const d = pp.dbg().walk;
          return { on, off: !d.stroll.on, away: d.away,
                   active: !!pp.app.game.walkActive };
        }""")
        check(left["on"] and left["off"] and left["away"] and left["active"],
              "the way out ends the ROAD and not the WALK — he is simply out", left)
        ctx.close()

        # ---- H2 : leaving the scene mid-stroll ----------------------------
        ctx, pg = fresh()
        pg.evaluate(ONTO_ROAD)
        pg.evaluate("() => __pp.strollTap(0)")
        keptBefore = pg.evaluate("() => __pp.app.game.walkPicked")
        pg.evaluate("() => __pp.app.nav.go('room', { switched: true })")
        pg.wait_for_function("() => window.__pp.loop.scene.rig")
        pg.evaluate("() => __pp.step(1/60, 30)")
        bail = pg.evaluate("""() => {
          const d = __pp.dbg().walk;
          return { away: d.away, on: d.stroll.on, hides: __pp.loop.scene.walk.hidesDog,
                   picked: __pp.app.game.walkPicked };
        }""")
        check(len(keptBefore) == 1, "control: she had tapped something first", keptBefore)
        check(bail["away"] and not bail["on"] and bail["hides"],
              "leaving the screen mid-stroll means he is simply out", bail)
        check(bail["picked"] == keptBefore,
              "...and what she had already tapped is not lost with the layer", bail)
        ctx.close()

        # ---- H3 : the walk finishes UNDERNEATH the stroll ------------------
        ctx, pg = fresh()
        pg.evaluate(ONTO_ROAD)
        over = pg.evaluate("""() => {
          const pp = window.__pp;
          const on = pp.dbg().walk.stroll.on;
          /* the whole walk elapses while she is still watching the first minute
             of it — the case that proves the road never holds the return up */
          pp.fakeWalkAway(30);
          pp.step(1/60, 10);
          const d = pp.dbg().walk;
          return { on, off: !d.stroll.on, ended: d.stroll.ended, beat: d.beat };
        }""")
        check(over["on"] and over["off"] and over["ended"] == "walk-over",
              "a walk that finishes under the road ends the road, not the other way round",
              over)
        check(over["beat"] in ("home", "away"),
              "and the return takes over immediately", over["beat"])
        ctx.close()

        # ---- THE FOUR MOMENTS, IN A CONTEXT OF THEIR OWN ------------------
        # Taken last and in a fresh session ON PURPOSE: a screenshot pass that
        # tapped a find would change the picks every assertion above is about,
        # so `--shots` must not be able to move a single result.
        #
        # It is a gate's job to take them at all because the first render of this
        # beat was a DOG FILLING THE FRAME with no road left to walk along and
        # every find hidden behind him — and there is no number in the debug
        # block that says that. The composition is checked by looking, so the
        # looking is made cheap.
        if shots:
            SHOTS.mkdir(exist_ok=True)
            ctx, pg = fresh()
            pg.evaluate(ONTO_ROAD)
            pg.evaluate("() => __pp.step(1/60, 60)")
            pg.screenshot(path=str(SHOTS / "stroll-road.png"))
            # a find well up the road, coming
            pg.evaluate("""() => {
              const pp = window.__pp;
              let g = 0;
              while (g++ < 3600) {
                const it = pp.dbg().walk.stroll.items[1];
                if (!it || it.x > 30) break;
                pp.step(1/60, 1);
              }
            }""")
            pg.screenshot(path=str(SHOTS / "stroll-find.png"))
            # ...and level with him, which is the middle of the tap window
            pg.evaluate("""() => {
              const pp = window.__pp, S = pp.BALANCE.walk.stroll;
              let g = 0;
              while (g++ < 3600) {
                const it = pp.dbg().walk.stroll.items[1];
                if (!it || it.x >= S.at) break;
                pp.step(1/60, 1);
              }
            }""")
            pg.screenshot(path=str(SHOTS / "stroll-reach.png"))
            pg.evaluate("() => __pp.strollTap(1)")
            pg.evaluate("() => __pp.step(1/60, 7)")
            pg.screenshot(path=str(SHOTS / "stroll-taken.png"))
            ctx.close()

        # ---- SHE CAN SEE THE FIND HE IS STANDING IN FRONT OF -------------
        #
        # docs/STROLL-PLAN.md §5: a find passes at his own x, the reach line will
        # not let a tap target sit below 676 while his feet are at ~696, so
        # nothing can pass in FRONT of him and he covers it for ~2.2s of the ~5s
        # it is on screen — at its closest approach, which is exactly when she is
        # deciding. `dog/stroll.js` now redraws it over him, faintly.
        #
        # ASSERTED ON PIXELS, AND AGAINST ITSELF. Config cannot show that
        # anything reached the screen, so this walks a find to his x, reads the
        # canvas around it, then sets `ghostAlpha` to 0 and reads the same box
        # again. The difference IS the ghost — which makes the check its own
        # fault injection: if the pass stops drawing, the two reads become equal
        # and this fails.
        ctx, pg = fresh()
        pg.evaluate(ONTO_ROAD)
        ghost = pg.evaluate("""() => {
          const pp = window.__pp, S = pp.BALANCE.walk.stroll;
          /* walk whichever find comes closest to him up to his x */
          let g = 0, it = null;
          while (g++ < 3600) {
            const live = pp.dbg().walk.stroll.items.filter((i) => !i.taken);
            it = live.map((i) => [Math.abs(i.x - S.at), i])
                     .sort((a, b) => a[0] - b[0])[0];
            if (it && it[0] < 4) { it = it[1]; break; }
            it = null;
            pp.step(1/60, 1);
          }
          if (!it) return { err: 'no find reached him' };
          const cv = document.querySelector('canvas');
          const c = cv.getContext('2d');
          const dpr = cv.width / pp.BALANCE.view.W;
          const box = () => {
            const w = Math.round(70 * dpr), h = Math.round(70 * dpr);
            const x = Math.round((it.x - 35) * dpr), y = Math.round((it.y - 35) * dpr);
            return Array.from(c.getImageData(x, y, w, h).data);
          };
          const withGhost = box();
          const keep = S.ghostAlpha;
          S.ghostAlpha = 0;
          pp.step(1/60, 1);
          const without = box();
          S.ghostAlpha = keep;
          pp.step(1/60, 1);
          let diff = 0;
          for (let i = 0; i < withGhost.length; i += 4) {
            if (Math.abs(withGhost[i] - without[i])
              + Math.abs(withGhost[i+1] - without[i+1])
              + Math.abs(withGhost[i+2] - without[i+2]) > 8) diff++;
          }
          return { x: it.x, y: it.y, id: it.id, diff, px: withGhost.length / 4 };
        }""")
        check(not ghost.get("err"), "a find really does reach his own x", ghost)
        if not ghost.get("err"):
            check(ghost["diff"] > 120,
                  "the find he is standing in front of is still drawn over him "
                  "— and turning the ghost off removes it, which is the control",
                  "%s pixels changed of %s in the box, find '%s' at x %s"
                  % (ghost["diff"], ghost["px"], ghost["id"], ghost["x"]))
        ctx.close()

        check(not errors, "no page errors", errors[:4])
        b.close()

    for line in notes:
        print(line)
    for line in fails:
        print(line)
    print("\n%d passed, %d failed" % (len(notes), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
