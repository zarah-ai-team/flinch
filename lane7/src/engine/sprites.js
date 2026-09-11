/* ===================================================================
   Sprites and the light compositor.

   Sprites: everything on screen is still drawn in code — no image
   files — but drawn ONCE into an offscreen canvas at device resolution
   and blitted after that. A radial gradient built every frame is
   expensive; a radial gradient built once and drawImage'd is free.

   LightLayer: 2D lighting without WebGL. The world is painted at full
   brightness, then a darkness layer goes over it with holes cut where
   the lamps are (destination-out), then warm additive glows go on top.
   The result reads as a lit target in a dark bay, and dimming a level
   is one number.
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

(function () {
  const Sprites = {
    dpr: 2,

    // draw(g, w, h) receives a context already scaled so it can draw in
    // design units; the backing store is w*dpr × h*dpr.
    make(w, h, draw, scale) {
      const s = scale || this.dpr;
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.ceil(w * s));
      c.height = Math.max(1, Math.ceil(h * s));
      const g = c.getContext("2d");
      g.scale(s, s);
      draw(g, w, h);
      return { canvas: c, w, h };
    },

    // Radial glow. stops: [[offset, "rgba(...)"], ...] from centre out.
    glow(r, stops, scale) {
      return this.make(r * 2, r * 2, (g) => {
        const grd = g.createRadialGradient(r, r, 0, r, r, r);
        for (const [o, c] of stops) grd.addColorStop(o, c);
        g.fillStyle = grd;
        g.fillRect(0, 0, r * 2, r * 2);
      }, scale);
    },

    // Soft-edged disc with a flatter centre than a plain gradient — a
    // better lamp pool: bright and even under the lamp, falling off
    // toward the rim.
    pool(r, rgb, peak, scale) {
      return this.glow(r, [[0, `rgba(${rgb},${peak})`], [0.3, `rgba(${rgb},${peak * 0.92})`], [0.62, `rgba(${rgb},${peak * 0.42})`], [0.85, `rgba(${rgb},${peak * 0.1})`], [1, `rgba(${rgb},0)`]], scale);
    },

    // Film grain tile, drawn as a pattern at low alpha.
    noise(size, scale) {
      return this.make(size, size, (g, w, h) => {
        const s = scale || this.dpr;
        const img = g.getImageData(0, 0, Math.ceil(w * s), Math.ceil(h * s));
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = 96 + Math.random() * 96;
          d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
        }
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.putImageData(img, 0, 0);
      }, scale);
    },

    draw(ctx, sp, x, y, w, h, alpha, rot) {
      w = w || sp.w; h = h || sp.h;
      if (alpha !== undefined) ctx.globalAlpha = alpha;
      if (rot) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
        ctx.drawImage(sp.canvas, -w / 2, -h / 2, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(sp.canvas, x - w / 2, y - h / 2, w, h);
      }
      if (alpha !== undefined) ctx.globalAlpha = 1;
    }
  };

  class LightLayer {
    constructor(w, h) {
      this.w = w; this.h = h;
      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d");
      this.scale = 1;
      this.cutter = null;
    }
    resize(scale) {
      // Lighting is soft by nature; rendering it at half resolution is
      // invisible and halves the fill cost of the layer.
      this.scale = Math.max(0.5, scale * 0.5);
      this.canvas.width = Math.ceil(this.w * this.scale);
      this.canvas.height = Math.ceil(this.h * this.scale);
      this.cutter = Sprites.pool(128, "255,255,255", 1, 1);
    }
    begin(darkness, rgb) {
      const g = this.ctx;
      g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.clearRect(0, 0, this.w, this.h);
      g.fillStyle = `rgba(${rgb},${darkness})`;
      g.fillRect(0, 0, this.w, this.h);
      g.globalCompositeOperation = "destination-out";
    }
    // Cut a pool of light: an ellipse rx×ry at (x, y), `strength` 0..1.
    cut(x, y, rx, ry, strength) {
      if (strength <= 0.001) return;
      const g = this.ctx;
      g.globalAlpha = Math.min(1, strength);
      g.drawImage(this.cutter.canvas, x - rx, y - ry, rx * 2, ry * 2);
    }
    end(ctx) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.drawImage(this.canvas, 0, 0, this.w, this.h);
    }
  }

  // Additive light at half resolution. Every warm pool, lamp core, signal
  // glow and muzzle flash is soft, so drawing them at half the pixels is
  // invisible — and it turns several full-screen additive blits (the
  // fill-rate cost that makes phones drop frames) into one.
  class GlowLayer {
    constructor(w, h) {
      this.w = w; this.h = h;
      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d");
      this.scale = 1;
      this.used = false;
    }
    resize(scale) {
      this.scale = Math.max(0.5, scale * 0.5);
      this.canvas.width = Math.ceil(this.w * this.scale);
      this.canvas.height = Math.ceil(this.h * this.scale);
    }
    begin() {
      const g = this.ctx;
      g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.clearRect(0, 0, this.w, this.h);
      g.globalCompositeOperation = "lighter";
      this.used = false;
    }
    end(ctx) {
      if (!this.used) return;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 1;
      ctx.drawImage(this.canvas, 0, 0, this.w, this.h);
      ctx.globalCompositeOperation = "source-over";
    }
  }

  L7.Sprites = Sprites;
  L7.LightLayer = LightLayer;
  L7.GlowLayer = GlowLayer;
})();
