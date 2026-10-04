import { Vector3, Quaternion } from 'three';
import { Body, Joint, Shape } from '../physics/index.js';
import { applyPairCorrection } from '../physics/solver.js';
import { quatToRotVec } from '../physics/math.js';
import { WEAPONS, OFFHAND } from '../data/weapons.js';

const STEEL = { friction: 0.16, restitution: 0.18, compliance: 1 / 4e6, damping: 250 };
const WOOD = { friction: 0.35, restitution: 0.1, compliance: 1 / 1.5e6, damping: 400 };

/**
 * Mass properties of a weapon from its parts, in the hilt frame.
 * Rods are sliced; a blade's linear density is tilted so its centre of
 * mass lands where the part says (distal taper).
 */
export function massProperties(def) {
  const pts = [];   // [x, y, z, m, ix, iy, iz] (ix.. = intrinsic inertia of the lump)
  const rod = (x, y0, y1, m, comY = null, n = 14) => {
    const L = y1 - y0;
    let k = 0;
    if (comY !== null && L > 1e-6) k = Math.max(-1.9, Math.min(1.9, ((comY - y0) / L - 0.5) * 12));
    let wsum = 0;
    const ws = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const w = 1 + k * (t - 0.5);
      ws.push(w);
      wsum += w;
    }
    for (let i = 0; i < n; i++) pts.push([x, y0 + ((i + 0.5) / n) * L, 0, (m * ws[i]) / wsum, 0, 0, 0]);
  };
  for (const p of def.parts) {
    switch (p.kind) {
      case 'blade': rod(0, p.y0, p.y1, p.mass, p.com ?? null); break;
      case 'grip': case 'haft': rod(0, p.y0, p.y1, p.mass); break;
      case 'cross': {
        const n = 8;
        for (let i = 0; i < n; i++) pts.push([-p.half + ((i + 0.5) / n) * 2 * p.half, p.y, 0, p.mass / n, 0, 0, 0]);
        break;
      }
      case 'pommel': {
        const I = 0.4 * p.mass * p.r * p.r;
        pts.push([0, p.y, 0, p.mass, I, I, I]);
        break;
      }
      case 'rondel': {
        const I = 0.25 * p.mass * p.r * p.r;
        pts.push([0, p.y, 0, p.mass, I, 2 * I, I]);
        break;
      }
      case 'head': {
        const x = p.x ?? 0;
        if (Math.abs(x) > 0.04 && (p.sub === 'hammer' || p.sub === 'beak')) {
          const n = 6;
          for (let i = 0; i < n; i++) pts.push([(x * (i + 0.5)) / n, (p.y0 + p.y1) / 2, 0, p.mass / n, 0, 0, 0]);
        } else {
          rod(x * 0.6, p.y0, p.y1, p.mass);
        }
        break;
      }
      default: break;
    }
  }
  let M = 0;
  const com = new Vector3();
  for (const [x, y, z, m] of pts) { M += m; com.x += x * m; com.y += y * m; com.z += z * m; }
  com.multiplyScalar(1 / M);
  const I = new Vector3();
  for (const [x, y, z, m, ix, iy, iz] of pts) {
    const dx = x - com.x, dy = y - com.y, dz = z - com.z;
    I.x += m * (dy * dy + dz * dz) + ix;
    I.y += m * (dx * dx + dz * dz) + iy;
    I.z += m * (dx * dx + dy * dy) + iz;
  }
  // Floor the roll inertia so a thin rod stays numerically sane.
  I.y = Math.max(I.y, 2e-4);
  return { mass: M, com, inertia: I };
}

/**
 * Pulls the weapon towards a target pose with bounded, compliant force and
 * torque applied *between the weapon and the chest* — the coordinated work
 * of shoulders, arms and wrists. Equal and opposite, so swinging a heavy
 * weapon really turns the body, and the caps keep a poleaxe slower than a
 * dagger.
 */
export class WeaponDrive {
  constructor(weapon, chest) {
    this.weapon = weapon;
    this.chest = chest;
    this.point = new Vector3();       // local control point on the weapon
    this.target = new Vector3();
    this.targetVel = new Vector3();
    this.targetQ = new Quaternion();
    this.targetOmega = new Vector3();
    this.k = 0; this.c = 0; this.maxF = 0;
    this.kr = 0; this.cr = 0; this.maxT = 0;
    this.enabled = true;
  }

