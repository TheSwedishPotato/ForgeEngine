import { postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';

/** Shows one intermediate buffer full-screen (?debug=albedo|normal|rough|metal|motion|ao|ssr|ssgi|probes|depth|emissive|lit). */
const FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uTex, uDepth;
uniform int uMode;
uniform mat4 uInvProj;
void main() {
  vec4 t = texture(uTex, vUv);
  vec3 c;
  if (uMode == 1) c = pow(t.rgb, vec3(1.0 / 2.2));
  else if (uMode == 2) c = decodeNormal(t.xy) * 0.5 + 0.5;
  else if (uMode == 3) c = vec3(t.z);
  else if (uMode == 4) c = vec3(t.w);
  else if (uMode == 5) c = vec3(0.5 + t.xy * 40.0, 0.5);
  else if (uMode == 6) c = vec3(t.r);
  else if (uMode == 7 || uMode == 8) c = pow(t.rgb / (1.0 + t.rgb), vec3(1.0 / 2.2)) + vec3(0.0, 0.0, t.a * 0.0);
  else if (uMode == 9) { vec4 p = uInvProj * vec4(0.0, 0.0, texture(uDepth, vUv).r * 2.0 - 1.0, 1.0); c = vec3(fract(-p.z / p.w / 10.0)); }
  else c = pow(t.rgb / (1.0 + t.rgb), vec3(1.0 / 2.2));
  o = vec4(c, 1.0);
}`;
const MODES = { albedo: 1, normal: 2, rough: 3, metal: 4, motion: 5, ao: 6, ssr: 7, ssgi: 8, depth: 9, emissive: 10, lit: 11 };

export class Debug {
  constructor(view) { this.name = 'debug'; this.view = view; }
  init(r) { this.prog = postProgram(r.gl, FS, {}, 'debug'); }
  afterLighting(r, color) {
    const m = MODES[this.view];
    if (!m) return color;
    const g = r.gbuffer.colors;
    const tex = { 1: g[0], 2: g[1], 3: g[1], 4: g[1], 5: g[2], 6: r.aoTexture, 7: r.ssrTexture, 8: r.ssgiTexture, 9: g[0], 10: g[3], 11: r.hdr.tex }[m];
    const gl = r.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, r.displayW, r.displayH);
    state(gl);
    this.prog.use().set('uTex', tex ?? r.black).set('uDepth', r.depth).set('uMode', m).set('uInvProj', r.invProj);
    fullscreen(gl);
    return color;
  }
}
