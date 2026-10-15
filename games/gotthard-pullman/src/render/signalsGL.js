/**
 * The line's signals in 3D (world/signals.js decides the aspects): SBB System L light signals on
 * plain steel masts beside the track, on the outer side of each main line (left of the special's
 * track, right of the other), the black screen facing the trains they govern.
 *
 *  - main signal: a tall black screen, the green lamp above the red one; "Fahrt" one green light,
 *    "Halt" one red light;
 *  - distant signal: a square black screen; "Warnung" two orange lights side by side at the top,
 *    "Fahrt" two green lights diagonally;
 *  - at each signal the Signum track magnet beside the rail (a yellow-painted box).
 */
import { Group, Mesh, MeshStandardMaterial, Color, CylinderGeometry, Vector3 } from 'three';
import { Builder } from './geom.js';
import { poseOnTrack } from './trainGL.js';

const V = (x, y, z) => new Vector3(x, y, z);
const SIDE = 2.7;                 // m from the track centre to the mast
const SHOW = 2600;                // drawn within this distance of the camera

let _mats = null;
function mats() {
  if (_mats) return _mats;
  const lamp = (c, k = 9) => new MeshStandardMaterial({ color: new Color(...c).multiplyScalar(0.3), emissive: new Color(...c), emissiveIntensity: k, roughness: 0.3 });
  _mats = {
    mast: new MeshStandardMaterial({ color: new Color('#6c6f70'), roughness: 0.55, metalness: 0.8 }),
    screen: new MeshStandardMaterial({ color: new Color('#0d0d0e'), roughness: 0.7 }),
    rim: new MeshStandardMaterial({ color: new Color('#e8e6df'), roughness: 0.6 }),
    hood: new MeshStandardMaterial({ color: new Color('#111112'), roughness: 0.6, metalness: 0.3 }),
    dark: new MeshStandardMaterial({ color: new Color('#1b1d1c'), roughness: 0.15, metalness: 0.1 }),
    magnet: new MeshStandardMaterial({ color: new Color('#c9a227'), roughness: 0.7 }),
    green: lamp([0.15, 1, 0.45]),
    red: lamp([1, 0.07, 0.04]),
    orange: lamp([1, 0.5, 0.05]),
  };
  return _mats;
}

/** Lamp positions (y up, z across) on each kind of screen, and which are lit for each aspect. */
const LAMPS = {
  main: { at: { green: [5.25, 0], red: [4.75, 0] }, lit: { clear: ['green'], stop: ['red'] } },
  distant: {
    at: { o1: [4.95, -0.22], o2: [4.95, 0.22], g1: [4.95, 0.22], g2: [4.55, -0.22] },
    colour: { o1: 'orange', o2: 'orange', g1: 'green', g2: 'green' },
    lit: { warning: ['o1', 'o2'], clear: ['g1', 'g2'] },
  },
};

/** The mast and screen of one kind, built once (signal frame: x = the governed trains' direction of travel, z to their right). */
function body(kind) {
  const b = new Builder();
  const top = kind === 'main' ? 5.6 : 5.3;
  b.cylinder('mast', V(0, -0.6, 0), V(0, top + 0.1, 0), 0.08, 0.07, { segs: 10 });
  b.box('mast', [-0.35, -0.6, -0.35], [0.35, -0.3, 0.35]);                      // the foundation block
  // the screen, its white rim, facing the approaching train (-x)
  const [y0, y1, w] = kind === 'main' ? [4.45, 5.55, 0.3] : [4.3, 5.2, 0.45];
  b.box('rim', [-0.2, y0 - 0.04, -w - 0.04], [-0.17, y1 + 0.04, w + 0.04]);
  b.box('screen', [-0.23, y0, -w], [-0.12, y1, w]);
  // a dark lens and a hood over every lamp position
  const at = Object.values(LAMPS[kind].at);
  const seen = new Set();
  for (const [y, z] of at) {
    const k = `${y},${z}`; if (seen.has(k)) continue; seen.add(k);
    b.cylinder('dark', V(-0.24, y, z), V(-0.23, y, z), 0.085, 0.085, { segs: 14 });
    b.box('hood', [-0.42, y + 0.09, z - 0.12], [-0.23, y + 0.11, z + 0.12]);
  }
  b.box('mast', [-0.12, y0 + 0.1, -0.05], [0, y0 + 0.2, 0.05]);                  // the bracket
  return b.build(mats(), { castShadow: true });
}

const LENS = new CylinderGeometry(0.078, 0.078, 0.02, 14);
LENS.rotateZ(Math.PI / 2);

export class SignalsGL {
  constructor(stage, route, signals) {
    this.stage = stage; this.signals = signals;
    this.group = new Group(); this.group.name = 'signals';
    stage.scene.add(this.group);
    const proto = { main: body('main'), distant: body('distant') };
    const magnet = new Builder();
    magnet.box('magnet', [-0.5, -0.05, -0.12], [0.5, 0.12, 0.12]);
    const magnetProto = magnet.build(mats(), { castShadow: false });
    const M = mats();
    this.items = [];
    const pose = {};
    for (const g of signals.list) {
      const line = g.track === 'R' ? route.right : route.run;
      if (g.s < 2 || g.s > line.length - 2) continue;
      poseOnTrack(line, g.s + g.dir, g.s - g.dir, pose);
      const p = line.pos(g.s);
      const hold = new Group();
      // the mast on the outer side: left of the special's line (it runs south), right of the other
      // (seen from the special) = left of the northbound trains on it
      const off = -SIDE;
      const h = pose.heading;
      const map = { x: p.x + Math.cos(h) * off, y: p.y - Math.sin(h) * off, z: p.z };
      hold.rotation.y = pose.yaw;
      hold.add(proto[g.kind].clone());
      const lamps = {};
      const L = LAMPS[g.kind];
      for (const [name, [y, z]] of Object.entries(L.at)) {
        const m = new Mesh(LENS, M[L.colour?.[name] ?? name]);
        m.position.set(-0.25, y, z);
        m.visible = false;
        hold.add(m);
        lamps[name] = m;
      }
      // the Signum magnet beside the rail, back toward the track centre
      const mg = magnetProto.clone();
      mg.position.set(0, 0, SIDE - 1.05);
      hold.add(mg);
      this.stage.anchor(hold, map);
      this.group.add(hold);
      this.items.push({ g, hold, lamps, aspect: null });
    }
  }

  update(camera) {
    const cam = camera.position;
    for (const it of this.items) {
      it.hold.visible = it.hold.position.distanceTo(cam) < SHOW;
      if (!it.hold.visible || it.aspect === it.g.aspect) continue;
      it.aspect = it.g.aspect;
      const lit = LAMPS[it.g.kind].lit[it.aspect] ?? [];
      for (const [name, m] of Object.entries(it.lamps)) m.visible = lit.includes(name);
    }
  }
}
