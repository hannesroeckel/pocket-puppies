"""
tools/make-sidesprites.py — TURN A REFERENCE SHEET INTO A GAME ASSET.

The human drew the profile dog rather than accept the drawn one:

    "i built the side view of the schnoodle with chatgpt as yours looked bad.
     pull it from my downloads folder"

So `docs/reference/side-walk-schnoodle.png` is art now, not reference, and this
turns it into something the game can composite over grass.

FOUR THINGS IT HAS TO DO, and each of them is a defect if it is skipped:

  1. KEY OUT THE BACKGROUND. The sheet has a cream backdrop baked in. Left there,
     he walks across the park inside a cream rectangle. The key is distance-based
     with a soft edge, so the dark outline keeps its antialiasing instead of
     coming back jagged.

  2. DROP THE DRAWN SHADOW. Each frame has a soft grey ellipse under it. The game
     draws its own contact shadow, on the ground, sized by how high he is off it —
     two shadows is one too many, and the drawn one cannot move. It falls out of
     the key for free: a 10%-grey ellipse on cream is within the key's own
     threshold, which is why the threshold is set where it is.

  3. ALIGN THE FRAMES ON THE GROUND, NOT ON THEIR BOXES. The four dogs have
     different bounding boxes — a walking leg reaches further than a standing one
     — so trimming each frame to its own ink and centring it would make him bob
     and slide. Every frame is placed by the same ground line and the same body
     centre, both measured with the SHADOW EXCLUDED, or the alignment is measured
     against a blob that is not the dog.

  4. SIZE IT FOR THE PHONE, ONCE. The dog is about 150 virtual units tall; at
     dpr 3 that is ~450 device pixels, which is the sprite's height. Bigger is
     wasted bytes in a cache that holds every asset offline; smaller is a soft dog
     on the device it was made for.

Usage:  py tools/make-sidesprites.py [--breed schnoodle] [--height 450] [--check] [--png]
        --check writes review/sprite-check.png: the frames on a green field, which
        is the only way to see a cream fringe.
"""
import sys, base64, json, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "src" / "assets"
# the intermediate metadata is a TOOL INPUT, not a shipped asset: it lives
# under tools/ so it is never fetched, never precached, and never mistaken
# for something the game loads. tools/side-meta.py turns it into a module.
SHEETMETA = ROOT / "tools" / "sidesheets"
SHOTS = ROOT / "review"

# THE SLICER, in the browser, because the browser is the thing that will draw it.
# Doing the resample here means the filtering that produces the shipped pixels is
# the same filtering the game would apply, rather than a different library's.
SLICE = r"""async ([url, frames, targetH, keyLo, keyHi, fillTol]) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const sc = src.getContext('2d', { willReadFrequently: true });
  sc.drawImage(img, 0, 0);
  const data = sc.getImageData(0, 0, W, H);
  const d = data.data;
  const bg = [d[0], d[1], d[2]];
  const dist = (i) => Math.abs(d[i] - bg[0]) + Math.abs(d[i+1] - bg[1]) + Math.abs(d[i+2] - bg[2]);

  /* ---- 1 + 2: FLOOD-FILL THE BACKGROUND, don't threshold it ---------------
     A global threshold cannot do this job. The drawn shadow under the standing
     frame is further from cream than the dog's own PALE MUZZLE is, so any
     threshold that removes the shadow also punches a hole in his face — and the
     first run proved the other half: at a threshold that spared the muzzle, the
     standing frame kept its shadow, which then counted as ink and threw that
     frame's ground alignment off by the height of the ellipse.

     So: fill inward from the border through everything background-ish. The
     shadow is connected to the background and goes with it; the muzzle is
     enclosed by the dog's own dark outline, which the fill cannot cross. Then
     the soft edge is restored only OUTSIDE the filled region, so the outline
     keeps its antialiasing and nothing else is touched. */
  const N = W * H;
  const bgish = new Uint8Array(N);
  for (let q = 0; q < N; q++) bgish[q] = dist(q * 4) < fillTol ? 1 : 0;
  const filled = new Uint8Array(N);
  const stack = [];
  for (let x = 0; x < W; x++) { stack.push(x); stack.push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { stack.push(y * W); stack.push(y * W + W - 1); }
  while (stack.length) {
    const q = stack.pop();
    if (q < 0 || q >= N || filled[q] || !bgish[q]) continue;
    filled[q] = 1;
    const x = q % W;
    if (x > 0) stack.push(q - 1);
    if (x < W - 1) stack.push(q + 1);
    if (q >= W) stack.push(q - W);
    if (q < N - W) stack.push(q + W);
  }
  for (let q = 0; q < N; q++) {
    const i = q * 4;
    if (filled[q]) { d[i+3] = 0; continue; }
    /* THE SOFT RAMP IS FOR THE RIM ONLY, and the first pass got this wrong in a
       way that only showed up on grass: it applied the ramp to every kept pixel
       by COLOUR DISTANCE, so his near-white EYE CATCHLIGHTS — which are close to
       cream — came out half-transparent and the green field showed through them.
       He had green eyes. An interior pixel is opaque whatever colour it is; only
       a pixel touching the filled background gets feathered, because that is
       where the artist's antialiasing lives. */
    const x = q % W;
    const edge = (x > 0 && filled[q - 1]) || (x < W - 1 && filled[q + 1])
      || (q >= W && filled[q - W]) || (q < N - W && filled[q + W]);
    if (!edge) { d[i+3] = 255; continue; }
    const t = (dist(i) - keyLo) / (keyHi - keyLo);
    d[i+3] = Math.max(0, Math.min(1, t)) * 255;
  }
  sc.putImageData(data, 0, 0);

  /* ---- 3: measure each frame with the shadow already gone ---------------- */
  const CELL = Math.floor(W / frames);
  const boxes = [];
  for (let f = 0; f < frames; f++) {
    let lo = 1e9, hi = -1, top = 1e9, bot = -1;
    for (let y = 0; y < H; y++) {
      for (let x = f * CELL; x < (f + 1) * CELL; x++) {
        if (d[(y * W + x) * 4 + 3] > 40) {
          if (x < lo) lo = x; if (x > hi) hi = x;
          if (y < top) top = y; if (y > bot) bot = y;
        }
      }
    }
    boxes.push({ lo, hi, top, bot, w: hi - lo + 1, h: bot - top + 1 });
  }
  /* one cell for all four: the tallest dog and the widest dog, plus a margin,
     so no frame is ever clipped and every frame shares one origin */
  const maxH = Math.max(...boxes.map((b) => b.h));
  const maxW = Math.max(...boxes.map((b) => b.w));
  const k = targetH / maxH;                       // one scale for the whole sheet
  const pad = 4;
  const cellW = Math.ceil(maxW * k) + pad * 2;
  const cellH = Math.ceil(maxH * k) + pad * 2;

  const out = document.createElement('canvas');
  out.width = cellW * frames; out.height = cellH;
  const oc = out.getContext('2d');
  oc.imageSmoothingQuality = 'high';
  /* THE GROUND IS THE SAME LINE IN EVERY CELL, and so is the body centre: each
     dog is placed by its own paws and its own middle, not by its own box. */
  const groundY = cellH - pad;
  const centres = [];
  for (let f = 0; f < frames; f++) {
    const b = boxes[f];
    const dw = b.w * k, dh = b.h * k;
    const dx = f * cellW + (cellW - dw) / 2;
    const dy = groundY - dh;
    oc.drawImage(src, b.lo, b.top, b.w, b.h, dx, dy, dw, dh);
    centres.push(+(((cellW) / 2)).toFixed(1));
  }
  return {
    png: out.toDataURL('image/png'),
    /* WEBP TOO, and it is what ships. This art is soft gradients over large flat
       areas, which is the case PNG is worst at: the first slice came out at 944KB
       for one breed, and every asset in this project is precached for offline, so
       three breeds would have been nearly 3MB of cache for a dog who walks. WebP
       at 0.92 is lossy in a way that is invisible on fur and roughly a fifth of
       the size. Safari has decoded it since iOS 14. */
    webp: out.toDataURL('image/webp', 0.92),
    meta: {
      frames, cellW, cellH, ground: groundY, centre: cellW / 2,
      scale: +k.toFixed(4), source: src,
      boxes,
    },
  };
}"""

