/**
 * Deferred lighting: reads the G-buffer and writes the lit HDR image (and, beside it, skin's diffuse
 * light for subsurface scattering). One fullscreen pass.
 *
 *   sun         cascaded + focus shadow maps (PCF, rotated Poisson), contact shadows, material lobes
 *   local       point / spot / tube lights from the tile lists (spots may cast shadows from the atlas)
 *   indirect    SH9 sky irradiance, GGX-prefiltered environment, split-sum BRDF LUT, ambient occlusion
 *   sky         where nothing was drawn (depth 0 in reversed-Z)
 *
 * Bind groups: 0 Frame | 1 G-buffer + shadow maps + environment | 2 storage (lights, tile lists, SH)
 */
import { Frame, COMMON_WGSL, SKY_WGSL } from './common.js';

export const MAX_LIGHTS = 256;
export const MAX_PER_TILE = 32;
export const TILE = 32;
export const TILE_STRIDE = MAX_PER_TILE + 1;   // u32s per tile: count, then indices

/** Entries for the lighting bind group layouts (see GPU.layout). */
export const LIGHTING_LAYOUT_1 = [
  { b: 0, v: 'f', texture: 'unfilterable-float' }, { b: 1, v: 'f', texture: 'unfilterable-float' },
  { b: 2, v: 'f', texture: 'unfilterable-float' }, { b: 3, v: 'f', texture: 'unfilterable-float' },
  { b: 4, v: 'f', texture: 'depth' },
  { b: 5, v: 'f', texture: 'depth', dim: '2d-array' },
  { b: 6, v: 'f', texture: 'depth' },
  { b: 7, v: 'f', sampler: 'comparison' },
  { b: 8, v: 'f', texture: 'float', dim: 'cube' },
  { b: 9, v: 'f', sampler: 'filtering' },
  { b: 10, v: 'f', texture: 'float' },
  { b: 11, v: 'f', texture: 'unfilterable-float' },
];
export const LIGHTING_LAYOUT_2 = [
  { b: 0, v: 'f', buffer: 'read-only-storage' }, { b: 1, v: 'f', buffer: 'read-only-storage' }, { b: 2, v: 'f', buffer: 'read-only-storage' },
];

export const FULLSCREEN_VS = /* wgsl */`
struct FsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> FsOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: FsOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return o;
}
`;

