/**
 * The physics world: static colliders (a level), dynamic rigid bodies (capsules and spheres), joints, kinematic
 * characters, triggers and queries.
 *
 *   const world = new World();
 *   world.addCollider(new PlaneCollider(new Vector3(0, 1, 0), 0));
 *   const body = world.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.3 }, mass: 2, position }));
 *   world.step(1 / 60);
 *
 * The solver is a sequential-impulse solver run in substeps: every substep re-detects contacts, applies the
 * impulses of the previous substep (warm starting), iterates the joints and contacts with a small position-error
 * bias, moves the bodies, and then runs a few relax iterations without the bias so that error correction does not
 * add energy. Restitution is applied after the relax pass. Friction is a pyramid per contact.
 */
import { Vector3, Quaternion } from '../math/core.js';
import { AABBTree } from './AABBTree.js';
import { Contacts, capsuleVsCapsule, rayCapsule } from './Collide.js';

/**
 * What `new World()` takes (and Engine's `physics` option).
 * @typedef {object} WorldOptions
 * @property {Vector3} [gravity]    metres per second squared (default (0, -9.81, 0))
 * @property {number} [substeps]    solver substeps per step (4)
 * @property {number} [iterations]  solver iterations per substep (4)
 * @property {number} [relax]       relax iterations per substep, without the position bias (2)
 * @property {boolean} [sleeping]   let resting bodies fall asleep (true)
 */
import { RigidBody } from './Body.js';

/**
 * @import { Collider, PlaneCollider } from './Colliders.js'
 * @import { Joint } from './Joints.js'
 * @import { Character } from './Character.js'
 */

/**
 * Called when something enters or leaves a trigger: a Character, or a RigidBody that has `triggerActivator` set.
 * @typedef {(who: Character | RigidBody) => void} TriggerCallback
 */

/**
 * What `world.addTrigger(collider, o)` takes.
 * @typedef {object} TriggerOptions
 * @property {TriggerCallback | null} [onEnter]  called once when something comes in
 * @property {TriggerCallback | null} [onExit]   called once when it leaves
 * @property {((who: Character | RigidBody) => boolean) | null} [filter]  only things it returns true for count
 */

/**
 * A trigger volume, as `addTrigger` returns it (give it back to `removeTrigger`).
 * @typedef {object} Trigger
 * @property {Collider} collider
 * @property {TriggerCallback | null} onEnter
 * @property {TriggerCallback | null} onExit
 * @property {((who: Character | RigidBody) => boolean) | null} filter
 * @property {Set<Character | RigidBody>} inside  who is in the volume right now
 */

/**
 * The nearest thing a ray hit.
 * @typedef {object} RayHit
 * @property {number} t           distance along the ray
 * @property {Vector3} point
 * @property {Vector3} normal     unit surface normal
 * @property {Collider | null} collider  the static collider that was hit (null when it was a body)
 * @property {RigidBody | null} body     the body that was hit (null when it was a static collider)
 */

/**
 * What `world.raycast(origin, dir, maxT, o)` takes.
 * @typedef {object} RaycastOptions
 * @property {number} [mask]      which collision groups count (default: all)
 * @property {boolean} [bodies]   test the dynamic bodies too (default true)
 * @property {RigidBody | null} [ignore]  a body to skip, such as the one shooting
 */

/**
 * What `overlapSphere` and `sphereCast` take.
 * @typedef {object} OverlapOptions
 * @property {number} [mask]      which collision groups count (default: all)
 * @property {number} [group]     the group the query itself belongs to (default 1)
 * @property {boolean} [bodies]   test the dynamic bodies too (default false)
 * @property {RigidBody | null} [ignore]  a body to skip
 */

/**
 * Where a swept sphere first touched something.
 * @typedef {object} SweepHit
 * @property {number} t        how far the sphere travelled before touching (0 when it starts inside something)
 * @property {Vector3} point   where its centre was then
 * @property {Vector3} normal  the surface normal there
 * @property {boolean} [startsInside]  the sphere already overlapped something at the start
 */

const SLOP = 0.002;            // penetration tolerated before the solver pushes back (m)
const BAUMGARTE = 0.2;
const MAX_PUSH = 3;            // fastest position recovery (m/s)
const REST_THRESHOLD = 1.0;    // slowest impact that bounces (m/s)
const MAX_LIN = 120, MAX_ANG = 60;
const SLEEP_LIN = 0.09, SLEEP_ANG = 0.18, SLEEP_TIME = 0.6;
const ZERO9 = new Float64Array(9);

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3();
const _hit = { t: 0, nx: 0, ny: 0, nz: 0 };

