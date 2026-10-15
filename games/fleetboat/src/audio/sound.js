/**
 * The boat's sounds, synthesized from what the plant is doing (Web Audio; nothing recorded):
 *
 *  - the main engines: a Fairbanks-Morse opposed-piston two-stroke fires every cylinder every turn,
 *    ten cylinders: the firing note is rpm / 60 x 10 (120 Hz at 720 rpm), rough with its harmonics,
 *    and the scavenging blower's whine over it; deafening in the engine rooms, a throb elsewhere;
 *  - the main motors and generators: a hum at the commutators' frequency rising with the speed,
 *    louder with the current;
 *  - the auxiliaries: the ventilation blowers' rush, the trim pump's whine, the low-pressure
 *    blower's drone, the hydraulic pumps' chatter when the accumulator is charging;
 *  - the diving alarm (the klaxon: "ah-OO-gah"), the telegraphs' bells;
 *  - air: the roar out of the vents as she dives, the hiss of a blow in the manifolds, the bubble
 *    of the air spilling from the flood ports;
 *  - the sea: the slap of waves on the casing on the surface; under water, the flow along the hull
 *    with the speed, and the hull's creaks and groans as the pressure on it changes.
 *
 * Each sound has a place in the boat; you hear it louder in its own compartment, through an open
 * door less, through shut ones hardly.
 */
import { COMPARTMENTS, frameX } from '../data/boat.js';

const PLACES = {
  fer: (COMPARTMENTS.find((c) => c.id === 'fer').x0 + COMPARTMENTS.find((c) => c.id === 'fer').x1) / 2,
  aer: (COMPARTMENTS.find((c) => c.id === 'aer').x0 + COMPARTMENTS.find((c) => c.id === 'aer').x1) / 2,
  man: -27.5, cr: 11.0, pump: 10.0, vents: 0, abr: 0,
};

