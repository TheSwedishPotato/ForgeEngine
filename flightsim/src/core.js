// Shared math, geography, time and astronomy helpers.
import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const R_EARTH = 6371000;
export const G = 9.81;
export const KT = 0.514444; // m/s per knot
export const FT = 0.3048;

// Stereographic projection centred between Stockholm and Copenhagen.
// World frame: x = east, y = up, z = south (north is -z), metres.
export const LAT0 = 57.6, LON0 = 15.3;
const sinP0 = Math.sin(LAT0 * DEG), cosP0 = Math.cos(LAT0 * DEG);

export function project(lat, lon, out = { x: 0, z: 0 }) {
  const p = lat * DEG, dl = (lon - LON0) * DEG;
  const sp = Math.sin(p), cp = Math.cos(p), cdl = Math.cos(dl);
  const k = 2 * R_EARTH / (1 + sinP0 * sp + cosP0 * cp * cdl);
  out.x = k * cp * Math.sin(dl);
  out.z = -k * (cosP0 * sp - sinP0 * cp * cdl);
  return out;
}

export function unproject(x, z, out = { lat: 0, lon: 0 }) {
  const y = -z;
  const rho = Math.hypot(x, y);
  if (rho < 1e-6) { out.lat = LAT0; out.lon = LON0; return out; }
  const c = 2 * Math.atan2(rho, 2 * R_EARTH);
  const sc = Math.sin(c), cc = Math.cos(c);
  out.lat = Math.asin(cc * sinP0 + (y * sc * cosP0) / rho) / DEG;
  out.lon = LON0 + Math.atan2(x * sc, rho * cosP0 * cc - y * sinP0 * sc) / DEG;
  return out;
}

export const P = (lat, lon) => { const p = project(lat, lon); return new THREE.Vector2(p.x, p.z); };

// Heading (deg, clockwise from north) of a direction in world x/z.
export const headingOf = (dx, dz) => ((Math.atan2(dx, -dz) / DEG) + 360) % 360;
export const dirOfHeading = (hdgDeg) => new THREE.Vector2(Math.sin(hdgDeg * DEG), -Math.cos(hdgDeg * DEG));

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const smoothstep = (a, b, x) => smooth((x - a) / (b - a));
export const damp = (cur, target, rate, dt) => target + (cur - target) * Math.exp(-rate * dt);
export function dampAngle(cur, target, rate, dt) {
  let d = ((target - cur + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return cur + d * (1 - Math.exp(-rate * dt));
}
export const wrapDeg = (d) => ((d % 360) + 540) % 360 - 180;

// Deterministic PRNG (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a0, b0) => a0 + (b0 - a0) * f();
  f.int = (a0, b0) => Math.floor(a0 + (b0 - a0 + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  f.gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += f(); return (s - 2) * 1.73; };
  return f;
}

export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth value noise in JS (used for turbulence, placement etc.).
export function vnoise1(x) {
  const i = Math.floor(x), f = x - i;
  const a = hash2(i, 17), b = hash2(i + 1, 17);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}
export function vnoise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export function fbm2(x, y, oct = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * vnoise2(x * f, y * f); f *= 2.03; amp *= 0.5; }
  return s;
}

// ISA atmosphere
export function isa(h) {
  const T = h < 11000 ? 288.15 - 0.0065 * h : 216.65;
  const p = h < 11000 ? 101325 * Math.pow(T / 288.15, 5.2559) : 22632 * Math.exp(-(h - 11000) / 6341.6);
  const rho = p / (287.05 * T);
  return { T, p, rho, a: Math.sqrt(1.4 * 287.05 * T), sigma: rho / 1.225 };
}

// ---------- Time & astronomy ----------
// Simulation date: Sunday 10 May 2026, CEST (UTC+2) in both Sweden and Denmark.
export const DATE = { y: 2026, m: 5, d: 10, utcOffset: 2 };

export function julianDay(y, m, d, hUTC) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5 + hUTC / 24;
}

// Returns sun {az, el} in radians (az clockwise from north) — NOAA algorithm.
export function sunPosition(localHours, lat, lon) {
  const hUTC = localHours - DATE.utcOffset;
  const jd = julianDay(DATE.y, DATE.m, DATE.d, hUTC);
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * DEG) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * DEG) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * DEG) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * DEG);
  const decl = Math.asin(Math.sin(eps * DEG) * Math.sin(lambda * DEG));
  const y = Math.tan(eps * DEG / 2) ** 2;
  const eqTime = 4 / DEG * (y * Math.sin(2 * L0 * DEG) - 2 * e * Math.sin(M * DEG) + 4 * e * y * Math.sin(M * DEG) * Math.cos(2 * L0 * DEG) - 0.5 * y * y * Math.sin(4 * L0 * DEG) - 1.25 * e * e * Math.sin(2 * M * DEG));
  const trueSolarMin = ((hUTC * 60 + eqTime + 4 * lon) % 1440 + 1440) % 1440;
  let ha = trueSolarMin / 4 - 180;
  const phi = lat * DEG, H = ha * DEG;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const zen = Math.acos(clamp(cosZ, -1, 1));
  let az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI;
  return { az, el: Math.PI / 2 - zen };
}

