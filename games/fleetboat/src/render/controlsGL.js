/**
 * Every control in data/controls.js as a thing you can see and put a hand on: handwheels that turn
 * as the valve opens (as many turns as the valve takes), levers that swing between their
 * positions, switches, the big plane and steering wheels, the field rheostats, the telegraphs,
 * the hatches on their hinges, the alarm buttons. Each sits where the control is, turned to face
 * the man who works it.
 */
import { Group, Mesh, MeshStandardMaterial, Color, CylinderGeometry, BoxGeometry, TorusGeometry, SphereGeometry, Vector3, Quaternion, DoubleSide } from 'three';
import { CONTROLS } from '../data/controls.js';
import { HATCHES } from '../data/boat.js';

const FACE = { port: [0, 0, -1], stbd: [0, 0, 1], fwd: [1, 0, 0], aft: [-1, 0, 0], up: [0, 1, 0] };
const _q = new Quaternion(), _z = new Vector3(0, 0, 1);

export function controlMaterials() {
  return {
    red: new MeshStandardMaterial({ color: new Color('#8e1b16'), roughness: 0.45, metalness: 0.2 }),
    black: new MeshStandardMaterial({ color: new Color('#121314'), roughness: 0.5, metalness: 0.2 }),
    chrome: new MeshStandardMaterial({ color: new Color(0.75, 0.76, 0.78), roughness: 0.18, metalness: 1.0 }),
    brass: new MeshStandardMaterial({ color: new Color(0.78, 0.6, 0.3), roughness: 0.28, metalness: 1.0 }),
    bronze: new MeshStandardMaterial({ color: new Color(0.55, 0.38, 0.2), roughness: 0.35, metalness: 1.0 }),
    grey: new MeshStandardMaterial({ color: new Color('#6c7074'), roughness: 0.5, metalness: 0.4 }),
    panel: new MeshStandardMaterial({ color: new Color('#3d4247'), roughness: 0.55, metalness: 0.3 }),
    hatch: new MeshStandardMaterial({ color: new Color('#b9b7ad'), roughness: 0.5, metalness: 0.3, side: DoubleSide }),
    knob: new MeshStandardMaterial({ color: new Color('#1d1a17'), roughness: 0.35 }),
    iron: new MeshStandardMaterial({ color: new Color('#2a2c2e'), roughness: 0.45, metalness: 0.6 }),
  };
}

/** The handwheel's colour by what it does (air red, water green-bronze, the rest black). */
function wheelMat(c, M) {
  if (c.id.startsWith('hp.') || c.id.startsWith('mbt.') || c.id.startsWith('lp.')) return M.red;
  if (c.id.startsWith('tm.')) return M.bronze;
  if (c.id.includes('exhaust') || c.id.includes('induction') || c.id.includes('Supply')) return M.grey;
  return M.black;
}

function handwheel(r, mat, spokes = 4) {
  const g = new Group();
  g.add(new Mesh(new TorusGeometry(r, r * 0.12, 8, 24), mat));
  for (let i = 0; i < spokes; i++) {
    const s = new Mesh(new CylinderGeometry(r * 0.06, r * 0.06, r * 2, 6), mat);
    s.rotation.z = (i / spokes) * Math.PI;
    g.add(s);
  }
  g.add(new Mesh(new CylinderGeometry(r * 0.22, r * 0.22, r * 0.3, 12).rotateX(Math.PI / 2), mat));
  return g;
}

