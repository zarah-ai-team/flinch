/* ===================================================================
   LANE 7 — Simulation
   The rules and nothing else. No canvas, no DOM, no audio, no engine.
   The renderer, HUD and sound all subscribe to the events this emits
   and read its public fields; none of them may write to it. That is
   what lets this file run unchanged in a Node test — and what makes
   the eventual engine port a rewrite of everything EXCEPT the game.

   Round timeline:
     ARM     carrier slides to a fresh random spot, card edge-on
     HOLD    red light. Wait. Any tap here is a false start.
     FIRE    buzzer + green + lamp + card snaps face-on. One shot.
     BANNER  the round's verdict; tap to skip after a short guard
   ... × rounds, then OVER with a level verdict.

   Clocks: `step(dt, now)` advances the fixed-step animation state in
   `dt` seconds, while `now` is the frame timestamp (same origin as the
   pointer event timestamps handed to `fire`). The duel itself — who
   reacted first — is judged entirely on that one real clock, so the
   fixed step's 16ms quantisation never decides a photo finish.
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

(function () {
  const lerp  = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // Back-out easing: the card overshoots face-on and settles, like a
  // real turning target hitting its stop. Used for the visual AND the
  // hit test, so a shot during the overshoot is judged on what's shown.
  const backOut = (t, s = 1.70158) => { const u = t - 1; return u * u * ((s + 1) * u + s) + 1; };

  class Sim {
    constructor(cfg, opts = {}) {
      this.cfg = cfg;
      this.rng = opts.rng || Math.random;
      this.listeners = new Map();

      this.state = "TITLE";
      this.level = 1;
      this.params = cfg.levels[0];
      this.mode = "ladder";       // "ladder" | "daily" — a label for presentation and the save, never a rule
      this.day = null;            // daily only: the UTC day number this run belongs to
      this.round = 0;
      this.youScore = 0;
      this.oppScore = 0;
      this.results = [];          // "won" | "lost" per round, drives the pips

      this.t = 0;                 // seconds in the current state
      this.turn = 0;              // 0 edge-on … 1 face-on (may overshoot slightly)
      this.turnT = 0;
      this.exposed = false;       // has the card turned this round

      this.target = null;         // { x, y, s, d, u, ceilY, floorY }
      this.decoys = [];
      this.holes = [];            // card-local hits, persist for the level
      this.wallMarks = [];        // world-space misses, persist for the level

      this.holdFor = 0;
      this.armFor = 0;
      this.moveMs = 0;
      this.bannerFor = cfg.bannerMs / 1000;
      this.greenAt = 0;
      this.oppReactMs = 0;
      this.lastReactMs = null;
      this.bestReactMs = opts.bestReactMs ?? null;
      this.pendingOppShot = -1;   // countdown to Lane 8's "you missed, I didn't" shot
    }

    /* ---------- events ---------- */
    on(evt, fn) { (this.listeners.get(evt) || this.listeners.set(evt, []).get(evt)).push(fn); return this; }
    off(evt, fn) { const l = this.listeners.get(evt); if (l) l.splice(l.indexOf(fn) >>> 0, 1); }
    emit(evt, data) { const l = this.listeners.get(evt); if (l) for (const fn of l.slice()) fn(data, this); }

    rand(lo, hi) { return lo + this.rng() * (hi - lo); }

    /* ---------- geometry ---------- */
    // Depth d (0 near … 1 far) and lateral u (-1 … 1) → screen placement.
    perspective(d, u) {
      const p = this.cfg.perspective, t = this.cfg.target;
      const hw     = lerp(p.nearHalfW,  p.farHalfW,  d);
      const floorY = lerp(p.nearFloorY, p.farFloorY, d);
      const ceilY  = lerp(p.nearCeilY,  p.farCeilY,  d);
      const s      = lerp(p.nearScale,  p.farScale,  d);
      const gap    = lerp(p.nearGap,    p.farGap,    d);
      const y = floorY - gap - (t.cardTop + t.cardH) * s;           // card bottom sits `gap` above the floor
      const reach = Math.max(0, hw - (t.cardW / 2) * s - p.edgeMargin);
      const x = this.cfg.design.w / 2 + u * reach;
      return { x, y, s, d, u, ceilY, floorY, hw };
    }

    placeTarget(prev) {
      const P = this.params;
      let fallback = null;
      for (let i = 0; i < 8; i++) {
        const c = this.perspective(this.rand(P.dist[0], P.dist[1]), (this.rng() * 2 - 1) * P.spread);
        if (!prev) return c;
        // Insist on a visible move so a round never reuses the last spot.
        if (Math.abs(c.x - prev.x) > 48 || Math.abs(c.d - prev.d) > 0.12) return c;
        fallback = c;
      }
      return fallback;
    }

    // Two cards at similar depth sit side by side with at most ~30%
    // overlap. Cards at clearly different depths may layer — a near card
    // in front of a far one reads as distance, not as a bug — provided
    // the far card's head stays fully clear and most of it is visible.
    // The bay only fits two cards abreast, so without layering the
    // two-decoy levels could not exist.
    separated(a, b) {
      const T = this.cfg.target;
      const near = a.d <= b.d ? a : b, far = near === a ? b : a;
      const hwN = (T.cardW / 2) * near.s, hwF = (T.cardW / 2) * far.s;
      const dx = Math.abs(a.x - b.x);
      if (Math.abs(a.d - b.d) < 0.2) return dx >= (hwN + hwF) * 0.68 + 10;
      if (dx < (hwN + hwF) * 0.4) return false;
      const hx = far.x, hy = far.y + T.headY * far.s, hr = T.headR * far.s + 12;
      const nx0 = near.x - hwN, nx1 = near.x + hwN;
      const ny0 = near.y + T.cardTop * near.s, ny1 = ny0 + T.cardH * near.s;
      const cx = clamp(hx, nx0, nx1), cy = clamp(hy, ny0, ny1);
      return (cx - hx) * (cx - hx) + (cy - hy) * (cy - hy) > hr * hr;
    }

    // Decoys roam the whole bay, not just the level's depth band: the
    // white card can hang in front of the target or far behind it, and
    // picking the manila one out is the skill being tested. If no legal
    // spot exists for a decoy this round, it simply doesn't appear.
    placeDecoys(target, n) {
      const out = [];
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < this.cfg.placementTries; i++) {
          const c = this.perspective(this.rand(0, 1), this.rng() * 2 - 1);
          if (this.separated(c, target) && out.every(o => this.separated(c, o))) { out.push(c); break; }
        }
      }
      return out;
    }

    // Every card this round, nearest first — the order hit-testing must
    // use, and the reverse of the order the renderer paints them in.
    cardsNearestFirst() {
      const all = [{ kind: "target", c: this.target, index: -1 }];
      this.decoys.forEach((c, i) => all.push({ kind: "decoy", c, index: i }));
      return all.sort((p, q) => p.c.d - q.c.d);
    }

    /* ---------- level & round flow ---------- */
    oppAvgMs(level) {
      const P = this.cfg.levels[clamp(level, 1, this.cfg.levels.length) - 1];
      return Math.round((P.opp[0] + P.opp[1]) / 2);
    }

    toTitle() { this.state = "TITLE"; this.t = 0; this.exposed = false; this.emit("title"); }

    startLevel(level, opts = {}) {
      this.level = clamp(level, 1, this.cfg.levels.length);
      this.params = this.cfg.levels[this.level - 1];
      this.mode = opts.mode || "ladder";
      this.day = opts.day ?? null;
      this.round = 0; this.youScore = 0; this.oppScore = 0; this.results = [];
      this.holes = []; this.wallMarks = []; this.lastReactMs = null;
      this.target = null; this.decoys = [];
      this.emit("level:start", { level: this.level, params: this.params, mode: this.mode, day: this.day });
      this.beginRound();
    }

    beginRound() {
      this.round++;
      const prev = this.target;
      this.target = this.placeTarget(prev);
      this.decoys = this.placeDecoys(this.target, this.params.decoys);
      const home = prev || this.perspective(0, 0);
      const dist = Math.hypot(this.target.x - home.x, this.target.y - home.y);
      this.moveMs = Math.round(lerp(this.cfg.moveMs[0], this.cfg.moveMs[1], clamp(dist / 360, 0, 1)));
      this.armFor = (this.moveMs + this.cfg.armSettleMs) / 1000;
      this.state = "ARM"; this.t = 0;
      this.turnT = 0; this.turn = 0; this.exposed = false;
      this.pendingOppShot = -1;
      // Roll the whole round now — the hold wait and Lane 8's reaction —
      // so the random sequence never depends on how the round is played.
      // A false start skips the go signal; if the jitter were drawn there,
      // every later round would shift and one daily seed would no longer
      // be the same run for everyone.
      const P = this.params, R = this.cfg.rounds, j = this.cfg.opponentJitterMs;
      this.holdFor = this.rand(P.hold[0], P.hold[1]) / 1000;
      const base = lerp(P.opp[0], P.opp[1], R > 1 ? (this.round - 1) / (R - 1) : 0);
      this.oppReactMs = Math.max(this.cfg.opponentFloorMs, Math.round(base + this.rand(-j, j)));
      this.emit("round:begin", {
        round: this.round, rounds: this.cfg.rounds,
        target: this.target, decoys: this.decoys, from: home, moveMs: this.moveMs
      });
    }

    toHold() {
      this.state = "HOLD"; this.t = 0;
      this.emit("hold", { round: this.round, holdMs: Math.round(this.holdFor * 1000) });
    }

    goGreen(now) {
      this.state = "FIRE"; this.t = 0; this.exposed = true;
      this.greenAt = now;
      this.emit("go", { round: this.round, oppReactMs: this.oppReactMs });
    }

    step(dt, now) {
      const P = this.params;
      const facing = this.exposed && (this.state === "FIRE" || this.state === "BANNER");
      if (facing) {
        this.turnT = Math.min(1, this.turnT + dt * 1000 / P.turnMs);
        this.turn = backOut(this.turnT);
      } else {
        // Turning away is slower and un-eased: the motor, not the stop.
        this.turnT = Math.max(0, this.turnT - dt * 1000 / (P.turnMs * 1.8));
        this.turn = this.turnT;
      }

      this.t += dt;

      if (this.pendingOppShot >= 0) {
        this.pendingOppShot -= dt;
        if (this.pendingOppShot < 0) { this.pendingOppShot = -1; this.emit("shot:opponent", { late: true, reactMs: null, round: this.round }); }
      }

      switch (this.state) {
        case "ARM":    if (this.t >= this.armFor) this.toHold(); break;
        case "HOLD":   if (this.t >= this.holdFor) this.goGreen(now); break;
        case "FIRE":   if (now - this.greenAt >= this.oppReactMs) this.resolveOpponentShot(); break;
        case "BANNER": if (this.t >= this.bannerFor) this.endBanner(); break;
      }
    }

    /* ---------- the one action ---------- */
    // Returns what the tap meant, mostly for tests and debugging.
    fire(x, y, ts) {
      switch (this.state) {
        case "ARM":
          if (this.t * 1000 < this.cfg.armGraceMs) return "ignored";
          this.falseStart(); return "early";
        case "HOLD":
          this.falseStart(); return "early";
        case "FIRE":
          return this.resolvePlayerShot(x, y, ts);
        case "BANNER":
          if (this.t * 1000 >= this.cfg.bannerSkipAfterMs) { this.endBanner(); return "skip"; }
          return "ignored";
        default:
          return "ignored";
      }
    }

    hitTest(x, y) {
      const T = this.cfg.target;
      // Below a quarter turn the card is a sliver; nothing can be hit.
      if (this.turn < 0.25) return { zone: "miss" };
      // Nearest card first, exactly as they are painted: if a white card
      // hangs in front of the target, the white card is what you hit.
      for (const { kind, c, index } of this.cardsNearestFirst()) {
        // Undo the carrier's scale and the turn so the shot lands in
        // card-local units. A shot mid-turn is genuinely aiming at a
        // narrower card — honest, and it rewards speed with difficulty.
        const lx = (x - c.x) / (c.s * this.turn), ly = (y - c.y) / c.s;
        const z = L7.Shapes.zoneLocal(lx, ly, T);
        if (z === "miss") continue;
        if (kind === "decoy") return { zone: "decoy", index, lx, ly };
        if (z === "card") return { zone: "card", lx, ly };   // the margin: a hole, no points
        return { zone: z, lx, ly };
      }
      return { zone: "miss" };
    }

    resolvePlayerShot(x, y, ts) {
      const reactMs = Math.max(0, Math.round(ts - this.greenAt));
      const hit = this.hitTest(x, y);
      this.state = "BANNER"; this.t = 0;
      this.lastReactMs = reactMs;

      const ev = {
        zone: hit.zone, x, y, reactMs, oppReactMs: this.oppReactMs,
        margin: this.oppReactMs - reactMs, pts: 0, best: false,
        round: this.round, index: hit.index, lx: hit.lx, ly: hit.ly
      };

      if (hit.zone === "head" || hit.zone === "body") {
        ev.pts = this.cfg.points[hit.zone];
        this.youScore += ev.pts;
        this.results.push("won");
        this.holes.push({ lx: hit.lx, ly: hit.ly });
        if (this.holes.length > this.cfg.maxHoles) this.holes.shift();
        if (this.bestReactMs === null || reactMs < this.bestReactMs) { this.bestReactMs = reactMs; ev.best = true; }
      } else {
        this.oppScore += this.cfg.opponentPoints;
        this.results.push("lost");
        if (hit.zone === "card") {
          this.holes.push({ lx: hit.lx, ly: hit.ly });
          if (this.holes.length > this.cfg.maxHoles) this.holes.shift();
        } else if (hit.zone === "miss") {
          this.wallMarks.push({ x, y });
          if (this.wallMarks.length > this.cfg.maxWallMarks) this.wallMarks.shift();
        }
        this.pendingOppShot = 0.18;   // Lane 8 takes the body a beat later
      }
      this.emit("shot:player", ev);
      return hit.zone;
    }

    resolveOpponentShot() {
      this.state = "BANNER"; this.t = 0;
      this.oppScore += this.cfg.opponentPoints;
      this.results.push("lost");
      this.emit("shot:opponent", { late: false, reactMs: this.oppReactMs, round: this.round });
    }

    falseStart() {
      const during = this.state;   // captured before the switch: ARM or HOLD
      this.state = "BANNER"; this.t = 0;
      this.oppScore += this.cfg.opponentPoints;
      this.results.push("lost");
      this.emit("false-start", { round: this.round, during });
    }

    endBanner() {
      this.emit("banner:end", { round: this.round });
      if (this.round >= this.cfg.rounds) this.endLevel();
      else this.beginRound();
    }

    endLevel() {
      this.state = "OVER"; this.t = 0;
      const won = this.youScore > this.oppScore;
      const tied = this.youScore === this.oppScore;
      const last = this.cfg.levels.length;
      this.emit("level:end", {
        level: this.level, won, tied, mode: this.mode, day: this.day,
        youScore: this.youScore, oppScore: this.oppScore,
        complete: won && this.level === last,
        next: won ? Math.min(this.level + 1, last) : this.level
      });
    }

    // The app went to the background mid-round. Restart the round at a
    // fresh spot with no penalty — punishing a phone call is not tense,
    // it's just unfair.
    abortRound() {
      if (this.state !== "ARM" && this.state !== "HOLD" && this.state !== "FIRE") return false;
      this.round--;
      this.beginRound();
      this.emit("round:restart", { round: this.round });
      return true;
    }
  }

  L7.Sim = Sim;
})();

if (typeof module !== "undefined") module.exports = L7.Sim;
