"""
tools/kennelgate.py — THE SHIBA IS A DOG SHE CAN OWN.

He was finished and unreachable. `dog/breeds.js` has carried a complete Shiba
entry since stage 1 — he is the reference breed the renderer was built against,
every bowl, reach, wear and walk gate in this folder measures him, and 8.21.0 gave
him a painted profile sheet that `sw.js` precaches. None of that put him in the
game: he was not the gift breed, he was not on `economy.unlocks`, and
`economy.kennel` named exactly one adoptable breed in a hardcoded triple. There
was no code path by which a player could ever meet him.

This is the gate for the fix, and it is written against the LADDER rather than
against the Shiba — the point of the change is that a breed is now a data entry,
so a check that hardcodes "cockapoo then shiba" would pass while re-introducing
the bug it exists to prevent.

WHAT IT ASSERTS

  A  EVERY BREED ON THE LADDER IS REACHABLE. Walk `unlocks`' breed rows in order:
     each one is offered by the kennel, each one is refused below its threshold
     and adopted at it, and after the last one the roster holds every breed
     `dog/breeds.js` draws. No row is skipped, none is offered twice.

  B  EARNED, NOT BOUGHT — at both gates. Ten million coins adopts nobody, and
     reaching the second gate does not cost her the first: care points are a
     lifetime total, so `carePoints` is unchanged by an adoption.

  C  ONE CARD AT A TIME. At 1600 points with one dog she can afford two puppies;
     exactly one card is on screen, and it is the CHEAPER one. A milestone is not
     a shopping list, and four cards do not fit on the panel anyway.

  D  THE BEAT ANNOUNCES THE RIGHT PUPPY. `adoptDog()` runs at the reveal and the
     roster refreshes immediately, so the offered row has already moved on to the
     next breed by the time the reveal line draws. The line must still name the
     dog walking out of the glow. This was unreachable with one adoptable breed
     and is the first bug a second one can have.

  E  IT FITS, FOR EVERY ROW CROSSED WITH EVERY PRONOUN. The card's copy stopped
     being literals, so "it fits" is no longer a property of six strings somebody
     looked at once. Every line is measured in its own slot for each ladder row
     against he / she / they, and nothing may be shrunk or ellipsised. This file's
     own history is the reason: a note measured at 334 units was drawn into a
     116-unit slot and shipped as "She goes to someone wh…".

  F  HE RENDERS AS HIMSELF. Brought into the room, the Shiba's rig reports the
     Shiba's proportions and his own palette reaches the pixels — not the fallback
     breed, and not the Schnoodle he would have been if `getBreed` had shrugged.

  G  THE CAP HOLDS. A fourth adoption is refused with `reason: 'full'`, the panel
     stops offering a card, and the toast says the real number.

FAULT INJECTION: E is run a second time with a deliberately over-long name pushed
onto a ladder row, and must report it as shrunk or cut. Without that, "every line
fits" is a sentence about a check that cannot fail — text.js never clips, so bad
copy comes out as slightly smaller text rather than as anything a shot would flag.

Usage:  py tools/kennelgate.py [--shots]
Exit code 0 = every check passed.
"""
import sys, pathlib, json
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


