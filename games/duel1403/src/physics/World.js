import { Vector3 } from 'three';
import { applyPairCorrection } from './solver.js';
import { Contact, collide } from './collision.js';

const _pA = new Vector3(), _pB = new Vector3(), _pAp = new Vector3(), _pBp = new Vector3();
const _dp = new Vector3(), _corr = new Vector3(), _v = new Vector3(), _vA = new Vector3(), _vB = new Vector3();
const _t = new Vector3();

/**
 * Impact record: everything a game needs to know about two bodies hitting
 * each other during one frame (all substeps summed).
 */
export class Impact {
  constructor() {
    this.bodyA = null;
    this.bodyB = null;
    this.shapeA = null;
    this.shapeB = null;
    this.impulse = 0;             // N s, total normal impulse over the frame
    this.impulseT = 0;            // N s, total friction impulse over the frame
    this.work = 0;                // J, energy the contact dissipated (normal + sliding)
    this.peakForce = 0;           // N
    this.approachSpeed = 0;       // m/s, max closing speed at first touch
    this.point = new Vector3();   // impulse-weighted contact point
    this.normal = new Vector3();  // impulse-weighted normal (B -> A)
    this.isNew = false;           // bodies were not touching last frame
  }
}

/**
 * XPBD rigid body world with substepping (Mueller et al. 2020).
 * One frame = `substeps` substeps of size h = dt / substeps, each with a
 * single constraint-projection iteration. Small substeps make stiff joint
 * chains, heavy mass ratios and fast punches stable and accurate.
 */
export class World {
  constructor({ gravity = new Vector3(0, -9.81, 0), substeps = 20 } = {}) {
    this.gravity = gravity.clone();
    this.substeps = substeps;
    this.bodies = [];
    this.joints = [];
    this.constraints = [];   // custom: { solvePosition(h), solveVelocity(h) }
    this.shapes = [];
    this.planes = [];
    this.collisionFilter = null;  // (shapeA, shapeB) => boolean
    this.materialRule = null;     // (shapeA, shapeB, contact) => void, may override friction etc.
    this.skinMargin = 0;          // added to the broadphase margin when pairSkin is used
    this.pairSkin = null;         // (shapeA, shapeB) => metres of extra thickness on B (clothes over a body)
    this.contacts = [];
    this._contactPool = [];
    this._numContacts = 0;
    this._pairs = [];
    this._excluded = new Set();
    this._impactMap = new Map();
    this._touching = new Set();
    this.impacts = [];
    this.time = 0;
    this.enabled = true;
  }

  addBody(body) {
    this.bodies.push(body);
    for (const s of body.shapes) {
      if (s.type === 'plane') this.planes.push(s);
      else this.shapes.push(s);
    }
    return body;
  }

  removeBody(body) {
    this.bodies = this.bodies.filter((b) => b !== body);
    this.shapes = this.shapes.filter((s) => s.body !== body);
    this.planes = this.planes.filter((s) => s.body !== body);
  }

  addJoint(joint) {
    this.joints.push(joint);
    this.excludePair(joint.parent, joint.child);
    return joint;
  }

  addConstraint(c) {
    this.constraints.push(c);
    return c;
  }

  excludePair(a, b) {
    this._excluded.add(pairKey(a, b));
  }

  _allocContact = () => {
    let c = this._contactPool[this._numContacts];
    if (!c) {
      c = new Contact();
      this._contactPool.push(c);
    }
    this._numContacts++;
    return c;
  };

