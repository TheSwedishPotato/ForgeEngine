/**
 * The inside of the pressure hull: the shell and its frames (a T-bar ring every 24 or 30 inches,
 * as the frame spacing table has it), the eight compartments' bulkheads with their oval
 * watertight doors (20" x 38", eight dogs, a sill a foot and more above the deck), the walking
 * deck (tread plate in the machinery spaces, linoleum where men live), the conning tower over the
 * control room, the pump room under it, the lamps along the overhead, and the trunk up from the
 * crew's mess into the observation deck.
 *
 * Everything in boat coordinates (metres: x forward of frame 66 1/2, y above the keel, z to
 * starboard). The doors swing with their controls' values.
 */
import { Group, Mesh, MeshStandardMaterial, Color, Vector3, CylinderGeometry, SphereGeometry, DoubleSide } from 'three';
import { Builder } from '../../../gotthard-pullman/src/render/geom.js';
import { DECK, AXIS, R_HULL, LEVELS, LADDERS, DOOR_LIST, hullRadiusAt, compartmentAt } from '../data/layout.js';
import { COMPARTMENTS, CONNING_TOWER, HATCHES, HULL, FT, IN, frameX, frameInches } from '../data/boat.js';
import { OBS_DECK } from '../physics/mass.js';
import { canvasTex } from './hullGL.js';

const V = (x, y, z) => new Vector3(x, y, z);
const XF = COMPARTMENTS[0].x0, XA = COMPARTMENTS[COMPARTMENTS.length - 1].x1;
const DOOR = { w: 20 * IN, h: 38 * IN, sill: 0.33 };

