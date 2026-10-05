import { Object3D, Color, MeshStandardMaterial } from 'three';
import { LODInstancer, buildLODChain } from '../engine/geometry/LOD.js';
import { onlookerParts } from './Foliage.js';

const SKINS = ['#e0b896', '#d2a07c', '#c48e6a', '#e8c4a4', '#b98462'];
const _o = new Object3D(), _c = new Color();

/**
 * Everyone in town as instanced figures with LOD chains: belted tunic or
 * gown, head, hood or hat, in the colours of their estate and trade. They
 * walk (bob and sway with the stride), stand, sit and lie. Inside a building
 * only the people in that room are drawn, at their places in it.
 */
export class PeopleMesh {
  constructor(scene, sim) {
    this.sim = sim;
    const parts = onlookerParts();
    const n = sim.people.length;
    const mk = (geo, name) => {
      const chain = buildLODChain(geo, [1, 0.4, 0.12]);
      const mat = new MeshStandardMaterial({ roughness: name === 'head' ? 0.6 : 0.92, vertexColors: true });
      if (name !== 'head') mat.userData.cloth = true;
      const l = new LODInstancer(chain.map((c, i) => ({ geometry: c.geometry, distance: [16, 45, Infinity][i] })), mat, n, { name: 'people-' + name, shadowDistance: 60 });
      scene.add(l.group);
      return l;
    };
    this.parts = { body: mk(parts.body, 'body'), head: mk(parts.head, 'head'), hood: mk(parts.hood, 'hood'), hat: mk(parts.hat, 'hat') };
    this.skin = sim.people.map((p, i) => new Color(SKINS[(i * 7) % SKINS.length]));
    this.cloth = sim.people.map((p) => new Color(p.colors.cloth));
    this.wear = sim.people.map((p) => new Color(p.colors.hose).multiplyScalar(1.2));
    this.time = 0;
  }

  /** interior: {building, spotOf(person) -> {x,y,z,yaw,posture}} when the player is inside. */
  update(dt, camera, interior = null) {
    this.time += dt;
    const P = this.parts;
    const zero = new Object3D(); zero.scale.setScalar(0); zero.updateMatrix();
    let k = 0;
    const counts = { body: 0, head: 0, hood: 0, hat: 0 };
    for (const [i, p] of this.sim.people.entries()) {
      const a = p.agent;
      let x, y, z, yaw, posture = 'stand';
      if (interior) {
        if (a.inside !== interior.b.id || a.route.length) continue;
        const s = interior.spotOf(p);
        ({ x, y, z, yaw } = s); posture = s.posture;
      } else {
        if (a.inside || p.hiddenForWalker) continue;
        x = a.x; y = a.y; z = a.z; yaw = a.yaw;
        if (/sleeping in the porch/.test(a.act) || !p.alive) posture = 'lie';
        else if (a.speed < 0.05 && /begging|resting/.test(a.act)) posture = 'sit';
      }
      const walking = a.speed > 0.05 && !interior;
      const ph = this.time * 7.2 + i;
      _o.position.set(x, y + (walking ? Math.abs(Math.sin(ph)) * 0.045 : 0) - (posture === 'sit' ? 0.42 : 0), z);
      _o.rotation.set(0, yaw ?? 0, 0);
      if (walking) { _o.rotateZ(Math.sin(ph) * 0.035); _o.rotateX(0.05); }
      if (posture === 'lie') { _o.rotateX(-Math.PI / 2); _o.position.y += 0.12; }
      _o.scale.set(1, (p.height ?? 1.7) / 1.7, 1);
      _o.updateMatrix();
      const hatKind = p.hat === 1 ? 'hat' : p.items.head === 'hood' || p.dress === 'woman' || p.dress === 'womanPoor' ? 'hood' : null;
      P.body.setInstance(counts.body++, _o.matrix, this.cloth[i]);
      P.head.setInstance(counts.head++, _o.matrix, this.skin[i]);
      if (hatKind === 'hood') P.hood.setInstance(counts.hood++, _o.matrix, this.wear[i]);
      else if (hatKind === 'hat') P.hat.setInstance(counts.hat++, _o.matrix, _c.copy(this.wear[i]).multiplyScalar(0.7));
      k++;
    }
    for (const [name, l] of Object.entries(P)) {
      for (let j = counts[name]; j < l.count; j++) l.setInstance(j, zero.matrix);
      l._built = false;
      l.update(camera.position);
    }
  }
}
