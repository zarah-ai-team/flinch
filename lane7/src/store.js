/* ===================================================================
   Save. Versioned from the first commit, with a migration ladder.
   v1 stored a best reaction and a match record. v2 added level
   progress and the mute flag. v3 adds per-level stats, the daily
   challenge record and the daily streak.

   Storage goes through a tiny adapter: localStorage where available,
   memory otherwise (private mode, sandboxed previews). The game must
   never crash because saving failed.

   `recordLevelEnd` is the one place a finished level touches the save.
   It is a pure function of (save, result) so the progression rules —
   replaying an old level never regresses the ladder, a daily counts
   once, streaks need consecutive days — run headless in the tests.
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

L7.SAVE_VERSION = 3;
L7.SAVE_KEY = "lane7:save";

L7.defaultSave = function () {
  return {
    version: L7.SAVE_VERSION,
    bestReactMs: null,      // fastest shot that actually hit the card
    matchesPlayed: 0,
    matchesWon: 0,
    level: 1,               // level the title screen offers next
    cleared: 0,             // highest level beaten
    muted: false,
    // v3
    levelStats: {},         // { [level]: { played, won, bestReactMs } }
    daily: null,            // today's run: { day, level, done, won, youScore, oppScore, bestReactMs }; done=false means started and abandoned
    dailyPlayed: 0,
    dailyWon: 0,
    dailyStreak: 0,         // consecutive days won
    dailyLastWonDay: null   // day number of the last daily win, for the streak
  };
};

// Each version adds one case and falls through to the next. Never
// delete a case: a player can arrive from any older version.
L7.migrateSave = function (data) {
  if (!data || typeof data !== "object") return L7.defaultSave();
  switch (data.version) {
    case 1:
      data.level = 1;
      data.cleared = 0;
      data.muted = false;
      data.version = 2;
      // falls through
    case 2:
      data.levelStats = {};
      data.daily = null;
      data.dailyPlayed = 0;
      data.dailyWon = 0;
      data.dailyStreak = 0;
      data.dailyLastWonDay = null;
      data.version = 3;
      // falls through
    case 3:
      break;
    default:
      return L7.defaultSave();   // from the future, or garbage
  }
  // Belt and braces: fill anything a broken write left out.
  const d = L7.defaultSave();
  for (const k in d) if (!(k in data)) data[k] = d[k];
  if (!data.levelStats || typeof data.levelStats !== "object") data.levelStats = {};
  return data;
};

/* A level has ended. `r` is the Sim's level:end payload plus:
     mode          "ladder" | "daily"
     day           (daily) UTC day number the run belongs to
     bestReactMs   fastest hit in this run, or null if nothing hit
   Mutates and returns `save`. */
L7.recordLevelEnd = function (save, r) {
  const best = r.bestReactMs ?? null;
  if (r.mode === "daily") {
    save.daily = { day: r.day, level: r.level, done: true, won: !!r.won, youScore: r.youScore, oppScore: r.oppScore, bestReactMs: best };
    save.dailyPlayed++;
    if (r.won) {
      save.dailyWon++;
      // A streak is consecutive days won; a missed or lost day resets it.
      save.dailyStreak = (save.dailyLastWonDay === r.day - 1) ? save.dailyStreak + 1 : 1;
      save.dailyLastWonDay = r.day;
    } else {
      save.dailyStreak = 0;
    }
    return save;
  }
  save.matchesPlayed++;
  const st = save.levelStats[r.level] || (save.levelStats[r.level] = { played: 0, won: 0, bestReactMs: null });
  st.played++;
  if (best !== null && (st.bestReactMs === null || best < st.bestReactMs)) st.bestReactMs = best;
  if (r.won) {
    save.matchesWon++;
    st.won++;
    save.cleared = Math.max(save.cleared, r.level);
    // Replaying a cleared level never sends the title back to it.
    save.level = Math.max(save.level, r.next);
  }
  return save;
};

const memoryStore = {};
L7.Store = {
  get(key) {
    try { if (typeof localStorage !== "undefined") return localStorage.getItem(key); }
    catch (_) { /* storage blocked — fall through */ }
    return memoryStore[key] ?? null;
  },
  set(key, value) {
    try { if (typeof localStorage !== "undefined") { localStorage.setItem(key, value); return; } }
    catch (_) { /* quota or privacy mode — fall through */ }
    memoryStore[key] = value;
  },
  remove(key) {
    try { if (typeof localStorage !== "undefined") localStorage.removeItem(key); } catch (_) { /* ignore */ }
    delete memoryStore[key];
  }
};

L7.loadSave = function () {
  const raw = L7.Store.get(L7.SAVE_KEY);
  if (!raw) return L7.defaultSave();
  try { return L7.migrateSave(JSON.parse(raw)); }
  catch (_) { return L7.defaultSave(); }   // corrupt — defaults, not a crash
};
L7.persistSave = function (save) { L7.Store.set(L7.SAVE_KEY, JSON.stringify(save)); };
L7.wipeSave = function () { L7.Store.remove(L7.SAVE_KEY); };

if (typeof module !== "undefined") module.exports = { migrateSave: L7.migrateSave, defaultSave: L7.defaultSave, recordLevelEnd: L7.recordLevelEnd, Store: L7.Store };
