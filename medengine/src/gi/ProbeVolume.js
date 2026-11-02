import { Matrix4, PerspectiveCamera, Vector3, Frustum } from 'three';
import { Program, Texture, Target, postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON, SKY } from '../shaders/common.js';
import { GEOMETRY_VS } from '../shaders/geometry.js';
import { SHADOW_GLSL } from '../passes/Shadows.js';
import { PROBES_GLSL } from '../shaders/lighting.js';

/**
 * Forward shading used when the scene is captured into probes: base colour
 * lit by the sun (with the cascaded shadows), by the probe volume itself
 * (so bounces accumulate over successive updates), plus emission.
 */
export const CAPTURE_FS = /* glsl */`
${COMMON}
${SKY}
${SHADOW_GLSL}
${PROBES_GLSL}
in vec3 vWorld; in vec3 vNormal; in vec2 vUv; in vec3 vColor; in vec4 vCur; in vec4 vPrev;
uniform vec3 uBaseColor, uEmissive;
uniform float uMetalness, uUnlitScale;
uniform sampler2D uMap;
uniform mat3 uMapTransform;
uniform vec3 uSunIrradiance;
uniform mat4 uMainView;
out vec4 o;
void main() {
  vec3 base = uBaseColor * vColor;
#ifdef USE_MAP
  base *= textureLod(uMap, (uMapTransform * vec3(vUv, 1.0)).xy, 4.0).rgb;
#endif
#ifdef FLAT
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
  vec3 N = normalize(vNormal);
#endif
#if defined(DOUBLE_SIDED) || defined(BACK_SIDE)
  if (!gl_FrontFacing) N = -N;
#endif
#ifdef UNLIT
  o = vec4(base, 1.0); return;
#endif
  vec3 diffuse = base * (1.0 - uMetalness * 0.8);
  float viewDepth = -(uMainView * vec4(vWorld, 1.0)).z;
  float vis = sunShadowFast(vWorld + N * 0.05, viewDepth);
  vec3 c = diffuse * INV_PI * (uSunIrradiance * saturate(dot(N, uSunDir)) * vis + irradianceAt(vWorld, N)) + uEmissive;
  o = vec4(c, 1.0);
}`;

