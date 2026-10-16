/**
 * Derailment: nothing holds a vehicle to the track but its wheels' flanges and its own weight.
 * Each step every vehicle on the rails is checked against the two ways a wheelset leaves them:
 *
 *  - Overturning. The lateral load the track has to supply (the curve's pull not balanced by the
 *    cant, the crosswind, the couplings' sideways pull in a curve) shifts the weight onto the outer
 *    wheels: Q_inner = Q0 (1 - (h/b) a_y/g), with h the centre of gravity's height and b half
 *    the 1.5 m between the wheels' contact points. When the inner wheels carry nothing the vehicle
 *    is going over (about 4 m/s^2 unbalanced for a car, h = 1.8 m).
 *
 *  - Flange climb (Nadal, 1908): the guiding wheel climbs its rail when Y/Q, its lateral force
 *    against its vertical load, passes (tan d - mu) / (1 + mu tan d), 1.34 for a 70 degree flange
 *    and mu = 0.3, for long enough to roll up the flange (about 2 m, or 50 ms).
 *
 *  - Running out of track: off the end of the line, at speed, the buffer stop does not hold her.
 *
 * A vehicle that has left the rails is a free body: it slides on its wheels over the sleepers and
 * the ballast (mu about 0.35) or on its side (0.55), its couplings pull it about as springs at its
 * ends (and part at about 1.2 MN), it trips over when it slides sideways (the ground's friction at
 * its feet against its inertia high up: when mu h > b it goes over), it is held by a tunnel's walls
 * and falls where there is no ground under it, off a bridge or an embankment.
 */

const G = 9.80665, B = 0.75, NADAL = 1.34;
const MU_WHEELS = 0.35, MU_SIDE = 0.55;
const K_PULL = 1.6e6, K_PUSH = 2.4e6, C_COUPLE = 1.5e5, BREAK = 1.2e6;

/** Centre of gravity height above the rail (m): the engine's boiler is high, the tender's water low. */
const CG = { engine: 1.95, tender: 1.55, helper: 1.6 };
const cgOf = (v) => CG[v.kind] ?? 1.8;

export class Derailment {
  constructor(train) {
    this.train = train;
    this.cause = null;
    this.climb = [];                                       // seconds each vehicle's guiding wheel has been over Nadal
  }

  get any() { return this.train.veh.some((v) => v.wreck); }

  /** The ground under a map point (m): the formation beside the track, the terrain away from it. */
  ground(x, y, hint) {
    const R = this.train.route, L = R.run;
    const q = L.locate(x, y, hint, hint == null ? 1e9 : 120), p = L.pos(q.s), h = L.headingAt(q.s);
    const off = (x - p.x) * Math.cos(h) - (y - p.y) * Math.sin(h);
    const st = R.structureAt?.(q.s);
    const terr = this.train.terrain?.heightAt?.(x, y);
    let z;
    if (Math.abs(off) < 2.6) z = p.z - 0.18;                                   // on the sleepers, between or beside the rails
    else if (st?.type === 'bridge') z = terr ?? p.z - 30;                      // nothing under it but the gorge
    else z = terr != null ? terr : p.z - 0.7 - Math.min(3, (Math.abs(off) - 2.6) * 0.66);   // the ground itself (without the terrain: down the ballast shoulder and a modest bank)
    return { z, s: q.s, off, tunnel: st?.type === 'tunnel', heading: h };
  }

  /**
   * The lateral loads on a vehicle on the rails (m/s^2, + to its right): the curve, the cant,
   * the wind and the couplings at its ends.
   */
  lateral(i, cond) {
    const T = this.train, v = T.veh[i], R = T.route.run;
    const k = R.curvatureAt(v.s), c = R.cantAt(v.s);
    let ay = -v.v * v.v * k + G * (c / 1.5);           // (the cant carries the curve's sign: its weight leans in)
    // crosswind on the vehicle's side (C_y about 1.2 on a box body)
    if (cond?.windFrom != null) {
      const head = R.headingAt(v.s), w = cond.wind * Math.sin(cond.windFrom - head);   // from the left is +
      ay += (0.5 * (cond.rho ?? 1.2) * 1.2 * v.length * 3.6 * w * Math.abs(w)) / v.mNow;
    }
    // the couplings: in a curve their line is angled to the body by about k times its half length,
    // so buffing (compression) pushes the ends outward and drawing pulls them in (the string line)
    const n = T.veh.length;
    for (const j of [i - 1, i]) {
      if (j < 0 || j >= n - 1) continue;
      const F = T.couplerForce[j];
      ay += (F * k * (v.length / 2)) / v.mNow;               // tension pulls toward the curve's inside (+k right)
    }
    if (T.lateralPull?.[i]) ay += T.lateralPull[i] / v.mNow;   // a derailed neighbour dragging it sideways
    return ay;
  }

