"""
tools/sideheight.py — HOW TALL EACH PROFILE SHEET SHOULD BE DRAWN.

`BALANCE.side.sprite.height` was ONE NUMBER for every breed — 250 — and
balance.js records how it was got: the Schnoodle's body width, times the
Schnoodle's cell aspect. It is therefore exactly right for the Schnoodle and
accidental for everybody else. That is the same mistake the BOWL made and
solved: *"Typed numbers could only ever be right for one of the three breeds,
and stage 7's were right for none of them."*

WHAT THIS MEASURES, AND WHY IT MEASURES IT TWICE
------------------------------------------------
A scale factor needs one landmark that means the same thing in the frontal dog
and in the painted sheet. Two are available, and they are deliberately about as
unrelated as two landmarks can be:

  BELLY   the ground-to-belly clearance. In the sheet it is found by walking UP
          from the ground and taking the lowest row where the separate LEG runs
          have merged into one body — anatomically exact, and it cannot be
          confused with an ear or a tail because neither is down there.
          In the frontal dog it is `stance().pawSole - bodyBottom`, analytic.

  TOTAL   the whole silhouette, ground to topmost ink. In the sheet that is the
          cell's ink box; in the frontal dog it is his drawn ink box.

USING BOTH IS THE POINT. If the painted sheet and the drawn dog agree about a
breed's proportions, the two landmarks give the same answer and the scale is
real. If they disagree, THERE IS NO CORRECT SINGLE SCALE for that breed — match
his legs and the whole dog comes out too small, match his height and his legs
are wrong — and this tool says so and holds him at the default rather than
picking a winner and calling it derived.

Three heuristics were tried and thrown away before the belly, and they are worth
recording so nobody re-tries them: the topmost ink in the REAR of the cell reads
the Shiba's tail, which curls up over his back; the topmost ink in the MIDDLE
reads the Corgi's ears, which are set back over his shoulders; and the flattest
run of the top contour picks a different landmark on each dog. All three were
rendered with the line drawn on the art, which is how they were caught.

CALIBRATED ON THE SCHNOODLE, so he is pixel-unchanged: he is the gift puppy and
he is on her phone. Every other breed moves relative to him.

Usage:  py tools/sideheight.py [--write]
        --write updates tools/sidesheets/side-<breed>.json; then run
        `py tools/side-meta.py` to carry the numbers into src/assets.
"""
import sys, json, pathlib, re

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page, boot
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "src" / "assets"
SHEETMETA = ROOT / "tools" / "sidesheets"

ANCHOR = "schnoodle"      # the gift puppy: he must not move
BASE = 250.0              # what he is drawn at today
AGREE = 8.0               # % disagreement above which a breed is HELD

# ---- HELD BY DECISION, WHICH IS NOT THE SAME AS HELD BY DISAGREEMENT --------
#
# A breed here has a PERFECTLY GOOD solved height and is being overruled anyway.
# That is a legitimate thing to do — "measurably correct" and "reads well" are
# different questions and only one of them is this tool's business — but it must
# never be laundered into looking like a measurement. So the solved number is
# still computed, still printed, and still recorded in the note.
HOLD = {
    "corgi": (
        "the two landmarks agree, and he is overruled on FRAMING. At his solved "
        "height he spans 100% of the 390-unit screen in the room (from 84%) and "
        "62% of it on the road (from 52%). The stroll's 0.62 scale exists "
        "precisely because a wide dog meant 'every find he passed hidden behind "
        "him', and STROLL-PLAN already lists an untaken find being hidden for "
        "about a second as that beat's one unfixed flaw; 18% wider makes the "
        "occlusion roughly 2.2s -> 2.6s. Human decision, 2026-08-31."),
}


def ink_runs(px, y, w, minrun=6):
    """how many separate ink spans cross row y (specks ignored)"""
    n = cur = 0
    for x in range(int(w)):
        if px[x, y] > 40:
            cur += 1
        else:
            if cur >= minrun:
                n += 1
            cur = 0
    return n + (1 if cur >= minrun else 0)


def measure_sheet(path, cellW, cellH, ground):
    """belly and total, as fractions of the cell, off FRAME 0.

    Frame 0 only, on purpose: on a 'bound' sheet the fourth frame is a leap with
    the legs stretched and never merging, which returns the ground line and
    poisons an average. Frame 0 is a stand there and an ordinary stride on a
    'walk' sheet — the one frame every sheet draws comparably."""
    a = Image.open(path).convert("RGBA").split()[3]
    cell = a.crop((0, 0, int(cellW), int(cellH)))
    px = cell.load()
    belly = None
    for y in range(int(ground) - 4, int(cellH * 0.25), -1):
        if ink_runs(px, y, cellW) == 1 and all(
                ink_runs(px, yy, cellW) == 1 for yy in range(y - 6, y)):
            belly = y
            break
    top = cell.getbbox()[1]
    return {"bellyFrac": (ground - belly) / cellH if belly else None,
            "totalFrac": (ground - top) / cellH}


