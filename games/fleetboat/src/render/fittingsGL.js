/**
 * What fills the compartments, after the photographs and arrangement drawings in Fleet Type
 * Submarine (NavPers 16160, chapter 3) and the General Information Book: positions are estimates
 * within each space, sizes from the class's equipment where the books give them.
 *
 *  Forward torpedo room  six tube breeches in the forward bulkhead, reload racks (two display
 *                        torpedoes kept), three-tier bunks over them, the escape trunk overhead.
 *  Forward battery       officers' country: staterooms each side of the passage with their
 *                        bunks and desks, the wardroom table; the battery well under the deck.
 *  Control room          the diving station (the planes' wheels, the depth gauges, the bubble,
 *                        the Christmas tree), the hydraulic manifold, the trim manifold and its
 *                        tank gauges, the air manifolds, the steering stand and gyro, the chart
 *                        table, the periscope wells, the radio room in the after starboard corner.
 *  Pump room             the trim pump, the drain pump, the IMO pumps, the compressors.
 *  After battery         the galley, the crew's mess (four tables), the crew's berthing in
 *                        three tiers, the trunk up to the observation deck.
 *  Engine rooms          two Fairbanks-Morse 38D 8-1/8 each side by side, their generators
 *                        abaft them, the walkway between.
 *  Maneuvering room      the main propulsion control cubicle across the room.
 *  After torpedo room    four tube breeches, bunks.
 *  Conning tower         the helm, the two periscopes, the torpedo data computer.
 */
import { MeshStandardMaterial, Color, Vector3, DoubleSide } from 'three';
import { Builder } from '../../../gotthard-pullman/src/render/geom.js';
import { DECK, AXIS, LEVELS, hullRadiusAt, onWall, halfWidth } from '../data/layout.js';
import { COMPARTMENTS, CONNING_TOWER, HATCHES, FT, IN, frameX } from '../data/boat.js';
import { canvasTex } from './hullGL.js';

const V = (x, y, z) => new Vector3(x, y, z);
const C = Object.fromEntries(COMPARTMENTS.map((c) => [c.id, c]));
const D = DECK;

export function fittingMaterials() {
  const mattress = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#7d8a93'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(40,50,60,0.35)'; g.lineWidth = 3;
    for (let x = 8; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  });
  const blanket = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#4a4f3c'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(20,20,10,0.25)'; for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1);
  });
  return {
    paint: new MeshStandardMaterial({ color: new Color('#d8d6cc'), roughness: 0.6 }),
    grey: new MeshStandardMaterial({ color: new Color('#7b8084'), roughness: 0.5, metalness: 0.4 }),
    darkGrey: new MeshStandardMaterial({ color: new Color('#3e4347'), roughness: 0.5, metalness: 0.4 }),
    engine: new MeshStandardMaterial({ color: new Color('#6f7a76'), roughness: 0.45, metalness: 0.5 }),
    steel: new MeshStandardMaterial({ color: new Color(0.5, 0.51, 0.52), roughness: 0.3, metalness: 1.0 }),
    brass: new MeshStandardMaterial({ color: new Color(0.78, 0.6, 0.3), roughness: 0.28, metalness: 1.0 }),
    bronze: new MeshStandardMaterial({ color: new Color(0.55, 0.38, 0.2), roughness: 0.35, metalness: 1.0 }),
    wood: new MeshStandardMaterial({ color: new Color('#6a4a2c'), roughness: 0.5 }),
    formica: new MeshStandardMaterial({ color: new Color('#9a9488'), roughness: 0.35 }),
    mattress: new MeshStandardMaterial({ map: mattress, roughness: 0.9 }),
    blanket: new MeshStandardMaterial({ map: blanket, roughness: 0.95 }),
    black: new MeshStandardMaterial({ color: new Color('#141516'), roughness: 0.5 }),
    red: new MeshStandardMaterial({ color: new Color('#8e1b16'), roughness: 0.45 }),
    green: new MeshStandardMaterial({ color: new Color('#3f5b44'), roughness: 0.55 }),
    torpedo: new MeshStandardMaterial({ color: new Color('#2d3133'), roughness: 0.4, metalness: 0.5 }),
    warhead: new MeshStandardMaterial({ color: new Color('#8d8f7a'), roughness: 0.5, metalness: 0.3 }),
    curtain: new MeshStandardMaterial({ color: new Color('#5c6a5e'), roughness: 0.9, side: DoubleSide }),
    pipeRed: new MeshStandardMaterial({ color: new Color('#7a2a22'), roughness: 0.5, metalness: 0.3 }),
    pipeBlue: new MeshStandardMaterial({ color: new Color('#2f4a66'), roughness: 0.5, metalness: 0.3 }),
    pipeGreen: new MeshStandardMaterial({ color: new Color('#466246'), roughness: 0.5, metalness: 0.3 }),
    cable: new MeshStandardMaterial({ color: new Color('#2a2a28'), roughness: 0.7 }),
    glass: new MeshStandardMaterial({ color: new Color(0.05, 0.06, 0.065), roughness: 0.05 }),
    stainless: new MeshStandardMaterial({ color: new Color(0.7, 0.71, 0.72), roughness: 0.25, metalness: 1.0 }),
  };
}