CHECK = r"""async ([dataUrl, cellW, cellH, frames]) => {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const c = cv.getContext('2d');
  /* A GREEN FIELD, because a cream fringe on cream is invisible and a cream
     fringe on grass is the whole reason this check exists. */
  c.fillStyle = '#7fae62'; c.fillRect(0, 0, cv.width, cv.height);
  c.drawImage(img, 0, 0);
  return cv.toDataURL('image/png');
}"""


def arg(name, default):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


def main():
    breed = arg("--breed", "schnoodle")
    height = int(arg("--height", "450"))
    ASSETS.mkdir(parents=True, exist_ok=True)
    SHEETMETA.mkdir(parents=True, exist_ok=True)
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        ctx = b.new_context(viewport={"width": 900, "height": 600})
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url + "/tools/side-preview.html")
        src = "%s/docs/reference/side-walk-%s.png" % (url, breed)
        res = pg.evaluate(SLICE, [src, 4, height, 18, 64, 155])
        png = base64.b64decode(res["png"].split(",", 1)[1])
        webp = base64.b64decode(res["webp"].split(",", 1)[1])
        use_png = "--png" in sys.argv
        blob = png if use_png else webp
        ext = "png" if use_png else "webp"
        (ASSETS / ("side-%s.%s" % (breed, ext))).write_bytes(blob)
        for stale in ("png", "webp"):
            if stale != ext:
                old_f = ASSETS / ("side-%s.%s" % (breed, stale))
                if old_f.exists(): old_f.unlink()
        meta = res["meta"]
        meta["breed"] = breed
        (SHEETMETA / ("side-%s.json" % breed)).write_text(
            json.dumps(meta, indent=2) + "\n", encoding="utf-8")

        meta["file"] = "side-%s.%s" % (breed, ext)
        print("wrote src/assets/%s  %d frames of %dx%d"
              % (meta["file"], meta["frames"], meta["cellW"], meta["cellH"]))
        print("     png %.0f KB   webp %.0f KB   -> shipping %s (%.0f KB)"
              % (len(png) / 1024, len(webp) / 1024, ext, len(blob) / 1024))
        print("     scale %.3f, ground at y %d, centre x %.1f"
              % (meta["scale"], meta["ground"], meta["centre"]))
        for i, bx in enumerate(meta["boxes"]):
            print("     frame %d: %dx%d at (%d,%d)" % (i, bx["w"], bx["h"], bx["lo"], bx["top"]))

        if "--check" in sys.argv:
            SHOTS.mkdir(exist_ok=True)
            chk = pg.evaluate(CHECK, [res["png"], meta["cellW"], meta["cellH"], 4])
            (SHOTS / "sprite-check.png").write_bytes(base64.b64decode(chk.split(",", 1)[1]))
            print("     review/sprite-check.png — on grass, to catch a cream fringe")
        print("errors:", errs[:3] or "none")
        b.close()
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
