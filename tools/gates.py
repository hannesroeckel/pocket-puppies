"""
tools/gates.py — RUN EVERY GATE, ONCE, AND PRINT ONE TABLE.

§27.6 records the gap this closes: "Nothing runs the suite as one command. Six
gates, six invocations, ~25 minutes. A runner is obvious and was not written."
It is eighteen now, and the argument is the same one — a suite nobody runs in one
go is a suite that gets run in part.

EACH GATE IS A SUBPROCESS, NOT AN IMPORT. Three reasons, all learned rather than
chosen:

  * They are not written to be imported. Every one of them calls `sys.exit()`
    out of `main()`, several keep module-level mutable state (`fails`, `notes`),
    and two are `async` with their own `asyncio.run`. Importing them into one
    process would make the second gate's counts depend on the first's.
  * `bowlpixels.py` CRASHES A BROWSER PROCESS if it is asked to do too much in
    one go (§27.2: `Target crashed`, because the browser process does not give
    DPR-3 ImageData buffers back). A gate that dies takes its own process with
    it and the others still run.
  * A gate that segfaults, hangs or is killed prints nothing at all. The runner
    has to survive that and record it as a FAILURE, which is only possible if
    the thing that died was not the runner.

THE EXIT CODE IS THE TRUTH; THE TEXT IS ONLY THE COUNTS. Every gate already
exits 0 for pass and non-zero for fail, and that is the one thing all eleven
agree on. The printed summary lines are parsed for the numbers ONLY, and a gate
that prints "12 passed, 0 failed" and then exits 1 is recorded as FAILED. The
alternative — believing the text — is how a runner comes to report a green suite
over a gate that crashed after its last check.

THREE SUMMARY FORMATS, PARSED RATHER THAN LEGISLATED. They were written at
different times and it is not worth touching nine working files to make them
agree:

    "N passed, M failed"        traingate timegate findsgate shopgate toastgate
                                reachgate bowlgate breedproof
    "ALL PASS" / "FAILED"       bowlpixels bowlperf
    "OK: N entries, ..."        check-precache

WHERE THE COUNTS COLUMN IS A DASH, THE GATE DOES NOT PUBLISH ONE. `bowlpixels`
and `bowlperf` assert plenty and report none of it as a number, so the runner
prints "—" rather than inventing one or quietly writing 1. §27.4's rule — a gate
must not claim a bigger sample than it takes — applies to the thing summarising
the gates just as much as to the gates.

Usage:
    py tools/gates.py                  every gate
    py tools/gates.py --fast           skip bowlpixels; breedproof runs --fast
    py tools/gates.py --only bowlgate,breedproof
    py tools/gates.py --list

Exit code 0 only if every gate that ran passed.
"""
import sys, os, re, time, subprocess, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"

# ---------------------------------------------------------------------------
# THE ROSTER.  (name, script, extra args, is_slow)
#
# Ordered cheapest-first ON PURPOSE. `check-precache` needs no browser at all
# and takes well under a second; if the tree is missing a precached file there
# is no point spending twenty minutes finding out that the bowl is still on the
# floor. Everything after it costs a browser.
#
# `is_slow` marks the gate `--fast` drops. Only `bowlpixels` is marked: it is
# the one that reads back DPR-3 ImageData for three breeds x two actions and
# needs a fresh browser per breed to survive at all (§27.2).
# ---------------------------------------------------------------------------
GATES = [
    ("check-precache", "check-precache.py", [], False),
    ("toastgate",      "toastgate.py",      [], False),
    ("timegate",       "timegate.py",       [], False),
    ("findsgate",      "findsgate.py",      [], False),
    ("shopgate",       "shopgate.py",       [], False),
    ("reachgate",      "reachgate.py",      [], False),
    ("traingate",      "traingate.py",      [], False),
    ("weargate",       "weargate.py",       [], False),
    ("decorgate",      "decorgate.py",      [], False),
    ("discgate",       "discgate.py",       [], False),
    ("placegate",      "placegate.py",      [], False),
    ("walkgate",       "walkgate.py",       [], False),
    ("strollgate",     "strollgate.py",     [], False),
    ("howtogate",      "howtogate.py",      [], False),
    ("bowlperf",       "bowlperf.py",       [], False),
    ("bowlgate",       "bowlgate.py",       [], False),
    ("breedproof",     "breedproof.py",     [], False),
    ("bowlpixels",     "bowlpixels.py",     [], True),
]