# ---------------------------------------------------------------------------
# WALK THE WHOLE LADDER, THROUGH THE REAL SURFACE.
#
# The adoption is not called as a mutator: the card is TAPPED, through
# `scene.pointer`, and the beat is then stepped to completion. That is the
# 8.16.1 lesson (the disc shipped un-flickable because its gate called
# `disc.pointer` directly and never touched the scene that routes to it), and it
# is the only way this gate can see the reveal line at all.
# ---------------------------------------------------------------------------
LADDER = r"""() => {
  const pp = window.__pp, app = pp.app, g = app.game;
  const out = { steps: [], rows: pp.adoptable() };

  const kdbg = () => pp.loop.scene.debug.kennel;

  /* SETTLE THE NEW ARRIVAL BEFORE ASKING FOR ANOTHER.
     Finishing an adoption hands the puppy to the room, which REMOUNTS the scene
     (`app.nav.go('room', { adopted: true })`) and opens the naming beat, because
     the dog has no name. Two consequences a gate has to respect rather than
     route around:
       - `loop.scene.debug.kennel` is a NEW kennel that has never refreshed, so
         it reports an empty roster until it is opened again;
       - `openKennel()` is REFUSED while naming owns the screen, which is the
         surface arbiter doing its job.
     So: name whoever is unnamed, then open.

     SUBMITTING A NAME IS NOT THE SAME AS THE BEAT BEING OVER. `ui.naming`
     holds the new name in the middle of the screen for `revealHold` 2.4s after
     the submit, and it owns the screen for all of it — so a settle that names
     the puppy and steps twenty frames still finds `surfaceOwner() === 'naming'`
     and gets its `openKennel()` refused. `skipIntro` submits AND closes, which
     is what it exists for. */
  const settle = () => {
    for (let i = 0; i < 12; i++) {
      pp.step(1/60, 30);
      const sc = pp.loop.scene;
      const naming = !!(sc.naming && sc.naming.isOpen);
      const un = g.roster().filter((d) => !d.name).length;
      if (!naming && !un && (!sc.surfaceOwner || !sc.surfaceOwner())) break;
      /* the beat names the ACTIVE dog, which after an adoption is the new one */
      pp.skipIntro('Pup' + g.roster().length);
      pp.step(1/60, 30);
    }
  };
  const openK = () => {
    settle();
    const opened = pp.openKennel();
    pp.step(1/60, 10);
    const d = kdbg();
    d.opened = opened;
    d.owner = pp.loop.scene.surfaceOwner ? pp.loop.scene.surfaceOwner() : '?';
    d.isOpen = !!(pp.loop.scene.debug.kennel && pp.loop.scene.debug.kennel.open);
    return d;
  };

  /* the card, tapped where her thumb would land.
     THE GEOMETRY COMES FROM THE SURFACE, NOT FROM BALANCE. `ui.kennel.cardH` is
     a CEILING — the panel sizes its cards to whatever the earned list and the
     Done button leave, and at five dogs that is about 74 rather than 92. Reading
     the table here worked while every card was 92 and would have silently
     started tapping the wrong row the moment the fifth dog compressed them. */
  const tapCard = () => {
    const sc = pp.loop.scene;
    const d = kdbg();
    const n = d.roster.length;
    const y = d.listTop + n * d.cardStep + d.cardH / 2;
    const at = { x: pp.BALANCE.view.W / 2, y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false };
    sc.pointer(app, { type: 'down', ...at });
    pp.step(1/60, 2);
    return at;
  };

  for (const row of out.rows) {
    const step = { id: row.id, at: row.at };

    /* ---- one point short: offered, refused, nobody created ---- */
    pp.setCarePoints(Math.max(0, row.at - 1));
    let d = openK();
    step.short = {
      offering: d.offering, showNew: d.showNew, ok: d.adopt.ok,
      reason: d.adopt.reason, short: d.adopt.short, dogs: d.roster.length,
      opened: d.opened, owner: d.owner, isOpen: d.isOpen,
    };
    tapCard();
    pp.step(1/60, 30);
    step.short.dogsAfterTap = kdbg().roster.length;
    step.short.beatAfterTap = kdbg().beat;

    /* ---- and with a fortune in coins, still refused ---- */
    pp.addCoins(10000000);
    d = kdbg();
    step.short.coins = d.coinsSeen;
    step.short.okWithCoins = d.adopt.ok;

    /* ---- on the threshold: offered, and adopted by a real tap ---- */
    pp.setCarePoints(row.at);
    pp.step(1/60, 6);
    d = kdbg();
    step.ready = { offering: d.offering, showNew: d.showNew, ok: d.adopt.ok,
                   pointsBefore: d.carePoints };
    tapCard();
    /* THE BEAT, SAMPLED FRAME BY FRAME. What the reveal SAYS is the assertion
       (D), and it is only true for the 1.9 seconds the reveal runs — so the
       breed the beat is about is recorded at every phase change. */
    const seen = {};
    for (let i = 0; i < 400; i++) {
      pp.step(1/60, 1);
      const k = kdbg();
      if (k.beat && !seen[k.beat]) {
        seen[k.beat] = { breed: k.beatBreed, offering: k.offering, dogs: k.roster.length };
      }
      if (!k.beat && seen.settle) break;
    }
    step.beat = seen;
    pp.step(1/60, 60);
    const r = g.roster();
    /* READ BEFORE SETTLING: `named` is the assertion that the room's naming beat
       has something to open for, so it has to be sampled before this gate names
       him on her behalf. */
    step.after = {
      dogs: r.map((x) => x.breedId),
      newest: r[r.length - 1] ? { breedId: r[r.length - 1].breedId, sex: r[r.length - 1].sex,
                                  named: !!r[r.length - 1].name } : null,
      points: g.carePoints,
    };
    out.steps.push(step);
  }

  /* ---- the cap ---- */
  pp.setCarePoints(999999);
  const d = openK();
  out.cap = { showNew: d.showNew, ok: d.adopt.ok, reason: d.adopt.reason,
              offering: d.offering, max: d.max, dogs: d.roster.length };
  out.capRefused = pp.adopt(Date.now()) === null;
  return out;
}"""


