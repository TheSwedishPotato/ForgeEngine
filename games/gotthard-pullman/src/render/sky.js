/**
 * The sky over the Reuss valley: a physically based clear atmosphere (Rayleigh scattering by
 * the air, Mie scattering by aerosols, absorption by ozone; Nishita-style single scattering
 * with a simple multiple-scattering term) baked into a sky-view lookup texture whenever the
 * sun or the weather changes, and the weather's clouds on top of it: from a few fair-weather
 * clouds to the grey, even overcast of a snowfall (CIE overcast sky, luminance rising to the
 * zenith as (1 + 2 sin h) / 3).
 *
 * Coefficients (sea level): Rayleigh 5.802, 13.558, 33.1 x 1e-6 /m (scale height 8 km);
 * ozone absorption 0.650, 1.881, 0.085 x 1e-6 /m round 25 km; aerosols by the weather's
 * visibility (Koschmieder: extinction = 3.912 / visibility), scale height 1.2 km, phase
 * Cornette-Shanks g = 0.8. (Bruneton & Neyret 2008; Hillaire 2020.)
 *
 * The SKY_GLSL block replaces the Med Engine's own sky function (an autumn afternoon over
 * Bohemia) everywhere it is used: the background, the environment map for reflections, and
 * the spherical harmonics for the ambient light.
 */
import { Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';

export const R_EARTH = 6360e3, R_ATMO = 6420e3;
export const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6];
export const BETA_O = [0.650e-6, 1.881e-6, 0.085e-6];
export const H_R = 8000, H_M = 1200;
export const SUN_E0 = 10.0;           // top-of-atmosphere irradiance in the engine's units

export const ATMO_GLSL = /* glsl */`
const float Re = ${R_EARTH.toFixed(1)}, Ra = ${R_ATMO.toFixed(1)};
const vec3 bR = vec3(${BETA_R.join(', ')});
const vec3 bO = vec3(${BETA_O.join(', ')});
const float HR = ${H_R.toFixed(1)}, HM = ${H_M.toFixed(1)};
// densities at a height above sea level: rayleigh, mie, ozone
vec3 atmoDensity(float h) {
  h = max(h, 0.0);
  return vec3(exp(-h / HR), exp(-h / HM), max(0.0, 1.0 - abs(h - 25000.0) / 15000.0));
}
float raySphere(vec3 ro, vec3 rd, float R) {     // far hit distance, -1 if none
  float b = dot(ro, rd), c = dot(ro, ro) - R * R, h = b * b - c;
  if (h < 0.0) return -1.0;
  return -b + sqrt(h);
}
float rayGround(vec3 ro, vec3 rd) {
  float b = dot(ro, rd), c = dot(ro, ro) - Re * Re, h = b * b - c;
  if (h < 0.0) return -1.0;
  float t = -b - sqrt(h);
  return t > 0.0 ? t : -1.0;
}
float phaseR(float c) { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
float phaseM(float c, float g) { float g2 = g * g; return 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
`;

