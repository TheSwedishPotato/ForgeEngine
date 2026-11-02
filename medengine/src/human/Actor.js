import { Vector3, MathUtils } from 'three';
import { Human } from './Human.js';
import { Rig, completePose, blendPose, addPose, clonePose } from './Rig.js';
import { Face } from './Face.js';
import { POSES, CLIPS } from './Moves.js';
import { dress } from './Garments.js';

const ease = {
  linear: (t) => t, in: (t) => t * t, out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => t * t * (3 - 2 * t), snap: (t) => 1 - Math.pow(1 - t, 4),
};
const _v = new Vector3(), _w = new Vector3();

/**
 * An actor: a digital human that performs. Layers, bottom to top:
 *   posture (a held pose, cross-faded) -> gait (walking/running, procedural, feet planted)
 *   -> clip (a short keyed move: a punch, a nod) -> breathing and weight shift (additive)
 *   -> look-at (head, neck, eyes) -> face (emotion, blinks, saccades, lip-sync)
 * plus garments (cape cloth) following the body.
 */
export class Actor {
  static async load(stage, baseUrl, id, opts = {}) {
    const h = await Human.load(baseUrl, id, opts);
    return new Actor(stage, h, opts);
  }

  constructor(stage, human, { name } = {}) {
    this.stage = stage;
    this.h = human;
    this.id = human.id;
    this.name = name ?? human.name;
    this.root = human.root;
    this.rig = new Rig(human);
    this.face = new Face(human, this.rig);
    this.garments = dress(human, stage?.r);
    this.yaw = 0;
    this.post = completePose(POSES.idle);
    this.postFrom = null; this.postT = 1; this.postDur = 0.4;
    this.postName = 'idle';
    this.clip = null;
    this.walk = null;           // { target, speed, resolve, run }
    this.gaitPhase = 0; this.gaitW = 0; this.speed = 0;
    this.lookTarget = null; this.lookW = 0; this.lookWTarget = 0;
    this.breath = Math.random() * 10;
    this.tension = 0;
    this.time = 0;
    this.visible = true;
  }

  get position() { return this.root.position; }

  place(p, yawDeg = this.yaw * MathUtils.RAD2DEG) {
    this.root.position.set(p.x ?? p[0], p.y ?? p[1] ?? 0, p.z ?? p[2]);
    this.yaw = yawDeg * MathUtils.DEG2RAD;
    this.root.rotation.set(0, this.yaw, 0);
    this.root.updateMatrixWorld(true);
    return this;
  }

  /** Holds a pose (by name or object), blending from the current one. */
  posture(p, fade = 0.45) {
    const pose = typeof p === 'string' ? POSES[p] : p;
    if (typeof p === 'string') this.postName = p;
    this.postFrom = this._currentBase();
    this.post = completePose(pose ?? {});
    this.postT = 0; this.postDur = Math.max(0.001, fade);
    return this;
  }

  _currentBase() {
    if (!this.postFrom || this.postT >= 1) return clonePose(this.post);
    return blendPose(this.postFrom, this.post, ease.inOut(this.postT));
  }

  /** Plays a clip (name or object). Resolves when it ends. */
  play(c, { speed = 1, weight = 1 } = {}) {
    const clip = typeof c === 'string' ? CLIPS[c] : c;
    if (!clip) return Promise.resolve();
    return new Promise((resolve) => {
      this.clip?.resolve?.();
      const dur = clip.keys[clip.keys.length - 1].t;
      this.clip = { clip, t: 0, dur, speed, weight, resolve };
    });
  }

  /** Walks (or runs) to a world point; resolves on arrival. */
  walkTo(p, { speed = 1.35, run = false, stopDist = 0.05 } = {}) {
    return new Promise((resolve) => {
      this.walk?.resolve?.();
      this.walk = { target: new Vector3(p.x ?? p[0], 0, p.z ?? p[2]), speed: run ? Math.max(speed, 3.6) : speed, run, resolve, stopDist };
    });
  }

