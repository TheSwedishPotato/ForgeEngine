/**
 * The elevator's sounds, made as it makes them (Web Audio, nothing recorded): the machine's
 * electrical hum at its slot frequency and the inverter's whine, rising with the speed; the wind
 * on the glass and the rumble of the roller guides; the door operator; the contactors and the
 * brakes; the arrival gong (once going up, twice going down); the buttons; the overload and
 * nudging buzzers; the alarm bell; the safety gear's screech and the buffers' thump.
 * Distant things are quieter: what is far from your ears is attenuated.
 */
export class Sound {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.vol = 0.8;
  }

  attach(target) {
    const start = () => {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      try { this._init(); } catch { this.ctx = null; }
    };
    target.addEventListener('pointerdown', start);
    target.addEventListener('keydown', start);
  }

  _init() {
    const A = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.out = A.createGain(); this.out.gain.value = this.vol; this.out.connect(A.destination);
    const noise = A.createBuffer(1, A.sampleRate * 2, A.sampleRate), d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = noise;
    const loopNoise = () => { const s = A.createBufferSource(); s.buffer = noise; s.loop = true; s.start(); return s; };
    // the machine: slot harmonic and the inverter's carrier whine
    this.hum = A.createOscillator(); this.hum.type = 'sawtooth';
    this.humF = A.createBiquadFilter(); this.humF.type = 'lowpass'; this.humF.frequency.value = 600;
    this.humG = A.createGain(); this.humG.gain.value = 0;
    this.hum.connect(this.humF).connect(this.humG).connect(this.out); this.hum.start();
    this.whine = A.createOscillator(); this.whine.type = 'sine'; this.whine.frequency.value = 3150;
    this.whineG = A.createGain(); this.whineG.gain.value = 0;
    this.whine.connect(this.whineG).connect(this.out); this.whine.start();
    // wind on the glass, the guides' rumble
    this.wind = loopNoise(); this.windF = A.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.Q.value = 0.6;
    this.windG = A.createGain(); this.windG.gain.value = 0;
    this.wind.connect(this.windF).connect(this.windG).connect(this.out);
    this.rum = loopNoise(); this.rumF = A.createBiquadFilter(); this.rumF.type = 'lowpass'; this.rumF.frequency.value = 120;
    this.rumG = A.createGain(); this.rumG.gain.value = 0;
    this.rum.connect(this.rumF).connect(this.rumG).connect(this.out);
    // the door operator
    this.door = A.createOscillator(); this.door.type = 'square'; this.door.frequency.value = 95;
    this.doorF = A.createBiquadFilter(); this.doorF.type = 'lowpass'; this.doorF.frequency.value = 400;
    this.doorG = A.createGain(); this.doorG.gain.value = 0;
    this.door.connect(this.doorF).connect(this.doorG).connect(this.out); this.door.start();
    // buzzer (overload, nudging) and the safety gear's screech
    this.buzz = A.createOscillator(); this.buzz.type = 'square'; this.buzz.frequency.value = 440;
    this.buzzG = A.createGain(); this.buzzG.gain.value = 0;
    this.buzz.connect(this.buzzG).connect(this.out); this.buzz.start();
    this.scr = loopNoise(); this.scrF = A.createBiquadFilter(); this.scrF.type = 'bandpass'; this.scrF.frequency.value = 2800; this.scrF.Q.value = 6;
    this.scrG = A.createGain(); this.scrG.gain.value = 0;
    this.scr.connect(this.scrF).connect(this.scrG).connect(this.out);
  }

  _burst(t, dur, f, q, g, type = 'bandpass') {
    const A = this.ctx, s = A.createBufferSource(); s.buffer = this.noise;
    const fl = A.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const gn = A.createGain(); gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(fl).connect(gn).connect(this.out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  _tone(t, f, dur, g, type = 'sine') {
    const A = this.ctx, o = A.createOscillator(); o.type = type; o.frequency.value = f;
    const gn = A.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn).connect(this.out); o.start(t); o.stop(t + dur + 0.05);
  }

  /** A sound event from the simulation, attenuated by how far it is from you. */
  play(e) {
    const A = this.ctx, t = A.currentTime, g = this.game, cam = g.stage.camera.position, h = g.sim.hoist;
    const at = e.at ?? (e.floor ? [0, (e.floor === 1 ? 0 : 6 + (e.floor - 2) * 3.9) + 2, 14.6] : [0, h.yc + 1.5, 16]);
    const dist = Math.hypot(cam.x - at[0], cam.y - at[1], cam.z - at[2]);
    const k = 1 / (1 + dist / 5);
    switch (e.name) {
      case 'click': this._burst(t, 0.03, 3500, 3, 0.25 * k); break;
      case 'beep': this._tone(t, 1760, 0.08, 0.12 * k); break;
      case 'beep2': this._tone(t, 1200, 0.07, 0.1 * k); this._tone(t + 0.1, 900, 0.07, 0.1 * k); break;
      case 'clack': this._burst(t, 0.05, 1800, 2, 0.5 * k); break;
      case 'contactor': case 'contactorOff': this._burst(t, 0.06, 900, 1.5, 0.4 * k); this._burst(t + 0.03, 0.05, 1500, 2, 0.3 * k); break;
      case 'brakeLift': case 'brakeDrop': this._burst(t, 0.09, 700, 1.2, (e.name === 'brakeDrop' ? 0.7 : 0.5) * k); this._burst(t + 0.02, 0.12, 2600, 4, 0.2 * k); break;
      case 'estop': this._burst(t, 0.6, 300, 0.8, 0.5 * k, 'lowpass'); break;
      case 'gong': this._tone(t, 659.3, 1.6, 0.28 * k); this._tone(t, 1318.5, 0.9, 0.08 * k); break;
      case 'gong2': this._tone(t, 659.3, 1.2, 0.28 * k); this._tone(t + 0.45, 523.3, 1.6, 0.28 * k); break;
      case 'doorShut': this._burst(t, 0.12, 220, 1, 0.5 * k, 'lowpass'); break;
      case 'alarm': for (let i = 0; i < 24; i++) this._tone(t + i * 0.08, 1100, 0.07, 0.15 * k, 'square'); break;
      case 'thump': this._burst(t, 0.3, 120, 1, 0.9, 'lowpass'); break;
      case 'snap': this._burst(t, 0.4, 1400, 0.7, 1.0); this._burst(t + 0.05, 0.8, 300, 0.7, 0.8, 'lowpass'); break;
      case 'doorMotor': break;
      default: break;
    }
  }

  update(dt) {
    if (!this.ctx) return;
    const g = this.game, s = g.sim, h = s.hoist, d = s.doors, c = s.ctl, t = this.ctx.currentTime;
    for (const e of s.sounds) this.play(e);
    s.sounds.length = 0;
    const cam = g.stage.camera.position;
    const inCar = g.player.onCar || (g.player.mode === 'walk' && Math.abs(cam.y - h.yc - 1.5) < 2 && cam.z > 15);
    const inMR = cam.y > 121;
    const v = Math.abs(h.vc), rpm = (Math.abs(h.vs) / 0.32) * 60 / (2 * Math.PI);
    const fe = (rpm / 60) * (20 / 2);                      // the electrical frequency (20 poles)
    const torque = Math.abs(h.motor.torque) / 6800;
    const mr = inMR ? 1 : 0.06;
    this.hum.frequency.setTargetAtTime(Math.max(18, fe * 6), t, 0.05);
    this.humG.gain.setTargetAtTime((h.motor.enabled ? 0.02 + 0.12 * torque : 0) * mr, t, 0.05);
    this.whineG.gain.setTargetAtTime((h.motor.enabled ? 0.006 + 0.01 * torque : 0) * mr, t, 0.05);
    this.windF.frequency.setTargetAtTime(300 + v * 220, t, 0.1);
    this.windG.gain.setTargetAtTime(inCar ? Math.min(0.25, v * v * 0.012) : 0.02 * v, t, 0.1);
    this.rumG.gain.setTargetAtTime(inCar ? Math.min(0.4, v * 0.06) : 0, t, 0.1);
    const near = inCar || Math.abs(cam.y - h.yc) < 4;
    this.doorG.gain.setTargetAtTime(near ? Math.min(0.06, Math.abs(d.car.v) * 0.12) : 0, t, 0.03);
    this.door.frequency.setTargetAtTime(70 + Math.abs(d.car.v) * 160, t, 0.05);
    const buzz = (c.overload && c.door !== 'closed') || c.nudging;
    this.buzzG.gain.setTargetAtTime(buzz && near ? 0.03 : 0, t, 0.02);
    const screech = h.sg.engage > 0.2 && Math.abs(h.vc) > 0.05 ? 1 : !h.stick && Math.abs(h.vs - h.vu) > 0.05 && inMR ? 0.5 : 0;
    this.scrG.gain.setTargetAtTime(screech * 0.25, t, 0.02);
  }
}
