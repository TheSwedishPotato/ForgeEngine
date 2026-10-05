import { Vector3, Quaternion } from 'three';
import { smoothstep, clamp } from '../physics/math.js';
import { weaponRotation } from './ik.js';
import { BLOW_NAMES } from '../data/guards.js';

const deg = Math.PI / 180;
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _q1 = new Quaternion(), _q2 = new Quaternion();

/**
 * Turns a swipe (screen direction of travel, dx right / dy up, as the
 * attacker sees it from behind) into a blow of the fighter's system.
 * Returns the line of the blow and its period name.
 */
export function classifySwipe(naming, weaponId, mode, dx, dy, aimPart = null) {
  const a = Math.atan2(dy, dx) / deg;   // travel direction, degrees
  // Travel in the attacker's frontal plane: +lat = to his left.
  const len = Math.hypot(dx, dy) || 1;
  const travel = { lat: -dx / len, up: dy / len };
  let line, side;
  if (a <= -160 || a >= 160) { line = 'mid'; side = 'R'; }
  else if (a > -160 && a <= -115) { line = 'high'; side = 'R'; }
  else if (a > -115 && a <= -98) { line = 'steep'; side = 'R'; }
  else if (a > -98 && a < -82) { line = 'vertical'; side = 'C'; }
  else if (a >= -82 && a < -20) { line = 'high'; side = 'L'; }
  else if (a >= -20 && a <= 20) { line = 'mid'; side = 'L'; }
  else if (a > 20 && a < 70) { line = 'low'; side = 'L'; }
  else if (a >= 70 && a <= 110) { line = 'rising'; side = 'C'; }
  else { line = 'low'; side = 'R'; }

  const names = BLOW_NAMES[naming] ?? BLOW_NAMES.i33;
  let key;
  let edgeSign = 1;
  let kind = 'cut';
  switch (naming) {
    case 'liechtenauer':
      if (line === 'high' && side === 'R') key = aimPart === 'hand' ? 'krumphau' : 'zornhau';
      else if (line === 'steep') { key = 'schielhau'; edgeSign = -1; }
      else if (line === 'vertical') key = 'scheitelhau';
      else if (line === 'mid') { key = 'zwerchhau'; if (side === 'R') edgeSign = -1; }
      else if (line === 'high') key = 'oberhauL';
      else if (line === 'low' || line === 'rising') key = side === 'L' ? 'unterhauL' : 'unterhauR';
      break;
    case 'fiore':
      if (line === 'vertical') key = 'fendenteV';
      else if (line === 'high' || line === 'steep') key = side === 'L' ? 'fendenteL' : 'fendenteR';
      else if (line === 'mid') key = side === 'L' ? 'mezzanoL' : 'mezzanoR';
      else key = side === 'L' ? 'sottanoL' : 'sottanoR';
      break;
    case 'halfsword':
      key = 'mordschlag'; kind = 'mord';
      break;
    case 'azza':
      key = mode === 'axe' ? 'axe' : 'hammer'; kind = mode === 'axe' ? 'cut' : 'blunt';
      edgeSign = mode === 'axe' ? 1 : -1;
      break;
    case 'spear':
      key = 'beat'; kind = 'blunt';
      break;
    case 'dagger':
      key = line === 'low' || line === 'rising' ? 'sottano' : line === 'mid' ? 'punta' : 'fendente';
      kind = 'stab';
      break;
    default: // i33, onehand
      if (line === 'vertical') key = 'scheitel';
      else if (line === 'high' || line === 'steep') key = side === 'L' ? 'oberL' : 'oberR';
      else if (line === 'mid') key = side === 'L' ? 'mittelL' : 'mittelR';
      else key = side === 'L' ? 'unterL' : 'unterR';
      if (weaponId === 'warHammer') { kind = mode === 'beak' ? 'blunt' : 'blunt'; edgeSign = mode === 'beak' ? 1 : -1; }
      if (weaponId === 'mace') kind = 'blunt';
      break;
  }
  const info = names[key] ?? { name: 'Blow', translation: '', text: '' };
  return { kind, key, name: info.name, translation: info.translation, text: info.text, travel, line, side, edgeSign };
}

