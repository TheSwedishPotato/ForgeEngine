/**
 * Verkstan: a one-bay workshop in a brick and corrugated-steel hall on Hisingen. 18 x 14 m, 5.2 m
 * to the roof beams. The roller door faces south onto the yard; the customers' door and the
 * reception counter are in the south-east corner.
 *
 * In it: a two-post lift (3.5 t, asymmetric arms) whose four arms must each be swung under the
 * car's jacking point before it will take the car's weight; the workbench with its vice and the
 * pegboard of hand tools over it; the roll cab; the parts shelves; the tyre hotel with customers'
 * winter wheels; the compressor and its hose reel; a wheel balancer; a waste-oil drain pan on
 * castors; the oil barrel; the scrap bin; F1 jacks and a heater cart when the F1 car is in.
 *
 * World axes: X east, Y up, Z south. The car on the lift faces north (its +Z to the world's -Z).
 */
import { Group, Mesh, BoxGeometry, CylinderGeometry, PlaneGeometry, Vector3, CanvasTexture, SRGBColorSpace, MeshStandardMaterial } from 'three';
import { meshGroup } from '../render/geo.js';
import { HALL } from '../render/stage.js';

export const BAY = { x: -4, z: -0.5, yaw: Math.PI };
export const DOOR = { x: -4, w: 3.8, h: 3.8 };
export const COUNTER = { x0: 4.3, x1: 8.6, z: 3.4 };
export const CUSTOMER_SPOT = [6.4, 0, 4.4];
export const MECHANIC_SPOT = [6.4, 0, 2.5];
export const YARD = [-4, 0, 13];

const box = (w, h, d, p, m, r) => ({ t: 'box', s: [w, h, d], p, m, r });
const cyl = (rad, len, p, ax, m, o = {}) => ({ t: 'cyl', rad, len, p, ax, m, ...o });

export class Workshop {
  constructor(stage, M) {
    this.stage = stage; this.M = M;
    this.root = new Group(); stage.scene.add(this.root);
    this.pickables = [];
    this.colliders = [];                 // [x0, z0, x1, z1] boxes you cannot walk through
    this.surfaces = [];                  // [x0, z0, x1, z1, y]: tops things can be put on
    const mat = (m) => M[m] ?? M.steel;
    this.mat = mat;
    this._hall();
    this._lift();
    this._furniture();
    this.rollerDoor = 1;                  // 1 open, 0 shut
    this.lift = { y: 0.08, v: 0, cmd: 0, arms: [false, false, false, false], locked: false };
  }

  add(prims, { pick = null, pos = [0, 0, 0], collide = null, surface = null } = {}) {
    const g = meshGroup(prims, this.mat);
    g.position.set(...pos);
    if (pick) g.traverse((o) => { if (o.isMesh) { o.userData.worldId = pick; this.pickables.push(o); } });
    if (collide) this.colliders.push(collide);
    if (surface) this.surfaces.push(surface);
    this.root.add(g);
    return g;
  }

