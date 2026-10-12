/**
 * The permanent way and the overhead line, along every track of the map.
 *
 * Track: standard gauge (1435 mm), UIC 60 rails (172 mm high, 72 mm head, 150 mm foot) laid
 * at 1:40 inclination on concrete sleepers of the B 91 type used in Switzerland (2.60 m long,
 * every 0.60 m), in a ballast bed whose shoulders slope 2:3 down to the formation 0.72 m under
 * the rail head. In curves the whole track is canted (route.js). The rail heads shine where
 * the wheels run; everything else is rust brown, grey concrete and granite ballast, and
 * snow-covered as the weather says.
 *
 * Overhead line (15 kV 16.7 Hz): steel masts beside each main track about every 60 m
 * (closer in tight curves), cantilevers holding the contact wire at about 5.3 m above the
 * rail, zig-zagged +-0.25 m across the pantograph, under a messenger wire some 1.4 m above it
 * at the supports, joined by droppers. In tunnels the wire hangs from brackets in the vault.
 *
 * Drawn in 100 m pieces near the camera (sleepers within ~300 m, rails within ~900 m, ballast
 * and masts within ~3 km), each anchored to the floating origin.
 */
import { BufferGeometry, Float32BufferAttribute, BoxGeometry, InstancedMesh, Mesh, MeshStandardMaterial, Group, Matrix4, Quaternion, Vector3, Euler, Color } from 'three';

const PIECE = 100;
const RAIL_PITCH = 1.507;            // rail centre to rail centre (gauge + head width)
const SLEEPER = { len: 2.6, w: 0.28, h: 0.21, gap: 0.6 };
const FORMATION = 0.72;

// UIC 60 cross-section (simplified, metres; x across, y up from the rail foot), counter-clockwise
const RAIL_PROFILE = [
  [-0.075, 0], [0.075, 0], [0.075, 0.012], [0.012, 0.03], [0.0083, 0.04], [0.0083, 0.13], [0.036, 0.137], [0.036, 0.165], [0.03, 0.172],
  [-0.03, 0.172], [-0.036, 0.165], [-0.036, 0.137], [-0.0083, 0.13], [-0.0083, 0.04], [-0.012, 0.03], [-0.075, 0.012],
];

/** A frame along a track: position (map), unit tangent, unit right (horizontal), cant angle. */
function frameAt(line, s, out = {}) {
  const p = line.pos(s);
  const h = line.headingAt(s);
  const g = line.gradeAt(s);
  out.x = p.x; out.y = p.y; out.z = p.z;
  out.tx = Math.sin(h); out.ty = Math.cos(h); out.tz = g;
  out.rx = Math.cos(h); out.ry = -Math.sin(h);           // right of the direction of travel
  const k = line.curvatureAt(s);
  out.cant = -Math.atan2(line.cantAt ? line.cantAt(s) : 0, RAIL_PITCH) * Math.sign(k);   // curving right: the left (outer) rail is raised
  return out;
}

/** World (anchor-relative) point from a frame, an offset across (right +) and a height above the rail head. */
function framePoint(f, across, up, anchor, out) {
  // cant: rotate (across, up) about the track centre
  const c = Math.cos(f.cant), s = Math.sin(f.cant);
  const a = across * c + up * s * 0, u = up + across * s;          // small angle: heights change, widths do not
  const mx = f.x + f.rx * a, my = f.y + f.ry * a, mz = f.z + u;
  out.set(mx - anchor.x, mz - anchor.z, -(my - anchor.y));
  return out;
}

