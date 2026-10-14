/**
 * The overhead line's wires, drawn as lines over the finished image.
 *
 * A contact wire is 13 mm thick: a few metres away it is already thinner than a pixel, and as
 * geometry it would flicker and crawl as the train moves. Here every wire is a strip at least a
 * pixel wide whose opacity is the share of that pixel the wire really covers (coverage), so it
 * stays a steady, faint line into the distance, as in a photograph. Hidden behind anything
 * nearer (the depth buffer), seen through falling snow and fog with the contrast those leave it,
 * lit by the sky and the sun (copper turned dark brown; white with rime in freezing fog).
 */
import { Program, Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';

const VS = /* glsl */`
layout(location = 0) in vec4 aA;      // end A (world), radius
layout(location = 1) in vec4 aB;      // end B (world), daylight on the span (0 in a tunnel)
uniform mat4 uViewProj, uView;
uniform vec2 uResolution;
uniform float uFogExt, uFocal;
out float vCover, vDepth, vFade, vEdge, vLight;
void main() {
  int c = gl_VertexID % 6;
  const vec2 Q[6] = vec2[](vec2(0, -1), vec2(1, -1), vec2(1, 1), vec2(0, -1), vec2(1, 1), vec2(0, 1));
  vec2 q = Q[c];
  vec4 a = uViewProj * vec4(aA.xyz, 1.0), b = uViewProj * vec4(aB.xyz, 1.0);
  // keep the segment in front of the eye
  if (a.w < 0.05 && b.w < 0.05) { gl_Position = vec4(2.0); return; }
  if (a.w < 0.05) a = mix(b, a, (b.w - 0.05) / (b.w - a.w));
  if (b.w < 0.05) b = mix(a, b, (a.w - 0.05) / (a.w - b.w));
  vec2 sa = a.xy / a.w * 0.5 * uResolution, sb = b.xy / b.w * 0.5 * uResolution;
  vec2 d = sb - sa;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  vec4 p = mix(a, b, q.x);
  float w = p.w;
  // the wire's width in pixels here, and the strip's (at least about a pixel)
  float px = aA.w * 2.0 * uFocal / w;
  float strip = max(px, 1.15);
  vCover = min(1.0, px / strip);
  vec2 s = mix(sa, sb, q.x) + n * q.y * (strip * 0.5 + 0.75);
  vEdge = q.y * (strip * 0.5 + 0.75) / (strip * 0.5);
  gl_Position = vec4(s / (0.5 * uResolution) * w, p.z, w);
  vDepth = w;
  vFade = exp(-uFogExt * w);
  vLight = aB.w;
}`;

const FS = /* glsl */`
${COMMON}
in float vCover, vDepth, vFade, vEdge, vLight;
uniform highp sampler2D uDepth;
uniform mat4 uInvProj;
uniform vec2 uResolution;
uniform vec3 uColor;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float z = texture(uDepth, uv).r;
  if (z < 1.0) {
    vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
    if (-p.z / p.w < vDepth - 0.05) discard;     // something nearer in front of the wire
  }
  // the strip's profile: full inside, a pixel's soft edge
  float e = clamp((1.0 - abs(vEdge)) * 2.0 + 0.5, 0.0, 1.0);
  float a = vCover * e * vFade;
  if (a < 0.004) discard;
  o = vec4(uColor * vLight * a, a);
  if (!(abs(o.r) + abs(o.g) + abs(o.b) + abs(o.a) < 1e30)) o = vec4(0.0);
  o = clamp(o, vec4(0.0), vec4(6e4, 6e4, 6e4, 1.0));
}`;

export class Wires {
  constructor(stage) {
    this.name = 'wires';
    this.enabled = true;
    this.stage = stage;
    this.count = 0;
    this.data = new Float32Array(8 * 4096);
    this.color = [0.02, 0.016, 0.013];
    this.albedo = [0.12, 0.09, 0.07];
    this.fogExt = 0;
  }

  init(r) {
    const gl = (this.gl = r.gl);
    this.prog = new Program(gl, VS, FS, {}, 'wires');
    this.copy = postProgram(gl, `in vec2 vUv; out vec4 o; uniform sampler2D uC; void main(){ o = texture(uC, vUv); }`, {}, 'wires-copy');
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
  }

  resize(r) {
    if (!this.target) this.target = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba16f' }] });
    else this.target.resize(r.displayW, r.displayH);
  }

  setWeather(weather) {
    const p = weather.p;
    // rime in freezing fog turns the wires white; otherwise weathered copper and bronze
    this.albedo = p.id === 'fog' ? [0.75, 0.77, 0.8] : [0.12, 0.09, 0.07];
    this.fogExt = p.fog || (p.snowfall ?? 0) > 0 ? 3.912 / Math.max(50, p.visibility ?? 1e5) : 1 / 9000;
  }

  /** The segments to draw this frame: [ax, ay, az, radius, bx, by, bz, 0] each, world. */
  setSegments(arr, n) {
    if (arr.length > this.data.length) this.data = new Float32Array(arr.length);
    this.data.set(arr.subarray(0, n * 8));
    this.count = n;
    this.dirty = true;
  }

  afterLighting(r, color) {
    if (!this.count) return color;
    const gl = r.gl;
    if (this.dirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      if (this.data.byteLength > (this._cap ?? 0)) { gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW); this._cap = this.data.byteLength; }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.dirty = false;
    }
    // the wires' light: the sky from above and the sun on their sunny side (a thin cylinder sees ~1/π of it)
    const sh = r.env.sh, k = 0.282095 * 1.5 / Math.PI;
    const sun = r.sunIntensity * Math.max(0, r.sunDir.y) * 0.32 / Math.PI;
    const al = this.albedo;
    const col = [0, 1, 2].map((i) => al[i] * (sh[i] * k + [r.sunColor.x, r.sunColor.y, r.sunColor.z][i] * sun));
    this.target.bind();
    state(gl);
    this.copy.use().set('uC', color);
    fullscreen(gl);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    this.prog.use().set('uViewProj', r.viewProj).set('uView', r.view).set('uResolution', [r.displayW, r.displayH])
      .set('uFogExt', this.fogExt).set('uFocal', r.proj.elements[5] * r.displayH * 0.5).set('uDepth', r.depth).set('uInvProj', r.invProj).set('uColor', col);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return this.target.tex;
  }
}