  _hall() {
    const { x0, x1, z0, z1, h } = HALL;
    const W = x1 - x0, D = z1 - z0;
    const walls = [
      box(W, 0.02, D, [0, -0.01, 0], 'floor'),
      box(W + 0.4, 0.3, D + 0.4, [0, h + 0.15, 0], 'ceiling'),
      box(0.3, h, D, [x0 - 0.15, h / 2, 0], 'wallBrick'), box(0.3, h, D, [x1 + 0.15, h / 2, 0], 'wallBrick'),
      box(W, h, 0.3, [0, h / 2, z0 - 0.15], 'wallBrick'),
      // the south wall, with the roller door's opening and the customers' door
      box(DOOR.x - DOOR.w / 2 - x0, h, 0.3, [(x0 + DOOR.x - DOOR.w / 2) / 2, h / 2, z1 + 0.15], 'corrugated'),
      box(5.6 - (DOOR.x + DOOR.w / 2), h, 0.3, [(DOOR.x + DOOR.w / 2 + 5.6) / 2, h / 2, z1 + 0.15], 'corrugated'),
      box(x1 - 7.0, h, 0.3, [(7.0 + x1) / 2, h / 2, z1 + 0.15], 'corrugated'),
      box(1.4, h - 2.1, 0.3, [6.3, 2.1 + (h - 2.1) / 2, z1 + 0.15], 'corrugated'),
      box(DOOR.w, h - DOOR.h, 0.3, [DOOR.x, DOOR.h + (h - DOOR.h) / 2, z1 + 0.15], 'corrugated'),
      // roof beams and the LED panels
      ...[-6, -2, 2, 6].map((z) => box(W, 0.35, 0.18, [0, h - 0.2, z], 'shelfGrey')),
      ...[-6, -3, 0, 3, 6].flatMap((x) => [-4.5, -1, 2.5].map((z) => box(1.2, 0.04, 0.3, [x, h - 0.42, z], 'ledPanel'))),
      // windows high in the east and west walls
      ...[-4, 0, 4].flatMap((z) => [box(0.05, 0.9, 2.2, [x0 + 0.02, 3.9, z], 'glass'), box(0.05, 0.9, 2.2, [x1 - 0.02, 3.9, z], 'glass')]),
      // a painted line round the bay and the yard outside
      box(0.08, 0.004, 6.4, [BAY.x - 2.3, 0.002, BAY.z], 'liftYellow'), box(0.08, 0.004, 6.4, [BAY.x + 2.3, 0.002, BAY.z], 'liftYellow'),
      box(60, 0.02, 30, [0, -0.012, z1 + 15.2], 'asphalt'), box(60, 0.02, 30, [0, -0.012, z0 - 15.2], 'asphalt'),
      box(30, 0.02, 14.4, [x1 + 15.2, -0.012, 0], 'asphalt'), box(30, 0.02, 14.4, [x0 - 15.2, -0.012, 0], 'asphalt'),
      box(80, 0.02, 40, [0, -0.03, 0], 'grass'),
    ];
    this.add(walls);
    this.colliders.push([x0 - 1, z0 - 1, x0, z1 + 1], [x1, z0 - 1, x1 + 1, z1 + 1], [x0 - 1, z0 - 1, x1 + 1, z0]);
    this.colliders.push([x0, z1, DOOR.x - DOOR.w / 2, z1 + 0.3], [DOOR.x + DOOR.w / 2, z1, 5.6, z1 + 0.3], [7.0, z1, x1, z1 + 0.3]);
    // the roller door (rolls up into its drum)
    this.door = this.add([box(DOOR.w, DOOR.h, 0.05, [0, DOOR.h / 2, 0], 'corrugated'), cyl(0.25, DOOR.w + 0.2, [0, DOOR.h + 0.3, 0], 'x', 'shelfGrey')], { pos: [DOOR.x, 0, z1 + 0.05], pick: 'rollerdoor' });
    // the sign over the door
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const g = c.getContext('2d'); g.fillStyle = '#16365e'; g.fillRect(0, 0, 512, 96); g.fillStyle = '#f2f2ee'; g.font = '800 58px Inter, Arial'; g.textAlign = 'center'; g.fillText('VERKSTAN', 256, 66); g.fillStyle = '#e0b012'; g.fillRect(0, 84, 512, 6);
    const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
    const sign = new Mesh(new PlaneGeometry(3.2, 0.6), new MeshStandardMaterial({ map: t, roughness: 0.5 }));
    sign.position.set(DOOR.x, h - 0.6, z1 + 0.32); this.root.add(sign);
  }

