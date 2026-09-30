// Procedural cabin audio (Web Audio). Everything is synthesised — no samples.
import { clamp, lerp } from './core.js';

function noiseBuffer(ctx, type, seconds = 4) {
  const n = ctx.sampleRate * seconds, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (type === 'white') d[i] = w;
    else if (type === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
  }
  return b;
}

export class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; this.volume = 0.8; this.muffle = 0; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.buf = { white: noiseBuffer(ctx, 'white'), pink: noiseBuffer(ctx, 'pink'), brown: noiseBuffer(ctx, 'brown') };
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -16; this.comp.ratio.value = 3; this.comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    this.earLP = ctx.createBiquadFilter(); this.earLP.type = 'lowpass'; this.earLP.frequency.value = 18000; this.earLP.Q.value = 0.5;
    this.master.connect(this.earLP); this.earLP.connect(this.comp);
    // cabin wall transmission for outside sources
    this.hull = ctx.createBiquadFilter(); this.hull.type = 'lowpass'; this.hull.frequency.value = 2600; this.hull.Q.value = 0.4;
    this.hullGain = ctx.createGain(); this.hullGain.gain.value = 1; this.hull.connect(this.hullGain); this.hullGain.connect(this.master);
    this.engines = [this._engine(-1), this._engine(1)];
    this.aero = this._noiseChain('pink', [['highpass', 120, 0.5], ['lowpass', 900, 0.6]], this.hull, 0);
    this.aeroHi = this._noiseChain('white', [['bandpass', 2400, 0.8]], this.master, 0);
    this.packs = this._noiseChain('pink', [['bandpass', 1400, 0.4]], this.master, 0.05);
    this.packsLow = this._noiseChain('brown', [['lowpass', 180, 0.7]], this.master, 0.08);
    this.roll = this._noiseChain('brown', [['lowpass', 140, 0.9]], this.master, 0);
    this.rollMid = this._noiseChain('pink', [['bandpass', 380, 1.2]], this.hull, 0);
    this.gearAero = this._noiseChain('brown', [['lowpass', 260, 0.7]], this.master, 0);
    this.spoilerAero = this._noiseChain('brown', [['lowpass', 320, 0.7]], this.master, 0);
    this.rain = this._noiseChain('white', [['highpass', 1800, 0.6], ['lowpass', 7000, 0.4]], this.master, 0);
    this.wind = this._noiseChain('pink', [['bandpass', 600, 0.6]], this.master, 0);
    this.gasper = this._noiseChain('white', [['highpass', 1500, 0.4], ['lowpass', 6000, 0.5]], this.master, 0);
    // hydraulic motors (flaps, gear)
    this.flapMotor = this._tone('sawtooth', 138, [['bandpass', 760, 3]], this.master, 0);
    this.flapMotor2 = this._tone('triangle', 552, [['bandpass', 1100, 4]], this.master, 0);
    this.gearMotor = this._tone('sawtooth', 96, [['bandpass', 420, 2]], this.master, 0);
    // cabin murmur (formant-filtered noise voices)
    this.voices = [];
    for (let i = 0; i < 5; i++) {
      const src = this._src('pink'); const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 500 + i * 90; f1.Q.value = 5;
      const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1400 + i * 170; f2.Q.value = 6;
      const g = ctx.createGain(); g.gain.value = 0; const pan = ctx.createStereoPanner(); pan.pan.value = (i / 4) * 1.6 - 0.8;
      const mix = ctx.createGain(); mix.gain.value = 1;
      src.connect(f1); src.connect(f2); f1.connect(mix); f2.connect(mix); mix.connect(g); g.connect(pan); pan.connect(this.master);
      this.voices.push({ g, f1, f2, next: 0, level: 0 });
    }
    this.babble = 0.3;
    this.nextThump = 0;
    this.ready = true;
  }

  _src(type) { const s = this.ctx.createBufferSource(); s.buffer = this.buf[type]; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 3); return s; }
  _filters(chain) { let first = null, last = null; const fs = []; for (const [type, f, q] of chain) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (last) last.connect(b); else first = b; last = b; fs.push(b); } return { first, last, fs }; }
  _noiseChain(type, chain, dest, gain) {
    const s = this._src(type), f = this._filters(chain), g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(f.first); f.last.connect(g); g.connect(dest); return { src: s, g, f: f.fs };
  }
  _tone(wave, freq, chain, dest, gain) {
    const o = this.ctx.createOscillator(); o.type = wave; o.frequency.value = freq; o.start();
    const f = this._filters(chain), g = this.ctx.createGain(); g.gain.value = gain;
    o.connect(f.first); f.last.connect(g); g.connect(dest); return { o, g, f: f.fs };
  }
  _panner(x, y, z) {
    const p = this.ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2; p.rolloffFactor = 0.6;
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; p.connect(this.hull); return p;
  }

  _engine(side) {
    const ctx = this.ctx;
    const pan = this._panner(side * 5.75, -1.7, 4.5);
    const panAft = this._panner(side * 5.0, -1.2, 14); // jet exhaust noise radiates aft
    const e = { side, pan, panAft };
    e.rumble = this._noiseChain('brown', [['lowpass', 120, 0.8]], pan, 0);
    e.roar = this._noiseChain('white', [['bandpass', 700, 0.5], ['lowpass', 2200, 0.5]], panAft, 0);
    e.roarLow = this._noiseChain('brown', [['lowpass', 380, 0.6]], panAft, 0);
    const mkOsc = (type, f, g0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = g0; o.connect(g); g.connect(pan); o.start(); return { o, g }; };
    e.fan = mkOsc('triangle', 300, 0); e.fan2 = mkOsc('sine', 600, 0); e.n2 = mkOsc('sine', 4200, 0);
    // buzz-saw: shaft-order tones when the fan tips go supersonic
    const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 60; saw.start();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
    const sg = ctx.createGain(); sg.gain.value = 0; saw.connect(bp); bp.connect(sg); sg.connect(pan);
    e.saw = { o: saw, g: sg, f: bp };
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35 + Math.random() * 0.2; const lg = ctx.createGain(); lg.gain.value = 3; lfo.connect(lg); lg.connect(e.fan.o.frequency); lfo.start();
    return e;
  }

  setListener(pos, fwd, up) {
    if (!this.ready) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.setTargetAtTime(up.x, t, 0.02); L.upY.setTargetAtTime(up.y, t, 0.02); L.upZ.setTargetAtTime(up.z, t, 0.02);
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
    this.listenerZ = pos.z;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }

  // s: flight/cabin state snapshot
  update(dt, s) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, k = 0.08;
    const set = (param, v, tc = k) => param.setTargetAtTime(v, t, tc);
    const aftK = clamp((this.listenerZ ?? 10) / 22, 0, 1.2); // rear cabin hears more exhaust
    for (const e of this.engines) {
      const n1 = s.n1[e.side < 0 ? 0 : 1];
      const on = n1 > 0.02 ? 1 : 0;
      const bpf = n1 * 3894 / 60 * 18; // LEAP-1A: 18 fan blades
      set(e.fan.o.frequency, Math.max(20, bpf * 0.5), 0.3);
      set(e.fan2.o.frequency, Math.max(40, bpf), 0.3);
      set(e.n2.o.frequency, 2600 + n1 * 3200, 0.3);
      set(e.saw.o.frequency, Math.max(10, n1 * 3894 / 60), 0.3);
      set(e.fan.g.gain, on * (0.028 + 0.03 * smoothN(n1, 0.2, 0.5)) * (1.1 - aftK * 0.4));
      set(e.fan2.g.gain, on * 0.012 * (0.4 + n1));
      set(e.n2.g.gain, on * 0.0035 * (1 - n1 * 0.5));
      set(e.saw.g.gain, on * 0.05 * smoothN(n1, 0.72, 0.86) * (1.2 - aftK * 0.6) * (s.onGround || s.agl < 3000 ? 1 : 0.35));
      set(e.saw.f.frequency, 500 + n1 * 900);
      const thrust = clamp((n1 - 0.2) / 0.65, 0, 1);
      set(e.rumble.g.gain, on * (0.1 + 0.55 * thrust * thrust));
      set(e.rumble.f[0].frequency, 60 + n1 * 160);
      const rev = s.reverse || 0;
      set(e.roar.g.gain, on * (0.02 + 0.35 * thrust ** 2.2 * (0.6 + aftK)) * (1 + rev * 2.5) * (s.onGround ? 1.25 : 1));
      set(e.roar.f[0].frequency, 380 + thrust * 900);
      set(e.roarLow.g.gain, on * (0.05 + 0.6 * thrust ** 2) * (1 + rev * 2) * (0.6 + aftK * 0.6));
    }
    const ias = s.ias || 0;
    const q = clamp(ias / 280, 0, 1.3);
    set(this.aero.g.gain, 0.42 * q ** 2.2 * (s.onGround ? 0.4 : 1));
    set(this.aero.f[1].frequency, 400 + ias * 3.2);
    set(this.aeroHi.g.gain, 0.012 * q ** 2);
    set(this.packs.g.gain, s.packs ? 0.045 : 0.012);
    set(this.packsLow.g.gain, s.packs ? 0.09 : 0.03);
    const rr = s.rollRumble || 0;
    set(this.roll.g.gain, 0.55 * rr + (s.onGround && s.v > 0.3 ? 0.08 : 0), 0.05);
    set(this.rollMid.g.gain, 0.12 * rr ** 1.5, 0.05);
    set(this.gearAero.g.gain, (s.gear > 0.05 && !s.onGround ? s.gear * 0.25 * q ** 1.5 : 0) * (0.7 + 0.3 * Math.random()), 0.2);
    set(this.spoilerAero.g.gain, (s.spoiler || 0) * 0.35 * q ** 1.5);
    set(this.rain.g.gain, (s.rain || 0) * (0.03 + 0.05 * q) * (0.7 + 0.6 * Math.random()), 0.05);
    set(this.wind.g.gain, s.doorOpen ? 0.05 : 0);
    set(this.gasper.g.gain, s.gasper ? 0.05 : 0);
    set(this.flapMotor.g.gain, s.flapsMoving ? 0.035 : 0, 0.25);
    set(this.flapMotor2.g.gain, s.flapsMoving ? 0.012 : 0, 0.25);
    set(this.flapMotor.o.frequency, 128 + Math.sin(t * 3.1) * 4);
    set(this.gearMotor.g.gain, s.gearMoving ? 0.05 : 0, 0.2);
    // ear pressure muffling (descent) — cleared by swallowing
    set(this.earLP.frequency, lerp(18000, 1600, clamp(this.muffle, 0, 1)), 0.3);
    // runway centreline-light / joint thumps
    if (s.onGround && s.v > 4) {
      this.nextThump -= dt;
      if (this.nextThump <= 0) {
        this.nextThump = 15 / s.v * (0.9 + Math.random() * 0.2);
        this.thump(clamp(s.v / 80, 0.05, 0.5) * (0.6 + Math.random() * 0.4), 55 + Math.random() * 20);
        if (s.v > 20) setTimeout(() => this.thump(clamp(s.v / 100, 0.05, 0.35), 50), 1000 * (13 / s.v));
      }
    }
    // turbulence rattles
    if (Math.abs(s.bump || 0) > 0.28 && Math.random() < dt * 6) this.rattle(Math.abs(s.bump));
    // murmur
    for (const v of this.voices) {
      v.next -= dt;
      if (v.next <= 0) {
        v.next = 0.12 + Math.random() * 0.25;
        const talking = Math.random() < this.babble;
        set(v.g.gain, talking ? 0.02 + Math.random() * 0.035 : 0.0, 0.05);
        set(v.f1.frequency, 350 + Math.random() * 500, 0.06); set(v.f2.frequency, 1100 + Math.random() * 1200, 0.06);
      }
    }
  }

  // -------- one-shots --------
  _env(node, a, d, peak, when = 0) {
    const t = this.ctx.currentTime + when; const g = node.gain;
    g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(peak, t + a); g.exponentialRampToValueAtTime(0.0001, t + a + d);
    return t + a + d;
  }
  _burst(type, filters, peak, a, d, dest = this.master, when = 0, rate = 1) {
    if (!this.ready) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.buf[type]; s.playbackRate.value = rate;
    const f = this._filters(filters), g = this.ctx.createGain(); g.gain.value = 0;
    s.connect(f.first); f.last.connect(g); g.connect(dest);
    const end = this._env(g, a, d, peak, when);
    s.start(this.ctx.currentTime + when, Math.random() * 2); s.stop(end + 0.05);
    return { s, f, g };
  }
  _ping(freq, peak, d, type = 'sine', when = 0, dest = this.master) {
    if (!this.ready) return;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq; const g = this.ctx.createGain(); g.gain.value = 0;
    o.connect(g); g.connect(dest); const end = this._env(g, 0.004, d, peak, when); o.start(this.ctx.currentTime + when); o.stop(end + 0.05);
    return o;
  }
  thump(k = 0.4, f = 60) {
    if (!this.ready) return;
    const o = this._ping(f, 0.5 * k, 0.18); if (o) o.frequency.exponentialRampToValueAtTime(f * 0.6, this.ctx.currentTime + 0.15);
    this._burst('brown', [['lowpass', 300, 0.7]], 0.4 * k, 0.005, 0.12);
  }
  touchdown(k) { this.thump(0.9 * k + 0.3, 48); this._burst('brown', [['lowpass', 500, 0.7]], 0.6 * k, 0.01, 0.6); this._burst('white', [['bandpass', 1800, 1.5]], 0.05 * k, 0.01, 0.35, this.hull); }
  clunk(k = 0.5) { this.thump(k, 90); this._burst('white', [['bandpass', 900, 2]], 0.08 * k, 0.002, 0.08); }
  rattle(k) { for (let i = 0; i < 3; i++) this._burst('white', [['bandpass', 2500 + Math.random() * 2500, 6]], 0.03 * k, 0.001, 0.03, this.master, i * 0.04 * Math.random()); }
  // Airbus cabin chimes: single high (passenger call / signs), high-low (crew interphone)
  chime(kind = 'single') {
    if (!this.ready) return;
    const bell = (f, when, g = 0.16) => { this._ping(f, g, 1.6, 'sine', when); this._ping(f * 2.01, g * 0.25, 0.9, 'sine', when); this._ping(f * 3.02, g * 0.08, 0.5, 'sine', when); };
    if (kind === 'hilo') { bell(1250, 0); bell(1000, 0.55); }
    else if (kind === 'triple') { bell(1250, 0); bell(1000, 0.55); bell(1250, 1.1); bell(1000, 1.65); }
    else if (kind === 'low') bell(900, 0);
    else bell(1250, 0);
  }
  paClick(on = true) { this._burst('white', [['bandpass', 1500, 1]], 0.05, 0.001, 0.05); if (on) this._burst('pink', [['bandpass', 250, 2]], 0.02, 0.05, 0.4); }
  seatbelt() { this._ping(3200, 0.05, 0.05, 'square'); this._ping(1800, 0.06, 0.08, 'triangle', 0.02); this._burst('white', [['bandpass', 4000, 3]], 0.08, 0.001, 0.05); }
  seatbeltOpen() { this._ping(2400, 0.05, 0.06, 'square'); this._burst('white', [['bandpass', 3000, 3]], 0.06, 0.001, 0.06); }
  clicks(n = 10, spread = 4) { for (let i = 0; i < n; i++) { const w = Math.random() * spread; this._ping(2400 + Math.random() * 800, 0.012, 0.05, 'square', w); this._burst('white', [['bandpass', 3500, 3]], 0.018, 0.001, 0.04, this.master, w); } }
  tray() { this._burst('white', [['bandpass', 700, 2]], 0.08, 0.002, 0.1); this.thump(0.15, 120); }
  shade() { this._burst('pink', [['bandpass', 1600, 1.2]], 0.07, 0.03, 0.35); }
  binOpen() { this._burst('white', [['bandpass', 1200, 2]], 0.08, 0.002, 0.08); this.thump(0.2, 140); }
  binClose() { this.thump(0.5, 110); this._burst('white', [['bandpass', 800, 1.5]], 0.12, 0.002, 0.12); }
  flush() { const b = this._burst('pink', [['highpass', 300, 0.5], ['lowpass', 5000, 0.5]], 0.5, 0.05, 1.6); if (b) b.f.fs?.[1]; this._burst('brown', [['lowpass', 400, 0.6]], 0.5, 0.05, 1.4); }
  tap() { this._burst('white', [['highpass', 2000, 0.5]], 0.05, 0.1, 1.5); }
  cough(k = 1, when = 0) { for (let i = 0; i < 2; i++) this._burst('pink', [['bandpass', 450 + Math.random() * 200, 1.4]], 0.07 * k, 0.01, 0.16, this.master, when + i * 0.28); }
  sneeze() { this._burst('pink', [['bandpass', 2400, 1.5]], 0.07, 0.02, 0.3); }
  footstep() { this._burst('brown', [['lowpass', 250, 0.7]], 0.05, 0.005, 0.07); }
  cart(on) {
    if (!this.ready) return;
    if (on && !this._cart) { this._cart = this._noiseChain('brown', [['lowpass', 220, 0.8]], this.master, 0); this._cart.g.gain.setTargetAtTime(0.06, this.ctx.currentTime, 0.2); }
    if (!on && this._cart) { const c = this._cart; this._cart = null; c.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); setTimeout(() => c.src.stop(), 1500); }
  }
  cartJingle() { for (let i = 0; i < 4; i++) this._ping(2200 + Math.random() * 2600, 0.02, 0.25, 'sine', Math.random() * 0.2); }
  pour() { this._burst('white', [['bandpass', 1800, 0.8]], 0.05, 0.2, 1.4); }
  beep() { this._ping(2700, 0.05, 0.12, 'square'); this._ping(2700, 0.05, 0.12, 'square', 0.16); }
  pop() { this._ping(180, 0.05, 0.05); this.muffle = 0; }
  doorThud() { this.thump(0.7, 70); this._burst('brown', [['lowpass', 300, 0.7]], 0.4, 0.01, 0.8); }
  spoolDown() { /* engines spool naturally via n1 */ }

  // ---------------- abnormal and emergency sounds ----------------
  // A compressor stall or engine failure: a sharp report through the hull, then a deep boom.
  bang(k = 1, when = 0) {
    this._burst('white', [['bandpass', 700, 0.8]], 0.5 * k, 0.001, 0.12, this.master, when);
    this._burst('brown', [['lowpass', 180, 0.8]], 0.9 * k, 0.003, 0.9, this.master, when);
    const o = this._ping(55, 0.6 * k, 0.6, 'sine', when); if (o) o.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + when + 0.5);
  }
  surge(n = 4) { for (let i = 0; i < n; i++) this.bang(0.55 + Math.random() * 0.35, i * (0.35 + Math.random() * 0.5)); }
  // Rapid decompression: a boom, a rush of air out of the cabin, fog, then a wind roar that
  // stays until the descent is well under way.
  decompression() {
    this.bang(1.2);
    this._burst('white', [['highpass', 400, 0.5]], 0.9, 0.02, 2.5);
    this._burst('pink', [['lowpass', 1200, 0.5]], 0.7, 0.05, 4.0);
    this.roar(0.7);
  }
  roar(level) {
    if (!this.ready) return;
    if (!this._roar) this._roar = this._noiseChain('pink', [['bandpass', 420, 0.5], ['lowpass', 2500, 0.5]], this.master, 0);
    this._roar.g.gain.setTargetAtTime(level * 0.35, this.ctx.currentTime, 0.8);
  }
  // Metal on concrete or earth while the aircraft slides after a crash-landing.
  scrape(level) {
    if (!this.ready) return;
    if (!this._scrape) { this._scrape = this._noiseChain('white', [['bandpass', 1300, 2.5]], this.master, 0); this._scrapeLo = this._noiseChain('brown', [['lowpass', 220, 0.8]], this.master, 0); }
    this._scrape.g.gain.setTargetAtTime(level * 0.28, this.ctx.currentTime, 0.1);
    this._scrapeLo.g.gain.setTargetAtTime(level * 0.8, this.ctx.currentTime, 0.1);
  }
  impact(k = 1) { this.bang(1.3 * k); this._burst('brown', [['lowpass', 400, 0.6]], 1.0 * k, 0.005, 1.8); this._burst('white', [['bandpass', 2400, 1]], 0.3 * k, 0.002, 0.6); }
  // a cabin full of people drawing breath at once
  gasp(k = 1) { for (let i = 0; i < 6; i++) this._burst('pink', [['bandpass', 700 + Math.random() * 900, 3]], 0.05 * k, 0.05 + Math.random() * 0.1, 0.5, this.master, Math.random() * 0.25); }
  scream(k = 1) { for (let i = 0; i < 4; i++) { const o = this._ping(700 + Math.random() * 500, 0.02 * k, 1.1, 'sawtooth', Math.random() * 0.3); if (o) o.frequency.linearRampToValueAtTime(900 + Math.random() * 600, this.ctx.currentTime + 1); } this.gasp(k); }
  // the mask compartments pop open and the tubes rattle as the masks drop
  masks() { for (let i = 0; i < 30; i++) this._burst('white', [['bandpass', 1800 + Math.random() * 1500, 3]], 0.03, 0.001, 0.05, this.master, Math.random() * 0.6); this._burst('white', [['highpass', 3000, 0.7]], 0.05, 0.3, 3); }
  // evacuation slides inflating (loud hiss) and the lightning crack
  slide() { this._burst('white', [['highpass', 900, 0.6]], 0.6, 0.02, 4.5, this.hull); this.thump(0.8, 60); }
  lightning() { this._burst('white', [['bandpass', 3000, 0.7]], 0.6, 0.001, 0.2); this.bang(0.6, 0.02); }
  // Thunder from a flash `d` metres away: it arrives d/343 s later, a sharp crack only when close,
  // then a rumble that is longer and deeper the further away the flash was (the high frequencies
  // are absorbed first), and seldom heard beyond about 16 km (the US National Weather Service's
  // "if you can hear thunder, you are within 10 miles"). `k` scales it for the cabin walls.
  thunder(d, k = 1) {
    if (!this.ready || d > 20000 || k <= 0) return;
    const when = d / 343;
    if (when > 90) return;
    const a = k * 0.9 / (1 + d / 1200);
    const cut = 90 + 900 / (1 + d / 1500);
    if (d < 1500) this._burst('white', [['bandpass', 2600, 0.6]], a * 0.8, 0.002, 0.25, this.master, when);
    const len = 1.2 + Math.min(6, d / 2500);
    for (let i = 0; i < 4; i++) {
      const w = when + i * len * (0.12 + 0.18 * Math.random());
      this._burst('brown', [['lowpass', cut * (0.8 + 0.4 * Math.random()), 0.7]], a * (1 - i * 0.18), 0.03 + 0.1 * i, len * (0.5 + 0.3 * Math.random()), this.master, w, 0.7);
    }
  }
}

function smoothN(x, a, b) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
