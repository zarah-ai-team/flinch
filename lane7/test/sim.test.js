/* Headless test for the Sim. Run: node test/sim.test.js
   Drives a simulated player through every level at several reaction
   speeds and checks the rules, the geometry and the save migration.
   No browser, no canvas — that is the point of keeping Sim pure. */
"use strict";
const path = require("path");
const src = (f) => require(path.join(__dirname, "..", "src", f));
const CONFIG = src("config.js");
const mulberry32 = src("rng.js");
src("shapes.js");
const Sim = src("sim.js");
const Daily = src("daily.js");
const { migrateSave, defaultSave, recordLevelEnd } = src("store.js");

let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log("  FAIL:", msg); } }

const STEP = 1 / 60, FRAME = 1000 / 60;
const decoyStats = { want: 0, got: 0, byLevel: {} };

// Plays one level. `reactMs` is the player's reaction to the go signal,
// `headRate` how often they gamble on the head, `aimJitter` px of hand shake.
function playLevel(level, { reactMs, headRate = 0.4, aimJitter = 6, seed = 1234, falseStartRate = 0, skipBanners = true }) {
  const sim = new Sim(CONFIG, { rng: mulberry32(seed) });
  const prng = mulberry32(seed ^ 0x9e3779b9);
  let now = 100000, tapAt = -1, aim = null, result = null, frames = 0;
  const events = [];
  const positions = [];
  sim.on("round:begin", (e) => {
    // Snapshot: the target object is live and a mover will slide it later.
    positions.push({ target: { x: e.target.x, d: e.target.d }, decoys: e.decoys });
    // Geometry checks on every placement.
    const T = CONFIG.target;
    const cards = [e.target, ...e.decoys];
    for (const c of cards) {
      const halfW = (T.cardW / 2) * c.s, top = c.y + T.cardTop * c.s, bottom = c.y + (T.cardTop + T.cardH) * c.s;
      ok(c.x - halfW >= 0 && c.x + halfW <= CONFIG.design.w, `L${level} card inside lane horizontally (x=${c.x.toFixed(0)} s=${c.s.toFixed(2)})`);
      ok(top >= 100, `L${level} card top below the HUD (top=${top.toFixed(0)})`);
      ok(bottom <= c.floorY, `L${level} card bottom above its floor line`);
    }
    for (let i = 0; i < e.decoys.length; i++) {
      ok(sim.separated(e.decoys[i], e.target), `L${level} decoy ${i} separated from target`);
      for (let j = i + 1; j < e.decoys.length; j++) ok(sim.separated(e.decoys[i], e.decoys[j]), `L${level} decoys separated from each other`);
    }
    ok(e.decoys.length <= CONFIG.levels[level - 1].decoys, `L${level} never more decoys than configured`);
    decoyStats.want += CONFIG.levels[level - 1].decoys; decoyStats.got += e.decoys.length;
    const bl = decoyStats.byLevel[level] || (decoyStats.byLevel[level] = { want: 0, got: 0 });
    bl.want += CONFIG.levels[level - 1].decoys; bl.got += e.decoys.length;
  });
  sim.on("go", (e) => {
    ok(e.oppReactMs >= CONFIG.opponentFloorMs, `L${level} opponent never faster than the floor (${e.oppReactMs})`);
    const t = sim.target;
    aim = { head: prng() < headRate, jx: (prng() * 2 - 1) * aimJitter, jy: (prng() * 2 - 1) * aimJitter };
    tapAt = now + reactMs + (prng() * 2 - 1) * 40;
  });
  sim.on("hold", () => {
    if (prng() < falseStartRate) tapAt = now + 200; // deliberate early tap
  });
  sim.on("level:end", (e) => { result = e; });
  for (const evt of ["hold", "go", "shot:player", "shot:opponent", "false-start", "banner:end"]) sim.on(evt, (e) => events.push([evt, e]));

  sim.startLevel(level);
  while (!result && frames < 60 * 240) {
    now += FRAME; frames++;
    if (tapAt >= 0 && now >= tapAt) {
      // Aim at the card where it is now: a mover has slid since the buzzer.
      const t = sim.target;
      const pt = aim ? { x: t.x + aim.jx, y: t.y + (aim.head ? CONFIG.target.headY : 30) * t.s + aim.jy } : { x: 270, y: 480 };
      sim.fire(pt.x, pt.y, tapAt);
      tapAt = -1;
    }
    sim.step(STEP, now);
    if (skipBanners && sim.state === "BANNER" && sim.t * 1000 > CONFIG.bannerSkipAfterMs + 20) sim.fire(0, 0, now);
  }
  ok(result !== null, `L${level} level finishes (state=${sim.state}, frames=${frames})`);
  return { sim, result, events, positions, frames };
}