  _lift() {
    // two posts with their carriages; each carriage carries two swinging arms with screw pads
    const px = 1.78, z = BAY.z;
    for (const sx of [-1, 1]) this.add([box(0.32, 3.9, 0.36, [0, 1.95, 0], 'liftBlue'), box(0.6, 0.02, 0.6, [0, 0.01, 0], 'steel'), box(0.36, 0.06, 0.4, [0, 3.93, 0], 'liftBlue')], { pos: [BAY.x + sx * px, 0, z], collide: [BAY.x + sx * px - 0.2, z - 0.22, BAY.x + sx * px + 0.2, z + 0.22] });
    this.add([box(px * 2 + 0.3, 0.12, 0.2, [0, 4.0, 0], 'liftBlue')], { pos: [BAY.x, 0, z] });
    this.add([box(0.18, 0.28, 0.12, [0, 0, 0], 'blackPlastic'), box(0.05, 0.05, 0.03, [-0.04, 0.06, 0.07], 'liftYellow'), box(0.05, 0.05, 0.03, [0.04, 0.06, 0.07], 'liftYellow')], { pos: [BAY.x - px - 0.26, 1.3, z + 0.1], pick: 'liftbox' });
    this.carriages = [];
    this.arms = [];
    for (const sx of [-1, 1]) {
      const car = new Group(); car.position.set(BAY.x + sx * px, 0.08, z); this.root.add(car);
      car.add(meshGroup([box(0.4, 0.5, 0.44, [0, 0.25, 0], 'liftYellow')], this.mat));
      this.carriages.push(car);
      for (const sz of [-1, 1]) {
        const arm = new Group(); arm.position.set(-sx * 0.12, 0.05, sz * 0.15); car.add(arm);
        const len = sz < 0 ? 1.15 : 0.9;              // asymmetric: long arms to the front
        const g = meshGroup([box(len, 0.08, 0.14, [-sx * len / 2, 0, 0], 'liftYellow'), cyl(0.07, 0.06, [-sx * len, 0.07, 0], 'y', 'rubber')], this.mat);
        g.traverse((o) => { if (o.isMesh) { o.userData.worldId = 'arm' + this.arms.length; this.pickables.push(o); } });
        arm.add(g);
        arm.userData = { sx, sz, len, swung: 0, target: 0, idx: this.arms.length };
        arm.rotation.y = sz * sx * 1.35;        // swung clear, along the post
        this.arms.push(arm);
      }
    }
  }

