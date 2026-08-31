"""
tools/breedshot.py — THE FRONTAL DOG, BESIDE THE ART HE WAS AUTHORED FROM.

`dog/breeds.js` is authored by looking. Every note in that file that starts
"RENDERED AND LOOKED AT" or "the first pass came back as" was written after
somebody put the drawn dog next to the reference and compared them, and four of
the Schnoodle's five passes exist because that comparison had to be made by hand
each time. This does it in one command.

WHAT IT IS NOT: a gate. Nothing here passes or fails, because "does this look
like a corgi" is not a number. `tools/breedproof.py` and `tools/bowlgate.py` are
the checks; this is the eye.

It loads the real game with `?breed=<id>` (main.js's dev override, which pushes
the id into `unlocks.breeds` and makes it the active dog), suppresses everything
that is not the animal — the naming beat, the HUD, the nav, the toast, the
explainer cards — and screenshots him alone on the rug, then pastes the matching
crop of `docs/reference/character-sheet-<id>.png` alongside.

Usage:  py tools/breedshot.py [--breeds corgi,golden] [--pose sit]
        writes review/breed-<id>.png per breed.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page, boot
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "review"
REF = ROOT / "docs" / "reference"

# HIDE EVERYTHING THAT IS NOT THE DOG. The room's art stays — he has to be
# judged against the wall and the rug he will actually be seen on, which is the
# whole reason the Schnoodle's grey coat was rejected (§"THE ROOM": a grey dog in
# a warm room reads as cut out of a different picture).
ALONE = r"""(breed) => {
  const pp = window.__pp;
  const g = pp.app.game;
  pp.app.game.setFlag('installNever', true);
  pp.skipIntro('Ref');
  /* SWITCH THE BREED THROUGH A REMOUNT, not through `?breed=`.
     The query override works, but taking it means navigating past `_drive.boot`
     — and boot is what removes the splash veil, applies the safe-area inset
     through the real resize path, and steps the first frames. Skipping it
     screenshots a canvas that has never been laid out: the first run of this
     tool came back with a pure black pane beside a perfectly good reference.
     `scenes/room.js enter()` builds the rig, the renderer and every care layer
     from `game.dog`, so a remount is how a different breed actually arrives. */
  g.state.dogs[0].breedId = breed;
  if (g.state.unlocks.breeds.indexOf(breed) < 0) g.state.unlocks.breeds.push(breed);
  pp.app.nav.go('room', { switched: true, dogId: g.state.dogs[0].id });
  pp.step(1/60, 4);
  const sc = pp.loop.scene;
  if (sc.naming) sc.naming.close();
  /* full mood and every need met, so nothing about the pose is a complaint */
  for (const k of ['hunger', 'thirst', 'cleanliness', 'energy']) pp.app.game.setNeed(k, 1);
  pp.app.game.setMood(0.72);
  pp.step(1/60, 150);
  return { breed: sc.rig && sc.rig.breed ? sc.rig.breed.id : '?',
           x: sc.rig ? sc.rig.x : 0, y: sc.rig ? sc.rig.y : 0, s: sc.rig ? sc.rig.s : 0 };
}"""


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def refcrop(breed, h):
    """the front view out of the character sheet, scaled to height h"""
    f = REF / ("character-sheet-%s.png" % breed)
    if not f.exists():
        return None
    im = Image.open(f).convert("RGB")
    W, H = im.size
    # the front view is the leftmost pose; the sheet is 8 poses wide, and the
    # first is comfortably inside the first eighth
    c = im.crop((0, 0, int(W * 0.115), H))
    k = h / c.size[1]
    return c.resize((max(1, int(c.size[0] * k)), h), Image.LANCZOS)


def main():
    breeds = arg("--breeds", "corgi,golden").split(",")
    url = serve()
    out = []
    with sync_playwright() as p:
        b = browser(p)
        for breed in breeds:
            ctx, pg = page(b, inset=40, dpr=2)
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: errs.append("console.%s: %s" % (m.type, m.text))
                  if m.type == "error" else None)
            boot(pg, url)
            info = pg.evaluate(ALONE, breed)
            shot = SHOTS / ("_raw-%s.png" % breed)
            pg.screenshot(path=str(shot))
            ctx.close()

            game = Image.open(shot).convert("RGB")
            ref = refcrop(breed, game.size[1])
            if ref:
                pad = 12
                comp = Image.new("RGB", (game.size[0] + ref.size[0] + pad, game.size[1]),
                                 (250, 241, 231))
                comp.paste(game, (0, 0))
                comp.paste(ref, (game.size[0] + pad, 0))
                comp.save(SHOTS / ("breed-%s.png" % breed))
            else:
                game.save(SHOTS / ("breed-%s.png" % breed))
            shot.unlink()
            print("review/breed-%s.png   rig breed %s  s %.2f  errors %s"
                  % (breed, info["breed"], info["s"], errs[:2] or "none"))
            out.append(info["breed"] == breed)
        b.close()
    return 0 if all(out) else 1


if __name__ == "__main__":
    sys.exit(main())