// Low-precision moon position (az/el radians) and illuminated fraction.
export function moonPosition(localHours, lat, lon) {
  const hUTC = localHours - DATE.utcOffset;
  const jd = julianDay(DATE.y, DATE.m, DATE.d, hUTC);
  const d = jd - 2451545;
  const L = (218.316 + 13.176396 * d) * DEG, Mm = (134.963 + 13.064993 * d) * DEG, F = (93.272 + 13.229350 * d) * DEG;
  const lamb = L + 6.289 * DEG * Math.sin(Mm), beta = 5.128 * DEG * Math.sin(F);
  const eps = 23.439 * DEG;
  const ra = Math.atan2(Math.sin(lamb) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps), Math.cos(lamb));
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lamb));
  const gmst = (280.46061837 + 360.98564736629 * d) * DEG;
  const H = gmst + lon * DEG - ra, phi = lat * DEG;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
  const Ms = (357.529 + 0.98560028 * d) * DEG, Ls = (280.459 + 0.98564736 * d) * DEG + 1.915 * DEG * Math.sin(Ms);
  const elong = Math.acos(Math.cos(lamb - Ls) * Math.cos(beta));
  return { az, el, illum: (1 - Math.cos(elong)) / 2 };
}

// Direction vector (world) from az/el.
export function azElToVec(az, el, out = new THREE.Vector3()) {
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

export function fmtClock(localHours, seconds = false) {
  let h = ((localHours % 24) + 24) % 24;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.floor(((h - hh) * 60 - mm) * 60);
  const p = (n) => String(n).padStart(2, '0');
  return seconds ? `${p(hh)}:${p(mm)}:${p(ss)}` : `${p(hh)}:${p(mm)}`;
}

// GLSL: earth-curvature drop applied in view space (precise near the camera).
export const CURVE_GLSL = /* glsl */`
uniform vec3 uViewUp;
vec4 curveView(vec4 mv) {
  float v = dot(mv.xyz, uViewUp);
  float h2 = max(dot(mv.xyz, mv.xyz) - v * v, 0.0);
  mv.xyz -= uViewUp * (h2 / (2.0 * 6371000.0));
  return mv;
}
`;

// Shared uniform object for view-space up vector; updated per frame by the world renderer.
export const sharedUniforms = {
  uViewUp: { value: new THREE.Vector3(0, 1, 0) },
  uGFog: { value: new THREE.Vector4(0, 0, 1, 0) }, uGFogTop: { value: 60 }, uGFogCol: { value: new THREE.Color(0.8, 0.82, 0.85) },
  uCamPosW: { value: new THREE.Vector3() },
};

// Patch a built-in material so it follows earth curvature.
export function curveMaterial(mat) {
  mat.onBeforeCompile = (shader) => {
    for (const k of ['uViewUp', 'uGFog', 'uGFogTop', 'uGFogCol', 'uCamPosW']) shader.uniforms[k] = sharedUniforms[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + CURVE_GLSL + `
        uniform vec4 uGFog; uniform float uGFogTop; uniform vec3 uCamPosW; varying float vGF;`)
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        vec3 gfW = (modelMatrix * mvPosition).xyz;
        mvPosition = curveView(modelViewMatrix * mvPosition);
        gl_Position = projectionMatrix * mvPosition;
        vGF = 0.0;
        if (uGFog.w > 0.0) {
          // optical depth through a fog layer that thins out exponentially with height
          float Hf = uGFogTop * 0.6; vec3 dv = gfW - uCamPosW; float dist = length(dv);
          float hc = max(uCamPosW.y, 0.0), hp = max(gfW.y, 0.0), dh = hc - hp;
          float od = abs(dh) < 0.5 ? exp(-hc / Hf) * dist : Hf * dist / dh * (exp(-hp / Hf) - exp(-hc / Hf));
          float wgt = 1.0 - smoothstep(uGFog.z * 0.6, uGFog.z, length(gfW.xz - uGFog.xy));
          vGF = 1.0 - exp(-uGFog.w * od * wgt);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGFogCol; varying float vGF;')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\n gl_FragColor.rgb = mix(gl_FragColor.rgb, uGFogCol, vGF);');
  };
  mat.customProgramCacheKey = () => 'curved';
  return mat;
}

export class EventBus {
  constructor() { this.h = new Map(); }
  on(ev, fn) { if (!this.h.has(ev)) this.h.set(ev, []); this.h.get(ev).push(fn); return () => this.off(ev, fn); }
  off(ev, fn) { const a = this.h.get(ev); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(ev, data) { const a = this.h.get(ev); if (a) for (const fn of [...a]) fn(data); }
}
export const bus = new EventBus();
