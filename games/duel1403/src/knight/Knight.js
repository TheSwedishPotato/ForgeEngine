import { Vector3, Quaternion } from 'three';
import { Ragdoll } from './Ragdoll.js';
import { BalanceAssist } from './BalanceAssist.js';
import { ReachAssist } from './ReachAssist.js';
import { Weapon, WeaponDrive } from './Weapon.js';
import { resolveArmour, locomotionCost } from './armourProfile.js';
import { solveTwoBone, lookRotation, weaponRotation } from './ik.js';
import { Attack, classifySwipe, thrustName, lerpDir } from './techniques.js';
import { GUARDS, SYSTEMS } from '../data/guards.js';
import { WEAPONS } from '../data/weapons.js';
import { rotVecToQuat, quatToRotVec, clamp, smoothstep } from '../physics/math.js';

const deg = Math.PI / 180;
const UP = new Vector3(0, 1, 0);
export const LISTS_RADIUS = 5.2;   // inside the barrier of the lists

const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _pole = new Vector3();
const _q = new Quaternion(), _q2 = new Quaternion(), _q3 = new Quaternion(), _qp = new Quaternion();
const _qu = new Quaternion(), _ql = new Quaternion(), _rv = new Vector3();
const _hip = new Vector3(), _ankle = new Vector3(), _sh = new Vector3(), _dir = new Vector3();
const _w1 = new Vector3(), _w2 = new Vector3(), _w3 = new Vector3();

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * A fighter: ragdoll + weapon + motor control.
 *
 * Each frame the controller turns intent (move, guard, blow, parry) into a
 * commanded weapon pose, drives the weapon towards it through the arms
 * (weapon drive + arm IK), and keeps the body balanced over its feet. Nothing
 * is animated: muscles with torque limits move real masses, so speed, reach,
 * power, binds and falls come out of the physics.
 */
export class Knight {
  constructor(world, {
    id, name = 'Knight', title = '', position = new Vector3(), yaw = 0, height = 1.78, mass = 78,
    items, weapon = 'longsword', offhand = 'none', strength = 1, skill = 0.7, colors = {}, heraldry = 'none',
  }) {
    this.id = id;
    this.name = name;
    this.title = title;
    this.world = world;
    this.colors = colors;
    this.heraldry = heraldry;
    this.skill = skill;
    this.strength = strength;
    this.profile = resolveArmour(items);
    this.locoCost = locomotionCost(this.profile);
    this.ragdoll = new Ragdoll(world, { id, height, mass, armour: this.profile, strength });
    this.ragdoll.place(position, yaw);
    this.b = this.ragdoll.bodies;
    this.j = this.ragdoll.joints;
    this.anat = this.ragdoll.anatomy;
    this.scale = this.anat.scale;
    this.bodyMass = mass;

    this.center = new Vector3(position.x, 0, position.z);
    this.centerVel = new Vector3();
    this.yaw = yaw;
    this.forward = new Vector3();
    this.left = new Vector3();
    this._updateAxes();

    // Weapon, placed in the right hand, then gripped.
    this.weaponId = weapon;
    this.weapon = new Weapon(world, weapon, { owner: id, offhand });
    this.def = WEAPONS[weapon];
    this.systems = [...this.def.systems];
    this.system = this.systems.find((s) => s !== 'halfsword') ?? this.systems[0];
    this.naming = SYSTEMS[this.system].naming;
    this.guards = GUARDS[this.system];
    this.guardIndex = 0;
    this.guard = this.guards[0];
    this.mode = 'normal';
    this.cmd = { hand: new Vector3(), dir: new Vector3(), edge: new Vector3() };
    this.guardPose = { hand: new Vector3(), dir: new Vector3(), edge: new Vector3() };
    this._computeGuardPose();
    this.cmd.hand.copy(this.guardPose.hand);
    this.cmd.dir.copy(this.guardPose.dir);
    this.cmd.edge.copy(this.guardPose.edge);
    {
      const hand = this.b.forearmR.localToWorld(this.ragdoll.bones.armR.lowerEnd, new Vector3());
      this.ffDir(this.cmd.dir.x, this.cmd.dir.y, this.cmd.dir.z, _w1);
      this.ffDir(this.cmd.edge.x, this.cmd.edge.y, this.cmd.edge.z, _w2);
      weaponRotation(_w1, _w2, _q);
      this.weapon.placeAt(hand, _q);
    }
    this.weapon.attach(this.ragdoll);
    // Inertia about the main grip: what the arms must accelerate in a swing.
    {
      const d = this.weapon.def.grips.main - this.weapon.com.y;
      this.weaponInertia = this.weapon.body.inertia.x + this.weapon.mass * d * d;
    }

    let total = this.ragdoll.totalMass + this.weapon.mass + (this.weapon.offhand ? this.weapon.offhand.def.mass : 0);
    this.totalMass = total;
    this.assist = world.addConstraint(new BalanceAssist(this.b.pelvis, total));
    this.drive = world.addConstraint(new WeaponDrive(this.weapon, this.b.chest));
    const bL = this.ragdoll.bones.armL;
    this.offReach = world.addConstraint(new ReachAssist(bL.lowerBody, bL.lowerEnd, this.b.chest, bL.rootLocalInParent));
    this.offReach.prevTarget = new Vector3();
    this.offTarget = new Vector3();

    this.pelvisRestY = this.b.pelvis.userData.restPos.y;
    this.stanceHeight = this.pelvisRestY - 0.085 * this.scale;
    this.feet = {};
    for (const side of ['L', 'R']) this.feet[side] = { side, planted: true, pos: new Vector3(), yaw, swing: null, lastStep: 0 };
    this._resetFeetFromBody();
    this.pose = {};
    this.opponent = null;
    this.time = 0;
    this.intent = { moveX: 0, moveY: 0, parry: false };
    this.visorDown = true;
    this.resetCondition();
  }