class ContactConstraint {
  constructor() {
    this.a = null; this.b = null; this.owner = null; this.key = 0;
    this.px = 0; this.py = 0; this.pz = 0; this.nx = 0; this.ny = 0; this.nz = 0; this.depth = 0;
    this.rax = 0; this.ray = 0; this.raz = 0; this.rbx = 0; this.rby = 0; this.rbz = 0;
    this.t1x = 0; this.t1y = 0; this.t1z = 0; this.t2x = 0; this.t2y = 0; this.t2z = 0;
    this.ima = 0; this.imb = 0; this.Ia = ZERO9; this.Ib = ZERO9;
    this.mn = 0; this.mt1 = 0; this.mt2 = 0;
    this.jn = 0; this.jt1 = 0; this.jt2 = 0;
    this.friction = 0; this.restitution = 0; this.bounce = 0; this.bias = 0;
  }
}

class PairCache { constructor() { this.n = 0; this.d = new Float64Array(28); this.stamp = 0; } }

export class World {
  /** @param {WorldOptions} [o] */
  constructor({ gravity = new Vector3(0, -9.81, 0), substeps = 4, iterations = 4, relax = 2, sleeping = true } = {}) {
    this.gravity = gravity.clone();
    this.substeps = substeps; this.iterations = iterations; this.relax = relax; this.sleeping = sleeping;
    /** @type {RigidBody[]} */ this.bodies = [];
    /** @type {Joint[]} */ this.joints = [];
    /** @type {Collider[]} */ this.colliders = [];
    /** @type {PlaneCollider[]} */ this.planes = [];
    /** @type {Character[]} */ this.characters = [];
    /** @type {Trigger[]} */ this.triggers = [];
    /** A fixed body to pin joints to the world: `new BallJoint(world.ground, body, anchor)`. */
    this.ground = new RigidBody({ shape: { type: 'sphere', radius: 0.01 }, mass: 0, driven: true });
    this.time = 0;
    this._tree = null; this._treeColliders = []; this._dirty = false;
    this._pool = []; this._nc = 0;
    this._pairs = new Map(); this._stamp = 0;
    this._cs = new Contacts(); this._co = [];       // scratch contacts + owners
    this._active = []; this._activeJoints = [];
    this._visit = (i) => this._visitCollider(this._treeColliders[i]);
    this._qa = null; this._qb = null; this._qr = 0; this._qgroup = 1; this._qmask = 0xffffffff; this._qout = null; this._qowners = null;
    this._mark = 1;
  }

  // ----------------------------------------------------------------------------------------------- scene content

  /**
   * Adds a static collider (a piece of the level). Trigger volumes go through `addTrigger`.
   * @template {Collider} C
   * @param {C} c
   * @returns {C}
   */
  addCollider(c) {
    if (c.isTrigger) throw new Error('Use addTrigger() for trigger colliders');
    this.colliders.push(c); if (c.type === 'plane') this.planes.push(c); this._dirty = true; return c;
  }
  /** @param {Collider} c */
  removeCollider(c) {
    let i = this.colliders.indexOf(c); if (i >= 0) this.colliders.splice(i, 1);
    i = this.planes.indexOf(c); if (i >= 0) this.planes.splice(i, 1);
    this._dirty = true;
  }
  /**
   * Adds a rigid body.
   * @template {RigidBody} B
   * @param {B} b
   * @returns {B}
   */
  addBody(b) { if (b.world) throw new Error('Body is already in a world'); b.world = this; this.bodies.push(b); return b; }
  /** @param {RigidBody} b */
  removeBody(b) {
    const i = this.bodies.indexOf(b); if (i < 0) return;
    this.bodies.splice(i, 1); b.world = null;
    for (const j of [...b.joints]) this.removeJoint(j);
  }
  /**
   * Adds a joint between two bodies (see BallJoint, HingeJoint).
   * @template {Joint} J
   * @param {J} j
   * @returns {J}
   */
  addJoint(j) { j.world = this; this.joints.push(j); return j; }
  /** @param {Joint} j */
  removeJoint(j) { const i = this.joints.indexOf(j); if (i >= 0) this.joints.splice(i, 1); j.dispose(); j.world = null; }
  /**
   * Registers a Character so dynamic bodies collide with it and triggers see it.
   * @template {Character} C
   * @param {C} ch
   * @returns {C}
   */
  addCharacter(ch) {
    if (!this.characters.includes(ch)) { this.characters.push(ch); this.addBody(ch.body); }
    return ch;
  }
  /** @param {Character} ch */
  removeCharacter(ch) { const i = this.characters.indexOf(ch); if (i >= 0) { this.characters.splice(i, 1); this.removeBody(ch.body); } }
  /**
   * A volume that reports who is inside it. `onEnter(who)` / `onExit(who)` get a Character or a RigidBody
   * (bodies only when `triggerActivator` is set on them).
   * @param {Collider} collider  the volume
   * @param {TriggerOptions} [o]
   * @returns {Trigger}
   */
  addTrigger(collider, { onEnter = null, onExit = null, filter = null } = {}) {
    collider.isTrigger = true;
    const t = { collider, onEnter, onExit, filter, inside: new Set() };
    this.triggers.push(t); return t;
  }
  /** @param {Trigger} t */
  removeTrigger(t) { const i = this.triggers.indexOf(t); if (i >= 0) this.triggers.splice(i, 1); }

