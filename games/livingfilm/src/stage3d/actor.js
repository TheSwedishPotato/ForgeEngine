/**
 * Actors: the townsfolk of Zweikampf 1403 (Walker: a posed, clothed body,
 * gait from biomechanics, work motions) taught to act. Extended here, not
 * changed there: gestures for a scene (pointing, arms crossed, a hand on
 * the heart, both hands raised, beckoning, a shrug, a drink, a wave, a bow,
 * a hand on the hilt, an embrace), walking to a mark, turning the head to
 * whoever speaks, and a face that moves: the brows and mouth repainted on
 * the head's own painted skin by emotion, the lips working while they talk.
 */
import { Vector3, Quaternion, Color } from 'three';
import { Walker, FACE } from './engine.js';
import { GESTURES, TASKS } from './vocab.js';

export { GESTURES, TASKS };

const X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1);
const qx = (a) => new Quaternion().setFromAxisAngle(X, a);
const qz = (a) => new Quaternion().setFromAxisAngle(Z, a);
const TAU = Math.PI * 2;


/** Arm targets per gesture and side: arm raise, elbow bend, abduction (out from the body); plus trunk bend and head. */
function gesturePose(g, side, t) {
  const R = side === 'R', s = Math.sin;
  switch (g) {
    case 'point': return R ? { arm: 1.45, elbow: 0.12, abd: 0.25 } : null;
    case 'cross': return { arm: 0.55, elbow: 2.05, abd: -0.38 };
    case 'heart': return R ? { arm: 0.42, elbow: 2.05, abd: -0.4, head: 0.12 } : null;
    case 'raise': return { arm: 1.05, elbow: 1.3, abd: 0.45 };
    case 'beckon': return R ? { arm: 0.85, elbow: 1.1 + 0.45 * Math.max(0, s(t * 7)), abd: 0.1 } : null;
    case 'shrug': return { arm: 0.3, elbow: 1.55, abd: 0.55, head: 0.08 };
    case 'drink': { const u = Math.pow(Math.max(0, s(t * 1.1)), 2); return R ? { arm: 0.6 + 0.55 * u, elbow: 1.7 + 0.5 * u, abd: 0.05, head: -0.25 * u } : null; }
    case 'wave': return R ? { arm: 2.5, elbow: 0.55 + 0.35 * s(t * 8), abd: 0.35 } : null;
    case 'bow': return { arm: 0.25, elbow: 0.35, abd: 0.05, bend: 0.75, head: 0.35 };
    case 'hilt': return R ? null : { arm: 0.12, elbow: 0.95, abd: 0.25 };
    case 'embrace': return { arm: 1.3, elbow: 0.95, abd: 0.12 };
    case 'hips': return { arm: 0.15, elbow: 1.5, abd: 0.75 };
    case 'clasp': return { arm: 0.5, elbow: 1.6, abd: -0.2, head: 0.15 };
    case 'reach': return R ? { arm: 1.2, elbow: 0.35, abd: 0.05, bend: 0.12 } : null;                       // a hand held out to someone
    case 'offer': return { arm: 0.85, elbow: 0.9, abd: 0.12, bend: 0.06 };                                   // both hands out, giving or showing
    case 'fist': return R ? { arm: 1.0 + 0.08 * s(t * 3), elbow: 1.9, abd: 0.2 } : { arm: 0.15, elbow: 0.5, abd: 0.1 };
    case 'cover': return { arm: 1.15, elbow: 2.35, abd: -0.05, bend: 0.25, head: 0.4 };                      // hands to the face
    case 'chin': return R ? { arm: 0.75, elbow: 2.3, abd: -0.15, head: 0.08 } : { arm: 0.5, elbow: 1.9, abd: -0.35 };   // thinking
    case 'bless': { const u = s(t * 2.4); return R ? { arm: 1.0 + 0.25 * u, elbow: 1.2, abd: 0.05 + 0.2 * Math.cos(t * 2.4) } : null; }   // the sign of the cross
    case 'halt': return R ? { arm: 1.35, elbow: 0.5, abd: 0.15 } : null;                                       // palm up: stop
    case 'wring': { const u = s(t * 5); return { arm: 0.55, elbow: 1.7 + 0.12 * u, abd: -0.32, head: 0.2 }; }  // hands twisting together
    case 'slump': return { arm: 0.05, elbow: 0.2, abd: 0.04, bend: 0.32, head: 0.45 };                        // spent, beaten
    case 'lean': return { arm: 0.55, elbow: 0.35, abd: 0.05, bend: 0.45, head: -0.15 };                       // leaning on a table or sill
    case 'count': return R ? { arm: 0.6, elbow: 1.6 + 0.1 * s(t * 6), abd: -0.1, head: 0.35 } : { arm: 0.55, elbow: 1.5, abd: -0.15, head: 0.35 };   // counting coin
    case 'scratch': return R ? { arm: 2.3, elbow: 2.2 + 0.1 * s(t * 9), abd: 0.4, head: 0.1 } : null;        // scratching the head, unsure
    default: return null;
  }
}