/** A polyline as a minimal Track-like object (yard tracks). */
class Polyline {
  constructor(pts) {
    this.pts = pts;                        // [x, y, z, ...]
    this.cum = [0];
    for (let i = 3; i < pts.length; i += 3) this.cum.push(this.cum.at(-1) + Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2]));
    this.length = this.cum.at(-1);
  }
  _seg(s) {
    let i = 0; while (i < this.cum.length - 2 && this.cum[i + 1] < s) i++;
    const t = Math.min(1, Math.max(0, (s - this.cum[i]) / Math.max(1e-6, this.cum[i + 1] - this.cum[i])));
    return [i, t];
  }
  pos(s) { const [i, t] = this._seg(s), P = this.pts, a = i * 3, b = a + 3; return { x: P[a] + (P[b] - P[a]) * t, y: P[a + 1] + (P[b + 1] - P[a + 1]) * t, z: P[a + 2] + (P[b + 2] - P[a + 2]) * t }; }
  headingAt(s) { const [i] = this._seg(s), P = this.pts, a = i * 3, b = a + 3; return Math.atan2(P[b] - P[a], P[b + 1] - P[a + 1]); }
  gradeAt(s) { const [i] = this._seg(s), P = this.pts, a = i * 3, b = a + 3; return (P[b + 2] - P[a + 2]) / Math.max(1e-3, Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1])); }
  curvatureAt() { return 0; }
}

export class TrackGL {
  constructor(stage, route, terrain, weather) {
    this.stage = stage; this.route = route; this.T = terrain;
    this.group = new Group(); this.group.name = 'track';
    stage.scene.add(this.group);
    this.pieces = new Map();
    this._lines();
    this.setWeather(weather);
  }

  /** The lines to lay: the running path, the other main track, the left main track and the yards where they leave those. */
  _lines() {
    const R = this.route;
    const lines = [{ id: 'run', line: R.run, main: true, side: -1 }, { id: 'right', line: R.right, main: true, side: 1 }];
    // the left main line where the running path is not on it (it leaves it at the two stations)
    const near = (x, y, tracks, d) => tracks.some((t) => t.locate(x, y, null, 0).d < d);
    const spans = (line, others, step = 10, dmin = 2.2) => {
      const out = []; let cur = null;
      for (let s = 0; s <= line.length; s += step) {
        const p = line.pos(s);
        const free = !others.some((o) => o.locate(p.x, p.y).d < dmin);
        if (free && !cur) cur = { s0: s };
        if (!free && cur) { cur.s1 = s; out.push(cur); cur = null; }
      }
      if (cur) { cur.s1 = line.length; out.push(cur); }
      return out.filter((x) => x.s1 - x.s0 > 15);
    };
    void near;
    for (const sp of spans(R.left, [R.run, R.right])) lines.push({ id: `left${sp.s0}`, line: R.left, s0: sp.s0, s1: sp.s1, main: false, side: -1 });
    (R.data?.yard ?? []).forEach((y, i) => {
      const pl = new Polyline(y.p);
      for (const sp of spans(pl, [R.run, R.right, R.left], 5)) lines.push({ id: `yard${i}-${sp.s0}`, line: pl, s0: sp.s0, s1: sp.s1, main: false, side: 0 });
    });
    for (const L of lines) { L.s0 ??= 0; L.s1 ??= L.line.length; }
    this.lines = lines;
    // the overhead line's supports on the two main lines: spans shorten in curves so the chord
    // between supports stays within the pantograph (sagitta L^2 / 8R under ~0.4 m)
    for (const L of lines) {
      if (!L.main) continue;
      const line = L.line, masts = [];
      let s = 8;
      while (s < line.length - 5) {
        const inTunnel = (q) => (line === R.run ? !!R.inTunnel(q) : this._rightInTunnel(q));
        masts.push({ s, tunnel: inTunnel(s) });
        let span = 64;
        for (let q = s; q < s + 64; q += 4) { const k = Math.abs(line.curvatureAt(q)); if (k > 1e-5) span = Math.min(span, Math.sqrt(3.2 / k)); }
        if (inTunnel(s)) span = Math.min(span, 30);
        s += Math.max(24, span);
      }
      L.masts = masts;
    }
  }