  solvePosition(h) {
    if (!this.enabled) return;
    const W = this.weapon.body, C = this.chest;
    if (this.k > 0) {
      W.localToWorld(this.point, _p);
      _c.subVectors(this.target, _p);
      applyPairCorrection(W, C, _c, 1 / this.k, h, _p, C.pos, this.maxF * h * h);
    }
    if (this.kr > 0) {
      _q.copy(W.q).invert().premultiply(this.targetQ);
      quatToRotVec(_q, _c);
      applyPairCorrection(W, C, _c, 1 / this.kr, h, null, null, this.maxT * h * h);
    }
  }

  solveVelocity(h) {
    if (!this.enabled) return;
    const W = this.weapon.body, C = this.chest;
    if (this.c > 0) {
      W.localToWorld(this.point, _p);
      W.velocityAt(_p, _v).sub(this.targetVel);
      const vl = _v.length();
      if (vl > 1e-6) {
        _n.copy(_v).multiplyScalar(1 / vl);
        const w = W.getInverseMass(_n, _p) + C.getInverseMass(_n, C.pos);
        let dv = (this.c * h * w * vl) / (1 + this.c * h * w);
        dv = Math.min(dv, this.maxF * h * w);
        _c.copy(_n).multiplyScalar(-dv);
        applyPairCorrection(W, C, _c, 0, h, _p, C.pos, Infinity, true);
      }
    }
    if (this.cr > 0) {
      _v.subVectors(W.omega, this.targetOmega);
      const wl = _v.length();
      if (wl > 1e-6) {
        _n.copy(_v).multiplyScalar(1 / wl);
        const wi = W.getInverseMass(_n, null) + C.getInverseMass(_n, null);
        let dw = (this.cr * h * wi * wl) / (1 + this.cr * h * wi);
        dw = Math.min(dw, this.maxT * h * wi);
        _c.copy(_n).multiplyScalar(-dw);
        applyPairCorrection(W, C, _c, 0, h, null, null, Infinity, true);
      }
    }
  }
}

const _p = new Vector3(), _c = new Vector3(), _v = new Vector3(), _n = new Vector3(), _q = new Quaternion();

/**
 * A weapon in the world: one rigid body, held by one or two grip joints
 * (ball joints between the hand and a point on the weapon). Changing grip
 * (half-sword, Mordschlag) slides those points along the weapon.
 */
