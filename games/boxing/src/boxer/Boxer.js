import { Vector3, Quaternion } from 'three';
import { Ragdoll } from './Ragdoll.js';
import { BalanceAssist } from './BalanceAssist.js';
import { ReachAssist } from './ReachAssist.js';
import { solveTwoBone, lookRotation } from './ik.js';
import { PUNCHES, DEFENSES } from './moves.js';
import { rotVecToQuat, clamp, smoothstep } from '../physics/math.js';

const deg = Math.PI / 180;
const UP = new Vector3(0, 1, 0);
const RING_HALF = 2.75;      // inside the ropes, minus a body width

const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _pole = new Vector3();
const _q = new Quaternion(), _q2 = new Quaternion(), _q3 = new Quaternion(), _qp = new Quaternion();
const _qu = new Quaternion(), _ql = new Quaternion(), _rv = new Vector3();
const _hip = new Vector3(), _ankle = new Vector3(), _sh = new Vector3(), _G = new Vector3(), _T = new Vector3();
const _C = new Vector3(), _P = new Vector3(), _dir = new Vector3();

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function bezier(p0, p1, p2, t, out) {
  const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
  return out.set(
    a * p0.x + b * p1.x + c * p2.x,
    a * p0.y + b * p1.y + c * p2.y,
    a * p0.z + b * p1.z + c * p2.z,
  );
}

/** 0 -> 1 -> 0 envelope with ease in/out and a hold in the middle. */
function envelope(s, inEnd = 0.3, outStart = 0.65) {
  if (s <= 0 || s >= 1) return 0;
  if (s < inEnd) return smoothstep(0, inEnd, s);
  if (s < outStart) return 1;
  return 1 - smoothstep(outStart, 1, s);
}

/**
 * A fighter: ragdoll + motor control.
 *
 * Every physics frame the controller turns high-level intent (move, punch,
 * slip, block) into joint targets via IK and pose layers. Nothing is
 * animated directly: the muscles (joint drives with torque limits) have to
 * move the mass, so speed, reach and power come out of the physics, and
 * getting hit genuinely disturbs the body.
 */
export class Boxer {
  constructor(world, {
    id, name = 'Boxer', stance = 'orthodox', height = 1.8, mass = 80,
    position = new Vector3(), yaw = 0, attributes = {},
  }) {
    this.id = id;
    this.name = name;
    this.world = world;
    this.ragdoll = new Ragdoll(world, { id, height, mass });
    this.ragdoll.place(position, yaw);
    this.b = this.ragdoll.bodies;
    this.j = this.ragdoll.joints;
    this.anat = this.ragdoll.anatomy;
    this.scale = this.anat.scale;
    this.ss = stance === 'southpaw' ? -1 : 1;
    this.leadSide = this.ss > 0 ? 'L' : 'R';
    this.rearSide = this.ss > 0 ? 'R' : 'L';
    this.attr = { power: 1, speed: 1, chin: 1, stamina: 1, defense: 1, ...attributes };

    this.center = new Vector3(position.x, 0, position.z);
    this.centerVel = new Vector3();
    this.yaw = yaw;
    this.forward = new Vector3();
    this.left = new Vector3();
    this._updateAxes();

    this.assist = world.addConstraint(new BalanceAssist(this.b.pelvis, this.ragdoll.totalMass));
    this.reach = {};
    for (const side of ['L', 'R']) {
      const bone = this.ragdoll.bones['arm' + side];
      this.reach[side] = world.addConstraint(new ReachAssist(bone.lowerBody, bone.lowerEnd, this.b.chest, bone.rootLocalInParent));
      this.reach[side].prevTarget = new Vector3();
    }
    this.pelvisRestY = this.b.pelvis.userData.restPos.y;
    this.stanceHeight = this.pelvisRestY - 0.075 * this.scale;   // knees bent, athletic

    this.feet = {};
    for (const side of ['L', 'R']) this.feet[side] = { side, planted: true, pos: new Vector3(), yaw, swing: null, lastStep: 0 };
    this._resetFeetFromBody();

    this.opponent = null;
    this.time = 0;
    this.intent = { moveX: 0, moveY: 0, block: false };
    this.handTargets = { L: new Vector3(), R: new Vector3() };
    this.pose = {};
    this.resetCondition();
  }

