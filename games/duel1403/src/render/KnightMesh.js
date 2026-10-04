import { Group } from 'three';
import { BodyMesh, SKIN_TONES } from './bodyMesh.js';
import { ArmourMesh } from './armourMesh.js';
import { WeaponMesh } from './weaponMesh.js';

/** Everything you see of one fighter: body, armour, weapon (and buckler). */
export class KnightMesh {
  constructor(knight, { quality = 'high' } = {}) {
    this.knight = knight;
    const c = knight.colors;
    const it = knight.profile.items;
    const inflate = { shirt: 0.006, armingDoublet: 0.011, gambeson: 0.022 }[it.under] ?? 0.006;
    this.body = new BodyMesh(knight, {
      skin: c.skin ?? SKIN_TONES.light, hair: c.hair ?? '#3a2818', cloth: c.cloth ?? '#6a5a40', hose: c.hose ?? '#4a3a2a',
      shoe: '#3b2a1c', quality, inflateTorso: inflate, inflateArm: it.under === 'gambeson' ? 0.018 : 0.008,
    });
    this.armour = new ArmourMesh(this.body, knight, { quality });
    this.weapon = new WeaponMesh(knight.weapon, { quality });
    this.group = new Group();
    this.group.add(this.body.group, this.weapon.group);
    if (this.weapon.buckler) this.group.add(this.weapon.buckler);
  }

  update(dt) {
    this.body.update();
    this.armour.update(dt);
    this.weapon.update();
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) m.dispose();
    });
    this.group.removeFromParent();
  }
}
