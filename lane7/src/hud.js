/* ===================================================================
   HUD. Scores, pips, status line, the round banner and the overlay
   cards (title with level select and the daily, level clear, level
   lost, daily result) — all DOM, layered over the canvas. DOM text is
   crisper than canvas text, costs nothing per frame, and stays put
   while the world shakes, which is exactly what a scoreboard should do.

   The HUD reads the Sim and the save; it writes to neither. Anything
   the player chooses here (a level, the daily, share, reset) goes out
   through the callbacks main.js supplies.
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

(function () {
  const $ = (id) => document.getElementById(id);

  class Hud {
    constructor(o) {
      this.sim = o.sim; this.save = o.save; this.cfg = o.cfg; this.tweens = o.tweens;
      this.onStart = o.onStart; this.onDaily = o.onDaily; this.onTitle = o.onTitle;
      this.onMute = o.onMute; this.onReset = o.onReset; this.onShare = o.onShare;
      this.dailyInfo = o.dailyInfo;       // () => { day, key, level, name, msLeft, played, result }
      this.lastEnd = null;
      this.resetArmed = false;
      this.tick = 0;                      // last countdown refresh, ms
      this.el = {
        you: $("youScore"), opp: $("oppScore"), oppSide: $("oppSide"), pips: $("pips"), level: $("levelTag"),
        banner: $("banner"), verdict: $("verdict"), detail: $("detail"), bannerBest: $("bannerBest"),
        status: $("status"), sub: $("sub"), note: $("note"),
        overlay: $("overlay"), title: $("title"), kicker: $("kicker"), blurb: $("blurb"), rules: $("rules"), cue: $("cue"),
        levels: $("levels"), daily: $("daily"), dailyKicker: $("dailyKicker"), dailyText: $("dailyText"), dailyAction: $("dailyAction"),
        record: $("record"), actions: $("actions"), share: $("share"),
        mute: $("mute"), reset: $("reset")
      };
      this.buildPips();
      this.buildLevels();
      // Controls inside the stage must not fall through to the canvas as a shot.
      const control = (el, fn) => el.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); ev.preventDefault(); fn(ev); });
      control(this.el.mute, () => this.onMute());
      control(this.el.reset, () => {
        if (!this.resetArmed) { this.resetArmed = true; this.el.reset.textContent = "Tap again to reset progress"; return; }
        this.resetArmed = false; this.el.reset.textContent = "Reset progress";
        this.onReset();
      });
      control(this.el.daily, () => { if (!this.el.daily.classList.contains("done")) this.onDaily(); });
      control(this.el.share, () => {
        Promise.resolve(this.onShare(this.lastEnd)).then((r) => {
          if (r === "copied") this.note("Copied to clipboard");
          else if (r === "unsupported") this.note("Sharing is not available here");
        });
      });
      this.bind();
    }

    buildPips() {
      this.el.pips.innerHTML = "";
      for (let i = 0; i < this.cfg.rounds; i++) this.el.pips.appendChild(document.createElement("i"));
    }

    buildLevels() {
      this.el.levels.innerHTML = "";
      this.chips = [];
      this.cfg.levels.forEach((P, i) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "chip"; b.dataset.level = i + 1;
        b.title = P.name;
        b.innerHTML = `<span class="n">${i + 1}</span><span class="ms"></span>`;
        b.addEventListener("pointerdown", (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          if (b.classList.contains("locked")) { this.note(`Clear level ${i} first`); return; }
          this.onStart(i + 1);
        });
        this.el.levels.appendChild(b);
        this.chips.push(b);
      });
    }

    bind() {
      const sim = this.sim;
      sim.on("title", () => this.showTitle());
      sim.on("level:start", (e) => {
        this.el.level.textContent = (e.mode === "daily" ? "Daily · " : "") + `Level ${e.level} · ${e.params.name}`;
        this.syncScores(); this.hideBanner(); this.hideOverlay();
        this.setStatus("Range hot", "");
      });
      sim.on("round:begin", (e) => { this.hideBanner(); this.setStatus("Carrier moving", `Round ${e.round} of ${e.rounds}`); });
      sim.on("round:restart", () => this.note("Range cold — round restarted"));
      sim.on("hold", (e) => this.setStatus("Hold", `Round ${e.round} of ${this.cfg.rounds}`));
      sim.on("go", () => this.setStatus("Fire", ""));
      sim.on("shot:player", (e) => this.onPlayerShot(e));
      sim.on("shot:opponent", (e) => this.onOpponentShot(e));
      sim.on("false-start", () => {
        this.showBanner(false, "Fired early", "The light was still red");
        this.setStatus("Fired early", ""); this.syncScores(true);
      });
      sim.on("level:end", (e) => { this.hideBanner(); this.showLevelEnd(e); });
    }

    /* ---------- scoreboard ---------- */
    // holdOpp: Lane 8's points appear when HE fires, a beat after a miss.
    syncScores(oppPop, youPop, holdOpp) {
      const sim = this.sim;
      if (this.el.you.textContent !== String(sim.youScore)) { this.el.you.textContent = sim.youScore; if (youPop) this.pop(this.el.you); }
      if (!holdOpp && this.el.opp.textContent !== String(sim.oppScore)) { this.el.opp.textContent = sim.oppScore; if (oppPop) this.pop(this.el.opp); }
      const pips = this.el.pips.children;
      for (let i = 0; i < pips.length; i++) pips[i].className = sim.results[i] || "";
    }
    pop(el) { el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
    flashOpponent() {
      this.el.oppSide.classList.add("fired");
      setTimeout(() => this.el.oppSide.classList.remove("fired"), 260);
    }

    setStatus(main, sub) { this.el.status.textContent = main; this.el.sub.textContent = sub ?? ""; }
    note(text) {
      this.el.note.textContent = text; this.el.note.classList.add("show");
      clearTimeout(this.noteT); this.noteT = setTimeout(() => this.el.note.classList.remove("show"), 2200);
    }

    reactTag(ms) { for (const [lim, tag] of this.cfg.reactTags) if (ms < lim) return tag; return ""; }

    /* ---------- banner ---------- */
    showBanner(good, verdict, detail, countMs, best) {
      const b = this.el.banner;
      this.el.verdict.textContent = verdict;
      b.className = "show " + (good ? "good" : "bad");
      if (countMs !== undefined) {
        // The reaction time rolls up from zero: a number you watch land
        // is read; a number that just appears is skimmed.
        this.tweens.kill("count");
        this.tweens.add({ from: 0, to: countMs, duration: 320, ease: "cubicOut", realtime: true, tag: "count",
          onUpdate: (v) => { this.el.detail.textContent = detail.replace("{ms}", Math.round(v)); } });
      } else this.el.detail.textContent = detail || "";
      // Re-insert the tag so its animation restarts every time it is earned.
      this.el.bannerBest.hidden = !best;
      if (best) { const t = this.el.bannerBest; t.remove(); b.appendChild(t); }
    }
    hideBanner() { this.el.banner.className = ""; this.el.bannerBest.hidden = true; }

    onPlayerShot(e) {
      const tag = this.reactTag(e.reactMs);
      switch (e.zone) {
        case "head":
          this.showBanner(true, `Head · +${e.pts}`, `{ms} ms · ${tag}`, e.reactMs, e.best);
          this.setStatus("Head", `${e.reactMs} ms`); break;
        case "body":
          this.showBanner(true, `Body · +${e.pts}`, `{ms} ms · ${tag}`, e.reactMs, e.best);
          this.setStatus("Body", `${e.reactMs} ms`); break;
        case "decoy":
          this.showBanner(false, "No-shoot", "{ms} ms · that was the white card", e.reactMs);
          this.setStatus("No-shoot", ""); break;
        case "card":
          this.showBanner(false, "Paper", "{ms} ms · outside the silhouette", e.reactMs);
          this.setStatus("Paper", ""); break;
        default:
          this.showBanner(false, "Missed", "{ms} ms · Lane 8 takes the round", e.reactMs);
          this.setStatus("Missed", "");
      }
      this.syncScores(false, e.pts > 0, e.pts === 0);
    }

    onOpponentShot(e) {
      this.flashOpponent();
      if (e.late) { this.syncScores(true); return; }
      this.showBanner(false, "Too slow", `Lane 8 fired in ${e.reactMs} ms`);
      this.setStatus("Too slow", "");
      this.syncScores(true);
    }

    /* ---------- overlays ---------- */
    showOverlay() { this.el.overlay.hidden = false; requestAnimationFrame(() => this.el.overlay.classList.add("in")); }
    hideOverlay() { this.el.overlay.classList.remove("in"); this.el.overlay.hidden = true; }

    levelLine(level) {
      const P = this.cfg.levels[level - 1];
      return `Level ${level} · ${P.name}`;
    }

    // Title: the level select, the daily and the record all read the save.
    showTitle() {
      const save = this.save, level = save.level, best = save.bestReactMs;
      this.lastEnd = null;
      this.el.title.textContent = "Flinch";
      this.el.kicker.textContent = this.levelLine(level);
      this.el.blurb.textContent = `Don't flinch. Wait for the buzzer, find the card: one shot, five rounds.` +
        ` Lane 8 reacts in about ${this.sim.oppAvgMs(level)} ms.`;
      this.el.rules.innerHTML = "Head 5 &middot; Body 3 &middot; Miss 0<br>Lane 8 takes the body every time for 3. White cards are no-shoots.";

      this.chips.forEach((b, i) => {
        const n = i + 1, st = save.levelStats[n];
        b.className = "chip " + (n <= save.cleared ? "done" : n === level ? "next" : "locked");
        b.querySelector(".ms").textContent = st && st.bestReactMs !== null ? `${st.bestReactMs} ms` : (n <= save.cleared ? "clear" : "");
      });
      this.el.levels.hidden = false;
      this.refreshDaily();
      this.el.daily.hidden = false;

      const bits = [];
      if (save.matchesPlayed) bits.push(`<b>${save.matchesPlayed}</b> ${save.matchesPlayed === 1 ? "match" : "matches"} · <b>${save.matchesWon}</b> won`);
      if (best) bits.push(`fastest hit <b>${best} ms</b>`);
      if (save.dailyWon) bits.push(`<b>${save.dailyWon}</b> ${save.dailyWon === 1 ? "daily" : "dailies"} won`);
      this.el.record.innerHTML = bits.join(" · ");
      this.el.record.hidden = bits.length === 0;

      this.el.cue.textContent = `Tap anywhere for level ${level}`;
      this.el.actions.hidden = !best;
      this.el.share.textContent = "Share your best";
      this.el.level.textContent = this.levelLine(level);
      this.setStatus("Range cold", best ? `Fastest hit ${best} ms` : "");
      this.el.reset.hidden = save.cleared === 0 && save.level === 1 && save.dailyPlayed === 0;
      this.showOverlay();
    }

    refreshDaily() {
      const d = this.dailyInfo(), el = this.el.daily;
      const name = this.cfg.levels[d.level - 1].name;
      if (!d.played) {
        el.className = "daily ready";
        this.el.dailyKicker.textContent = "Today's daily";
        this.el.dailyText.textContent = `Level ${d.level} · ${name} · one attempt, same range for everyone`;
        this.el.dailyAction.textContent = "Play";
      } else {
        const r = d.result;
        el.className = "daily done";
        if (!r.done) {
          this.el.dailyKicker.textContent = "Daily forfeited";
          this.el.dailyText.textContent = "The run was left unfinished";
        } else {
          this.el.dailyKicker.textContent = r.won ? "Daily cleared" : "Daily lost";
          this.el.dailyText.textContent = `${r.youScore}–${r.oppScore}` + (r.bestReactMs ? ` · fastest ${r.bestReactMs} ms` : "") +
            (this.save.dailyStreak > 1 ? ` · streak ${this.save.dailyStreak}` : "");
        }
        this.el.dailyAction.textContent = `Next in ${L7.Daily.countdownText(d.msLeft)}`;
      }
    }

    showLevelEnd(e) {
      this.lastEnd = e;
      const score = `${e.youScore} to ${e.oppScore}.`;
      const best = this.save.bestReactMs;
      this.el.levels.hidden = true; this.el.daily.hidden = true; this.el.record.hidden = true;
      if (e.mode === "daily") {
        const d = this.dailyInfo();
        this.el.title.textContent = e.won ? "Daily cleared" : "Daily lost";
        this.el.kicker.textContent = `Daily · ${this.levelLine(e.level)}`;
        this.el.blurb.textContent = score +
          (e.won && this.save.dailyStreak > 1 ? ` ${this.save.dailyStreak} days in a row.` : "") +
          ` Next daily in ${L7.Daily.countdownText(d.msLeft)}.`;
        this.el.cue.textContent = "Tap to return to the range";
      } else if (e.complete) {
        this.el.title.textContent = "Range master";
        this.el.kicker.textContent = "All ten levels cleared";
        this.el.blurb.textContent = `${score} Lane 8 has nothing left.` + (best ? ` Fastest hit ${best} ms.` : "");
        this.el.cue.textContent = "Tap to run level 10 again";
      } else if (e.won) {
        this.el.title.textContent = `Level ${e.level} clear`;
        this.el.kicker.textContent = `Next: ${this.levelLine(e.next)}`;
        this.el.blurb.textContent = `${score} Lane 8 now reacts in about ${this.sim.oppAvgMs(e.next)} ms.`;
        this.el.cue.textContent = "Tap to continue";
      } else {
        this.el.title.textContent = "Lane 8 holds";
        this.el.kicker.textContent = this.levelLine(e.level);
        const hint = e.youScore <= 6 ? " Two heads beat three losses." : " One more head would have done it.";
        this.el.blurb.textContent = score + hint;
        this.el.cue.textContent = "Tap to retry";
      }
      this.el.rules.innerHTML = "";
      this.el.actions.hidden = !(e.won || best);
      this.el.share.textContent = e.won ? "Share" : "Share your best";
      this.setStatus("Range cold", "");
      this.el.reset.hidden = true;
      this.showOverlay();
    }

    // A tap while an overlay is up.
    advance() {
      if (this.sim.state === "TITLE") { this.onStart(this.save.level); return; }
      if (this.sim.state === "OVER" && this.lastEnd) {
        if (this.lastEnd.mode === "daily") this.onTitle();
        else this.onStart(this.lastEnd.next);
      }
    }

    setMuted(m) { this.el.mute.textContent = m ? "muted" : "sound"; this.el.mute.classList.toggle("off", m); }

    // Once a second while the title is up: the daily countdown.
    update(nowMs) {
      if (this.el.overlay.hidden || this.sim.state !== "TITLE" || nowMs - this.tick < 1000) return;
      this.tick = nowMs;
      const d = this.dailyInfo();
      if (d.played) this.el.dailyAction.textContent = `Next in ${L7.Daily.countdownText(d.msLeft)}`;
      else if (this.el.daily.classList.contains("done")) this.refreshDaily();   // midnight passed: a new daily is up
    }
  }

  L7.Hud = Hud;
})();