/** The face for an emotion: inner brow (+ raised), brow height, mouth curve (+ smile), resting mouth opening. */
const EMOTION = {
  neutral: { browIn: 0, browY: 0, curve: 0, open: 0 }, warm: { browIn: 0.2, browY: 0.1, curve: 0.6, open: 0.1 }, amused: { browIn: 0.1, browY: 0.2, curve: 0.8, open: 0.3 },
  tender: { browIn: 0.5, browY: 0.05, curve: 0.35, open: 0 }, sad: { browIn: 0.8, browY: 0, curve: -0.5, open: 0 }, angry: { browIn: -0.9, browY: -0.2, curve: -0.45, open: 0.15 },
  afraid: { browIn: 0.9, browY: 0.4, curve: -0.3, open: 0.4 }, surprised: { browIn: 0.4, browY: 0.6, curve: 0, open: 0.7 }, suspicious: { browIn: -0.5, browY: -0.1, curve: -0.15, open: 0 },
  proud: { browIn: -0.15, browY: 0.15, curve: 0.25, open: 0 }, tired: { browIn: 0.3, browY: -0.1, curve: -0.2, open: 0 },
};

export class Actor extends Walker {
  constructor(opts) {
    super(opts);
    this.id = opts.id;
    this.pos = new Vector3(); this.yawNow = 0; this.target = null;
    this.gestureName = 'none'; this.gw = 0;
    this.emotion = 'neutral'; this.talking = false; this.lookAt = null; this.posture = 'stand'; this.task = null;
    this._face = null;
    this._faceT = 0;
  }

  place(x, z, yaw, posture = 'stand') { this.pos.set(x, 0, z); this.yawNow = yaw; this.target = null; this.posture = posture; }
  walkTo(x, z, yaw = null, posture = 'stand') { this.target = { x, z, yaw, posture }; this.posture = 'stand'; }
  /** Turn the body to someone (when standing still), and the eyes always. */
  faceTo(p) {
    this.lookAt = p;
    if (!p || this.target || this.posture !== 'stand') return;
    this.yawWant = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }
  act({ gesture, emotion, talking, task } = {}) {
    if (task !== undefined) this.task = TASKS.includes(task) ? task : null;
    if (gesture !== undefined && gesture !== this.gestureName) { this.gestureName = GESTURES.includes(gesture) ? gesture : 'none'; }
    if (emotion) this.emotion = EMOTION[emotion] ? emotion : 'neutral';
    if (talking !== undefined) this.talking = talking;
  }

