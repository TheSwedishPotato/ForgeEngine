/**
 * Life off Waianae: schools of small silvery fish (opelu, akule: mackerel scad and bigeye scad)
 * wheeling in mid-water, reef fish round the coral heads (yellow tang, convict tang), Hawaiian
 * green sea turtles (honu) grazing the reef and rising to breathe, a pod of spinner dolphins near
 * the surface. Each school a few hundred fish as one instanced mesh, steering as a body (a
 * wandering centre, each fish keeping its place in it with its own wobble) and shying away from
 * the boat's hull when she comes near.
 */
import { InstancedMesh, MeshStandardMaterial, Color, Matrix4, Quaternion, Vector3, Euler, Group, BufferGeometry, Float32BufferAttribute } from 'three';
import { Builder } from '../../../gotthard-pullman/src/render/geom.js';
import { OBS_DECK } from '../physics/mass.js';

const _m = new Matrix4(), _q = new Quaternion(), _v = new Vector3(), _s = new Vector3(), _e = new Euler(0, 0, 0, 'YXZ');

/** A fish: a lathed body along +x, a forked tail, a dorsal fin. Length 1 m (scaled per species). */
function fishGeometry({ deep = 0.22, tail = 0.28 } = {}) {
  const b = new Builder();
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    const r = Math.sin(Math.PI * Math.pow(u, 0.75)) * deep * (u < 0.15 ? 0.8 + u : 1);
    prof.push([u, r]);
  }
  // body: rings along x (from tail at x=-0.5 to snout at x=+0.5), flattened sideways
  const segs = 10, rings = prof.map(([u, r]) => ({ x: u - 0.5, r }));
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], B = rings[i + 1];
    for (let j = 0; j < segs; j++) {
      const t0 = (j / segs) * Math.PI * 2, t1 = ((j + 1) / segs) * Math.PI * 2;
      const p = (q, t) => new Vector3(q.x, q.r * Math.sin(t), q.r * 0.45 * Math.cos(t));
      b.quad('f', p(A, t0), p(B, t0), p(B, t1), p(A, t1));
    }
  }
  // the tail: two triangles forked
  b.tri('f', new Vector3(-0.48, 0, 0), new Vector3(-0.5 - tail, tail * 0.9, 0), new Vector3(-0.5 - tail * 0.6, 0, 0));
  b.tri('f', new Vector3(-0.48, 0, 0), new Vector3(-0.5 - tail * 0.6, 0, 0), new Vector3(-0.5 - tail, -tail * 0.9, 0));
  b.tri('f', new Vector3(-0.48, 0, 0), new Vector3(-0.5 - tail * 0.6, 0, 0), new Vector3(-0.5 - tail, tail * 0.9, 0));
  b.tri('f', new Vector3(-0.48, 0, 0), new Vector3(-0.5 - tail, -tail * 0.9, 0), new Vector3(-0.5 - tail * 0.6, 0, 0));
  // dorsal fin
  b.tri('f', new Vector3(0.05, deep * 0.95, 0), new Vector3(-0.25, deep * 0.6, 0), new Vector3(-0.05, deep * 1.5, 0));
  b.tri('f', new Vector3(0.05, deep * 0.95, 0), new Vector3(-0.05, deep * 1.5, 0), new Vector3(-0.25, deep * 0.6, 0));
  const g = b.build({ f: new MeshStandardMaterial() }).children[0].geometry;
  return g;
}

