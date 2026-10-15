/**
 * The crew in the 3D boat, as the crew model has them: on the 1403 engine's own figure (the
 * Walker, dressed by Gotthard Pullman's figure.js), in the boat's frame so they ride her rolls.
 * Enlisted men in dungarees (chambray shirts, denim trousers), chiefs and officers in khaki with
 * caps. Walking the passages, climbing the ladders hand over hand, seated at the planes, lying in
 * their bunks off watch, and with their hands where the crew model has them: on the wheel, the
 * lever, the valve they are working.
 *
 * Figures are made a few at a time, nearest first, and drawn only near the camera (a compartment
 * and its neighbours: the bulkheads hide the rest).
 */
import { Vector3 } from 'three';
import { makeFigure } from '../../../gotthard-pullman/src/people/figure.js';
import { LEVEL_Y } from '../crew/person.js';

const SKINS = ['#f1c9a5', '#e8bd96', '#d9a982', '#c48e6a', '#a8714c', '#8d5a3b', '#6b4430', '#e0b896', '#b98462'];
const HAIR = ['#1c1a18', '#2e221a', '#3b2a1e', '#5a3c22', '#7a5a3a', '#a8875a', '#141210'];
const _v = new Vector3();

function looks(m) {
  const r = (k) => { const x = Math.sin(m.seed * 9301 + k * 49297) * 233280; return x - Math.floor(x); };
  const khaki = m.officer || m.rate.startsWith('Chief');
  const cook = m.rate.includes('Cook') || m.rate.includes('Baker') || m.rate.includes('Steward');
  return {
    female: m.female,
    height: m.female ? 1.6 + r(1) * 0.12 : 1.68 + r(1) * 0.17,
    mass: m.female ? 58 + r(2) * 16 : 66 + r(2) * 24,
    colors: {
      skin: SKINS[Math.floor(r(3) * SKINS.length)], hair: HAIR[Math.floor(r(4) * HAIR.length)],
      cloth: khaki ? '#a99a70' : cook ? '#e4e2da' : '#7d98b8', hose: khaki ? '#8d7f5a' : cook ? '#d8d6cc' : '#27344d',
    },
    beard: !m.female && r(5) < 0.3 ? 0.3 + r(6) * 0.6 : 0,
    gown: false,
    cap: khaki ? { color: '#9d8e64', band: '#6a5f42', visor: '#1a1612' } : null,
  };
}

export class CrewGL {
  constructor(boatGL, crew) {
    this.parent = boatGL.inner;
    this.crew = crew;
    this.items = crew.men.map((m) => ({ m, fig: null, look: 0 }));
    this.queue = [];
  }

  /** Builds up to n figures for the men nearest the camera. */
  _build(camB, n = 2) {
    const want = this.items.filter((q) => !q.fig).map((q) => ({ q, d: Math.hypot(q.m.x - camB.x, q.m.z - camB.z) + (q.m.level === this.camLevel ? 0 : 6) }))
      .sort((a, b) => a.d - b.d).slice(0, n);
    for (const { q, d } of want) {
      if (d > 26) break;
      q.fig = makeFigure(q.m.name, looks(q.m), { quality: 'low', texSize: 256 });
      this.parent.add(q.fig.mesh);
    }
  }

  /** camB: the camera in boat coordinates; camLevel: where the viewer is. */
  update(dt, camB, camLevel) {
    this.camLevel = camLevel;
    this._build(camB, 2);
    for (const q of this.items) {
      const m = q.m, fig = q.fig;
      if (!fig) continue;
      const dist = Math.hypot(m.x - camB.x, m.z - camB.z, (LEVEL_Y[m.level] - camB.y) * 0.5);
      // seen only near the camera (the bulkheads hide the rest)
      fig.mesh.visible = dist < 22;
      if (!fig.mesh.visible) continue;
      fig.reach.L = fig.reach.R = null;
      fig.bend = 0;
      let y = LEVEL_Y[m.level], yaw = m.yaw, posture = m.posture === 'walk' ? 'walk' : m.posture, speed = m.speed;
      let x = m.x, z = m.z;
      if (m.climb) {
        // on the ladder: facing it, hands on the rails, rising rung by rung
        const c = m.climb, k = Math.min(1, c.t / c.T);
        y = LEVEL_Y[c.from] + (LEVEL_Y[c.to] - LEVEL_Y[c.from]) * k;
        x = c.L.x; z = c.L.z;
        yaw = -Math.PI / 2;
        posture = 'stand'; speed = 0;
        const hy = y + 1.35 + 0.15 * Math.sin(c.t * 5);
        fig.reach.L = { x: c.L.x - 0.32, y: hy, z: z - 0.2, w: 1 };
        fig.reach.R = { x: c.L.x - 0.32, y: hy + 0.15 * Math.cos(c.t * 5), z: z + 0.2, w: 1 };
      } else if (posture === 'lie') {
        y = m.rest?.y ?? y;
        yaw = Math.PI / 2;
      }
      // his hands on what he is working
      for (const side of ['L', 'R']) {
        const h = m.hands[side];
        if (h.pos && !m.climb) {
          fig.reach[side] = { x: h.pos[0], y: h.pos[1], z: h.pos[2], w: 1 };
          const low = (y + 0.95) - h.pos[1];
          if (low > 0) fig.bend = Math.max(fig.bend, Math.min(1.1, low * 1.4));
        }
      }
      // where he looks: at what his hands are on, or along his way
      let look = 0;
      const on = m.hands.R.pos ?? m.hands.L.pos;
      if (on) look = Math.max(-1.2, Math.min(1.2, ((Math.atan2(on[0] - x, on[2] - z) - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
      q.look += (look - q.look) * Math.min(1, dt * 3);
      fig.update(dt, { x, y, z, yaw, speed, posture: posture === 'walk' ? 'walk' : posture, look: q.look });
    }
  }
}

export { looks };
void _v;
