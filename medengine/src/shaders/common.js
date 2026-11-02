/**
 * Shared GLSL: constants, encodings, noise, the Cook-Torrance BRDF,
 * spherical harmonics, and the sky model used both on screen and in
 * environment captures.
 */

export const COMMON = /* glsl */`
#define PI 3.14159265359
#define TAU 6.28318530718
#define INV_PI 0.31830988618
float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }
float pow2(float x) { return x * x; }
float pow5(float x) { float x2 = x * x; return x2 * x2 * x; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Octahedral normal encoding (Cigolle et al. 2014): two channels, uniform error.
vec2 octWrap(vec2 v) { return (1.0 - abs(v.yx)) * vec2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0); }
vec2 encodeNormal(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  n.xy = n.z >= 0.0 ? n.xy : octWrap(n.xy);
  return n.xy;
}
vec3 decodeNormal(vec2 f) {
  vec3 n = vec3(f, 1.0 - abs(f.x) - abs(f.y));
  float t = saturate(-n.z);
  n.xy += vec2(n.x >= 0.0 ? -t : t, n.y >= 0.0 ? -t : t);
  return normalize(n);
}

// Hashes and noise.
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// Interleaved gradient noise (Jimenez 2014): a cheap blue-ish per-pixel sequence.
float ign(vec2 pix, float frame) { pix += 5.588238 * mod(frame, 64.0); return fract(52.9829189 * fract(0.06711056 * pix.x + 0.00583715 * pix.y)); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
float vnoise3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z); }
float fbm2(vec2 p, int oct) { float s = 0.0, a = 0.5; for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }

// ---------------------------------------------------------------------------
// Cook-Torrance microfacet BRDF: GGX distribution, height-correlated Smith
// visibility, Schlick Fresnel (Karis 2013, Heitz 2014).
float D_GGX(float NoH, float a) { float a2 = a * a; float d = (NoH * a2 - NoH) * NoH + 1.0; return a2 / (PI * d * d + 1e-7); }
float V_SmithGGXCorrelated(float NoV, float NoL, float a) {
  float a2 = a * a;
  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / (gv + gl + 1e-6);
}
vec3 F_Schlick(vec3 f0, float VoH) { return f0 + (1.0 - f0) * pow5(1.0 - VoH); }
vec3 F_SchlickRoughness(vec3 f0, float NoV, float r) { return f0 + (max(vec3(1.0 - r), f0) - f0) * pow5(1.0 - NoV); }

/** Direct light from one source; returns radiance reflected toward the eye per unit irradiance. */
vec3 brdfDirect(vec3 n, vec3 v, vec3 l, vec3 diffuseColor, vec3 f0, float roughness, out vec3 diffuseOut) {
  vec3 h = normalize(v + l);
  float NoV = abs(dot(n, v)) + 1e-4;
  float NoL = saturate(dot(n, l));
  float NoH = saturate(dot(n, h));
  float VoH = saturate(dot(v, h));
  float a = max(roughness * roughness, 0.002);
  vec3 F = F_Schlick(f0, VoH);
  vec3 spec = D_GGX(NoH, a) * V_SmithGGXCorrelated(NoV, NoL, a) * F;
  diffuseOut = diffuseColor * INV_PI * (1.0 - F);
  return spec;
}

/** Analytic fit of the split-sum DFG term (Karis, "Mobile" 2014), used where the LUT is not bound. */
vec2 envBRDFApprox(float NoV, float r) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 rr = r * c0 + c1;
  float a004 = min(rr.x * rr.x, exp2(-9.28 * NoV)) * rr.x + rr.y;
  return vec2(-1.04, 1.04) * a004 + rr.zw;
}

// ---------------------------------------------------------------------------
// Spherical harmonics, order 2 (9 coefficients), irradiance form
// (Ramamoorthi & Hanrahan 2001). Coefficients are pre-convolved with the
// cosine lobe, so evaluating gives irradiance E(n); divide by PI for radiance.
vec3 shIrradiance(vec3 n, vec3 c[9]) {
  return max(vec3(0.0),
      c[0] * 0.886227
    + c[1] * 1.023328 * n.y + c[2] * 1.023328 * n.z + c[3] * 1.023328 * n.x
    + c[4] * 0.858086 * n.x * n.y + c[5] * 0.858086 * n.y * n.z
    + c[6] * 0.247708 * (3.0 * n.z * n.z - 1.0)
    + c[7] * 0.858086 * n.x * n.z + c[8] * 0.429043 * (n.x * n.x - n.y * n.y));
}
`;

