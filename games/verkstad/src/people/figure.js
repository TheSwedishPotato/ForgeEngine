/**
 * The customer in person: the people of all the Med Engine games (Zweikampf 1403's Walker, a
 * skinned body on its ragdoll's skeleton with a real gait, through Gotthard Pullman's Figure with
 * hands that reach), dressed for a wet November day in Gothenburg as the customer's card describes
 * them. They walk from their car to the counter, stand there shifting their weight, look at you,
 * and gesture while they talk.
 */
import { makeFigure } from '../../../gotthard-pullman/src/people/figure.js';
import { SKIN_TONES } from '../../../duel1403/src/render/bodyMesh.js';

const SKIN = { light: SKIN_TONES.light, medium: SKIN_TONES.medium, tan: SKIN_TONES.tan, brown: SKIN_TONES.brown, dark: '#6b4430' };
const HAIR = { black: '#1c1a18', 'dark brown': '#2e221a', brown: '#5a3c22', blond: '#b8955a', red: '#8a3a1c', grey: '#8a8580', white: '#d0ccc4', none: '#c8a888' };

export class CustomerFigure {
  constructor(scene, profile) {
    const L = profile.looks ?? {};
    const female = profile.gender === 'woman';
    const looks = {
      female, height: Math.max(1.45, Math.min(2.05, (L.height_cm ?? (female ? 166 : 178)) / 100)), mass: female ? 64 : 80,
      colors: { skin: SKIN[L.skin] ?? SKIN.light, hair: HAIR[L.hair] ?? HAIR.brown, cloth: /^#[0-9a-f]{6}$/i.test(L.clothes ?? '') ? L.clothes : '#26324a', hose: '#24272d' },
      beard: L.beard ? 0.5 : 0, gown: false,
    };
    this.fig = makeFigure('customer' + profile.name, looks, { quality: 'low', texSize: 512 });
    this.scene = scene;
    scene.add(this.fig.mesh);
    this.pos = [-4, 0, 13]; this.yaw = Math.PI; this.path = []; this.t = 0;
  }

  walkTo(points) { this.path = points.map((p) => [...p]); }

  update(dt, camera, talking) {
    this.t += dt;
    let speed = 0;
    if (this.path.length) {
      const [tx, , tz] = this.path[0];
      const dx = tx - this.pos[0], dz = tz - this.pos[2], d = Math.hypot(dx, dz);
      if (d < 0.08) this.path.shift();
      else {
        speed = 1.25;
        const step = Math.min(d, speed * dt);
        this.pos[0] += (dx / d) * step; this.pos[2] += (dz / d) * step;
        const want = Math.atan2(dx, dz);
        this.yaw += Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)) * Math.min(1, dt * 6);
      }
    } else if (camera) {
      // stand facing you, if you are anywhere near the counter
      const dx = camera.position.x - this.pos[0], dz = camera.position.z - this.pos[2];
      if (Math.hypot(dx, dz) < 6) { const want = Math.atan2(dx, dz); this.yaw += Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)) * Math.min(1, dt * 2); }
    }
    this.fig.update(dt, { x: this.pos[0], y: 0, z: this.pos[2], yaw: this.yaw, speed, posture: 'stand', gesture: !!talking && Math.sin(this.t * 2.2) > -0.2, look: 0 });
  }

  remove() { this.scene.remove(this.fig.mesh); this.fig.dispose?.(); }
}