export class ControlsGL {
  constructor(M) {
    this.M = M;
    this.group = new Group();
    this.items = [];
    for (const c of CONTROLS) {
      const it = this._make(c);
      if (!it) continue;
      it.c = c;
      this.items.push(it);
    }
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  /** A mount at the control's place, its local +z turned toward the man working it. */
  _mount(c) {
    const m = new Group();
    m.position.set(...c.pos);
    const f = FACE[c.face] ?? FACE.fwd;
    // the operator faces `face`: the control's front looks back at him; on the hull's side, along
    // the hull's inward normal (the fittings lean in with the curve of the plating)
    const n = new Vector3(-f[0], -f[1], -f[2]);
    if (c.normal) n.set(...c.normal);
    _q.setFromUnitVectors(_z, n);
    m.quaternion.copy(_q);
    this.group.add(m);
    return m;
  }

  _make(c) {
    const M = this.M;
    if (c.kind === 'door') return null;          // the doors are the interior's
    if (c.kind === 'hatch') return this._hatch(c);
    const m = this._mount(c);
    const s = c.size ?? 0.05;
    if (c.kind === 'valve') {
      const stem = new Mesh(new CylinderGeometry(s * 0.12, s * 0.12, s * 1.6, 8).rotateX(Math.PI / 2).translate(0, 0, -s * 0.8), M.chrome);
      m.add(stem);
      const w = handwheel(s, wheelMat(c, M), s > 0.08 ? 5 : 4);
      m.add(w);
      return { m, spin: w, kind: 'valve' };
    }
    if (c.kind === 'wheel' || c.kind === 'rheostat') {
      const w = handwheel(s, c.kind === 'rheostat' ? M.black : M.iron, c.kind === 'wheel' ? 6 : 3);
      if (c.kind === 'wheel') w.add(new Mesh(new TorusGeometry(s * 1.0, s * 0.05, 8, 40), M.chrome));
      if (c.kind === 'wheel') for (let i = 0; i < 6; i++) {
        // the handles round the rim
        const a = (i / 6) * Math.PI * 2;
        const h = new Mesh(new CylinderGeometry(0.014, 0.014, 0.1, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * s * 1.02, Math.sin(a) * s * 1.02, 0.05), M.knob);
        w.add(h);
      }
      m.add(new Mesh(new CylinderGeometry(0.03, 0.03, 0.25, 8).rotateX(Math.PI / 2).translate(0, 0, -0.12), M.chrome));
      m.add(w);
      return { m, spin: w, kind: c.kind };
    }
    if (c.kind === 'lever') {
      const base = new Mesh(new BoxGeometry(s * 1.4, s * 1.1, s * 0.6).translate(0, 0, -s * 0.3), M.panel);
      m.add(base);
      const arm = new Group();
      arm.add(new Mesh(new CylinderGeometry(s * 0.12, s * 0.12, s * 3.2, 8).translate(0, s * 1.6, 0), M.chrome));
      arm.add(new Mesh(new SphereGeometry(s * 0.35, 10, 8).translate(0, s * 3.3, 0), M.knob));
      m.add(arm);
      return { m, arm, kind: 'lever' };
    }
    if (c.kind === 'switch') {
      m.add(new Mesh(new BoxGeometry(s * 2.6, s * 3.4, s * 1.2).translate(0, 0, -s * 0.6), M.panel));
      const t = new Mesh(new CylinderGeometry(s * 0.18, s * 0.18, s * 1.6, 6).translate(0, s * 0.8, 0), M.chrome);
      const piv = new Group(); piv.position.z = s * 0.05; piv.add(t);
      m.add(piv);
      return { m, arm: piv, kind: 'switch' };
    }
    if (c.kind === 'telegraph') {
      m.add(new Mesh(new CylinderGeometry(s * 1.4, s * 1.4, s * 0.8, 24).rotateX(Math.PI / 2), M.brass));
      m.add(new Mesh(new CylinderGeometry(s * 1.25, s * 1.25, s * 0.82, 24).rotateX(Math.PI / 2).translate(0, 0, 0.002), M.panel));
      const arm = new Group();
      arm.add(new Mesh(new BoxGeometry(s * 0.2, s * 1.6, s * 0.15).translate(0, s * 0.8, s * 0.5), M.brass));
      m.add(arm);
      return { m, arm, kind: 'telegraph' };
    }
    if (c.kind === 'button') {
      m.add(new Mesh(new BoxGeometry(s * 2.4, s * 2.4, s * 0.8).translate(0, 0, -s * 0.4), M.panel));
      const b = new Mesh(new CylinderGeometry(s * 0.6, s * 0.6, s * 0.6, 12).rotateX(Math.PI / 2).translate(0, 0, s * 0.2), M.red);
      m.add(b);
      return { m, push: b, kind: 'button' };
    }
    return null;
  }

  /** A hatch: a disc on a hinge in the hull (or the conning tower's floor and roof). */
  _hatch(c) {
    const h = HATCHES.find((q) => q.id === c.hatch);
    const r = (h.dia ?? Math.max(h.w, h.h)) / 2;
    const piv = new Group();
    piv.position.set(c.pos[0] - r, c.pos[1], c.pos[2]);
    const lid = new Mesh(new CylinderGeometry(r * 1.05, r * 1.05, 0.06, 28).translate(r, 0, 0), this.M.hatch);
    if (h.kind === 'oval') lid.scale.set(1, 1, h.w / h.h);
    piv.add(lid);
    piv.add(new Mesh(new CylinderGeometry(r * 0.35, r * 0.35, 0.03, 16).translate(r, -0.05, 0), this.M.grey));
    this.group.add(piv);
    return { m: piv, kind: 'hatch', lid: piv };
  }

  /** Moves everything to the controls' values. */
  update(plant) {
    const ctl = plant.ctl;
    for (const it of this.items) {
      const c = it.c, v = ctl[c.id];
      switch (it.kind) {
        case 'valve': it.spin.rotation.z = -(+v || 0) * (c.turns || 1) * Math.PI * 2; break;
        case 'rheostat': it.spin.rotation.z = -(+v || 0) * Math.PI * 1.5; break;
        case 'wheel': it.spin.rotation.z = -((+v || 0) / 25) * Math.PI * 1.2; break;
        case 'lever': {
          const st = c.states ?? ['off', 'on'];
          const i = Math.max(0, st.indexOf(v));
          const k = st.length > 1 ? i / (st.length - 1) : 0;
          it.arm.rotation.x = (k - 0.5) * 1.1;
          break;
        }
        case 'switch': it.arm.rotation.x = (+v || 0) > 0.5 ? 0.6 : -0.6; break;
        case 'telegraph': {
          const st = c.states, i = Math.max(0, st.indexOf(v));
          it.arm.rotation.z = -((i / (st.length - 1)) - 0.5) * 2.6;
          break;
        }
        case 'button': it.push.position.z = (+v || 0) > 0.5 ? -0.012 : 0; break;
        case 'hatch': it.lid.rotation.z = Math.min(1, Math.max(0, +v || 0)) * 1.75; break;
        default:
      }
    }
  }
}

export { FACE };
