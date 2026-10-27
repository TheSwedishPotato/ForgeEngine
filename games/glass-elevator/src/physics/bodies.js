/**
 * The loose things in the building, and your hands on them. Rigid bodies (boxes, cylinders and
 * balls) fall, slide, tip over, roll and stack against the floors and walls, the moving car, the
 * sliding door panels and each other, solved with sequential impulses (Coulomb friction,
 * restitution, Baumgarte stabilisation) at 250 steps a second.
 *
 * The world's surfaces are boxes: fixed ones (floors, walls, the pit) and moving ones (the car's
 * floor, walls and roof, every door panel), which carry what stands on them and feel what it
 * pushes back with: the car's load weighing reads the weight of what stands in it, and a door
 * that closes on a crate is held by it.
 *
 * You hold a thing by a point: a spring pulls that point toward your hand, as hard as a person
 * can (450 N), so a cardboard box flies about, a 25 kg test weight comes up slowly, and a 600 kg
 * weight cart can only be rolled.
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/** Rotates v by unit quaternion q = [x, y, z, w]. */
export function rot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
const conj = (q) => [-q[0], -q[1], -q[2], q[3]];

export const MATERIALS = { cardboard: 0.55, steel: 0.4, rubber: 0.9, castors: 0.035, wood: 0.5, plastic: 0.4 };

export class Body {
  constructor({ name, kind = 'box', size = [0.4, 0.4, 0.4], r = 0.2, mass = 10, pos = [0, 0, 0], yaw = 0, mu = 0.5, e = 0.15, id }) {
    this.id = id ?? name;
    this.name = name; this.kind = kind; this.mass = mass; this.inv = 1 / mass; this.mu = mu; this.e = e;
    this.p = [...pos]; this.q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    this.v = [0, 0, 0]; this.w = [0, 0, 0];
    this.still = 0; this.asleep = false; this.held = null;
    if (kind === 'ball') { this.r = r; this.half = [r, r, r]; const I = 0.4 * mass * r * r; this.Iinv = [1 / I, 1 / I, 1 / I]; this.pts = [[0, 0, 0]]; }
    else {
      const [w, h, d] = size;
      this.half = [w / 2, h / 2, d / 2];
      if (kind === 'cyl') { this.r = w / 2; const Ia = 0.5 * mass * this.r ** 2, It = (mass * (3 * this.r ** 2 + h * h)) / 12; this.Iinv = [1 / It, 1 / Ia, 1 / It]; }
      else this.Iinv = [12 / (mass * (h * h + d * d)), 12 / (mass * (w * w + d * d)), 12 / (mass * (w * w + h * h))];
      this.pts = [];
      if (kind === 'cyl') { for (const y of [-1, 1]) for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; this.pts.push([Math.cos(a) * this.r, (y * h) / 2, Math.sin(a) * this.r]); } }
      else for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) this.pts.push([(x * w) / 2, (y * h) / 2, (z * d) / 2]);
      // the middle of each edge too: a box resting across a sill or a step stays on it
      if (kind === 'box') for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) { const p = [0, 0, 0]; p[a] = s1 * this.half[a]; p[b] = s2 * this.half[b]; this.pts.push(p); }
    }
    this.radius = len(this.half);
  }
  /** World inverse inertia applied to a vector. */
  Iw(v) { const l = rot(conj(this.q), v); return rot(this.q, [l[0] * this.Iinv[0], l[1] * this.Iinv[1], l[2] * this.Iinv[2]]); }
  velAt(r) { return add(this.v, cross(this.w, r)); }
  impulse(j, r) { if (this.inv === 0) return; this.v = add(this.v, mul(j, this.inv)); this.w = add(this.w, this.Iw(cross(r, j))); }
  wake() { this.asleep = false; this.still = 0; }
  /** World-space axis-aligned bounds. */
  aabb() {
    if (this.kind === 'ball') return [sub(this.p, this.half), add(this.p, this.half)];
    const e = [0, 0, 0];
    for (let i = 0; i < 3; i++) { const ax = [0, 0, 0]; ax[i] = 1; const l = rot(conj(this.q), ax); e[i] = Math.abs(l[0]) * this.half[0] + Math.abs(l[1]) * this.half[1] + Math.abs(l[2]) * this.half[2]; }
    return [sub(this.p, e), add(this.p, e)];
  }
  toLocal(P) { return rot(conj(this.q), sub(P, this.p)); }
  toWorld(l) { return add(this.p, rot(this.q, l)); }
}

