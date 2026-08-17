"""Queue item 5: a toast must not cover the thing it is talking about."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- toast.js
p = ROOT / "src" / "ui" / "toast.js"
s = p.read_text(encoding="utf-8")

OLD = """    /**
     * @param baseY where the bottom-most toast sits, in virtual units. The
     *   room passes the nav's top edge, which is itself derived from the safe
     *   inset — and `drawText` clamps into the safe band on top of that, so a
     *   caller who gets this wrong can no longer push a toast off screen.
     */
    draw(g, baseY) {
      if (!items.length) return;
      for (let i = 0; i < items.length; i++) {"""
NEW = """    /**
     * @param baseY where the bottom-most toast sits, in virtual units. The
     *   room passes the nav's top edge, which is itself derived from the safe
     *   inset — and `drawText` clamps into the safe band on top of that, so a
     *   caller who gets this wrong can no longer push a toast off screen.
     * @param avoid an optional rect `{x, y, w, h}` the stack must not cover —
     *   the thing the message is ABOUT. See below.
     */
    draw(g, baseY, avoid) {
      if (!items.length) return;
      /* ---- A MESSAGE MUST NOT OBSCURE ITS OWN SUBJECT (queue item 5) -----
         "the 'Biscuit is full' toast sits directly over the bowl it refers
         to", and in Play a toast covered the very ball it named. Both were
         perfectly legible — `ui/text.js` guarantees that — so no contrast gate
         could see it: the defect is placement, and the only thing that knows
         the subject's rect is the caller.

         The whole stack lifts as one, by exactly the overlap plus a margin, so
         the messages never reorder or jump about relative to each other. It
         lifts UP because everything a toast talks about is at the bottom of the
         screen (the bowls, the ball, the nav) and the room above him is empty
         wall — and it is bounded, because a toast that climbs onto his face to
         get out of the way of a bowl has solved nothing. */
      let lift = 0;
      if (avoid && avoid.w > 0 && avoid.h > 0) {
        const box = measure(g, items[0].text, { ...type('labelMd', { weight: 700 }) });
        const top = baseY - box.h / 2 - U.padY;
        const bottom = baseY + box.h / 2 + U.padY;
        const clear = U.avoidGap;
        if (bottom > avoid.y - clear && top < avoid.y + avoid.h + clear) {
          lift = Math.min(U.avoidMaxLift, bottom - (avoid.y - clear));
        }
      }
      baseY -= Math.max(0, lift);
      for (let i = 0; i < items.length; i++) {"""
assert OLD in s
s = s.replace(OLD, NEW, 1)
s = s.replace("import { drawText } from './text.js';",
              "import { drawText, measure } from './text.js';", 1)
p.write_text(s, encoding="utf-8")
print("toast ok")

# ---------------------------------------------------------------- balance.js
b = ROOT / "src" / "state" / "balance.js"
t = b.read_text(encoding="utf-8")
import re
m = re.search(r"\n(\s*)toast: \{\n", t)
assert m
insert_at = t.index("\n", m.end() - 1) + 1
indent = m.group(1) + "  "
ADD = (
    f"{indent}/* ---- KEEPING OFF THE THING IT IS TALKING ABOUT (queue item 5) ---\n"
    f"{indent}   `avoidGap` is the clearance the stack keeps from the subject's\n"
    f"{indent}   rect; `avoidMaxLift` is how far it will move to get it. The cap\n"
    f"{indent}   matters more than the gap: a toast that climbs onto his face to\n"
    f"{indent}   avoid a bowl has not solved anything, and past this it is better\n"
    f"{indent}   to overlap the prop a little than to land somewhere absurd. */\n"
    f"{indent}avoidGap: 10,\n"
    f"{indent}avoidMaxLift: 96,\n"
)
t = t[:insert_at] + ADD + t[insert_at:]
b.write_text(t, encoding="utf-8")
print("balance ok")

# ---------------------------------------------------------------- room.js
r = ROOT / "src" / "scenes" / "room.js"
w = r.read_text(encoding="utf-8")

OLD2 = """      toasts.draw(g, nav.y - 22);"""
NEW2 = """      /* WHAT THE MESSAGE IS ABOUT, if anything: the bowl she is using, or the
         ball if it is loose on the floor. The room is the only layer that knows
         which of them is the current subject, so it is the room that says. */
      toasts.draw(g, nav.y - 22, toastSubject());"""
assert OLD2 in w
w = w.replace(OLD2, NEW2, 1)

OLD3 = """  /** is a virtual point inside a rect? */"""
NEW3 = """  /**
   * THE RECT A TOAST MUST KEEP OFF (queue item 5).
   *
   * Care first: while she is feeding or watering him the bowl IS the subject,
   * and "Biscuit is full" sitting on top of it was the reported defect. Then
   * the ball, but only while it is lying about being interactive — once he has
   * it in his mouth or is chasing it, a message is about HIM and the ball is
   * moving anyway, so following it would make the stack jitter.
   *
   * Deliberately not the dog: he is most of the screen, and a toast that will
   * not overlap him has nowhere left to be.
   */
  function toastSubject() {
    const d = care && care.debug;
    if (d && d.mode && (d.mode === 'feed' || d.mode === 'water') && d.bowlAt) {
      const B = BALANCE.ui.toast.bowlRect;
      return { x: d.bowlAt[0] - B[0], y: d.bowlAt[1] - B[1], w: B[0] * 2, h: B[1] + B[2] };
    }
    if (toy && toy.toy && !toy.busy && toy.toy.held !== true) {
      const T = BALANCE.ui.toast.toyRect;
      return { x: toy.toy.x - T[0], y: toy.toy.y - T[1], w: T[0] * 2, h: T[1] * 2 };
    }
    return null;
  }

  /** is a virtual point inside a rect? */"""
assert OLD3 in w
w = w.replace(OLD3, NEW3, 1)

# and the duplicated Play copy: one message, not two
OLD4 = """      hud.setHint('Flick the ball up-screen');
      toasts.show('Flick the ball up — never sideways');
      return;"""
NEW4 = """      /* ONE MESSAGE, NOT TWO. This set a hud hint AND a toast that said the
         same thing in different words, at the same moment, and the toast landed
         on the ball it was naming (docs/FEEDBACK-QUEUE.md 5). The hint is the
         right one to keep: it lives at the top of the screen, it stays up while
         she works out what to do, and it cannot cover anything. */
      hud.setHint('Flick the ball up-screen — never sideways');
      return;"""
assert OLD4 in w
w = w.replace(OLD4, NEW4, 1)
r.write_text(w, encoding="utf-8")
print("room ok")

# the two subject rects, in balance
t = b.read_text(encoding="utf-8")
t = t.replace("      avoidGap: 10,\n      avoidMaxLift: 96,\n",
              "      avoidGap: 10,\n      avoidMaxLift: 96,\n"
              "      /* the subject rects, as half-extents around the thing's own draw\n"
              "         position: [halfWidth, above, below] for the bowl (which is drawn\n"
              "         from its base) and [halfWidth, halfHeight] for the ball. */\n"
              "      bowlRect: [34, 30, 12],\n"
              "      toyRect: [20, 20],\n", 1)
b.write_text(t, encoding="utf-8")
print("rects ok")
