import { Scene, PerspectiveCamera, Vector3 } from 'three';
import { Renderer } from '../engine/Renderer.js';
import { ProbeVolume } from '../engine/gi/ProbeVolume.js';
import { Sprites } from '../engine/passes/Sprites.js';
import { Volumetrics } from '../engine/passes/Volumetrics.js';
import { ScreenSpace } from '../engine/passes/ScreenSpace.js';
import { DOF, MotionBlur } from '../engine/passes/Cinematic.js';
import { TAA, Upscale } from '../engine/passes/TAA.js';
import { Exposure, Bloom, Composite } from '../engine/passes/Post.js';
import { Debug } from '../engine/passes/Debug.js';
import { SUN_DIR } from './Sky.js';

/**
 * The game's stage on the Forge renderer: same interface the game used with
 * the old three.js Stage (scene, camera, sky.update, kick, hurt, visor,
 * setQuality, render), but every pixel is drawn by our own engine.
 */
export class ForgeStage {
  constructor(canvas, { quality = 'high' } = {}) {
    this.quality = quality;
    const r = this.r = this.renderer = new Renderer(canvas, { quality });
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 900);
    this.camera.position.set(0, 1.7, -3);
    r.sunDir.copy(SUN_DIR);
    // Pass order is pipeline order.
    this.probes = r.addPass(new ProbeVolume());
    this.sprites = r.addPass(new Sprites());
    this.volumetrics = r.addPass(new Volumetrics());
    this.screen = r.addPass(new ScreenSpace());
    this.dof = r.addPass(new DOF());
    this.taa = r.addPass(new TAA());
    r.addPass(new Upscale());
    this.motionBlur = r.addPass(new MotionBlur());
    this.exposure = r.addPass(new Exposure());
    this.bloom = r.addPass(new Bloom());
    this.composite = r.addPass(new Composite());
    const dbg = new URLSearchParams(location.search).get('debug');
    if (dbg) r.addPass(new Debug(dbg));
    window.forge = r;
    this._applyQuality();
    this.sky = { update: (t) => { this.skyTime = t; } };
    this.shake = 0; this.flash = 0; this.aberration = 0; this.hurt = 0; this.visor = 0;
    this.shakeOffset = new Vector3();
    this.focusPoint = null;   // world point the lens focuses on
    this.dofAmount = 0.4;
    window.addEventListener('resize', () => this.resize());
  }

  _applyQuality() {
    const q = this.r.q;
    this.volumetrics.enabled = q.volumetrics !== 'off';
    this.dof.enabled = q.dof;
    this.motionBlur.enabled = q.motionBlur;
    this.bloom.enabled = q.bloom;
    this.taa.enabled = true;
  }

  setQuality(q) { this.quality = q; this.r.setQuality(q); this._applyQuality(); this.taa.reset = true; }

  resize() {
    this.r.resize();
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  kick({ shake = 0, flash = 0, aberration = 0 } = {}) {
    this.shake = Math.min(1, this.shake + shake);
    this.flash = Math.min(0.6, this.flash + flash);
    this.aberration = Math.min(1, this.aberration + aberration);
  }

  render(dt, time) {
    this.shake = Math.max(0, this.shake - dt * 3.5);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.aberration = Math.max(0, this.aberration - dt * 3);
    const k = this.shake * this.shake * 0.06;
    this.shakeOffset.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    this.camera.position.add(this.shakeOffset);
    if (this.focusPoint) {
      const d = this.camera.position.distanceTo(this.focusPoint);
      this.dof.focus += (d - this.dof.focus) * Math.min(1, dt * 6);
    }
    this.dof.amount += (this.dofAmount - this.dof.amount) * Math.min(1, dt * 3);
    this.r.lens = { time, hurt: this.hurt, visor: this.visor ?? 0, flash: this.flash, aberration: 0.0012 + this.aberration * 0.01 };
    this.r.render(this.scene, this.camera, dt);
    this.camera.position.sub(this.shakeOffset);
  }
}
