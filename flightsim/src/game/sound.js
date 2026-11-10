/**
 * What you hear, synthesised from what the machine is doing: the engine's note is built on its firing frequency (two power
 * strokes a revolution) and swells with manifold pressure; the propeller adds its own beat; the slipstream hisses with dynamic
 * pressure; the wheels rumble on the surface they are actually rolling on; the starter grinds while it draws current; the stall
 * warning is a reed that sounds with the suction at the wing's leading edge. Nothing is a recording.
 */
import { Audio } from '../../../medengine/src/index.js';

export class FlightSound {
  constructor() { this.audio = new Audio(); this.on = false; this.muted = false; }

  /** Call from a click or key press: browsers only start sound then. */
  start() {
    if (this.on) return;
    this.audio.start();
    const ctx = this.ctx = this.audio.ctx;
    if (!ctx) return;
    this.on = true;
    const out = this.out = ctx.createGain(); out.gain.value = 0.9; out.connect(this.audio.master ?? ctx.destination);
    this.cabin = ctx.createBiquadFilter(); this.cabin.type = 'lowpass'; this.cabin.frequency.value = 2200; this.cabin.connect(out);
    const noise = this.audio.noise ?? this._noise(2);
    const src = (buffer) => { const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true; s.start(); return s; };
    const osc = (type, f = 100) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
    const gain = (v = 0, to = this.cabin) => { const g = ctx.createGain(); g.gain.value = v; g.connect(to); return g; };
    const filter = (type, f, q, to) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(to); return b; };
    // engine: exhaust pulses, a lumpy half-order, a harmonic, shaped and filtered
    this.eg = gain(0); this.elp = filter('lowpass', 400, 0.7, this.eg);
    const shape = ctx.createWaveShaper(); const curve = new Float32Array(257); for (let i = 0; i < 257; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(2.2 * x); } shape.curve = curve; shape.connect(this.elp);
    this.e1 = osc('sawtooth'); this.e2 = osc('square'); this.e3 = osc('triangle');
    const m1 = gain(0.5, shape), m2 = gain(0.32, shape), m3 = gain(0.22, shape); this.e1.connect(m1); this.e2.connect(m2); this.e3.connect(m3);
    this.rough = gain(0, shape); src(noise).connect(filter('lowpass', 90, 1, this.rough));
    // propeller: broadband noise beaten at the blade-passing frequency
    this.pg = gain(0); const pb = filter('bandpass', 1400, 0.6, this.pg); src(noise).connect(pb);
    this.pm = gain(0, this.pg.gain); this.e1.connect(this.pm);
    // slipstream and airframe
    this.wg = gain(0); this.wlp = filter('lowpass', 800, 0.4, this.wg); src(noise).connect(this.wlp);
    // wheels
    this.rg = gain(0); this.rlp = filter('lowpass', 110, 0.8, this.rg); src(noise).connect(this.rlp);
    this.skid = gain(0); src(noise).connect(filter('bandpass', 1900, 6, this.skid));
    // starter, flap motor, gyros, stall horn
    this.sg = gain(0); this.s1 = osc('sawtooth', 160); this.s1.connect(filter('bandpass', 900, 1.2, this.sg));
    this.fg = gain(0); osc('sawtooth', 310).connect(filter('lowpass', 900, 1, this.fg));
    this.gg = gain(0); this.g1 = osc('sine', 390); this.g1.connect(this.gg);
    this.hg = gain(0, out); this.h1 = osc('square', 430); this.h2 = osc('sawtooth', 437); const hf = filter('bandpass', 1300, 1.5, this.hg); this.h1.connect(hf); this.h2.connect(hf);
    this.t = 0;
  }
  _noise(sec) { const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }

  /** One-off sounds. */
  fx(name, v = 1) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime, g = ctx.createGain(), s = ctx.createBufferSource(), f = ctx.createBiquadFilter();
    s.buffer = this.audio.noise ?? this._noise(1); f.type = 'bandpass';
    const [freq, q, dur, vol] = { click: [2600, 2, 0.035, 0.5], primer: [700, 1.5, 0.5, 0.25], chirp: [1700, 5, 0.22, Math.min(1, v)], thump: [70, 1, 0.3, Math.min(1.5, v)] }[name] ?? [1000, 1, 0.1, 0.3];
    f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.cabin); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  /** Radio speech through the browser's own voice, if it has one. */
  say(text) { try { this.audio.speak?.(text, { rate: 1.05, pitch: 0.9, radio: true }); } catch { /* no speech engine */ } }
  hush() { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }

  /** @param {object} ac the aircraft  @param {boolean} inside  is the listener in the cabin? */
  update(dt, ac, inside, paused) {
    if (!this.on) return;
    const now = this.ctx.currentTime, set = (p, v, tc = 0.05) => p.setTargetAtTime(v, now, tc);
    set(this.out.gain, paused || this.muted ? 0 : 0.9, 0.08);
    const eng = ac.eng, rpm = Math.abs(eng.rpm), f = Math.max(rpm / 30, 1), load = eng.firing ? Math.min(1.1, eng.map / 100000) : 0;
    set(this.e1.frequency, f); set(this.e2.frequency, f / 2); set(this.e3.frequency, f * 2);
    const turning = Math.min(1, rpm / 300);
    set(this.eg.gain, turning * (eng.firing ? 0.10 + 0.42 * load : 0.03) * (inside ? 1 : 1.3));
    set(this.elp.frequency, 180 + rpm * 0.55 + load * 500);
    set(this.rough.gain, eng.rough * 2.5 * turning);
    const tip = rpm / 2700; set(this.pg.gain, 0.16 * tip ** 3 * (inside ? 0.6 : 1.4)); set(this.pm.gain, 0.12 * tip ** 3);
    const v = ac.tas, q = 0.5 * ac.air.rho * v * v;
    set(this.wg.gain, Math.min(0.5, q / 5200) * (inside ? 1 : 0.5) + ac.buffet * 0.25); set(this.wlp.frequency, 300 + v * 22);
    const w = ac.gear.wheels, roll = ac.gear.onGround ? Math.max(...w.map((x) => (x.onGround ? Math.abs(x.roll) : 0))) : 0, grass = w.some((x) => x.onGround && x.surface === 1);
    set(this.rg.gain, Math.min(0.5, roll / 45) * (grass ? 1.6 : 1)); set(this.rlp.frequency, 70 + roll * 4 + (grass ? 60 : 0));
    set(this.skid.gain, Math.max(...w.map((x) => (x.onGround ? x.slip : 0))) * Math.min(1, roll / 4) * 0.25);
    set(this.sg.gain, eng.starterAmps > 5 ? 0.16 : 0, 0.03); set(this.s1.frequency, 120 + rpm * 0.9);
    set(this.fg.gain, ac.flapMoving ? 0.035 : 0);
    set(this.gg.gain, 0.006 * ac.inst.aiSpin * (inside ? 1 : 0)); set(this.g1.frequency, 150 + 260 * ac.inst.aiSpin);
    set(this.hg.gain, ac.horn * 0.22 * (inside ? 1 : 0.15), 0.03); set(this.h1.frequency, 400 + 60 * ac.horn); set(this.h2.frequency, 406 + 62 * ac.horn);
    set(this.cabin.frequency, inside ? 2200 : 9000, 0.2);
    for (const x of w) if (x.chirp) { this.fx(x.side ? 'chirp' : 'chirp', x.chirp / 40); this.fx('thump', (ac.gear.touchdown?.sink ?? 1) / 2.5); x.chirp = 0; }
  }
}
