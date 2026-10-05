/**
 * Procedural sound: every effect is synthesised (no audio files).
 * Steel on steel rings with inharmonic partials; a blade into cloth and
 * flesh is a short, wet thud; a blow on plate is a clang with a dull body;
 * mail jingles. A herald's trumpet opens the fight; the crowd murmurs.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.lastWhoosh = 0;
    this.lastClang = 0;
  }

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
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Open-air reverb: short and sparse.
    this.reverb = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 1.4);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 4.5) * 0.4;
    }
    this.reverb.buffer = ir;
    const rg = ctx.createGain();
    rg.gain.value = 0.25;
    this.reverb.connect(rg).connect(this.master);
    this._ambience();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  _noise(t, dur) {
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

  /** Steel on steel: a ringing, inharmonic clang. energy in joules. */
  clang(energy = 30, heavy = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - this.lastClang < 0.03) return;
    this.lastClang = t;
    const k = Math.min(1.3, 0.2 + energy / 60);
    const base = (heavy ? 420 : 760) * (0.92 + Math.random() * 0.16);
    for (const [r, a, dec] of [[1, 0.25, 0.9], [2.76, 0.18, 0.6], [5.4, 0.12, 0.45], [8.93, 0.07, 0.3], [13.3, 0.05, 0.2]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * r;
      o.start(t);
      o.stop(t + dec + 0.1);
      this._out(this._env(o, t, a * k, 0.001, dec * (heavy ? 0.6 : 1)), 0.45);
    }
    const n = this._noise(t, 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    n.connect(hp);
    this._out(this._env(hp, t, 0.6 * k, 0.001, 0.03), 0.2);
  }

  /** A blow landing on a body: material decides the colour of the sound. */
  hit(mat = 'cloth', energy = 30, wound = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const k = Math.min(1.4, 0.25 + energy / 70);
    if (mat === 'plate') { this.clang(energy, true); }
    if (mat === 'mail') {
      for (let i = 0; i < 8; i++) {
        const tt = t + Math.random() * 0.06;
        const n = this._noise(tt, 0.03);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 4000 + Math.random() * 4000;
        bp.Q.value = 6;
        n.connect(bp);
        this._out(this._env(bp, tt, 0.25 * k, 0.001, 0.05), 0.2);
      }
    }
    // the body of the blow
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.1);
    o.start(t);
    o.stop(t + 0.25);
    this._out(this._env(o, t, 0.7 * k, 0.002, 0.16), 0.1);
    const n = this._noise(t, 0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = wound ? 1400 : 700;
    n.connect(lp);
    this._out(this._env(lp, t, (wound ? 0.8 : 0.5) * k, 0.002, wound ? 0.12 : 0.08), 0.15);
  }

  whoosh(speed = 15) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - this.lastWhoosh < 0.12) return;
    this.lastWhoosh = t;
    const n = this._noise(t, 0.35);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(400 + speed * 70, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(250, t + 0.3);
    n.connect(bp);
    this._out(this._env(bp, t, 0.12 * Math.min(1.6, speed / 15), 0.06, 0.18), 0.1);
  }

  step(armoured = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise(t, 0.1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500 + Math.random() * 300;
    n.connect(lp);
    this._out(this._env(lp, t, 0.06, 0.004, 0.06), 0.05);
    if (armoured) {
      const o = ctx.createOscillator();
      o.frequency.value = 2200 + Math.random() * 1800;
      o.start(t);
      o.stop(t + 0.1);
      this._out(this._env(o, t, 0.012, 0.001, 0.07), 0.1);
    }
  }

  thud(energy = 200) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    o.start(t);
    o.stop(t + 0.5);
    this._out(this._env(o, t, Math.min(1, energy / 300), 0.004, 0.4), 0.3);
  }

  _ambience() {
    const ctx = this.ctx;
    // Wind and a distant murmuring crowd.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    const pk = ctx.createBiquadFilter();
    pk.type = 'peaking';
    pk.frequency.value = 400;
    pk.gain.value = 5;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.04;
    src.connect(lp).connect(pk).connect(this.crowdGain);
    this._out(this.crowdGain, 0.4);
    src.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.17;
    const lg = ctx.createGain();
    lg.gain.value = 0.012;
    lfo.connect(lg).connect(this.crowdGain.gain);
    lfo.start();
    // Birds, now and then.
    const bird = () => {
      if (!this.ctx) return;
      const t = ctx.currentTime;
      const f = 2500 + Math.random() * 1800;
      for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
        const tt = t + i * 0.11;
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(f, tt);
        o.frequency.exponentialRampToValueAtTime(f * 1.4, tt + 0.05);
        o.start(tt);
        o.stop(tt + 0.08);
        this._out(this._env(o, tt, 0.012, 0.005, 0.06), 0.3);
      }
      setTimeout(bird, 3000 + Math.random() * 9000);
    };
    setTimeout(bird, 2500);
  }

  crowd(kind = 'ooh', intensity = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise(t, 3);
    const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
    f1.type = f2.type = 'bandpass';
    const [a, b] = kind === 'ooh' ? [320, 870] : [700, 1150];
    f1.frequency.value = a; f2.frequency.value = b;
    f1.Q.value = f2.Q.value = 3;
    n.connect(f1); n.connect(f2);
    const g = ctx.createGain();
    const peak = (kind === 'ooh' ? 0.25 : 0.45) * intensity;
    const dur = kind === 'ooh' ? 1.2 : 3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f1.connect(g); f2.connect(g);
    this._out(g, 0.5);
  }

  /** Two trumpets (busines) sound the fanfare. */
  fanfare() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const notes = [[0, 392], [0.18, 392], [0.36, 523], [0.62, 659], [0.95, 523], [1.15, 784]];
    for (const [dt, f] of notes) {
      const t = ctx.currentTime + dt + 0.05;
      const dur = dt === 1.15 ? 0.9 : 0.22;
      for (const [h, a] of [[1, 0.13], [2, 0.08], [3, 0.06], [4, 0.04], [5, 0.025]]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * h;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2400;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.1);
        this._out(this._env(lp, t, a, 0.03, dur), 0.5);
      }
    }
  }

  heartbeat(level) {
    if (!this.ctx || level < 0.1) return;
    const ctx = this.ctx;
    for (const dt of [0, 0.17]) {
      const t = ctx.currentTime + dt;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(58, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      o.start(t);
      o.stop(t + 0.2);
      this._out(this._env(o, t, 0.45 * level * (dt ? 0.7 : 1), 0.01, 0.14), 0);
    }
  }

  breath(level) {
    if (!this.ctx || level < 0.1) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise(t, 0.9);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    n.connect(bp);
    this._out(this._env(bp, t, 0.06 * level, 0.25, 0.5), 0.1);
  }

  // ---- the joust -------------------------------------------------------------------------

  /** One hoof on packed earth: a dull knock with grit; louder and sharper at speed. gain 0..1 by distance. */
  hoof(gain = 1, speed = 6) {
    if (!this.ctx || gain < 0.02) return;
    const ctx = this.ctx, t = ctx.currentTime + Math.random() * 0.01;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130 + Math.random() * 40, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.07);
    o.start(t); o.stop(t + 0.12);
    this._out(this._env(o, t, 0.22 * gain * (0.6 + speed / 20), 0.002, 0.08), 0.15);
    const n = this._noise(t, 0.08);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 700 + Math.random() * 500; bp.Q.value = 0.9;
    n.connect(bp);
    this._out(this._env(bp, t, 0.09 * gain, 0.002, 0.05), 0.1);
  }

  /** Harness on a moving horse: bit, stirrup irons and plate jingling with the stride. */
  tack(gain = 1) {
    if (!this.ctx || gain < 0.05) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.frequency.value = 2600 + Math.random() * 2400;
      const tt = t + i * 0.03;
      o.start(tt); o.stop(tt + 0.08);
      this._out(this._env(o, tt, 0.01 * gain, 0.001, 0.06), 0.2);
    }
  }

  /**
   * A lance breaking: the crack of fibres letting go (broadband, very
   * short), the boom of the shaft, then splinters pattering down.
   */
  lanceBreak(force = 9000) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const k = Math.min(1.4, force / 9000);
    const n = this._noise(t, 0.25);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 900;
    n.connect(hp);
    this._out(this._env(hp, t, 0.9 * k, 0.001, 0.09), 0.6);
    const n2 = this._noise(t, 0.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 600;
    n2.connect(lp);
    this._out(this._env(lp, t, 0.7 * k, 0.003, 0.25), 0.6);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.3);
    o.start(t); o.stop(t + 0.4);
    this._out(this._env(o, t, 0.5 * k, 0.002, 0.3), 0.4);
    for (let i = 0; i < 9; i++) {
      const tt = t + 0.35 + Math.random() * 0.9;
      const s = this._noise(tt, 0.04);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1500 + Math.random() * 2500; bp.Q.value = 2;
      s.connect(bp);
      this._out(this._env(bp, tt, 0.05, 0.001, 0.03), 0.3);
    }
  }

  /** A lance that holds: the coronel hammering shield or plate. */
  lanceStrike(onSteel = false, energy = 1) {
    if (!this.ctx) return;
    if (onSteel) return this.clang(60 * energy, true);
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise(t, 0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 1.2;
    n.connect(bp);
    this._out(this._env(bp, t, 0.8 * energy, 0.002, 0.15), 0.5);
  }

  /** The heralds' trumpets: a short call to ride. */
  trumpetCall() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const notes = [[0, 523], [0.14, 523], [0.28, 659], [0.5, 784]];
    for (const [dt, f] of notes) {
      const t = ctx.currentTime + dt + 0.03;
      const dur = dt === 0.5 ? 0.7 : 0.11;
      for (const [h, a] of [[1, 0.12], [2, 0.07], [3, 0.05], [4, 0.03]]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * h;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 2600;
        o.connect(lp);
        o.start(t); o.stop(t + dur + 0.1);
        this._out(this._env(lp, t, a, 0.02, dur), 0.6);
      }
    }
  }

  /** A horse blowing through its nostrils. */
  snort(gain = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise(t, 0.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 350; bp.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 28;
    const lg = ctx.createGain();
    lg.gain.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.6;
    lfo.connect(lg).connect(g.gain);
    lfo.start(t); lfo.stop(t + 0.6);
    n.connect(bp).connect(g);
    this._out(this._env(g, t, 0.18 * gain, 0.05, 0.45), 0.2);
  }

  /** A man in harness hitting the ground from horseback: thud, then plate and mail clattering. */
  armourFall() {
    if (!this.ctx) return;
    this.thud(400);
    const ctx = this.ctx;
    for (let i = 0; i < 6; i++) {
      const t = ctx.currentTime + 0.03 + i * 0.05 + Math.random() * 0.05;
      const o = ctx.createOscillator();
      o.frequency.value = 900 + Math.random() * 2200;
      o.start(t); o.stop(t + 0.15);
      this._out(this._env(o, t, 0.05, 0.001, 0.12), 0.3);
    }
  }

  /** A church bell: a struck bronze partial series, three strokes. */
  bell() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let k = 0; k < 3; k++) {
      const t = ctx.currentTime + k * 1.6;
      for (const [r, a] of [[0.5, 0.12], [1, 0.2], [1.19, 0.1], [1.5, 0.08], [2, 0.06], [2.5, 0.04]]) {
        const o = ctx.createOscillator();
        o.frequency.value = 330 * r;
        o.start(t); o.stop(t + 4);
        this._out(this._env(o, t, a * 0.6, 0.004, 3.5), 0.6);
      }
    }
  }
}