  resetCondition() {
    this.state = 'fight';
    this.stamina = 100;
    this.blood = 5.0;            // litres
    this.bleed = 0;              // litres per minute
    this.stun = 0;
    this.pain = 0;
    this.shock = 0;
    this.limb = { armR: 1, armL: 1, legR: 1, legL: 1 };
    this.wounds = [];
    this.attack = null;
    this.queued = null;
    this.parrying = false;
    this.parryT = 0;
    this.flinch = 0;
    this.downTime = 0;
    this.getUpTime = 0;
    this.activation = 1;
    this.balanceScale = 1;
    this.stagger = 0;
    this.lastHitTime = -10;
    this.bound = 0;              // seconds in contact with the opposing weapon
    this.stats = { attacks: 0, hits: 0, wounds: 0, parries: 0 };
    this.fatal = null;
  }

  // --------------------------------------------------------------------------
  // Public control API (player input and AI)

  get canAct() {
    return this.state === 'fight';
  }

  get isDown() {
    return this.state === 'down' || this.state === 'dead' || this.state === 'out';
  }

  get armed() {
    return this.weapon.held;
  }

  setGuard(index) {
    if (!this.canAct) return;
    const n = this.guards.length;
    this.guardIndex = ((index % n) + n) % n;
    this.guard = this.guards[this.guardIndex];
    this._computeGuardPose();
  }

  setGuardById(id) {
    const i = this.guards.findIndex((g) => g.id === id);
    if (i >= 0) this.setGuard(i);
  }

  cycleGuard(dir) {
    this.setGuard(this.guardIndex + dir);
  }

  setSystem(sys) {
    if (!this.systems.includes(sys) || sys === this.system) return;
    this.system = sys;
    this.naming = SYSTEMS[sys].naming;
    this.guards = GUARDS[sys];
    this.setGuard(0);
  }

  /** The weapon's alternate grip or striking face. Returns a label. */
  toggleMode() {
    if (!this.canAct || this.attack) return null;
    const id = this.weaponId;
    if (id === 'longsword') {
      if (this.mode !== 'half') {
        this._prevSystem = this.system;
        this.mode = 'half';
        this.weapon.setMode('half');
        this.setSystem('halfsword');
      } else {
        this.mode = 'normal';
        this.weapon.setMode('normal');
        this.setSystem(this._prevSystem ?? 'liechtenauer');
      }
      return this.mode === 'half' ? 'Half-sword' : 'Long sword';
    }
    if (id === 'poleaxe') { this.mode = this.mode === 'axe' ? 'normal' : 'axe'; return this.mode === 'axe' ? 'Axe blade' : 'Hammer'; }
    if (id === 'warHammer') { this.mode = this.mode === 'beak' ? 'normal' : 'beak'; return this.mode === 'beak' ? 'Beak' : 'Hammer face'; }
    return null;
  }

  modeLabel() {
    const id = this.weaponId;
    if (id === 'longsword') return this.mode === 'half' ? 'Half-sword' : 'Long sword';
    if (id === 'poleaxe') return this.mode === 'axe' ? 'Axe blade' : 'Hammer';
    if (id === 'warHammer') return this.mode === 'beak' ? 'Beak' : 'Hammer face';
    return null;
  }

  toggleVisor() {
    if (!this.profile.hasVisor || this.isDown) return null;
    this.visorDown = !this.visorDown;
    return this.visorDown;
  }

  get vision() {
    return this.profile.vision(this.visorDown);
  }

  /** A cut/blow along a swipe (dx right, dy up as seen from behind). */
  swipe(dx, dy, aim = null, aimPart = null) {
    if (!this.canAct || !this.armed) return null;
    const naming = this.naming;
    const c = classifySwipe(naming, this.weaponId, this.mode, dx, dy, aimPart);
    if (naming === 'halfsword') this.weapon.setMode('mord');
    const target = aim ? aim.clone() : this._defaultTarget(c.line, c.side);
    return this._begin({ ...c, target });
  }

  /** A thrust at a point (or the face / chest by default). */
  thrust(aim = null) {
    if (!this.canAct || !this.armed) return null;
    const n = thrustName(this.naming, this.weaponId, this.mode);
    const target = aim ? aim.clone() : this._defaultTarget('thrust', 'C');
    if (this.weaponId === 'warHammer' || this.weaponId === 'mace') {
      // No real point: a short, aimed blow with the beak (or the head).
      const fromRight = this.toFightFrame(target, _v).y < 0.15;
      return this._begin({ kind: 'blunt', key: n.key, name: n.name, translation: n.translation, text: n.text, travel: { lat: fromRight ? 0.55 : -0.55, up: -0.84 }, edgeSign: this.weaponId === 'warHammer' ? 1 : 1, target, line: 'high', side: 'R' });
    }
    return this._begin({ kind: 'thrust', key: n.key, name: n.name, translation: n.translation, text: n.text, target, half: this.mode === 'half' });
  }