// SH projection of a 6-face capture (array texture) into one probe column.
const PROJECT_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform highp sampler2DArray uFaces;
uniform mat4 uFaceInv[6];
uniform int uSize;
uniform float uBlend;
uniform sampler2D uOld;
uniform int uIndex;
uniform vec3 uProbePos;
float Y(int k, vec3 d) {
  if (k == 0) return 0.282095;
  if (k == 1) return 0.488603 * d.y;
  if (k == 2) return 0.488603 * d.z;
  if (k == 3) return 0.488603 * d.x;
  if (k == 4) return 1.092548 * d.x * d.y;
  if (k == 5) return 1.092548 * d.y * d.z;
  if (k == 6) return 0.315392 * (3.0 * d.z * d.z - 1.0);
  if (k == 7) return 1.092548 * d.x * d.z;
  return 0.546274 * (d.x * d.x - d.y * d.y);
}
void main() {
  int k = int(gl_FragCoord.y);
  vec3 sum = vec3(0.0); float wsum = 0.0;
  for (int f = 0; f < 6; f++) {
    for (int y = 0; y < 32; y++) {
      if (y >= uSize) break;
      for (int x = 0; x < 32; x++) {
        if (x >= uSize) break;
        vec2 ndc = (vec2(x, y) + 0.5) / float(uSize) * 2.0 - 1.0;
        vec4 p = uFaceInv[f] * vec4(ndc, 1.0, 1.0);
        vec3 d = normalize(p.xyz / p.w - uProbePos);
        float w = 1.0 / pow(1.0 + dot(ndc, ndc), 1.5);
        vec3 L = texelFetch(uFaces, ivec3(x, y, f), 0).rgb;
        sum += L * Y(k, d) * w;
        wsum += w;
      }
    }
  }
  vec3 c = sum * (4.0 * PI / wsum);
  vec3 old = texelFetch(uOld, ivec2(uIndex, k), 0).rgb;
  o = vec4(mix(old, c, uBlend), 1.0);
}`;

const SKY_FILL_FS = /* glsl */`
${COMMON}
${SKY}
in vec2 vUv; out vec4 o;
uniform mat4 uInv;
uniform vec3 uEye;
void main() {
  vec4 p = uInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  o = vec4(skyRadiance(p.xyz / p.w - uEye, false), 1.0);
}`;

const COPY_COL_FS = `in vec2 vUv; out vec4 o; uniform sampler2D uSrc; void main(){ o = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0); }`;

const FACES = [
  [new Vector3(1, 0, 0), new Vector3(0, -1, 0)], [new Vector3(-1, 0, 0), new Vector3(0, -1, 0)],
  [new Vector3(0, 1, 0), new Vector3(0, 0, 1)], [new Vector3(0, -1, 0), new Vector3(0, 0, -1)],
  [new Vector3(0, 0, 1), new Vector3(0, -1, 0)], [new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
];

/** Shared machinery: render the scene into six faces around a point. */
class Capturer {
  constructor(r, size) {
    const gl = r.gl;
    this.r = r;
    this.size = size;
    this.faces = new Texture(gl, { target: 'array', width: size, height: size, depth: 6, format: 'rgba16f', filter: 'linear' });
    this.depth = new Texture(gl, { width: size, height: size, format: 'depth24', filter: 'nearest' });
    this.fbo = gl.createFramebuffer();
    this.cam = new PerspectiveCamera(90, 1, 0.1, 400);
    this.vp = []; this.inv = new Float32Array(96);
    for (let i = 0; i < 6; i++) this.vp.push(new Matrix4());
    this.skyProg = postProgram(gl, SKY_FILL_FS, {}, 'capture-sky');
  }

  /** Renders the six faces around `pos` into the array texture. */
  capture(pos, items, near = 60) {
    const r = this.r, gl = r.gl;
    const frustum = new Frustum();
    for (let f = 0; f < 6; f++) {
      const [dir, up] = FACES[f];
      this.cam.position.copy(pos);
      this.cam.up.copy(up);
      this.cam.lookAt(_t.copy(pos).add(dir));
      this.cam.updateMatrixWorld();
      this.cam.updateProjectionMatrix();
      const vp = this.vp[f].multiplyMatrices(this.cam.projectionMatrix, this.cam.matrixWorldInverse);
      this.inv.set(_m.copy(vp).invert().elements, f * 16);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.faces.tex, 0, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth.tex, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, this.size, this.size);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      state(gl);
      this.skyProg.use().setAll(r.skyUniforms()).set('uInv', _m.copy(vp).invert()).set('uEye', pos);
      fullscreen(gl);
      state(gl, { depthTest: true, depthWrite: true });
      frustum.setFromProjectionMatrix(vp);
      const near2 = near * near;
      const sel = items.filter((it) => {
        if (it.mat.transparent || it.object.userData.captureSkip) return false;
        // Probes record the big, still world. Knights and their small fittings
        // add nothing a 16-pixel face can see; leave them out.
        if (!it.bounds || it.skin) return false;
        if (it.bounds[3] < 0.6 && !it.instances) return false;
        const dx = it.bounds[0] - pos.x, dy = it.bounds[1] - pos.y, dz = it.bounds[2] - pos.z;
        return dx * dx + dy * dy + dz * dz < near2 + it.bounds[3] * it.bounds[3] * 4 || it.bounds[3] > 30;
      });
      r.drawItems(sel, 'capture', vp, { frustum, extra: r.captureUniforms() });
      r.customDraw('capture', vp, frustum, r.captureUniforms());
    }
  }
}

const _t = new Vector3(), _m = new Matrix4();

export class ProbeVolume {
  constructor({ min = [-21, 0.35, -21], max = [21, 6.5, 21], dims = [9, 3, 9], perFrame = 2, size = 16 } = {}) {
    this.name = 'probes';
    this.min = min; this.max = max; this.dims = dims;
    this.count = dims[0] * dims[1] * dims[2];
    this.perFrame = perFrame;
    this.size = size;
    this.next = 0;
    this.filled = 0;
    this.reflection = { pos: new Vector3(0, 1.7, 0), radius: 26, size: 96, face: 0, interval: 3, timer: 0, ready: false };
  }

  init(r) {
    const gl = r.gl;
    this.r = r;
    this.cap = new Capturer(r, this.size);
    this.a = new Target(gl, { width: this.count, height: 9, colors: [{ format: 'rgba16f', filter: 'nearest' }] });
    this.b = new Target(gl, { width: this.count, height: 9, colors: [{ format: 'rgba16f', filter: 'nearest' }] });
    this.project = postProgram(gl, PROJECT_FS, {}, 'sh-project');
    this.copyCol = postProgram(gl, COPY_COL_FS, {}, 'copy-col');
    this.seeded = false;
    r.probeVolume = { min: this.min, max: this.max, dims: this.dims };
    // reflection probe
    const R = this.reflection;
    this.reflCap = new Capturer(r, R.size);
    this.reflCube = new Texture(gl, { target: 'cube', width: R.size, height: R.size, format: 'rgba16f', filter: 'mip' });
    this.reflFbo = new Target(gl, { width: R.size, height: R.size, colors: [{ format: 'rgba16f' }] });
    this.reflSpec = new Texture(gl, { target: 'cube', width: R.size, height: R.size, format: 'rgba16f', filter: 'mip', levels: 6 });
    this.copyLayer = postProgram(gl, `in vec2 vUv; out vec4 o; uniform highp sampler2DArray uA; uniform int uL; void main(){ o = texelFetch(uA, ivec3(ivec2(gl_FragCoord.xy), uL), 0); }`, {}, 'copy-layer');
  }

  probePos(i) {
    const [nx, ny] = this.dims;
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
    const f = (a, b, k, n) => a + (b - a) * (k / Math.max(1, n - 1));
    return new Vector3(f(this.min[0], this.max[0], x, this.dims[0]), f(this.min[1], this.max[1], y, this.dims[1]), f(this.min[2], this.max[2], z, this.dims[2]));
  }

  /** Seeds every probe with the sky's SH so ambient is right from frame one. */
  _seed(r) {
    const gl = r.gl;
    const data = new Float32Array(this.count * 9 * 4);
    for (let k = 0; k < 9; k++) for (let i = 0; i < this.count; i++) {
      const o = (k * this.count + i) * 4;
      data[o] = r.env.sh[k * 3]; data[o + 1] = r.env.sh[k * 3 + 1]; data[o + 2] = r.env.sh[k * 3 + 2]; data[o + 3] = 1;
    }
    const h = toHalf(data);
    for (const t of [this.a, this.b]) t.tex.upload(h);
    this.seeded = true;
    void gl;
  }

  beforeLighting(r) {
    if (!r.q.probes) { r.probeTexture = null; return; }
    if (!this.seeded) this._seed(r);
    const gl = r.gl;
    r.probeTexture = this.b.tex;   // read the current set while updating
    for (let n = 0; n < this.perFrame; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.count;
      const pos = this.probePos(i);
      this.cap.capture(pos, r.lists.opaque, 50);
      // project into column i of A (copy B first so other columns persist)
      this.a.bind();
      state(gl);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(i, 0, 1, 9);
      this.project.use().set('uFaces', this.cap.faces).set('uFaceInv', this.cap.inv).set('uSize', this.size)
        .set('uBlend', this.filled < this.count ? 1 : 0.6).set('uOld', this.b.tex).set('uIndex', i).set('uProbePos', pos);
      fullscreen(gl);
      gl.disable(gl.SCISSOR_TEST);
      // copy column back to B
      this.b.bind();
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(i, 0, 1, 9);
      this.copyCol.use().set('uSrc', this.a.tex);
      fullscreen(gl);
      gl.disable(gl.SCISSOR_TEST);
      this.filled++;
    }
    r.probeTexture = this.b.tex;
    this._reflection(r);
  }

  /** The reflection probe: one face per frame, then prefilter, every few seconds. */
  _reflection(r) {
    const R = this.reflection, gl = r.gl;
    R.timer -= r.dt;
    if (R.face === 0 && R.timer > 0 && R.ready) return;
    if (R.face === 0) R.timer = R.interval;
    // capture all faces into the array (cheap at this size), copy one per frame
    if (R.face === 0) this.reflCap.capture(R.pos, r.lists.opaque, 80);
    state(gl);
    this.copyLayer.use().set('uA', this.reflCap.faces);
    for (let f = 0; f < 6; f++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.reflFbo.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, this.reflCube.tex, 0);
      gl.viewport(0, 0, R.size, R.size);
      this.copyLayer.set('uL', f);
      fullscreen(gl);
    }
    this.reflCube.generateMips();
    // prefilter into our own cube (reuse the environment's filter)
    const env = r.env;
    const saveSpec = env.spec, saveT = env.specTarget;
    env.spec = this.reflSpec;
    if (!this.reflSpecTarget) this.reflSpecTarget = new Target(gl, { width: R.size, height: R.size, colors: [this.reflSpec] });
    env.specTarget = this.reflSpecTarget;
    env.filterFrom(this.reflCube, R.size);
    env.spec = saveSpec; env.specTarget = saveT;
    R.face = 0;
    R.ready = true;
    r.reflectionProbe = { tex: this.reflSpec, pos: R.pos, radius: R.radius };
  }
}

/** Float32 -> IEEE half (Uint16) for uploads to RGBA16F. */
export function toHalf(f32) {
  const out = new Uint16Array(f32.length);
  const fv = new Float32Array(1), iv = new Uint32Array(fv.buffer);
  for (let i = 0; i < f32.length; i++) {
    fv[0] = f32[i];
    const x = iv[0];
    const sign = (x >> 16) & 0x8000;
    let e = ((x >> 23) & 0xff) - 127 + 15;
    let m = x & 0x7fffff;
    if (e <= 0) { out[i] = sign; continue; }
    if (e >= 31) { out[i] = sign | 0x7c00; continue; }
    out[i] = sign | (e << 10) | (m >> 13);
  }
  return out;
}
void Program; void GEOMETRY_VS;
