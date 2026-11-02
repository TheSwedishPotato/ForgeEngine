import { Program, Target, postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';

/**
 * Forward pass for sprites (dust puffs, impact flashes): camera-facing
 * quads, lit by the sun and sky, with soft depth fade against the scene
 * ("soft particles") so they never show a hard line where they cut the ground.
 * See-through sprites are composited with weighted blended order-independent
 * transparency (McGuire and Bavoil 2013): overlapping dust and smoke need no
 * sorting and never pop as their order changes.
 */
const VS = /* glsl */`
uniform mat4 uViewProj;
uniform vec3 uCenter, uRight, uUp;
uniform vec2 uScale;
uniform float uRotation;
out vec2 vUv;
out vec4 vClip;
void main() {
  const vec2 Q[6] = vec2[](vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(0.5, 0.5), vec2(-0.5, -0.5), vec2(0.5, 0.5), vec2(-0.5, 0.5));
  vec2 c = Q[gl_VertexID];
  vUv = c + 0.5;
  float cs = cos(uRotation), sn = sin(uRotation);
  vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * uScale;
  vec3 w = uCenter + uRight * rc.x + uUp * rc.y;
  vClip = uViewProj * vec4(w, 1.0);
  gl_Position = vClip;
}`;
const FS = /* glsl */`
${COMMON}
in vec2 vUv; in vec4 vClip;
layout(location = 0) out vec4 o;
#ifdef OIT
layout(location = 1) out vec4 oReveal;
#endif
uniform sampler2D uMap, uDepth;
uniform mat4 uInvProj;
uniform vec3 uColor, uLight;
uniform float uOpacity, uAdditive, uSoftness;
float lin(float d) { vec4 p = uInvProj * vec4(0.0, 0.0, d * 2.0 - 1.0, 1.0); return -p.z / p.w; }
void main() {
  vec4 t = texture(uMap, vUv);
  vec2 suv = vClip.xy / vClip.w * 0.5 + 0.5;
  float sceneZ = lin(texture(uDepth, suv).r);
  float z = lin(vClip.z / vClip.w * 0.5 + 0.5);
  float soft = saturate((sceneZ - z) / uSoftness);
  float a = t.a * uOpacity * soft;
  vec3 c = uColor * t.rgb * (uAdditive > 0.5 ? vec3(6.0) : uLight);
#ifdef OIT
  // weighted premultiplied colour in one target; the other sums -log(1 - a),
  // whose exponential is the product of (1 - a) over all layers, so plain
  // additive blending serves both
  float w = clamp(0.03 / (1e-5 + pow(z / 60.0, 4.0)), 1e-2, 3e3) * max(a, 1e-3);
  o = vec4(c * a, a) * w;
  oReveal = vec4(-log(max(1.0 - a, 1e-4)), 0.0, 0.0, 0.0);
#else
  o = uAdditive > 0.5 ? vec4(c * a, 0.0) : vec4(c * a, a);
#endif
}`;

const COMPOSITE_FS = /* glsl */`
in vec2 vUv; out vec4 o;
uniform sampler2D uAccum, uReveal;
void main() {
  vec4 a = texture(uAccum, vUv);
  float R = exp(-texture(uReveal, vUv).r);          // what still shows through
  if (R > 0.999) discard;
  vec3 avg = a.rgb / max(a.a, 1e-5);
  o = vec4(avg * (1.0 - R), R);                     // blended as  src + dst * R
}`;

export class Sprites {
  constructor() { this.name = 'sprites'; }
  init(r) {
    this.prog = new Program(r.gl, VS, FS, {}, 'sprites');
    this.progOIT = new Program(r.gl, VS, FS, { OIT: true }, 'sprites-oit');
    this.composite = postProgram(r.gl, COMPOSITE_FS, {}, 'oit-composite');
  }
  resize(r) {
    if (!this.oit) this.oit = new Target(r.gl, { width: r.width, height: r.height, colors: [{ format: 'rgba16f' }, { format: 'r16f' }] });
    else this.oit.resize(r.width, r.height);
  }
  afterLighting(r, color) {
    const list = r.lists.sprites;
    if (!list.length) return color;
    const gl = r.gl;
    const soft = list.filter((s) => s.material.blending !== 2), glow = list.filter((s) => s.material.blending === 2);
    if (soft.length) {
      this.oit.bind();
      state(gl);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this._draw(r, this.progOIT, soft, false);
      r.hdr.bind();
      state(gl);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.SRC_ALPHA);
      this.composite.use().set('uAccum', this.oit.colors[0]).set('uReveal', this.oit.colors[1]);
      fullscreen(gl);
    }
    if (glow.length) {
      r.hdr.bind();
      state(gl);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this._draw(r, this.prog, glow, true);
    }
    gl.disable(gl.BLEND);
    return color;
  }
  _draw(r, prog, list, additive) {
    const gl = r.gl;
    const p = prog.use();
    const v = r.view.elements;
    p.set('uViewProj', r.viewProjJit).set('uRight', [v[0], v[4], v[8]]).set('uUp', [v[1], v[5], v[9]]).set('uDepth', r.depth).set('uInvProj', r.invProj).set('uSoftness', 0.25);
    // sun + sky light for non-additive sprites (the irradiance a vertical card would receive)
    const sun = r.sunColor, I = r.sunIntensity, sh = r.env.sh;
    const light = [sun.x * I * 0.25 + sh[0] * 0.9, sun.y * I * 0.25 + sh[1] * 0.9, sun.z * I * 0.25 + sh[2] * 0.9];
    for (const s of list) {
      const m = s.material;
      const tex = r.adapter.texture(m.map, true) ?? r.adapter.white;
      const e = s.matrixWorld.elements;
      const sx = Math.hypot(e[0], e[1], e[2]), sy = Math.hypot(e[4], e[5], e[6]);
      p.set('uMap', tex).set('uCenter', [e[12], e[13], e[14]]).set('uScale', [sx, sy]).set('uRotation', m.rotation ?? 0)
        .set('uColor', [m.color.r, m.color.g, m.color.b]).set('uOpacity', m.opacity).set('uAdditive', additive ? 1 : 0).set('uLight', light);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }
}