  _ensureTree() {
    if (!this._dirty) return;
    this._dirty = false;
    const list = this.colliders.filter((c) => c.type !== 'plane');
    this._treeColliders = list;
    if (!list.length) { this._tree = null; return; }
    const boxes = new Float32Array(list.length * 6);
    list.forEach((c, i) => boxes.set(c.aabb, i * 6));
    this._tree = new AABBTree(boxes);
  }
  /** Call after moving a static collider (BoxCollider.setTransform ...). */
  refreshColliders() { this._dirty = true; }

  // ----------------------------------------------------------------------------------------------- queries

  _visitCollider(c) {
    if (!((c.group & this._qmask) && (this._qgroup & c.mask))) return;
    const out = this._qout, start = out.n;
    c.collideCapsule(this._qa, this._qb, this._qr, out);
    if (this._qowners) for (let i = start; i < out.n; i++) this._qowners[i] = c;
  }

  /**
   * Appends to `out` (Contacts) the contacts of the capsule a-b (radius r) with the static colliders; `owners[i]`
   * receives the Collider of contact i. `group`/`mask` are the capsule's own collision filter.
   * @param {Vector3} a  one end of the capsule's axis
   * @param {Vector3} b  the other end
   * @param {number} r   radius
   * @param {number} group
   * @param {number} mask
   * @param {Contacts} out
   * @param {Collider[] | null} [owners]
   */
  collideStatics(a, b, r, group, mask, out, owners = null) {
    this._ensureTree();
    this._qa = a; this._qb = b; this._qr = r; this._qgroup = group; this._qmask = mask; this._qout = out; this._qowners = owners;
    for (let i = 0; i < this.planes.length; i++) this._visitCollider(this.planes[i]);
    if (this._tree) {
      const x0 = Math.min(a.x, b.x) - r, y0 = Math.min(a.y, b.y) - r, z0 = Math.min(a.z, b.z) - r, x1 = Math.max(a.x, b.x) + r, y1 = Math.max(a.y, b.y) + r, z1 = Math.max(a.z, b.z) + r;
      this._tree.query(x0, y0, z0, x1, y1, z1, this._visit);
    }
  }

  /**
   * Same against the world's bodies (dynamic, kinematic and character bodies), except `ignore`. owners[i] = RigidBody.
   * @param {Vector3} a
   * @param {Vector3} b
   * @param {number} r
   * @param {number} group
   * @param {number} mask
   * @param {Contacts} out
   * @param {RigidBody[] | null} [owners]
   * @param {RigidBody | null} [ignore]
   */
  collideBodies(a, b, r, group, mask, out, owners = null, ignore = null) {
    const x0 = Math.min(a.x, b.x) - r, y0 = Math.min(a.y, b.y) - r, z0 = Math.min(a.z, b.z) - r, x1 = Math.max(a.x, b.x) + r, y1 = Math.max(a.y, b.y) + r, z1 = Math.max(a.z, b.z) + r;
    for (let k = 0; k < this.bodies.length; k++) {
      const o = this.bodies[k];
      if (o === ignore || !o.enabled || !((o.group & mask) && (group & o.mask))) continue;
      o.segment(_c, _d);
      const rs = o.shape.radius;
      if (Math.max(_c.x, _d.x) + rs < x0 || Math.min(_c.x, _d.x) - rs > x1 || Math.max(_c.y, _d.y) + rs < y0 || Math.min(_c.y, _d.y) - rs > y1 || Math.max(_c.z, _d.z) + rs < z0 || Math.min(_c.z, _d.z) - rs > z1) continue;
      const start = out.n;
      capsuleVsCapsule(a, b, r, _c, o.shape.type === 'sphere' ? _c : _d, rs, out);
      if (owners) for (let i = start; i < out.n; i++) owners[i] = o;
    }
  }

