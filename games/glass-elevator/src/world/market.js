/**
 * The ground floor as a supermarket, round the lift core: gondola shelving in eight aisles (west
 * and east wings), chilled cabinets with glass doors along the north wall, fruit and veg tables,
 * four checkouts by the lobby, shopping carts and a promotion table you can take things from.
 * The people: shoppers come in through the plaza door, walk the aisles taking things off the
 * shelves into carts or baskets, queue at an open checkout, are served and leave; cashiers scan,
 * shelf stockers fill the shelves, a guard watches the door. Click anyone to talk to them.
 */
import { Group, Mesh, InstancedMesh, BoxGeometry, SphereGeometry, MeshStandardMaterial, Color, Object3D } from 'three';
import { Batch, boxMesh, cylGeo } from '../render/build.js';
import { Body, MATERIALS } from '../physics/bodies.js';

const S = (color, o = {}) => new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// gondolas (x centres, 0.9 deep) and their z extents; wall shelving 0.45 deep on the east and west walls
const GW = [-15.5, -12.5, -9.5], GE = [9.5, 12.5, 15.5], WZ = [-11.5, 3.5], EZ = [-11.5, -1.5];
const AISLES = [
  { x: -16.6, z: WZ, sides: [-1, 1], name: '1 · Bread & cereal' },
  { x: -14.0, z: WZ, sides: [-1, 1], name: '2 · Pasta, rice & tins' },
  { x: -11.0, z: WZ, sides: [-1, 1], name: '3 · Snacks & drinks' },
  { x: -7.5, z: WZ, sides: [-1], name: '4 · Household' },
  { x: 7.5, z: EZ, sides: [1], name: '5 · Coffee & tea' },
  { x: 11.0, z: EZ, sides: [-1, 1], name: '6 · Baby & health' },
  { x: 14.0, z: EZ, sides: [-1, 1], name: '7 · Cleaning' },
  { x: 16.6, z: EZ, sides: [-1, 1], name: '8 · Pets & paper' },
];
const BACK_Z = -12.8, FRONT_Z = 5.2, MID_Z = -0.6, EXIT_Z = 5.6;
const COUNTERS = [8.4, 10.8, 13.2, 15.6];     // checkout counters (x), z 2.0 to 4.6; the lane on their west
const BINS = [-4, 0, 4];                      // fruit and veg tables, z -11 to -8
const SHIRTS = [0x3b5b8c, 0x8c3b3b, 0xd8d2c4, 0x2f2f33, 0x6a7f4b, 0xc7883a, 0x7d4f8c, 0x2a6b78, 0xb8b8b8, 0x9c5a5a];
const SKIN = [0xf1c8a8, 0xe0ac87, 0xc68a62, 0x8d5a3b, 0x5e3b25];
const HAIR = [0x1c1410, 0x4a2f1c, 0x8a6a3c, 0xd8c08a, 0x777777, 0xa0471f];
const SHOPPER_LINES = ['Excuse me, do you know where the oat milk is?', 'They moved the coffee again.', 'Have you seen the view from the glass lift? Thirty floors!', 'Just popping in for bread.', 'The queue at checkout 1 is always the slowest.', 'Hej! Busy in here today.'];

export class Market {
  constructor({ stage, M, labels, controls, world, glass, sim, props }) {
    Object.assign(this, { stage, M, labels, controls, world, glass, sim, props });
    this.root = new Group(); stage.scene.add(this.root);
    this._mats = new Map();
    this.people = [];
    this._build();
    this._graph();
    this._staff();
    for (let i = 0; i < 16; i++) this._shopper(true);
  }

  mat(hex) { if (!this._mats.has(hex)) this._mats.set(hex, S(hex)); return this._mats.get(hex); }
  solid(x0, y0, z0, x1, y1, z1) { this.world.solid([x0, y0, z0], [x1, y1, z1]); }

  // ---------------------------------------------------------------------------------------------
  // The shop