/**
 * A surface: a box [min, max], fixed, or moving (vel() gives its velocity, bounds() where it is
 * now), with onImpulse(j) told what the bodies push it with.
 */
export class World {
  constructor() {
    this.bodies = [];
    this.solids = [];
    this.movers = [];
    this.g = -9.81;
    this.iterations = 8;
    this.hand = null;            // { body, local, target: [x,y,z], force }
    this.handForce = 450;
    this.time = 0;
    this.after = [];             // called after each step (the car reads what its surfaces carried)
  }
  add(b) { this.bodies.push(b); return b; }
  solid(min, max, opts = {}) { const s = { min, max, mu: 0.6, ...opts }; this.solids.push(s); return s; }
  mover(m) { const o = { mu: 0.6, ...m }; this.movers.push(o); return o; }

  step(dt) {
    this.time += dt;
    for (const b of this.bodies) b.held = this.hand?.body === b;
    for (const m of this.movers) { m.box = m.bounds(); m.v = m.vel ? m.vel() : [0, 0, 0]; m.J = [0, 0, 0]; m.active = m.box !== null; }
    const B = this.bodies;
    // wake what moving surfaces touch
    for (const m of this.movers) {
      if (!m.active || (Math.abs(m.v[0]) + Math.abs(m.v[1]) + Math.abs(m.v[2]) < 1e-4)) continue;
      for (const b of B) if (b.asleep && overlap(b.aabb(), m.box, 0.06)) b.wake();
    }
    // forces: gravity, your hand
    for (const b of B) {
      if (b.asleep) continue;
      b.v[1] += this.g * dt;
      const k = Math.exp(-0.05 * dt), kw = Math.exp(-(b.held ? 6 : 0.3) * dt);
      b.v = mul(b.v, k); b.w = mul(b.w, kw);
    }
    const H = this.hand;
    if (H?.body) {
      const b = H.body; b.wake();
      const P = b.toWorld(H.local), r = sub(P, b.p);
      const vP = b.velAt(r);
      const w = 9, m = b.mass;
      let F = sub(mul(sub(H.target, P), m * w * w), mul(vP, 2 * m * w * 0.8));
      // strong enough for anything here, the 600 kg carts included
      const lim = Math.max(this.handForce, m * 9.81 * 1.6 + 300);
      F[1] += -this.g * m * 0.98;                                              // you bear its weight
      const f = len(F);
      if (f > lim) F = mul(F, lim / f);
      H.force = Math.min(f, lim);
      b.impulse(mul(F, dt), r);
    }
    // contacts
    const C = [];
    for (const b of B) {
      if (b.asleep) continue;
      const bb = b.aabb();
      for (const s of this.solids) if (overlap(bb, [s.min, s.max], 0.02)) this._vsBox(C, b, s.min, s.max, null, s.mu);
      for (const m of this.movers) if (m.active && !m.cyl && overlap(bb, m.box, 0.02)) this._vsBox(C, b, m.box[0], m.box[1], m, m.mu);
    }
    for (let i = 0; i < B.length; i++) {
      const a = B[i], ab = a.aabb();
      for (let j = i + 1; j < B.length; j++) {
        const b = B[j];
        if (a.asleep && b.asleep) continue;
        if (!overlap(ab, b.aabb(), 0.02)) continue;
        this._pair(C, a, b);
      }
    }
    // sequential impulses
    for (const c of C) {
      const A = c.a, Bb = c.b;
      c.rA = sub(c.P, A.p); c.rB = Bb ? sub(c.P, Bb.p) : null;
      const kA = A.inv + dot(cross(A.Iw(cross(c.rA, c.n)), c.rA), c.n);
      const kB = Bb && !Bb.asleep ? Bb.inv + dot(cross(Bb.Iw(cross(c.rB, c.n)), c.rB), c.n) : 0;
      c.k = 1 / (kA + kB);
      c.kt = c.k;
      const vn = dot(this._rel(c), c.n);
      c.bias = Math.max(0, c.d - 0.004) * (0.25 / dt) + (vn < -1.2 ? -c.e * vn : 0);
      c.acc = 0; c.accT = 0;
    }
    for (let it = 0; it < this.iterations; it++) {
      for (const c of C) {
        const dv = this._rel(c);
        const vn = dot(dv, c.n);
        let l = (c.bias - vn) * c.k;
        const na = Math.max(0, c.acc + l); l = na - c.acc; c.acc = na;
        if (c.max !== undefined && c.acc > c.max) { l -= c.acc - c.max; c.acc = c.max; }
        this._apply(c, mul(c.n, l));
        // friction against the sliding velocity, up to mu times the normal impulse so far
        const dv2 = this._rel(c);
        const vt = sub(dv2, mul(c.n, dot(dv2, c.n)));
        const s = len(vt);
        if (s > 1e-6) {
          const want = s * c.kt, room = c.mu * c.acc - c.accT;
          const jt = Math.min(want, Math.max(0, room));
          if (jt > 0) { c.accT += jt; this._apply(c, mul(vt, -jt / s)); }
        }
      }
    }
    // integrate (no faster than 10 m/s: in one step nothing can then cross a wall before it is felt)
    for (const b of B) {
      if (b.asleep) continue;
      const sp = len(b.v);
      if (sp > 10) b.v = mul(b.v, 10 / sp);
      const p0 = b.p;
      b.p = add(b.p, mul(b.v, dt));
      this._unstick(b, p0);
      for (const m of this.movers) if (m.cyl && m.active && !b.held) this._outOf(b, m, dt);
      const [wx, wy, wz] = b.w, q = b.q;
      const dq = [wx * q[3] + wy * q[2] - wz * q[1], wy * q[3] + wz * q[0] - wx * q[2], wz * q[3] + wx * q[1] - wy * q[0], -wx * q[0] - wy * q[1] - wz * q[2]];
      for (let i = 0; i < 4; i++) q[i] += 0.5 * dq[i] * dt;
      const n = Math.hypot(q[0], q[1], q[2], q[3]); for (let i = 0; i < 4; i++) q[i] /= n;
      // rest: still for a while, and not carried by anything that moves
      const carried = b.touching?.some((m) => len(m.v) > 1e-4);
      if (!b.held && !carried && len(b.v) < 0.04 && len(b.w) < 0.08) { b.still += dt; if (b.still > 0.6) { b.asleep = true; b.v = [0, 0, 0]; b.w = [0, 0, 0]; } } else b.still = 0;
      if (b.p[1] < -60) { b.p = [...b.home]; b.v = [0, 0, 0]; b.w = [0, 0, 0]; b.q = [0, 0, 0, 1]; }
      b.touching = null;
    }
    for (const c of C) if (c.m) (c.a.touching ??= []).push(c.m);
    for (const m of this.movers) if (m.onImpulse) m.onImpulse(m.J, dt);
    for (const f of this.after) f(dt);
  }