  /**
   * Nearest ray hit: { t, point, normal, collider, body } or null.
   * @param {Vector3} origin
   * @param {Vector3} dir  unit direction
   * @param {number} [maxT]  the longest distance to look (default: unlimited)
   * @param {RaycastOptions} [o]
   * @returns {RayHit | null}
   */
  raycast(origin, dir, maxT = Infinity, { mask = 0xffffffff, bodies = true, ignore = null } = {}) {
    this._ensureTree();
    const ox = origin.x, oy = origin.y, oz = origin.z, dx = dir.x, dy = dir.y, dz = dir.z;
    let best = maxT, collider = null, body = null, nx = 0, ny = 0, nz = 0;
    for (const p of this.planes) {
      if (!(p.group & mask)) continue;
      if (p.raycast(ox, oy, oz, dx, dy, dz, best, _hit) && _hit.t <= best) { best = _hit.t; collider = p; body = null; nx = _hit.nx; ny = _hit.ny; nz = _hit.nz; }
    }
    if (this._tree) {
      this._tree.raycast(ox, oy, oz, dx, dy, dz, best, (i) => {
        const c = this._treeColliders[i];
        if (!(c.group & mask)) return undefined;
        if (c.raycast(ox, oy, oz, dx, dy, dz, best, _hit) && _hit.t <= best) { best = _hit.t; collider = c; body = null; nx = _hit.nx; ny = _hit.ny; nz = _hit.nz; return best; }
        return undefined;
      });
    }
    if (bodies) {
      for (const o of this.bodies) {
        if (o === ignore || !o.enabled || !(o.group & mask)) continue;
        o.segment(_c, _d);
        const t = rayCapsule(ox, oy, oz, dx, dy, dz, _c, o.shape.type === 'sphere' ? _c : _d, o.shape.radius, best);
        if (t >= 0 && t <= best) {
          best = t; body = o; collider = null;
          // normal: from the closest axis point to the hit point
          const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
          const abx = _d.x - _c.x, aby = _d.y - _c.y, abz = _d.z - _c.z, l2 = abx * abx + aby * aby + abz * abz;
          const s = l2 > 1e-12 ? Math.min(1, Math.max(0, ((hx - _c.x) * abx + (hy - _c.y) * aby + (hz - _c.z) * abz) / l2)) : 0;
          nx = hx - (_c.x + abx * s); ny = hy - (_c.y + aby * s); nz = hz - (_c.z + abz * s);
          const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        }
      }
    }
    if (!collider && !body) return null;
    return { t: best, point: new Vector3(ox + dx * best, oy + dy * best, oz + dz * best), normal: new Vector3(nx, ny, nz), collider, body };
  }

  /**
   * Does a sphere at `p` overlap anything?
   * @param {Vector3} p  centre
   * @param {number} r   radius
   * @param {OverlapOptions} [o]
   * @returns {boolean}
   */
  overlapSphere(p, r, { mask = 0xffffffff, group = 1, bodies = false, ignore = null } = {}) {
    const out = this._cs; out.clear();
    this.collideStatics(p, p, r, group, mask, out);
    for (let i = 0; i < out.n; i++) if (out.d[i * 7 + 6] > 1e-5) return true;
    if (bodies) { out.clear(); this.collideBodies(p, p, r, group, mask, out, null, ignore); for (let i = 0; i < out.n; i++) if (out.d[i * 7 + 6] > 1e-5) return true; }
    return false;
  }