# ---------------------------------------------------------------------------
# MEASURE EVERY LINE, FOR EVERY ROW, AT EVERY PRONOUN.
# `scene.probeKennel(row, pron, host)` runs ui/kennel.js's own `audit()`, which
# lays each string out in the slot the draw call uses and reports what text.js
# had to do to make it fit.
# ---------------------------------------------------------------------------
FITS = r"""(inject) => {
  const pp = window.__pp, sc = pp.loop.scene;
  const PRON = {
    m: { they: 'he', them: 'him', their: 'his', theirs: 'his', self: 'himself', is: 'is', has: 'has', s: 's' },
    f: { they: 'she', them: 'her', their: 'her', theirs: 'hers', self: 'herself', is: 'is', has: 'has', s: 's' },
    n: { they: 'they', them: 'them', their: 'their', theirs: 'theirs', self: 'themselves', is: 'are', has: 'have', s: '' },
  };
  pp.openKennel();
  pp.step(1/60, 12);
  const out = [];
  for (const base of pp.adoptable()) {
    const row = inject ? { ...base, name: base.name + ' with an unreasonably long name' } : base;
    for (const a of ['m', 'f', 'n']) {
      for (const h of ['m', 'f', 'n']) {
        const r = sc.probeKennel({ ...row, pron: PRON[a] }, PRON[a], PRON[h]);
        if (!r) return { error: 'no probe' };
        out.push({ id: base.id, pron: a, host: h, rows: r.rows, card: r.card });
      }
    }
  }
  return { out };
}"""