/** Half-breadth of the hull's inside at height y and station x. */
function halfAt(x, y) { const r = hullRadiusAt(x) - 0.12; return Math.sqrt(Math.max(0, r * r - (y - AXIS) ** 2)); }

export class FittingsGL {
  constructor(M) {
    this.M = M;
    const b = (this.b = new Builder());
    this.torpedoRoom(C.ftr, 1);
    this.torpedoRoom(C.atr, -1);
    this.officers();
    this.controlRoom();
    this.pumpRoom();
    this.afterBattery();
    this.engineRoom(C.fer, [1, 2]);
    this.engineRoom(C.aer, [3, 4]);
    this.maneuvering();
    this.conningTower();
    this.observationConsole();
    this.overhead();
    this.group = b.build(M);
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  /** A board on the hull's side between heights y0 and y1, following the plating's curve (inset in from it, thick deep). */
  wallBoard(part, x0, x1, y0, y1, side, { inset = 0.12, thick = 0.05, n = 8 } = {}) {
    const rows = [];
    for (let i = 0; i <= n; i++) {
      const y = y0 + (y1 - y0) * (i / n);
      const a = onWall(x0, y, side, inset), b = onWall(x0, y, side, inset + thick);
      rows.push({ out: a.pos, inn: b.pos });
    }
    const P = (p, x) => V(x, p[1], p[2]);
    for (let i = 0; i < n; i++) {
      const r0 = rows[i], r1 = rows[i + 1];
      // the face toward the room
      const a = P(r0.inn, x0), bb = P(r0.inn, x1), c = P(r1.inn, x1), d = P(r1.inn, x0);
      if (side < 0) this.b.quad(part, a, bb, c, d); else this.b.quad(part, bb, a, d, c);
      // its ends
      if (side < 0) { this.b.quad(part, P(r0.out, x0), P(r0.inn, x0), P(r1.inn, x0), P(r1.out, x0)); this.b.quad(part, P(r0.inn, x1), P(r0.out, x1), P(r1.out, x1), P(r1.inn, x1)); }
      else { this.b.quad(part, P(r0.inn, x0), P(r0.out, x0), P(r1.out, x0), P(r1.inn, x0)); this.b.quad(part, P(r0.out, x1), P(r0.inn, x1), P(r1.inn, x1), P(r1.out, x1)); }
    }
    const top = rows[n], bot = rows[0];
    this.box(part, x0, top.inn[1] - 0.005, Math.min(top.inn[2], top.out[2]), x1, top.inn[1] + 0.005, Math.max(top.inn[2], top.out[2]));
    void bot;
  }

  /** A cabinet standing on the deck against the hull's side: its front at |z| = zin, its back the hull. */
  wallCabinet(part, x0, x1, y1, side, zin) {
    const y0 = D, n = 8;
    const prof = [];
    for (let i = 0; i <= n; i++) {
      const y = y0 + (y1 - y0) * (i / n);
      prof.push([y, Math.max(Math.abs(zin) + 0.02, halfWidth((x0 + x1) / 2, y) - 0.04)]);
    }
    for (let i = 0; i < n; i++) {
      const [ya, za] = prof[i], [yb, zb] = prof[i + 1];
      const zi = Math.abs(zin);
      // the front (toward the room), the ends
      const f0 = V(x0, ya, side * zi), f1 = V(x1, ya, side * zi), f2 = V(x1, yb, side * zi), f3 = V(x0, yb, side * zi);
      if (side > 0) this.b.quad(part, f1, f0, f3, f2); else this.b.quad(part, f0, f1, f2, f3);
      for (const [x, s] of [[x0, -1], [x1, 1]]) {
        const a = V(x, ya, side * zi), b2 = V(x, ya, side * za), c = V(x, yb, side * zb), d = V(x, yb, side * zi);
        if (s * side > 0) this.b.quad(part, a, b2, c, d); else this.b.quad(part, b2, a, d, c);
      }
    }
    this.box(part, x0, y1 - 0.01, Math.min(side * Math.abs(zin), side * prof[n][1]), x1, y1, Math.max(side * Math.abs(zin), side * prof[n][1]));
  }

  box(part, x0, y0, z0, x1, y1, z1) { this.b.box(part, [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)]); }
  cyl(part, a, c, r, r2 = r, segs = 14) { this.b.cylinder(part, V(...a), V(...c), r, r2, { segs }); }

