import {
  Group, Mesh, LatheGeometry, Vector2, Vector3, Quaternion, MeshStandardMaterial, MeshPhysicalMaterial, ConeGeometry,
  CylinderGeometry, CanvasTexture, RepeatWrapping, SRGBColorSpace, PlaneGeometry, DoubleSide,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BodyMesh, SKIN_TONES } from './bodyMesh.js';
import { ArmourMesh } from './armourMesh.js';
import { heraldryTexture } from './textures.js';
import { HERALDRY } from '../data/opponents.js';

const _v = new Vector3(), _q = new Quaternion();
const Y = new Vector3(0, 1, 0);

/** Lances were painted: a spiral in the rider's colours. */
function stripeTexture(a, b) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = a;
  g.fillRect(0, 0, 64, 512);
  g.fillStyle = b;
  for (let i = -2; i < 16; i++) {
    g.beginPath();
    g.moveTo(0, i * 40); g.lineTo(64, i * 40 + 30); g.lineTo(64, i * 40 + 50); g.lineTo(0, i * 40 + 20);
    g.fill();
  }
  // wear and grain
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,240,210'},${Math.random() * 0.06})`; g.fillRect(Math.random() * 64, Math.random() * 512, 1, 4 + Math.random() * 12); }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Radius of the lance at distance u from the butt (m). */
function lanceRadius(u, L) {
  const grip = L.grip, len = L.length, k = L.diameter / 0.055;
  if (u < 0.05) return 0.026 * k;
  if (u < grip - 0.18) return (0.034 + 0.006 * Math.sin((u / (grip - 0.18)) * Math.PI)) * k;
  if (u < grip + 0.08) return 0.03 * k;                  // the grip, pared down for the hand
  if (u < grip + 0.3) return (0.03 + 0.012 * ((u - grip - 0.08) / 0.22)) * k;   // swells behind the vamplate
  return (0.042 - 0.02 * ((u - grip - 0.3) / (len - grip - 0.3))) * k;          // tapers to the head
}

function lanceGeometry(L, u0, u1, jagged = null) {
  const pts = [];
  const n = 40;
  pts.push(new Vector2(0.0005, u0));
  for (let i = 0; i <= n; i++) {
    const u = u0 + (u1 - u0) * (i / n);
    pts.push(new Vector2(lanceRadius(u, L), u));
  }
  pts.push(new Vector2(0.0005, u1));
  const g = new LatheGeometry(pts, 14);
  g.translate(0, -L.com, 0);
  const parts = [g];
  if (jagged !== null) {
    // splintered end: long slivers
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, r = lanceRadius(jagged, L) * 0.7;
      const len = 0.05 + Math.random() * 0.14;
      const s = new ConeGeometry(0.008 + Math.random() * 0.008, len, 4);
      s.translate(0, (jagged > u0 + 0.01 ? 1 : -1) * len / 2, 0);
      s.translate(Math.cos(a) * r, jagged - L.com, Math.sin(a) * r);
      parts.push(s);
    }
  }
  return mergeGeometries(parts.map((p) => p.index ? p.toNonIndexed() : p));
}

/** The lance: painted shaft, steel vamplate over the hand, the coronel at the head. */
export class LanceMesh {
  constructor(lance, colors) {
    this.lance = lance;
    const L = lance.def;
    this.L = L;
    this.group = new Group();
    this.root = new Group();
    this.group.add(this.root);
    const tex = stripeTexture(colors.cloth ?? '#7a1c1c', colors.accent ?? '#e8e2d4');
    tex.repeat.set(1, 6);
    this.wood = new MeshStandardMaterial({ map: tex, roughness: 0.55 });
    this.steel = new MeshPhysicalMaterial({ color: '#c9ccd1', metalness: 1, roughness: 0.3, clearcoat: 0.3 });
    const cut = L.length * (1 - L.breakAt);
    this.cut = cut;
    this.rear = new Mesh(lanceGeometry(L, 0, cut), this.wood);
    this.front = new Group();
    this.frontShaft = new Mesh(lanceGeometry(L, cut, L.length), this.wood);
    this.front.add(this.frontShaft);
    // vamplate: a steel funnel guarding the hand
    const vy = L.grip + 0.1 - L.com;
    const vp = new LatheGeometry([new Vector2(0.04, 0.0), new Vector2(0.1, -0.1), new Vector2(0.135, -0.2), new Vector2(0.13, -0.21), new Vector2(0.09, -0.1), new Vector2(0.036, 0.02)].map((p) => new Vector2(p.x, p.y + vy + 0.2)), 24);
    this.vamplate = new Mesh(vp, this.steel);
    // coronel: a ring with three blunt points
    const hy = L.length - L.com;
    const cor = [new CylinderGeometry(0.024, 0.026, 0.05, 12).translate(0, hy - 0.025, 0)];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      cor.push(new ConeGeometry(0.014, 0.05, 6).translate(Math.cos(a) * 0.026, hy + 0.02, Math.sin(a) * 0.026));
    }
    this.front.add(new Mesh(mergeGeometries(cor.map((p) => p.toNonIndexed())), this.steel));
    this.root.add(this.rear, this.front, this.vamplate);
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.broken = false;
  }

  update() {
    const l = this.lance;
    this.root.position.copy(l.body.pos);
    this.root.quaternion.copy(l.body.q);
    if (l.broken && !this.broken) {
      this.broken = true;
      // a ragged stump in the hand, a ragged piece in the air
      this.rear.geometry.dispose();
      this.rear.geometry = lanceGeometry(this.L, 0, this.cut, this.cut);
      this.frontShaft.geometry.dispose();
      this.frontShaft.geometry = lanceGeometry(this.L, this.cut, this.L.length, this.cut);
      this.root.remove(this.front);
      this.piece = new Group();
      this.piece.add(this.front);
      // the piece body's origin is the middle of the fore-lance
      this.front.position.set(0, -(this.cut + (this.L.length - this.cut) / 2 - this.L.com), 0);
      this.group.add(this.piece);
    }
    if (this.piece && l.piece) {
      this.piece.position.copy(l.piece.body.pos);
      this.piece.quaternion.copy(l.piece.body.q);
    }
  }

  dispose() { disposeTree(this.group); }
}

