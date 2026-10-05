import { Vector3, Quaternion } from 'three';
import { Body } from '../physics/Body.js';
import { applyPairCorrection } from '../physics/solver.js';
import { quatToRotVec, closestPtPointSegment } from '../physics/math.js';

const _p = new Vector3(), _d = new Vector3(), _c = new Vector3(), _w = new Vector3(), _v = new Vector3();
const _q = new Quaternion(), _qi = new Quaternion(), _a = new Vector3(), _b = new Vector3(), _n = new Vector3(), _t = new Vector3();

/**
 * A body moved by script rather than by forces: the horse. It has infinite
 * mass for the solver (impacts do not slow 600 kg of horse noticeably) but
 * moves smoothly through every substep at its set velocity, so the riders'
 * seat constraints see a moving saddle, not a teleporting one.
 */
export class KinematicBody extends Body {
  constructor(opts) {
    super({ ...opts, mass: 0 });
  }

  get isStatic() { return false; }   // moving: the broadphase pads its boxes by velocity

  integrate(h) {
    this.prevPos.copy(this.pos);
    this.prevQ.copy(this.q);
    this.pos.addScaledVector(this.vel, h);
    if (this.omega.lengthSq() > 0) this.applyRotation(_v.copy(this.omega), h);
  }
}

/**
 * Holds one body at a pose fixed in a reference body's frame (the saddle),
 * with bounded force and torque: the seat, the thighs gripping the saddle
 * bows, the feet in the stirrups, the back against the cantle. Push harder
 * than the bounds and the body moves; push far enough and the rider is out
 * of the saddle.
 */
export class PoseLock {
  constructor(body, ref, { kPos = 0, maxForce = 0, kRot = 0, maxTorque = 0, zeta = 0.8 } = {}) {
    this.body = body;
    this.ref = ref;
    this.localPos = new Vector3();
    this.localQ = new Quaternion();
    this.kPos = kPos; this.maxForce = maxForce;
    this.kRot = kRot; this.maxTorque = maxTorque;
    this.cPos = 2 * zeta * Math.sqrt(kPos * body.mass);
    // rotational damping from the body's mean inertia
    const I = (body.inertia.x + body.inertia.y + body.inertia.z) / 3;
    this.cRot = 2 * zeta * Math.sqrt(kRot * I);
    this.strength = 1;
    this.posErr = 0;
    this.rotErr = 0;
    this.force = 0;
  }

  targetPos(out) { return this.ref.localToWorld(this.localPos, out); }
  targetQ(out) { return out.copy(this.ref.q).multiply(this.localQ); }

  solvePosition(h) {
    const s = this.strength;
    if (s <= 1e-3) return;
    const b = this.body;
    if (this.kPos > 0) {
      this.targetPos(_p);
      _d.subVectors(_p, b.pos);
      this.posErr = _d.length();
      const lam = applyPairCorrection(b, null, _d, 1 / (this.kPos * s), h, b.pos, null, this.maxForce * s * h * h);
      this.force = lam / (h * h);
    }
    if (this.kRot > 0) {
      this.targetQ(_q);
      _q.multiply(_qi.copy(b.q).invert());
      quatToRotVec(_q, _c);
      this.rotErr = _c.length();
      applyPairCorrection(b, null, _c, 1 / (this.kRot * s), h, null, null, this.maxTorque * s * h * h);
    }
  }

  solveVelocity(h) {
    const s = this.strength;
    if (s <= 1e-3) return;
    const b = this.body, r = this.ref;
    if (this.kPos > 0) {
      r.velocityAt(b.pos, _v);
      _d.subVectors(b.vel, _v);
      const vl = _d.length();
      if (vl > 1e-6) {
        const c = this.cPos * s, w = b.invMass;
        const dv = Math.min((c * h * w * vl) / (1 + c * h * w), this.maxForce * s * h * w);
        _c.copy(_d).multiplyScalar(-dv / vl);
        applyPairCorrection(b, null, _c, 0, h, b.pos, null, Infinity, true);
      }
    }
    if (this.kRot > 0) {
      _w.subVectors(b.omega, r.omega);
      const wl = _w.length();
      if (wl > 1e-6) {
        _w.multiplyScalar(1 / wl);
        const wi = b.getInverseMass(_w, null);
        const c = this.cRot * s;
        const dw = Math.min((c * h * wi * wl) / (1 + c * h * wi), this.maxTorque * s * h * wi);
        _c.copy(_w).multiplyScalar(-dw);
        applyPairCorrection(b, null, _c, 0, h, null, null, Infinity, true);
      }
    }
  }
}

