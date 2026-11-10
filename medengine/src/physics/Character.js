/**
 * A kinematic capsule character controller: walks on floors and slopes, steps up stairs, slides along walls,
 * jumps, falls and lands, and pushes loose bodies. It is not simulated by the solver; it moves by small steps and
 * pushes itself out of whatever it overlaps (depenetration), which is robust against any level geometry.
 *
 *   const hero = world.addCharacter(new Character(world, { position, radius: 0.3, height: 1.75 }));
 *   // every fixed step:
 *   hero.update(dt, wishVelocity);        // wishVelocity: Vector3, horizontal metres per second
 *   if (jumpPressed) hero.jump(4.4);
 *   world.step(dt);
 *   object.position.copy(hero.position);
 *
 * `position` is the point between the feet. The capsule's bottom touches the ground there.
 */
import { Vector3 } from '../math/core.js';
import { Contacts } from './Collide.js';
import { RigidBody } from './Body.js';

/** @import { World } from './World.js' */

/**
 * What `new Character(world, o)` takes.
 * @typedef {object} CharacterOptions
 * @property {Vector3} [position]   feet
 * @property {number} [radius]      0.3 m
 * @property {number} [height]      1.75 m
 * @property {number} [stepHeight]  tallest step that is climbed without jumping, 0.35 m
 * @property {number} [slopeLimit]  steepest walkable slope in degrees, 50
 * @property {number} [mass]        kg, used when pushing bodies, 75
 * @property {number} [airControl]  0..1, how quickly the wish velocity takes over in the air, 0.35
 * @property {number} [coyoteTime]  seconds after leaving a ledge during which a jump still works, 0.1
 * @property {boolean} [pushBodies] push loose bodies out of the way (true)
 * @property {number} [group]       collision filter group (4)
 * @property {number} [mask]        collision filter mask (all)
 * @property {number} [gravityScale] 1
 */

const SKIN = 0.002;
const HORIZONTAL = 0, VERTICAL = 1, SUPPORT = 2;
const _a = new Vector3(), _b = new Vector3(), _down = new Vector3(0, -1, 0), _surf = { ny: 1, y: 0 };

export class Character {
  /**
   * @param {World} world
   * @param {CharacterOptions} [o]
   */
  constructor(world, { position = new Vector3(), radius = 0.3, height = 1.75, stepHeight = 0.35, slopeLimit = 50, mass = 75, airControl = 0.35, coyoteTime = 0.1, pushBodies = true, group = 4, mask = 0xffffffff, gravityScale = 1 } = {}) {
    this.world = world;
    this.position = position.clone();
    this.velocity = new Vector3();
    this.radius = radius; this.height = height; this.stepHeight = stepHeight;
    this.slopeLimit = slopeLimit; this.cosSlope = Math.cos(slopeLimit * Math.PI / 180);
    this.mass = mass; this.airControl = airControl; this.coyoteTime = coyoteTime; this.pushBodies = pushBodies;
    this.group = group; this.mask = mask; this.gravityScale = gravityScale;
    this.maxFallSpeed = 55;
    // state
    this.grounded = false;
    this.groundNormal = new Vector3(0, 1, 0);
    this.groundOwner = null;
    this.slopeAngle = 0;
    this.justLanded = false; this.justLeftGround = false;
    /** Downward speed at the moment of the last landing (m/s), for fall damage and landing animations. */
    this.landingSpeed = 0;
    this.time = 0;
    this._vy = 0; this._coyote = 0; this._noSnap = 0; this._jump = 0;
    this._cs = new Contacts(); this._owners = [];
    this._touched = new Map();
    this._ceiling = false; this._intentX = 0; this._intentZ = 0; this._stepGround = null; this._baseY = position.y;
    /** The kinematic body other bodies collide with. */
    this.body = new RigidBody({ shape: { type: 'capsule', radius, length: Math.max(0, height - 2 * radius) }, mass: 0, driven: true, group, mask, friction: 0.2 });
    this.body.userData = this;
    this._syncBody(0);
  }

  /** End points of the capsule's axis (world). */
  capsule(a, b) {
    a.set(this.position.x, this.position.y + this.radius, this.position.z);
    b.set(this.position.x, this.position.y + Math.max(this.radius, this.height - this.radius), this.position.z);
  }

  setSlopeLimit(deg) { this.slopeLimit = deg; this.cosSlope = Math.cos(deg * Math.PI / 180); }

  /** Moves the character without collision and forgets its motion. */
  teleport(p) {
    this.position.copy(p); this.velocity.set(0, 0, 0); this._vy = 0; this.grounded = false; this._baseY = p.y; this._syncBody(0);
  }