  resetCondition() {
    this.state = 'fight';
    this.stamina = 100;
    this.maxStamina = 100;
    this.health = 100;
    this.stun = 0;
    this.bodyDamage = 0;
    this.faceDamage = 0;
    this.punch = null;
    this.queued = null;
    this.defense = null;
    this.flinch = 0;
    this.flinchDir = new Vector3();
    this.downTime = 0;
    this.getUpTime = 0;
    this.willGetUp = true;
    this.activation = 1;
    this.balance = 1;
    this.knockdownsThisRound = 0;
    this.stats = { thrown: 0, landed: 0, powerThrown: 0, powerLanded: 0, knockdowns: 0, damageDealt: 0 };
    this.roundStats = { thrown: 0, landed: 0, powerLanded: 0, damage: 0, knockdowns: 0 };
    this.lastPunchTime = -10;
    this.pendingCollapse = 0;
    this.aimError = null;
  }

  // --------------------------------------------------------------------------
  // Public control API (used by the player input and the AI)

  get isDown() {
    return this.state === 'down' || this.state === 'ko';
  }

  get canAct() {
    return this.state === 'fight';
  }

  get isBlocking() {
    return this.canAct && this.intent.block && !this.punch;
  }

  throwPunch(type, level = 'head') {
    if (!this.canAct) return false;
    const def = PUNCHES[type];
    if (!def) return false;
    if (this.punch) {
      // Combination: buffer the next punch if this one is on its way back.
      const s = Math.max(0, this.punch.t - this.punch.lead) / this.punch.duration;
      if (s > this.punch.def.extend * 0.8) this.queued = { type, level };
      return false;
    }
    if (this.defense && this.defense.t / this.defense.def.duration < 0.55) {
      this.queued = { type, level };
      return false;
    }
    this._startPunch(type, level);
    return true;
  }

  defend(kind) {
    if (!this.canAct || this.punch) return false;
    if (this.defense && this.defense.t < this.defense.def.duration * 0.7) return false;
    const def = DEFENSES[kind];
    this.defense = { kind, def, t: 0 };
    this.stamina = Math.max(0, this.stamina - def.cost);
    return true;
  }

  // --------------------------------------------------------------------------

  _startPunch(type, level) {
    const def = PUNCHES[type];
    const side = def.hand === 'lead' ? this.leadSide : this.rearSide;
    const fatigue = this.stamina / this.maxStamina;
    // Tired arms are slow arms: up to 30% longer at zero stamina.
    const speed = this.attr.speed * (0.7 + 0.3 * fatigue) * (1 - 0.25 * Math.max(0, this.stun - 0.3));
    this.punch = {
      type, def, side, level,
      t: 0,
      duration: def.duration / speed,
      target: new Vector3(),
      end: new Vector3(),          // path end (fight-frame coords) when retracting
      landed: false,
      hitBody: null,
      tracking: true,
    };
    this._punchTarget(this.punch, this.punch.target);
    // Out of range? Step in with the punch, as fighters do.
    _v.subVectors(this.punch.target, this.center).setY(0);
    const excess = _v.length() - def.reach * this.scale;
    this.punch.stepIn = clamp(excess, 0, 0.3);
    this.punch.stepped = 0;
    // The step starts first; the arm fires as the lead foot lands.
    this.punch.lead = this.punch.stepIn * 0.35;
    this.stamina = Math.max(0, this.stamina - def.cost * (1.15 - 0.15 * this.attr.stamina));
    this.stats.thrown++;
    this.roundStats.thrown++;
    if (type !== 'jab') this.stats.powerThrown++;
    this.lastPunchTime = this.time;
  }

  /** World-space aim point on the opponent for the current punch. */
  _punchTarget(p, out) {
    const o = this.opponent;
    if (!o) return out.copy(this.center).addScaledVector(this.forward, 1).setY(1.5);
    const def = p.def;
    const head = o.b.head, chest = o.b.chest, abd = o.b.abdomen;
    if (p.level === 'body') {
      if (def.kind === 'hook') out.copy(abd.pos).addScaledVector(UP, 0.05);
      else if (def.kind === 'uppercut') out.copy(chest.pos).addScaledVector(UP, -0.12);
      else out.copy(chest.pos).addScaledVector(UP, -0.1);
    } else {
      // Face: a little below the head's COM (nose/jaw). Uppercuts go for the chin.
      out.copy(head.pos).addScaledVector(UP, def.kind === 'uppercut' ? -0.07 : -0.025);
    }
    if (this.aimError) out.add(this.aimError);
    // Lead the target slightly by its velocity.
    const tLeft = Math.max(0, p.duration * def.extend - p.t) * 0.6;
    const v = p.level === 'body' ? abd.vel : head.vel;
    out.x += v.x * tLeft;
    out.z += v.z * tLeft;
    return out;
  }