/** A sea turtle: a domed shell, head, four flippers. About 1 m long. */
function turtleGeometry() {
  const b = new Builder();
  const shell = 18, rings = 8;
  for (let i = 0; i < rings; i++) for (let j = 0; j < shell; j++) {
    const a0 = (i / rings) * Math.PI / 2, a1 = ((i + 1) / rings) * Math.PI / 2;
    const t0 = (j / shell) * Math.PI * 2, t1 = ((j + 1) / shell) * Math.PI * 2;
    const p = (a, t) => new Vector3(0.5 * Math.cos(a) * Math.cos(t), 0.22 * Math.sin(a), 0.4 * Math.cos(a) * Math.sin(t));
    b.quad('t', p(a0, t0), p(a0, t1), p(a1, t1), p(a1, t0));
  }
  for (let j = 0; j < shell; j++) {
    const t0 = (j / shell) * Math.PI * 2, t1 = ((j + 1) / shell) * Math.PI * 2;
    b.tri('t', new Vector3(0, -0.02, 0), new Vector3(0.5 * Math.cos(t1), 0, 0.4 * Math.sin(t1)), new Vector3(0.5 * Math.cos(t0), 0, 0.4 * Math.sin(t0)));
  }
  b.box('t', [0.48, -0.04, -0.07], [0.68, 0.08, 0.07]);
  for (const [x, s, L] of [[0.25, 1, 0.55], [0.25, -1, 0.55], [-0.32, 1, 0.25], [-0.32, -1, 0.25]]) {
    b.tri('t', new Vector3(x + 0.08, 0, s * 0.3), new Vector3(x - 0.1, 0, s * (0.3 + L)), new Vector3(x - 0.08, 0, s * 0.3));
    b.tri('t', new Vector3(x + 0.08, 0, s * 0.3), new Vector3(x - 0.08, 0, s * 0.3), new Vector3(x - 0.1, 0, s * (0.3 + L)));
  }
  return b.build({ t: new MeshStandardMaterial() }).children[0].geometry;
}

/** A dolphin: a lathed body with beak, flukes, dorsal fin. 2 m. */
function dolphinGeometry() {
  const g = fishGeometry({ deep: 0.13, tail: 0.18 });
  return g;
}

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

class School {
  constructor({ geo, mat, n, size, home, depth, radius, speed, spread, seed, kind = 'fish' }) {
    this.mesh = new InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.n = n; this.size = size; this.home = home; this.depth = depth; this.radius = radius; this.speed = speed; this.spread = spread; this.kind = kind;
    const r = rng(seed);
    this.r = r;
    this.offs = Array.from({ length: n }, () => [(r() - 0.5) * spread * 2, (r() - 0.5) * spread * 0.6, (r() - 0.5) * spread * 2, r() * 6.28, 0.85 + r() * 0.3]);
    this.phase = r() * 100;
    this.c = [home[0], -depth, home[1]];
    this.dir = [1, 0, 0];
    this.flee = [0, 0, 0];
  }
}

