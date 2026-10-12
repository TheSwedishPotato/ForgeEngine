/**
 * The ground on the Med Engine: drawn by our own programs through the engine's custom-draw
 * hook (userData.forgeDraw), into its G-buffer and its shadow cascades.
 *
 * Three levels, each a set of square chunks whose heights the vertex shader reads from a
 * float texture (one shared grid mesh per level of detail):
 *   far    100 m samples, 4 km chunks, the ring round the map (cut away where the map is)
 *   map     25 m samples, 1 km chunks, the 20 x 27 km valley
 *   fine     5 m samples, 250 m chunks, the 1 km tiles along the line (carved formation)
 * Each chunk picks the coarsest grid whose height error stays under ~1.5 pixels on screen
 * (errors precomputed per chunk); skirts hide the cracks between neighbours.
 *
 * The material is procedural: snow where it lies (by slope, altitude and the weather's
 * depth), granite and gneiss where it is too steep for snow, the dark speckle of snowy
 * spruce forest at distance (near the line the forest is real trees), frozen meadows,
 * water. Every input is real: the DEM, the ESA WorldCover classes, the weather.
 */
import { Object3D, Box3, Vector3 } from 'three';
import { Program, Texture } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';
import { FINE_N, FINE_STEP, FINE_TILE } from '../world/terrain.js';

const VS = /* glsl */`
layout(location = 0) in vec3 aGrid;          // i, j, skirt
uniform highp sampler2D uHeight;
uniform ivec2 uTexel0;                        // texel of the chunk's corner
uniform int uStride;
uniform ivec2 uTexMax;
uniform float uCell;                          // metres per texel
uniform vec3 uAnchor;                         // world position of texel uTexel0 (floating origin), its height left at 0
uniform vec2 uMap0;                           // map coordinates of texel uTexel0
uniform float uSkirt;
uniform float uOriginZ;                       // height of the floating origin
uniform mat4 uViewProj, uViewProjFlat, uPrevViewProj;
out vec3 vWorld; out vec3 vNormal; out vec2 vMap; out float vHeight; out vec4 vCur; out vec4 vPrev;
float H(ivec2 t) { return texelFetch(uHeight, clamp(t, ivec2(0), uTexMax), 0).r; }
void main() {
  ivec2 g = ivec2(aGrid.xy) * uStride;
  ivec2 t = uTexel0 + g;
  float h = H(t);
  int s = max(uStride, 1);
  float hx = (H(t + ivec2(s, 0)) - H(t - ivec2(s, 0))) / (2.0 * uCell * float(s));
  float hy = (H(t + ivec2(0, s)) - H(t - ivec2(0, s))) / (2.0 * uCell * float(s));
  vec2 local = vec2(g) * uCell;
  vMap = uMap0 + local;
  vHeight = h;
  vec3 w = uAnchor + vec3(local.x, h - uOriginZ - aGrid.z * uSkirt, -local.y);
  vWorld = w;
  vNormal = normalize(vec3(-hx, 1.0, hy));
  vCur = uViewProjFlat * vec4(w, 1.0);
  vPrev = uPrevViewProj * vec4(w, 1.0);
  gl_Position = uViewProj * vec4(w, 1.0);
}`;

