'use strict';
// All sounds are synthesised with WebAudio - no audio files needed.
const Sound = {
  ctx: null, master: null, noise: null, crowdG: null, crowdF: null,
  muted: true, // muted during the menu demo match

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(c.destination);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // Crowd murmur: looping filtered noise
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.6;
    const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 2200;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(f2); f2.connect(g); g.connect(this.master);
    src.start();
    this.crowdG = g; this.crowdF = f;
  },
  unlock() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },
  running() { return !!this.ctx && this.ctx.state === 'running'; },
  ok() { return this.running() && !this.muted; },

  crowd(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, v = this.muted ? 0 : level;
    this.crowdG.gain.setTargetAtTime(v, t, 0.25);
    this.crowdF.frequency.setTargetAtTime(600 + level * 1500, t, 0.4);
  },
  env(g, t0, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
  },
  noiseHit(dur, freq, vol, type) {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type || 'highpass'; f.frequency.value = freq;
    const g = c.createGain(); this.env(g, t, 0.003, vol, dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  tone(freq, type, vol, dur, endFreq) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    this.env(g, t, 0.004, vol, dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },
  kick(p) {
    if (!this.ok()) return;
    this.tone(150, 'sine', 0.3 + 0.5 * p, 0.13, 45);
    this.noiseHit(0.04, 2500, 0.12 + p * 0.2);
  },
  bounce(v) {
    if (!this.ok()) return;
    this.tone(110, 'sine', Math.min(0.25, v / 40), 0.08, 50);
  },
  tackle() { if (this.ok()) this.noiseHit(0.12, 500, 0.45, 'lowpass'); },
  catchBall() { if (this.ok()) this.noiseHit(0.07, 900, 0.35, 'lowpass'); },
  whistle(n, long) {
    if (!this.ok()) return;
    const c = this.ctx;
    n = n || 1;
    for (let i = 0; i < n; i++) {
      const t = c.currentTime + i * 0.42, dur = long && i === n - 1 ? 0.9 : 0.28;
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 2950;
      const lfo = c.createOscillator(); lfo.frequency.value = 38;
      const lg = c.createGain(); lg.gain.value = 180;
      lfo.connect(lg); lg.connect(o.frequency);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.setValueAtTime(0.16, t + dur - 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    }
  },
  roar(freq, peak, hold, fall) {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.25);
    g.gain.setTargetAtTime(0.0001, t + hold, fall);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + hold + fall * 5);
  },
  cheer() { if (this.ok()) this.roar(1100, 0.7, 1.4, 1.0); },
  ooh() { if (this.ok()) this.roar(480, 0.3, 0.5, 0.5); },
  post() {
    if (!this.ok()) return;
    [880, 1320, 2100].forEach((f, i) => this.tone(f, 'triangle', 0.25 / (i + 1), 0.5));
    this.ooh();
  },
  blip(hi) { // menu sound, plays even when match sound is muted
    if (!this.running()) return;
    this.tone(hi ? 880 : 660, 'square', 0.07, 0.08);
  },
};
