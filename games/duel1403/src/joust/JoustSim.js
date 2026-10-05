import { Vector3, Quaternion } from 'three';
import { World, Body, Shape } from '../physics/index.js';
import { Horse } from './Horse.js';
import { Rider } from './Rider.js';
import { Lance } from './Lance.js';
import { HORSE, RULES } from '../data/joust.js';

const _v = new Vector3(), _v2 = new Vector3(), _d = new Vector3(), _q = new Quaternion();
const UP = new Vector3(0, 1, 0);

/** The joust field: a run along +X, centred on `center`. Shared by sim, scenery and terrain. */
export const FIELD = {
  center: new Vector3(0, 0, -30),
  start: 30,          // each rider starts this far from the middle
  end: 46,            // and pulls up before this
  lane: 0.8,          // half the distance between the horses' lines
  halfLength: 52,
  halfWidth: 9,
};

/** Mulberry32: a seeded generator so a course can be replayed. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A joust of peace at large: two horses, two riders in the high saddle, two
 * coronel lances, run over a number of courses with Band scoring.
 *
 * Each rider has a controller (player or AI) that writes `ctrl`:
 *   speed   wanted horse speed (m/s)
 *   lane    shift of his line towards the opponent (m, + is closer)
 *   aim     world point the lance should meet (or null)
 *   brace   true on the frame he leans into the blow
 */
export class JoustSim {
  constructor({ riders = [{}, {}], seed = 1403, substeps = 20, saddle = 'hohenzeug' } = {}) {
    this.saddle = saddle;
    this.world = new World({ substeps });
    this.dt = 1 / 60;
    this.time = 0;
    this.rand = seeded(seed);
    const ground = new Body({ name: 'ground' });
    ground.addShape(Shape.plane(UP, 0, { friction: 0.7, restitution: 0.05, userData: { part: 'ground' } }));
    this.world.addBody(ground);

    this.horses = [];
    this.riders = [];
    this.lances = [];
    riders.forEach((cfg, i) => {
      const horse = new Horse(this.world, { id: i, coat: cfg.coat ?? (i ? 'grey' : 'bay') });
      const rider = new Rider(this.world, { ...cfg, id: i, key: cfg.id, horse, saddle });
      this.horses.push(horse);
      this.riders.push(rider);
      rider.ctrl = { speed: HORSE.gaits.canter + 1.2, lane: 0, aim: null, brace: false };
      rider.score = { points: 0, broken: 0, attaints: 0, fouls: 0, courses: [] };
    });
    this.riders.forEach((r, i) => {
      const lance = new Lance(this.world, r, { rand: this.rand });
      this.lances.push(lance);
      r.lance = lance;
      r.opponent = this.riders[1 - i];
    });
    for (const [i, l] of this.lances.entries()) {
      const o = this.riders[1 - i];
      l.strike.targets = [
        o.ecranche,
        ...o.ragdoll.list.flatMap((b) => b.shapes.filter((s) => s.type !== 'box' && s !== o.ecranche)),
        ...o.horse.body.shapes,
      ];
      l.strike.onBreak = (c) => this._onBreak(i, c);
    }
    // Who may touch whom: a seated rider and his own horse are one; lances are handled by hand.
    this.world.collisionFilter = (s1, s2) => {
      const u1 = s1.userData, u2 = s2.userData;
      if (u1.part === 'ground' || u2.part === 'ground') return true;
      if (u1.lanceOf !== undefined || u2.lanceOf !== undefined || u1.part === 'lance-piece' || u2.part === 'lance-piece') return false;
      const f1 = u1.fighter ?? (u1.horse ? u1.owner : undefined), f2 = u2.fighter ?? (u2.horse ? u2.owner : undefined);
      if (f1 === undefined || f2 === undefined) return true;
      if (u1.horse && u2.horse) return false;
      if (f1 === f2) return !this.riders[f1].seated && (u1.horse || u2.horse);
      return true;
    };
    this._carry = new Vector3(); this._aim = new Vector3(); this._dir = new Vector3();
    this.listeners = [];
    this.course = 0;
    this.phase = 'ready';
    this.phaseT = 0;
    this.dir = 1;            // rider 0 rides towards +X on odd courses
    this.over = false;
    this.winner = null;
    this.strikes = [];       // this course's strikes, per lance
    this.slowmo = 0;
    this.startCourse();
  }

  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  emit(e) { e.t = this.time; for (const f of this.listeners) f(e); }