  /** A tier of bunks along a side: pipe frames, canvas bottoms, mattresses, blankets. */
  bunks(x0, x1, side, tiers = 3, { y0 = D + 0.35, gap = 0.62, inboard = 0.55, depth = 0.68 } = {}) {
    const zi = side * inboard, zo = side * (inboard + depth);
    for (let t = 0; t < tiers; t++) {
      const y = y0 + t * gap;
      const zo2 = side * Math.min(Math.abs(zo), halfAt((x0 + x1) / 2, y + 0.2));
      this.box('steel', x0, y - 0.03, zi, x1, y, zo2);
      this.box('mattress', x0 + 0.02, y, zi - side * 0.01, x1 - 0.02, y + 0.1, zo2 + side * 0.01);
      this.box('blanket', x0 + 0.5, y + 0.1, zi - side * 0.01, x1 - 0.05, y + 0.13, zo2 + side * 0.01);
      this.cyl('steel', [x0, y + 0.02, zi], [x1, y + 0.02, zi], 0.018, 0.018, 6);
    }
    for (const x of [x0, x1]) this.cyl('steel', [x, D, zi], [x, y0 + tiers * gap, zi], 0.02, 0.02, 6);
  }

  // ---- torpedo rooms ---------------------------------------------------------------------------
  torpedoRoom(c, dir) {
    const end = dir > 0 ? c.x0 : c.x1, inward = -dir;
    // the tube breeches: two columns (six forward, four aft)
    const rows = dir > 0 ? [D + 0.35, D + 1.0, D + 1.65] : [D + 0.55, D + 1.3];
    for (const y of rows) for (const s of [-1, 1]) {
      const z = s * 0.52, x = end;
      this.cyl('bronze', [x, y, z], [x + inward * 1.6, y, z], 0.29, 0.29, 18);                  // the tube's after end
      this.cyl('brass', [x + inward * 1.6, y, z], [x + inward * 1.68, y, z], 0.37, 0.37, 20);    // the breech door
      this.cyl('steel', [x + inward * 1.68, y, z], [x + inward * 1.72, y, z], 0.12, 0.12, 10);
      this.box('steel', x + inward * 1.69, y - 0.02, z - s * 0.32, x + inward * 1.73, y + 0.02, z - s * 0.12);  // the breech lever
    }
    // the reload racks (two display torpedoes, forward room) and the bunks over them
    const xa = dir > 0 ? c.x1 + 0.6 : end + 2.2, xb = dir > 0 ? end - 2.0 : c.x0 - 0.6;
    if (dir > 0) for (const s of [-1, 1]) {
      const z = s * 1.18, y = D + 0.3;
      this.cyl('torpedo', [xa + 0.4, y, z], [xa + 0.4 + 5.6, y, z], 0.265, 0.265, 18);
      this.cyl('warhead', [xa + 6.0, y, z], [xa + 6.6, y, z], 0.265, 0.08, 18);
      this.box('steel', xa + 0.3, D, z - 0.3, xa + 6.4, D + 0.05, z + 0.3);
    }
    for (const s of [-1, 1]) this.bunks(xa + 0.2, Math.min(xa + 2.1, xb), s, 3, { y0: D + 0.75, gap: 0.55, inboard: 0.62 });
    for (const s of [-1, 1]) this.bunks(Math.min(xa + 2.2, xb - 1.9), xb, s, 3, { y0: D + 0.75, gap: 0.55, inboard: 0.62 });
    // the escape trunk's lower end and its ladder (forward), the loading hatch's skid
    const esc = HATCHES.find((h) => h.id === (dir > 0 ? 'escFwd' : 'escAft'));
    this.cyl('paint', [esc.x, AXIS + hullRadiusAt(esc.x) - 0.2, 0], [esc.x, AXIS + hullRadiusAt(esc.x) + 0.15, 0], 0.48, 0.48, 18);
    // the loading rail along the overhead
    this.cyl('steel', [c.x1 + 0.4, D + 2.1, 0], [c.x0 - 0.4, D + 2.1, 0], 0.03, 0.03, 6);
  }