  /** Each frame: walk, turn, gesture, speak. */
  tick(dt, t) {
    let speed = 0;
    if (this.target) {
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.05) { if (this.target.yaw != null) this.yawWant = this.target.yaw; this.posture = this.target.posture ?? 'stand'; this.target = null; }
      else { const step = Math.min(d, 1.15 * dt); this.pos.x += (dx / d) * step; this.pos.z += (dz / d) * step; speed = 1.15; this.yawWant = Math.atan2(dx, dz); }
    }
    if (this.yawWant != null) { let dy = this.yawWant - this.yawNow; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); this.yawNow += dy * Math.min(1, dt * 5); }
    // the head turns to whoever matters (within what a neck allows)
    let look = 0;
    if (this.lookAt) { const a = Math.atan2(this.lookAt.x - this.pos.x, this.lookAt.z - this.pos.z) - this.yawNow; look = Math.max(-0.9, Math.min(0.9, Math.atan2(Math.sin(a), Math.cos(a)))); }
    this.gw += ((this.gestureName !== 'none' && speed < 0.05 ? 1 : 0) - this.gw) * Math.min(1, dt * 4);
    this._t = t;
    this.update(dt, { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yawNow, speed, posture: this.posture, gesture: this.talking && this.gestureName === 'none' && this.task == null, look, task: speed > 0.05 ? null : this.task ?? (this.talking && this.gestureName === 'none' ? 'talk' : null) });
    this._faceTick(dt);
  }

  /** Walker's pose, then the gesture laid over it. */
  _orient(dt, speed, posture) {
    super._orient(dt, speed, posture);
    if (this.gw < 0.01 || posture === 'lie') return;
    const P = this.pose, w = this.gw, t = this._t ?? 0;
    let bend = 0, head = 0;
    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      const g = gesturePose(this.gestureName, side, t);
      if (!g) continue;
      // read back the current arm angles is not possible from quaternions cheaply; blend toward the target pose instead
      const target = qz(sx * g.abd).multiply(qx(-g.arm));
      P['upperArm' + side] = P['upperArm' + side].clone().slerp(target, w);
      P['forearm' + side] = P['upperArm' + side].clone().multiply(qx(-g.elbow * w - (1 - w) * 0.25));
      bend = Math.max(bend, g.bend ?? 0); head = g.head ?? head;
    }
    if (bend) { P.chest = qx(bend * w).multiply(P.chest); P.abdomen = qx(bend * 0.4 * w).multiply(P.abdomen); }
    if (head) P.head = qx(head * w).multiply(P.head);
  }

  // --- the face ---------------------------------------------------------------------------------

  _faceSetup() {
    const b = this.body;
    if (!b?.g || !b.headUV) return null;
    const pts = [[-0.7, FACE.brow + 0.16], [0.7, FACE.brow + 0.16], [-0.7, FACE.lipL - 0.1], [0.7, FACE.lipL - 0.1]].map(([dx, dy]) => b.headUV(dx, dy, Math.sqrt(Math.max(0.05, 1 - dx * dx - dy * dy))));
    const x0 = Math.floor(Math.min(...pts.map((p) => p[0]))) - 4, x1 = Math.ceil(Math.max(...pts.map((p) => p[0]))) + 4;
    const y0 = Math.floor(Math.min(...pts.map((p) => p[1]))) - 4, y1 = Math.ceil(Math.max(...pts.map((p) => p[1]))) + 4;
    if (x1 - x0 > b.S * 0.6 || x1 <= x0 || y1 <= y0) return null;
    const orig = b.g.getImageData(x0, y0, x1 - x0, y1 - y0);
    const [fx, fy] = b.headUV(0, FACE.brow + 0.1, 0.95);
    const skin = b.g.getImageData(Math.round(fx), Math.round(fy), 1, 1).data;
    const hair = new Color(this.colors.hair);
    return { x0, y0, orig, skin: `rgb(${skin[0]},${skin[1]},${skin[2]})`, hair: `#${hair.getHexString()}`, last: '' };
  }

  _faceTick(dt) {
    this._faceT -= dt;
    if (this._faceT > 0) return;
    this._faceT = 1 / 14;
    const f = this._face ??= this._faceSetup();
    if (!f) return;
    const E = EMOTION[this.emotion] ?? EMOTION.neutral;
    const mouth = (this.talking ? 0.25 + 0.75 * Math.abs(Math.sin((this._t ?? 0) * 11 + Math.sin((this._t ?? 0) * 4.3) * 2)) : 0) + E.open * 0.4;
    const key = `${this.emotion}|${mouth.toFixed(1)}`;
    if (key === f.last) return;
    f.last = key;
    const b = this.body, g = b.g;
    g.putImageData(f.orig, f.x0, f.y0);
    // cover the painted brows and lips with skin, then paint them for the feeling
    g.save();
    g.globalAlpha = 0.92; g.fillStyle = f.skin;
    for (const sx of [1, -1]) { const [px, py] = b.headUV(sx * 0.36, FACE.brow + 0.03, 0.93); g.beginPath(); g.ellipse(px, py, 28, 9, 0, 0, TAU); g.fill(); }
    const [mx, my] = b.headUV(0, (FACE.lipU + FACE.lipL) / 2, 0.9);
    g.beginPath(); g.ellipse(mx, my, 26, 14, 0, 0, TAU); g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = f.hair; g.lineCap = 'round';
    for (const sx of [1, -1]) {
      for (let k = 0; k < 22; k++) {
        const u = k / 21, dx = sx * (0.14 + 0.44 * u);
        const dy = FACE.brow + 0.01 + 0.04 * E.browY + 0.035 * Math.sin(u * Math.PI) - 0.02 * u + E.browIn * 0.05 * (1 - u);
        const [px, py] = b.headUV(dx, dy, Math.sqrt(Math.max(0.05, 1 - dx * dx - dy * dy)));
        g.globalAlpha = 0.6; g.lineWidth = 3.4 - 1.6 * u;
        g.beginPath(); g.moveTo(px - sx * 2, py + 1.5 + E.browIn * sx * 0.3); g.lineTo(px + sx * 2, py - 1.5); g.stroke();
      }
    }
    // the mouth: lips, the line between them bent by the feeling, open as they speak
    const curve = E.curve * 5, open = mouth * 9;
    g.globalAlpha = 0.6; g.fillStyle = '#8a3b36';
    g.beginPath(); g.ellipse(mx, my - 4 - open * 0.3, 19, 4.5, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(mx, my + 4 + open * 0.6, 19, 5.5, 0, 0, TAU); g.fill();
    g.globalAlpha = 0.85; g.fillStyle = '#2a0e0a';
    g.beginPath(); g.moveTo(mx - 18, my - curve); g.quadraticCurveTo(mx, my + curve + open, mx + 18, my - curve); g.quadraticCurveTo(mx, my + curve * 0.4 - open * 0.15, mx - 18, my - curve); g.fill();
    g.restore();
    b.texture.needsUpdate = true;
  }
}
