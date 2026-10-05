import {
  Group, Mesh, BoxGeometry, CylinderGeometry, SphereGeometry, PlaneGeometry, MeshStandardMaterial, MeshBasicMaterial, PointLight, DoubleSide, Color,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const DEPTH = -60;   // rooms are built below the town, out of the sun

/**
 * The inside of a building, built when you walk in: walls of daub or stone,
 * a beaten-earth or plank floor, the furniture of the trade, and the fire
 * that lights it. Each room lists its places (where people stand, sit,
 * work and sleep) and its door.
 *
 * Interiors follow the archaeology of Bohemian town and village houses of
 * the period: one or two rooms (the living room with the hearth or a tiled
 * stove, the "jizba"), a loft above, benches along the walls; workshops
 * open to the street; the tavern a large jizba with tables and a tap.
 */
export class Interior {
  constructor(scene, building) {
    this.b = building;
    this.group = new Group();
    this.group.name = 'interior-' + building.id;
    const W = Math.max(5, building.w - 0.6), D = Math.max(4, building.d - 0.6), H = building.kind === 'church' ? 8 : building.kind === 'hall' ? 7 : 3.1;
    this.W = W; this.D = D; this.H = H;
    this.origin = { x: building.x, y: DEPTH, z: building.z };
    const stone = building.kind === 'church' || building.kind === 'hall';
    const wallMat = new MeshStandardMaterial({ color: stone ? '#c8bea8' : '#cbbf9e', roughness: 0.95, side: DoubleSide });
    const floorMat = new MeshStandardMaterial({ color: stone ? '#8a8272' : '#5a4632', roughness: 1 });
    const wood = new MeshStandardMaterial({ color: '#5e4128', roughness: 0.8 });
    const dark = new MeshStandardMaterial({ color: '#2a1e14', roughness: 0.9 });
    const iron = new MeshStandardMaterial({ color: '#3a3a3c', metalness: 0.8, roughness: 0.5 });
    const cloth = new MeshStandardMaterial({ color: building.kind === 'hall' ? '#7a1018' : '#8a7a5a', roughness: 0.95, side: DoubleSide });
    const add = (geo, mat, x, y, z, ry = 0) => { const m = new Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; this.group.add(m); return m; };
    // shell
    add(new BoxGeometry(W, 0.2, D), floorMat, 0, -0.1, 0);
    add(new BoxGeometry(W, 0.2, D), dark, 0, H + 0.1, 0);
    for (const s of [-1, 1]) {
      add(new BoxGeometry(0.2, H, D), wallMat, s * W / 2, H / 2, 0);
      add(new BoxGeometry(W, H, 0.2), wallMat, 0, H / 2, s * D / 2);
    }
    // ceiling beams
    if (!stone) for (let x = -W / 2 + 0.8; x < W / 2; x += 1.4) add(new BoxGeometry(0.18, 0.22, D), wood, x, H - 0.11, 0);
    // the door: on the wall facing the street door
    const dx = building.door.x - building.x, dz = building.door.z - building.z;
    const onX = Math.abs(dx) / building.w > Math.abs(dz) / building.d;
    this.doorLocal = onX ? { x: Math.sign(dx) * (W / 2 - 0.8), z: 0 } : { x: 0, z: Math.sign(dz) * (D / 2 - 0.8) };
    const doorFace = onX ? { x: Math.sign(dx) * (W / 2 - 0.09), z: 0 } : { x: 0, z: Math.sign(dz) * (D / 2 - 0.09) };
    add(new BoxGeometry(onX ? 0.04 : 1.1, 2.0, onX ? 1.1 : 0.04), new MeshBasicMaterial({ color: new Color(1.6, 1.45, 1.1) }), doorFace.x, 1.0, doorFace.z);   // daylight through the door
    this.spots = [];   // {x, z, yaw, posture}
    const spot = (x, z, yaw = 0, posture = 'stand') => this.spots.push({ x, z, yaw, posture });
    const lights = [];
    const fire = (x, z, y = 0.5, power = 9) => {
      const L = new PointLight(0xffa050, power, 9, 2);
      L.position.set(x, y + 0.4, z);
      lights.push(L);
      add(new SphereGeometry(0.22, 10, 8), new MeshBasicMaterial({ color: new Color(4, 1.6, 0.4) }), x, y, z);
    };
    const table = (x, z, w = 2.2, d = 0.8, ry = 0) => {
      const t = [new BoxGeometry(w, 0.08, d).translate(0, 0.76, 0)];
      for (const sx of [-1, 1]) t.push(new BoxGeometry(0.1, 0.72, d * 0.8).translate(sx * (w / 2 - 0.15), 0.36, 0));
      add(mergeGeometries(t), wood, x, 0, z, ry);
    };
    const bench = (x, z, w = 2.2, ry = 0) => add(new BoxGeometry(w, 0.08, 0.32).translate(0, 0.45, 0), wood, x, 0, z, ry);
    const kind = building.kind;
    if (kind === 'tavern') {
      for (const [x, z] of [[-W / 4, -D / 4], [-W / 4, D / 4], [W / 6, -D / 4]]) {
        table(x, z); bench(x, z - 0.65); bench(x, z + 0.65);
        spot(x - 0.6, z - 0.65, 0, 'sit'); spot(x + 0.6, z - 0.65, 0, 'sit'); spot(x - 0.6, z + 0.65, Math.PI, 'sit'); spot(x + 0.6, z + 0.65, Math.PI, 'sit');
      }
      // the tap: barrels and a counter
      add(new BoxGeometry(0.6, 1.0, 2.6), wood, W / 2 - 1.4, 0.5, D / 4);
      for (let i = 0; i < 3; i++) add(new CylinderGeometry(0.32, 0.32, 0.8, 12).rotateZ(Math.PI / 2), dark, W / 2 - 0.5, 0.35, D / 4 - 0.9 + i * 0.9);
      spot(W / 2 - 0.9, D / 4, -Math.PI / 2); spot(W / 2 - 0.9, D / 4 + 1, -Math.PI / 2); spot(0, 0, 0);
      add(new BoxGeometry(1.4, 1.1, 1.0), new MeshStandardMaterial({ color: '#6e4a32', roughness: 0.9 }), -W / 2 + 0.8, 0.55, -D / 2 + 0.7);   // tiled stove
      fire(-W / 2 + 0.8, -D / 2 + 1.3, 0.4, 10);
      fire(0, 0, H - 0.6, 3);   // a lamp
      this.sleep = { x: -W / 2 + 1, z: D / 2 - 1 };
    } else if (kind === 'smithy') {
      add(new BoxGeometry(1.6, 0.9, 1.2), new MeshStandardMaterial({ color: '#6a5a4a', roughness: 1 }), -W / 2 + 1.1, 0.45, 0);   // the forge hearth
      fire(-W / 2 + 1.1, 0, 1.0, 14);
      add(new BoxGeometry(0.5, 0.25, 0.25).translate(0, 0.72, 0), iron, 0.4, 0, 0.2);   // anvil
      add(new CylinderGeometry(0.22, 0.26, 0.6, 10).translate(0, 0.3, 0), wood, 0.4, 0, 0.2);
      add(new BoxGeometry(1.2, 0.6, 0.6), dark, -W / 2 + 1.1, 0.9, 1.0);   // bellows
      spot(0.4, -0.6, 0); spot(-W / 2 + 1.9, 0.6, -Math.PI / 2); spot(1.5, 1, Math.PI);
    } else if (kind === 'bakery') {
      add(new SphereGeometry(1.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new MeshStandardMaterial({ color: '#8a6a50', roughness: 1 }), -W / 2 + 1.4, 0.3, 0);   // the oven
      fire(-W / 2 + 1.4, 0.8, 0.5, 9);
      table(1, 0, 2, 0.9);
      for (let i = 0; i < 6; i++) add(new SphereGeometry(0.1, 8, 6).scale(1.3, 0.6, 1), new MeshStandardMaterial({ color: '#8a5a2a', roughness: 0.8 }), 0.4 + (i % 3) * 0.4, 0.86, -0.2 + Math.floor(i / 3) * 0.35);
      spot(1, 0.8, Math.PI); spot(-W / 2 + 2.6, 0, -Math.PI / 2);
    } else if (kind === 'butcher' || kind === 'workshop' || kind === 'rychta') {
      table(0, 0, 2.2, 1.0);
      bench(0, -0.7); bench(-W / 2 + 0.4, 0, 2.6, Math.PI / 2);
      if (kind === 'rychta') add(new BoxGeometry(0.4, 0.06, 0.3), new MeshStandardMaterial({ color: '#c8b890' }), 0, 0.82, 0);   // the town book
      add(new BoxGeometry(1.2, 0.6, 0.6), wood, W / 2 - 0.8, 0.3, -D / 2 + 0.6);   // chest
      fire(-W / 2 + 0.7, D / 2 - 0.8, 0.4, 7);
      spot(0, -0.7, 0, 'sit'); spot(0.8, 0.7, Math.PI); spot(-W / 2 + 0.4, 0.8, Math.PI / 2, 'sit');
    } else if (kind === 'church') {
      add(new BoxGeometry(2.2, 1.0, 1.0), new MeshStandardMaterial({ color: '#d8d0c0', roughness: 0.9 }), 0, 0.5, D / 2 - 1.6);   // altar
      add(new BoxGeometry(2.6, 2.4, 0.06), cloth, 0, 2.6, D / 2 - 0.2);
      for (const s of [-1, 1]) { const L = new PointLight(0xffd8a0, 4, 10, 2); L.position.set(s * 0.8, 1.4, D / 2 - 1.6); lights.push(L); add(new CylinderGeometry(0.03, 0.03, 0.4, 6), new MeshBasicMaterial({ color: new Color(3, 2.6, 1.6) }), s * 0.8, 1.2, D / 2 - 1.6); }
      fire(0, 0, H - 1.5, 4);
      for (let r = 0; r < 6; r++) for (let c = -2; c <= 2; c++) spot(c * 0.9, -D / 2 + 2 + r * 1.2, 0);
      spot(0, D / 2 - 2.4, Math.PI);
    } else if (kind === 'hall') {
      table(0, 0, W - 3, 1.1); bench(0, -0.8, W - 3); bench(0, 0.8, W - 3);
      add(new BoxGeometry(W - 2, 2.6, 0.04), cloth, 0, 2.4, D / 2 - 0.15);   // hanging
      fire(-W / 2 + 0.8, 0, 0.6, 14); fire(0, 0, H - 1.2, 5);
      for (let i = -3; i <= 3; i++) spot(i * 1.2, -0.8, 0, 'sit');
      spot(0, 0.8, Math.PI, 'sit'); spot(2, 0.8, Math.PI, 'sit');
    } else if (kind === 'barracks') {
      for (let i = 0; i < 4; i++) add(new BoxGeometry(0.9, 0.3, 2.0), wood, -W / 2 + 0.7 + i * 1.1, 0.25, -D / 2 + 1.2);   // bunks
      add(new BoxGeometry(2.4, 1.6, 0.2), wood, W / 2 - 1.5, 0.8, D / 2 - 0.3);   // weapon rack
      for (let i = 0; i < 5; i++) add(new CylinderGeometry(0.02, 0.02, 2.2, 5), wood, W / 2 - 2.5 + i * 0.5, 1.1, D / 2 - 0.45);
      table(0, 0.6, 1.8); fire(W / 2 - 0.8, -D / 2 + 0.8, 0.4, 9);
      spot(0, 0.0, 0, 'sit'); spot(0.6, 1.2, Math.PI, 'sit'); spot(-W / 2 + 0.7, -D / 2 + 1.2, 0, 'lie'); spot(-W / 2 + 1.8, -D / 2 + 1.2, 0, 'lie');
      this.sleep = { x: -W / 2 + 2.9, z: -D / 2 + 1.2 };
    } else if (kind === 'bath') {
      for (const [x, z] of [[-1.2, -0.8], [1.2, -0.8]]) { add(new CylinderGeometry(0.75, 0.7, 0.75, 16, 1, true), wood, x, 0.38, z); add(new CylinderGeometry(0.7, 0.7, 0.04, 16), new MeshStandardMaterial({ color: '#8aa0a8', roughness: 0.1, metalness: 0.1 }), x, 0.6, z); }
      add(new BoxGeometry(1.2, 1.2, 1.2), new MeshStandardMaterial({ color: '#5a4a3a', roughness: 1 }), W / 2 - 0.9, 0.6, D / 2 - 0.9);
      fire(W / 2 - 0.9, D / 2 - 1.6, 0.5, 11);
      bench(0, D / 2 - 0.5, W - 2);
      spot(0, 0.8, Math.PI); spot(-1.2, -0.8, 0, 'sit'); spot(1.2, -0.8, 0, 'sit');
    } else {
      // a home: the jizba with a stove, a table, benches, a straw bed
      add(new BoxGeometry(1.3, 1.2, 1.0), new MeshStandardMaterial({ color: '#6e5a48', roughness: 1 }), -W / 2 + 0.8, 0.6, -D / 2 + 0.7);
      fire(-W / 2 + 0.8, -D / 2 + 1.3, 0.4, 8);
      table(0.5, 0.2, 1.6); bench(0.5, -0.45, 1.6);
      add(new BoxGeometry(1.0, 0.25, 2.0), new MeshStandardMaterial({ color: '#b8a060', roughness: 1 }), W / 2 - 0.7, 0.13, D / 2 - 1.1);   // straw bed
      spot(0.2, -0.45, 0, 'sit'); spot(0.9, -0.45, 0, 'sit'); spot(W / 2 - 0.7, D / 2 - 1.1, 0, 'lie'); spot(-W / 2 + 1.2, 0.4, Math.PI / 2);
      this.sleep = { x: W / 2 - 0.7, z: D / 2 - 1.1 };
    }
    for (const L of lights) this.group.add(L);
    this.lights = lights;
    this.group.position.set(this.origin.x, this.origin.y, this.origin.z);
    scene.add(this.group);
    this.assign = new Map();
    void PlaneGeometry;
  }

  /** World position of a local room point. */
  world(x, z) { return { x: this.origin.x + x, y: this.origin.y, z: this.origin.z + z }; }

  /** Where a person stands in this room (each keeps their place while here). */
  spotOf(p) {
    if (!this.assign.has(p.id)) {
      const act = p.agent.act;
      const want = /sleep/.test(act) ? 'lie' : /drink|eat|sit|supper|dinner|resting|reckoning/.test(act) ? 'sit' : 'stand';
      const used = new Set(this.assign.values());
      let idx = this.spots.findIndex((s, i) => !used.has(i) && s.posture === want);
      if (idx < 0) idx = this.spots.findIndex((s, i) => !used.has(i));
      if (idx < 0) idx = this.assign.size % this.spots.length;
      this.assign.set(p.id, idx);
    }
    const s = this.spots[this.assign.get(p.id)];
    return { x: this.origin.x + s.x, y: this.origin.y, z: this.origin.z + s.z, yaw: s.yaw, posture: s.posture };
  }

  /** Keep the player inside the walls. */
  clamp(x, z) {
    const lx = Math.max(-this.W / 2 + 0.35, Math.min(this.W / 2 - 0.35, x - this.origin.x));
    const lz = Math.max(-this.D / 2 + 0.35, Math.min(this.D / 2 - 0.35, z - this.origin.z));
    return { x: this.origin.x + lx, z: this.origin.z + lz };
  }

  nearDoor(x, z) { return Math.hypot(x - this.origin.x - this.doorLocal.x, z - this.origin.z - this.doorLocal.z) < 1.3; }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) m.dispose();
    });
    this.group.removeFromParent();
  }
}
