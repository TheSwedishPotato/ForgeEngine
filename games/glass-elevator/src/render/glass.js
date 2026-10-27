/**
 * The glass, drawn over the finished (anti-aliased) image as Gotthard Pullman draws its windows:
 * the car's three walls of laminated safety glass (two 10 mm sheets on a stiff interlayer, the
 * faint green of float glass in their edges), its glass door panels, and the screens round the
 * foot of the hoistway.
 *
 * Each pane reflects what is on the near side of it, by Fresnel (4 % head-on, rising toward
 * grazing): from outside the sky; from inside the car its own lit ceiling and floor, which is
 * what you see in a glass lift at dusk. A little dust lies in the lower corners, and the
 * edges of the laminate show their green.
 *
 * A pane: a corner and two edge vectors in world space, and which way it moves: with the car,
 * or with one of the car's door panels.
 */
import { Program, Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';

const VS = /* glsl */`
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aO;
layout(location = 2) in vec3 aU;
layout(location = 3) in vec3 aV;
layout(location = 4) in vec4 aInfo;          // moves (0 fixed, 1 car, 2 left door, 3 right door), frosted, seed, tint
uniform mat4 uViewProj;
uniform vec3 uCameraPos;
uniform float uCarY, uDoorX;
out vec2 vUv; out vec3 vWorld; out vec3 vNormal; out vec4 vClip; out vec4 vInfo; out vec2 vSize;
void main() {
  vec3 p = aO + aU * aCorner.x + aV * aCorner.y;
  int mv = int(aInfo.x + 0.5);
  if (mv >= 1) p.y += uCarY;
  if (mv == 2) p.x -= uDoorX;
  if (mv == 3) p.x += uDoorX;
  vWorld = p;
  vNormal = normalize(cross(aU, aV));
  vUv = aCorner;
  vInfo = aInfo;
  vSize = vec2(length(aU), length(aV));
  vClip = uViewProj * vec4(p, 1.0);
  gl_Position = vClip;
}`;

const FS = /* glsl */`
${COMMON}
in vec2 vUv; in vec3 vWorld; in vec3 vNormal; in vec4 vClip; in vec4 vInfo; in vec2 vSize;
uniform highp sampler2D uDepth;
uniform mat4 uInvProj;
uniform samplerCube uEnv;
uniform vec3 uCameraPos;
uniform vec3 uInterior;      // the lit car's radiance, for the reflections seen from inside
uniform vec3 uLamp;          // its downlights' glints
uniform float uCarY;
out vec4 o;
void main() {
  vec2 ndc = vClip.xy / vClip.w;
  float d = texture(uDepth, ndc * 0.5 + 0.5).r;
  vec4 sp = uInvProj * vec4(ndc, d * 2.0 - 1.0, 1.0);
  if (d < 1.0 && -sp.z / sp.w < vClip.w - 0.02) discard;
  vec3 V = normalize(uCameraPos - vWorld);
  bool facing = dot(V, vNormal) > 0.0;
  vec3 N = facing ? vNormal : -vNormal;
  float cosT = max(dot(N, V), 0.0);
  float F = 0.04 + 0.96 * pow5(1.0 - cosT);
  vec3 R = reflect(-V, N);
  // inside the car (the camera between its walls) the car is mirrored, else the sky
  bool inCar = vInfo.x > 0.5 && uCameraPos.y > uCarY - 0.2 && uCameraPos.y < uCarY + 2.6 && uCameraPos.z > 15.0;
  vec3 refl = inCar ? uInterior * (0.5 + 0.8 * max(-R.y, 0.0)) + uLamp * pow(max(R.y, 0.0), 24.0)
                    : min(textureLod(uEnv, R, 0.4).rgb, vec3(12.0));
  // dust in the lower corners, the laminate's green at grazing angles
  vec2 m = vUv * vSize;
  float dust = 0.02 + 0.05 * smoothstep(0.5, 0.0, m.y) * (0.5 + 0.5 * vnoise(m * 9.0 + vInfo.z));
  vec3 tint = mix(vec3(1.0), vec3(0.78, 0.92, 0.86), (1.0 - cosT) * 0.6 + vInfo.w);
  float frost = vInfo.y;
  vec3 col = refl * F + vec3(dust) * uInterior * 2.0 + frost * vec3(0.5) * (uInterior + 0.05);
  float a = clamp(F + dust + frost * 0.75 + (1.0 - dot(tint, vec3(0.333))) * 0.6, 0.0, 1.0);
  o = vec4(col * tint, a);
  if (!(abs(o.r) + abs(o.g) + abs(o.b) + abs(o.a) < 1e30)) o = vec4(0.0);
  o = clamp(o, vec4(0.0), vec4(6e4, 6e4, 6e4, 1.0));
}`;

export class Glass {
  constructor(stage) {
    this.name = 'glass';
    this.enabled = true;
    this.stage = stage;
    this.panes = [];
    this.carY = 0; this.doorX = 0;
    this.interior = [0.02, 0.019, 0.017];
    this.lamp = [0, 0, 0];
  }

  /** Adds a pane: corner o, edges u and v (world, m), moving 0 fixed / 1 car / 2, 3 car door panels. */
  add(o, u, v, { moves = 0, frosted = 0, tint = 0 } = {}) {
    this.panes.push([...o, ...u, ...v, moves, frosted, (o[0] * 7.1 + o[1] * 3.3 + o[2]) % 17, tint]);
    this.dirty = true;
  }

  init(r) {
    const gl = (this.gl = r.gl);
    this.prog = new Program(gl, VS, FS, {}, 'glass');
    this.copy = postProgram(gl, 'in vec2 vUv; out vec4 o; uniform sampler2D uC; void main(){ o = texture(uC, vUv); }', {}, 'glass-copy');
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, 256 * 52, gl.DYNAMIC_DRAW);
    const F = 4, stride = 13 * F;
    for (const [loc, size, off] of [[1, 3, 0], [2, 3, 3], [3, 3, 6], [4, 4, 9]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * F); gl.vertexAttribDivisor(loc, 1); }
    gl.bindVertexArray(null);
  }

  resize(r) {
    if (!this.target) this.target = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba16f' }] });
    else this.target.resize(r.displayW, r.displayH);
  }

  afterLighting(r, color) {
    if (!this.panes.length) return color;
    const gl = r.gl;
    if (this.dirty) { gl.bindBuffer(gl.ARRAY_BUFFER, this.inst); gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(this.panes.flat())); this.dirty = false; }
    this.target.bind();
    state(gl);
    this.copy.use().set('uC', color);
    fullscreen(gl);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    this.prog.use().set('uViewProj', r.viewProj).set('uCameraPos', r.cameraPos).set('uDepth', r.depth).set('uInvProj', r.invProj)
      .set('uEnv', r.env.spec).set('uInterior', this.interior).set('uLamp', this.lamp).set('uCarY', this.carY).set('uDoorX', this.doorX);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.panes.length);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return this.target.tex;
  }
}
