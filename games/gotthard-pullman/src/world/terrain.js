/**
 * The ground: the Copernicus GLO-30 heights of the Reuss valley (a 25 m grid baked by
 * tools/geodata/build.py), with the railway's formation carved into it.
 *
 * Two levels:
 *  - the coarse grid (25 m) over the whole 20 x 27 km map, for the mountains at distance;
 *  - fine tiles (1 km, 5 m grid) along the line, made when needed: the DEM interpolated
 *    bicubically, a little fractal detail (more on steep, rocky ground), and the formation
 *    cut in. The line is laid on a flat formation 0.72 m under the rail head (rail, sleeper
 *    and ballast), with cuttings (1:1.25 in soil, steep in rock) and embankments (2:3) out
 *    to the natural ground; where an embankment would run far down a steep hillside the
 *    builders put a dry-stone wall instead, and so does this (walls are kept for drawing).
 *    Nothing is carved over tunnels; under bridges the ground is only kept clear of the deck.
 *
 * Map coordinates: x east, y north, z up (m above sea level).
 */
import { extensionStructures } from './testline.js';
import TERRAIN from '../data/terrain.js';
import TERRAIN_FAR from '../data/terrain_far.js';
import LANDCOVER from '../data/landcover.js';
import { gunzipBase64 } from '../data/decode.js';

export const FINE_STEP = 5;          // m
export const FINE_TILE = 1000;       // m
export const FINE_N = FINE_TILE / FINE_STEP;   // cells per tile side
export const CARVE_RADIUS = 70;      // m: how far a cutting or embankment can reach from a track

const FORMATION = 0.72;              // rail head to formation top (UIC 60 rail 0.172, sleeper 0.22, ballast under the sleeper 0.30, pad)
const HALF_WIDTH = 3.6;              // m from a track's centre to the edge of its formation (ballast shoulder and cess)
const FILL_SLOPE = 2 / 3;            // embankment, rise over run
const CUT_SOIL = 0.8, CUT_ROCK = 3.0;
// the test tracks run in a valley carved for them (kind 3): its sides rise at 0.75 (about 37 degrees), reaching up to VALLEY m out
const VALLEY = 1000, VALLEY_SIDE = 0.75;
const WALL_SLOPE = 8;                // a dry-stone wall's batter (8:1)

// ---------------------------------------------------------------------------------------------
// deterministic noise (the same everywhere, every run)

