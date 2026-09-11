/* ===================================================================
   Camera and game clock.

   Clock: one place that decides how much simulated time a real frame
   is worth. Hit-stop freezes it, slow motion scales it, and both
   recover automatically. Input and HUD stay on the real clock.

   Camera: trauma-based shake (trauma is squared, so small hits barely
   register and big ones land), a zoom punch that scales about the
   point of impact rather than the screen centre, a slight roll, and a
   white flash. `apply` turns all of that into one canvas transform.
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

(function () {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  class Clock {
    constructor() { this.scale = 1; this.freezeLeft = 0; this.slowLeft = 0; this.slowTotal = 0; this.slowScale = 1; }
    hitstop(ms) { this.freezeLeft = Math.max(this.freezeLeft, ms / 1000); }
    slowMo(scale, ms) { this.slowLeft = this.slowTotal = ms / 1000; this.slowScale = scale; }
    // Returns game seconds for `dtReal` real seconds.
    advance(dtReal) {
      if (this.freezeLeft > 0) { this.freezeLeft -= dtReal; this.scale = 0; return 0; }
      if (this.slowLeft > 0) {
        this.slowLeft -= dtReal;
        // Hold the slow speed, then ease back up over the final third so
        // the return to full speed reads as a release, not a jump.
        const k = clamp(this.slowLeft / this.slowTotal, 0, 1);
        const back = k < 0.35 ? 1 - k / 0.35 : 0;
        this.scale = this.slowScale + (1 - this.slowScale) * back * back;
      } else this.scale = 1;
      return dtReal * this.scale;
    }
  }

  // Smooth pseudo-noise from stacked sines: cheap, deterministic, and
  // it looks like hand-held camera rather than static.
  const noise = (t, o) => Math.sin(t + o) * 0.5 + Math.sin(t * 2.3 + o * 1.7 + 1.1) * 0.3 + Math.sin(t * 4.7 + o * 0.6 + 2.3) * 0.2;

  class Camera {
    constructor(w, h, feel) {
      this.w = w; this.h = h; this.feel = feel;
      this.trauma = 0; this.time = 0;
      this.zoom = 1; this.fx = w / 2; this.fy = h / 2;
      this.offX = 0; this.offY = 0; this.rot = 0;
      this.flashA = 0; this.flashColor = "255,240,205";
      this.reduced = false;
    }
    addTrauma(a) { this.trauma = clamp(this.trauma + (this.reduced ? a * 0.3 : a), 0, 1); }
    flash(a, color) { this.flashA = Math.max(this.flashA, a); if (color) this.flashColor = color; }
    // Zoom toward (x, y), snap in fast, ease out slow.
    punch(tweens, zoom, x, y) {
      if (this.reduced) return;
      this.fx = x; this.fy = y;
      tweens.kill("cam-zoom");
      tweens.add({ target: this, to: { zoom }, duration: this.feel.zoom.inMs, ease: "quadOut", realtime: true, tag: "cam-zoom",
        onComplete: () => tweens.add({ target: this, to: { zoom: 1 }, duration: this.feel.zoom.outMs, ease: "cubicOut", realtime: true, tag: "cam-zoom" }) });
    }
    update(dtReal) {
      this.time += dtReal;
      this.trauma = Math.max(0, this.trauma - dtReal * 1.7);
      const s = this.trauma * this.trauma;
      const t = this.time * 31;
      this.offX = this.feel.maxShakePx * s * noise(t, 0);
      this.offY = this.feel.maxShakePx * s * noise(t, 5);
      this.rot = this.feel.maxShakeDeg * (Math.PI / 180) * s * noise(t, 9);
      this.flashA = Math.max(0, this.flashA - dtReal * 9);
    }
    // World transform: design units → device pixels, with zoom about
    // the focus point, roll about the screen centre, and shake offset.
    apply(ctx, scale) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.translate(this.w / 2, this.h / 2);
      ctx.rotate(this.rot);
      ctx.translate(-this.w / 2, -this.h / 2);
      ctx.translate(this.fx, this.fy);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-this.fx, -this.fy);
      ctx.translate(this.offX, this.offY);
    }
  }

  L7.Clock = Clock;
  L7.Camera = Camera;
})();

if (typeof module !== "undefined") module.exports = { Clock: L7.Clock, Camera: L7.Camera };
