/* ===================================================================
   Sound. Everything is synthesised at runtime — no files, nothing to
   license, nothing to download — and each cue is a brief for what to
   record later. Two simple layers read better than one complex sample:
   a gunshot is a noise crack plus a low thump; a head hit is a bright
   ring, a body hit a dull slap; that difference IS the reward, and it
   lives in pitch and brightness so it survives a phone speaker.

   Mobile browsers refuse to start an AudioContext without a gesture;
   unlock() runs on the first tap. A tiny compressor on the master bus
   stops the shot and the buzzer clipping when they overlap.
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

L7.Sound = {
  ctx: null, master: null, noise: null, muted: false, volume: 0.85,

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.knee.value = 18; comp.ratio.value = 4;
      comp.attack.value = 0.002; comp.release.value = 0.12;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  },

  setMuted(m) {
    this.muted = !!m;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
  },

  out(pan) {
    if (pan === undefined || !this.ctx.createStereoPanner) return this.master;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master);
    return p;
  },

  // Pan for a world x in design units: left lane edge -0.7, right +0.7.
  panAt(x) { return ((x / 540) - 0.5) * 1.4; },

  tone(freq, dur, type, vol, pan, slideTo, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out(pan));
    o.start(t); o.stop(t + dur + 0.03);
  },

  burst(dur, filterType, from, to, vol, pan, delay = 0, q) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = filterType;
    if (q) f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.out(pan));
    s.start(t); s.stop(t + dur + 0.03);
  },

  /* ---------- cues ---------- */
  shot(pan)  { this.burst(0.16, "lowpass", 7000, 380, 0.6, pan); this.tone(130, 0.14, "sine", 0.55, pan, 44); },
  oppShot()  { this.burst(0.14, "lowpass", 5200, 300, 0.42, 0.75); this.tone(110, 0.13, "sine", 0.4, 0.75, 40); },

  // Ejected brass hitting the bench: two inharmonic partials, delayed.
  casing()   { this.tone(3150, 0.09, "sine", 0.07, 0.35, 2900, 0.24); this.tone(4720, 0.06, "sine", 0.045, 0.35, 4400, 0.245); this.tone(2650, 0.05, "sine", 0.03, 0.4, 0, 0.36); },

  // Carrier motor: a low hum and a filtered whir that slows as it stops.
  motor(sec, pan) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(sec, "bandpass", 420, 180, 0.11, pan, 0, 2.5);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(58, t); o.frequency.linearRampToValueAtTime(44, t + sec);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.08);
    g.gain.setValueAtTime(0.05, t + sec - 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
    o.connect(g); g.connect(this.out(pan)); o.start(t); o.stop(t + sec + 0.02);
    // The stop: a relay clack.
    this.burst(0.03, "highpass", 1800, 3000, 0.16, pan, sec - 0.02);
  },

  ready()    { this.burst(0.02, "highpass", 2500, 4000, 0.12); this.tone(520, 0.05, "square", 0.06); },

  // The go signal is a real range buzzer: two rough voices a fifth
  // apart, chopped at 50Hz so it rasps instead of whistles.
  buzzer() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, dur = 0.19;
    for (const [f, type, v] of [[392, "sawtooth", 0.16], [588, "square", 0.09]]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
      o.type = type; o.frequency.value = f;
      lfo.type = "square"; lfo.frequency.value = 50; lg.gain.value = 0.5;
      lfo.connect(lg); lg.connect(g.gain);
      g.gain.setValueAtTime(v * 0.5, t);
      g.gain.setValueAtTime(v * 0.5, t + dur - 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
    }
  },

  lampOn(pan) { this.burst(0.025, "highpass", 3000, 5000, 0.1, pan); this.tone(118, 0.22, "triangle", 0.035, pan, 0, 0.03); },

  hitHead(pan) { this.tone(1500, 0.34, "sine", 0.3, pan); this.tone(2260, 0.28, "sine", 0.16, pan); this.tone(3020, 0.18, "sine", 0.06, pan); },
  hitBody(pan) { this.burst(0.11, "bandpass", 700, 320, 0.45, pan); this.tone(180, 0.1, "sine", 0.2, pan, 90); },
  miss(pan)    { this.burst(0.07, "highpass", 2400, 3600, 0.25, pan); this.tone(620, 0.3, "sine", 0.16, pan, 190); },
  noShoot()    { this.tone(740, 0.12, "square", 0.14, 0, 0, 0); this.tone(740, 0.12, "square", 0.14, 0, 0, 0.16); this.tone(520, 0.3, "sawtooth", 0.1, 0, 300, 0.32); },
  buzz()       { this.tone(92, 0.4, "sawtooth", 0.26); this.tone(97, 0.4, "sawtooth", 0.2); },

  // A new personal best: three bright partials climbing, a beat after the hit lands.
  best()    { [1320, 1760, 2640].forEach((f, i) => this.tone(f, 0.22, "triangle", 0.16, 0, 0, 0.14 + i * 0.07)); },
  // Level chips and buttons on the title.
  uiTap()   { this.burst(0.018, "highpass", 2200, 3600, 0.08); this.tone(880, 0.04, "square", 0.04); },

  win()     { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.24, "triangle", 0.22, 0, 0, i * 0.09)); },
  levelUp() { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.3, "triangle", 0.2, 0, 0, i * 0.08)); this.burst(0.5, "lowpass", 2400, 300, 0.12, 0, 0.45); },
  lose()    { [392, 330, 247].forEach((f, i) => this.tone(f, 0.32, "triangle", 0.22, 0, 0, i * 0.12)); },
  tick()    { this.tone(1200, 0.03, "square", 0.05); }
};
