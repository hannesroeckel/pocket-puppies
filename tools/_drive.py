"""
tools/_drive.py — the small shared driver the training-clarity gates run on.

Not a gate itself. It boots the real tree over a real HTTP server in a real
browser at the design viewport, with `requestAnimationFrame` stubbed and
`Date.now` pinned, so every frame comes from an explicit step and nothing in
the save ledger advances with wall-clock time while a check is thinking.

THE BROWSER IS WHICHEVER CHROMIUM IS ACTUALLY AVAILABLE, and the order of
preference is now the other way round from how this file started.

It used to resolve the SYSTEM Chrome and nothing else, because this development
machine cannot download a Playwright-managed build — the corporate network
refuses — and §27.2 records two committed gates that were unrunnable here for
exactly that reason. In CI the opposite is true: a GitHub runner has no Chrome
installed at a path anybody can predict, but `playwright install --with-deps
chromium` works, and that is the supported thing.

Neither environment can be made to look like the other, so `browser()` tries
Playwright's own bundled chromium FIRST and falls back to a system Chrome or
Edge. That way the same gate files run in both places without a flag, and the
reason it is safe to accept either is unchanged: what these gates check is canvas
geometry and canvas type, which any recent Chromium draws identically.
"""
import functools, http.server, socketserver, threading, pathlib, os

ROOT = str(pathlib.Path(__file__).resolve().parent.parent)

CHROME = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]

PIN = ("window.requestAnimationFrame = function () { return 0; };"
       "window.cancelAnimationFrame = function () {};"
       "Date.now = function () { return 1767225600000; };")


class _Q(socketserver.ThreadingTCPServer):
    allow_reuse_address = False
    daemon_threads = True

    def handle_error(self, *a):
        pass


def serve(root=ROOT):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
    srv = _Q(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return "http://127.0.0.1:%d" % srv.server_address[1]


def bundled(p):
    """
    The path Playwright would use for its own chromium, if that build is really
    on disk — otherwise None.

    IT IS A PATH TEST, NOT A TRY/LAUNCH, and that is not a style preference.
    `bowlperf.py` and `bowlpixels.py` drive the ASYNC api, where
    `p.chromium.launch()` returns a COROUTINE and raises nothing at all until the
    caller awaits it — so wrapping the launch in `try/except` here would work
    perfectly for the eight sync gates and silently never fire for the two async
    ones, which are exactly the two §27.2 caught being unrunnable. Asking
    `executable_path` for a path and asking the filesystem whether it exists
    behaves identically under both apis and does not start a process to find out.

    `executable_path` is a property that can raise on some driver states, hence
    the guard; a machine with no bundled build simply reports a path that is not
    there (`...\\ms-playwright\\chromium-NNNN\\chrome-win64\\chrome.exe`), which
    is the case on the development machine this suite was written on.
    """
    try:
        exe = p.chromium.executable_path
    except Exception:                            # noqa: BLE001 — treated as absent
        return None
    return exe if exe and os.path.exists(exe) else None


def browser(p, **kw):
    """
    Playwright's own chromium FIRST, a system Chrome or Edge second.

    The bundled build wins when it is present because its version is pinned by
    the install step and so a CI result is reproducible against it. The dev
    machine has no bundled build and never will, so it falls through to the
    system browser it has always used, at the cost of one `os.path.exists`.

    Returns whatever `launch` returns — a Browser under the sync api, an
    awaitable under the async one — so both kinds of caller are unchanged.
    """
    own = bundled(p)
    if own:
        # LAUNCH THE EXACT FILE THAT WAS PROBED, by path, rather than letting a
        # bare `launch()` choose. They are not the same browser.
        #
        # `chromium.executable_path` reports the CHROMIUM build:
        #     ms-playwright\chromium-NNNN\chrome-win64\chrome.exe
        # but a default headless `launch()` prefers the separate HEADLESS SHELL
        # build:
        #     ms-playwright\chromium_headless_shell-NNNN\chrome-headless-shell.exe
        # which is a different download. Probing one and launching the other is a
        # probe that can lie — and it did: an earlier cut of this function
        # reported the bundled build present and then failed inside `bowlperf.py`
        # with "Executable doesn't exist at ...chrome-headless-shell.exe". Naming
        # the path closes the gap: whatever `bundled()` found is what runs.
        return p.chromium.launch(executable_path=own, **kw)
    for exe in CHROME:
        if os.path.exists(exe):
            return p.chromium.launch(executable_path=exe, **kw)
    raise SystemExit(
        "no browser: Playwright's bundled chromium is not installed, and no "
        "system Chrome or Edge was found.\n"
        "  In CI:   pip install playwright && playwright install --with-deps chromium\n"
        "  Locally: install Chrome, or add its path to tools/_drive.py CHROME.")


def page(b, inset=0, dpr=2, reduced=False, dark=True):
    """A page at the design viewport, with a chosen safe-area inset."""
    ctx = b.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=dpr,
        is_mobile=True,
        has_touch=True,
        color_scheme="dark" if dark else "light",
        reduced_motion="reduce" if reduced else "no-preference",
    )
    pg = ctx.new_page()
    pg.add_init_script(PIN)
    # remembered so `boot` can apply it through the REAL resize path
    pg._pp_inset = inset
    return ctx, pg