  /** Turns to face a point or an angle (degrees) over `dur` seconds. */
  turnTo(t, dur = 0.6) {
    let target;
    if (typeof t === 'number') target = t * MathUtils.DEG2RAD;
    else { const p = t.isVector3 ? t : t.position ?? new Vector3(...t); target = Math.atan2(p.x - this.root.position.x, p.z - this.root.position.z); }
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return new Promise((resolve) => { this.turn = { from: this.yaw, d, t: 0, dur, resolve }; });
  }

  /** Looks at an actor, a point, or nothing. */
  lookAt(t, weight = 1) { this.lookTarget = t; this.lookWTarget = t ? weight : 0; return this; }

  emote(name, intensity = 1) { this.face.setEmotion(name, intensity); return this; }

  /** Lip-syncs a line; returns its duration. */
  say(text, { emotion, duration, amp = 1 } = {}) {
    if (emotion) this.emote(emotion);
    return this.face.say(text, duration, amp);
  }

  /** World position between the eyes (for framing and eye-lines). */
  eyes(out = new Vector3()) {
    this.h.bones.eye_l.getWorldPosition(out); this.h.bones.eye_r.getWorldPosition(_w);
    return out.add(_w).multiplyScalar(0.5);
  }
  bone(name, out = new Vector3()) { return this.h.bones[name].getWorldPosition(out); }
  chest(out = new Vector3()) { return this.bone('spine_03', out); }

  setVisible(v) { this.visible = v; this.root.visible = v; if (this.garments.cape) this.garments.cape.visible = v; }

  update(dt) {
    this.time += dt;
    // turning
    if (this.turn) {
      const T = this.turn; T.t += dt;
      const k = ease.inOut(Math.min(1, T.t / T.dur));
      this.yaw = T.from + T.d * k;
      if (T.t >= T.dur) { this.turn = null; T.resolve(); }
    }
    // walking: steer toward the target, accelerate, arrive
    let gaitTarget = 0;
    if (this.walk) {
      const W = this.walk;
      _v.set(W.target.x - this.root.position.x, 0, W.target.z - this.root.position.z);
      const dist = _v.length();
      if (dist < W.stopDist + this.speed * 0.15) {
        this.walk = null; W.resolve();
      } else {
        const want = Math.atan2(_v.x, _v.z);
        let d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
        this.yaw += MathUtils.clamp(d, -dt * 4, dt * 4);
        gaitTarget = Math.min(W.speed, 0.6 + dist * 1.8);
      }
    }
    this.speed += (gaitTarget - this.speed) * Math.min(1, dt * (gaitTarget > this.speed ? 3 : 5));
    if (this.speed > 0.02) {
      this.root.position.x += Math.sin(this.yaw) * this.speed * dt;
      this.root.position.z += Math.cos(this.yaw) * this.speed * dt;
    }
    this.root.rotation.set(0, this.yaw, 0);
    this.root.updateMatrixWorld(true);

    // ---- pose layers
    if (this.postT < 1) this.postT = Math.min(1, this.postT + dt / this.postDur);
    let pose = this._currentBase();
    // gait
    const run = this.speed > 2.4;
    const stride = run ? 1.25 : 0.68 + this.speed * 0.12;
    this.gaitW += ((this.speed > 0.05 ? 1 : 0) - this.gaitW) * Math.min(1, dt * 6);
    if (this.gaitW > 0.01) {
      this.gaitPhase = (this.gaitPhase + (this.speed * dt) / (stride * 2)) % 1;
      pose = blendPose(pose, this._gait(pose, stride, run), this.gaitW);
    }
    // clip
    if (this.clip) {
      const C = this.clip;
      C.t += dt * C.speed;
      const keys = C.clip.keys;
      let k = keys.findIndex((x) => x.t > C.t);
      let cp;
      if (k < 0) cp = keys[keys.length - 1].pose;
      else if (k === 0) cp = keys[0].pose;
      else {
        const a = keys[k - 1], b = keys[k];
        const u = (ease[b.ease ?? 'inOut'])((C.t - a.t) / (b.t - a.t));
        cp = blendPose(completePose(a.pose, pose), completePose(b.pose, pose), u);
      }
      const fade = Math.min(1, C.t / 0.06, C.clip.hold ? 1 : (C.dur - C.t) / 0.12 + 0.0001);
      pose = blendPose(pose, completePose(cp, pose), Math.max(0, Math.min(1, fade)) * C.weight);
      if (C.t >= C.dur) {
        if (C.clip.hold) { this.post = completePose(keys[keys.length - 1].pose, pose); this.postFrom = null; this.postT = 1; }
        this.clip = null; C.resolve();
      }
    }
    // breathing and weight shift
    this.breath += dt * (1.05 + this.tension * 0.9);
    const b = Math.sin(this.breath * 2.2);
    addPose(pose, { spine: [b * 0.9, 0, 0], neck: [-b * 0.4, 0, 0], armL: { clavicle: [b * 0.8, 0] }, armR: { clavicle: [b * 0.8, 0] } });
    if (this.gaitW < 0.5) {
      const sway = Math.sin(this.time * 0.31) * 0.012;
      addPose(pose, { pelvis: { pos: [sway, 0, 0], rot: [0, 0, sway * 40] }, spine: [0, 0, -sway * 50] });
    }
    // look-at
    this.lookW += (this.lookWTarget - this.lookW) * Math.min(1, dt * 4);
    if (this.lookTarget && this.lookW > 0.001) {
      const t = this.lookTarget;
      this.rig.lookTarget = t.isVector3 ? t : t.eyes ? t.eyes(this._lt ??= new Vector3()) : new Vector3(...t);
      this.rig.lookWeight = this.lookW;
    } else { this.rig.lookTarget = null; this.rig.lookWeight = 0; }
    this.rig.apply(pose);
    this.face.tension = this.tension;
    this.face.update(dt);
    this.garments.cape?.update(dt);
  }