function hash2(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
/** Ridged fractal, -0.5..0.5-ish, at a base wavelength (m). */
export function detailNoise(x, y, wavelength = 60, oct = 4) {
  let s = 0, a = 0.5, f = 1 / wavelength;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(vnoise(x * f + 17.3 * i, y * f - 9.1 * i) * 2 - 1);
    s += a * (n * n - 0.33);
    a *= 0.5; f *= 2.07;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------

function cubic(p0, p1, p2, p3, t) {
  // Catmull-Rom
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

export class Terrain {
  static async load(route) {
    const [dem, lc, far] = await Promise.all([gunzipBase64(TERRAIN.data, Uint16Array), gunzipBase64(LANDCOVER.data, Uint8Array), gunzipBase64(TERRAIN_FAR.data, Uint16Array)]);
    return new Terrain(route, dem, lc, far);
  }

  constructor(route, dem, lc, farDem) {
    // the far ring (100 m): only for the distant view and the long mountain shadows
    const F = TERRAIN_FAR;
    this.far = { x0: F.x0, y0: F.y0, step: F.step, w: F.w, h: F.h, H: new Float32Array(farDem.length) };
    for (let i = 0; i < farDem.length; i++) this.far.H[i] = farDem[i] / 10;
    this.route = route;
    const T = TERRAIN;
    this.x0 = T.x0; this.y0 = T.y0; this.step = T.step; this.w = T.w; this.h = T.h;
    this.x1 = this.x0 + (this.w - 1) * this.step; this.y1 = this.y0 + (this.h - 1) * this.step;
    this.dem = new Float32Array(dem.length);
    for (let i = 0; i < dem.length; i++) this.dem[i] = dem[i] / 10;
    // the test section's tunnels and viaducts, where it runs deep under the natural ground or high over it
    if (!route._testStructures) { route._testStructures = true; extensionStructures(route, (x, y) => this.demBicubic(x, y)); }
    this.lc = lc;
    this.lcX0 = LANDCOVER.x0; this.lcY0 = LANDCOVER.y0; this.lcStep = LANDCOVER.step; this.lcW = LANDCOVER.w; this.lcH = LANDCOVER.h;
    this._buildTrackSamples();
    this.walls = [];                 // dry-stone walls made by the carving: { x, y, z0, z1 } runs, by tile
    this.fine = new Map();           // "i,j" -> tile
    this.fineWanted = this._fineTileSet();
    // the coarse grid gets the formation too (seen from across the valley it still shows)
    this.H = this.dem.slice();
    this._carveGrid(this.H, this.x0, this.y0, this.step, this.w, this.h, (x, y, i) => this.dem[i]);
  }

  // ---- the tracks as carving samples ---------------------------------------------------------

  _buildTrackSamples() {
    const R = this.route;
    const S = [];   // flat array: x, y, zf, kind (0 ground, 1 bridge, 2 tunnel)
    const inRanges = (list, s) => list.some((t) => s >= t.s0 && s <= t.s1);
    // (the mountain's cover over a bore begins a grid step inside the portal: the cutting runs right
    // up to the portal's face, so the ground's coarse triangles do not climb through the trains there)
    const inBore = (list, s) => list.some((t) => s >= t.s0 + 7 && s <= t.s1 - 7);
    const runKind = (s) => (inBore(R.tunnels, s) ? 2 : inRanges(R.bridges, s) ? 1 : 0);
    const leftKind = (s) => (inBore(R.leftTunnels, s) ? 2 : inRanges(R.leftBridges, s) ? 1 : 0);
    // a track deep under the natural ground is in a tunnel whatever the map says
    const add = (x, y, z, kind) => { if (kind === 0 && this.demBicubic(x, y) - z > 28) kind = 2; S.push(x, y, z - FORMATION, kind); };
    const every = 4;
    const runEnd = R.testFrom ?? R.run.length;
    for (let s = 0; s <= runEnd; s += every) { const p = R.run.pos(s); add(p.x, p.y, p.z, runKind(s)); }
    // the test tracks: open, in their own valley (samples every 20 m: the valley is wide and smooth)
    if (R.testFrom != null) {
      S.push(NaN, NaN, NaN, NaN);
      for (let s = R.testFrom; s <= R.run.length; s += 20) { const p = R.run.pos(s); S.push(p.x, p.y, p.z - FORMATION, inRanges(R.bridges, s) ? 1 : 3); }
    }
    S.push(NaN, NaN, NaN, NaN);    // break: segments never join across tracks
    for (let s = 0; s <= R.left.length; s += every) { const p = R.left.pos(s); add(p.x, p.y, p.z, leftKind(s)); }
    S.push(NaN, NaN, NaN, NaN);
    // the other main line: its structures are the left line's (the Gotthard's tunnels and most bridges
    // carry both tracks); matched to the left line by position and height, so a track passing over
    // or under another in the loops is never taken for it
    const L = R.left;
    let guess = 0;
    for (let s = 0; s <= R.right.length; s += every) {
      const p = R.right.pos(s);
      let best = 1e30, bi = -1;
      const i0 = Math.max(0, Math.floor((guess - 300) / L.step)), i1 = Math.min(L.n - 1, Math.ceil((guess + 300) / L.step));
      for (let i = i0; i <= i1; i++) {
        if (Math.abs(L.z[i] - p.z) > 8) continue;
        const d = (L.x[i] - p.x) ** 2 + (L.y[i] - p.y) ** 2;
        if (d < best) { best = d; bi = i; }
      }
      if (bi < 0 || best > 30 * 30) {
        // lost: search the whole line once
        for (let i = 0; i < L.n; i++) {
          if (Math.abs(L.z[i] - p.z) > 8) continue;
          const d = (L.x[i] - p.x) ** 2 + (L.y[i] - p.y) ** 2;
          if (d < best) { best = d; bi = i; }
        }
      }
      const matched = bi >= 0 && best < 30 * 30;
      if (matched) guess = bi * L.step;
      add(p.x, p.y, p.z, matched ? leftKind(bi * L.step) : 0);
    }
    S.push(NaN, NaN, NaN, NaN);
    for (const y of R.yard ?? []) {
      const p = y.p;
      for (let k = 0; k + 5 < p.length; k += 3) {
        const x0 = p[k], y0 = p[k + 1], z0 = p[k + 2], x1 = p[k + 3], y1 = p[k + 4], z1 = p[k + 5];
        const Lk = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(Lk / every));
        for (let i = 0; i < n; i++) { const t = i / n; add(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, 0); }
      }
      add(p[p.length - 3], p[p.length - 2], p[p.length - 1], 0);
      S.push(NaN, NaN, NaN, NaN);
    }
    this.samples = new Float64Array(S);
    // a spatial hash of the segments (64 m cells)
    const cell = 64, grid = new Map();
    const n = this.samples.length / 4;
    for (let k = 0; k + 1 < n; k++) {
      const a = k * 4, b = a + 4;
      if (Number.isNaN(this.samples[a]) || Number.isNaN(this.samples[b])) continue;
      const cx = Math.floor((this.samples[a] + this.samples[b]) / 2 / cell), cy = Math.floor((this.samples[a + 1] + this.samples[b + 1]) / 2 / cell);
      const key = cx * 100003 + cy;
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push(k);
    }
    this.segCell = cell; this.segGrid = grid;
  }

  /** Segment indices whose midpoints lie in cells overlapping the box. */
  _segmentsIn(xa, ya, xb, yb) {
    const c = this.segCell, out = [];
    for (let cx = Math.floor(xa / c) - 1; cx <= Math.floor(xb / c) + 1; cx++) {
      for (let cy = Math.floor(ya / c) - 1; cy <= Math.floor(yb / c) + 1; cy++) {
        const l = this.segGrid.get(cx * 100003 + cy);
        if (l) for (const k of l) out.push(k);
      }
    }
    return out;
  }

  /**
   * Carves the formation into a grid of heights. natural(x, y, index) gives the uncarved height.
   * Each track segment pushes a lower bound (embankment) and an upper bound (cutting) onto the
   * grid points around it; the ground is the natural height clamped between them.
   */
  _carveGrid(H, gx0, gy0, step, nw, nh, natural, wallsOut = null, tunnelOut = null) {
    const S = this.samples;
    const xa = gx0 - VALLEY, ya = gy0 - VALLEY, xb = gx0 + (nw - 1) * step + VALLEY, yb = gy0 + (nh - 1) * step + VALLEY;
    const segs = this._segmentsIn(xa, ya, xb, yb);
    if (!segs.length) return;
    const N = nw * nh;
    const lower = new Float32Array(N).fill(-1e9), upper = new Float32Array(N).fill(1e9);
    const nearD = new Float32Array(N).fill(1e9), nearZ = new Float32Array(N);
    const openD = new Float32Array(N).fill(1e9), tunD = new Float32Array(N).fill(1e9), openZ = new Float32Array(N), vNear = new Uint8Array(N);
    // the ground is a grid of this step, flat between its points: a cutting's side may only begin a
    // whole step (and a diagonal's worth) beyond the formation's edge, or the triangles that span it
    // would rise into the space the trains run in (the loading gauge, 2.2 m from the track's centre)
    const clearEdge = HALF_WIDTH + step * 1.42;
    const touched = new Uint8Array(N);
    for (const k of segs) {
      const a = k * 4, b = a + 4;
      const kind = Math.max(S[a + 3], S[b + 3]);
      const inTunnel = kind === 2 && S[a + 3] === 2 && S[b + 3] === 2;
      // inside a tunnel the mountain stays; where the DEM (30 m, smoothing steep slopes) has too little
      // rock over the bore, it gets at least the vault plus 1.5 m, falling away at 1:1 to the sides
      const ax = S[a], ay = S[a + 1], bx = S[b], by = S[b + 1], az = S[a + 2], bz = S[b + 2];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const valley = S[a + 3] === 3 || S[b + 3] === 3, RAD = valley ? VALLEY : CARVE_RADIUS;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - RAD - gx0) / step)), i1 = Math.min(nw - 1, Math.ceil((Math.max(ax, bx) + RAD - gx0) / step));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - RAD - gy0) / step)), j1 = Math.min(nh - 1, Math.ceil((Math.max(ay, by) + RAD - gy0) / step));
      for (let j = j0; j <= j1; j++) {
        const y = gy0 + j * step;
        for (let i = i0; i <= i1; i++) {
          const x = gx0 + i * step;
          let t = ((x - ax) * dx + (y - ay) * dy) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + dx * t - x, py = ay + dy * t - y;
          const d = Math.sqrt(px * px + py * py);
          if (d > RAD) continue;
          const zf = az + (bz - az) * t;
          const idx = j * nw + i;
          if (valley) {
            // the test tracks' valley: the ground no higher than its sides; banked up close by where the line is high
            const u = zf + Math.max(0, d - clearEdge) * VALLEY_SIDE;
            if (u < upper[idx]) upper[idx] = u;
            if (d < CARVE_RADIUS) { const lo = zf - Math.max(0, d - HALF_WIDTH) * FILL_SLOPE; if (lo > lower[idx]) lower[idx] = lo; }
            touched[idx] = 1; vNear[idx] = 1;
            if (d < nearD[idx]) { nearD[idx] = d; nearZ[idx] = zf; }
            continue;
          }
          if (inTunnel) {
            if (d < tunD[idx]) tunD[idx] = d;
            if (tunnelOut && d < 6.0) tunnelOut[idx] = Math.max(tunnelOut[idx], zf + FORMATION);
            const cover = zf + FORMATION + 8.2 - Math.max(0, d - 5) * 1.0;
            if (cover > lower[idx]) { lower[idx] = cover; touched[idx] = 1; if (d < nearD[idx]) { nearD[idx] = d; nearZ[idx] = cover; } }
            continue;
          }
          const e = Math.max(0, d - HALF_WIDTH), ec = Math.max(0, d - clearEdge);
          touched[idx] = 1;
          if (d < nearD[idx]) { nearD[idx] = d; nearZ[idx] = zf; }
          if (d < openD[idx]) { openD[idx] = d; openZ[idx] = zf; }
          if (kind === 1) {
            // a bridge: keep the ground under the deck (no embankment)
            const u = zf - 2.5 + ec * CUT_SOIL;
            if (u < upper[idx]) upper[idx] = u;
            continue;
          }
          const lo = zf - e * FILL_SLOPE, up = zf + ec * CUT_SOIL;
          if (lo > lower[idx]) lower[idx] = lo;
          if (up < upper[idx]) upper[idx] = up;
        }
      }
    }
    for (let j = 0; j < nh; j++) {
      for (let i = 0; i < nw; i++) {
        const idx = j * nw + i;
        if (!touched[idx]) continue;
        const x = gx0 + i * step, y = gy0 + j * step;
        const hn = natural(x, y, idx);
        let lo = lower[idx], up = upper[idx];
        // a tunnel's cover against an open track's cutting: the nearer track has it (an open line
        // beside a portal must not run into the mountain kept over the other bore)
        if (lo > up) { if (vNear[idx] || openD[idx] <= tunD[idx] + 4) lo = up; else up = lo; }   // (the test tracks' valley takes precedence)
        // rock: steep natural ground takes a steep cutting
        if (hn > up && up < 1e8) {
          const slope = this._naturalSlope(x, y);
          if (slope > 0.75 && openD[idx] < 1e8 && !vNear[idx]) {
            const e = Math.max(0, openD[idx] - clearEdge);
            up = Math.min(hn, openZ[idx] + e * CUT_ROCK);            // (a steep rock face, not a soil slope)
          }
        }
        // a long fill down a steep hillside: a wall instead
        if (hn < lo && lo > -1e8) {
          // (the wall's foot one grid step out, so the grid's triangles do not round the formation edge down)
          const e = Math.max(0, nearD[idx] - HALF_WIDTH - step);
          const fillAtToe = nearZ[idx] - hn;
          if (fillAtToe > 4 && this._naturalSlope(x, y) > 0.55) {
            lo = nearZ[idx] - e * WALL_SLOPE;
            if (wallsOut && e < 1.5 * step && e > 0) wallsOut.push(x, y, Math.max(hn, lo), nearZ[idx]);
          }
        }
        H[idx] = hn < lo ? lo : hn > up ? up : hn;
      }
    }
  }

  // ---- queries on the DEM ----------------------------------------------------------------------

  _demAt(i, j) {
    i = i < 0 ? 0 : i >= this.w ? this.w - 1 : i;
    j = j < 0 ? 0 : j >= this.h ? this.h - 1 : j;
    return this.dem[j * this.w + i];
  }

  /** The DEM, bicubic. */
  demBicubic(x, y) {
    const fx = (x - this.x0) / this.step, fy = (y - this.y0) / this.step;
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const r = [];
    for (let m = -1; m <= 2; m++) r.push(cubic(this._demAt(i - 1, j + m), this._demAt(i, j + m), this._demAt(i + 1, j + m), this._demAt(i + 2, j + m), tx));
    return cubic(r[0], r[1], r[2], r[3], ty);
  }

  /** Steepness of the natural ground (rise over run), from the DEM's own gradient, bilinear. */
  _naturalSlope(x, y) {
    if (!this.slope) {
      const w = this.w, h = this.h, S = (this.slope = new Float32Array(w * h));
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const gx = (this._demAt(i + 1, j) - this._demAt(i - 1, j)) / (2 * this.step);
        const gy = (this._demAt(i, j + 1) - this._demAt(i, j - 1)) / (2 * this.step);
        S[j * w + i] = Math.hypot(gx, gy);
      }
    }
    const fx = Math.min(this.w - 1.001, Math.max(0, (x - this.x0) / this.step)), fy = Math.min(this.h - 1.001, Math.max(0, (y - this.y0) / this.step));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, w = this.w, k = j * w + i, S = this.slope;
    return (S[k] * (1 - tx) + S[k + 1] * tx) * (1 - ty) + (S[k + w] * (1 - tx) + S[k + w + 1] * tx) * ty;
  }

  /** The natural ground with the fine detail (no carving). */
  natural(x, y) {
    const h = this.demBicubic(x, y);
    const sl = Math.min(1.5, this._naturalSlope(x, y));
    // rough rock on the steep, gentle swells on the meadows
    const amp = 0.6 + sl * 3.2;
    return h + amp * detailNoise(x, y, 45, 4) + 0.35 * detailNoise(x + 500, y - 300, 11, 2);
  }

  /** Coarse grid height (bilinear, carved). */
  coarseAt(x, y) {
    const fx = Math.min(this.w - 1.001, Math.max(0, (x - this.x0) / this.step)), fy = Math.min(this.h - 1.001, Math.max(0, (y - this.y0) / this.step));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const H = this.H, w = this.w, k = j * w + i;
    return (H[k] * (1 - tx) + H[k + 1] * tx) * (1 - ty) + (H[k + w] * (1 - tx) + H[k + w + 1] * tx) * ty;
  }

  /** Far ring height (bilinear), for anything off the map. */
  farAt(x, y) {
    const F = this.far;
    const fx = Math.min(F.w - 1.001, Math.max(0, (x - F.x0) / F.step)), fy = Math.min(F.h - 1.001, Math.max(0, (y - F.y0) / F.step));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, H = F.H, w = F.w, k = j * w + i;
    return (H[k] * (1 - tx) + H[k + 1] * tx) * (1 - ty) + (H[k + w] * (1 - tx) + H[k + w + 1] * tx) * ty;
  }

  inMap(x, y) { return x >= this.x0 && x <= this.x1 && y >= this.y0 && y <= this.y1; }

  /** Ground height: from a fine tile where there is one, else the coarse grid. */
  heightAt(x, y) {
    if (!this.inMap(x, y)) return this.farAt(x, y);
    const ti = Math.floor((x - this.x0) / FINE_TILE), tj = Math.floor((y - this.y0) / FINE_TILE);
    const t = this.fine.get(`${ti},${tj}`);
    if (!t) return this.coarseAt(x, y);
    const fx = (x - t.x0) / FINE_STEP, fy = (y - t.y0) / FINE_STEP;
    const i = Math.min(FINE_N - 1, Math.max(0, Math.floor(fx))), j = Math.min(FINE_N - 1, Math.max(0, Math.floor(fy)));
    // the tile's grid has a one-sample border all round (for normals at the edges)
    const tx = fx - i, ty = fy - j, n = FINE_N + 3, H = t.H, k = (j + 1) * n + (i + 1);
    // the same triangle split the renderer uses (diagonal from (i,j) to (i+1,j+1))
    if (tx >= ty) return H[k] + (H[k + 1] - H[k]) * tx + (H[k + n + 1] - H[k + 1]) * ty;
    return H[k] + (H[k + n] - H[k]) * ty + (H[k + n + 1] - H[k + n]) * tx;
  }

  /** ESA WorldCover class at a point (nearest 20 m cell). */
  coverAt(x, y) {
    const i = Math.round((x - this.lcX0) / this.lcStep), j = Math.round((y - this.lcY0) / this.lcStep);
    if (i < 0 || j < 0 || i >= this.lcW || j >= this.lcH) return 0;
    return this.lc[j * this.lcW + i];
  }

  // ---- fine tiles ------------------------------------------------------------------------------

  /** Tiles within reach of any track. */
  _fineTileSet() {
    const set = new Set(), S = this.samples;
    for (let k = 0; k < S.length; k += 4) {
      if (Number.isNaN(S[k])) continue;
      const reach = (S[k + 3] === 3 ? VALLEY : CARVE_RADIUS) + 120;
      for (const ox of [-reach, -reach / 2, 0, reach / 2, reach]) for (const oy of [-reach, -reach / 2, 0, reach / 2, reach]) {
        const ti = Math.floor((S[k] + ox - this.x0) / FINE_TILE), tj = Math.floor((S[k + 1] + oy - this.y0) / FINE_TILE);
        if (ti >= 0 && tj >= 0 && ti < Math.floor((this.x1 - this.x0) / FINE_TILE) && tj < Math.floor((this.y1 - this.y0) / FINE_TILE)) set.add(`${ti},${tj}`);
      }
    }
    return set;
  }

  hasFine(ti, tj) { return this.fineWanted.has(`${ti},${tj}`); }

  /** Makes (or returns) the fine tile (ti, tj): heights on a (FINE_N+1)^2 grid. */
  fineTile(ti, tj) {
    const key = `${ti},${tj}`;
    let t = this.fine.get(key);
    if (t) return t;
    // (FINE_N + 1)^2 samples plus a one-sample border, starting one step outside the tile
    const x0 = this.x0 + ti * FINE_TILE, y0 = this.y0 + tj * FINE_TILE, n = FINE_N + 3;
    const bx = x0 - FINE_STEP, by = y0 - FINE_STEP;
    const H = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) H[j * n + i] = this.natural(bx + i * FINE_STEP, by + j * FINE_STEP);
    const walls = [];
    const tun = new Float32Array(n * n).fill(-1e4);
    this._carveGrid(H, bx, by, FINE_STEP, n, n, (x, y, idx) => H[idx], walls, tun);
    // Where the neighbouring tile is never fine (no track near it), the edge takes the coarse
    // surface exactly and the last rings blend toward it, so the coarse chunk meets it without a
    // step. Between two fine tiles nothing is needed: both compute the same heights on the edge.
    const blend = 8;
    const coarseEdge = [!this.hasFine(ti - 1, tj), !this.hasFine(ti + 1, tj), !this.hasFine(ti, tj - 1), !this.hasFine(ti, tj + 1)];
    if (coarseEdge.some(Boolean)) {
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        let e = 1e9;
        if (coarseEdge[0]) e = Math.min(e, i);
        if (coarseEdge[1]) e = Math.min(e, n - 1 - i);
        if (coarseEdge[2]) e = Math.min(e, j);
        if (coarseEdge[3]) e = Math.min(e, n - 1 - j);
        if (e > blend) continue;
        const w = Math.max(0, e - 1) / (blend + 1);
        H[j * n + i] = H[j * n + i] * w + this.coarseAt(bx + i * FINE_STEP, by + j * FINE_STEP) * (1 - w);
      }
    }
    t = { ti, tj, x0, y0, n, H, walls, tunnel: tun, version: 1 };
    this.fine.set(key, t);
    return t;
  }
}
