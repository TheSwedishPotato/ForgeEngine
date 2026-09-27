import {
  Group, Mesh, MeshStandardMaterial, SphereGeometry, CapsuleGeometry, BoxGeometry, Vector3, Quaternion,
} from 'three';

const _q = new Quaternion();
const Y = new Vector3(0, 1, 0);

/** Draws every collision shape of a world as translucent primitives. */
export class DebugDraw {
  constructor(world, scene) {
    this.world = world;
    this.group = new Group();
    this.group.name = 'physics-debug';
    scene.add(this.group);
    this.items = [];
    const mats = [
      new MeshStandardMaterial({ color: 0xd9534f, roughness: 0.6, transparent: true, opacity: 0.85 }),
      new MeshStandardMaterial({ color: 0x3a7bd5, roughness: 0.6, transparent: true, opacity: 0.85 }),
    ];
    const glove = new MeshStandardMaterial({ color: 0xffcc33, roughness: 0.5 });
    const statics = new MeshStandardMaterial({ color: 0x888888, roughness: 0.8, transparent: true, opacity: 0.5 });
    for (const s of world.shapes) {
      let geo;
      if (s.type === 'sphere') geo = new SphereGeometry(s.radius, 20, 14);
      else if (s.type === 'capsule') geo = new CapsuleGeometry(s.radius, s.halfLength * 2, 8, 16);
      else if (s.type === 'box') geo = new BoxGeometry(s.halfExtents.x * 2, s.halfExtents.y * 2, s.halfExtents.z * 2);
      else continue;
      const u = s.userData;
      const mat = u.part === 'glove' ? glove : u.boxer !== undefined ? mats[u.boxer % 2] : statics;
      const mesh = new Mesh(geo, mat);
      mesh.castShadow = true;
      this.group.add(mesh);
      // Capsule geometry is built along +Y.
      const align = s.type === 'capsule' ? new Quaternion().setFromUnitVectors(Y, s.axis) : new Quaternion();
      this.items.push({ shape: s, mesh, align });
    }
  }

  set visible(v) {
    this.group.visible = v;
  }

  get visible() {
    return this.group.visible;
  }

  update(alpha = 1) {
    if (!this.group.visible) return;
    for (const it of this.items) {
      const b = it.shape.body;
      const pos = b.renderPos ?? b.pos, q = b.renderQ ?? b.q;
      it.mesh.position.copy(it.shape.offset).applyQuaternion(q).add(pos);
      it.mesh.quaternion.copy(q).multiply(it.align);
    }
    void alpha; void _q;
  }
}