def boot(pg, url, fresh=True):
    """Load the game and wait for the loop to exist. Returns the page."""
    if fresh:
        pg.goto(url + "/index.html")
        pg.evaluate("() => { try { localStorage.clear(); } catch (e) {} }")
    pg.goto(url + "/index.html")
    pg.wait_for_function("() => window.__pp && window.__pp.loop && window.__pp.loop.scene")
    # THE BOOT VEIL IS LIFTED BY ONE rAF, WHICH WE HAVE STUBBED. It is a full-
    # bleed opaque div, so every screenshot came back as the splash screen on a
    # dark brown field — the game was running correctly underneath it the whole
    # time. Lifted here rather than in each gate, because it is a property of
    # pinning the clock and not of anything being tested.
    # REMOVED, not faded: `.gone` is a 0.35s CSS opacity transition, and CSS
    # transitions run on real time — which stubbing rAF does not stop. A
    # screenshot taken promptly caught the splash still half-visible over the
    # game, which looked like a rendering bug in whatever was being tested.
    pg.evaluate("() => { const b = document.getElementById('boot');"
                "        if (b) b.remove(); }")
    pg.evaluate("() => window.__pp.loop.stepFixed(1/60, 8)")

    # ---- THE SAFE-AREA INSET, APPLIED THE WAY A ROTATION APPLIES IT --------
    # index.html keeps a 1px #safeprobe whose padding is env(safe-area-inset-*),
    # and main.js measures it; a desktop browser reports zero for all four, so
    # that element's padding is the lever a notched phone pulls.
    #
    # It used to be set from an init script on DOMContentLoaded, and that was a
    # RACE THAT USUALLY LOST: a module script is deferred, so it runs BEFORE
    # DOMContentLoaded with `readyState === 'interactive'`, which sends main.js
    # down its `else boot()` branch — it had already measured the probe by the
    # time the listener fired. On a cold page the two were close enough to look
    # fine, and on a second page in the same browser the inset was silently 0,
    # which quietly turned every "at inset 40" claim into "at inset 0".
    #
    # So: set it, then dispatch a real `resize`, which is the production path
    # (`main.js` listens for it, re-reads the probe, and hands the inset to
    # every panel through `scene.resize`). Deterministic, and it exercises the
    # code a rotation exercises.
    inset = getattr(pg, "_pp_inset", 0)
    if inset:
        pg.evaluate(
            "(v) => { const el = document.getElementById('safeprobe');"
            "  if (el) el.style.paddingBottom = v + 'px';"
            "  window.dispatchEvent(new Event('resize')); }", inset)
        pg.evaluate("() => window.__pp.loop.stepFixed(1/60, 4)")
        got = pg.evaluate("() => window.__pp.app.view.safe.bottom")
        if abs(got - inset) > 0.5:
            raise SystemExit("driver: asked for inset %s, the game read %s" % (inset, got))
    return pg
