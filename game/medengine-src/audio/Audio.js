/**
 * Med Engine 2 sound: everything synthesised in the browser with WebAudio, no files.
 *
 *   ambience  layered beds that cross-fade per scene: rain (hiss, drops, gutters), wind,
 *             city (traffic rumble, distant sirens), harbour (swell, hull knocks, foghorn),
 *             garage (fluorescent hum, drips), storm (thunder, triggered with lightning)
 *   sfx       impacts, gunshots, batarang, grapple, glide, cape snap, footsteps, splash,
 *             metal, body fall, heartbeat, UI ticks
 *   score     a generative noir score: low drones and string-like pads in D minor, a pulse
 *             that rises with `intensity`, stingers for reveals
 *   space     a convolution reverb whose impulse is generated per place (concrete garage,
 *             open roof, steel deck)
 *   voices    optional speech through the browser's speech engine, per-character pitch/rate
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.beds = {};
    this.volume = { master: 0.9, music: 0.55, ambience: 0.8, sfx: 0.9, voice: 1 };
    this.voices = false;
    this._voiceList = [];
  }

  /** Must be called from a user gesture (browsers start audio only then). */
  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume.master;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);
    this.musicBus = this._bus(this.volume.music, 0.25);
    this.ambBus = this._bus(this.volume.ambience, 0.15);
    this.sfxBus = this._bus(this.volume.sfx, 0.4);
    this.noise = this._noiseBuffer(4);
    this.space('open');
    if ('speechSynthesis' in window) {
      const load = () => { this._voiceList = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); };
      load(); speechSynthesis.onvoiceschanged = load;
    }
  }

  _bus(vol, send) {
    const g = this.ctx.createGain(); g.gain.value = vol; g.connect(this.master);
    const s = this.ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(this.reverb);
    return g;
  }

  _noiseBuffer(sec, color = 'white') {
    const ctx = this.ctx, n = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
      }
    }
    return b;
  }

  /** The room: 'garage' (long concrete), 'open' (rooftops), 'deck' (steel ship), 'street'. */
  space(kind) {
    if (!this.ctx) return;
    const P = { garage: [2.8, 2.2, 0.55], open: [1.2, 3.5, 0.25], deck: [1.6, 2.6, 0.35], street: [1.6, 3.0, 0.3], cave: [4, 1.6, 0.6] }[kind] ?? [1.4, 3, 0.3];
    const [sec, decay, wet] = P;
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
    }
    this.reverb.buffer = b;
    this.reverbGain.gain.setTargetAtTime(wet, ctx.currentTime, 0.3);
    this.currentSpace = kind;
  }

  // ---------------------------------------------------------------------------
  // Ambience beds

  _loopNoise(filterType, freq, q, gain, bus = this.ambBus) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(bus);
    src.start();
    g.gain.setTargetAtTime(gain, ctx.currentTime, 1.2);
    return { src, f, g };
  }

  /** Sets the ambience: { rain: 0..1, wind, city, harbour, garage, engine } (cross-fades). */
  ambience(levels, fade = 2) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const want = { rain: 0, wind: 0, city: 0, harbour: 0, garage: 0, engine: 0, ...levels };
    for (const [k, v] of Object.entries(want)) {
      let bed = this.beds[k];
      if (!bed && v > 0) bed = this.beds[k] = this._makeBed(k);
      if (!bed) continue;
      bed.level = v;
      for (const p of bed.parts) p.g.gain.setTargetAtTime(v * p.base, now, fade / 3);
    }
  }

  _makeBed(kind) {
    const ctx = this.ctx;
    const parts = [];
    const add = (p, base) => { p.base = base; p.g.gain.value = 0; parts.push(p); return p; };
    if (kind === 'rain') {
      add(this._loopNoise('highpass', 900, 0.4, 0), 0.32);
      add(this._loopNoise('bandpass', 3500, 0.6, 0), 0.2);
      add(this._loopNoise('lowpass', 380, 0.5, 0), 0.25);     // gutters and runoff
      // individual drops on near surfaces
      const bed = { parts, drops: setInterval(() => { if ((this.beds.rain?.level ?? 0) > 0.05) this._drop(this.beds.rain.level); }, 45) };
      return bed;
    }
    if (kind === 'wind') {
      const p = add(this._loopNoise('bandpass', 420, 1.2, 0), 0.45);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
      const lg = ctx.createGain(); lg.gain.value = 260; lfo.connect(lg).connect(p.f.frequency); lfo.start();
      add(this._loopNoise('lowpass', 160, 0.3, 0), 0.3);
    }
    if (kind === 'city') {
      add(this._loopNoise('lowpass', 120, 0.7, 0), 0.55);
      add(this._loopNoise('bandpass', 700, 0.4, 0), 0.06);
      const bed = { parts, sirens: setInterval(() => { if ((this.beds.city?.level ?? 0) > 0.1 && Math.random() < 0.25) this.siren(0.15 * this.beds.city.level); }, 9000) };
      return bed;
    }
    if (kind === 'harbour') {
      const p = add(this._loopNoise('lowpass', 300, 0.7, 0), 0.6);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12;
      const lg = ctx.createGain(); lg.gain.value = 0.35; lfo.connect(lg).connect(p.g.gain); lfo.start();
      add(this._loopNoise('bandpass', 1200, 0.5, 0), 0.12);
      const bed = { parts, horn: setInterval(() => { if ((this.beds.harbour?.level ?? 0) > 0.2 && Math.random() < 0.3) this.foghorn(0.25); }, 14000) };
      return bed;
    }
    if (kind === 'garage') {
      for (const [f, a] of [[60, 0.05], [120, 0.04], [180, 0.015], [240, 0.008]]) {
        const o = ctx.createOscillator(); o.frequency.value = f; o.type = 'sine';
        const g = ctx.createGain(); g.gain.value = 0; o.connect(g).connect(this.ambBus); o.start();
        add({ g }, a);
      }
      add(this._loopNoise('lowpass', 90, 0.4, 0), 0.25);
      const bed = { parts, drips: setInterval(() => { if ((this.beds.garage?.level ?? 0) > 0.1 && Math.random() < 0.5) this.drip(); }, 1300) };
      return bed;
    }
    if (kind === 'engine') {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 42;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(f).connect(g).connect(this.ambBus); o.start();
      const p = add({ g, o, f }, 0.25);
      add(this._loopNoise('bandpass', 180, 0.8, 0), 0.25);
      this.engineNode = p;
    }
    return { parts };
  }

  /** Engine revs (0..1) for the boat. */
  engineLoad(x) { if (this.engineNode) { this.engineNode.o.frequency.setTargetAtTime(38 + x * 60, this.ctx.currentTime, 0.2); this.engineNode.f.frequency.setTargetAtTime(250 + x * 700, this.ctx.currentTime, 0.2); } }

  // ---------------------------------------------------------------------------
  // One-shots

  _burst({ freq = 1000, q = 1, type = 'bandpass', dur = 0.2, gain = 0.5, attack = 0.002, bus = this.sfxBus, rate = 1, pan = 0, decay = 3 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.setTargetAtTime(0, t + attack, dur / decay);
    const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pn) { pn.pan.value = pan; src.connect(f).connect(g).connect(pn).connect(bus); } else src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 3); src.stop(t + dur * 2 + 0.1);
    return { f, g };
  }
  _tone({ freq = 100, to = null, type = 'sine', dur = 0.3, gain = 0.4, bus = this.sfxBus, attack = 0.005 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }

  _drop(level) { this._burst({ freq: 2500 + Math.random() * 4000, q: 4, dur: 0.03, gain: 0.04 * level * Math.random(), pan: Math.random() * 2 - 1, bus: this.ambBus }); }
  drip() { this._tone({ freq: 1400 + Math.random() * 900, to: 600, dur: 0.12, gain: 0.05, bus: this.ambBus }); }

  sfx(name, o = {}) {
    if (!this.ctx) return;
    const v = o.volume ?? 1;
    switch (name) {
      case 'punch': this._burst({ freq: 180, q: 0.8, type: 'lowpass', dur: 0.18, gain: 0.9 * v }); this._tone({ freq: 90, to: 40, dur: 0.18, gain: 0.7 * v }); this._burst({ freq: 2500, q: 1, dur: 0.05, gain: 0.25 * v }); break;
      case 'kick': this._burst({ freq: 140, q: 0.7, type: 'lowpass', dur: 0.25, gain: 1.0 * v }); this._tone({ freq: 70, to: 35, dur: 0.25, gain: 0.8 * v }); break;
      case 'block': this._burst({ freq: 900, q: 2, dur: 0.08, gain: 0.5 * v }); this._tone({ freq: 220, to: 120, dur: 0.1, gain: 0.3 * v }); break;
      case 'whoosh': { const b = this._burst({ freq: 400, q: 1.2, dur: 0.35, gain: 0.35 * v, attack: 0.08 }); b?.f.frequency.exponentialRampToValueAtTime(2200, this.ctx.currentTime + 0.3); break; }
      case 'cape': this._burst({ freq: 300, q: 0.6, type: 'lowpass', dur: 0.3, gain: 0.5 * v, attack: 0.04 }); break;
      case 'gunshot': this._burst({ freq: 1800, q: 0.4, type: 'highpass', dur: 0.12, gain: 1.2 * v }); this._burst({ freq: 300, q: 0.5, type: 'lowpass', dur: 0.9, gain: 1.1 * v, decay: 5 }); this._tone({ freq: 120, to: 40, dur: 0.3, gain: 0.8 * v }); break;
      case 'click': this._burst({ freq: 4000, q: 3, dur: 0.02, gain: 0.25 * v }); break;
      case 'batarang': { const b = this._burst({ freq: 1500, q: 6, dur: 0.6, gain: 0.25 * v, attack: 0.05 }); b?.f.frequency.linearRampToValueAtTime(600, this.ctx.currentTime + 0.5); break; }
      case 'clang': for (const f of [520, 1310, 2100]) this._tone({ freq: f, dur: 0.9, gain: 0.18 * v, type: 'triangle' }); this._burst({ freq: 3000, q: 2, dur: 0.06, gain: 0.4 * v }); break;
      case 'grapple': this._burst({ freq: 2200, q: 8, dur: 0.5, gain: 0.25 * v }); this._tone({ freq: 900, to: 300, dur: 0.4, gain: 0.15 * v, type: 'sawtooth' }); break;
      case 'land': this._burst({ freq: 120, q: 0.6, type: 'lowpass', dur: 0.4, gain: 0.9 * v }); this._burst({ freq: 3000, q: 0.6, type: 'highpass', dur: 0.15, gain: 0.25 * v }); break;
      case 'step': this._burst({ freq: 600 + Math.random() * 300, q: 1.5, dur: 0.07, gain: 0.12 * v }); this._burst({ freq: 3500, q: 1, dur: 0.04, gain: 0.05 * v }); break;
      case 'fall': this._burst({ freq: 100, q: 0.5, type: 'lowpass', dur: 0.5, gain: 1.0 * v }); this._tone({ freq: 60, to: 30, dur: 0.4, gain: 0.6 * v }); break;
      case 'splash': this._burst({ freq: 900, q: 0.5, dur: 1.2, gain: 0.7 * v, attack: 0.02, decay: 4 }); this._burst({ freq: 200, q: 0.5, type: 'lowpass', dur: 0.6, gain: 0.6 * v }); break;
      case 'glass': for (let i = 0; i < 8; i++) setTimeout(() => this._tone({ freq: 2500 + Math.random() * 4000, dur: 0.3, gain: 0.08 * v, type: 'triangle' }), i * 25); break;
      case 'zip': this._burst({ freq: 3000, q: 4, dur: 0.25, gain: 0.2 * v, attack: 0.1 }); break;
      case 'heartbeat': this._tone({ freq: 55, to: 40, dur: 0.15, gain: 0.6 * v }); setTimeout(() => this._tone({ freq: 50, to: 38, dur: 0.18, gain: 0.45 * v }), 180); break;
      case 'tick': this._tone({ freq: 1800, dur: 0.04, gain: 0.08 * v, type: 'square' }); break;
      case 'choice': this._tone({ freq: 660, to: 880, dur: 0.18, gain: 0.12 * v, type: 'triangle' }); break;
      case 'fail': this._tone({ freq: 220, to: 110, dur: 0.5, gain: 0.2 * v, type: 'sawtooth' }); break;
      case 'success': this._tone({ freq: 440, to: 660, dur: 0.25, gain: 0.12 * v, type: 'triangle' }); break;
      case 'radio': this._burst({ freq: 1800, q: 1.2, dur: 0.12, gain: 0.25 * v }); this._tone({ freq: 1200, dur: 0.06, gain: 0.08 * v, type: 'square' }); break;
      case 'door': this._burst({ freq: 200, q: 0.6, type: 'lowpass', dur: 0.6, gain: 0.7 * v }); this._tone({ freq: 140, to: 70, dur: 0.5, gain: 0.3 * v, type: 'triangle' }); break;
      case 'breaker': this._burst({ freq: 2500, q: 2, dur: 0.05, gain: 0.6 * v }); this._tone({ freq: 60, to: 20, dur: 0.6, gain: 0.5 * v, type: 'sawtooth' }); break;
      case 'hull': this._tone({ freq: 70, to: 45, dur: 0.8, gain: 0.5 * v, type: 'triangle' }); this._burst({ freq: 300, q: 0.6, type: 'lowpass', dur: 0.8, gain: 0.5 * v }); break;
      default: break;
    }
  }

  thunder(distance = 0.5) {
    if (!this.ctx) return;
    const delay = 0.3 + distance * 4;
    setTimeout(() => {
      const near = 1 - distance;
      this._burst({ freq: 2500, q: 0.3, type: 'highpass', dur: 0.25, gain: 0.4 * near * near });
      this._burst({ freq: 140, q: 0.4, type: 'lowpass', dur: 3.5 + distance * 3, gain: 1.0, attack: 0.05 + distance * 0.3, decay: 3, bus: this.ambBus });
      this._burst({ freq: 60, q: 0.4, type: 'lowpass', dur: 5, gain: 0.9, attack: 0.4, decay: 2.5, bus: this.ambBus });
    }, delay * 1000);
  }

  siren(gain = 0.15) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 1.5); g.gain.linearRampToValueAtTime(0, t + 7);
    for (let i = 0; i < 7; i++) { o.frequency.setValueAtTime(650, t + i); o.frequency.linearRampToValueAtTime(950, t + i + 0.5); o.frequency.linearRampToValueAtTime(650, t + i + 1); }
    o.connect(f).connect(g).connect(this.ambBus); o.start(t); o.stop(t + 7.2);
  }

  foghorn(gain = 0.3) {
    if (!this.ctx) return;
    for (const fq of [98, 98.7, 196]) this._tone({ freq: fq, dur: 3.2, gain: gain * (fq > 150 ? 0.3 : 1), type: 'sawtooth', attack: 0.4, bus: this.ambBus });
  }

  // ---------------------------------------------------------------------------
  // Score

  /** Starts (or retunes) the score. mood: 'dread' | 'tension' | 'action' | 'grief' | 'dawn' | 'off' */
  music(mood, intensity = 0.4) {
    if (!this.ctx) return;
    this.intensity = intensity;
    if (mood === this.mood) return;
    this.mood = mood;
    const ctx = this.ctx, now = ctx.currentTime;
    if (this.score) { const old = this.score; old.g.gain.setTargetAtTime(0, now, 1.5); setTimeout(() => { old.stop(); }, 6000); this.score = null; }
    if (mood === 'off') return;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(this.musicBus);
    g.gain.setTargetAtTime(1, now, 2);
    const nodes = [];
    const chords = {
      dread: [[38, 45, 50, 53], [36, 43, 48, 51], [34, 41, 46, 50], [33, 40, 45, 49]],
      tension: [[38, 45, 50, 53], [39, 46, 51, 54], [38, 45, 50, 53], [37, 44, 49, 52]],
      action: [[38, 45, 50, 57], [41, 48, 53, 57], [36, 43, 48, 55], [34, 41, 46, 53]],
      grief: [[38, 45, 50, 53], [34, 41, 46, 50], [31, 38, 43, 50], [33, 40, 45, 52]],
      dawn: [[38, 45, 50, 54], [43, 50, 55, 59], [40, 47, 52, 55], [45, 52, 57, 61]],
    }[mood] ?? [[38, 45, 50, 53]];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    // pad: four detuned saws per chord tone through a slow filter
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = mood === 'dawn' ? 1800 : 900; filt.Q.value = 0.6;
    filt.connect(g);
    const voices = chords[0].map((m) => {
      const vg = ctx.createGain(); vg.gain.value = 0.045; vg.connect(filt);
      const os = [-7, 0, 6].map((det) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m + 12); o.detune.value = det; o.connect(vg); o.start(); nodes.push(o); return o; });
      return { vg, os };
    });
    // drone
    const drone = ctx.createOscillator(); drone.type = 'sine'; drone.frequency.value = mtof(chords[0][0] - 12);
    const dg = ctx.createGain(); dg.gain.value = 0.18; drone.connect(dg).connect(g); drone.start(); nodes.push(drone);
    let ci = 0;
    const step = () => {
      ci = (ci + 1) % chords.length;
      const t = ctx.currentTime;
      chords[ci].forEach((m, k) => voices[k].os.forEach((o) => o.frequency.setTargetAtTime(mtof(m + 12), t, 0.8)));
      drone.frequency.setTargetAtTime(mtof(chords[ci][0] - 12), t, 1.2);
      filt.frequency.setTargetAtTime((mood === 'dawn' ? 1400 : 600) + (this.intensity ?? 0.4) * 1600, t, 1.5);
    };
    const chordTimer = setInterval(step, mood === 'action' ? 4000 : 8000);
    // pulse: muted low notes, louder and faster with intensity
    const pulseTimer = setInterval(() => {
      const I = this.intensity ?? 0.4;
      if (mood === 'dawn' || mood === 'grief') { if (Math.random() < 0.35) this._tone({ freq: mtof(chords[ci][Math.floor(Math.random() * 4)] + 24), dur: 2.2, gain: 0.05, type: 'triangle', bus: g, attack: 0.02 }); return; }
      if (Math.random() > 0.25 + I * 0.75) return;
      this._tone({ freq: mtof(chords[ci][0]), dur: 0.22, gain: 0.08 + I * 0.12, type: 'triangle', bus: g });
      if (I > 0.6 && Math.random() < 0.5) this._burst({ freq: 80, q: 0.8, type: 'lowpass', dur: 0.2, gain: 0.25 * I, bus: g });
    }, mood === 'action' ? 230 : 460);
    this.score = { g, stop: () => { clearInterval(chordTimer); clearInterval(pulseTimer); nodes.forEach((n) => { try { n.stop(); } catch { /* stopped */ } }); g.disconnect(); } };
  }

  setIntensity(x) { this.intensity = x; }

  sting(kind = 'reveal') {
    if (!this.ctx) return;
    if (kind === 'reveal') { for (const f of [73.4, 77.8, 110]) this._tone({ freq: f, dur: 3, gain: 0.25, type: 'sawtooth', bus: this.musicBus, attack: 0.02 }); this._burst({ freq: 60, q: 0.5, type: 'lowpass', dur: 2, gain: 0.8, bus: this.musicBus }); }
    if (kind === 'hit') { this._burst({ freq: 70, q: 0.5, type: 'lowpass', dur: 1.5, gain: 1, bus: this.musicBus }); this._tone({ freq: 55, to: 30, dur: 1.4, gain: 0.6, bus: this.musicBus }); }
    if (kind === 'title') { for (const f of [36.7, 73.4, 110, 146.8]) this._tone({ freq: f, dur: 6, gain: 0.18, type: 'sawtooth', bus: this.musicBus, attack: 1.5 }); }
  }

  // ---------------------------------------------------------------------------
  // Voices

  /** Speaks a line if voices are on. Calls onBoundary(charIndex) on word starts. Resolves when done. */
  speak(text, { pitch = 1, rate = 1, gender = 'm', radio = false, key = '' } = {}, onBoundary) {
    if (!this.voices || !('speechSynthesis' in window) || !this._voiceList.length) return null;
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const pref = this._voiceList.filter((v) => /natural|neural|google|premium|enhanced/i.test(v.name));
      const pool = pref.length ? pref : this._voiceList;
      const byGender = pool.filter((v) => (gender === 'f' ? /female|woman|zira|samantha|victoria|karen|moira|tessa|fiona|aria|jenny|sonia|libby/i : /male|man|david|daniel|alex|fred|george|guy|ryan|thomas/i).test(v.name));
      u.voice = (byGender.length ? byGender : pool)[Math.abs(hash(key || String(pitch))) % (byGender.length || pool.length)];
      u.pitch = pitch; u.rate = rate * 0.95; u.volume = radio ? 0.75 : 1;
      u.onboundary = (e) => onBoundary?.(e.charIndex);
      u.onend = () => resolve(); u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }
  stopSpeech() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