const SKY_LUT_FS = /* glsl */`
${COMMON}
${ATMO_GLSL}
in vec2 vUv; out vec4 o;
uniform vec3 uSunDir;
uniform float uAltitude, uMieExt, uSunE, uGroundAlbedo, uMs;
vec3 lutDir(vec2 uv) {
  float az = (uv.x - 0.5) * TAU;
  float v = uv.y * 2.0 - 1.0;
  float el = sign(v) * v * v * (PI * 0.5);
  return vec3(cos(el) * sin(az), sin(el), -cos(el) * cos(az));
}
vec3 transmittanceToSun(vec3 p) {
  vec3 up = normalize(p);
  if (rayGround(p, uSunDir) > 0.0) return vec3(0.0);
  float t1 = raySphere(p, uSunDir, Ra);
  vec3 od = vec3(0.0);
  const int N = 10;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N); t = t * t * t1;
    float dt = (pow((float(i) + 1.0) / float(N), 2.0) - pow(float(i) / float(N), 2.0)) * t1;
    od += atmoDensity(length(p + uSunDir * t) - Re) * dt;
  }
  return exp(-(bR * od.x + vec3(uMieExt * 1.11) * od.y + bO * od.z));
}
void main() {
  vec3 d = lutDir(vUv);
  vec3 ro = vec3(0.0, Re + uAltitude, 0.0);
  float tg = rayGround(ro, d);
  float tEnd = tg > 0.0 ? tg : raySphere(ro, d, Ra);
  float mu = dot(d, uSunDir);
  float pr = phaseR(mu), pm = phaseM(mu, 0.8);
  vec3 L = vec3(0.0), od = vec3(0.0);
  const int N = 24;
  for (int i = 0; i < N; i++) {
    float a = float(i) / float(N), b = float(i + 1) / float(N);
    float t0 = a * a * tEnd, t1 = b * b * tEnd, dt = t1 - t0;
    vec3 p = ro + d * (t0 + dt * 0.5);
    vec3 dens = atmoDensity(length(p) - Re);
    od += dens * dt;
    vec3 T = exp(-(bR * od.x + vec3(uMieExt * 1.11) * od.y + bO * od.z));
    vec3 Ts = transmittanceToSun(p);
    vec3 sR = bR * dens.x, sM = vec3(uMieExt) * dens.y;
    // single scattering, plus an isotropic multiple-scattering share (lifts the shadowed sky)
    float sunUp = clamp(uSunDir.y * 4.0 + 0.3, 0.0, 1.0);
    L += T * ((sR * pr + sM * pm) * Ts + (sR + sM) * uMs * sunUp / (4.0 * PI)) * dt;
  }
  L *= uSunE;
  if (tg > 0.0) {
    // the ground (seen in reflections only): snow and forest lit by the sun and the sky
    vec3 p = ro + d * tg;
    vec3 T = exp(-(bR * od.x + vec3(uMieExt * 1.11) * od.y + bO * od.z));
    vec3 Ts = transmittanceToSun(p + normalize(p) * 2.0);
    float cosS = max(dot(normalize(p), uSunDir), 0.0);
    // (much of the valley's ground lies in the mountains' shadow: about half of it sunlit)
    L += T * uGroundAlbedo / PI * uSunE * (Ts * cosS * 0.35 + 0.035);
  }
  o = vec4(L, 1.0);
}`;

/**
 * The engine's skyRadiance(), rewritten: the baked clear sky, the weather's clouds, the sun's disc.
 * Declares the uniforms the engine's own SKY block did (uSunDir, uTime, uSunColor, uCloudCover).
 */