  _updateAxes() {
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.left.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** Fight frame -> world: forward, lateral (left +), absolute height. */
  ff(fwd, lat, up, out) {
    return out.copy(this.center).addScaledVector(this.forward, fwd).addScaledVector(this.left, lat).setY(up);
  }

  toFightFrame(world, out) {
    _v.subVectors(world, this.center);
    return out.set(_v.dot(this.forward), _v.dot(this.left), world.y);
  }

  _resetFeetFromBody() {
    for (const side of ['L', 'R']) {
      const bone = this.ragdoll.bones['leg' + side];
      const foot = this.b['foot' + side];
      foot.localToWorld(bone.ankleInFoot, _v);
      const f = this.feet[side];
      f.pos.set(_v.x, 0, _v.z);
      _v2.set(0, 0, 1).applyQuaternion(foot.q);
      f.yaw = Math.atan2(_v2.x, _v2.z);
      f.planted = true;
      f.swing = null;
    }
  }

  /** Teleport to a spot (between rounds / start). */
  placeAt(position, yaw) {
    this.ragdoll.place(new Vector3(position.x, 0, position.z), yaw);
    this.center.set(position.x, 0, position.z);
    this.centerVel.set(0, 0, 0);
    this.yaw = yaw;
    this._updateAxes();
    this._resetFeetFromBody();
    this.punch = null;
    this.queued = null;
    this.defense = null;
    this.state = 'fight';
    this.downTime = 0;
    for (const j of Object.values(this.j)) j.setTarget(new Quaternion(), 0);
  }

  // --------------------------------------------------------------------------
  // Per-frame update

  update(dt) {
    this.time += dt;
    this._updateCondition(dt);

    if (this.state === 'down' || this.state === 'ko') {
      this._relax(dt);
      return;
    }

    this._updateFrame(dt);
    const P = this._computePose(dt);
    this._updateFeet(dt, P);
    this._applyPose(dt, P);
  }

  _updateCondition(dt) {
    const moving = Math.min(1, this.centerVel.length() / 1.2);
    const regen = (this.punch ? 0 : 4.2 - 1.2 * moving) * this.attr.stamina * (1 - 0.5 * this.bodyDamage / 100) * (this.intent.block ? 0.7 : 1);
    this.maxStamina = 100 - 0.35 * this.bodyDamage;
    this.stamina = Math.min(this.maxStamina, this.stamina + regen * dt);
    // Stun wears off; faster when healthy.
    this.stun = Math.max(0, this.stun - dt * (0.1 + 0.12 * this.health / 100));
    this.flinch = Math.max(0, this.flinch - dt * 4);

    const fatigue = this.stamina / 100;
    this.activation = (0.62 + 0.38 * fatigue) * (1 - 0.45 * clamp(this.stun - 0.25, 0, 1));
    this.balance = clamp(1 - 0.9 * Math.max(0, this.stun - 0.3), 0.3, 1);

    if (this.pendingCollapse > 0 && this.state === 'fight') {
      this.pendingCollapse -= dt;
      if (this.pendingCollapse <= 0) {
        this.pendingCollapse = 0;
        this.knockDown();
      }
    }
    if (this.state === 'down') {
      this.downTime += dt;
    } else if (this.state === 'getup') {
      this.getUpTime += dt;
      if (this.getUpTime > 2.6) this.state = 'fight';
    }
  }

  _updateFrame(dt) {
    const o = this.opponent;
    if (o) {
      const dx = o.center.x - this.center.x, dz = o.center.z - this.center.z;
      const targetYaw = Math.atan2(dx, dz);
      const err = wrapAngle(targetYaw - this.yaw);
      const rate = (this.state === 'fight' ? 5 : 2) * dt;
      this.yaw = wrapAngle(this.yaw + clamp(err, -rate, rate));
      this._updateAxes();
    }

    // Footwork: intent -> desired centre velocity.
    let speedMul = this.attr.speed * (0.6 + 0.4 * this.activation);
    if (this.punch) speedMul *= 0.45;
    if (this.intent.block) speedMul *= 0.65;
    if (this.state !== 'fight') speedMul = 0;
    const mx = clamp(this.intent.moveX, -1, 1), my = clamp(this.intent.moveY, -1, 1);
    _v.copy(this.forward).multiplyScalar(my * 1.45 * speedMul).addScaledVector(this.left, -mx * 1.25 * speedMul);
    // accelerate towards it
    _v.sub(this.centerVel);
    const maxDv = 7 * dt;
    if (_v.length() > maxDv) _v.setLength(maxDv);
    this.centerVel.add(_v);
    this.center.addScaledVector(this.centerVel, dt);

    // Yield to external pushes: if the pelvis has been knocked away from where
    // we want it, move the plan with it and let the feet re-step.
    // (Only for external pushes: lag behind our own movement or step-in is
    // expected and must not be undone.)
    const pel = this.b.pelvis.pos;
    _v.subVectors(pel, this.assist.targetPos).setY(0);
    const lagDir = _v2.copy(this.centerVel).setY(0);
    if (this.punch && this.punch.stepIn > 0) lagDir.addScaledVector(this.forward, 1);
    if (lagDir.lengthSq() > 1e-4) {
      lagDir.normalize();
      const along = _v.dot(lagDir);
      if (along < 0) _v.addScaledVector(lagDir, -along);
    }
    const e = _v.length();
    if (e > 0.05) this.center.addScaledVector(_v, ((e - 0.05) / e) * Math.min(1, 5 * dt));

    // Keep a minimum distance to the opponent (bodies would collide anyway).
    if (o) {
      _v.subVectors(this.center, o.center).setY(0);
      const d = _v.length();
      const minD = 0.62;
      if (d < minD && d > 1e-4) this.center.addScaledVector(_v, ((minD - d) / d) * 0.5);
    }
    // Stay inside the ropes.
    this.center.x = clamp(this.center.x, -RING_HALF, RING_HALF);
    this.center.z = clamp(this.center.z, -RING_HALF, RING_HALF);
  }

  /** Builds this frame's pose parameters from stance + actions. */
  _computePose(dt) {
    const ss = this.ss, s = this.scale;
    const P = this.pose;
    const fatigue = 1 - this.stamina / 100;
    P.pelvisFwd = -0.02;
    P.pelvisLat = 0;
    P.height = this.stanceHeight;
    P.pelvisYaw = -ss * 26 * deg;
    P.spineTwist = -ss * 6 * deg;
    P.flex = 8 * deg;
    P.roll = 0;
    P.chinTuck = 12 * deg;
    P.leadFootYawAdd = 0;
    P.rearFootYawAdd = 0;
    P.armDrive = { L: 1, R: 1 };
    P.armTorque = { L: 0.8, R: 0.8 };
    P.reach = P.reach ?? { L: {}, R: {} };
    for (const side of ['L', 'R']) Object.assign(P.reach[side], { k: 1500, c: 60, f: 70 });
    P.torsoDrive = 1;
    P.neckDrive = 1;
    P.poles = P.poles ?? { L: new Vector3(), R: new Vector3() };

    // Guard. Fatigue and being hurt drop the hands.
    const drop = 0.07 * fatigue + 0.18 * clamp(this.stun - 0.35, 0, 1);
    const lead = this.leadSide, rear = this.rearSide;
    const block = this.isBlocking;
    if (this.debugNoGuard) {
      this.ff(0.05 * s, ss * 0.28 * s, 1.0 * s, this.handTargets[lead]);
      this.ff(0.0 * s, -ss * 0.28 * s, 1.0 * s, this.handTargets[rear]);
    } else if (block) {
      this.ff(0.2 * s, ss * 0.085 * s, 1.55 * s, this.handTargets[lead]);
      this.ff(0.19 * s, -ss * 0.075 * s, 1.55 * s, this.handTargets[rear]);
      P.flex += 8 * deg;
      P.chinTuck += 10 * deg;
      P.height -= 0.02 * s;
      P.armDrive[lead] = P.armDrive[rear] = 1.6;
      P.armTorque[lead] = P.armTorque[rear] = 1;
      Object.assign(P.reach[lead], { k: 4000, c: 120, f: 160 });
      Object.assign(P.reach[rear], { k: 4000, c: 120, f: 160 });
      P.neckDrive = 1.35;
    } else {
      this.ff(0.34 * s, ss * 0.13 * s, (1.4 - drop) * s, this.handTargets[lead]);
      this.ff(0.21 * s, -ss * 0.075 * s, (1.44 - drop) * s, this.handTargets[rear]);
    }
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      if (this.debugNoGuard) P.poles[side].copy(this.forward).multiplyScalar(-1).addScaledVector(this.left, sx * 0.4);
      else P.poles[side].copy(UP).multiplyScalar(-1).addScaledVector(this.left, sx * 0.35).addScaledVector(this.forward, -0.15);
    }

    // Hurt fighters sway.
    if (this.stun > 0.4) {
      const k = (this.stun - 0.4) * 0.1;
      P.pelvisLat += Math.sin(this.time * 2.3) * k;
      P.pelvisFwd += Math.sin(this.time * 1.7 + 1) * k * 0.6;
      P.roll += Math.sin(this.time * 2.1) * k * 1.5;
    }

    // Recoil from the last hit (upper body gives, then recovers).
    if (this.flinch > 0) P.flex -= this.flinch * 6 * deg;

    // Defensive head movement.
    if (this.defense) {
      const d = this.defense;
      d.t += dt;
      const e = envelope(d.t / d.def.duration);
      P.pelvisLat += d.def.lat * s * e;
      P.roll += d.def.roll * e;
      P.flex += d.def.flex * e;
      P.spineTwist += ss * d.def.twist * e;
      P.height += d.def.height * s * e;
      P.pelvisFwd -= (d.def.back ?? 0) * s * e;
      if (d.t >= d.def.duration) this.defense = null;
    }

    // Punch.
    const p = this.punch;
    if (p) {
      p.t += dt;
      const def = p.def;
      const sN = Math.max(0, p.t - p.lead) / p.duration;
      const e = def.extend, hEnd = def.extend + def.hold;
      // Torso rotation envelope: optional wind-up, drive through, recover.
      // Kinetic chain: hips and shoulders turn first, the arm follows.
      let r;
      if (sN < e) {
        const x = sN / e;
        r = smoothstep(0, 0.7, x) - def.windup * Math.sin(Math.PI * Math.min(1, x / 0.5)) * Math.max(0, 1 - 2 * x);
      } else if (sN < hEnd) r = 1;
      else r = 1 - smoothstep(hEnd, 1, sN);

      P.pelvisYaw += ss * def.pelvisYaw * r;
      P.spineTwist += ss * (def.chestYaw - def.pelvisYaw) * r;
      P.pelvisFwd += def.shift * s * Math.max(0, r);
      P.flex += def.lean * Math.max(0, r);
      P.height += def.dip * s * Math.max(0, r);
      if (def.preDip) {
        const x = sN / e;
        P.height += def.preDip * s * (sN < e ? Math.sin(Math.PI * Math.min(1, x / 0.7)) * (x < 0.7 ? 1 : 0) : 0);
      }
      if (def.pivotRear) P.rearFootYawAdd = ss * def.pivotRear * Math.max(0, r);
      if (def.pivotLead) P.leadFootYawAdd = ss * def.pivotLead * Math.max(0, r);
      P.torsoDrive = 1.8;
      if (p.stepIn > 0) {
        const want = p.stepIn * smoothstep(0, p.lead + 0.5 * e * p.duration, p.t);
        this.center.addScaledVector(this.forward, want - p.stepped);
        p.stepped = want;
      }

      // Glove path.
      const hand = p.side;
      const sx = hand === 'L' ? 1 : -1;
      _G.copy(this.handTargets[hand]);
      if (p.tracking && sN < e * 0.65) this._punchTarget(p, p.target);
      else p.tracking = false;
      const T = _T.copy(p.target);
      // Follow through: aim past the contact surface.
      this.b.chest.localToWorld(this.ragdoll.bones['arm' + hand].rootLocalInParent, _sh);
      _dir.subVectors(T, _sh).normalize();

      const pole = P.poles[hand];
      if (sN < hEnd) {
        // The target leads the glove (ease-out), so the arm accelerates at
        // its force limit the whole way, like a real ballistic punch.
        const x = clamp((sN / e - def.armDelay) / (1 - def.armDelay), 0, 1);
        const u = 1 - (1 - x) * (1 - x) * (1 - x);
        if (def.kind === 'straight') {
          T.addScaledVector(_dir, def.follow);
          _P.lerpVectors(_G, T, u);
          pole.copy(UP).multiplyScalar(-1).addScaledVector(this.left, sx * 0.25);
        } else if (def.kind === 'hook') {
          // Arc in from the punching side at shoulder height.
          _v.copy(this.left).multiplyScalar(sx * 0.42 * s);
          _C.copy(T).add(_v).addScaledVector(this.forward, -0.18 * s);
          _C.y = T.y + 0.02;
          T.addScaledVector(this.left, -sx * def.follow);
          bezier(_G, _C, T, u, _P);
          pole.copy(this.left).multiplyScalar(sx).addScaledVector(UP, 0.35 + 0.5 * u).addScaledVector(this.forward, -0.25);
        } else {
          // Uppercut: drop, then drive up through the chin.
          _C.copy(T).addScaledVector(UP, -0.36 * s).addScaledVector(this.forward, -0.24 * s);
          _C.addScaledVector(this.left, sx * 0.05);
          T.addScaledVector(UP, def.follow).addScaledVector(this.forward, 0.03);
          bezier(_G, _C, T, u, _P);
          pole.copy(UP).multiplyScalar(-1).addScaledVector(this.forward, -0.5).addScaledVector(this.left, sx * 0.3);
        }
        this.toFightFrame(_P, p.end);
        this.handTargets[hand].copy(_P);
        // While extending, the coordinated reach force leads and the joint
        // drives only keep the elbow in its plane (a stiff elbow would snap
        // the forearm through an arc before the shoulder can lift it).
        const extending = sN < e;
        P.armDrive[hand] = extending ? def.drive : 1.2;
        P.armTorque[hand] = 1;
        const pf = this.attr.power;
        if (extending) Object.assign(P.reach[hand], { k: 12000, c: 12, f: def.force * pf });
        else Object.assign(P.reach[hand], { k: 5000, c: 80, f: 250 });
      } else {
        // Retract straight back to guard.
        const x = smoothstep(hEnd, 1, sN);
        this.ff(p.end.x, p.end.y, p.end.z, _P);
        this.handTargets[hand].lerpVectors(_P, _G, x);
        P.armDrive[hand] = 1.25;
        Object.assign(P.reach[hand], { k: 4000, c: 120, f: 220 });
      }

      if (sN >= 1) {
        this.punch = null;
        this.lastPunchEnd = this.time;
        if (this.queued) {
          const qd = this.queued;
          this.queued = null;
          this._startPunch(qd.type, qd.level);
        }
      }
    } else if (this.queued && !this.defense) {
      const qd = this.queued;
      this.queued = null;
      this._startPunch(qd.type, qd.level);
    }
    return P;
  }

