/**
 * What it says on the things: the makers' and rating plates in the machine room, and the tower's tuned
 * mass damper (a steel ball hung near the top, as in Taipei 101) swinging against the sway.
 */
import { Mesh, SphereGeometry, Group } from 'three';
import { SHEAVE, MR, SPEC, floorY, FLOORS } from '../data/spec.js';
import { cylGeo } from './build.js';

/** A rating plate: lines of engraved text on a w x h (m) plate, facing +z turned by ry. */
function plate(labels, key, lines, w, h, pos, ry) {
  const pw = 512, ph = Math.round((pw * h) / w);
  const cell = labels.cell('plate:' + key, pw, ph, (g, W, H) => {
    g.lineWidth = 3; g.strokeRect(4, 4, W - 8, H - 8);
    const n = lines.length, lh = (H - 16) / n;
    lines.forEach((t, i) => { g.font = `${i === 0 ? 700 : 500} ${Math.round(lh * (i === 0 ? 0.62 : 0.5))}px Inter, Helvetica, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, W / 2, 8 + lh * (i + 0.5)); });
  });
  const q = labels.quad(cell, w, h, labels.engraved); q.position.set(...pos); q.rotation.y = ry;
  return q;
}

export function makePlates(game) {
  const L = game.labels, root = game.buildingGL.root, S = SPEC, y = MR.floor, cz = MR.z0 + 0.45;
  root.add(plate(L, 'machine', ['KONE', 'Gearless permanent-magnet synchronous machine', `${Math.round(S.machine.ratedPower / 1000)} kW · ${S.machine.ratedRpm.toFixed(0)} rpm · ${S.machine.maxTorque / 1000} kN·m max · ${S.machine.poles} poles`, `Sheave Ø ${Math.round(SHEAVE.r * 2000)} mm · rated speed ${S.ratedSpeed} m/s · 2 brake sets ${S.brakes.torque / 1000} kN·m each`], 0.62, 0.3, [SHEAVE.x, SHEAVE.y, SHEAVE.z - 0.8], Math.PI));
  root.add(plate(L, 'ropes', ['KONE UltraRope', `${S.ropes.n} carbon-fibre hoisting belts, 25 x 5 mm · ~${(S.ropes.kgPerM / S.ropes.n).toFixed(1)} kg/m each`], 0.9, 0.2, [SHEAVE.x - 0.2, y + 0.13, SHEAVE.z + 0.905], 0));
  root.add(plate(L, 'drive', ['Regenerative variable-frequency drive', 'four-quadrant · braking energy fed back to the building', `${Math.round(S.machine.ratedPower / 1000)} kW · encoder feedback · STO`], 0.6, 0.2, [-0.75, y + 1.75, cz + 0.1], 0));
  root.add(plate(L, 'etsl', ['Emergency terminal speed limiting (ETSL)', `reduced-stroke buffers: impact ≤ ${S.etsl.impact} m/s`], 0.5, 0.12, [-2.35, y + 1.55, cz + 0.006], 0));
  // the tuned mass damper: a 2 m steel ball on cables, top floor west wing
  const fy = floorY(FLOORS), g = new Group(); g.position.set(-12, fy + 2.0, -9); root.add(g);
  const ball = new Mesh(new SphereGeometry(1.3, 32, 20), game.M.steel); ball.castShadow = true; g.add(ball);
  for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) { const c = new Mesh(cylGeo(0.03, 2.2, 'y', 6), game.M.rope); c.position.set(x * 0.8, 1.9, z * 0.8); g.add(c); }
  game.world.solid([-13.4, fy, -10.4], [-10.6, fy + 3.4, -7.6]);
  root.add(plate(L, 'tmd', ['Tuned mass damper', `2 % of the tower's modal mass · tuned to ${(game.sim.atmos.wd / (2 * Math.PI)).toFixed(3)} Hz`, 'it swings against the sway and soaks it up'], 0.8, 0.22, [-12, fy + 1.1, -7.55], 0));
  return { update() { const A = game.sim.atmos, d = A.dir + A.nd, cs = Math.cos(d), sn = Math.sin(d); ball.position.set(A.u[0] * cs - A.u[1] * sn, 0, A.u[0] * sn + A.u[1] * cs); } };
}
