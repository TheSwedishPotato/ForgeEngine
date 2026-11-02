/**
 * Sound, synthesised (WebAudio): the engine is its firing events from the simulation, each a thump
 * of exhaust through a silencer-shaped filter, so a misfiring cylinder is a missing beat you can hear
 * before any scan tool tells you. The starter's whine while cranking. The ratchet's clicks for every
 * few degrees you turn it, the impact gun's hammer, the torque wrench's click, the air line's hiss,
 * the bang of something giving way.
 */
export class Sound {
  constructor(game) { this.game = game; this.ctx = null; this.simT = null; }

  attach(target) {
    const go = () => {
      if (this.ctx) return;
      const C = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
      this.master = C.createGain(); this.master.gain.value = 0.6; this.master.connect(C.destination);
      // the exhaust: a low-pass and a resonance like a silencer's
      this.exLP = C.createBiquadFilter(); this.exLP.type = 'lowpass'; this.exLP.frequency.value = 420; this.exLP.Q.value = 2.5;
      this.exGain = C.createGain(); this.exGain.gain.value = 0.9;
      this.exLP.connect(this.exGain).connect(this.master);
      const n = C.sampleRate * 0.06;
      this.puff = C.createBuffer(1, n, C.sampleRate);
      const d = this.puff.getChannelData(0);
      for (let i = 0; i < n; i++) { const t = i / C.sampleRate; d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 70) * 0.6 + Math.sin(t * 2 * Math.PI * 70) * Math.exp(-t * 45); }
      this.noise = C.createBuffer(1, C.sampleRate, C.sampleRate);
      const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      // the starter
      this.st = C.createOscillator(); this.st.type = 'sawtooth'; this.st.frequency.value = 90;
      this.stG = C.createGain(); this.stG.gain.value = 0;
      this.st.connect(this.stG).connect(this.master); this.st.start();
    };
    for (const ev of ['pointerdown', 'keydown']) target.addEventListener(ev, go, { once: false });
  }

  _burst(dur, f, q = 1, gain = 0.3, type = 'bandpass', at = 0) {
    const C = this.ctx; if (!C) return;
    const s = C.createBufferSource(); s.buffer = this.noise;
    const fl = C.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = C.createGain(); const t = C.currentTime + at;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.master); s.start(t, Math.random() * 0.5, dur + 0.02);
  }

  click() { this._burst(0.04, 3200, 4, 0.5); this._burst(0.03, 1200, 3, 0.25, 'bandpass', 0.01); }
  clunk() { this._burst(0.12, 300, 2, 0.6); }
  bang() { this._burst(0.5, 120, 1, 1.0, 'lowpass'); this._burst(0.25, 2400, 1, 0.4); }
  hiss() { if (!this._hissT || performance.now() - this._hissT > 120) { this._hissT = performance.now(); this._burst(0.14, 5000, 0.7, 0.08, 'highpass'); } }
  turn(tool, deg) {
    if (!this.ctx) return;
    if (tool.power) { if (!this._impT || performance.now() - this._impT > 60) { this._impT = performance.now(); this._burst(0.05, 900, 1.5, 0.35); this._burst(0.03, 2600, 2, 0.2); } return; }
    this._ratchet = (this._ratchet ?? 0) + deg;
    while (this._ratchet > 6) { this._ratchet -= 6; this._burst(0.015, 4200, 6, 0.12); }
  }

  update() {
    const g = this.game, C = this.ctx;
    if (!C || !g.cust) return;
    const E = g.cust.S.E;
    const evs = E.drainEvents();
    // place each firing at its moment, a little behind real time so none is late
    if (this.simT == null || Math.abs(E.time - this.simT - (C.currentTime - this.ctxT)) > 0.3) { this.simT = E.time; this.ctxT = C.currentTime; }
    const cam = g.stage.camera.position, car = g.carGL?.root.position;
    const dist = car ? Math.max(1, Math.hypot(cam.x - car.x, cam.z - car.z)) : 5;
    const vol = Math.min(1, 3 / dist);
    for (const e of evs) {
      const at = this.ctxT + (e.t - this.simT) + 0.06;
      if (at < C.currentTime) continue;
      const s = C.createBufferSource(); s.buffer = this.puff; s.playbackRate.value = 0.8 + Math.min(1.5, e.rpm / 4000);
      const gg = C.createGain(); gg.gain.value = (e.fired ? 0.5 + e.s * 0.6 : 0.08) * vol;
      s.connect(gg).connect(this.exLP); s.start(at);
    }
    this.exLP.frequency.value = 300 + Math.min(2500, E.rpm * 0.35);
    this.stG.gain.value = E.starterAmps > 0 ? 0.05 * vol : 0;
    this.st.frequency.value = 60 + E.rpm * 0.6;
  }
}