  /** Changes the capsule height (crouching). Growing is refused, and returns false, if there is no room. */
  setHeight(h) {
    if (h === this.height) return true;
    const old = this.height;
    this.height = h;
    if (h > old) {
      this.capsule(_a, _b);
      const cs = this._cs; cs.clear();
      this.world.collideStatics(_a, _b, this.radius, this.group, this.mask, cs, this._owners);
      for (let i = 0; i < cs.n; i++) if (cs.d[i * 7 + 6] > 0.01) { this.height = old; return false; }
    }
    this.body.shape.length = Math.max(0, h - 2 * this.radius);
    this.body.setMass(0);
    return true;
  }

  /** Starts a jump with the given take-off speed (m/s) if standing on the ground (or just after leaving it). */
  jump(speed = 4.4) {
    if (this.grounded || this._coyote > 0) { this._jump = speed; return true; }
    return false;
  }

  /** Drops the character onto whatever is below (up to `maxDistance`), e.g. after spawning. */
  snapToGround(maxDistance = 5) {
    this._depenetrate(VERTICAL);
    const g = this._probeGround(maxDistance);
    if (g) { this.position.y -= Math.max(0, g.dist - SKIN); this._setGrounded(g); this._vy = 0; this._baseY = g.py; }
    this._syncBody(0);
    return !!g;
  }

  // ------------------------------------------------------------------------------------------------ update

  /**
   * Advances the character by dt seconds.
   * @param {number} dt
   * @param {Vector3} [wish]  desired horizontal velocity in m/s (y is ignored)
   */
  update(dt, wish = null) {
    if (!(dt > 0)) return;
    const p = this.position, w = this.world;
    const px = p.x, py = p.y, pz = p.z;
    const wasGrounded = this.grounded;
    this.justLanded = false; this.justLeftGround = false;
    this._touched.clear(); this._ceiling = false;
    this._coyote = wasGrounded ? this.coyoteTime : Math.max(0, this._coyote - dt);
    this._noSnap = Math.max(0, this._noSnap - dt);

    // intent
    const wx = wish ? wish.x : 0, wz = wish ? wish.z : 0;
    let hx, hz;
    if (wasGrounded) { hx = wx; hz = wz; }
    else {
      const k = Math.min(1, this.airControl * dt * 10);
      hx = this.velocity.x + (wx - this.velocity.x) * k; hz = this.velocity.z + (wz - this.velocity.z) * k;
    }
    let vy = this._vy;
    if (this._jump > 0) { vy = this._jump; this._jump = 0; this._noSnap = 0.12; this._coyote = 0; }
    else if (wasGrounded) vy = 0;
    else vy = Math.max(-this.maxFallSpeed, vy + w.gravity.y * this.gravityScale * dt);
    const airborne = !wasGrounded || vy > 0;

    // 1. horizontal move, along the ground plane when standing on a walkable surface
    let dx = hx * dt, dz = hz * dt, dy = 0;
    if (wasGrounded && !airborne && this.groundNormal.y > 0.05) {
      const n = this.groundNormal;
      dy = -(n.x * dx + n.z * dz) / n.y;
    }
    this._intentX = hx; this._intentZ = hz;
    this._stepGround = null;
    if (dx !== 0 || dz !== 0) this._moveHorizontal(dx, dy, dz, wasGrounded && !airborne);
    else this._depenetrate(VERTICAL);                       // standing still: still get pushed out of things that move into us

    // 2. vertical move
    if (airborne) {
      this._slide(0, vy * dt, 0, VERTICAL);
      if (vy > 0 && this._ceiling) vy = 0;
    }

    // 3. ground contact
    const snap = wasGrounded && !airborne && this._noSnap === 0 ? this.stepHeight + 0.02 : (vy <= 0 && this._noSnap === 0 ? 0.03 : 0);
    let g = this._stepGround;
    if (g) g = this._probeGround(0.03) || g;                // on a rim: prefer a real walkable contact if there is one
    else if (snap > 0 && vy <= 0.0001) g = this._probeGround(snap);
    if (g) {
      if (g.dist > SKIN) p.y -= g.dist - SKIN;
      this._setGrounded(g);
      this._baseY = g.py;                                        // height of the surface we stand on
      if (!wasGrounded) { this.justLanded = true; this.landingSpeed = Math.max(0, -vy); }
      vy = 0;
    } else {
      if (wasGrounded) this.justLeftGround = true;
      this.grounded = false; this.groundOwner = null; this.slopeAngle = 0;
    }

    // result
    this.velocity.set((p.x - px) / dt, (p.y - py) / dt, (p.z - pz) / dt);
    if (this.grounded) this._vy = 0;
    else {
      // keep the integrated fall speed unless something blocked the move (a ceiling, a steep slope we slide along)
      const expected = vy * dt, achieved = p.y - py;
      this._vy = Math.abs(achieved - expected) > 0.002 ? achieved / dt : vy;
    }
    this.time += dt;
    this._applyPushes();
    this._syncBody(dt);
  }

