/**
 * One vertex shader for every pass that rasterises scene geometry (G-buffer, shadow maps), with
 * skinning, instancing and morph targets selected by defines; and the G-buffer / depth fragment shaders.
 *
 * Bind groups: 0 Frame (dynamic) | 1 Material (dynamic uniform + 4 textures + sampler) |
 *              2 Object (dynamic uniform) | 3 Resources (storage: bones, instances, morph deltas)
 *
 * G-buffer targets:
 *   0 (rgba8 sRGB)  base colour, specular scale
 *   1 (rgba16f)     octahedral normal, roughness, metallic
 *   2 (rgba16f)     motion vector (uv/frame), material type, material parameter
 *   3 (rgba16f)     emitted radiance
 */
import { struct } from '../../gpu/wgsl.js';
import { Frame, COMMON_WGSL } from './common.js';

export const ObjectU = struct('Obj', [
  ['model', 'mat4x4f'], ['prevModel', 'mat4x4f'], ['normalMat', 'mat3x3f'],
  ['bind', 'mat4x4f'], ['bindInv', 'mat4x4f'],
  ['morphN', 'u32'], ['morphSlots', 'u32'], ['instances', 'u32'], ['_p', 'u32'],
  ['morphIdx', 'vec4i', 4], ['morphW', 'vec4f', 4], ['morphPW', 'vec4f', 4],
]);

export const MaterialU = struct('Mtl', [
  ['baseColor', 'vec4f'],      // rgb, opacity
  ['emissive', 'vec4f'],       // rgb * intensity, unlit flag
  ['params', 'vec4f'],         // roughness, metalness, material type, type parameter
  ['params2', 'vec4f'],        // specular, alpha test, wet factor, ambient-occlusion map strength
  ['detail', 'vec3f'], ['_p0', 'f32'],   // micro detail: uv frequency, normal strength, roughness variation
  ['normalScale', 'vec2f'], ['_p1', 'vec2f'],
  ['mapT', 'mat3x3f'], ['normalT', 'mat3x3f'], ['roughT', 'mat3x3f'],
]);

export const MATERIAL_TYPES = { default: 0, skin: 1, coat: 2, cloth: 3, foliage: 4, eye: 5, hair: 6, batsuit: 7, water: 8 };

export const HEADER = /* wgsl */`
${Frame.wgsl}
${ObjectU.wgsl}
${MaterialU.wgsl}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> mtl: Mtl;
@group(1) @binding(1) var matMap: texture_2d<f32>;
@group(1) @binding(2) var matNormal: texture_2d<f32>;
@group(1) @binding(3) var matRough: texture_2d<f32>;
@group(1) @binding(4) var matEmissive: texture_2d<f32>;
@group(1) @binding(5) var matSamp: sampler;
@group(2) @binding(0) var<uniform> obj: Obj;
@group(3) @binding(0) var<storage, read> bonesCur: array<mat4x4f>;
@group(3) @binding(1) var<storage, read> bonesPrev: array<mat4x4f>;
@group(3) @binding(2) var<storage, read> instCur: array<mat4x4f>;
@group(3) @binding(3) var<storage, read> instPrev: array<mat4x4f>;
@group(3) @binding(4) var<storage, read> instColor: array<vec4f>;
@group(3) @binding(5) var<storage, read> morphData: array<vec2<u32>>;
`;