  _build() {
    const M = this.M, b = new Batch(), L = this.labels;
    const tile = S(0xdedad2, { roughness: 0.35 }), white = S(0xeceae4, { roughness: 0.45 }), shelf = S(0xc9ccce, { metalness: 0.4, roughness: 0.4 });
    const green = S(0x1f6b3a, { roughness: 0.5 }), edge = S(0xf2c21b, { roughness: 0.5 }), chill = S(0x000000, { emissive: new Color(0.8, 0.9, 1), emissiveIntensity: 0.7 });
    // the floor: vinyl tiles over the slab
    for (const [x0, z0, x1, z1] of [[-17.7, -14.7, 17.7, 7], [-17.7, 7, -8.3, 14.6], [8, 7, 17.7, 14.6]]) b.box(tile, x0, 0.004, z0, x1, 0.008, z1, 1);
    const prods = [];
    const stock = (x, s, z0, z1, ys, d, palette) => {
      // a run of products, front-aligned on the shelf edge at x, facing s; each product in 2 to 6 facings
      for (const y of ys) {
        let z = z0 + 0.03;
        while (z < z1 - 0.15) {
          const w = rnd(0.09, 0.26), h = Math.min(0.38, rnd(0.1, 0.34)), c = new Color().setHSL(pick(palette) + rnd(-0.03, 0.03), rnd(0.45, 0.85), rnd(0.35, 0.65));
          for (let f = Math.floor(rnd(2, 7)); f > 0 && z + w < z1 - 0.03; f--, z += w + 0.012) prods.push([x - s * d / 2, y + h / 2, z + w / 2, d, h, w, c]);
          z += 0.02;
        }
      }
    };
    const LEVELS = [0.14, 0.57, 1.0, 1.43];
    const gondola = (x, [z0, z1], palette) => {
      b.box(M.paintGrey, x - 0.45, 0, z0, x + 0.45, 0.12, z1);
      b.box(white, x - 0.03, 0.12, z0, x + 0.03, 1.95, z1);
      for (const s of [-1, 1]) {
        for (const y of LEVELS) { b.box(shelf, x + s * 0.03, y - 0.025, z0, x + s * 0.45, y, z1); b.box(edge, x + s * 0.44, y - 0.06, z0, x + s * 0.46, y, z1); }
        stock(x + s * 0.43, s, z0, z1, LEVELS, 0.3, palette);
      }
      b.box(green, x - 0.46, 1.95, z0, x + 0.46, 2.1, z1);
      this.solid(x - 0.45, 0, z0, x + 0.45, 2.1, z1);
    };
    const wallShelf = (x, s, [z0, z1], palette) => {
      // against a wall at x, its shelves facing s
      b.box(M.paintGrey, Math.min(x, x + s * 0.45), 0, z0, Math.max(x, x + s * 0.45), 0.12, z1);
      b.box(white, Math.min(x, x + s * 0.03), 0.12, z0, Math.max(x, x + s * 0.03), 2.2, z1);
      for (const y of [...LEVELS, 1.86]) { b.box(shelf, Math.min(x, x + s * 0.45), y - 0.025, z0, Math.max(x, x + s * 0.45), y, z1); b.box(edge, x + s * 0.44 - 0.01, y - 0.06, z0, x + s * 0.44 + 0.01, y, z1); }
      stock(x + s * 0.43, s, z0, z1, [...LEVELS, 1.86], 0.3, palette);
      this.solid(Math.min(x, x + s * 0.45), 0, z0, Math.max(x, x + s * 0.45), 2.2, z1);
    };
    const PAL = [[0.08, 0.1, 0.13, 0.0], [0.0, 0.05, 0.6, 0.12], [0.0, 0.15, 0.55, 0.95], [0.55, 0.6, 0.3, 0.85], [0.03, 0.08, 0.0, 0.33], [0.55, 0.9, 0.15, 0.5], [0.5, 0.6, 0.33, 0.15], [0.08, 0.6, 0.12, 0.45]];
    GW.forEach((x, i) => gondola(x, WZ, PAL[i + 1]));
    GE.forEach((x, i) => gondola(x, EZ, PAL[i + 5]));
    wallShelf(-17.7, 1, WZ, PAL[0]);
    wallShelf(17.7, -1, EZ, PAL[7]);
    // chilled cabinets along the north wall: lit inside, glass doors
    const fz0 = -14.7, fz1 = -13.9;
    for (const [x0, x1] of [[-17.4, -0.3], [0.3, 17.4]]) {
      b.box(white, x0, 0, fz0, x1, 0.15, fz1); b.box(white, x0, 2.05, fz0, x1, 2.4, fz1);
      b.box(chill, x0, 0.15, fz0, x1, 2.05, fz0 + 0.04);
      for (const y of [0.15, 0.55, 0.95, 1.35, 1.75]) b.box(shelf, x0, y - 0.02, fz0, x1, y, fz1 - 0.05);
      for (const y of [0.15, 0.55, 0.95, 1.35, 1.75]) {
        let x = x0 + 0.03;
        while (x < x1 - 0.15) {
          const w = rnd(0.07, 0.2), h = rnd(0.12, 0.3), c = new Color().setHSL(pick([0.6, 0.58, 0.0, 0.12, 0.33]), rnd(0.2, 0.8), rnd(0.45, 0.9));
          for (let f = Math.floor(rnd(3, 8)); f > 0 && x + w < x1 - 0.03; f--, x += w + 0.01) prods.push([x + w / 2, y + h / 2, fz1 - 0.2, w, h, 0.32, c]);
          x += 0.02;
        }
      }
      for (let x = x0; x <= x1 + 1e-6; x += (x1 - x0) / Math.round((x1 - x0) / 0.8)) b.box(M.aluminium, x - 0.02, 0.15, fz1 - 0.04, x + 0.02, 2.05, fz1);
      this.glass.add([x0, 0.15, fz1 - 0.02], [x1 - x0, 0, 0], [0, 1.9, 0], { tint: 0.03 });
      this.solid(x0, 0, fz0, x1, 2.4, fz1);
      for (let i = 0; i < 3; i++) this._sign(x0 + (x1 - x0) * (i + 0.5) / 3, 2.22, fz1 + 0.005, 0, 'DAIRY · MEAT · FROZEN', 2.6, 0.32, false);
    }
    // fruit and veg: sloping wooden tables heaped with fruit
    const fruit = [];
    for (const bx of BINS) {
      b.box(M.wood, bx - 1.2, 0, -11, bx + 1.2, 0.75, -8);
      this.solid(bx - 1.2, 0, -11, bx + 1.2, 0.95, -8);
      for (let k = 0; k < 4; k++) {
        const hue = [0.0, 0.08, 0.15, 0.28, 0.95][(k + bx + 8) % 5], r = [0.045, 0.05, 0.06, 0.04, 0.035][k];
        for (let i = 0; i < 70; i++) fruit.push([bx - 1.15 + k * 0.58 + rnd(0.05, 0.53), 0.75 + r + rnd(0, 0.12), rnd(-10.95, -8.05), r * rnd(0.9, 1.15), new Color().setHSL(hue + rnd(-0.02, 0.02), 0.75, rnd(0.35, 0.5))]);
      }
      this._sign(bx, 1.6, -8, 0, 'FRUIT & VEG', 1.4, 0.3, true, true);
    }
    // the checkouts: counter, belt, scanner, till on its pole with the lane number, bagging area
    this.lanes = COUNTERS.map((cx, i) => {
      b.box(white, cx - 0.4, 0, 2.0, cx + 0.4, 0.88, 4.6);
      b.box(M.rubber, cx - 0.32, 0.88, 2.05, cx + 0.32, 0.9, 3.45);
      b.box(M.plastic, cx - 0.3, 0.88, 3.5, cx + 0.3, 0.95, 3.85);
      b.box(M.stainless, cx - 0.36, 0.88, 3.95, cx + 0.36, 0.9, 4.55);
      b.box(M.steel, cx + 0.3, 0.88, 3.7, cx + 0.34, 1.35, 3.74);
      b.box(M.plastic, cx + 0.12, 1.25, 3.62, cx + 0.42, 1.45, 3.66);
      b.box(M.steel, cx - 0.36, 0.9, 1.98, cx - 0.32, 2.1, 2.02);
      this.solid(cx - 0.4, 0, 2.0, cx + 0.4, 0.95, 4.6);
      const open = i < 3;
      this._sign(cx - 0.34, 2.25, 1.97, Math.PI, open ? String(i + 1) : 'CLOSED', open ? 0.3 : 0.55, 0.22, true, open);
      return { x: cx - 0.72, cx, open, queue: [], cashier: null };
    });
    // the shop's name over the way in from the lobby, and the aisle signs
    b.box(green, -3, 4.2, 6.9, 3, 5.1, 7.0);
    this._sign(0, 4.65, 7.005, 0, 'SUPERMARKET', 5.4, 0.7, true);
    for (const a of AISLES) {
      const z = a.z[1] + 0.3;
      b.box(green, a.x - 0.8, 3.0, z - 0.02, a.x + 0.8, 3.45, z);
      this._sign(a.x, 3.225, z + 0.005, 0, a.name, 1.5, 0.36, true);
      b.box(M.steel, a.x - 0.6, 3.45, z - 0.015, a.x - 0.58, 5.7, z - 0.005); b.box(M.steel, a.x + 0.58, 3.45, z - 0.015, a.x + 0.6, 5.7, z - 0.005);
    }
    // a promotion table at the way in
    b.box(M.wood, -4, 0, 5.8, -2, 0.8, 6.6); this.solid(-4, 0, 5.8, -2, 0.8, 6.6);
    b.build(this.root);
    // the stock: one instanced box per product, one instanced sphere per fruit
    const im = new InstancedMesh(new BoxGeometry(1, 1, 1), S(0xffffff, { roughness: 0.5 }), prods.length), o = new Object3D();
    prods.forEach(([x, y, z, sx, sy, sz, c], i) => { o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, c); });
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; this.root.add(im);
    const fm = new InstancedMesh(new SphereGeometry(1, 10, 8), S(0xffffff, { roughness: 0.45 }), fruit.length);
    fruit.forEach(([x, y, z, r, c], i) => { o.position.set(x, y, z); o.scale.setScalar(r); o.updateMatrix(); fm.setMatrixAt(i, o.matrix); fm.setColorAt(i, c); });
    fm.instanceMatrix.needsUpdate = true; fm.instanceColor.needsUpdate = true; this.root.add(fm);
    // what you can take: shopping carts, and the promotion table's goods
    const add = (spec, look) => {
      const body = this.world.add(new Body(spec)); body.home = [...spec.pos];
      const g = new Group(); this.stage.scene.add(g); look(g);
      g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.userData.body = body; } });
      this.props.list.push({ b: body, g });
    };
    for (let i = 0; i < 4; i++) add({ name: 'Shopping cart (16 kg, on castors)', kind: 'box', size: [0.56, 1.0, 0.92], mass: 16, pos: [7.55, 0.5, 10.6 + i * 0.95], mu: MATERIALS.castors, e: 0.05 }, (g) => { const c = this._cart(); c.position.set(0, -0.5, -0.4); g.add(c); });
    const goods = [
      ['Watermelon (4 kg)', 'ball', { r: 0.13 }, 4, 0x2f6b2a], ['Watermelon (4 kg)', 'ball', { r: 0.13 }, 4, 0x2f6b2a],
      ['Six-pack of water (9 kg)', 'box', { size: [0.27, 0.25, 0.18] }, 9, 0x6fa8d8], ['Cereal box (0.5 kg)', 'box', { size: [0.2, 0.3, 0.07] }, 0.5, 0xd8a514],
      ['Cereal box (0.5 kg)', 'box', { size: [0.2, 0.3, 0.07] }, 0.5, 0xb83a26], ['Bag of flour (2 kg)', 'box', { size: [0.16, 0.24, 0.09] }, 2, 0xece6d6],
      ['Pumpkin (3 kg)', 'ball', { r: 0.11 }, 3, 0xe0761b], ['Tin of tomatoes (0.4 kg)', 'cyl', { size: [0.075, 0.11, 0.075] }, 0.4, 0xc0281c],
    ];
    goods.forEach(([name, kind, dim, mass, col], i) => {
      const h = dim.r ? dim.r * 2 : dim.size[1];
      add({ name, kind, ...dim, mass, pos: [-3.75 + (i % 4) * 0.5, 0.8 + h / 2 + 0.01, 6.0 + Math.floor(i / 4) * 0.35], mu: MATERIALS.cardboard, e: 0.1 }, (g) => {
        const m = kind === 'ball' ? new Mesh(new SphereGeometry(dim.r, 16, 12), this.mat(col)) : kind === 'cyl' ? new Mesh(cylGeo(dim.size[0] / 2, dim.size[1], 'y', 16), this.mat(col)) : boxMesh(this.mat(col), ...dim.size);
        g.add(m);
      });
    });
    // the play corner east of the lobby: a wall of boxes to knock down, bowling, balls, barrels, crates, sacks
    const thing = (name, kind, dim, mass, pos, col, mu = MATERIALS.cardboard, e = 0.15, deco) => add({ name, kind, ...dim, mass, pos, mu, e }, (g) => {
      g.add(kind === 'ball' ? new Mesh(new SphereGeometry(dim.r, 18, 12), this.mat(col)) : kind === 'cyl' ? new Mesh(cylGeo(dim.size[0] / 2, dim.size[1], 'y', 18), this.mat(col)) : boxMesh(this.mat(col), ...dim.size));
      deco?.(g);
    });
    for (let row = 0; row < 5; row++) for (let i = 0; i < 5; i++) thing('Cardboard box (3 kg)', 'box', { size: [0.4, 0.4, 0.4] }, 3, [9.6 + i * 0.42 + (row % 2) * 0.21, 0.2 + row * 0.405, 9.2], 0xa47a4c);
    const pin = (g) => { const st = new Mesh(cylGeo(0.062, 0.04, 'y', 18), this.mat(0xc0281c)); st.position.y = 0.09; g.add(st); };
    [[0, 0], [-1, 1], [1, 1], [-2, 2], [0, 2], [2, 2], [-3, 3], [-1, 3], [1, 3], [3, 3]].forEach(([u, v]) => thing('Bowling pin (1.5 kg)', 'cyl', { size: [0.12, 0.38] }, 1.5, [15.2 + u * 0.15, 0.19, 12.4 + v * 0.26], 0xf4f2ec, MATERIALS.plastic, 0.3, pin));
    thing('Bowling ball (7 kg)', 'ball', { r: 0.11 }, 7, [15.2, 0.11, 8.4], 0x1c2a6e, MATERIALS.plastic, 0.2);
    thing('Bowling ball (5 kg)', 'ball', { r: 0.1 }, 5, [14.7, 0.1, 8.4], 0x7a1c4a, MATERIALS.plastic, 0.2);
    for (let i = 0; i < 4; i++) thing('Beach ball', 'ball', { r: 0.25 }, 0.3, [10 + i * 0.7, 0.25, 12.8], [0xe0561b, 0x2a6bd8, 0xf2c21b, 0x2f9b4a][i], MATERIALS.rubber, 0.85);
    for (let i = 0; i < 3; i++) thing('Basketball (0.6 kg)', 'ball', { r: 0.12 }, 0.6, [12.8 + i * 0.3, 0.12, 11.2], 0xd2691e, MATERIALS.rubber, 0.8);
    for (let i = 0; i < 3; i++) thing('Oil barrel (20 kg, empty)', 'cyl', { size: [0.58, 0.88] }, 20, [16.6, 0.44, 9 + i * 0.7], [0x1f4f8a, 0xa3201b, 0x2f6b3d][i], MATERIALS.steel, 0.1);
    for (let i = 0; i < 4; i++) thing('Wooden crate (12 kg)', 'box', { size: [0.5, 0.5, 0.5] }, 12, [12.6 + (i % 2) * 0.55, 0.25 + Math.floor(i / 2) * 0.505, 13.8], 0x9a6a3a, MATERIALS.wood);
    thing('Pallet (20 kg)', 'box', { size: [1.2, 0.15, 0.8] }, 20, [10.4, 0.075, 14.0], 0xb08a5a, MATERIALS.wood);
    for (let i = 0; i < 3; i++) thing('Sack of potatoes (25 kg)', 'box', { size: [0.45, 0.25, 0.65] }, 25, [10.4, 0.15 + 0.125 + i * 0.255, 14.0], 0x8a7a55, MATERIALS.cardboard, 0.05);
    for (let i = 0; i < 6; i++) thing('Watermelon (4 kg)', 'ball', { r: 0.13 }, 4, [9.2 + (i % 3) * 0.28, 0.13, 11.4 + Math.floor(i / 3) * 0.28], 0x2f6b2a, MATERIALS.cardboard, 0.2);
    thing('Traffic cone (2.5 kg)', 'cyl', { size: [0.3, 0.5] }, 2.5, [14.0, 0.25, 10.0], 0xe0561b, MATERIALS.rubber);
    thing('Gym ball (1 kg)', 'ball', { r: 0.33 }, 1, [11.6, 0.33, 11.0], 0x7d4f8c, MATERIALS.rubber, 0.7);
  }

  /** A sign: lit (or printed) lettering on a board face, facing +z turned by ry. */
  _sign(x, y, z, ry, text, w, h, lit = true, green = false) {
    const L = this.labels, px = Math.min(1024, Math.round(w / h * 64));
    const q = L.quad(L.text('mk:' + text, text, { w: px, h: 64, size: 40, weight: 700 }), w, h, lit ? (green ? L.glowGreen : L.glow) : L.engraved);
    q.position.set(x, y, z); q.rotation.y = ry; this.root.add(q);
    return q;
  }

  /** A shopping cart: wire basket, handle and castors (origin on the floor, handle toward -z). */
  _cart() {
    const g = new Group(), M = this.M, b = new Batch(), w = M.aluminium;
    for (const [x0, x1, z0, z1] of [[-0.27, -0.25, 0, 0.8], [0.25, 0.27, 0, 0.8], [-0.27, 0.27, 0, 0.02], [-0.27, 0.27, 0.78, 0.8]]) b.box(w, x0, 0.45, z0, x1, 0.95, z1);
    b.box(w, -0.27, 0.45, 0, 0.27, 0.47, 0.8);
    b.box(M.paintRed, -0.28, 1.0, -0.06, 0.28, 1.04, -0.02);
    b.box(w, -0.26, 0.95, -0.05, -0.24, 1.0, 0.02); b.box(w, 0.24, 0.95, -0.05, 0.26, 1.0, 0.02);
    b.box(w, -0.22, 0.1, 0.05, -0.2, 0.45, 0.07); b.box(w, 0.2, 0.1, 0.05, 0.22, 0.45, 0.07);
    b.box(w, -0.22, 0.1, 0.05, 0.22, 0.12, 0.75);
    for (const [x, z] of [[-0.2, 0.05], [0.2, 0.05], [-0.2, 0.75], [0.2, 0.75]]) b.cyl(M.rubber, x, 0.05, z, 0.05, 0.03, 'x', 10);
    b.build(g, { shadow: false });
    return g;
  }

  // ---------------------------------------------------------------------------------------------
  // Where people can walk: corridors and aisles as a graph

  _graph() {
    const N = this.nodes = [], E = this.edges = [];
    const at = (x, z) => { let i = N.findIndex((n) => Math.abs(n[0] - x) < 0.05 && Math.abs(n[1] - z) < 0.05); if (i < 0) { i = N.length; N.push([x, z]); E.push([]); } return i; };
    const link = (a, c) => { E[a].push(c); E[c].push(a); };
    const chain = (pts) => { for (let i = 1; i < pts.length; i++) link(at(...pts[i - 1]), at(...pts[i])); };
    const west = AISLES.filter((a) => a.x < 0), east = AISLES.filter((a) => a.x > 0);
    chain([...AISLES.map((a) => [a.x, BACK_Z]), ...BINS.map((x) => [x, BACK_Z])].sort((p, q) => p[0] - q[0]));
    chain([...west.map((a) => [a.x, FRONT_Z]), [0, FRONT_Z], [5.6, 6.4], [6.6, EXIT_Z]]);
    for (const a of west) link(at(a.x, BACK_Z), at(a.x, FRONT_Z));
    chain([[6.6, EXIT_Z], [6.6, MID_Z]]);
    chain([[6.6, MID_Z], ...[...east.map((a) => a.x), ...this.lanes.slice(1).map((l) => l.x)].sort((p, q) => p - q).map((x) => [x, MID_Z])]);
    for (const a of east) link(at(a.x, BACK_Z), at(a.x, MID_Z));
    chain([[6.6, EXIT_Z], ...this.lanes.map((l) => [l.x, EXIT_Z])]);
    chain([[5.6, 6.4], [6.9, 9.5], [6.0, 12.5], [6.0, 14.4], [6.0, 16.5], [6.0, 18.5]]);
    chain([[6.6, EXIT_Z], [6.9, 9.5]]);
    this.at = at;
    this.OUT = at(6.0, 18.5);
  }

  /** The shortest way between two nodes, as points. */
  route(a, c) {
    const N = this.nodes, n = N.length, dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
    dist[a] = 0;
    for (;;) {
      let u = -1; for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === c) break;
      done[u] = true;
      for (const v of this.edges[u]) { const d = dist[u] + Math.hypot(N[u][0] - N[v][0], N[u][1] - N[v][1]); if (d < dist[v]) { dist[v] = d; prev[v] = u; } }
    }
    const out = []; for (let u = c; u >= 0; u = prev[u]) out.unshift([...N[u]]);
    return out;
  }

  /** A place to stand and take something: { p, face (yaw), node }. */
  _spot() {
    const r = Math.random();
    if (r < 0.7) {
      const a = pick(AISLES), s = pick(a.sides), z = rnd(a.z[0] + 0.6, a.z[1] - 0.6);
      const end = z - a.z[0] < a.z[1] - z ? BACK_Z : a.x < 0 ? FRONT_Z : MID_Z;
      return { p: [a.x + s * 0.3, z], face: s * Math.PI / 2, node: this.at(a.x, end) };
    }
    if (r < 0.88) {
      const x = rnd(-17, 17), near = [...AISLES.map((a) => a.x), ...BINS].reduce((p, q) => (Math.abs(q - x) < Math.abs(p - x) ? q : p));
      return { p: [x, -13.4], face: Math.PI, node: this.at(near, BACK_Z) };
    }
    const bx = pick(BINS);
    return { p: [bx + rnd(-0.9, 0.9), -11.45], face: 0, node: this.at(bx, BACK_Z) };
  }

  // ---------------------------------------------------------------------------------------------
  // People

  _person(o) {
    const h = o.height ?? rnd(1.58, 1.88), g = new Group(), sc = h / 1.75;
    const skin = this.mat(o.skin ?? pick(SKIN)), shirt = this.mat(o.shirt), legs = this.mat(o.legs ?? pick([0x23272e, 0x3a4a68, 0x5a4a3a, 0x1b1b1b, 0x6b6f75])), hair = this.mat(o.hair ?? pick(HAIR)), shoe = this.mat(0x151515);
    const limb = (mat, x, y, w, len, d) => { const p = new Group(); p.position.set(x, y, 0); const m = boxMesh(mat, w, len, d); m.position.y = -len / 2; m.castShadow = true; p.add(m); g.add(p); return { p, m }; };
    const L = limb(legs, -0.09, 0.9, 0.13, 0.86, 0.15), R = limb(legs, 0.09, 0.9, 0.13, 0.86, 0.15);
    for (const k of [L, R]) { const f = boxMesh(shoe, 0.12, 0.06, 0.24); f.position.set(0, -0.87, 0.04); k.p.add(f); }
    const torso = boxMesh(shirt, 0.38, 0.6, 0.22); torso.position.y = 1.2; torso.castShadow = true; g.add(torso);
    const AL = limb(shirt, -0.235, 1.47, 0.1, 0.6, 0.11), AR = limb(shirt, 0.235, 1.47, 0.1, 0.6, 0.11);
    for (const k of [AL, AR]) { const hd = boxMesh(skin, 0.08, 0.1, 0.09); hd.position.y = -0.64; k.p.add(hd); }
    const head = new Mesh(new SphereGeometry(0.11, 14, 10), skin); head.position.y = 1.64; head.scale.set(1, 1.15, 1); head.castShadow = true; g.add(head);
    const cap = boxMesh(o.capMat ?? hair, 0.22, 0.07, 0.23); cap.position.set(0, 1.74, -0.01); g.add(cap);
    if (o.apron) { const ap = boxMesh(this.mat(o.apron), 0.34, 0.62, 0.02); ap.position.set(0, 1.08, 0.12); g.add(ap); const tag = boxMesh(this.mat(0xf4f4f4), 0.07, 0.03, 0.01); tag.position.set(0.1, 1.38, 0.135); g.add(tag); }
    g.scale.setScalar(sc);
    this.root.add(g);
    const P = { g, L, R, AL, AR, torso, head, x: 0, z: 0, yaw: 0, vx: 0, vz: 0, phase: 0, path: [], speed: rnd(1.0, 1.35), t: 0, blocked: 0, ...o };
    P.mover = this.world.mover({ bounds: () => (P.g.visible ? [[P.x - 0.22, 0, P.z - 0.22], [P.x + 0.22, 1.75 * sc, P.z + 0.22]] : null), vel: () => [P.vx, 0, P.vz] });
    this.controls.add([torso, head], {
      id: 'person.' + this.people.length, label: o.name, kind: 'button', person: true,
      hint: () => `${o.name} · click to talk`,
      down: () => this.sim.say(P.talk ? P.talk() : pick(o.lines ?? SHOPPER_LINES), o.name),
    });
    this.people.push(P);
    return P;
  }

  _staff() {
    const uni = { shirt: 0x1f6b3a, legs: 0x1b1b1b, apron: 0x14502a };
    const names = ['Sara', 'Ahmed', 'Lena'];
    this.lanes.forEach((l, i) => {
      if (!l.open) return;
      const c = this._person({ ...uni, name: `${names[i]} (checkout ${i + 1})`, role: 'cashier', lane: l, lines: ['Hi! Do you need a bag?', 'Card or cash?', 'Would you like the receipt?', 'That\'s everything, have a nice day!', 'Lane 4 is closed today, sorry.'] });
      c.x = l.cx + 0.72; c.z = 3.3; c.yaw = -Math.PI / 2; l.cashier = c;
    });
    for (const name of ['Johan (shelves)', 'Maja (shelves)']) {
      const s = this._person({ ...uni, name, role: 'stocker', lines: ['The cereal came in this morning, aisle 1.', 'If you can\'t find it, it\'s probably on the top shelf.', 'Mind the boxes!', 'We restock the fridges at six.'] });
      const box = boxMesh(this.M.cardboard, 0.4, 0.3, 0.3); box.position.set(0, 1.12, 0.36); s.g.add(box); s.box = box;
      const sp = this._spot(); [s.x, s.z] = sp.p; s.node = sp.node; s.state = 'browse'; s.t = rnd(2, 8); s.face = sp.face;
    }
    const gd = this._person({ shirt: 0x1c2a44, legs: 0x1c2a44, capMat: this.mat(0x1c2a44), name: 'Erik (security)', role: 'guard', lines: ['Welcome in.', 'Have a nice day.', 'Carts are by the door.', 'The lifts? Through the lobby, the glass one.'] });
    gd.x = 4.4; gd.z = 13.0; gd.yaw = Math.PI / 2;
  }

  _shopper(inside) {
    const P = this._person({ shirt: pick(SHIRTS), name: 'Shopper', role: 'shopper' });
    P.withCart = Math.random() < 0.5;
    if (P.withCart) { P.cart = this._cart(); P.cart.position.set(0, 0, 0.42); P.g.add(P.cart); }
    else { P.basket = boxMesh(this.mat(0xc0281c), 0.38, 0.2, 0.26); P.basket.position.set(-0.3, 0.72, 0.05); P.g.add(P.basket); }
    P.goods = [];
    for (let i = 0; i < 6; i++) {
      const m = boxMesh(this.mat(new Color().setHSL(Math.random(), 0.6, 0.5).getHex()), 0.12, 0.16, 0.1); m.visible = false;
      if (P.withCart) m.position.set(-0.15 + (i % 3) * 0.15, 0.56, 0.2 + Math.floor(i / 3) * 0.25), P.cart.add(m);
      else m.position.set(-0.1 + (i % 3) * 0.1, 0.1, 0), P.basket.add(m);
      P.goods.push(m);
    }
    this._enter(P, inside);
  }

  _enter(P, inside) {
    P.items = 0; P.list = Array.from({ length: Math.floor(rnd(2, 6)) }, () => this._spot()); P.g.visible = true;
    if (inside) { const sp = P.list.shift(); [P.x, P.z] = sp.p; P.node = sp.node; P.state = 'browse'; P.t = rnd(0.5, 4); P.face = sp.face; P.items = Math.floor(rnd(0, 3)); }
    else { P.node = this.OUT; [P.x, P.z] = this.nodes[this.OUT]; this._next(P); }
    this._goods(P);
  }

  _goods(P) { P.goods.forEach((m, i) => (m.visible = i < P.items)); }

  _go(P, pts, then) { P.path = pts; P.then = then; P.state = 'walk'; }

  /** What a shopper does next: the next thing on the list, or the checkout. */
  _next(P) {
    if (P.role === 'stocker' || P.list.length) {
      const sp = P.role === 'stocker' ? this._spot() : P.list.shift();
      this._go(P, [...this.route(P.node, sp.node), sp.p], () => { P.node = sp.node; P.state = 'browse'; P.t = P.role === 'stocker' ? rnd(6, 14) : rnd(2, 5); P.face = sp.face; });
      return;
    }
    const open = this.lanes.filter((l) => l.open), lane = open.reduce((a, c) => (c.queue.length < a.queue.length ? c : a));
    if (lane.queue.length >= 4) { P.list.push(this._spot()); return this._next(P); }
    const ln = this.at(lane.x === this.lanes[0].x ? 7.5 : lane.x, MID_Z);
    this._go(P, this.route(P.node, ln), () => { lane.queue.push(P); P.lane = lane; P.state = 'queue'; P.serving = false; });
  }

  update(dt) {
    const pl = this.game?.player;
    for (const P of this.people) {
      if (P.role === 'cashier') { this._pose(P, dt, 0, P.lane.queue[0]?.serving ? 'scan' : null); continue; }
      if (P.role === 'guard') { this._pose(P, dt, 0, null); continue; }
      if (P.state === 'gone') { P.t -= dt; if (P.t <= 0) this._enter(P, false); continue; }
      let target = null, reach = null;
      if (P.state === 'walk') target = P.path[0];
      else if (P.state === 'browse') {
        P.yaw = turn(P.yaw, P.face, dt * 5); P.t -= dt; reach = P.role === 'stocker' ? 'stock' : 'reach';
        if (P.t <= 0) { if (P.role === 'shopper') { P.items = Math.min(6, P.items + Math.ceil(rnd(0, 2))); this._goods(P); } this._next(P); }
      } else if (P.state === 'queue') {
        const k = P.lane.queue.indexOf(P);
        target = k === 0 ? [P.lane.x, 3.3] : [P.lane.x, 1.6 - (k - 1) * 0.85];
        if (k === 0 && Math.hypot(P.x - target[0], P.z - target[1]) < 0.12) {
          target = null; P.yaw = turn(P.yaw, Math.PI / 2 - 0.4, dt * 4);
          if (!P.serving) { P.serving = true; P.t = 3 + P.items * 1.2; }
          P.t -= dt; reach = P.t < 2 ? 'pay' : null;
          if (P.t <= 0) {
            P.lane.queue.shift(); P.serving = false;
            const ex = this.at(P.lane.x, EXIT_Z);
            this._go(P, [[P.lane.x, EXIT_Z], ...this.route(ex, this.OUT)], () => { P.state = 'gone'; P.g.visible = false; P.t = rnd(2, 12); });
          }
        }
      }
      let moving = false;
      if (target) {
        const dx = target[0] - P.x, dz = target[1] - P.z, d = Math.hypot(dx, dz);
        if (d < 0.08) {
          if (P.state === 'walk') { P.path.shift(); if (!P.path.length) { P.vx = P.vz = 0; P.then?.(); } }
        } else {
          const ux = dx / d, uz = dz / d;
          // someone (or you) in the way: wait, and after a while squeeze past
          let block = false;
          if (P.blocked < 1.5) {
            for (const o of this.people) {
              if (o === P || !o.g.visible) continue;
              const ox = o.x - P.x, oz = o.z - P.z, ahead = ox * ux + oz * uz;
              if (ahead > 0.05 && ahead < 0.75 && Math.abs(ox * uz - oz * ux) < 0.42 && !(P.state === 'queue' && o.state === 'queue' && ahead > 0.5)) { block = true; break; }
            }
            if (pl && Math.abs(pl.p[1]) < 1) { const ox = pl.p[0] - P.x, oz = pl.p[2] - P.z, ahead = ox * ux + oz * uz; if (ahead > 0 && ahead < 0.8 && Math.abs(ox * uz - oz * ux) < 0.5) { block = true; if (!P.said || this.sim.clock - P.said > 20) { P.said = this.sim.clock; if (P.blocked > 1) this.sim.say('Excuse me!', P.name); } } }
          } else if (P.blocked > 2.5) P.blocked = 0;
          if (block) { P.blocked += dt; P.vx = P.vz = 0; }
          else {
            if (P.blocked >= 1.5) P.blocked += dt; else P.blocked = 0;
            const v = Math.min(P.speed * (P.state === 'queue' ? 0.6 : 1), d / dt);
            P.vx = ux * v; P.vz = uz * v; P.x += P.vx * dt; P.z += P.vz * dt; moving = true;
            P.phase += v * dt * 4.4;
            P.yaw = turn(P.yaw, Math.atan2(ux, uz), dt * 6);
          }
        }
      } else { P.vx = P.vz = 0; }
      this._pose(P, dt, moving ? 1 : 0, reach);
    }
  }

  /** Legs and arms: walking swing, reaching to a shelf, stocking, scanning, paying. */
  _pose(P, dt, walk, act) {
    const k = Math.min(1, dt * 8), sw = walk ? Math.sin(P.phase) * 0.55 : 0, t = this.sim.clock;
    P.L.p.rotation.x += (sw - P.L.p.rotation.x) * k; P.R.p.rotation.x += (-sw - P.R.p.rotation.x) * k;
    let al = -sw * 0.6, ar = sw * 0.6;
    if (P.withCart || P.box) al = ar = -1.15;
    if (P.basket) al = 0;
    if (act === 'reach') ar = -1.6 + Math.sin(t * 2 + P.speed * 9) * 0.3;
    if (act === 'stock') { al = -1.2 + Math.sin(t * 2.5) * 0.4; ar = -1.4 + Math.sin(t * 2.5 + 1.5) * 0.4; }
    if (act === 'scan') ar = -1.0 + Math.sin(t * 7) * 0.45;
    if (act === 'pay') ar = -1.2;
    P.AL.p.rotation.x += (al - P.AL.p.rotation.x) * k; P.AR.p.rotation.x += (ar - P.AR.p.rotation.x) * k;
    if (P.box) P.box.visible = !act;
    P.g.position.set(P.x, Math.abs(Math.sin(P.phase)) * 0.025 * walk, P.z);
    P.g.rotation.y = P.yaw;
  }
}

/** a turned toward b by at most r (rad). */
function turn(a, b, r) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + Math.max(-r, Math.min(r, d)); }
