/**
 * Every sound made from the physics, synthesised with Web Audio (nothing recorded):
 *
 *  - the PRV V6: three firing pulses a revolution (6 cylinders, 4 strokes), a rough 90-degree
 *    V's half-order beat under them, the intake roar opening with the throttle, a gurgle on
 *    the overrun; heard muffled through the bulkhead from inside, open from outside;
 *  - the road: tyre roar rising with speed, squeal when the tyres slide, wind rising with the
 *    square of the speed;
 *  - Doc's machinery: the time circuits' power-up chirp, the keypad's tones, the flux
 *    capacitor's whine climbing toward 88 mph, the crackle of the arcs;
 *  - displacement: three bangs like sonic booms on departure (with the fire's whoosh) and on
 *    arrival; the cold vapour's hiss;
 *  - the doors' gas struts, a thud for a knock, crickets on a still country night.
 */
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  /** Starts on the first touch or key (browsers allow sound only after a gesture). */
  attach(target = window) {
    const go = () => { this.start(); target.removeEventListener('pointerdown', go); target.removeEventListener('keydown', go); };
    target.addEventListener('pointerdown', go);
    target.addEventListener('keydown', go);
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
    // a short room/echo for the bangs
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(2.4, 2.2);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain).connect(this.master);
    this.noise = this._noiseBuffer(2);
    // --- the engine: two pulse oscillators (firing and half order) through a filter -------------
    const eng = (this.eng = {});
    eng.out = ctx.createGain(); eng.out.gain.value = 0;
    eng.filter = ctx.createBiquadFilter(); eng.filter.type = 'lowpass'; eng.filter.frequency.value = 600; eng.filter.Q.value = 2.5;
    eng.cabin = ctx.createBiquadFilter(); eng.cabin.type = 'lowpass'; eng.cabin.frequency.value = 2000;
    eng.fire = ctx.createOscillator(); eng.fire.type = 'sawtooth';
    eng.half = ctx.createOscillator(); eng.half.type = 'square';
    eng.fireG = ctx.createGain(); eng.fireG.gain.value = 0.5;
    eng.halfG = ctx.createGain(); eng.halfG.gain.value = 0.18;
    eng.fire.connect(eng.fireG).connect(eng.filter);
    eng.half.connect(eng.halfG).connect(eng.filter);
    // the intake: noise through a band that opens with the throttle
    eng.intake = this._noiseSource(); eng.intakeF = ctx.createBiquadFilter(); eng.intakeF.type = 'bandpass'; eng.intakeF.Q.value = 1.2;
    eng.intakeG = ctx.createGain(); eng.intakeG.gain.value = 0;
    eng.intake.connect(eng.intakeF).connect(eng.intakeG).connect(eng.filter);
    eng.filter.connect(eng.cabin).connect(eng.out).connect(this.master);
    eng.fire.start(); eng.half.start(); eng.intake.start();
    // --- the road and the wind -----------------------------------------------------------------
    this.road = this._noiseLoop('lowpass', 300, 0.8);
    this.wind = this._noiseLoop('bandpass', 700, 0.6);
    this.squeal = this._noiseLoop('bandpass', 1400, 12);
    // --- the flux capacitor's whine and the arcs' crackle ---------------------------------------
    this.whine = ctx.createOscillator(); this.whine.type = 'sine';
    this.whine2 = ctx.createOscillator(); this.whine2.type = 'triangle';
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0;
    this.whine.connect(this.whineG); this.whine2.connect(this.whineG);
    this.whineG.connect(this.master);
    this.whine.start(); this.whine2.start();
    this.crackle = this._noiseLoop('highpass', 2500, 0.7);
    this.hiss = this._noiseLoop('highpass', 4000, 0.5);
    // --- the night: crickets ---------------------------------------------------------------------
    this.cricket = ctx.createOscillator(); this.cricket.frequency.value = 4400;
    this.cricketAM = ctx.createGain(); this.cricketAM.gain.value = 0;
    this.cricketLFO = ctx.createOscillator(); this.cricketLFO.frequency.value = 28;
    this.cricketDepth = ctx.createGain(); this.cricketDepth.gain.value = 0;
    this.cricketLFO.connect(this.cricketDepth).connect(this.cricketAM.gain);
    this.cricket.connect(this.cricketAM).connect(this.master);
    this.cricket.start(); this.cricketLFO.start();
  }

  _noiseBuffer(secs) {
    const ctx = this.ctx, n = ctx.sampleRate * secs, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  _noiseSource() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; return s; }
  _noiseLoop(type, f, q) {
    const ctx = this.ctx, s = this._noiseSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.value = 0;
    s.connect(fl).connect(g).connect(this.master); s.start();
    return { src: s, filter: fl, gain: g };
  }
  _impulse(secs, decay) {
    const ctx = this.ctx, n = ctx.sampleRate * secs, b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }
  _set(param, v, tc = 0.05) { param.setTargetAtTime(v, this.ctx.currentTime, tc); }

  /** Each frame. s: { rpm, throttle, running, speed (m/s), skid (0..1), inside, flux (0..1), armed, arcs (0..1), frost, night, rural }. */
  update(s) {
    if (!this.ctx || !this.enabled) return;
    const E = this.eng;
    const rpm = s.running ? Math.max(500, s.rpm) : 0;
    const f = rpm / 60 * 3;
    this._set(E.fire.frequency, Math.max(20, f), 0.02);
    this._set(E.half.frequency, Math.max(10, f / 2), 0.02);
    this._set(E.filter.frequency, 220 + rpm * 0.12 + s.throttle * 900, 0.04);
    this._set(E.intakeF.frequency, 300 + rpm * 0.25, 0.05);
    this._set(E.intakeG.gain, s.running ? s.throttle * 0.25 : 0, 0.05);
    this._set(E.cabin.frequency, s.inside ? 1100 : 4000, 0.1);
    this._set(E.out.gain, s.running ? (0.07 + s.throttle * 0.13 + rpm / 6500 * 0.08) * (s.inside ? 0.8 : 1) : 0, 0.06);
    const v = s.speed;
    this._set(this.road.gain.gain, Math.min(0.18, v / 40 * 0.12) * (s.inside ? 0.8 : 1), 0.1);
    this._set(this.road.filter.frequency, 120 + v * 9, 0.1);
    this._set(this.wind.gain.gain, Math.min(0.22, (v / 45) ** 2 * 0.18) * (s.inside ? 0.7 : 1), 0.1);
    this._set(this.wind.filter.frequency, 300 + v * 22, 0.1);
    this._set(this.squeal.gain.gain, Math.min(0.12, s.skid * 0.14), 0.04);
    this._set(this.squeal.filter.frequency, 1100 + v * 8, 0.1);
    // the flux capacitor: a whine rising with the speed while armed, toward a scream at 88
    const w = s.armed ? s.flux : 0;
    this._set(this.whineG.gain, w * w * 0.07, 0.08);
    this._set(this.whine.frequency, 300 + w * w * 2600, 0.05);
    this._set(this.whine2.frequency, 451 + w * w * 3900, 0.05);
    this._set(this.crackle.gain.gain, s.arcs * (0.06 + Math.random() * 0.1), 0.01);
    this._set(this.hiss.gain.gain, Math.min(0.08, s.frost * 0.09), 0.2);
    // crickets on a quiet country night
    const crick = s.night * (s.rural ? 1 : 0.25) * (1 - Math.min(1, v / 15));
    this._set(this.cricketDepth.gain, crick * 0.018, 0.3);
  }

  /** A bang: a low thump and a burst, with an echo. */
  bang(delay = 0, size = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(110 * size, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * size, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g); g.connect(this.master); g.connect(this.verb);
    o.start(t); o.stop(t + 0.8);
    const n = this._noiseSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();
    nf.type = 'lowpass'; nf.frequency.setValueAtTime(5000, t); nf.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.6 * size, t + 0.005); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    n.connect(nf).connect(ng); ng.connect(this.master); ng.connect(this.verb);
    n.start(t); n.stop(t + 0.6);
  }

  /** Thunder: a crack (near) and a long rumble, arriving after the flash. */
  thunder(delay = 2, size = 1, strike = false) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    if (strike) this.bang(delay, 1.6);
    const n = this._noiseSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.frequency.setValueAtTime(strike ? 2000 : 600, t); f.frequency.exponentialRampToValueAtTime(90, t + 4);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * size, t + (strike ? 0.02 : 0.4)); g.gain.exponentialRampToValueAtTime(0.001, t + 5 + size * 2);
    n.connect(f).connect(g); g.connect(this.master); g.connect(this.verb);
    n.start(t); n.stop(t + 8);
  }

  /** The three bangs of a displacement. */
  booms(arrival = false) { for (let i = 0; i < 3; i++) this.bang(i * 0.11, arrival ? 0.8 : 1); if (!arrival) this.whoosh(); }

  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.Q.value = 0.8; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(120, t + 3);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.2); g.gain.exponentialRampToValueAtTime(0.001, t + 4);
    n.connect(f).connect(g).connect(this.master); n.start(t); n.stop(t + 4.2);
  }

  /** A tone (the keypad, the circuits' chirp). */
  tone(freq, dur = 0.09, vol = 0.12, type = 'square', delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = 3000;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.setValueAtTime(vol, t + dur - 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  key(k) {
    // the keypad: DTMF-like pairs of tones for the digits
    const row = { 1: 697, 2: 697, 3: 697, 4: 770, 5: 770, 6: 770, 7: 852, 8: 852, 9: 852, 0: 941 }[k], col = { 1: 1209, 4: 1209, 7: 1209, 2: 1336, 5: 1336, 8: 1336, 0: 1336, 3: 1477, 6: 1477, 9: 1477 }[k];
    if (row) { this.tone(row, 0.08, 0.06, 'sine'); this.tone(col, 0.08, 0.06, 'sine'); }
    else this.tone(k === 'enter' ? 1800 : 600, 0.12, 0.08);
  }
  circuits(on) {
    if (on) [880, 1320, 1760, 2640].forEach((f, i) => this.tone(f, 0.07, 0.07, 'square', i * 0.06));
    else [1320, 660].forEach((f, i) => this.tone(f, 0.08, 0.06, 'square', i * 0.07));
  }
  error() { this.tone(220, 0.35, 0.1, 'sawtooth'); }
  door(open) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = open ? 2200 : 1500; f.Q.value = 2;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    n.connect(f).connect(g).connect(this.master); n.start(t); n.stop(t + 1.2);
    if (!open) this.thud(0.4, 1.0);
  }
  thud(vol = 0.5, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.35);
  }
  toggle() { this.enabled = !this.enabled; if (this.master) this.master.gain.value = this.enabled ? 0.7 : 0; return this.enabled; }
}