  _furniture() {
    const { x0, x1, z0 } = HALL;
    // workbench along the north wall, the vice, the pegboard and its tools, the roll cab
    this.add([box(6, 0.06, 0.8, [0, 0.92, 0], 'benchTop'), ...[-2.9, 0, 2.9].map((x) => box(0.06, 0.9, 0.7, [x, 0.45, 0], 'shelfGrey')), box(0.2, 0.15, 0.2, [-2, 1.02, 0.15], 'liftBlue'), box(0.24, 0.08, 0.06, [-2, 1.1, 0.27], 'steel'),
      box(6, 1.4, 0.03, [0, 1.85, -0.38], 'pegboard'),
      ...[...Array(14).keys()].map((i) => box(0.03, 0.22 + (i % 3) * 0.04, 0.02, [-2.7 + i * 0.4, 1.75, -0.35], i % 4 ? 'chrome' : 'toolRed')),
      ...[...Array(9).keys()].map((i) => box(0.18, 0.02, 0.02, [-2.6 + i * 0.6, 2.25, -0.35], 'chrome'))],
      { pos: [-5, 0, z0 + 0.45], collide: [-8, z0, -2, z0 + 0.85], surface: [-8, z0, -2, z0 + 0.85, 0.95] });
    this.add([box(1.1, 1.0, 0.5, [0, 0.55, 0], 'toolRed'), ...[0, 1, 2, 3, 4].map((i) => box(1.02, 0.015, 0.01, [0, 0.25 + i * 0.17, 0.255], 'chrome')), box(1.1, 0.05, 0.5, [0, 1.08, 0], 'rubber'), ...[-0.45, 0.45].flatMap((x) => [-0.18, 0.18].map((z) => cyl(0.05, 0.04, [x, 0.05, z], 'x', 'rubber')))],
      { pos: [-0.9, 0, z0 + 0.4], pick: 'rollcab', collide: [-1.5, z0, -0.3, z0 + 0.7], surface: [-1.5, z0, -0.3, z0 + 0.7, 1.1] });
    // parts shelves on the west wall
    this.add([...[0, 1, 2, 3].map((i) => box(0.6, 0.03, 6, [0, 0.4 + i * 0.6, 0], 'shelfGrey')), ...[-3, 0, 3].map((z) => box(0.6, 2.3, 0.04, [0, 1.15, z], 'shelfGrey')),
      ...[...Array(24).keys()].map((i) => box(0.36 + (i % 3) * 0.06, 0.24 + (i % 2) * 0.08, 0.32, [0, 0.55 + Math.floor(i / 8) * 0.6, -2.6 + (i % 8) * 0.72], i % 5 ? 'cardboard' : 'liftBlue'))],
      { pos: [x0 + 0.35, 0, 0], pick: 'shelf', collide: [x0, -3, x0 + 0.7, 3] });
    // the tyre hotel on the east wall: customers' winter wheels, in sets of four
    this.add([...[0, 1, 2].map((i) => box(0.7, 0.04, 5, [0, 0.05 + i * 0.9, 0], 'shelfGrey')), ...[...Array(15).keys()].map((i) => cyl(0.31, 0.2, [0, 0.4 + Math.floor(i / 5) * 0.9, -2 + (i % 5) * 0.95], 'x', 'tyre', { seg: 24 }))],
      { pos: [x1 - 0.45, 0, -3.5], pick: 'tyrehotel', collide: [x1 - 0.85, -6.1, x1, -0.9] });
    // compressor and hose reel; the wheel balancer; the oil barrel; the scrap bin
    this.add([cyl(0.25, 0.9, [0, 0.4, 0], 'x', 'toolRed'), box(0.4, 0.3, 0.35, [0.1, 0.85, 0], 'castIron'), cyl(0.2, 0.08, [0, 1.6, -0.45], 'z', 'liftBlue')], { pos: [x1 - 0.8, 0, z0 + 0.6], pick: 'compressor', collide: [x1 - 1.4, z0, x1, z0 + 1.0] });
    this.add([box(0.6, 0.9, 0.6, [0, 0.45, 0], 'liftBlue'), cyl(0.03, 0.4, [-0.4, 0.75, 0], 'x', 'chrome'), box(0.3, 0.25, 0.05, [0, 1.1, -0.2], 'screen')], { pos: [4.0, 0, z0 + 1.3], pick: 'balancer', collide: [3.6, z0 + 0.9, 4.4, z0 + 1.7] });
    this.add([cyl(0.29, 0.88, [0, 0.44, 0], 'y', 'liftBlue', { seg: 20 }), cyl(0.29, 0.88, [0.65, 0.44, 0], 'y', 'paintBlack', { seg: 20 }), box(0.08, 0.3, 0.08, [0, 1.0, 0.2], 'steel')], { pos: [x0 + 0.6, 0, 4.8], pick: 'oilbarrel', collide: [x0, 4.3, x0 + 1.4, 5.3] });
    this.add([cyl(0.3, 0.75, [0, 0.375, 0], 'y', 'shelfGrey', { seg: 16 })], { pos: [-2.0, 0, z0 + 1.7], pick: 'scrap', collide: [-2.3, z0 + 1.4, -1.7, z0 + 2.0] });
    // reception: the counter, the computer, the coffee machine, chairs for those who wait
    this.add([box(COUNTER.x1 - COUNTER.x0, 1.05, 0.6, [0, 0.525, 0], 'wood'), box(COUNTER.x1 - COUNTER.x0 + 0.1, 0.04, 0.7, [0, 1.07, 0], 'benchTop'), box(0.5, 0.32, 0.03, [0.6, 1.3, -0.2], 'screen'), box(0.05, 0.2, 0.05, [0.6, 1.12, -0.18], 'blackPlastic')],
      { pos: [(COUNTER.x0 + COUNTER.x1) / 2, 0, COUNTER.z], pick: 'counter', collide: [COUNTER.x0, COUNTER.z - 0.3, COUNTER.x1, COUNTER.z + 0.3] });
    this.add([box(0.35, 0.5, 0.35, [0, 1.3, 0], 'paintBlack'), box(0.9, 0.9, 0.5, [0, 0.45, 0], 'wood')], { pos: [8.3, 0, 5.6] });
    for (const x of [4.6, 5.3]) this.add([box(0.45, 0.06, 0.45, [0, 0.46, 0], 'liftBlue'), box(0.45, 0.45, 0.05, [0, 0.7, 0.2], 'liftBlue'), ...[-0.18, 0.18].flatMap((a) => [-0.18, 0.18].map((b) => cyl(0.015, 0.45, [a, 0.225, b], 'y', 'chrome')))], { pos: [x, 0, 6.4] });
    this.colliders.push([4.0, 3.4, x1, 3.45]);      // the counter's line: customers stay on their side
    // the whiteboard (today's jobs) and a calendar
    this.add([box(1.8, 1.1, 0.03, [0, 0, 0], 'whiteboard')], { pos: [2.5, 1.8, z0 + 0.03], pick: 'whiteboard' });
  }

