import { Vector3, Quaternion } from 'three';
import { GPUCloth } from '../engine/passes/GPUCloth.js';

const _a = new Vector3(), _b = new Vector3(), _back = new Vector3(), _q = new Quaternion();

/** Who wears a cloak in Skalice, and its wool and trim. */
export const CAPES = {
  burgrave: { color: '#6e0f16', trim: '#d8c060', length: 1.25 },
  captain: { color: '#34432a', trim: '#c8a040', length: 1.05 },
  merchant: { color: '#1c3a6a', trim: '#8a6a3a', length: 1.15 },
  priest: { color: '#161616', trim: '#3a3a3a', length: 1.3 },
  squire: { color: '#9a141a', trim: '#e8e2d4', length: 1.0 },
};

/**
 * A cloak on a Walker (or any posed ragdoll): a GPU-simulated cape pinned
 * along the shoulders, kept out of the wearer's body. Call update() each
 * frame after the walker is posed.
 */
export class Cape {
  constructor(renderer, scene, walker, style) {
    this.walker = walker;
    this.cloth = new GPUCloth(renderer, { ...style, width: 0.6 * walker.scale, length: (style.length ?? 1.1) * walker.scale });
    scene.add(this.cloth);
    this.caps = [];
  }

  update(groundY = 0) {
    const w = this.walker, R = w.ragdoll, chest = w.b.chest;
    this.cloth.visible = w.mesh.visible;
    if (!this.cloth.visible) return;
    // the shoulders, a little in toward the neck and up onto the trapezius
    chest.localToWorld(R.joints.shoulderL.anchorParent, _a);
    chest.localToWorld(R.joints.shoulderR.anchorParent, _b);
    const mid = _a.clone().add(_b).multiplyScalar(0.5);
    _a.lerp(mid, 0.12); _b.lerp(mid, 0.12);
    _a.y += 0.04 * w.scale; _b.y += 0.04 * w.scale;
    // the back: the chest's -z
    _q.copy(chest.q);
    _back.set(0, 0, -1).applyQuaternion(_q);
    _a.addScaledVector(_back, 0.07 * w.scale); _b.addScaledVector(_back, 0.07 * w.scale);
    // the body it must not pass through
    let n = 0;
    for (const name of ['chest', 'abdomen', 'pelvis', 'thighL', 'thighR', 'upperArmL', 'upperArmR', 'shinL', 'shinR']) {
      const b = w.b[name];
      for (const sh of b.shapes) {
        if (sh.type !== 'capsule' && sh.type !== 'sphere') continue;
        sh.updateWorld();
        const c = (this.caps[n++] ??= { a: new Vector3(), b: new Vector3(), r: 0 });
        if (sh.type === 'sphere') { c.a.copy(sh.wCenter); c.b.copy(sh.wCenter); } else { c.a.copy(sh.wA); c.b.copy(sh.wB); }
        c.r = sh.radius + 0.02;
      }
    }
    this.caps.length = Math.min(n, 16);
    // the left and right ends: from the wearer's point of view, left is +x of the chest
    this.cloth.setBody({ left: _a, right: _b, back: _back, capsules: this.caps, ground: groundY });
  }

  dispose() { this.cloth.dispose(); }
}
