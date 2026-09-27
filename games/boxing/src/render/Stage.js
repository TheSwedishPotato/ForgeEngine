import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, FogExp2, ACESFilmicToneMapping, SRGBColorSpace, PCFSoftShadowMap,
  WebGLRenderTarget, HalfFloatType, PMREMGenerator, Vector2, Vector3,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.045 },
    uAberration: { value: 0.0015 },
    uHurt: { value: 0 },
    uFlash: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uAberration, uHurt, uFlash; uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r = length(c);
      // chromatic aberration, stronger at the edges and on impacts
      float ab = uAberration * (0.5 + r * 2.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ab).b;
      // hurt: double vision + blur + desaturation + tunnel
      if (uHurt > 0.001) {
        vec2 off = vec2(sin(uTime * 1.7), cos(uTime * 1.3)) * 0.012 * uHurt;
        vec3 ghost = texture2D(tDiffuse, vUv + off).rgb;
        vec3 blur = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.785;
          blur += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * 0.006 * uHurt).rgb;
        }
        blur /= 8.0;
        col = mix(col, (col + ghost) * 0.5, 0.6 * uHurt);
        col = mix(col, blur, 0.5 * uHurt);
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(l), 0.45 * uHurt);
        col *= 1.0 - smoothstep(0.25, 0.75, r) * 0.75 * uHurt;
      }
      col += uFlash * vec3(1.0, 0.95, 0.9);
      // vignette
      col *= 1.0 - uVignette * smoothstep(0.35, 0.85, r);
      // grain
      float n = hash(vUv * uResolution + uTime * 61.0) - 0.5;
      col += n * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/**
 * Renderer, scene, camera and the post-processing chain.
 * Quality: 'high' (MSAA x4, bloom, 4k shadows), 'medium', 'low'.
 */
export class Stage {
  constructor(canvas, { quality = 'high' } = {}) {
    this.quality = quality;
    const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    const dpr = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer = renderer;

    const scene = new Scene();
    scene.background = new Color(0x05060a);
    scene.fog = new FogExp2(0x07080d, 0.045);
    this.scene = scene;

    // Image-based lighting for reflections (leather, sweat, satin).
    const pmrem = new PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.18;

    const camera = new PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 120);
    camera.position.set(0, 1.7, -3);
    this.camera = camera;

    this.usePost = quality !== 'low';
    if (this.usePost) {
      const size = renderer.getDrawingBufferSize(new Vector2());
      const rt = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: quality === 'high' ? 4 : 2 });
      const composer = new EffectComposer(renderer, rt);
      composer.addPass(new RenderPass(scene, camera));
      this.bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.32, 0.5, 0.9);
      composer.addPass(this.bloom);
      composer.addPass(new OutputPass());
      this.lens = new ShaderPass(LensShader);
      this.lens.uniforms.uResolution.value.copy(size);
      composer.addPass(this.lens);
      this.composer = composer;
    }
    this.shake = 0;
    this.shakeOffset = new Vector3();
    this.flash = 0;
    this.aberration = 0;
    this.hurt = 0;
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      const size = this.renderer.getDrawingBufferSize(new Vector2());
      this.composer.setSize(w, h);
      this.lens.uniforms.uResolution.value.copy(size);
    }
  }

  kick({ shake = 0, flash = 0, aberration = 0 } = {}) {
    this.shake = Math.min(1, this.shake + shake);
    this.flash = Math.min(0.6, this.flash + flash);
    this.aberration = Math.min(1, this.aberration + aberration);
  }

  render(dt, time) {
    // camera shake (applied as an offset, removed after rendering)
    this.shake = Math.max(0, this.shake - dt * 3.5);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.aberration = Math.max(0, this.aberration - dt * 3);
    const k = this.shake * this.shake * 0.06;
    this.shakeOffset.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    this.camera.position.add(this.shakeOffset);
    if (this.composer) {
      const u = this.lens.uniforms;
      u.uTime.value = time;
      u.uHurt.value = this.hurt;
      u.uFlash.value = this.flash;
      u.uAberration.value = 0.0012 + this.aberration * 0.01;
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.camera.position.sub(this.shakeOffset);
  }
}