export class LifeGL {
  constructor(stage, sim) {
    this.stage = stage; this.sim = sim;
    this.group = new Group();
    stage.scene.add(this.group);
    const silver = new MeshStandardMaterial({ color: new Color(0.7, 0.75, 0.8), roughness: 0.28, metalness: 0.75 });
    const tang = new MeshStandardMaterial({ color: new Color(0.95, 0.82, 0.12), roughness: 0.45 });
    const convict = new MeshStandardMaterial({ color: new Color(0.75, 0.78, 0.7), roughness: 0.45 });
    const turtle = new MeshStandardMaterial({ color: new Color(0.32, 0.28, 0.18), roughness: 0.6 });
    const dolphin = new MeshStandardMaterial({ color: new Color(0.32, 0.36, 0.42), roughness: 0.35, metalness: 0.1 });
    const fish = fishGeometry(), tangGeo = fishGeometry({ deep: 0.42, tail: 0.18 });
    const bed = sim.bed, P = sim.plant;
    const x0 = P.dyn.pos[0], z0 = P.dyn.pos[2];
    const near = (dx, dz) => [x0 + dx, z0 + dz];
    this.schools = [
      new School({ geo: fish, mat: silver, n: 260, size: 0.28, home: near(-40, -80), depth: 14, radius: 45, speed: 1.2, spread: 5, seed: 3 }),
      new School({ geo: fish, mat: silver, n: 220, size: 0.22, home: near(60, -160), depth: 22, radius: 60, speed: 1.0, spread: 4, seed: 9 }),
      new School({ geo: fish, mat: silver, n: 300, size: 0.3, home: near(-20, -300), depth: 9, radius: 70, speed: 1.4, spread: 6, seed: 17 }),
    ];
    // reef fish round coral heads near the bottom
    for (let k = 0; k < 4; k++) {
      const h = near(-60 + k * 45, -60 - k * 70);
      const d = bed.depth(h[0], h[1]) - 2.5;
      this.schools.push(new School({ geo: tangGeo, mat: k % 2 ? tang : convict, n: 40, size: 0.2, home: h, depth: Math.max(6, d), radius: 6, speed: 0.4, spread: 3, seed: 30 + k, kind: 'reef' }));
    }
    this.schools.push(new School({ geo: turtleGeometry(), mat: turtle, n: 4, size: 1.0, home: near(10, -120), depth: Math.max(8, bed.depth(x0 + 10, z0 - 120) - 3), radius: 50, speed: 0.45, spread: 30, seed: 51, kind: 'turtle' }));
    // bluefin trevally and a cloud of scad that pace the boat, 8 to 14 m off the observation deck
    const jack = new MeshStandardMaterial({ color: new Color(0.55, 0.62, 0.72), roughness: 0.3, metalness: 0.6 });
    this.schools.push(new School({ geo: fishGeometry({ deep: 0.3, tail: 0.25 }), mat: jack, n: 14, size: 0.6, home: [0, 0], depth: 0, radius: 11, speed: 0.15, spread: 5, seed: 91, kind: 'escort' }));
    this.schools.push(new School({ geo: fish, mat: silver, n: 160, size: 0.2, home: [0, 0], depth: 0, radius: 13, speed: 0.1, spread: 3.5, seed: 93, kind: 'escort' }));
    this.schools.push(new School({ geo: dolphinGeometry(), mat: dolphin, n: 8, size: 2.0, home: near(150, -200), depth: 2.5, radius: 250, speed: 5, spread: 8, seed: 77, kind: 'dolphin' }));
    for (const s of this.schools) this.group.add(s.mesh);
    this.t = 0;
    this._r = rng(4242);
    this.r01 = () => this._r();
  }