  get a() { return this.riders[0]; }
  get b() { return this.riders[1]; }

  /** The line each rider rides: left side to left side. */
  laneOf(i, dir = this.dir) {
    const d = i === 0 ? dir : -dir;               // his direction along X
    const leftZ = -d;                             // facing +X his left is -Z
    const r = this.riders[i];
    // The opponent is on his left: his own line lies to the right of the middle.
    const half = Math.max(0.35, FIELD.lane - (r.ctrl?.lane ?? 0));
    return { d, z: FIELD.center.z - leftZ * half, yaw: d > 0 ? Math.PI / 2 : -Math.PI / 2 };
  }

  startCourse() {
    this.course++;
    if (this.course > 1) this.dir = -this.dir;
    this.strikes = [null, null];
    this.passed = false;
    for (const [i, r] of this.riders.entries()) {
      const ln = this.laneOf(i);
      const h = this.horses[i];
      h.place(FIELD.center.x - ln.d * FIELD.start, ln.z, ln.yaw);
      h.goal = null;
      h.heading = ln.yaw;
      r.couch = 0;
      r.brace = 0; r.braceT = 0; r.braceCool = 0;
      r.ctrl.aim = null;
      r.seat(true);
      const l = this.lances[i];
      if (l.broken) this._newLance(i);
      l.hold.enabled = true;
      l.strike.enabled = true;
      l.strike.contact = null;
      this._aimLance(i, 0);
      l.place();
    }
    this.phase = 'ready';
    this.phaseT = 0;
    this.emit({ type: 'course', n: this.course });
  }

  _newLance(i) {
    const old = this.lances[i];
    const r = this.riders[i];
    this.world.removeBody(old.body);
    this.world.constraints = this.world.constraints.filter((c) => c !== old.hold && c !== old.strike);
    if (old.piece) this.world.removeBody(old.piece.body);
    const l = new Lance(this.world, r, { rand: this.rand });
    const o = this.riders[1 - i];
    l.strike.targets = old.strike.targets;
    l.strike.onBreak = (c) => this._onBreak(i, c);
    this.lances[i] = l;
    r.lance = l;
    this.emit({ type: 'newLance', rider: r, lance: l, old });
    void o;
  }

  /** Lance attitude: upright while riding up, couched across the neck for the strike. */
  _aimLance(i, dt) {
    const r = this.riders[i], l = this.lances[i], h = this.horses[i];
    if (!r.seated) return;
    // Carried: butt on the thigh, the head up and a little out to the left.
    const carry = this._carry.set(0.18, 0.92, 0.34).normalize().applyQuaternion(h.body.q);
    let aim = this._couchedDir(i, this._aim);
    if (r.ctrl.aim) aim = this._aimDir(i, r.ctrl.aim, this._aim);
    // Lag the couch: lowering a lance takes about a second.
    const dir = this._dir.copy(carry).lerp(aim, smooth(r.couch)).normalize();
    // The horse's gait shakes the point; a skilled rider damps it.
    const g = { halt: 0, walk: 0.15, trot: 0.6, canter: 0.75, gallop: 1 }[h.gait];
    const amp = (0.01 + 0.035 * (1 - r.skill)) * g;
    const ph = h.phase * Math.PI * 2;
    dir.x += amp * Math.sin(ph * 1 + i);
    dir.y += amp * 1.4 * Math.cos(ph);
    l.aim(dir.normalize());
    void dt;
  }

  /** The default couched line: across the neck, level. */
  _couchedDir(i, out) {
    const h = this.horses[i];
    return out.set(0.38, -0.02, 1).normalize().applyQuaternion(_q.setFromAxisAngle(UP, h.yaw));
  }

