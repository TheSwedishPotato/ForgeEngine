import { postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';

/** Minimal output: fixed exposure + ACES to the canvas (replaced by the full post chain when present). */
const FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uColor; uniform float uExposure;
vec3 aces(vec3 x) { const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return saturate((x * (a * x + b)) / (x * (c * x + d) + e)); }
void main() { vec3 c = texture(uColor, vUv).rgb * uExposure; o = vec4(pow(aces(c), vec3(1.0 / 2.2)), 1.0); }`;

export class Output {
  constructor() { this.name = 'output'; this.exposure = 0.6; }
  init(r) { this.prog = postProgram(r.gl, FS, {}, 'output'); }
  afterLighting(r, color) {
    const gl = r.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, r.displayW, r.displayH);
    state(gl);
    this.prog.use().set('uColor', color).set('uExposure', this.exposure);
    fullscreen(gl);
    return color;
  }
}
