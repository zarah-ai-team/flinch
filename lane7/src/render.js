/* ===================================================================
   LANE 7 — Renderer
   Reads the Sim, writes pixels, never changes game state. Everything
   here is presentation: where the carrier appears to be while it
   moves, how a lamp flickers on, what a hit looks like. If this file
   were deleted the game would still be correct — just invisible.

   Frame order, in design units under the camera transform:
     backdrop → wall marks → cards (far to near) → particles
     → darkness with lamp pools cut out → additive glows
   then in screen space: signal pulse, camera flash, vignette, grain.
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

(function () {
  const S = L7.Sprites, TAU = Math.PI * 2;
  const lerp  = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Visual constants. Not gameplay — those live in CONFIG.
  const LOOK = {
    gloom: "4,7,8",
    ambientCold: 0.55, ambientFloor: 0.06,
    lampRgb: "232,199,122",
    poolRadius: [300, 210],            // near … far, before the level's lamp factor
    signal: { x: 54, y: 846 },
    // The shooter's pistol: bottom right, drawn in screen space, aimed at
    // the vanishing point. `barrel` is pivot-to-muzzle; the flash, smoke
    // and light all come from that tip. Recoil is visual, so it lives here.
    gun: { x: 470, y: 962, aimX: 270, aimY: 340, barrel: 186, recoilPx: 22, recoilDeg: 6, slidePx: 15, slideMs: 110, returnMs: 240 },
    opp: { x: 585, y: 700 },
    paper:    ["#d8c9a8", "#cbb992", "#e4d8bb"],
    white:    ["#ebe7de", "#d9d5cc", "#f4f1ea"],
    concrete: ["#5a6466", "#6c7779", "#3f4749"],
    brass: "#c9a458"
  };

  class CardView {
    constructor(kind, index, rng) {
      this.kind = kind; this.index = index;
      this.x = 270; this.y = 480; this.s = 1; this.d = 0; this.ceilY = -40;
      this.rot = 0; this.rotV = 0; this.squash = 1; this.sqV = 0;
      this.lamp = 0; this.flick = 1; this.phase = rng() * 10;
      this.dip = 1;                // momentary lamp dips: a hit shakes the tube, the title bay has a draft
      this.sway = 0;               // lamp shade drift on the title, in px
      this.holes = []; this.alive = true;
      this.face = 0;               // what is drawn: exact Sim turn while exposed, eased away otherwise
      this.faceOverride = null;    // title screen only
    }
  }

  class Renderer {
    constructor(o) {
      this.canvas = o.canvas; this.sim = o.sim; this.cfg = o.cfg;
      this.tweens = o.tweens; this.rng = o.rng; this.cam = o.camera; this.clock = o.clock;
      this.W = this.cfg.design.w; this.H = this.cfg.design.h;
      this.ctx = this.canvas.getContext("2d", { alpha: false, desynchronized: true });
      this.light = new L7.LightLayer(this.W, this.H);
      this.glow = new L7.GlowLayer(this.W, this.H);
      this.scale = 1;
      this.reduced = !!o.reduced;
      this.grainOn = !this.reduced;

      this.ambient = LOOK.ambientCold;
      this.cards = [];
      this.target = null;
      this.signal = { r: 0, g: 0 };
      this.pulse = { a: 0, rgb: "110,200,110" };
      this.muzzleA = 0; this.oppFlash = 0;
      this.rings = []; this.flashes = [];
      this.frame = 0;
      this.gun = { kick: 0, slide: 0 };
      this.floats = [];                 // "+5" / "+3" rising from the hit
      this.tracer = { a: 0, x: 0, y: 0 };
      this.order = [];                  // draw order, reused every frame (no per-frame allocation)
      this.byDepth = (a, b) => b.d - a.d;
      this.buildGun();
      this.titleFlickerIn = 2;

      this.buildSprites();
      this.buildEmitters();
      this.bind();
    }

    /* ---------- resolution ---------- */
    // pxPerUnit: device pixels per design unit (CSS size × DPR ÷ 540).
    // Sprites are rebuilt only when that crosses a half-step, so a
    // slowly resizing window doesn't regenerate textures every frame.
    setScale(pxPerUnit) {
      this.scale = pxPerUnit;
      this.canvas.width = Math.max(1, Math.round(this.W * pxPerUnit));
      this.canvas.height = Math.max(1, Math.round(this.H * pxPerUnit));
      this.light.resize(pxPerUnit);
      this.glow.resize(pxPerUnit);
      const q = clamp(Math.round(pxPerUnit * 2) / 2, 1, 3);
      if (S.dpr !== q) { S.dpr = q; this.buildSprites(); this.buildEmitters(); }
    }

    // Fonts arrive after first paint; the card's printed numbers and the
    // wall stencil are baked into sprites, so bake them again.
    rebuild() { this.buildSprites(); this.buildEmitters(); }

    /* ---------- sprites ---------- */
    buildSprites() {
      const W = this.W, H = this.H, P = this.cfg.perspective, T = this.cfg.target;
      const sp = this.sp = {};

      sp.backdrop = S.make(W, H, (g) => this.drawBackdrop(g, W, H, P));
      sp.card = S.make(T.cardW, T.cardH, (g) => this.drawCard(g, T, false));
      sp.decoy = S.make(T.cardW, T.cardH, (g) => this.drawCard(g, T, true));
      // Soft shadow built from stacked rects rather than ctx.filter, which
      // older Safari ignores (and would leave a hard black rectangle).
      sp.shadow = S.make(T.cardW + 40, T.cardH + 40, (g, w, h) => {
        for (let i = 0; i < 12; i++) {
          const inset = 20 - i * 1.6;
          g.fillStyle = `rgba(0,0,0,${0.07})`;
          g.fillRect(inset, inset, w - inset * 2, h - inset * 2);
        }
      });
      sp.holes = [0, 1, 2].map((i) => S.make(20, 20, (g) => this.drawHole(g, i)));
      sp.mark = S.make(18, 18, (g) => {
        g.fillStyle = "rgba(120,132,130,.28)"; g.beginPath(); g.arc(9, 9, 8, 0, TAU); g.fill();
        g.fillStyle = "rgba(8,10,10,.85)"; g.beginPath(); g.arc(9, 9, 3.6, 0, TAU); g.fill();
      });
      sp.shade = S.make(52, 28, (g) => {
        g.fillStyle = "#1b2022"; g.beginPath(); g.moveTo(15, 2); g.lineTo(37, 2); g.lineTo(51, 26); g.lineTo(1, 26); g.closePath(); g.fill();
        g.strokeStyle = "rgba(210,220,215,.16)"; g.lineWidth = 1; g.stroke();
        g.fillStyle = "rgba(255,240,205,.16)"; g.fillRect(4, 24, 44, 3);
      });
      sp.trolley = S.make(32, 16, (g) => {
        g.fillStyle = "#1a1f21"; g.fillRect(2, 5, 28, 9);
        g.fillStyle = "#2b3335"; g.beginPath(); g.arc(8, 5, 3.2, 0, TAU); g.arc(24, 5, 3.2, 0, TAU); g.fill();
        g.fillStyle = "rgba(200,215,210,.12)"; g.fillRect(2, 5, 28, 1);
      });

      sp.impact   = S.glow(30, [[0, "rgba(255,250,235,1)"], [0.3, "rgba(255,225,170,.7)"], [1, "rgba(255,190,110,0)"]]);
      sp.pool     = S.pool(256, LOOK.lampRgb, 0.55);
      sp.lampCore = S.glow(40, [[0, "rgba(255,246,220,.95)"], [0.25, "rgba(255,232,175,.55)"], [1, "rgba(255,220,150,0)"]]);
      sp.red      = S.pool(128, "225,72,52", 0.75);
      sp.green    = S.pool(128, "120,215,120", 0.85);
      sp.muzzle   = S.glow(220, [[0, "rgba(255,250,232,1)"], [0.16, "rgba(255,228,165,.9)"], [0.48, "rgba(255,172,92,.38)"], [1, "rgba(255,140,60,0)"]]);
      sp.opp      = S.glow(200, [[0, "rgba(255,226,180,.95)"], [0.3, "rgba(255,170,90,.55)"], [1, "rgba(255,140,60,0)"]]);
      sp.spark    = S.glow(8, [[0, "rgba(255,255,255,1)"], [0.4, "rgba(255,240,200,.8)"], [1, "rgba(255,200,120,0)"]]);
      sp.smoke    = S.glow(32, [[0, "rgba(150,158,156,.55)"], [0.6, "rgba(150,158,156,.2)"], [1, "rgba(150,158,156,0)"]]);
      sp.dust     = S.glow(4, [[0, "rgba(255,245,220,1)"], [1, "rgba(255,245,220,0)"]]);
      sp.vignette = S.make(W, H, (g) => {
        const r = g.createRadialGradient(W / 2, H * 0.47, H * 0.22, W / 2, H * 0.47, H * 0.78);
        r.addColorStop(0, "rgba(3,6,7,0)"); r.addColorStop(0.55, "rgba(3,6,7,.22)"); r.addColorStop(1, "rgba(3,6,7,.82)");
        g.fillStyle = r; g.fillRect(0, 0, W, H);
        const top = g.createLinearGradient(0, 0, 0, 120);
        top.addColorStop(0, "rgba(3,6,7,.55)"); top.addColorStop(1, "rgba(3,6,7,0)");
        g.fillStyle = top; g.fillRect(0, 0, W, 120);
      }, 1);
      // Grain pre-tiled to one oversize sheet: a single low-alpha blit per
      // frame instead of dozens of tiles under a blend mode phones hate.
      sp.grain = [0, 1].map(() => S.make(W + 128, H + 128, (g, w, h) => {
        const tile = S.noise(128, 1);
        for (let y = 0; y < h; y += 128) for (let x = 0; x < w; x += 128) g.drawImage(tile.canvas, x, y, 128, 128);
      }, 1));
      // Four-point impact star, drawn additive over the hit for a few frames.
      sp.star = S.make(64, 64, (g) => {
        g.translate(32, 32);
        g.fillStyle = "rgba(255,250,235,1)";
        for (const a of [0, Math.PI / 2]) {
          g.save(); g.rotate(a);
          g.beginPath(); g.moveTo(-30, 0); g.lineTo(0, -3); g.lineTo(30, 0); g.lineTo(0, 3); g.closePath(); g.fill();
          g.restore();
        }
        g.fillStyle = "rgba(255,240,200,.9)"; g.beginPath(); g.arc(0, 0, 4, 0, TAU); g.fill();
      });
      // Score floats, baked once so no text is laid out mid-hit.
      const floatText = (txt) => S.make(80, 44, (g, w, h) => {
        g.font = "700 34px 'Barlow Condensed', 'Arial Narrow', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
        g.lineJoin = "round"; g.lineWidth = 5; g.strokeStyle = "rgba(8,10,10,.85)"; g.strokeText(txt, w / 2, h / 2 + 1);
        g.fillStyle = "#e8d9b4"; g.fillText(txt, w / 2, h / 2 + 1);
      });
      sp.plus = { head: floatText("+" + this.cfg.points.head), body: floatText("+" + this.cfg.points.body) };
    }

    drawBackdrop(g, W, H, P) {
      const cx = W / 2;
      const nearL = cx - P.nearHalfW, nearR = cx + P.nearHalfW, farL = cx - P.farHalfW, farR = cx + P.farHalfW;

      g.fillStyle = "#0e1516"; g.fillRect(0, 0, W, H);

      // Ceiling with beams converging downrange.
      const ceil = g.createLinearGradient(0, P.nearCeilY, 0, P.farCeilY);
      ceil.addColorStop(0, "#1b2527"); ceil.addColorStop(1, "#0f1718");
      g.fillStyle = ceil;
      g.beginPath(); g.moveTo(nearL, P.nearCeilY); g.lineTo(nearR, P.nearCeilY); g.lineTo(farR, P.farCeilY); g.lineTo(farL, P.farCeilY); g.closePath(); g.fill();
      g.strokeStyle = "rgba(140,170,165,.07)"; g.lineWidth = 2;
      for (let i = 0; i <= 6; i++) {
        const u = i / 6 * 2 - 1;
        g.beginPath(); g.moveTo(cx + u * P.nearHalfW, P.nearCeilY); g.lineTo(cx + u * P.farHalfW, P.farCeilY); g.stroke();
      }
      for (const d of [0.32, 0.66]) {
        const y = lerp(P.nearCeilY, P.farCeilY, d), hw = lerp(P.nearHalfW, P.farHalfW, d);
        g.beginPath(); g.moveTo(cx - hw, y); g.lineTo(cx + hw, y); g.stroke();
      }

      // Side walls.
      for (const side of [-1, 1]) {
        const wall = g.createLinearGradient(cx + side * P.nearHalfW, 0, cx + side * P.farHalfW, 0);
        wall.addColorStop(0, "#131b1d"); wall.addColorStop(1, "#1a2426");
        g.fillStyle = wall;
        g.beginPath();
        g.moveTo(cx + side * P.nearHalfW, P.nearCeilY); g.lineTo(cx + side * P.farHalfW, P.farCeilY);
        g.lineTo(cx + side * P.farHalfW, P.farFloorY); g.lineTo(cx + side * P.nearHalfW, P.nearFloorY);
        g.closePath(); g.fill();
        // Baffle rails along the wall.
        g.strokeStyle = "rgba(150,175,170,.06)"; g.lineWidth = 3;
        for (const k of [0.25, 0.5, 0.75]) {
          g.beginPath();
          g.moveTo(cx + side * P.nearHalfW, lerp(P.nearCeilY, P.nearFloorY, k));
          g.lineTo(cx + side * P.farHalfW, lerp(P.farCeilY, P.farFloorY, k));
          g.stroke();
        }
      }

      // Back wall and the rubber bullet trap along its base.
      const back = g.createLinearGradient(0, P.farCeilY, 0, P.farFloorY);
      back.addColorStop(0, "#1e292b"); back.addColorStop(1, "#182123");
      g.fillStyle = back; g.fillRect(farL, P.farCeilY, farR - farL, P.farFloorY - P.farCeilY);
      g.strokeStyle = "rgba(0,0,0,.18)"; g.lineWidth = 1;
      for (let x = farL + 40; x < farR; x += 40) { g.beginPath(); g.moveTo(x, P.farCeilY); g.lineTo(x, P.farFloorY); g.stroke(); }
      g.fillStyle = "rgba(216,201,168,.055)";
      g.font = "700 150px 'Barlow Condensed', 'Arial Narrow', sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("7", cx, (P.farCeilY + P.farFloorY) / 2 + 4);
      // Rubber bullet trap along the base of the back wall.
      const trap = g.createLinearGradient(0, P.farFloorY - 30, 0, P.farFloorY);
      trap.addColorStop(0, "#151d1f"); trap.addColorStop(1, "#0e1516");
      g.fillStyle = trap; g.fillRect(farL, P.farFloorY - 30, farR - farL, 30);
      g.fillStyle = "rgba(200,220,215,.07)"; g.fillRect(farL, P.farFloorY - 30, farR - farL, 1.5);

      // Floor, lane edges, firing line, bench.
      const slope = (P.nearHalfW - P.farHalfW) / (P.nearFloorY - P.farFloorY);
      const bottomHW = P.nearHalfW + slope * (H - P.nearFloorY);
      const floor = g.createLinearGradient(0, P.farFloorY, 0, H);
      floor.addColorStop(0, "#131b1c"); floor.addColorStop(1, "#0a0f10");
      g.fillStyle = floor;
      g.beginPath(); g.moveTo(farL, P.farFloorY); g.lineTo(farR, P.farFloorY); g.lineTo(cx + bottomHW, H); g.lineTo(cx - bottomHW, H); g.closePath(); g.fill();
      g.strokeStyle = "rgba(150,170,165,.09)"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(farL, P.farFloorY); g.lineTo(cx - bottomHW, H); g.stroke();
      g.beginPath(); g.moveTo(farR, P.farFloorY); g.lineTo(cx + bottomHW, H); g.stroke();
      // A faint sheen where the lamps usually fall.
      const sheen = g.createRadialGradient(cx, P.nearFloorY - 60, 40, cx, P.nearFloorY - 60, 360);
      sheen.addColorStop(0, "rgba(160,180,175,.05)"); sheen.addColorStop(1, "rgba(160,180,175,0)");
      g.fillStyle = sheen; g.fillRect(0, P.farFloorY, W, H - P.farFloorY);

      const fy = 872;
      g.fillStyle = "rgba(196,72,58,.32)"; g.fillRect(0, fy, W, 10);
      g.fillStyle = "rgba(230,230,220,.22)";
      for (let x = 6; x < W; x += 30) g.fillRect(x, fy + 2, 14, 6);
      g.font = "600 9px Barlow, sans-serif"; g.textAlign = "left"; g.textBaseline = "alphabetic";
      g.fillStyle = "rgba(230,230,220,.28)"; g.fillText("FIRING LINE", 8, fy - 5);

      const bench = g.createLinearGradient(0, 906, 0, H);
      bench.addColorStop(0, "#0d1213"); bench.addColorStop(1, "#070a0b");
      g.fillStyle = bench; g.fillRect(0, 906, W, H - 906);
      g.fillStyle = "rgba(232,199,122,.14)"; g.fillRect(0, 906, W, 2);
    }

    drawCard(g, T, decoy) {
      const w = T.cardW, h = T.cardH, ox = w / 2, oy = -T.cardTop;
      g.fillStyle = decoy ? "#ebe7de" : "#d8c9a8"; g.fillRect(0, 0, w, h);
      const sh = g.createLinearGradient(0, 0, 0, h);
      sh.addColorStop(0, "rgba(255,250,235,.12)"); sh.addColorStop(1, "rgba(40,30,15,.12)");
      g.fillStyle = sh; g.fillRect(0, 0, w, h);
      // Paper grain: a few thousand faint specks.
      g.fillStyle = decoy ? "rgba(90,90,80,.09)" : "rgba(80,60,30,.11)";
      for (let i = 0; i < 2600; i++) g.fillRect(Math.random() * w, Math.random() * h, 1, 1);
      g.strokeStyle = decoy ? "rgba(70,70,60,.3)" : "rgba(90,75,50,.38)"; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, w - 1.5, h - 1.5);
      // Staples.
      g.fillStyle = "rgba(70,72,70,.65)"; g.fillRect(16, 7, 7, 2); g.fillRect(w - 23, 7, 7, 2);

      g.save(); g.translate(ox, oy);
      const poly = L7.Shapes.bodyPolygon;
      const path = () => { g.beginPath(); g.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]); g.closePath(); };
      if (!decoy) {
        g.fillStyle = "#14100e";
        path(); g.fill();
        g.beginPath(); g.arc(0, T.headY, T.headR, 0, TAU); g.fill();
        // Printed scoring zones: the rules are on the object, not in a tutorial.
        g.strokeStyle = "rgba(216,201,168,.42)"; g.lineWidth = 1.5; g.setLineDash([4, 4]);
        g.beginPath(); g.arc(0, T.headY, T.headR - 5, 0, TAU); g.stroke();
        g.beginPath(); g.ellipse(0, 26, 52, 62, 0, 0, TAU); g.stroke();
        g.setLineDash([]);
        g.fillStyle = "rgba(216,201,168,.5)";
        g.font = "600 15px Barlow, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText("5", 0, T.headY + 1); g.fillText("3", 0, 26);
        g.fillStyle = "rgba(20,16,14,.35)"; g.font = "500 8px 'Barlow Condensed', 'Arial Narrow', sans-serif";
        g.fillText("LANE 7  ·  B-27 SILHOUETTE  ·  HEAD 5  BODY 3", 0, h - oy - 9);
      } else {
        g.strokeStyle = "rgba(118,126,124,.8)"; g.lineWidth = 3;
        path(); g.stroke();
        g.beginPath(); g.arc(0, T.headY, T.headR, 0, TAU); g.stroke();
        g.strokeStyle = "rgba(190,52,42,.85)"; g.lineWidth = 6;
        g.beginPath(); g.arc(0, 18, 46, 0, TAU); g.stroke();
        g.beginPath(); g.moveTo(-32, -14); g.lineTo(32, 50); g.stroke();
        g.save(); g.translate(0, -138); g.rotate(-0.06);
        g.fillStyle = "rgba(190,52,42,.9)"; g.fillRect(-92, -12, 184, 24);
        g.fillStyle = "#f6f1e6"; g.font = "700 17px 'Barlow Condensed', 'Arial Narrow', sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("NO SHOOT", 0, 1);
        g.restore();
      }
      g.restore();
    }

    drawHole(g, variant) {
      const c = 10;
      g.fillStyle = "rgba(0,0,0,.3)"; g.beginPath(); g.arc(c + 1, c + 1.5, 7.5, 0, TAU); g.fill();
      // Torn rim: a ring of lighter flaps at uneven angles.
      g.fillStyle = "rgba(240,230,205,.7)";
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + variant * 0.9 + Math.sin(i * 3.1 + variant) * 0.3;
        const r = 5.2 + ((i * 7 + variant * 3) % 3);
        g.beginPath(); g.moveTo(c, c);
        g.lineTo(c + Math.cos(a - 0.35) * r, c + Math.sin(a - 0.35) * r);
        g.lineTo(c + Math.cos(a + 0.35) * r, c + Math.sin(a + 0.35) * r);
        g.closePath(); g.fill();
      }
      g.fillStyle = "#0a0908"; g.beginPath(); g.arc(c, c, 4.3, 0, TAU); g.fill();
    }

    /* ---------- particles ---------- */
    buildEmitters() {
      const rng = this.rng, sp = this.sp;
      this.em = {
        paper:    new L7.Emitter({ rng, max: 90,  color: LOOK.paper, size: [3, 7], aspect: [1.3, 2.6], spin: [-900, 900], speed: [90, 330], angle: [190, 350], gravity: 950, drag: 1.4, life: [0.5, 1.0], alpha: [1, 0.15] }),
        white:    new L7.Emitter({ rng, max: 40,  color: LOOK.white, size: [3, 7], aspect: [1.3, 2.6], spin: [-900, 900], speed: [90, 330], angle: [190, 350], gravity: 950, drag: 1.4, life: [0.5, 1.0], alpha: [1, 0.15] }),
        concrete: new L7.Emitter({ rng, max: 40,  color: LOOK.concrete, size: [2, 5], aspect: [1, 1.8], spin: [-500, 500], speed: [60, 220], angle: [200, 340], gravity: 1100, drag: 1, life: [0.4, 0.8], alpha: [1, 0.2] }),
        spark:    new L7.Emitter({ rng, max: 60,  sprite: sp.spark, blend: "lighter", size: [6, 14], aspect: [2.5, 4], speed: [220, 560], angle: [0, 360], gravity: 400, drag: 2.5, life: [0.08, 0.26], alpha: [1, 0], rotateToVelocity: true }),
        smoke:    new L7.Emitter({ rng, max: 30,  sprite: sp.smoke, size: [26, 46], sizeEnd: 2.4, speed: [14, 46], angle: [250, 290], drag: 0.9, life: [0.9, 1.7], alpha: [0.26, 0], spin: [-30, 30] }),
        dust:     new L7.Emitter({ rng, max: 120, sprite: sp.dust, blend: "lighter", size: [1.6, 3.4], speed: [3, 12], angle: [0, 360], life: [1.6, 3.2], alpha: [0.38, 0] }),
        casing:   new L7.Emitter({ rng, max: 6,   color: LOOK.brass, size: [8, 9], aspect: [2.1, 2.3], spin: [700, 1300], speed: [270, 340], angle: [-78, -60], gravity: 1500, life: [0.72, 0.72], alpha: [1, 1] })
      };
    }

    /* ---------- sim events ---------- */
    bind() {
      const sim = this.sim;
      sim.on("title", () => this.parkTitleCard());
      sim.on("level:start", (e) => this.onLevelStart(e));
      sim.on("round:begin", (e) => this.onRoundBegin(e));
      sim.on("hold", () => this.setSignal(1, 0));
      sim.on("go", () => this.onGo());
      sim.on("shot:player", (e) => this.onPlayerShot(e));
      sim.on("shot:opponent", () => this.onOpponentShot());
      sim.on("false-start", () => this.onFalseStart());
      sim.on("level:end", () => this.onLevelEnd());
    }

    setAmbient(v, ms = 320) {
      this.tweens.kill("ambient");
      this.tweens.add({ target: this, to: { ambient: v }, duration: ms, ease: "quadOut", realtime: true, tag: "ambient" });
    }
    setSignal(r, g) {
      this.tweens.kill("signal");
      this.tweens.add({ target: this.signal, to: { r, g }, duration: 70, ease: "quadOut", realtime: true, tag: "signal" });
    }
    holdAmbient() { const P = this.sim.params; return lerp(LOOK.ambientFloor, LOOK.ambientCold, P.holdLight); }

    parkTitleCard() {
      this.tweens.kill("carrier");
      for (const c of this.cards) if (c.kind === "decoy") this.retire(c);
      const home = this.sim.perspective(0.12, 0);
      let v = this.target;
      if (!v) { v = new CardView("target", -1, this.rng); this.cards.push(v); this.target = v; Object.assign(v, { x: home.x, y: home.y + 40, s: home.s, d: home.d, ceilY: home.ceilY }); }
      v.holes = []; v.faceOverride = 0;
      this.tweens.add({ target: v, to: { x: home.x, y: home.y, s: home.s, d: home.d, ceilY: home.ceilY }, duration: 700, ease: "cubicOut", tag: "carrier" });
      this.tweens.add({ target: v, to: { faceOverride: 1 }, duration: 260, ease: "backOut", delay: 400, tag: "carrier" });
      this.tweens.add({ target: v, to: { lamp: 0.8 }, duration: 500, delay: 300, tag: "lamp" });
      this.setSignal(0, 0);
      this.setAmbient(LOOK.ambientCold, 600);
    }

    onLevelStart() {
      if (this.target) { this.target.holes = []; this.target.faceOverride = null; }
      this.setAmbient(this.holdAmbient(), 500);
    }

    // Card views come and go with the round; the target's view persists
    // across the level so its holes accumulate and its carrier is seen
    // to travel between spots.
    onRoundBegin(e) {
      this.tweens.kill("carrier"); this.tweens.kill("lamp");
      for (const c of this.cards) this.tweens.add({ target: c, to: { lamp: 0 }, duration: 140, tag: "lamp" });
      this.setSignal(0, 0);
      this.setAmbient(this.holdAmbient(), 260);

      let v = this.target;
      if (!v) { v = new CardView("target", -1, this.rng); this.cards.push(v); this.target = v; Object.assign(v, { x: e.from.x, y: e.from.y, s: e.from.s, d: e.from.d, ceilY: e.from.ceilY }); }
      v.faceOverride = null;
      const t = e.target;
      this.tweens.add({ target: v, to: { x: t.x, y: t.y, s: t.s, d: t.d, ceilY: t.ceilY }, duration: e.moveMs, ease: "cubicInOut", tag: "carrier",
        onComplete: () => { v.rotV += this.rng() < 0.5 ? -0.9 : 0.9; } });
      // Retire last round's decoys, bring in this round's.
      for (const c of this.cards) if (c.kind === "decoy" && c.alive) this.retire(c);
      e.decoys.forEach((dc, i) => {
        const nv = new CardView("decoy", i, this.rng);
        const fromX = dc.x < this.W / 2 ? -160 : this.W + 160;
        Object.assign(nv, { x: fromX, y: dc.y, s: dc.s, d: dc.d, ceilY: dc.ceilY });
        this.cards.push(nv);
        this.tweens.add({ target: nv, to: { x: dc.x }, duration: e.moveMs, ease: "cubicInOut", tag: "carrier",
          onComplete: () => { nv.rotV += this.rng() < 0.5 ? -0.8 : 0.8; } });
      });
    }

    retire(c) {
      c.alive = false;
      this.tweens.killTarget(c);
      const toX = c.x < this.W / 2 ? -160 : this.W + 160;
      this.tweens.add({ target: c, to: { x: toX, lamp: 0 }, duration: 520, ease: "cubicIn", tag: "retire",
        onComplete: () => { this.cards = this.cards.filter(k => k !== c); } });
    }

    onGo() {
      this.setSignal(0, 1);
      this.pulse.rgb = "110,200,110";
      this.tweens.add({ from: 1, to: 0, duration: 240, ease: "quadOut", realtime: true, onUpdate: (v) => { this.pulse.a = v; } });
      const lampLevel = this.sim.params.lamp;
      for (const c of this.cards) {
        if (!c.alive) continue;
        // Fluorescent ignition: a couple of false starts, then steady.
        this.tweens.keyframes([[1, 25], [0.25, 30], [1, 35], [0.65, 45], [1, 60]], (v) => { c.lamp = v * lampLevel; },
          { from: 0, tag: "lamp", delay: c.kind === "decoy" ? 20 + c.index * 15 : 0 });
      }
    }

    onPlayerShot(e) {
      const F = this.cfg.feel;
      // The shooter's pistol: flash at the muzzle, recoil, slide cycle, smoke, brass.
      const G = LOOK.gun, gg = this.gunGeo;
      this.muzzleA = 1;
      this.tweens.add({ from: 1, to: 0, duration: 120, ease: "expoOut", realtime: true, onUpdate: (v) => { this.muzzleA = v; } });
      this.cam.flash(0.11);
      this.tweens.kill("gun");
      if (!this.reduced) { this.gun.kick = 1; this.tweens.add({ target: this.gun, to: { kick: 0 }, duration: G.returnMs, ease: "cubicOut", tag: "gun" }); }
      this.tweens.keyframes([[1, G.slideMs * 0.4, "quadOut"], [0, G.slideMs * 0.6, "quadIn"]], (v) => { this.gun.slide = v; }, { from: 0, tag: "gun" });
      this.em.smoke.explode(4, gg.muzzle[0], gg.muzzle[1] - 10, { jitter: 10 });
      this.em.spark.explode(3, gg.muzzle[0], gg.muzzle[1], { speed: [120, 260], angle: [230, 310], life: [0.05, 0.12] });
      this.em.casing.explode(1, gg.eject[0], gg.eject[1]);
      this.impact(e.x, e.y, e.zone === "head" ? 1.25 : 0.9);
      this.trace(e.x, e.y);

      const view = e.zone === "decoy" ? this.cards.find(c => c.kind === "decoy" && c.index === e.index && c.alive) : this.target;
      if (e.zone === "head" || e.zone === "body") {
        const head = e.zone === "head";
        this.cam.addTrauma(head ? F.trauma.head : F.trauma.body);
        this.cam.punch(this.tweens, head ? F.zoom.head : F.zoom.body, e.x, e.y);
        this.clock.hitstop(head ? F.hitstopMs.head : F.hitstopMs.body);
        if (head && !this.reduced) this.clock.slowMo(F.slowMo.scale, F.slowMo.ms);
        this.em.paper.explode(head ? 22 : 13, e.x, e.y);
        // A few bigger torn pieces that flutter, and a puff of paper dust.
        this.em.paper.explode(4, e.x, e.y, { size: [9, 15], aspect: [1.5, 3], speed: [50, 170], spin: [-420, 420], life: [0.8, 1.3], gravity: 700 });
        this.em.smoke.explode(2, e.x, e.y, { jitter: 6, size: [10, 16], sizeEnd: 2, alpha: [0.22, 0], life: [0.3, 0.55], speed: [10, 30] });
        this.em.spark.explode(head ? 16 : 6, e.x, e.y);
        this.ring(e.x, e.y, "232,220,190", head ? 74 : 46, head ? 380 : 260);
        this.float(e.zone, e.x, e.y - 16);
        if (e.best) {
          // A new personal best: a gold ring that outlives the hit, more
          // sparks, a warm flash and the lamp jolting on its arm.
          this.ring(e.x, e.y, "255,218,130", 130, 700);
          this.em.spark.explode(14, e.x, e.y, { speed: [160, 420] });
          this.cam.flash(0.07, "255,232,180");
          this.tweens.keyframes([[0.55, 40], [1, 160]], (v) => { view.dip = v; }, { from: 1, tag: "dip" });
        } else if (head) {
          this.tweens.keyframes([[0.7, 30], [1, 110]], (v) => { view.dip = v; }, { from: 1, tag: "dip" });
        }
        this.punchCard(view, e.lx);
        this.addHole(view, e.lx, e.ly);
      } else if (e.zone === "decoy") {
        this.cam.addTrauma(F.trauma.miss);
        this.em.white.explode(12, e.x, e.y);
        this.punchCard(view, e.lx);
        this.addHole(view, e.lx, e.ly);
      } else if (e.zone === "card") {
        this.cam.addTrauma(F.trauma.miss);
        this.em.paper.explode(8, e.x, e.y);
        this.punchCard(view, e.lx);
        this.addHole(view, e.lx, e.ly);
      } else {
        this.cam.addTrauma(F.trauma.miss);
        this.em.concrete.explode(10, e.x, e.y);
        this.em.smoke.explode(2, e.x, e.y, { jitter: 6, size: [12, 20], alpha: [0.18, 0] });
      }
    }

    punchCard(view, lx) {
      if (!view) return;
      view.rotV += (lx > 0 ? -1 : 1) * (0.7 + Math.min(1, Math.abs(lx) / 110) * 1.6);
      view.sqV -= 2.2;
    }
    addHole(view, lx, ly) {
      if (!view) return;
      view.holes.push({ lx, ly, v: Math.floor(this.rng() * 3), rot: this.rng() * TAU, age: 0 });
      if (view.holes.length > this.cfg.maxHoles) view.holes.shift();
    }
    ring(x, y, rgb, maxR = 74, ms = 380) {
      const r = { x, y, r: 6, a: 0.9, rgb };
      this.rings.push(r);
      this.tweens.add({ target: r, to: { r: maxR, a: 0 }, duration: ms, ease: "cubicOut", onComplete: () => { this.rings = this.rings.filter(k => k !== r); } });
    }
    // A bright pop at the point of impact. Real time, so it reads through hit-stop.
    impact(x, y, k = 1) {
      const fl = { x, y, r: 36 * k, a: 1, rot: this.rng() * TAU };
      this.flashes.push(fl);
      this.tweens.add({ target: fl, to: { r: 70 * k, a: 0 }, duration: 110, ease: "quadOut", realtime: true, onComplete: () => { this.flashes = this.flashes.filter(q => q !== fl); } });
    }

    // A streak from the muzzle to the impact for a few frames: it ties the
    // pistol at the bottom of the screen to the hole that just appeared.
    trace(x, y) {
      this.tracer.x = x; this.tracer.y = y; this.tracer.a = 1;
      this.tweens.kill("tracer");
      this.tweens.add({ from: 1, to: 0, duration: 60, ease: "quadOut", realtime: true, tag: "tracer", onUpdate: (v) => { this.tracer.a = v; } });
    }
    float(zone, x, y) {
      const f = { x, y, a: 1, s: 0.6, sprite: this.sp.plus[zone] };
      this.floats.push(f);
      this.tweens.add({ target: f, to: { y: y - 54, s: 1 }, duration: 640, ease: "cubicOut", realtime: true });
      this.tweens.add({ target: f, to: { a: 0 }, duration: 640, ease: "quadIn", realtime: true, onComplete: () => { this.floats = this.floats.filter(q => q !== f); } });
    }

    onOpponentShot() {
      this.oppFlash = 1;
      this.tweens.add({ from: 1, to: 0, duration: 140, ease: "expoOut", realtime: true, onUpdate: (v) => { this.oppFlash = v; } });
      this.cam.addTrauma(this.cfg.feel.trauma.opp);
    }

    onFalseStart() {
      this.cam.addTrauma(this.cfg.feel.trauma.early);
      this.pulse.rgb = "225,72,52";
      this.tweens.add({ from: 1, to: 0, duration: 420, ease: "quadOut", realtime: true, onUpdate: (v) => { this.pulse.a = v; } });
      this.setSignal(1, 0);
    }

    onLevelEnd() {
      this.setSignal(0, 0);
      this.setAmbient(Math.max(this.ambient, 0.28), 900);
    }

    /* ---------- per frame ---------- */
    update(dtGame) {
      this.frame++;
      const sim = this.sim;
      const exposed = sim.exposed && (sim.state === "FIRE" || sim.state === "BANNER");
      const awayRate = 1000 / (sim.params.turnMs * 1.8);
      for (const c of this.cards) {
        // While the card is live its drawn turn IS the Sim's turn, so the
        // hit test and the picture can't disagree. Otherwise ease it away.
        if (c.faceOverride !== null) c.face = c.faceOverride;
        else if (exposed) c.face = sim.turn;
        else c.face = Math.max(0, c.face - dtGame * awayRate);

        // A mover: while the card is exposed the view follows the Sim's live x.
        if (c.kind === "target" && exposed && sim.target) c.x = sim.target.x;
        for (const h of c.holes) h.age += dtGame;

        // Hanging-card physics: a light spring on rotation and a squash
        // that recovers, so a hit visibly rocks the card on its clip.
        c.rotV += (-c.rot * 70 - c.rotV * 4.5) * dtGame;
        c.rot += c.rotV * dtGame;
        c.sqV += (-(c.squash - 1) * 260 - c.sqV * 16) * dtGame;
        c.squash += c.sqV * dtGame;
        const t = this.cam.time * 1000 + c.phase * 1000;
        c.flick = (0.94 + 0.04 * Math.sin(t * 0.021) + 0.02 * Math.sin(t * 0.137)) * c.dip;
        // Parked on the title screen: an idle sway so the range feels alive.
        if (c.faceOverride !== null && sim.state === "TITLE") c.rotV += Math.sin(this.cam.time * 1.3 + c.phase) * 0.035 * dtGame * 60;
        // A draft in the bay: the lamp shade drifts on the title and settles once the range is hot.
        c.sway = sim.state === "TITLE" ? Math.sin(this.cam.time * 0.8 + c.phase) * 5 : c.sway * Math.max(0, 1 - dtGame * 3);
        if (c.lamp > 0.05 && c.alive) {
          this.em.dust.stream(10 * c.lamp, dtGame, c.x, c.y - 10 * c.s, 240 * c.s, 320 * c.s);
        }
      }
      // The title lamp is an old tube: every few seconds it stutters.
      if (sim.state === "TITLE" && this.target) {
        this.titleFlickerIn -= dtGame;
        if (this.titleFlickerIn <= 0) {
          this.titleFlickerIn = 2.5 + this.rng() * 5;
          const v = this.target;
          this.tweens.keyframes([[0.45, 30], [1, 40], [0.75, 25], [1, 90]], (k) => { v.dip = k; }, { from: 1, tag: "dip" });
        }
      }
      for (const k in this.em) this.em[k].update(dtGame);
    }

    lampPos(c) { return { x: c.x + c.sway, y: c.y + this.cfg.target.cardTop * c.s - 62 * c.s }; }

    draw() {
      const ctx = this.ctx, W = this.W, H = this.H, sim = this.sim, sp = this.sp, T = this.cfg.target;
      this.cam.apply(ctx, this.scale);
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      ctx.drawImage(sp.backdrop.canvas, 0, 0, W, H);

      for (const m of sim.wallMarks) S.draw(ctx, sp.mark, m.x, m.y, 18, 18);

      // Cards, far to near.
      const cards = this.order;
      cards.length = 0;
      for (const c of this.cards) cards.push(c);
      cards.sort(this.byDepth);
      for (const c of cards) this.drawCardView(ctx, c, T);

      this.em.smoke.draw(ctx);
      this.em.paper.draw(ctx); this.em.white.draw(ctx); this.em.concrete.draw(ctx); this.em.casing.draw(ctx);

      /* Darkness with the lamps cut out. */
      const L = this.light;
      L.begin(clamp(1 - this.ambient, 0, 1), LOOK.gloom);
      for (const c of cards) {
        if (c.lamp <= 0.01) continue;
        const R = lerp(LOOK.poolRadius[0], LOOK.poolRadius[1], c.d) * (0.75 + 0.25 * c.lamp);
        L.cut(c.x, c.y - 30 * c.s, R, R * 1.18, Math.min(1, c.lamp * c.flick * 1.15));
      }
      const sig = Math.max(this.signal.r, this.signal.g);
      if (sig > 0) L.cut(LOOK.signal.x, LOOK.signal.y, 110, 80, 0.45 * sig);
      if (this.muzzleA > 0) L.cut(this.gunGeo.muzzle[0], this.gunGeo.muzzle[1], 240 * this.muzzleA + 60, 220 * this.muzzleA + 50, this.muzzleA);
      if (this.oppFlash > 0) L.cut(LOOK.opp.x, LOOK.opp.y, 300 * this.oppFlash + 40, 260 * this.oppFlash + 40, this.oppFlash * 0.85);
      L.end(ctx);

      /* Additive light: the big soft glows go through the half-resolution
         glow layer and land on the world as one blit. */
      const G = this.glow, gc = G.ctx;
      G.begin();
      for (const c of cards) {
        if (c.lamp <= 0.01) continue;
        const lp = this.lampPos(c);
        const R = lerp(LOOK.poolRadius[0], LOOK.poolRadius[1], c.d);
        S.draw(gc, sp.pool, c.x, c.y - 20 * c.s, R * 2.1, R * 2.4, 0.42 * c.lamp * c.flick);
        S.draw(gc, sp.lampCore, lp.x, lp.y + 14 * c.s, 70 * c.s, 70 * c.s, c.lamp * c.flick);
        G.used = true;
      }
      if (this.signal.r > 0) { S.draw(gc, sp.red, LOOK.signal.x, LOOK.signal.y, 260, 260, 0.5 * this.signal.r); G.used = true; }
      if (this.signal.g > 0) { S.draw(gc, sp.green, LOOK.signal.x, LOOK.signal.y, 270, 270, 0.55 * this.signal.g); G.used = true; }
      if (this.muzzleA > 0) {
        const mx = this.gunGeo.muzzle[0], my = this.gunGeo.muzzle[1], a = this.muzzleA;
        S.draw(gc, sp.muzzle, mx, my, 360 * (0.7 + 0.3 * a), 340 * (0.7 + 0.3 * a), a);
        S.draw(gc, sp.muzzle, mx, my - 6, 150, 150, a * 0.9);
        G.used = true;
      }
      if (this.oppFlash > 0) { S.draw(gc, sp.opp, LOOK.opp.x, LOOK.opp.y, 540, 540, this.oppFlash); G.used = true; }
      G.end(ctx);

      /* Small, sharp additive details stay at full resolution. */
      ctx.globalCompositeOperation = "lighter";
      if (this.tracer.a > 0) {
        const m = this.gunGeo.muzzle, tr = this.tracer;
        ctx.strokeStyle = `rgba(255,236,190,${0.3 * tr.a})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(m[0], m[1]); ctx.lineTo(tr.x, tr.y); ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${0.45 * tr.a})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(m[0], m[1]); ctx.lineTo(tr.x, tr.y); ctx.stroke();
      }
      for (const fl of this.flashes) {
        S.draw(ctx, sp.impact, fl.x, fl.y, fl.r, fl.r, fl.a);
        S.draw(ctx, sp.star, fl.x, fl.y, fl.r * 1.9, fl.r * 1.9, fl.a, fl.rot);
      }
      for (const r of this.rings) {
        ctx.globalAlpha = r.a; ctx.strokeStyle = `rgba(${r.rgb},1)`; ctx.lineWidth = 3 * (1 - r.a) + 1.5;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      this.em.spark.draw(ctx);
      this.em.dust.draw(ctx);
      ctx.globalCompositeOperation = "source-over";
      for (const f of this.floats) S.draw(ctx, f.sprite, f.x, f.y, 80 * f.s, 44 * f.s, f.a);

      /* Signal lamp housing at the firing line (drawn after lighting so it is always legible). */
      this.drawSignalHousing(ctx);

      /* Screen space: the pistol first, then the full-frame passes. */
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      this.drawGun(ctx);
      if (this.pulse.a > 0) { ctx.fillStyle = `rgba(${this.pulse.rgb},${this.pulse.a * 0.2})`; ctx.fillRect(0, 0, W, H); }
      if (this.cam.flashA > 0) { ctx.fillStyle = `rgba(${this.cam.flashColor},${this.cam.flashA})`; ctx.fillRect(0, 0, W, H); }
      ctx.drawImage(sp.vignette.canvas, 0, 0, W, H);
      if (this.grainOn) {
        const g = sp.grain[this.frame & 1];
        ctx.globalAlpha = 0.05;
        ctx.drawImage(g.canvas, -(this.frame * 37 % 128), -(this.frame * 53 % 128), W + 128, H + 128);
        ctx.globalAlpha = 1;
      }
    }

    drawCardView(ctx, c, T) {
      const sp = this.sp;
      const face = c.face;
      const sx = Math.max(0.018, face);
      const top = c.y + T.cardTop * c.s;
      const lp = this.lampPos(c);

      // Trolley on the ceiling, wire to the hanger, and the lamp arm.
      ctx.strokeStyle = "rgba(200,215,212,.15)"; ctx.lineWidth = 1.5 * c.s;
      ctx.beginPath(); ctx.moveTo(c.x, c.ceilY + 8); ctx.lineTo(c.x, top - 4 * c.s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c.x, c.ceilY + 8); ctx.lineTo(lp.x, lp.y - 12 * c.s); ctx.stroke();
      S.draw(ctx, sp.trolley, c.x, c.ceilY + 6, 32 * c.s, 16 * c.s);
      S.draw(ctx, sp.shade, lp.x, lp.y, 52 * c.s, 28 * c.s);
      if (c.lamp > 0.02) {
        ctx.fillStyle = `rgba(255,244,214,${0.85 * c.lamp * c.flick})`;
        ctx.beginPath(); ctx.arc(lp.x, lp.y + 15 * c.s, 3.2 * c.s, 0, TAU); ctx.fill();
      }

      ctx.save();
      ctx.translate(c.x, top);                        // pivot at the hanger, like a real card on a clip
      ctx.rotate(c.rot);
      ctx.translate(0, -T.cardTop * c.s);             // back to the card's centre
      ctx.scale(c.s * sx, c.s * c.squash);
      // Shadow on the wall behind, cast down and right of the lamp. Drawn in
      // the card's own frame so it swings and squashes with the card; the
      // lateral offset is divided by the turn so it stays put on screen.
      if (face > 0.1) {
        ctx.globalAlpha = 0.5 * face;
        ctx.drawImage(sp.shadow.canvas, -T.cardW / 2 - 20 + 10 / sx, T.cardTop - 20 + 18, T.cardW + 40, T.cardH + 40);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage((c.kind === "decoy" ? sp.decoy : sp.card).canvas, -T.cardW / 2, T.cardTop, T.cardW, T.cardH);
      for (const h of c.holes) {
        const hs = sp.holes[h.v];
        // A fresh hole punches in oversize and settles over ~120 ms; on the
        // game clock, so hit-stop holds it at its biggest.
        const k = Math.min(1, h.age / 0.12), sz = 20 * (1 + 0.8 * (1 - k) * (1 - k));
        ctx.save(); ctx.translate(h.lx, h.ly); ctx.rotate(h.rot);
        ctx.drawImage(hs.canvas, -sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      }
      // Hanger clip.
      ctx.fillStyle = "#2a2f31"; ctx.fillRect(-7, T.cardTop - 8, 14, 10);
      ctx.restore();
    }

    drawSignalHousing(ctx) {
      const { x, y } = LOOK.signal, r = this.signal.r, g = this.signal.g;
      ctx.fillStyle = "#171c1e";
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 13, y - 25, 26, 50, 5) : ctx.rect(x - 13, y - 25, 26, 50); ctx.fill();
      ctx.strokeStyle = "rgba(200,215,210,.14)"; ctx.lineWidth = 1; ctx.stroke();
      // Two bulbs, red above green like a real lane signal, so position
      // carries the meaning as well as colour.
      ctx.fillStyle = r > 0.05 ? `rgba(${lerp(70, 235, r)},${lerp(40, 70, r)},${lerp(38, 50, r)},1)` : "#2a2523";
      ctx.beginPath(); ctx.arc(x, y - 11, 6.5, 0, TAU); ctx.fill();
      ctx.fillStyle = g > 0.05 ? `rgba(${lerp(60, 130, g)},${lerp(70, 225, g)},${lerp(60, 120, g)},1)` : "#20292a";
      ctx.beginPath(); ctx.arc(x, y + 11, 6.5, 0, TAU); ctx.fill();
    }

    /* ---------- the shooter's pistol ---------- */
    // Rear three-quarter view: the slide tapers away from the eye toward
    // the muzzle, the grip drops off the bottom edge. Geometry is built
    // once in screen space along the barrel axis (t) and across it (s);
    // per frame it is only translated and rotated for recoil.
    buildGun() {
      const G = LOOK.gun;
      const P = { x: G.x, y: G.y };
      const len = Math.hypot(G.aimX - G.x, G.aimY - G.y);
      const dir = { x: (G.aimX - G.x) / len, y: (G.aimY - G.y) / len };
      const perp = { x: -dir.y, y: dir.x };                        // the side that faces the camera
      const pt = (t, s, dx = 0, dy = 0) => [P.x + dir.x * t + perp.x * s + dx, P.y + dir.y * t + perp.y * s + dy];
      const D = [7, 11];                                           // visible slide thickness, screen px
      this.gunGeo = {
        P, dir, perp,
        muzzle: pt(G.barrel, 0),
        eject: pt(118, 20),
        slideTop:  [pt(40, -23), pt(40, 23), pt(G.barrel, 12), pt(G.barrel, -12)],
        slideSide: [pt(40, 23), pt(40, 23, D[0], D[1]), pt(G.barrel, 12, D[0] * 0.5, D[1] * 0.5), pt(G.barrel, 12)],
        slideBack: [pt(33, -21), pt(33, 21), pt(40, 23), pt(40, -23)],
        rearSight: [[pt(44, -15), pt(44, -7), pt(52, -7), pt(52, -15)], [pt(44, 7), pt(44, 15), pt(52, 15), pt(52, 7)]],
        frontSight: [pt(G.barrel - 12, -3), pt(G.barrel - 12, 3), pt(G.barrel - 4, 3), pt(G.barrel - 4, -3)],
        frame: [pt(46, -19, D[0], D[1]), pt(46, 21, D[0], D[1]), pt(150, 13, D[0], D[1]), pt(150, -11, D[0], D[1])],
        grip:  [pt(30, -20, D[0], D[1]), pt(30, 22, D[0], D[1]), pt(30, 22, D[0] + 22, D[1] + 78), pt(30, -20, D[0] + 6, D[1] + 84)],
        guard: pt(98, 2, D[0] + 2, D[1] + 14),
        highlight: [pt(42, -22), pt(G.barrel - 2, -11)],
        port: [pt(96, 4), pt(96, 19), pt(132, 16), pt(132, 3)],
        hammer: [pt(26, -9), pt(26, 9), pt(34, 12), pt(34, -12)]
      };
    }

    drawGun(ctx) {
      const G = LOOK.gun, g = this.gunGeo, k = this.gun.kick, sl = this.gun.slide;
      const poly = (pts) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); };
      ctx.save();
      // Half the camera shake: the gun is in the shooter's hand, not on the wall.
      ctx.translate(this.cam.offX * 0.5 - g.dir.x * k * G.recoilPx, this.cam.offY * 0.5 - g.dir.y * k * G.recoilPx);
      ctx.translate(g.P.x, g.P.y); ctx.rotate(k * G.recoilDeg * Math.PI / 180); ctx.translate(-g.P.x, -g.P.y);
      const lit = this.muzzleA, sig = this.signal;
      // Frame, grip and trigger guard: the parts that don't move.
      ctx.fillStyle = "#15191b"; poly(g.grip); ctx.fill();
      ctx.fillStyle = "#1a1f21"; poly(g.frame); ctx.fill();
      ctx.strokeStyle = "#1d2224"; ctx.lineWidth = 6; ctx.lineCap = "round";
      ctx.beginPath(); ctx.ellipse(g.guard[0], g.guard[1], 17, 12, Math.atan2(g.dir.y, g.dir.x), 0.15, Math.PI - 0.15); ctx.stroke();
      ctx.lineCap = "butt";
      // The slide cycles back along the barrel after a shot.
      ctx.save();
      ctx.translate(-g.dir.x * sl * G.slidePx, -g.dir.y * sl * G.slidePx);
      ctx.fillStyle = "#101415"; poly(g.slideSide); ctx.fill();
      ctx.fillStyle = "#22282a"; poly(g.slideTop); ctx.fill();
      ctx.fillStyle = "#0d1011"; poly(g.slideBack); ctx.fill();
      ctx.fillStyle = "#2b3234"; for (const sight of g.rearSight) { poly(sight); ctx.fill(); } poly(g.frontSight); ctx.fill();
      ctx.fillStyle = "#0a0d0e"; poly(g.port); ctx.fill();                       // ejection port
      ctx.fillStyle = "#1a1f21"; poly(g.hammer); ctx.fill();                     // hammer, behind the slide
      // Rim light along the top edge, brighter under the muzzle flash.
      ctx.strokeStyle = `rgba(210,228,222,${0.16 + 0.5 * lit})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(g.highlight[0][0], g.highlight[0][1]); ctx.lineTo(g.highlight[1][0], g.highlight[1][1]); ctx.stroke();
      // The lane signal tints the slide: red while you hold, green when it's hot.
      if (sig.r > 0.02) { ctx.fillStyle = `rgba(225,72,52,${0.12 * sig.r})`; poly(g.slideTop); ctx.fill(); }
      if (sig.g > 0.02) { ctx.fillStyle = `rgba(120,215,120,${0.12 * sig.g})`; poly(g.slideTop); ctx.fill(); }
      if (lit > 0) { ctx.fillStyle = `rgba(255,220,160,${0.35 * lit})`; poly(g.slideTop); ctx.fill(); }
      ctx.restore();
      ctx.restore();
    }
  }

  L7.Renderer = Renderer;
})();
