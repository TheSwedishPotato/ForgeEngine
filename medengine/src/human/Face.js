/**
 * Med Engine 2 faces: emotion, blinking, eye movement and lip-sync on the 52 ARKit units.
 *
 * - Emotions are blends of units (FACS-style recipes); the face eases between them and adds
 *   a little life on top (breathing in the nostrils, asymmetry, micro-movement).
 * - Blinks follow human statistics (every 2-10 s, faster when tense, a double blink now and then)
 *   and are triggered by big gaze shifts, as real blinks are.
 * - Saccades: the eyes dart between fixation points on the face they look at.
 * - Lip-sync: text becomes a viseme track (a small rule-based grapheme-to-phoneme pass, English),
 *   each viseme a mouth shape on the units, timed to the line's duration or to the speech
 *   engine's word boundaries, with coarticulation (neighbouring shapes overlap).
 */

export const EMOTIONS = {
  neutral: {},
  calm: { mouthSmileLeft: 0.06, mouthSmileRight: 0.06, eyeSquintLeft: 0.08, eyeSquintRight: 0.08 },
  happy: { mouthSmileLeft: 0.6, mouthSmileRight: 0.55, cheekSquintLeft: 0.45, cheekSquintRight: 0.4, eyeSquintLeft: 0.3, eyeSquintRight: 0.3, mouthDimpleLeft: 0.2, mouthDimpleRight: 0.2 },
  smirk: { mouthSmileLeft: 0.45, mouthDimpleLeft: 0.3, cheekSquintLeft: 0.2, eyeSquintLeft: 0.15, browDownRight: 0.1 },
  sad: { browInnerUp: 0.7, mouthFrownLeft: 0.45, mouthFrownRight: 0.45, mouthShrugLower: 0.25, eyeLookDownLeft: 0.15, eyeLookDownRight: 0.15, eyeSquintLeft: 0.1, eyeSquintRight: 0.1 },
  afraid: { browInnerUp: 0.8, browOuterUpLeft: 0.4, browOuterUpRight: 0.4, eyeWideLeft: 0.75, eyeWideRight: 0.75, mouthStretchLeft: 0.4, mouthStretchRight: 0.4, jawOpen: 0.08 },
  angry: { browDownLeft: 0.8, browDownRight: 0.8, eyeSquintLeft: 0.4, eyeSquintRight: 0.4, noseSneerLeft: 0.35, noseSneerRight: 0.35, mouthPressLeft: 0.3, mouthPressRight: 0.3, jawForward: 0.15 },
  fury: { browDownLeft: 1, browDownRight: 1, eyeWideLeft: 0.3, eyeWideRight: 0.3, noseSneerLeft: 0.6, noseSneerRight: 0.6, mouthUpperUpLeft: 0.45, mouthUpperUpRight: 0.45, mouthStretchLeft: 0.3, mouthStretchRight: 0.3, jawForward: 0.2 },
  disgust: { noseSneerLeft: 0.7, noseSneerRight: 0.5, mouthUpperUpLeft: 0.5, mouthUpperUpRight: 0.3, browDownLeft: 0.4, browDownRight: 0.3, eyeSquintLeft: 0.3 },
  surprised: { browInnerUp: 0.75, browOuterUpLeft: 0.7, browOuterUpRight: 0.7, eyeWideLeft: 0.8, eyeWideRight: 0.8, jawOpen: 0.25 },
  determined: { browDownLeft: 0.45, browDownRight: 0.45, eyeSquintLeft: 0.25, eyeSquintRight: 0.25, mouthPressLeft: 0.35, mouthPressRight: 0.35, mouthClose: 0.1 },
  grim: { browDownLeft: 0.3, browDownRight: 0.3, mouthFrownLeft: 0.25, mouthFrownRight: 0.25, mouthPressLeft: 0.25, mouthPressRight: 0.25, eyeSquintLeft: 0.15, eyeSquintRight: 0.15 },
  pained: { browInnerUp: 0.6, browDownLeft: 0.4, browDownRight: 0.4, eyeSquintLeft: 0.6, eyeSquintRight: 0.6, mouthStretchLeft: 0.5, mouthStretchRight: 0.5, noseSneerLeft: 0.3, noseSneerRight: 0.3, jawOpen: 0.1 },
  desperate: { browInnerUp: 0.9, eyeWideLeft: 0.5, eyeWideRight: 0.5, mouthStretchLeft: 0.35, mouthStretchRight: 0.35, mouthFrownLeft: 0.3, mouthFrownRight: 0.3, jawOpen: 0.06 },
  contempt: { mouthSmileLeft: 0.3, mouthPressRight: 0.25, eyeSquintLeft: 0.2, eyeSquintRight: 0.25, browDownRight: 0.15, mouthDimpleLeft: 0.25 },
  cold: { eyeSquintLeft: 0.2, eyeSquintRight: 0.2, browDownLeft: 0.1, browDownRight: 0.1, mouthPressLeft: 0.12, mouthPressRight: 0.12 },
  worried: { browInnerUp: 0.55, mouthPressLeft: 0.2, mouthPressRight: 0.2, mouthFrownLeft: 0.15, mouthFrownRight: 0.15 },
  tired: { eyeBlinkLeft: 0.3, eyeBlinkRight: 0.3, browInnerUp: 0.2, mouthFrownLeft: 0.1, mouthFrownRight: 0.1 },
};

