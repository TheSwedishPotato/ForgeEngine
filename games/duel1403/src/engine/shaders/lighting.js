import { COMMON, SKY } from './common.js';
import { SHADOW_GLSL } from '../passes/Shadows.js';

/** Shared G-buffer decoding for screen-space passes. */
export const GBUFFER_READ = /* glsl */`
uniform sampler2D uG0, uG1, uG2, uG3, uDepth;
uniform mat4 uInvViewProj, uView, uViewProjFlat, uInvProj, uProj;
uniform vec3 uCameraPos;
uniform vec2 uResolution;   // internal render resolution
vec3 worldFromDepth(vec2 uv, float d) {
  vec4 p = uInvViewProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
vec3 viewFromDepth(vec2 uv, float d) {
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
`;

/** Ambient light from the probe volume (irradiance SH per probe, trilinear). */
export const PROBES_GLSL = /* glsl */`
uniform sampler2D uProbes;      // width = probe count, height = 9 (SH coefficients, RGB)
uniform vec3 uProbeMin, uProbeMax;
uniform ivec3 uProbeDims;
uniform float uProbeWeight;     // 0 = sky only
uniform vec3 uSkySH[9];
vec3 probeSH(int index, vec3 n) {
  vec3 c[9];
  for (int k = 0; k < 9; k++) c[k] = texelFetch(uProbes, ivec2(index, k), 0).rgb;
  return shIrradiance(n, c);
}
/** Irradiance E(n) at a world position (W/m^2-like, divide by PI for radiance). */
vec3 irradianceAt(vec3 p, vec3 n) {
  vec3 sky = shIrradiance(n, uSkySH);
  if (uProbeWeight <= 0.0) return sky;
  vec3 g = (p + n * 0.3 - uProbeMin) / (uProbeMax - uProbeMin) * vec3(uProbeDims - 1);
  if (any(lessThan(g, vec3(0.0))) || any(greaterThan(g, vec3(uProbeDims - 1)))) return sky;
  vec3 base = floor(g), f = g - base;
  vec3 sum = vec3(0.0); float wsum = 0.0;
  for (int i = 0; i < 8; i++) {
    ivec3 o = ivec3(i & 1, (i >> 1) & 1, (i >> 2) & 1);
    ivec3 c = min(ivec3(base) + o, uProbeDims - 1);
    vec3 tri = mix(1.0 - f, f, vec3(o));
    float w = tri.x * tri.y * tri.z;
    // Prefer probes in front of the surface (reduces light leaking through walls).
    vec3 probePos = uProbeMin + vec3(c) / vec3(uProbeDims - 1) * (uProbeMax - uProbeMin);
    vec3 dir = normalize(probePos - p + 1e-4);
    w *= pow2(max(0.05, (dot(dir, n) + 1.0) * 0.5)) + 0.02;
    int idx = c.x + c.y * uProbeDims.x + c.z * uProbeDims.x * uProbeDims.y;
    sum += probeSH(idx, n) * w;
    wsum += w;
  }
  vec3 probe = sum / max(wsum, 1e-4);
  // fade to sky at the edges of the volume
  vec3 e = min(g, vec3(uProbeDims - 1) - g);
  float edge = saturate(min(min(e.x, e.z), e.y + 1.0) * 0.6);
  return mix(sky, probe, uProbeWeight * edge);
}
`;