  /** Checks the vehicles still on the rails; derails those that go. */
  check(dt) {
    const T = this.train, R = T.route.run;
    for (let i = 0; i < T.veh.length; i++) {
      const v = T.veh[i];
      if (v.wreck || !v.mNow) continue;
      // off the end of the line
      const front = v.s + v.length / 2, back = v.s - v.length / 2;
      if ((front > R.length && v.v > 0) || (back < 0 && v.v < 0)) {
        if (Math.abs(v.v) > 2.5) { this.derail(i, 'ran off the end of the line', { lat: 0.3 }); continue; }
        v.v = 0;
        continue;
      }
      const ay = this.lateral(i, v.cond) * 1.1;          // (the ride's sway adds about a tenth)
      const ratio = (cgOf(v) / B) * (ay / G);
      // overturning: the inner wheels lift
      if (Math.abs(ratio) >= 1) { this.derail(i, 'overturned in the curve', { lat: Math.sign(ay) * 0.8, roll: Math.sign(ay) * 0.7 }); continue; }
      // flange climb on the guiding (loaded) side
      const k = Math.abs(R.curvatureAt(v.s));
      const Q0 = (v.mNow * G) / (2 * v.axles), Qout = Q0 * (1 + Math.abs(ratio));
      const Y = 0.3 * Q0 * Math.min(1, 180 * k) + (1.5 * v.mNow * Math.abs(ay)) / v.axles;
      this.climb[i] = Y / Qout > NADAL ? (this.climb[i] ?? 0) + dt : 0;
      if (this.climb[i] > Math.max(0.05, 2 / Math.max(1, Math.abs(v.v)))) this.derail(i, 'climbed the rail', { lat: Math.sign(ay) * 0.5 });
    }
  }

  /** Leaves the rails: from here on the vehicle is a free body. */
  derail(i, why, { lat = 0, roll = 0 } = {}) {
    const T = this.train, v = T.veh[i], R = T.route.run;
    if (v.wreck) return;
    const s = Math.max(0, Math.min(R.length, v.s)), p = R.pos(s), h = R.headingAt(s);
    const fx = Math.sin(h), fy = Math.cos(h), rx = Math.cos(h), ry = -Math.sin(h);
    const cant = -Math.atan2(R.cantAt(s), 1.5);
    v.wreck = {
      x: p.x, y: p.y, z: p.z, vx: fx * v.v + rx * lat * Math.max(1, Math.abs(v.v) * 0.08), vy: fy * v.v + ry * lat * Math.max(1, Math.abs(v.v) * 0.08), vz: 0,
      psi: h, w: 0, roll: -cant, rollRate: roll, hint: s, onSide: false, why,
    };
    this.cause ??= { vehicle: v.name, why, s, speed: v.v };
    T.events.push({ type: 'derailed', i, name: v.name, why, s, speed: v.v });
    // the brake hoses tear: the pipe empties and every brake goes on
    T.brake.handle = 'emergency';
  }

  /** A vehicle's coupling end (map x, y), front (+1) or back (-1). */
  end(v, sign) {
    if (v.wreck) { const W = v.wreck; return [W.x + Math.sin(W.psi) * sign * v.length / 2, W.y + Math.cos(W.psi) * sign * v.length / 2]; }
    const p = this.train.route.run.pos(v.s + sign * v.length / 2);
    return [p.x, p.y];
  }