// Visemes as unit shapes (Oculus/ARKit-style set)
export const VISEMES = {
  sil: {},
  PP: { mouthClose: 0.55, mouthPressLeft: 0.35, mouthPressRight: 0.35, jawOpen: 0.02 },
  FF: { mouthRollLower: 0.5, mouthUpperUpLeft: 0.2, mouthUpperUpRight: 0.2, jawOpen: 0.08 },
  TH: { tongueOut: 0.35, jawOpen: 0.12 },
  DD: { jawOpen: 0.16, mouthStretchLeft: 0.1, mouthStretchRight: 0.1 },
  kk: { jawOpen: 0.2, mouthStretchLeft: 0.12, mouthStretchRight: 0.12 },
  CH: { mouthFunnel: 0.45, jawOpen: 0.12, mouthShrugUpper: 0.2 },
  SS: { jawOpen: 0.06, mouthStretchLeft: 0.25, mouthStretchRight: 0.25, mouthSmileLeft: 0.1, mouthSmileRight: 0.1 },
  nn: { jawOpen: 0.12, mouthClose: 0.08 },
  RR: { mouthFunnel: 0.3, mouthPucker: 0.2, jawOpen: 0.12 },
  aa: { jawOpen: 0.5, mouthLowerDownLeft: 0.2, mouthLowerDownRight: 0.2 },
  E: { jawOpen: 0.3, mouthStretchLeft: 0.3, mouthStretchRight: 0.3, mouthUpperUpLeft: 0.1, mouthUpperUpRight: 0.1 },
  I: { jawOpen: 0.18, mouthSmileLeft: 0.3, mouthSmileRight: 0.3, mouthStretchLeft: 0.2, mouthStretchRight: 0.2 },
  O: { jawOpen: 0.35, mouthFunnel: 0.55, mouthPucker: 0.15 },
  U: { jawOpen: 0.15, mouthPucker: 0.7, mouthFunnel: 0.3 },
};