  _gait(base, stride, run) {
    const ph = this.gaitPhase * Math.PI * 2;
    const leg = (offset) => {
      const p = (this.gaitPhase + offset) % 1;
      // stance (0..0.6): foot moves back under the hip; swing (0.6..1): forward, lifted
      const stanceEnd = run ? 0.42 : 0.6;
      let fwd, lift, toe;
      if (p < stanceEnd) { const s = p / stanceEnd; fwd = (0.5 - s) * stride; lift = 0; toe = -s * (run ? 20 : 12); }
      else { const s = (p - stanceEnd) / (1 - stanceEnd); const e = s * s * (3 - 2 * s); fwd = (-0.5 + e) * stride; lift = Math.sin(s * Math.PI) * (run ? 0.22 : 0.1); toe = Math.sin(s * Math.PI) * 12 - 8 * (1 - s); }
      return { fwd, lift, toe };
    };
    const L = leg(0), R = leg(0.5);
    const bob = Math.abs(Math.cos(ph)) * (run ? 0.05 : 0.025) - (run ? 0.06 : 0.02);
    const sw = Math.sin(ph);
    const armSwing = run ? 0.32 : 0.18;
    return {
      pelvis: { pos: [0, bob, 0], rot: [run ? 8 : 2, sw * 6, 0] },
      spine: [run ? 14 : base.spine[0], -sw * 8, 0],
      legL: { foot: [0.0, L.lift, L.fwd], toe: L.toe, knee: [0.05, 0, 1] },
      legR: { foot: [0.0, R.lift, R.fwd], toe: R.toe, knee: [0.05, 0, 1] },
      armL: { hand: [0.05, run ? -0.3 : -0.5, -L.fwd * armSwing * 1.6 + 0.06], elbow: [0.2, 0, -1], curl: run ? 0.8 : 0.35 },
      armR: { hand: [0.05, run ? -0.3 : -0.5, -R.fwd * armSwing * 1.6 + 0.06], elbow: [0.2, 0, -1], curl: run ? 0.8 : 0.35 },
    };
  }
}
