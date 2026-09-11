/* ===================================================================
   Pooled particle emitters. Every particle object is allocated once
   at construction and reused forever — allocating per frame is what
   makes phone games hitch, because the garbage collector eventually
   runs, and it runs during your smoothest moment.

   A particle is drawn either as a sprite (an offscreen canvas) or as
   a filled rectangle, with optional spin, gravity and drag, and alpha
   and size curves over its life.
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

(function () {
  const DEG = Math.PI / 180;

  class Emitter {
    constructor(o) {
      this.rng = o.rng || Math.random;
      this.max = o.max || 120;
      this.cfg = Object.assign({
        speed: [60, 160], angle: [0, 360], gravity: 0, drag: 0,
        life: [0.4, 0.8], size: [2, 4], sizeEnd: 1, aspect: 1,
        alpha: [1, 0], spin: [0, 0], blend: "source-over",
        color: "#ffffff", sprite: null, jitter: 0, rotateToVelocity: false
      }, o);
      this.pool = [];
      for (let i = 0; i < this.max; i++) {
        this.pool.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, rot: 0, spin: 0, color: null, sprite: null, aspect: 1 });
      }
      this.alive = 0;
      this.streamAcc = 0;
    }

    r(lo, hi) { return lo + this.rng() * (hi - lo); }

    spawn(x, y, over) {
      const c = over ? Object.assign({}, this.cfg, over) : this.cfg;
      for (let i = 0; i < this.pool.length; i++) {
        const p = this.pool[i];
        if (p.alive) continue;
        const a = this.r(c.angle[0], c.angle[1]) * DEG, s = this.r(c.speed[0], c.speed[1]);
        p.alive = true;
        p.x = x + (c.jitter ? this.r(-c.jitter, c.jitter) : 0);
        p.y = y + (c.jitter ? this.r(-c.jitter, c.jitter) : 0);
        p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
        p.max = p.life = this.r(c.life[0], c.life[1]);
        p.size = this.r(c.size[0], c.size[1]);
        p.rot = this.rng() * Math.PI * 2;
        p.spin = this.r(c.spin[0], c.spin[1]) * DEG;
        p.color = Array.isArray(c.color) ? c.color[Math.floor(this.rng() * c.color.length)] : c.color;
        p.sprite = c.sprite;
        p.aspect = Array.isArray(c.aspect) ? this.r(c.aspect[0], c.aspect[1]) : c.aspect;
        p.gravity = c.gravity; p.drag = c.drag; p.alphaFrom = c.alpha[0]; p.alphaTo = c.alpha[1];
        p.sizeEnd = c.sizeEnd; p.rotV = c.rotateToVelocity;
        this.alive++;
        return p;
      }
      return null;   // pool exhausted — drop the particle, never allocate
    }

    explode(n, x, y, over) { for (let i = 0; i < n; i++) this.spawn(x, y, over); }

    // Continuous emission at `rate` per second inside a w×h box around (x, y).
    stream(rate, dt, x, y, w = 0, h = 0, over) {
      this.streamAcc += rate * dt;
      while (this.streamAcc >= 1) {
        this.streamAcc -= 1;
        this.spawn(x + this.r(-w / 2, w / 2), y + this.r(-h / 2, h / 2), over);
      }
    }

    update(dt) {
      for (let i = 0; i < this.pool.length; i++) {
        const p = this.pool[i];
        if (!p.alive) continue;
        p.life -= dt;
        if (p.life <= 0) { p.alive = false; this.alive--; continue; }
        p.vy += p.gravity * dt;
        if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
      }
    }

    draw(ctx) {
      if (!this.alive) return;
      ctx.globalCompositeOperation = this.cfg.blend;
      for (let i = 0; i < this.pool.length; i++) {
        const p = this.pool[i];
        if (!p.alive) continue;
        const k = 1 - p.life / p.max;                       // 0 born … 1 dying
        const alpha = p.alphaFrom + (p.alphaTo - p.alphaFrom) * k;
        const size = p.size * (1 + (p.sizeEnd - 1) * k);
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        const rot = p.rotV ? Math.atan2(p.vy, p.vx) : p.rot;
        if (rot) {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rot);
          if (p.sprite) ctx.drawImage(p.sprite.canvas, -size / 2, -size / (2 * p.aspect), size, size / p.aspect);
          else { ctx.fillStyle = p.color; ctx.fillRect(-size / 2, -size / (2 * p.aspect), size, size / p.aspect); }
          ctx.restore();
        } else if (p.sprite) {
          ctx.drawImage(p.sprite.canvas, p.x - size / 2, p.y - size / (2 * p.aspect), size, size / p.aspect);
        } else {
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - size / 2, p.y - size / (2 * p.aspect), size, size / p.aspect);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    clear() { for (const p of this.pool) p.alive = false; this.alive = 0; }
  }

  L7.Emitter = Emitter;
})();

if (typeof module !== "undefined") module.exports = L7.Emitter;
