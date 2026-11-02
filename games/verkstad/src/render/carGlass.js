/**
 * Car glass, see-through. The Med Engine is a deferred renderer and draws only opaque surfaces, so
 * glass is drawn over the finished image, as Glass Elevator and Gotthard Pullman draw theirs: here
 * not flat panes but the car's own curved glass (the windscreen, the door glass, the rear window,
 * lofted with the body in car/body.js), each mesh with its own model matrix, so it moves with the
 * car on the lift, the doors as they swing and the tailgate as it lifts.
 *
 * Each pixel of glass: hidden if something in the scene is in front of it; otherwise it lets
 * through what is behind it (the seats, the dashboard, the steering wheel), dimmed by the
 * glass's light green-grey tint, and adds its reflection by Fresnel (4 % head-on, nearly a mirror
 * at grazing angles): in the hall, its walls and the streaks of the LED panels in the ceiling;
 * outside, the sky.
 */
import { Program, Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';

const VS = /* glsl */`
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
uniform mat4 uViewProj, uModel;
out vec3 vWorld; out vec3 vNormal; out vec4 vClip;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = mat3(uModel) * aNormal;
  vClip = uViewProj * w;
  gl_Position = vClip;
}`;

const FS = /* glsl */`
${COMMON}
in vec3 vWorld; in vec3 vNormal; in vec4 vClip;
uniform highp sampler2D uDepth;
uniform mat4 uInvProj;
uniform samplerCube uEnv;
uniform vec3 uCameraPos, uHall;
uniform float uIndoor;
out vec4 o;
void main() {
  vec2 ndc = vClip.xy / vClip.w;
  float d = texture(uDepth, ndc * 0.5 + 0.5).r;
  vec4 sp = uInvProj * vec4(ndc, d * 2.0 - 1.0, 1.0);
  if (d < 1.0 && -sp.z / sp.w < vClip.w - 0.015) discard;
  vec3 V = normalize(uCameraPos - vWorld);
  vec3 N = normalize(vNormal);
  if (dot(N, V) < 0.0) N = -N;
  float c = max(dot(N, V), 0.0);
  float F = 0.04 + 0.96 * pow5(1.0 - c);
  vec3 R = reflect(-V, N);
  float up = max(R.y, 0.0);
  vec3 hall = uHall * (0.5 + 1.4 * up) + uHall * 40.0 * pow(up, 48.0) * (0.6 + 0.4 * vnoise(vWorld.xz * 3.0));
  vec3 refl = mix(min(textureLod(uEnv, R, 0.3).rgb, vec3(12.0)), hall, uIndoor);
  float absorb = 0.16 + 0.1 * (1.0 - c);          // the tint: thicker glass at a slant
  o = vec4(refl * F * vec3(0.92, 1.0, 0.96), clamp(F + absorb, 0.0, 1.0));
  if (!(abs(o.r) + abs(o.g) + abs(o.b) + abs(o.a) < 1e30)) o = vec4(0.0);
  o = clamp(o, vec4(0.0), vec4(6e4, 6e4, 6e4, 1.0));
}`;

export class CarGlass {
  constructor() { this.name = 'carglass'; this.enabled = true; this.meshes = []; this.vaos = new WeakMap(); this.hall = [0.016, 0.0155, 0.015]; this.indoor = 1; }

  /** The glass meshes to draw (a car's; replaced when the next car comes). */
  set(meshes) { this.meshes = meshes ?? []; }

  init(r) {
    this.gl = r.gl;
    this.prog = new Program(r.gl, VS, FS, {}, 'carglass');
    this.copy = postProgram(r.gl, 'in vec2 vUv; out vec4 o; uniform sampler2D uC; void main(){ o = texture(uC, vUv); }', {}, 'carglass-copy');
  }

  resize(r) {
    if (!this.target) this.target = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba16f' }] });
    else this.target.resize(r.displayW, r.displayH);
  }

  _vao(mesh) {
    let v = this.vaos.get(mesh);
    if (v) return v;
    const gl = this.gl, g = mesh.geometry;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    for (const [loc, name] of [[0, 'position'], [1, 'normal']]) {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, g.attributes[name].array, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    }
    gl.bindVertexArray(null);
    v = { vao, count: g.attributes.position.count };
    this.vaos.set(mesh, v);
    return v;
  }

  afterLighting(r, color) {
    const list = this.meshes.filter(shown);
    if (!list.length) return color;
    const gl = r.gl;
    this.target.bind();
    state(gl);
    this.copy.use().set('uC', color);
    fullscreen(gl);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    const P = this.prog.use().set('uViewProj', r.viewProj).set('uCameraPos', r.cameraPos).set('uDepth', r.depth).set('uInvProj', r.invProj)
      .set('uEnv', r.env.spec).set('uHall', this.hall).set('uIndoor', this.indoor);
    for (const m of list) {
      const v = this._vao(m);
      P.set('uModel', m.matrixWorld);
      gl.bindVertexArray(v.vao);
      gl.drawArrays(gl.TRIANGLES, 0, v.count);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return this.target.tex;
  }
}

function shown(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return !!o.parent; }
