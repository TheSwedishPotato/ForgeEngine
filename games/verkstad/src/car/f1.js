/**
 * A 2026-regulation Formula 1 car, as a workshop meets one (the customer's story is Claude's).
 *
 * What is different from a road car, and modelled so:
 *  - no jacking points. The carbon floor and its plank would crack on a two-post lift's arms:
 *    it goes up on its front and rear jacks (the long-handled ones a pit crew uses) and sits on
 *    stands;
 *  - centre-lock wheels: one nut each, done up with a wheel gun;
 *  - carbon-carbon brakes: discs 32 mm thick with hundreds of cooling holes, six-piston calipers;
 *  - the power unit cannot be started with a key. The coolant and oil have to be warmed by a
 *    heater cart first, and the engine is spun by an external starter pushed into the back of
 *    the gearbox;
 *  - the energy store and the 350 kW MGU-K are high-voltage. The ERS status light (green: safe,
 *    red: live) says whether the car may be touched; isolate it before any work near the
 *    power unit or the battery;
 *  - the steering wheel comes off on a quick release; the nose and front wing are one unit on
 *    two quick-release pins.
 */
import { B, C, T, S, L, TOR } from './assembly.js';

const NAME = { FL: 'front left', FR: 'front right', RL: 'rear left', RR: 'rear right' };