  update(dt) {
    this.t += dt;
    const S = this.stage, P = this.sim.plant, d = P.dyn, bed = this.sim.bed;
    const bx = d.pos[0], by = d.pos[1], bz = d.pos[2];
    const B = this.stage.boatMat.elements;
    for (const s of this.schools) {
      if (s.kind === 'escort') {
        // alongside her: a point off the observation deck, swinging slowly from one side to the other
        const a = this.t * s.speed + s.phase;
        // one school each side (the jacks to starboard, the scad to port), drifting fore and aft
        const side = s.n < 50 ? 1 : -1;
        const lx = OBS_DECK.x + Math.sin(a * 0.7) * 6, ly = OBS_DECK.axisY - 0.5 + Math.sin(a * 0.5) * 1.5, lz = side * s.radius * (0.85 + 0.15 * Math.sin(a * 1.3));
        const wx = B[0] * lx + B[4] * ly + B[8] * lz + B[12] + S.origin.x, wy = B[1] * lx + B[5] * ly + B[9] * lz + B[13], wz = B[2] * lx + B[6] * ly + B[10] * lz + B[14] + S.origin.z;
        const k = Math.hypot(wx - s.c[0], wz - s.c[2]) > 60 ? 1 : Math.min(1, dt * 0.8);   // (joining her: straight there)
        s.c[0] += (wx - s.c[0]) * k; s.c[1] += (Math.min(-1.2, wy) - s.c[1]) * k; s.c[2] += (wz - s.c[2]) * k;
        const hdg = d.attitude.heading;
        s.dir = [Math.sin(hdg), 0, -Math.cos(hdg)];
        this._place(s, Math.atan2(-s.dir[2], s.dir[0]), S);
        continue;
      }
      // left far astern, a school's haunt is found again ahead of her (the sea is full of them)
      if (s.kind !== 'reef' && Math.hypot(s.home[0] - bx, s.home[1] - bz) > 420) {
        const h = d.attitude.heading, ahead = 180 + this.r01() * 160, side = (this.r01() - 0.5) * 220;
        s.home = [bx + Math.sin(h) * ahead + Math.cos(h) * side, bz - Math.cos(h) * ahead + Math.sin(h) * side];
        s.c = [s.home[0], s.c[1], s.home[1]];
        if (s.kind === 'turtle') s.depth = Math.max(6, bed.depth(s.home[0], s.home[1]) - 3);
      }
      // the school's centre wanders round its home, at its depth (turtles rising now and then to breathe)
      const T = this.t * s.speed / s.radius + s.phase;
      let depth = s.depth;
      if (s.kind === 'turtle') depth = s.depth * (0.5 + 0.5 * Math.cos(this.t * 0.02 + s.phase));
      if (s.kind === 'dolphin') depth = 1.5 + 2.5 * Math.abs(Math.sin(this.t * 0.6 + s.phase));
      const tx = s.home[0] + Math.cos(T) * s.radius + Math.sin(T * 2.3) * s.radius * 0.3;
      const tz = s.home[1] + Math.sin(T * 1.3) * s.radius;
      const nx = tx - s.c[0], nz = tz - s.c[2];
      const l = Math.hypot(nx, nz) || 1;
      // shy of the hull: a school within 20 m of the boat's middle turns away from her
      const fx = s.c[0] - bx, fy = s.c[1] - by, fz = s.c[2] - bz, fd = Math.hypot(fx, fy * 2, fz);
      const shy = s.kind === 'dolphin' ? 0 : Math.max(0, 1 - fd / 22);
      s.dir = [nx / l + (fx / (fd || 1)) * shy * 3, 0, nz / l + (fz / (fd || 1)) * shy * 3];
      const dl = Math.hypot(s.dir[0], s.dir[2]) || 1;
      s.c[0] += (s.dir[0] / dl) * s.speed * dt * (1 + shy * 2);
      s.c[2] += (s.dir[2] / dl) * s.speed * dt * (1 + shy * 2);
      s.c[1] += (-depth - s.c[1]) * Math.min(1, dt * 0.3);
      const floor = -bed.depth(s.c[0], s.c[2]) + 1.0;
      if (s.c[1] < floor) s.c[1] = floor;
      this._place(s, Math.atan2(-s.dir[2], s.dir[0]), S);
    }
  }

  /** Puts each fish of a school at its place in it, swimming. */
  _place(s, yaw, S) {
    {
      for (let i = 0; i < s.n; i++) {
        const o = s.offs[i];
        const w = this.t * (s.kind === 'turtle' ? 0.6 : 3.5) * o[4] + o[3];
        const ox = o[0] + Math.sin(w * 0.13) * 0.4, oy = o[1] + Math.sin(w * 0.21) * 0.25, oz = o[2] + Math.cos(w * 0.11) * 0.4;
        // the offsets turned with the school's heading
        const c = Math.cos(yaw), sn = Math.sin(yaw);
        const X = s.c[0] + ox * c - oz * sn, Z = s.c[2] + ox * sn + oz * c;
        let Y = s.c[1] + oy;
        if (s.kind === 'dolphin') Y += Math.sin(this.t * 1.5 + o[3]) * 0.6;
        _v.set(X - S.origin.x, Math.min(-0.25, Y), Z - S.origin.z);
        _e.set(s.kind === 'dolphin' ? Math.cos(this.t * 1.5 + o[3]) * 0.3 : 0, yaw + Math.sin(w) * (s.kind === 'turtle' ? 0.05 : 0.12), 0, 'YXZ');
        _q.setFromEuler(_e);
        const k = s.size * o[4];
        _s.set(k, k, k);
        _m.compose(_v, _q, _s);
        s.mesh.setMatrixAt(i, _m);
      }
      s.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