  _footOffsets(side, P, out) {
    const ss = this.ss, s = this.scale;
    const isLead = side === this.leadSide;
    if (isLead) {
      out.fwd = 0.2 * s; out.lat = ss * 0.115 * s; out.yaw = -ss * 12 * deg + P.leadFootYawAdd;
    } else {
      out.fwd = -0.27 * s; out.lat = -ss * 0.125 * s; out.yaw = -ss * 48 * deg + P.rearFootYawAdd;
    }
    return out;
  }

  _updateFeet(dt, P) {
    const off = this._off ?? (this._off = {});
    const moving = this.centerVel.length() > 0.15;
    let best = null, bestErr = 0;
    for (const side of ['L', 'R']) {
      const f = this.feet[side];
      this._footOffsets(side, P, off);
      f.desired = f.desired ?? new Vector3();
      this.ff(off.fwd, off.lat, 0, f.desired).addScaledVector(this.centerVel, 0.12);
      f.desiredYaw = this.yaw + off.yaw;
      if (f.swing) {
        const sw = f.swing;
        sw.t += dt / sw.dur;
        // Retarget in flight so fast footwork stays tight.
        sw.to.copy(f.desired);
        sw.toYaw = f.desiredYaw;
        if (sw.t >= 1) {
          f.pos.copy(sw.to);
          f.yaw = sw.toYaw;
          f.swing = null;
          f.planted = true;
          f.lastStep = this.time;
        }
        continue;
      }
      const err = Math.hypot(f.desired.x - f.pos.x, f.desired.z - f.pos.z) + 0.12 * Math.abs(wrapAngle(f.desiredYaw - f.yaw));
      if (err > bestErr) { bestErr = err; best = f; }
    }
    const other = best && this.feet[best.side === 'L' ? 'R' : 'L'];
    const threshold = moving ? 0.045 : 0.07;
    if (best && bestErr > threshold && other.planted && !other.swing && this.time - other.lastStep > 0.05) {
      const dist = Math.hypot(best.desired.x - best.pos.x, best.desired.z - best.pos.z);
      best.swing = {
        t: 0,
        dur: clamp(0.13 + 0.35 * dist, 0.13, 0.26) / this.attr.speed,
        from: best.pos.clone(),
        to: best.desired.clone(),
        fromYaw: best.yaw,
        toYaw: best.desiredYaw,
        lift: 0.03 + 0.08 * dist,
      };
      best.planted = false;
    }
  }