/** Name of the thrust in the fighter's system. */
export function thrustName(naming, weaponId, mode) {
  if (naming === 'halfsword') return { key: 'halfThrust', ...BLOW_NAMES.halfsword.halfThrust };
  if (naming === 'fiore' || naming === 'azza' || naming === 'spear' || naming === 'dagger') {
    const tbl = BLOW_NAMES[naming];
    return { key: 'punta', ...tbl.punta };
  }
  if (naming === 'onehand' && weaponId === 'warHammer') return { key: 'beak', ...BLOW_NAMES.onehand.beak };
  if (naming === 'onehand' && weaponId === 'mace') return { key: 'scheitel', ...BLOW_NAMES.onehand.scheitel };
  const tbl = BLOW_NAMES[naming] ?? BLOW_NAMES.i33;
  return { key: 'stich', ...(tbl.stich ?? BLOW_NAMES.i33.stich) };
}

/** Bezier-free ease: accelerate all the way to impact (a ballistic blow). */
const accel = (u) => u * u * (1.25 - 0.25 * u);
const decel = (u) => 1 - (1 - u) * (1 - u);

/**
 * A planned attack in the attacker's fight frame (forward, left, height),
 * so it moves with him as he steps. pose(t) returns the commanded grip
 * position and weapon orientation.
 *
 * Swings (cut, blunt, mord, stab) rotate the weapon in a plane through a
 * pivot in front of the chest: the plane holds the line from pivot to target
 * and the direction of travel the swipe asked for. The edge (or the hammer
 * face, or the point for a stab) leads. Thrusts drive the point straight at
 * the target. Speed and power are whatever the muscles and the weapon's
 * inertia make of these targets.
 */
export class Attack {
  constructor(k, spec) {
    this.k = k;
    this.spec = spec;
    this.kind = spec.kind;
    this.name = spec.name;
    this.t = 0;
    this.phase = 'prep';
    this.hit = null;
    this.blocked = false;
    this.done = false;
    this.stepIn = 0;
    this.stepped = 0;
    const s = k.scale;
    const W = k.weapon;
    const gripY = W.gripTarget.R ?? W.gripTarget.L;
    this.gripY = gripY;
    const T = k.toFightFrame(spec.target, new Vector3());
    this.T = T;
    const speed = k.speedFactor();
    const inertiaFactor = clamp(Math.sqrt(k.weaponInertia / 0.22), 0.8, 1.45);
    this.start = { hand: k.cmd.hand.clone(), dir: k.cmd.dir.clone(), edge: k.cmd.edge.clone() };

    if (spec.kind === 'thrust') {
      const reachL = (W.tipY - gripY);
      const H0 = this.start.hand;
      const D = _a.subVectors(T, H0).normalize();
      // Mix in the current blade line so a thrust from a guard comes out of it.
      D.lerp(this.start.dir, 0.15).normalize();
      this.D = D.clone();
      // Thrust through the target, not to it: the arms and the step keep
      // driving the point after it arrives (the target is what stops it).
      const overshoot = 0.28 * s;
      const Hend = T.clone().addScaledVector(D, -(reachL - overshoot));
      // How far can the hand go? Measure from the shoulder line.
      const sh = new Vector3(0.0, -0.1 * s, 1.43 * s);
      const maxArm = (k.weapon.hands === 2 ? 0.56 : 0.66) * s;
      const need = Hend.distanceTo(sh);
      this.stepIn = clamp(need - maxArm, 0, 0.85 * s);   // up to a full passing step
      Hend.addScaledVector(_b.set(1, 0, 0), -this.stepIn);
      this.Hend = Hend;
      this.Hchamber = H0.clone().addScaledVector(D, -0.1 * s);
      const edge = _c.copy(this.start.edge).addScaledVector(D, -this.start.edge.dot(D));
      if (edge.lengthSq() < 1e-4) edge.set(0, 0, 1);
      this.E = edge.normalize().clone();
      // Bring the point on line first; the more it must turn, the longer.
      const turn = Math.acos(clamp(this.start.dir.dot(D), -1, 1));
      this.durPrep = (0.07 + 0.16 * turn + 0.1 * this.start.hand.distanceTo(this.Hchamber) / s) / speed;
      this.durMain = ((spec.half ? 0.22 : 0.17) + 0.2 * this.stepIn / s) * inertiaFactor / speed;
      this.durHold = 0.1;
      this.durRecover = 0.22 / speed;
    } else {
      // Swing geometry.
      const P = new Vector3(0.12 * s, -0.05 * s, 1.38 * s);
      if (spec.key === 'zwerchhau') P.y = 1.62 * s;
      if (spec.kind === 'stab') P.set(0.05 * s, -0.12 * s, 1.45 * s);
      this.P = P;
      const reverse = spec.kind === 'mord';
      const strikeY = spec.kind === 'stab' ? W.tipY : reverse ? -0.08 : W.strikeY;
      this.strikeY = strikeY;
      const Ls = Math.abs(strikeY - gripY);
      this.reverse = reverse;
      // Travel direction in the frontal plane of the fight frame.
      const tr = new Vector3(0, spec.travel.lat, spec.travel.up);
      let d, rh;
      if (spec.kind === 'stab') {
        // The point leads: the hand ends a blade-length short of the target.
        const t0 = tr.clone().normalize();
        const Hi = T.clone().addScaledVector(t0, -Ls * 0.85);
        d = _a.subVectors(Hi, P);
        rh = d.length();
        d.normalize();
      } else {
        d = _a.subVectors(T, P);
        const R = d.length();
        d.normalize();
        rh = R - Ls;
      }
      const maxArm = (W.hands === 2 ? 0.5 : 0.6) * s;
      const minArm = 0.16 * s;
      this.stepIn = clamp(rh - maxArm, 0, 0.85 * s);
      rh = clamp(rh, minArm, maxArm);
      this.di = d.clone();
      const ti = tr.addScaledVector(this.di, -tr.dot(this.di));
      if (ti.lengthSq() < 1e-6) ti.set(0, 1, 0).addScaledVector(this.di, -this.di.y);
      this.ti = ti.normalize().clone();
      this.rh = rh;
      const big = spec.kind === 'blunt' || spec.kind === 'mord';
      this.thW = (spec.kind === 'stab' ? 95 : big ? 140 : 125) * deg;
      this.thF = (spec.kind === 'stab' ? 25 : big ? 55 : 70) * deg;
      this.edgeSign = spec.edgeSign ?? 1;
      const windup = this.swingPose(-this.thW, {});
      this.durPrep = clamp(0.1 + 0.28 * this.start.hand.distanceTo(windup.hand) / s, 0.12, 0.38) * inertiaFactor / speed;
      this.durMain = (spec.kind === 'stab' ? 0.2 : 0.24) * inertiaFactor / speed;
      this.durFollow = 0.14 * inertiaFactor / speed;
      this.durRecover = 0.24 / speed;
    }
    this.stepDone = false;
  }