const MATERIAL_GLSL = /* glsl */`
uniform highp sampler2D uCover;      // ESA WorldCover classes (r8, nearest)
uniform vec4 uCoverRect;              // x0, y0, step, -
uniform ivec2 uCoverSize;
uniform vec4 uSnow;                   // depth in the valley (m), depth up high (m), fresh (0..1), rime (0..1)
uniform vec4 uGround;                 // wet (0..1), tree distance (m), -, -
uniform vec3 uCamMap;                 // camera in map coordinates (x, y, height)
uniform int uLevel;                   // 0 fine, 1 map, 2 far
uniform vec4 uMapRect;                // the map's extent (for the far ring's cut)

float coverIs(float cls, ivec2 c) {
  c = clamp(c, ivec2(0), uCoverSize - 1);
  return abs(texelFetch(uCover, c, 0).r * 255.0 - cls) < 0.5 ? 1.0 : 0.0;
}
// bilinear weight of one land-cover class at a map point
float cover(float cls, vec2 m) {
  vec2 f = (m - uCoverRect.xy) / uCoverRect.z - 0.5;
  ivec2 i = ivec2(floor(f)); vec2 t = fract(f);
  return mix(mix(coverIs(cls, i), coverIs(cls, i + ivec2(1, 0)), t.x), mix(coverIs(cls, i + ivec2(0, 1)), coverIs(cls, i + ivec2(1, 1)), t.x), t.y);
}
// value noise with its gradient (for detail normals)
vec3 noised(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y,
              du * vec2(b - a + (a - b - c + d) * u.y, c - a + (a - b - c + d) * u.x));
}
vec3 fbmd(vec2 p, int oct) {
  vec3 s = vec3(0.0); float a = 0.5, f = 1.0;
  for (int i = 0; i < 6; i++) { if (i >= oct) break; vec3 n = noised(p * f + float(i) * 13.7); s += a * vec3(n.x, n.yz * f); a *= 0.5; f *= 2.03; }
  return s;
}

void terrainMaterial(vec3 Ng, vec2 m, float h, float dist, out vec3 albedo, out vec3 N, out float rough) {
  // land cover
  float forest = cover(10.0, m);
  float water = cover(80.0, m);
  float bare = cover(60.0, m) + cover(70.0, m);
  float built = cover(50.0, m);
  // detail: big lumps (10-40 m), small (1-3 m), fine grain
  float fade = 1.0 - smoothstep(60.0, 900.0, dist);
  vec3 big = fbmd(m / 31.0, 4);
  vec3 small = fbmd(m / 2.7, 3) * fade;
  float steep = 1.0 - Ng.y;                         // 0 level, 0.5 at 60 degrees
  float rockiness = clamp(smoothstep(0.30, 0.48, steep + (big.x - 0.5) * 0.18) + bare * 0.6, 0.0, 1.0);
  // ---- snow: depth by altitude, held by slopes under ~50 degrees, blown off ridges
  float depth = mix(uSnow.x, uSnow.y, smoothstep(480.0, 1900.0, h));
  float holds = smoothstep(0.50, 0.30, steep + (big.x - 0.5) * 0.22 + (small.x - 0.5) * 0.10);
  float snow = clamp(depth * 9.0, 0.0, 1.0) * holds;
  // thin snow lies in patches; deep snow covers all but the steepest rock
  snow *= smoothstep(0.0, 0.35, depth * 3.0 + big.x - 0.55 + 0.35);
  snow *= 1.0 - water;
  // ---- colours (linear)
  vec3 granite = vec3(0.30, 0.295, 0.28) * (0.72 + 0.55 * big.x) * (0.85 + 0.3 * small.x);
  granite = mix(granite, vec3(0.20, 0.21, 0.17), smoothstep(0.55, 0.8, small.y * 0.5 + 0.5) * 0.35);   // lichen
  vec3 meadow = mix(vec3(0.20, 0.17, 0.09), vec3(0.15, 0.16, 0.08), big.x) * (0.8 + 0.4 * small.x);  // winter-brown grass
  meadow = mix(meadow, meadow * 0.55, uGround.x);                                                     // wet from the thaw
  vec3 litter = vec3(0.10, 0.075, 0.05) * (0.8 + 0.4 * small.x);                                       // spruce needles and earth
  vec3 ground = mix(meadow, litter, forest);
  ground = mix(ground, granite, rockiness);
  ground = mix(ground, vec3(0.16, 0.15, 0.14), built * 0.6);
  vec3 snowCol = vec3(0.86, 0.88, 0.92) * (0.93 + 0.07 * small.x);
  snowCol = mix(snowCol * 0.88, snowCol, uSnow.z);                                                    // fresh snow is whiter
  albedo = mix(ground, snowCol, snow);
  // ---- forest seen from afar (near the line the trees themselves stand there)
  float far = smoothstep(uGround.y * 0.8, uGround.y * 1.1, dist) + (uLevel == 2 ? 1.0 : 0.0);
  float canopy = forest * clamp(far, 0.0, 1.0);
  if (canopy > 0.001) {
    // crowns 6-9 m across: dark needles with snow caught on the branches, snow between
    vec2 cp = m / 7.5;
    float crown = smoothstep(0.38, 0.62, noised(cp).x * 0.65 + noised(cp * 2.1 + 5.0).x * 0.35);
    vec3 needles = vec3(0.035, 0.05, 0.035) * (0.8 + 0.4 * big.x);
    vec3 laden = mix(needles, snowCol * 0.75, clamp(uSnow.z * 0.55 + uSnow.w * 0.8, 0.0, 0.85) * (0.5 + 0.5 * small.x));
    vec3 forestFar = mix(albedo * 0.85, laden, crown * 0.85);
    albedo = mix(albedo, forestFar, canopy);
  }
  // ---- water: the Reuss runs dark and fast; still water freezes at the edges
  albedo = mix(albedo, vec3(0.025, 0.035, 0.04), water * (1.0 - snow));
  // ---- normal: detail bumps, gentle under snow, rough on rock
  float bump = mix(0.35, 0.9, rockiness) * (1.0 - snow * 0.7);
  vec2 grad = big.yz * (1.0 / 31.0) * 6.0 + small.yz * (1.0 / 2.7) * 0.6;
  N = normalize(Ng + vec3(-grad.x, 0.0, grad.y) * bump * fade);
  rough = mix(mix(0.92, 0.85, rockiness), 0.72, snow);
  rough = mix(rough, 0.12, water * (1.0 - snow));
}
`;

