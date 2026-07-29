/* ==========================================================================
   engine/audio.js — STUB (stage 7 fills this in).

   Rules that are already enforced here so later stages can't break them:
     - No AudioContext is created until a real user gesture. iOS Safari will
       otherwise hand back a permanently suspended context.
     - No asset files, ever. Every sound will be synthesised.
     - play() is a no-op until `ready`, so callers never need to guard.
   ========================================================================== */

export function createAudio(settings = { sound: true }) {
  let ctx = null;
  let master = null;
  let unlocked = false;
  const missing = new Set();

  function unlock() {
    if (unlocked) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { unlocked = true; return false; }
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = settings.sound ? 0.6 : 0;
      master.connect(ctx.destination);
      if (ctx.state === 'suspended') ctx.resume();
      unlocked = true;
    } catch (e) {
      ctx = null; unlocked = true;
    }
    return !!ctx;
  }

  return {
    get ready() { return !!ctx && ctx.state === 'running'; },
    get ctx() { return ctx; },
    get master() { return master; },
    /** call from the first real pointerdown */
    unlock,
    setEnabled(on) {
      settings.sound = !!on;
      if (master) master.gain.value = on ? 0.6 : 0;
    },
    /** stage 7 registers synth voices here */
    voices: Object.create(null),
    /** no-op until a voice exists; records unknown names once for stage 7 */
    play(name, opts) {
      if (!ctx || !settings.sound) return;
      const v = this.voices[name];
      if (!v) { if (!missing.has(name)) missing.add(name); return; }
      try { v(ctx, master, opts || {}); } catch (e) { /* never let audio break a frame */ }
    },
    /** what stage 7 still owes us */
    get pending() { return [...missing]; },
  };
}

export default createAudio;