/**
 * The couched lance: a point of the lance lies in the rest on the right
 * breast (stiff, it is bolted steel), and the arm and armpit turn the lance
 * towards the aim with bounded torque. Impacts along the lance go straight
 * into the breastplate, which is what the rest is for.
 */
export class LanceHold {
  constructor(lance, chest, { restLocalLance, restLocalChest, kRot = 15000, maxTorque = 900, seat = null }) {
    this.lance = lance;
    this.chest = chest;
    this.seat = seat;
    this.aLance = restLocalLance.clone();
    this.aChest = restLocalChest.clone();
    this.targetQ = lance.q.clone();
    this.kRot = kRot;
    this.maxTorque = maxTorque;
    const I = lance.inertia.x;
    this.cRot = 2 * 0.9 * Math.sqrt(kRot * I);
    this.enabled = true;
    this.force = 0;
    this.strength = 1;
  }

  solvePosition(h) {
    if (!this.enabled) return;
    const L = this.lance, C = this.chest;
    L.localToWorld(this.aLance, _a);
    C.localToWorld(this.aChest, _b);
    _d.subVectors(_b, _a);
    const lam = applyPairCorrection(L, C, _d, 1e-7, h, _a, _b);
    this.force = lam / (h * h);
    // aim
    _q.copy(this.targetQ).multiply(_qi.copy(L.q).invert());
    quatToRotVec(_q, _c);
    // The arm, the rest and the armpit turn the lance; the man is braced in
    // the saddle, so the reaction of aiming goes to the seat (the horse),
    // not into twisting his chest. Shocks along the lance still come through
    // the rest point above.
    const s = this.strength;
    if (s > 1e-3) applyPairCorrection(L, null, _c, 1 / (this.kRot * s), h, null, null, this.maxTorque * s * h * h);
  }

  solveVelocity(h) {
    if (!this.enabled || this.strength <= 1e-3) return;
    const L = this.lance, H = this.seat;
    _w.copy(L.omega);
    if (H) _w.sub(H.omega);
    const wl = _w.length();
    if (wl < 1e-6) return;
    _w.multiplyScalar(1 / wl);
    const wsum = L.getInverseMass(_w, null);
    const c = this.cRot * this.strength;
    let J = (c * h * wl) / (1 + c * h * wsum);
    J = Math.min(J, this.maxTorque * this.strength * h);
    _c.copy(_w).multiplyScalar(-J);
    L.applyCorrection(_c, null, true);
  }
}

/**
 * The coronel meeting its target, solved by hand instead of by the generic
 * contact solver, because the lance is the weakest part of the system: it
 * cannot push harder than its buckling load. Each substep the contact
 * impulse is capped at that load; when the cap is reached (or the bending
 * limit across the head), the lance breaks, and the target has received
 * exactly what a lance can give.
 */
export class LanceStrike {
  constructor(lance, { tipLocal, radius = 0.045, buckling, bending, bowTime = 0.005 }) {
    this.lance = lance;
    this.bowTime = bowTime;
    this.tipLocal = tipLocal.clone();
    this.radius = radius;
    this.buckling = buckling;
    this.bending = bending;
    this.targets = [];        // shapes it can strike
    this.enabled = true;
    this.broken = false;
    this.onBreak = null;
    this.contact = null;      // the current strike, if any
    this.history = [];
    this._fn = [];
  }

  /** Per-shape coronel material: friction (bite) and compliance. */
  static material(shape) {
    const part = shape.userData.part, mat = shape.userData.mat;
    if (part === 'ecranche') return { mu: 0.85, compliance: 1 / 9e5 };   // the points bite into wood and leather
    if (shape.userData.horse) return { mu: 0.5, compliance: 1 / 6e5 };
    if (mat === 'plate' || part === 'skull' || part === 'jaw') return { mu: 0.12, compliance: 1 / 2.2e6 };
    if (mat === 'mail') return { mu: 0.3, compliance: 1 / 1.2e6 };
    return { mu: 0.35, compliance: 1 / 1.5e6 };   // a jupon over plate
  }

