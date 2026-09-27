import { Vector3 } from 'three';
import { World, Body, Shape } from '../physics/index.js';
import { Boxer } from '../boxer/Boxer.js';

export const RING = {
  half: 3.05,          // 20 ft between the ropes
  apron: 0.6,
  postRadius: 0.075,
  postHeight: 1.55,
  ropeHeights: [0.46, 0.76, 1.07, 1.37],
  ropeRadius: 0.02,
  platformHeight: 1.2,
};

/**
 * The physical fight: world, canvas, ropes, posts and two boxers.
 * Shared by the game and the headless tools so both run identical physics.
 */
export class FightSim {
  constructor({ substeps = 20, fighters = [{}, {}] } = {}) {
    this.world = new World({ substeps });
    this.dt = 1 / 60;
    this.time = 0;

    const canvas = new Body({ name: 'canvas' });
    canvas.addShape(Shape.plane(new Vector3(0, 1, 0), 0, { friction: 0.9, restitution: 0, userData: { part: 'canvas' } }));
    this.world.addBody(canvas);
    this.canvas = canvas;

    this._buildRopes();

    const [fa, fb] = fighters;
    this.a = new Boxer(this.world, { id: 0, name: 'Red', position: new Vector3(0, 0, -0.55), yaw: 0, ...fa });
    this.b = new Boxer(this.world, { id: 1, name: 'Blue', position: new Vector3(0, 0, 0.55), yaw: Math.PI, ...fb });
    this.a.opponent = this.b;
    this.b.opponent = this.a;
    this.boxers = [this.a, this.b];

    this.world.collisionFilter = (s1, s2) => {
      const u1 = s1.userData, u2 = s2.userData;
      if (u1.boxer === undefined || u2.boxer === undefined) return true;
      if (u1.boxer !== u2.boxer) return true;
      // Self contact: gloves can't pass through one's own head.
      return (u1.part === 'glove' && u2.segment === 'head') || (u2.part === 'glove' && u1.segment === 'head');
    };
  }

  _buildRopes() {
    const R = RING;
    this.ropes = [];
    const ropeMat = { friction: 0.5, restitution: 0.0, compliance: 1 / 2.2e4, damping: 900 };
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = corners[i];
      const [x1, z1] = corners[(i + 1) % 4];
      const a = new Vector3(x0 * R.half, 0, z0 * R.half);
      const b = new Vector3(x1 * R.half, 0, z1 * R.half);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const axis = b.clone().sub(a).normalize();
      const len = a.distanceTo(b);
      for (let k = 0; k < R.ropeHeights.length; k++) {
        const body = new Body({ name: `rope${i}_${k}` });
        body.pos.set(mid.x, R.ropeHeights[k], mid.z);
        body.addShape(Shape.capsule(R.ropeRadius, len / 2, axis, new Vector3(), { ...ropeMat, userData: { part: 'rope', side: i, index: k } }));
        this.world.addBody(body);
        this.ropes.push({ body, side: i, index: k, a, b, height: R.ropeHeights[k], deflection: 0, deflectPoint: 0.5 });
      }
      const post = new Body({ name: `post${i}` });
      post.pos.set(x0 * R.half, R.postHeight / 2, z0 * R.half);
      post.addShape(Shape.capsule(0.12, R.postHeight / 2, new Vector3(0, 1, 0), new Vector3(), { friction: 0.5, compliance: 1 / 5e4, damping: 1500, userData: { part: 'post' } }));
      this.world.addBody(post);
    }
  }

  step() {
    for (const bx of this.boxers) bx.update(this.dt);
    this.world.step(this.dt);
    this.time += this.dt;
  }
}
