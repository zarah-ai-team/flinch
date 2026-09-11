# Flinch — Technical Notes

Product name **Flinch**; codename **Lane 7** everywhere in code (folder,
`L7` namespace, `lane7:save` key, cache name). The codename is load-bearing:
renaming the save key would orphan every existing save.

**Current build:** `lane7/index.html` + `lane7/src/` + `lane7/fonts/` +
`lane7/icons/` + `manifest.webmanifest` + `sw.js`. No build step: open the
file. `lane7.html` in the parent folder is the v1 single-file prototype,
kept for reference only.
**Next platform:** Godot 4 (GDScript) → iOS, or Phaser 3 + Capacitor if we
stay web-first. See the porting section.
**Last updated:** 11 Sep 2026 (v2.2)

---

## How to run

- Play: double-click `lane7/index.html`. Works from `file://`, no server.
  `?q=max` pins full resolution, `?q=low` starts at 1× (old phones).
  Or `npm run serve` for http://localhost:8080 (this is also the only way
  to exercise the service worker, which cannot register from `file://`).
- Rules tests: `npm test` (no browser, ~5 s, prints the difficulty curve).
- Browser smoke test: `npm run test:browser` after a one-time
  `npm install && npx playwright install chromium`; writes screenshots to
  `lane7/test/shots/`.