  /**
   * The direction that brings the head of the lance onto a moving point: the
   * point's path relative to the rest is a straight line (both horses run
   * straight), so solve |D + v t| = reach for the first contact.
   */
  _aimDir(i, point, out) {
    const r = this.riders[i], l = this.lances[i], o = this.riders[1 - i];
    const R = l.restPoint;
    const D = _d.subVectors(point, R);
    // horizontal only: the gait bounce is not a course to extrapolate
    const vrel = _v.subVectors(o.horse.body.vel, r.horse.body.vel).setY(0);
    const reach = l.reach;
    const a = vrel.lengthSq(), b = 2 * D.dot(vrel), c = D.lengthSq() - reach * reach;
    let t = 0;
    if (c > 0 && a > 1e-6) {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) t = (-b - Math.sqrt(disc)) / (2 * a);
      else t = Math.max(0, -b / (2 * a));          // he passes out of reach: aim at closest approach
    }
    out.copy(D).addScaledVector(vrel, Math.max(0, t)).normalize();
    // Within what arm, rest and the horse's neck allow (horse frame).
    const h = this.horses[i];
    _q.setFromAxisAngle(UP, -h.yaw);
    out.applyQuaternion(_q);
    let yaw = Math.atan2(out.x, out.z), pitch = Math.asin(Math.max(-1, Math.min(1, out.y)));
    yaw = Math.max(-0.1, Math.min(0.8, yaw));
    pitch = Math.max(-0.32, Math.min(0.22, pitch));
    out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    return out.applyQuaternion(_q.setFromAxisAngle(UP, h.yaw));
  }

  /** Distance between the riders along the run, signed: > 0 before they pass. */
  closing() {
    const A = this.horses[0].body.pos, B = this.horses[1].body.pos;
    return (B.x - A.x) * this.dir;
  }

  /** Seconds until the lances meet, roughly. */
  timeToImpact(i) {
    const d = this.closing() - this.lances[i].reach * 0.85;
    const v = this.horses[0].speed + this.horses[1].speed;
    return v > 0.5 ? d / v : Infinity;
  }

  // --- the step ---------------------------------------------------------------------------

  step() {
    const dt = this.dt;
    this.phaseT += dt;
    this.slowmo = Math.max(0, this.slowmo - dt);
    const close = this.closing();
    if (this.phase === 'ready') {
      for (const h of this.horses) h.targetSpeed = 0;
      if (this.phaseT > 2.6 && !this.over) { this.phase = 'charge'; this.phaseT = 0; this.emit({ type: 'charge', n: this.course }); }
    } else if (this.phase === 'charge') {
      for (const [i, r] of this.riders.entries()) {
        const h = this.horses[i], ln = this.laneOf(i);
        h.targetSpeed = r.seated ? Math.max(HORSE.gaits.trot, Math.min(HORSE.gaits.gallop, r.ctrl.speed)) : HORSE.gaits.canter;
        h.goal = { x: FIELD.center.x + ln.d * (FIELD.end + 10), z: ln.z };
        // Couch the lance as they close; about a second to bring it down.
        const want = close < 34 ? 1 : 0;
        r.couch += Math.sign(want - r.couch) * Math.min(Math.abs(want - r.couch), dt * 1.0);
        r.twist = 0.18 * r.couch;
      }
      if (close < -1.5 && !this.passed) { this.passed = true; this.phase = 'pass'; this.phaseT = 0; }
    } else if (this.phase === 'pass') {
      for (const [i, r] of this.riders.entries()) {
        const h = this.horses[i], ln = this.laneOf(i);
        r.couch = Math.max(0, r.couch - dt * 0.8);
        r.twist = 0.18 * r.couch;
        const left = FIELD.end - h.body.pos.x * ln.d + FIELD.center.x * ln.d;
        h.targetSpeed = left < 8 ? 0 : HORSE.gaits.trot;
      }
      if (this.phaseT > 0.7 && !this._scored) this._scoreCourse();
      if (this.phaseT > 4.2) this._endOfCourse();
    }

    for (const [i, r] of this.riders.entries()) {
      if (r.ctrl.brace) { r.doBrace(); r.ctrl.brace = false; }
      r.lookAt = r.opponent.b.head.pos;
      r.handTarget = this.lances[i].hold.enabled ? this.lances[i].grip : null;
      this._aimLance(i, dt);
      r.update(dt);
      this.horses[i].plan(dt);
    }
    this.world.step(dt);
    for (const h of this.horses) h.commit();
    for (const [i, l] of this.lances.entries()) {
      const c = l.strike.settle();
      if (c) this._recordStrike(i, c);
      if (l.piece) l.piece.t += dt;
    }
    this._checkSeats();
    this.time += dt;
  }

  _zoneOf(shape) {
    const u = shape.userData;
    if (u.part === 'ecranche') return 'ecranche';
    if (u.horse) return 'horse';
    return u.segType ?? 'chest';
  }

  _onBreak(i, c) {
    const l = this.lances[i];
    l.breakOff(c);
    const zone = this._zoneOf(c.shape);
    const o = this.riders[1 - i];
    this.strikes[i] = { ...this._strikeInfo(i, c), broke: true };
    this.slowmo = 1.2;
    this.emit({ type: 'break', rider: this.riders[i], target: o, zone, force: c.peak, impulse: c.impulse, speed: c.speed, point: c.point.clone(), how: c.broke, lance: l });
  }

  _strikeInfo(i, c) {
    const zone = this._zoneOf(c.shape);
    return { zone, kind: RULES.zones[zone] ?? 'body', force: c.peak, impulse: c.impulse, speed: c.speed, point: c.point.clone(), part: c.shape.userData.part };
  }

  _recordStrike(i, c) {
    if (this.strikes[i]?.broke) return;          // the break already recorded this strike
    if (c.impulse < 2) return;                   // a brush
    this.strikes[i] = { ...this._strikeInfo(i, c), broke: false };
    this.emit({ type: 'attaint', rider: this.riders[i], target: this.riders[1 - i], ...this.strikes[i] });
  }

  _checkSeats() {
    for (const r of this.riders) {
      if (!r.seated) continue;
      const d = r.displacement();
      let cause = null;
      const U = r.saddle.unseat;
      if (d.seat > U.seat) cause = 'seat';
      else if (d.back > U.back) cause = 'back';
      else if (d.pelvisRot > U.twist) cause = 'twist';
      if (cause) {
        r.unseat(cause);
        this.lances[r.id].drop();
        this.slowmo = 2;
        this.emit({ type: 'unhorse', rider: r, by: r.opponent, cause });
      }
    }
  }

  _scoreCourse() {
    this._scored = true;
    const res = [];
    for (const [i, r] of this.riders.entries()) {
      const s = this.strikes[i];
      const o = r.opponent;
      let pts = 0, text;
      if (!s) text = 'missed';
      else if (s.kind === 'foul') {
        pts = -RULES.foulPenalty;
        r.score.fouls++;
        text = s.zone === 'horse' ? 'struck the horse: foul' : 'struck below the girdle: foul';
      } else if (s.broke) {
        pts = RULES.points[s.kind];
        r.score.broken++;
        text = `broke his lance on the ${s.kind === 'helm' ? 'helm' : s.zone === 'ecranche' ? 'shield' : 'body'}`;
        // A hard blow on the great helm can tear it from its laces and chain.
        if (s.kind === 'helm' && !o.helmOff) {
          const p = Math.max(0, Math.min(0.4, (s.impulse - 12) / 60));
          if (this.rand() < p) {
            o.helmOff = true;
            pts += RULES.points.unhelm;
            text += ' and unhelmed him';
            this.emit({ type: 'unhelm', rider: o, by: r });
          }
        }
      } else {
        r.score.attaints++;
        text = `struck the ${s.kind === 'helm' ? 'helm' : s.zone === 'ecranche' ? 'shield' : 'body'} without breaking`;
      }
      if (s && (s.kind === 'helm')) o.stun = Math.min(1, o.stun + s.impulse / 120);
      r.score.points += pts;
      r.score.courses.push({ n: this.course, pts, text, strike: s });
      res.push({ rider: r, pts, text, strike: s });
    }
    this.emit({ type: 'score', n: this.course, results: res });
  }

  _endOfCourse() {
    this._scored = false;
    const [A, B] = this.riders;
    if (!A.seated || !B.seated) {
      // Unhorsing ends it. Both down: the points decide.
      const down = [A, B].filter((r) => !r.seated);
      const winner = down.length === 1 ? down[0].opponent : A.score.points === B.score.points ? null : A.score.points > B.score.points ? A : B;
      return this._finish(winner, down.length === 1 ? `${down[0].name} is borne to the ground` : 'both men are unhorsed');
    }
    const pa = A.score.points, pb = B.score.points;
    if (this.course >= RULES.courses && pa !== pb) return this._finish(pa > pb ? A : B, 'on lances broken');
    if (this.course >= RULES.courses + RULES.extraCourses) return this._finish(null, 'the judges cannot part them');
    this.startCourse();
  }

  _finish(winner, how) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.phase = 'over';
    this.phaseT = 0;
    for (const h of this.horses) h.targetSpeed = 0;
    this.emit({ type: 'end', winner, how });
  }
}

function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
