/* ===================================================================
   LANE 7 — bootstrap
   Wires the modules together and runs the loop. This is the only file
   that knows about all of them:

     Input ──► fire(x, y, ts) ──► Sim ──events──► Renderer
                                    │              HUD
                                    ├─────────────► Sound
                                    └─────────────► Save

   The loop keeps the Sim at a fixed 60Hz through an accumulator no
   matter what the display does; the Clock decides how much simulated
   time each real frame is worth (hit-stop, slow motion); tweens and
   the camera get both clocks and pick the one they belong on.
   =================================================================== */
(function () {
  "use strict";
  const CONFIG = L7.CONFIG, W = CONFIG.design.w, H = CONFIG.design.h;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const save = L7.loadSave();
  const seedFor = (level) => CONFIG.fixedSeed !== null ? CONFIG.fixedSeed
    : ((CONFIG.seed ^ (level * 7919) ^ (Date.now() % 1000003)) >>> 0);

  const sim = new L7.Sim(CONFIG, { rng: L7.mulberry32(CONFIG.seed), bestReactMs: save.bestReactMs });
  const tweens = new L7.Tweens();
  const clock = new L7.Clock();
  const camera = new L7.Camera(W, H, CONFIG.feel);
  camera.reduced = reduced;

  const stage = document.getElementById("stage");
  const canvas = document.getElementById("game");
  const renderer = new L7.Renderer({ canvas, sim, cfg: CONFIG, tweens, rng: L7.mulberry32(CONFIG.seed ^ 0xC0FFEE), camera, clock, reduced });
  const Sound = L7.Sound;

  /* ---------- the daily ---------- */
  function dailyInfo() {
    const now = Date.now(), day = L7.Daily.dayNumber(now);
    const played = !!(save.daily && save.daily.day === day);
    return { day, key: L7.Daily.dayKey(day), level: L7.Daily.levelFor(day, CONFIG), msLeft: L7.Daily.msUntilNext(now), played, result: played ? save.daily : null };
  }

  const hud = new L7.Hud({
    sim, save, cfg: CONFIG, tweens, dailyInfo,
    onStart: startLevel,
    onDaily: startDaily,
    onTitle: () => sim.toTitle(),
    onMute: () => { save.muted = !save.muted; Sound.setMuted(save.muted); hud.setMuted(save.muted); L7.persistSave(save); },
    onReset: () => { L7.wipeSave(); Object.assign(save, L7.defaultSave(), { muted: save.muted }); sim.bestReactMs = null; hud.showTitle(); },
    onShare: share
  });

  /* ---------- sound follows the Sim ---------- */
  sim.on("round:begin", (e) => Sound.motor(e.moveMs / 1000 + 0.05, Sound.panAt(e.target.x)));
  sim.on("hold", () => Sound.ready());
  sim.on("go", () => { Sound.buzzer(); Sound.lampOn(Sound.panAt(sim.target.x)); });
  sim.on("shot:player", (e) => {
    Sound.shot(-0.15); Sound.casing();
    const pan = Sound.panAt(e.x);
    if (e.zone === "head") Sound.hitHead(pan);
    else if (e.zone === "body") Sound.hitBody(pan);
    else if (e.zone === "decoy") Sound.noShoot();
    else Sound.miss(pan);
    if (e.best) Sound.best();
    // Haptics where the platform has them (Android). Never under reduced motion.
    const buzz = CONFIG.haptics[e.zone];
    const activated = !navigator.userActivation || navigator.userActivation.hasBeenActive;   // scripted shots have no gesture
    if (buzz && !reduced && navigator.vibrate && activated) { try { navigator.vibrate(buzz); } catch (_) { /* denied — fine */ } }
  });
  sim.on("shot:opponent", () => Sound.oppShot());
  sim.on("false-start", () => Sound.buzz());
  sim.on("level:end", (e) => { if (e.complete) Sound.levelUp(); else if (e.won) Sound.win(); else Sound.lose(); });

  /* ---------- save follows the Sim ---------- */
  let runBest = null;                        // fastest hit in the level being played
  sim.on("level:start", () => { runBest = null; });
  sim.on("shot:player", (e) => {
    if (e.pts > 0 && (runBest === null || e.reactMs < runBest)) runBest = e.reactMs;
    if (e.best) { save.bestReactMs = e.reactMs; L7.persistSave(save); }
  });
  sim.on("level:end", (e) => {
    L7.recordLevelEnd(save, { mode: e.mode, day: e.day, level: e.level, won: e.won, next: e.next, youScore: e.youScore, oppScore: e.oppScore, bestReactMs: runBest });
    L7.persistSave(save);
  });

  function startLevel(level) {
    Sound.uiTap();
    sim.rng = L7.mulberry32(seedFor(level));
    sim.startLevel(level);
  }

  // One attempt per UTC day; the seed is the day, so everyone gets the same range.
  function startDaily() {
    const d = dailyInfo();
    if (d.played) return;
    Sound.uiTap();
    // Taken the moment it starts: reloading mid-run forfeits it rather than
    // giving a second look at today's positions.
    save.daily = { day: d.day, level: d.level, done: false, won: false, youScore: 0, oppScore: 0, bestReactMs: null };
    L7.persistSave(save);
    sim.rng = L7.mulberry32(L7.Daily.seedFor(d.day, CONFIG));
    sim.startLevel(d.level, { mode: "daily", day: d.day });
  }

  /* ---------- share ---------- */
  // ctx is the level:end payload, or null on the title. Returns what happened.
  function share(ctx) {
    const url = /^https?:/.test(location.protocol) ? location.origin + location.pathname : "";
    const best = save.bestReactMs ? ` Fastest hit ${save.bestReactMs} ms.` : "";
    let text;
    if (ctx && ctx.mode === "daily") {
      text = `Flinch daily ${L7.Daily.dayKey(ctx.day)}: ${ctx.won ? "cleared" : "lost"} ${ctx.youScore}–${ctx.oppScore}` +
        (runBest ? `, fastest hit ${runBest} ms` : "") + (save.dailyStreak > 1 ? `, ${save.dailyStreak}-day streak` : "") + ".";
    } else if (ctx && ctx.won) {
      text = `Flinch: cleared level ${ctx.level} (${CONFIG.levels[ctx.level - 1].name}) ${ctx.youScore}–${ctx.oppScore}.${best}`;
    } else {
      text = `Flinch: ${save.cleared} of ${CONFIG.levels.length} levels cleared.${best}`;
    }
    text += " Can you beat Lane 8?";
    const payload = url ? { title: "Flinch", text, url } : { title: "Flinch", text };
    if (navigator.share) return navigator.share(payload).then(() => "shared").catch(() => "cancelled");
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(url ? `${text} ${url}` : text).then(() => "copied").catch(() => "unsupported");
    return "unsupported";
  }

  /* ---------- input ---------- */
  function fire(a) {
    Sound.unlock();
    if (sim.state === "TITLE" || sim.state === "OVER") { hud.advance(); return; }
    sim.fire(a.x, a.y, a.ts);
  }
  new L7.Input(stage, canvas, W, H, fire);

  /* ---------- sizing and quality ---------- */
  // ?q=max pins full resolution (screenshots, demos); ?q=low starts low.
  const qParam = new URLSearchParams(location.search).get("q");
  const quality = { dprCap: qParam === "low" ? 1 : 2, frames: 0, slow: 0, warm: 0, locked: qParam === "max" };
  let lastCssW = 0;
  function resize() {
    const r = canvas.getBoundingClientRect();
    lastCssW = r.width;
    const dpr = Math.min(window.devicePixelRatio || 1, quality.dprCap);
    renderer.setScale((r.width / W) * dpr);
  }
  window.addEventListener("resize", resize);

  // If frames keep missing budget, step the resolution down once and
  // drop the grain. Never steps back up: oscillating quality is worse
  // than steady lower quality.
  function sampleQuality(dtReal) {
    if (quality.locked) return;
    if (quality.warm < 120) { quality.warm++; return; }
    quality.frames++; if (dtReal > 0.024) quality.slow++;
    if (quality.frames >= 180) {
      if (quality.slow > 70 && quality.dprCap > 1) {
        quality.dprCap = quality.dprCap > 1.5 ? 1.5 : 1;
        renderer.grainOn = false;
        resize();
      }
      quality.frames = 0; quality.slow = 0;
    }
  }

  /* ---------- loop ---------- */
  const STEP = 1 / 60;
  let acc = 0, last = performance.now();
  function loop(now) {
    const dtReal = Math.min((now - last) / 1000, 0.1);   // clamp: a tab switch must not fire hundreds of steps
    last = now;
    const dtGame = clock.advance(dtReal);
    acc += dtGame;
    while (acc >= STEP) { sim.step(STEP, now); acc -= STEP; }
    tweens.update(dtGame, dtReal);
    camera.update(dtReal);
    renderer.update(dtGame);
    hud.update(now);
    const r = canvas.getBoundingClientRect();
    if (Math.abs(r.width - lastCssW) > 0.5) resize();
    renderer.draw();
    sampleQuality(dtReal);
    requestAnimationFrame(loop);
  }

  /* ---------- lifecycle ---------- */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { sim.abortRound(); Sound.ctx && Sound.ctx.suspend && Sound.ctx.suspend(); }
    else { last = performance.now(); acc = 0; if (Sound.ctx && !Sound.muted) Sound.ctx.resume(); }
  });

  // Offline and home-screen install. Only over http(s): a service worker
  // cannot register from file://, and that path must keep working.
  if ("serviceWorker" in navigator && /^https?:/.test(location.protocol)) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* not fatal: the game runs without it */ });
  }

  /* ---------- boot ---------- */
  Sound.muted = save.muted;
  hud.setMuted(save.muted);
  resize();
  sim.toTitle();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => renderer.rebuild());
  requestAnimationFrame(loop);

  L7.game = { sim, renderer, hud, save, tweens, clock, camera, quality, dailyInfo, startDaily };
})();