# `--fast` also thins the gates that take a `--fast` of their own, rather than
# dropping them. breedproof's full sweep is 3 breeds x 10 cases x feed+water =
# 60 care actions and ~7.5 minutes; its `--fast` is one breed, feed only, and
# still runs the whole self-test. Recorded in the table so a fast run can never
# be mistaken for a full one.
FAST_ARGS = {"breedproof": ["--fast"]}

PASSFAIL = re.compile(r"(\d+)\s+passed,\s+(\d+)\s+failed")
ALLPASS = re.compile(r"^(ALL PASS|FAILED)\b", re.M)
PRECACHE = re.compile(r"^OK:\s+(\d+)\s+entries", re.M)


def counts(text):
    """
    What a gate published about its own size, as (passed, total, unit), or None.

    LAST MATCH, NOT FIRST. Several gates print per-case lines that contain the
    words on the way past; the summary is the last one, and taking the first
    reported a single sub-case's total as the whole gate's.

    `check-precache` IS COUNTED IN A DIFFERENT UNIT, and it matters. "OK: 54
    entries" is 54 PRECACHE ENTRIES matching the tree, not 54 assertions — it is
    one check over 54 files. Folding it into a checks total would inflate the
    suite's headline by 54 for free, which is precisely the "never claim a
    bigger sample than you take" rule (§27.4) being broken by the thing that
    exists to report samples. So it carries its unit with it and the totals line
    only adds up the rows whose unit is `checks`.
    """
    m = list(PASSFAIL.finditer(text))
    if m:
        p, f = int(m[-1].group(1)), int(m[-1].group(2))
        return p, p + f, "checks"
    m = PRECACHE.search(text)
    if m:
        return 1, 1, "%s entries" % m.group(1)
    return None


def run(name, script, args, echo):
    path = TOOLS / script
    if not path.exists():
        return {"name": name, "ok": False, "counts": None, "secs": 0.0,
                "why": "no such file: tools/%s" % script, "out": ""}
    t0 = time.time()
    try:
        # `text=True` with `errors='replace'`: several gates print the section
        # sign in their labels and a Windows console codepage will otherwise
        # raise UnicodeDecodeError HERE, turning a passing gate into a runner
        # crash. Replace the byte, never lose the gate.
        p = subprocess.run([sys.executable, str(path)] + args,
                           cwd=str(ROOT), capture_output=True, text=True,
                           errors="replace")
        out = (p.stdout or "") + (p.stderr or "")
        ok, why = p.returncode == 0, ("exit %d" % p.returncode)
    except Exception as e:                      # noqa: BLE001 — a dead gate is a failure
        out, ok, why = "", False, "runner could not start it: %r" % e
    secs = time.time() - t0
    if echo:
        print(out)
    return {"name": name, "ok": ok, "counts": counts(out), "secs": secs,
            "why": why, "out": out}


