/**
 * Inside the time machine (left-hand drive: the driver sits on the left, z < 0).
 *
 * The DMC-12's own cabin: two pleated leather buckets low on the floor either side of the
 * backbone's tunnel, the console with the five-speed lever, the binnacle over the dials (an
 * 85 mph speedometer, the tach, temperature, volts, fuel, oil), the centre stack, the three-
 * spoke wheel, the pedals, the door cards with their armrests, the headliner and visors.
 *
 * Doc's additions, as on the cars in the photographs (Universal's, the Petersen's): the time
 * circuits stepped down the centre stack under the radio, angled to the driver; the green
 * keypad box beside the wheel; the white digital speedometer on top of the dash; the panel of
 * meters on the passenger side with the plutonium chamber's ROENTGENS meter; the switch pod
 * on the wheel's hub; the lever that turns the time circuits on, by the gear lever; conduit
 * and loom along the console; and on the bulkhead between the seats, at head height, the flux
 * capacitor: three glass tubes in a Y behind a window, their lights running in to the centre.
 *
 * Returns the group and handles to everything that moves or lights.
 */
import { Group, Mesh, Vector3, Matrix4, Quaternion, PlaneGeometry, CircleGeometry, MeshStandardMaterial, Color, TorusGeometry, SphereGeometry, CylinderGeometry, BoxGeometry, CanvasTexture } from 'three';
import { canvas } from './textures.js';
import { Builder } from './geom.js';
import { tube } from './timemachine.js';
import { TimeCircuitsFace, SpeedoFace, dmcDials, roentgenFace, plateLabel } from './instruments.js';

const V = (x, y, z) => new Vector3(x, y, z);
const Z = V(0, 0, 1);

/** A textured plane centred at c, its face toward n, its up toward u (approximately). */
function panel(w, h, c, n, u, mat) {
  const m = new Mesh(new PlaneGeometry(w, h), mat);
  const nz = n.clone().normalize(), x = new Vector3().crossVectors(u, nz).normalize(), y = new Vector3().crossVectors(nz, x);
  m.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, nz));
  m.position.copy(c);
  return m;
}

/** A dial: face texture, glass, a needle on a pivot (rotate .needle.rotation.z, clockwise negative). */
function dial(r, tex, c, n, M, { needleColor = null } = {}) {
  const g = new Group();
  g.position.copy(c);
  g.quaternion.setFromUnitVectors(Z, n.clone().normalize());
  const face = new Mesh(new CircleGeometry(r, 40), new MeshStandardMaterial({ map: tex, roughness: 0.6, emissiveMap: tex, emissive: new Color(0, 0, 0) }));
  g.add(face);
  const bezel = new Mesh(new TorusGeometry(r + 0.002, 0.0035, 6, 40), M.plasticBlack);
  g.add(bezel);
  const needle = new Group();
  needle.position.z = 0.004;
  const nm = needleColor ? new MeshStandardMaterial({ color: needleColor, roughness: 0.4 }) : M.needle;
  const bar = new Mesh(new BoxGeometry(0.0035, r * 0.85, 0.002), nm);
  bar.position.y = r * 0.35;
  needle.add(bar);
  const hub = new Mesh(new CylinderGeometry(r * 0.09, r * 0.09, 0.004, 12), M.plasticBlack);
  hub.rotation.x = Math.PI / 2;
  needle.add(hub);
  g.add(needle);
  g.userData = { needle, face };
  return g;
}

