/* ===================================================================
   Seeded randomness. Math.random() can't be replayed; mulberry32 can.
   The game keeps TWO streams: `sim` decides hold times, jitter and
   target placement, `fx` feeds particles and shake. Separating them is
   what keeps a run reproducible — in v1 the shake consumed the same
   stream as the rules, so the sequence depended on how many frames the
   player took to shoot, which quietly made replays impossible.
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

L7.mulberry32 = function (seed) {
  let a = seed >>> 0;
  const next = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.pick  = (arr) => arr[Math.floor(next() * arr.length)];
  next.sign  = () => (next() < 0.5 ? -1 : 1);
  return next;
};

if (typeof module !== "undefined") module.exports = L7.mulberry32;
