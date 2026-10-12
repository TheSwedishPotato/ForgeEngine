/**
 * Aerial perspective and the weather's murk, applied to the lit image.
 *
 * Every pixel's view ray is marched (16 steps, longer toward the end) through the same air
 * the sky is made of (Rayleigh, Mie and ozone, sky.js) plus the weather: the freezing fog
 * lying in the valley up to its top, the falling snow (extinction 3.912 / visibility,
 * Koschmieder). Sunlight scattered toward the eye only comes from air the sun reaches: each
 * step looks up the mountain shadows (the terrain light map), so the air in the shaded valley
 * stays clear and cold while the haze glows over sunlit slopes. Blended onto the lit HDR image
 * as L = L * T + S (premultiplied: one pass, no copy).
 */
import { postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';
import { ATMO_GLSL, SUN_E0 } from './sky.js';
import { TERRAIN_LIGHT_GLSL } from './terrainLight.js';

const FS = /* glsl */`
${COMMON}
${ATMO_GLSL}
${TERRAIN_LIGHT_GLSL}
in vec2 vUv; out vec4 o;
uniform highp sampler2D uDepth;
uniform mat4 uInvViewProj;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform vec3 uSunTop;          // sun irradiance above the atmosphere (engine units)
uniform vec3 uSunBeam;         // direct beam at the camera (through air and clouds)
uniform float uMieExt;
uniform vec4 uFog;             // fog extinction (1/m), fog top (m), fog edge softness (m), snowfall extinction (1/m)
uniform vec3 uAmbient;         // sky irradiance / 4 pi, for the isotropic part
uniform float uFrame;
uniform float uSkyMurk;        // how much of the fog applies to the sky itself
void main() {
  float d = texture(uDepth, vUv).r;
  vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 p1 = wp.xyz / wp.w;
  vec3 ray = p1 - uCameraPos;
  float L = length(ray);
  vec3 dir = ray / max(L, 1e-4);
  bool sky = d >= 1.0;
  float camH = uCameraPos.y + uOrigin.z;
  if (sky) {
    // the sky already holds the clear air; only the weather's own murk lies in front of it
    float fogTop = uFog.y;
    float through = dir.y > 0.01 ? max(0.0, fogTop - camH) / dir.y : 30000.0;
    L = min(through + (uFog.w > 0.0 ? 6000.0 : 0.0), 30000.0);
  }
  float jitter = ign(gl_FragCoord.xy, uFrame);
  float mu = dot(dir, uSunDir);
  float pr = phaseR(mu), pm = phaseM(mu, 0.8), pf = phaseM(mu, 0.6);
  vec3 T = vec3(1.0), S = vec3(0.0);
  const int N = 16;
  for (int i = 0; i < N; i++) {
    float a = (float(i) + jitter) / float(N), b = (float(i) + 1.0 + jitter) / float(N);
    float t0 = a * a * L, t1 = min(b * b, 1.0) * L, dt = max(t1 - t0, 0.0);
    vec3 p = uCameraPos + dir * (t0 + dt * 0.5);
    float h = p.y + uOrigin.z;
    vec3 dens = sky ? vec3(0.0) : atmoDensity(h);
    float fog = uFog.x * smoothstep(uFog.y + uFog.z, uFog.y - uFog.z, h);
    float snow = uFog.w * smoothstep(3500.0, 2500.0, h);
    vec3 ext = bR * dens.x + vec3(uMieExt * 1.11) * dens.y + bO * dens.z + vec3(fog + snow);
    vec3 sR = bR * dens.x, sM = vec3(uMieExt) * dens.y;
    float sun = terrainSun(p);
    vec3 beam = uSunTop * exp(-(bR * 8000.0 * exp(-h / HR) + uMieExt * 1.11 * 1200.0 * exp(-h / HM)) / max(uSunDir.y, 0.05) * 0.85);
    beam = min(beam, uSunBeam * 1.5 + 1e-3);
    vec3 src = (sR * pr + sM * pm) * beam * sun + (sR + sM) * uAmbient * 4.0 * PI * 0.08
             + vec3(fog) * (beam * sun * pf * 0.5 + uAmbient * 0.95)
             + vec3(snow) * (beam * sun * 0.25 / (4.0 * PI) + uAmbient * 0.9);
    vec3 tr = exp(-ext * dt);
    S += T * src * (1.0 - tr) / max(ext, vec3(1e-9));
    T *= tr;
  }
  if (sky) { S *= uSkyMurk; T = mix(vec3(1.0), T, uSkyMurk); }
  o = vec4(S, (T.r + T.g + T.b) / 3.0);
}`;

export class Atmosphere {
  constructor(stage) {
    this.name = 'atmosphere';
    this.enabled = true;
    this.stage = stage;
    this.fog = [0, 1e4, 60, 0];
    this.mieExt = 1e-5;
    this.ambient = [0.05, 0.06, 0.08];
    this.skyMurk = 1;
  }
  init(r) { this.prog = postProgram(r.gl, FS, {}, 'atmosphere'); }

  setWeather(weather) {
    const p = weather.p;
    const vis = p.visibility ?? 60000;
    const fogExt = p.fog ? 3.912 / Math.max(50, vis) : 0;
    const snowExt = p.snowfall > 0 ? 3.912 / Math.max(80, vis) : 0;
    this.fog = [fogExt, p.fogTop ?? 1e4, 70, snowExt];
    this.skyMurk = p.fog || p.snowfall > 0 ? 1 : 0;
  }

  afterLighting(r, color) {
    const gl = r.gl, st = this.stage;
    r.hdr.bind();
    state(gl);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.SRC_ALPHA, gl.ZERO, gl.ONE);
    const sh = r.env.sh, k = 0.282095 / Math.PI;      // SH L00 -> mean radiance
    const amb = [Math.max(0, sh[0] * k), Math.max(0, sh[1] * k), Math.max(0, sh[2] * k)];
    const P = this.prog.use();
    P.set('uDepth', r.depth).set('uInvViewProj', r.invViewProj).set('uCameraPos', r.cameraPos).set('uSunDir', r.sunDir)
      .set('uSunTop', [SUN_E0, SUN_E0, SUN_E0]).set('uSunBeam', [r.sunColor.x * r.sunIntensity, r.sunColor.y * r.sunIntensity, r.sunColor.z * r.sunIntensity])
      .set('uMieExt', st.sky?.mieExt ?? this.mieExt).set('uFog', this.fog).set('uAmbient', amb).set('uFrame', r.frame).set('uSkyMurk', this.skyMurk);
    st.terrainLight?.bind(P, st.origin);
    fullscreen(gl);
    gl.disable(gl.BLEND);
    return color;
  }
}