  _broadphase(dt) {
    const pairs = this._pairs;
    pairs.length = 0;
    const shapes = this.shapes;
    for (const s of shapes) {
      const b = s.body;
      const margin = b.isStatic ? 0.01 : b.vel.length() * dt + b.omega.length() * dt * 0.3 + 0.02 + this.skinMargin;
      s.computeAabb(margin);
    }
    for (let i = 0; i < shapes.length; i++) {
      const a = shapes[i];
      if (!a.collidesWithBodies) continue;
      for (let j = i + 1; j < shapes.length; j++) {
        const b = shapes[j];
        if (!b.collidesWithBodies) continue;
        if (a.body === b.body) continue;
        if (a.body.isStatic && b.body.isStatic) continue;
        if (!a.aabb.intersectsBox(b.aabb)) continue;
        if (this._excluded.has(pairKey(a.body, b.body))) continue;
        if (this.collisionFilter && !this.collisionFilter(a, b)) continue;
        pairs.push(a, b);
      }
    }
    for (const p of this.planes) {
      for (const s of shapes) {
        if (s.body.isStatic || !s.collidesWithPlane) continue;
        // Lowest AABB corner along the plane normal.
        const n = p.normal, bx = s.aabb;
        const lo = (n.x > 0 ? bx.min.x : bx.max.x) * n.x + (n.y > 0 ? bx.min.y : bx.max.y) * n.y + (n.z > 0 ? bx.min.z : bx.max.z) * n.z;
        if (lo > p.constant) continue;
        if (this.collisionFilter && !this.collisionFilter(s, p)) continue;
        pairs.push(s, p);
      }
    }
  }

  step(dt) {
    if (!this.enabled) return;
    const n = this.substeps;
    const h = dt / n;
    this._impactMap.forEach((imp) => { imp.impulse = 0; imp.impulseT = 0; imp.work = 0; imp.peakForce = 0; imp.approachSpeed = 0; imp._w = 0; imp.point.set(0, 0, 0); imp.normal.set(0, 0, 0); });
    this._broadphase(dt);

    for (let sub = 0; sub < n; sub++) {
      for (const b of this.bodies) b.integrate(h, this.gravity);

      for (const j of this.joints) j.solveDrive(h);
      for (const j of this.joints) j.solveLimits(h);
      for (const j of this.joints) j.solveAttachment(h);
      for (const c of this.constraints) if (c.solvePosition) c.solvePosition(h);

      this._generateContacts();
      this._solveContactPositions(h);

      for (const b of this.bodies) b.updateVelocities(h);

      for (const j of this.joints) j.solveVelocity(h);
      for (const c of this.constraints) if (c.solveVelocity) c.solveVelocity(h);
      this._solveContactVelocities(h);
    }

    this._collectImpacts();
    this.time += dt;
  }

  _generateContacts() {
    this._numContacts = 0;
    const pairs = this._pairs;
    for (let i = 0; i < pairs.length; i += 2) {
      const a = pairs[i], b = pairs[i + 1];
      a.updateWorld();
      b.updateWorld();
      collide(a, b, this._allocContact, this.pairSkin ? this.pairSkin(a, b) : 0);
    }
  }

  _solveContactPositions(h) {
    for (let i = 0; i < this._numContacts; i++) {
      const c = this._contactPool[i];
      const sa = c.shapeA, sb = c.shapeB;
      const A = sa.body, B = sb.body;
      A.worldToLocal(c.pA, c.rA);
      B.worldToLocal(c.pB, c.rB);
      A.velocityAt(c.pA, _vA);
      B.velocityAt(c.pB, _vB);
      c.vnPre = _v.subVectors(_vA, _vB).dot(c.normal);
      c.compliance = sa.compliance + sb.compliance;       // springs in series
      c.damping = Math.max(sa.damping, sb.damping);
      c.friction = Math.sqrt(sa.friction * sb.friction);
      c.restitution = Math.max(sa.restitution, sb.restitution);
      c.lambdaT = 0;
      c.slipSpeed = 0;
      if (this.materialRule) this.materialRule(sa, sb, c);

      _corr.copy(c.normal).multiplyScalar(c.depth);
      c.lambdaN = applyPairCorrection(A, B, _corr, c.compliance, h, c.pA, c.pB);

      // Coulomb friction at the position level: undo the tangential slip of
      // the contact points during this substep, with the friction impulse
      // capped by mu * normal impulse. Capping (rather than all-or-nothing)
      // lets the several points of one manifold share the load correctly.
      A.localToWorld(c.rA, _pA);
      B.localToWorld(c.rB, _pB);
      A.prevLocalToWorld(c.rA, _pAp);
      B.prevLocalToWorld(c.rB, _pBp);
      _dp.subVectors(_pA, _pAp).sub(_pB).add(_pBp);
      _dp.addScaledVector(c.normal, -_dp.dot(c.normal));
      const slip = _dp.length();
      if (slip > 1e-12 && c.lambdaN > 0) {
        _t.copy(_dp).multiplyScalar(1 / slip);
        const w = A.getInverseMass(_t, _pA) + B.getInverseMass(_t, _pB);
        if (w > 0) {
          const sticking = slip / w <= c.friction * c.lambdaN;
          const maxLambda = sticking ? Infinity : KINETIC_RATIO * c.friction * c.lambdaN;
          _dp.negate();
          c.lambdaT = applyPairCorrection(A, B, _dp, 0, h, _pA, _pB, maxLambda);
          c.slipSpeed = slip / h;
        }
      }
      this._recordImpact(c, h);
    }
  }