- Icons: `npm run icons` regenerates `lane7/icons/*.png` from the card
  geometry (`tools/make-icons.js`, a tiny PNG encoder over Node's zlib).
- Claude Code: `CLAUDE.md` at the repo root carries the working rules,
  the event contract and where to change what. Open a terminal in
  `development/` and run `claude`.

## Deploy

Static files, nothing to build. `.github/workflows/deploy-pages.yml` runs
the rules tests and publishes the shell, `src/`, `fonts/`, `icons/`, the
manifest and the service worker to GitHub Pages on every push to `main`;
enable it once under repo Settings → Pages → Source: GitHub Actions. For
itch.io, zip the contents of `lane7/` without `test/`, with `index.html` at
the zip root, and upload as an HTML project. The fonts are self-hosted, so
there is no external dependency to worry about on either.

Bump the version in three places on every release — `BUILD` in `sw.js`,
`CONFIG.version` in `config.js`, `package.json` — and `npm test` refuses
to pass if they disagree. The worker's cache name comes from `BUILD`, and
that is what makes a phone drop the previous build's cache.

## About the engine choice

The brief for v2 was "expand the tech stack so the look and feel improve
significantly". The plan was Phaser 3, the project's default for browser 2D.
The session that built v2 had every package registry and CDN blocked, so
Phaser could not be vendored, and a 2,000-line framework build that could not
be run once was not worth shipping. Instead v2 has a small in-house engine
layer (`src/engine/`) with the same module boundaries Phaser would impose —
tweens, particles, camera, sprites, input — which could be tested frame by
frame in headless Chromium.

This is not a compromise on the result: everything the feel needed (easing,
hit-stop, slow motion, lighting, particles, camera work) is here and is
Canvas 2D, which is GPU-backed on every phone that matters. What Phaser would
add is WebGL post-processing (true bloom) and a larger ecosystem. If we want
that, the swap is mechanical — see "Porting". The Sim does not change.

## Architecture

```
Input ──► fire(x, y, ts) ──► Sim ──events──► Renderer  (canvas)
                               │             HUD       (DOM)
                               ├───────────► Sound     (Web Audio)
                               └───────────► Save      (store.js)
```

- **Sim** (`sim.js`) owns every rule and every piece of game state. It has
  no dependency on the DOM, canvas or audio, emits events, and is driven by
  `step(dt, now)` and `fire(x, y, ts)`. It runs in Node for tests. It carries
  a `mode` label ("ladder" | "daily") and the daily's day number purely so
  presentation and the save can tell runs apart; no rule reads them.
- **Renderer** (`render.js`) reads the Sim and draws. It keeps its own
  presentation state (where a carrier *appears* to be mid-move, lamp
  ignition, card swing, the pistol's recoil) and never writes to the Sim.
- **HUD** (`hud.js`) is DOM: scores, pips, banner, the title with its level
  select, daily row and record line, the level and daily result cards, mute,
  share, reset. DOM text is crisper than canvas text, costs nothing per frame,
  and does not shake with the world. Every control stops propagation so a
  tap on a button never reaches the canvas as a shot.
- **Sound** (`sound.js`) is fired from Sim events in `main.js`.
- **Save** (`store.js`) is the versioned save plus `recordLevelEnd`, the one
  pure function that turns a finished level into progression.
- **Daily** (`daily.js`) is pure date and seed arithmetic.
- **Engine** (`src/engine/`): `tween.js` (easing + tween manager on two
  clocks), `particles.js` (pooled emitters), `camera.js` (Clock with
  hit-stop/slow-mo, Camera with trauma shake, punch zoom, roll, flash),
  `sprites.js` (offscreen sprite factory + LightLayer compositor),
  `input.js` (pointer + keyboard → one action).
- **CONFIG** (`config.js`) holds every gameplay tunable including the level
  table, the daily rotation and the haptic lengths. Visual constants,
  including the pistol's geometry and recoil, live in `LOOK` at the top of
  `render.js`.

Each file attaches to one global namespace `L7` and works both as a classic
`<script>` (so `file://` works with no bundler) and as a Node `require`.
Adding a source file means adding it to the `<script>` list in `index.html`
**and** to `SHELL` in `sw.js`, or offline play silently breaks.

## Fixed timestep and the two clocks

The Sim advances in identical 1/60 s steps through an accumulator; rendering
happens whenever the browser is ready. Real frame time is clamped to 100 ms
so a tab switch cannot run hundreds of catch-up steps.

`Clock.advance(dtReal)` decides how much simulated time a frame is worth:
zero during hit-stop, ~0.32× during slow motion, easing back to 1 over the
last third of the slow-mo window. Everything world-side (Sim steps, carrier
tweens, particles, lamp ignition, the pistol's recoil) runs on that game
clock — so hit-stop holds the gun at full kick, which is the feel. Everything
the player must be able to read or use during a freeze (HUD tweens, camera
zoom recovery, the ambient light, the impact flash) runs on the real clock —
each tween declares which one it wants.

## Timing and fairness

The duel — who fired first — is judged on one clock. `goGreen` stamps
`greenAt` with the frame timestamp; the player's tap carries
`event.timeStamp`, which shares that time origin and is stamped by the OS a
few ms *before* our handler runs; Lane 8's deadline is checked against the
frame timestamp inside `step`. The fixed step's 16 ms quantisation therefore
never decides a photo finish. Lane 8 can only ever fire *late* — by at most
one frame — which is a bias in the player's favour, never against.

Reaction times are measured from the frame in which the green state was
computed, which precedes the paint by a few ms; that constant offset is the
same for every player and is fine for a personal best. For a leaderboard,
measure from the paint (`requestAnimationFrame` after the state change) and
say so in the small print.

`touch-action: none` on the body is still load-bearing: without it iOS Safari
holds taps ~300 ms to see if you meant to double-tap-zoom.

## Determinism

Two `mulberry32` streams: the Sim's decides hold times, jitter and every card
position; the renderer's feeds particles, shake, card phases and the title
flicker. v1 shared one stream, so the shake consumed numbers at a rate that
depended on how long the player took to shoot — replays were impossible in
practice.

Every random number a round needs — the target spot, the mover's
direction, the decoy spots, the hold wait and Lane 8's jittered reaction —
is drawn in `beginRound`, before the player can do anything. v2 drew the hold wait in `toHold` and the jitter
in `goGreen`; a false start skipped `goGreen`, so the sequence shifted and
two players on one seed diverged from that round on. Now the sequence is a
function of the seed alone, which is what the daily needs. The only thing
that still perturbs it is `abortRound` (the app going to the background),
which re-rolls the round — acceptable, and documented on the daily.

By default each level attempt is seeded from `CONFIG.seed ^ level ^ clock`
so retries differ; `CONFIG.fixedSeed = N` pins every run for debugging.

## Daily challenge

`daily.js`: the day number is whole UTC days since the epoch; the key is the
ISO date; the level is `(day + levelOffset) mod 10 + 1`; the seed is the day
xor a salt, mixed twice so neighbouring days share nothing. `main.js` starts
it with `sim.startLevel(level, { mode: "daily", day })` after seeding
`sim.rng` from the day; `level:start` and `level:end` carry `mode` and `day`
so the HUD can label it and the save can file it.

The save stamps the daily as taken (`done: false`) *before* the first round,
so a reload mid-run forfeits it instead of granting a second look at the
positions. `recordLevelEnd` fills in the result and the streak (consecutive
days won, tracked by `dailyLastWonDay`). The title refreshes the countdown
once a second while it is up, and re-arms the row when midnight UTC passes.

## Placement

The bay is a 2.5D corridor: depth `d ∈ [0,1]` maps linearly to lane
half-width (270→200), floor y (660→350), ceiling y (−40→120) and card scale
(0.92→0.62). A card hangs a fixed clearance above the floor at its depth, so
near cards are big and low, far cards small and high, and the eye reads
distance without any 3D. `Sim.perspective(d, u)` is the single source of
truth; the backdrop is drawn from the same constants so the wall and floor
lines agree with where cards hang.

Targets are rejection-sampled inside the level's depth band and spread, and
must visibly move from the previous spot. Decoys roam the whole bay (any
depth, full width). The separation rule: two cards at similar depth may
overlap by at most ~30% of their width; cards at clearly different depths may
layer — the near one paints in front — provided the far card's head circle
(plus 12 px) is clear of the near card and at least 40% of its width shows.
Without layering the bay physically cannot hold three cards; with it, 400
samples per decoy place them ~95% of the time overall (100% on static
levels, ~90% beside the fastest movers), and a decoy that cannot be placed
is simply skipped for that round (never overlapped).

Beside a mover, a decoy must also be clear of the target everywhere along
the path the carrier will take before Lane 8 can possibly fire — the
level's slowest reaction plus jitter, capped by `driftSweepSec`. The path
is sampled every ~30 px with bounces applied (`Sim.driftAt`), plus the lane
edge itself if it bounces, and the direction is known because it is drawn
before the decoys are placed. Checking both directions instead (v2.2's
first attempt) halved placement; three decoys never fit at all and were
dropped from the table.

## Movers

`params.drift` is a speed in design px/s. `beginRound` picks the sign and
computes the lane bounds at the target's depth (`driftMin/Max`, the same
reach `perspective` uses); `step` slides `target.x` only while the state is
FIRE and reverses at a bound; `go` carries the signed speed so the sound
can hum in the right ear. Hit-testing reads `target.x` live, and the
renderer copies it into the target's view every frame while the card is
exposed, so picture and rules agree to the pixel. The carrier tween that
brought the card in has finished before HOLD, so nothing fights over x.
Holes are card-local and so ride along; the next round's carrier move
starts from wherever the mover stopped.

## Hit detection

One flattened polygon (`shapes.js`) is the silhouette for drawing *and*
hit-testing; the shoulders' curves are sampled once into it, so no canvas
`isPointInPath` is needed and the Sim stays pure. Cards are tested nearest
first — the same order they are painted in reverse — so if a white card hangs
in front of the target, the white card is what you hit. The card margin
outside the silhouette is "paper": a hole, no points, Lane 8 takes the round.

While the card is live, the drawn width IS the Sim's `turn` (Back-out
easing, overshooting slightly past face-on and settling); local x is divided
by it, so a shot mid-turn is genuinely aiming at a narrower card, and a shot
during the overshoot gets the extra width it can see. Below a quarter turn
nothing can be hit.

Head radius 32 at near scale 0.92 is ~43 pt across on a 390 pt phone — at
Apple's 44 pt minimum. At far scale it is ~29 pt; only levels 9–10 put the
carrier all the way back. Measure on a device before changing either.

## Lighting without WebGL

The world is painted at full brightness. A half-resolution `LightLayer` is
then filled with darkness (`1 − ambient`) and lamp pools are cut out of it
with `destination-out` using a cached soft disc; the layer is composited over
the world, and warm/red/green/flash glows are added on top with `lighter`.
Dimming a level is one number (`holdLight` → ambient); a lamp is a position,
a radius and an intensity. Ignition is a keyframed flicker; a `dip`
multiplier on each card view lets a head hit jolt the tube and the title
stutter it. The muzzle flash cuts and glows at the pistol's muzzle tip, the
impact flash is a small additive sprite at the hit point. This is the whole
"engine upgrade" the look rests on and it costs two full-screen composites.

## The pistol

Drawn in screen space after the lighting pass, so nothing in the world
occludes it and the zoom punch does not scale it; it takes half the camera
shake, because it is in the shooter's hand rather than on the wall.
`buildGun` lays the geometry out once along the barrel axis (`t` along,
`s` across) from a pivot below the bottom edge toward the vanishing point,
as flat point arrays; `drawGun` only translates (recoil back along the
axis), rotates (muzzle rise about the pivot) and offsets the slide group
(the cycle). The slide's top face carries a rim light that brightens under
the muzzle flash and a wash of whatever the lane signal is showing. The
muzzle tip, ejection port and every recoil number live in `LOOK.gun`.
Nothing about it touches the Sim: a shot is a shot whether the gun is drawn
or not, and reduced motion simply skips the recoil.

## Phone performance (v2.2)

The first phone test called the game laggy. CPU time per frame was under a
millisecond on desktop, so the cost was GPU fill rate: at 2× device pixels
a frame blitted the backdrop, the light layer, the vignette, two or three
lamp pools each the size of the screen with `lighter`, and 45 grain tiles
under `overlay` — a non-separable blend that mobile Skia and WebKit take
slow paths for — plus a `backdrop-filter` blur on the title overlay that
re-blurred the live canvas every frame. What changed:

- **Glow layer.** All the big soft additive glows (pools, lamp cores, the
  signal, the muzzle, Lane 8's flash) draw into a half-resolution canvas
  with `lighter` and land on the world as one blit (`GlowLayer`, next to
  `LightLayer`). Sparks, dust, rings, the tracer and the impact star stay
  full-resolution because their edges matter. A frame's additive fill went
  from ~3 screens to ~1.
- **Grain** is pre-tiled into one oversize sheet and drawn once with
  `source-over` at 5% — one blit, no blend mode.
- **No `backdrop-filter`** on the overlay; the gradient is a little darker
  instead.
- **Device pixels start at 1.5× on touch devices** (`pointer: coarse`),
  2× elsewhere; the art is lit and soft so the difference is invisible and
  the fill is 44% lower. The governor now decides every 1.5 s after a 1 s
  warm-up and steps 2 → 1.5 → 1.25 → 1, dropping the grain at 1.25.
- **`desynchronized: true`** on the 2D context lets Chrome skip the
  compositor queue for the canvas, which is a measurable cut in tap-to-
  photon latency on Android.
- The canvas's size is watched with a `ResizeObserver` instead of a
  `getBoundingClientRect` per frame (a forced layout whenever the HUD
  animates), and the draw order array is reused rather than sliced.

None of this was measured on the phone that lagged; it was reasoned from
the frame composition. `L7.game.quality.dprCap` after a few rounds says
whether the governor had to step down.

## The hit

Everything at the impact is presentation on top of one `shot:player`
event. The tracer is two strokes from the pistol's muzzle to the hit,
real-time, gone in 60 ms. The impact flash and the four-point star share
one entry in `flashes` (real time, so they read through the hit-stop).
The hole sprite draws at 1.8× and settles to 1× over 120 ms on the game
clock, so hit-stop freezes it at its largest. Paper chips, four larger
torn pieces with more drag, and two small smoke puffs come from the
existing pooled emitters with overrides. The score float is a baked text
sprite (no text layout mid-hit) that rises 54 px and fades in real time.

## Sprites and resolution

Everything is drawn in code but drawn once: cards, holes (three variants),
glows, smoke, sparks, the impact flash, the backdrop, the vignette and two
grain tiles are offscreen canvases at device resolution. Sprites rebuild
only when the device-pixels-per-design-unit crosses a half step, and once
more when web fonts finish loading (the card's printed numbers and the wall
stencil are baked in). The card shadow is stacked rectangles, not
`ctx.filter`, because older Safari ignores `filter` and would leave a hard
black box; it is drawn inside the card's own transform so it swings and
squashes with the card.

## Particles and pooling

Every emitter preallocates its pool (paper 90, sparks 60, dust 120, …) and
never allocates during play; when a pool is exhausted the particle is
dropped. Sparks are stretched along their velocity; paper chips spin and
have drag; dust streams under each lit lamp at 10/s and lives ~3 s.

## Camera

Trauma accumulates per hit and decays; shake is `trauma²` × 15 px with a
0.7° roll, driven by stacked sines so it reads as hand-held rather than
static. A hit zooms 1.075× (head) toward the impact point, not the screen
centre, in 90 ms and back in 420 ms. Reduced-motion disables zoom, slow-mo,
recoil and haptics and cuts trauma to 30%.

## Quality governor

After a two-second warm-up, if more than 70 of 180 frames exceed 24 ms the
renderer drops device-pixel cap 2 → 1.5 → 1 and turns the grain off. It never
steps back up; oscillating quality is worse than steady lower quality.

## Save

Version 3, migrated from v1 and v2 through a fallthrough ladder (`store.js`),
with missing fields filled from defaults and unknown versions replaced.
Stores the best reaction, the match record, the level the title offers, the
highest level cleared, the mute flag, per-level stats (played, won, best
reaction), today's daily record and the daily counters and streak.
`localStorage` with an in-memory fallback; a failed write never throws into
the game. `Reset progress` on the title is two-tap to avoid a blocking
`confirm()`.

`recordLevelEnd(save, result)` is the only writer of progression and is
pure, so the tests pin the rules: a ladder win raises `level` and `cleared`
but replaying an old level never lowers them; a daily updates only the daily
fields; the streak needs consecutive day numbers.

## Offline and install

`manifest.webmanifest` (fullscreen, portrait, the generated icons, a
maskable variant) plus `sw.js`. The worker precaches the whole shell on
install and then answers every same-origin GET network-first with the cache
as fallback: online players always get the current build, a player in a
tunnel gets the last one they loaded, and a navigation with nothing cached
falls back to `index.html`. Registration is skipped on `file://`, where it
would fail anyway.

**Freshness (v2.2.1).** GitHub Pages sends every file with
`Cache-Control: max-age=600`, and the first phone test caught what that
does: a plain `fetch` inside the worker returned a ten-minute-old build
while online, and the precache filled itself from the same stale copies.
What the worker does now, and why each piece is there (an adversarial
review of the first version of this change found the gaps):

- Every request is fetched with `cache: "no-cache"` (revalidate with the
  server — a 304 when nothing changed, one round trip) via `fetch(url,
  init)`, not `new Request(navigationRequest, init)`, which older engines
  refuse. A 404 or 5xx while a good copy exists is answered from the
  cache. On a link that is up but silent, the cached copy is served after
  3.5 s rather than a white page.
- The precache uses `cache: "reload"` (bypass the HTTP cache), scripts
  before the two page entries, so a partial failure cannot leave the HTTP
  cache holding a fresh page next to stale scripts. A failed precache is
  logged and leaves the previous worker in charge.
- The build version is a literal in `sw.js` (`BUILD`), equal to
  `CONFIG.version` and `package.json` — the rules tests enforce all
  three. It has to be in the worker file itself: WebKit's update check
  compares only that file's bytes, so a bump that lived in an imported
  script would never install on an iPhone. Registration passes
  `updateViaCache: "none"` so the check bypasses the HTTP cache.
- Activate retires only `lane7-*` caches (CacheStorage is per origin and
  `zarah-ai-team.github.io` is shared with other projects), claims every
  open page and tells it which build is serving. `main.js` compares that
  with its own `CONFIG.version`: on the title it reloads at once,
  otherwise before the next level or daily starts — never mid-round,
  never on a first visit (nothing to differ from), never when the page is
  already current. A page that loaded before the worker activated asks
  the controller for its build on boot and on `controllerchange`.
- A home-screen app resumes without a navigation, so `main.js` asks the
  registration for an update check whenever the page becomes visible.
- The title shows the version bottom-right, so "which build is this
  phone on" is a glance, not a guess; `hud.js` guards that element
  because for one open after a release the previous worker can pair an
  older page with newer scripts.

Known limits: the very first open after **this** release is still served
by the previous worker with plain HTTP-cache semantics, so a phone that
last played within ten minutes of the deploy can see the old build once
more and the new one on the following open — every release after this
one is covered by the announce-and-reload above. GitHub's CDN can serve a
mixed build for a few minutes after a deploy; treat a release as live ten
minutes after the workflow finishes. iOS Safari (browser tab, not
home-screen) deletes all site storage — cache, worker and the save — after
seven days without a visit; the home-screen install is exempt, which is
one more reason to push it. `apple-mobile-web-app-*` metas and the 180 px touch icon
cover iOS "Add to Home Screen", which is the closest thing to an app the
web build gets.

## Share

`navigator.share` with a title, one line of text and the page URL where it
exists (every phone browser); otherwise the text goes to the clipboard and
the HUD says so. From `file://` there is no URL, so the text stands alone.

## Fonts

Barlow 400/600 and Barlow Condensed 500/700, Latin subset, woff2, in
`lane7/fonts/`, declared with `@font-face` and `font-display: swap`; the two
that paint first are preloaded. The card and stencil sprites are re-baked
when `document.fonts.ready` resolves, so the system-font fallback is only
ever a first-paint flash. SIL Open Font License; keep the licence note in
the README.

## Lifecycle

`visibilitychange` → hidden aborts an in-progress round (re-armed at a fresh
spot, no penalty, "Range cold — round restarted") and suspends the audio
context; visible resets the frame clock and resumes audio. A phone call
should never cost a round — or a daily.

## Known issues

1. No real-device measurements yet. Headless numbers are software-rendered
   and meaningless; the v2.2 fill-rate work was reasoned, not measured.
   The governor exists precisely because we haven't measured.
2. No gamepad. The action layer is ready for one (`input.js`).
3. Reaction is measured from state change, not paint (see Timing).
4. The Sim's `abortRound` picks a new spot; a strict "resume where you were"
   would need the hold timer preserved. Not worth it. On the daily this is
   the one way two players' runs can diverge.
5. Haptics are Android-only; iOS Safari has no `navigator.vibrate`. They
   also require a real user gesture in the session, so a scripted shot
   (tests, the console) never buzzes.
6. The daily's "one attempt" is enforced per device (it lives in the save).
   Clearing site data is a second attempt. A server fixes that, and nothing
   else does.
7. When testing service-worker changes on localhost, bump `BUILD` or
   unregister the worker; the old cache serves the old build for one load.

## Porting

**To Phaser 3 (web-first path):** `Sim`, `config.js`, `shapes.js`,
`rng.js`, `store.js`, `daily.js` and `sound.js` copy across untouched.
`Renderer` becomes a Scene: `LightLayer` → `Light2D` pipeline (one `addLight`
per lamp), the darkness/ambient → `setAmbientColor`, glows → additive sprites
+ camera `postFX.addBloom`, emitters → `ParticleEmitter` configs (the numbers
transfer), `Camera` → `cameras.main.shake/zoomTo/flash`, `Tweens` →
`this.tweens`, hit-stop/slow-mo → `time.timeScale` + the Sim accumulator, the
pistol → a fixed-to-camera container. HUD stays DOM or becomes a parallel HUD
scene.

**To Godot 4 (iOS path):** `CONFIG` → a `Resource`; `Sim` → a `RefCounted`
class with no node dependencies (keep it testable); fixed step via
`_physics_process` at 60 ticks; cards → `Node2D` with a `Sprite2D` and a
`PointLight2D` per carrier, ambient via `CanvasModulate`; particles →
`GPUParticles2D`; audio → `AudioStreamPlayer` with real files recorded from
the synthesis briefs; input through the InputMap as actions, never raw events;
save → `user://save.json` through the same migration ladder; the daily's day
and seed arithmetic is ten lines and copies verbatim.