export class Weapon {
  constructor(world, id, { owner, offhand = 'none' } = {}) {
    const def = WEAPONS[id];
    this.id = id;
    this.def = def;
    this.world = world;
    this.owner = owner;
    const mp = massProperties(def);
    this.mass = mp.mass;
    this.com = mp.com;               // hilt-frame position of the COM
    const body = new Body({ name: 'weapon-' + id, mass: mp.mass, inertia: mp.inertia, angularDamping: 0.05, linearDamping: 0.01 });
    this.body = body;
    body.userData = { fighter: owner, weapon: true };
    this.length = 0;
    for (const p of def.parts) {
      const mat = p.kind === 'haft' ? WOOD : STEEL;
      const ud = (extra) => ({ fighter: owner, weapon: true, weaponPart: extra.part, ...extra });
      const off = (x, y, z = 0) => new Vector3(x - this.com.x, y - this.com.y, z - this.com.z);
      switch (p.kind) {
        case 'blade': {
          const half = Math.max(0.001, (p.y1 - p.y0) / 2 - p.r * 0.5);
          body.addShape(Shape.capsule(p.r, half, new Vector3(0, 1, 0), off(0, (p.y0 + p.y1) / 2), { ...STEEL, userData: ud({ part: 'blade', y0: p.y0, y1: p.y1 }) }));
          this.tipY = p.y1;
          this.bladeY0 = p.y0;
          break;
        }
        case 'haft': {
          const half = (p.y1 - p.y0) / 2;
          body.addShape(Shape.capsule(p.r + 0.003, half, new Vector3(0, 1, 0), off(0, (p.y0 + p.y1) / 2), { ...WOOD, userData: ud({ part: 'haft', y0: p.y0, y1: p.y1 }) }));
          break;
        }
        case 'cross':
          body.addShape(Shape.capsule(p.r + 0.003, p.half - p.r, new Vector3(1, 0, 0), off(0, p.y), { ...STEEL, userData: ud({ part: 'cross' }) }));
          break;
        case 'pommel':
          body.addShape(Shape.sphere(p.r, off(0, p.y), { ...STEEL, userData: ud({ part: 'pommel' }) }));
          this.pommelY = p.y;
          break;
        case 'rondel':
          body.addShape(Shape.sphere(p.r * 0.7, off(0, p.y), { ...STEEL, userData: ud({ part: 'rondel' }) }));
          break;
        case 'head': {
          const x = p.x ?? 0;
          if (p.sub === 'hammer' || p.sub === 'beak') {
            const y = (p.y0 + p.y1) / 2;
            const half = Math.max(0.005, Math.abs(x) / 2 - p.r * 0.5);
            body.addShape(Shape.capsule(p.r, half, new Vector3(1, 0, 0), off(x / 2, y), { ...STEEL, userData: ud({ part: p.sub, faceX: Math.sign(x) }) }));
          } else {
            const half = Math.max(0.005, (p.y1 - p.y0) / 2 - p.r * 0.5);
            body.addShape(Shape.capsule(p.r, half, new Vector3(0, 1, 0), off(x * 0.75, (p.y0 + p.y1) / 2), { ...STEEL, userData: ud({ part: p.sub, faceX: Math.sign(x) }) }));
          }
          if (p.sub === 'spike' || p.sub === 'flanges') this.tipY = Math.max(this.tipY ?? -Infinity, p.y1);
          if (p.sub === 'butt') this.buttY = p.y0;
          break;
        }
        default: break;
      }
    }
    if (this.tipY === undefined) this.tipY = 0.1;
    // Where the weapon does its work (percussion point / head centre).
    const blade = def.parts.find((p) => p.kind === 'blade');
    const head = def.parts.find((p) => p.kind === 'head' && (p.sub === 'axe' || p.sub === 'hammer' || p.sub === 'flanges'));
    this.strikeY = head ? (head.y0 + head.y1) / 2 : blade ? blade.y0 + 0.72 * (blade.y1 - blade.y0) : this.tipY * 0.7;
    this.hands = def.hands;
    this.grips = def.grips;
    this.joints = {};
    this.gripY = { R: def.grips.main, L: def.hands === 2 ? def.grips.off : null };
    this.gripTarget = { ...this.gripY };
    this.mode = 'normal';
    world.addBody(body);

    this.offhand = null;
    if (offhand === 'buckler' && def.hands === 1) {
      const o = OFFHAND.buckler;
      const b = new Body({ name: 'buckler', mass: o.mass, inertia: new Vector3(0.25 * o.mass * o.radius ** 2, 0.25 * o.mass * o.radius ** 2, 0.5 * o.mass * o.radius ** 2), angularDamping: 0.1 });
      b.userData = { fighter: owner, weapon: true, buckler: true };
      // Disc in the local XZ plane, face towards local -Y (away from the fist).
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        b.addShape(Shape.capsule(0.02, o.radius - 0.02, new Vector3(Math.cos(a), 0, Math.sin(a)), new Vector3(0, -0.04, 0), { ...STEEL, userData: { fighter: owner, weapon: true, weaponPart: 'buckler' } }));
      }
      b.addShape(Shape.sphere(0.05, new Vector3(0, -0.06, 0), { ...STEEL, userData: { fighter: owner, weapon: true, weaponPart: 'buckler' } }));
      world.addBody(b);
      this.offhand = { kind: 'buckler', body: b, def: o };
    }
  }

  /** Hilt-frame point -> body-local (COM-relative) point. */
  local(y, x = 0, out = new Vector3()) {
    return out.set(x - this.com.x, y - this.com.y, -this.com.z);
  }

  /** Puts the weapon so that hilt-frame point `y` sits at `pos`, oriented by q. */
  placeAt(pos, q, y = this.gripY.R) {
    const b = this.body;
    b.q.copy(q);
    this.local(y, 0, _p).applyQuaternion(q);
    b.pos.copy(pos).sub(_p);
    b.prevPos.copy(b.pos);
    b.prevQ.copy(b.q);
    b.vel.set(0, 0, 0);
    b.omega.set(0, 0, 0);
  }

  /** Creates the grip joints to the fighter's hands. */
  attach(ragdoll) {
    this.ragdoll = ragdoll;
    const handLocal = (side) => ragdoll.bones['arm' + side].lowerEnd;
    for (const side of ['R', 'L']) {
      if (this.gripY[side] === null || this.gripY[side] === undefined) continue;
      const fore = ragdoll.bodies['forearm' + side];
      const anchor = fore.localToWorld(handLocal(side), new Vector3());
      const j = new Joint(fore, this.body, { name: 'grip' + side, anchor });
      j.hasLimits = false;
      j.driveEnabled = false;
      j.anchorParent.copy(handLocal(side));
      j.anchorChild.copy(this.local(this.gripY[side]));
      for (const b of ragdoll.list) this.world.excludePair(b, this.body);
      if (side === 'R') {
        this.world.addJoint(j);
        this.joints[side] = j;
      } else {
        // The second hand closes on the grip once it gets there.
        this.pending = j;
      }
    }
    if (this.offhand) {
      const fore = ragdoll.bodies.forearmL;
      const ob = this.offhand.body;
      const anchor = fore.localToWorld(handLocal('L'), new Vector3());
      ob.q.copy(fore.q);
      ob.pos.copy(anchor);
      ob.prevPos.copy(ob.pos);
      ob.prevQ.copy(ob.q);
      const j = new Joint(fore, ob, { name: 'buckler', anchor, twist: [0, 0], swing1: [0, 0], swing2: [0, 0] });
      j.driveEnabled = false;
      this.world.addJoint(j);
      this.offhand.joint = j;
      for (const b of ragdoll.list) this.world.excludePair(b, ob);
      this.world.excludePair(ob, this.body);
    }
  }

  /** Grip modes: 'normal', 'half' (left hand on the blade), 'mord' (both hands on the blade). */
  setMode(mode) {
    if (mode === this.mode) return;
    const g = this.grips;
    if (mode === 'half' && g.half === undefined) return;
    if (mode === 'mord' && !g.mord) return;
    this.mode = mode;
    if (mode === 'normal') this.gripTarget = { R: g.main, L: this.hands === 2 ? g.off : null };
    else if (mode === 'half') this.gripTarget = { R: g.main, L: g.half };
    else if (mode === 'mord') this.gripTarget = { R: g.mord[0], L: g.mord[1] };
  }

  /** Slides the hands along the weapon towards the current grip mode. */
  update(dt) {
    for (const side of ['R', 'L']) {
      const j = this.joints[side];
      const target = this.gripTarget[side];
      if (!j || target === null || target === undefined) continue;
      const cur = this.gripY[side];
      const step = 3.2 * dt;  // m/s along the weapon
      const next = Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step;
      if (next !== cur) {
        this.gripY[side] = next;
        this.local(next, 0, j.anchorChild);
      }
    }
  }

  /** Closes the second hand on the grip when it is close enough. */
  tryGrip() {
    const j = this.pending;
    if (!j || !this.joints.R) return false;
    j.parent.localToWorld(j.anchorParent, _p);
    this.body.localToWorld(j.anchorChild, _v);
    if (_p.distanceTo(_v) > 0.06) return false;
    this.world.addJoint(j);
    this.joints.L = j;
    this.pending = null;
    return true;
  }

  /** World position where the pending hand should go. */
  pendingTarget(out) {
    if (!this.pending) return null;
    return this.body.localToWorld(this.pending.anchorChild, out);
  }

  /** The hand lets go (a wound, a disarm). */
  release(side) {
    const j = this.joints[side];
    if (!j) return;
    this.world.joints = this.world.joints.filter((x) => x !== j);
    delete this.joints[side];
    if (side === 'R' && this.joints.L) {
      // Keep fighting with the left hand: it becomes the main grip.
      this.gripY.R = null;
    }
  }

  get held() {
    return !!(this.joints.R || this.joints.L);
  }

  /** World position of a hilt-frame point. */
  worldPoint(y, out, x = 0) {
    return this.body.localToWorld(this.local(y, x, _p), out);
  }

  /** World direction of the blade/haft axis (+Y). */
  axis(out) {
    return out.set(0, 1, 0).applyQuaternion(this.body.q);
  }

  edgeDir(out) {
    return out.set(1, 0, 0).applyQuaternion(this.body.q);
  }
}
