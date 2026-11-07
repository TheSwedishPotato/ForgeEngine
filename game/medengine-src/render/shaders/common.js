/**
 * Shared WGSL: the per-pass Frame uniform, constants, encodings, noise, the Cook-Torrance BRDF,
 * spherical harmonics and the sky model (also used to capture the environment).
 *
 * Conventions: reversed-Z depth (0 = far plane / sky), framebuffer and uv origin at the top left
 * (y down), NDC y up. Frame.view / viewProj are the camera's; shadow passes get their own Frame.
 */
import { struct } from '../../gpu/wgsl.js';

export const MAX_CASCADES = 5;   // 4 cascades + the focus map

export const Frame = struct('Frame', [
  ['viewProj', 'mat4x4f'], ['viewProjFlat', 'mat4x4f'], ['prevViewProj', 'mat4x4f'],
  ['view', 'mat4x4f'], ['proj', 'mat4x4f'], ['invViewProj', 'mat4x4f'], ['invProj', 'mat4x4f'],
  ['cameraPos', 'vec3f'], ['time', 'f32'],
  ['jitter', 'vec2f'], ['resolution', 'vec2f'],
  ['wetness', 'f32'], ['rain', 'f32'], ['frame', 'f32'], ['envLevels', 'f32'],
  ['sunDir', 'vec3f'], ['cloudCover', 'f32'],
  ['sunColor', 'vec3f'], ['night', 'f32'],
  ['sunIrradiance', 'vec3f'], ['overcast', 'f32'],
  ['cityGlow', 'vec3f'], ['lightning', 'f32'],
  ['lightningPos', 'vec3f'], ['envIntensity', 'f32'],
  ['shadowMat', 'mat4x4f', MAX_CASCADES],
  ['shadowSplits', 'vec4f'], ['shadowTexel', 'vec4f'],
  ['shadowSize', 'f32'], ['shadowsOn', 'f32'], ['shadowFocusOn', 'f32'], ['shadowFocusTexel', 'f32'],
  ['contact', 'f32'], ['lightCount', 'u32'], ['tilesX', 'u32'], ['tilesY', 'u32'],
  ['reflPos', 'vec3f'], ['reflRadius', 'f32'],
  ['debug', 'f32'], ['aoOn', 'f32'], ['ssrOn', 'f32'], ['_pad', 'f32'],
]);

