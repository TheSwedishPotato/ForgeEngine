import { Target, postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';

/**
 * Screen-space subsurface scattering for skin (after Jimenez et al., "Separable Subsurface
 * Scattering", 2015). The lighting pass writes skin's diffuse light into its own target;
 * here it is blurred along the surface with a sum-of-Gaussians skin profile: red light
 * travels several millimetres under the skin, green less, blue hardly at all. That softens
 * the hard shadow edges of the nose and lips, fills the pores with light and puts the warm
 * red rim at the terminator that tells the eye "this is flesh, not plaster".
 *
 * The kernel is measured in world millimetres and projected per pixel, so a close-up and a
 * wide shot scatter the same physical distance. Samples that leave the skin or jump in depth
 * are rejected (the scattering follows the surface, not the screen).
 */
const BLUR_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uSkin, uDepth, uColor, uOrig;
uniform mat4 uInvProj;
uniform vec2 uDir;          // (1,0) then (0,1), in pixels
uniform float uPxPerMeter;  // projection scale: pixels per metre at 1 m depth
uniform float uWidth;       // world scale of the profile (1 = average skin)
uniform float uFinal;       // second pass: composite onto the lit image
float lin(float d) { vec4 p = uInvProj * vec4(0.0, 0.0, d * 2.0 - 1.0, 1.0); return -p.z / p.w; }
// sum of Gaussians per channel (variances in mm^2), fitted to a three-layer skin profile
const vec3 V0 = vec3(0.0064, 0.0064, 0.0064);
const vec3 V1 = vec3(0.0484, 0.0484, 0.0310);
const vec3 V2 = vec3(0.187, 0.12, 0.05);
const vec3 V3 = vec3(0.567, 0.21, 0.04);
const vec3 V4 = vec3(1.99, 0.41, 0.06);
const vec3 W0 = vec3(0.233, 0.455, 0.649);
const vec3 W1 = vec3(0.100, 0.336, 0.344);
const vec3 W2 = vec3(0.118, 0.198, 0.0);
const vec3 W3 = vec3(0.113, 0.007, 0.007);
const vec3 W4 = vec3(0.358, 0.004, 0.0);
vec3 profile(float r2) {
  return W0 * exp(-r2 / (2.0 * V0)) + W1 * exp(-r2 / (2.0 * V1)) + W2 * exp(-r2 / (2.0 * V2)) + W3 * exp(-r2 / (2.0 * V3)) + W4 * exp(-r2 / (2.0 * V4));
}
void main() {
  vec4 c = texture(uSkin, vUv);
  if (c.a < 0.5) {
    o = uFinal > 0.5 ? texture(uColor, vUv) : vec4(c.rgb, c.a);
    return;
  }
  float z = lin(texture(uDepth, vUv).r);
  // how many pixels one millimetre covers here
  float pxPerMm = uPxPerMeter / max(z, 0.05) * 0.001 * uWidth;
  vec2 texel = 1.0 / vec2(textureSize(uSkin, 0));
  const int TAPS = 9;
  float range = 3.2;          // mm on each side
  vec3 sum = c.rgb * profile(0.0), wsum = profile(0.0);
  for (int i = 1; i <= TAPS; i++) {
    float mm = range * float(i) / float(TAPS);
    mm *= mm / range;         // denser near the centre
    float px = mm * pxPerMm;
    if (px < 0.5) continue;
    for (int s = -1; s <= 1; s += 2) {
      vec2 uv = vUv + uDir * texel * px * float(s);
      vec4 t = texture(uSkin, uv);
      float zt = lin(texture(uDepth, uv).r);
      // follow the surface: reject other surfaces and non-skin
      float dz = abs(zt - z) * 1000.0;   // mm
      vec3 w = profile(mm * mm + dz * dz) * t.a;
      sum += t.rgb * w; wsum += w;
    }
  }
  vec3 blurred = sum / max(wsum, vec3(1e-5));
  if (uFinal > 0.5) {
    vec4 lit = texture(uColor, vUv);
    o = vec4(lit.rgb - texture(uOrig, vUv).rgb + blurred, lit.a);
  } else o = vec4(blurred, 1.0);
}`;

export class SkinSSS {
  constructor() { this.name = 'skin-sss'; this.enabled = true; this.width = 1.0; }
  init(r) { this.prog = postProgram(r.gl, BLUR_FS, {}, 'skin-sss'); }
  resize(r) {
    if (!this.tmp) {
      this.tmp = new Target(r.gl, { width: r.width, height: r.height, colors: [{ format: 'rgba16f' }] });
      this.out = new Target(r.gl, { width: r.width, height: r.height, colors: [{ format: 'rgba16f' }] });
    } else { this.tmp.resize(r.width, r.height); this.out.resize(r.width, r.height); }
  }
  afterLighting(r, color) {
    const gl = r.gl;
    state(gl);
    const pxPerMeter = r.proj.elements[5] * 0.5 * r.height;
    const P = this.prog.use().set('uDepth', r.depth).set('uInvProj', r.invProj).set('uPxPerMeter', pxPerMeter).set('uWidth', this.width);
    this.tmp.bind();
    P.set('uSkin', r.skinDiffuse).set('uDir', [1, 0]).set('uFinal', 0).set('uColor', color);
    fullscreen(gl);
    // the vertical pass reads the horizontally blurred skin (alpha from the original)
    this.out.bind();
    P.set('uSkin', this.tmp.tex).set('uOrig', r.skinDiffuse).set('uDir', [0, 1]).set('uFinal', 1).set('uColor', color);
    fullscreen(gl);
    return this.out.tex;
  }
}