  /** The other main track's tunnels: where its nearest point of the running path is in one (both tracks share the bores). */
  _rightInTunnel(s) {
    const R = this.route, p = R.right.pos(s);
    this._rg = R.run.locate(p.x, p.y, this._rg ?? null, this._rg == null ? 1e9 : 300).s;
    const q = R.run.pos(this._rg);
    return Math.abs(q.z - p.z) < 6 && !!R.inTunnel(this._rg);
  }

  setWeather(weather) {
    const p = weather.p;
    // how much snow lies on the track: ploughed and kept open by the trains, but lying on the sleepers after a fall
    this.snow = p.snowfall > 1 ? 1.0 : p.snowfall > 0 ? 0.8 : p.id === 'foehn' ? 0.0 : p.id === 'fog' ? 0.55 : 0.45;
    const snowy = (c, k) => new Color().copy(c).lerp(new Color(0.84, 0.86, 0.9), k);
    this.mats = {
      ballast: new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
      sleeper: new MeshStandardMaterial({ color: snowy(new Color(0.42, 0.41, 0.39), this.snow * 0.55), roughness: 0.9 }),
      rail: new MeshStandardMaterial({ color: new Color(0.16, 0.09, 0.06), roughness: 0.8, metalness: 0.3 }),
      head: new MeshStandardMaterial({ color: new Color(0.62, 0.62, 0.64), roughness: p.rail === 'wet' ? 0.12 : 0.28, metalness: 1.0 }),
      mast: new MeshStandardMaterial({ color: new Color(0.36, 0.37, 0.38), roughness: 0.6, metalness: 0.6 }),
      wire: new MeshStandardMaterial({ color: new Color(0.25, 0.2, 0.15), roughness: 0.5, metalness: 0.8 }),
      insulator: new MeshStandardMaterial({ color: new Color(0.45, 0.25, 0.15), roughness: 0.3 }),
    };
    if (p.id === 'fog') this.mats.wire.color.setRGB(0.8, 0.82, 0.85);       // rime on the wires
    for (const pc of this.pieces.values()) this._disposePiece(pc);
    this.pieces.clear();
  }

  // ---- building one piece ------------------------------------------------------------------