const GBUFFER_FS = /* glsl */`
${COMMON}
${MATERIAL_GLSL}
in vec3 vWorld; in vec3 vNormal; in vec2 vMap; in float vHeight; in vec4 vCur; in vec4 vPrev;
layout(location = 0) out vec4 g0; layout(location = 1) out vec4 g1; layout(location = 2) out vec4 g2; layout(location = 3) out vec4 g3;
void main() {
  if (uLevel == 2 && vMap.x > uMapRect.x && vMap.x < uMapRect.z && vMap.y > uMapRect.y && vMap.y < uMapRect.w) discard;
  vec3 Ng = normalize(vNormal);
  float dist = length(vec3(vMap.x - uCamMap.x, vHeight - uCamMap.z, vMap.y - uCamMap.y));
  vec3 albedo, N; float rough;
  terrainMaterial(Ng, vMap, vHeight, dist, albedo, N, rough);
  vec3 dndu = dFdx(N), dndv = dFdy(N);
  float variance = 0.25 * (dot(dndu, dndu) + dot(dndv, dndv));
  rough = clamp(sqrt(sqrt(min(pow(rough, 4.0) + min(2.0 * variance, 0.18), 1.0))), 0.03, 1.0);
  vec2 motion = (vCur.xy / vCur.w - vPrev.xy / vPrev.w) * 0.5;
  g0 = vec4(saturate(albedo), 1.0);
  g1 = vec4(encodeNormal(N), rough, 0.0);
  g2 = vec4(motion, 0.0, 0.0);
  g3 = vec4(0.0, 0.0, 0.0, 1.0);
}`;

const DEPTH_FS = /* glsl */`
in vec3 vWorld; in vec3 vNormal; in vec2 vMap; in float vHeight; in vec4 vCur; in vec4 vPrev;
uniform int uLevel; uniform vec4 uMapRect;
out vec4 o;
void main() {
  if (uLevel == 2 && vMap.x > uMapRect.x && vMap.x < uMapRect.z && vMap.y > uMapRect.y && vMap.y < uMapRect.w) discard;
  o = vec4(1.0);
}`;