  // ---- officers' country -----------------------------------------------------------------------
  officers() {
    const c = C.fbr, M = 0.45;
    // partitions either side of the passage, with the staterooms' openings (curtained)
    const rooms = [c.x0 - 0.3, c.x0 - 2.3, c.x0 - 4.3, c.x0 - 6.1, c.x1 + 0.3];
    for (const s of [-1, 1]) {
      for (let i = 0; i < rooms.length - 1; i++) {
        const xa = rooms[i + 1], xb = rooms[i];
        // the wall along the passage, an opening near its forward end
        this.box('formica', xa, D, s * M, xb - 0.8, D + 2.0, s * (M + 0.03));
        this.box('curtain', xb - 0.8, D + 0.05, s * (M + 0.01), xb - 0.1, D + 1.95, s * (M + 0.02));
        this.box('formica', xb - 0.1, D, s * M, xb, D + 2.0, s * (M + 0.03));
        // the athwartship wall between rooms
        this.box('formica', xa - 0.015, D, s * M, xa + 0.015, D + 2.0, s * halfAt(xa, D + 1.0));
        // the bunks (two, one over the other), a desk with a fold-down top, a locker
        this.bunks(xa + 0.05, xa + 1.95, s, 2, { y0: D + 0.45, gap: 0.8, inboard: M + 0.75, depth: 0.7 });
        this.box('wood', xa + 0.1, D, s * (M + 0.05), xa + 0.6, D + 0.75, s * (M + 0.55));
        this.box('wood', xa + 0.1, D + 0.75, s * (M + 0.05), xa + 0.65, D + 0.78, s * (M + 0.6));
      }
    }
    // the wardroom table in the after port room
    this.box('green', c.x1 + 0.6, D + 0.72, -M - 0.2, c.x1 + 1.8, D + 0.76, -M - 1.1);
    this.box('wood', c.x1 + 1.1, D, -M - 0.6, c.x1 + 1.3, D + 0.72, -M - 0.7);
  }