console.log("Sim tests");

/* ---- 1. Every level plays through, scores add up ---- */
for (let level = 1; level <= CONFIG.levels.length; level++) {
  const { sim, result, events } = playLevel(level, { reactMs: 600, seed: 77 + level });
  ok(sim.results.length === CONFIG.rounds, `L${level} five rounds recorded`);
  const won = sim.results.filter(r => r === "won").length, lost = CONFIG.rounds - won;
  ok(sim.oppScore === lost * CONFIG.opponentPoints, `L${level} Lane 8 scores 3 per lost round`);
  const pts = events.filter(([n]) => n === "shot:player").reduce((a, [, e]) => a + e.pts, 0);
  ok(sim.youScore === pts, `L${level} player score equals sum of hits`);
  ok(result.level === level, `L${level} verdict reports the right level`);
  ok(result.won === (sim.youScore > sim.oppScore), `L${level} verdict matches scores`);
}

/* ---- 2. Difficulty actually ramps ---- */
function winRate(level, opts, runs = 30) {
  let wins = 0;
  for (let i = 0; i < runs; i++) wins += playLevel(level, { ...opts, seed: 1000 + i * 17 + level }).result.won ? 1 : 0;
  return wins / runs;
}
const fast = [1, 5, 10].map(l => winRate(l, { reactMs: 380, headRate: 0.5, aimJitter: 4 }));
const mid  = [1, 5, 10].map(l => winRate(l, { reactMs: 560, headRate: 0.4 }));
const slow = [1, 5, 10].map(l => winRate(l, { reactMs: 800, headRate: 0.3 }));
console.log("  win rates  L1 / L5 / L10");
console.log("   380ms:", fast.map(x => x.toFixed(2)).join(" / "));
console.log("   560ms:", mid.map(x => x.toFixed(2)).join(" / "));
console.log("   800ms:", slow.map(x => x.toFixed(2)).join(" / "));
ok(fast[0] > 0.9, "a fast player clears level 1");
ok(fast[2] > 0.5, "a 380ms head-taker can beat level 10");
ok(mid[0] > 0.9, "a 560ms player clears level 1");
ok(mid[1] > 0.5, "a 560ms player can take level 5");
ok(mid[2] < 0.1, "a 560ms player cannot beat level 10");
ok(slow[0] > 0.5, "an 800ms player can still take level 1");
ok(slow[1] < 0.1 && slow[2] === 0, "an 800ms player is stopped by level 5 and never sees level 10");
ok(slow[1] < mid[1] && mid[2] <= mid[0], "difficulty is monotone in the obvious directions");

/* ---- 3. Scoring arithmetic ---- */
{
  const { sim, result } = playLevel(1, { reactMs: 450, headRate: 0, aimJitter: 0, seed: 5 });
  ok(sim.youScore === 15 && sim.oppScore === 0 && result.won, "always-body vs a slow Lane 8 wins outright at level 1");
  // Lane 8 only scores when you fail, so with 5 rounds a draw is
  // arithmetically impossible (5h + 3b = 3(5 - h - b) has no integer
  // solution). Check that across a lot of mixed matches.
  let ties = 0;
  for (let i = 0; i < 60; i++) ties += playLevel(1 + (i % 10), { reactMs: 550 + (i % 5) * 80, headRate: 0.5, seed: 700 + i }).result.tied ? 1 : 0;
  ok(ties === 0, "no match ever ends level");
  // The comeback: two heads (10) beat three lost rounds (9).
  ok(2 * CONFIG.points.head > 3 * CONFIG.opponentPoints && 2 * CONFIG.points.body < 3 * CONFIG.opponentPoints,
     "two heads beat three losses, two bodies don't");
}

/* ---- 3b. Difficulty curve table (for tuning, printed not asserted) ---- */
{
  const speeds = [400, 450, 500, 560, 640, 740];
  console.log("  win rate by level (rows: player reaction ms, 40% head gambles)");
  console.log("        " + CONFIG.levels.map((_, i) => String(i + 1).padStart(4)).join(""));
  for (const ms of speeds) {
    const row = CONFIG.levels.map((_, i) => winRate(i + 1, { reactMs: ms, headRate: 0.4 }, 24));
    console.log("  " + String(ms).padStart(4) + "  " + row.map(x => String(Math.round(x * 100)).padStart(4)).join(""));
  }
}