  _setJointTarget(joint, q, dt) {
    joint.clampRotation(q, q);
    joint.setTarget(q, dt);
  }

  _applyPose(dt, P) {
    const s = this.scale;
    const b = this.b;

    // --- pelvis (balance controller target) -------------------------------
    const pelTarget = this.ff(P.pelvisFwd, P.pelvisLat, P.height, _v3);
    this.assist.targetPos.copy(pelTarget);
    this.assist.targetVel.copy(this.centerVel);
    _qp.setFromAxisAngle(UP, this.yaw + P.pelvisYaw);
    this.assist.targetQ.copy(_qp);
    const grounded = (this.feet.L.planted ? 1 : 0) + (this.feet.R.planted ? 1 : 0);
    const ramp = this.state === 'getup' ? smoothstep(0, 1.6, this.getUpTime) : 1;
    this.assist.strength = this.balance * (grounded > 0 ? 1 : 0.75) * ramp;
    // A lunge: the rear leg drives off harder than for normal footwork.
    this.assist.boost = this.punch && this.punch.stepIn > 0 && this.punch.stepped < this.punch.stepIn * 0.95 ? 1.7 : 1;

    // --- spine --------------------------------------------------------------
    const lumbarShare = 0.4;
    _rv.set(P.flex * 0.45, 0, -P.roll * 0.5);
    rotVecToQuat(_rv, _q);
    _q.multiply(_q2.setFromAxisAngle(UP, P.spineTwist * lumbarShare));
    this._setJointTarget(this.j.lumbar, _q, dt);
    _rv.set(P.flex * 0.55, 0, -P.roll * 0.5);
    rotVecToQuat(_rv, _q);
    _q.multiply(_q2.setFromAxisAngle(UP, P.spineTwist * (1 - lumbarShare)));
    this._setJointTarget(this.j.thoracic, _q, dt);

    // --- head: eyes on the opponent, chin down ------------------------------
    const o = this.opponent;
    if (o) _dir.subVectors(o.b.head.pos, b.head.pos);
    else _dir.copy(this.forward);
    _dir.y = clamp(_dir.y, -0.4, 0.4);
    _dir.normalize();
    lookRotation(_dir, UP, _q);
    _q.multiply(_q2.setFromAxisAngle(_v.set(1, 0, 0), P.chinTuck));
    _q2.copy(b.chest.q).invert().multiply(_q);
    this._setJointTarget(this.j.neck, _q2, dt);

    // --- arms (IK relative to the actual chest) ------------------------------
    for (const side of ['L', 'R']) {
      const bone = this.ragdoll.bones['arm' + side];
      b.chest.localToWorld(bone.rootLocalInParent, _sh);
      const sx = side === 'L' ? 1 : -1;
      _v2.copy(this.forward).multiplyScalar(-1).addScaledVector(this.left, sx * 0.6);
      solveTwoBone(_sh, this.handTargets[side], P.poles[side], bone, _qu, _ql, null, _v2);
      _q.copy(b.chest.q).invert().multiply(_qu);
      this._setJointTarget(this.j['shoulder' + side], _q, dt);
      _q.copy(_qu).invert().multiply(_ql);
      this._setJointTarget(this.j['elbow' + side], _q, dt);
      const ra = this.reach[side], rp = P.reach[side];
      ra.targetVel.subVectors(this.handTargets[side], ra.prevTarget).multiplyScalar(1 / dt);
      if (ra.targetVel.lengthSq() > 400) ra.targetVel.setLength(20);
      ra.prevTarget.copy(this.handTargets[side]);
      ra.target.copy(this.handTargets[side]);
      const ract = 0.5 + 0.5 * this.activation;
      ra.stiffness = rp.k * ract;
      ra.damping = rp.c;
      ra.maxForce = rp.f * ract;
    }

    // --- legs (IK from the desired pelvis pose, so they push towards it) ----
    for (const side of ['L', 'R']) {
      const bone = this.ragdoll.bones['leg' + side];
      const f = this.feet[side];
      _hip.copy(bone.rootLocalInParent).applyQuaternion(_qp).add(pelTarget);
      let footYaw = f.yaw;
      if (f.swing) {
        const sw = f.swing;
        const x = smoothstep(0, 1, sw.t);
        _ankle.lerpVectors(sw.from, sw.to, x);
        _ankle.y = this.anat.J.ankleY + sw.lift * Math.sin(Math.PI * Math.min(1, sw.t));
        footYaw = sw.fromYaw + wrapAngle(sw.toYaw - sw.fromYaw) * x;
      } else {
        _ankle.copy(f.pos).setY(this.anat.J.ankleY);
      }
      _pole.set(Math.sin(footYaw), 0, Math.cos(footYaw)).addScaledVector(this.left, (side === 'L' ? 1 : -1) * 0.25);
      solveTwoBone(_hip, _ankle, _pole, bone, _qu, _ql);
      _q.copy(_qp).invert().multiply(_qu);
      this._setJointTarget(this.j['hip' + side], _q, dt);
      _q.copy(_qu).invert().multiply(_ql);
      this._setJointTarget(this.j['knee' + side], _q, dt);
      _q3.setFromAxisAngle(UP, footYaw);
      _q.copy(_ql).invert().multiply(_q3);
      this._setJointTarget(this.j['ankle' + side], _q, dt);
    }

    // --- muscle activation ----------------------------------------------------
    const act = this.activation * (this.state === 'getup' ? 0.4 + 0.6 * ramp : 1);
    const pw = this.attr.power;
    for (const j of Object.values(this.j)) {
      const m = j.muscle;
      let k = 1, tq = 1;
      switch (j.group) {
        case 'shoulder':
        case 'elbow': {
          const side = j.name.slice(-1);
          k = P.armDrive[side];
          tq = P.armTorque[side] * pw;
          break;
        }
        case 'lumbar':
        case 'thoracic':
          k = P.torsoDrive;
          tq = 0.8 + 0.2 * pw;
          break;
        case 'neck':
          k = P.neckDrive;
          break;
        default:
          break;
      }
      k *= act;
      j.setDrive(m.stiffness * k, m.damping * Math.sqrt(k), m.maxTorque * tq * (0.55 + 0.45 * act));
    }
  }

