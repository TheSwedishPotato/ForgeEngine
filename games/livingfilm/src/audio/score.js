/**
 * The score and the sound of each place, made in the browser (WebAudio),
 * nothing recorded, nothing loaded.
 *
 * Music follows the mood in the manner of the late Middle Ages and the
 * early Renaissance: a drone (an organetto or a hurdy-gurdy's drone
 * strings) under a modal melody on a plucked lute or a recorder, in the
 * church modes (Dorian for the melancholy and the tender, Mixolydian for
 * joy, Phrygian for the grim and the eerie, Aeolian for the tense),
 * phrases of eight, answered and varied; a frame drum when the place is
 * busy or glad. Each scene gets its own tune, seeded by the place.
 *
 * Ambience follows the place, the hour and the weather: a fire's crackle
 * and the murmur of a room indoors; wind, birds by day and crickets or an
 * owl by night outdoors; water by a river or the shore; the bell of a
 * church now and then over a town; rain and storm when it rains.
 */

const MODES = {
  dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
};
const MOOD = {
  warm: { mode: 'mixolydian', root: 50, bpm: 76, inst: 'lute', drum: 0, density: 0.75 },
  joyful: { mode: 'mixolydian', root: 52, bpm: 104, inst: 'recorder', drum: 1, density: 0.9 },
  bustling: { mode: 'mixolydian', root: 50, bpm: 112, inst: 'lute', drum: 1, density: 0.9 },
  tender: { mode: 'dorian', root: 50, bpm: 62, inst: 'recorder', drum: 0, density: 0.55 },
  melancholy: { mode: 'dorian', root: 45, bpm: 58, inst: 'lute', drum: 0, density: 0.5 },
  quiet: { mode: 'dorian', root: 48, bpm: 60, inst: 'lute', drum: 0, density: 0.35 },
  sacred: { mode: 'lydian', root: 48, bpm: 50, inst: 'voice', drum: 0, density: 0.45 },
  tense: { mode: 'aeolian', root: 45, bpm: 84, inst: 'lute', drum: 0.5, density: 0.6 },
  grim: { mode: 'phrygian', root: 41, bpm: 54, inst: 'voice', drum: 0.3, density: 0.4 },
  eerie: { mode: 'phrygian', root: 47, bpm: 46, inst: 'recorder', drum: 0, density: 0.3 },
};
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function rng(seed) {
  let s = [...String(seed)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 9) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export class Score {
  constructor() {
    this.ctx = null; this.on = true; this.musicOn = true; this.ambOn = true;
    this.mood = null; this.place = null; this.timer = null; this.amb = [];
  }

  /** Must be called from a click (browsers start sound only after the viewer acts). */
  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.on ? 0.9 : 0; this.master.connect(c.destination);
    this.music = c.createGain(); this.music.gain.value = 0.32;
    this.ambBus = c.createGain(); this.ambBus.gain.value = 0.55;
    // a small room for everything: a feedback delay network as reverb
    this.verb = this._reverb(2.4);
    this.music.connect(this.master); this.music.connect(this.verb.input);
    this.ambBus.connect(this.master);
    this.verb.output.connect(this.master);
    this.noise = this._noiseBuffer();
    if (this.pending) { const p = this.pending; this.pending = null; this.set(p); }
  }

  setEnabled(on) { this.on = on; if (this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.3); }

  /** The scene now: { mood, place (type), time, weather, indoor, seed }. */
  set(s) {
    if (!this.ctx) { this.pending = s; return; }
    const key = `${s.mood}|${s.seed}`;
    if (key !== this.musicKey) { this.musicKey = key; this._music(s); }
    const ak = `${s.place}|${s.time}|${s.weather}|${s.indoor}`;
    if (ak !== this.ambKey) { this.ambKey = ak; this._ambience(s); }
  }

  /** A sting for a turn of fortune: a low swell for a hard failure, a bright chord for a clean success. */
  sting(kind) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const notes = kind === 'good' ? [62, 66, 69, 74] : kind === 'bad' ? [38, 45, 50, 51] : [50, 57, 62];
    for (const [i, m] of notes.entries()) this._tone(hz(m), t + i * 0.04, 2.6, kind === 'bad' ? 'sawtooth' : 'triangle', 0.05, kind === 'bad' ? 500 : 2400, this.music);
  }

  // --- music -----------------------------------------------------------------------------------------

  _music(s) {
    clearTimeout(this.timer);
    for (const n of this.drone ?? []) { try { n.g.gain.setTargetAtTime(0, this.ctx.currentTime, 1.2); n.o.stop(this.ctx.currentTime + 5); } catch { /* done */ } }
    this.drone = [];
    const M = MOOD[s.mood] ?? MOOD.quiet;
    const R = rng(s.seed ?? s.mood);
    const scale = MODES[M.mode];
    const root = M.root + Math.floor(R() * 3) - 1;
    const c = this.ctx, t0 = c.currentTime + 0.4;
    // the drone: root and fifth, slowly breathing
    for (const m of [root - 12, root - 5]) {
      const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = (R() - 0.5) * 8;
      f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.7;
      g.gain.value = 0; g.gain.setTargetAtTime(M.inst === 'voice' ? 0.05 : 0.032, t0, 2.5);
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.07 + R() * 0.05; lg.gain.value = 0.012; lfo.connect(lg); lg.connect(g.gain); lfo.start(t0);
      o.connect(f); f.connect(g); g.connect(this.music); o.start(t0);
      this.drone.push({ o, g }, { o: lfo, g: lg });
    }
    // the tune: a phrase of eight walked on the mode, then answered, varied, repeated
    const deg = (d) => root + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7];
    const phrase = () => { let d = Math.floor(R() * 3); const out = []; for (let i = 0; i < 8; i++) { d += [-2, -1, -1, 0, 1, 1, 2, 3][Math.floor(R() * 8)]; d = Math.max(-2, Math.min(9, d)); out.push(i === 7 ? (R() < 0.6 ? 0 : 4) : d); } return out; };
    const A = phrase(), B = phrase(), song = [A, B, A, B.map((d, i) => (i === 7 ? 0 : d + (R() < 0.3 ? 1 : 0)))];
    const rhythms = [[1, 1, 1, 1, 1, 1, 1, 1], [1.5, 0.5, 1, 1, 1.5, 0.5, 1, 1], [2, 1, 1, 1, 1, 1, 1], [1, 0.5, 0.5, 1, 1, 1, 1, 2]];
    const beat = 60 / M.bpm;
    let section = 0;
    const play = () => {
      if (!this.ctx || this.musicKey !== `${s.mood}|${s.seed}`) return;
      const t = this.ctx.currentTime + 0.05;
      const ph = song[section % song.length], rh = rhythms[Math.floor(R() * rhythms.length)];
      let at = t;
      const rest = section % 8 === 7;        // breathe every so often
      if (!rest && this.musicOn) {
        for (let i = 0; i < ph.length; i++) {
          const d = rh[i % rh.length] * beat;
          if (R() < M.density + 0.15) this._note(M.inst, hz(deg(ph[i]) + 12), at, d);
          if (M.drum && (i % 4 === 0 || (M.drum > 0.6 && i % 2 === 0))) this._drum(at, i % 4 === 0 ? 1 : 0.5);
          at += d;
        }
      } else at += 8 * beat;
      section++;
      this.timer = setTimeout(play, (at - this.ctx.currentTime - 0.1) * 1000);
    };
    this.timer = setTimeout(play, 1800);
  }

  _note(inst, f, t, d) {
    const c = this.ctx;
    if (inst === 'lute') {
      // plucked: a bright attack falling fast, two slightly detuned strings (a course)
      for (const det of [-3, 3]) this._tone(f, t, Math.min(2.2, d * 2.5), 'triangle', 0.06, 2600, this.music, 0.004, det, 'pluck');
    } else if (inst === 'recorder') {
      this._tone(f, t, d * 0.95, 'sine', 0.05, 3000, this.music, 0.05, 0, 'breath');
      // a little breath noise at the start
      const n = c.createBufferSource(), bf = c.createBiquadFilter(), g = c.createGain();
      n.buffer = this.noise; bf.type = 'bandpass'; bf.frequency.value = f * 2; bf.Q.value = 3; g.gain.setValueAtTime(0.012, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      n.connect(bf); bf.connect(g); g.connect(this.music); n.start(t, Math.random()); n.stop(t + 0.15);
    } else {
      // voices: a soft vowel, two partials, slow attack
      this._tone(f / 2, t, d * 1.1, 'sawtooth', 0.025, 900, this.music, 0.25, 0, 'breath');
      this._tone(f, t, d * 1.1, 'sine', 0.02, 2000, this.music, 0.25, 5, 'breath');
    }
  }

  _tone(f, t, d, type, vol, cutoff, dest, attack = 0.01, detune = 0, env = 'pluck') {
    const c = this.ctx, o = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain();
    o.type = type; o.frequency.value = f; o.detune.value = detune;
    fl.type = 'lowpass'; fl.frequency.setValueAtTime(cutoff, t); if (env === 'pluck') fl.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.25), t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack);
    if (env === 'pluck') g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    else { g.gain.setValueAtTime(vol, t + Math.max(attack, d - 0.12)); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25); }
    if (env === 'breath') { const v = c.createOscillator(), vg = c.createGain(); v.frequency.value = 5.2; vg.gain.value = f * 0.006; v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + d + 0.3); }
    o.connect(fl); fl.connect(g); g.connect(dest); o.start(t); o.stop(t + d + 0.35);
  }

  _drum(t, v) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12 * v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(this.music); o.start(t); o.stop(t + 0.35);
    const n = c.createBufferSource(), f = c.createBiquadFilter(), ng = c.createGain();
    n.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = 1800; ng.gain.setValueAtTime(0.03 * v, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    n.connect(f); f.connect(ng); ng.connect(this.music); n.start(t, Math.random()); n.stop(t + 0.1);
  }

  // --- ambience --------------------------------------------------------------------------------------

  _ambience(s) {
    const c = this.ctx, now = c.currentTime;
    for (const a of this.amb) { try { a.g.gain.setTargetAtTime(0, now, 0.8); setTimeout(() => a.stop(), 4000); } catch { /* gone */ } }
    this.amb = [];
    if (!this.ambOn) return;
    const P = s.place, night = s.time === 'night', out = !s.indoor;
    const wet = s.weather === 'rain' || s.weather === 'storm';
    if (wet) this.amb.push(this._bed('rain', s.indoor ? 0.08 : 0.2, s.indoor ? 900 : 2600, 0.6));
    if (s.weather === 'storm' || s.weather === 'wind' || (out && ['hilltop', 'field', 'road', 'shore', 'castle', 'bridge'].includes(P))) this.amb.push(this._wind(s.weather === 'storm' ? 0.16 : 0.07));
    if (['river', 'bridge', 'shore', 'ship'].includes(P)) this.amb.push(this._water(P === 'shore' || P === 'ship' ? 0.16 : 0.09, P === 'shore' || P === 'ship'));
    if (s.indoor && ['tavern', 'hall', 'kitchen', 'cottage', 'workshop', 'chamber'].includes(P)) this.amb.push(this._fire(P === 'workshop' ? 0.09 : 0.05));
    if (['tavern', 'market', 'square', 'hall'].includes(P) || (P === 'street' && !night)) this.amb.push(this._crowd(P === 'market' || P === 'square' ? 0.07 : P === 'tavern' ? 0.06 : 0.03));
    if (out && !night && !wet && ['forest', 'field', 'garden', 'road', 'hilltop', 'graveyard', 'river', 'courtyard', 'street'].includes(P)) this.amb.push(this._birds(P === 'forest' || P === 'garden' ? 1 : 0.5));
    if (out && night && !wet) this.amb.push(this._night());
    if (['street', 'square', 'market', 'courtyard', 'graveyard', 'church'].includes(P)) this.amb.push(this._bells(P === 'church' ? 0.05 : 0.025));
    if (P === 'church' || P === 'cave' || P === 'cellar' || P === 'dungeon') this.amb.push(this._bed('room', 0.03, 300, 0.2));
    if (P === 'workshop') this.amb.push(this._clinks());
  }

  _src(gainV) {
    const c = this.ctx, g = c.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(gainV, c.currentTime + 0.2, 1.5); g.connect(this.ambBus);
    const nodes = []; let timer = null;
    return { g, nodes, set timer(t) { timer = t; }, stop: () => { clearTimeout(timer); clearInterval(timer); for (const n of nodes) try { n.stop(); } catch { /* */ } try { g.disconnect(); } catch { /* */ } } };
  }

  _loopNoise(a, type, freq, q = 0.7) {
    const c = this.ctx, n = c.createBufferSource(), f = c.createBiquadFilter();
    n.buffer = this.noise; n.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q;
    n.connect(f); f.connect(a.g); n.start(c.currentTime, Math.random() * 2); a.nodes.push(n);
    return f;
  }

  _bed(kind, v, freq, q) { const a = this._src(v); this._loopNoise(a, kind === 'rain' ? 'highpass' : 'lowpass', freq, q); if (kind === 'rain') this._loopNoise(a, 'lowpass', 500, 0.5); return a; }

  _wind(v) {
    const a = this._src(v), f = this._loopNoise(a, 'bandpass', 380, 0.8), c = this.ctx;
    const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 0.09; lg.gain.value = 220; l.connect(lg); lg.connect(f.frequency); l.start(); a.nodes.push(l);
    return a;
  }

  _water(v, waves) {
    const a = this._src(v), c = this.ctx, f = this._loopNoise(a, 'lowpass', waves ? 700 : 1300, 0.6);
    if (waves) { const l = c.createOscillator(), lg = c.createGain(), amp = c.createGain(); l.frequency.value = 0.12; lg.gain.value = 0.5; amp.gain.value = 0.6; f.disconnect(); f.connect(amp); amp.connect(a.g); l.connect(lg); lg.connect(amp.gain); l.start(); a.nodes.push(l); }
    return a;
  }

  _fire(v) {
    const a = this._src(1), c = this.ctx;
    const base = this._loopNoise(a, 'lowpass', 260, 0.5); const bg = c.createGain(); bg.gain.value = v * 0.5; base.disconnect(); base.connect(bg); bg.connect(a.g);
    const crack = () => {
      const t = c.currentTime;
      for (let i = 0; i < 1 + Math.floor(Math.random() * 3); i++) {
        const n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), at = t + Math.random() * 0.3;
        n.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = 1500 + Math.random() * 3000; f.Q.value = 2;
        g.gain.setValueAtTime(v * (0.6 + Math.random()), at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.02 + Math.random() * 0.04);
        n.connect(f); f.connect(g); g.connect(a.g); n.start(at, Math.random()); n.stop(at + 0.08);
      }
      a.timer = setTimeout(crack, 120 + Math.random() * 700);
    };
    crack();
    return a;
  }

  _crowd(v) {
    // voices without words: formant bands of noise, each swelling and falling like someone talking
    const a = this._src(v), c = this.ctx;
    for (const [f0, rate] of [[480, 0.7], [820, 1.1], [1250, 0.9], [650, 1.4], [1050, 0.6]]) {
      const n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), l = c.createOscillator(), lg = c.createGain();
      n.buffer = this.noise; n.loop = true; f.type = 'bandpass'; f.frequency.value = f0; f.Q.value = 6;
      g.gain.value = 0.35; l.frequency.value = rate * (0.6 + Math.random() * 0.8); lg.gain.value = 0.35; l.connect(lg); lg.connect(g.gain);
      n.connect(f); f.connect(g); g.connect(a.g); n.start(c.currentTime, Math.random() * 2); l.start(); a.nodes.push(n, l);
    }
    // now and then a laugh or a called word
    const call = () => { const t = c.currentTime; this._tone(220 + Math.random() * 180, t, 0.25 + Math.random() * 0.3, 'sawtooth', v * 0.25, 900, a.g, 0.03, 0, 'breath'); a.timer = setTimeout(call, 2500 + Math.random() * 7000); };
    a.timer = setTimeout(call, 2000);
    return a;
  }

  _birds(k) {
    const a = this._src(0.05 * k + 0.02), c = this.ctx;
    const sing = () => {
      const t = c.currentTime, n = 2 + Math.floor(Math.random() * 6), f0 = 2200 + Math.random() * 2400;
      for (let i = 0; i < n; i++) {
        const o = c.createOscillator(), g = c.createGain(), at = t + i * (0.08 + Math.random() * 0.06);
        o.frequency.setValueAtTime(f0 * (0.9 + Math.random() * 0.3), at); o.frequency.exponentialRampToValueAtTime(f0 * (0.7 + Math.random() * 0.8), at + 0.06);
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.5, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
        o.connect(g); g.connect(a.g); o.start(at); o.stop(at + 0.09);
      }
      a.timer = setTimeout(sing, 1200 + Math.random() * 5000 / k);
    };
    sing();
    return a;
  }

  _night() {
    const a = this._src(0.03), c = this.ctx;
    const o = c.createOscillator(), g = c.createGain(), l = c.createOscillator(), lg = c.createGain();
    o.frequency.value = 4300; g.gain.value = 0.25; l.type = 'square'; l.frequency.value = 18; lg.gain.value = 0.25; l.connect(lg); lg.connect(g.gain);
    o.connect(g); g.connect(a.g); o.start(); l.start(); a.nodes.push(o, l);
    const owl = () => { const t = c.currentTime; for (const [i, d] of [[0, 0.35], [0.6, 0.18], [0.85, 0.5]]) this._tone(380 - i * 20, t + i, d, 'sine', 0.25, 800, a.g, 0.05, 0, 'breath'); a.timer = setTimeout(owl, 9000 + Math.random() * 14000); };
    a.timer = setTimeout(owl, 4000);
    return a;
  }

  _bells(v) {
    const a = this._src(1), c = this.ctx;
    const toll = () => {
      const t = c.currentTime, n = 1 + Math.floor(Math.random() * 4), f = 196 + Math.random() * 40;
      for (let i = 0; i < n; i++) for (const [m, vol] of [[1, 1], [2.4, 0.5], [3.0, 0.35], [4.2, 0.2], [0.5, 0.4]]) this._tone(f * m, t + i * 2.2, 5, 'sine', v * vol, 6000, a.g, 0.005);
      a.timer = setTimeout(toll, 25000 + Math.random() * 40000);
    };
    a.timer = setTimeout(toll, 3000 + Math.random() * 8000);
    return a;
  }

  _clinks() {
    const a = this._src(0.05), c = this.ctx;
    const tap = () => { const t = c.currentTime; for (const m of [1, 2.76, 5.4]) this._tone(1400 * m, t, 0.4, 'sine', 0.3 / m, 9000, a.g, 0.002); a.timer = setTimeout(tap, 900 + Math.random() * 2400); };
    tap();
    return a;
  }

  // --- plumbing --------------------------------------------------------------------------------------

  _noiseBuffer() {
    const c = this.ctx, b = c.createBuffer(1, c.sampleRate * 3, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = 0.97 * last + 0.03 * w; d[i] = w * 0.6 + last * 2.2; }
    return b;
  }

  _reverb(seconds) {
    const c = this.ctx, input = c.createGain(), output = c.createGain();
    const len = c.sampleRate * seconds, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    const conv = c.createConvolver(); conv.buffer = ir; output.gain.value = 0.35;
    input.connect(conv); conv.connect(output);
    return { input, output };
  }
}