/* ---- 4. False start, grace window, banner skip ---- */
{
  const sim = new Sim(CONFIG, { rng: mulberry32(9) });
  const ev = [];
  sim.on("false-start", () => ev.push("early"));
  sim.startLevel(1);
  ok(sim.state === "ARM", "level starts in ARM");
  ok(sim.fire(0, 0, 0) === "ignored", "tap inside the ARM grace window is ignored");
  for (let i = 0; i < 30; i++) sim.step(STEP, i * FRAME);      // 500ms into ARM
  ok(sim.fire(0, 0, 500) === "early", "tap after the grace window is a false start");
  ok(sim.state === "BANNER" && sim.oppScore === 3 && ev.length === 1, "false start hands Lane 8 the round");
  ok(sim.fire(0, 0, 600) === "ignored", "banner swallows immediate taps");
  for (let i = 0; i < 30; i++) sim.step(STEP, 600 + i * FRAME);
  ok(sim.fire(0, 0, 1100) === "skip", "banner can be skipped after the guard");
  ok(sim.state === "ARM" && sim.round === 2, "skip advances to the next round");
}

/* ---- 5. Hit zones and the turn ---- */
{
  const sim = new Sim(CONFIG, { rng: mulberry32(11) });
  sim.startLevel(1);
  let now = 0;
  while (sim.state !== "FIRE") { now += FRAME; sim.step(STEP, now); }
  ok(sim.turn < 0.25, "card is still edge-on the instant the light goes green");
  ok(sim.hitTest(sim.target.x, sim.target.y).zone === "miss", "nothing can be hit before a quarter turn");
  for (let i = 0; i < 12; i++) { now += FRAME; sim.step(STEP, now); }
  ok(sim.turn > 0.95, "card is face-on after ~200ms");
  const t = sim.target;
  ok(sim.hitTest(t.x, t.y + CONFIG.target.headY * t.s).zone === "head", "head centre is a head");
  ok(sim.hitTest(t.x, t.y + 30 * t.s).zone === "body", "torso is a body");
  ok(sim.hitTest(t.x + 100 * t.s, t.y + 135 * t.s).zone === "card", "card margin is a card, not the silhouette");
  ok(sim.hitTest(t.x + 200, t.y - 300).zone === "miss", "off the card is a miss");
  const r = sim.fire(t.x, t.y + CONFIG.target.headY * t.s, now);
  ok(r === "head" && sim.youScore === 5 && sim.holes.length === 1, "head shot scores 5 and leaves a hole");
  ok(sim.lastReactMs >= 190 && sim.lastReactMs <= 220, `reaction measured on the real clock (${sim.lastReactMs}ms)`);
}

/* ---- 6. Decoys are punished ---- */
{
  let hitDecoy = false;
  for (let seed = 1; seed < 60 && !hitDecoy; seed++) {
    const sim = new Sim(CONFIG, { rng: mulberry32(seed) });
    sim.startLevel(8);
    let now = 0;
    while (sim.state !== "FIRE") { now += FRAME; sim.step(STEP, now); }
    for (let i = 0; i < 14; i++) { now += FRAME; sim.step(STEP, now); }
    if (!sim.decoys.length) continue;
    const d = sim.decoys[0];
    const z = sim.fire(d.x, d.y + 20 * d.s, now);
    ok(z === "decoy", "shooting a white card registers as decoy");
    ok(sim.oppScore === 3 && sim.youScore === 0, "decoy hit hands Lane 8 the round");
    hitDecoy = true;
  }
  ok(hitDecoy, "found a level-8 layout with a decoy to test");
}

/* ---- 7. Determinism and variety ---- */
{
  const a = playLevel(4, { reactMs: 550, seed: 4242 }).positions.map(p => p.target.x.toFixed(2) + ":" + p.target.d.toFixed(3));
  const b = playLevel(4, { reactMs: 550, seed: 4242 }).positions.map(p => p.target.x.toFixed(2) + ":" + p.target.d.toFixed(3));
  ok(a.join() === b.join(), "same seed, same target placements");
  ok(new Set(a).size === a.length, "no two rounds reuse a spot");
  const c = playLevel(4, { reactMs: 550, seed: 4343 }).positions.map(p => p.target.x.toFixed(2));
  ok(a.join() !== c.join(), "different seed, different placements");
}