  _solveContactVelocities(h) {
    const g = this.gravity.length();
    for (let i = 0; i < this._numContacts; i++) {
      const c = this._contactPool[i];
      if (c.lambdaN <= 0) continue;
      const A = c.shapeA.body, B = c.shapeB.body;
      A.localToWorld(c.rA, _pA);
      B.localToWorld(c.rB, _pB);
      A.velocityAt(_pA, _vA);
      B.velocityAt(_pB, _vB);
      _v.subVectors(_vA, _vB);
      const vn = _v.dot(c.normal);
      // Normal response (friction was handled at the position level)
      if (c.compliance > 0) {
        // Padding: dashpot while compressing (Hunt-Crossley style, no stickiness).
        if (vn < 0 && c.damping > 0) {
          const w = A.getInverseMass(c.normal, _pA) + B.getInverseMass(c.normal, _pB);
          const dvn = (c.damping * h * w * -vn) / (1 + c.damping * h * w);
          _corr.copy(c.normal).multiplyScalar(dvn);
          const J = applyPairCorrection(A, B, _corr, 0, h, _pA, _pB, Infinity, true);
          // The dashpot's impulse and the energy it absorbs are part of the hit.
          if (c.imp) { c.imp.impulse += J; c.imp.work += J * -vn * 0.6; }
        }
      } else {
        const e = Math.abs(vn) <= 2 * g * h ? 0 : c.restitution;
        const dvn = -vn + Math.max(-e * c.vnPre, 0);
        if (Math.abs(dvn) > 1e-9) {
          _corr.copy(c.normal).multiplyScalar(dvn);
          applyPairCorrection(A, B, _corr, 0, h, _pA, _pB, Infinity, true);
        }
      }
    }
  }

  _recordImpact(c, h) {
    const A = c.shapeA.body, B = c.shapeB.body;
    const key = pairKey(A, B);
    let imp = this._impactMap.get(key);
    if (!imp) {
      imp = new Impact();
      imp._w = 0;
      this._impactMap.set(key, imp);
    }
    // Keep a consistent orientation: bodyA is whichever has the smaller id.
    const flip = A.id > B.id;
    imp.bodyA = flip ? B : A;
    imp.bodyB = flip ? A : B;
    imp.shapeA = flip ? c.shapeB : c.shapeA;
    imp.shapeB = flip ? c.shapeA : c.shapeB;
    c.imp = imp;
    const J = c.lambdaN / h;
    imp.impulse += J;
    const Jt = c.lambdaT / h;
    imp.impulseT += Jt;
    imp.work += 0.75 * (J * Math.max(0, -c.vnPre) + Jt * c.slipSpeed);
    const F = c.lambdaN / (h * h);
    if (F > imp.peakForce) imp.peakForce = F;
    const closing = -c.vnPre;
    if (closing > imp.approachSpeed) imp.approachSpeed = closing;
    imp.point.addScaledVector(c.pA, J + 1e-12);
    imp.normal.addScaledVector(c.normal, flip ? -(J + 1e-12) : (J + 1e-12));
    imp._w += J + 1e-12;
  }

  _collectImpacts() {
    this.impacts.length = 0;
    const nowTouching = new Set();
    this._impactMap.forEach((imp, key) => {
      if (imp._w <= 0) return;
      imp.point.multiplyScalar(1 / imp._w);
      if (imp.normal.lengthSq() > 0) imp.normal.normalize();
      imp.isNew = !this._touching.has(key);
      nowTouching.add(key);
      this.impacts.push(imp);
    });
    this._touching = nowTouching;
  }
}

const KINETIC_RATIO = 0.85; // mu_kinetic / mu_static

function pairKey(a, b) {
  return a.id < b.id ? a.id * 100000 + b.id : b.id * 100000 + a.id;
}
