# Flinch (codename Lane 7) — Claude Code project notes

Reaction-duel shooting-range game. The product is called **Flinch**; the
code keeps the codename Lane 7 (folder `lane7/`, namespace `L7`, save key
`lane7:save`). Never rename the save key. User-facing strings say Flinch;
the rival is Lane 8; the wall stencil 7 is the player's own lane. Browser, portrait, one hand. Plain JS +
Canvas 2D with a small in-house engine layer. **No build step** — open
`lane7/index.html` or `npm run serve`.

Read `GDD.md` (design, rules, level table, open playtest questions) and
`TECH.md` (architecture, timing, lighting, save, porting) before changing
anything non-trivial. Keep both current when a decision changes.

## Layout

```
development/
  GDD.md, TECH.md         design + tech docs (source of truth for decisions)
  README.md               public front page: play, rules, develop, deploy
  lane7.html              v1 single-file prototype — reference only, do not edit
  tools/make-icons.js     renders lane7/icons/*.png from the card geometry
  .github/workflows/      deploy-pages.yml — tests, then GitHub Pages
  lane7/
    index.html            shell, CSS, @font-face, script load order (order matters)
    manifest.webmanifest  PWA: fullscreen portrait, icons
    sw.js                 service worker: precache SHELL, network-first; VERSION = release
    fonts/                Barlow + Barlow Condensed, Latin woff2, self-hosted
    icons/                generated — never hand-edit, run `npm run icons`
    src/config.js         EVERY gameplay tunable incl. the 10-level table, daily, haptics
    src/sim.js            the rules. Pure: no DOM, no canvas, no audio, no engine
    src/shapes.js         silhouette polygon + zone test (shared by draw and hit-test)
    src/rng.js            mulberry32; two streams (rules vs effects)
    src/store.js          save v3 + migration ladder + recordLevelEnd (pure progression)
    src/daily.js          UTC day number, daily level rotation, daily seed, countdown (pure)
    src/sound.js          procedural Web Audio cues
    src/engine/           tween.js particles.js camera.js sprites.js input.js
    src/render.js         canvas renderer; visual constants in LOOK at the top (incl. the pistol)
    src/hud.js            DOM: scoreboard, banner, title (level select, daily, record, share), cards
    src/main.js           wiring, fixed-step loop, quality governor, daily start, share, SW register
    test/sim.test.js      headless rules tests (prints the difficulty curve)
    test/browser.test.js  Playwright smoke test with screenshots
```

## Commands

```
npm test                 # rules tests, ~5 s, run after ANY change to sim.js/config.js/shapes.js/store.js/daily.js
npm run test:browser     # needs: npm i && npx playwright install chromium
npm run serve            # http://localhost:8080 (file:// also works; the service worker needs http)
npm run icons            # regenerate lane7/icons/ after touching the card geometry
```

## Hard rules

1. `sim.js` never imports or touches the DOM, canvas or audio. Renderer, HUD
   and Sound subscribe to Sim events and read its fields; they never write
   to it. This is what keeps the rules testable and portable.
2. Game logic runs in fixed 1/60 s steps (`main.js` accumulator). Never tie a
   rule to frame time. Presentation may use real time (`realtime: true` tweens).
3. No magic numbers: gameplay values go in `CONFIG` (`config.js`), visual
   values in `LOOK` (`render.js`). Level difficulty is ONLY the level table.
4. Anything spawned in bulk is pooled (`engine/particles.js`). No per-frame
   allocation in the render path.
5. Randomness is seeded. Rules use `sim.rng`; effects use the renderer's
   stream. Don't mix them, don't call `Math.random()` in gameplay code.
6. Save format changes bump `SAVE_VERSION` and add a migration case in
   `store.js`; never remove old cases. Progression is written only through
   `recordLevelEnd`, which stays pure and tested.
7. Every random number a round needs is drawn in `Sim.beginRound`. Never
   call `sim.rng` later in a round: the daily relies on the sequence being a
   function of the seed alone, whatever the player does.
