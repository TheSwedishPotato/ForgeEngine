/**
 * Hill Valley's sky at any hour of any year.
 *
 * Day and twilight: a physically based clear atmosphere (Rayleigh, Mie and ozone; Nishita
 * single scattering with an isotropic multiple-scattering share) baked into a sky-view lookup
 * texture whenever the sun moves, after the Gotthard Pullman's sky (Bruneton & Neyret 2008;
 * Hillaire 2020). The same bake is run a second time with the moon as the light source,
 * at the moon's illuminance, and added: the faint blue of a moonlit sky.
 *
 * Night: the moon's disc with its true phase and terminator; the stars, turning with the
 * sidereal time about the celestial pole; the Milky Way along the galactic plane; and the
 * town's own glow on the horizon and the clouds, which grows from nothing in 1885 to the
 * sodium-orange dome of 1985.
 *
 * The SKY_GLSL block replaces the Med Engine's own sky function everywhere it is used: the
 * background, the environment map for reflections, and the spherical harmonics for the
 * ambient light.
 */
import { Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';

export const R_EARTH = 6360e3, R_ATMO = 6420e3;
export const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6];
export const BETA_O = [0.650e-6, 1.881e-6, 0.085e-6];
export const H_R = 8000, H_M = 1200;
/** Top-of-atmosphere solar irradiance in the engine's units (1 unit ~ 10 000 lux at the ground). */
export const SUN_E0 = 10.0;

export const ATMO_GLSL = /* glsl */`
const float Re = ${R_EARTH.toFixed(1)}, Ra = ${R_ATMO.toFixed(1)};
const vec3 bR = vec3(${BETA_R.join(', ')});
const vec3 bO = vec3(${BETA_O.join(', ')});
const float HR = ${H_R.toFixed(1)}, HM = ${H_M.toFixed(1)};
vec3 atmoDensity(float h) {
  h = max(h, 0.0);
  return vec3(exp(-h / HR), exp(-h / HM), max(0.0, 1.0 - abs(h - 25000.0) / 15000.0));
}
float raySphere(vec3 ro, vec3 rd, float R) {
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
    float sunUp = clamp(uSunDir.y * 4.0 + 0.3, 0.0, 1.0);
    L += T * ((sR * pr + sM * pm) * Ts + (sR + sM) * uMs * sunUp / (4.0 * PI)) * dt;
  }
  L *= uSunE;
  if (tg > 0.0) {
    // the ground, seen only in reflections: dry California grass and pavement
    vec3 p = ro + d * tg;
    vec3 T = exp(-(bR * od.x + vec3(uMieExt * 1.11) * od.y + bO * od.z));
    vec3 Ts = transmittanceToSun(p + normalize(p) * 2.0);
    float cosS = max(dot(normalize(p), uSunDir), 0.0);
    L += T * uGroundAlbedo / PI * uSunE * (Ts * cosS + 0.06 * clamp(uSunDir.y * 4.0 + 0.3, 0.0, 1.0));
  }
  o = vec4(L, 1.0);
}`;

/**
 * The engine's skyRadiance(), rewritten. Declares the uniforms the engine's own SKY block
 * did (uSunDir, uTime, uSunColor, uCloudCover) and its own.
 */