/** A grid of n x n quads with a skirt round it. Vertex = (i, j, skirt). */
function makeGrid(gl, n) {
  const v = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) v.push(i, j, 0);
  const idx = [];
  const at = (i, j) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    idx.push(a, b, c, a, c, d);
  }
  // the boundary, counter-clockwise seen from above
  const ring = [];
  for (let i = 0; i < n; i++) ring.push([i, 0]);
  for (let j = 0; j < n; j++) ring.push([n, j]);
  for (let i = n; i > 0; i--) ring.push([i, n]);
  for (let j = n; j > 0; j--) ring.push([0, j]);
  const base = v.length / 3;
  for (const [i, j] of ring) v.push(i, j, 1);
  for (let k = 0; k < ring.length; k++) {
    const k2 = (k + 1) % ring.length;
    const a = at(...ring[k]), b = at(...ring[k2]), a2 = base + k, b2 = base + k2;
    idx.push(a, a2, b, b, a2, b2);
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  const big = v.length / 3 > 65535;
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(idx) : new Uint16Array(idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: idx.length, type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, n };
}

const _box = new Box3(), _v = new Vector3();

export class TerrainGL extends Object3D {
  /** stage: the GotthardStage (floating origin, weather); terrain: world/terrain.js */
  constructor(stage, terrain) {
    super();
    this.name = 'terrain';
    this.userData.forgeDraw = this;
    this.frustumCulled = false;
    this.castShadow = true;
    this.stage = stage;
    this.T = terrain;
    const r = stage.r, gl = r.gl;
    this.gl = gl;
    const T = terrain, F = T.far;
    this.mapTex = new Texture(gl, { width: T.w, height: T.h, format: 'r32f', filter: 'nearest', data: T.H });
    this.farTex = new Texture(gl, { width: F.w, height: F.h, format: 'r32f', filter: 'nearest', data: F.H });
    this.coverTex = new Texture(gl, { width: T.lcW, height: T.lcH, format: 'r8', filter: 'nearest', data: T.lc });
    this.programs = { gbuffer: new Program(gl, VS, GBUFFER_FS, {}, 'terrain-gbuffer'), depth: new Program(gl, VS, DEPTH_FS, {}, 'terrain-depth') };
    this.grids = {};
    for (const n of [40, 20, 10, 5, 50, 25]) this.grids[n] = makeGrid(gl, n);
    this.chunks = [];          // every drawable chunk (any level)
    this._buildMapChunks();
    this._buildFarChunks();
    this._buildFineChunks();
    this.drawList = [];
    this.frame = -1;
    this.stats = { chunks: 0, tris: 0 };
    this.snow = [0.15, 0.6, 0.5, 0.0];
    this.groundParams = [0, 900, 0, 0];
    this.fineDist = 2600;      // fine tiles drawn within this distance of the camera
  }

  // ---- chunk records -------------------------------------------------------------------------