8. A new source file goes in `index.html`'s script list AND `sw.js`'s
   `SHELL`. Bump `VERSION` in `sw.js` with `package.json` on every release.
9. `camelCase`, comment the *why* of non-obvious maths, complete files over
   fragments.

## Where to change common things

- **Difficulty / new level** → `CONFIG.levels` row. Then `npm test` and read
  the printed win-rate table; each level should move the wall ~50 ms. Ten
  levels also drive the daily rotation (day mod level count).
- **Scoring** → `CONFIG.points`, `CONFIG.opponentPoints`. Note: with 5 rounds
  a draw is impossible (`8h + 6b = 15`); keep two heads > three losses.
- **A new round rule** → add state or logic in `Sim`, emit an event, handle it
  in `render.js` (`bind()`), `hud.js` (`bind()`), `main.js` (sound). Add a
  test in `test/sim.test.js`.
- **The daily** → rotation and salt in `CONFIG.daily`; arithmetic in
  `daily.js`; start in `main.js` `startDaily()`; the row and result card in
  `hud.js` (`refreshDaily`, `showLevelEnd`); streak rules in
  `store.js` `recordLevelEnd`.
- **Title screen / level select / record line** → `hud.js` `showTitle()`;
  chip styles in `index.html` (`.chip`, `.daily`, `#record`).
- **Share text** → `main.js` `share()`.
- **A new visual effect** → sprite in `Renderer.buildSprites()`, emitter in
  `buildEmitters()`, trigger in the matching `on*` handler.
- **The pistol** → `LOOK.gun` for placement and recoil, `buildGun()` for
  geometry, `drawGun()` for shading. It never touches the Sim.
- **A new sound** → cue in `sound.js`, wire it to an event in `main.js`.
- **Feel (shake, zoom, hit-stop, slow-mo, haptics)** → `CONFIG.feel`,
  `CONFIG.haptics`.
- **Card geometry / hit zones** → `CONFIG.target` + `shapes.js` (one polygon
  serves drawing and hit-testing — never fork them). Then `npm run icons`.
- **Offline / install** → `sw.js` (`SHELL`, `VERSION`), `manifest.webmanifest`.

## Sim events (the contract between rules and presentation)

`title`, `level:start` {level, params, mode, day}, `round:begin` {round,
target, decoys, from, moveMs}, `round:restart`, `hold` {holdMs}, `go`
{oppReactMs}, `shot:player` {zone: head|body|card|decoy|miss, x, y, lx, ly,
reactMs, pts, best}, `shot:opponent` {late, reactMs}, `false-start`
{round, during: ARM|HOLD}, `banner:end`, `level:end` {level, won, tied,
mode, day, youScore, oppScore, next, complete}.

`mode` is "ladder" or "daily"; `day` is the UTC day number on a daily and
null otherwise. `Sim.startLevel(level, { mode, day })` sets them.

## Deploy

- **Repo**: github.com/zarah-ai-team/flinch. Live: https://zarah-ai-team.github.io/flinch/
- **GitHub Pages**: `.github/workflows/deploy-pages.yml` runs the rules tests
  and publishes `index.html`, `src/`, `fonts/`, `icons/`, the manifest and
  `sw.js` on every push to `main`. One-time: repo Settings → Pages →
  Source = "GitHub Actions".
- **itch.io**: zip the contents of `lane7/` without `test/`, `index.html` at
  the zip root, upload as an HTML project, viewport 540×960 or "mobile
  friendly", enable the fullscreen button.
- **Before any release**: bump `package.json` version and `sw.js` `VERSION`
  together; `npm test`; `npm run test:browser` and look at the shots.

## Open questions (from GDD.md — decide with play, not in code)

Head gamble rate when behind; dark hold at levels 5+; level-6 decoy
reception; level-10 beatability (raise `opp` by 40 ms on levels 8–10 if
nobody clears it in a week); far-depth head size on a real phone; whether
one daily attempt with forfeit-on-reload feels fair; whether the pistol
reads as a hand or as clutter on a small phone; whether anyone replays
cleared levels for a better time.
