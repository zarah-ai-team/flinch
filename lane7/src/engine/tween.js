/* ===================================================================
   Tweens and easing. Every animated value in the game — carrier
   position, lamp ignition, zoom punch, score pop — runs through here,
   so slow motion and hit-stop only have to be implemented once: a
   tween is either on the game clock (world things) or on the real
   clock (`realtime`, for HUD and camera work that must not freeze).
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

(function () {
  const PI = Math.PI;
  const Ease = {
    linear:     t => t,
    quadIn:     t => t * t,
    quadOut:    t => t * (2 - t),
    quadInOut:  t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    cubicIn:    t => t * t * t,
    cubicOut:   t => (--t) * t * t + 1,
    cubicInOut: t => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
    quartOut:   t => 1 - (--t) * t * t * t,
    expoOut:    t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
    sineInOut:  t => -(Math.cos(PI * t) - 1) / 2,
    backOut:    t => { const s = 1.70158, u = t - 1; return u * u * ((s + 1) * u + s) + 1; },
    backIn:     t => { const s = 1.70158; return t * t * ((s + 1) * t - s); },
    elasticOut: t => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * PI / 3)) + 1,
    bounceOut:  t => {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    }
  };

  class Tweens {
    constructor() { this.list = []; }

    /* Two shapes:
         value tween  { from: 0, to: 1, duration, ease, onUpdate(v, p) }
         object tween { target, to: { x: 10, y: 20 }, duration, ease, onUpdate(target, p) }
       Common: delay, onComplete, realtime, tag (for cancelling a group). */
    add(o) {
      const tw = {
        target: o.target || null, to: o.to, from: o.from, start: null,
        dur: Math.max(1, o.duration || 300),
        ease: typeof o.ease === "function" ? o.ease : (Ease[o.ease] || Ease.quadOut),
        delay: o.delay || 0, elapsed: 0,
        onUpdate: o.onUpdate || null, onComplete: o.onComplete || null,
        realtime: !!o.realtime, tag: o.tag || null, done: false,
        isValue: typeof o.to === "number"
      };
      this.list.push(tw);
      return tw;
    }

    // Keyframes on one value: frames = [[value, durationMs, ease?], ...]
    keyframes(frames, setter, opts = {}) {
      let delay = opts.delay || 0, prev = opts.from ?? frames[0][0];
      frames.forEach(([v, dur, ease], i) => {
        this.add({ from: prev, to: v, duration: dur, ease: ease || "linear", delay, realtime: opts.realtime, tag: opts.tag, onUpdate: setter,
                   onComplete: i === frames.length - 1 ? (opts.onComplete || null) : null });
        delay += dur; prev = v;
      });
    }

    kill(tag) { for (const tw of this.list) if (tw.tag === tag) tw.done = true; }
    killTarget(target) { for (const tw of this.list) if (tw.target === target) tw.done = true; }
    clear() { this.list.length = 0; }

    update(dtGame, dtReal) {
      let anyDone = false;
      for (let i = 0; i < this.list.length; i++) {
        const tw = this.list[i];
        if (tw.done) { anyDone = true; continue; }
        let dt = (tw.realtime ? dtReal : dtGame) * 1000;
        if (tw.delay > 0) {
          tw.delay -= dt;
          if (tw.delay > 0) continue;
          dt = -tw.delay; tw.delay = 0;          // spend the remainder on the tween itself
        }
        tw.elapsed += dt;
        if (tw.start === null) {
          if (tw.isValue) tw.start = tw.from ?? 0;
          else { tw.start = {}; for (const k in tw.to) tw.start[k] = tw.from && k in tw.from ? tw.from[k] : tw.target[k]; }
        }
        const p = Math.min(1, tw.elapsed / tw.dur), e = tw.ease(p);
        if (tw.isValue) {
          const v = tw.start + (tw.to - tw.start) * e;
          if (tw.onUpdate) tw.onUpdate(v, p);
        } else {
          for (const k in tw.to) tw.target[k] = tw.start[k] + (tw.to[k] - tw.start[k]) * e;
          if (tw.onUpdate) tw.onUpdate(tw.target, p);
        }
        if (p >= 1) { tw.done = true; anyDone = true; if (tw.onComplete) tw.onComplete(); }
      }
      if (anyDone) this.list = this.list.filter(t => !t.done);
    }
  }

  L7.Ease = Ease;
  L7.Tweens = Tweens;
})();

if (typeof module !== "undefined") module.exports = { Ease: L7.Ease, Tweens: L7.Tweens };