export const LIGHTING_WGSL = /* wgsl */`
${Frame.wgsl}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var tG0: texture_2d<f32>;
@group(1) @binding(1) var tG1: texture_2d<f32>;
@group(1) @binding(2) var tG2: texture_2d<f32>;
@group(1) @binding(3) var tG3: texture_2d<f32>;
@group(1) @binding(4) var tDepth: texture_depth_2d;
@group(1) @binding(5) var tShadow: texture_depth_2d_array;
@group(1) @binding(6) var tSpot: texture_depth_2d;
@group(1) @binding(7) var sCmp: sampler_comparison;
@group(1) @binding(8) var tEnv: texture_cube<f32>;
@group(1) @binding(9) var sLin: sampler;
@group(1) @binding(10) var tBrdf: texture_2d<f32>;
@group(1) @binding(11) var tAO: texture_2d<f32>;
@group(2) @binding(0) var<storage, read> lights: array<vec4f>;
@group(2) @binding(1) var<storage, read> tiles: array<u32>;
@group(2) @binding(2) var<storage, read> shBuf: array<vec4f>;
${COMMON_WGSL}
${SKY_WGSL}

${FULLSCREEN_VS}

var<private> POISSON: array<vec2f, 12> = array<vec2f, 12>(
  vec2f(-0.326, -0.406), vec2f(-0.840, -0.074), vec2f(-0.696, 0.457), vec2f(-0.203, 0.621),
  vec2f(0.962, -0.195), vec2f(0.473, -0.480), vec2f(0.519, 0.767), vec2f(0.185, -0.893),
  vec2f(0.507, 0.064), vec2f(0.896, 0.412), vec2f(-0.322, -0.933), vec2f(-0.792, -0.598));

fn shUV(s: vec3f) -> vec2f { return vec2f(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5); }

fn viewZFromDepth(ndc: vec2f, d: f32) -> f32 {
  if (d <= 0.0) { return -1e9; }
  let p = frame.invProj * vec4f(ndc, d, 1.0);
  return p.z / p.w;
}

// ---- sun shadows -------------------------------------------------------------------------------
fn shadowCascade(i: i32, wpos: vec3f, n: vec3f, rot: f32, softness: f32) -> f32 {
  let p = wpos + n * frame.shadowTexel[i] * 1.6;
  let c = frame.shadowMat[i] * vec4f(p, 1.0);
  let s = c.xyz / c.w;
  let uv = shUV(s);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || s.z > 1.0) { return 1.0; }
  let radius = softness / frame.shadowSize * (1.0 + f32(i) * 0.15);
  let ca = cos(rot); let sa = sin(rot);
  var sum = 0.0;
  for (var k = 0; k < 12; k++) {
    let o0 = POISSON[k];
    let o = vec2f(o0.x * ca - o0.y * sa, o0.x * sa + o0.y * ca);
    sum += textureSampleCompareLevel(tShadow, sCmp, uv + o * radius, i, s.z);
  }
  return sum / 12.0;
}
struct Focus { vis: f32, w: f32 };
fn shadowFocus(wpos: vec3f, n: vec3f, rot: f32) -> Focus {
  var r: Focus; r.vis = 1.0; r.w = 0.0;
  if (frame.shadowFocusOn < 0.5) { return r; }
  let p = wpos + n * frame.shadowFocusTexel * 2.0;
  let c = frame.shadowMat[4] * vec4f(p, 1.0);
  let s = c.xyz / c.w;
  let uv = shUV(s);
  let e = min(uv, 1.0 - uv);
  r.w = smoothstep(0.0, 0.08, min(e.x, e.y));
  if (r.w <= 0.0 || s.z > 1.0) { r.w = 0.0; return r; }
  var radius = 2.2 * (frame.shadowTexel.x / max(frame.shadowFocusTexel, 1e-6)) / frame.shadowSize;
  radius = min(radius, 0.02);
  let ca = cos(rot); let sa = sin(rot);
  var sum = 0.0;
  for (var k = 0; k < 12; k++) {
    let o0 = POISSON[k];
    let o = vec2f(o0.x * ca - o0.y * sa, o0.x * sa + o0.y * ca);
    sum += textureSampleCompareLevel(tShadow, sCmp, uv + o * radius, 4, s.z);
  }
  r.vis = sum / 12.0;
  return r;
}
fn sunShadow(wpos: vec3f, n: vec3f, viewDepth: f32, rot: f32) -> f32 {
  let f = shadowFocus(wpos, n, rot);
  if (f.w >= 1.0) { return f.vis; }
  let sp = frame.shadowSplits;
  var i = 4;
  if (viewDepth < sp.x) { i = 0; } else if (viewDepth < sp.y) { i = 1; } else if (viewDepth < sp.z) { i = 2; } else if (viewDepth < sp.w) { i = 3; }
  if (i > 3) { return mix(1.0, f.vis, f.w); }
  var sh = shadowCascade(i, wpos, n, rot, 2.2);
  // blend into the next cascade over the last 12% of this one
  let edge = sp[i];
  var start = 0.0;
  if (i > 0) { start = sp[i - 1]; }
  let k = smoothstep(edge - (edge - start) * 0.12, edge, viewDepth);
  if (k > 0.0) {
    if (i < 3) { sh = mix(sh, shadowCascade(i + 1, wpos, n, rot, 2.2), k); } else { sh = mix(sh, 1.0, k); }
  }
  return mix(sh, f.vis, f.w);
}

/**
 * Contact shadows: a short ray from the pixel toward the sun, marched through the depth buffer. It
 * catches what the shadow maps are too coarse for (where a foot meets the ground, a hand on a hilt,
 * the fold of a sleeve). Thickness-tested; faded with distance.
 */
fn contactShadow(wpos: vec3f, L: vec3f, viewDepth: f32, jitter: f32) -> f32 {
  if (frame.contact <= 0.0 || viewDepth > 28.0) { return 1.0; }
  let len = frame.contact * (0.6 + viewDepth * 0.02);
  var start = (frame.view * vec4f(wpos, 1.0)).xyz;
  let dir = (frame.view * vec4f(L, 0.0)).xyz;
  start += dir * 0.012 * (1.0 + viewDepth * 0.05);
  var shadow = 0.0;
  let dims = frame.resolution;
  for (var i = 1; i <= 14; i++) {
    let t = (f32(i) - 1.0 + jitter) / 14.0;
    let pv = start + dir * (t * t * len);
    let c = frame.proj * vec4f(pv, 1.0);
    let ndc = c.xy / c.w;
    let uv = shUV(vec3f(ndc, 0.0));
    if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { break; }
    let q = min(vec2i(uv * dims), vec2i(dims) - 1);
    let d = textureLoad(tDepth, q, 0);
    let sceneZ = -viewZFromDepth(ndc, d);
    let rayZ = -pv.z;
    let dz = rayZ - sceneZ;
    let thick = 0.06 + rayZ * 0.004;
    if (dz > 0.004 && dz < thick) { shadow = 1.0 - t * 0.6; break; }
  }
  return 1.0 - shadow * (1.0 - smoothstep(18.0, 28.0, viewDepth));
}

// ---- local lights ------------------------------------------------------------------------------
fn spotShadow(i: u32, idx: i32, wpos: vec3f, N: vec3f, dist: f32, rot: f32) -> f32 {
  let M = mat4x4f(lights[i * 8u + 4u], lights[i * 8u + 5u], lights[i * 8u + 6u], lights[i * 8u + 7u]);
  var p = M * vec4f(wpos + N * (0.01 + dist * 0.004), 1.0);
  p = vec4f(p.xyz / p.w, 1.0);
  let t0 = vec2f(f32(idx % 4), f32(idx / 4)) * 0.25;
  if (any(p.xy < t0) || any(p.xy > t0 + vec2f(0.25)) || p.z > 1.0) { return 1.0; }
  var s = 0.0;
  let r = 1.6 / f32(textureDimensions(tSpot).x);
  for (var k = 0; k < 8; k++) {
    let a = rot + f32(k) * 2.39996;
    let rr = sqrt((f32(k) + 0.5) / 8.0);
    let o = vec2f(cos(a), sin(a)) * rr * r * 1.8;
    s += textureSampleCompareLevel(tSpot, sCmp, clamp(p.xy + o, t0 + vec2f(0.0005), t0 + vec2f(0.2495)), p.z - 0.0004);
  }
  return s / 8.0;
}

/** Sums every light of this pixel's tile. diffOut gets the diffuse part (for skin scattering). */
fn localLights(px: vec2i, wpos: vec3f, N: vec3f, V: vec3f, diffuseColor: vec3f, F0: vec3f, rough: f32, matType: i32, rot: f32, diffOut: ptr<function, vec3f>) -> vec3f {
  let tile = px / 32;
  let t = u32(tile.y) * frame.tilesX + u32(tile.x);
  let base = t * ${33}u;
  let n = min(tiles[base], ${MAX_PER_TILE}u);
  var sum = vec3f(0.0);
  for (var k = 0u; k < n; k++) {
    let i = tiles[base + 1u + k];
    let a = lights[i * 8u]; let b = lights[i * 8u + 1u]; let c = lights[i * 8u + 2u]; let d = lights[i * 8u + 3u];
    let ltype = i32(b.w + 0.5);
    var lp = a.xyz;
    var specPoint = lp;
    if (ltype == 2) {
      // tube: closest point for diffuse, representative point on the reflection ray for specular
      let axis = c.xyz * c.w;
      let p0 = lp - axis; let p1 = lp + axis;
      let seg = p1 - p0;
      let tt = clamp(dot(wpos - p0, seg) / dot(seg, seg), 0.0, 1.0);
      lp = p0 + seg * tt;
      let R = reflect(-V, N);
      let l0 = p0 - wpos; let l1 = p1 - wpos;
      let ld = l1 - l0;
      let rl = dot(R, ld);
      let ts = clamp((dot(R, l0) * rl - dot(l0, ld)) / max(dot(ld, ld) - rl * rl, 1e-5), 0.0, 1.0);
      specPoint = p0 + seg * ts;
    }
    var L = lp - wpos;
    let dist2 = dot(L, L);
    let range = a.w;
    let win = pow2(saturate(1.0 - pow2(dist2 / (range * range))));
    if (win <= 0.0) { continue; }
    let dist = sqrt(dist2);
    L = L / dist;
    var fall = win / (dist2 + d.z * d.z + 0.01);
    // a tube sits in a fixture that throws its light down: little reaches the ceiling above it
    if (ltype == 2) { fall *= (1.0 + c.w * 0.8) * (0.06 + 0.94 * saturate(L.y * 1.3)); }
    if (ltype == 1) {
      let cd = dot(-L, c.xyz);
      fall *= smoothstep(c.w, d.x, cd);
      if (fall <= 0.0) { continue; }
      if (d.y >= 0.0) { fall *= spotShadow(i, i32(d.y + 0.5), wpos, N, dist, rot); }
    }
    let NoLraw = dot(N, L);
    let NoL = saturate(NoLraw);
    let Ls = normalize(specPoint - wpos);
    // a spherical source widens the highlight (energy-normalised, Karis 2013)
    let sr = saturate(rough * rough + d.z / (2.0 * dist));
    let br = brdfDirect(N, V, Ls, diffuseColor, F0, sqrt(sr));
    let sp = br.spec * saturate(dot(N, Ls));
    let col = b.rgb * fall;
    var diff = br.diff * NoL;
    if (matType == 1) {
      // skin: wrapped diffuse with a red scattering tint past the terminator
      let w = saturate((NoLraw + 0.5) / 1.5);
      diff += diffuseColor * INV_PI * vec3f(0.6, 0.2, 0.1) * max(w - NoL, 0.0);
    }
    *diffOut += diff * col;
    sum += (diff + sp) * col;
  }
  return sum;
}

struct LOut { @location(0) color: vec4f, @location(1) skin: vec4f };

@fragment fn fs(@builtin(position) frag: vec4f) -> LOut {
  var out: LOut;
  out.skin = vec4f(0.0);
  let px = vec2i(frag.xy);
  let depth = textureLoad(tDepth, px, 0);
  let ndc = vec2f(frag.x / frame.resolution.x * 2.0 - 1.0, 1.0 - frag.y / frame.resolution.y * 2.0);
  if (depth <= 0.0) {
    // sky: the ray through the pixel, from the near plane (reversed-Z: depth 1)
    let pn = frame.invViewProj * vec4f(ndc, 1.0, 1.0);
    let dir = normalize(pn.xyz / pn.w - frame.cameraPos);
    out.color = vec4f(skyRadiance(dir, true), 1.0);
    return out;
  }
  let wp4 = frame.invViewProj * vec4f(ndc, depth, 1.0);
  let wpos = wp4.xyz / wp4.w;
  let V = normalize(frame.cameraPos - wpos);
  let g0 = textureLoad(tG0, px, 0); let g1 = textureLoad(tG1, px, 0);
  let g2 = textureLoad(tG2, px, 0); let g3 = textureLoad(tG3, px, 0);
  let base = g0.rgb;
  let specScale = g0.a;
  let N = decodeNormal(g1.xy);
  let rough = g1.z; let metal = g1.w;
  let mtype = i32(g2.z + 0.5);
  let param = g2.w;
  let emissive = g3.rgb;

  let diffuseColor = base * (1.0 - metal);
  let f0d = select(0.04, 0.028, mtype == 1);
  let F0 = mix(vec3f(f0d * specScale), base, metal);
  let NoV = saturate(dot(N, V)) + 1e-4;
  let viewDepth = -(frame.view * vec4f(wpos, 1.0)).z;
  let rot = ign(frag.xy, frame.frame) * TAU;
  let dfg = textureSampleLevel(tBrdf, sLin, vec2f(NoV, rough), 0.0).rg;
  // multiple-scattering energy compensation (Fdez-Aguera 2019): rough metals keep their brightness
  let energy = 1.0 + F0 * (1.0 / max(dfg.x + dfg.y, 1e-3) - 1.0);
  let sunIrr = frame.sunIrradiance;

  // --- sun ---
  let L = frame.sunDir;
  let NoLraw = dot(N, L);
  var vis = 1.0;
  if (frame.shadowsOn > 0.5) { vis = sunShadow(wpos, N, viewDepth, rot); }
  if (vis > 0.02 && NoLraw > 0.0) { vis *= contactShadow(wpos, L, viewDepth, fract(rot * 0.159155 + 0.37)); }
  let br = brdfDirect(N, V, L, diffuseColor, F0, rough);
  let NoL = saturate(NoLraw);
  var direct = (br.diff + br.spec * energy) * NoL * vis * sunIrr;
  var skinDiffuse = br.diff * NoL * vis * sunIrr;

  if (mtype == 1) {
    // skin: light bleeds past the terminator, reddened by the blood beneath (wrapped diffuse)
    let wrap = 0.5;
    let w = saturate((NoLraw + wrap) / (1.0 + wrap));
    let sss = vec3f(0.6, 0.2, 0.1) * max(w - NoL, 0.0) * mix(0.35, 1.0, vis);
    direct += diffuseColor * INV_PI * sss * sunIrr;
    skinDiffuse += diffuseColor * INV_PI * sss * sunIrr;
  } else if (mtype == 2) {
    // clear coat over polished steel: a second, sharp lobe
    let H = normalize(V + L);
    let ca = 0.12 * 0.12;
    let Fc = 0.04 + 0.96 * pow5(1.0 - saturate(dot(V, H)));
    let coat = D_GGX(saturate(dot(N, H)), ca) * V_SmithGGXCorrelated(NoV, NoL, ca) * Fc * param;
    direct = direct * (1.0 - Fc * param) + coat * NoL * vis * sunIrr;
  } else if (mtype == 3) {
    // cloth sheen (Charlie distribution, Estevez & Kulla 2017)
    let H = normalize(V + L);
    let NoH = saturate(dot(N, H));
    let r = max(rough, 0.3); let inv = 1.0 / r;
    let sin2h = max(1.0 - NoH * NoH, 0.0078125);
    let D = (2.0 + inv) * pow(sin2h, inv * 0.5) / TAU;
    let Vv = 1.0 / (4.0 * (NoL + NoV - NoL * NoV) + 1e-4);
    direct += base * D * Vv * param * NoL * vis * sunIrr;
  } else if (mtype == 4) {
    // thin translucent fabric and leaves: sun through the cloth
    let back = saturate(-NoLraw) * (0.5 + 0.5 * pow(saturate(dot(-V, L)), 4.0));
    direct += diffuseColor * INV_PI * back * 0.45 * vis * sunIrr;
  } else if (mtype == 6) {
    // hair: a shifted, tinted second lobe (Marschner's TRT, cheaply) and some light through
    let H = normalize(V + L);
    let trt = pow(saturate(dot(N, normalize(H + N * 0.25))), 24.0) * 0.6;
    direct += base * trt * NoL * vis * sunIrr + diffuseColor * INV_PI * saturate(-NoLraw) * 0.25 * vis * sunIrr;
  }

  // --- local lights ---
  var localDiffuse = vec3f(0.0);
  direct += localLights(px, wpos, N, V, diffuseColor, F0, rough, mtype, rot, &localDiffuse);
  skinDiffuse += localDiffuse;

  // --- indirect ---
  var ao = g3.a;                                  // baked occlusion from the material
  if (frame.aoOn > 0.5) { ao = ao * textureLoad(tAO, px, 0).r; }
  var sh: array<vec3f, 9>;
  for (var k = 0; k < 9; k++) { sh[k] = shBuf[k].xyz; }
  let E = shIrradiance(N, sh) * frame.envIntensity;
  var indirectDiffuse = diffuseColor * E * INV_PI * ao;
  if (mtype == 4) { indirectDiffuse += diffuseColor * shIrradiance(-N, sh) * frame.envIntensity * INV_PI * 0.25 * ao; }

  var R = reflect(-V, N);
  // rough reflections lean toward the normal (Lagarde & de Rousiers 2014)
  R = normalize(mix(R, N, rough * rough));
  if (frame.reflRadius > 0.0) {
    // parallax-corrected probe: where R leaves the proxy sphere, looked up from the probe centre
    let lp = wpos - frame.reflPos;
    let b = dot(lp, R); let c = dot(lp, lp) - frame.reflRadius * frame.reflRadius;
    let h = b * b - c;
    if (c < 0.0 && h > 0.0) { R = normalize(lp + R * (-b + sqrt(h))); }
  }
  let envL = textureSampleLevel(tEnv, sLin, R, rough * (frame.envLevels - 1.0)).rgb * frame.envIntensity;
  let Ess = F0 * dfg.x + dfg.y;
  let specOcc = saturate(pow(NoV + ao, exp2(-16.0 * rough - 1.0)) - 1.0 + ao);
  var indirectSpec = envL * Ess * energy * specOcc;
  if (mtype == 2) {
    let Fc = 0.04 + 0.96 * pow5(1.0 - NoV);
    let coatRefl = textureSampleLevel(tEnv, sLin, reflect(-V, N), 0.6).rgb * frame.envIntensity;
    indirectSpec = indirectSpec * (1.0 - Fc * param) + coatRefl * Fc * param * specOcc;
  }
  if (mtype == 5) { indirectSpec *= 1.6; }   // the wet cornea mirrors the room: the catchlight that makes a face alive

  var color = direct + indirectDiffuse + indirectSpec + emissive;
  if (frame.debug > 0.5) {
    let dbg = i32(frame.debug + 0.5);
    if (dbg == 1) { color = base; }
    else if (dbg == 2) { color = N * 0.5 + 0.5; }
    else if (dbg == 3) { color = vec3f(rough, metal, 0.0); }
    else if (dbg == 4) { color = vec3f(ao); }
    else if (dbg == 5) { color = vec3f(vis); }
    else if (dbg == 6) { color = vec3f(fract(viewDepth * 0.1)); }
    else if (dbg == 7) { color = vec3f(abs(g2.xy) * 100.0, 0.0); }
  }
  out.color = vec4f(color, 1.0);
  if (mtype == 1) { out.skin = vec4f(skinDiffuse + indirectDiffuse, 1.0); }
  return out;
}
`;
