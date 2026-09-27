// HDR post-processing: linear half-float scene buffers, bloom, film grade and SMAA.
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const FINAL_GLSL = /* glsl */`
uniform sampler2D tScene; uniform float uExposure; uniform float uTime; uniform vec2 uRes;
uniform float uVignette; uniform float uGrain; uniform float uCA; uniform float uSat; uniform float uContrast;
uniform vec3 uTint; uniform float uFlash; uniform float uEarFade; uniform float uRed; uniform float uDark;
varying vec2 vUv;
vec3 aces(vec3 x){ const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
vec3 toSRGB(vec3 c){ return mix(12.92*c, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p){ p = fract(p*vec2(443.897, 441.423)); p += dot(p, p.yx+19.19); return fract((p.x+p.y)*p.x); }
void main(){
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  // lateral chromatic aberration grows towards the edge of the frame
  vec2 ca = d * r2 * uCA;
  vec3 col;
  col.r = texture2D(tScene, uv - ca).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv + ca).b;
  col *= uExposure;
  col *= uTint;
  col = aces(col);
  // grade: contrast around mid grey, saturation
  col = (col - 0.5) * uContrast + 0.5;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  // vignette
  float v = 1.0 - smoothstep(0.35, 1.25, r2 * 2.0) * uVignette;
  col *= v;
  // film grain
  float g = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 100.0) - 0.5;
  col += g * uGrain * (0.6 + 0.4 * (1.0 - l));
  // ear-pressure darkening at the edges, camera flash
  col *= 1.0 - uEarFade * smoothstep(0.1, 0.9, r2 * 2.5);
  col = mix(col, vec3(1.0), uFlash);
  // injury: a red pulse from the edges; blackout (hypoxia, impact): fade to black
  col = mix(col, col * vec3(1.0, 0.25, 0.2) + vec3(0.18, 0.0, 0.0), uRed * smoothstep(0.05, 0.7, r2 * 2.5 + 0.3));
  col *= 1.0 - uDark;
  gl_FragColor = vec4(toSRGB(clamp(col, 0.0, 1.0)), 1.0);
}`;

export class PostFX {
  constructor(renderer, { width, height, quality = 'high' }) {
    this.renderer = renderer;
    this.quality = quality;
    this.enabled = quality !== 'low';
    const mk = (w, h, depth) => {
      const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, samples: 0 });
      rt.texture.minFilter = THREE.LinearFilter; rt.texture.magFilter = THREE.LinearFilter;
      if (depth) { rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedInt248Type); rt.depthTexture.format = THREE.DepthStencilFormat; }
      return rt;
    };
    this.rtWorld = mk(width, height, true);   // outside pass (sky, terrain, scenery) + depth for the cloud march
    this.rtMain = mk(width, height, false);   // composite: clouds, aircraft exterior, cabin
    this.rtLDR = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.55, 0.6, 0.9);
    this.bloom.threshold = 1.35; this.bloom.strength = quality === 'ultra' ? 0.42 : 0.34; this.bloom.radius = 0.5;
    this.smaa = new SMAAPass(width, height); this.smaa.renderToScreen = true;
    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, uExposure: { value: 1 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(width, height) },
        uVignette: { value: 0.38 }, uGrain: { value: 0.018 }, uCA: { value: 0.006 }, uSat: { value: 1.04 }, uContrast: { value: 1.03 },
        uTint: { value: new THREE.Color(1, 1, 1) }, uFlash: { value: 0 }, uEarFade: { value: 0 }, uRed: { value: 0 }, uDark: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FINAL_GLSL, depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.finalMat);
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tScene; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tScene, vUv); }',
      depthTest: false, depthWrite: false,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilFail: THREE.KeepStencilOp,
    });
    this.copyQuad = new FullScreenQuad(this.copyMat);
  }

  setSize(w, h) {
    for (const rt of [this.rtWorld, this.rtMain, this.rtLDR]) rt.setSize(w, h);
    this.bloom.setSize(w, h); this.smaa.setSize(w, h);
    this.finalMat.uniforms.uRes.value.set(w, h);
  }

  // Copy the outside pass into the main buffer where the stencil allows (no volumetrics).
  blitWorld() {
    const r = this.renderer;
    this.copyMat.uniforms.tScene.value = this.rtWorld.texture;
    r.setRenderTarget(this.rtMain);
    this.copyQuad.render(r);
  }

  // Bloom + grade + anti-aliasing from rtMain to the screen.
  finish({ exposure, time, night = 0, earFade = 0, flash = 0, red = 0, dark = 0, tint = null, bloom = true, smaa = true }) {
    const r = this.renderer;
    const prev = r.autoClear; r.autoClear = false;
    if (bloom) this.bloom.render(r, null, this.rtMain, 0, false);
    const u = this.finalMat.uniforms;
    u.tScene.value = this.rtMain.texture; u.uExposure.value = exposure; u.uTime.value = time;
    u.uGrain.value = 0.006 + 0.016 * night; u.uEarFade.value = Math.min(1, earFade); u.uFlash.value = flash; u.uRed.value = Math.min(1, red); u.uDark.value = Math.min(1, dark);
    if (tint) u.uTint.value.copy(tint); else u.uTint.value.setScalar(1);
    if (smaa) {
      r.setRenderTarget(this.rtLDR); this.quad.render(r);
      r.setRenderTarget(null);
      this.smaa.render(r, null, this.rtLDR, 0, false);
    } else { r.setRenderTarget(null); this.quad.render(r); }
    r.autoClear = prev;
  }
}
