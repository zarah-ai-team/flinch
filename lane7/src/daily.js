/* ===================================================================
   Daily challenge. Pure date and seed arithmetic — no DOM, no Sim —
   so it runs in the tests and every player on Earth agrees on what
   "today" is (UTC) and what today's level and seed are.

   The day number is whole UTC days since the epoch. The level rotates
   through the table so each day asks a different question; the seed
   is a hash of the day, and because the Sim draws every random number
   in an order that does not depend on what the player does, one seed
   means the same five positions, hold waits and Lane 8 reactions for
   everyone. One attempt per day: the point is that nobody has seen
   the positions before.
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

(function () {
  const DAY_MS = 86400000;

  L7.Daily = {
    dayNumber(nowMs) { return Math.floor(nowMs / DAY_MS); },

    // "2026-09-11": what the player sees and what the save records.
    dayKey(day) { return new Date(day * DAY_MS).toISOString().slice(0, 10); },

    levelFor(day, cfg) {
      const n = cfg.levels.length;
      return ((day + cfg.daily.levelOffset) % n + n) % n + 1;
    },

    // Integer hash of the day, mixed so neighbouring days share nothing.
    seedFor(day, cfg) {
      let h = (day ^ cfg.daily.seedSalt) >>> 0;
      h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
      h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
      return (h ^ (h >>> 16)) >>> 0;
    },

    msUntilNext(nowMs) { return DAY_MS - (nowMs % DAY_MS); },

    countdownText(ms) {
      if (ms < 60000) return "under a minute";
      const m = Math.ceil(ms / 60000);
      const h = Math.floor(m / 60), mm = m % 60;
      if (h === 0) return `${mm}m`;
      return `${h}h ${String(mm).padStart(2, "0")}m`;
    }
  };
})();

if (typeof module !== "undefined") module.exports = L7.Daily;
