/* ===================================================================
   LANE 7 — CONFIG
   Every tunable number in the game lives here. Nothing else in src/
   should contain a magic number that a designer might want to touch.
   When this moves to an engine it becomes a resource / JSON file.
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

L7.CONFIG = {
  // The build version. The service worker names its cache after it (so a
  // bump retires the previous build on every phone) and the title shows
  // it, so "which version am I on" is never a guess. Keep package.json in
  // step.
  version: "2.2.1",

  design: { w: 540, h: 960 },        // portrait phone design space

  rounds: 5,
  points: { head: 5, body: 3, miss: 0 },
  opponentPoints: 3,                 // Lane 8 always takes the body

  // Lane 8's reaction per round is lerped across `opp` in the level
  // table, then jittered. The floor guarantees a level is never
  // physically unwinnable: nobody reliably taps a located target in
  // under ~400ms on a phone.
  opponentJitterMs: 80,
  opponentFloorMs: 400,

  // Movers. A level's `drift` is how fast the carrier slides sideways
  // (design px/s) while the card is exposed; it bounces off the lane
  // edges. Decoys are kept clear of the path the target will take before
  // Lane 8 fires — the level's slowest reaction plus jitter — so a white
  // card never slides over the head. `driftSweepSec` caps that window.
  driftSweepSec: 0.8,

  // Round timeline. ARM is the carrier moving to its new spot; taps in
  // its first `armGraceMs` are ignored (not punished) so a tap-to-skip
  // on the banner can't roll straight into a false start.
  armGraceMs: 300,
  armSettleMs: 220,                  // pause after the carrier stops, before the red light
  moveMs: [420, 900],                // carrier travel time, scaled by distance moved
  bannerMs: 1500,
  bannerSkipAfterMs: 450,

  // Target card geometry in card-local units (see shapes.js).
  target: { headR: 32, headY: -100, cardW: 220, cardH: 298, cardTop: -154 },

  // The range is a 2.5D corridor. Depth d runs 0 (near, just past the
  // firing line) to 1 (far wall). Everything about a carrier's screen
  // position and size derives from d so near targets are big and low,
  // far targets small and high — the eye reads it as distance for free.
  // Head radius 32 × nearScale 0.92 lands at ~43pt across on a 390pt
  // phone — Apple's 44pt minimum, give or take. At farScale it is 29pt:
  // demanding, and deliberately so, because only levels 9–10 put the
  // carrier all the way back. Measure on a real device before shrinking.
  perspective: {
    nearHalfW: 270, farHalfW: 200,
    nearFloorY: 660, farFloorY: 350,
    nearCeilY: -40,  farCeilY: 120,
    nearScale: 0.92, farScale: 0.62,
    nearGap: 40,     farGap: 12,      // clearance between card bottom and floor
    edgeMargin: 16
  },
  placementTries: 400,               // rejection samples per decoy before giving up on it

  // Feel. Trauma is squared before it becomes shake, so small hits
  // barely register and big ones land — linear shake feels mushy.
  feel: {
    trauma:   { head: 0.62, body: 0.42, miss: 0.30, opp: 0.34, early: 0.30 },
    hitstopMs:{ head: 70,   body: 28 },
    slowMo:   { scale: 0.32, ms: 340 },
    zoom:     { head: 1.075, body: 1.025, inMs: 90, outMs: 420 },
    maxShakePx: 15,
    maxShakeDeg: 0.7
  },

  reactTags: [[300, "Lightning"], [420, "Sharp"], [560, "Steady"], [Infinity, "Late"]],

  maxHoles: 14,
  maxWallMarks: 10,

  seed: 20260910,
  fixedSeed: null,                   // set a number to make every run identical

  // Daily challenge: one attempt per UTC day, same seed for everyone.
  // The level rotates through the table; levelOffset shifts which
  // level lands on which day without touching the rotation.
  daily: { levelOffset: 0, seedSalt: 0x5EED0DA7 },

  // Haptics in ms (Android Chrome; iOS Safari ignores vibrate). Off
  // entirely under reduced motion.
  haptics: { head: 28, body: 14, miss: 0 },

  /* Level table. One row per level; the game reads nothing else to
     decide difficulty. Columns:
       opp        Lane 8 reaction ms, lerped from round 1 to round 5
       hold       red-light wait window ms — wider is harder to anticipate
       dist       depth range the carrier can stop in (0 near … 1 far)
       spread     lateral randomness, 0 = centre only, 1 = full lane width
       holdLight  how lit the range is while you wait: 1 you watch the
                  carrier park, 0 pitch black until the lamp snaps on
       lamp       brightness/size of the lamp over the target at GO
       decoys     white NO-SHOOT cards that turn with the target
       drift      mover speed while exposed, design px/s (0 = static)
       turnMs     how fast the card snaps face-on

     The wall moves ~50 ms a level. Levels 1–2 are lit and static, 3 adds
     the first no-shoot, 4–5 take the light away, 6 starts the carrier
     moving, 7–8 add a second decoy and distance, 9–10 push the mover,
     dim the lamp and put Lane 8 at the floor. Two decoys is the most the
     bay can hold next to a mover; a third fits so rarely it was a lie.  */
  levels: [
    { name: "Warm-up",      opp: [ 900,  810], hold: [1000, 2600], dist: [0.00, 0.25], spread: 0.50, holdLight: 1.00, lamp: 1.00, decoys: 0, drift:   0, turnMs: 120 },
    { name: "Range hot",    opp: [ 840,  750], hold: [1000, 2800], dist: [0.00, 0.40], spread: 0.70, holdLight: 0.80, lamp: 1.00, decoys: 0, drift:   0, turnMs: 115 },
    { name: "No-shoot",     opp: [ 780,  700], hold: [ 900, 3000], dist: [0.10, 0.50], spread: 0.85, holdLight: 0.60, lamp: 0.95, decoys: 1, drift:   0, turnMs: 110 },
    { name: "Lights low",   opp: [ 730,  650], hold: [ 900, 3200], dist: [0.15, 0.60], spread: 1.00, holdLight: 0.30, lamp: 0.90, decoys: 1, drift:   0, turnMs: 105 },
    { name: "Lights out",   opp: [ 680,  600], hold: [ 800, 3400], dist: [0.20, 0.70], spread: 1.00, holdLight: 0.05, lamp: 0.85, decoys: 1, drift:   0, turnMs: 100 },
    { name: "Movers",       opp: [ 630,  560], hold: [ 800, 3600], dist: [0.20, 0.80], spread: 1.00, holdLight: 0.00, lamp: 0.80, decoys: 1, drift:  50, turnMs:  95 },
    { name: "Hostage bay",  opp: [ 590,  520], hold: [ 700, 3800], dist: [0.30, 0.85], spread: 1.00, holdLight: 0.00, lamp: 0.72, decoys: 2, drift:  65, turnMs:  90 },
    { name: "Night bay",    opp: [ 550,  490], hold: [ 700, 4000], dist: [0.35, 0.90], spread: 1.00, holdLight: 0.00, lamp: 0.64, decoys: 2, drift:  80, turnMs:  85 },
    { name: "Hair trigger", opp: [ 510,  450], hold: [ 600, 4300], dist: [0.40, 1.00], spread: 1.00, holdLight: 0.00, lamp: 0.56, decoys: 2, drift:  95, turnMs:  80 },
    { name: "Lane 8",       opp: [ 470,  410], hold: [ 600, 4600], dist: [0.45, 1.00], spread: 1.00, holdLight: 0.00, lamp: 0.48, decoys: 2, drift: 110, turnMs:  75 }
  ]
};

if (typeof module !== "undefined") module.exports = L7.CONFIG;