  /**
   * Sweeps a sphere along a ray and returns where it first touches something: { t, point, normal } or null.
   * Marched in steps of at most half a radius and refined by bisection, so geometry thinner than that can be
   * skipped. Meant for camera collision and ground probes, not for bullets.
   * @param {Vector3} origin  where the sphere's centre starts
   * @param {Vector3} dir     unit direction
   * @param {number} radius
   * @param {number} maxT     the longest distance to sweep
   * @param {OverlapOptions} [o]  what counts as an obstacle
   * @returns {SweepHit | null}
   */
  sphereCast(origin, dir, radius, maxT, o = {}) {
    const step = Math.max(Math.min(radius * 0.5, 0.25), 0.02);
    const p = _a;
    const at = (t) => p.set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
    const hitAt = (t) => this.overlapSphere(at(t), radius, o);
    if (hitAt(0)) return { t: 0, point: origin.clone(), normal: this._sphereNormal(origin, radius, o), startsInside: true };
    let free = 0;
    for (let t = step; ; t += step) {
      const tt = Math.min(t, maxT);
      if (hitAt(tt)) {
        let lo = free, hi = tt;
        for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (hitAt(m)) hi = m; else lo = m; }
        const point = at(lo).clone();
        return { t: lo, point, normal: this._sphereNormal(at(hi), radius, o) };
      }
      free = tt;
      if (tt >= maxT) return null;
    }
  }
  _sphereNormal(p, r, o) {
    const out = this._cs; out.clear();
    this.collideStatics(p, p, r, o.group ?? 1, o.mask ?? 0xffffffff, out);
    if (o.bodies) this.collideBodies(p, p, r, o.group ?? 1, o.mask ?? 0xffffffff, out, null, o.ignore ?? null);
    let best = -1, bd = -Infinity;
    for (let i = 0; i < out.n; i++) if (out.d[i * 7 + 6] > bd) { bd = out.d[i * 7 + 6]; best = i; }
    if (best < 0) return new Vector3(0, 1, 0);
    return new Vector3(out.d[best * 7 + 3], out.d[best * 7 + 4], out.d[best * 7 + 5]);
  }

  // ----------------------------------------------------------------------------------------------- stepping

  /**
   * Advances the simulation. Large `dt`s are clamped to 1/15 s.
   * @param {number} dt  seconds
   */
  step(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 1 / 15);
    const n = Math.max(1, this.substeps | 0), h = dt / n;
    this._ensureTree();
    for (let s = 0; s < n; s++) this._substep(h);
    for (const b of this.bodies) { b.force.set(0, 0, 0); b.torque.set(0, 0, 0); b.sync(); }
    this.time += dt;
    this._updateTriggers();
    if (this.sleeping) this._updateSleeping(dt);
  }

  _substep(h) {
    const bodies = this.bodies, joints = this.joints;
    this._stamp++;
    // 1. velocities
    const gx = this.gravity.x, gy = this.gravity.y, gz = this.gravity.z;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.enabled || b.sleeping) continue;
      if (b.invMass > 0) {
        const v = b.linearVelocity, w = b.angularVelocity, f = b.force, gs = b.gravityScale, im = b.invMass;
        v.x += (gx * gs + f.x * im) * h; v.y += (gy * gs + f.y * im) * h; v.z += (gz * gs + f.z * im) * h;
        const t = b.torque;
        if (t.x || t.y || t.z) { const m = b.iw; w.x += (m[0] * t.x + m[1] * t.y + m[2] * t.z) * h; w.y += (m[3] * t.x + m[4] * t.y + m[5] * t.z) * h; w.z += (m[6] * t.x + m[7] * t.y + m[8] * t.z) * h; }
        const ld = 1 / (1 + h * b.linearDamping), ad = 1 / (1 + h * b.angularDamping);
        v.x *= ld; v.y *= ld; v.z *= ld; w.x *= ad; w.y *= ad; w.z *= ad;
        const sp = v.lengthSq();
        if (sp > MAX_LIN * MAX_LIN) v.multiplyScalar(MAX_LIN / Math.sqrt(sp));
        const sw = w.lengthSq();
        if (sw > MAX_ANG * MAX_ANG) w.multiplyScalar(MAX_ANG / Math.sqrt(sw));
      }
    }
    // 2. contacts and joints (a joint between sleeping bodies is not solved)
    const aj = this._activeJoints; aj.length = 0;
    for (let i = 0; i < joints.length; i++) {
      const j = joints[i], A = j.bodyA, B = j.bodyB;
      if (j.enabled && ((A.invMass > 0 && !A.sleeping && A.enabled) || (B.invMass > 0 && !B.sleeping && B.enabled))) aj.push(j);
    }
    this._buildContacts();
    this._prepareContacts(h);
    for (let i = 0; i < aj.length; i++) aj[i].prepare(h);
    for (let i = 0; i < aj.length; i++) aj[i].warmStart();
    this._warmStartContacts();
    // 3. solve with bias
    for (let it = 0; it < this.iterations; it++) {
      for (let i = 0; i < aj.length; i++) aj[i].solve(true);
      this._solveContacts(true);
    }
    // 4. positions
    this._integratePositions(h);
    // 5. relax
    for (let it = 0; it < this.relax; it++) {
      for (let i = 0; i < aj.length; i++) aj[i].solve(false);
      this._solveContacts(false);
    }
    this._restitution();
    this._storeContacts();
  }

  _integratePositions(h) {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.enabled || b.sleeping || b.driven) continue;
      const v = b.linearVelocity, w = b.angularVelocity, p = b.position;
      p.x += v.x * h; p.y += v.y * h; p.z += v.z * h;
      const wl = Math.hypot(w.x, w.y, w.z);
      if (wl > 1e-9) {
        const ang = wl * h * 0.5, s = Math.sin(ang) / wl, q = b.quaternion;
        const dx = w.x * s, dy = w.y * s, dz = w.z * s, dw = Math.cos(ang);
        const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
        q.set(dw * qx + dx * qw + dy * qz - dz * qy, dw * qy - dx * qz + dy * qw + dz * qx, dw * qz + dx * qy - dy * qx + dz * qw, dw * qw - dx * qx - dy * qy - dz * qz).normalize();
        b.updateWorld();
      }
    }
  }

  // ----------------------------------------------------------------------------------------------- contacts

  _newContact() {
    if (this._nc === this._pool.length) this._pool.push(new ContactConstraint());
    return this._pool[this._nc++];
  }

  _addContact(a, b, owner, key, d, i, friction, restitution) {
    const c = this._newContact(), o = i * 7;
    c.a = a; c.b = b; c.owner = owner; c.key = key;
    c.px = d[o]; c.py = d[o + 1]; c.pz = d[o + 2]; c.nx = d[o + 3]; c.ny = d[o + 4]; c.nz = d[o + 5]; c.depth = d[o + 6];
    c.friction = Math.sqrt(a.friction * friction); c.restitution = Math.max(a.restitution, restitution);
    const aLive = a.invMass > 0 && !a.sleeping, bLive = b !== null && b.invMass > 0 && !b.sleeping;
    c.ima = aLive ? a.invMass : 0; c.Ia = aLive ? a.iw : ZERO9;
    c.imb = bLive ? b.invMass : 0; c.Ib = bLive ? b.iw : ZERO9;
    c.jn = 0; c.jt1 = 0; c.jt2 = 0; c.bounce = 0;
  }

  _buildContacts() {
    this._nc = 0;
    const bodies = this.bodies, cs = this._cs, co = this._co;
    const active = this._active; active.length = 0;
    for (let k = 0; k < bodies.length; k++) {
      const b = bodies[k];
      if (!b.enabled) continue;
      b.segment(_a, _b);
      const r = b.shape.radius, sphere = b.shape.type === 'sphere';
      b._ax0 = Math.min(_a.x, _b.x) - r; b._ax1 = Math.max(_a.x, _b.x) + r;
      b._ay0 = Math.min(_a.y, _b.y) - r; b._ay1 = Math.max(_a.y, _b.y) + r;
      b._az0 = Math.min(_a.z, _b.z) - r; b._az1 = Math.max(_a.z, _b.z) + r;
      active.push(b);
      if (b.invMass <= 0 || b.sleeping) continue;
      cs.clear();
      this.collideStatics(_a, sphere ? _a : _b, r, b.group, b.mask, cs, co);
      for (let i = 0; i < cs.n; i++) {
        const c = co[i];
        this._addContact(b, null, c, -(c.id * 4194304) - b.id, cs.d, i, c.friction, c.restitution);
      }
    }
    // body vs body: sweep and prune along x
    for (let i = 1; i < active.length; i++) {            // insertion sort, nearly sorted from the previous substep
      const x = active[i]; let j = i - 1;
      while (j >= 0 && active[j]._ax0 > x._ax0) { active[j + 1] = active[j]; j--; }
      active[j + 1] = x;
    }
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        let a = active[i], b = active[j];
        if (b._ax0 > a._ax1) break;
        if (a.id > b.id) { const t = a; a = b; b = t; }          // a stable order keeps warm-start keys and normals consistent
        const aLive = a.invMass > 0 && !a.sleeping, bLive = b.invMass > 0 && !b.sleeping;
        if (!aLive && !bLive) continue;
        if (a._ay1 < b._ay0 || a._ay0 > b._ay1 || a._az1 < b._az0 || a._az0 > b._az1) continue;
        if (!((a.group & b.mask) && (b.group & a.mask))) continue;
        if (a.ignoreGroup !== null && a.ignoreGroup === b.ignoreGroup) continue;
        if (this._jointed(a, b)) continue;
        // a sleeping body hit by a moving one wakes up
        if (!aLive && a.invMass > 0 && (b.driven || b.linearVelocity.lengthSq() > 0.25)) a.wake();
        if (!bLive && b.invMass > 0 && (a.driven || a.linearVelocity.lengthSq() > 0.25)) b.wake();
        a.segment(_a, _b); b.segment(_c, _d);
        const A = a.shape.type === 'sphere' ? _a : _b, B = b.shape.type === 'sphere' ? _c : _d;
        cs.clear();
        capsuleVsCapsule(_a, A, a.shape.radius, _c, B, b.shape.radius, cs);
        const key = a.id * 4194304 + b.id;
        for (let n = 0; n < cs.n; n++) this._addContact(a, b, b, key, cs.d, n, b.friction, b.restitution);
      }
    }
  }

  _jointed(a, b) {
    const ja = a.joints;
    for (let i = 0; i < ja.length; i++) { const j = ja[i]; if (!j.collideConnected && (j.bodyA === b || j.bodyB === b)) return true; }
    return false;
  }

  _prepareContacts(h) {
    const k = BAUMGARTE / h;
    for (let i = 0; i < this._nc; i++) {
      const c = this._pool[i], a = c.a, b = c.b;
      c.rax = c.px - a.position.x; c.ray = c.py - a.position.y; c.raz = c.pz - a.position.z;
      if (b) { c.rbx = c.px - b.position.x; c.rby = c.py - b.position.y; c.rbz = c.pz - b.position.z; } else { c.rbx = c.rby = c.rbz = 0; }
      // tangent basis
      const nx = c.nx, ny = c.ny, nz = c.nz;
      let tx, ty, tz;
      if (Math.abs(nx) < 0.57) { tx = 0; ty = nz; tz = -ny; } else { tx = -nz; ty = 0; tz = nx; }      // n x (1,0,0) or n x (0,1,0)
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      c.t1x = tx; c.t1y = ty; c.t1z = tz;
      c.t2x = ny * tz - nz * ty; c.t2y = nz * tx - nx * tz; c.t2z = nx * ty - ny * tx;
      c.mn = this._effMass(c, nx, ny, nz); c.mt1 = this._effMass(c, c.t1x, c.t1y, c.t1z); c.mt2 = this._effMass(c, c.t2x, c.t2y, c.t2z);
      c.bias = Math.min(k * Math.max(c.depth - SLOP, 0), MAX_PUSH);
      // restitution target from the impact speed
      const vn = this._relVelDot(c, nx, ny, nz);
      c.bounce = c.restitution > 0 && vn < -REST_THRESHOLD ? -c.restitution * vn : 0;
    }
  }

  _effMass(c, ux, uy, uz) {
    let k = c.ima + c.imb;
    let cx = c.ray * uz - c.raz * uy, cy = c.raz * ux - c.rax * uz, cz = c.rax * uy - c.ray * ux, m = c.Ia;
    k += cx * (m[0] * cx + m[1] * cy + m[2] * cz) + cy * (m[3] * cx + m[4] * cy + m[5] * cz) + cz * (m[6] * cx + m[7] * cy + m[8] * cz);
    if (c.b) {
      cx = c.rby * uz - c.rbz * uy; cy = c.rbz * ux - c.rbx * uz; cz = c.rbx * uy - c.rby * ux; m = c.Ib;
      k += cx * (m[0] * cx + m[1] * cy + m[2] * cz) + cy * (m[3] * cx + m[4] * cy + m[5] * cz) + cz * (m[6] * cx + m[7] * cy + m[8] * cz);
    }
    return k > 1e-12 ? 1 / k : 0;
  }

  /** (velocity of the contact point on A minus on B) . u */
  _relVelDot(c, ux, uy, uz) {
    const a = c.a, b = c.b, va = a.linearVelocity, wa = a.angularVelocity;
    let vx = va.x + (wa.y * c.raz - wa.z * c.ray), vy = va.y + (wa.z * c.rax - wa.x * c.raz), vz = va.z + (wa.x * c.ray - wa.y * c.rax);
    if (b) {
      const vb = b.linearVelocity, wb = b.angularVelocity;
      vx -= vb.x + (wb.y * c.rbz - wb.z * c.rby); vy -= vb.y + (wb.z * c.rbx - wb.x * c.rbz); vz -= vb.z + (wb.x * c.rby - wb.y * c.rbx);
    }
    return vx * ux + vy * uy + vz * uz;
  }

  /** Applies impulse (x,y,z) at the contact: +P on A, -P on B. */
  _applyImpulse(c, x, y, z) {
    const a = c.a, va = a.linearVelocity, wa = a.angularVelocity;
    if (c.ima > 0) {
      va.x += c.ima * x; va.y += c.ima * y; va.z += c.ima * z;
      const tx = c.ray * z - c.raz * y, ty = c.raz * x - c.rax * z, tz = c.rax * y - c.ray * x, m = c.Ia;
      wa.x += m[0] * tx + m[1] * ty + m[2] * tz; wa.y += m[3] * tx + m[4] * ty + m[5] * tz; wa.z += m[6] * tx + m[7] * ty + m[8] * tz;
    }
    if (c.b && c.imb > 0) {
      const b = c.b, vb = b.linearVelocity, wb = b.angularVelocity;
      vb.x -= c.imb * x; vb.y -= c.imb * y; vb.z -= c.imb * z;
      const tx = c.rby * z - c.rbz * y, ty = c.rbz * x - c.rbx * z, tz = c.rbx * y - c.rby * x, m = c.Ib;
      wb.x -= m[0] * tx + m[1] * ty + m[2] * tz; wb.y -= m[3] * tx + m[4] * ty + m[5] * tz; wb.z -= m[6] * tx + m[7] * ty + m[8] * tz;
    }
  }

  _warmStartContacts() {
    const stamp = this._stamp - 1;
    for (let i = 0; i < this._nc; i++) {
      const c = this._pool[i], e = this._pairs.get(c.key);
      if (!e || e.stamp < stamp - 1) continue;
      let best = -1, bd = 0.0025;
      for (let k = 0; k < e.n; k++) {
        const dx = e.d[k * 7] - c.px, dy = e.d[k * 7 + 1] - c.py, dz = e.d[k * 7 + 2] - c.pz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bd) { bd = d2; best = k; }
      }
      if (best < 0) continue;
      const o = best * 7, jn = e.d[o + 3];
      const tx = e.d[o + 4], ty = e.d[o + 5], tz = e.d[o + 6];
      c.jn = jn; c.jt1 = tx * c.t1x + ty * c.t1y + tz * c.t1z; c.jt2 = tx * c.t2x + ty * c.t2y + tz * c.t2z;
      this._applyImpulse(c, c.nx * c.jn + c.t1x * c.jt1 + c.t2x * c.jt2, c.ny * c.jn + c.t1y * c.jt1 + c.t2y * c.jt2, c.nz * c.jn + c.t1z * c.jt1 + c.t2z * c.jt2);
    }
  }

  _solveContacts(useBias) {
    for (let i = 0; i < this._nc; i++) {
      const c = this._pool[i];
      if (c.ima === 0 && c.imb === 0) continue;
      // friction
      const maxF = c.friction * c.jn;
      if (maxF > 0) {
        let l = -c.mt1 * this._relVelDot(c, c.t1x, c.t1y, c.t1z);
        let nj = Math.max(-maxF, Math.min(maxF, c.jt1 + l)); l = nj - c.jt1; c.jt1 = nj;
        let l2 = -c.mt2 * this._relVelDot(c, c.t2x, c.t2y, c.t2z);
        let nj2 = Math.max(-maxF, Math.min(maxF, c.jt2 + l2)); l2 = nj2 - c.jt2; c.jt2 = nj2;
        this._applyImpulse(c, c.t1x * l + c.t2x * l2, c.t1y * l + c.t2y * l2, c.t1z * l + c.t2z * l2);
      }
      // normal
      const vn = this._relVelDot(c, c.nx, c.ny, c.nz);
      let l = c.mn * ((useBias ? c.bias : 0) - vn);
      const nj = Math.max(c.jn + l, 0); l = nj - c.jn; c.jn = nj;
      this._applyImpulse(c, c.nx * l, c.ny * l, c.nz * l);
    }
  }

  _restitution() {
    for (let i = 0; i < this._nc; i++) {
      const c = this._pool[i];
      if (c.bounce <= 0) continue;
      const vn = this._relVelDot(c, c.nx, c.ny, c.nz);
      if (vn >= c.bounce) continue;
      let l = c.mn * (c.bounce - vn);
      const nj = Math.max(c.jn + l, 0); l = nj - c.jn; c.jn = nj;
      this._applyImpulse(c, c.nx * l, c.ny * l, c.nz * l);
    }
  }

  _storeContacts() {
    const stamp = this._stamp;
    for (let i = 0; i < this._nc; i++) {
      const c = this._pool[i];
      let e = this._pairs.get(c.key);
      if (!e) { e = new PairCache(); this._pairs.set(c.key, e); }
      if (e.stamp !== stamp) { e.stamp = stamp; e.n = 0; }
      if (e.n >= 4) continue;
      const o = e.n++ * 7;
      e.d[o] = c.px; e.d[o + 1] = c.py; e.d[o + 2] = c.pz; e.d[o + 3] = c.jn;
      e.d[o + 4] = c.t1x * c.jt1 + c.t2x * c.jt2; e.d[o + 5] = c.t1y * c.jt1 + c.t2y * c.jt2; e.d[o + 6] = c.t1z * c.jt1 + c.t2z * c.jt2;
    }
    if (this._pairs.size > 2048 && (stamp & 63) === 0) for (const [k, e] of this._pairs) if (e.stamp < stamp - 240) this._pairs.delete(k);
  }

  // ----------------------------------------------------------------------------------------------- triggers, sleeping

  _updateTriggers() {
    if (!this.triggers.length) return;
    const cs = this._cs;
    for (const t of this.triggers) {
      const now = new Set();
      const test = (who, a, b, r, sphere) => {
        if (t.filter && !t.filter(who)) return;
        cs.clear(); t.collider.collideCapsule(a, sphere ? a : b, r, cs);
        for (let i = 0; i < cs.n; i++) if (cs.d[i * 7 + 6] > 0) { now.add(who); return; }
      };
      for (const ch of this.characters) { ch.capsule(_a, _b); test(ch, _a, _b, ch.radius, false); }
      for (const b of this.bodies) if (b.triggerActivator && b.enabled && !this.characters.some((ch) => ch.body === b)) { b.segment(_a, _b); test(b, _a, _b, b.shape.radius, b.shape.type === 'sphere'); }
      for (const who of now) if (!t.inside.has(who) && t.onEnter) t.onEnter(who);
      for (const who of t.inside) if (!now.has(who) && t.onExit) t.onExit(who);
      t.inside = now;
    }
  }

  _updateSleeping(dt) {
    const bodies = this.bodies;
    for (const b of bodies) {
      if (b.invMass <= 0 || b.sleeping || !b.enabled) continue;
      if (b.linearVelocity.lengthSq() < SLEEP_LIN * SLEEP_LIN && b.angularVelocity.lengthSq() < SLEEP_ANG * SLEEP_ANG) b._still += dt; else b._still = 0;
    }
    // a group of jointed bodies falls asleep together
    const mark = ++this._mark;
    for (const seed of bodies) {
      if (seed.invMass <= 0 || seed.sleeping || seed._mark === mark || !seed.enabled) continue;
      const group = [seed]; seed._mark = mark;
      let still = true;
      for (let i = 0; i < group.length; i++) {
        const b = group[i];
        if (b._still < SLEEP_TIME) still = false;
        for (const j of b.joints) {
          const o = j.bodyA === b ? j.bodyB : j.bodyA;
          if (o.invMass > 0 && o._mark !== mark) { o._mark = mark; group.push(o); }
          else if (o.invMass <= 0 && o !== this.ground && o.linearVelocity.lengthSq() > SLEEP_LIN * SLEEP_LIN) still = false;
        }
      }
      if (still) for (const b of group) {
        b.sleeping = true; b.linearVelocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
        for (const j of b.joints) j.reset();
      }
    }
  }

  /**
   * Total kinetic energy of the dynamic bodies (joules), handy for tests and tuning.
   * @returns {number}
   */
  kineticEnergy() {
    let e = 0;
    for (const b of this.bodies) if (b.invMass > 0) e += 0.5 * b.mass * b.linearVelocity.lengthSq();
    return e;
  }
}