  // ---- control room ----------------------------------------------------------------------------
  controlRoom() {
    const c = C.cr, P = -1.82, S = 1.82;
    // the diving station: the planes' columns (their wheels are controls), the depth gauges' board above
    this.box('darkGrey', 11.0, D, -1.62, 12.2, D + 0.8, -1.35);
    this.wallBoard('darkGrey', 10.75, 12.4, D + 1.25, D + 2.2, -1);
    for (const x of [11.95, 11.10]) {
      this.cyl('darkGrey', [x, D + 1.05, -1.6], [x, D + 1.05, -1.45], 0.06, 0.06, 10);
      this.box('black', x - 0.18, D, -0.95, x + 0.18, D + 0.45, -0.75);         // the planesmen's stools
      this.cyl('steel', [x, D, -0.85], [x, D + 0.42, -0.85], 0.03, 0.03, 6);
    }
    // the Christmas tree (hull opening indicator) over the hydraulic manifold
    this.wallBoard('darkGrey', 12.45, 13.4, D + 1.55, D + 2.05, -1);
    // the hydraulic manifold's frame and its oil tank
    this.wallBoard('darkGrey', 12.25, 13.35, D + 0.8, D + 1.35, -1, { thick: 0.14 });
    this.cyl('grey', [13.55, D, -1.5], [13.55, D + 1.1, -1.5], 0.22, 0.22, 16);
    // the trim manifold's frame, the tank gauges over it
    this.wallBoard('darkGrey', 9.25, 10.7, D + 0.8, D + 1.4, -1, { thick: 0.12 });
    this.wallBoard('darkGrey', 9.25, 10.7, D + 1.55, D + 2.05, -1);
    // starboard: the I.C. switchboard, the high-pressure manifold, the 600-lb and 10-lb manifolds
    this.wallCabinet('grey', 13.0, 13.85, D + 1.95, 1, 1.45);
    this.wallBoard('darkGrey', 11.7, 12.95, D + 0.9, D + 1.8, 1, { thick: 0.12 });
    this.wallBoard('darkGrey', 10.55, 11.45, D + 0.95, D + 1.4, 1, { thick: 0.12 });
    this.wallBoard('darkGrey', 9.6, 10.55, D + 0.85, D + 1.3, 1, { thick: 0.12 });
    // air pressure gauges board over the manifolds
    this.wallBoard('darkGrey', 9.6, 12.95, D + 1.82, D + 2.2, 1);
    // the steering stand and the master gyro (forward, centreline), the chart table (starboard forward)
    this.box('grey', 13.15, D, 0.25, 13.5, D + 1.0, 0.65);
    this.cyl('grey', [13.6, D, -0.4], [13.6, D + 0.95, -0.4], 0.32, 0.36, 18);
    this.b.lathe?.('grey', V(13.6, D + 0.95, -0.4), V(0, 1, 0), [[0.36, 0], [0.38, 0.2], [0.3, 0.45], [0, 0.55]], { segs: 18 });
    this.box('wood', 12.2, D + 0.95, 0.75, 13.0, D + 1.0, 1.45);
    this.box('darkGrey', 12.2, D, 0.8, 13.0, D + 0.95, 1.4);
    // the periscope wells: the two tubes down through the room
    for (const x of [10.85, 9.75]) this.cyl('steel', [x, D, 0.35], [x, D + 2.5, 0.35], 0.11, 0.11, 14);
    // the radio room in the after starboard corner
    this.box('formica', c.x1 + 1.9, D, 0.7, c.x1 + 1.95, D + 2.0, 1.95);
    this.box('formica', c.x1 + 0.05, D, 0.68, c.x1 + 1.3, D + 2.0, 0.72);
    for (let i = 0; i < 3; i++) this.wallCabinet('darkGrey', c.x1 + 0.15 + i * 0.55, c.x1 + 0.65 + i * 0.55, D + 1.6, 1, 1.5);
    this.box('wood', c.x1 + 0.15, D + 0.72, 1.2, c.x1 + 1.8, D + 0.75, 1.95);
    // the deck's hatch to the pump room: a coaming round the opening
    const px = 8.08, pz = 0.55;
    for (const [a, bb] of [[[px - 0.35, pz - 0.35], [px + 0.35, pz - 0.35]], [[px - 0.35, pz + 0.35], [px + 0.35, pz + 0.35]], [[px - 0.35, pz - 0.35], [px - 0.35, pz + 0.35]], [[px + 0.35, pz - 0.35], [px + 0.35, pz + 0.35]]]) {
      this.box('steel', Math.min(a[0], bb[0]) - 0.02, D, Math.min(a[1], bb[1]) - 0.02, Math.max(a[0], bb[0]) + 0.02, D + 0.06, Math.max(a[1], bb[1]) + 0.02);
    }
    void P;
  }

