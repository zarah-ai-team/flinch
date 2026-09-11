/* Browser smoke test. Opens index.html from file://, plays through
   several states with an automated player and screenshots each one.
   Run from the repo root: npm run test:browser
   (one-time: npm install && npx playwright install chromium) */
"use strict";
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const OUT = process.env.SHOT_DIR || path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const url = "file://" + path.join(__dirname, "..", "index.html") + "?q=max";

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(m.type() + ": " + m.text());
  });

  await page.goto(url);
  await page.waitForFunction(() => window.L7 && L7.game && L7.game.sim.state === "TITLE");
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "01-title.png") });

  // The title: self-hosted fonts, ten level chips, the daily row.
  const title = await page.evaluate(() => ({
    fonts: document.fonts.check('700 20px "Barlow Condensed"') && document.fonts.check('400 14px "Barlow"'),
    chips: document.querySelectorAll("#levels .chip").length,
    locked: document.querySelectorAll("#levels .chip.locked").length,
    daily: document.getElementById("daily").className,
    sw: !!navigator.serviceWorker.controller
  }));
  console.log("title:", JSON.stringify(title));
  if (!title.fonts) errors.push("self-hosted fonts did not load");
  if (title.chips !== 10 || title.locked !== 9) errors.push("level select should show 10 chips with 9 locked on a fresh save: " + JSON.stringify(title));
  if (title.daily !== "daily ready") errors.push("daily row should be ready on a fresh save");
  if (title.sw) errors.push("a service worker must not register from file://");

  // Design → CSS px for clicks.
  const box = await page.locator("#game").boundingBox();
  const toCss = (x, y) => ({ x: box.x + x * box.width / 540, y: box.y + y * box.height / 960 });
  const tap = async (x, y) => { const p = toCss(x, y); await page.mouse.click(p.x, p.y); };
  const state = () => page.evaluate(() => L7.game.sim.state);
  const waitState = (s, t = 8000) => page.waitForFunction((s) => L7.game.sim.state === s, s, { timeout: t });
  const headOf = (t) => ({ x: t.x, y: t.y + (-100) * t.s });
  // Overlay taps go on the heading: the level chips and the daily row are
  // controls of their own, so "tap anywhere" must avoid them in the test.
  const tapOverlay = () => page.locator("#title").click();

  // Start level 1.
  await tapOverlay();
  await waitState("ARM");
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, "02-arm-carrier-moving.png") });
  await waitState("HOLD");
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, "03-hold-red.png") });
  await waitState("FIRE");
  await page.waitForTimeout(200);
  // Aim at the head, then look at the impact (pistol recoil, muzzle flash) and the banner (new best).
  const t1 = await page.evaluate(() => L7.game.sim.target);
  await tap(headOf(t1).x, headOf(t1).y);
  await page.screenshot({ path: path.join(OUT, "04-head-hit-impact.png") });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, "05-head-hit-banner.png") });
  const s1 = await page.evaluate(() => ({ you: L7.game.sim.youScore, opp: L7.game.sim.oppScore, zone: L7.game.sim.results.slice(-1)[0], react: L7.game.sim.lastReactMs, holes: L7.game.sim.holes.length, bestTag: !document.getElementById("bannerBest").hidden }));
  console.log("round 1:", JSON.stringify(s1));
  if (s1.you !== 5) errors.push("head tap did not score a head: " + JSON.stringify(s1));
  if (!s1.bestTag) errors.push("first hit of a fresh save should show the new-best tag");
  // Close-up of the card with its hole, at full resolution.
  const clip = { x: box.x + (t1.x - 130 * t1.s) * box.width / 540, y: box.y + (t1.y - 240 * t1.s) * box.height / 960, width: 260 * t1.s * box.width / 540, height: 400 * t1.s * box.height / 960 };
  await page.screenshot({ path: path.join(OUT, "06-card-closeup.png"), clip });

  // Play out the rest of level 1 automatically (body shots), then screenshot the level card.
  for (let r = 2; r <= 5; r++) {
    await waitState("FIRE", 15000);
    await page.waitForTimeout(240);
    const t = await page.evaluate(() => L7.game.sim.target);
    await tap(t.x, t.y + 30 * t.s);
    if (r === 3) { await page.waitForTimeout(60); await page.screenshot({ path: path.join(OUT, "07-body-hit.png") }); }
  }
  await waitState("OVER", 15000);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, "08-level-clear.png") });
  const end = await page.evaluate(() => ({ you: L7.game.sim.youScore, opp: L7.game.sim.oppScore, level: L7.game.save.level, cleared: L7.game.save.cleared, stats: L7.game.save.levelStats, version: L7.game.save.version }));
  console.log("level 1 end:", JSON.stringify(end));
  if (end.level !== 2 || end.cleared !== 1) errors.push("winning level 1 should unlock level 2: " + JSON.stringify(end));
  if (!end.stats[1] || end.stats[1].won !== 1 || typeof end.stats[1].bestReactMs !== "number") errors.push("level stats not recorded: " + JSON.stringify(end.stats));
  if (end.version !== 3) errors.push("save should be version 3");

  // Jump to level 8: dark bay, two decoys.
  await page.evaluate(() => L7.game.hud.onStart(8));
  await waitState("HOLD");
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, "09-L8-hold-dark.png") });
  await waitState("FIRE", 12000);
  await page.waitForTimeout(260);
  await page.screenshot({ path: path.join(OUT, "10-L8-fire-decoys.png") });
  const dec = await page.evaluate(() => ({ decoys: L7.game.sim.decoys.length, target: L7.game.sim.target, oppReact: L7.game.sim.oppReactMs }));
  console.log("level 8 layout:", JSON.stringify(dec));
  // Miss on purpose to see the wall mark + opponent flash.
  await tap(30, 200);
  await page.waitForTimeout(230);
  await page.screenshot({ path: path.join(OUT, "11-L8-miss-opp-fires.png") });

  // Let the opponent win a round to see "Too slow".
  await waitState("FIRE", 12000);
  await waitState("BANNER", 5000);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, "12-L8-too-slow.png") });

  // False start.
  await waitState("HOLD", 12000);
  await page.waitForTimeout(100);
  await tap(270, 480);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, "13-false-start.png") });

  // Level 10: the dimmest lamp, farthest carrier.
  await page.evaluate(() => L7.game.hud.onStart(10));
  await waitState("FIRE", 12000);
  await page.waitForTimeout(260);
  await page.screenshot({ path: path.join(OUT, "14-L10-fire.png") });
  const l10 = await page.evaluate(() => ({ decoys: L7.game.sim.decoys.length, s: L7.game.sim.target.s, d: L7.game.sim.target.d, oppReact: L7.game.sim.oppReactMs }));
  console.log("level 10:", JSON.stringify(l10));

  // The daily: stamped as taken at start, played through on head shots, recorded at the end.
  await page.evaluate(() => { L7.game.sim.toTitle(); });
  await waitState("TITLE");
  await page.evaluate(() => L7.game.startDaily());
  await waitState("ARM");
  const dstart = await page.evaluate(() => ({ mode: L7.game.sim.mode, day: L7.game.sim.day, level: L7.game.sim.level, tag: document.getElementById("levelTag").textContent, stamped: L7.game.save.daily && L7.game.save.daily.done === false }));
  console.log("daily start:", JSON.stringify(dstart));
  if (dstart.mode !== "daily" || !/^Daily/.test(dstart.tag) || !dstart.stamped) errors.push("daily did not start as a daily: " + JSON.stringify(dstart));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, "15-daily-arm.png") });
  for (let r = 1; r <= 5; r++) {
    await waitState("FIRE", 15000);
    await page.waitForTimeout(230);
    const t = await page.evaluate(() => L7.game.sim.target);
    await tap(headOf(t).x, headOf(t).y);
    await waitState("BANNER", 3000);
  }
  await waitState("OVER", 15000);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, "16-daily-result.png") });
  const dend = await page.evaluate(() => ({ daily: L7.game.save.daily, played: L7.game.save.dailyPlayed, won: L7.game.save.dailyWon, streak: L7.game.save.dailyStreak, ladder: L7.game.save.level, title: document.getElementById("title").textContent }));
  console.log("daily end:", JSON.stringify(dend));
  if (!dend.daily || dend.daily.done !== true || dend.played !== 1) errors.push("daily was not recorded: " + JSON.stringify(dend));
  if (dend.ladder !== 2) errors.push("the daily must not move the ladder: " + JSON.stringify(dend));
  if (!/^Daily/.test(dend.title)) errors.push("daily end card should be the daily card: " + dend.title);
  // Back to the title: the daily row is spent and shows the countdown.
  await tapOverlay();
  await waitState("TITLE");
  await page.waitForTimeout(500);
  const drow = await page.evaluate(() => ({ cls: document.getElementById("daily").className, action: document.getElementById("dailyAction").textContent, kicker: document.getElementById("dailyKicker").textContent }));
  console.log("daily row:", JSON.stringify(drow));
  if (drow.cls !== "daily done" || !/^Next in/.test(drow.action)) errors.push("daily row should be spent after playing: " + JSON.stringify(drow));
  await page.screenshot({ path: path.join(OUT, "17-title-after-daily.png") });

  // Frame-time sample (software renderer — only relative numbers matter).
  const ft = await page.evaluate(() => new Promise((res) => {
    const t = []; let last = performance.now();
    function f(now) { t.push(now - last); last = now; if (t.length < 60) requestAnimationFrame(f); else res(t); }
    requestAnimationFrame(f);
  }));
  const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
  console.log(`frame time (headless swiftshader): avg ${avg.toFixed(1)} ms, max ${Math.max(...ft).toFixed(1)} ms`);

  const perf = await page.evaluate(() => ({ dpr: window.devicePixelRatio, canvas: [L7.game.renderer.canvas.width, L7.game.renderer.canvas.height], spriteDpr: L7.Sprites.dpr }));
  console.log("render:", JSON.stringify(perf));
  console.log("final state:", await state());
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no console errors");
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