export const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir;
uniform float uTime;
uniform vec3 uSunColor;
uniform float uCloudCover;
uniform sampler2D uSkyLUT;
uniform vec4 uClouds;       // cover (0..1), opacity of the deck (0 broken .. 1 overcast), cloud brightness, precipitation murk
uniform vec3 uSunDisc;      // the disc's radiance, through the air and the clouds
uniform vec3 uOvercast;     // zenith radiance of the overcast deck
uniform vec2 uCloudDrift;   // m/s over the ground, x east, y north
vec3 skyClear(vec3 d) {
  float az = atan(d.x, -d.z);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float v = sign(el) * sqrt(abs(el) / (PI * 0.5));
  return texture(uSkyLUT, vec2(az / TAU + 0.5, v * 0.5 + 0.5)).rgb;
}
vec3 skyRadiance(vec3 d, bool withSun) {
  d = normalize(d);
  vec3 col = skyClear(d);
  float h = d.y;
  float cover = uClouds.x;
  if (cover > 0.001 && h > -0.05) {
    float hh = max(h, 0.0);
    // the deck: an overcast sky brightens toward the zenith (CIE standard overcast)
    vec3 deck = uOvercast * (1.0 + 2.0 * hh) / 3.0;
    // cloud texture projected on a layer: wavy stratocumulus when broken, faint structure when overcast
    vec2 uv = d.xz / (hh + 0.06) * 0.9 + uCloudDrift * uTime * 0.00012;
    float n = fbm2(uv, 6);
    float m = fbm2(uv * 2.3 + 7.1, 4);
    float c = smoothstep(1.0 - cover - 0.12, 1.0 - cover + 0.22, n);
    c = mix(c, 1.0, uClouds.y);                        // overcast: the whole sky
    float sd = max(dot(d, uSunDir), 0.0);
    vec3 lit = uOvercast * (0.9 + 0.5 * m) * uClouds.z + uSunColor * pow(sd, 6.0) * (1.0 - uClouds.y) * 0.25;
    vec3 cloud = mix(lit, deck * (0.85 + 0.3 * m), uClouds.y);
    float horizonFade = smoothstep(-0.05, 0.08, h);
    col = mix(col, cloud, c * horizonFade);
    // falling snow: the far sky fades into the murk
    col = mix(col, deck * 0.9, uClouds.w * (1.0 - hh * 0.6));
  }
  if (withSun) {
    float sd = dot(d, uSunDir);
    col += uSunDisc * smoothstep(0.99996, 0.999985, sd);
  }
  return col;
}
`;

/** The weather's sky: aerosols by visibility, clouds. */
export function skyParams(weather) {
  const p = weather.p;
  const vis = p.visibility ?? 60000;
  const clouds = {
    clear: [0.12, 0.0, 1.0, 0.0],
    snowfall: [0.97, 0.92, 0.85, 0.25],
    heavy: [1.0, 1.0, 0.7, 0.55],
    foehn: [0.35, 0.0, 1.05, 0.0],
    fog: [1.0, 0.85, 0.9, 0.0],
    blizzard: [1.0, 1.0, 0.6, 0.75],
  }[p.id] ?? [0.3, 0.0, 1.0, 0.0];
  // aerosol extinction at the ground from the far visibility (the weather's own fog and snow are in the atmosphere pass)
  const clearVis = { clear: 120000, foehn: 160000, snowfall: 40000, heavy: 30000, fog: 30000, blizzard: 25000 }[p.id] ?? 60000;
  void vis;
  return { mieExt: Math.max(4e-6, 3.912 / clearVis - 1.3e-5), clouds };
}

/** Sun's direct beam at an altitude through the clear atmosphere (RGB, engine units). */
export function sunTransmittance(sunDir, altitude, mieExt) {
  const ro = [0, R_EARTH + altitude, 0];
  const b = ro[1] * sunDir.y, c = ro[1] * ro[1] - R_ATMO * R_ATMO;
  const t1 = -b + Math.sqrt(b * b - c);
  // below the geometric horizon of the earth: dark
  const cg = ro[1] * ro[1] - R_EARTH * R_EARTH, hg = b * b - cg;
  if (hg > 0 && -b - Math.sqrt(hg) > 0) return [0, 0, 0];
  const od = [0, 0, 0], N = 64;
  for (let i = 0; i < N; i++) {
    const t = ((i + 0.5) / N) ** 2 * t1, dt = (((i + 1) / N) ** 2 - (i / N) ** 2) * t1;
    const x = sunDir.x * t, y = ro[1] + sunDir.y * t, z = sunDir.z * t;
    const h = Math.max(0, Math.hypot(x, y, z) - R_EARTH);
    od[0] += Math.exp(-h / H_R) * dt; od[1] += Math.exp(-h / H_M) * dt; od[2] += Math.max(0, 1 - Math.abs(h - 25000) / 15000) * dt;
  }
  return [0, 1, 2].map((k) => Math.exp(-(BETA_R[k] * od[0] + mieExt * 1.11 * od[1] + BETA_O[k] * od[2])));
}

/** Bakes the clear-sky view into a lookup texture (256 x 128, full sphere). */
export class SkyLUT {
  constructor(gl) {
    this.gl = gl;
    this.target = new Target(gl, { width: 256, height: 128, colors: [{ format: 'rgba16f', filter: 'linear' }] });
    this.prog = postProgram(gl, SKY_LUT_FS, {}, 'sky-lut');
  }
  get tex() { return this.target.tex; }
  update({ sunDir, altitude, mieExt, groundAlbedo = 0.55, ms = 0.7 }) {
    const gl = this.gl;
    this.target.bind();
    state(gl);
    this.prog.use().set('uSunDir', [sunDir.x, sunDir.y, sunDir.z]).set('uAltitude', altitude).set('uMieExt', mieExt)
      .set('uSunE', SUN_E0).set('uGroundAlbedo', groundAlbedo).set('uMs', ms);
    fullscreen(gl);
  }
}
