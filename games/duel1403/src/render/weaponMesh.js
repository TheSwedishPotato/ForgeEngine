import {
  BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Vector2,
  CylinderGeometry, SphereGeometry, BoxGeometry, ConeGeometry, LatheGeometry, ExtrudeGeometry, Shape, TorusGeometry,
  DoubleSide,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { steelNormal, leatherNormal, woodTexture } from './textures.js';

/**
 * Weapon meshes built from the same part list as the physics body, in the
 * weapon's hilt frame (+Y to the point, +X the true edge), then shifted so
 * the mesh origin is the body's centre of mass.
 */

function bladeGeometry(p, segs = 40) {
  // Cross-section: lenticular / flattened diamond, single-edged with a
  // thick back, or triangular (rondel dagger). Tapers in width and
  // thickness, with an acute point over the last part of the blade.
  const L = p.y1 - p.y0;
  const ring = p.triangular ? 3 : p.edges === 1 ? 6 : 8;
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = p.y0 + L * t;
    let w = p.w0 + (p.w1 - p.w0) * t;
    if (p.leaf) w = p.w0 * Math.sin(Math.min(1, t * 1.25) * Math.PI) * 1.1 + 0.004;
    const pointStart = p.leaf ? 1 : p.clip ? 1 - p.clip / L : 0.86;
    if (t > pointStart) w *= 1 - ((t - pointStart) / (1 - pointStart)) ** 1.6;
    if (i === segs) w = 0.0005;
    const th = (p.t0 + (p.t1 - p.t0) * t) * (i === segs ? 0.1 : 1);
    const curve = p.curve ? -p.curve * t * t : 0;
    for (let k = 0; k < ring; k++) {
      let x, z;
      if (p.triangular) {
        const a = (k / 3) * Math.PI * 2;
        x = Math.cos(a) * w * 0.6; z = Math.sin(a) * w * 0.6;
      } else if (p.edges === 1) {
        // edge at +X, flat thick back at -X (clipped point: back sharpened near the tip)
        const backT = t > pointStart && p.clip ? 0.25 : 1;
        const pts = [[w / 2, 0], [w / 6, th / 2], [-w / 2, th / 2 * backT], [-w / 2 - 0.0005, 0], [-w / 2, -th / 2 * backT], [w / 6, -th / 2]];
        [x, z] = pts[k];
      } else {
        const a = (k / ring) * Math.PI * 2;
        x = Math.cos(a) * w / 2;
        z = Math.sin(a) * th / 2 * (1 - 0.35 * Math.abs(Math.cos(a)));
      }
      pos.push(x + curve, y, z);
    }
  }
  for (let i = 0; i < segs; i++) for (let k = 0; k < ring; k++) {
    const a = i * ring + k, b = i * ring + ((k + 1) % ring), c = a + ring, d = b + ring;
    idx.push(a, c, b, b, c, d);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  const uv = new Float32Array((ng.attributes.position.count) * 2);
  ng.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return ng;
}

function prep(g) {
  const n = g.index ? g.toNonIndexed() : g;
  if (!n.attributes.uv) n.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}

export function weaponMaterials(look = {}) {
  const steel = new MeshPhysicalMaterial({ color: look.steel ?? '#c9ccd0', metalness: 1, roughness: 0.22, normalMap: steelNormal(), normalScale: new Vector2(0.08, 0.08), clearcoat: 0.4, clearcoatRoughness: 0.2 });
  const fitting = new MeshPhysicalMaterial({ color: look.guard ?? '#9aa0a8', metalness: 1, roughness: 0.32 });
  const grip = new MeshStandardMaterial({ color: look.grip ?? '#3a2618', roughness: 0.7, normalMap: leatherNormal(), normalScale: new Vector2(0.5, 0.5) });
  const haftMap = woodTexture(look.haft ?? '#5b3d24');
  const wood = new MeshStandardMaterial({ map: haftMap, color: '#ffffff', roughness: 0.65 });
  return { steel, fitting, grip, wood };
}

export class WeaponMesh {
  constructor(weapon, { quality = 'high' } = {}) {
    this.weapon = weapon;
    const def = weapon.def;
    const M = weaponMaterials(def.look);
    this.group = new Group();
    const steel = [], fit = [], grip = [], wood = [];
    const segs = quality === 'low' ? 24 : 40;
    for (const p of def.parts) {
      switch (p.kind) {
        case 'blade': steel.push(bladeGeometry(p, segs)); break;
        case 'cross': {
          const g = new CylinderGeometry(0.008, 0.008, p.half * 2, 10);
          g.rotateZ(Math.PI / 2);
          g.translate(0, p.y, 0);
          fit.push(g);
          for (const sx of [1, -1]) {
            const knob = new SphereGeometry(0.011, 10, 8);
            knob.translate(sx * p.half, p.y + 0.004, 0);
            fit.push(knob);
          }
          if (p.nagel) {
            const n = new ConeGeometry(0.006, 0.05, 8);
            n.rotateX(Math.PI / 2);
            n.translate(0, p.y, 0.028);
            fit.push(n);
          }
          break;
        }
        case 'grip': {
          const L = p.y1 - p.y0;
          const g = p.slab ? new BoxGeometry(0.03, L, 0.022) : new CylinderGeometry(p.r, p.r * 1.05, L, 14);
          g.translate(0, (p.y0 + p.y1) / 2, 0);
          grip.push(g);
          break;
        }
        case 'pommel': {
          if (p.shape === 'wheel') {
            const g = new CylinderGeometry(p.r, p.r, p.r * 0.8, 20);
            g.rotateX(Math.PI / 2);
            g.translate(0, p.y, 0);
            fit.push(g);
            const boss = new CylinderGeometry(p.r * 0.45, p.r * 0.45, p.r * 1.1, 12);
            boss.rotateX(Math.PI / 2);
            boss.translate(0, p.y, 0);
            fit.push(boss);
          } else {
            const g = new SphereGeometry(p.r, 14, 10);
            g.scale(1, 0.8, 0.8);
            g.translate(0, p.y, 0);
            fit.push(g);
          }
          break;
        }
        case 'rondel': {
          const g = new CylinderGeometry(p.r, p.r, 0.008, 22);
          g.translate(0, p.y, 0);
          fit.push(g);
          break;
        }
        case 'haft': {
          const L = p.y1 - p.y0;
          const g = new CylinderGeometry(p.r, p.r * 1.05, L, 12);
          g.translate(0, (p.y0 + p.y1) / 2, 0);
          wood.push(g);
          break;
        }
        case 'head': this._head(p, steel, fit); break;
        default: break;
      }
    }
    // Langets down the haft of polearms and hammers.
    if (def.parts.some((p) => p.kind === 'haft') && (def.parts.some((p) => p.sub === 'axe' || p.sub === 'hammer'))) {
      for (const sx of [1, -1]) {
        const l = new BoxGeometry(0.004, 0.32, 0.012);
        l.translate(sx * 0.018, -0.17, 0);
        fit.push(l);
      }
    }
    const add = (list, mat) => {
      if (!list.length) return;
      const m = new Mesh(mergeGeometries(list.map(prep)), mat);
      m.castShadow = true;
      this.group.add(m);
    };
    add(steel, M.steel);
    add(fit, M.fitting);
    add(grip, M.grip);
    add(wood, M.wood);
    // Origin at the body's centre of mass.
    for (const c of this.group.children) c.geometry.translate(-weapon.com.x, -weapon.com.y, -weapon.com.z);

    if (weapon.offhand?.kind === 'buckler') {
      const R = weapon.offhand.def.radius;
      const prof = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        prof.push(new Vector2(R * t, -0.04 - 0.035 * Math.cos(t * Math.PI / 2) + 0.035));
      }
      // Dish bulging away from the fist (local -Y), boss in the middle.
      const dish = new LatheGeometry(prof, 32);
      const boss = new SphereGeometry(0.05, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      boss.rotateX(Math.PI);
      boss.translate(0, -0.04, 0);
      const rim = new TorusGeometry(R, 0.006, 8, 40);
      rim.rotateX(Math.PI / 2);
      rim.translate(0, -0.005, 0);
      const bm = new Mesh(mergeGeometries([prep(dish), prep(boss), prep(rim)]), M.steel.clone());
      bm.material.side = DoubleSide;
      bm.castShadow = true;
      this.buckler = bm;
    }
  }

  _head(p, steel, fit) {
    const ym = (p.y0 + p.y1) / 2, L = p.y1 - p.y0;
    switch (p.sub) {
      case 'spike': {
        const g = new ConeGeometry(p.r * 1.3, L, 4);
        g.translate(0, ym, 0);
        steel.push(g);
        break;
      }
      case 'butt': {
        const g = new ConeGeometry(p.r * 1.3, L, 4);
        g.rotateX(Math.PI);
        g.translate(0, ym, 0);
        fit.push(g);
        break;
      }
      case 'axe': {
        const s = new Shape();
        s.moveTo(0.0, -0.035);
        s.quadraticCurveTo(0.06, -0.05, p.x + 0.015, p.y0 - 0.02);
        s.quadraticCurveTo(p.x + 0.035, ym, p.x + 0.015, p.y1 + 0.02);
        s.quadraticCurveTo(0.06, p.y1, 0.0, 0.035);
        s.lineTo(0, -0.035);
        const g = new ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
        g.translate(0, 0, -0.004);
        steel.push(g);
        break;
      }
      case 'hammer': {
        const g = new BoxGeometry(Math.abs(p.x), 0.04, 0.04);
        g.translate(p.x / 2, ym, 0);
        fit.push(g);
        const face = new BoxGeometry(0.012, 0.05, 0.05);
        face.translate(p.x, ym, 0);
        fit.push(face);
        break;
      }
      case 'beak': {
        const g = new ConeGeometry(0.012, Math.abs(p.x) * 1.1, 6);
        g.rotateZ(-Math.sign(p.x) * Math.PI / 2 - 0.25 * Math.sign(p.x));
        g.translate(p.x * 0.55, ym - 0.012, 0);
        steel.push(g);
        break;
      }
      case 'flanges': {
        for (let i = 0; i < 6; i++) {
          const s = new Shape();
          s.moveTo(0, 0);
          s.lineTo(p.r, L * 0.2);
          s.quadraticCurveTo(p.r * 1.1, L * 0.6, p.r * 0.7, L);
          s.lineTo(0, L);
          s.lineTo(0, 0);
          const g = new ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: false });
          g.translate(0, p.y0, -0.0025);
          g.rotateY((i * Math.PI) / 3);
          fit.push(g);
        }
        const knob = new SphereGeometry(0.018, 12, 8);
        knob.translate(0, p.y1, 0);
        fit.push(knob);
        break;
      }
      default: break;
    }
  }

  update() {
    const b = this.weapon.body;
    this.group.position.copy(b.renderPos ?? b.pos);
    this.group.quaternion.copy(b.renderQ ?? b.q);
    const o = this.weapon.offhand;
    if (o && this.buckler) {
      this.buckler.position.copy(o.body.renderPos ?? o.body.pos);
      this.buckler.quaternion.copy(o.body.renderQ ?? o.body.q);
    }
  }
}
