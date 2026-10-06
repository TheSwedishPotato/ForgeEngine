import { Vector3, Quaternion } from 'three';
import { World, Body, Shape } from '../physics/index.js';
import { Knight } from '../knight/Knight.js';
import { DamageModel } from './Damage.js';

/**
 * The physical duel: the world, the ground of the lists and two fighters.
 * Shared by the game and the headless tools so both run identical physics.
 */
const SELF_BLOCK = new Set(['chest', 'abdomen', 'pelvis', 'head', 'thigh', 'shin', 'upperArm']);

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
      if (u1.fighter !== u2.fighter) return true;
      // No part of his own weapon passes through his own trunk, head, thighs
      // or upper arms, except where his hands are on it (the forearms and
      // hands hold it, so they are left out).
      const w = u1.weapon ? u1 : u2.weapon ? u2 : null;
      if (!w || (u1.weapon && u2.weapon)) return false;
      const b = w === u1 ? u2 : u1;
      if (!SELF_BLOCK.has(b.segType) || w.weaponPart === 'buckler') return false;
      // the player's drawn swings cross his own body; only head and chest stop his blade, so it never snags
      if (w.fighter === 0 && b.segType !== 'head' && b.segType !== 'chest') return false;
      const W = this.knights[w.fighter]?.weapon;
      if (W && w.y0 !== undefined) {
        for (const g of [W.gripY.R, W.gripY.L]) if (g !== null && g !== undefined && g > w.y0 - 0.02 && g < w.y1 + 0.02) return false;
      }
      // the crossguard and pommel sit at the sword hand: they may touch the other arm, not the sword arm's own
      if ((w.weaponPart === 'cross' || w.weaponPart === 'pommel' || w.weaponPart === 'rondel') && b.segType === 'upperArm') return false;
      return true;
    };
    // The clothes and armour over the body: his own weapon stops at their
    // surface, not at the bare body capsule (gambeson and mail stand off
    // 3–5 cm). Only for his own weapon; blows from the other man are
    // governed by the armour model.
    this.world.skinMargin = 0.05;
    this.world.pairSkin = (sa, sb) => {
      const u1 = sa.userData, u2 = sb.userData;
      if (u1.fighter === undefined || u1.fighter !== u2.fighter || !(u1.weapon ^ u2.weapon)) return 0;
      if (u1.fighter === 0) return 0.01;
      const body = u1.weapon ? u2 : u1;
      return body.mat === 'plate' || body.mat === 'mail' ? 0.045 : 0.035;
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
