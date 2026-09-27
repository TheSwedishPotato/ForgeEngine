/**
 * Procedural sound: every effect is synthesised (no audio files).
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
    this.speech = true;
    this.lastWhoosh = 0;
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // Shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Room reverb (short, arena-like)
    this.reverb = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2) * 0.6;
    }
    this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.22;
    this.reverb.connect(this.reverbGain).connect(this.master);
    this._startCrowd();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  _noiseSource(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(t, Math.random() * 1.5, dur + 0.05);
    return src;
  }

  _env(node, t, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    return g;
  }

  _out(node, wet = 0.3) {
    node.connect(this.master);
    if (wet > 0) {
      const w = this.ctx.createGain();
      w.gain.value = wet;
      node.connect(w).connect(this.reverb);
    }
  }

  /** Glove impact. speed m/s, zone head|body|block, force N. */
  impact(speed, zone, force = 1000) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const k = Math.min(1.4, Math.max(0.15, speed / 9) * (0.6 + Math.min(1, force / 2500) * 0.6));
    // thump (the body)
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = zone === 'body' ? 70 : zone === 'head' ? 95 : 120;
    osc.frequency.setValueAtTime(f0 * 1.8, t);
    osc.frequency.exponentialRampToValueAtTime(f0, t + 0.06);
    osc.start(t);
    osc.stop(t + 0.3);
    this._out(this._env(osc, t, 0.9 * k, 0.003, zone === 'body' ? 0.22 : 0.14), 0.15);
    // leather slap
    const n = this._noiseSource(t, 0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = zone === 'block' ? 1800 : zone === 'head' ? 1300 : 900;
    bp.Q.value = 0.9;
    n.connect(bp);
    this._out(this._env(bp, t, (zone === 'block' ? 0.7 : 0.9) * k, 0.002, 0.08 + 0.05 * k), 0.35);
    // low body of the hit
    const n2 = this._noiseSource(t, 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    n2.connect(lp);
    this._out(this._env(lp, t, 0.8 * k, 0.004, 0.16), 0.2);
  }

  whoosh(speed = 8) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - this.lastWhoosh < 0.05) return;
    this.lastWhoosh = t;
    const n = this._noiseSource(t, 0.3);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(1600 + speed * 90, t + 0.12);
    n.connect(bp);
    this._out(this._env(bp, t, 0.08 * Math.min(1.5, speed / 8), 0.04, 0.12), 0.1);
  }

  step() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSource(t, 0.08);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500 + Math.random() * 2500;
    n.connect(hp);
    this._out(this._env(hp, t, 0.015 + Math.random() * 0.02, 0.002, 0.04), 0.05);
  }

  bell(times = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let r = 0; r < times; r++) {
      const t = ctx.currentTime + r * 0.42;
      for (const [f, a, d] of [[830, 0.35, 2.4], [1660, 0.12, 1.6], [2270, 0.1, 1.2], [3120, 0.06, 0.8], [4200, 0.04, 0.5]]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
        o.start(t);
        o.stop(t + d + 0.1);
        this._out(this._env(o, t, a, 0.002, d), 0.4);
      }
    }
  }

  _startCrowd() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const bp = ctx.createBiquadFilter();
    bp.type = 'peaking';
    bp.frequency.value = 450;
    bp.gain.value = 6;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.05;
    src.connect(lp).connect(bp).connect(this.crowdGain);
    this._out(this.crowdGain, 0.5);
    src.start();
    // murmur modulation
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(this.crowdGain.gain);
    lfo.start();
    this.crowdBase = 0.05;
  }

  /** Crowd swell: 'ooh' on big shots, 'roar' on knockdowns, 'cheer' at the end. */
  crowd(kind = 'ooh', intensity = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSource(t, 3);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    // vowel formants: "oo" (300/870) vs "ah" (730/1090)
    const [a, b] = kind === 'ooh' ? [320, 870] : [700, 1150];
    f1.frequency.value = a;
    f2.frequency.value = b;
    f1.Q.value = 3;
    f2.Q.value = 3;
    n.connect(f1);
    n.connect(f2);
    const g = ctx.createGain();
    const peak = (kind === 'ooh' ? 0.35 : 0.6) * intensity;
    const dur = kind === 'ooh' ? 1.2 : 3.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (kind === 'ooh' ? 0.12 : 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f1.connect(g);
    f2.connect(g);
    this._out(g, 0.6);
    if (kind !== 'ooh') {
      // clapping texture
      for (let i = 0; i < 26 * intensity; i++) {
        const ct = t + 0.1 + Math.random() * 2.2;
        const c = this._noiseSource(ct, 0.05);
        const hp = ctx.createBiquadFilter();
        hp.type = 'bandpass';
        hp.frequency.value = 1200 + Math.random() * 1500;
        c.connect(hp);
        const eg = ctx.createGain();
        eg.gain.setValueAtTime(0.0001, ct);
        eg.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.05, ct + 0.003);
        eg.gain.exponentialRampToValueAtTime(0.0001, ct + 0.04);
        hp.connect(eg);
        this._out(eg, 0.4);
      }
    }
  }

  /** Continuous crowd level from match intensity (0..1). */
  setIntensity(x) {
    if (!this.crowdGain) return;
    this.crowdGain.gain.setTargetAtTime(this.crowdBase + x * 0.09, this.ctx.currentTime, 0.4);
  }

  heartbeat(level) {
    if (!this.ctx || level < 0.1) return;
    const ctx = this.ctx;
    for (const dt of [0, 0.16]) {
      const t = ctx.currentTime + dt;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(58, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      o.start(t);
      o.stop(t + 0.2);
      this._out(this._env(o, t, 0.5 * level * (dt ? 0.7 : 1), 0.01, 0.14), 0);
    }
  }

  say(text) {
    if (!this.speech || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.pitch = 0.8;
      u.volume = Math.min(1, this.volume + 0.1);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* speech not available */
    }
  }
}