  _begin(spec) {
    if (this.attack && !this.attack.done) {
      // Chain: queue the next blow if this one is already recovering.
      if (this.attack.phase === 'recover' || this.attack.phase === 'follow') this.queued = spec;
      return null;
    }
    if (this.stamina < 6) return null;
    this.parrying = false;
    if (spec.kind !== 'mord' && this.weapon.mode === 'mord') this.weapon.setMode(this.mode === 'half' ? 'half' : 'normal');
    const a = new Attack(this, spec);
    this.attack = a;
    const cost = 4 + 9 * Math.min(1.5, this.weaponInertia / 0.25);
    this.stamina = Math.max(0, this.stamina - cost * (spec.kind === 'thrust' ? 0.7 : 1));
    this.stats.attacks++;
    return a;
  }

  _defaultTarget(line, side) {
    const o = this.opponent;
    const out = new Vector3();
    if (!o) return this.ff(1.5, 0, 1.4 * this.scale, out);
    const B = o.b;
    switch (line) {
      case 'high': case 'steep': case 'vertical':
        out.copy(B.head.pos).addScaledVector(UP, 0.02); break;
      case 'mid':
        out.copy(B.chest.pos).addScaledVector(UP, 0.12); break;
      case 'low':
        out.copy(side === 'L' ? B.thighR.pos : B.thighL.pos); break;
      case 'rising':
        out.copy(B.abdomen.pos); break;
      default: {
        // Thrust: the face if it is open, otherwise the chest.
        const open = !o.profile.layersAt('face', o.visorDown).some((l) => l.mat === 'plate');
        out.copy(open ? B.head.pos : B.chest.pos);
        if (open) out.addScaledVector(UP, -0.02);
      }
    }
    return out;
  }

  setParry(on) {
    if (on && !this.parrying) this.parryT = 0;
    this.parrying = on && this.canAct && this.armed;
  }

  /** Ringen: a shove or throw when close. Returns the outcome. */
  shove() {
    const o = this.opponent;
    if (!this.canAct || !o || o.isDown) return null;
    const d = _v.subVectors(o.center, this.center).setY(0).length();
    if (d > 1.05 * this.scale) return 'far';
    if (this.stamina < 12) return 'tired';
    this.stamina -= 12;
    const myPower = this.strength * (0.5 + 0.5 * this.stamina / 100) * (this.totalMass / 100) * (0.6 + 0.4 * Math.min(this.limb.armR, this.limb.armL));
    let hisBase = o.strength * (0.5 + 0.5 * o.stamina / 100) * (o.totalMass / 100) * (0.5 + 0.5 * Math.min(o.limb.legL, o.limb.legR));
    if (o.attack && o.attack.striking) hisBase *= 0.7;   // caught mid-blow
    hisBase *= 1 - 0.5 * clamp(o.stun, 0, 1);
    const ratio = myPower / Math.max(0.05, hisBase);
    const throwChance = clamp((ratio - 0.85) * 0.9 + (this.skill - o.skill) * 0.3, 0.03, 0.75);
    const thrown = Math.random() < throwChance;
    // The push itself is physical: an impulse into his chest and pelvis.
    _dir.subVectors(o.center, this.center).setY(0).normalize();
    const J = (thrown ? 230 : 120) * clamp(ratio, 0.5, 1.6);
    o.b.chest.vel.addScaledVector(_dir, J * 0.55 / o.b.chest.mass);
    o.b.pelvis.vel.addScaledVector(_dir, J * 0.45 / o.b.pelvis.mass);
    this.b.chest.vel.addScaledVector(_dir, -J * 0.25 / this.b.chest.mass);
    o.stagger = thrown ? 1.2 : 0.45;
    if (thrown) o.knockDown('thrown');
    return thrown ? 'thrown' : 'pushed';
  }

  // --------------------------------------------------------------------------
  // Frames