def main():
    argv = sys.argv[1:]
    fast = "--fast" in argv
    echo = "--echo" in argv
    only = None
    if "--only" in argv:
        only = [s.strip() for s in argv[argv.index("--only") + 1].split(",") if s.strip()]

    roster = [g for g in GATES if not (fast and g[3])]
    if only:
        known = {g[0] for g in GATES}
        bad = [n for n in only if n not in known]
        if bad:
            print("no such gate: %s\nknown: %s"
                  % (", ".join(bad), ", ".join(sorted(known))))
            return 2
        roster = [g for g in GATES if g[0] in only]

    # ---- DISCOVERY, as a CHECK rather than as the mechanism ---------------
    # The roster is written out by hand, because the order and the `--fast`
    # marking are judgements a glob cannot make. But a glob CAN notice that
    # somebody added tools/whatevergate.py and did not put it here, which is
    # the failure mode of a hand-written roster and the reason §27's gates went
    # uncommitted for months. So: list what looks like a gate, and say so.
    looks_like = {p.stem for p in TOOLS.glob("*gate.py")} | {"breedproof",
                                                             "bowlpixels",
                                                             "bowlperf",
                                                             "check-precache"}
    listed = {g[0] for g in GATES}
    orphans = sorted(looks_like - listed)

    if "--list" in argv:
        for n, s, a, slow in GATES:
            print("  %-15s tools/%-18s %s" % (n, s, "(slow: dropped by --fast)" if slow else ""))
        if orphans:
            print("\nNOT IN THE ROSTER: %s" % ", ".join(orphans))
        return 0

    print("running %d gate%s%s\n" % (len(roster), "" if len(roster) == 1 else "s",
                                     "  [--fast]" if fast else ""))
    results = []
    for name, script, args, slow in roster:
        extra = list(args) + (FAST_ARGS.get(name, []) if fast else [])
        sys.stdout.write("  %-15s ... " % name)
        sys.stdout.flush()
        r = run(name, script, extra, echo)
        r["args"] = extra
        results.append(r)
        print("%s  %.1fs" % ("pass" if r["ok"] else "FAIL", r["secs"]))

    total = sum(r["secs"] for r in results)
    bad = [r for r in results if not r["ok"]]

    print("\n  %-15s %-6s %14s %10s   %s"
          % ("gate", "result", "counts", "wall", "args"))
    print("  " + "-" * 66)
    for r in results:
        c = r["counts"]
        # A GATE THAT PUBLISHES NO COUNT GETS A DASH, NOT A ONE.
        shown = "(none)" if c is None else (
            "%d/%d %s" % (c[0], c[1], c[2]) if c[2] != "checks"
            else "%d/%d checks" % (c[0], c[1]))
        print("  %-15s %-6s %14s %9.1fs   %s"
              % (r["name"], "pass" if r["ok"] else "FAIL", shown, r["secs"],
                 " ".join(r["args"]) or ""))
    print("  " + "-" * 66)

    # THE HEADLINE TOTAL COUNTS PASSING GATES ONLY. A gate that failed may still
    # have printed a large "N passed" — the runner's own self-test uses a stub
    # that prints "999 passed, 0 failed" and then exits 3 — and adding that to
    # the total produces a headline of 999 checks over a broken suite. The row
    # still shows what the gate claimed; the total does not believe it.
    chk = [r["counts"] for r in results
           if r["ok"] and r["counts"] and r["counts"][2] == "checks"]
    print("  %-15s %-6s %14s %9.1fs"
          % ("%d gate%s" % (len(results), "" if len(results) == 1 else "s"),
             "FAIL" if bad else "pass",
             ("%d/%d checks" % (sum(c[0] for c in chk), sum(c[1] for c in chk)))
             if chk else "(none)",
             total))
    if bad:
        print("  %-15s %s" % ("", "%d gate%s failed; the total above is over the "
                              "%d that passed" % (len(bad), "" if len(bad) == 1
                                                  else "s", len(results) - len(bad))))
    silent = [r["name"] for r in results if r["ok"] and not r["counts"]]
    if silent:
        rest = len(chk)
        print("\n  (no check count is published by: %s.\n   %s — see the header.)"
              % (", ".join(silent),
                 "They assert plenty and report no number for it, so there is no "
                 "checks total to give" if rest == 0 else
                 "The total above is over the other %d gate%s only"
                 % (rest, "" if rest == 1 else "s")))
    if fast:
        print("\n  --fast: bowlpixels was NOT run, and breedproof ran one breed, "
              "feed only.\n  This is a smaller suite making a smaller claim.")
    if orphans:
        print("\n  NOT IN THE ROSTER and therefore NOT RUN: %s" % ", ".join(orphans))

    for r in bad:
        print("\n" + "=" * 66)
        print("FAILED: %s (%s)" % (r["name"], r["why"]))
        print("=" * 66)
        # The tail, not the head: every one of these prints its failures last.
        tail = [ln for ln in r["out"].splitlines() if ln.strip()][-40:]
        print("\n".join(tail) if tail else "(no output at all)")

    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
