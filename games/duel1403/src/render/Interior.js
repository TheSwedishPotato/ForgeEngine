import {
  Group, Mesh, BoxGeometry, CylinderGeometry, SphereGeometry, PlaneGeometry, ConeGeometry, MeshStandardMaterial, MeshBasicMaterial, PointLight, DoubleSide, Color,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Batch, barrel, tub, crate, sack, stool, goods, woodpile, bench as benchProp } from './props.js';
import { townMaterials } from './TownMesh.js';

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
    // the door's side, in the building's own frame (castle buildings are turned)
    const rc = Math.cos(building.rot ?? 0), rs = Math.sin(building.rot ?? 0);
    const dx0 = building.door.x - building.x, dz0 = building.door.z - building.z;
    const dx = dx0 * rc - dz0 * rs, dz = dx0 * rs + dz0 * rc;
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
    this._furnish(kind, W, D, H);
    for (const L of lights) this.group.add(L);
    this.lights = lights;
    this.group.position.set(this.origin.x, this.origin.y, this.origin.z);
    scene.add(this.group);
    this.assign = new Map();
    void PlaneGeometry;
  }

  /**
   * The things of the trade and of daily life, modelled (see props.js): the
   * tavern's casks and stools and mugs, the smith's tools and coal, flour
   * sacks and loaves, the shoemaker's lasts, a loom, beds with blankets,
   * shelves of pots, a font, shields and spears, and so on. Kept clear of
   * the door and of the places where people stand.
   */
  _furnish(kind, W, D, H) {
    const M = townMaterials(), B = new Batch();
    const shelf = (x, z, ry, ware = 'pots') => {
      for (const yy of [1.1, 1.6]) B.put('planks', new BoxGeometry(1.4, 0.04, 0.3), x, yy, z, ry);
      for (const s2 of [-1, 1]) B.put('beam', new BoxGeometry(0.05, 0.3, 0.3), x + Math.cos(ry) * s2 * 0.65, 1.0, z - Math.sin(ry) * s2 * 0.65, ry);
      goods(B, ware, x, 1.13, z, { ry, n: 3 }); goods(B, ware, x, 1.63, z, { ry, n: 3 });
    };
    const bed = (x, z, ry = 0, color = 'clothRed') => {
      B.put('planks', new BoxGeometry(1.0, 0.35, 2.0), x, 0.18, z, ry);
      B.put('hay', new BoxGeometry(0.9, 0.12, 1.9), x, 0.41, z, ry);
      B.put(color, new BoxGeometry(0.95, 0.06, 1.3), x + Math.sin(ry) * 0.3, 0.49, z + Math.cos(ry) * 0.3, ry, { rx: 0.03 });
      B.put('sack', new BoxGeometry(0.6, 0.12, 0.3), x - Math.sin(ry) * 0.75, 0.52, z - Math.cos(ry) * 0.75, ry);
    };
    const chest = (x, z, ry = 0) => {
      B.put('planks', new BoxGeometry(1.1, 0.55, 0.55), x, 0.28, z, ry);
      B.put('planks', new CylinderGeometry(0.28, 0.28, 1.1, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), x, 0.55, z, ry);
      for (const t of [-0.35, 0.35]) B.put('iron', new BoxGeometry(0.05, 0.6, 0.58), x + Math.cos(ry) * t, 0.3, z - Math.sin(ry) * t, ry);
    };
    const mug = (x, y, z) => { B.put('stave', new CylinderGeometry(0.05, 0.045, 0.13, 8), x, y + 0.065, z); B.put('iron', new CylinderGeometry(0.052, 0.052, 0.015, 8, 1, true), x, y + 0.11, z); };
    const herbs = (x, z) => { for (let i = 0; i < 4; i++) { const g = new ConeGeometry(0.07, 0.3, 6); g.rotateX(Math.PI); B.put(i % 2 ? 'leaves' : 'hay', g, x + i * 0.25, H - 0.45, z); } };
    if (kind === 'tavern') {
      for (const [x, z] of [[-W / 4, -D / 4], [-W / 4, D / 4], [W / 6, -D / 4]]) { mug(x - 0.4, 0.8, z); mug(x + 0.3, 0.8, z + 0.1); }
      for (let i = 0; i < 3; i++) barrel(B, W / 2 - 0.45, 0, -D / 2 + 0.6 + i * 0.65, { lying: true, ry: Math.PI / 2 });
      shelf(W / 2 - 0.2, D / 2 - 1.4, -Math.PI / 2);
      sack(B, -W / 2 + 0.5, 0, D / 2 - 0.5, { seed: 4 }); crate(B, -W / 2 + 1.1, 0, D / 2 - 0.45, {});
      stool(B, W / 6 + 1.3, 0, D / 4 + 0.4); stool(B, W / 6 + 1.9, 0, D / 4 - 0.3);
      herbs(-W / 4, -D / 2 + 0.4);
    } else if (kind === 'smithy') {
      // tongs and hammers on a rack, a coal heap, a quench tub, bar iron
      B.put('beam', new BoxGeometry(1.6, 0.08, 0.06), 1.0, 1.5, -D / 2 + 0.12);
      for (let i = 0; i < 5; i++) B.put('iron', new BoxGeometry(0.04, 0.5, 0.03), 0.4 + i * 0.3, 1.2, -D / 2 + 0.16);
      const coal = new SphereGeometry(0.5, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2); coal.scale(1, 0.5, 1);
      B.put('dark', coal, -W / 2 + 0.6, 0, D / 2 - 0.7);
      tub(B, 1.4, 0, -0.9, { r: 0.32, h: 0.5 });
      for (let i = 0; i < 6; i++) B.put('iron', new BoxGeometry(1.2, 0.03, 0.03), W / 2 - 0.8, 0.05 + i * 0.03, D / 2 - 0.5 + (i % 2) * 0.04);
      woodpile(B, W / 2 - 0.5, 0, 0, { len: 1.8, h: 0.8, ry: Math.PI / 2 });
    } else if (kind === 'bakery') {
      for (let i = 0; i < 3; i++) sack(B, W / 2 - 0.5, 0, -D / 2 + 0.6 + i * 0.6, { seed: i + 1 });
      shelf(0.6, D / 2 - 0.2, Math.PI, 'bread');
      B.put('log', new BoxGeometry(1.6, 0.35, 0.55), 1, 0.55, -D / 2 + 0.5);       // the kneading trough
      woodpile(B, -W / 2 + 0.5, 0, D / 2 - 0.6, { len: 1.6, h: 0.9 });
    } else if (kind === 'butcher') {
      for (let i = 0; i < 4; i++) goods(B, 'meat', -1 + i * 0.6, H - 0.3, D / 2 - 0.4, { n: 1 });
      B.put('log', new CylinderGeometry(0.35, 0.38, 0.8, 10), 1.6, 0.4, -0.6);
      tub(B, -1.6, 0, -D / 2 + 0.6, {});
    } else if (kind === 'workshop') {
      if (this.b.id === 'weaver') {
        // an upright loom: two posts, beams and the warp
        for (const s2 of [-0.8, 0.8]) B.put('beam', new BoxGeometry(0.1, 1.9, 0.1), 1 + s2, 0.95, D / 2 - 0.6);
        for (const yy of [0.3, 1.8]) B.put('log', new CylinderGeometry(0.05, 0.05, 1.7, 8).rotateZ(Math.PI / 2), 1, yy, D / 2 - 0.6);
        B.put('clothBlue', new BoxGeometry(1.5, 1.4, 0.02), 1, 1.05, D / 2 - 0.6);
        goods(B, 'cloth', -1.2, 0.8, D / 2 - 0.5, { n: 3 });
      } else {
        shelf(1.2, D / 2 - 0.2, Math.PI, 'shoes');
        for (let i = 0; i < 4; i++) B.put('log', new BoxGeometry(0.08, 0.06, 0.24), -0.4 + i * 0.15, 0.83, 0.1);   // lasts on the bench
      }
      chest(W / 2 - 0.8, -D / 2 + 0.6);
    } else if (kind === 'rychta') {
      chest(W / 2 - 0.8, -D / 2 + 0.6);
      shelf(-W / 2 + 0.2, -D / 2 + 1.5, Math.PI / 2);
      B.put('iron', new BoxGeometry(0.06, 0.6, 0.06), 0.9, 1.0, 0.0);   // a candle on an iron stand
    } else if (kind === 'church') {
      const font = new CylinderGeometry(0.55, 0.35, 0.8, 8);
      B.put('stone', font, -W / 2 + 1.5, 0.4, -D / 2 + 2);
      B.put('stone', new CylinderGeometry(0.3, 0.4, 0.3, 8), -W / 2 + 1.5, 0.05, -D / 2 + 2);
      for (const s2 of [-1, 1]) B.put('iron', new CylinderGeometry(0.03, 0.12, 1.2, 6), s2 * 1.6, 0.6, D / 2 - 1.6);
    } else if (kind === 'hall') {
      B.put('planks', new BoxGeometry(W - 2, 0.25, 1.8), 0, 0.12, D / 2 - 1.2);     // the dais for the high table
      for (let i = 0; i < 4; i++) { const sh = new CylinderGeometry(0.35, 0.35, 0.05, 3); sh.rotateX(Math.PI / 2); B.put(i % 2 ? 'clothRed' : 'clothBlue', sh, -W / 2 + 3 + i * (W - 6) / 3, 2.4, -D / 2 + 0.15); }
      for (let i = 0; i < 6; i++) B.put('beam', new BoxGeometry(0.04, 2.6, 0.04), W / 2 - 0.4, 1.3, -D / 2 + 1 + i * 0.35, 0, { rz: 0.1 });
      chest(-W / 2 + 1, -D / 2 + 0.6);
      for (let i = -2; i <= 2; i++) mug(i * 1.1, 0.8, 0.1);
    } else if (kind === 'barracks') {
      for (let i = 0; i < 4; i++) B.put('hay', new BoxGeometry(0.85, 0.08, 1.9), -W / 2 + 0.7 + i * 1.1, 0.44, -D / 2 + 1.2);
      for (let i = 0; i < 3; i++) { const sh = new CylinderGeometry(0.32, 0.32, 0.04, 16); sh.rotateX(Math.PI / 2); B.put(i % 2 ? 'clothRed' : 'planks', sh, -W / 2 + 0.8 + i * 0.8, 1.7, D / 2 - 0.12); }
      chest(W / 2 - 0.8, 0.4, Math.PI / 2);
      barrel(B, W / 2 - 0.5, 0, -D / 2 + 0.5, {});
    } else if (kind === 'bath') {
      for (let i = 0; i < 3; i++) tub(B, -W / 2 + 0.6 + i * 0.5, 0, D / 2 - 0.5, { r: 0.18, h: 0.25 });
      for (let i = 0; i < 4; i++) B.put('sack', new BoxGeometry(0.5, 0.02, 0.8), -W / 2 + 0.3, 1.2, -1 + i * 0.6, 0, { rz: 1.4 });   // linen on a rail
      woodpile(B, W / 2 - 0.4, 0, -D / 2 + 1.4, { len: 1.6, h: 0.8, ry: Math.PI / 2 });
    } else {
      // a home: a bed with a blanket, a chest, pots on a shelf, a distaff, herbs drying
      bed(W / 2 - 0.7, D / 2 - 1.1, 0, Math.random() < 0.5 ? 'clothRed' : 'clothBlue');
      chest(-W / 2 + 0.7, D / 2 - 0.5);
      shelf(0.6, -D / 2 + 0.2, 0);
      tub(B, -W / 2 + 0.5, 0, 0.6, { r: 0.25, h: 0.35 });
      stool(B, 1.3, 0, 0.7);
      herbs(-0.5, D / 2 - 0.4);
      B.put('beam', new CylinderGeometry(0.015, 0.015, 1.2, 4), -W / 2 + 1.6, 0.6, -D / 2 + 0.4, 0, { rz: 0.3 });
    }
    void benchProp;
    for (const [key, geo] of B.build({ planks: 0.8, beam: 0.6, stone: 0.5, hay: 0.8 })) {
      const m = new Mesh(geo, M[key] ?? M.planks);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }
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
