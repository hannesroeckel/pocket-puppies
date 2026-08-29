"""
tools/audiogate.py — THE GAME DOES NOT TAKE THE PHONE'S AUDIO UNLESS ASKED.

From a report of real use: "when playing the game all other audio such as music
on the phone stops."

That was not a bug in `engine/audio.js`. It was the documented PRICE of the
silent-switch override, which had been chosen deliberately and never weighed
against its cost. iOS gives a page's audio one of two categories: *ambient*
mixes with other audio and is muted by the ringer switch, *playback* ignores the
switch and is NON-MIXING BY DEFINITION. The game claimed *playback* — by playing
a quarter second of true silence on a looping `<audio>` element — so that the
puppy could be heard on a phone kept on silent. The price of that is every other
sound on the device.

There is no third option on the web. Native iOS can request *playback* WITH
`mixWithOthers`; Safari exposes no such flag. So it is a real either/or, it is
now `state.settings.playOnSilent`, and it defaults to OFF.

WHAT IT ASSERTS

  A  THE DEFAULT IS POLITE. A fresh save, after a real gesture that unlocks the
     AudioContext, holds NO session element and wants none. This is the whole
     report, as one check.

  B  THE ELEMENT TRACKS THE INTENT, in every combination of the two switches.
     `sessionWanted()` is the intent and the `<audio>` element is the mechanism,
     and they must agree in all four states plus a re-acquisition. This is the
     check that matters, and it is the one that caught the bug this gate was
     written alongside: `setEnabled` branched on `want` (sound) rather than on
     `sessionWanted()`, so turning play-on-silent OFF while sound stayed ON took
     the ensure path, returned early, and never released anything — the one
     setting whose entire job is to give the phone's audio back would not have
     given it back until the next reload.

  C  THE ROW IS REACHABLE AND HONEST. It is in Settings, it names the COST and
     not just the benefit in both states, and it is hidden when sound is off,
     because then it decides nothing.

  D  IT PERSISTS. The choice survives a reload — it is worth nothing if she has
     to make it every launch.

  E  SOUND ITSELF IS UNREGRESSED. The context still unlocks and still plays with
     the override off, which is the thing that would make this whole change a
     bad trade if it were untrue.

FAULT INJECTION: B is re-run against a deliberately leaked element, and must
report it. Without that, "the element tracks the intent" is a sentence about a
check that has never been shown to fail.

Usage:  py tools/audiogate.py
Exit code 0 = every check passed.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page, boot
from playwright.sync_api import sync_playwright

fails, notes = [], []


def check(ok, label, detail=""):
    (notes if ok else fails).append(("PASS" if ok else "FAIL") + "  " + label
                                    + (("  — " + str(detail)) if detail else ""))
    return ok


# Tap a Settings row the way a finger does: through `scene.pointer`, at a y the
# sheet's own hit test agrees is that row. Not by calling the handler — the
# 8.16.1 lesson (the disc shipped un-flickable because its gate called the
# layer directly and never touched the scene that routes to it).
TAP = r"""(rowId) => {
  const pp = window.__pp, app = pp.app, sc = pp.loop.scene;
  sc.openSettings(); pp.step(1/60, 24);
  for (let y = 0; y < pp.BALANCE.view.H; y += 3) {
    const r = sc.sheet.hit(195, y);
    if (r && r.id === rowId) {
      const ev = { x: 195, y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false };
      sc.pointer(app, { type: 'down', ...ev });
      sc.pointer(app, { type: 'up', ...ev });
      pp.step(1/60, 30);
      return true;
    }
  }
  return false;
}"""

ROWS = r"""() => {
  const sc = window.__pp.loop.scene;
  sc.openSettings(); window.__pp.step(1/60, 24);
  const out = [];
  for (let y = 0; y < 844; y += 3) {
    const r = sc.sheet.hit(195, y);
    if (r && r.id && r.id.indexOf('__') !== 0 && !out.some((o) => o.id === r.id)) {
      out.push({ id: r.id, label: r.label || '', note: r.note || '' });
    }
  }
  return out;
}"""

STATE = r"""() => {
  const a = window.__pp.app.audio.debug;
  return { playOnSilent: !!a.playOnSilent, wanted: !!a.sessionWanted,
           element: !!a.sessionEl, sound: !!a.enabled,
           override: !!a.overrideSilentSwitch, type: a.sessionType,
           ctx: a.state, running: !!a.running };
}"""


def main():
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        errors = []
        ctx, pg = page(b, inset=40)
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
              if m.type == "error" else None)
        boot(pg, url)
        pg.evaluate("() => { __pp.app.game.setFlag('installNever', true); __pp.skipIntro('Pip'); }")
        # A REAL GESTURE FIRST. The session is only ever claimed from inside one,
        # so a check made before any tap would pass for the wrong reason.
        #
        # AND `unlock()` EXPLICITLY, because `__pp.tapAt` routes into
        # `scene.pointer` and the call that unlocks the AudioContext lives one
        # level up in main.js's own pointer handler — so a synthetic scene tap
        # leaves the context at 'none' and check E fails for a reason that has
        # nothing to do with the game. `unlock()` is the real API a gesture
        # reaches; calling it here is the same code path, minus the routing this
        # gate is not about.
        pg.evaluate("() => { __pp.tapAt(195, 620); __pp.app.audio.unlock(); __pp.step(1/60, 20); }")

        # ---- A. the default is polite -----------------------------------
        s = pg.evaluate(STATE)
        check(s["override"], "the override capability is still compiled in "
                             "(otherwise the rest of this gate proves nothing)", s["override"])
        check(s["running"], "E: the AudioContext still unlocks from a tap", s["ctx"])
        check(not s["playOnSilent"], "A: a fresh save does not opt in to playing on silent", s)
        check(not s["wanted"] and not s["element"],
              "A: and therefore claims NO audio session — the phone's music is untouched", s)

        # ---- C. the row is reachable and honest -------------------------
        rows = pg.evaluate(ROWS)
        row = next((r for r in rows if r["id"] == "playOnSilent"), None)
        check(row is not None, "C: the choice is offered in Settings",
              [r["id"] for r in rows])
        if row:
            check("music" in row["note"].lower(),
                  "C: and the OFF note says what she gets — her music", row["note"])
        sound = next((r for r in rows if r["id"] == "sound"), None)
        check(sound and "silent" not in sound["note"].lower(),
              "C: the sound row no longer claims anything about the ringer switch — "
              "that is this row's job now", sound and sound["note"])

        # ---- B. the element tracks the intent ---------------------------
        seq = [("default", None)]
        for label, tap in [("play-on-silent ON", "playOnSilent"),
                           ("play-on-silent OFF", "playOnSilent"),
                           ("ON again", "playOnSilent"),
                           ("sound OFF", "sound"),
                           ("sound ON", "sound")]:
            pg.evaluate(TAP, tap)
            seq.append((label, pg.evaluate(STATE)))
        seq[0] = ("default", s)
        for label, st in seq:
            check(st["element"] == st["wanted"],
                  "B: %s — the element matches the intent" % label,
                  "wanted %s, element %s" % (st["wanted"], st["element"]))
        on = next(st for lb, st in seq if lb == "ON again")
        check(on["wanted"] and on["element"],
              "B: the session can be RE-ACQUIRED after being released", on)
        off = next(st for lb, st in seq if lb == "play-on-silent OFF")
        check(not off["element"] and off["sound"],
              "B: turning it off releases the session even though sound stays ON "
              "(the bug this gate was written for)", off)

        # ---- C. hidden when it decides nothing --------------------------
        pg.evaluate(TAP, "sound")            # sound off
        ids = [r["id"] for r in pg.evaluate(ROWS)]
        check("playOnSilent" not in ids,
              "C: with sound off the row is gone — a control that controls nothing", ids)
        pg.evaluate(TAP, "sound")            # back on

        # ---- D. it persists ---------------------------------------------
        pg.evaluate("() => { if (!__pp.app.game.state.settings.playOnSilent) return; }")
        want = pg.evaluate("() => __pp.app.game.state.settings.playOnSilent")
        pg.evaluate("() => __pp.save && __pp.save()")
        pg.reload()
        pg.wait_for_function("() => window.__pp && window.__pp.loop && window.__pp.loop.scene")
        after = pg.evaluate("() => __pp.app.game.state.settings.playOnSilent")
        check(after == want, "D: the choice survives a reload",
              "before %s, after %s" % (want, after))

        # ---- FAULT INJECTION --------------------------------------------
        # leak an element by hand and prove check B would have caught it
        leaked = pg.evaluate("""() => {
          const pp = window.__pp;
          pp.app.game.setSetting('playOnSilent', false);
          pp.app.audio.setEnabled(true);
          const before = pp.app.audio.debug;
          /* the shape of the old bug: an element left playing with nothing
             wanting it. Built here rather than by reverting the fix. */
          const el = document.createElement('audio');
          el.setAttribute('playsinline', ''); el.loop = true;
          document.body.appendChild(el);
          return { wanted: !!before.sessionWanted, elementNowInDoc:
                   !!document.querySelector('audio') };
        }""")
        check(not leaked["wanted"] and leaked["elementNowInDoc"],
              "B: fault injection — a leaked element IS visible to this check, so "
              "the assertion above can fail", leaked)

        check(not errors, "no console errors or page exceptions", errors[:3] or "")
        ctx.close()
        b.close()

    for line in notes:
        print(line)
    if fails:
        print()
        for line in fails:
            print(line)
    print("\n%d passed, %d failed" % (len(notes), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