export const COMMON_WGSL = /* wgsl */`
const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;
const INV_PI: f32 = 0.31830988618;

fn pow2(x: f32) -> f32 { return x * x; }
fn pow5(x: f32) -> f32 { let x2 = x * x; return x2 * x2 * x; }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn fmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }

// Octahedral normal encoding (Cigolle et al. 2014): two channels, uniform error.
fn octWrap(v: vec2f) -> vec2f { return (1.0 - abs(v.yx)) * select(vec2f(-1.0), vec2f(1.0), v >= vec2f(0.0)); }
fn encodeNormal(n0: vec3f) -> vec2f {
  let n = n0 / (abs(n0.x) + abs(n0.y) + abs(n0.z));
  return select(octWrap(n.xy), n.xy, n.z >= 0.0);
}
fn decodeNormal(f: vec2f) -> vec3f {
  var n = vec3f(f, 1.0 - abs(f.x) - abs(f.y));
  let t = saturate(-n.z);
  let adj = select(vec2f(t), vec2f(-t), n.xy >= vec2f(0.0));
  n = vec3f(n.xy + adj, n.z);
  return normalize(n);
}

// Hashes and noise.
fn hash12(p: vec2f) -> f32 { var p3 = fract(vec3f(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
fn hash13(p: vec3f) -> f32 { var p3 = fract(p * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
fn hash22(p: vec2f) -> vec2f { var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// Interleaved gradient noise (Jimenez 2014): a cheap blue-ish per-pixel sequence.
fn ign(pix: vec2f, frame: f32) -> f32 { let pp = pix + 5.588238 * fmod(frame, 64.0); return fract(52.9829189 * fract(0.06711056 * pp.x + 0.00583715 * pp.y)); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); var f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2f(1.0, 0.0)), f.x), mix(hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)), f.x), f.y);
}
fn fbm2(p0: vec2f, oct: i32) -> f32 {
  var p = p0; var s = 0.0; var a = 0.5;
  for (var i = 0; i < 8; i++) { if (i >= oct) { break; } s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

// Cook-Torrance microfacet BRDF: GGX distribution, height-correlated Smith visibility, Schlick
// Fresnel (Karis 2013, Heitz 2014).
fn D_GGX(NoH: f32, a: f32) -> f32 { let a2 = a * a; let d = (NoH * a2 - NoH) * NoH + 1.0; return a2 / (PI * d * d + 1e-7); }
fn V_SmithGGXCorrelated(NoV: f32, NoL: f32, a: f32) -> f32 {
  let a2 = a * a;
  let gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  let gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / (gv + gl + 1e-6);
}
fn F_Schlick(f0: vec3f, VoH: f32) -> vec3f { return f0 + (1.0 - f0) * pow5(1.0 - VoH); }

struct Brdf { spec: vec3f, diff: vec3f };
/** Direct light from one source: specular and diffuse reflected toward the eye per unit irradiance. */
fn brdfDirect(n: vec3f, v: vec3f, l: vec3f, diffuseColor: vec3f, f0: vec3f, roughness: f32) -> Brdf {
  let h = normalize(v + l);
  let NoV = abs(dot(n, v)) + 1e-4;
  let NoL = saturate(dot(n, l));
  let NoH = saturate(dot(n, h));
  let VoH = saturate(dot(v, h));
  let a = max(roughness * roughness, 0.002);
  let F = F_Schlick(f0, VoH);
  var r: Brdf;
  r.spec = D_GGX(NoH, a) * V_SmithGGXCorrelated(NoV, NoL, a) * F;
  r.diff = diffuseColor * INV_PI * (1.0 - F);
  return r;
}

// Spherical harmonics, order 2 (9 coefficients of radiance): evaluating applies the cosine-lobe
// convolution, so the result is irradiance E(n) (divide by PI for radiance).
fn shIrradiance(n: vec3f, c: array<vec3f, 9>) -> vec3f {
  return max(vec3f(0.0),
      c[0] * 0.886227
    + c[1] * 1.023328 * n.y + c[2] * 1.023328 * n.z + c[3] * 1.023328 * n.x
    + c[4] * 0.858086 * n.x * n.y + c[5] * 0.858086 * n.y * n.z
    + c[6] * 0.247708 * (3.0 * n.z * n.z - 1.0)
    + c[7] * 0.858086 * n.x * n.z + c[8] * 0.429043 * (n.x * n.x - n.y * n.y));
}

// Direction of a cube-map texel. face order +X -X +Y -Y +Z -Z; sc, tc in -1..1 with tc growing downward
// in the face image (the convention WebGPU samples with).
fn cubeDir(face: u32, uv: vec2f) -> vec3f {
  let sc = uv.x * 2.0 - 1.0; let tc = uv.y * 2.0 - 1.0;
  switch (face) {
    case 0u: { return normalize(vec3f(1.0, -tc, -sc)); }
    case 1u: { return normalize(vec3f(-1.0, -tc, sc)); }
    case 2u: { return normalize(vec3f(sc, 1.0, tc)); }
    case 3u: { return normalize(vec3f(sc, -1.0, -tc)); }
    case 4u: { return normalize(vec3f(sc, -tc, 1.0)); }
    default: { return normalize(vec3f(-sc, -tc, -1.0)); }
  }
}
`;

/**
 * Sky radiance in linear HDR: one model from a clear day through dusk to a stormy night over a city.
 * Reads the Frame uniform (`frame`): sunDir, sunColor, cloudCover, night, overcast, cityGlow, lightning,
 * lightningPos, time.
 */
