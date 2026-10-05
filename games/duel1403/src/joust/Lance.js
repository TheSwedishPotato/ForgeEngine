import { Vector3 } from 'three';
import { Body, Shape } from '../physics/index.js';
import { LanceHold, LanceStrike } from './constraints.js';
import { LANCE, LANCE_WOODS, lanceBucklingLoad, lanceBendingLimit } from '../data/joust.js';

const Y = new Vector3(0, 1, 0);
const _v = new Vector3();

/**
 * A jousting lance of painted fir with vamplate and coronel. Local +Y runs
 * from the butt to the head; the origin is its centre of mass.
 *
 * It lies in the rest on the rider's right breast and the arm turns it to
 * the aim. At the head, a LanceStrike solves the coronel against the
 * opponent and breaks the lance at its buckling load. The defect factor
 * makes every lance a little different, as every piece of wood is.
 */
export class Lance {
  constructor(world, rider, { rand = Math.random } = {}) {
    this.world = world;
    this.rider = rider;
    const wood = LANCE_WOODS[rider.saddle.wood] ?? LANCE_WOODS.fir;
    const L = { ...LANCE, ...wood, gripDiameter: LANCE.gripDiameter * wood.diameter / LANCE.diameter };
    this.def = L;
    this.wood = wood;
    const y = (u) => u - L.com;              // local Y of a point u metres from the butt
    this.y = y;
    const I = L.mass * (L.length * L.length / 12 + (L.length / 2 - L.com) ** 2);
    this.body = new Body({ name: 'lance' + rider.id, mass: L.mass, inertia: new Vector3(I, 0.004, I), angularDamping: 0.05 });
    this.body.maxSpeed = 40;
    this.shaft = Shape.capsule(0.032, L.length / 2 - 0.03, Y, new Vector3(0, y(L.length / 2), 0), {
      friction: 0.5, restitution: 0.2, collidesWithBodies: false, userData: { lanceOf: rider.id, part: 'lance', mat: 'wood' },
    });
    this.body.addShape(this.shaft);
    this.body.userData = { lanceOf: rider.id };
    world.addBody(this.body);

    const defect = L.defect[0] + (L.defect[1] - L.defect[0]) * rand();
    this.buckling = lanceBucklingLoad(L) * defect;
    this.bending = lanceBendingLimit(L) * (0.8 + 0.4 * rand());
    // How long the bowed lance holds before the fibres go: a few milliseconds, longer for sound wood.
    this.bowTime = L.bowTime[0] + (L.bowTime[1] - L.bowTime[0]) * defect * rand();
    this.tipLocal = new Vector3(0, y(L.length), 0);
    this.gripLocal = new Vector3(0, y(L.grip), 0);
    this.restLocal = new Vector3(0, y(L.rest), 0);
    const s = rider.scale;
    this.restOnChest = new Vector3(-0.115 * s, -0.03 * s, 0.17 * s);   // the rest, right breast
    this.hold = world.addConstraint(new LanceHold(this.body, rider.b.chest, { restLocalLance: this.restLocal, restLocalChest: this.restOnChest, seat: rider.horse.body }));
    this.strike = world.addConstraint(new LanceStrike(this.body, { tipLocal: this.tipLocal, buckling: this.buckling, bending: this.bending, bowTime: this.bowTime }));
    this.broken = false;
    this.piece = null;       // the broken-off fore-lance, flying
    this.breakPoint = null;
    this.place();
  }

  /** Puts the lance in the rest along the current hold target. */
  place() {
    const b = this.body;
    b.q.copy(this.hold.targetQ);
    const rest = this.rider.b.chest.localToWorld(this.restOnChest, new Vector3());
    b.pos.copy(rest).sub(this.restLocal.clone().applyQuaternion(b.q));
    b.prevPos.copy(b.pos); b.prevQ.copy(b.q);
    b.vel.copy(this.rider.horse.body.vel); b.omega.set(0, 0, 0);
  }

  /** Where the lance would point: world direction to aim along. */
  aim(dir) {
    this.hold.targetQ.setFromUnitVectors(Y, _v.copy(dir).normalize());
  }

  worldPoint(local, out = new Vector3()) { return this.body.localToWorld(local, out); }
  get tip() { return this.worldPoint(this.tipLocal); }
  get grip() { return this.worldPoint(this.gripLocal); }
  get restPoint() { return this.rider.b.chest.localToWorld(this.restOnChest, new Vector3()); }
  get axis() { return _v.copy(Y).applyQuaternion(this.body.q); }
  /** Length in front of the rest. */
  get reach() { return (this.broken ? this.def.length * (1 - this.def.breakAt) : this.def.length) - this.def.rest; }

  /** It snaps: the fore-lance flies off, the stump stays in the hand. */
  breakOff(contact) {
    if (this.broken) return;
    this.broken = true;
    const L = this.def;
    const cut = L.length * (1 - L.breakAt);
    this.breakU = cut;
    const b = this.body;
    this.breakPoint = b.localToWorld(new Vector3(0, this.y(cut), 0), new Vector3());
    // Stump: shorter shaft, a little lighter (the fore-lance is the thin end).
    this.world.removeBody(b);
    b.shapes.length = 0;
    this.shaft = Shape.capsule(0.034, cut / 2 - 0.03, Y, new Vector3(0, this.y(cut / 2), 0), { friction: 0.5, restitution: 0.2, collidesWithBodies: false, userData: { lanceOf: this.rider.id, part: 'lance', mat: 'wood' } });
    b.addShape(this.shaft);
    b.setMass(L.mass * 0.78, b.inertia.clone().multiplyScalar(0.55));
    this.world.addBody(b);
    // The fore-lance.
    const len = L.length - cut;
    const mid = new Vector3(0, this.y(cut + len / 2), 0);
    const p = new Body({ name: 'lance-piece', mass: L.mass * 0.22, inertia: new Vector3(L.mass * 0.22 * len * len / 12, 0.001, L.mass * 0.22 * len * len / 12), angularDamping: 0.1, linearDamping: 0.05 });
    b.localToWorld(mid, p.pos);
    p.q.copy(b.q);
    p.prevPos.copy(p.pos); p.prevQ.copy(p.q);
    b.velocityAt(p.pos, p.vel);
    // The shock throws it back and up, spinning.
    const n = contact?.normal ?? Y;
    p.vel.addScaledVector(n, 2 + Math.random() * 3).add(_v.set((Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2));
    p.omega.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 30);
    p.addShape(Shape.capsule(0.025, len / 2 - 0.02, Y, new Vector3(), { friction: 0.6, restitution: 0.25, collidesWithBodies: false, userData: { part: 'lance-piece', mat: 'wood' } }));
    p.userData = { piece: true };
    this.world.addBody(p);
    this.piece = { body: p, length: len, t: 0 };
  }

  /** Dropped: an unhorsed rider lets it go. */
  drop() {
    this.hold.enabled = false;
    this.strike.enabled = false;
  }

  dispose() {
    this.world.removeBody(this.body);
    if (this.piece) this.world.removeBody(this.piece.body);
  }
}