export const LIGHTING_FS = /* glsl */`
${COMMON}
${SKY}
${GBUFFER_READ}
${SHADOW_GLSL}
${PROBES_GLSL}
in vec2 vUv;
out vec4 o;

uniform samplerCube uEnvSpec;
uniform float uEnvLevels;
uniform float uEnvIntensity;
uniform vec3 uReflPos;
uniform float uReflRadius;   // parallax sphere of the reflection probe (0 = sky only)
uniform sampler2D uBrdfLut;
uniform sampler2D uAO;          // r: ambient occlusion
uniform sampler2D uSSGI;        // rgb: bounced radiance from rays that hit, a: fraction that hit
uniform sampler2D uSSR;         // rgb: reflected radiance, a: confidence
uniform float uFrame;
uniform vec3 uSunIrradiance;    // sun colour * intensity
uniform float uShadowsOn;
uniform float uContact;         // contact-shadow ray length (m), 0 = off
uniform highp sampler2D uRTShadow;   // ray-traced sun visibility (passes/RayTracing.js)
uniform float uRTOn, uRTDist;

/**
 * Contact shadows: a short ray from the pixel toward the sun, marched
 * through the depth buffer. It catches what the shadow maps are too coarse
 * for: the shadow where a foot meets the ground, a hand on a hilt, the
 * fold of a sleeve. Thickness-tested so thin things do not shadow what is
 * far behind them; faded with distance (beyond ~25 m the maps suffice).
 */
float contactShadow(vec3 wpos, vec3 L, float viewDepth, float jitter) {
  if (uContact <= 0.0 || viewDepth > 28.0) return 1.0;
  float len = uContact * (0.6 + viewDepth * 0.02);
  const int STEPS = 14;
  vec3 start = (uView * vec4(wpos, 1.0)).xyz;
  vec3 dir = mat3(uView) * L;
  start += dir * 0.012 * (1.0 + viewDepth * 0.05);
  float shadow = 0.0;
  for (int i = 1; i <= STEPS; i++) {
    float t = (float(i) - 1.0 + jitter) / float(STEPS);
    vec3 pv = start + dir * (t * t * len);
    vec4 c = uProj * vec4(pv, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) break;
    float sceneZ = -viewFromDepth(uv, texture(uDepth, uv).r).z;
    float rayZ = -pv.z;
    float dz = rayZ - sceneZ;
    float thick = 0.06 + rayZ * 0.004;
    if (dz > 0.004 && dz < thick) { shadow = 1.0 - t * 0.6; break; }
  }
  return 1.0 - shadow * (1.0 - smoothstep(18.0, 28.0, viewDepth));
}

#define MAX_POINTS 8
uniform int uPointCount;
uniform vec4 uPointPos[MAX_POINTS];     // xyz, radius
uniform vec4 uPointColor[MAX_POINTS];   // rgb * intensity, unused

void main() {
  float depth = texture(uDepth, vUv).r;
  vec3 wpos = worldFromDepth(vUv, depth);
  vec3 V = normalize(uCameraPos - wpos);
  if (depth >= 1.0) {
    o = vec4(skyRadiance(-V, true), 1.0);
    return;
  }
  vec4 g0 = texture(uG0, vUv), g1 = texture(uG1, vUv), g2 = texture(uG2, vUv), g3 = texture(uG3, vUv);
  vec3 base = g0.rgb;
  float specScale = g0.a;
  vec3 N = decodeNormal(g1.xy);
  float rough = g1.z, metal = g1.w;
  int type = int(g2.z + 0.5);
  float param = g2.w;
  vec3 emissive = g3.rgb;

  vec3 diffuseColor = base * (1.0 - metal);
  float f0d = type == 1 ? 0.028 : 0.04;
  vec3 F0 = mix(vec3(f0d * specScale), base, metal);
  float NoV = saturate(dot(N, V)) + 1e-4;
  float viewDepth = -(uView * vec4(wpos, 1.0)).z;
  float rot = ign(gl_FragCoord.xy, uFrame) * TAU;
  vec2 dfg = texture(uBrdfLut, vec2(NoV, rough)).rg;
  // Multiple-scattering energy compensation (Fdez-Agüera 2019): rough metals keep their brightness.
  vec3 energy = 1.0 + F0 * (1.0 / max(dfg.x + dfg.y, 1e-3) - 1.0);

  // --- sun -------------------------------------------------------------------
  vec3 L = uSunDir;
  float NoLraw = dot(N, L);
  float vis = uShadowsOn > 0.5 ? sunShadow(wpos, N, viewDepth, rot) : 1.0;
  if (uRTOn > 0.5) vis *= mix(1.0, texture(uRTShadow, vUv).r, 1.0 - smoothstep(uRTDist * 0.85, uRTDist, viewDepth));
  if (vis > 0.02 && NoLraw > 0.0) vis *= contactShadow(wpos, L, viewDepth, fract(rot * 0.159155 + 0.37));
  vec3 diffBrdf;
  vec3 spec = brdfDirect(N, V, L, diffuseColor, F0, rough, diffBrdf);
  float NoL = saturate(NoLraw);
  vec3 direct = (diffBrdf + spec * energy) * NoL * vis * uSunIrradiance;

  if (type == 1) {
    // Skin: light bleeds past the terminator, reddened by the blood beneath
    // (wrapped diffuse with a scattering tint).
    float wrap = 0.5;
    float w = saturate((NoLraw + wrap) / (1.0 + wrap));
    vec3 sss = vec3(0.95, 0.32, 0.16) * max(w - NoL, 0.0) * mix(0.35, 1.0, vis);
    direct += diffuseColor * INV_PI * sss * uSunIrradiance;
  } else if (type == 2) {
    // Clear coat over polished steel: a second, sharp lobe (Filament).
    vec3 H = normalize(V + L);
    float ca = 0.12 * 0.12;
    float Fc = 0.04 + 0.96 * pow5(1.0 - saturate(dot(V, H)));
    float coat = D_GGX(saturate(dot(N, H)), ca) * V_SmithGGXCorrelated(NoV, NoL, ca) * Fc * param;
    direct = direct * (1.0 - Fc * param) + coat * NoL * vis * uSunIrradiance;
  } else if (type == 3) {
    // Cloth sheen (Charlie distribution, Estevez & Kulla 2017).
    vec3 H = normalize(V + L);
    float NoH = saturate(dot(N, H));
    float r = max(rough, 0.3), inv = 1.0 / r;
    float sin2h = max(1.0 - NoH * NoH, 0.0078125);
    float D = (2.0 + inv) * pow(sin2h, inv * 0.5) / TAU;
    float Vv = 1.0 / (4.0 * (NoL + NoV - NoL * NoV) + 1e-4);
    direct += base * D * Vv * param * NoL * vis * uSunIrradiance;
  } else if (type == 4) {
    // Thin translucent fabric (banners, canopies): sun through the cloth.
    float back = saturate(-NoLraw) * (0.5 + 0.5 * pow(saturate(dot(-V, L)), 4.0));
    direct += diffuseColor * INV_PI * back * 0.45 * vis * uSunIrradiance;
  }

  // --- point lights (fire) ----------------------------------------------------
  for (int i = 0; i < MAX_POINTS; i++) {
    if (i >= uPointCount) break;
    vec3 d = uPointPos[i].xyz - wpos;
    float dist2 = dot(d, d);
    float r = uPointPos[i].w;
    float fall = pow2(saturate(1.0 - pow2(dist2 / (r * r)))) / (dist2 + 0.25);
    vec3 Lp = d * inversesqrt(dist2);
    vec3 dB;
    vec3 sp = brdfDirect(N, V, Lp, diffuseColor, F0, rough, dB);
    direct += (dB + sp) * saturate(dot(N, Lp)) * fall * uPointColor[i].rgb;
  }

  // --- indirect -----------------------------------------------------------------
  float ao = texture(uAO, vUv).r;
  vec4 gi = texture(uSSGI, vUv);
  vec3 E = irradianceAt(wpos, N);
  // Rays that hit something nearby bring its light; the rest see the probes/sky.
  vec3 indirectDiffuse = diffuseColor * (gi.rgb + (1.0 - gi.a) * E * INV_PI) * ao;
  if (type == 4) indirectDiffuse += diffuseColor * irradianceAt(wpos, -N) * INV_PI * 0.25 * ao;

  vec3 R = reflect(-V, N);
  // Rough reflections lean toward the normal (Lagarde & de Rousiers 2014).
  R = normalize(mix(R, N, rough * rough));
  if (uReflRadius > 0.0) {
    // Parallax correction: find where R leaves the probe's proxy sphere and
    // look that point up from the probe's centre (Lagarde 2012).
    vec3 lp = wpos - uReflPos;
    float b = dot(lp, R), c = dot(lp, lp) - uReflRadius * uReflRadius;
    float h = b * b - c;
    if (c < 0.0 && h > 0.0) R = normalize(lp + R * (-b + sqrt(h)));
  }
  vec3 envL = textureLod(uEnvSpec, R, rough * (uEnvLevels - 1.0)).rgb * uEnvIntensity;
  vec4 ssr = texture(uSSR, vUv);
  vec3 refl = mix(envL, ssr.rgb, ssr.a);
  vec3 Ess = F0 * dfg.x + dfg.y;
  float specOcc = saturate(pow(NoV + ao, exp2(-16.0 * rough - 1.0)) - 1.0 + ao);
  vec3 indirectSpec = refl * Ess * energy * specOcc;
  if (type == 2) {
    float Fc = 0.04 + 0.96 * pow5(1.0 - NoV);
    vec3 coatRefl = mix(textureLod(uEnvSpec, reflect(-V, N), 0.6).rgb * uEnvIntensity, ssr.rgb, ssr.a);
    indirectSpec = indirectSpec * (1.0 - Fc * param) + coatRefl * Fc * param * specOcc;
  }

  vec3 color = direct + indirectDiffuse + indirectSpec + emissive;
  o = vec4(color, 1.0);
}`;