  _setGrounded(g) {
    this.grounded = true;
    this.groundNormal.set(g.nx, g.ny, g.nz);
    this.groundOwner = g.owner;
    this.slopeAngle = Math.acos(Math.min(1, g.ny)) * 180 / Math.PI;
  }

  _syncBody(dt) {
    const b = this.body, h = Math.max(this.height, 2 * this.radius);
    b.position.set(this.position.x, this.position.y + h / 2, this.position.z);
    b.linearVelocity.copy(this.velocity);
    b.updateWorld();
  }

  // ------------------------------------------------------------------------------------------------ movement

  /** Moves by (dx, dy, dz) in small steps, pushing out of anything in the way. */
  _slide(dx, dy, dz, mode, maxStep = this.radius * 0.5) {
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-9) return;
    const n = Math.max(1, Math.ceil(dist / maxStep)), p = this.position;
    const sx = dx / n, sy = dy / n, sz = dz / n;
    for (let i = 0; i < n; i++) { p.x += sx; p.y += sy; p.z += sz; this._depenetrate(mode); }
  }

  _moveHorizontal(dx, dy, dz, canStep) {
    const p = this.position, sx = p.x, sy = p.y, sz = p.z;
    this._slide(dx, dy, dz, HORIZONTAL);
    if (!canStep || this.stepHeight <= 0) return;
    const want = Math.hypot(dx, dz), got = (p.x - sx) * dx / want + (p.z - sz) * dz / want;
    if (got >= want * 0.85 - 1e-4) return;
    // blocked: try to climb. Raise, move forward, come back down onto whatever supports us.
    const fx = p.x, fy = p.y, fz = p.z;
    p.set(sx, sy, sz);
    const y0 = p.y;
    this._slide(0, this.stepHeight, 0, VERTICAL);
    const up = p.y - y0;
    if (up < 0.02) { p.set(fx, fy, fz); return; }
    const hx = p.x, hz = p.z;
    this._slide(dx, 0, dz, HORIZONTAL);
    const gotUp = (p.x - hx) * dx / want + (p.z - hz) * dz / want;
    this._slide(0, -(up + 0.01), 0, SUPPORT, 0.02);          // small steps, so the rim of a step holds the capsule up
    const fin = (p.x - sx) * dx / want + (p.z - sz) * dz / want;
    const sup = gotUp > got + 0.3 * want && fin > got + 0.3 * want ? this._probeGround(0.03, true) : null;
    if (sup) {
      // resting on the lip of a step still counts as standing, if the surface under the lip is flat enough to walk
      // on and no higher than a step above the last place we stood. (Measured from there, so a chain of small lip
      // steps cannot add up to a tall wall.)
      const surf = this._trueSurface(sup);
      if (surf.ny >= this.cosSlope && surf.y - this._baseY <= this.stepHeight + 0.02) {
        if (sup.dist > SKIN) p.y -= sup.dist - SKIN;
        this._stepGround = { dist: SKIN, nx: 0, ny: 1, nz: 0, px: sup.px, py: surf.y, pz: sup.pz, owner: sup.owner };
        return;
      }
    }
    p.set(fx, fy, fz);
  }

  /**
   * The slope and height of the surface a contact belongs to. A capsule resting on the rim of a step touches an
   * edge, whose contact normal points diagonally; a ray dropped just inside the rim finds the real surface.
   */
  _trueSurface(c) {
    const r = _surf; r.ny = c.ny; r.y = c.py;
    if (c.ny >= this.cosSlope || c.owner instanceof RigidBody) return r;
    let hx = c.px - this.position.x, hz = c.pz - this.position.z;
    const l = Math.hypot(hx, hz);
    if (l < 1e-6) return r;
    hx /= l; hz /= l;
    _a.set(c.px + hx * 0.004, c.py + 0.06, c.pz + hz * 0.004);
    const hit = this.world.raycast(_a, _down, 0.14, { bodies: false, mask: this.mask });
    if (hit) { r.ny = hit.normal.y; r.y = hit.point.y; }
    return r;
  }

  /**
   * Pushes the capsule out of everything it overlaps. HORIZONTAL: surfaces too steep to walk on push sideways
   * only (so walking into a steep slope does not lift you); VERTICAL: walkable surfaces push straight up (so
   * landing on a slope does not slide you down it).
   */
  _depenetrate(mode) {
    const w = this.world, cs = this._cs, owners = this._owners, p = this.position;
    for (let iter = 0; iter < 6; iter++) {
      this.capsule(_a, _b);
      cs.clear();
      w.collideStatics(_a, _b, this.radius, this.group, this.mask, cs, owners);
      w.collideBodies(_a, _b, this.radius, this.group, this.mask, cs, owners, this.body);
      if (!cs.n) return;
      let dx = 0, dy = 0, dz = 0, moved = false;
      const d = cs.d;
      for (let i = 0; i < cs.n; i++) {
        const o = i * 7, nx = d[o + 3], ny = d[o + 4], nz = d[o + 5];
        let pen = d[o + 6] + SKIN - (dx * nx + dy * ny + dz * nz);
        if (pen <= 0) continue;
        const walkable = ny >= this.cosSlope;
        let ex = nx, ey = ny, ez = nz, c = 1;
        if (mode === HORIZONTAL && !walkable && ny > -0.7) {
          const l = Math.hypot(nx, nz);
          if (l > 1e-4) { ex = nx / l; ey = 0; ez = nz / l; c = l; }
        } else if (mode === VERTICAL && walkable) { ex = 0; ey = 1; ez = 0; c = ny; }
        else if (mode === SUPPORT && ny > 0.1) { ex = 0; ey = 1; ez = 0; c = ny; }
        const s = pen / Math.max(c, 0.25);
        dx += ex * s; dy += ey * s; dz += ez * s; moved = true;
        if (ny < -0.7) this._ceiling = true;
        const owner = owners[i];
        if (owner instanceof RigidBody && owner.invMass > 0 && this.pushBodies) {
          let t = this._touched.get(owner);
          if (!t) { t = { nx, ny, nz, px: d[o], py: d[o + 1], pz: d[o + 2] }; this._touched.set(owner, t); }
        }
      }
      if (!moved) return;
      p.x += dx; p.y += dy; p.z += dz;
    }
  }

  /**
   * Looks for ground up to maxDist below the feet. Returns { dist, nx, ny, nz, px, py, pz, owner } or null; `dist`
   * is how far the capsule must drop to rest on it. Only walkable surfaces count unless `anySupport` is set.
   */
  _probeGround(maxDist, anySupport = false) {
    const p = this.position, w = this.world, cs = this._cs, owners = this._owners;
    const minNy = anySupport ? 0.1 : this.cosSlope;
    const step = maxDist <= 0.06 ? maxDist : Math.min(Math.max(maxDist / 8, 0.05), this.radius * 0.8);
    const y0 = p.y;
    let result = null;
    // lower the capsule a little at a time and stop at the first supporting surface, so a rim is found before the floor behind it
    for (let lowered = step; ; lowered += step) {
      const L = Math.min(lowered, maxDist);
      p.y = y0 - L;
      this.capsule(_a, _b);
      cs.clear();
      w.collideStatics(_a, _b, this.radius, this.group, this.mask, cs, owners);
      w.collideBodies(_a, _b, this.radius, this.group, this.mask, cs, owners, this.body);
      let best = -1, bestDist = Infinity;
      for (let i = 0; i < cs.n; i++) {
        const o = i * 7, ny = cs.d[o + 4];
        if (ny < minNy) continue;
        const dist = L - cs.d[o + 6] / ny;
        if (dist < bestDist) { bestDist = dist; best = i; }
      }
      if (best >= 0) {
        const o = best * 7;
        result = { dist: Math.max(0, bestDist), nx: cs.d[o + 3], ny: cs.d[o + 4], nz: cs.d[o + 5], px: cs.d[o], py: cs.d[o + 1], pz: cs.d[o + 2], owner: owners[best] };
        break;
      }
      if (L >= maxDist) break;
    }
    p.y = y0;
    return result;
  }

  _applyPushes() {
    if (!this.pushBodies || !this._touched.size) return;
    for (const [body, t] of this._touched) {
      // speed of the character into the body along the contact normal (the normal points from the body to us)
      const vn = -(this._intentX * t.nx + this._intentZ * t.nz);
      if (vn <= 0.05 || t.ny > 0.7) continue;                       // standing on it does not push it sideways
      const bv = -(body.linearVelocity.x * t.nx + body.linearVelocity.y * t.ny + body.linearVelocity.z * t.nz);
      const dv = vn - bv;
      if (dv <= 0) continue;
      const m = Math.min(body.mass, this.mass) * 0.6;
      body.applyImpulse(_a.set(-t.nx * dv * m, -t.ny * dv * m, -t.nz * dv * m), _b.set(t.px, t.py, t.pz));
    }
  }
}
