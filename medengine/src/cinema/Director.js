import { Vector3, Quaternion, MathUtils, Euler } from 'three';

/**
 * Med Engine 2 virtual cinematographer.
 *
 * A shot is described the way a director would call it, and the camera works out where to
 * stand:
 *   { type: 'cu', on: actor, angle: 25, height: 0.0, lens: 85, move: 'push', dur: 4,
 *     look: actorOrPoint, dutch: 4, handheld: 0.3, focus: actor, aperture: 1.8 }
 *
 * Types (subject framing, 35 mm full-frame lens equivalents by default):
 *   ecu (eyes)  cu (face)  mcu (head and shoulders)  ms (waist up)  mls (knees up)
 *   ws (whole body, room around)  ews (the place, the person small in it)
 *   ots (over `over`'s shoulder onto `on`)  two (two people)  pov (through `on`'s eyes)
 *   insert (an object or hand: `at` point, `size` metres)  free (pos/target given)
 * Angle is degrees around the subject from their facing (0 = in front, 90 = their left
 * side); height raises the camera (low angles are negative); `side` picks the shoulder for
 * ots. Composition: eyes on the upper third, look room in front of a profile.
 * Moves over `dur` seconds: push (dolly in), pull (dolly out), orbit (deg), crane (up),
 * drop (down), truck (sideways), track (follow the subject), static. `handheld` adds the
 * breathing drift of a camera operator; `shake` an impact.
 */

const FRAME = { ecu: 0.11, cu: 0.3, mcu: 0.52, ms: 0.92, mls: 1.35, ws: 2.6, ews: 9 };
const LENS = { ecu: 100, cu: 85, mcu: 65, ms: 50, mls: 40, ws: 32, ews: 24, ots: 50, two: 40, pov: 32, insert: 85, free: 40 };
const SENSOR_H = 0.024;   // full-frame height (m)

export function vfov(focalMm) { return 2 * Math.atan(SENSOR_H / 2 / (focalMm / 1000)) * MathUtils.RAD2DEG; }

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3();

function pointOf(x, out = new Vector3()) {
  if (!x) return null;
  if (x.isVector3) return out.copy(x);
  if (Array.isArray(x)) return out.set(x[0], x[1], x[2]);
  if (x.eyes) return x.eyes(out);
  if (x.getWorldPosition) return x.getWorldPosition(out);
  return null;
}

function facing(actor) { return actor?.yaw ?? 0; }

export class Director {
  constructor(stage) {
    this.stage = stage;
    this.camera = stage.camera;
    this.shot = null;
    this.t = 0;
    this.noiseT = Math.random() * 100;
    this.from = { pos: new Vector3(), target: new Vector3(), fov: 40 };
    this.to = { pos: new Vector3(), target: new Vector3(), fov: 40 };
    this.cur = { pos: new Vector3(), target: new Vector3(), fov: 40, roll: 0 };
    this.mode = 'shot';          // 'shot' | 'follow' (gameplay) | 'manual'
    this.follow = null;          // { actor, dist, height, shoulder, yaw, pitch }
    this.bounds = null;          // optional { min: Vector3, max: Vector3 } the camera must stay inside
    this.shake = 0;
    this.cutCount = 0;
  }

  /** Cuts (or blends, if `blend` seconds) to a new shot. */
  cut(spec, { blend = 0 } = {}) {
    this.mode = 'shot';
    this.shot = { ...spec };
    this.t = 0;
    this.blend = blend;
    if (blend > 0) { this.from.pos.copy(this.cur.pos); this.from.target.copy(this.cur.target); this.from.fov = this.cur.fov; }
    this._solve(0, this.to);
    if (blend <= 0) { this.cur.pos.copy(this.to.pos); this.cur.target.copy(this.to.target); this.cur.fov = this.to.fov; this.cutCount++; }
    // the lens
    const L = this.stage.lens;
    L.focal = (spec.lens ?? LENS[spec.type] ?? 40) / 1000;
    L.aperture = spec.aperture ?? (spec.type === 'ecu' || spec.type === 'cu' ? 1.8 : spec.type === 'ews' || spec.type === 'ws' ? 5.6 : 2.8);
    L.pull = spec.pull ?? 6;
    return this;
  }

