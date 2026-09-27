import {
  InstancedMesh, IcosahedronGeometry, MeshPhysicalMaterial, Object3D, Vector3, Color, Sprite, SpriteMaterial,
  CanvasTexture, AdditiveBlending, NormalBlending,
} from 'three';

const MAX = 420;
const _o = new Object3D();
const _c = new Color();

/**
 * Sweat spray and mist on impacts (the classic slow-motion boxing shot),
 * with a few blood droplets from cuts.
 */
export class Particles {
  constructor(scene) {
    const geo = new IcosahedronGeometry(1, 1);
    const mat = new MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.85,
      clearcoat: 1, clearcoatRoughness: 0.05,
    });
    this.mesh = new InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.p = [];
    for (let i = 0; i < MAX; i++) this.p.push({ pos: new Vector3(), vel: new Vector3(), life: 0, size: 0, color: new Color(), alive: false });
    this.next = 0;
    // mist puffs
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,0.8)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.25)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new CanvasTexture(cv);
    this.puffs = [];
    for (let i = 0; i < 10; i++) {
      const s = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0 }));
      s.visible = false;
      scene.add(s);
      this.puffs.push({ sprite: s, life: 0, vel: new Vector3() });
    }
    void NormalBlending;
  }

  /** Burst at a contact point. normal points away from the struck surface. */
  burst(point, normal, strength, { blood = false, zone = 'head' } = {}) {
    const n = Math.floor((zone === 'head' ? 28 : 16) * Math.min(2, strength) + (blood ? 6 : 0));
    for (let i = 0; i < n; i++) {
      const p = this.p[this.next];
      this.next = (this.next + 1) % MAX;
      p.alive = true;
      p.life = 0.5 + Math.random() * 0.7;
      p.pos.copy(point).addScaledVector(normal, 0.02);
      // spray mostly along the punch direction, cone-shaped
      const spread = 0.9;
      p.vel.set((Math.random() - 0.5) * spread, (Math.random() - 0.3) * spread, (Math.random() - 0.5) * spread)
        .addScaledVector(normal, -1.2)
        .normalize()
        .multiplyScalar((1.2 + Math.random() * 3.2) * Math.min(1.6, 0.5 + strength));
      p.vel.y += 0.6;
      const isBlood = blood && i < 6;
      p.size = isBlood ? 0.0035 + Math.random() * 0.003 : 0.0018 + Math.random() * 0.0035;
      p.color.set(isBlood ? 0x6d0508 : 0xe8f2ff);
    }
    const puff = this.puffs.find((x) => x.life <= 0);
    if (puff) {
      puff.life = 1;
      puff.sprite.visible = true;
      puff.sprite.position.copy(point);
      puff.vel.copy(normal).multiplyScalar(-0.4);
      puff.sprite.material.opacity = 0.35 * Math.min(1, strength);
      puff.sprite.scale.setScalar(0.05);
    }
  }

  update(dt) {
    let count = 0;
    for (const p of this.p) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0 || p.pos.y < 0.005) {
        p.alive = false;
        continue;
      }
      p.vel.y -= 9.81 * dt;
      p.vel.multiplyScalar(1 - 0.6 * dt);
      p.pos.addScaledVector(p.vel, dt);
      _o.position.copy(p.pos);
      const stretch = 1 + Math.min(4, p.vel.length() * 0.35);
      _o.scale.set(p.size, p.size * stretch, p.size);
      _o.lookAt(p.pos.x + p.vel.x, p.pos.y + p.vel.y, p.pos.z + p.vel.z);
      _o.rotateX(Math.PI / 2);
      _o.updateMatrix();
      this.mesh.setMatrixAt(count, _o.matrix);
      _c.copy(p.color);
      this.mesh.setColorAt(count, _c);
      count++;
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    for (const f of this.puffs) {
      if (f.life <= 0) continue;
      f.life -= dt * 2.2;
      f.sprite.position.addScaledVector(f.vel, dt);
      f.sprite.scale.setScalar(0.05 + (1 - f.life) * 0.35);
      f.sprite.material.opacity = Math.max(0, f.life) * 0.3;
      if (f.life <= 0) f.sprite.visible = false;
    }
  }
}
