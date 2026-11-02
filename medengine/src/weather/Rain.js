import { Program, Target, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';
import { LIGHTS_GLSL } from '../lights/LightGrid.js';

/**
 * Rain (Med Engine 2).
 *
 * Streaks: tens of thousands of drops, generated in the vertex shader from the instance
 * number and the time (no buffers, nothing on the CPU), falling through a box that travels
 * with the camera. Each drop is drawn as the streak a film camera's shutter would see
 * (about 1/48 s of fall), slanted by the wind, depth-tested against the scene, and lit by
 * what lights it: the scene behind it, refracted (a drop is a tiny lens), and the street
 * lamps and headlights of the tile it falls through, brightest when they are behind it.
 *
 * Splashes: each splash instance picks a random spot on the screen, reads the depth and
 * normal there, and if the surface faces up it bursts into a small crown for a fraction of
 * a second; then it picks another spot. So splashes land on whatever is drawn, roofs, cars
 * and shoulders included, with no knowledge of the scene's geometry.
 */
const STREAK_VS = /* glsl */`
${COMMON}
uniform mat4 uViewProj;
uniform vec3 uCameraPos;
uniform float uTime, uBox, uSpeed, uLength, uWidthPx;
uniform vec2 uWind, uResolution;
out vec2 vSide;
out float vAlong;
out vec3 vWorld;
out float vFade;
void main() {
  int id = gl_InstanceID;
  int corner = gl_VertexID % 6;
  vec2 h = hash22(vec2(float(id) * 0.1373, float(id) * 0.7121));
  float h3 = hash12(vec2(float(id) * 1.913, 3.7));
  float speed = uSpeed * (0.85 + 0.3 * h3);
  // position in a box of side uBox around the camera, wrapped
  vec3 o = vec3(h.x, h3, h.y) * uBox;
  vec3 fall = vec3(uWind.x, -speed, uWind.y) * uTime;
  vec3 p = mod(o + fall - uCameraPos + uBox * 0.5, vec3(uBox)) + uCameraPos - uBox * 0.5;
  vec3 vel = normalize(vec3(uWind.x, -speed, uWind.y));
  vec3 top = p - vel * uLength * (0.7 + 0.6 * h.x);
  // screen-space width of at least uWidthPx pixels, with alpha falling off instead
  vec4 a = uViewProj * vec4(p, 1.0), b = uViewProj * vec4(top, 1.0);
  vec2 sa = a.xy / a.w, sb = b.xy / b.w;
  vec2 dir = normalize((sb - sa) * uResolution + 1e-5);
  vec2 n = vec2(-dir.y, dir.x) / uResolution * uWidthPx;
  float t = (corner == 0 || corner == 1 || corner == 4) ? 0.0 : 1.0;
  float s = (corner == 0 || corner == 2 || corner == 3) ? -1.0 : 1.0;
  if (corner == 3) t = 1.0; if (corner == 5) { t = 1.0; s = 1.0; }
  vec4 clip = mix(a, b, t);
  clip.xy += n * s * clip.w;
  vSide = vec2(s, 0.0);
  vAlong = t;
  vWorld = mix(p, top, t);
  float dist = length(p - uCameraPos);
  vFade = smoothstep(uBox * 0.5, uBox * 0.3, dist) * smoothstep(0.3, 1.2, dist);
  gl_Position = clip;
}`;

const STREAK_FS = /* glsl */`
${COMMON}
${LIGHTS_GLSL}
in vec2 vSide; in float vAlong; in vec3 vWorld; in float vFade;
out vec4 o;
uniform sampler2D uDepth, uScene;
uniform mat4 uViewProjFlat;
uniform vec2 uResolution;
uniform vec3 uCameraPos, uAmbient;
uniform float uIntensity;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  // behind the scene? (manual depth test against the opaque depth)
  vec4 c = uViewProjFlat * vec4(vWorld, 1.0);
  float z = c.z / c.w * 0.5 + 0.5;
  if (z > texture(uDepth, uv).r) discard;
  float profile = (1.0 - vSide.x * vSide.x) * smoothstep(0.0, 0.25, vAlong) * smoothstep(1.0, 0.6, vAlong);
  // refraction: a drop shows an inverted, brightened sliver of what is behind it
  vec3 behind = texture(uScene, uv + vec2(vSide.x * 0.004, 0.006)).rgb;
  vec3 V = normalize(uCameraPos - vWorld);
  // the lights of this tile, seen through the drop (forward scattering)
  vec3 lit = vec3(0.0);
  ivec2 tile = ivec2(gl_FragCoord.xy) / 32;
  int t = tile.y * uTilesX + tile.x;
  int n = int(texelFetch(uLightGrid, ivec2(t, 0), 0).r);
  for (int k = 0; k < 32; k++) {
    if (k >= n) break;
    int i = int(texelFetch(uLightGrid, ivec2(t, 1 + k / 4), 0)[k % 4] + 0.5);
    vec4 la = lightTexel(i, 0), lb = lightTexel(i, 1), lc = lightTexel(i, 2), ld = lightTexel(i, 3);
    vec3 L = la.xyz - vWorld;
    float d2 = dot(L, L);
    float win = saturate(1.0 - d2 / (la.w * la.w));
    if (win <= 0.0) continue;
    L *= inversesqrt(d2);
    float f = win / (d2 + 0.3);
    if (int(lb.w + 0.5) == 1) f *= smoothstep(lc.w, ld.x, dot(-L, lc.xyz));
    float fwd = pow(saturate(dot(-V, L)), 3.0) * 3.0 + 0.25;
    lit += lb.rgb * f * fwd;
  }
  vec3 col = behind * 0.35 + lit * 0.5 + uAmbient * 0.6;
  o = vec4(col * profile * vFade * uIntensity, 0.0);
}`;

const SPLASH_VS = /* glsl */`
${COMMON}
uniform sampler2D uDepth, uG1;
uniform mat4 uInvViewProj, uViewProj;
uniform vec3 uCameraPos;
uniform float uTime, uLife;
uniform vec2 uResolution;
out vec2 vQ;
out float vAge;
out vec3 vWorld;
out float vNear;
void main() {
  int id = gl_InstanceID;
  int corner = gl_VertexID % 6;
  float phase = hash12(vec2(float(id) * 0.31, 9.1));
  float cyc = uTime / uLife + phase;
  float cycle = floor(cyc);
  vAge = fract(cyc);
  vec2 suv = hash22(vec2(float(id) * 0.77 + cycle * 13.1, cycle * 0.37));
  // bias toward the lower half of the frame, where the ground is
  suv.y = suv.y * suv.y;
  float d = textureLod(uDepth, suv, 0.0).r;
  vec3 N = decodeNormal(textureLod(uG1, suv, 0.0).xy);
  vec4 wp = uInvViewProj * vec4(suv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 p = wp.xyz / wp.w;
  float dist = length(p - uCameraPos);
  float ok = (d < 1.0 && N.y > 0.7 && dist < 14.0) ? 1.0 : 0.0;
  vNear = 1.0 - smoothstep(4.0, 14.0, dist);
  vec2 q = vec2(corner == 1 || corner == 2 || corner == 4 ? 1.0 : -1.0, corner == 2 || corner == 4 || corner == 5 ? 1.0 : 0.0);
  vQ = q;
  float size = 0.035 + 0.05 * vAge;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), p - uCameraPos + 1e-4));
  vec3 pos = p + right * q.x * size + vec3(0.0, q.y * size * 0.9, 0.0) + N * 0.005;
  vWorld = pos;
  gl_Position = ok > 0.5 ? uViewProj * vec4(pos, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;

const SPLASH_FS = /* glsl */`
${COMMON}
in vec2 vQ; in float vAge; in vec3 vWorld; in float vNear;
out vec4 o;
uniform sampler2D uScene;
uniform vec2 uResolution;
uniform vec3 uAmbient;
uniform float uIntensity;
void main() {
  // a crown: a thin ring rising and spreading, with a few droplets above it
  float r = abs(vQ.x);
  float crown = smoothstep(0.25, 0.0, abs(vQ.y - (1.0 - r * r) * 0.6 * (1.0 - vAge))) * smoothstep(1.0, 0.7, r);
  float drops = smoothstep(0.08, 0.0, length(vec2(fract(vQ.x * 2.5) - 0.5, vQ.y - 0.7 * (1.0 - vAge) - 0.2)) );
  float a = (crown + drops * 0.6) * (1.0 - vAge);
  vec3 behind = texture(uScene, gl_FragCoord.xy / uResolution + vec2(0.0, 0.004)).rgb;
  o = vec4((behind * 0.6 + uAmbient * 0.8) * a * uIntensity * vNear * 0.6, 0.0);
}`;

export class Rain {
  constructor() {
    this.name = 'rain';
    this.enabled = true;
    this.intensity = 0;          // 0..1: drizzle .. downpour (set by Weather)
    this.wind = [1.2, 0.4];
    this.speed = 9.0;
    this.box = 18;
  }
  init(r) {
    this.pStreak = new Program(r.gl, STREAK_VS, STREAK_FS, {}, 'rain-streaks');
    this.pSplash = new Program(r.gl, SPLASH_VS, SPLASH_FS, {}, 'rain-splash');
    this.vao = r.gl.createVertexArray();
  }
  resize(r) {
    if (!this.target) this.target = new Target(r.gl, { width: r.width, height: r.height, colors: [r.hdr.tex] });
    else { this.target.width = r.width; this.target.height = r.height; this.target.attach(); }
    this.copy?.resize(r.width, r.height);
  }
  afterLighting(r, color) {
    if (this.intensity <= 0.001) return color;
    const gl = r.gl;
    // the drops refract the scene: copy it first
    if (!this.copy) this.copy = new Target(gl, { width: r.width, height: r.height, colors: [{ format: 'rgba16f' }] });
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._readFbo(r, color));
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.copy.fbo);
    gl.blitFramebuffer(0, 0, r.width, r.height, 0, 0, r.width, r.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    this.target.colors[0] = color.width ? color : r.hdr.tex;
    this.target.attach();
    this.target.bind();
    state(gl, { blend: 'add' });
    const amb = r.env.sh, k = 0.28;
    const ambient = [amb[0] * k, amb[1] * k, amb[2] * k];
    gl.bindVertexArray(this.vao);
    const P = this.pStreak.use();
    P.set('uViewProj', r.viewProjJit).set('uViewProjFlat', r.viewProj).set('uCameraPos', r.cameraPos).set('uTime', r.time)
      .set('uBox', this.box).set('uSpeed', this.speed).set('uLength', this.speed / 48).set('uWidthPx', 1.1).set('uWind', this.wind)
      .set('uResolution', [r.width, r.height]).set('uDepth', r.depth).set('uScene', this.copy.tex).set('uAmbient', ambient)
      .set('uIntensity', 0.55 + this.intensity * 0.45);
    r.lightGrid.bind(P);
    const drops = Math.round(6000 + this.intensity * 26000) * (r.q.renderScale < 0.6 ? 0.5 : 1);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, drops);
    const S = this.pSplash.use();
    S.set('uDepth', r.depth).set('uG1', r.gbuffer.colors[1]).set('uInvViewProj', r.invViewProj).set('uViewProj', r.viewProjJit)
      .set('uCameraPos', r.cameraPos).set('uTime', r.time).set('uLife', 0.22).set('uResolution', [r.width, r.height])
      .set('uScene', this.copy.tex).set('uAmbient', ambient).set('uIntensity', 0.9);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, Math.round(300 + this.intensity * 1500));
    gl.bindVertexArray(null);
    state(gl);
    return color;
  }
  _readFbo(r, color) {
    // a framebuffer reading the current colour texture
    this._rt ??= new Target(r.gl, { width: r.width, height: r.height, colors: [color.width ? color : r.hdr.tex] });
    if (this._rt.colors[0] !== color || this._rt.width !== r.width) { this._rt.colors[0] = color; this._rt.width = r.width; this._rt.height = r.height; this._rt.attach(); }
    return this._rt.fbo;
  }
}