export const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir;
uniform float uTime;
uniform vec3 uSunColor;
uniform float uCloudCover;
uniform sampler2D uSkyLUT;
uniform vec4 uClouds;       // cover, overcast deck opacity, cloud brightness, rain murk
uniform vec3 uSunDisc;      // the sun's disc radiance after the air and the clouds
uniform vec3 uOvercast;     // zenith radiance of the overcast deck (sun- and moon-lit)
uniform vec2 uCloudDrift;   // m/s, x east, y north
uniform vec3 uMoonDir;
uniform vec3 uMoonDisc;     // radiance of the full-lit lunar surface after the air and the clouds
uniform mat3 uStarRot;      // equatorial -> world
uniform vec3 uStarsLM;      // stars' brightness, the Milky Way's, the twilight/glow mask
uniform vec3 uGlow;         // the town's light on the horizon (radiance)
vec3 skyClear(vec3 d) {
  float az = atan(d.x, -d.z);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float v = sign(el) * sqrt(abs(el) / (PI * 0.5));
  return texture(uSkyLUT, vec2(az / TAU + 0.5, v * 0.5 + 0.5)).rgb;
}
// a star field on the faces of a cube round the celestial sphere: ~0.5 degree cells, at
// most one star in each, magnitudes skewed to the faint end, colours from blue-white to orange
vec3 starAt(vec3 q) {
  vec3 a = abs(q);
  vec2 uv; float face;
  if (a.x >= a.y && a.x >= a.z) { uv = q.yz / a.x; face = q.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z) { uv = q.xz / a.y; face = q.y > 0.0 ? 2.0 : 3.0; }
  else { uv = q.xy / a.z; face = q.z > 0.0 ? 4.0 : 5.0; }
  const float N = 150.0;
  vec2 g = (uv * 0.5 + 0.5) * N;
  vec2 cell = floor(g), f = g - cell;
  float h = hash12(cell + face * 311.7);
  if (h > 0.42) return vec3(0.0);
  vec2 pos = 0.2 + 0.6 * hash22(cell + face * 97.1);
  float r = length((f - pos) * vec2(1.0));
  float mag = pow(hash12(cell * 1.7 + face * 13.3), 9.0);         // 0 faint .. 1 brightest
  float size = 0.035 + 0.05 * mag;
  float core = exp(-r * r / (size * size));
  float t = hash12(cell * 3.1 + face);
  vec3 col = t < 0.2 ? vec3(0.75, 0.85, 1.25) : t < 0.7 ? vec3(1.0) : t < 0.9 ? vec3(1.15, 1.0, 0.8) : vec3(1.3, 0.85, 0.6);
  return col * core * (0.02 + mag * 1.6);
}
float milkyWay(vec3 q) {
  // the galactic plane: north pole at RA 192.86, Dec 27.13; the centre at RA 266.4, Dec -28.94
  const vec3 ngp = vec3(-0.8676, -0.1981, 0.4560);
  const vec3 gc = vec3(-0.0549, -0.8734, -0.4838);
  float b = dot(q, ngp);
  float band = exp(-b * b / 0.018);
  float core = 0.35 + 0.65 * pow(max(dot(q, gc), 0.0), 3.0);
  float n = fbm2(q.xy * 6.0 + q.z * 3.0, 5) * fbm2(q.yz * 11.0 + 1.7, 3);
  float dust = smoothstep(0.08, 0.0, abs(b + 0.01 * sin(q.x * 9.0))) * 0.6;
  return band * core * (0.4 + 1.4 * n) * (1.0 - dust);
}
vec3 skyRadiance(vec3 d, bool withSun) {
  d = normalize(d);
  vec3 col = skyClear(d);
  float h = d.y;
  // the town's glow, strongest low down
  col += uGlow * exp(-max(h, 0.0) * 7.0) * smoothstep(-0.25, 0.0, h);
  if (h > -0.02) {
    vec3 q = transpose(uStarRot) * d;
    float ext = exp(-0.25 / max(h + 0.04, 0.02));                 // the air dims the stars low down
    col += (starAt(q) * uStarsLM.x + vec3(0.9, 0.92, 1.0) * milkyWay(q) * uStarsLM.y) * ext;
  }
  if (withSun || uMoonDisc.r > 0.0) {
    // the moon: 0.259 degrees in radius, lit from the sun, its maria darker
    float md = dot(d, uMoonDir);
    const float R = 0.004522;
    if (md > 0.99995) {
      vec3 off = (d - uMoonDir * md) / R;
      float r2 = dot(off, off);
      if (r2 < 1.0) {
        vec3 n = off - uMoonDir * sqrt(1.0 - r2);
        float lit = max(dot(n, uSunDir), 0.0);
        vec3 t1 = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
        vec2 m = vec2(dot(off, t1), dot(off, cross(t1, uMoonDir)));
        float maria = 0.6 + 0.4 * smoothstep(0.35, 0.65, fbm2(m * 2.2 + 4.0, 4));
        vec3 disc = uMoonDisc * maria * (lit + 0.002);
        float edge = smoothstep(1.0, 0.96, r2);
        col = mix(col, col * 0.2 + disc, edge);
      }
    }
  }
  float cover = uClouds.x;
  if (cover > 0.001 && h > -0.05) {
    float hh = max(h, 0.0);
    vec3 deck = uOvercast * (1.0 + 2.0 * hh) / 3.0 + uGlow * 0.6;
    vec2 uv = d.xz / (hh + 0.06) * 0.9 + uCloudDrift * uTime * 0.00012;
    float n = fbm2(uv, 6);
    float m = fbm2(uv * 2.3 + 7.1, 4);
    float c = smoothstep(1.0 - cover - 0.12, 1.0 - cover + 0.22, n);
    c = mix(c, 1.0, uClouds.y);
    float sd = max(dot(d, uSunDir), 0.0);
    vec3 lit = uOvercast * (0.9 + 0.5 * m) * uClouds.z + uSunColor * pow(sd, 6.0) * (1.0 - uClouds.y) * 0.25 + uGlow * (0.8 + 0.4 * m);
    vec3 cloud = mix(lit, deck * (0.85 + 0.3 * m), uClouds.y);
    col = mix(col, cloud, c * smoothstep(-0.05, 0.08, h));
    col = mix(col, deck * 0.9, uClouds.w * (1.0 - hh * 0.6));
  }
  if (withSun) {
    float sd = dot(d, uSunDir);
    col += uSunDisc * smoothstep(0.99996, 0.999985, sd);
  }
  return col;
}
`;

/** Sun's (or moon's) direct beam through the clear atmosphere (RGB transmittance). */
export function transmittance(dir, altitude, mieExt) {
  const ro = [0, R_EARTH + altitude, 0];
  const b = ro[1] * dir.y, c = ro[1] * ro[1] - R_ATMO * R_ATMO;
  const t1 = -b + Math.sqrt(b * b - c);
  const cg = ro[1] * ro[1] - R_EARTH * R_EARTH, hg = b * b - cg;
  if (hg > 0 && -b - Math.sqrt(hg) > 0) return [0, 0, 0];
  const od = [0, 0, 0], N = 64;
  for (let i = 0; i < N; i++) {
    const t = ((i + 0.5) / N) ** 2 * t1, dt = (((i + 1) / N) ** 2 - (i / N) ** 2) * t1;
    const x = dir.x * t, y = ro[1] + dir.y * t, z = dir.z * t;
    const h = Math.max(0, Math.hypot(x, y, z) - R_EARTH);
    od[0] += Math.exp(-h / H_R) * dt; od[1] += Math.exp(-h / H_M) * dt; od[2] += Math.max(0, 1 - Math.abs(h - 25000) / 15000) * dt;
  }
  return [0, 1, 2].map((k) => Math.exp(-(BETA_R[k] * od[0] + mieExt * 1.11 * od[1] + BETA_O[k] * od[2])));
}

/** Bakes the clear-sky view (sun-lit plus moon-lit) into a lookup texture (256 x 128, full sphere). */
export class SkyLUT {
  constructor(gl) {
    this.gl = gl;
    this.target = new Target(gl, { width: 256, height: 128, colors: [{ format: 'rgba16f', filter: 'linear' }] });
    this.prog = postProgram(gl, SKY_LUT_FS, {}, 'sky-lut');
  }
  get tex() { return this.target.tex; }
  update({ sunDir, moonDir, moonE, altitude, mieExt, groundAlbedo = 0.2, ms = 0.7 }) {
    const gl = this.gl;
    this.target.bind();
    state(gl);
    const P = this.prog.use().set('uAltitude', altitude).set('uMieExt', mieExt).set('uGroundAlbedo', groundAlbedo).set('uMs', ms);
    P.set('uSunDir', [sunDir.x, sunDir.y, sunDir.z]).set('uSunE', SUN_E0);
    fullscreen(gl);
    if (moonE > 0 && moonDir.y > -0.1) {
      state(gl, { blend: 'add' });
      P.set('uSunDir', [moonDir.x, moonDir.y, moonDir.z]).set('uSunE', moonE);
      fullscreen(gl);
      state(gl);
    }
  }
}
