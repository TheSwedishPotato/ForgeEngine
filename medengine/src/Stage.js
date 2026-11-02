import { Scene, PerspectiveCamera, Vector3 } from 'three';
import { Renderer } from './Renderer.js';
import { ProbeVolume } from './gi/ProbeVolume.js';
import { Sprites } from './passes/Sprites.js';
import { GPUParticles } from './passes/GPUParticles.js';
import { ClothSystem } from './passes/GPUCloth.js';
import { Volumetrics } from './passes/Volumetrics.js';
import { ScreenSpace } from './passes/ScreenSpace.js';
import { DOF, MotionBlur } from './passes/Cinematic.js';
import { TAA, Upscale } from './passes/TAA.js';
import { Exposure, Bloom, Composite, Anamorphic } from './passes/Post.js';
import { SkinSSS } from './passes/SkinSSS.js';
import { Rain } from './weather/Rain.js';
import { Debug } from './passes/Debug.js';

/**
 * A Med Engine 2 stage: the renderer with the whole frame pipeline, a scene and a camera.
 *
 *   shadows -> G-buffer -> AO/SSR/SSGI -> local lights (tiles, spot shadows) -> deferred lighting
 *   -> skin scattering -> rain -> particles -> volumetrics -> depth of field -> TAA(U)
 *   -> motion blur -> exposure -> bloom -> anamorphic streaks -> film composite
 *
 * Games set `stage.lens` (focus, aperture, focal length) and `stage.grade` per shot; the
 * cinematic camera (cinema/Director.js) does that for them.
 */
export class Stage {
  constructor(canvas, { quality = 'high', probes = null } = {}) {
    this.canvas = canvas;
    const r = this.r = new Renderer(canvas, { quality });
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(35, innerWidth / innerHeight, 0.03, 1500);
    this.sss = r.addPass(new SkinSSS());
    if (probes) this.probes = r.addPass(new ProbeVolume(probes));
    this.sprites = r.addPass(new Sprites());
    this.particles = r.addPass(new GPUParticles());
    this.cloth = r.addPass(new ClothSystem());
    this.rain = r.addPass(new Rain());
    this.volumetrics = r.addPass(new Volumetrics());
    this.screen = r.addPass(new ScreenSpace());
    this.dof = r.addPass(new DOF());
    this.taa = r.addPass(new TAA());
    r.addPass(new Upscale());
    this.motionBlur = r.addPass(new MotionBlur());
    this.exposure = r.addPass(new Exposure());
    this.bloom = r.addPass(new Bloom());
    this.anamorphic = r.addPass(new Anamorphic());
    this.composite = r.addPass(new Composite());
    const dbg = new URLSearchParams(location.search).get('debug');
    if (dbg) r.addPass(new Debug(dbg));
    this.applyQuality();
    this.lens = { focus: 3, aperture: 2.0, focal: 0.05, amount: 1 };
    this.shake = 0;
    this._shake = new Vector3();
    this.shadowFocus = null;
    window.medStage = this;
    addEventListener('resize', () => this.resize());
  }

  get grade() { return this.composite.grade; }

  applyQuality() {
    const q = this.r.q;
    this.volumetrics.enabled = q.volumetrics !== 'off';
    this.dof.enabled = q.dof;
    this.motionBlur.enabled = q.motionBlur;
    this.bloom.enabled = q.bloom;
    this.sss.enabled = q.ssao !== false;
    this.taa.enabled = true;
  }

  setQuality(q) { this.r.setQuality(q); this.applyQuality(); this.taa.reset = true; }

  resize() {
    this.r.resize();
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  render(dt) {
    const r = this.r, L = this.lens;
    // lens: focus distance, aperture, focal length (the field of view follows the focal length
    // only when the director sets it; here it just feeds depth of field)
    this.dof.focus += (L.focus - this.dof.focus) * Math.min(1, dt * (L.pull ?? 8));
    this.dof.aperture = L.aperture; this.dof.focal = L.focal; this.dof.amount = L.amount;
    // camera shake (handheld and impacts) is added by the director; this is the impact kick
    this.shake = Math.max(0, this.shake - dt * 3.0);
    const k = this.shake * this.shake * 0.05;
    this._shake.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    this.camera.position.add(this._shake);
    const fp = this.shadowFocus;
    r.shadowFocus = fp ? { center: fp.center, radius: fp.radius } : null;
    r.render(this.scene, this.camera, dt);
    this.camera.position.sub(this._shake);
  }
}