export class Sound {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.on = false;
    this.t = 0;
    this._lastBell = {};
    this._creakIn = 3;
  }

  /** Starts on the first gesture (browsers allow sound only after one). */
  attach(el) {
    const start = () => { if (!this.ctx) this._init(); this.ctx?.resume?.(); };
    el.addEventListener('pointerdown', start);
    el.addEventListener('keydown', start);
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = 0.7; this.master.connect(c.destination);
    // white noise for the rushes and roars
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noise = (type, f, q) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(this.master); s.start();
      return { g, fl };
    };
    const tone = (type, f) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f;
      const g = c.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(this.master); o.start();
      return { o, g };
    };
    this.engines = [0, 1, 2, 3].map(() => {
      const fire = tone('sawtooth', 120), f2 = tone('square', 240);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
      fire.g.disconnect(); f2.g.disconnect(); fire.g.connect(lp); f2.g.connect(lp); lp.connect(this.master);
      return { fire, f2, blower: tone('triangle', 900), rush: noise('bandpass', 500, 0.8) };
    });
    this.motors = { hum: tone('sawtooth', 200), whine: tone('sine', 800) };
    const mlp = c.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 900;
    this.motors.hum.g.disconnect(); this.motors.hum.g.connect(mlp); mlp.connect(this.master);
    this.vent = noise('bandpass', 300, 0.6);            // the main vents' roar
    this.blow = noise('highpass', 3500, 0.7);           // the hiss of the high-pressure air
    this.blowLow = noise('lowpass', 250, 0.7);          // and its rumble in the tanks
    this.fans = noise('bandpass', 700, 0.5);            // ventilation
    this.flow = noise('lowpass', 180, 0.6);             // the sea along the hull
    this.waves = noise('lowpass', 400, 0.5);
    this.pump = tone('sawtooth', 340);
    this.lpb = tone('sawtooth', 95);
    this.klaxon = tone('square', 380);
    const kf = c.createBiquadFilter(); kf.type = 'bandpass'; kf.frequency.value = 900; kf.Q.value = 1.2;
    this.klaxon.g.disconnect(); this.klaxon.g.connect(kf); kf.connect(this.master);
    this.on = true;
  }

  /** How loud a source at boat x is where you are: same compartment 1, through doors less. */
  _heard(x, me) {
    const dx = Math.abs(x - me.x);
    let g = 1 / (1 + (dx / 7) ** 2);
    // each bulkhead between: an open door passes a third, a shut one a twentieth
    const ctl = this.game.sim.plant.ctl;
    const a = Math.min(x, me.x), b = Math.max(x, me.x);
    for (let i = 0; i < COMPARTMENTS.length - 1; i++) {
      const bx = COMPARTMENTS[i].x1;
      if (bx > a && bx < b) g *= (+ctl[`door.${i}`] || 0) > 0.5 ? 0.35 : 0.05;
    }
    if (me.outside) g *= 0.15;
    return g;
  }

  _set(node, v, k = 0.08) { node.gain.setTargetAtTime(Math.max(0, v), this.ctx.currentTime, k); }

  bell() {
    const c = this.ctx; if (!c) return;
    for (let i = 0; i < 2; i++) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = 1760; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, c.currentTime + i * 0.28);
      g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + i * 0.28 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + i * 0.28 + 0.6);
      o.connect(g); g.connect(this.master); o.start(c.currentTime + i * 0.28); o.stop(c.currentTime + i * 0.28 + 0.7);
    }
  }

  creak(level) {
    const c = this.ctx; if (!c) return;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 60 + Math.random() * 140; f.Q.value = 18;
    const g = c.createGain(); g.gain.value = 0;
    const t = c.currentTime, d = 0.4 + Math.random() * 1.4;
    g.gain.linearRampToValueAtTime(level, t + d * 0.3); g.gain.linearRampToValueAtTime(0, t + d);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + d + 0.1);
  }

  update(dt) {
    if (!this.on || !this.ctx) return;
    this.t += dt;
    const G = this.game, P = G.sim.plant, g = P.g, ctl = P.ctl;
    const pl = G.player;
    const me = pl.mode === 'walk' ? { x: pl.p.x, outside: false } : { x: 0, outside: true };
    // the diesels
    const engX = [PLACES.fer, PLACES.fer, PLACES.aer, PLACES.aer];
    P.engines.forEach((e, i) => {
      const E = this.engines[i], rpm = e.rpm, h = this._heard(engX[i], me);
      const fire = rpm / 60 * 10;
      E.fire.o.frequency.setTargetAtTime(Math.max(20, fire), this.ctx.currentTime, 0.1);
      E.f2.o.frequency.setTargetAtTime(Math.max(40, fire * 2.02), this.ctx.currentTime, 0.1);
      E.blower.o.frequency.setTargetAtTime(Math.max(50, rpm * 2.0 / 60 * 26), this.ctx.currentTime, 0.1);
      const load = e.firing ? 0.5 + 0.5 * Math.min(1, e.power / e.ratedPower) : rpm > 5 ? 0.25 : 0;
      this._set(E.fire.g, 0.09 * load * h);
      this._set(E.f2.g, 0.04 * load * h);
      this._set(E.blower.g, 0.012 * Math.min(1, rpm / 700) * h);
      this._set(E.rush.g, 0.12 * Math.min(1, rpm / 700) * h);
    });
    // the motors
    const mrpm = Math.max(Math.abs(g.motorRpm?.port ?? 0), Math.abs(g.motorRpm?.stbd ?? 0));
    const amps = Math.abs(g.amps?.port ?? 0) + Math.abs(g.amps?.stbd ?? 0);
    const hm = this._heard(PLACES.man, me);
    this.motors.hum.o.frequency.setTargetAtTime(Math.max(30, mrpm / 60 * 6), this.ctx.currentTime, 0.2);
    this.motors.whine.o.frequency.setTargetAtTime(Math.max(60, mrpm / 60 * 48), this.ctx.currentTime, 0.2);
    this._set(this.motors.hum.g, 0.03 * Math.min(1, mrpm / 1200) * (0.4 + Math.min(1, amps / 5000)) * hm);
    this._set(this.motors.whine.g, 0.006 * Math.min(1, mrpm / 1200) * hm);
    // air
    let vent = 0, blowing = 0;
    for (const tk of P.boat.tanks) { vent += tk.venting ?? 0; }
    blowing = (g.p600 > 20 && P.boat.tankFlows?.fromSupply > 0 ? 1 : 0) + (+ctl['hp.blow.negative'] || 0) + (+ctl['hp.blow.safety'] || 0) + (+ctl['hp.blow.bb'] || 0) * 0.5;
    this._set(this.vent.g, Math.min(0.5, Math.sqrt(vent) * 0.012) * (me.outside ? 1 : 0.6));
    this._set(this.blow.g, Math.min(0.25, blowing * 0.1) * this._heard(PLACES.cr, me));
    this._set(this.blowLow.g, Math.min(0.3, blowing * 0.12));
    // auxiliaries
    this._set(this.fans.g, ((+ctl['fer.ventBlowers'] || 0) > 0.5 ? 0.03 : 0.012) * (P.power ? 1 : 0));
    const pumpOn = P.trim.pump && P.trim.primed > 0.9;
    this._set(this.pump.g, pumpOn ? 0.015 * this._heard(PLACES.pump, me) : 0);
    this._set(this.lpb.g, P.air.lpBlower ? 0.04 * this._heard(PLACES.pump, me) : 0);
    // the sea
    const sub = Math.min(1, Math.max(0, (g.depth - 25) / 15));
    const kn = Math.abs(g.speed ?? 0);
    this._set(this.flow.g, sub * Math.min(0.2, 0.004 * kn * kn));
    this._set(this.waves.g, (1 - sub) * 0.05 * (me.outside ? 2 : 1));
    // the klaxon: "ah-OO-gah", the pitch climbing through each blast
    const alarm = g.alarm;
    if (alarm) { this._klax = (this._klax ?? 0) + dt; const k = this._klax % 0.9; this.klaxon.o.frequency.setTargetAtTime(300 + 260 * Math.min(1, k / 0.45), this.ctx.currentTime, 0.03); }
    else this._klax = 0;
    this._set(this.klaxon.g, alarm ? 0.12 : 0, 0.02);
    // the telegraphs' bells in the conning tower and the maneuvering room
    for (const side of ['port', 'stbd']) {
      const b = ctl[`ct.telegraph.${side}`];
      if (this._lastBell[side] && this._lastBell[side] !== b) this.bell();
      this._lastBell[side] = b;
    }
    // the hull, as the pressure on it changes
    this._lastDepth ??= g.depth;
    const dd = Math.abs(g.depth - this._lastDepth);
    this._lastDepth = g.depth;
    this._creakIn -= dt * (1 + dd * 40 + g.depth / 120);
    if (this._creakIn < 0 && g.depth > 40) { this.creak(Math.min(0.2, 0.03 + g.depth / 3000 + dd * 2)); this._creakIn = 2 + Math.random() * 8; }
  }
}

export { PLACES, frameX };