export function buildInterior(M, { version = 'part1' } = {}) {
  const root = new Group();
  root.name = 'interior';
  const b = new Builder();
  const live = { dials: {}, keys: [], flux: [], lamps: {} };

  // --- floor, tunnel, sills, firewall, bulkhead --------------------------------------------
  b.box('carpet', [-0.9, 0.2, -0.84], [0.66, 0.245, 0.84]);
  b.box('carpet', [-0.88, 0.245, -0.14], [0.5, 0.40, 0.14]);                        // the backbone's tunnel
  b.soft('leather', [-0.82, 0.40, -0.13], [0.06, 0.475, 0.13], 0.025, { k: 2 });     // console top / armrest
  for (const s of [1, -1]) {
    b.box('liner', [-0.9, 0.245, s > 0 ? 0.76 : -0.9], [0.62, 0.37, s > 0 ? 0.9 : -0.76]);   // the high sills inside
  }
  // toe board and firewall
  b.quad('carpet', V(0.6, 0.245, -0.84), V(0.6, 0.245, 0.84), V(0.82, 0.46, 0.84), V(0.82, 0.46, -0.84));
  b.box('plastic', [0.78, 0.46, -0.84], [0.84, 0.82, 0.84]);
  // the bulkhead behind the seats, the rear window in it (the pane is drawn by the glass pass)
  b.box('liner', [-0.96, 0.245, -0.82], [-0.92, 0.84, 0.82]);
  b.box('liner', [-0.96, 0.84, -0.82], [-0.92, 1.12, -0.44]);
  b.box('liner', [-0.96, 0.84, 0.44], [-0.92, 1.12, 0.82]);
  b.box('liner', [-0.96, 1.08, -0.44], [-0.92, 1.13, 0.44]);
  const rearWindow = new Mesh(new PlaneGeometry(0.88, 0.24));
  rearWindow.position.set(-0.94, 0.96, 0); rearWindow.rotation.y = Math.PI / 2;
  root.add(rearWindow);
  live.rearWindow = rearWindow;
  b.box('well', [-1.2, 0.3, -0.5], [-0.97, 1.0, 0.5]);                                // the engine bay behind it, dark

  // --- the seats: pleated buckets, low on the floor -------------------------------------------
  for (const zc of [-0.39, 0.39]) {
    const seat = new Matrix4().makeRotationZ(-0.1).setPosition(-0.36, 0.0, zc);
    b.transform(seat);
    for (let k = 0; k < 4; k++) b.soft('leatherDark', [-0.27, 0.27, -0.2 + k * 0.1], [0.24, 0.395, -0.105 + k * 0.1], 0.03, { k: 2 });
    for (const s of [1, -1]) b.soft('leatherDark', [-0.27, 0.27, s > 0 ? 0.19 : -0.26], [0.25, 0.44, s > 0 ? 0.26 : -0.19], 0.035, { k: 2 });
    b.transform(null);
    // the back, reclined about 21 degrees, with side bolsters and the headrest shape
    const back = new Matrix4().makeRotationZ(0.37).setPosition(-0.62, 0.33, zc);
    b.transform(back);
    for (let k = 0; k < 4; k++) b.soft('leatherDark', [-0.07, 0.0, -0.2 + k * 0.1], [0.05, 0.56, -0.105 + k * 0.1], 0.03, { k: 2 });
    for (const s of [1, -1]) b.soft('leatherDark', [-0.08, 0.0, s > 0 ? 0.19 : -0.27], [0.09, 0.5, s > 0 ? 0.27 : -0.19], 0.04, { k: 2 });
    b.soft('leatherDark', [-0.07, 0.56, -0.13], [0.05, 0.74, 0.13], 0.04, { k: 2 });
    b.box('plasticBlack', [-0.1, 0.0, -0.25], [-0.07, 0.55, 0.25]);
    b.transform(null);
    // the runners
    b.box('alloyDark', [-0.66, 0.245, zc - 0.2], [0.06, 0.26, zc - 0.18]);
    b.box('alloyDark', [-0.66, 0.245, zc + 0.18], [0.06, 0.26, zc + 0.2]);
  }

  // --- the dash ------------------------------------------------------------------------------
  b.box('dashTop', [0.22, 0.79, -0.8], [0.56, 0.845, 0.8]);                         // the top under the windscreen
  b.soft('dashTop', [0.15, 0.76, -0.69], [0.42, 0.875, -0.07], 0.03, { k: 2 });     // the binnacle's hood over the dials
  b.box('plasticBlack', [0.27, 0.62, -0.67], [0.34, 0.785, -0.09]);                  // the cluster
  b.soft('dashTop', [0.18, 0.42, -0.8], [0.42, 0.63, -0.12], 0.03, { k: 2 });       // under the cluster (knees)
  b.soft('dashTop', [0.24, 0.56, 0.12], [0.5, 0.80, 0.8], 0.03, { k: 2 });          // the passenger side
  b.box('plastic', [0.235, 0.6, 0.3], [0.245, 0.74, 0.7]);                           // the glove box lid
  // the centre stack: an upright face behind the time circuits, sloping back under them to the console
  b.box('plastic', [0.27, 0.55, -0.125], [0.42, 0.79, 0.125]);
  b.quad('plastic', V(0.27, 0.55, 0.125), V(0.27, 0.55, -0.125), V(0.06, 0.43, -0.125), V(0.06, 0.43, 0.125));
  b.tri('plastic', V(0.27, 0.55, -0.125), V(0.27, 0.43, -0.125), V(0.06, 0.43, -0.125));
  b.tri('plastic', V(0.27, 0.55, 0.125), V(0.06, 0.43, 0.125), V(0.27, 0.43, 0.125));
  // the climate controls on the slope: three knobs
  for (const z of [-0.06, 0, 0.06]) b.cylinder('plasticBlack', V(0.205, 0.505, z), V(0.19, 0.512, z), 0.017, 0.017, { segs: 14 });
  // the radio on top of the time circuits
  b.box('plasticBlack', [0.2, 0.77, -0.1], [0.3, 0.815, 0.1]);
  b.box('aluminium', [0.198, 0.785, -0.06], [0.2, 0.80, 0.03]);
  for (const z of [-0.08, 0.08]) b.cylinder('plasticBlack', V(0.2, 0.792, z), V(0.18, 0.792, z), 0.014, 0.014, { segs: 12 });
  // the steering column
  b.cylinder('plasticBlack', V(0.3, 0.62, -0.38), V(0.07, 0.69, -0.38), 0.04, 0.032, { segs: 14 });
  // the pedals
  for (const [z, w] of [[-0.52, 0.06], [-0.4, 0.07], [-0.27, 0.045]]) b.box('alloyDark', [0.6, 0.28, z - w / 2], [0.63, 0.37, z + w / 2]);
  // the door cards' armrests and pulls are on the doors (see the car)

  // --- the windscreen's mirror and the visors -------------------------------------------------
  b.box('plasticBlack', [0.0, 1.02, -0.11], [0.02, 1.065, 0.11]);
  b.box('chrome', [-0.002, 1.025, -0.105], [0.0, 1.06, 0.105]);
  b.box('plasticBlack', [0.01, 1.065, -0.01], [0.02, 1.1, 0.01]);
  for (const s of [1, -1]) b.soft('headliner', [-0.06, 1.095, s > 0 ? 0.12 : -0.62], [0.14, 1.115, s > 0 ? 0.62 : -0.12], 0.008, { k: 1 });

  // --- the gear lever and the time circuits' lever --------------------------------------------
  const shifter = new Group();
  shifter.position.set(-0.04, 0.475, 0);
  const sb = new Builder();
  sb.lathe('leatherDark', V(0, 0, 0), V(0, 1, 0), [[0.05, 0], [0.04, 0.02], [0.022, 0.05], [0.012, 0.08]], { segs: 14 });
  sb.cylinder('chrome', V(0, 0.07, 0), V(0, 0.15, 0), 0.007, 0.007, { segs: 8 });
  const shifterMesh = sb.build(M);
  shifter.add(shifterMesh);
  const knob = new Mesh(new SphereGeometry(0.025, 16, 12), M.plasticBlack);
  knob.position.y = 0.165;
  shifter.add(knob);
  root.add(shifter);
  live.shifter = shifter;
  const tcLever = new Group();
  tcLever.position.set(-0.2, 0.475, 0.1);
  const lb = new Builder();
  lb.box('plasticBlack', [-0.015, 0, -0.012], [0.015, 0.02, 0.012]);
  lb.cylinder('plasticBlack', V(0, 0.01, 0), V(0.16, 0.06, 0), 0.01, 0.009, { segs: 8 });
  lb.cylinder('plasticBlack', V(0.16, 0.06, -0.035), V(0.16, 0.06, 0.035), 0.012, 0.012, { segs: 10 });
  tcLever.add(lb.build(M));
  root.add(tcLever);
  live.tcLever = tcLever;

  // --- the steering wheel ------------------------------------------------------------------------
  const wheelC = V(0.05, 0.695, -0.38), wheelN = V(-1, 0.42, 0).normalize();
  const steer = new Group();
  steer.position.copy(wheelC);
  steer.quaternion.setFromUnitVectors(Z, wheelN);
  const spin = new Group();
  steer.add(spin);
  const rim = new Mesh(new TorusGeometry(0.182, 0.016, 10, 48), M.wheelLeather);
  spin.add(rim);
  const wb = new Builder();
  // three spokes: left, right, a broad one down
  wb.box('wheelLeather', [-0.18, -0.02, -0.035], [-0.04, 0.018, -0.02]);
  wb.box('wheelLeather', [0.04, -0.02, -0.035], [0.18, 0.018, -0.02]);
  wb.box('wheelLeather', [-0.04, -0.18, -0.035], [0.04, -0.04, -0.02]);
  wb.soft('wheelLeather', [-0.065, -0.065, -0.06], [0.065, 0.06, -0.005], 0.02, { k: 2 });
  // Doc's switch pod on the hub: one green, two red rockers
  wb.box('plasticBlack', [-0.055, -0.03, -0.005], [0.055, 0.035, 0.012]);
  wb.box('wireGreen', [-0.045, -0.015, 0.012], [-0.02, 0.02, 0.022]);
  wb.box('red', [0.0, -0.015, 0.012], [0.02, 0.02, 0.022]);
  wb.box('red', [0.027, -0.015, 0.012], [0.047, 0.02, 0.022]);
  spin.add(wb.build(M));
  root.add(steer);
  live.steer = spin;
  // the stalks
  b.cylinder('plasticBlack', V(0.1, 0.69, -0.34), V(0.08, 0.74, -0.22), 0.007, 0.006, { segs: 6 });
  b.cylinder('plasticBlack', V(0.1, 0.69, -0.42), V(0.08, 0.72, -0.56), 0.007, 0.006, { segs: 6 });

  // --- the dials in the binnacle ---------------------------------------------------------------
  const dials = dmcDials();
  const clusterN = V(-1, 0.18, 0);
  const D = (key, r, y, z, x = 0.268) => { const d = dial(r, dials[key], V(x, y, z), clusterN, M); root.add(d); live.dials[key] = d.userData; return d; };
  D('speedo', 0.06, 0.705, -0.47);
  D('tach', 0.06, 0.705, -0.29);
  D('temp', 0.028, 0.735, -0.6); D('volt', 0.028, 0.672, -0.6);
  D('fuel', 0.028, 0.735, -0.16); D('oil', 0.028, 0.672, -0.16);

  // --- the time circuits -----------------------------------------------------------------------
  const tc = (live.tc = new TimeCircuitsFace());
  live.tcMats = [];
  const tcN = V(-1, 0.42, -0.36).normalize();
  for (let i = 0; i < 3; i++) {
    const y = 0.738 - i * 0.064, x = 0.232 - i * 0.012, z = -0.008 - i * 0.01;
    const w = 0.235, h = 0.0585;
    const c = V(x, y, z);
    const mat = new MeshStandardMaterial({ map: tc.base[i], emissiveMap: tc.glow[i], emissive: new Color(1, 1, 1), emissiveIntensity: 0, roughness: 0.42, metalness: 0.15 });
    live.tcMats.push(mat);
    const face = panel(w, h, c, tcN, V(0, 1, 0), mat);
    root.add(face);
    // the box behind the face
    const box = new Mesh(new BoxGeometry(w + 0.006, h + 0.004, 0.07), M.aluminium);
    box.quaternion.copy(face.quaternion);
    box.position.copy(c).addScaledVector(tcN, -0.036);
    root.add(box);
  }
  // the folded aluminium side cover to the right of the rows
  b.box('aluBrushed', [0.14, 0.58, 0.115], [0.27, 0.77, 0.13]);

  // --- the keypad box ---------------------------------------------------------------------------
  {
    const kc = V(0.15, 0.52, -0.105), kn = V(-1, 0.4, -0.25).normalize();
    const box = new Mesh(new BoxGeometry(0.075, 0.11, 0.05), M.keypadGreen);
    const q = new Quaternion().setFromUnitVectors(Z, kn);
    box.quaternion.copy(q); box.position.copy(kc).addScaledVector(kn, -0.025);
    root.add(box);
    const keyGeo = new BoxGeometry(0.014, 0.012, 0.008);
    const right = new Vector3(1, 0, 0).applyQuaternion(q), up = new Vector3(0, 1, 0).applyQuaternion(q);
    const labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', ''];
    for (let k = 0; k < 12; k++) {
      const col = k % 3, row = Math.floor(k / 3);
      const key = new Mesh(keyGeo, keyMaterial(labels[k], M));
      key.quaternion.copy(q);
      key.position.copy(kc).addScaledVector(right, 0.004 + (col - 1) * 0.018).addScaledVector(up, 0.03 - row * 0.017).addScaledVector(kn, 0.004);
      key.userData = { label: labels[k], rest: key.position.clone(), normal: kn.clone() };
      root.add(key);
      live.keys.push(key);
    }
    // the coloured lamps down its left edge
    live.lamps.keypad = [];
    ['#ff2a1a', '#ff9a1a', '#33ff55', '#2a7bff'].forEach((c, k) => {
      const m = new Mesh(new BoxGeometry(0.008, 0.008, 0.006), new MeshStandardMaterial({ color: new Color(c).multiplyScalar(0.3), emissive: new Color(c), emissiveIntensity: 0, roughness: 0.3 }));
      m.quaternion.copy(q);
      m.position.copy(kc).addScaledVector(right, -0.03).addScaledVector(up, 0.032 - k * 0.017).addScaledVector(kn, 0.003);
      root.add(m);
      live.lamps.keypad.push(m.material);
    });
  }

  // --- the digital speedometer on the dash ------------------------------------------------------
  {
    const sp = (live.speedo = new SpeedoFace());
    const box = new Mesh(new BoxGeometry(0.075, 0.05, 0.12), M.whitePlastic);
    box.position.set(0.345, 0.872, -0.06);
    root.add(box);
    const mat = new MeshStandardMaterial({ map: sp.base, emissiveMap: sp.glow, emissive: new Color(1, 1, 1), emissiveIntensity: 0, roughness: 0.5 });
    live.speedoMat = mat;
    root.add(panel(0.11, 0.045, V(0.307, 0.873, -0.06), V(-1, 0.25, 0), V(0, 1, 0), mat));
    // the two black boxes on the binnacle's top, left of it
    b.box('plasticBlack', [0.3, 0.875, -0.66], [0.39, 0.905, -0.47]);
    b.box('plasticBlack', [0.3, 0.875, -0.45], [0.39, 0.905, -0.27]);
  }

  // --- Doc's meters on the passenger side -------------------------------------------------------
  {
    const pn = V(-1, 0.55, -0.15).normalize();
    b.box('aluBrushed', [0.305, 0.84, 0.14], [0.36, 0.935, 0.62]);
    const prim = dial(0.042, dials.primary, V(0.296, 0.905, 0.2), pn, M, { needleColor: new Color(0.05, 0.05, 0.05) });
    const pow = dial(0.042, dials.power, V(0.296, 0.905, 0.3), pn, M, { needleColor: new Color(0.05, 0.05, 0.05) });
    root.add(prim, pow);
    live.dials.primary = prim.userData; live.dials.power = pow.userData;
    const rf = new MeshStandardMaterial({ map: roentgenFace(), roughness: 0.6 });
    root.add(panel(0.12, 0.08, V(0.296, 0.915, 0.47), pn, V(0, 1, 0), rf));
    const ring = new Group();
    ring.position.set(0.292, 0.887, 0.47);
    ring.quaternion.setFromUnitVectors(Z, pn);
    const needle = new Group();
    const nb = new Mesh(new BoxGeometry(0.0025, 0.06, 0.002), new MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
    nb.position.y = 0.03; needle.add(nb); ring.add(needle);
    root.add(ring);
    live.dials.plutonium = { needle };
    root.add(panel(0.13, 0.022, V(0.297, 0.858, 0.47), pn, V(0, 1, 0), new MeshStandardMaterial({ map: plateLabel('PLUTONIUM CHAMBER', { size: 40 }), roughness: 0.5 })));
    // the EMPTY lamp under the meters, and the row of indicator lamps at the right end
    const empty = new MeshStandardMaterial({ color: new Color(0.3, 0.02, 0.02), emissive: new Color(1, 0.05, 0.03), emissiveIntensity: 0, roughness: 0.3 });
    const el = new Mesh(new BoxGeometry(0.03, 0.016, 0.008), empty);
    el.position.set(0.297, 0.862, 0.27); el.quaternion.setFromUnitVectors(Z, pn);
    root.add(el);
    root.add(panel(0.04, 0.012, V(0.297, 0.848, 0.27), pn, V(0, 1, 0), new MeshStandardMaterial({ map: plateLabel('EMPTY', { size: 60 }), roughness: 0.5 })));
    live.lamps.empty = empty;
    live.lamps.indicators = [];
    ['#ff2a1a', '#ff2a1a', '#2a7bff', '#2a7bff'].forEach((c, k) => {
      const m = new MeshStandardMaterial({ color: new Color(c).multiplyScalar(0.25), emissive: new Color(c), emissiveIntensity: 0, roughness: 0.3 });
      const lamp = new Mesh(new BoxGeometry(0.028, 0.03, 0.02), m);
      lamp.position.set(0.33, 0.88, 0.69 + k * 0.032);
      root.add(lamp);
      live.lamps.indicators.push(m);
    });
  }

  // --- conduit along the console --------------------------------------------------------------
  tube(b, 'conduitGrey', [V(0.18, 0.56, 0.13), V(0.0, 0.47, 0.16), V(-0.4, 0.45, 0.16), V(-0.8, 0.5, 0.15), V(-0.88, 0.8, 0.12)], 0.016, { segs: 10 });
  tube(b, 'wireYellow', [V(0.2, 0.62, 0.135), V(0.02, 0.5, 0.15), V(-0.4, 0.48, 0.15), V(-0.8, 0.52, 0.13), V(-0.88, 0.82, 0.1)], 0.005, { segs: 5 });
  tube(b, 'wireRed', [V(0.2, 0.6, 0.137), V(0.02, 0.49, 0.152), V(-0.4, 0.47, 0.152), V(-0.8, 0.51, 0.135), V(-0.88, 0.81, 0.11)], 0.005, { segs: 5 });

  // --- the flux capacitor -----------------------------------------------------------------------
  {
    const fx = -0.86, fy = 0.94, w = 0.27, h = 0.31, d = 0.1;
    b.box('greyBox', [fx - d, fy - h / 2, -w / 2], [fx, fy + h / 2, w / 2]);
    b.box('aluminium', [fx - 0.004, fy - h / 2 + 0.02, -w / 2 + 0.02], [fx + 0.008, fy + h / 2 - 0.02, -w / 2 + 0.035]);
    b.box('aluminium', [fx - 0.004, fy - h / 2 + 0.02, w / 2 - 0.035], [fx + 0.008, fy + h / 2 - 0.02, w / 2 - 0.02]);
    b.box('aluminium', [fx - 0.004, fy + h / 2 - 0.035, -w / 2 + 0.02], [fx + 0.008, fy + h / 2 - 0.02, w / 2 - 0.02]);
    b.box('aluminium', [fx - 0.004, fy - h / 2 + 0.02, -w / 2 + 0.02], [fx + 0.008, fy - h / 2 + 0.035, w / 2 - 0.02]);
    b.box('well', [fx - 0.08, fy - h / 2 + 0.035, -w / 2 + 0.035], [fx - 0.075, fy + h / 2 - 0.035, w / 2 - 0.035]);
    // the three arms of the Y: up-left, up-right, down; each a glass tube with a lit rod in segments
    const c = V(fx - 0.045, fy + 0.01, 0);
    const arms = [V(0, 0.105, -0.085), V(0, 0.105, 0.085), V(0, -0.115, 0)];
    const segMats = [];
    for (let k = 0; k < 6; k++) segMats.push(new MeshStandardMaterial({ color: new Color(0.6, 0.58, 0.5), emissive: new Color(1.0, 0.88, 0.62), emissiveIntensity: 0, roughness: 0.2 }));
    const fb = new Builder();
    for (const a of arms) {
      const end = c.clone().add(a);
      fb.cylinder('glassTube', c.clone().addScaledVector(a, 0.12), end, 0.013, 0.013, { segs: 14, open: true });
      // the relay head at the outer end
      const L = a.length(), dir = a.clone().normalize();
      fb.cylinder('relay', end.clone().addScaledVector(dir, -0.005), end.clone().addScaledVector(dir, 0.03), 0.022, 0.022, { segs: 14 });
      fb.cylinder('relay', end.clone().addScaledVector(dir, 0.03), end.clone().addScaledVector(dir, 0.034), 0.016, 0.016, { segs: 14 });
      for (let k = 0; k < 6; k++) {
        const t0 = 0.12 + (k / 6) * 0.86, t1 = t0 + 0.86 / 6 - 0.01;
        // segment 0 is at the outer end, 5 at the centre: the light runs inward
        fb.cylinder(`seg${5 - k}`, c.clone().add(a.clone().multiplyScalar(1 - t0)), c.clone().add(a.clone().multiplyScalar(1 - t1)), 0.006, 0.006, { segs: 8 });
      }
      void L;
    }
    fb.cylinder('relay', c.clone().add(V(0.01, 0, 0)), c.clone().add(V(-0.03, 0, 0)), 0.024, 0.024, { segs: 16 });
    const fm = { glassTube: new MeshStandardMaterial({ color: new Color(0.55, 0.55, 0.52), roughness: 0.08, metalness: 0.2 }), relay: M.plasticBlack };
    segMats.forEach((m, k) => { fm[`seg${k}`] = m; });
    const fluxGroup = fb.build(fm);
    root.add(fluxGroup);
    live.flux = segMats;
    // the window over it and its warning
    const win = new Mesh(new PlaneGeometry(w - 0.07, h - 0.07));
    win.position.set(fx + 0.004, fy, 0); win.rotation.y = Math.PI / 2;
    root.add(win);
    live.fluxWindow = win;
    root.add(panel(0.17, 0.018, V(fx + 0.0085, fy + h / 2 - 0.0275, 0), V(1, 0, 0), V(0, 1, 0), new MeshStandardMaterial({ map: plateLabel('SHIELD EYES FROM LIGHT', { size: 34, bg: '#e8c21c', fg: '#111' }), roughness: 0.5 })));
    root.add(panel(0.2, 0.016, V(fx + 0.0085, fy - h / 2 + 0.0275, 0), V(1, 0, 0), V(0, 1, 0), new MeshStandardMaterial({ map: plateLabel('DISCONNECT CAPACITOR DRIVE BEFORE OPENING', { size: 22, bg: '#e8c21c', fg: '#111', w: 768 }), roughness: 0.5 })));
    // the cables from its top into the roof
    for (const [z, mat, r] of [[-0.06, 'conduit', 0.016], [0.0, 'wireRed', 0.009], [0.06, 'conduit', 0.016]]) tube(b, mat, [V(fx - 0.05, fy + h / 2, z), V(fx - 0.05, fy + h / 2 + 0.05, z * 1.4), V(fx - 0.02, 1.1, z * 2.4)], r, { segs: 8 });
  }

  // --- Part II: the SID behind the passenger seat ------------------------------------------------
  if (version === 'part2') {
    b.box('blackBox', [-0.9, 0.62, 0.48], [-0.86, 0.98, 0.72]);
  }

  root.add(b.build(M));
  return { group: root, live };
}

const _keyMats = new Map();
function keyMaterial(label, M) {
  if (_keyMats.has(label)) return _keyMats.get(label);
  let mat = M.keyWhite;
  if (label) {
    const c = canvas(64, 64), g = c.getContext('2d');
    g.fillStyle = '#c9c8c1'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#1b1b1b'; g.font = 'bold 40px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 32, 34);
    mat = new MeshStandardMaterial({ map: new CanvasTexture(c), roughness: 0.45 });
  }
  _keyMats.set(label, mat);
  return mat;
}