export const SKY_WGSL = /* wgsl */`
fn skyRadiance(d0: vec3f, withSun: bool) -> vec3f {
  let d = normalize(d0);
  let h = d.y;
  let sunDir = frame.sunDir; let sunColor = frame.sunColor; let night = frame.night; let overcast = frame.overcast;
  let sd = max(dot(d, sunDir), 0.0);
  // --- day
  var zenith = vec3f(0.20, 0.36, 0.66) * 1.25;
  var horizon = vec3f(0.92, 0.86, 0.76) * 1.35;
  let ground = vec3f(0.30, 0.30, 0.24) * 0.55;
  let dusk = smoothstep(0.25, -0.05, sunDir.y) * (1.0 - night);
  horizon = mix(horizon, vec3f(1.2, 0.55, 0.28), dusk * 0.8);
  zenith = mix(zenith, vec3f(0.12, 0.16, 0.34), dusk);
  var day = select(mix(horizon * 0.9, ground, saturate(-h * 5.0)), mix(horizon, zenith, pow(saturate(h), 0.5)), h > 0.0);
  day += sunColor * (pow(sd, 8.0) * 0.55 + pow(sd, 90.0) * 2.4) * smoothstep(-0.1, 0.05, h);
  day += vec3f(0.9, 0.55, 0.3) * pow(1.0 - abs(h), 12.0) * pow(sd, 2.0) * (0.6 + dusk);
  // --- night: deep blue zenith, the city's glow along the horizon
  var nightCol = mix(vec3f(0.010, 0.013, 0.022), vec3f(0.003, 0.004, 0.009), pow(saturate(h), 0.6));
  nightCol += frame.cityGlow * pow(1.0 - saturate(h), 5.0) * 0.6;
  if (h < 0.0) { nightCol = mix(nightCol, frame.cityGlow * 0.25, saturate(-h * 4.0)); }
  var col = mix(day, nightCol, night);
  // overcast dims and greys the day sky
  col = mix(col, vec3f(luma(col)) * vec3f(0.92, 0.95, 1.0) * mix(0.55, 1.0, night), overcast * 0.85);
  if (withSun && overcast < 0.75) {
    let disc = smoothstep(0.99955, 0.99975, sd);
    col += sunColor * disc * mix(400.0, 6.0, night) * (1.0 - overcast);
  }
  if (h > 0.0) {
    let uv = d.xz / (h + 0.16) * 1.4 + vec2f(frame.time * 0.004, frame.time * 0.0013) * (1.0 + overcast * 4.0);
    let base = fbm2(uv, 6);
    let cover = mix(frame.cloudCover, 1.0, overcast);
    let c = smoothstep(0.62 - 0.45 * cover, 0.86 - 0.3 * overcast, base);
    let thick = smoothstep(0.5, 0.95, fbm2(uv * 1.7 + 3.1, 4));
    let lit = mix(vec3f(0.72, 0.72, 0.74), vec3f(1.25, 1.12, 0.95), pow(sd, 2.5)) * 1.35;
    let shade = vec3f(0.48, 0.5, 0.55) * 1.2;
    var dayCloud = mix(lit, shade, thick * 0.7) + sunColor * pow(sd, 30.0) * (1.0 - thick) * 1.5;
    dayCloud *= mix(1.0, 0.45, overcast);
    let nightCloud = frame.cityGlow * (0.35 + 0.65 * (1.0 - thick)) * (0.6 + 0.4 * smoothstep(0.4, 0.0, h))
      + sunColor * 0.04 * pow(sd, 6.0) * (1.0 - thick) * (1.0 - overcast);
    let cloud = mix(dayCloud, nightCloud, night);
    col = mix(col, cloud, c * 0.95 * smoothstep(0.0, 0.1, h));
    if (frame.lightning > 0.0) {
      let nr = pow(max(dot(d, normalize(frame.lightningPos)), 0.0), 6.0);
      col += vec3f(0.75, 0.82, 1.0) * frame.lightning * (0.4 + 3.5 * nr) * (0.4 + 0.6 * c) * 2.5;
    }
  } else if (frame.lightning > 0.0) {
    col += vec3f(0.75, 0.82, 1.0) * frame.lightning * 0.15;
  }
  return col;
}
`;
