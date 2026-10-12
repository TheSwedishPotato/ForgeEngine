/**
 * The cars' window glass, drawn over the finished (anti-aliased) image so the panes stay crisp
 * while the landscape streams past behind them.
 *
 * Each pane: Fresnel reflection (4 % head-on, rising toward grazing) of what is on the near
 * side of it: the sky and the snow from outside, the dim car and the glint of its lamps from
 * inside (strong in a tunnel, where the glass turns into a mirror); a faint film of grime; and
 * the weather on the outside: snow driven against the car gathers on the sill and in the
 * lower corners (it builds through a snowfall and the climb into colder air), freezing fog
 * grows hoar frost in from the corners, rain and thaw run as streaks.
 */
import { Program, Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';
import { BODY } from './pullman.js';

const VS = /* glsl */`
layout(location = 0) in vec2 aCorner;        // 0..1 across the pane
layout(location = 1) in vec4 aRect;          // x0, x1, y0, y1 (car coordinates)
layout(location = 2) in vec4 aInfo;          // car index, side (+1 right, -1 left), frosted, seed
uniform mat4 uCarMat[8];
uniform mat4 uViewProj;
uniform vec3 uCameraPos;
out vec2 vUv; out vec3 vWorld; out vec3 vNormal; out vec4 vClip; out vec4 vInfo; out float vInside; out vec2 vSize;
void main() {
  vSize = vec2(aRect.y - aRect.x, aRect.w - aRect.z);
  int k = int(aInfo.x + 0.5);
  float side = aInfo.y;
  float z = side * (${(BODY.half - BODY.wall * 0.5).toFixed(4)});
  vec3 lp = vec3(mix(aRect.x, aRect.y, aCorner.x), mix(aRect.z, aRect.w, aCorner.y), z);
  mat4 M = uCarMat[k];
  vec4 w = M * vec4(lp, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(M) * vec3(0.0, 0.0, side));
  vUv = aCorner;
  vInfo = aInfo;
  vInside = dot(uCameraPos - w.xyz, vNormal) < 0.0 ? 1.0 : 0.0;
  vClip = uViewProj * w;
  gl_Position = vClip;
}`;

const FS = /* glsl */`
${COMMON}
in vec2 vUv; in vec3 vWorld; in vec3 vNormal; in vec4 vClip; in vec4 vInfo; in float vInside; in vec2 vSize;
uniform highp sampler2D uDepth;
uniform mat4 uInvProj;
uniform samplerCube uEnv;
uniform float uEnvLevels;
uniform vec3 uCameraPos;
uniform vec3 uInterior;       // radiance of the car's interior (for the reflection from inside)
uniform vec4 uSnow;           // sill snow height (m), corner snow (0..1), frost (0..1), wet streaks (0..1)
uniform vec3 uSnowLight;      // the light on the snow outside
uniform float uLamp;          // the car's lamps (0..1)
uniform float uTime, uSpeed;
out vec4 o;
void main() {
  // hidden behind something nearer (a chair, a passenger, the window post)?
  vec2 ndc = vClip.xy / vClip.w;
  vec2 uvS = ndc * 0.5 + 0.5;
  float d = texture(uDepth, uvS).r;
  vec4 sp = uInvProj * vec4(ndc, d * 2.0 - 1.0, 1.0);
  float sceneZ = -sp.z / sp.w;
  float paneZ = vClip.w;
  if (d < 1.0 && sceneZ < paneZ - 0.03) discard;
  vec3 V = normalize(uCameraPos - vWorld);
  vec3 N = vInside > 0.5 ? -vNormal : vNormal;
  float cosT = max(dot(N, V), 0.0);
  float F = 0.04 + 0.96 * pow5(1.0 - cosT);
  vec3 refl;
  if (vInside > 0.5) {
    // from inside: the car mirrored; the lamps as soft glints
    refl = uInterior * (0.7 + 0.6 * vUv.y);
    vec2 g = vec2(fract(vUv.x * 1.0 + 0.5), vUv.y);
    refl += vec3(1.0, 0.85, 0.6) * uLamp * 3.0 * exp(-dot(g - vec2(0.5, 0.92), g - vec2(0.5, 0.92)) * 90.0);
  } else {
    // the sky and the snow mirrored (the sun's disc would whiten whole panes: held to a glint)
    refl = min(textureLod(uEnv, reflect(-V, N), 1.2).rgb, vec3(6.0));
  }
  // grime: a faint film, heavier low down
  float grime = 0.035 + 0.05 * (1.0 - vUv.y) * (0.6 + 0.4 * hash12(floor(vUv * vec2(40.0, 20.0)) + vInfo.w));
  // the weather on the outside of the glass (in metres from the pane's corners)
  vec2 m = vUv * vSize;
  float n1 = vnoise(vec2(m.x * 9.0 + vInfo.w * 7.0, 1.3)), n2 = vnoise(m * 23.0 + vInfo.w);
  float sill = uSnow.x * (0.75 + 0.5 * n1) + 0.006 * n2;
  // (kept above zero: smoothstep with equal edges is undefined, and GPUs return 1 - snow on the whole pane)
  float cornerR = max(uSnow.y * 0.16 * (0.8 + 0.4 * n1), 1e-4);
  float cl = length(vec2(m.x, m.y)), cr = length(vec2(vSize.x - m.x, m.y));
  float snow = max(smoothstep(sill + 0.004, sill - 0.004, m.y), max(smoothstep(cornerR, cornerR * 0.6, cl), smoothstep(cornerR, cornerR * 0.6, cr)));
  // hoar frost: feathery growth from the corners and edges
  float edge = min(min(m.x, vSize.x - m.x), min(m.y, vSize.y - m.y));
  float fern = vnoise(m * 60.0 + vInfo.w * 3.0) * 0.6 + vnoise(m * 180.0) * 0.4;
  float frost = uSnow.z * smoothstep(0.12 * uSnow.z + 0.02, 0.0, edge - fern * 0.06);
  // thaw and rain: streaks running back along the car (with the speed) and down
  float streak = uSnow.w * smoothstep(0.8, 1.0, vnoise(vec2(m.x * 6.0 + uTime * 0.2 * uSpeed, m.y * 40.0 + uTime * 0.8))) * 0.5;
  vec3 snowCol = uSnowLight * (vInside > 0.5 ? 0.55 : 1.0);   // seen from inside it is backlit, a little blue
  if (vInside > 0.5) snowCol *= vec3(0.85, 0.92, 1.05);
  if (vInfo.z > 0.5) { o = vec4(0.0); return; }               // frosted panes are geometry already
  vec3 add = refl * F + vec3(grime) * uSnowLight * 0.15;
  float cover = clamp(snow * 0.97 + frost * 0.8, 0.0, 1.0);
  vec3 col = mix(add, snowCol * (0.9 + 0.1 * n2), cover) + vec3(streak) * uSnowLight * 0.2;
  float a = clamp(max(cover, grime + streak * 0.3), 0.0, 1.0);
  // premultiplied: the scene behind keeps (1 - a) of itself, minus what the glass reflects back
  o = vec4(col, a + F * (1.0 - a) * 0.5);
}`;

export class Glass {
  constructor(stage) {
    this.name = 'glass';
    this.enabled = true;
    this.stage = stage;
    this.panes = [];
    this.snow = [0, 0, 0, 0];
    this.time = 0;
  }

  init(r) {
    const gl = (this.gl = r.gl);
    this.prog = new Program(gl, VS, FS, {}, 'glass');
    this.copy = postProgram(gl, `in vec2 vUv; out vec4 o; uniform sampler2D uC; void main(){ o = texture(uC, vUv); }`, {}, 'glass-copy');
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, 4096 * 32, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  resize(r) {
    if (!this.target) this.target = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba16f' }] });
    else this.target.resize(r.displayW, r.displayH);
  }

  /** The panes of the cars (car index k in the stage's car list, rects in car coordinates). */
  setPanes(cars) {
    const data = [];
    cars.forEach((info, k) => {
      for (const [side, list] of [[1, info.windows.right], [-1, info.windows.left]]) {
        for (const q of list) data.push(q.x0, q.x1, Math.max(q.y0, BODY.floor), q.y1, k, side, q.frosted ? 1 : 0, (q.x0 * 13.7 + side * 3.1) % 97);
      }
    });
    this.count = data.length / 8;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(data));
  }

  afterLighting(r, color) {
    const C = this.stage.cars;
    if (!this.count || !C?.count) return color;
    const gl = r.gl;
    this.time += r.dt ?? 0.016;
    this.target.bind();
    state(gl);
    this.copy.use().set('uC', color);
    fullscreen(gl);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    const sh = r.env.sh, k = 0.282095 / Math.PI;
    const amb = [sh[0] * k, sh[1] * k, sh[2] * k];
    const sunI = r.sunIntensity * Math.max(0.1, r.sunDir.y);
    const snowLight = [amb[0] * 2.2 + r.sunColor.x * sunI * 0.25, amb[1] * 2.2 + r.sunColor.y * sunI * 0.25, amb[2] * 2.2 + r.sunColor.z * sunI * 0.25];
    const P = this.prog.use();
    P.set('uCarMat', C.mat).set('uViewProj', r.viewProj).set('uCameraPos', r.cameraPos).set('uDepth', r.depth).set('uInvProj', r.invProj)
      .set('uEnv', r.env.spec).set('uEnvLevels', r.env.levels).set('uInterior', this.interior ?? [0.02, 0.018, 0.015])
      .set('uSnow', this.snow).set('uSnowLight', snowLight).set('uLamp', this.lamp ?? 0).set('uTime', this.time).set('uSpeed', this.speed ?? 0)
      ;
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return this.target.tex;
  }
}