  /** Third-person gameplay camera behind the actor. */
  followActor(actor, o = {}) {
    this.mode = 'follow';
    this.follow = { actor, dist: o.dist ?? 2.6, height: o.height ?? 0.35, shoulder: o.shoulder ?? 0.45, yaw: actor.yaw, pitch: o.pitch ?? -8, lens: o.lens ?? 32 };
    this.stage.lens.focal = this.follow.lens / 1000; this.stage.lens.aperture = 4;
  }

  _solve(t, out) {
    const S = this.shot;
    const type = S.type ?? 'ms';
    const lens = S.lens ?? LENS[type] ?? 40;
    out.fov = vfov(lens);
    const subj = S.on;
    const E = pointOf(subj, new Vector3()) ?? pointOf(S.at, new Vector3()) ?? new Vector3();
    const yaw = facing(subj?.isVector3 ? null : subj) + MathUtils.degToRad(S.angle ?? 0);
    const dirOut = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const tanH = Math.tan(MathUtils.degToRad(out.fov) / 2);
    if (type === 'free') {
      pointOf(S.pos, out.pos); pointOf(S.target, out.target);
    } else if (type === 'pov') {
      out.pos.copy(E).addScaledVector(dirOut, 0.06);
      pointOf(S.look, out.target) ?? out.target.copy(E).addScaledVector(dirOut, 5);
    } else if (type === 'ots') {
      // behind `over`, off one shoulder, looking at `on`
      const over = S.over;
      const O = over.chest ? over.chest(new Vector3()) : pointOf(over, new Vector3());
      O.y = (over.eyes ? over.eyes(_a).y : O.y) - 0.05;
      const toS = _b.copy(E).sub(O); toS.y = 0; toS.normalize();
      const side = new Vector3(toS.z, 0, -toS.x).multiplyScalar(S.side === 'left' ? -1 : 1);
      out.pos.copy(O).addScaledVector(toS, -(S.back ?? 0.75)).addScaledVector(side, S.shoulder ?? 0.36);
      out.pos.y += (S.height ?? 0.08);
      out.target.copy(E).addScaledVector(side, -0.05);
      out.target.y -= 0.06;
    } else if (type === 'two') {
      const B2 = pointOf(S.with, new Vector3());
      const mid = _a.copy(E).add(B2).multiplyScalar(0.5);
      const span = E.distanceTo(B2) + 0.9;
      const across = _b.copy(B2).sub(E); across.y = 0; across.normalize();
      const perp = new Vector3(-across.z, 0, across.x).multiplyScalar(S.flip ? -1 : 1);
      const d = (span / 2) / (tanH * (this.camera.aspect || 1.78)) * 1.15;
      out.pos.copy(mid).addScaledVector(perp, d).add(new Vector3(0, S.height ?? 0, 0));
      out.target.copy(mid); out.target.y -= 0.12;
    } else if (type === 'insert') {
      const size = S.size ?? 0.3;
      const d = (size / 2) / tanH;
      out.pos.copy(E).addScaledVector(dirOut, d).add(new Vector3(0, S.height ?? 0.1, 0));
      out.target.copy(E);
    } else {
      const H = (S.frame ?? FRAME[type] ?? 1);
      const d = (H / 2) / tanH;
      out.pos.copy(E).addScaledVector(dirOut, d);
      out.pos.y += S.height ?? 0;
      // composition: eyes at the upper third; profiles get room in front
      out.target.copy(E);
      out.target.y -= H * 0.17;
      if (Math.abs(S.angle ?? 0) > 20 && type !== 'ews') out.target.addScaledVector(right, -Math.sign(S.angle ?? 0) * H * 0.18 * (S.lookRoom ?? 1));
      if (S.look) { const L = pointOf(S.look, _c); if (L) out.target.lerp(L, S.lookMix ?? 0.35); }
    }
    // moves
    const mv = S.move, dur = S.dur ?? 4;
    if (mv && mv !== 'static') {
      const k = MathUtils.smootherstep(Math.min(1, t / dur), 0, 1);
      const amt = S.amount ?? 1;
      const fwd = _a.copy(out.target).sub(out.pos).normalize();
      if (mv === 'push') out.pos.addScaledVector(fwd, (k - 0.5) * 0.6 * amt * (FRAME[type] ?? 1));
      if (mv === 'pull') out.pos.addScaledVector(fwd, -(k - 0.5) * 0.6 * amt * (FRAME[type] ?? 1));
      if (mv === 'crane') out.pos.y += (k - 0.5) * 1.2 * amt;
      if (mv === 'drop') out.pos.y -= (k - 0.5) * 1.2 * amt;
      if (mv === 'truck') out.pos.addScaledVector(_b.crossVectors(fwd, new Vector3(0, 1, 0)).normalize(), (k - 0.5) * 0.8 * amt);
      if (mv === 'orbit') {
        const ang = MathUtils.degToRad((k - 0.5) * (S.orbit ?? 30));
        const rel = _b.copy(out.pos).sub(out.target);
        rel.applyAxisAngle(new Vector3(0, 1, 0), ang);
        out.pos.copy(out.target).add(rel);
      }
    }
    if (this.bounds) out.pos.clamp(this.bounds.min, this.bounds.max);
    out.roll = MathUtils.degToRad(S.dutch ?? 0);
  }