# the frontal dog, drawn at the rig's OWN default placement for every breed —
# identical for all of them, so the ratios between breeds are exact even though
# the absolute number is in whatever units that placement produces.
FRONTAL = r"""async () => {
  const [{createRig,resolveDims,stance},{createDogRenderer},{createRng},{BREEDS}] =
    await Promise.all([import('/src/dog/rig.js'), import('/src/dog/draw.js'),
      import('/src/engine/rng.js'), import('/src/dog/breeds.js')]);
  const W=1000,H=1400;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d',{willReadFrequently:true});
  const out=[];
  for (const id of (window.__pp.breeds||[])) {
    const st=stance(resolveDims({proportions:BREEDS[id].proportions}),{});
    const rig=createRig({breed:id,rng:createRng(1)});
    const dog=createDogRenderer(rig);
    for(let i=0;i<90;i++) rig.update(1/60,{});
    ctx.clearRect(0,0,W,H); dog.draw({ctx});
    const d=ctx.getImageData(0,0,W,H).data;
    let t=-1,b=-1;
    for(let y=0;y<H;y++){for(let x=0;x<W;x++){if(d[(y*W+x)*4+3]>24){t=y;break;}}if(t>=0)break;}
    for(let y=H-1;y>=0;y--){for(let x=0;x<W;x++){if(d[(y*W+x)*4+3]>24){b=y;break;}}if(b>=0)break;}
    out.push({id, total:b-t, clipped:(t<=0||b>=H-1), belly:st.pawSole-st.bodyBottom});
  }
  return out;
}"""


def main():
    write = "--write" in sys.argv
    meta = (ASSETS / "side-meta.js").read_text(encoding="utf-8")
    rows = re.findall(r"(\w+): \{ file: '([^']+)', frames: (\d+), cellW: ([\d.]+), "
                      r"cellH: ([\d.]+), ground: ([\d.]+)", meta)
    sheets = {b: measure_sheet(ASSETS / f, float(cw), float(ch), float(gr))
              for b, f, n, cw, ch, gr in rows}

    url = serve()
    with sync_playwright() as p:
        br = browser(p)
        ctx, pg = page(br, inset=40)
        boot(pg, url)
        pg.evaluate("() => __pp.skipIntro('Pip')")
        front = {r["id"]: r for r in pg.evaluate(FRONTAL)}
        br.close()

    bad = [k for k, v in front.items() if v["clipped"]]
    if bad:
        print("FAILED: the frontal dog was clipped by the probe canvas for %s — "
              "the measurement would be a lie." % bad)
        return 1
    for b in sheets:
        if sheets[b]["bellyFrac"] is None:
            print("FAILED: no belly line found in %s's sheet." % b)
            return 1

    kB = BASE * sheets[ANCHOR]["bellyFrac"] / front[ANCHOR]["belly"]
    kT = BASE * sheets[ANCHOR]["totalFrac"] / front[ANCHOR]["total"]

    print("%-10s %10s %9s %9s %10s   %s" %
          ("breed", "H(belly)", "H(total)", "disagree", "HEIGHT", "vs 250"))
    solved = {}
    for b in sorted(sheets):
        hB = front[b]["belly"] * kB / sheets[b]["bellyFrac"]
        hT = front[b]["total"] * kT / sheets[b]["totalFrac"]
        dis = abs(hB - hT) / hT * 100
        solvedH = round((hB + hT) / 2, 1)
        if dis >= AGREE:
            h, why = BASE, "disagree"
            note = ("HELD at %g: the sheet and the frontal dog disagree by %.1f%% "
                    "about this breed's proportions, so no one scale is correct"
                    % (BASE, dis))
        elif b in HOLD:
            h, why = BASE, "overruled"
            note = "HELD at %g though it solves to %g — %s" % (BASE, solvedH, HOLD[b])
        else:
            h, why = solvedH, ""
            note = "two landmarks agree to %.1f%%" % dis
        solved[b] = (h, note)
        print("%-10s %10.1f %9.1f %8.1f%% %10.1f   %+6.1f%%  %s" %
              (b, hB, hT, dis, h, (h / BASE - 1) * 100,
               {"disagree": "<- HELD (anchors disagree)",
                "overruled": "<- HELD (solves to %g; overruled on framing)" % solvedH,
                "": ""}[why]))

    if write:
        for b, (h, note) in solved.items():
            f = SHEETMETA / ("side-%s.json" % b)
            m = json.loads(f.read_text(encoding="utf-8"))
            m["height"] = h
            m["heightNote"] = note
            f.write_text(json.dumps(m, indent=2), encoding="utf-8")
        print("\nwrote height into %d sheet json(s); "
              "now run `py tools/side-meta.py`" % len(solved))
    else:
        print("\n(dry run — pass --write to record these)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