  _updateAxes() {
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.left.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  ff(f, l, y, out) {
    return out.copy(this.center).addScaledVector(this.forward, f).addScaledVector(this.left, l).setY(y);
  }

  ffDir(f, l, y, out) {
    return out.set(0, y, 0).addScaledVector(this.forward, f).addScaledVector(this.left, l);
  }

  toFightFrame(world, out) {
    _v.subVectors(world, this.center);
    return out.set(_v.dot(this.forward), _v.dot(this.left), world.y);
  }

  toFightDir(world, out) {
    return out.set(world.dot(this.forward), world.dot(this.left), world.y);
  }

  speedFactor() {
    const fat = 0.7 + 0.3 * this.stamina / 100;
    const arm = 0.55 + 0.45 * this.limb.armR;
    return fat * arm * (1 - 0.3 * clamp(this.stun - 0.2, 0, 1)) * (0.9 + 0.1 * this.skill);
  }

  _computeGuardPose() {
    const g = this.guard, s = this.scale;
    this.guardPose.hand.set(g.hand[0] * s, g.hand[1] * s, g.hand[2] * s);
    this.guardPose.dir.set(g.dir[0], g.dir[1], g.dir[2]);
    const e = this.guardPose.edge.set(g.edge[0], g.edge[1], g.edge[2]);
    e.addScaledVector(this.guardPose.dir, -e.dot(this.guardPose.dir));
    if (e.lengthSq() < 1e-4) e.set(0, 0, 1).addScaledVector(this.guardPose.dir, -this.guardPose.dir.z);
    e.normalize();
  }

  /** Where the weapon actually is, in the fight frame. */
  actualPose(hand, dir, edge) {
    const W = this.weapon;
    const y = W.gripY.R ?? W.gripY.L ?? W.grips.main;
    W.worldPoint(y, _w1);
    this.toFightFrame(_w1, hand);
    this.toFightDir(W.axis(_w2), dir);
    this.toFightDir(W.edgeDir(_w2), edge);
    if (W.mode === 'mord') dir.multiplyScalar(-1);
    return { hand, dir, edge };
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

  placeAt(position, yaw) {
    this.ragdoll.place(new Vector3(position.x, 0, position.z), yaw);
    this.center.set(position.x, 0, position.z);
    this.centerVel.set(0, 0, 0);
    this.yaw = yaw;
    this._updateAxes();
    this._resetFeetFromBody();
  }

  update(dt) {
    this.time += dt;
    this._updateCondition(dt);
    this.weapon.update(dt);
    if (this.weapon.pending) this.weapon.tryGrip();
    if (this.state === 'down' || this.state === 'dead' || this.state === 'out') {
      this._relax(dt);
      return;
    }
    this._updateFrame(dt);
    const P = this._computePose(dt);
    this._updateFeet(dt, P);
    this._applyPose(dt, P);
  }

  _updateCondition(dt) {
    const moving = Math.min(1, this.centerVel.length() / 1.3);
    const breath = this.profile.breath(this.visorDown);
    // Energy: moving in armour costs more (Jaquet 2016, Askew 2012); a
    // closed visor and a tight breastplate slow recovery.
    const drain = moving * 2.2 * this.locoCost + (this.parrying ? 3 : 0);
    const regen = (this.attack ? 1.5 : 8) * (1 - breath) * (1 - 0.6 * moving) * (this.blood / 5) ** 2 * (1 - 0.4 * this.shock);
    this.stamina = clamp(this.stamina + (regen - drain) * dt, 0, 100);

    // Bleeding: litres per minute.
    if (this.bleed > 0 && this.state !== 'dead') {
      this.blood = Math.max(0, this.blood - (this.bleed / 60) * dt);
      // Small vessels close up over time; the big ones do not.
      for (const w of this.wounds) if (w.bleed > 0 && !w.arterial) w.bleed *= Math.exp(-dt / 90);
      this.bleed = this.wounds.reduce((s, w) => s + w.bleed, 0);
    }
    this.pain = Math.max(0, this.pain - dt * 0.03);
    this.stun = Math.max(0, this.stun - dt * (0.08 + 0.1 * this.blood / 5));
    this.flinch = Math.max(0, this.flinch - dt * 4);
    this.stagger = Math.max(0, this.stagger - dt);
    this.shock = clamp((5 - this.blood) / 2.2 + this.pain * 0.3, 0, 1);

    const fat = this.stamina / 100;
    this.activation = (0.6 + 0.4 * fat) * (1 - 0.45 * clamp(this.stun - 0.25, 0, 1)) * (1 - 0.5 * this.shock);
    const legs = Math.min(this.limb.legL, this.limb.legR);
    this.balanceScale = clamp((1 - 0.8 * Math.max(0, this.stun - 0.35)) * (0.35 + 0.65 * legs) * (this.stagger > 0 ? 0.45 : 1), 0.15, 1);

    if (this.state === 'fight' || this.state === 'getup') {
      if (this.blood < 3.0) this.collapse('blood');
      else if (this.stun >= 1) this.knockDown('stunned');
      else if (legs < 0.15) this.knockDown('legs');
      // Fell over: pelvis low or torso far from upright.
      const pel = this.b.pelvis;
      _v.set(0, 1, 0).applyQuaternion(this.b.chest.q);
      if (pel.pos.y < 0.5 * this.scale || _v.y < 0.35) this.knockDown('fell');
    }
    if (this.state === 'down') {
      this.downTime += dt;
      if (this.blood < 2.4) this.die('blood');
    } else if (this.state === 'out') {
      this.downTime += dt;
      if (this.blood < 2.4) this.die('blood');
    } else if (this.state === 'getup') {
      this.getUpTime += dt;
      if (this.getUpTime > 2.2) this.state = 'fight';
    }
    if (this.fatal && this.state !== 'dead') {
      this.fatal.t -= dt;
      if (this.fatal.t <= 0) this.die(this.fatal.cause);
    }
  }

  _updateFrame(dt) {
    const o = this.opponent;
    if (o) {
      const dx = o.center.x - this.center.x, dz = o.center.z - this.center.z;
      const targetYaw = Math.atan2(dx, dz);
      const err = wrapAngle(targetYaw - this.yaw);
      const rate = (this.state === 'fight' ? 4.5 : 2) * dt;
      this.yaw = wrapAngle(this.yaw + clamp(err, -rate, rate));
      this._updateAxes();
    }
    const legs = Math.min(this.limb.legL, this.limb.legR);
    let speedMul = (0.55 + 0.45 * this.activation) * (0.4 + 0.6 * legs) * (1 - 0.12 * Math.min(1, this.profile.total / 40));
    if (this.attack && this.attack.phase !== 'recover') speedMul *= 0.55;
    if (this.parrying) speedMul *= 0.7;
    if (this.state !== 'fight') speedMul = 0;
    const mx = clamp(this.intent.moveX, -1, 1), my = clamp(this.intent.moveY, -1, 1);
    _v.copy(this.forward).multiplyScalar(my * 1.35 * speedMul).addScaledVector(this.left, -mx * 1.1 * speedMul);
    _v.sub(this.centerVel);
    const maxDv = 5.5 * dt * (0.7 + 0.3 * 80 / Math.max(80, this.totalMass));
    if (_v.length() > maxDv) _v.setLength(maxDv);
    this.centerVel.add(_v);
    this.center.addScaledVector(this.centerVel, dt);

    // Yield to external pushes (being hit, shoved, binding): move the plan.
    const pel = this.b.pelvis.pos;
    _v.subVectors(pel, this.assist.targetPos).setY(0);
    const lagDir = _v2.copy(this.centerVel).setY(0);
    if (this.attack && this.attack.stepIn > 0) lagDir.addScaledVector(this.forward, 1);
    if (lagDir.lengthSq() > 1e-4) {
      lagDir.normalize();
      const along = _v.dot(lagDir);
      if (along < 0) _v.addScaledVector(lagDir, -along);
    }
    const e = _v.length();
    if (e > 0.06) this.center.addScaledVector(_v, ((e - 0.06) / e) * Math.min(1, 5 * dt));

    if (o) {
      _v.subVectors(this.center, o.center).setY(0);
      const d = _v.length();
      const minD = 0.6 * this.scale;
      if (d < minD && d > 1e-4) this.center.addScaledVector(_v, ((minD - d) / d) * 0.5);
    }
    const r = Math.hypot(this.center.x, this.center.z);
    if (r > LISTS_RADIUS) this.center.multiplyScalar(LISTS_RADIUS / r);
  }

  _threatPose(out) {
    // Where is the opponent's weapon heading? Cover that line.
    const o = this.opponent;
    const s = this.scale;
    if (!o || !o.armed) {
      out.hand.copy(this.guardPose.hand);
      out.dir.copy(this.guardPose.dir);
      out.edge.copy(this.guardPose.edge);
      return out;
    }
    const W = o.weapon;
    W.worldPoint(W.strikeY, _w1);
    const vel = W.body.velocityAt(_w1, _w2);
    _w3.copy(_w1).addScaledVector(vel, 0.08);
    const T = this.toFightFrame(_w3, _v3);
    const l = clamp(T.y, -0.4, 0.4);
    const h = T.z;
    const sideSign = l >= 0 ? 1 : -1;
    const fwd = (this.def.hands === 2 && this.weapon.tipY > 1 ? 0.18 : 0.36) * s;
    if (h > 1.5 * s && Math.abs(l) < 0.12) {
      // Straight down the middle: the crown (Krone), blade across above the head.
      out.hand.set(0.33 * s, -0.16 * s, 1.68 * s);
      out.dir.set(0.15, 1, 0.22).normalize();
      out.edge.set(0, 0, 1);
    } else if (h > 1.05 * s) {
      out.hand.set(fwd, clamp(0.6 * l, -0.22, 0.22) * s, clamp(h - 0.12 * s, 1.05 * s, 1.5 * s));
      out.dir.set(0.3, 0.55 * sideSign, 0.78).normalize();
      out.edge.set(0, sideSign, 0.2);
    } else {
      out.hand.set(fwd, clamp(0.5 * l, -0.2, 0.2) * s, 1.02 * s);
      out.dir.set(0.3, 0.5 * sideSign, -0.8).normalize();
      out.edge.set(0, sideSign, -0.2);
    }
    out.edge.addScaledVector(out.dir, -out.edge.dot(out.dir)).normalize();
    // Keep the threat point for the buckler.
    out.threat = T.clone();
    return out;
  }

  _computePose(dt) {
    const s = this.scale;
    const P = this.pose;
    const g = this.guard;
    P.lead = g.lead ?? 'L';
    P.pelvisFwd = -0.02 * s;
    P.pelvisLat = 0;
    P.height = this.stanceHeight - (g.crouch ?? 0) * s;
    P.pelvisYaw = (P.lead === 'L' ? -1 : 1) * 18 * deg;
    P.spineTwist = (g.twist ?? 0) * deg;
    P.flex = 6 * deg;
    P.roll = 0;
    P.armDrive = 0.9;
    P.neckDrive = 1;
    P.torsoDrive = 1;
    P.driveMode = 'hold';

    if (this.stun > 0.4) {
      const k = (this.stun - 0.4) * 0.08;
      P.pelvisLat += Math.sin(this.time * 2.3) * k;
      P.roll += Math.sin(this.time * 2.1) * k * 1.5;
    }
    if (this.flinch > 0) P.flex -= this.flinch * 6 * deg;

    const cmd = this.cmd;
    const a = this.attack;
    if (a) {
      a.update(dt, cmd);
      // Body follows the blow: turn into it, shift weight forward.
      const pr = a.phase;
      const drive = pr === 'strike' || pr === 'follow' ? 1 : pr === 'hold' ? 0.8 : pr === 'prep' ? 0.3 : 0;
      if (a.kind !== 'thrust') {
        const side = a.spec.side === 'L' ? 1 : a.spec.side === 'R' ? -1 : 0;
        const wind = pr === 'prep' ? smoothstep(0, a.durPrep, a.t) : pr === 'strike' ? 1 - smoothstep(a.durPrep, a.impactTime, a.t) : 0;
        P.spineTwist += (side * 22 * wind - side * 18 * (pr === 'strike' || pr === 'follow' ? 1 : 0)) * deg;
      }
      P.pelvisFwd += 0.08 * s * drive;
      P.flex += 6 * deg * drive;
      P.driveMode = pr === 'strike' || pr === 'follow' || pr === 'hold' ? 'strike' : pr === 'prep' ? 'prep' : 'hold';
      if (a.stepIn > 0 && pr !== 'recover') {
        const want = a.stepIn * smoothstep(0, a.impactTime * 0.9, a.t);
        this.center.addScaledVector(this.forward, want - a.stepped);
        a.stepped = want;
        // A long step is a passing step.
        if (a.stepIn > 0.18 * s) P.lead = P.lead === 'L' ? 'R' : 'L';
      }
      if (a.done) {
        this.attack = null;
        if (this.weapon.mode === 'mord') this.weapon.setMode(this.mode === 'half' ? 'half' : 'normal');
        if (this.queued) {
          const q = this.queued;
          this.queued = null;
          if (q.kind === 'thrust') this.thrust(q.target); else this._begin(q);
        }
      }
    } else if (this.parrying) {
      this.parryT += dt;
      const tp = this._threatPose(this._tp ?? (this._tp = { hand: new Vector3(), dir: new Vector3(), edge: new Vector3() }));
      const k = 1 - Math.exp(-dt * 22);
      cmd.hand.lerp(tp.hand, k);
      lerpDir(cmd.dir, tp.dir, k, cmd.dir).normalize();
      lerpDir(cmd.edge, tp.edge, k, cmd.edge).normalize();
      P.driveMode = 'parry';
      P.flex += 4 * deg;
    } else {
      // Move into the chosen guard at a pace the weapon allows.
      const k = 1 - Math.exp(-dt * 9 / Math.sqrt(Math.max(0.6, this.weaponInertia / 0.22)));
      cmd.hand.lerp(this.guardPose.hand, k);
      lerpDir(cmd.dir, this.guardPose.dir, k, cmd.dir).normalize();
      lerpDir(cmd.edge, this.guardPose.edge, k, cmd.edge).normalize();
      if (this.queued) {
        const q = this.queued;
        this.queued = null;
        this._begin(q);
      }
    }
    // Keep the edge perpendicular to the blade.
    cmd.edge.addScaledVector(cmd.dir, -cmd.edge.dot(cmd.dir));
    if (cmd.edge.lengthSq() < 1e-6) cmd.edge.set(0, 0, 1).addScaledVector(cmd.dir, -cmd.dir.z);
    cmd.edge.normalize();
    return P;
  }

  _footOffsets(side, P, out) {
    const s = this.scale;
    const lead = side === P.lead;
    const ls = P.lead === 'L' ? 1 : -1;
    const wide = this.profile.total > 20 ? 1.08 : 1;
    if (lead) {
      out.fwd = 0.24 * s * wide; out.lat = ls * 0.11 * s; out.yaw = -ls * 10 * deg;
    } else {
      out.fwd = -0.28 * s * wide; out.lat = -ls * 0.13 * s; out.yaw = -ls * 42 * deg;
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
        sw.to.copy(f.desired);
        sw.toYaw = f.desiredYaw;
        if (sw.t >= 1) {
          f.pos.copy(sw.to);
          f.yaw = sw.toYaw;
          f.swing = null;
          f.planted = true;
          f.lastStep = this.time;
          this.onStep?.(this, side);
        }
        continue;
      }
      const err = Math.hypot(f.desired.x - f.pos.x, f.desired.z - f.pos.z) + 0.12 * Math.abs(wrapAngle(f.desiredYaw - f.yaw));
      if (err > bestErr) { bestErr = err; best = f; }
    }
    const other = best && this.feet[best.side === 'L' ? 'R' : 'L'];
    const threshold = moving ? 0.05 : 0.08;
    if (best && bestErr > threshold && other.planted && !other.swing && this.time - other.lastStep > 0.06) {
      const dist = Math.hypot(best.desired.x - best.pos.x, best.desired.z - best.pos.z);
      const heavy = 1 + 0.25 * Math.min(1, this.profile.total / 40);
      best.swing = {
        t: 0,
        dur: clamp(0.15 + 0.4 * dist, 0.15, 0.34) * heavy,
        from: best.pos.clone(),
        to: best.desired.clone(),
        fromYaw: best.yaw,
        toYaw: best.desiredYaw,
        lift: 0.035 + 0.08 * dist,
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
    const W = this.weapon;

    // --- pelvis -----------------------------------------------------------------
    const pelTarget = this.ff(P.pelvisFwd, P.pelvisLat, P.height, _v3);
    this.assist.targetPos.copy(pelTarget);
    this.assist.targetVel.copy(this.centerVel);
    _qp.setFromAxisAngle(UP, this.yaw + P.pelvisYaw);
    this.assist.targetQ.copy(_qp);
    const grounded = (this.feet.L.planted ? 1 : 0) + (this.feet.R.planted ? 1 : 0);
    const ramp = this.state === 'getup' ? smoothstep(0, 1.6, this.getUpTime) : 1;
    this.assist.strength = this.balanceScale * (grounded > 0 ? 1 : 0.75) * ramp;
    this.assist.boost = this.attack && this.attack.stepIn > 0 && this.attack.stepped < this.attack.stepIn * 0.95 ? 1.6 : 1;

    // --- spine ------------------------------------------------------------------
    const lumbarShare = 0.4;
    _rv.set(P.flex * 0.45, 0, -P.roll * 0.5);
    rotVecToQuat(_rv, _q);
    _q.multiply(_q2.setFromAxisAngle(UP, P.spineTwist * lumbarShare - P.pelvisYaw * 0.35));
    this._setJointTarget(this.j.lumbar, _q, dt);
    _rv.set(P.flex * 0.55, 0, -P.roll * 0.5);
    rotVecToQuat(_rv, _q);
    _q.multiply(_q2.setFromAxisAngle(UP, P.spineTwist * (1 - lumbarShare) - P.pelvisYaw * 0.5));
    this._setJointTarget(this.j.thoracic, _q, dt);

    // --- head: eyes on the opponent ---------------------------------------------
    const o = this.opponent;
    if (o) _dir.subVectors(o.b.head.pos, b.head.pos);
    else _dir.copy(this.forward);
    _dir.y = clamp(_dir.y, -0.4, 0.4);
    _dir.normalize();
    lookRotation(_dir, UP, _q);
    _q.multiply(_q2.setFromAxisAngle(_v.set(1, 0, 0), 8 * deg));
    _q2.copy(b.chest.q).invert().multiply(_q);
    this._setJointTarget(this.j.neck, _q2, dt);

    // --- weapon -------------------------------------------------------------------
    const cmd = this.cmd;
    const hand = this.ff(cmd.hand.x, cmd.hand.y, cmd.hand.z, _w1);
    const dirW = this.ffDir(cmd.dir.x, cmd.dir.y, cmd.dir.z, _w2).normalize();
    const edgeW = this.ffDir(cmd.edge.x, cmd.edge.y, cmd.edge.z, _w3).normalize();
    const reverse = W.mode === 'mord';
    if (reverse) dirW.multiplyScalar(-1);
    weaponRotation(dirW, edgeW, _q);
    const mainY = W.gripY.R ?? W.gripY.L;
    const ctrlY = W.gripY.R !== null && W.gripY.L !== null && W.joints.L && W.joints.R ? 0.5 * (W.gripY.R + W.gripY.L) : mainY;
    const D = this.drive;
    W.local(ctrlY, 0, D.point);
    // target for the control point: the main grip plus the offset along the axis
    _v.copy(hand).addScaledVector(dirW, ctrlY - mainY);
    if (this._prevTarget) D.targetVel.subVectors(_v, this._prevTarget).multiplyScalar(1 / dt);
    else D.targetVel.set(0, 0, 0);
    if (D.targetVel.lengthSq() > 900) D.targetVel.setLength(30);
    (this._prevTarget ??= new Vector3()).copy(_v);
    D.target.copy(_v);
    if (this._prevQ) {
      _q2.copy(this._prevQ).invert().premultiply(_q);
      quatToRotVec(_q2, D.targetOmega).multiplyScalar(1 / dt);
      if (D.targetOmega.lengthSq() > 900) D.targetOmega.setLength(30);
    }
    (this._prevQ ??= new Quaternion()).copy(_q);
    D.targetQ.copy(_q);
    const two = !!(W.hands === 2 && W.joints.L && W.joints.R);
    const twoHanded = W.hands === 2 && W.gripY.L !== null && W.gripY.R !== null && !!W.joints.R;
    const armF = two ? 0.5 * (this.limb.armR + this.limb.armL) : (W.joints.R ? this.limb.armR : this.limb.armL);
    const act = this.activation * (0.35 + 0.65 * armF) * this.strength;
    const capF = (two ? 820 : 520) * act;
    const capT = (two ? 150 : 85) * act * (this.weaponId === 'dagger' ? 0.5 : 1);
    switch (P.driveMode) {
      case 'strike':
        D.k = 26000; D.c = 18; D.maxF = capF;
        D.kr = 2600; D.cr = 4; D.maxT = capT;
        break;
      case 'prep':
        D.k = 9000; D.c = 70; D.maxF = capF * 0.8;
        D.kr = 900; D.cr = 14; D.maxT = capT * 0.8;
        break;
      case 'parry':
        D.k = 14000; D.c = 120; D.maxF = capF;
        D.kr = 1400; D.cr = 20; D.maxT = capT;
        break;
      default:
        D.k = 7000; D.c = 110; D.maxF = capF * 0.7;
        D.kr = 650; D.cr = 16; D.maxT = capT * 0.7;
    }
    if (!W.held) { D.k = 0; D.kr = 0; D.c = 0; D.cr = 0; }

    // --- arms: IK to where the grips will be ----------------------------------------
    const handTargets = this._handTargets ?? (this._handTargets = { R: new Vector3(), L: new Vector3() });
    if (W.joints.R) handTargets.R.copy(hand);
    else handTargets.R.copy(this.ff(0.15 * s, -0.25 * s, 1.0 * s, _v));
    if (twoHanded) {
      handTargets.L.copy(hand).addScaledVector(dirW, W.gripY.L - mainY);
    } else if (W.joints.L && !W.joints.R) {
      handTargets.L.copy(hand);
    } else {
      // One-handed weapon: the off hand holds the buckler or guards.
      const off = this.guard.off ?? [0.22, 0.16, 1.2];
      this.ff(off[0] * s, off[1] * s, off[2] * s, handTargets.L);
      if (W.offhand && (this.parrying || (this.attack && this.attack.phase !== 'recover'))) {
        // I.33: the buckler goes with the sword hand / to the threat.
        if (this.parrying && this._tp?.threat) {
          const T = this._tp.threat;
          this.ff(0.42 * s, clamp(T.y, -0.3, 0.3), clamp(T.z, 0.9 * s, 1.7 * s), handTargets.L);
        } else {
          _v.copy(hand).lerp(handTargets.L, 0.5);
          handTargets.L.copy(_v).addScaledVector(this.forward, 0.08);
        }
      }
    }
    for (const side of ['L', 'R']) {
      const bone = this.ragdoll.bones['arm' + side];
      b.chest.localToWorld(bone.rootLocalInParent, _sh);
      const sx = side === 'L' ? 1 : -1;
      _pole.copy(UP).multiplyScalar(-1).addScaledVector(this.left, sx * 0.5).addScaledVector(this.forward, -0.25);
      _v2.copy(this.forward).multiplyScalar(-1).addScaledVector(this.left, sx * 0.6);
      solveTwoBone(_sh, handTargets[side], _pole, bone, _qu, _ql, null, _v2);
      _q.copy(b.chest.q).invert().multiply(_qu);
      this._setJointTarget(this.j['shoulder' + side], _q, dt);
      _q.copy(_qu).invert().multiply(_ql);
      this._setJointTarget(this.j['elbow' + side], _q, dt);
    }
    const R = this.offReach;
    if (!twoHanded && !(W.joints.L && !W.joints.R)) {
      R.targetVel.subVectors(handTargets.L, R.prevTarget).multiplyScalar(1 / dt);
      if (R.targetVel.lengthSq() > 400) R.targetVel.setLength(20);
      R.prevTarget.copy(handTargets.L);
      R.target.copy(handTargets.L);
      const busy = W.offhand && (this.parrying || this.attack);
      R.stiffness = (busy ? 5000 : 2000) * this.activation * this.limb.armL;
      R.damping = busy ? 120 : 70;
      R.maxForce = (busy ? 260 : 90) * this.activation * this.limb.armL;
    } else {
      R.stiffness = 0; R.damping = 0;
    }

    // --- legs -------------------------------------------------------------------------
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

    // --- muscle activation --------------------------------------------------------------
    const actAll = this.activation * (this.state === 'getup' ? 0.4 + 0.6 * ramp : 1);
    for (const j of Object.values(this.j)) {
      const m = j.muscle;
      let k = 1, tq = 1;
      switch (j.group) {
        case 'shoulder': case 'elbow': {
          const side = j.name.slice(-1);
          const lf = side === 'R' ? this.limb.armR : this.limb.armL;
          k = P.armDrive * (P.driveMode === 'strike' ? 0.55 : 1) * lf;
          tq = lf;
          break;
        }
        case 'lumbar': case 'thoracic':
          k = P.torsoDrive * (P.driveMode === 'strike' ? 1.4 : 1);
          break;
        case 'neck':
          k = P.neckDrive;
          break;
        case 'hip': case 'knee': case 'ankle': {
          const side = j.name.slice(-1);
          const lf = side === 'R' ? this.limb.legR : this.limb.legL;
          k = 0.4 + 0.6 * lf;
          tq = 0.35 + 0.65 * lf;
          break;
        }
        default: break;
      }
      k *= actAll;
      j.setDrive(m.stiffness * k, m.damping * Math.sqrt(Math.max(k, 0.01)), m.maxTorque * tq * (0.55 + 0.45 * actAll));
    }
  }

  _relax() {
    this.assist.strength = 0;
    this.offReach.stiffness = 0;
    this.offReach.damping = 0;
    const D = this.drive;
    D.k = 0; D.kr = 0;
    D.c = 6; D.cr = 1; D.maxF = 40; D.maxT = 4;
    D.targetVel.set(0, 0, 0);
    D.targetOmega.set(0, 0, 0);
    const tone = this.state === 'dead' ? 0.015 : this.state === 'out' ? 0.03 : 0.06;
    for (const j of Object.values(this.j)) {
      const m = j.muscle;
      j.setTarget(_q.identity(), 0);
      j.setDrive(m.stiffness * tone, m.damping * 0.35, m.maxTorque * 0.1);
    }
    this.attack = null;
    this.queued = null;
    this.parrying = false;
  }

  // --------------------------------------------------------------------------
  // Condition changes (called by the damage model and the match)

  knockDown(cause = 'fell') {
    if (this.state === 'down' || this.state === 'dead' || this.state === 'out') return;
    this.state = this.stun >= 1 ? 'out' : 'down';
    this.downCause = cause;
    this.downTime = 0;
    this.attack = null;
    this.queued = null;
    this.parrying = false;
    this.onDown?.(this, cause);
  }

  collapse(cause) {
    if (this.state === 'dead' || this.state === 'out') return;
    this.state = 'out';
    this.downCause = cause;
    this.downTime = 0;
    this.attack = null;
    this.onDown?.(this, cause);
  }

  die(cause) {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.deathCause = cause;
    this.attack = null;
    this.onDeath?.(this, cause);
  }

  canGetUp() {
    return this.state === 'down' && this.downTime > 1.6 && this.stun < 0.85 && this.blood > 3.2 && Math.min(this.limb.legL, this.limb.legR) > 0.3;
  }

  startGetUp() {
    if (this.state !== 'down') return;
    this.state = 'getup';
    this.getUpTime = 0;
    const pel = this.b.pelvis.pos;
    this.center.set(pel.x, 0, pel.z);
    const r = Math.hypot(this.center.x, this.center.z);
    if (r > LISTS_RADIUS) this.center.multiplyScalar(LISTS_RADIUS / r);
    this.centerVel.set(0, 0, 0);
    const off = {};
    for (const side of ['L', 'R']) {
      const f = this.feet[side];
      this._footOffsets(side, { lead: this.guard.lead ?? 'L' }, off);
      this.ff(off.fwd, off.lat, 0, f.pos);
      f.yaw = this.yaw + off.yaw;
      f.planted = true;
      f.swing = null;
    }
  }

  /** Arms/legs lose function; a useless hand lets go of the weapon. */
  impairLimb(limb, amount) {
    this.limb[limb] = clamp(this.limb[limb] - amount, 0, 1);
    if (limb === 'armR' && this.limb.armR < 0.22 && this.weapon.joints.R) {
      this.weapon.release('R');
      this.onDrop?.(this, 'R');
    }
    if (limb === 'armL' && this.limb.armL < 0.22 && this.weapon.joints.L) {
      this.weapon.release('L');
      this.onDrop?.(this, 'L');
    }
  }
}