  /** Sets the lift's movement: +1 up, -1 down, 0 stop. */
  liftCmd(dir) { this.lift.cmd = dir; }

  update(dt, car) {
    const L = this.lift;
    // the lift: 4 cm/s up and down (as a 3.5 t two-post lift does); it holds on its safety locks
    const target = L.cmd > 0 ? 1.95 : L.cmd < 0 ? 0.08 : L.y;
    if (L.cmd) L.y += Math.sign(target - L.y) * Math.min(Math.abs(target - L.y), 0.045 * dt);
    for (const c of this.carriages) c.position.y = L.y;
    // arms swing towards where they are set
    for (const a of this.arms) {
      const u = a.userData;
      const want = u.target ? u.aim ?? 0 : u.sz * u.sx * 1.35;
      a.rotation.y += (want - a.rotation.y) * Math.min(1, dt * 3);
      a.scale.x += ((u.target ? u.ext ?? 1 : 1) - a.scale.x) * Math.min(1, dt * 3);
    }
    // the roller door
    const dy = this.rollerDoor * (DOOR.h - 0.1);
    this.door.children.forEach((m) => { if (m.geometry?.parameters?.height === DOOR.h) m.position.y = DOOR.h / 2 + dy; });
    void car;
  }

  /** Where a car's jacking points are in the world, when it stands in the bay (4 of them). */
  jackingPoints(spec) {
    const d = spec.dims, hw = d.width / 2 - 0.13, jz = d.wheelbase / 2 - 0.42;
    // car frame (+Z forward, +X left) to the world (car facing north): x' = -x, z' = -z
    return [[hw, jz], [-hw, jz], [hw, -jz], [-hw, -jz]].map(([x, z]) => new Vector3(BAY.x - x, 0, BAY.z - z));
  }

  /** The arm (0..3) that reaches a jacking point: its index and the swing angle that puts its pad there. */
  aimArm(i, spec) {
    const a = this.arms[i], u = a.userData;
    const pts = this.jackingPoints(spec);
    const pivot = new Vector3(); a.getWorldPosition(pivot);
    // the arm's own jacking point: same side (sx), same end (sz: -1 front of the car = world north)
    const p = pts.find((q) => Math.sign(q.x - BAY.x) === u.sx && Math.sign(q.z - BAY.z) === u.sz) ?? pts[i];
    const dx = p.x - pivot.x, dz = p.z - pivot.z;
    const reach = Math.hypot(dx, dz);
    // the pad sits at (-sx·len, 0, 0) in the arm's frame; turned by θ about Y it lands at (-sx·len·cosθ, sx·len·sinθ)
    u.aim = Math.atan2(u.sx * dz, -u.sx * dx);
    // the arms telescope: each reaches from 0.6 m to 1.45 m out from its pivot
    u.ext = Math.max(0.6, Math.min(1.45, reach)) / u.len;
    return { reach, ok: reach > 0.6 && reach < 1.45 };
  }
}