  pumpRoom() {
    const y = LEVELS.pump.y;
    // the trim pump (port, aft), the drain pump (starboard), the IMO pumps (port forward), the compressors (starboard)
    this.cyl('grey', [8.2, y, -1.0], [8.2, y + 0.9, -1.0], 0.35, 0.35, 18);
    this.cyl('grey', [8.7, y + 0.5, -1.0], [9.5, y + 0.5, -1.0], 0.22, 0.22, 14);
    this.box('grey', 9.4, y, 0.7, 10.3, y + 0.7, 1.3);
    for (const x of [11.8, 12.4]) { this.box('engine', x - 0.25, y, -1.2, x + 0.25, y + 0.55, -0.7); this.cyl('grey', [x, y + 0.55, -0.95], [x, y + 0.95, -0.95], 0.14, 0.14, 12); }
    for (const x of [10.4, 11.0]) { this.box('engine', x - 0.28, y, 0.65, x + 0.28, y + 0.8, 1.25); this.cyl('grey', [x, y + 0.8, 0.95], [x, y + 1.15, 0.95], 0.18, 0.18, 12); }
    // the accumulator, the air flasks' manifold piping
    this.cyl('grey', [12.9, y, 0.9], [12.9, y + 1.6, 0.9], 0.2, 0.2, 14);
    this.cyl('pipeRed', [6.4, y + 1.7, 1.2], [13.0, y + 1.7, 1.2], 0.04, 0.04, 8);
    this.cyl('pipeGreen', [6.4, y + 1.5, -1.2], [13.0, y + 1.5, -1.2], 0.05, 0.05, 8);
  }

  // ---- after battery: galley, mess, berthing ------------------------------------------------------
  afterBattery() {
    const c = C.abr;
    const gx0 = 3.4, gx1 = c.x0 - 0.15;
    // the galley (port): the range, the ovens, the sink, the counter; the scuttlebutt
    this.wallCabinet('stainless', gx0, gx1, D + 0.9, -1, 0.6);
    this.box('black', gx0 + 0.2, D + 0.9, -1.0, gx0 + 1.2, D + 0.93, -1.75);
    this.box('stainless', gx0 + 1.3, D + 0.9, -1.0, gx1 - 0.2, D + 1.0, -1.75);
    this.wallBoard('stainless', gx0, gx1, D + 1.35, D + 2.0, -1, { thick: 0.3 });
    // the pantry and the refrigerator door (starboard)
    this.wallCabinet('stainless', gx0, gx1, D + 1.9, 1, 0.6);
    // the crew's mess: four tables with their benches (2 each side)
    for (const s of [-1, 1]) for (const x of [0.2, 2.1]) {
      this.box('formica', x - 0.75, D + 0.72, s * 0.55, x + 0.75, D + 0.76, s * 1.35);
      this.box('steel', x - 0.05, D, s * 0.9, x + 0.05, D + 0.72, s * 1.0);
      for (const dx of [-1.05, 1.05]) {
        this.box('green', x + dx - 0.18, D + 0.42, s * 0.6, x + dx + 0.18, D + 0.47, s * 1.45);
        this.box('steel', x + dx - 0.03, D, s * 0.95, x + dx + 0.03, D + 0.42, s * 1.1);
      }
    }
    // the trunk's ladder base is the interior's; berthing aft of the mess, three tiers each side
    for (const s of [-1, 1]) {
      for (let x = c.x1 + 0.3; x < -0.9; x += 2.0) this.bunks(x, x + 1.9, s, 3, { y0: D + 0.3, gap: 0.6, inboard: 0.5 });
    }
    // the washroom and showers in the after starboard corner
    this.box('formica', c.x1 + 0.1, D, 0.48, c.x1 + 1.5, D + 2.0, 0.52);
  }