  /**
   * A body whose middle has got inside a wall (pushed there by your hand, or a door closing on it)
   * goes back out the side it came in from, and stops moving into it.
   */
  _unstick(b, p0) {
    const boxes = this.solids.map((s) => [s.min, s.max]);
    for (const m of this.movers) if (m.active && !m.maxPush) boxes.push(m.box);
    for (const [lo, hi] of boxes) {
      const P = b.p;
      if (P[0] <= lo[0] || P[0] >= hi[0] || P[1] <= lo[1] || P[1] >= hi[1] || P[2] <= lo[2] || P[2] >= hi[2]) continue;
      let best = null;
      for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
        const face = s > 0 ? hi[i] : lo[i];
        const came = s > 0 ? p0[i] >= hi[i] : p0[i] <= lo[i];
        const d = Math.abs(face - P[i]) - (came ? 1e3 : 0);
        if (!best || d < best.d) best = { d, i, s, face };
      }
      const { i, s, face } = best;
      b.p[i] = face + s * (Math.min(b.half[0], b.half[1], b.half[2]) + 0.002);
      if (b.v[i] * s < 0) b.v[i] = 0;
    }
  }

  /** Out of a person (an upright cylinder): a thing that has got inside you is pushed out, sideways. */
  _outOf(b, m, dt) {
    const { p, r, h } = m.cyl, [lo, hi] = b.aabb();
    if (hi[1] < p[1] + 0.2 || lo[1] > p[1] + h) return;
    const ex = (hi[0] - lo[0]) / 2, ez = (hi[2] - lo[2]) / 2;
    let dx = b.p[0] - p[0], dz = b.p[2] - p[2];
    const reach = r + Math.min(ex, ez) + (b.mass > 40 ? 0.06 : 0);     // you stand against a heavy thing, and lean on it
    const d = Math.hypot(dx, dz);
    if (d >= reach) return;
    if (d < 1e-4) { dx = Math.cos(b.p[1] * 7); dz = Math.sin(b.p[1] * 7); } else { dx /= d; dz /= d; }
    b.wake();
    const vin = b.v[0] * dx + b.v[2] * dz - (m.v[0] * dx + m.v[2] * dz);
    if (b.mass > 40) {
      // too heavy to shove aside: you lean on it, with what a person can push (450 N)
      if (vin < 0) { const dv = Math.min(-vin, (450 * dt) / b.mass); b.v[0] += dv * dx; b.v[2] += dv * dz; }
      return;
    }
    b.p[0] = p[0] + dx * (reach + 0.002); b.p[2] = p[2] + dz * (reach + 0.002);
    if (vin < 0) { b.v[0] -= vin * dx; b.v[2] -= vin * dz; }
  }

  _rel(c) {
    const vA = c.a.velAt(c.rA);
    if (c.b) return sub(vA, c.b.velAt(c.rB));
    if (c.m) return sub(vA, c.m.v);
    return vA;
  }
  _apply(c, j) {
    c.a.impulse(j, c.rA);
    if (c.b) { if (c.b.asleep) c.b.wake(); c.b.impulse(mul(j, -1), c.rB); }
    if (c.m) c.m.J = sub(c.m.J, j);
  }

  /** Contacts of body b against the box [lo, hi] (a surface, fixed or moving). */
  _vsBox(C, b, lo, hi, m, mu) {
    const muC = Math.min(mu, b.mu);
    if (b.kind === 'ball') {
      const c = b.p, q = [clamp(c[0], lo[0], hi[0]), clamp(c[1], lo[1], hi[1]), clamp(c[2], lo[2], hi[2])];
      let n = sub(c, q), d = len(n);
      if (d > b.r) return;
      if (d < 1e-6) { const f = insideNormal(c, lo, hi); n = f.n; d = -f.d; } else n = mul(n, 1 / d);
      C.push({ a: b, m, P: sub(c, mul(n, b.r)), n, d: b.r - d, mu: muC, e: b.e });
      return;
    }
    for (const l of b.pts) {
      const P = b.toWorld(l);
      if (P[0] <= lo[0] || P[0] >= hi[0] || P[1] <= lo[1] || P[1] >= hi[1] || P[2] <= lo[2] || P[2] >= hi[2]) continue;
      const f = insideNormal(P, lo, hi, b.p);
      C.push({ a: b, m, P, n: f.n, d: f.d, mu: muC, e: b.e, max: m?.maxPush });
    }
  }

  _pair(C, a, b) {
    const mu = Math.min(a.mu, b.mu), e = Math.min(a.e, b.e);
    if (a.kind === 'ball' && b.kind === 'ball') {
      const d = sub(a.p, b.p), l = len(d);
      if (l >= a.r + b.r || l < 1e-6) return;
      const n = mul(d, 1 / l);
      C.push({ a, b, P: sub(a.p, mul(n, a.r)), n, d: a.r + b.r - l, mu, e });
      return;
    }
    if (a.kind === 'ball' || b.kind === 'ball') {
      const s = a.kind === 'ball' ? a : b, x = s === a ? b : a;
      const l = x.toLocal(s.p), q = [clamp(l[0], -x.half[0], x.half[0]), clamp(l[1], -x.half[1], x.half[1]), clamp(l[2], -x.half[2], x.half[2])];
      const dl = sub(l, q), dd = len(dl);
      if (dd > s.r) return;
      let nl = dd > 1e-6 ? mul(dl, 1 / dd) : insideNormal(l, mul(x.half, -1), x.half).n;
      const n = rot(x.q, nl);
      C.push({ a: s, b: x, P: sub(s.p, mul(n, s.r)), n, d: s.r - dd, mu, e });
      return;
    }
    // box against box: each one's corners inside the other
    for (const [p, o] of [[a, b], [b, a]]) {
      for (const l of p.pts) {
        const P = p.toWorld(l), lo = o.toLocal(P), h = o.half;
        if (Math.abs(lo[0]) >= h[0] || Math.abs(lo[1]) >= h[1] || Math.abs(lo[2]) >= h[2]) continue;
        const f = insideNormal(lo, mul(h, -1), h, o.toLocal(p.p));
        C.push({ a: p, b: o, P, n: rot(o.q, f.n), d: f.d, mu, e });
      }
    }
  }

  /** The first body along a ray (origin o, unit direction d) within range, with the hit point. */
  pick(o, d, range = 3) {
    let best = null;
    for (const b of this.bodies) {
      const t = rayBody(b, o, d);
      if (t !== null && t < range && (!best || t < best.t)) best = { body: b, t, P: add(o, mul(d, t)) };
    }
    return best;
  }
}

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function overlap(a, b, m = 0) {
  return a[0][0] - m < b[1][0] && a[1][0] + m > b[0][0] && a[0][1] - m < b[1][1] && a[1][1] + m > b[0][1] && a[0][2] - m < b[1][2] && a[1][2] + m > b[0][2];
}
/**
 * The way out of a box for a point inside it: the nearest face, unless the body's own centre `from`
 * says which side it came in from (a thin wall is crossed from the side the body is on).
 */
