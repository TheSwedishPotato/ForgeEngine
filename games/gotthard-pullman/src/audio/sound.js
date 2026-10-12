/**
 * The sound of the trip, made from the physics as it happens (Web Audio, no recordings).
 *
 * The engine: every exhaust beat of the low-pressure cylinders is a chuff (a burst of blast noise,
 * its loudness from the pressure left in the cylinder at release, its length shorter as the beats
 * come faster, with the thump of the column in the chimney), placed at the chimney and heard after
 * the time the sound takes to come back along the train (343 m/s). The whistle, the roar of the
 * safety valves, the blower's hiss, the panting of the air pump, the drain cocks spitting.
 *
 * The car you sit in: the rumble of its wheels on the welded rail (its spectrum rising with the
 * speed), flange squeal in the tight curves of the ramps, brake blocks singing as the train comes
 * to a stand, the wind on the body, the panelling creaking with the sway, the murmur of the other
 * passengers. Through the car's walls the outside is muffled; in a tunnel it comes back from the
 * vault as a long reverberation and much louder.
 */
const SOUND_SPEED = 343;

export class Sound {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.volume = 0.8;
    this.muted = false;
    this._lastBeat = 0;
    this._pumpSign = 0;
    this._creepT = 0;
  }

  /** Audio may only start after a gesture: the first click or key starts it. */
  attach(target = window) {
    const go = () => { this.start(); target.removeEventListener('pointerdown', go); target.removeEventListener('keydown', go); };
    target.addEventListener('pointerdown', go);
    target.addEventListener('keydown', go);
    target.addEventListener('keydown', (e) => { if (e.code === 'KeyN') this.setMuted(!this.muted); });
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05); }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.noise = this._noiseBuffer(3);
    // master: a gentle compressor keeps the safety valves from deafening
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    // the outside through the car's walls (a low-pass; open when the camera is outside)
    this.walls = ctx.createBiquadFilter(); this.walls.type = 'lowpass'; this.walls.frequency.value = 1100; this.walls.Q.value = 0.5;
    this.outside = ctx.createGain(); this.outside.gain.value = 1;
    this.outside.connect(this.walls).connect(this.master);
    // a tunnel's vault: a reverb send
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this._impulse(3.2, 2.2);
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0;
    this.outside.connect(this.reverbSend).connect(this.reverb).connect(this.walls);
    // the engine: a bus delayed by the sound's travel and placed at the chimney
    this.engDelay = ctx.createDelay(2.0);
    this.engPan = ctx.createPanner();
    Object.assign(this.engPan, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 10, rolloffFactor: 1.1, maxDistance: 5000 });
    this.engBus = ctx.createGain();
    this.engBus.connect(this.engDelay).connect(this.engPan).connect(this.outside);
    // inside the car (not through the walls)
    this.inside = ctx.createGain(); this.inside.connect(this.master);

    // continuous layers
    this.rumble = this._noiseLayer({ type: 'lowpass', f: 120, Q: 0.7 }, this.outside);
    this.rumbleHi = this._noiseLayer({ type: 'bandpass', f: 600, Q: 0.9 }, this.outside);
    this.wind = this._noiseLayer({ type: 'bandpass', f: 500, Q: 0.5 }, this.outside);
    this.squeal = this._tone([3150, 4230, 6300], this.outside);
    this.brakeSing = this._tone([2480, 3720], this.outside);
    this.safety = this._noiseLayer({ type: 'highpass', f: 1400, Q: 0.6 }, this.engBus);
    this.blower = this._noiseLayer({ type: 'bandpass', f: 1900, Q: 1.4 }, this.engBus);
    this.drains = this._noiseLayer({ type: 'bandpass', f: 2600, Q: 0.8 }, this.engBus);
    this.whistle = this._whistle(this.engBus);
    this.murmur = this._babble(this.inside);
    // another train going by: the roar of its wheels and the rush of air
    this.passby = this._noiseLayer({ type: 'bandpass', f: 420, Q: 0.6 }, this.outside);
    this.passbyHi = this._noiseLayer({ type: 'highpass', f: 1800, Q: 0.5 }, this.outside);
    this.horn = this._tone([370, 440], this.outside);   // a two-tone horn (the pitches are an estimate)
    this.heating = this._noiseLayer({ type: 'highpass', f: 4000, Q: 0.5 }, this.inside);
  }

  // ---- building blocks ------------------------------------------------------------------------------

  _noiseBuffer(sec) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /** A diffuse decaying tail (a tunnel's vault): noise under an exponential envelope, stereo. */
  _impulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) { const t = i / ctx.sampleRate; d[i] = (Math.random() * 2 - 1) * Math.exp(-t * decay) * (t < 0.012 ? t / 0.012 : 1); }
    }
    return b;
  }

  _noiseLayer({ type, f, Q }, out) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    src.loopStart = Math.random(); src.start(0, Math.random() * 2);
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = Q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(flt).connect(g).connect(out);
    return { src, flt, g };
  }

  _tone(freqs, out) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const oscs = freqs.map((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = 1 / (i + 1.5);
      o.connect(og).connect(g); o.start();
      return o;
    });
    g.connect(out);
    return { g, oscs, base: freqs.slice() };
  }

  /** The engine's whistle: a bell whistle's fundamental with its partials and the steam's breath. */
  _whistle(out) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3500;
    const f0 = 722;                              // (a single-bell whistle of the class; the pitch is an estimate)
    for (const [k, a] of [[1, 1], [2, 0.32], [3, 0.12], [4.02, 0.05]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f0 * k;
      const og = ctx.createGain(); og.gain.value = a; o.connect(og).connect(tone); o.start();
    }
    const breath = this._noiseLayer({ type: 'bandpass', f: f0 * 2, Q: 3 }, tone);
    breath.g.gain.value = 0.25;
    tone.connect(g).connect(out);
    return { g };
  }

  /** The passengers talking: noise through vowel formants, the syllables and phrases coming and going. */
  _babble(out) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const voices = [];
    for (let v = 0; v < 4; v++) {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true; src.start(0, Math.random() * 2);
      const vg = ctx.createGain(); vg.gain.value = 0;
      const mix = ctx.createGain(); mix.gain.value = 0.6;
      for (const [f, q] of [[520 + v * 60, 6], [1450 + v * 120, 8], [2500 + v * 90, 9]]) {
        const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q;
        src.connect(b).connect(mix);
      }
      mix.connect(vg).connect(g);
      voices.push({ vg, phase: Math.random() * 10, rate: 3.5 + Math.random() * 2, talk: 0 });
    }
    g.connect(out);
    return { g, voices };
  }

  /** One exhaust beat: blast noise and the chimney's thump, at level L (0..1.5), length d (s). */
  _chuff(L, d, bright) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 280 + 900 * bright; bp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500 + 3000 * bright;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, L), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + d);
    src.connect(bp).connect(lp).connect(g).connect(this.engBus);
    src.start(t, Math.random() * 2, d + 0.05);
    // the thump of the column in the chimney
    const th = ctx.createBufferSource(); th.buffer = this.noise;
    const tl = ctx.createBiquadFilter(); tl.type = 'lowpass'; tl.frequency.value = 140;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(Math.max(0.001, L * 1.6), t + 0.004);
    tg.gain.exponentialRampToValueAtTime(0.0008, t + d * 0.55);
    th.connect(tl).connect(tg).connect(this.engBus);
    th.start(t, Math.random() * 2, d * 0.6 + 0.05);
  }

  /** A short noise click (wood creaking, the pump's valves): centre f, level, length. */
  _click(f, L, d, out) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(L, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0005, t + d);
    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random() * 2, d + 0.03);
  }

  // ---- each frame ------------------------------------------------------------------------------------

  update(dt) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || dt <= 0) { if (ctx?.state === 'suspended') ctx.resume(); return; }
    const G = this.game, sim = G.sim, T = sim.train, L = T.loco, o = L.out, c = L.c;
    const now = ctx.currentTime, k = (x) => Math.min(1, dt * x);
    const set = (param, v, tau = 0.08) => param.setTargetAtTime(v, now, tau);
    const cam = G.stage.camera;
    const v = Math.abs(T.speed);
    // the listener at the eye
    const Lsn = ctx.listener, cp = cam.position;
    const fwd = cam.getWorldDirection(this._f ??= cam.position.clone());
    if (Lsn.positionX) {
      Lsn.positionX.setTargetAtTime(cp.x, now, 0.02); Lsn.positionY.setTargetAtTime(cp.y, now, 0.02); Lsn.positionZ.setTargetAtTime(cp.z, now, 0.02);
      Lsn.forwardX.setTargetAtTime(fwd.x, now, 0.02); Lsn.forwardY.setTargetAtTime(fwd.y, now, 0.02); Lsn.forwardZ.setTargetAtTime(fwd.z, now, 0.02);
      Lsn.upX.value = 0; Lsn.upY.value = 1; Lsn.upZ.value = 0;
    } else { Lsn.setPosition(cp.x, cp.y, cp.z); Lsn.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
    // the chimney, and the time its sound takes to arrive
    const eng = G.trainGL.vehicles[0];
    if (eng) {
      eng.group.updateMatrixWorld();
      const p = (this._cp ??= cam.position.clone()).set(6.3425 - 1.75, 4.5, 0).applyMatrix4(eng.group.matrixWorld);
      if (this.engPan.positionX) { set(this.engPan.positionX, p.x, 0.02); set(this.engPan.positionY, p.y, 0.02); set(this.engPan.positionZ, p.z, 0.02); }
      else this.engPan.setPosition(p.x, p.y, p.z);
      set(this.engDelay.delayTime, Math.min(1.9, p.distanceTo(cp) / SOUND_SPEED), 0.1);
    }
    // where the listener is: inside the car (muffled), outside, in a tunnel
    const outsideView = G.player.exposed?.() ?? G.player.mode === 'outside';
    const car = G.player.car?.();
    const sHere = car ? car.v.s : T.front;
    const tunnel = !!sim.route.inTunnel(sHere);
    set(this.walls.frequency, outsideView ? 16000 : tunnel ? 1900 : 1100, 0.3);
    set(this.reverbSend.gain, tunnel ? 0.55 : 0, 0.4);
    set(this.outside.gain, tunnel ? 1.9 : 1, 0.4);

    // ---- the engine
    const vRail = v;
    for (const ev of L.queue ?? []) {
      if (!(ev.n > this._lastBeat)) continue;
      this._lastBeat = ev.n;
      if (ev.type !== 'beat' || (L.time ?? 0) - ev.t > 0.4) continue;
      const strength = Math.max(0, ev.strength ?? 0.2);
      const level = Math.min(1.4, 0.12 + strength * 1.8) * Math.min(1.3, 0.5 + Math.sqrt(Math.max(0.01, ev.mass ?? 0.1)) * 1.2);
      const d = Math.max(0.07, Math.min(0.42, 0.42 / (1 + vRail / 4)));
      this._chuff(level, d, Math.min(1, strength * 1.6));
    }
    set(this.safety.g.gain, Math.min(1.2, (o.svFlow ?? 0) * 0.5), 0.05);
    set(this.blower.g.gain, (c.regulator < 0.1 ? 1 : 0.3) * (c.blower ?? 0) * 0.25, 0.2);
    set(this.drains.g.gain, c.drainCocks ? Math.min(0.8, (o.drainFlow ?? 0) * 8) : 0, 0.05);
    set(this.whistle.g.gain, Math.min(1, (o.whistleFlow ?? 0) / 0.12) * 0.45, 0.025);
    // the air pump: each stroke a pant and a clack of its valves
    const sgn = Math.sign(o.pumpBeat ?? 0);
    if (sgn !== 0 && sgn !== this._pumpSign) { this._click(320, 0.25, 0.12, this.engBus); this._click(1800, 0.06, 0.03, this.engBus); }
    this._pumpSign = sgn;

    // ---- the car on the rails
    const rv = Math.min(1, v / 25);
    set(this.rumble.g.gain, 0.55 * Math.pow(rv, 1.1), 0.15);
    set(this.rumble.flt.frequency, 70 + 7 * v, 0.2);
    set(this.rumbleHi.g.gain, 0.12 * Math.pow(rv, 1.6), 0.15);
    set(this.rumbleHi.flt.frequency, 350 + 25 * v, 0.2);
    set(this.wind.g.gain, 0.25 * Math.pow(Math.min(1.5, v / 22), 2) + (G.weather.p.wind ?? 0) * 0.008, 0.3);
    // flange squeal: in curves tighter than about 350 m, most between walking pace and 50 km/h
    const kc = Math.abs(sim.route.run.curvatureAt(sHere));
    const R = kc > 1e-6 ? 1 / kc : 1e9;
    const sq = Math.max(0, (350 - R) / 120) * Math.min(1, v / 3) * Math.max(0, 1 - Math.max(0, v - 14) / 8);
    this._sq = (this._sq ?? 0) + (sq * (0.6 + 0.4 * Math.sin(now * 2.3) * Math.sin(now * 0.7)) - (this._sq ?? 0)) * k(3);
    set(this.squeal.g.gain, Math.min(0.18, this._sq * 0.12), 0.05);
    this.squeal.oscs.forEach((osc, i) => set(osc.frequency, this.squeal.base[i] * (1 + 0.012 * Math.sin(now * (3 + i) + i)), 0.05));
    // the brake blocks sing in the last metres before a stand
    const bc = T.brake?.v?.[Math.min(T.brake.v.length - 1, Math.max(0, G.trainGL.vehicles.indexOf(car)))]?.pBC ?? 0;
    set(this.brakeSing.g.gain, bc > 0.4 && v > 0.2 && v < 6 ? Math.min(0.08, bc * 0.02) * (1 - v / 6) : 0, 0.08);

    // ---- the Treno Gottardo going by, and its driver's greeting for the steam train
    const nt = G.trafficGL?.nearest(cp);
    if (nt) {
      const a = G.traffic.at(sim.clock).find((x) => x.train === G.traffic.trains[nt.i]);
      const vv = a?.v ?? 0, near = 1 / (1 + Math.max(0, nt.d - 6) / 14);
      set(this.passby.g.gain, Math.min(1.2, near * Math.pow(vv / 22, 1.4) * 1.2), 0.08);
      set(this.passbyHi.g.gain, Math.min(0.5, near * near * Math.pow(vv / 22, 2) * 0.6), 0.05);
      const eDist = eng ? nt.pos.distanceTo(eng.group.position) : 1e9;
      const key = `${nt.i}:${Math.round(sim.clock / 600)}`;
      if (eDist < 160 && vv > 3 && this._hornFor !== key) { this._hornFor = key; this._hornT = 1.4; }
    } else { set(this.passby.g.gain, 0, 0.2); set(this.passbyHi.g.gain, 0, 0.2); }
    this._hornT = Math.max(0, (this._hornT ?? 0) - dt);
    set(this.horn.g.gain, this._hornT > 0.75 || (this._hornT > 0 && this._hornT < 0.5) ? 0.22 : 0, 0.02);

    // ---- inside the car
    const inCar = !outsideView;
    const ride = car?.ride?.felt;
    if (inCar && ride) {
      // the panelling creaks with the sway
      this._creepT -= dt * (0.3 + Math.abs(ride.lat ?? 0) * 6 + Math.abs(ride.vert ?? 0) * 2);
      if (this._creepT <= 0) { this._creepT = 0.4 + Math.random() * 2.5; this._click(1400 + Math.random() * 2600, 0.015 + Math.random() * 0.03, 0.04 + Math.random() * 0.08, this.inside); }
    }
    // the others talking, quieter when the train is loud
    const awake = G.people ? G.people.passengers.filter((p) => p.model === car && p.act !== 'doze').length : 0;
    set(this.murmur.g.gain, inCar ? Math.min(0.05, awake * 0.004) : 0, 0.5);
    for (const vc of this.murmur.voices) {
      vc.phase += dt * vc.rate;
      if (Math.random() < dt * 0.15) vc.talk = vc.talk ? 0 : 1;
      set(vc.vg.gain, vc.talk * Math.max(0, Math.sin(vc.phase * Math.PI)) ** 2, 0.03);
    }
    set(this.heating.g.gain, inCar ? (c.steamHeat ?? 0) * 0.006 : 0, 0.5);
  }
}