  _piece(L, k) {
    const s0 = Math.max(L.s0, k * PIECE), s1 = Math.min(L.s1, (k + 1) * PIECE);
    if (s1 - s0 < 1) return null;
    const line = L.line;
    const f0 = frameAt(line, s0);
    const anchor = { x: f0.x, y: f0.y, z: f0.z };
    const group = new Group();
    group.name = `track-${L.id}-${k}`;
    const parts = { group, anchor, ballast: null, rails: null, sleepers: null, mast: null, wires: null };
    // ---- ballast
    {
      const P = [], C = [], idx = [];
      const prof = [[-2.55, -FORMATION - 0.05], [-1.72, -0.215], [-0.75, -0.2], [0.75, -0.2], [1.72, -0.215], [2.55, -FORMATION - 0.05]];
      const n = Math.max(2, Math.ceil((s1 - s0) / 4) + 1);
      const f = {}, v = new Vector3();
      const sn = this.snow;
      for (let i = 0; i < n; i++) {
        const s = s0 + (s1 - s0) * (i / (n - 1));
        frameAt(line, s, f);
        prof.forEach(([a, u], j) => {
          framePoint(f, a, u, anchor, v);
          P.push(v.x, v.y, v.z);
          const top = j > 0 && j < prof.length - 1;
          const n1 = Math.sin(s * 0.37 + j) * 0.5 + 0.5;
          const stone = [0.30 + 0.03 * n1, 0.29 + 0.03 * n1, 0.27 + 0.02 * n1];
          const w = top ? sn * 0.9 : sn;
          C.push(stone[0] * (1 - w) + 0.85 * w, stone[1] * (1 - w) + 0.87 * w, stone[2] * (1 - w) + 0.91 * w);
        });
      }
      const m = prof.length;
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) {
        const a = i * m + j, b = a + 1, c = a + m, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(P, 3));
      g.setAttribute('color', new Float32BufferAttribute(C, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const mesh = new Mesh(g, this.mats.ballast);
      mesh.receiveShadow = true;
      group.add(mesh);
      parts.ballast = mesh;
    }
    // ---- rails (body and polished head band)
    {
      const body = { P: [], idx: [] }, head = { P: [], idx: [] };
      const n = Math.max(2, Math.ceil((s1 - s0) / 3) + 1);
      const f = {}, v = new Vector3();
      for (const side of [-1, 1]) {
        const tilt = side * (1 / 40);                       // rails lean inward 1:40
        for (const [tgt, prof] of [[body, RAIL_PROFILE], [head, [[-0.03, 0.172], [0.03, 0.172], [0.036, 0.165], [-0.036, 0.165]]]]) {
          const base = tgt.P.length / 3;
          for (let i = 0; i < n; i++) {
            const s = s0 + (s1 - s0) * (i / (n - 1));
            frameAt(line, s, f);
            for (const [px, py] of prof) {
              const a = side * RAIL_PITCH / 2 + px - py * tilt;
              framePoint(f, a, py - 0.172 + (tgt === head ? 0.0006 : 0), anchor, v);
              tgt.P.push(v.x, v.y, v.z);
            }
          }
          const m = prof.length;
          for (let i = 0; i < n - 1; i++) for (let j = 0; j < (tgt === head ? 1 : m); j++) {
            const j2 = (j + 1) % m;
            const a = base + i * m + j, b = base + i * m + j2, c = base + (i + 1) * m + j, d = base + (i + 1) * m + j2;
            tgt.idx.push(a, c, b, b, c, d);
          }
        }
      }
      const mk = (t, mat) => {
        const g = new BufferGeometry();
        g.setAttribute('position', new Float32BufferAttribute(t.P, 3));
        g.setIndex(t.idx);
        g.computeVertexNormals();
        const mesh = new Mesh(g, mat);
        mesh.castShadow = true;
        return mesh;
      };
      parts.rails = new Group();
      parts.rails.add(mk(body, this.mats.rail), mk(head, this.mats.head));
      group.add(parts.rails);
    }
    // ---- sleepers
    {
      const n = Math.floor((s1 - s0) / SLEEPER.gap);
      const geo = (this._sleeperGeo ??= new BoxGeometry(SLEEPER.len, SLEEPER.h, SLEEPER.w).translate(0, -0.172 - 0.012 - SLEEPER.h / 2, 0));
      const im = new InstancedMesh(geo, this.mats.sleeper, Math.max(1, n));
      const f = {}, m = new Matrix4(), q = new Quaternion(), e = new Euler(), v = new Vector3(), one = new Vector3(1, 1, 1);
      for (let i = 0; i < n; i++) {
        const s = s0 + (i + 0.5) * SLEEPER.gap;
        frameAt(line, s, f);
        framePoint(f, 0, 0, anchor, v);
        const yaw = Math.atan2(f.tx, f.ty);
        e.set(Math.atan(f.tz), -yaw, f.cant, 'YXZ');
        // the sleeper's long axis across the track: rotate a box whose x is across
        q.setFromEuler(new Euler(0, -yaw + 0, 0));
        const qc = new Quaternion().setFromAxisAngle(new Vector3(f.tx, 0, -f.ty).normalize(), -f.cant);
        q.premultiply(qc);
        m.compose(v, q, one);
        im.setMatrixAt(i, m);
      }
      im.count = n;
      im.castShadow = false;
      im.frustumCulled = true;
      im.computeBoundingSphere();
      group.add(im);
      parts.sleepers = im;
    }
    if (L.main && L.masts) parts.overhead = this._overhead(L, s0, s1, anchor, group);
    this.stage.anchor(group, anchor);
    this.group.add(group);
    return parts;
  }

  /** Masts, cantilevers and wires for the spans starting in [s0, s1) of a main line. */
  _overhead(L, s0, s1, anchor, group) {
    const line = L.line, side = L.side;            // masts on the outer side of each main track
    const M = { P: [], idx: [] }, W = { P: [], idx: [] }, I = { P: [], idx: [] };
    const f = {}, v = new Vector3(), a = new Vector3(), b = new Vector3();
    const box = (T, c, ax, ay, az, hx, hy, hz) => {
      // an oriented box: centre c, half-sizes along the unit axes ax (across), ay (up), az (along)
      const base = T.P.length / 3;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        T.P.push(c.x + ax.x * hx * sx + ay.x * hy * sy + az.x * hz * sz, c.y + ax.y * hx * sx + ay.y * hy * sy + az.y * hz * sz, c.z + ax.z * hx * sx + ay.z * hy * sy + az.z * hz * sz);
      }
      for (const q of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) T.idx.push(base + q[0], base + q[1], base + q[2], base + q[0], base + q[2], base + q[3]);
    };
    const tube = (T, p0, p1, r, segs = 4) => {
      const d = new Vector3().subVectors(p1, p0), len = d.length();
      if (len < 1e-4) return;
      d.divideScalar(len);
      const u = Math.abs(d.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
      const e1 = new Vector3().crossVectors(d, u).normalize(), e2 = new Vector3().crossVectors(d, e1);
      const base = T.P.length / 3;
      for (const p of [p0, p1]) for (let k = 0; k < segs; k++) {
        const t = (k / segs) * Math.PI * 2;
        T.P.push(p.x + (e1.x * Math.cos(t) + e2.x * Math.sin(t)) * r, p.y + (e1.y * Math.cos(t) + e2.y * Math.sin(t)) * r, p.z + (e1.z * Math.cos(t) + e2.z * Math.sin(t)) * r);
      }
      for (let k = 0; k < segs; k++) { const k2 = (k + 1) % segs; T.idx.push(base + k, base + segs + k, base + k2, base + k2, base + segs + k, base + segs + k2); }
    };
    const up = new Vector3(0, 1, 0);
    const CW = 5.3, SYS = 1.4;
    const masts = L.masts;
    for (let i = 0; i < masts.length; i++) {
      const m0 = masts[i];
      if (m0.s < s0 || m0.s >= s1) continue;
      frameAt(line, m0.s, f);
      const stagger = (i % 2 ? 1 : -1) * 0.25;
      const across = new Vector3(f.rx, 0, -f.ry).normalize(), along = new Vector3(f.tx, 0, -f.ty).normalize();
      // the contact and messenger support points
      const cw0 = framePoint(f, stagger, CW, anchor, new Vector3());
      const ms0 = framePoint(f, 0, CW + SYS, anchor, new Vector3());
      if (!m0.tunnel) {
        const foot = framePoint(f, side * 3.1, -FORMATION, anchor, new Vector3());
        const top = framePoint(f, side * 3.1, CW + SYS + 0.9, anchor, new Vector3());
        box(M, a.addVectors(foot, top).multiplyScalar(0.5), across, up, along, 0.11, (top.y - foot.y) / 2, 0.09);
        // cantilever: the top tube to the messenger, the bracket tube under it, the registration arm
        const t1 = framePoint(f, side * 3.0, CW + SYS + 0.05, anchor, new Vector3());
        const t2 = framePoint(f, side * 3.0, CW - 0.2, anchor, new Vector3());
        tube(M, t1, ms0.clone().add(new Vector3(0, 0.05, 0)), 0.03);
        tube(M, t2, framePoint(f, stagger + side * 0.6, CW + SYS * 0.55, anchor, new Vector3()), 0.03);
        tube(M, framePoint(f, stagger + side * 0.6, CW + SYS * 0.55, anchor, new Vector3()), ms0, 0.02);
        tube(M, framePoint(f, stagger + side * 0.75, CW + 0.25, anchor, new Vector3()), cw0, 0.012);
        // insulators next to the mast
        tube(I, framePoint(f, side * 2.95, CW + SYS + 0.05, anchor, new Vector3()), framePoint(f, side * 2.45, CW + SYS + 0.05, anchor, new Vector3()), 0.06, 6);
        tube(I, framePoint(f, side * 2.95, CW - 0.2, anchor, new Vector3()), framePoint(f, side * 2.45, CW - 0.12, anchor, new Vector3()), 0.06, 6);
      } else {
        // in a tunnel: a drop bracket from the vault
        tube(M, framePoint(f, stagger, CW + SYS + 0.6, anchor, new Vector3()), cw0, 0.02);
      }
      // the span to the next support: contact wire straight, messenger sagging, droppers between
      const m1 = masts[i + 1];
      if (!m1) continue;
      const f1 = frameAt(line, m1.s, {});
      const cw1 = framePoint(f1, -stagger, CW, anchor, new Vector3());
      const ms1 = framePoint(f1, 0, CW + SYS, anchor, new Vector3());
      tube(W, cw0, cw1, 0.0065, 3);
      const nseg = 6;
      let prev = ms0.clone();
      for (let k = 1; k <= nseg; k++) {
        const t = k / nseg;
        const pnt = new Vector3().lerpVectors(ms0, ms1, t);
        pnt.y -= 4 * t * (1 - t) * (SYS - 0.45);
        tube(W, prev, pnt, 0.0055, 3);
        if (k < nseg) {
          const cwp = new Vector3().lerpVectors(cw0, cw1, t);
          tube(W, pnt, cwp, 0.0025, 3);
        }
        prev = pnt;
      }
    }
    const out = new Group();
    for (const [T, mat] of [[M, this.mats.mast], [W, this.mats.wire], [I, this.mats.insulator]]) {
      if (!T.idx.length) continue;
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(T.P, 3));
      g.setIndex(T.idx);
      g.computeVertexNormals();
      const mesh = new Mesh(g, mat);
      mesh.castShadow = true;
      if (T === W) mesh.userData.wires = true;
      out.add(mesh);
    }
    group.add(out);
    return out;
  }