export function buildF1(A) {
  const s = A.spec, d = s.dims, zF = d.wheelbase / 2, zR = -d.wheelbase / 2;
  A.layout = { engZ: -1.05, engY: 0.32, hoodY: 0.7, fire: -0.5 };
  A.state.ersSafe = false;
  A.state.f1 = true;
  const P = 'paint';
  // the survival cell, the nose, the sidepods and the engine cover: lofted cross-sections
  // (z, half-width, bottom, top, roundness)
  A.add({ id: 'tub', name: 'Survival cell (carbon composite monocoque)', kind: 'body', sys: 'body', fixed: true, mass: 45, pos: [0, 0, 0], panel: 'f1',
    g: [{ t: 'loft', m: P, sec: [[1.3, 0.16, 0.08, 0.5, 3], [1.0, 0.22, 0.06, 0.6, 3], [0.6, 0.38, 0.05, 0.64, 4], [0.1, 0.42, 0.05, 0.64, 4], [-0.45, 0.42, 0.05, 0.66, 4], [-0.6, 0.36, 0.06, 0.72, 4]] },
      B(0.42, 0.02, 0.7, [0, 0.645, 0.45], 'carbon'),                     // cockpit rim
      B(0.36, 0.25, 0.04, [0, 0.52, 0.1], 'carbon')] });
  A.add({ id: 'nose', name: 'Nose and front wing assembly', kind: 'nosewing', sys: 'aero', mass: 9, price: 180000, pos: [0, 0, 0],
    fasteners: [{ id: 'pinL', name: 'nose quick-release pin (left)', size: 8, drive: 'pin', torque: 3, len: 0.5, stiffness: 0.5, pos: [0.12, 0.42, 1.32], axis: [1, 0, 0] }, { id: 'pinR', name: 'nose quick-release pin (right)', size: 8, drive: 'pin', torque: 3, len: 0.5, stiffness: 0.5, pos: [-0.12, 0.42, 1.32], axis: [-1, 0, 0] }],
    cond: { damage: 0, flap: 0 },
    g: [{ t: 'loft', m: P, sec: [[2.62, 0.04, 0.17, 0.24, 2.5], [2.3, 0.08, 0.16, 0.3, 2.5], [1.8, 0.12, 0.17, 0.42, 3], [1.3, 0.16, 0.08, 0.5, 3]] },
      ...[0, 1, 2, 3].map((i) => B(1.42 - i * 0.08, 0.012, 0.18 - i * 0.03, [0, 0.08 + i * 0.045, 2.62 - i * 0.12], i === 0 ? 'carbon' : P, [-0.08 - i * 0.12, 0, 0])),
      B(0.012, 0.26, 0.42, [0.72, 0.16, 2.48], 'carbon'), B(0.012, 0.26, 0.42, [-0.72, 0.16, 2.48], 'carbon')] });
  A.add({ id: 'sidepods', name: 'Sidepods and radiators', kind: 'sidepod', sys: 'cool', fixed: true, pos: [0, 0, 0],
    g: [{ t: 'loft', m: P, sec: [[0.55, 0.2, 0.12, 0.5, 2.5], [0.3, 0.52, 0.08, 0.56, 3], [-0.4, 0.5, 0.06, 0.5, 3], [-1.1, 0.3, 0.06, 0.38, 3], [-1.6, 0.14, 0.08, 0.3, 2.5]] }] });
  A.add({ id: 'cover', name: 'Engine cover', kind: 'enginecover', sys: 'body', mass: 4, price: 60000, pos: [0, 0, 0], need: ['ers'],
    fasteners: [1, 2, 3, 4, 5, 6].map((i) => ({ id: 'dz' + i, name: `quarter-turn fastener ${i}`, size: 6, drive: 'dzus', torque: 1, len: 0.25, stiffness: 0.2, pos: [(i % 2 ? 1 : -1) * 0.3, 0.42, -0.5 - Math.floor((i - 1) / 2) * 0.45], axis: [i % 2 ? 1 : -1, 0, 0] })),
    g: [{ t: 'loft', m: P, sec: [[-0.55, 0.3, 0.38, 0.9, 3], [-0.9, 0.28, 0.32, 0.86, 3], [-1.5, 0.18, 0.3, 0.68, 2.5], [-2.05, 0.09, 0.3, 0.46, 2]] },
      B(0.012, 0.3, 0.9, [0, 0.82, -1.45], P, [0.25, 0, 0]),                   // the shark fin
      L([[0.001, 0], [0.11, 0.0], [0.12, 0.02]], [0, 0.88, -0.48], 'z', 'carbon', { seg: 20 })] });   // the airbox mouth over the driver
  A.add({ id: 'halo', name: 'Halo (titanium)', kind: 'halo', sys: 'body', fixed: true, pos: [0, 0, 0],
    g: [T([[0, 0.66, 0.92], [0, 0.78, 0.78], [0.2, 0.8, 0.55], [0.26, 0.76, 0.28], [0.22, 0.66, 0.12]], 0.022, 'titanium'), T([[0, 0.78, 0.78], [-0.2, 0.8, 0.55], [-0.26, 0.76, 0.28], [-0.22, 0.66, 0.12]], 0.022, 'titanium')] });
  A.add({ id: 'floor', name: 'Floor, plank and diffuser', kind: 'floor', sys: 'aero', fixed: true, pos: [0, 0, 0], cond: { plankWear: 0.3 },
    g: [B(1.5, 0.012, 2.9, [0, 0.045, -0.4], 'carbon'), B(0.3, 0.01, 2.4, [0, 0.035, -0.3], 'plank'), B(1.0, 0.25, 0.4, [0, 0.13, -2.05], 'carbon', [0.35, 0, 0])] });
  A.add({ id: 'rearwing', name: 'Rear wing (active: corner and straight-line modes)', kind: 'rearwing', sys: 'aero', fixed: true, pos: [0, 0, 0], cond: { actuator: true },
    g: [B(0.95, 0.012, 0.3, [0, 0.82, -2.32], P, [-0.2, 0, 0]), B(0.95, 0.01, 0.18, [0, 0.93, -2.4], P, [-0.5, 0, 0]), B(0.012, 0.42, 0.5, [0.48, 0.78, -2.3], 'carbon'), B(0.012, 0.42, 0.5, [-0.48, 0.78, -2.3], 'carbon'), B(0.04, 0.5, 0.06, [0, 0.55, -2.2], 'carbon')] });
  A.add({ id: 'mirrorL', name: 'Mirror (left)', kind: 'mirror', sys: 'body', fixed: true, pos: [0.48, 0.66, 0.55], g: [B(0.16, 0.05, 0.04, [0, 0, 0], P), T([[-0.03, -0.02, 0], [-0.15, -0.1, 0.05]], 0.008, 'carbon')] });
  A.add({ id: 'mirrorR', name: 'Mirror (right)', kind: 'mirror', sys: 'body', fixed: true, pos: [-0.48, 0.66, 0.55], g: [B(0.16, 0.05, 0.04, [0, 0, 0], P), T([[0.03, -0.02, 0], [0.15, -0.1, 0.05]], 0.008, 'carbon')] });
  // cockpit
  A.add({ id: 'seat', name: 'Driver\'s seat (moulded)', kind: 'seat', sys: 'interior', fixed: true, pos: [0, 0.1, 0.25], g: [B(0.34, 0.05, 0.6, [0, 0, 0.1], 'carbon', [0.1, 0, 0]), B(0.34, 0.45, 0.05, [0, 0.25, -0.22], 'carbon', [-0.45, 0, 0])] });
  A.add({ id: 'f1wheel', name: 'Steering wheel (quick release)', kind: 'f1steering', sys: 'interior', mass: 1.3, price: 85000, clip: true, pos: [0, 0.52, 0.86], cond: { ok: true },
    g: [B(0.27, 0.15, 0.04, [0, 0, 0], 'carbon'), B(0.1, 0.06, 0.01, [0, 0.02, -0.025], 'clusterScreen', [0, Math.PI, 0]), ...[-1, 1].map((sx) => B(0.05, 0.13, 0.05, [sx * 0.14, -0.02, 0], 'rubber'))] });
  A.add({ id: 'erslight', name: 'ERS status light', kind: 'erslight', sys: 'ers', fixed: true, pos: [0, 0.92, -0.42], info: 'Green: the car is safe to touch. Red: the high-voltage system is live, do not touch the car', g: [B(0.06, 0.03, 0.03, [0, 0, 0], 'ersLight')] });
  A.add({ id: 'isolator', name: 'ERS isolation (high-voltage) switch', kind: 'isolator', sys: 'ers', fixed: true, pos: [0.25, 0.4, -0.55], info: 'Only with insulated gloves on. Isolating the energy store takes some seconds to discharge the DC link', g: [B(0.05, 0.05, 0.03, [0, 0, 0], 'orange')] });
  // the power unit: 90° V6, its turbo, the MGU-K, the energy store under the fuel cell
  const EY = A.layout.engY, EZ = A.layout.engZ;
  A.add({ id: 'engine', name: '1.6 l V6 turbo internal combustion engine', kind: 'engine', sys: 'engine', fixed: true, mass: 150, pos: [0, EY, EZ],
    cond: { oil: s.engine.oil.capacity, oilAge: 300, oilGrade: s.engine.oil.grade, sludge: 0, comp: [1, 1, 1, 1, 1, 1], blowby: 0, coolant: 1, headGasket: true, timing: true, warm: 20 },
    g: [B(0.22, 0.24, 0.5, [0, 0, 0], 'engineGrey'), B(0.12, 0.16, 0.48, [0.13, 0.14, 0], 'alu', [0, 0, -0.75]), B(0.12, 0.16, 0.48, [-0.13, 0.14, 0], 'alu', [0, 0, 0.75]),
      C(0.075, 0.12, [0, 0.08, 0.3], 'z', 'exhaustHot', { seg: 20 }), ...[1, -1].map((sx) => T([[sx * 0.18, 0.12, 0.2], [sx * 0.22, 0.05, 0], [sx * 0.2, 0.0, -0.3]], 0.02, 'exhaustHot'))] });
  A.add({ id: 'mguk', name: 'MGU-K (350 kW)', kind: 'mguk', sys: 'ers', fixed: true, pos: [-0.14, EY - 0.08, EZ + 0.18], cond: { ok: true, temp: 30 }, g: [C(0.07, 0.18, [0, 0, 0], 'z', 'carbon'), T([[0, 0.06, 0.05], [0.05, 0.12, 0.35], [0.1, 0.15, 0.6]], 0.01, 'hvCable')] });
  A.add({ id: 'es', name: 'Energy store (lithium-ion)', kind: 'es', sys: 'ers', fixed: true, pos: [0, 0.12, -0.35], cond: { soc: 0.4, ok: true }, g: [B(0.36, 0.12, 0.3, [0, 0, 0], 'carbon'), B(0.04, 0.02, 0.02, [0.12, 0.07, 0], 'orange')] });
  A.add({ id: 'gearbox', name: '8-speed seamless-shift gearbox', kind: 'gearbox', sys: 'drive', fixed: true, pos: [0, 0.3, -1.75], g: [B(0.18, 0.2, 0.55, [0, 0, 0], 'carbon'), C(0.04, 0.06, [0, -0.02, -0.3], 'z', 'titanium')] });
  A.add({ id: 'starterport', name: 'External starter socket (rear of gearbox)', kind: 'starterport', sys: 'engine', fixed: true, pos: [0, 0.28, -2.1], info: 'The starter\'s shaft goes in here; the car has no starter of its own', g: [C(0.025, 0.02, [0, 0, 0], 'z', 'steel')] });
  A.add({ id: 'coolantport', name: 'Heater cart coolant connections', kind: 'coolantport', sys: 'cool', fixed: true, pos: [0.42, 0.35, -0.3], g: [C(0.015, 0.03, [0, 0, 0], 'x', 'blueCap')] });
  // the corners: suspension in tubes, carbon brakes, centre-lock wheels
  for (const k of ['FL', 'FR', 'RL', 'RR']) {
    const ax = k[0], sx = k[1] === 'L' ? 1 : -1, z = ax === 'F' ? zF : zR;
    const R = ax === 'F' ? s.wheels.tyreR : s.wheels.tyreRR, W = ax === 'F' ? s.wheels.tyreW : s.wheels.tyreWR;
    const tr = ax === 'F' ? d.trackF : d.trackR, x = (sx * tr) / 2, rimR = (18 * 0.0254) / 2, Bk = s.brakes[ax];
    const prof = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12, a = Math.PI * (t - 0.5); prof.push([rimR + (R - rimR) * (0.6 + 0.4 * Math.cos(a) ** 0.25), (W / 2) * Math.sin(a) * 1.02]); }
    A.add({ id: 'wheel' + k, name: `${NAME[k]} wheel and tyre (${ax === 'F' ? '280/705' : '375/710'} R18 slick)`, kind: 'wheel', sys: 'wheel', corner: k, side: k[1], mass: ax === 'F' ? 10 : 12, price: 18000, pos: [x, R, z], need: ['raised'],
      fasteners: [{ id: 'nut', name: 'centre-lock wheel nut', size: s.wheels.size, torque: s.wheels.torque, len: 4, stiffness: 25, thread: s.wheels.thread, pos: [sx * (W / 2 + 0.02), 0, 0], axis: [sx, 0, 0] }],
      cond: { bar: s.wheels.pressure[ax], tread: 3, nail: false, leak: 0, imbalance: 0, season: 'slick', compound: 'medium', temp: 25, age: 0 },
      g: [{ t: 'lathe', prof, p: [0, 0, 0], ax: 'x', m: 'tyre', seg: 40 }, C(rimR - 0.005, W - 0.03, [0, 0, 0], 'x', 'rimDark', { seg: 32 }), TOR(R - 0.035, 0.004, [sx * (W / 2 - 0.004), 0, 0], 'x', 'tyreYellow', { seg: 48 }), C(0.045, 0.05, [sx * (W / 2 + 0.01), 0, 0], 'x', 'titanium', { seg: 6 })] });
    A.add({ id: 'disc' + k, name: `${NAME[k]} carbon brake disc`, kind: 'disc', sys: 'brake', corner: k, side: k[1], mass: 1.2, price: 22000, pos: [x - sx * (W / 2 - 0.07), R, z], blockers: ['wheel' + k, 'caliper' + k], need: ['raised'],
      cond: { t: Bk.disc.t * 1000, min: Bk.disc.min * 1000, runout: 0.01, nominal: Bk.disc.t * 1000, rust: 0, carbon: true }, g: [L([[0.1, -0.016], [Bk.disc.d / 2, -0.016], [Bk.disc.d / 2, 0.016], [0.1, 0.016]], [0, 0, 0], 'x', 'carbonDisc', { seg: 40 })] });
    A.add({ id: 'caliper' + k, name: `${NAME[k]} brake caliper (${Bk.pistons}-piston monobloc)`, kind: 'caliper', sys: 'brake', corner: k, side: k[1], mass: 1.4, price: 40000, pos: [x - sx * (W / 2 - 0.07), R + 0.12, z - 0.05], blockers: ['wheel' + k], need: ['raised'],
      fasteners: [{ id: 'b1', name: 'caliper bolt', size: 12, torque: 40, len: 5, pos: [-sx * 0.04, 0.04, 0], axis: [-sx, 0, 0] }, { id: 'b2', name: 'caliper bolt', size: 12, torque: 40, len: 5, pos: [-sx * 0.04, -0.04, 0], axis: [-sx, 0, 0] }],
      cond: { seized: false, leak: false }, g: [B(0.06, 0.14, 0.12, [0, 0, 0], 'caliperPaint')] });
    for (const io of ['I', 'O']) A.add({ id: `pad${io}${k}`, name: `${NAME[k]} carbon brake pad (${io === 'O' ? 'outer' : 'inner'})`, kind: 'pad', sys: 'brake', corner: k, side: k[1], mass: 0.2, price: 6000, clip: true,
      pos: [x - sx * (W / 2 - 0.07) + (io === 'O' ? sx : -sx) * 0.03, R + 0.12, z - 0.05], blockers: ['caliper' + k], need: ['raised'], cond: { mm: Bk.padMM, nominal: Bk.padMM, glazed: false, squealer: false },
      g: [B(0.03, 0.06, 0.1, [0, 0, 0], 'carbonDisc')] });
    // wishbones (push-rod front, pull-rod rear) and the upright
    const inX = sx * 0.2, hub = [x - sx * (W / 2 - 0.05), R, z];
    A.add({ id: 'susp' + k, name: `${NAME[k]} wishbones, ${ax === 'F' ? 'push' : 'pull'} rod and upright`, kind: 'wishbone', sys: 'susp', corner: k, side: k[1], fixed: true, pos: [0, 0, 0], cond: { play: 0 },
      g: [T([hub.map((v, i) => v + (i === 1 ? 0.12 : 0)), [inX, 0.42, z + 0.25]], 0.014, 'carbon'), T([hub.map((v, i) => v + (i === 1 ? 0.12 : 0)), [inX, 0.42, z - 0.25]], 0.014, 'carbon'),
        T([hub.map((v, i) => v - (i === 1 ? 0.1 : 0)), [inX, 0.2, z + 0.3]], 0.014, 'carbon'), T([hub.map((v, i) => v - (i === 1 ? 0.1 : 0)), [inX, 0.2, z - 0.3]], 0.014, 'carbon'),
        T(ax === 'F' ? [[hub[0], R - 0.1, z], [sx * 0.15, 0.6, z - 0.1]] : [[hub[0], R + 0.12, z], [sx * 0.18, 0.15, z + 0.1]], 0.012, 'titanium'),
        B(0.06, 0.26, 0.12, [hub[0] + sx * 0.0, R, z], 'titanium')] });
  }
}