  /** Unconscious: residual muscle tone only. */
  _relax() {
    this.assist.strength = 0;
    this.reach.L.stiffness = this.reach.R.stiffness = 0;
    this.reach.L.damping = this.reach.R.damping = 0;
    const tone = this.state === 'ko' ? 0.025 : 0.05;
    for (const j of Object.values(this.j)) {
      const m = j.muscle;
      j.setTarget(_q.identity(), 0);
      j.setDrive(m.stiffness * tone, m.damping * 0.35, m.maxTorque * 0.08);
    }
    // Arms fold in a little, like a real knocked-out fighter.
    this.punch = null;
    this.queued = null;
    this.defense = null;
  }

  // --------------------------------------------------------------------------
  // Damage interface (called by the match / damage model)

  applyTrauma({ concussion = 0, body = 0, direction = null }) {
    if (this.state === 'ko') return;
    const chin = this.attr.chin;
    const vulnerability = (1.35 - 0.35 * this.health / 100) / chin;
    this.stun += concussion * vulnerability;
    this.health = Math.max(0, this.health - concussion * 11 / chin - body * 0.3);
    this.bodyDamage = Math.min(100, this.bodyDamage + body * 1.1);
    this.stamina = Math.max(0, this.stamina - body * 1.6 - concussion * 6);
    this.flinch = Math.min(1, this.flinch + concussion * 2 + body * 0.05);
    if (direction) this.flinchDir.copy(direction);
    if (this.state === 'fight' || this.state === 'getup') {
      if (this.stun >= 1 || this.health <= 0) this.knockDown();
    }
  }