  /** Max height error of drawing a block of the grid at a stride (bilinear on the coarser grid). */
  static _errors(get, i0, j0, n, strides) {
    const errs = [];
    for (const s of strides) {
      let e = 0;
      if (s > 1) for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const ci = Math.floor(i / s) * s, cj = Math.floor(j / s) * s;
        const ti = (i - ci) / s, tj = (j - cj) / s;
        const ci1 = Math.min(n, ci + s), cj1 = Math.min(n, cj + s);
        const a = get(i0 + ci, j0 + cj), b = get(i0 + ci1, j0 + cj), c = get(i0 + ci1, j0 + cj1), d = get(i0 + ci, j0 + cj1);
        const approx = ti >= tj ? a + (b - a) * ti + (c - b) * tj : a + (d - a) * tj + (c - d) * ti;
        e = Math.max(e, Math.abs(get(i0 + i, j0 + j) - approx));
      }
      errs.push(e);
    }
    return errs;
  }

  _buildMapChunks() {
    const T = this.T, n = 40;
    const get = (i, j) => T.H[Math.min(T.h - 1, j) * T.w + Math.min(T.w - 1, i)];
    this.mapChunks = [];
    for (let cj = 0; cj * n < T.h - 1; cj++) for (let ci = 0; ci * n < T.w - 1; ci++) {
      let lo = 1e9, hi = -1e9;
      for (let j = cj * n; j <= Math.min(T.h - 1, (cj + 1) * n); j++) for (let i = ci * n; i <= Math.min(T.w - 1, (ci + 1) * n); i++) { const h = get(i, j); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      const c = {
        level: 1, tex: this.mapTex, texel0: [ci * n, cj * n], texMax: [T.w - 1, T.h - 1], cell: T.step, n,
        map0: [T.x0 + ci * n * T.step, T.y0 + cj * n * T.step], size: n * T.step, lo, hi, skirt: 40,
        strides: [1, 2, 4, 8], errs: TerrainGL._errors(get, ci * n, cj * n, n, [1, 2, 4, 8]),
        tile: `${ci},${cj}`,
      };
      this.mapChunks.push(c);
    }
  }

  _buildFarChunks() {
    const F = this.T.far, n = 40;
    const get = (i, j) => F.H[Math.min(F.h - 1, j) * F.w + Math.min(F.w - 1, i)];
    const M = this.T;
    this.farChunks = [];
    for (let cj = 0; cj * n < F.h - 1; cj++) for (let ci = 0; ci * n < F.w - 1; ci++) {
      const x0 = F.x0 + ci * n * F.step, y0 = F.y0 + cj * n * F.step, x1 = x0 + n * F.step, y1 = y0 + n * F.step;
      if (x0 >= M.x0 && x1 <= M.x1 && y0 >= M.y0 && y1 <= M.y1) continue;    // wholly under the map
      let lo = 1e9, hi = -1e9;
      for (let j = cj * n; j <= Math.min(F.h - 1, (cj + 1) * n); j++) for (let i = ci * n; i <= Math.min(F.w - 1, (ci + 1) * n); i++) { const h = get(i, j); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      this.farChunks.push({
        level: 2, tex: this.farTex, texel0: [ci * n, cj * n], texMax: [F.w - 1, F.h - 1], cell: F.step, n,
        map0: [x0, y0], size: n * F.step, lo, hi, skirt: 120,
        strides: [1, 2, 4, 8], errs: TerrainGL._errors(get, ci * n, cj * n, n, [1, 2, 4, 8]),
      });
    }
  }

  _buildFineChunks() {
    const T = this.T, gl = this.gl;
    this.fineByTile = new Map();
    const N = FINE_N + 3, sub = 50, per = FINE_N / sub;       // 4 x 4 chunks of 250 m per tile
    for (const key of T.fineWanted) {
      const [ti, tj] = key.split(',').map(Number);
      const t = T.fineTile(ti, tj);
      const tex = new Texture(gl, { width: N, height: N, format: 'r32f', filter: 'nearest', data: t.H });
      const get = (i, j) => t.H[Math.min(N - 1, j) * N + Math.min(N - 1, i)];
      const list = [];
      for (let sj = 0; sj < per; sj++) for (let si = 0; si < per; si++) {
        const i0 = 1 + si * sub, j0 = 1 + sj * sub;
        let lo = 1e9, hi = -1e9;
        for (let j = j0; j <= j0 + sub; j++) for (let i = i0; i <= i0 + sub; i++) { const h = get(i, j); lo = Math.min(lo, h); hi = Math.max(hi, h); }
        list.push({
          level: 0, tex, texel0: [i0, j0], texMax: [N - 1, N - 1], cell: FINE_STEP, n: sub,
          map0: [t.x0 + si * sub * FINE_STEP, t.y0 + sj * sub * FINE_STEP], size: sub * FINE_STEP, lo, hi, skirt: 6,
          strides: [1, 2, 5], errs: TerrainGL._errors(get, i0, j0, sub, [1, 2, 5]),
        });
      }
      this.fineByTile.set(key, list);
    }
  }

  // ---- per frame ------------------------------------------------------------------------------

  _box(c, out) {
    const o = this.stage.origin;
    out.min.set(c.map0[0] - o.x, c.lo - o.z - c.skirt, -(c.map0[1] + c.size - o.y));
    out.max.set(c.map0[0] + c.size - o.x, c.hi - o.z, -(c.map0[1] - o.y));
    return out;
  }

  _select(r) {
    this.frame = r.frame;
    const cam = r.cameraPos, o = this.stage.origin;
    const cx = cam.x + o.x, cy = -cam.z + o.y, cz = cam.y + o.z;
    const pxPerRad = r.height * r.proj.elements[5] * 0.5;
    const tau = { ultra: 0.9, high: 1.3, medium: 2.0, low: 3.0 }[r.qualityName] ?? 1.3;
    const list = (this.drawList = []);
    const distTo = (c) => {
      const dx = Math.max(c.map0[0] - cx, 0, cx - (c.map0[0] + c.size));
      const dy = Math.max(c.map0[1] - cy, 0, cy - (c.map0[1] + c.size));
      const dz = Math.max(c.lo - cz, 0, cz - c.hi);
      return Math.hypot(dx, dy, dz);
    };
    const pick = (c) => {
      const d = Math.max(1, distTo(c));
      let k = 0;
      for (let i = c.strides.length - 1; i >= 0; i--) if ((c.errs[i] / d) * pxPerRad < tau) { k = i; break; }
      list.push({ c, stride: c.strides[k], grid: this.grids[c.n / c.strides[k]], d });
    };
    for (const c of this.mapChunks) {
      const fine = this.fineByTile.get(c.tile);
      if (fine && distTo(c) < this.fineDist) { for (const f of fine) pick(f); continue; }
      pick(c);
    }
    for (const c of this.farChunks) pick(c);
    this.camMap = [cx, cy, cz];
  }

  setWeather(weather) {
    const p = weather.p;
    this.snow = [p.groundSnowValley ?? 0.1, p.groundSnowHigh ?? 0.6, p.snowfall > 0 ? 1 : p.id === 'fog' ? 0.6 : 0.35, p.id === 'fog' ? 1 : 0];
    this.groundParams = [p.rail === 'wet' ? 1 : 0, 900, 0, 0];
  }

  draw(r, kind, vp, frustum, extra) {
    if (!this.visible) return;
    if (kind !== 'gbuffer' && kind !== 'depth') return;
    if (this.frame !== r.frame) this._select(r);
    const gl = this.gl, p = this.programs[kind];
    const o = this.stage.origin, T = this.T;
    p.use().set('uViewProj', vp).set('uViewProjFlat', kind === 'gbuffer' ? r.viewProj : vp).set('uPrevViewProj', kind === 'gbuffer' ? r.prevViewProj : vp)
      .set('uOriginZ', o.z).set('uMapRect', [T.x0, T.y0, T.x1, T.y1]);
    if (kind === 'gbuffer') {
      p.set('uCover', this.coverTex).set('uCoverRect', [T.lcX0, T.lcY0, T.lcStep, 0]).set('uCoverSize', [T.lcW, T.lcH])
        .set('uSnow', this.snow).set('uGround', this.groundParams).set('uCamMap', this.camMap);
    }
    if (extra) p.setAll(extra);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    if (kind === 'depth') gl.disable(gl.CULL_FACE);
    let n = 0, tris = 0, curTex = null, curLevel = -1;
    for (const it of this.drawList) {
      const c = it.c;
      if (frustum && !frustum.intersectsBox(this._box(c, _box))) continue;
      if (kind === 'depth' && c.level === 2) continue;           // the far ring never reaches the cascades
      if (c.tex !== curTex) { p.set('uHeight', c.tex).set('uTexMax', c.texMax).set('uCell', c.cell); curTex = c.tex; }
      if (c.level !== curLevel) { p.set('uLevel', c.level); curLevel = c.level; }
      p.set('uTexel0', c.texel0).set('uStride', it.stride).set('uSkirt', c.skirt)
        .set('uAnchor', [c.map0[0] - o.x, 0, -(c.map0[1] - o.y)]).set('uMap0', c.map0);
      const g = it.grid;
      gl.bindVertexArray(g.vao);
      gl.drawElements(gl.TRIANGLES, g.count, g.type, 0);
      n++; tris += g.count / 3;
    }
    gl.bindVertexArray(null);
    if (kind === 'gbuffer') { this.stats.chunks = n; this.stats.tris = tris; }
    r.stats.drawCalls += n;
    r.stats.triangles += tris;
  }
}
void _v; void FINE_TILE;
