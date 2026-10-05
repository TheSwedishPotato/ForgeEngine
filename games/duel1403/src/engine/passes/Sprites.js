import { Program, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';

/**
 * Forward pass for sprites (dust puffs, impact flashes): camera-facing
 * quads, lit by the sun and sky, with soft depth fade against the scene
 * ("soft particles") so they never show a hard line where they cut the ground.
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
in vec2 vUv; in vec4 vClip; out vec4 o;
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
  o = uAdditive > 0.5 ? vec4(c * a, 0.0) : vec4(c * a, a);
}`;

export class Sprites {
  constructor() { this.name = 'sprites'; }
  init(r) { this.prog = new Program(r.gl, VS, FS, {}, 'sprites'); }
  afterLighting(r, color) {
    const list = r.lists.sprites;
    if (!list.length) return color;
    const gl = r.gl;
    r.hdr.bind();
    state(gl);
    gl.enable(gl.BLEND);
    const p = this.prog.use();
    const v = r.view.elements;
    p.set('uViewProj', r.viewProjJit).set('uRight', [v[0], v[4], v[8]]).set('uUp', [v[1], v[5], v[9]]).set('uDepth', r.depth).set('uInvProj', r.invProj).set('uSoftness', 0.25);
    // sun + sky light for non-additive sprites (the irradiance a vertical card would receive)
    const sun = r.sunColor, I = r.sunIntensity, sh = r.env.sh;
    const light = [sun.x * I * 0.25 + sh[0] * 0.9, sun.y * I * 0.25 + sh[1] * 0.9, sun.z * I * 0.25 + sh[2] * 0.9];
    for (const s of list) {
      const m = s.material;
      const tex = r.adapter.texture(m.map, true) ?? r.adapter.white;
      const add = m.blending === 2;
      if (add) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const e = s.matrixWorld.elements;
      const sx = Math.hypot(e[0], e[1], e[2]), sy = Math.hypot(e[4], e[5], e[6]);
      p.set('uMap', tex).set('uCenter', [e[12], e[13], e[14]]).set('uScale', [sx, sy]).set('uRotation', m.rotation ?? 0)
        .set('uColor', [m.color.r, m.color.g, m.color.b]).set('uOpacity', m.opacity).set('uAdditive', add ? 1 : 0).set('uLight', light);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disable(gl.BLEND);
    return color;
  }
}