/* ---- 8. Backgrounding restarts the round without penalty ---- */
{
  const sim = new Sim(CONFIG, { rng: mulberry32(3) });
  sim.startLevel(2);
  let now = 0;
  while (sim.state !== "HOLD") { now += FRAME; sim.step(STEP, now); }
  ok(sim.abortRound() === true && sim.state === "ARM" && sim.round === 1 && sim.oppScore === 0, "abort re-arms the same round, no score change");
  sim.state = "BANNER";
  ok(sim.abortRound() === false, "abort during a banner does nothing");
}

/* ---- 9. Save migration ---- */
{
  const v1 = { version: 1, bestReactMs: 412, matchesWon: 3, matchesPlayed: 7 };
  const m = migrateSave(JSON.parse(JSON.stringify(v1)));
  ok(m.version === 3 && m.level === 1 && m.cleared === 0 && m.muted === false && m.bestReactMs === 412 && m.matchesWon === 3, "v1 save migrates to the current version keeping its data");
  ok(migrateSave({ version: 99 }).version === 3, "unknown future version falls back to defaults");
  ok(migrateSave(null).version === 3, "null save gives defaults");
  const partial = migrateSave({ version: 2, level: 7 });
  ok(partial.level === 7 && partial.cleared === 0 && partial.muted === false, "missing v2 fields are filled in");
  ok(defaultSave().level === 1, "default save starts at level 1");
}


/* ---- 10. False start names its phase; mode flows through events ---- */
{
  const sim = new Sim(CONFIG, { rng: mulberry32(21) });
  const seen = [];
  sim.on("false-start", (e) => seen.push(e.during));
  sim.on("level:start", (e) => seen.push("start:" + e.mode + ":" + e.day));
  sim.startLevel(3, { mode: "daily", day: 20707 });
  ok(sim.mode === "daily" && sim.day === 20707, "startLevel records the mode and day");
  ok(seen[0] === "start:daily:20707", "level:start carries mode and day");
  for (let i = 0; i < 40; i++) sim.step(STEP, i * FRAME);       // well past the ARM grace
  sim.fire(0, 0, 700);
  ok(seen[1] === "ARM" || seen[1] === "HOLD", `false start names the phase it interrupted (${seen[1]})`);
  const plain = new Sim(CONFIG, { rng: mulberry32(22) });
  let endMode = null;
  plain.on("level:end", (e) => { endMode = e.mode; });
  plain.startLevel(1);
  ok(plain.mode === "ladder" && plain.day === null, "default mode is ladder");
  plain.round = CONFIG.rounds; plain.state = "BANNER";
  plain.endBanner();
  ok(endMode === "ladder", "level:end carries the mode");
}