  /**
   * The couplings that have a derailed vehicle at either end: springs between the ends in the
   * plane. Returns, per coupling, the force along the track on the vehicles still on the rails.
   */
  couplings() {
    const T = this.train, n = T.veh.length, R = T.route.run;
    T.lateralPull = new Float64Array(n);
    for (const v of T.veh) if (v.wreck) { v.wreck.fx = 0; v.wreck.fy = 0; v.wreck.tq = 0; }
    for (let i = 0; i < n - 1; i++) {
      const a = T.veh[i], b = T.veh[i + 1];
      if (!a.wreck && !b.wreck) continue;
      if (!T.coupled[i]) { T.couplerForce[i] = 0; continue; }
      const [ax, ay] = this.end(a, -1), [bx, by] = this.end(b, +1);
      const dx = bx - ax, dy = by - ay;
      // a's axis, backward (toward b): closing up along it is the buffers' work, the rest the draw gear's
      const ha = a.wreck ? a.wreck.psi : R.headingAt(a.s), ux = -Math.sin(ha), uy = -Math.cos(ha);
      const gap = dx * ux + dy * uy;
      const vel = (v) => (v.wreck ? [v.wreck.vx, v.wreck.vy] : [Math.sin(R.headingAt(v.s)) * v.v, Math.cos(R.headingAt(v.s)) * v.v]);
      const [avx, avy] = vel(a), [bvx, bvy] = vel(b);
      let Fx, Fy;                                              // the force on a (toward b is +)
      if (gap >= 0) { Fx = K_PULL * dx + C_COUPLE * (bvx - avx); Fy = K_PULL * dy + C_COUPLE * (bvy - avy); }
      else {
        const lx = dx - gap * ux, ly = dy - gap * uy;
        Fx = K_PUSH * gap * ux + K_PULL * lx; Fy = K_PUSH * gap * uy + K_PULL * ly;
      }
      const tension = gap >= 0 ? Math.hypot(Fx, Fy) : 0;
      if (tension > BREAK) { T.coupled[i] = false; T.couplerForce[i] = 0; T.events.push({ type: 'coupling broke', i, between: [a.name, b.name] }); T.brake.handle = 'emergency'; continue; }
      // on a: +F along u (toward b); on b: -F along u
      const apply = (v, fx, fy, sign) => {
        if (v.wreck) {
          const W = v.wreck, r = sign * v.length / 2;
          W.fx += fx; W.fy += fy;
          W.tq += r * (Math.sin(W.psi) * fy - Math.cos(W.psi) * fx);       // r x F (about the vertical)
        } else {
          const h = R.headingAt(v.s);
          const along = fx * Math.sin(h) + fy * Math.cos(h), side = fx * Math.cos(h) - fy * Math.sin(h);
          T.lateralPull[T.veh.indexOf(v)] += side;
          return along;
        }
        return 0;
      };
      const alongA = apply(a, Fx, Fy, -1), alongB = apply(b, -Fx, -Fy, +1);
      // T.couplerForce is + tension, acting on a backward and on b forward along the track
      T.couplerForce[i] = !a.wreck ? -alongA : alongB;
    }
  }

