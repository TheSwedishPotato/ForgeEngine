import { Vector3 } from 'three';
import { HORSE } from '../data/joust.js';

/**
 * A jouster's head: what he aims at, how true his point stays, when he
 * sets himself for the shock. Skill narrows the aim error and sharpens the
 * timing of the brace; nothing here touches the physics directly.
 */
export class JoustAI {
  constructor(sim, rider, { skill = rider.skill, aim = 'mixed', rand = Math.random } = {}) {
    this.sim = sim;
    this.r = rider;
    this.skill = skill;
    this.style = aim;
    this.rand = rand;
    this.course = -1;
    this.braced = false;
    this.local = new Vector3();
    this.err = new Vector3();
    this.point = new Vector3();
  }

  _newCourse() {
    this.course = this.sim.course;
    this.braced = false;
    const s = this.skill, R = this.rand;
    // The helm scores double but is a smaller mark that glances; the shield is the sure target.
    const helm = this.style === 'helm' ? R() < 0.6 : this.style === 'mixed' ? R() < 0.25 * s : false;
    this.target = helm ? 'head' : 'ecranche';
    const g = () => (R() + R() + R() - 1.5) * 2;   // ~ normal, sd 1
    const sd = 0.07 + 0.42 * (1 - s);   // m: a man must hit a hand-span shield from a galloping horse
    this.err.set(g() * sd, g() * sd * 1.2, 0);
    this.speed = HORSE.gaits.canter + 0.6 + 1.8 * s * (0.6 + 0.4 * R());
    this.braceLead = 0.2 + (R() - 0.5) * 0.3 * (1.2 - s);
  }

  update() {
    const sim = this.sim, r = this.r;
    if (sim.course !== this.course) this._newCourse();
    r.ctrl.speed = this.speed;
    r.ctrl.lane = 0.15 * this.skill;   // the bold ride a little closer
    const o = r.opponent;
    if (!o.seated) { r.ctrl.aim = null; return; }
    if (this.target === 'head') this.point.copy(o.b.head.pos);
    else o.b.chest.localToWorld(o.ecranche.offset, this.point);
    // The error lives in the target's frame: off to the side and up or down.
    const side = new Vector3(1, 0, 0).applyQuaternion(o.b.chest.q);
    this.point.addScaledVector(side, this.err.x);
    this.point.y += this.err.y;
    r.ctrl.aim = sim.phase === 'charge' ? this.point : null;
    if (sim.phase === 'charge' && !this.braced && sim.timeToImpact(r.id) < this.braceLead) {
      r.ctrl.brace = true;
      this.braced = true;
    }
  }
}
