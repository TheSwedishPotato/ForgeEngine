/**
 * Falling snow round the camera: flakes in a box that travels with the eye, falling at about
 * 1 m/s and carried by the wind, drawn as short soft streaks along their motion relative to the
 * eye, so from a moving train they stream past the windows. Light snow ~2,500 flakes in view,
 * a heavy fall or a blizzard ~9,000. Hidden behind the car's walls (depth tested) and lit by
 * the sky (and the sun when there is one).
 */
import { Program, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';

const MAX = 12000;

const VS = /* glsl */`
${COMMON}
uniform mat4 uViewProj, uView;
uniform vec3 uCamera;          // world position of the eye (floating origin)
uniform vec3 uCamVel;          // the eye's velocity (m/s)
uniform vec3 uWind;            // the air's velocity (m/s), with the fall
uniform vec3 uBox;             // box size (m)
uniform float uTime, uShutter, uCount;
uniform vec3 uOriginShift;     // floating origin (map), so the flakes do not jump when it moves
out float vAlpha; out vec2 vQ; out float vDist;
void main() {
  int id = gl_VertexID / 6, corner = gl_VertexID % 6;
  if (float(id) >= uCount) { gl_Position = vec4(2.0); return; }
  vec3 h = vec3(hash12(vec2(float(id), 1.7)), hash12(vec2(float(id), 9.3)), hash12(vec2(float(id), 4.1)));
  // each flake drifts on its own a little (tumbling) around the wind
  float tum = hash12(vec2(float(id), 2.2)) * 6.28;
  vec3 vel = uWind + vec3(sin(uTime * 1.3 + tum) * 0.35, -0.25 * h.y, cos(uTime * 1.1 + tum) * 0.35);
  vec3 p = h * uBox + vel * uTime - uOriginShift;
  // wrap into the box centred on the eye
  p = uCamera + (mod(p - uCamera + uBox * 0.5, uBox) - uBox * 0.5);
  vec3 rel = vel - uCamVel;                         // motion relative to the eye
  vec4 vp = uView * vec4(p, 1.0);
  float dist = -vp.z;
  if (dist < 0.25) { gl_Position = vec4(2.0); return; }
  vec3 tail = rel * uShutter;
  vec2 Q[6] = vec2[](vec2(0, -1), vec2(1, -1), vec2(1, 1), vec2(0, -1), vec2(1, 1), vec2(0, 1));
  vec2 q = Q[corner];
  vec4 a = uViewProj * vec4(p, 1.0), b = uViewProj * vec4(p - tail, 1.0);
  vec2 sa = a.xy / a.w, sb = b.xy / b.w;
  vec2 d = sb - sa;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(0.0, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float w = max(0.006 / dist, 0.0028);              // a flake ~6 mm, at least ~2 px wide
  vec2 sp = mix(sa, sb, q.x) + perp * q.y * w;
  gl_Position = vec4(sp * mix(a.w, b.w, q.x), mix(a.z, b.z, q.x), mix(a.w, b.w, q.x));
  vAlpha = (0.55 + 0.45 * h.z) * smoothstep(0.25, 1.0, dist) * (1.0 - smoothstep(uBox.x * 0.35, uBox.x * 0.5, dist)) / (1.0 + len * 40.0);
  vQ = q;
  vDist = mix(a.w, b.w, q.x);
}`;

const FS = /* glsl */`
in float vAlpha; in vec2 vQ; in float vDist;
uniform highp sampler2D uDepth;
uniform mat4 uInvProj;
uniform vec3 uLight;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uDepth, 0));
  float a = vAlpha * (1.0 - vQ.y * vQ.y);
  if (a < 0.004) discard;
  // behind something nearer (the car's walls and roof, a tunnel, the ground)? hidden
  float z = texture(uDepth, uv).r;
  if (z < 1.0) {
    vec4 sp = uInvProj * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
    if (-sp.z / sp.w < vDist - 0.02) discard;
  }
  o = vec4(uLight * a, a);
}`;

export class Snowfall {
  constructor(stage) {
    this.name = 'snowfall';
    this.enabled = true;
    this.stage = stage;
    this.count = 0;
    this.time = 0;
    this.camVel = [0, 0, 0];
    this.wind = [0, -1, 0];
    this._prev = null;
  }
  init(r) { this.prog = new Program(r.gl, VS, FS, {}, 'snowfall'); this.vao = r.gl.createVertexArray(); }

  setWeather(weather) {
    const p = weather.p;
    this.count = Math.min(MAX, Math.round((p.snowfall ?? 0) * 3500));
    // the wind blows from windFrom (degrees, map); world x east, z south
    const a = ((p.windFrom ?? 0) * Math.PI) / 180, w = p.wind ?? 0;
    this.wind = [-Math.sin(a) * w, -1.05, Math.cos(a) * w];
    this.enabled = this.count > 0;
  }

  afterLighting(r, color) {
    if (!this.count) return color;
    const gl = r.gl;
    const dt = Math.max(1e-3, r.dt ?? 0.016);
    this.time += dt;
    // the eye's velocity in the world (map motion, so a recentre of the origin is not a jump)
    const m = this.stage.toMap(r.cameraPos);
    if (this._prev) {
      const v = [(m.x - this._prev.x) / dt, (m.z - this._prev.z) / dt, -(m.y - this._prev.y) / dt];
      for (let i = 0; i < 3; i++) this.camVel[i] += (Math.max(-80, Math.min(80, v[i])) - this.camVel[i]) * Math.min(1, dt * 8);
    }
    this._prev = { ...m };
    const o = this.stage.origin;
    const sh = r.env.sh, k = 0.282095 / Math.PI * 2.4;
    const sun = r.sunIntensity * Math.max(0, r.sunDir.y) * 0.15;
    const light = [sh[0] * k + r.sunColor.x * sun, sh[1] * k + r.sunColor.y * sun, sh[2] * k + r.sunColor.z * sun];
    // draw into the lit image before the temporal filter (the streaks carry the motion)
    r.hdrDepth.bind();
    state(gl, { depthTest: true, depthWrite: false });
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    this.prog.use().set('uViewProj', r.viewProjJit).set('uView', r.view).set('uCamera', r.cameraPos).set('uCamVel', this.camVel)
      .set('uWind', this.wind).set('uBox', [36, 22, 36]).set('uTime', this.time).set('uShutter', 1 / 60).set('uCount', this.count)
      .set('uOriginShift', [o.x % 36, o.z % 22, (-o.y) % 36]).set('uDepth', r.depth).set('uInvProj', r.invProj).set('uLight', light);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.count * 6);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    state(gl);
    return color;
  }
}