  _disposePiece(pc) {
    this.stage.unanchor(pc.group);
    this.group.remove(pc.group);
    pc.group.traverse((o) => { if (o.isMesh) { o.geometry !== this._sleeperGeo && o.geometry.dispose(); o.dispose?.(); } });
  }

  /** Lays and lifts pieces near the camera; switches their detail by distance. */
  update(cameraWorld, budget = 6) {
    const cm = this.stage.toMap(cameraWorld);
    let made = 0;
    const keep = new Set();
    for (const L of this.lines) {
      // which pieces of this line are near? (coarse test by sampling every piece's middle)
      const k0 = Math.floor(L.s0 / PIECE), k1 = Math.floor((L.s1 - 1e-6) / PIECE);
      for (let k = k0; k <= k1; k++) {
        const sm = Math.min(L.s1, Math.max(L.s0, (k + 0.5) * PIECE));
        const p = L.line.pos(sm);
        const d = Math.hypot(p.x - cm.x, p.y - cm.y, p.z - cm.z);
        if (d > 3200) continue;
        const key = `${L.id}:${k}`;
        keep.add(key);
        let pc = this.pieces.get(key);
        if (!pc && made < budget) { pc = this._piece(L, k); this.pieces.set(key, pc); made++; }
        if (pc) {
          pc.rails.visible = d < 950;
          pc.sleepers.visible = d < 320;
          if (pc.overhead) for (const m of pc.overhead.children) m.visible = m.userData.wires ? d < 700 : d < 2400;
        }
      }
    }
    for (const [key, pc] of this.pieces) if (!keep.has(key)) { if (pc) this._disposePiece(pc); this.pieces.delete(key); }
    return made;
  }
}
