/* ===================================================================
   LANE 7 — CONFIG
   Every tunable number in the game lives here. Nothing else in src/
   should contain a magic number that a designer might want to touch.
   When this moves to an engine it becomes a resource / JSON file.
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

L7.CONFIG = {
  design: { w: 540, h: 960 },        // portrait phone design space

  rounds: 5,
  points: { head: 5, body: 3, miss: 0 },
  opponentPoints: 3,                 // Lane 8 always takes the body

  // Lane 8's reaction per round is lerped across `opp` in the level
  // table, then jittered. The floor guarantees a level is never
  // physically unwinnable: nobody reliably taps a located target in
  // under ~400ms on a phone.
  opponentJitterMs: 80,
  opponentFloorMs: 420,

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
       turnMs     how fast the card snaps face-on                       */
  levels: [
    { name: "Warm-up",      opp: [1200, 1000], hold: [1200, 2600], dist: [0.00, 0.15], spread: 0.35, holdLight: 1.00, lamp: 1.00, decoys: 0, turnMs: 120 },
    { name: "Range hot",    opp: [1100,  920], hold: [1100, 2800], dist: [0.00, 0.30], spread: 0.55, holdLight: 0.85, lamp: 1.00, decoys: 0, turnMs: 115 },
    { name: "Downrange",    opp: [1000,  840], hold: [1000, 3000], dist: [0.10, 0.45], spread: 0.70, holdLight: 0.65, lamp: 0.95, decoys: 0, turnMs: 110 },
    { name: "Lights low",   opp: [ 920,  760], hold: [1000, 3200], dist: [0.15, 0.55], spread: 0.80, holdLight: 0.40, lamp: 0.90, decoys: 0, turnMs: 105 },
    { name: "Lights out",   opp: [ 850,  700], hold: [ 900, 3400], dist: [0.20, 0.65], spread: 0.90, holdLight: 0.15, lamp: 0.85, decoys: 0, turnMs: 100 },
    { name: "No-shoot",     opp: [ 800,  660], hold: [ 900, 3600], dist: [0.20, 0.75], spread: 1.00, holdLight: 0.05, lamp: 0.80, decoys: 1, turnMs:  95 },
    { name: "Hostage bay",  opp: [ 750,  620], hold: [ 800, 3800], dist: [0.25, 0.85], spread: 1.00, holdLight: 0.00, lamp: 0.75, decoys: 1, turnMs:  90 },
    { name: "Night bay",    opp: [ 700,  580], hold: [ 800, 4000], dist: [0.30, 0.90], spread: 1.00, holdLight: 0.00, lamp: 0.68, decoys: 2, turnMs:  85 },
    { name: "Hair trigger", opp: [ 620,  520], hold: [ 700, 4200], dist: [0.35, 1.00], spread: 1.00, holdLight: 0.00, lamp: 0.60, decoys: 2, turnMs:  80 },
    { name: "Lane 8",       opp: [ 560,  460], hold: [ 700, 4500], dist: [0.40, 1.00], spread: 1.00, holdLight: 0.00, lamp: 0.52, decoys: 2, turnMs:  75 }
  ]
};

if (typeof module !== "undefined") module.exports = L7.CONFIG;
