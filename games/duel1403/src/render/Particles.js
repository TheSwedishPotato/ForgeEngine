import {
  InstancedMesh, IcosahedronGeometry, MeshBasicMaterial, MeshStandardMaterial, Object3D, Vector3, Color,
  Sprite, SpriteMaterial, CanvasTexture, AdditiveBlending,
} from 'three';

const MAX = 500;
const _o = new Object3D();
const _c = new Color();

/** Sparks where steel meets steel, blood from wounds, dust from feet and falls. */
export class Particles {
  constructor(scene) {
    const geo = new IcosahedronGeometry(1, 0);
    this.sparks = new InstancedMesh(geo, new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), MAX);
    this.drops = new InstancedMesh(geo, new MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }), MAX);
    for (const m of [this.sparks, this.drops]) { m.frustumCulled = false; m.count = 0; scene.add(m); }
    this.p = [];
    for (let i = 0; i < MAX * 2; i++) this.p.push({ pos: new Vector3(), vel: new Vector3(), life: 0, max: 1, size: 0, color: new Color(), kind: 'spark', alive: false });
    this.next = 0;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,0.7)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new CanvasTexture(cv);
    this.puffs = [];
    for (let i = 0; i < 16; i++) {
      const s = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, color: 0xb8a888 }));
      s.visible = false;
      scene.add(s);
      this.puffs.push({ sprite: s, life: 0, vel: new Vector3(), add: false });
    }
    this.flash = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0, color: 0xffd9a0 }));
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashLife = 0;
  }

  _spawn(kind) {
    const p = this.p[this.next];
    this.next = (this.next + 1) % this.p.length;
    p.alive = true;
    p.kind = kind;
    return p;
  }

  sparksAt(point, strength = 1) {
    const n = Math.floor(10 + 30 * Math.min(1.5, strength));
    for (let i = 0; i < n; i++) {
      const p = this._spawn('spark');
      p.life = p.max = 0.15 + Math.random() * 0.35;
      p.pos.copy(point);
      p.vel.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 6 * Math.min(1.5, strength));
      p.size = 0.003 + Math.random() * 0.004;
      p.color.setHSL(0.09 + Math.random() * 0.05, 1, 0.6 + Math.random() * 0.3).multiplyScalar(3);
    }
    this.flash.visible = true;
    this.flash.position.copy(point);
    this.flash.scale.setScalar(0.25 + 0.3 * Math.min(1, strength));
    this.flashLife = 1;
  }

  blood(point, dir, amount = 1) {
    const n = Math.floor(6 + 22 * Math.min(1.5, amount));
    for (let i = 0; i < n; i++) {
      const p = this._spawn('drop');
      p.life = p.max = 0.5 + Math.random() * 0.8;
      p.pos.copy(point);
      p.vel.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).addScaledVector(dir, 1.2).normalize().multiplyScalar(0.8 + Math.random() * 2.5);
      p.size = 0.004 + Math.random() * 0.006;
      p.color.set(0x5a0507);
    }
  }

  /** Splinters of a breaking lance: long pale slivers thrown forward and up. */
  splinters(point, dir, amount = 1) {
    const n = Math.floor(30 + 50 * Math.min(1.5, amount));
    for (let i = 0; i < n; i++) {
      const p = this._spawn('drop');
      p.life = p.max = 1.2 + Math.random() * 1.6;
      p.pos.copy(point);
      p.vel.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 6).addScaledVector(dir, 2 + Math.random() * 4);
      p.size = 0.006 + Math.random() * 0.012;
      p.color.setHSL(0.09 + Math.random() * 0.03, 0.35, 0.55 + Math.random() * 0.25);
    }
    this.dust(point, 0.6);
  }

  dust(point, amount = 1) {
    for (let k = 0; k < 2; k++) {
      const f = this.puffs.find((x) => x.life <= 0);
      if (!f) return;
      f.life = 1;
      f.sprite.visible = true;
      f.sprite.position.copy(point).add(new Vector3((Math.random() - 0.5) * 0.3, 0.05, (Math.random() - 0.5) * 0.3));
      f.vel.set((Math.random() - 0.5) * 0.4, 0.25, (Math.random() - 0.5) * 0.4);
      f.amount = Math.min(1, amount);
    }
  }

  update(dt) {
    let ns = 0, nd = 0;
    for (const p of this.p) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0 || (p.pos.y < 0.004 && p.kind === 'spark')) { p.alive = false; continue; }
      if (p.pos.y < 0.004) { p.vel.set(0, 0, 0); p.pos.y = 0.003; }
      p.vel.y -= 9.81 * dt;
      p.pos.addScaledVector(p.vel, dt);
      _o.position.copy(p.pos);
      const stretch = 1 + Math.min(6, p.vel.length() * (p.kind === 'spark' ? 0.9 : 0.3));
      _o.scale.set(p.size, p.size * stretch, p.size);
      _o.lookAt(p.pos.x + p.vel.x, p.pos.y + p.vel.y, p.pos.z + p.vel.z);
      _o.rotateX(Math.PI / 2);
      _o.updateMatrix();
      if (p.kind === 'spark') {
        _c.copy(p.color).multiplyScalar(p.life / p.max);
        this.sparks.setMatrixAt(ns, _o.matrix);
        this.sparks.setColorAt(ns, _c);
        ns++;
      } else {
        this.drops.setMatrixAt(nd, _o.matrix);
        this.drops.setColorAt(nd, p.color);
        nd++;
      }
      if (ns >= MAX || nd >= MAX) break;
    }
    this.sparks.count = ns;
    this.drops.count = nd;
    for (const m of [this.sparks, this.drops]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    for (const f of this.puffs) {
      if (f.life <= 0) continue;
      f.life -= dt * 0.8;
      f.sprite.position.addScaledVector(f.vel, dt);
      f.sprite.scale.setScalar(0.2 + (1 - f.life) * 0.9);
      f.sprite.material.opacity = Math.max(0, f.life) * 0.35 * f.amount;
      if (f.life <= 0) f.sprite.visible = false;
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt * 9;
      this.flash.material.opacity = Math.max(0, this.flashLife);
      if (this.flashLife <= 0) this.flash.visible = false;
    }
  }
}