/* ---- 10b. Movers: the card slides while exposed, bounces, and is hit where it is ---- */
{
  const lv = CONFIG.levels.findIndex(P => P.drift > 0) + 1;
  ok(lv > 0 && CONFIG.levels[0].drift === 0, `movers start at level ${lv}, never level 1`);
  const sim = new Sim(CONFIG, { rng: mulberry32(31) });
  sim.startLevel(lv);
  let now = 0;
  while (sim.state !== "FIRE") { now += FRAME; sim.step(STEP, now); }
  const x0 = sim.target.x, v = sim.driftV;
  ok(Math.abs(v) === CONFIG.levels[lv - 1].drift, "drift speed comes from the level table");
  for (let i = 0; i < 12; i++) { now += FRAME; sim.step(STEP, now); }
  ok(Math.abs(sim.target.x - x0) > 5, `the card has moved while exposed (${(sim.target.x - x0).toFixed(1)} px)`);
  ok(sim.target.x >= sim.driftMin && sim.target.x <= sim.driftMax, "the mover stays inside the lane");
  const t = sim.target;
  ok(sim.hitTest(t.x, t.y + 30 * t.s).zone === "body", "a shot at the moved position hits");
  ok(sim.hitTest(x0 - Math.sign(v) * 60, t.y + 30 * t.s).zone !== "body" || Math.abs(v) < 40, "a shot where the card was is no longer a body");
  // Bounce: run a long exposure with a huge drift and confirm it never leaves the lane.
  const fast = new Sim(CONFIG, { rng: mulberry32(32) });
  fast.startLevel(lv);
  now = 0; while (fast.state !== "FIRE") { now += FRAME; fast.step(STEP, now); }
  fast.driftV = 2000;                                  // far faster than any level, to force the bounce
  let inside = true, flips = 0, lastV = fast.driftV;
  for (let i = 0; i < 40 && fast.state === "FIRE"; i++) {
    fast.step(STEP, fast.greenAt + i);   // keep the real clock still so Lane 8 never fires
    if (fast.target.x < fast.driftMin - 0.01 || fast.target.x > fast.driftMax + 0.01) inside = false;
    if (fast.driftV !== lastV) { flips++; lastV = fast.driftV; }
  }
  ok(inside && flips >= 1, `a fast mover bounces off the lane edges (${flips} reversals)`);
  // Static levels never move.
  const still = new Sim(CONFIG, { rng: mulberry32(33) });
  still.startLevel(1);
  now = 0; while (still.state !== "FIRE") { now += FRAME; still.step(STEP, now); }
  const sx = still.target.x;
  for (let i = 0; i < 12; i++) { now += FRAME; still.step(STEP, now); }
  ok(still.target.x === sx && still.driftV === 0, "level 1 is static");
  // Decoys respect the sweep: at the top level, no decoy covers the target's head anywhere on its path.
  let checked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = new Sim(CONFIG, { rng: mulberry32(400 + seed) });
    s.startLevel(CONFIG.levels.length);
    const top = CONFIG.levels[CONFIG.levels.length - 1];
    const exposure = Math.min(CONFIG.driftSweepSec, (top.opp[0] + CONFIG.opponentJitterMs) / 1000);
    for (let k = 0; k <= 8; k++) {
      const at = Object.assign({}, s.target, { x: s.driftAt(s.target.x, s.driftV, exposure * k / 8) });
      for (const d of s.decoys) { checked++; ok(s.separated(d, at), "decoy clear of the mover's whole path"); }
    }
  }
  ok(checked > 40, `sweep separation exercised (${checked} checks)`);
}

/* ---- 11. Daily challenge arithmetic and determinism ---- */
{
  const now = Date.UTC(2026, 8, 11, 13, 30);                    // 11 Sep 2026, 13:30 UTC
  const day = Daily.dayNumber(now);
  ok(Daily.dayKey(day) === "2026-09-11", `day key is the UTC date (${Daily.dayKey(day)})`);
  ok(Daily.dayNumber(Date.UTC(2026, 8, 11, 23, 59)) === day && Daily.dayNumber(Date.UTC(2026, 8, 12, 0, 0)) === day + 1, "the day rolls at midnight UTC");
  const lv = Daily.levelFor(day, CONFIG);
  ok(lv >= 1 && lv <= CONFIG.levels.length, "daily level is in the table");
  const visited = new Set();
  for (let k = 0; k < CONFIG.levels.length; k++) visited.add(Daily.levelFor(day + k, CONFIG));
  ok(visited.size === CONFIG.levels.length, "ten consecutive days visit every level once");
  ok(Daily.seedFor(day, CONFIG) === Daily.seedFor(day, CONFIG), "same day, same seed");
  ok(Daily.seedFor(day, CONFIG) !== Daily.seedFor(day + 1, CONFIG), "next day, different seed");
  ok(Daily.msUntilNext(now) === 10.5 * 3600000, "countdown runs to midnight UTC");
  ok(Daily.countdownText(10.5 * 3600000) === "10h 30m" && Daily.countdownText(90000) === "2m" && Daily.countdownText(20000) === "under a minute", "countdown text");
  // Two players on the same seed get the same positions, waits and Lane 8, however they play.
  const seed = Daily.seedFor(day, CONFIG);
  const fast = playLevel(lv, { reactMs: 480, headRate: 0.6, seed, falseStartRate: 0.2 });
  const slow = playLevel(lv, { reactMs: 950, headRate: 0.1, seed });
  const spots = (r) => r.positions.map(p => p.target.x.toFixed(1) + ":" + p.target.d.toFixed(3) + ":" + p.decoys.length).join("|");
  const waits = (r) => r.events.filter(([k]) => k === "hold").map(([, e]) => e.holdMs).join(",");
  const opp   = (r) => r.events.filter(([k]) => k === "go").map(([, e]) => e.oppReactMs);
  ok(spots(fast) === spots(slow), "daily: same positions for a fast and a slow player");
  ok(waits(fast) === waits(slow), "daily: same hold waits regardless of play");
  // A false start skips that round's go signal, so compare only the rounds both reached.
  const oppF = opp(fast), oppS = opp(slow);
  ok(oppS.length === CONFIG.rounds && oppF.every((v) => oppS.includes(v)), "daily: Lane 8 reacts identically for everyone");
}