  /** Grip position and weapon axes for swing angle th (fight frame). */
  swingPose(th, out) {
    const c = Math.cos(th), sn = Math.sin(th);
    const D = (out.dir ??= new Vector3()).copy(this.di).multiplyScalar(c).addScaledVector(this.ti, sn);
    const T = (out.travel ??= new Vector3()).copy(this.di).multiplyScalar(-sn).addScaledVector(this.ti, c);
    const along = clamp(1 - Math.abs(th) / Math.max(this.thW, 1e-3), 0, 1);
    const r = this.rh * (0.7 + 0.3 * along);
    (out.hand ??= new Vector3()).copy(this.P).addScaledVector(D, r);
    out.edge ??= new Vector3();
    if (this.kind === 'stab') {
      // Point leads: the blade points along the travel.
      out.edge.copy(D).multiplyScalar(-1);
      out.dir.copy(T);
    } else {
      out.edge.copy(T).multiplyScalar(this.edgeSign);
      if (this.reverse) out.dir.multiplyScalar(-1);
    }
    return out;
  }

  get impactTime() {
    return this.durPrep + this.durMain;
  }

  /** Advances the attack and writes the commanded pose into `cmd`. */
  update(dt, cmd) {
    this.t += dt;
    const t = this.t;
    if (this.kind === 'thrust') {
      const t1 = this.durPrep, t2 = t1 + this.durMain, t3 = t2 + this.durHold, t4 = t3 + this.durRecover;
      if (t < t1) {
        this.phase = 'prep';
        const u = smoothstep(0, 1, t / t1);
        cmd.hand.lerpVectors(this.start.hand, this.Hchamber, u);
        lerpDir(this.start.dir, this.D, 0.8 * u, cmd.dir);
        lerpDir(this.start.edge, this.E, 0.8 * u, cmd.edge);
        this._pd = cmd.dir.clone(); this._pe = cmd.edge.clone();
      } else if (t < t2) {
        this.phase = 'strike';
        const x = (t - t1) / this.durMain;
        const u = accel(x);
        cmd.hand.lerpVectors(this.Hchamber, this.Hend, u);
        const al = smoothstep(0, 0.45, x);
        lerpDir(this._pd ?? this.D, this.D, al, cmd.dir);
        lerpDir(this._pe ?? this.E, this.E, al, cmd.edge);
      } else if (t < t3 && !this.recoverFrom) {
        this.phase = 'hold';
        cmd.hand.copy(this.Hend);
      } else {
        if (!this.recoverFrom) { this.recoverFrom = { hand: cmd.hand.clone(), dir: cmd.dir.clone(), edge: cmd.edge.clone(), t }; }
        this.phase = 'recover';
        const u = smoothstep(0, 1, (t - this.recoverFrom.t) / this.durRecover);
        const g = this.k.guardPose;
        cmd.hand.lerpVectors(this.recoverFrom.hand, g.hand, u);
        lerpDir(this.recoverFrom.dir, g.dir, u, cmd.dir);
        lerpDir(this.recoverFrom.edge, g.edge, u, cmd.edge);
        if (u >= 1) this.done = true;
      }
      return;
    }
    const t1 = this.durPrep, t2 = t1 + this.durMain, t3 = t2 + this.durFollow;
    const sp = this._sp ?? (this._sp = {});
    if (t < t1) {
      this.phase = 'prep';
      const u = smoothstep(0, 1, t / t1);
      this.swingPose(-this.thW, sp);
      cmd.hand.lerpVectors(this.start.hand, sp.hand, u);
      lerpDir(this.start.dir, sp.dir, u, cmd.dir);
      lerpDir(this.start.edge, sp.edge, u, cmd.edge);
    } else if (t < t2) {
      // Cut through: a blow that lands keeps driving (the target, not the
      // arms, stops it).
      this.phase = 'strike';
      const u = accel((t - t1) / this.durMain);
      this.swingPose(-this.thW * (1 - u), sp);
      cmd.hand.copy(sp.hand); cmd.dir.copy(sp.dir); cmd.edge.copy(sp.edge);
    } else if (t < t3 && !(this.hit && t - this.hitT > 0.12)) {
      this.phase = 'follow';
      const u = decel((t - t2) / this.durFollow);
      this.swingPose(this.thF * u, sp);
      cmd.hand.copy(sp.hand); cmd.dir.copy(sp.dir); cmd.edge.copy(sp.edge);
    } else {
      if (!this.recoverFrom) {
        // After a hit, recover from where the weapon actually is.
        const from = this.hit ? this.k.actualPose(new Vector3(), new Vector3(), new Vector3()) : null;
        this.recoverFrom = from ? { hand: from.hand, dir: from.dir, edge: from.edge, t } : { hand: cmd.hand.clone(), dir: cmd.dir.clone(), edge: cmd.edge.clone(), t };
      }
      this.phase = 'recover';
      const u = smoothstep(0, 1, (t - this.recoverFrom.t) / this.durRecover);
      const g = this.k.guardPose;
      cmd.hand.lerpVectors(this.recoverFrom.hand, g.hand, u);
      lerpDir(this.recoverFrom.dir, g.dir, u, cmd.dir);
      lerpDir(this.recoverFrom.edge, g.edge, u, cmd.edge);
      if (u >= 1) this.done = true;
    }
  }

  get striking() {
    return this.phase === 'strike' || this.phase === 'follow' || this.phase === 'hold';
  }
}

/** Interpolates two unit directions (slerp through the weapon rotation). */
export function lerpDir(a, b, u, out) {
  const d = Math.max(-1, Math.min(1, a.dot(b)));
  if (d > 0.9995) return out.lerpVectors(a, b, u).normalize();
  const th = Math.acos(d);
  if (th > Math.PI - 1e-3) {
    // Opposite: rotate through any perpendicular.
    _c.set(0, 0, 1).cross(a);
    if (_c.lengthSq() < 1e-6) _c.set(0, 1, 0).cross(a);
    _c.normalize();
    return out.copy(a).multiplyScalar(Math.cos(Math.PI * u)).addScaledVector(_c, Math.sin(Math.PI * u));
  }
  const s = Math.sin(th);
  const wa = Math.sin((1 - u) * th) / s, wb = Math.sin(u * th) / s;
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb);
}

export { weaponRotation, _q1, _q2 };
