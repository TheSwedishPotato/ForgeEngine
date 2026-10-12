/**
 * Tunnels and bridges of the north ramp, where OpenStreetMap puts them.
 *
 * Tunnels: the Gotthard line's double-track bores, lined in granite masonry: a portal of
 * dressed granite with a semicircular arch (about 8.6 m wide, its crown 6.4 m over the rails),
 * wing walls along the cutting, and inside the vault running on along the track.
 *
 * Bridges (types as built today where known, see README): Chärstelenbach (1970-72) two
 * single-track steel composite girders over two 50 m spans; Intschireuss (1975) two
 * prestressed concrete box girders on paired piers; the lower Meienreuss bridge a concrete
 * arch of 38.3 m with spandrel vaults; the Wattinger and Göschenen Reuss bridges steel; the
 * short ones granite arches. Piers stand on the real valley floor (Copernicus DEM).
 */
import { Group, Vector3, MeshStandardMaterial, Color, Matrix4, DoubleSide } from 'three';
import { Builder } from './geom.js';
import { RAIL_SPACING } from '../world/route.js';

function canvas(w, h) { return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }); }
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/** Dressed granite blocks (courses ~0.45 m), 1 texture = 2 m. */
async function graniteTexture() {
  const { CanvasTexture, RepeatWrapping, LinearMipmapLinearFilter } = await import('three');
  const W = 512, H = 512, c = canvas(W, H), g = c.getContext('2d'), r = rng(17);
  g.fillStyle = '#4a4744'; g.fillRect(0, 0, W, H);
  const course = H / 4.4;
  for (let row = 0, y = 0; y < H; row++, y += course) {
    let x = -(row % 2) * 60 - r() * 40;
    while (x < W) {
      const w = 70 + r() * 90;
      const shade = 70 + r() * 40;
      g.fillStyle = `rgb(${shade + 6},${shade + 3},${shade})`;
      g.fillRect(x + 2, y + 2, w - 4, course - 4);
      // speckle (feldspar and mica)
      for (let k = 0; k < 40; k++) { g.fillStyle = r() < 0.5 ? 'rgba(20,20,20,0.35)' : 'rgba(220,215,205,0.3)'; g.fillRect(x + r() * w, y + r() * course, 2, 2); }
      x += w;
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping; t.minFilter = LinearMipmapLinearFilter; t.anisotropy = 8;
  return t;
}

let _mats = null;
async function materials() {
  if (_mats) return _mats;
  const g = await graniteTexture();
  _mats = {
    granite: new MeshStandardMaterial({ map: g, roughness: 0.9, side: DoubleSide }),
    vault: new MeshStandardMaterial({ map: g, color: new Color(0.55, 0.53, 0.5), roughness: 0.95, side: DoubleSide }),
    concrete: new MeshStandardMaterial({ color: new Color(0.42, 0.41, 0.39), roughness: 0.85, side: DoubleSide }),
    steel: new MeshStandardMaterial({ color: new Color(0.16, 0.2, 0.19), roughness: 0.55, metalness: 0.5, side: DoubleSide }),
    rail: new MeshStandardMaterial({ color: new Color(0.25, 0.26, 0.26), roughness: 0.5, metalness: 0.7 }),
    snow: new MeshStandardMaterial({ color: new Color(0.85, 0.87, 0.9), roughness: 0.7 }),
  };
  return _mats;
}

/** The type of each named bridge (and a rule for the rest). */
function bridgeType(b) {
  const n = (b.name ?? '').toLowerCase(), L = b.s1 - b.s0;
  if (n.includes('chärstelenbach')) return { type: 'composite', spans: 2 };
  if (b.km > 49.1 && b.km < 49.3) return { type: 'box', spans: 3, name: 'Intschireussbrücke' };
  if (n.includes('untere meienreuss')) return { type: 'arch', span: 38.3 };
  if (n.includes('wattinger') || n.includes('göschenerreuss') || n.includes('mittlere meienreuss') || n.includes('obere meienreuss') || n.includes('kellerbach')) return { type: 'truss', spans: L > 70 ? 2 : 1 };
  if (L < 22) return { type: 'stonearch', span: Math.max(4, L - 2) };
  return { type: 'composite', spans: Math.max(1, Math.round(L / 40)) };
}

export class Structures {
  static async create(stage, route, terrain, weather) {
    const s = new Structures(stage, route, terrain, weather);
    s.M = await materials();
    s._build();
    return s;
  }

  constructor(stage, route, terrain, weather) {
    this.stage = stage; this.route = route; this.T = terrain; this.weather = weather;
    this.group = new Group(); this.group.name = 'structures';
    stage.scene.add(this.group);
    this.items = [];
  }

  /** A frame on the double track at run chainage s: centre between the tracks, along, right, up. */
  _frame(s) {
    const R = this.route, line = R.run;
    const p = line.pos(s), h = line.headingAt(s);
    const right = { x: Math.cos(h), y: -Math.sin(h) };
    // the other main track lies to the right: centre the structure between them when it is near
    const q = R.right.locate(p.x, p.y, null, 0);
    const off = q.d < 6 ? q.d / 2 : 0;
    return { x: p.x + right.x * off, y: p.y + right.y * off, z: p.z, h, half: off, double: q.d < 6 };
  }

  _build() {
    const R = this.route;
    // tunnels
    for (const t of R.tunnels) {
      const g = this._tunnel(t);
      if (g) this.items.push(g);
    }
    // bridges (none inside a tunnel)
    for (const b of R.bridges) {
      if (R.tunnels.some((t) => b.s0 > t.s0 && b.s1 < t.s1)) continue;
      b.km = R.kmAt(b.s0);
      const g = this._bridge(b, bridgeType(b));
      if (g) this.items.push(g);
    }
    for (const it of this.items) { this.group.add(it.group); this.stage.anchor(it.group, it.anchor); }
  }

  // ---- tunnels ---------------------------------------------------------------------------------

  _tunnel(t) {
    const b = new Builder();
    const f0 = this._frame(t.s0);
    const anchor = { x: f0.x, y: f0.y, z: f0.z };
    const W = f0.double ? 4.3 : 2.4, H = W + 2.1;                  // half width, crown height over the rails
    const local = (f, a, u) => {
      // world point (anchor-relative) at across a (right +) and height u over the rail, in the frame f
      const rx = Math.cos(f.h), ry = -Math.sin(f.h);
      const x = f.x + rx * a - anchor.x, y = f.y + ry * a - anchor.y;
      return new Vector3(x, f.z + u - anchor.z, -y);
    };
    // the vault: a semicircle on side walls, extruded along the track (every 6 m)
    const prof = [];
    prof.push([W, -0.8], [W, H - W]);
    for (let i = 1; i < 12; i++) { const a = (i / 12) * Math.PI; prof.push([Math.cos(a) * W, H - W + Math.sin(a) * W]); }
    prof.push([-W, H - W], [-W, -0.8]);
    const len = t.s1 - t.s0, n = Math.max(2, Math.ceil(len / 6));
    const frames = [];
    for (let i = 0; i <= n; i++) frames.push(this._frame(t.s0 + (len * i) / n));
    for (let i = 0; i < n; i++) {
      for (let k = 0; k + 1 < prof.length; k++) {
        const [a0, u0] = prof[k], [a1, u1] = prof[k + 1];
        // the inside faces the track: wind so the normal points in
        b.quad('vault', local(frames[i], a0, u0), local(frames[i + 1], a0, u0), local(frames[i + 1], a1, u1), local(frames[i], a1, u1),
          [i * 6 / 2, k / 2, (i + 1) * 6 / 2, (k + 1) / 2]);
      }
    }
    // the portals at both ends: a granite face with the arch cut out, a cornice
    for (const [s, dir] of [[t.s0, -1], [t.s1, 1]]) {
      const f = this._frame(s);
      const fw = W + 3.2, top = H + 2.4;
      const face = [];
      // the face as a fan of quads between the opening's edge and the face's outline
      const open = [[W, -0.8], [W, H - W]];
      for (let i = 1; i < 12; i++) { const a = (i / 12) * Math.PI; open.push([Math.cos(a) * W, H - W + Math.sin(a) * W]); }
      open.push([-W, H - W], [-W, -0.8]);
      const outline = open.map(([a, u]) => {
        // matching point on the outer rectangle
        if (u < H - W) return [Math.sign(a) * fw, u];
        const ang = Math.atan2(u - (H - W), a);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const tx = Math.abs(ca) > 1e-3 ? fw / Math.abs(ca) : 1e9, ty = (top - (H - W)) / Math.max(1e-3, sa);
        const tt = Math.min(tx, ty);
        return [ca * tt, H - W + sa * tt];
      });
      void face;
      const nudge = dir * 0.02;
      const at = (a, u, d) => {
        const p = local(f, a, u);
        const tx = Math.sin(f.h), ty = Math.cos(f.h);
        return p.add(new Vector3(tx * d, 0, -ty * d));
      };
      for (let k = 0; k + 1 < open.length; k++) {
        const a = at(open[k][0], open[k][1], nudge), bq = at(open[k + 1][0], open[k + 1][1], nudge);
        const c = at(outline[k + 1][0], outline[k + 1][1], nudge), d = at(outline[k][0], outline[k][1], nudge);
        if (dir < 0) b.quad('granite', a, bq, c, d, [open[k][0] / 2, open[k][1] / 2, outline[k + 1][0] / 2, outline[k + 1][1] / 2]);
        else b.quad('granite', a, d, c, bq, [open[k][0] / 2, open[k][1] / 2, outline[k][0] / 2, outline[k][1] / 2]);
      }
      // the parapet/cornice on top, and wing walls back into the slope
      const depth = 1.4;
      const corner = (a, u, d) => at(a, u, nudge + dir * d);
      b.quad('granite', corner(-fw - 0.3, top, 0), corner(fw + 0.3, top, 0), corner(fw + 0.3, top + 0.6, 0), corner(-fw - 0.3, top + 0.6, 0), [0, 0, (2 * fw) / 2, 0.3]);
      b.quad('granite', corner(-fw - 0.3, top + 0.6, 0), corner(fw + 0.3, top + 0.6, 0), corner(fw + 0.3, top + 0.6, -depth), corner(-fw - 0.3, top + 0.6, -depth), [0, 0, fw, 0.7]);
      for (const sgn of [-1, 1]) {
        const a0 = sgn * fw;
        const wall = [corner(a0, -1.5, 0), corner(a0 + sgn * 3.5, -1.5, -dir * 5), corner(a0 + sgn * 3.5, top * 0.5, -dir * 5), corner(a0, top + 0.6, 0)];
        if ((sgn > 0) === (dir > 0)) b.quad('granite', wall[0], wall[1], wall[2], wall[3], [0, 0, 3, top / 2]); else b.quad('granite', wall[1], wall[0], wall[3], wall[2], [0, 0, 3, top / 2]);
      }
    }
    const group = b.build(this.M);
    group.name = `tunnel-${t.name ?? t.s0}`;
    return { group, anchor, kind: 'tunnel', t };
  }

  // ---- bridges ---------------------------------------------------------------------------------

  _bridge(br, ty) {
    const b = new Builder();
    const s0 = br.s0 - 2, s1 = br.s1 + 2;
    const f0 = this._frame(s0);
    const anchor = { x: f0.x, y: f0.y, z: f0.z };
    const T = this.T;
    const local = (f, a, u) => {
      const rx = Math.cos(f.h), ry = -Math.sin(f.h);
      return new Vector3(f.x + rx * a - anchor.x, f.z + u - anchor.z, -(f.y + ry * a - anchor.y));
    };
    const ground = (f, a) => { const rx = Math.cos(f.h), ry = -Math.sin(f.h); return T.demBicubic(f.x + rx * a, f.y + ry * a); };
    const W = f0.double ? 4.4 : 2.6;
    const len = s1 - s0, n = Math.max(2, Math.ceil(len / 4));
    const fr = [];
    for (let i = 0; i <= n; i++) fr.push(this._frame(s0 + (len * i) / n));
    const deckTop = -0.72, deckBot = ty.type === 'box' ? -3.4 : ty.type === 'composite' ? -2.9 : -1.6;
    // the deck slab (ballasted) with its edge beams, along the bridge
    const mat = ty.type === 'truss' ? 'steel' : ty.type === 'stonearch' ? 'granite' : 'concrete';
    for (let i = 0; i < n; i++) {
      const A = fr[i], B = fr[i + 1];
      b.quad(mat, local(A, -W, deckBot), local(B, -W, deckBot), local(B, W, deckBot), local(A, W, deckBot));                       // soffit (faces down)
      b.quad(mat, local(A, W, deckBot), local(B, W, deckBot), local(B, W, deckTop + 0.9), local(A, W, deckTop + 0.9), [i * 2, 0, i * 2 + 2, 2]);   // right side
      b.quad(mat, local(B, -W, deckBot), local(A, -W, deckBot), local(A, -W, deckTop + 0.9), local(B, -W, deckTop + 0.9), [i * 2, 0, i * 2 + 2, 2]);
      b.quad(mat, local(A, W - 0.25, deckTop + 0.9), local(B, W - 0.25, deckTop + 0.9), local(B, W, deckTop + 0.9), local(A, W, deckTop + 0.9));         // parapet tops
      b.quad(mat, local(A, -W, deckTop + 0.9), local(B, -W, deckTop + 0.9), local(B, -W + 0.25, deckTop + 0.9), local(A, -W + 0.25, deckTop + 0.9));
      // railings (steel) on top of the edge beams
      b.cylinder('rail', local(A, W - 0.1, deckTop + 1.9), local(B, W - 0.1, deckTop + 1.9), 0.03, 0.03, { segs: 5 });
      b.cylinder('rail', local(A, -W + 0.1, deckTop + 1.9), local(B, -W + 0.1, deckTop + 1.9), 0.03, 0.03, { segs: 5 });
      if (i % 1 === 0) for (const a of [W - 0.1, -W + 0.1]) b.cylinder('rail', local(A, a, deckTop + 0.9), local(A, a, deckTop + 1.9), 0.025, 0.025, { segs: 4 });
    }
    // piers / supports down to the valley floor
    const pierAt = (s, wide = 1) => {
      const f = this._frame(s);
      const g = Math.min(ground(f, -W), ground(f, 0), ground(f, W));
      const bottom = g - f.z - 2;
      if (bottom > deckBot - 0.5) return;
      const pm = ty.type === 'box' || ty.type === 'composite' || ty.type === 'truss' ? 'concrete' : 'granite';
      const pw = 1.4 * wide, pd = W * 0.85;
      if (ty.type === 'box') {
        for (const a of [-W * 0.5, W * 0.5]) this._prism(b, pm, local, f, a - 0.9, a + 0.9, -1.1, 1.1, bottom, deckBot);
      } else this._prism(b, pm, local, f, -pd, pd, -pw / 2, pw / 2, bottom, deckBot, ty.type === 'stonearch' || ty.type === 'arch' ? 0.03 : 0);
    };
    if (ty.type === 'arch' || ty.type === 'stonearch') {
      // the arch: a curved intrados under the deck, with spandrel walls
      const span = Math.min(len - 4, ty.span ?? len - 4), mid = (s0 + s1) / 2;
      const fM = this._frame(mid);
      const springing = Math.min(ground(fM, 0) - fM.z + 2, deckBot - Math.min(span * 0.35, 25));
      const rise = deckBot - 1.2 - springing;
      const m = 16;
      for (let i = 0; i < m; i++) {
        const t0 = i / m, t1 = (i + 1) / m;
        const sa = mid - span / 2 + span * t0, sb = mid - span / 2 + span * t1;
        const ya = springing + rise * Math.sin(Math.PI * t0), yb = springing + rise * Math.sin(Math.PI * t1);
        const A = this._frame(sa), B = this._frame(sb);
        b.quad('concrete', local(B, -W + 0.4, yb), local(A, -W + 0.4, ya), local(A, W - 0.4, ya), local(B, W - 0.4, yb));            // the soffit of the arch
        for (const [a, sgn] of [[W - 0.4, 1], [-W + 0.4, -1]]) {
          if (sgn > 0) b.quad(ty.type === 'stonearch' ? 'granite' : 'concrete', local(A, a, ya), local(B, a, yb), local(B, a, deckBot), local(A, a, deckBot));
          else b.quad(ty.type === 'stonearch' ? 'granite' : 'concrete', local(B, a, yb), local(A, a, ya), local(A, a, deckBot), local(B, a, deckBot));
        }
      }
      pierAt(mid - span / 2 - 1.5, 2); pierAt(mid + span / 2 + 1.5, 2);
    } else {
      const spans = ty.spans ?? 1;
      for (let k = 1; k < spans; k++) pierAt(s0 + 2 + (len - 4) * (k / spans));
      pierAt(s0 + 1.0, 1.4); pierAt(s1 - 1.0, 1.4);
      if (ty.type === 'truss') {
        // through trusses: top chords and diagonals along both sides of the deck
        const ht = Math.min(7, Math.max(4.5, len / 9));
        for (const a of [W - 0.1, -W + 0.1]) {
          for (let i = 0; i < n; i++) {
            const A = fr[i], B = fr[i + 1];
            b.cylinder('steel', local(A, a, deckTop + ht), local(B, a, deckTop + ht), 0.16, 0.16, { segs: 4 });
            b.cylinder('steel', local(A, a, deckBot + 0.3), local(B, a, deckTop + ht), 0.08, 0.08, { segs: 4 });
            b.cylinder('steel', local(A, a, deckTop + ht), local(B, a, deckBot + 0.3), 0.08, 0.08, { segs: 4 });
          }
          for (let i = 0; i <= n; i += 2) b.cylinder('steel', local(fr[i], a, deckBot + 0.3), local(fr[i], a, deckTop + ht), 0.1, 0.1, { segs: 4 });
        }
        for (let i = 0; i <= n; i += 2) b.cylinder('steel', local(fr[i], -W + 0.1, deckTop + ht), local(fr[i], W - 0.1, deckTop + ht), 0.08, 0.08, { segs: 4 });
      }
    }
    const group = b.build(this.M);
    group.name = `bridge-${br.name ?? br.s0}`;
    return { group, anchor, kind: 'bridge', br, ty };
  }

  /** A pier: a box in the frame f from across a0..a1, along l0..l1, height y0..y1 (batter: inward slope per metre). */
  _prism(b, mat, local, f, a0, a1, l0, l1, y0, y1, batter = 0) {
    const tx = Math.sin(f.h), ty = Math.cos(f.h);
    const P = (a, l, y) => {
      const k = batter * (y1 - y);
      const aa = a + (a > 0 ? k : -k), ll = l + (l > 0 ? k : -k);
      return local(f, aa, y).add(new Vector3(tx * ll, 0, -ty * ll));
    };
    const c = [[a0, l0], [a1, l0], [a1, l1], [a0, l1]];
    for (let i = 0; i < 4; i++) {
      const [aA, lA] = c[i], [aB, lB] = c[(i + 1) % 4];
      b.quad(mat, P(aA, lA, y0), P(aB, lB, y0), P(aB, lB, y1), P(aA, lA, y1), [0, y0 / 2, 1, y1 / 2]);
    }
  }
}
void Matrix4; void RAIL_SPACING;