/* ---- 12. Save v3 and the progression recorder ---- */
{
  const v2 = { version: 2, bestReactMs: 300, matchesPlayed: 4, matchesWon: 2, level: 3, cleared: 2, muted: true };
  const m = migrateSave(JSON.parse(JSON.stringify(v2)));
  ok(m.version === 3 && m.level === 3 && m.muted === true && m.dailyStreak === 0 && m.daily === null && typeof m.levelStats === "object", "v2 save migrates to v3 keeping its data");
  const v1 = migrateSave({ version: 1, bestReactMs: 412, matchesWon: 3, matchesPlayed: 7 });
  ok(v1.version === 3 && v1.level === 1 && v1.dailyPlayed === 0 && v1.bestReactMs === 412, "v1 save climbs the whole ladder to v3");

  const s = defaultSave();
  recordLevelEnd(s, { mode: "ladder", level: 1, won: true, next: 2, youScore: 15, oppScore: 0, bestReactMs: 400 });
  recordLevelEnd(s, { mode: "ladder", level: 2, won: true, next: 3, youScore: 13, oppScore: 3, bestReactMs: 380 });
  ok(s.level === 3 && s.cleared === 2 && s.matchesWon === 2 && s.matchesPlayed === 2, "wins advance the ladder");
  recordLevelEnd(s, { mode: "ladder", level: 1, won: true, next: 2, youScore: 15, oppScore: 0, bestReactMs: 350 });
  ok(s.level === 3 && s.cleared === 2, "replaying a cleared level never regresses the ladder");
  ok(s.levelStats[1].played === 2 && s.levelStats[1].won === 2 && s.levelStats[1].bestReactMs === 350, "per-level stats accumulate and keep the best time");
  recordLevelEnd(s, { mode: "ladder", level: 3, won: false, next: 3, youScore: 6, oppScore: 9, bestReactMs: null });
  ok(s.level === 3 && s.matchesPlayed === 4 && s.levelStats[3].won === 0 && s.levelStats[3].bestReactMs === null, "a loss counts but changes nothing else");

  recordLevelEnd(s, { mode: "daily", day: 100, level: 5, won: true, next: 6, youScore: 15, oppScore: 0, bestReactMs: 420 });
  ok(s.daily.day === 100 && s.daily.won && s.dailyStreak === 1 && s.dailyPlayed === 1 && s.dailyWon === 1, "first daily win starts a streak");
  ok(s.level === 3 && s.matchesPlayed === 4, "a daily never touches the ladder");
  recordLevelEnd(s, { mode: "daily", day: 101, level: 6, won: true, next: 7, youScore: 10, oppScore: 9, bestReactMs: 500 });
  ok(s.dailyStreak === 2, "consecutive daily wins extend the streak");
  recordLevelEnd(s, { mode: "daily", day: 103, level: 8, won: true, next: 9, youScore: 10, oppScore: 9, bestReactMs: 500 });
  ok(s.dailyStreak === 1, "a skipped day restarts the streak");
  recordLevelEnd(s, { mode: "daily", day: 104, level: 9, won: false, next: 9, youScore: 3, oppScore: 12, bestReactMs: 600 });
  ok(s.dailyStreak === 0 && s.daily.won === false && s.dailyPlayed === 4 && s.dailyWon === 3, "a daily loss ends the streak and is recorded");
}

ok(decoyStats.got / decoyStats.want >= 0.9, `decoys placed ${(100 * decoyStats.got / decoyStats.want).toFixed(1)}% of the time (want ≥ 90%)`);
console.log(`  decoy placement success: ${(100 * decoyStats.got / decoyStats.want).toFixed(1)}%  by level: ` +
  Object.keys(decoyStats.byLevel).filter(l => decoyStats.byLevel[l].want).map(l => `L${l} ${Math.round(100 * decoyStats.byLevel[l].got / decoyStats.byLevel[l].want)}%`).join(" "));

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
