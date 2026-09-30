// Volumetric cumulus: a full-screen ray march through a cloud slab, lit by the sun
// with Beer–Lambert extinction, a short light march, powder darkening and aerial
// perspective. It composites over the outside pass using its depth buffer, so the
// terrain shows through gaps and the clouds sit correctly above and below the aircraft.
import * as THREE from 'three';
import { ATMOS_GLSL, REGION } from './world.js';
import { rng, clamp } from './core.js';

// Tileable 3D noise texture: R = low-frequency shape (billow), G = high-frequency detail.
function noise3D(N = 64) {
  const data = new Uint8Array(N * N * N * 4);
  const r = rng(2026);
  const P = 256, perm = new Uint8Array(P);
  for (let i = 0; i < P; i++) perm[i] = i;
  for (let i = P - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  const h = (x, y, z, f) => perm[(perm[(perm[(x % f + f) % f & 255] + ((y % f + f) % f)) & 255] + ((z % f + f) % f)) & 255] / 255;
  const sm = (t) => t * t * (3 - 2 * t);
  const vn = (x, y, z, f) => { // tileable value noise at frequency f cells
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = sm(x - ix), fy = sm(y - iy), fz = sm(z - iz);
    const c = (dx, dy, dz) => h(ix + dx, iy + dy, iz + dz, f);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy), l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
  };
  // tileable worley (cellular) for the billowy look
  const cells = (f) => { const pts = []; for (let i = 0; i < f * f * f; i++) pts.push([r(), r(), r()]); return pts; };
  const wpts = { 4: cells(4), 8: cells(8) };
  const worley = (x, y, z, f) => {
    const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
    let md = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const gx = ((cx + dx) % f + f) % f, gy = ((cy + dy) % f + f) % f, gz = ((cz + dz) % f + f) % f;
      const p = wpts[f][gx + gy * f + gz * f * f];
      const px = cx + dx + p[0] - x, py = cy + dy + p[1] - y, pz = cz + dz + p[2] - z;
      md = Math.min(md, px * px + py * py + pz * pz);
    }
    return 1 - clamp(Math.sqrt(md) * 1.4, 0, 1);
  };
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N;
    const perlin = 0.5 * vn(u * 4, v * 4, w * 4, 4) + 0.25 * vn(u * 8, v * 8, w * 8, 8) + 0.125 * vn(u * 16, v * 16, w * 16, 16) + 0.0625 * vn(u * 32, v * 32, w * 32, 32);
    const wor = 0.65 * worley(u * 4, v * 4, w * 4, 4) + 0.35 * worley(u * 8, v * 8, w * 8, 8);
    const shape = clamp((perlin / 0.94) * 0.7 + wor * 0.5 - 0.1, 0, 1);
    const detail = 0.55 * vn(u * 8, v * 8, w * 8, 8) + 0.3 * vn(u * 16, v * 16, w * 16, 16) + 0.15 * vn(u * 32, v * 32, w * 32, 32);
    const i = (x + y * N + z * N * N) * 4;
    data[i] = shape * 255; data[i + 1] = detail * 255; data[i + 2] = wor * 255; data[i + 3] = 255;
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat; t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export class VolumetricClouds {
  constructor(world, { steps = 56 } = {}) {
    this.world = world;
    const W = world.weather;
    this.tex = noise3D(64);
    this.mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({
        tColor: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix4() },
        uLogFC: { value: 1 }, uNoise: { value: this.tex }, uCloudMap: { value: world.cloudMap },
        uRegion: { value: new THREE.Vector4(REGION.x0, REGION.z0, REGION.x1 - REGION.x0, REGION.z1 - REGION.z0) },
        uBase: { value: W.cuBase }, uTop: { value: W.cuTop }, uSteps: { value: steps }, uFrame: { value: 0 }, uPreExp: { value: 1 },
        uWind: { value: new THREE.Vector2(6, 2) },
      }, world.u),
      depthTest: false, depthWrite: false,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilFail: THREE.KeepStencilOp,
      vertexShader: 'varying vec2 vUv; varying vec2 vNdc; void main(){ vUv = uv; vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        precision highp float; precision highp sampler3D;
        varying vec2 vUv; varying vec2 vNdc;
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform mat4 uInvProj; uniform mat4 uCamRot; uniform float uLogFC;
        uniform sampler3D uNoise; uniform sampler2D uCloudMap; uniform vec4 uRegion;
        uniform float uBase, uTop, uSteps, uFrame, uPreExp, uTime; uniform vec2 uWind; uniform vec3 uAmbient;
        ${ATMOS_GLSL}
        float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float coverage(vec2 xz){ return texture2D(uCloudMap, (xz - uRegion.xy) / uRegion.zw).r; }
        // cloud density at a world point; cheap version (shape only) for the light march
        float density(vec3 p, bool detail){
          float hf = clamp((p.y - uBase) / (uTop - uBase), 0.0, 1.0);
          float cov = coverage(p.xz);
          if (cov < 0.02) return 0.0;
          vec3 q = (p + vec3(uWind.x, 0.0, uWind.y) * uTime) * (1.0 / 2600.0);
          vec4 n = texture(uNoise, q * vec3(1.0, 1.6, 1.0));
          // vertical profile: flat base, domed top; taller where coverage is high
          float topH = mix(0.45, 1.0, cov);
          float prof = smoothstep(0.0, 0.08, hf) * (1.0 - smoothstep(topH * 0.6, topH, hf));
          float shape = cov * prof;
          float d = smoothstep(1.0 - shape * 1.15, 1.0 - shape * 1.15 + 0.32, n.r + 0.12 * hf);
          if (detail && d > 0.0) {
            vec4 m = texture(uNoise, q * vec3(5.0, 7.0, 5.0) + vec3(0.13, 0.0, 0.29));
            d = clamp(d - (1.0 - m.g) * 0.28 * (1.0 - d), 0.0, 1.0);
          }
          return d;
        }
        float lightMarch(vec3 p, float stepLen){
          float od = 0.0; vec3 q = p;
          for (int i = 0; i < 4; i++) { q += uSunDir * stepLen; od += density(q, false); }
          return od * stepLen;
        }
        void main(){
          vec4 scene = texture2D(tColor, vUv);
          vec4 v = uInvProj * vec4(vNdc, 1.0, 1.0); v /= v.w;
          vec3 vd = normalize(v.xyz);
          vec3 dir = normalize((uCamRot * vec4(vd, 0.0)).xyz);
          // logarithmic depth -> distance along the ray
          float dz = texture2D(tDepth, vUv).r;
          float w = exp2(dz * uLogFC) - 1.0;
          float tMax = dz > 0.99999 ? 1.0e9 : w / max(-vd.z, 1e-4);
          // slab intersection
          float t0, t1;
          float dy = dir.y;
          if (abs(dy) < 1e-4) { if (uCamPos.y > uBase && uCamPos.y < uTop) { t0 = 0.0; t1 = 60000.0; } else { gl_FragColor = scene; return; } }
          else {
            float ta = (uBase - uCamPos.y) / dy, tb = (uTop - uCamPos.y) / dy;
            t0 = max(min(ta, tb), 0.0); t1 = max(ta, tb);
          }
          t1 = min(t1, min(tMax, 70000.0));
          if (t1 <= t0) { gl_FragColor = scene; return; }
          // limit the march to where clouds are dense enough to matter
          float len = t1 - t0;
          float steps = uSteps;
          float ds = len / steps;
          float jitter = hash12(gl_FragCoord.xy + uFrame);
          float t = t0 + ds * jitter;
          float T = 1.0; vec3 col = vec3(0.0);
          float sigma = 0.045;
          float mu = dot(dir, uSunDir);
          float g = 0.35;
          float phase = (1.0 - g*g) / (4.0 * 3.14159 * pow(1.0 + g*g - 2.0*g*mu, 1.5)) * 0.85 + 0.15 * (1.0 / (4.0 * 3.14159));
          float meanT = 0.0, wsum = 0.0;
          vec3 skyTop = uZenith * 0.6 + uHorizon * 0.4;
          for (int i = 0; i < 96; i++) {
            if (float(i) >= steps || T < 0.02 || t > t1) break;
            vec3 p = uCamPos + dir * t;
            float d = density(p, true);
            if (d > 0.002) {
              float hf = clamp((p.y - uBase) / (uTop - uBase), 0.0, 1.0);
              float od = lightMarch(p, (uTop - uBase) * 0.22);
              float lt = exp(-od * sigma * 0.9);
              float powder = 1.0 - exp(-od * sigma * 2.5);
              vec3 sunL = uSunCol * lt * phase * 12.0 * mix(0.6, 1.0, powder);
              vec3 amb = mix(uAmbient * 0.9, skyTop * 1.3, hf) * 1.4;
              vec3 c = sunL + amb;
              float a = 1.0 - exp(-d * sigma * ds);
              col += T * a * c;
              meanT += T * a * t; wsum += T * a;
              T *= 1.0 - a;
            }
            t += ds;
          }
          float alpha = 1.0 - T;
          if (alpha > 0.001) {
            float dist = meanT / max(wsum, 1e-4);
            vec3 p = uCamPos + dir * dist;
            vec4 ap = aerial(p);
            col = mix(col, ap.rgb * alpha, ap.a);
          }
          gl_FragColor = vec4(scene.rgb * T + col * uPreExp, 1.0);
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.frame = 0;
  }

  // Composite rtWorld (+ clouds) into the current render target using the world camera.
  render(renderer, camera, rtWorld, preExp, time) {
    const u = this.mat.uniforms;
    u.tColor.value = rtWorld.texture; u.tDepth.value = rtWorld.depthTexture;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamRot.value.extractRotation(camera.matrixWorld);
    u.uLogFC.value = Math.log2(camera.far + 1);
    u.uFrame.value = (this.frame++ % 64) * 0.37;
    u.uPreExp.value = preExp; u.uTime.value = time;
    renderer.render(this.scene, this.cam);
  }
}