  solvePosition(h) {
    if (!this.enabled || this.broken) return;
    const L = this.lance;
    L.localToWorld(this.tipLocal, _p);
    _t.set(0, 1, 0).applyQuaternion(L.q);   // lance axis (towards the head)
    let hit = false;
    for (const s of this.targets) {
      s.updateWorld();
      let r;
      if (s.type === 'sphere') { _a.copy(s.wCenter); r = s.radius; }
      else if (s.type === 'capsule') { closestPtPointSegment(_p, s.wA, s.wB, _a); r = s.radius; }
      else continue;
      _n.subVectors(_p, _a);
      const dist = _n.length();
      const depth = r + this.radius - dist;
      if (depth <= 0 || dist < 1e-9) continue;
      _n.multiplyScalar(1 / dist);
      const B = s.body;
      const m = LanceStrike.material(s);
      const pB = _b.copy(_a).addScaledVector(_n, r);
      const cosA = Math.max(0.25, Math.abs(_n.dot(_t)));
      // The normal force the lance can bear: buckling along its axis.
      const cap = this.buckling / cosA;
      _c.copy(_n).multiplyScalar(depth);
      const lam = applyPairCorrection(L, B.invMass > 0 ? B : null, _c, m.compliance, h, _p, pB, cap * h * h);
      const Fn = lam / (h * h);
      // Friction at the position level: undo the tangential slip of this substep.
      L.velocityAt(_p, _v);
      B.velocityAt(pB, _w);
      _d.subVectors(_v, _w);
      _d.addScaledVector(_n, -_d.dot(_n)).multiplyScalar(h);
      const slip = _d.length();
      let Ft = 0;
      if (slip > 1e-9) {
        const lt = applyPairCorrection(L, B.invMass > 0 ? B : null, _d.negate(), 0, h, _p, pB, m.mu * lam);
        Ft = lt / (h * h);
      }
      hit = true;
      const c = this.contact ??= { shape: s, body: B, start: true, impulse: 0, peak: 0, peakT: 0, bowT: 0, bowMax: 0, point: new Vector3(), normal: new Vector3(), speed: 0, work: 0 };
      if (c.start) {
        L.velocityAt(_p, _v); B.velocityAt(pB, _w);
        c.speed = -_d.subVectors(_v, _w).dot(_n);
        c.shape = s; c.body = B;
        c.point.copy(_p);
        c.normal.copy(_n);
        c.start = false;
      }
      c.impulse += Fn * h;
      c.work += Fn * depth;
      if (Fn > c.peak) { c.peak = Fn; c.point.copy(_p); c.normal.copy(_n); c.shape = s; }
      if (Ft > c.peakT) c.peakT = Ft;
      c.ticks = 0;
      // At its buckling load the lance bows instead of pushing harder; held
      // there for the time the bow takes to grow to rupture, it snaps. If the
      // load falls first (the target gives, the point skids off), it springs
      // back whole. A sideways load beyond what the wood bends to snaps it at once.
      const axial = Fn * Math.abs(_n.dot(_t)) + Ft * Math.sqrt(Math.max(0, 1 - _n.dot(_t) ** 2));
      const lateral = Math.sqrt(Math.max(0, Fn * Fn + Ft * Ft - axial * axial));
      const bowing = lam >= cap * h * h * 0.999 || axial >= this.buckling * 0.999;
      c.bowT = bowing ? (c.bowT ?? 0) + h : Math.max(0, (c.bowT ?? 0) - h);
      if (c.bowT > c.bowMax) c.bowMax = c.bowT;
      if (c.bowT >= this.bowTime || lateral > this.bending) {
        this.broken = true;
        c.broke = lateral > this.bending && c.bowT < this.bowTime ? 'bending' : 'buckling';
        this.onBreak?.(c);
        return;
      }
    }
    if (!hit && this.contact) {
      this.contact.ticks = (this.contact.ticks ?? 0) + 1;
    }
  }

  /** Called once per frame by the sim: closes a strike once the coronel has left the target. */
  settle() {
    const c = this.contact;
    if (c && (c.ticks ?? 0) > 60) {   // a whole frame of substeps clear of the target
      this.history.push(c);
      this.contact = null;
      return c;
    }
    return null;
  }
}