export const GEOMETRY_WGSL = /* wgsl */`
${HEADER}
${COMMON_WGSL}

struct VIn {
  @builtin(instance_index) iid: u32,
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
#ifdef HAS_UV
  @location(2) uv: vec2f,
#endif
#ifdef SKINNED
  @location(3) skinIndex: vec4u,
  @location(4) skinWeight: vec4f,
#endif
#ifdef HAS_COLOR
  @location(5) color: vec4f,
#endif
#ifdef MORPH
  @location(6) morphSlot: f32,
#endif
}

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) color: vec4f,
#ifdef GBUFFER
  @location(4) cur: vec4f,
  @location(5) prev: vec4f,
#endif
}

#ifdef SKINNED
fn skinMatCur(i: vec4u, w: vec4f) -> mat4x4f {
  return obj.bindInv * (bonesCur[i.x] * w.x + bonesCur[i.y] * w.y + bonesCur[i.z] * w.z + bonesCur[i.w] * w.w) * obj.bind;
}
fn skinMatPrev(i: vec4u, w: vec4f) -> mat4x4f {
  return obj.bindInv * (bonesPrev[i.x] * w.x + bonesPrev[i.y] * w.y + bonesPrev[i.z] * w.z + bonesPrev[i.w] * w.w) * obj.bind;
}
#endif
#ifdef MORPH
fn morphFetch(unit: i32, slot: i32) -> vec3f {
  let t = morphData[u32(unit) * obj.morphSlots + u32(slot)];
  return vec3f(unpack2x16float(t.x), unpack2x16float(t.y).x);
}
#endif
fn cofactor3(m: mat3x3f) -> mat3x3f { return mat3x3f(cross(m[1], m[2]), cross(m[2], m[0]), cross(m[0], m[1])); }

@vertex fn vs(in: VIn) -> VOut {
  var p = vec4f(in.position, 1.0);
  var pp = p;
  var n = in.normal;
#ifdef MORPH
  if (in.morphSlot >= 0.0) {
    let slot = i32(in.morphSlot + 0.5);
    var d = vec3f(0.0);
    var dp = vec3f(0.0);
    for (var k = 0u; k < 16u; k++) {
      if (k >= obj.morphN) { break; }
      let m = morphFetch(obj.morphIdx[k >> 2u][k & 3u], slot);
      d += m * obj.morphW[k >> 2u][k & 3u];
      dp += m * obj.morphPW[k >> 2u][k & 3u];
    }
    p = vec4f(p.xyz + d, 1.0);
    pp = vec4f(pp.xyz + dp, 1.0);
  }
#endif
  var model = obj.model;
  var prevModel = obj.prevModel;
#ifdef SKINNED
  let sk = skinMatCur(in.skinIndex, in.skinWeight);
  pp = skinMatPrev(in.skinIndex, in.skinWeight) * pp;
  p = sk * p;
  n = mat3x3f(sk[0].xyz, sk[1].xyz, sk[2].xyz) * n;
#endif
#ifdef INSTANCED
  model = obj.model * instCur[in.iid];
  prevModel = obj.prevModel * instPrev[in.iid];
  let nm = cofactor3(mat3x3f(model[0].xyz, model[1].xyz, model[2].xyz));
#else
  let nm = obj.normalMat;
#endif
  let w = model * p;
  var o: VOut;
  o.world = w.xyz;
  o.normal = normalize(nm * n);
#ifdef HAS_UV
  o.uv = in.uv;
#else
  o.uv = vec2f(0.0);
#endif
#ifdef HAS_COLOR
  var col = in.color;
#else
  var col = vec4f(1.0);
#endif
#ifdef INSTANCE_COLOR
  col = vec4f(col.rgb * instColor[in.iid].rgb, col.a);
#endif
  o.color = col;
  o.pos = frame.viewProj * w;
#ifdef GBUFFER
  o.cur = frame.viewProjFlat * w;
  o.prev = frame.prevViewProj * (prevModel * pp);
#endif
  return o;
}

// ---------------------------------------------------------------------------
// Rain on surfaces: wet darkening of porous materials, glossier surfaces, puddles with expanding
// raindrop ripples on level ground, water running down walls (driven by frame.wetness / frame.rain).
fn rippleLayer(p: vec2f, t: f32, seed: f32) -> vec2f {
  let cell = floor(p); let f = fract(p);
  var g = vec2f(0.0);
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let c = cell + vec2f(f32(i), f32(j));
    let h = hash22(c + seed);
    let centre = vec2f(f32(i), f32(j)) + h * 0.8 + 0.1;
    let start = hash12(c * 1.7 + seed);
    let age = fract(t * 0.9 + start);
    let d = f - centre;
    let r = length(d);
    let ring = age * 1.1;
    let x = (r - ring) * 18.0;
    let w = exp(-x * x) * (1.0 - age) * (1.0 - age);
    g += d / max(r, 1e-3) * sin(x * 3.0) * w;
  } }
  return g;
}
fn ripples(p: vec2f, t: f32) -> vec2f { return (rippleLayer(p * 3.1, t, 0.0) + rippleLayer(p * 4.3 + 7.0, t * 1.13, 3.0) * 0.7) * frame.rain; }
fn puddleMask(p: vec2f) -> f32 {
  let n = fbm2(p * 0.35, 4) * 0.7 + fbm2(p * 1.7, 3) * 0.3;
  return smoothstep(0.52, 0.6, n + frame.wetness * 0.12 - 0.08);
}

// Normal mapping without tangents: a cotangent frame from screen-space derivatives (Schueler 2013).
fn cotangentFrame(N: vec3f, dp1: vec3f, dp2: vec3f, duv1: vec2f, duv2: vec2f) -> mat3x3f {
  let dp2perp = cross(dp2, N);
  let dp1perp = cross(N, dp1);
  let T = dp2perp * duv1.x + dp1perp * duv2.x;
  let B = dp2perp * duv1.y + dp1perp * duv2.y;
  let invmax = inverseSqrt(max(dot(T, T), dot(B, B)) + 1e-12);
  return mat3x3f(T * invmax, B * invmax, N);
}

struct GOut {
  @location(0) g0: vec4f,
  @location(1) g1: vec4f,
  @location(2) g2: vec4f,
  @location(3) g3: vec4f,
}

#ifdef GBUFFER
@fragment fn fs(in: VOut, @builtin(front_facing) front: bool) -> GOut {
  // screen-space derivatives first, in uniform control flow
  let dp1 = dpdx(in.world); let dp2 = dpdy(in.world);
  let duv1 = dpdx(in.uv); let duv2 = dpdy(in.uv);
  let uvMap = (mtl.mapT * vec3f(in.uv, 1.0)).xy;
  var base = vec4f(mtl.baseColor.rgb * in.color.rgb, mtl.baseColor.a * in.color.a);
#if USE_MAP && !BATSUIT
  base = base * textureSample(matMap, matSamp, uvMap);
#endif
  let alphaTest = mtl.params2.y;
#ifdef ALPHA_DITHER
  // hair cards and lashes: stochastic transparency, resolved by the temporal filter
  let thr = mix(alphaTest * 0.45, 0.9, ign(in.pos.xy, frame.frame));
  if (base.a < thr) { discard; }
#elif defined(TRANSPARENT)
  if (base.a < ign(in.pos.xy, frame.frame)) { discard; }
#elif defined(ALPHA_TEST)
  if (base.a < alphaTest) { discard; }
#endif
#ifdef FLAT
  let fn0 = cross(dp1, dp2);
  var N = select(normalize(in.normal + vec3f(0.0, 1e-6, 0.0)), normalize(fn0), dot(fn0, fn0) > 1e-24);
#else
  var N = normalize(in.normal + vec3f(0.0, 1e-9, 0.0));
#endif
#if DOUBLE_SIDED || BACK_SIDE
  if (!front) { N = -N; }
#endif
  let Ng = N;
  var rough = mtl.params.x;
  var metal = mtl.params.y;
  var occlusion = 1.0;
#ifdef USE_NORMALMAP
  let uvN = (mtl.normalT * vec3f(in.uv, 1.0)).xy;
  var mapN = textureSample(matNormal, matSamp, uvN).xyz * 2.0 - 1.0;
  mapN = vec3f(mapN.xy * mtl.normalScale, mapN.z);
  N = normalize(cotangentFrame(N, dp1, dp2, duv1, duv2) * normalize(mapN));
#endif
#ifdef DETAIL
  {
    // micro detail in uv space: skin pores and fine lines, leather grain, fabric weave; faded with
    // distance (it would only alias far away)
    let dist = length(frame.cameraPos - in.world);
    let k = 1.0 - smoothstep(0.8, 4.0, dist);
    if (k > 0.0) {
      let q = in.uv * mtl.detail.x;
      let e = 0.35;
      let h0 = vnoise(q); let hx = vnoise(q + vec2f(e, 0.0)); let hy = vnoise(q + vec2f(0.0, e));
      let q2 = q * 2.9;
      let n0 = vnoise(q2); let nx = vnoise(q2 + vec2f(e, 0.0)); let ny = vnoise(q2 + vec2f(0.0, e));
      let bump = vec3f(((h0 - hx) * 0.65 + (n0 - nx) * 0.35) * mtl.detail.y, ((h0 - hy) * 0.65 + (n0 - ny) * 0.35) * mtl.detail.y, 1.0);
      N = normalize(cotangentFrame(N, dp1, dp2, duv1, duv2) * normalize(mix(vec3f(0.0, 0.0, 1.0), bump, k)));
      rough = clamp(rough + (h0 - 0.5) * mtl.detail.z * 2.0 * k, 0.04, 1.0);
    }
  }
#endif
#ifdef BATSUIT
  {
    // The suit: the source garment's colour regions become raised armour panels (bump from
    // luminance), over a fine ballistic weave.
    let px = vec2f(1.0 / 1024.0);
    let hC = luma(textureSample(matMap, matSamp, uvMap).rgb);
    let hX = luma(textureSample(matMap, matSamp, uvMap + vec2f(px.x, 0.0)).rgb);
    let hY = luma(textureSample(matMap, matSamp, uvMap + vec2f(0.0, px.y)).rgb);
    let weaveUv = in.uv * vec2f(520.0, 520.0);
    let wx = sin(weaveUv.x * 6.2831) * 0.5 + 0.5; let wy = sin(weaveUv.y * 6.2831) * 0.5 + 0.5;
    let weave = mix(wx, wy, step(0.5, fract(floor(weaveUv.x) * 0.5 + floor(weaveUv.y) * 0.5)));
    let bump = vec3f((hC - hX) * 6.0 + (wx - 0.5) * 0.12, (hC - hY) * 6.0 + (wy - 0.5) * 0.12, 1.0);
    N = normalize(cotangentFrame(N, dp1, dp2, duv1, duv2) * normalize(bump));
    let panel = smoothstep(0.08, 0.22, hC);
    base = vec4f(mix(vec3f(0.028, 0.029, 0.033), vec3f(0.055, 0.056, 0.062), panel) * (0.92 + weave * 0.16), base.a);
    rough = mix(0.62, 0.38, panel);
  }
#endif
#ifdef USE_ROUGHMAP
  // glTF packs occlusion / roughness / metalness into the red / green / blue channels of one texture
  let orm = textureSample(matRough, matSamp, (mtl.roughT * vec3f(in.uv, 1.0)).xy);
  rough = rough * orm.g;
#ifdef METAL_FROM_ROUGHMAP
  metal = metal * orm.b;
#endif
#ifdef AO_FROM_ROUGHMAP
  occlusion = mix(1.0, orm.r, mtl.params2.w);
#endif
#endif
#ifdef WET_SURFACE
  let wet = frame.wetness * mtl.params2.z;
  if (wet > 0.001) {
    let up = saturate(Ng.y);
    // porous things darken when wet; everything gets a film of water (Lagarde 2013)
    let porosity = saturate((rough - 0.3) * 1.6) * (1.0 - metal);
    base = vec4f(base.rgb * mix(1.0, mix(1.0, 0.45, porosity), wet), base.a);
    rough = mix(rough, mix(0.32, 0.1, up), wet * mix(0.55, 0.95, up));
#ifdef PUDDLES
    let pm = puddleMask(in.world.xz) * smoothstep(0.85, 0.97, Ng.y) * wet;
    if (pm > 0.0) {
      let rp = ripples(in.world.xz, frame.time);
      let pn = normalize(vec3f(-rp.x * 0.5, 1.0, -rp.y * 0.5));
      N = normalize(mix(N, pn, pm));
      rough = mix(rough, 0.015, pm);
      base = vec4f(base.rgb * mix(1.0, 0.75, pm), base.a);
    } else if (frame.rain > 0.0 && Ng.y > 0.85) {
      let rp = ripples(in.world.xz, frame.time) * 0.25 * wet;
      N = normalize(N + vec3f(-rp.x, 0.0, -rp.y));
    }
#endif
#ifdef RAIN_STREAKS
    let side = 1.0 - abs(Ng.y);
    if (side > 0.5 && frame.rain > 0.0) {
      let sp = vec2f(dot(in.world.xz, vec2f(0.7, 0.7)) * 9.0, in.world.y * 1.5 + frame.time * 1.6);
      let col = floor(sp.x);
      let r = hash12(vec2f(col, 3.1));
      let flow = smoothstep(0.6, 1.0, sin(sp.y * (1.0 + r) + r * 40.0)) * step(0.55, r);
      N = normalize(N + cross(Ng, vec3f(0.0, 1.0, 0.0)) * (fract(sp.x) - 0.5) * flow * 0.6);
      rough = mix(rough, 0.05, flow * wet);
    }
#endif
  }
#endif
  // Specular anti-aliasing: widen the lobe where the normal changes faster than a pixel can resolve
  // (Tokuyoshi & Kaplanyan 2019).
  let dndu = dpdx(N); let dndv = dpdy(N);
  let variance = 0.25 * (dot(dndu, dndu) + dot(dndv, dndv));
  let a2 = rough * rough * rough * rough;
  rough = clamp(sqrt(sqrt(min(a2 + min(2.0 * variance, 0.18), 1.0))), 0.015, 1.0);

  var emissive = mtl.emissive.rgb;
#ifdef USE_EMISSIVEMAP
  emissive = emissive * textureSample(matEmissive, matSamp, uvMap).rgb;
#endif
#ifdef UNLIT
  emissive = base.rgb;
  base = vec4f(0.0, 0.0, 0.0, base.a);
#endif
  let cur = in.cur.xy / in.cur.w;
  let prev = in.prev.xy / max(abs(in.prev.w), 1e-6);
  let motion = (cur - prev) * vec2f(0.5, -0.5);   // uv units, y down
  var o: GOut;
  o.g0 = vec4f(saturate(base.rgb), mtl.params2.x);
  o.g1 = vec4f(encodeNormal(N), rough, metal);
  o.g2 = vec4f(motion, mtl.params.z, mtl.params.w);
  o.g3 = vec4f(emissive, occlusion);          // alpha: baked ambient occlusion (1 = open)
  return o;
}
#else
// depth-only: only compiled when the material needs a coverage test (alpha test / dither / transparency)
@fragment fn fs(in: VOut) {
  let uvMap = (mtl.mapT * vec3f(in.uv, 1.0)).xy;
  var a = mtl.baseColor.a * in.color.a;
#ifdef USE_MAP
  a = a * textureSample(matMap, matSamp, uvMap).a;
#endif
#ifdef ALPHA_DITHER
  if (a < mix(mtl.params2.y * 0.45, 0.9, hash12(in.pos.xy))) { discard; }
#elif defined(TRANSPARENT)
  if (a < hash12(in.pos.xy)) { discard; }
#else
  if (a < mtl.params2.y) { discard; }
#endif
}
#endif
`;
