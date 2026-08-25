"""
Diff sw.js's PRECACHE list against what is actually on disk.

There is no build step (ARCHITECTURE §1), so the precache list is hand-written.
A module added in a later stage and forgotten here would work perfectly online
and 404 the moment she opens the game with no signal — the worst kind of bug,
because it only appears in the one situation the service worker exists for.

Run from anywhere:  py tools/check-precache.py
Exit code 0 = the list and the tree agree.
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

# on disk and NOT part of the shipped game: dev spikes, art review, the
# generator for the icons, and this checker itself.
# `refs` is the reference art (turnaround sheets, walk cycles). It is gitignored
# — see .gitignore — so it is not even in the repo GitHub Pages serves, and
# precaching it would put megabytes of PNG a player never sees into the install
# AND fail that all-or-nothing install on any clone that doesn't have it.
# ANY DOTTED DIRECTORY, not just `.git`. A Claude Code subagent working in this
# repo gets a git worktree under `.claude/worktrees/<id>/`, which is a COMPLETE
# SECOND COPY of the tree living inside the first one — so this walk found every
# file twice and reported all 54 of them as missing from PRECACHE, while the
# actual precache list was perfectly correct. The checker was right about what it
# saw and wrong about where it looked.
EXCLUDE_DIRS = {"review", "tools", "docs", "refs"}


def _skip(name):
    return name in EXCLUDE_DIRS or name.startswith(".")
EXCLUDE_FILES = {"spike-a-2d.html", "spike-b-pixel.html", "spike-c-3d.html", "sw.js"}

sw = (ROOT / "sw.js").read_text(encoding="utf-8")
block = re.search(r"const PRECACHE = \[(.*?)\n\];", sw, re.S)
if not block:
    print("FAIL: could not find the PRECACHE array in sw.js")
    sys.exit(2)
listed = set(re.findall(r"'\./([^']*)'", block.group(1)))
listed.discard("")  # './' is the start_url alias for index.html

on_disk = set()
for p in ROOT.rglob("*"):
    if not p.is_file():
        continue
    rel = p.relative_to(ROOT)
    if _skip(rel.parts[0]) or rel.name in EXCLUDE_FILES:
        continue
    # `.webp` IS IN HERE BECAUSE THE PROFILE SPRITES ARE WEBP. They are fetched
    # at runtime like any module, so a sheet on disk and not in PRECACHE is a dog
    # who vanishes the moment the phone is offline — the exact class of failure
    # this checker exists to catch, and it would have missed it silently.
    if p.suffix.lower() in (".js", ".html", ".webmanifest", ".png", ".webp"):
        on_disk.add(rel.as_posix())

missing = sorted(on_disk - listed)      # shipped but not precached -> breaks offline
stale = sorted(listed - on_disk)        # precached but absent -> FAILS THE INSTALL

for f in missing:
    print(f"MISSING from PRECACHE (would 404 offline): {f}")
for f in stale:
    print(f"STALE in PRECACHE (would fail sw install): {f}")

if not missing and not stale:
    print(f"OK: {len(listed)} entries, and they match the tree exactly.")
    sys.exit(0)
sys.exit(1)