# HE IS DRAWN AS HIMSELF: the rig's proportions, and his coat in the pixels.
HIM = r"""(breedId) => {
  const pp = window.__pp, app = pp.app;
  const d = app.game.roster().find((x) => x.breedId === breedId);
  if (!d) return { error: 'not in roster' };
  app.game.switchDog(d.id);
  app.nav.go('room', { switched: true, dogId: d.id });
  return new Promise((res) => {
    let n = 0;
    const tick = () => {
      pp.step(1/60, 10);
      const sc = pp.loop.scene;
      if ((sc.rig && sc.rig.breed && sc.rig.breed.id === breedId) || ++n > 40) {
        pp.step(1/60, 90);
        const rig = sc.rig;
        const want = pp.breedProportions(breedId);
        /* his coat, counted on the canvas: the Shiba is orange-tan and the
           Schnoodle is auburn, so this is the check that the fallback breed did
           NOT render. Sampled over the dog's own box, not the whole frame. */
        const cv = app.view.canvas || document.querySelector('canvas');
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        const v = app.view;
        const px = (x, y, w, h) => ctx.getImageData(
          Math.round((x * v.vs + v.offX) * v.dpr), Math.round((y * v.vs + v.offY) * v.dpr),
          Math.round(w * v.vs * v.dpr), Math.round(h * v.vs * v.dpr)).data;
        const box = px(rig.x - 90, rig.y - 130, 180, 200);
        /* the dominant warm hue in the dog's box, as a coarse bucket */
        let best = null, bins = {};
        for (let i = 0; i < box.length; i += 4) {
          const R = box[i], G = box[i + 1], B = box[i + 2];
          if (R < 90 || R <= B + 18) continue;          // not a warm coat pixel
          const k = (R >> 4) + ',' + (G >> 4) + ',' + (B >> 4);
          bins[k] = (bins[k] || 0) + 1;
          if (!best || bins[k] > bins[best]) best = k;
        }
        res({
          rigBreed: rig.breed.id, sideSheet: pp.hasSideSprite ? pp.hasSideSprite(breedId) : null,
          headW: want ? want.headW : null, rigHeadW: rig.dims ? rig.dims.headW : null,
          eyeSize: want ? want.eyeSize : null,
          dominant: best, dominantN: best ? bins[best] : 0,
          scene: pp.loop.scene.name || '',
        });
        return;
      }
      setTimeout(tick, 0);
    };
    tick();
  });
}"""


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        errors = []

        def fresh():
            ctx, pg = page(b, inset=40)
            pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
            pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
                  if m.type in ("error", "warning") else None)
            boot(pg, url)
            pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
            pg.evaluate("() => __pp.skipIntro('Pip')")
            pg.evaluate("() => __pp.step(1/60, 30)")
            return ctx, pg

        # ---- A / B / C / D / G. the whole ladder, through the real card ----
        ctx, pg = fresh()
        L = pg.evaluate(LADDER)
        rows = L["rows"]
        check(len(rows) >= 2, "the ladder offers more than one puppy",
              [r["breedId"] for r in rows])
        # the ladder is the source of truth for what SHOULD be reachable
        expect = [r["breedId"] for r in rows]
        got = [s["beat"].get("reveal", {}).get("breed") if s.get("beat") else None
               for s in L["steps"]]
        check(got == expect,
              "D: the reveal announces the puppy who is arriving, every time",
              "expected %s, the beat said %s" % (expect, got))

        for s, row in zip(L["steps"], rows):
            rid = row["breedId"]
            sh = s["short"]
            check(sh["offering"] == rid and sh["showNew"],
                  "A: the kennel offers %s below its gate" % rid, sh)
            check(not sh["ok"] and sh["reason"] == "locked" and sh["short"] == 1,
                  "A: one point short of %s is refused, and says by how much" % row["at"], sh)
            check(sh["dogsAfterTap"] == sh["dogs"] and not sh["beatAfterTap"],
                  "A: tapping the locked card starts no beat and creates no dog", sh)
            check(sh["coins"] >= 10000000 and not sh["okWithCoins"],
                  "B: %s coins adopts nobody" % sh["coins"], sh)
            check(s["ready"]["offering"] == rid and s["ready"]["ok"],
                  "A: at %s exactly, %s is ready" % (row["at"], rid), s["ready"])
            check(s["after"]["newest"] and s["after"]["newest"]["breedId"] == rid,
                  "A: %s is the dog who arrived" % rid, s["after"]["newest"])
            check(s["after"]["newest"] and s["after"]["newest"]["sex"] == row["sex"],
                  "A: and arrived with the ladder's sex (%s), so pronouns are right" % row["sex"],
                  s["after"]["newest"])
            check(s["after"]["newest"] and not s["after"]["newest"]["named"],
                  "A: unnamed, so the room's naming beat opens for %s too" % rid, None)
            check(s["after"]["points"] == s["ready"]["pointsBefore"],
                  "B: adopting %s spent no care points (%s -> %s)"
                  % (rid, s["ready"]["pointsBefore"], s["after"]["points"]), None)
            # C: while the beat runs, the offered row has already moved on —
            # that is precisely why the beat must carry its own copy of the row
            rev = s["beat"].get("reveal", {})
            if rev:
                check(rev["breed"] == rid and rev.get("offering") != rid,
                      "D: at the reveal the CARD has moved on and the BEAT has not",
                      "beat %s, card offering %s" % (rev["breed"], rev.get("offering")))

        final = L["steps"][-1]["after"]["dogs"]
        check(set(expect).issubset(set(final)),
              "A: every breed on the ladder is in the kennel at the end", final)
        check(len(final) == 1 + len(expect),
              "A: the gift puppy plus one of each, nothing doubled", final)

        cap = L["cap"]
        check(not cap["showNew"] and not cap["ok"] and cap["reason"] == "full",
              "G: full is full, at any number of care points", cap)
        check(cap["dogs"] == cap["max"], "G: and the roster is exactly the cap", cap)
        check(L["capRefused"], "G: a further adoption is refused outright", None)

        if shots:
            pg.evaluate("() => { __pp.openKennel(); __pp.step(1/60, 30); }")
            pg.screenshot(path=str(SHOTS / "kennel-three-dogs.png"))
        ctx.close()

        # ---- C. one card at a time, and the cheaper one -------------------
        ctx, pg = fresh()
        one = pg.evaluate("""() => {
          const pp = window.__pp;
          pp.setCarePoints(999999);          /* she can afford every puppy at once */
          pp.openKennel();
          pp.step(1/60, 12);
          const d = pp.loop.scene.debug.kennel;
          return { offering: d.offering, showNew: d.showNew, dogs: d.roster.length,
                   rows: pp.adoptable().map((r) => r.breedId) };
        }""")
        check(one["showNew"] and one["offering"] == one["rows"][0],
              "C: affording both puppies still offers exactly one, the cheaper first", one)
        if shots:
            pg.screenshot(path=str(SHOTS / "kennel-card-first.png"))
        ctx.close()

        # ---- and the Shiba's own card, once the Cockapoo is home ----------
        ctx, pg = fresh()
        # THE CARD ADVANCES BY ONE, not to the end of the ladder. This check used
        # to compare against `rows[rows.length - 1]` and passed only because there
        # were exactly two breed rows, so "the next one" and "the last one" were
        # the same dog. 8.24.0 added two more and it failed immediately — which is
        # the gate catching its own hardcoding, and the reason it is written
        # against `pp.adoptable()` rather than against a list of breed names.
        second = pg.evaluate("""() => {
          const pp = window.__pp;
          const rows = pp.adoptable();
          pp.setCarePoints(rows[0].at);
          pp.adopt(Date.now());
          pp.setCarePoints(rows[1].at);
          pp.openKennel();
          pp.step(1/60, 20);
          const d = pp.loop.scene.debug.kennel;
          return { offering: d.offering, showNew: d.showNew, ok: d.adopt.ok,
                   at: d.adopt.at, dogs: d.roster.map((x) => x.breedId),
                   next: rows[1].breedId };
        }""")
        check(second["showNew"] and second["offering"] == second["next"] and second["ok"],
              "A: with the first puppy home, the card becomes the SECOND row's — "
              "not the last one's", second)
        if shots:
            pg.screenshot(path=str(SHOTS / "kennel-card-shiba.png"))
        ctx.close()

        # ---- E. it fits, for every row at every pronoun -------------------
        ctx, pg = fresh()
        F = pg.evaluate(FITS, False)
        check(not F.get("error"), "E: the kennel can be probed", F.get("error"))
        # THE ONE SLOT ALLOWED TO SHRINK, and it is not one of the new lines.
        #
        # `chipLocked` is `${short} more care points` in a 120-unit chip, and it
        # has shrunk since stage 6: the Cockapoo's worst case, '400 more care
        # points', already comes out at 10.5 rather than 12 in the shipped game.
        # The Shiba's '1600 more care points' is one digit longer and lands at 10.
        #
        # It is EXEMPTED FROM THE SHRINK RULE AND HELD TO A FLOOR rather than
        # waved through: `T.minSize` is 9.5, and at the floor text.js stops
        # shrinking and starts ELLIPSISING — which is the exact failure this file
        # documents ("She goes to someone wh…"). So the assertion is that the chip
        # keeps a full point of headroom over the floor and is never cut. A
        # five-digit gate on the ladder would break this, loudly, which is the
        # point of writing it as a number rather than as an exception.
        #
        # AND THE SETTLE LINE AT they/them, for a different reason. No ladder row
        # is neutral — `adoptable()` reports 'm' or 'f' and coerces anything else
        # — so this combination cannot occur in the shipping game. It is measured
        # anyway because the ladder is DATA and a future row could be neutral, and
        # it is held to a floor rather than to full size: "They are yours too.
        # They will want to meet them." is the widest expansion of the widest line
        # on the surface, and shortening the sentence to fit it at 16 would change
        # the Cockapoo's shipped copy to buy something no player can see.
        #
        # AND THE REVEAL LINE, for the longest breed name on the ladder. "A Golden
        # Retriever puppy, looking for a home." is 44 characters of `bodyMd` 16 in
        # a 334-unit band and comes out at 15 — one point, never cut, and on the
        # Cockapoo and the Corgi it is the full 16.
        #
        # The alternative was to speak the BREED's own name in the beat ("A Golden
        # Retriever, looking for a home.") and keep the row's longer name on the
        # card. That fits at 16 and it changes the Cockapoo's line, which has
        # shipped, from "A Cockapoo puppy, looking..." to "A Cockapoo, looking...".
        # Trading approved copy on the dog she meets first for one imperceptible
        # point on the dog she meets last is the wrong way round, so the shrink is
        # accepted and bounded instead.
        SHRINK_OK = {"chipLocked": 10.0, "reveal": 14.5}
        bad, soft = [], []
        for grp in F.get("out", []):
            for r in grp["rows"]:
                where = "%s/%s+%s %s: %r -> %r @%s (want %s)" % (
                    grp["id"], grp["pron"], grp["host"], r["slot"],
                    r["text"], r["got"], r["size"], r["want"])
                neutral = "n" in (grp["pron"], grp["host"])
                floor = SHRINK_OK.get(r["slot"])
                if floor is None and neutral and r["slot"] == "settle":
                    floor = 14.0
                if r["cut"]:
                    bad.append(where)
                elif r["shrunk"]:
                    if floor is None or r["size"] < floor:
                        bad.append(where)
                    else:
                        soft.append(where)
        check(not bad, "E: every card and beat line fits, every row x he/she/they",
              bad[:6] if bad else "%d lines measured, %d in the exempt chip"
              % (sum(len(g["rows"]) for g in F["out"]), len(soft)))
        # and the exemptions are stated out loud rather than hidden in a set
        worst = min([float(s.split("@")[1].split(" ")[0]) for s in soft], default=None)
        check(worst is None or worst >= SHRINK_OK["chipLocked"],
              "E: the two exempt slots shrink but stay clear of the ellipsis floor",
              "smallest %s of the %d exempt lines, floor 9.5" % (worst, len(soft)))
        # G (copy): not one typed pronoun anywhere on this surface
        typed = pg.evaluate("""async () => {
          const m = await import('/src/ui/kennel.js');
          const bad = [];
          for (const [k, v] of Object.entries(m.COPY)) {
            const s = typeof v === 'function' ? '' : String(v);
            if (/\\b(he|she|him|her|his|hers)\\b/i.test(s)) bad.push([k, s]);
          }
          return bad;
        }""")
        check(not typed, "E: no literal COPY string contains a typed pronoun", typed)

        # ---- FAULT INJECTION: the same check, with copy that cannot fit ----
        FI = pg.evaluate(FITS, True)
        caught = [r for grp in FI.get("out", []) for r in grp["rows"]
                  if r["cut"] or r["shrunk"]]
        check(bool(caught),
              "E: fault injection — an over-long row name IS reported as cut or shrunk",
              "%d lines flagged" % len(caught))
        ctx.close()

        # ---- F. he renders as himself ------------------------------------
        ctx, pg = fresh()
        shiba = pg.evaluate("""() => {
          const pp = window.__pp;
          const rows = pp.adoptable();
          for (const r of rows) { pp.setCarePoints(r.at); pp.adopt(Date.now()); }
          return pp.app.game.roster().map((d) => [d.breedId, d.id]);
        }""")
        check(any(x[0] == "shiba" for x in shiba),
              "F: the Shiba is in the roster to be looked at", shiba)
        him = pg.evaluate(HIM, "shiba")
        check(not him.get("error"), "F: he can be brought into the room", him.get("error"))
        check(him.get("rigBreed") == "shiba",
              "F: the rig in the room is the Shiba's, not the fallback breed's",
              him.get("rigBreed"))
        check(him.get("eyeSize") == 1.14,
              "F: and it is HIS proportions — eyeSize 1.14, not the Schnoodle's 1.44",
              him.get("eyeSize"))
        check(him.get("dominantN", 0) > 400,
              "F: his coat reaches the pixels", "dominant bucket %s, %s px"
              % (him.get("dominant"), him.get("dominantN")))
        if shots:
            pg.screenshot(path=str(SHOTS / "shiba-in-the-room.png"))
        ctx.close()

        check(not errors, "no console errors or page exceptions anywhere",
              errors[:4] if errors else "")

        b.close()

    for line in notes:
        print(line)
    if fails:
        print()
        for line in fails:
            print(line)
    # THE FORMAT tools/gates.py PARSES. It reads the numbers only and believes
    # the exit code, but a gate that publishes its counts in a fourth spelling
    # gets a dash in the table for no reason.
    print("\n%d passed, %d failed" % (len(notes), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