/** A small English grapheme -> viseme pass: good enough to drive a mouth, not a dictionary. */
export function textToVisemes(text) {
  const out = [];
  const words = text.toLowerCase().replace(/[^a-z' \n.,!?;:-]/g, ' ').split(/(\s+|[.,!?;:-]+)/);
  const rules = [
    ['tion', ['SS', 'nn']], ['ough', ['O']], ['augh', ['aa']], ['igh', ['aa', 'I']], ['tch', ['CH']], ['sch', ['SS', 'kk']],
    ['th', ['TH']], ['sh', ['CH']], ['ch', ['CH']], ['ph', ['FF']], ['wh', ['U']], ['ng', ['kk']], ['ck', ['kk']], ['qu', ['kk', 'U']],
    ['ee', ['I']], ['ea', ['I']], ['oo', ['U']], ['ou', ['aa', 'U']], ['ow', ['aa', 'U']], ['oi', ['O', 'I']], ['oy', ['O', 'I']], ['ai', ['E']], ['ay', ['E']], ['au', ['O']], ['aw', ['O']], ['ie', ['I']], ['ei', ['E']], ['ey', ['E']],
    ['a', ['aa']], ['e', ['E']], ['i', ['I']], ['o', ['O']], ['u', ['U']], ['y', ['I']],
    ['b', ['PP']], ['m', ['PP']], ['p', ['PP']], ['f', ['FF']], ['v', ['FF']], ['d', ['DD']], ['t', ['DD']], ['l', ['DD']], ['n', ['nn']],
    ['k', ['kk']], ['g', ['kk']], ['c', ['kk']], ['q', ['kk']], ['x', ['kk', 'SS']], ['s', ['SS']], ['z', ['SS']], ['j', ['CH']], ['r', ['RR']], ['w', ['U']], ['h', ['kk']],
  ];
  for (const w of words) {
    if (!w) continue;
    if (/^\s+$/.test(w)) { out.push({ v: 'sil', w: 0.35 }); continue; }
    if (/^[.,!?;:-]+$/.test(w)) { out.push({ v: 'sil', w: /[.!?]/.test(w) ? 2.4 : 1.2 }); continue; }
    let i = 0;
    const word = w.replace(/'/g, '');
    while (i < word.length) {
      // a silent final e
      if (word[i] === 'e' && i === word.length - 1 && word.length > 2) { i++; continue; }
      let hit = false;
      for (const [g, vs] of rules) {
        if (word.startsWith(g, i)) {
          for (const v of vs) out.push({ v, w: /^(aa|E|I|O|U)$/.test(v) ? 1.3 : 0.8 });
          i += g.length; hit = true; break;
        }
      }
      if (!hit) i++;
    }
  }
  // collapse repeats
  const res = [];
  for (const x of out) { const last = res[res.length - 1]; if (last && last.v === x.v) last.w += x.w * 0.5; else res.push({ ...x }); }
  return res;
}

/** Turns visemes into a timed track over `duration` seconds: [{t0, t1, v}] */
export function visemeTrack(text, duration) {
  const vs = textToVisemes(text);
  const total = vs.reduce((a, x) => a + x.w, 0) || 1;
  let t = 0;
  return vs.map((x) => { const d = (x.w / total) * duration; const r = { t0: t, t1: t + d, v: x.v }; t += d; return r; });
}

/** Seconds a line takes to say at a natural pace (about 2.6 words/s; slower for heavy lines). */
export function speechDuration(text, rate = 1) {
  const words = text.trim().split(/\s+/).length;
  const pauses = (text.match(/[.,!?;:—-]/g) ?? []).length;
  return (0.35 + words / 2.7 + pauses * 0.18) / rate;
}

export class Face {
  constructor(human, rig) {
    this.h = human; this.rig = rig;
    this.emotion = 'neutral';
    this.intensity = 1;
    this.cur = new Float32Array(human.face.length);
    this.target = new Float32Array(human.face.length);
    this.blinkT = 1 + Math.random() * 3;
    this.blink = 0; this.blinkPhase = -1;
    this.saccadeT = 0.5;
    this.speech = null;          // { track, t, dur, amp }
    this.tension = 0;            // 0 calm .. 1 extreme: faster blinks, smaller saccades
    this.time = Math.random() * 100;
    this.overrides = {};         // per-unit absolute overrides from scripts
    this.idx = human.unitIndex;
  }

  setEmotion(name, intensity = 1) { if (EMOTIONS[name]) { this.emotion = name; this.intensity = intensity; } }

  /** Starts speaking `text` for `duration` seconds (or the estimate). */
  say(text, duration = speechDuration(text), amp = 1) {
    this.speech = { track: visemeTrack(text, duration), t: 0, dur: duration, amp };
    return duration;
  }
  stopSpeaking() { this.speech = null; }
  get speaking() { return !!this.speech; }

  update(dt) {
    this.time += dt;
    const T = this.target, idx = this.idx;
    T.fill(0);
    const add = (shape, w) => { for (const k in shape) { const i = idx[k]; if (i !== undefined) T[i] += shape[k] * w; } };
    add(EMOTIONS[this.emotion] ?? {}, this.intensity);
    // life: breathing through the nose, faint asymmetry drift
    const br = Math.sin(this.time * 1.6) * 0.5 + 0.5;
    T[idx.noseSneerLeft] += br * 0.04; T[idx.noseSneerRight] += br * 0.035;
    T[idx.mouthLeft] += Math.sin(this.time * 0.37) * 0.03;
    // speech
    if (this.speech) {
      const s = this.speech;
      s.t += dt;
      if (s.t >= s.dur) this.speech = null;
      else {
        // coarticulation: blend the current viseme with its neighbours by distance in time
        const tr = s.track;
        let k = tr.findIndex((x) => s.t < x.t1);
        if (k < 0) k = tr.length - 1;
        for (let j = Math.max(0, k - 1); j <= Math.min(tr.length - 1, k + 1); j++) {
          const x = tr[j];
          const mid = (x.t0 + x.t1) / 2, half = Math.max(0.04, (x.t1 - x.t0) / 2);
          const w = Math.max(0, 1 - Math.abs(s.t - mid) / (half * 1.8));
          add(VISEMES[x.v] ?? {}, w * s.amp);
        }
      }
    }
    // blinks
    this.blinkT -= dt;
    if (this.blinkT <= 0 && this.blinkPhase < 0) {
      this.blinkPhase = 0;
      const calmGap = 2 + Math.random() * 5;
      this.blinkT = calmGap * (1 - this.tension * 0.6) + (Math.random() < 0.12 ? -calmGap + 0.25 : 0);
    }
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt / 0.16;
      this.blink = this.blinkPhase < 0.45 ? this.blinkPhase / 0.45 : Math.max(0, 1 - (this.blinkPhase - 0.45) / 0.55);
      if (this.blinkPhase >= 1) { this.blinkPhase = -1; this.blink = 0; }
    }
    T[idx.eyeBlinkLeft] = Math.max(T[idx.eyeBlinkLeft], this.blink);
    T[idx.eyeBlinkRight] = Math.max(T[idx.eyeBlinkRight], this.blink);
    // saccades: small darts of the eyes
    this.saccadeT -= dt;
    if (this.saccadeT <= 0) {
      const amp = 0.05 * (1 - this.tension * 0.5);
      const old = this.rig.eyeOffset;
      const nx = (Math.random() - 0.5) * amp * 2, ny = (Math.random() - 0.5) * amp;
      if (Math.hypot(nx - old[0], ny - old[1]) > 0.06 && Math.random() < 0.4) this.blinkT = Math.min(this.blinkT, 0.02);
      this.rig.eyeOffset = [nx, ny];
      this.saccadeT = 0.25 + Math.random() * (1.6 - this.tension);
    }
    // lids follow the eyes a little (eyeLook units)
    const [ex, ey] = this.rig.eyeOffset;
    T[idx.eyeLookDownLeft] += Math.max(0, -ey) * 2; T[idx.eyeLookDownRight] += Math.max(0, -ey) * 2;
    T[idx.eyeLookUpLeft] += Math.max(0, ey) * 2; T[idx.eyeLookUpRight] += Math.max(0, ey) * 2;
    void ex;
    for (const k in this.overrides) { const i = idx[k]; if (i !== undefined) T[i] = this.overrides[k]; }
    // ease toward the target (faster for the mouth when speaking)
    const out = this.h.face;
    const k1 = 1 - Math.exp(-dt * 10), k2 = 1 - Math.exp(-dt * 22);
    for (let i = 0; i < T.length; i++) {
      const fast = i === idx.eyeBlinkLeft || i === idx.eyeBlinkRight || (this.speech && (i === idx.jawOpen || i >= idx.mouthClose && i <= idx.mouthUpperUpRight));
      this.cur[i] += (Math.min(1, T[i]) - this.cur[i]) * (fast ? k2 : k1);
      out[i] = this.cur[i];
    }
  }
}