export function interiorMaterials() {
  const tread = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6a6c6e'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) {
      g.fillStyle = '#7d7f82'; g.save(); g.translate(x + 8, y + 8); g.rotate((((x + y) / 16) % 2 ? 1 : -1) * 0.7); g.fillRect(-6, -1.5, 12, 3); g.restore();
    }
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(20,18,15,${Math.random() * 0.1})`; g.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 20, 1 + Math.random() * 2); }
  });
  const lino = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3f4a40'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
    for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '120,130,120'},${Math.random() * 0.06})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  });
  return {
    paint: new MeshStandardMaterial({ color: new Color('#dcdad0'), roughness: 0.6 }),
    paintLow: new MeshStandardMaterial({ color: new Color('#9fa39b'), roughness: 0.65 }),
    frame: new MeshStandardMaterial({ color: new Color('#d2d0c6'), roughness: 0.6, side: DoubleSide }),
    tread: new MeshStandardMaterial({ map: tread, roughness: 0.45, metalness: 0.6 }),
    lino: new MeshStandardMaterial({ map: lino, roughness: 0.55 }),
    doorPaint: new MeshStandardMaterial({ color: new Color('#c9c7bd'), roughness: 0.55, side: DoubleSide }),
    paintDS: new MeshStandardMaterial({ color: new Color('#dcdad0'), roughness: 0.6, side: DoubleSide }),
    steel: new MeshStandardMaterial({ color: new Color(0.45, 0.46, 0.47), roughness: 0.35, metalness: 1.0 }),
    brass: new MeshStandardMaterial({ color: new Color(0.78, 0.6, 0.3), roughness: 0.28, metalness: 1.0 }),
    lamp: new MeshStandardMaterial({ color: new Color(1, 0.95, 0.85), emissive: new Color(1, 0.88, 0.66), emissiveIntensity: 0.6, roughness: 0.3 }),
    lampRed: new MeshStandardMaterial({ color: new Color(0.6, 0.1, 0.08), emissive: new Color(1, 0.12, 0.06), emissiveIntensity: 0.35, roughness: 0.3 }),
    dark: new MeshStandardMaterial({ color: new Color('#141516'), roughness: 0.7 }),
    rail: new MeshStandardMaterial({ color: new Color('#8a8c8e'), roughness: 0.35, metalness: 0.8, side: DoubleSide }),
    carpet: new MeshStandardMaterial({ color: new Color('#26313d'), roughness: 0.95 }),
    teak: new MeshStandardMaterial({ color: new Color('#6b4a2e'), roughness: 0.45 }),
    leather: new MeshStandardMaterial({ color: new Color('#5a2e22'), roughness: 0.5 }),
  };
}

/** Floor material by compartment: tread plate in the machinery spaces, linoleum where men live. */
const FLOOR = { ftr: 'tread', fbr: 'lino', cr: 'tread', abr: 'lino', fer: 'tread', aer: 'tread', man: 'tread', atr: 'tread' };

export class InteriorGL {
  constructor(mats) {
    this.m = mats;
    const b = new Builder();
    this._shell(b);
    this._frames(b);
    this._decks(b);
    this._bulkheads(b);
    this._conningTower(b);
    this._pumpRoom(b);
    this._trunkAndDeck(b);
    this._ladders(b);
    this.group = b.build(mats);
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this._doors();
    this._lamps();
  }

  /** The pressure hull's inside, seen from within (normals inward), white above the deck. */
  _shell(b) {
    const n = 40;
    const xs = [];
    for (let x = XA; x < XF; x += 0.6) xs.push(x);
    xs.push(XF);
    for (let i = 0; i < xs.length - 1; i++) {
      const xa = xs[i], xb = xs[i + 1], ra = hullRadiusAt(xa), rb = hullRadiusAt(xb);
      for (let j = 0; j < n; j++) {
        const t0 = (j / n) * Math.PI * 2, t1 = ((j + 1) / n) * Math.PI * 2;
        const p = (x, r, t) => V(x, AXIS + r * Math.sin(t), r * Math.cos(t));
        const low = Math.sin((t0 + t1) / 2) * R_HULL + AXIS < DECK;
        const part = low ? 'paintLow' : 'paint';
        const a = p(xa, ra, t0), bb = p(xb, rb, t0), c = p(xb, rb, t1), d = p(xa, ra, t1);
        const na = V(0, -Math.sin(t0), -Math.cos(t0)), nb = V(0, -Math.sin(t1), -Math.cos(t1));
        const pp = b.part(part);
        const uv = [0, 0];
        for (const [v, nn] of [[a, na], [c, nb], [bb, na], [a, na], [d, nb], [c, nb]]) b._push(pp, v, nn, uv[0], uv[1], null);
      }
    }
  }

  /** A T-bar ring at every frame. */
  _frames(b) {
    for (let f = 1; f <= 138; f++) {
      const x = frameX(f);
      if (x > XF - 0.05 || x < XA + 0.05) continue;
      const r = hullRadiusAt(x), n = 36, d = 0.11, w = 0.012;
      for (let j = 0; j < n; j++) {
        const t0 = (j / n) * Math.PI * 2, t1 = ((j + 1) / n) * Math.PI * 2;
        const p = (rr, t, dx) => V(x + dx, AXIS + rr * Math.sin(t), rr * Math.cos(t));
        if ((Math.sin(t0) * r + AXIS) < DECK - 0.1 && (Math.sin(t1) * r + AXIS) < DECK - 0.1) continue;
        b.quad('frame', p(r, t0, w), p(r, t1, w), p(r - d, t1, w), p(r - d, t0, w));
        b.quad('frame', p(r - d, t0, -w), p(r - d, t1, -w), p(r, t1, -w), p(r, t0, -w));
        b.quad('frame', p(r - d, t0, w), p(r - d, t1, w), p(r - d, t1, -w), p(r - d, t0, -w));
      }
    }
  }

  /** The walking deck: across the hull at DECK, its edges meeting the shell. */
  _decks(b) {
    for (const c of COMPARTMENTS) {
      const mat = FLOOR[c.id] ?? 'tread';
      const xs = [];
      for (let x = c.x1; x < c.x0; x += 0.5) xs.push(x);
      xs.push(c.x0);
      for (let i = 0; i < xs.length - 1; i++) {
        const xa = xs[i], xb = xs[i + 1];
        const half = (x) => Math.sqrt(Math.max(0, hullRadiusAt(x) ** 2 - (DECK - AXIS) ** 2));
        // the control room's deck has the pump room's hatch; the engine rooms' are gratings round the engines
        b.quad(mat, V(xa, DECK, half(xa)), V(xb, DECK, half(xb)), V(xb, DECK, -half(xb)), V(xa, DECK, -half(xa)), [xa, half(xa), xb, -half(xb)]);
      }
    }
  }

  /** The bulkheads: a disc with the door's oval cut out, its coaming and dogs. */
  _bulkheads(b) {
    const ends = [{ x: XF, door: false, face: -1 }, { x: XA, door: false, face: 1 }];
    for (const d of DOOR_LIST) ends.push({ x: d.x, door: true, both: true });
    for (const e of ends) {
      const r = hullRadiusAt(e.x) + 0.02, cy = DECK + DOOR.sill + DOOR.h / 2;
      const n = 64, thick = 0.012;
      for (const side of e.both ? [1, -1] : [e.face]) {
        const x = e.x + side * thick;
        for (let j = 0; j < n; j++) {
          const t0 = (j / n) * Math.PI * 2, t1 = ((j + 1) / n) * Math.PI * 2;
          // from the door's centre: the oval's edge (or a point) out to the hull circle
          const inner = (t) => e.door ? [Math.cos(t) * DOOR.w / 2 * 1.02, cy + Math.sin(t) * DOOR.h / 2 * 1.02] : [0, AXIS];
          const outer = (t) => {
            const oy = e.door ? cy : AXIS;
            const dz = Math.cos(t), dy = Math.sin(t);
            // ray from (0, oy) along (dz, dy) to the circle round (0, AXIS) radius r
            const by = oy - AXIS, B = by * dy, C = by * by - r * r;
            const s = -B + Math.sqrt(B * B - C);
            return [dz * s, oy + dy * s];
          };
          const [zi0, yi0] = inner(t0), [zi1, yi1] = inner(t1), [zo0, yo0] = outer(t0), [zo1, yo1] = outer(t1);
          const part = ((yo0 + yo1) / 2 < DECK + 1.0 && (yi0 + yi1) / 2 < DECK + 1.0) ? 'paintLow' : 'paint';
          const a = V(x, yi0, zi0), bb = V(x, yi1, zi1), c = V(x, yo1, zo1), d = V(x, yo0, zo0);
          if (side > 0) b.quad(part, a, bb, c, d); else b.quad(part, a, d, c, bb);
        }
        if (e.door) {
          // the coaming round the opening
          for (let j = 0; j < n; j++) {
            const t0 = (j / n) * Math.PI * 2, t1 = ((j + 1) / n) * Math.PI * 2;
            const p = (t, s, dx) => V(e.x + dx, cy + Math.sin(t) * DOOR.h / 2 * s, Math.cos(t) * DOOR.w / 2 * s);
            b.quad('doorPaint', p(t0, 1.02, -0.07), p(t1, 1.02, -0.07), p(t1, 1.02, 0.07), p(t0, 1.02, 0.07));
            b.quad('doorPaint', p(t0, 1.15, side * 0.07), p(t1, 1.15, side * 0.07), p(t1, 1.02, side * 0.07), p(t0, 1.02, side * 0.07));
          }
        }
      }
    }
  }

  /** The conning tower: a cylinder on its side above the control room, its deck, the hatches. */
  _conningTower(b) {
    const ct = CONNING_TOWER, R = ct.innerDia / 2, ay = ct.kg * FT, n = 32;
    for (let j = 0; j < n; j++) {
      const t0 = (j / n) * Math.PI * 2, t1 = ((j + 1) / n) * Math.PI * 2;
      const p = (x, t) => V(x, ay + R * Math.sin(t), R * Math.cos(t));
      const na = V(0, -Math.sin(t0), -Math.cos(t0)), nb = V(0, -Math.sin(t1), -Math.cos(t1));
      const pp = b.part('paint');
      for (const [v, nn] of [[p(ct.x1, t0), na], [p(ct.x0, t1), nb], [p(ct.x0, t0), na], [p(ct.x1, t0), na], [p(ct.x1, t1), nb], [p(ct.x0, t1), nb]]) b._push(pp, v, nn, 0, 0, null);
      // the end bulkheads (dished heads, drawn flat)
      b.tri('paint', V(ct.x0, ay, 0), p(ct.x0, t0), p(ct.x0, t1));
      b.tri('paint', V(ct.x1, ay, 0), p(ct.x1, t1), p(ct.x1, t0));
    }
    const fy = LEVELS.ct.y, half = Math.sqrt(R * R - (fy - ay) ** 2);
    b.quad('tread', V(ct.x1, fy, half), V(ct.x0, fy, half), V(ct.x0, fy, -half), V(ct.x1, fy, -half), [ct.x1, half, ct.x0, -half]);
  }

  /** The pump room under the control room: its deck, and the deck above it seen from below. */
  _pumpRoom(b) {
    const L = LEVELS.pump, y = L.y;
    const half = Math.sqrt(Math.max(0, (R_HULL - 0.2) ** 2 - (y - AXIS) ** 2));
    b.quad('tread', V(L.x0, y, half), V(L.x1, y, half), V(L.x1, y, -half), V(L.x0, y, -half), [L.x0, half, L.x1, -half]);
    // the underside of the control room's deck
    const hd = Math.sqrt(Math.max(0, (R_HULL - 0.2) ** 2 - (DECK - AXIS) ** 2));
    b.quad('paintLow', V(L.x0, DECK - 0.02, -hd), V(L.x1, DECK - 0.02, -hd), V(L.x1, DECK - 0.02, hd), V(L.x0, DECK - 0.02, hd));
    // its end bulkheads below the deck
    for (const [x, s] of [[L.x0, 1], [L.x1, -1]]) {
      const n = 20;
      for (let j = 0; j < n; j++) {
        const t0 = Math.PI + (j / n) * Math.PI, t1 = Math.PI + ((j + 1) / n) * Math.PI;
        const r = R_HULL - 0.2;
        const p = (t) => V(x, Math.min(DECK, AXIS + r * Math.sin(t)), r * Math.cos(t));
        if (s > 0) b.tri('paintLow', V(x, DECK, 0), p(t1), p(t0)); else b.tri('paintLow', V(x, DECK, 0), p(t0), p(t1));
      }
    }
  }

  /** The trunk from the crew's mess up through the old galley hatch into the observation deck, and its floor. */
  _trunkAndDeck(b) {
    const h = HATCHES.find((q) => q.id === 'galley'), D = OBS_DECK;
    const y0 = AXIS + hullRadiusAt(h.x) - 0.05, y1 = LEVELS.obs.y;
    b.cylinder('paintDS', V(h.x, y1, 0), V(h.x, y0, 0), 0.42, 0.42, { segs: 20, open: true });
    // the observation deck's floor: a flat deck across the capsule, carpeted, with the trunk's opening
    const fy = LEVELS.obs.y, half = Math.sqrt(D.rIn ** 2 - (fy - D.axisY) ** 2) - 0.02;
    const x0 = D.x - D.length / 2 - D.rIn * 0.6, x1 = D.x + D.length / 2 + D.rIn * 0.6;
    const hx0 = h.x - 0.45, hx1 = h.x + 0.45;
    b.quad('carpet', V(x0, fy, half), V(hx0, fy, half), V(hx0, fy, -half), V(x0, fy, -half), [x0, half, hx0, -half]);
    b.quad('carpet', V(hx1, fy, half), V(x1, fy, half), V(x1, fy, -half), V(hx1, fy, -half), [hx1, half, x1, -half]);
    b.quad('carpet', V(hx0, fy, half), V(hx1, fy, half), V(hx1, fy, 0.45), V(hx0, fy, 0.45));
    b.quad('carpet', V(hx0, fy, -0.45), V(hx1, fy, -0.45), V(hx1, fy, -half), V(hx0, fy, -half));
    // the floor's edge and the space under it (the saddle's inside), closed off
    b.quad('teak', V(x0, fy - 0.04, half), V(x1, fy - 0.04, half), V(x1, fy, half), V(x0, fy, half));
    b.quad('teak', V(x1, fy - 0.04, -half), V(x0, fy - 0.04, -half), V(x0, fy, -half), V(x1, fy, -half));
    // a brass rail round the trunk's opening
    for (const [a, c] of [[[hx0, -0.45], [hx1, -0.45]], [[hx1, -0.45], [hx1, 0.45]], [[hx0, 0.45], [hx0, -0.45]]]) {
      b.cylinder('brass', V(a[0], fy + 0.9, a[1]), V(c[0], fy + 0.9, c[1]), 0.02, 0.02, { segs: 8 });
      b.cylinder('brass', V(a[0], fy, a[1]), V(a[0], fy + 0.9, a[1]), 0.018, 0.018, { segs: 6 });
    }
    // two armchairs facing out to each side, a low table between
    for (const s of [1, -1]) {
      for (const x of [D.x - 1.3, D.x + 0.1]) {
        b.box('leather', [x - 0.35, fy, s * 0.15 - 0.33], [x + 0.35, fy + 0.42, s * 0.15 + 0.33]);
        b.box('leather', [x - 0.35, fy + 0.42, s * 0.15 - s * 0.33 - 0.06], [x + 0.35, fy + 0.95, s * 0.15 - s * 0.33 + 0.06]);
      }
    }
    b.cylinder('teak', V(D.x - 0.6, fy + 0.45, 0), V(D.x - 0.6, fy + 0.5, 0), 0.32, 0.32, { segs: 24 });
    b.cylinder('steel', V(D.x - 0.6, fy, 0), V(D.x - 0.6, fy + 0.45, 0), 0.04, 0.04, { segs: 8 });
  }

  /** The ladders: to the conning tower, to the bridge, to the pump room, up the trunk. */
  _ladders(b) {
    const levelY = { main: DECK, ct: LEVELS.ct.y, bridge: HULL.bridgeDeck, pump: LEVELS.pump.y, obs: LEVELS.obs.y };
    for (const L of LADDERS) {
      const y0 = levelY[L.from] < levelY[L.to] ? levelY[L.from] : levelY[L.to], y1 = Math.max(levelY[L.from], levelY[L.to]);
      const x = L.x - 0.32, z = L.z;
      for (const s of [-0.22, 0.22]) b.cylinder('rail', V(x, y0, z + s), V(x, y1 + 0.9, z + s), 0.022, 0.022, { segs: 8 });
      for (let y = y0 + 0.3; y < y1 + 0.05; y += 0.3) b.cylinder('rail', V(x, y, z - 0.22), V(x, y, z + 0.22), 0.016, 0.016, { segs: 6 });
    }
  }

  /** The watertight doors, each on its hinge (opened 0..1 by its control). */
  _doors() {
    this.doors = [];
    for (const d of DOOR_LIST) {
      const hinge = new Group();
      const cy = DECK + DOOR.sill + DOOR.h / 2;
      // hinged on the starboard side of the opening, swinging aft
      hinge.position.set(d.x - 0.09, cy, DOOR.w / 2 + 0.1);
      const leaf = new Mesh(new CylinderGeometry(1, 1, 0.05, 32).rotateZ(Math.PI / 2).scale(1, DOOR.h / 2 * 1.12, DOOR.w / 2 * 1.12).translate(0, 0, -DOOR.w / 2 - 0.1), this.m.doorPaint);
      leaf.castShadow = true;
      hinge.add(leaf);
      // the dogs' handwheel in the middle
      const wheel = new Mesh(new CylinderGeometry(0.09, 0.09, 0.03, 16).rotateZ(Math.PI / 2).translate(-0.05, 0, -DOOR.w / 2 - 0.1), this.m.steel);
      hinge.add(wheel);
      this.group.add(hinge);
      this.doors.push({ d, hinge });
    }
  }

  /** The overhead lamps of every space (their light is the lighting pass's; these are the bulbs you see). */
  _lamps() {
    const geo = new SphereGeometry(0.055, 12, 8);
    const shade = new CylinderGeometry(0.03, 0.11, 0.07, 14, 1, true);
    this.lamps = [];
    const rows = [];
    for (const c of COMPARTMENTS) rows.push({ id: c.id, x0: c.x0, x1: c.x1, y: DECK + 2.12 });
    rows.push({ id: 'ct', x0: CONNING_TOWER.x0, x1: CONNING_TOWER.x1, y: LEVELS.ct.y + 1.95 });
    rows.push({ id: 'pump', x0: LEVELS.pump.x1, x1: LEVELS.pump.x0, y: LEVELS.pump.y + 2.0 });
    for (const r of rows) {
      const sp = 2.3, n = Math.floor((r.x0 - r.x1) / sp + 1e-6);
      for (let i = 0; i <= n; i++) {
        const x = r.x1 + (i + 0.5) * sp;
        if (x > r.x0) continue;
        for (const z of [-0.42, 0.42]) {
          const bulb = new Mesh(geo, this.m.lamp);
          bulb.position.set(x, r.y, z);
          const s = new Mesh(shade, this.m.steel);
          s.position.set(x, r.y + 0.05, z);
          this.group.add(bulb, s);
          this.lamps.push({ id: r.id, bulb });
        }
      }
    }
  }

  /** Swings the doors and sets the lamps' colour (white or rigged for red; dark without power). */
  update(plant) {
    for (const q of this.doors) q.hinge.rotation.y = -Math.min(1, Math.max(0, +plant.ctl[`door.${q.d.i}`] || 0)) * 1.75;
    const red = plant.ctl['cr.lights'] === 'red', power = plant.g.power !== false;
    for (const L of this.lamps) {
      const isRed = red && (L.id === 'cr' || L.id === 'ct');
      L.bulb.material = isRed ? this.m.lampRed : this.m.lamp;
      L.bulb.visible = power;
    }
  }
}

export { DOOR, FLOOR, XF, XA, compartmentAt, frameInches };