function insideNormal(P, lo, hi, from) {
  let best = { d: Infinity, n: [0, 1, 0] };
  for (let i = 0; i < 3; i++) {
    for (const s of [-1, 1]) {
      const d = s > 0 ? hi[i] - P[i] : P[i] - lo[i];
      let w = d;
      if (from) { const side = s > 0 ? from[i] - hi[i] : lo[i] - from[i]; if (side > 0) w = d * 0.25; }
      if (w < best.w || best.w === undefined) { const n = [0, 0, 0]; n[i] = s; best = { d, w, n }; }
    }
  }
  return best;
}
function rayBody(b, o, d) {
  if (b.kind === 'ball') {
    const oc = sub(o, b.p), bb = dot(oc, d), c = dot(oc, oc) - b.r * b.r, h = bb * bb - c;
    if (h < 0) return null;
    const t = -bb - Math.sqrt(h);
    return t >= 0 ? t : null;
  }
  const lo = b.toLocal(o), ld = rot(conj(b.q), d);
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-9) { if (Math.abs(lo[i]) > b.half[i]) return null; continue; }
    let a = (-b.half[i] - lo[i]) / ld[i], c = (b.half[i] - lo[i]) / ld[i];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0;
}

export { sub, add, mul, dot, cross, len, overlap, rayBody };
