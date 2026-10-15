/**
 * The sea's surface, drawn over the finished image (as Gotthard's window glass is) so the waves
 * stay crisp: a grid of rings round the eye, its height the same dozen Airy waves the boat floats
 * in (sea.js), so what you see is what she rolls to.
 *
 * From above: the sky mirrored by Fresnel's law (2 % looking straight down, all of it at grazing)
 * and the sun's glitter; the rest is the sea under it (the water pass has already coloured that).
 * From below: Snell's window, the whole sky squeezed into a circle 97 degrees across overhead;
 * outside it the surface is a mirror (total internal reflection) of the blue depths.
 * Never inside the boat: the surface stops at her hull.
 */
import { Program, Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';
import { WATER, RAY_BOAT_GLSL } from './water.js';

const NW = 12;

const VS = /* glsl */`
layout(location = 0) in vec2 aPolar;          // radius (m), angle
uniform vec3 uCameraPos;
uniform mat4 uViewProj;
uniform vec2 uOrigin;
uniform float uTime, uSeaY;
uniform vec4 uWave[${NW}];                     // kx, kz, omega, amplitude
uniform vec4 uWaveP[${NW}];                    // phase
uniform int uWaves;
out vec3 vWorld; out vec3 vNormal; out vec4 vClip; out float vDist;
void main() {
  vec2 xz = uCameraPos.xz + aPolar.x * vec2(cos(aPolar.y), sin(aPolar.y));
  float fade = 1.0 - smoothstep(250.0, 1800.0, aPolar.x);
  float y = uSeaY; vec2 g = vec2(0.0);
  for (int i = 0; i < ${NW}; i++) {
    if (i >= uWaves) break;
    vec4 W = uWave[i];
    float th = W.x * (xz.x + uOrigin.x) + W.y * (xz.y + uOrigin.y) - W.z * uTime + uWaveP[i].x;
    y += W.w * cos(th) * fade;
    g -= W.w * sin(th) * W.xy * fade;
  }
  vNormal = normalize(vec3(-g.x, 1.0, -g.y));
  vWorld = vec3(xz.x, y, xz.y);
  vDist = aPolar.x;
  vClip = uViewProj * vec4(vWorld, 1.0);
  gl_Position = vClip;
}`;

const FS = /* glsl */`
${COMMON}
in vec3 vWorld; in vec3 vNormal; in vec4 vClip; in float vDist;
uniform highp sampler2D uDepth;
uniform mat4 uInvProj;
uniform samplerCube uEnv;
uniform vec3 uCameraPos, uSunDir, uSunIrr;
uniform mat4 uBoatInv;
uniform vec4 uHull, uCT, uObs;
uniform vec3 uKd, uC, uWaterRad;
uniform float uTime, uSeaY, uDebug;
out vec4 o;
${RAY_BOAT_GLSL}
bool inBoat(vec3 w) {
  vec3 q = (uBoatInv * vec4(w, 1.0)).xyz;
  float dy = q.y - uHull.x;
  if (q.x < uHull.z && q.x > uHull.w && dy * dy + q.z * q.z < (uHull.y + 0.15) * (uHull.y + 0.15)) return true;
  float cy = q.y - uCT.z;
  if (q.x < uCT.x && q.x > uCT.y && cy * cy + q.z * q.z < (uCT.w + 0.1) * (uCT.w + 0.1)) return true;
  float dx = max(abs(q.x - uObs.x) - uObs.w, 0.0), oy = q.y - uObs.y;
  return dx * dx + oy * oy + q.z * q.z < (uObs.z + 0.16) * (uObs.z + 0.16);
}
void main() {
  vec2 ndc = vClip.xy / vClip.w;
  vec2 uvS = ndc * 0.5 + 0.5;
  float d = texture(uDepth, uvS).r;
  vec4 sp = uInvProj * vec4(ndc, d * 2.0 - 1.0, 1.0);
  float sceneZ = -sp.z / sp.w;
  if (uDebug > 0.5) { o = vec4(fract(sceneZ / 10.0), fract(vClip.w / 10.0), d >= 1.0 ? 1.0 : 0.0, 1.0); return; }
  if (d < 1.0 && sceneZ < vClip.w - 0.02) discard;
  if (inBoat(vWorld)) discard;
  vec3 V = normalize(uCameraPos - vWorld);
  // capillary ripples on the swell (fading with distance)
  float rk = 1.0 - smoothstep(10.0, 120.0, vDist);
  vec2 rp = vWorld.xz * 1.7 + vec2(uTime * 0.6, uTime * 0.35);
  vec2 rg = vec2(vnoise(rp) - vnoise(rp + vec2(0.37, 0.0)), vnoise(rp) - vnoise(rp + vec2(0.0, 0.37))) * 0.9;
  vec3 N = normalize(vNormal + vec3(rg.x, 0.0, rg.y) * rk * 0.35);
  bool above = uCameraPos.y > vWorld.y;
  if (above) {
    float cosI = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow5(1.0 - cosI);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 refl = min(textureLod(uEnv, R, 0.5).rgb, vec3(20.0));
    // the sun's glitter: GGX on the rippled sea, rougher far off (unresolved waves)
    vec3 H = normalize(V + uSunDir);
    float a = 0.035 + 0.12 * smoothstep(20.0, 1500.0, vDist), a2 = a * a;
    float NoH = max(dot(N, H), 0.0), NoL = max(dot(N, uSunDir), 0.0);
    float D = a2 / (PI * pow2(NoH * NoH * (a2 - 1.0) + 1.0));
    vec3 glint = uSunIrr * D * F * NoL / max(4.0 * cosI * NoL + 1e-3, 1e-3) * 0.25;
    glint = min(glint, vec3(3e4));
    o = vec4(refl * F + glint, F);
  } else {
    vec3 Nd = -N;                         // the side facing the water
    vec3 up = -V;
    float cosI = max(dot(V, Nd), 0.0);
    vec3 t = refract(up, Nd, 1.333);
    float F = 1.0;
    vec3 sky = vec3(0.0);
    if (dot(t, t) > 0.0) {
      float ct = max(t.y, 0.0);
      float F0 = 0.02;
      F = F0 + (1.0 - F0) * pow5(1.0 - ct);
      sky = min(textureLod(uEnv, normalize(t), 0.5).rgb, vec3(20.0));
      sky += uSunIrr * 40.0 * pow(max(dot(normalize(t), uSunDir), 0.0), 900.0);
    }
    vec3 Rd = reflect(up, Nd);
    vec3 below = uWaterRad * (0.35 + 0.65 * smoothstep(-0.6, 1.0, Rd.y));
    vec3 col = (1.0 - F) * sky + F * below;
    // the water between the eye and the surface
    vec3 ray = vWorld - uCameraPos;
    float L = length(ray);
    vec3 dir = ray / max(L, 1e-5);
    vec3 ob = (uBoatInv * vec4(uCameraPos, 1.0)).xyz, db = mat3(uBoatInv) * dir;
    float tw = max(0.0, L - insideBoat(ob, db, vec2(0.0, L)));
    float dMid = max(0.0, uSeaY - (uCameraPos.y + dir.y * 0.5 * min(tw, 1.0 / uC.g)));
    vec3 T = exp(-uC * tw);
    vec3 Linf = uWaterRad * exp(-uKd * dMid) * (0.35 + 0.65 * smoothstep(-0.6, 1.0, dir.y));
    o = vec4(col * T + Linf * (1.0 - T), 1.0);
  }
  if (!(abs(o.r) + abs(o.g) + abs(o.b) + abs(o.a) < 1e30)) o = vec4(0.0);
  o = clamp(o, vec4(0.0), vec4(6e4, 6e4, 6e4, 1.0));
}`;

export class Surface {
  constructor(stage) { this.name = 'surface'; this.enabled = true; this.stage = stage; }

  init(r) {
    const gl = (this.gl = r.gl);
    this.prog = new Program(gl, VS, FS, {}, 'sea-surface');
    this.copy = postProgram(gl, `in vec2 vUv; out vec4 o; uniform sampler2D uC; void main(){ o = texture(uC, vUv); }`, {}, 'surface-copy');
    // the grid: rings growing geometrically outward
    const rings = [0];
    for (let r0 = 0.35; r0 < 6000; r0 *= 1.065) rings.push(r0);
    const NA = 192;
    const v = [];
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < NA; j++) {
        const a0 = (j / NA) * Math.PI * 2, a1 = ((j + 1) / NA) * Math.PI * 2;
        const r0 = rings[i], r1 = rings[i + 1];
        v.push(r0, a0, r1, a0, r1, a1, r0, a0, r1, a1, r0, a1);
      }
    }
    this.count = v.length / 2;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.waveA = new Float32Array(NW * 4); this.waveP = new Float32Array(NW * 4);
  }

  resize(r) {
    if (!this.target) this.target = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba16f' }] });
    else this.target.resize(r.displayW, r.displayH);
  }

  afterLighting(r, color) {
    const gl = r.gl, S = this.stage, sea = S.sea;
    const n = Math.min(NW, sea.waves.length);
    for (let i = 0; i < n; i++) { const w = sea.waves[i]; this.waveA.set([w.kx, w.kz, w.w, w.a], i * 4); this.waveP[i * 4] = w.ph; }
    this.target.bind();
    state(gl);
    this.copy.use().set('uC', color);
    fullscreen(gl);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.disable(gl.CULL_FACE);
    const sunI = r.sunIntensity;
    this.prog.use().set('uCameraPos', r.cameraPos).set('uViewProj', r.viewProj).set('uOrigin', [S.origin.x, S.origin.z])
      .set('uTime', sea.time).set('uDebug', this.debug ? 1 : 0).set('uSeaY', 0).set('uWave', this.waveA).set('uWaveP', this.waveP).set('uWaves', n)
      .set('uDepth', r.depth).set('uInvProj', r.invProj).set('uEnv', r.env.spec).set('uSunDir', r.sunDir)
      .set('uSunIrr', [r.sunColor.x * sunI, r.sunColor.y * sunI, r.sunColor.z * sunI])
      .set('uBoatInv', S.boatInv).set('uHull', S.U.hull).set('uCT', S.U.ct).set('uObs', S.U.obs)
      .set('uKd', WATER.Kd).set('uC', WATER.c).set('uWaterRad', S.U.waterRad);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return this.target.tex;
  }
}