  // ---- engine rooms ------------------------------------------------------------------------------
  /**
   * Two FM 38D 8-1/8 side by side: ten cylinders in line, opposed pistons, two crankshafts (the
   * upper above the deck, the lower below it: the deck runs round the engines at mid-height), a
   * blower at the forward end; the generator abaft each, half below the deck.
   */
  engineRoom(c, ids) {
    const x0 = c.x0 - 0.7, len = 4.9, glen = 1.9;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1, z = s * 1.12, n = ids[i];
      void n;
      const xe0 = x0 - len, w = 0.5;
      // the upper crankcase and the cylinder block's top, with inspection covers along it
      this.box('engine', xe0, D - 0.4, z - w, x0, D + 0.95, z + w);
      this.box('engine', xe0 + 0.1, D + 0.95, z - w * 0.8, x0 - 0.1, D + 1.35, z + w * 0.8);
      for (let k = 0; k < 10; k++) {
        const x = xe0 + 0.35 + k * (len - 0.7) / 9;
        this.box('darkGrey', x - 0.16, D + 0.25, z - s * w - s * 0.02, x + 0.16, D + 0.75, z - s * w);
        this.cyl('steel', [x, D + 1.35, z], [x, D + 1.42, z], 0.06, 0.06, 8);           // the fuel injector rocker covers
      }
      // the blower at the forward end, the exhaust manifold along the outboard side going aft overhead
      this.box('engine', x0, D - 0.2, z - 0.45, x0 + 0.55, D + 1.1, z + 0.45);
      this.cyl('darkGrey', [xe0, D + 1.2, z + s * 0.45], [x0, D + 1.2, z + s * 0.45], 0.14, 0.14, 12);
      this.cyl('darkGrey', [xe0, D + 1.2, z + s * 0.45], [c.x1 + 0.3, D + 2.0, z * 0.85], 0.13, 0.13, 12);
      // the generator abaft the engine
      this.cyl('grey', [xe0 - 0.1, D + 0.2, z], [xe0 - 0.1 - glen, D + 0.2, z], 0.72, 0.72, 24);
      this.cyl('darkGrey', [xe0 - 0.05, D + 0.2, z], [xe0 - 0.15, D + 0.2, z], 0.74, 0.74, 24);
      // the engine's gauge board at its control stand
      this.box('darkGrey', x0 + 0.05, D + 1.15, z - s * 0.55, x0 + 0.5, D + 1.75, z - s * 0.5);
    }
    // the gratings over the walkway's sides
    this.box('steel', c.x1 + 0.2, D - 0.01, -0.62, c.x0 - 0.2, D + 0.01, -0.6);
    this.box('steel', c.x1 + 0.2, D - 0.01, 0.6, c.x0 - 0.2, D + 0.01, 0.62);
    // the induction duct along the overhead, its hull valve
    this.cyl('grey', [c.x0 - 0.2, D + 2.15, 0], [c.x1 + 0.3, D + 2.15, 0], 0.3, 0.3, 18);
  }

  maneuvering() {
    const x = -28.75;
    // the cubicle: a steel cabinet across the room, its levers on the forward face (controls)
    this.box('grey', x - 0.85, D, -1.35, x - 0.05, D + 1.95, 1.35);
    this.box('darkGrey', x - 0.05, D + 0.7, -1.2, x, D + 1.2, 1.2);
    // the meter board over it
    this.box('darkGrey', x - 0.1, D + 1.25, -1.2, x - 0.02, D + 1.9, 1.2);
    // the main motors' hatches in the deck, the reduction gear casings showing at the after end
    for (const s of [-1, 1]) this.box('darkGrey', -27.3, D - 0.01, s * 0.5, -25.0, D + 0.02, s * 1.5);
    // the governor control panel and the auxiliary switchboard (starboard)
    this.wallCabinet('grey', -27.0, -25.6, D + 1.9, 1, 1.45);
    this.wallCabinet('grey', -30.0, -29.2, D + 1.95, 1, 1.4);
  }

  /** The owner's console at the observation deck's after end: a teak stand with the repeaters. */
  observationConsole() {
    const y = LEVELS.obs.y;
    this.box('wood', -3.05, y, -0.65, -2.8, y + 0.8, 0.65);
    this.box('darkGrey', -2.88, y + 0.7, -0.62, -2.82, y + 1.0, 0.62);
  }

  conningTower() {
    const ct = CONNING_TOWER, y = LEVELS.ct.y;
    // the helm's stand and the telegraphs' pedestals forward
    this.box('grey', 12.05, y, -0.2, 12.4, y + 1.0, 0.2);
    for (const z of [-0.55, 0.55]) this.cyl('brass', [12.3, y, z], [12.3, y + 1.15, z], 0.07, 0.07, 10);
    // the two periscopes, their training handles, the wells down through the floor
    for (const x of [10.85, 9.75]) {
      this.cyl('steel', [x, y - 0.3, 0.35], [x, y + 2.3, 0.35], 0.12, 0.12, 16);
      this.box('darkGrey', x - 0.2, y + 1.35, 0.25, x + 0.2, y + 1.6, 0.45);
      for (const s of [-1, 1]) this.cyl('black', [x, y + 1.45, 0.35 + s * 0.12], [x, y + 1.45, 0.35 + s * 0.4], 0.025, 0.025, 6);
    }
    // the torpedo data computer (port), the sonar and radar consoles (starboard)
    this.box('darkGrey', 8.0, y, -1.15, 10.0, y + 1.6, -0.75);
    this.box('darkGrey', 8.2, y, 0.8, 9.4, y + 1.5, 1.15);
    void ct;
  }

  /** Pipes and cable runs along the overhead of the whole boat (air red, water green, oil blue). */
  overhead() {
    const xa = COMPARTMENTS[COMPARTMENTS.length - 1].x1 + 0.2, xf = COMPARTMENTS[0].x0 - 0.2;
    const runs = [['pipeRed', 0.9, 2.05, 0.035], ['pipeGreen', -0.95, 2.0, 0.045], ['pipeBlue', 1.15, 1.95, 0.03], ['cable', -1.2, 1.95, 0.05], ['cable', 1.35, 1.85, 0.05]];
    for (const [m, z, h, r] of runs) {
      for (const cc of COMPARTMENTS) {
        const x0 = Math.max(xa, cc.x1 + 0.12), x1 = Math.min(xf, cc.x0 - 0.12);
        const zz = Math.sign(z) * Math.min(Math.abs(z), halfAt((x0 + x1) / 2, D + h) - 0.08);
        this.cyl(m, [x0, D + h, zz], [x1, D + h, zz], r, r, 8);
      }
    }
  }
}

export { halfAt, frameX, FT, IN };
