/**
 * The car's glass, drawn over the finished (anti-aliased) image: the Med Engine draws only
 * opaque surfaces, so the windscreen, the door glass and the lamps' lenses are drawn here,
 * after it, tested by hand against the scene's depth.
 *
 * Each pane: a Fresnel reflection (4 % head on, rising toward grazing) of the sky and the
 * world outside, or of the dim cabin from inside; a faint grey absorption; the windscreen's
 * tinted shade band along its top; and the frost that the time machine brings back from a
 * jump (it is "cold, damn cold"), growing from the edges and melting off over a minute or two.
 */
import { Program, Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';

const VS = /* glsl */`
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
uniform mat4 uModel, uViewProj;
uniform vec3 uCameraPos;
out vec3 vWorld; out vec3 vNormal; out vec4 vClip; out vec3 vObj;
void main() {
  vec4 w = uModel * vec4(position, 1.0);
  vWorld = w.xyz;
  vObj = position;
  vNormal = normalize(mat3(uModel) * normal);
  vClip = uViewProj * w;
  gl_Position = vClip;
}`;

const FS = /* glsl */`
${COMMON}
in vec3 vWorld; in vec3 vNormal; in vec4 vClip; in vec3 vObj;
uniform highp sampler2D uDepth;
uniform mat4 uInvProj;
uniform samplerCube uEnv;
uniform vec3 uCameraPos;
uniform vec3 uInterior;     // radiance of the cabin, mirrored in the glass from inside
uniform vec4 uBand;         // shade band: object-space y where it starts, where it is full, its strength, 0
uniform vec3 uTint;         // transmitted colour
uniform float uFrost, uDirt, uSeed, uEnvScale, uRain;
out vec4 o;
void main() {
  vec2 ndc = vClip.xy / vClip.w;
  vec2 uvS = ndc * 0.5 + 0.5;
  float d = texture(uDepth, uvS).r;
  vec4 sp = uInvProj * vec4(ndc, d * 2.0 - 1.0, 1.0);
  float sceneZ = -sp.z / sp.w;
  if (d < 1.0 && sceneZ < vClip.w - 0.015) discard;
  vec3 V = normalize(uCameraPos - vWorld);
  vec3 N = normalize(vNormal);
  bool inside = dot(V, N) < 0.0;
  if (inside) N = -N;
  float cosT = max(dot(N, V), 0.0);
  float F = 0.04 + 0.96 * pow5(1.0 - cosT);
  vec3 refl = inside ? uInterior : min(textureLod(uEnv, reflect(-V, N), 0.5).rgb * uEnvScale, vec3(8.0));
  // the shade band, and a faint film of road dirt
  float band = smoothstep(uBand.x, uBand.y, vObj.y) * uBand.z;
  float dirt = uDirt * (0.5 + 0.5 * vnoise(vObj.xz * 23.0 + uSeed)) * (0.6 + 0.4 * vnoise(vObj.xy * 5.0));
  // frost: feathered from the edges and in patches, as on a car out of a freezer
  float fern = vnoise(vObj.xy * 61.0 + uSeed) * 0.55 + vnoise(vObj.zy * 170.0) * 0.45;
  float patchy = vnoise(vObj.xz * 7.0 + vObj.y * 3.0 + uSeed * 1.7);
  float frost = smoothstep(0.35, 0.75, uFrost * (0.55 + 0.6 * patchy) + fern * 0.25 * uFrost);
  vec3 frostCol = (inside ? uInterior * 2.0 + refl * 0.2 : textureLod(uEnv, N, 4.0).rgb * uEnvScale * 0.9) + vec3(0.002);
  vec3 col = refl * F;
  float a = F * 0.5 + 0.06 + band * 0.55 + dirt * 0.12;
  // raindrops on the outside: beads of water, each a little lens catching the sky and the lights
  if (uRain > 0.0) {
    vec3 q = vObj * 38.0 + uSeed;
    vec3 cell = floor(q), f = fract(q);
    float h = hash13(cell);
    if (h < uRain * 0.75) {
      vec3 c = vec3(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.3)) * 0.6 + 0.2;
      float r = 0.18 + 0.2 * hash13(cell + 7.7);
      float d = length(f - c) / r;
      if (d < 1.0) {
        vec3 drop = min(textureLod(uEnv, reflect(-V, normalize(N + (f - c) * 1.5)), 2.0).rgb * uEnvScale, vec3(4.0)) * 0.35 + uInterior * 0.5;
        col = mix(col, drop, 0.6 * smoothstep(1.0, 0.6, d));
        a = mix(a, 0.55, smoothstep(1.0, 0.75, d));
      }
    }
  }
  vec3 absorbed = vec3(0.0);
  col = mix(col, frostCol, frost);
  a = mix(a, 0.93, frost);
  o = vec4(col + absorbed, clamp(a, 0.0, 1.0));
  if (!(abs(o.r) + abs(o.g) + abs(o.b) + abs(o.a) < 1e30)) o = vec4(0.0);
  o = clamp(o, vec4(0.0), vec4(6e4, 6e4, 6e4, 1.0));
}`;

export class Glass {
  constructor() {
    this.name = 'glass';
    this.enabled = true;
    this.panes = [];           // { mesh, band: [y0, y1, k, 0], tint, dirt }
    this.frost = 0;
    this.interior = [0.002, 0.002, 0.002];
    this.rain = 0;
  }

  init(r) {
    const gl = (this.gl = r.gl);
    this.prog = new Program(gl, VS, FS, {}, 'glass');
    this.copy = postProgram(gl, `in vec2 vUv; out vec4 o; uniform sampler2D uC; void main(){ o = texture(uC, vUv); }`, {}, 'glass-copy');
    this.vaos = new WeakMap();
  }

  resize(r) {
    if (!this.target) this.target = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba16f' }] });
    else this.target.resize(r.displayW, r.displayH);
  }

  add(mesh, opts = {}) {
    mesh.userData.forgeSkip = true;
    this.panes.push({ mesh, band: opts.band ?? [9, 10, 0, 0], tint: opts.tint ?? [0.92, 0.95, 0.93], dirt: opts.dirt ?? 0.15, seed: Math.random() * 50, frosts: opts.frosts !== false });
  }

  _vao(geo) {
    let v = this.vaos.get(geo);
    if (v) return v;
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, geo.attributes.position.array, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, geo.attributes.normal.array, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    v = { vao, count: geo.attributes.position.count };
    this.vaos.set(geo, v);
    return v;
  }

  afterLighting(r, color) {
    const panes = this.panes.filter((p) => p.mesh.visible && isShown(p.mesh));
    if (!panes.length) return color;
    const gl = r.gl;
    this.target.bind();
    state(gl);
    this.copy.use().set('uC', color);
    fullscreen(gl);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    const P = this.prog.use();
    P.set('uViewProj', r.viewProj).set('uCameraPos', r.cameraPos).set('uDepth', r.depth).set('uInvProj', r.invProj)
      .set('uEnv', r.env.spec).set('uInterior', this.interior).set('uEnvScale', r.envIntensity ?? 1);
    for (const p of panes) {
      const v = this._vao(p.mesh.geometry);
      P.set('uModel', p.mesh.matrixWorld).set('uBand', p.band).set('uTint', p.tint).set('uFrost', p.frosts ? this.frost : 0).set('uDirt', p.dirt).set('uSeed', p.seed).set('uRain', p.frosts ? this.rain : 0);
      gl.bindVertexArray(v.vao);
      gl.drawArrays(gl.TRIANGLES, 0, v.count);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return this.target.tex;
  }
}

function isShown(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
