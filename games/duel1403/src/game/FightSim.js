import { Vector3, Quaternion } from 'three';
import { World, Body, Shape } from '../physics/index.js';
import { Knight } from '../knight/Knight.js';
import { DamageModel } from './Damage.js';

/**
 * The physical duel: the world, the ground of the lists and two fighters.
 * Shared by the game and the headless tools so both run identical physics.
 */
export class FightSim {
  constructor({ substeps = 24, fighters = [{}, {}], separation = 3.2 } = {}) {
    this.world = new World({ substeps });
    this.dt = 1 / 60;
    this.time = 0;

    const ground = new Body({ name: 'ground' });
    ground.addShape(Shape.plane(new Vector3(0, 1, 0), 0, { friction: 0.8, restitution: 0, userData: { part: 'ground' } }));
    this.world.addBody(ground);
    this.ground = ground;

    const [fa, fb] = fighters;
    this.a = new Knight(this.world, { id: 0, name: 'You', position: new Vector3(0, 0, -separation / 2), yaw: 0, ...fa });
    this.b = new Knight(this.world, { id: 1, name: 'Opponent', position: new Vector3(0, 0, separation / 2), yaw: Math.PI, ...fb });
    this.a.opponent = this.b;
    this.b.opponent = this.a;
    this.knights = [this.a, this.b];

    this.world.collisionFilter = (s1, s2) => {
      const u1 = s1.userData, u2 = s2.userData;
      if (u1.fighter === undefined || u2.fighter === undefined) return true;
      return u1.fighter !== u2.fighter;
    };
    // Edge bite: a sharp edge or point catches in flesh, cloth and leather and
    // cuts in (high friction, soft and lossy contact); it skids over mail
    // less, and glances off plate. Steel on steel stays slippery.
    this.world.materialRule = (sa, sb, c) => {
      const ua = sa.userData, ub = sb.userData;
      const wa = ua.weapon ? ua : ub.weapon ? ub : null;
      if (!wa || (ua.weapon && ub.weapon)) return;
      const body = wa === ua ? ub : ua;
      if (body.fighter === undefined) return;
      const part = wa.weaponPart;
      const sharp = part === 'blade' || part === 'axe' || part === 'spike' || part === 'beak' || part === 'butt';
      const m = body.mat ?? 'skin';
      if (m === 'plate') { c.friction = 0.14; return; }
      if (!sharp) { if (m !== 'mail') { c.compliance = Math.max(c.compliance, 1 / 1.5e5); c.damping = Math.max(c.damping, 1400); } return; }
      if (m === 'mail') { c.friction = 0.55; return; }
      c.friction = m === 'leather' ? 1.0 : 1.3;
      c.compliance = 1 / 8e4;
      c.damping = 1800;
    };
    this.damage = new DamageModel(this);
    this._weaponBodies = [];
    for (const k of this.knights) {
      this._weaponBodies.push(k.weapon.body);
      if (k.weapon.offhand) this._weaponBodies.push(k.weapon.offhand.body);
    }
    for (const b of this._weaponBodies) b.userData.pre = { pos: new Vector3(), q: new Quaternion(), vel: new Vector3(), omega: new Vector3() };
  }

  /** Let both fighters take up their guards before the fight starts. */
  settle(seconds = 1.2) {
    const n = Math.round(seconds / this.dt);
    for (let i = 0; i < n; i++) {
      for (const k of this.knights) k.update(this.dt);
      this.world.step(this.dt);
    }
    this.world.impacts.length = 0;
  }

  step() {
    for (const b of this._weaponBodies) {
      const p = b.userData.pre;
      p.pos.copy(b.pos); p.q.copy(b.q); p.vel.copy(b.vel); p.omega.copy(b.omega);
    }
    for (const k of this.knights) k.update(this.dt);
    this.world.step(this.dt);
    this.time += this.dt;
    this.damage.process();
    for (const k of this.knights) k.bound = Math.max(0, k.bound - this.dt);
  }
}