/**
 * The ecranche: a small shield of wood under leather and gesso, painted
 * with the arms, hung on the left breast.
 */
export class EcrancheMesh {
  constructor(rider) {
    this.rider = rider;
    const her = HERALDRY[rider.heraldry] ?? HERALDRY.none;
    const tex = heraldryTexture(her, rider.colors.cloth ?? '#7a1c1c').clone();
    tex.needsUpdate = true;
    tex.offset.set(0.25, 0); tex.repeat.set(0.5, 1);
    const g = new PlaneGeometry(0.3, 0.38, 12, 12);
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i);
      // curved across, a heater's pointed foot
      const w = y < -0.05 ? 1 - ((-0.05 - y) / 0.14) * 0.55 : 1;
      P.setXYZ(i, x * w, y, -2.2 * x * x - 0.3 * y * y);
    }
    g.computeVertexNormals();
    const mat = new MeshPhysicalMaterial({ map: tex, roughness: 0.6, side: DoubleSide, clearcoat: 0.3, clearcoatRoughness: 0.5 });
    this.mesh = new Mesh(g, mat);
    this.mesh.castShadow = true;
    const back = new Mesh(g.clone().translate(0, 0, -0.012), new MeshStandardMaterial({ color: '#4a3020', roughness: 0.8, side: DoubleSide }));
    this.mesh.add(back);
    this.group = new Group();
    this.group.add(this.mesh);
    const s = rider.scale;
    this.offset = new Vector3(0.14 * s, 0.02 * s, 0.215 * s);
    // facing forward and out to the left, top tilted back
    this.localQ = new Quaternion().setFromAxisAngle(Y, 0.55).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.15));
  }

  update() {
    const c = this.rider.b.chest;
    c.localToWorld(this.offset, this.group.position);
    this.group.quaternion.copy(c.q).multiply(this.localQ);
  }

  dispose() { disposeTree(this.group); }
}

/** A mounted jouster's body and harness, shield, and (when it is struck off) his flying helm. */
export class RiderMesh {
  constructor(rider, { quality = 'high' } = {}) {
    this.rider = rider;
    const c = rider.colors;
    this.body = new BodyMesh(rider, { skin: c.skin ?? SKIN_TONES.light, hair: c.hair ?? '#3a2818', cloth: c.cloth ?? '#6a5a40', hose: c.hose ?? '#4a3a2a', shoe: '#3b2a1c', quality, inflateTorso: 0.022, inflateArm: 0.018 });
    this.armour = new ArmourMesh(this.body, rider, { quality });
    this.ecranche = new EcrancheMesh(rider);
    this.group = new Group();
    this.group.add(this.body.group, this.ecranche.group);
    const headBone = this.armour.bone('head');
    this.helmParts = this.armour.meshes.filter((m) => m.parent === headBone);
    this.helm = null;
  }

  /** The great helm is torn off: it flies, tumbles and lands. */
  unhelm(impulseDir) {
    if (this.helm || !this.helmParts.length) return;
    const head = this.rider.b.head;
    const g = new Group();
    g.position.copy(head.pos);
    g.quaternion.copy(head.q);
    for (const m of this.helmParts) { m.removeFromParent(); g.add(m); }
    this.group.add(g);
    this.helm = { g, vel: head.vel.clone().addScaledVector(impulseDir ?? Y, 3).add(new Vector3(0, 2.5, 0)), spin: new Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 14), rest: false };
  }

  update(dt) {
    this.body.update();
    this.armour.update(dt);
    this.ecranche.update();
    const h = this.helm;
    if (h && !h.rest) {
      h.vel.y -= 9.81 * dt;
      h.g.position.addScaledVector(h.vel, dt);
      _q.setFromAxisAngle(_v.copy(h.spin).normalize(), h.spin.length() * dt);
      h.g.quaternion.premultiply(_q);
      if (h.g.position.y < 0.15) {
        h.g.position.y = 0.15;
        h.vel.y = -h.vel.y * 0.3; h.vel.x *= 0.5; h.vel.z *= 0.5; h.spin.multiplyScalar(0.5);
        if (Math.abs(h.vel.y) < 0.4) h.rest = true;
      }
    }
  }

  dispose() { disposeTree(this.group); }
}

function disposeTree(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) m.dispose();
  });
  g.removeFromParent();
}