  knockDown() {
    if (this.state === 'down' || this.state === 'ko') return;
    this.state = 'down';
    this.downTime = 0;
    this.stats.knockdowns++;
    this.knockdownsThisRound++;
    this.punch = null;
    this.queued = null;
    this.defense = null;
  }

  finish() {
    this.state = 'ko';
  }

  startGetUp() {
    if (this.state !== 'down') return;
    this.state = 'getup';
    this.getUpTime = 0;
    this.stun = 0.55;
    // Re-plan around where the body is lying.
    const pel = this.b.pelvis.pos;
    this.center.set(pel.x, 0, pel.z);
    this.center.x = clamp(this.center.x, -RING_HALF, RING_HALF);
    this.center.z = clamp(this.center.z, -RING_HALF, RING_HALF);
    this.centerVel.set(0, 0, 0);
    const P = this.pose;
    const off = {};
    for (const side of ['L', 'R']) {
      const f = this.feet[side];
      this._footOffsets(side, { leadFootYawAdd: 0, rearFootYawAdd: 0, ...P }, off);
      this.ff(off.fwd, off.lat, 0, f.pos);
      f.yaw = this.yaw + off.yaw;
      f.planted = true;
      f.swing = null;
    }
  }

  headPosition(out) {
    return out.copy(this.b.head.pos);
  }

  /** Is a punch of ours currently travelling (for AI reads / hit crediting). */
  punchPhase() {
    if (!this.punch) return null;
    const s = Math.max(0, this.punch.t - this.punch.lead) / this.punch.duration;
    const e = this.punch.def.extend;
    return { type: this.punch.type, side: this.punch.side, level: this.punch.level, s, extending: s < e + this.punch.def.hold, eta: Math.max(0, (e - s) * this.punch.duration) };
  }
}