  kick(amount = 0.5) { this.shake = Math.min(1.5, this.shake + amount); }

  update(dt) {
    const cam = this.camera;
    this.noiseT += dt;
    if (this.mode === 'follow' && this.follow) {
      const F = this.follow, a = F.actor;
      const want = a.yaw;
      F.yaw += Math.atan2(Math.sin(want - F.yaw), Math.cos(want - F.yaw)) * Math.min(1, dt * 2.2);
      const back = new Vector3(-Math.sin(F.yaw), 0, -Math.cos(F.yaw));
      const right = new Vector3(Math.cos(F.yaw), 0, -Math.sin(F.yaw));
      const head = a.chest(new Vector3()); head.y += F.height;
      const pos = head.clone().addScaledVector(back, F.dist).addScaledVector(right, -F.shoulder);
      pos.y += Math.sin(MathUtils.degToRad(-F.pitch)) * F.dist;
      if (this.bounds) pos.clamp(this.bounds.min, this.bounds.max);
      this.cur.pos.lerp(pos, Math.min(1, dt * 5));
      this.cur.target.lerp(head.clone().addScaledVector(back, -2.5).addScaledVector(right, -0.2), Math.min(1, dt * 6));
      this.cur.fov = vfov(F.lens);
      this.cur.roll = 0;
      this.stage.lens.focus = this.cur.pos.distanceTo(a.chest(_c));
    } else if (this.mode === 'shot' && this.shot) {
      this.t += dt;
      const tracking = this.shot.move === 'track' || this.shot.track !== false;
      if (tracking) this._solve(this.t, this.to);
      if (this.blend > 0 && this.t < this.blend) {
        const k = MathUtils.smootherstep(this.t / this.blend, 0, 1);
        this.cur.pos.copy(this.from.pos).lerp(this.to.pos, k);
        this.cur.target.copy(this.from.target).lerp(this.to.target, k);
        this.cur.fov = this.from.fov + (this.to.fov - this.from.fov) * k;
      } else {
        // a camera operator follows a moving subject with a little lag
        const k = this.shot.move === 'track' ? Math.min(1, dt * 4) : 1;
        this.cur.pos.lerp(this.to.pos, k); this.cur.target.lerp(this.to.target, k);
        this.cur.fov = this.to.fov;
      }
      this.cur.roll = this.to.roll;
      const fp = pointOf(this.shot.focus ?? this.shot.on, _c);
      if (fp) this.stage.lens.focus = this.cur.pos.distanceTo(fp);
    }
    if (this.mode === 'manual') return;
    cam.position.copy(this.cur.pos);
    cam.lookAt(this.cur.target);
    // handheld: slow drift of an operator breathing, plus impact shake
    const hh = (this.shot?.handheld ?? (this.mode === 'follow' ? 0.15 : 0.08)) + this.shake;
    if (hh > 0) {
      const n = this.noiseT;
      const rx = (Math.sin(n * 0.9) * 0.6 + Math.sin(n * 2.3 + 1.3) * 0.3 + Math.sin(n * 5.1) * 0.1 * this.shake * 4) * 0.004 * hh;
      const ry = (Math.sin(n * 0.7 + 2) * 0.6 + Math.sin(n * 1.9) * 0.3 + Math.sin(n * 6.3 + 0.5) * 0.1 * this.shake * 4) * 0.005 * hh;
      cam.rotateX(rx); cam.rotateY(ry);
    }
    if (this.cur.roll) cam.rotateZ(this.cur.roll);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (Math.abs(cam.fov - this.cur.fov) > 0.01) { cam.fov = this.cur.fov; cam.updateProjectionMatrix(); }
  }
}

void Quaternion; void Euler;
