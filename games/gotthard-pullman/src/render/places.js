/**
 * The villages, roads and waters along the line, from OpenStreetMap (via Overture Maps):
 * every building footprint stood up (its height from OSM where mapped, else its floors or its
 * kind), with the low gable roofs of the canton, plaster or dark timber walls, shuttered
 * windows, and the snow lying on the roofs; the roads draped on the ground (the A2 motorway,
 * the Gotthardstrasse, village streets), ploughed black between snow banks; the Reuss and its
 * side streams; the platforms at Erstfeld and Göschenen (55 cm, the Swiss standard height).
 *
 * Built once at load into merged meshes, one group per 1 km tile, shown within ~5 km.
 */
import { Group, Vector3, Vector2, ShapeUtils, MeshStandardMaterial, Color, CanvasTexture, RepeatWrapping, LinearMipmapLinearFilter } from 'three';
import { Builder } from './geom.js';
import PLACES from '../data/places.js';

const TILE = 1000, SHOW = 5200;

function canvas(w, h) { return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }); }
function hash(n) { let h = Math.imul(n | 0, 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; return (h >>> 0) / 4294967296; }
function tex(c) { const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.minFilter = LinearMipmapLinearFilter; t.anisotropy = 8; return t; }

/** A plastered facade: one bay (1.3 m) by one storey (2.8 m) with a window, its frame and shutters. */
function facadeTexture({ wall = '#d9d3c4', shutter = '#3f5a3a' } = {}) {
  const W = 128, H = 256, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = wall; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.04})`; g.fillRect(Math.random() * W, Math.random() * H, 3, 3); }
  const wx = 38, ww = 52, wy = 70, wh = 110;
  g.fillStyle = '#efece4'; g.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);                 // the frame
  g.fillStyle = '#1b2125'; g.fillRect(wx, wy, ww, wh);                                    // the glass
  g.fillStyle = '#e8e4da'; g.fillRect(wx + ww / 2 - 2, wy, 4, wh); g.fillRect(wx, wy + wh * 0.4, ww, 4);   // sash bars
  g.fillStyle = shutter; g.fillRect(wx - 26, wy - 4, 20, wh + 8); g.fillRect(wx + ww + 6, wy - 4, 20, wh + 8);   // shutters
  g.strokeStyle = 'rgba(0,0,0,0.25)'; for (let y = wy; y < wy + wh; y += 8) { g.beginPath(); g.moveTo(wx - 26, y); g.lineTo(wx - 6, y); g.moveTo(wx + ww + 6, y); g.lineTo(wx + ww + 26, y); g.stroke(); }
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(wx - 6, wy + wh + 5, ww + 12, 6);         // the sill's shadow
  return tex(c);
}
/** Dark weathered timber (horizontal boards) with small windows, for chalets and barns. */
function timberTexture() {
  const W = 128, H = 256, c = canvas(W, H), g = c.getContext('2d');
  for (let y = 0; y < H; y += 16) { const k = 40 + Math.random() * 18; g.fillStyle = `rgb(${k + 22},${k + 10},${k})`; g.fillRect(0, y, W, 15); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, y + 15, W, 1); }
  g.fillStyle = '#e4dccc'; g.fillRect(40, 80, 48, 72); g.fillStyle = '#161b1e'; g.fillRect(44, 84, 40, 64);
  g.fillStyle = '#e4dccc'; g.fillRect(62, 84, 4, 64); g.fillRect(44, 112, 40, 4);
  return tex(c);
}

let _mats = null;
function materials(weather) {
  if (_mats) return _mats;
  const p = weather.p;
  const snowy = (p.groundSnowValley ?? 0) > 0.03 || p.snowfall > 0;
  _mats = {
    plaster: new MeshStandardMaterial({ map: facadeTexture(), roughness: 0.92 }),
    plaster2: new MeshStandardMaterial({ map: facadeTexture({ wall: '#cfc6b2', shutter: '#6b3a2a' }), roughness: 0.92 }),
    plaster3: new MeshStandardMaterial({ map: facadeTexture({ wall: '#ece9e2', shutter: '#4c5d6b' }), roughness: 0.92 }),
    plaster4: new MeshStandardMaterial({ map: facadeTexture({ wall: '#d8c39a', shutter: '#3d5434' }), roughness: 0.92 }),
    timber: new MeshStandardMaterial({ map: timberTexture(), roughness: 0.9 }),
    stone: new MeshStandardMaterial({ color: new Color(0.3, 0.29, 0.27), roughness: 0.95 }),
    roof: new MeshStandardMaterial({ color: snowy ? new Color(0.83, 0.85, 0.89) : new Color(0.09, 0.09, 0.1), roughness: snowy ? 0.7 : 0.8 }),
    eaves: new MeshStandardMaterial({ color: new Color(0.12, 0.08, 0.05), roughness: 0.85 }),
    road: new MeshStandardMaterial({ color: p.rail === 'wet' || snowy ? new Color(0.045, 0.045, 0.05) : new Color(0.09, 0.09, 0.09), roughness: snowy ? 0.35 : 0.8 }),
    bank: new MeshStandardMaterial({ color: new Color(0.8, 0.82, 0.86), roughness: 0.75 }),
    water: new MeshStandardMaterial({ color: new Color(0.02, 0.035, 0.04), roughness: 0.06, metalness: 0.0 }),
    platform: new MeshStandardMaterial({ color: new Color(0.24, 0.24, 0.25), roughness: 0.8 }),
    edge: new MeshStandardMaterial({ color: new Color(0.85, 0.85, 0.82), roughness: 0.6 }),
  };
  return _mats;
}

/** Oriented bounding box of a polygon (rotating calipers over edge directions). */
function obb(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const L = Math.hypot(bx - ax, by - ay); if (L < 0.5) continue;
    const ux = (bx - ax) / L, uy = (by - ay) / L, vx = -uy, vy = ux;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, y] of pts) { const u = x * ux + y * uy, v = x * vx + y * vy; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uy, vx, vy, u0, u1, v0, v1 };
  }
  return best;
}
function polyArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; a += x0 * y1 - x1 * y0; } return a / 2; }

const STOREY = 2.8;
function heights(b, area) {
  if (b.h) return { eave: Math.max(2.5, b.h * 0.72), total: b.h };
  if (b.f) return { eave: b.f * STOREY + 0.6, total: null };
  const c = b.c ?? '';
  if (area < 22) return { eave: 2.5, total: null };
  if (/garage|carport|shed|hut|shelter|allotment|toilet|transformer/.test(c)) return { eave: 2.8, total: null };
  if (/barn|farm_aux|stable|cowshed/.test(c)) return { eave: 5.0, total: null };
  if (/apartments|hotel|terrace|commercial|office|school|retail|kindergarten/.test(c)) return { eave: 3 * STOREY + 0.6, total: null };
  if (/industrial|warehouse|hangar|service|sports/.test(c)) return { eave: 7.5, total: null };
  if (/church|chapel/.test(c)) return { eave: 9, total: null };
  if (/train_station|transportation/.test(c)) return { eave: 2 * STOREY + 1.2, total: null };
  return { eave: area > 180 ? 2 * STOREY + 0.8 : 2 * STOREY + 0.4, total: null };
}

export class Places {
  constructor(stage, terrain, route, weather) {
    this.stage = stage; this.T = terrain; this.route = route;
    this.M = materials(weather);
    this.group = new Group(); this.group.name = 'places';
    stage.scene.add(this.group);
    this.tiles = new Map();          // "i,j" -> { builder, anchor }
    const t0 = performance.now();
    this._buildings();
    this._roads();
    this._water();
    this._platforms();
    for (const [k, t] of this.tiles) {
      const g = t.b.build(this.M);
      g.name = `places-${k}`;
      this.group.add(g);
      this.stage.anchor(g, t.anchor);
      t.group = g;
      t.b = null;
    }
    this.buildMs = performance.now() - t0;
  }

  _tile(x, y) {
    const i = Math.floor(x / TILE), j = Math.floor(y / TILE), k = `${i},${j}`;
    let t = this.tiles.get(k);
    if (!t) this.tiles.set(k, (t = { b: new Builder(), anchor: { x: i * TILE, y: j * TILE, z: this.T.coarseAt(i * TILE + TILE / 2, j * TILE + TILE / 2) }, cx: i * TILE + TILE / 2, cy: j * TILE + TILE / 2 }));
    return t;
  }
  /** Map point to tile-local (x, height, -y). */
  _v(t, x, y, z) { return new Vector3(x - t.anchor.x, z - t.anchor.z, -(y - t.anchor.y)); }

  // ---- buildings -----------------------------------------------------------------------------

  _buildings() {
    const T = this.T;
    let id = 0;
    for (const b of PLACES.buildings) {
      id++;
      const pts = [];
      for (let i = 0; i < b.p.length; i += 2) pts.push([b.p[i], b.p[i + 1]]);
      if (pts.length > 2 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
      if (pts.length < 3) continue;
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      if (!T.inMap(cx, cy)) continue;
      const area = Math.abs(polyArea(pts));
      if (area < 6) continue;
      const box = obb(pts);
      const hs = heights(b, area);
      let gmin = 1e9, gmax = -1e9;
      for (const [x, y] of pts) { const g = T.heightAt(x, y); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); }
      const base = gmin - 0.4, eave = gmax + hs.eave;
      const t = this._tile(cx, cy);
      const c = b.c ?? '';
      const h1 = hash(id);
      const barn = /barn|farm_aux|stable|cowshed|hut|shed/.test(c);
      const wall = barn || (h1 < 0.28 && /house|detached|null|^$/.test(c) && area < 220) ? 'timber'
        : /church|chapel|train_station|bunker/.test(c) ? 'stone' : ['plaster', 'plaster2', 'plaster3', 'plaster4'][Math.floor(hash(id * 7 + 3) * 4)];
      // the Uri house: a log storey or two (Strickbau) on a whitewashed masonry ground floor; barns
      // on a low stone footing
      const socle = wall !== 'timber' ? null : barn ? { mat: 'stone', h: 0.8 } : { mat: hash(id * 5 + 1) < 0.5 ? 'plaster3' : 'plaster', h: STOREY - 0.2 };
      const rectish = box.area < area * 1.25 && pts.length <= 8;
      const flat = !rectish || /industrial|warehouse|hangar|sports|parking|bunker/.test(c) || area > 900;
      if (rectish) {
        // walls on the fitted rectangle (cleaner than a noisy outline), the gable along the long side
        const P = (u, v) => [box.ux * u + box.vx * v, box.uy * u + box.vy * v];
        const corners = [P(box.u0, box.v0), P(box.u1, box.v0), P(box.u1, box.v1), P(box.u0, box.v1)];
        this._walls(t, corners, base, eave, wall, socle && { ...socle, top: gmin + socle.h });
        if (flat) this._flatRoof(t, corners, eave);
        else this._gable(t, box, eave, hs.total ? gmax + hs.total : null, /barn|farm_aux|stable|cowshed/.test(c) ? 0.5 : 0.62, wall === 'stone' ? 'plaster3' : wall);
      } else {
        this._walls(t, pts, base, eave, wall, socle && { ...socle, top: gmin + socle.h });
        this._flatRoof(t, pts, eave);
      }
    }
  }

  /** The walls round an outline; socle: { mat, top } a different lower part (masonry under timber). */
  _walls(t, pts, base, top, mat, socle = null) {
    const b = t.b;
    // the outline, counter-clockwise (map) so the walls face out
    if (polyArea(pts) < 0) pts = pts.slice().reverse();
    const mid = socle ? Math.min(top - 1.0, Math.max(base + 0.3, socle.top)) : base;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const L = Math.hypot(bx - ax, by - ay);
      const u1 = L / 1.3, vm = (mid - base) / STOREY - 0.15, v1 = (top - base) / STOREY - 0.15;
      if (socle) b.quad(socle.mat, this._v(t, ax, ay, base), this._v(t, bx, by, base), this._v(t, bx, by, mid), this._v(t, ax, ay, mid), [0, -0.15, u1, vm]);
      b.quad(mat, this._v(t, ax, ay, mid), this._v(t, bx, by, mid), this._v(t, bx, by, top), this._v(t, ax, ay, top), [0, vm, u1, v1]);
    }
  }

  _flatRoof(t, pts, top) {
    const b = t.b;
    if (polyArea(pts) < 0) pts = pts.slice().reverse();
    // fan from the centroid (fine for the convex footprints most are)
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      b.tri('roof', this._v(t, cx, cy, top + 0.3), this._v(t, ax, ay, top + 0.3), this._v(t, bx, by, top + 0.3));
    }
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      b.quad('eaves', this._v(t, ax, ay, top), this._v(t, bx, by, top), this._v(t, bx, by, top + 0.3), this._v(t, ax, ay, top + 0.3));
    }
  }

  /** A gable roof over the fitted rectangle, ridge along its long axis, with overhanging eaves. */
  _gable(t, box, eave, ridgeTop, pitchTan, wall = 'plaster') {
    const b = t.b;
    let { ux, uy, vx, vy, u0, u1, v0, v1 } = box;
    if (v1 - v0 > u1 - u0) { [ux, uy, vx, vy] = [vx, vy, -ux, -uy]; [u0, u1, v0, v1] = [v0, v1, -box.u1, -box.u0]; }
    const o = 0.7, half = (v1 - v0) / 2 + o;
    const vm = (v0 + v1) / 2;
    const rise = ridgeTop ? Math.max(1.2, ridgeTop - eave) : Math.max(1.0, half * pitchTan);
    const P = (u, v, z) => this._v(t, ux * u + vx * v, uy * u + vy * v, z);
    const e = eave - o * pitchTan * 0.6;
    const A = P(u0 - o, vm - half, e), B = P(u1 + o, vm - half, e), C = P(u1 + o, vm, eave + rise), D = P(u0 - o, vm, eave + rise);
    const E = P(u0 - o, vm + half, e), F = P(u1 + o, vm + half, e);
    // the two slopes (snow lies on them), their thickness (eaves boards), the gable ends
    b.quad('roof', A, B, C, D); b.quad('roof', F, E, D, C);
    const th = 0.25, dn = (p) => p.clone().add(new Vector3(0, -th, 0));
    b.quad('eaves', dn(B), dn(A), A, B); b.quad('eaves', dn(E), dn(F), F, E);
    b.quad('eaves', dn(A), dn(D), D, A); b.quad('eaves', dn(D), dn(E), E, D);
    b.quad('eaves', dn(C), dn(B), B, C); b.quad('eaves', dn(F), dn(C), C, F);
    // gable walls (the triangles under the roof at both ends)
    for (const [uu, sgn] of [[u0, -1], [u1, 1]]) {
      const a = P(uu, v0, eave), c2 = P(uu, v1, eave), r = P(uu, vm, eave + rise - 0.05);
      if (sgn > 0) b.tri(wall, a, r, c2, [0, 0, 0.5, rise / STOREY, 1, 0]); else b.tri(wall, c2, r, a, [0, 0, 0.5, rise / STOREY, 1, 0]);
    }
    // a chimney through the roof, a little off the ridge
    if ((u1 - u0) > 6) {
      const uc = u0 + (u1 - u0) * (0.25 + 0.5 * hash(Math.round(u0 * 7 + v0 * 13))), vc = vm + 0.55, s = 0.28;
      const z0 = eave + rise * 0.45, z1 = eave + rise + 0.8;
      const c = [[uc - s, vc - s], [uc + s, vc - s], [uc + s, vc + s], [uc - s, vc + s]];
      for (let i = 0; i < 4; i++) {
        const [a1, b1] = c[i], [a2, b2] = c[(i + 1) % 4];
        b.quad('stone', P(a1, b1, z0), P(a2, b2, z0), P(a2, b2, z1), P(a1, b1, z1), [0, 0, 0.45, 1]);
      }
      b.quad('eaves', P(c[0][0], c[0][1], z1), P(c[1][0], c[1][1], z1), P(c[2][0], c[2][1], z1), P(c[3][0], c[3][1], z1));
    }
  }

  // ---- roads ---------------------------------------------------------------------------------

  _roads() {
    const T = this.T;
    const width = { motorway: 7.6, trunk: 7.5, primary: 7.0, secondary: 6.0, tertiary: 5.5, unclassified: 4.5, residential: 4.5, living_street: 4.0, service: 3.2 };
    for (const r of PLACES.roads) {
      const w = width[r.c];
      if (!w) continue;                                // farm tracks and paths lie under the snow
      if (r.f?.includes('is_tunnel')) continue;
      const bridge = r.f?.includes('is_bridge');
      const pts = [];
      for (let i = 0; i < r.p.length; i += 2) pts.push([r.p[i], r.p[i + 1]]);
      // resample every ~5 m
      const P = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 5));
        for (let k = 0; k < n; k++) P.push([ax + (bx - ax) * (k / n), ay + (by - ay) * (k / n)]);
      }
      P.push(pts.at(-1));
      if (P.length < 2 || !T.inMap(P[0][0], P[0][1])) continue;
      const z0b = T.heightAt(P[0][0], P[0][1]), z1b = T.heightAt(P.at(-1)[0], P.at(-1)[1]);
      const t = this._tile(P[Math.floor(P.length / 2)][0], P[Math.floor(P.length / 2)][1]);
      const b = t.b, half = w / 2;
      let prev = null;
      for (let i = 0; i < P.length; i++) {
        const [x, y] = P[i];
        const [nx, ny] = P[Math.min(P.length - 1, i + 1)], [px, py] = P[Math.max(0, i - 1)];
        let dx = nx - px, dy = ny - py; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
        const rx = dy, ry = -dx;
        const zc = bridge ? z0b + (z1b - z0b) * (i / (P.length - 1)) : null;
        const zl = zc ?? T.heightAt(x - rx * half, y - ry * half), zr = zc ?? T.heightAt(x + rx * half, y + ry * half);
        const cur = {
          l: this._v(t, x - rx * half, y - ry * half, zl + 0.12), r: this._v(t, x + rx * half, y + ry * half, zr + 0.12),
          bl: this._v(t, x - rx * (half + 1.4), y - ry * (half + 1.4), (zc ?? T.heightAt(x - rx * (half + 1.4), y - ry * (half + 1.4))) + 0.45),
          br: this._v(t, x + rx * (half + 1.4), y + ry * (half + 1.4), (zc ?? T.heightAt(x + rx * (half + 1.4), y + ry * (half + 1.4))) + 0.45),
        };
        if (prev) {
          b.quad('road', prev.l, prev.r, cur.r, cur.l);
          b.quad('bank', prev.bl, prev.l, cur.l, cur.bl);
          b.quad('bank', prev.r, prev.br, cur.br, cur.r);
        }
        prev = cur;
      }
    }
  }

  // ---- water ---------------------------------------------------------------------------------

  _water() {
    const T = this.T;
    // the rivers' real banks where the map has them (riverbank areas): the ribbon down a river's
    // centre line takes its width, each side separately, from the banks either side of it
    const banks = [];
    for (const w of PLACES.water) {
      if (w.t !== 'area' || !/river/.test(w.s ?? w.c ?? '')) continue;
      const q = [];
      for (let i = 0; i < w.p.length; i += 2) q.push([w.p[i], w.p[i + 1]]);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [x, y] of q) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      banks.push({ q, x0, y0, x1, y1 });
    }
    const inside = (q, x, y) => { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const [xi, yi] = q[i], [xj, yj] = q[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    // the distance from (x, y) along (dx, dy) to the polygon's edge
    const reach = (q, x, y, dx, dy) => {
      let best = 1e9;
      for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
        const [ax, ay] = q[j], [bx, by] = q[i], ex = bx - ax, ey = by - ay;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - x) * ey - (ay - y) * ex) / den, u = ((ax - x) * dy - (ay - y) * dx) / den;
        if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
      }
      return best;
    };
    // the water's reach either side of the centre line: December's low water fills only part of the
    // bed between the banks, most of the canalised channel below Amsteg, under half of the boulder
    // bed above it (the rest lies under snow); where the map has no banks, the given half width
    const widthAt = (x, y, rx, ry, half) => {
      for (const B of banks) {
        if (x < B.x0 || x > B.x1 || y < B.y0 || y > B.y1 || !inside(B.q, x, y)) continue;
        const f = 0.6 - 0.15 * Math.min(1, Math.max(0, (T.heightAt(x, y) - 540) / 80));
        return [Math.min(60, reach(B.q, x, y, -rx, -ry)) * f, Math.min(60, reach(B.q, x, y, rx, ry)) * f].map((v) => Math.max(2, v));
      }
      return [half, half];
    };
    for (const w of PLACES.water) {
      if (w.t !== 'line' || !/river|stream|canal/.test(w.s ?? w.c ?? '')) continue;
      const big = /river/.test(w.s ?? '') ;
      // where the map has no banks: the Reuss above Amsteg is a mountain torrent some 12 m across
      const half = big ? (/Reuss/.test(w.n ?? '') ? 6 : 4) : 1.4;
      const pts = [];
      for (let i = 0; i < w.p.length; i += 2) pts.push([w.p[i], w.p[i + 1]]);
      if (pts.length < 2 || !T.inMap(pts[0][0], pts[0][1])) continue;
      const P = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 8));
        for (let k = 0; k < n; k++) P.push([ax + (bx - ax) * (k / n), ay + (by - ay) * (k / n)]);
      }
      const t = this._tile(P[Math.floor(P.length / 2)][0], P[Math.floor(P.length / 2)][1]);
      // the cross-sections: the direction across, the reach to each bank (smoothed along the river)
      const X = P.map(([x, y], i) => {
        const [nx, ny] = P[Math.min(P.length - 1, i + 1)], [px, py] = P[Math.max(0, i - 1)];
        let dx = nx - px, dy = ny - py; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
        const rx = dy, ry = -dx;
        const [wl, wr] = big ? widthAt(x, y, rx, ry, half) : [half, half];
        return { x, y, rx, ry, wl, wr };
      });
      for (let i = 0; i < X.length; i++) {
        let l = 0, r = 0, n = 0;
        for (let k = Math.max(0, i - 2); k <= Math.min(X.length - 1, i + 2); k++) { l += X[k].wl; r += X[k].wr; n++; }
        X[i].l = l / n; X[i].r = r / n;
      }
      let prev = null;
      for (const { x, y, rx, ry, l, r } of X) {
        // the water lies in the lowest of the ground across the channel
        const z = Math.min(T.heightAt(x, y), T.heightAt(x - rx * l, y - ry * l), T.heightAt(x + rx * r, y + ry * r)) + 0.25;
        const cur = { l: this._v(t, x - rx * l, y - ry * l, z), r: this._v(t, x + rx * r, y + ry * r, z) };
        if (prev) t.b.quad('water', prev.l, prev.r, cur.r, cur.l);
        prev = cur;
      }
    }
  }

  // ---- platforms ------------------------------------------------------------------------------

  _platforms() {
    const R = this.route;
    // A platform's edge stands 1.65 m from the track's centre on the straight, more in curves,
    // where a car's middle swings in and its ends out over the curve's chord (the 45/R widening),
    // and its top 55 cm over the rail all along, rising and falling with the track. The mapped
    // outlines are not that exact, and a train must not run through one: the outline is cut
    // into short pieces and every point nearer a track than that is moved back from it.
    const clear = (x, y) => {
      for (const line of [R.run, R.right]) {
        const q = line.locate(x, y, null, 1e9), P = line.pos(q.s), h = line.headingAt(q.s);
        const rx = Math.cos(h), ry = -Math.sin(h);
        const off = (x - P.x) * rx + (y - P.y) * ry, along = (x - P.x) * Math.sin(h) + (y - P.y) * Math.cos(h);
        const need = 1.65 + 45 * Math.abs(line.curvatureAt(q.s));
        if (Math.abs(off) < need && Math.abs(along) < 2) { const t = (off >= 0 ? need : -need) - off; x += rx * t; y += ry * t; }
      }
      return [x, y];
    };
    const dense = (xy) => {
      const out = [];
      for (let i = 0; i < xy.length; i++) {
        const [ax, ay] = xy[i], [bx, by] = xy[(i + 1) % xy.length], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5));
        for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
      }
      return out;
    };
    for (const p of R.platforms) {
      let xy = p.xy.slice();
      if (xy.length > 2 && xy[0][0] === xy.at(-1)[0] && xy[0][1] === xy.at(-1)[1]) xy.pop();
      const pts = dense(xy).map(([x, y]) => clear(x, y));
      if (pts.length < 3) continue;
      if (polyArea(pts) < 0) pts.reverse();
      const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length, cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
      let hint = R.run.locate(cx, cy).s;
      const top = pts.map(([x, y]) => { const q = R.run.locate(x, y, hint, 400); hint = q.s; return R.run.pos(q.s).z + 0.55; });
      const t = this._tile(cx, cy), b = t.b;
      // the walls: the platform's edge and ends, down into the ground
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length, [ax, ay] = pts[i], [bx, by] = pts[j];
        b.quad('platform', this._v(t, ax, ay, top[i] - 1.4), this._v(t, bx, by, top[j] - 1.4), this._v(t, bx, by, top[j]), this._v(t, ax, ay, top[i]));
      }
      // the top, triangulated properly (a platform along a curve is not convex)
      const tris = ShapeUtils.triangulateShape(pts.map(([x, y]) => new Vector2(x, y)), []);
      for (let [i, j, k] of tris) {
        const [ax, ay] = pts[i], [bx, by] = pts[j], [cx2, cy2] = pts[k];
        if ((bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax) < 0) [j, k] = [k, j];      // (counter-clockwise from above: facing up)
        b.tri('platform', this._v(t, pts[i][0], pts[i][1], top[i]), this._v(t, pts[j][0], pts[j][1], top[j]), this._v(t, pts[k][0], pts[k][1], top[k]));
      }
    }
  }

  /** Shows the tiles near the camera. */
  update(cameraWorld) {
    const cm = this.stage.toMap(cameraWorld);
    for (const t of this.tiles.values()) if (t.group) t.group.visible = Math.hypot(t.cx - cm.x, t.cy - cm.y) < SHOW;
  }
}