  /** Moves the derailed vehicles. */
  step(dt) {
    const T = this.train;
    for (const v of T.veh) {
      const W = v.wreck;
      if (!W) continue;
      const m = v.mNow ?? v.mass, gr = this.ground(W.x, W.y, W.hint);
      W.hint = gr.s; v.s = gr.s;
      const onGround = W.z <= gr.z + 0.02;
      let fx = W.fx ?? 0, fy = W.fy ?? 0;
      // on a slope its weight draws it downhill
      if (onGround) {
        const gx = this.ground(W.x + 1, W.y, W.hint).z - this.ground(W.x - 1, W.y, W.hint).z, gy = this.ground(W.x, W.y + 1, W.hint).z - this.ground(W.x, W.y - 1, W.hint).z;
        fx -= (m * G * gx) / 2 / Math.sqrt(1 + (gx * gx + gy * gy) / 4); fy -= (m * G * gy) / 2 / Math.sqrt(1 + (gx * gx + gy * gy) / 4);
      }
      // friction where it touches the ground (it cannot reverse the slide)
      const sp = Math.hypot(W.vx, W.vy);
      if (onGround && sp > 1e-3) {
        const mu = W.onSide ? MU_SIDE : MU_WHEELS, Ff = Math.min(mu * m * G, (m * sp) / dt);
        fx -= (Ff * W.vx) / sp; fy -= (Ff * W.vy) / sp;
      }
      W.vx += (fx / m) * dt; W.vy += (fy / m) * dt;
      // yaw: the couplings' torque, the ground's friction resisting the turn
      const I = (m * v.length * v.length) / 12;
      W.w -= ((W.tq ?? 0) / I) * dt;                          // (the heading turns clockwise; the torque is counter-clockwise +)
      if (onGround) W.w *= Math.exp(-dt * (W.onSide ? 2.5 : 1.5));
      W.psi += W.w * dt;
      // a tunnel's walls hold it within the bore
      let nx = W.x + W.vx * dt, ny = W.y + W.vy * dt;
      const g2 = this.ground(nx, ny, W.hint);
      if (g2.tunnel && Math.abs(g2.off) > 2.2) {
        const rx = Math.cos(g2.heading), ry = -Math.sin(g2.heading), push = g2.off - Math.sign(g2.off) * 2.2;
        nx -= rx * push; ny -= ry * push;
        const vl = W.vx * rx + W.vy * ry;
        W.vx -= rx * vl; W.vy -= ry * vl;                      // (it strikes the wall and slides along it)
        W.vx *= 0.97; W.vy *= 0.97;
      }
      // a slope rising steeper than it can ride up (a cutting's side, the mountain) stops it like a wall
      let gz = g2.z;
      const stepLen = Math.hypot(nx - W.x, ny - W.y);
      if (gz > W.z + Math.max(0.05, stepLen * 0.6)) {
        const ex = this.ground(W.x + 0.5, W.y, W.hint).z - this.ground(W.x - 0.5, W.y, W.hint).z, ey = this.ground(W.x, W.y + 0.5, W.hint).z - this.ground(W.x, W.y - 0.5, W.hint).z;
        const el = Math.hypot(ex, ey) || 1, ux = ex / el, uy = ey / el, into = W.vx * ux + W.vy * uy;
        if (into > 0) { W.vx -= ux * into * 1.3; W.vy -= uy * into * 1.3; }
        W.vx *= 0.9; W.vy *= 0.9;
        nx = W.x; ny = W.y; gz = gr.z;
      }
      W.x = nx; W.y = ny;
      // falling, or resting on the ground
      // sliding on, it follows the ground down a slope it can follow (steeper than 1:1 it flies off)
      if (onGround && W.z > gz && W.z - gz < Math.hypot(W.vx, W.vy) * dt * 1.0 + 0.02) W.z = gz;
      if (W.z > gz + 0.02) { W.vz -= G * dt; W.z += W.vz * dt; }
      if (W.z <= gz) { if (W.vz < -6) T.events.push({ type: 'fell', name: v.name, speed: -W.vz }); W.z = gz; W.vz = 0; }
      // over on its side: tripped by sliding sideways (friction at its feet, inertia high up)
      const h = cgOf(v), rx = Math.cos(W.psi), ry = -Math.sin(W.psi);
      const vlat = W.vx * rx + W.vy * ry;
      if (!W.onSide) {
        const th = Math.abs(W.roll), side = th > 1e-4 ? Math.sign(W.roll) : Math.sign(vlat) || 1;
        const Ip = m * (B * B + h * h) + (m * (2.9 * 2.9 + 4 * 4)) / 12;
        let tq = -side * m * G * (B * Math.cos(th) - h * Math.sin(th));                     // its weight rights it until past the tip
        if (onGround && Math.abs(vlat) > 0.3 && Math.sign(vlat) === side) tq += side * MU_WHEELS * 1.6 * m * G * (h * Math.cos(th) + B * Math.sin(th));
        if (th <= 1e-4 && tq * side <= 0) { W.roll = 0; W.rollRate = 0; }                  // (standing on its wheels)
        else {
          const before = W.roll;
          W.rollRate += (tq / Ip) * dt;
          W.roll += W.rollRate * dt;
          if (before !== 0 && Math.sign(W.roll) !== Math.sign(before)) { W.roll = 0; W.rollRate = 0; }   // (back on its wheels)
        }
        if (Math.abs(W.roll) >= Math.PI / 2) { W.roll = Math.sign(W.roll) * Math.PI / 2; W.rollRate = 0; W.onSide = true; T.events.push({ type: 'on its side', name: v.name }); }
      }
      v.v = Math.hypot(W.vx, W.vy) * Math.sign(W.vx * Math.sin(W.psi) + W.vy * Math.cos(W.psi) || 1);
      v.a = 0;
    }
  }
}