/**
 * Sky radiance in linear HDR (Med Engine 2): one model from a clear day through dusk to a
 * stormy night over a city.
 *   uNight      0 = day, 1 = night (the sun becomes the moon: dim, cold)
 *   uOvercast   0 = fair-weather cumulus, 1 = a low storm deck that hides sun and moon
 *   uCityGlow   light pollution: the underside of the clouds lit by the streets (rgb*intensity)
 *   uLightning  0..1, a flash inside the clouds
 * uSunDir, uTime, uSunColor, uCloudCover as before.
 */
export const SKY = /* glsl */`
uniform vec3 uSunDir;
uniform float uTime;
uniform vec3 uSunColor;
uniform float uCloudCover;
uniform float uNight, uOvercast, uLightning;
uniform vec3 uCityGlow;
uniform vec3 uLightningPos;      // direction of the flash in the cloud deck
vec3 skyRadiance(vec3 d, bool withSun) {
  d = normalize(d);
  float h = d.y;
  float sd = max(dot(d, uSunDir), 0.0);
  // --- day
  vec3 zenith = vec3(0.20, 0.36, 0.66) * 1.25;
  vec3 horizon = vec3(0.92, 0.86, 0.76) * 1.35;
  vec3 ground = vec3(0.30, 0.30, 0.24) * 0.55;
  float dusk = smoothstep(0.25, -0.05, uSunDir.y) * (1.0 - uNight);
  horizon = mix(horizon, vec3(1.2, 0.55, 0.28), dusk * 0.8);
  zenith = mix(zenith, vec3(0.12, 0.16, 0.34), dusk);
  vec3 day = h > 0.0 ? mix(horizon, zenith, pow(saturate(h), 0.5)) : mix(horizon * 0.9, ground, saturate(-h * 5.0));
  day += uSunColor * (pow(sd, 8.0) * 0.55 + pow(sd, 90.0) * 2.4) * smoothstep(-0.1, 0.05, h);
  day += vec3(0.9, 0.55, 0.3) * pow(1.0 - abs(h), 12.0) * pow(sd, 2.0) * (0.6 + dusk);
  // --- night: deep blue zenith, the city's sodium-and-LED glow along the horizon
  vec3 night = mix(vec3(0.010, 0.013, 0.022), vec3(0.003, 0.004, 0.009), pow(saturate(h), 0.6));
  night += uCityGlow * pow(1.0 - saturate(h), 5.0) * 0.6;
  if (h < 0.0) night = mix(night, uCityGlow * 0.25, saturate(-h * 4.0));
  vec3 col = mix(day, night, uNight);
  // overcast dims and greys the day sky
  col = mix(col, vec3(luma(col)) * vec3(0.92, 0.95, 1.0) * mix(0.55, 1.0, uNight), uOvercast * 0.85);
  bool sunVisible = uOvercast < 0.75;
  if (withSun && sunVisible) {
    float disc = smoothstep(0.99955, 0.99975, sd);
    col += uSunColor * disc * mix(400.0, 6.0, uNight) * (1.0 - uOvercast);
  }
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.16) * 1.4 + vec2(uTime * 0.004, uTime * 0.0013) * (1.0 + uOvercast * 4.0);
    float base = fbm2(uv, 6);
    float cover = mix(uCloudCover, 1.0, uOvercast);
    float c = smoothstep(0.62 - 0.45 * cover, 0.86 - 0.3 * uOvercast, base);
    float thick = smoothstep(0.5, 0.95, fbm2(uv * 1.7 + 3.1, 4));
    vec3 lit = mix(vec3(0.72, 0.72, 0.74), vec3(1.25, 1.12, 0.95), pow(sd, 2.5)) * 1.35;
    vec3 shade = vec3(0.48, 0.5, 0.55) * 1.2;
    vec3 dayCloud = mix(lit, shade, thick * 0.7) + uSunColor * pow(sd, 30.0) * (1.0 - thick) * 1.5;
    dayCloud *= mix(1.0, 0.45, uOvercast);
    // night clouds: lit from below by the city, rim of moonlight where thin
    vec3 nightCloud = uCityGlow * (0.35 + 0.65 * (1.0 - thick)) * (0.6 + 0.4 * smoothstep(0.4, 0.0, h))
      + uSunColor * 0.04 * pow(sd, 6.0) * (1.0 - thick) * (1.0 - uOvercast);
    vec3 cloud = mix(dayCloud, nightCloud, uNight);
    col = mix(col, cloud, c * 0.95 * smoothstep(0.0, 0.1, h));
    // lightning: the cloud deck lights up from inside, brightest near the bolt
    if (uLightning > 0.0) {
      float near = pow(max(dot(d, normalize(uLightningPos)), 0.0), 6.0);
      col += vec3(0.75, 0.82, 1.0) * uLightning * (0.4 + 3.5 * near) * (0.4 + 0.6 * c) * 2.5;
    }
  } else if (uLightning > 0.0) col += vec3(0.75, 0.82, 1.0) * uLightning * 0.15;
  return col;
}
`;
