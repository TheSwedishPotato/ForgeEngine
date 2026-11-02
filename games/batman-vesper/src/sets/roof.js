import { Group, PointLight, SpotLight, Color, Vector3 } from 'three';
import { pbr, mat, box, boxes, prop, skyline, sign } from '../../../../medengine/src/world/Kit.js';
import { sedan, van } from './vehicles.js';
import { streetGlow } from './cathedral.js';

/**
 * The open top deck of the Harrow Street garage, eight storeys up: wet concrete, a parapet,
 * sodium lamps throwing cones into the rain, the stair house with its caged light, a few
 * cars, and the skyline all around.
 */
export async function build() {
  const root = new Group();
  const deck = pbr('anti_slip_concrete', { scale: 3, roughness: 0.9, puddles: true });
  const wall = pbr('concrete_wall_006', { scale: 2.2, streaks: true });
  const paint = mat(0xc9c5b5, { roughness: 0.5 });
  const steel = mat(0x4a4e52, { roughness: 0.4, metalness: 0.8 });
  root.add(boxes([[40, 0.4, 30, 0, -0.2, 0]], deck, { cast: false }));
  // parapet around (the north edge, z = -15, is the ledge of chapter 3)
  root.add(boxes([[40, 1.1, 0.35, 0, 0.55, -15], [40, 1.1, 0.35, 0, 0.55, 15], [0.35, 1.1, 30, -20, 0.55, 0], [0.35, 1.1, 30, 20, 0.55, 0]], wall));
  root.add(boxes([[40, 26, 0.6, 0, -13.5, -15.2], [0.6, 26, 30, 20.2, -13.5, 0]], wall, { cast: false }));
  // bay lines
  const lines = [];
  for (let x = -17; x <= 17; x += 2.6) lines.push([0.1, 0.012, 5, x, 0.006, 8], [0.1, 0.012, 5, x, 0.006, -8]);
  root.add(boxes(lines, paint, { cast: false }));
  // the stair house
  root.add(boxes([[4, 3, 4, 14, 1.5, 9]], wall));
  root.add(box(0.1, 2.1, 1.0, mat(0x2d4a5c, { roughness: 0.4, metalness: 0.4 }), [11.95, 1.05, 9.5]));
  const caged = new PointLight(new Color(1, 0.85, 0.6), 5, 7); caged.position.set(11.7, 2.5, 9.5); caged.userData.volumetric = 0.3; root.add(caged);
  try { const cl = await prop('caged_hanging_light'); cl.position.set(11.75, 2.5, 9.5); root.add(cl); } catch { /* */ }
  const stencil = sign('LEVEL 8', { w: 1.2, h: 0.3, color: '#e8e2cc', glow: false, intensity: 0.2 });
  stencil.position.set(11.92, 2.5, 8.2); stencil.rotation.y = -Math.PI / 2; root.add(stencil);
  // lamp posts with sodium heads
  const lamps = [];
  for (const [x, z] of [[-12, -6], [0, -6], [-6, 6], [6, 6]]) {
    try { const l = await prop('street_lamp_01', { scale: 1 }); l.position.set(x, 0, z); root.add(l); } catch { root.add(box(0.15, 6, 0.15, steel, [x, 3, z])); }
    const s = new SpotLight(new Color(1, 0.6, 0.28), 70, 16, 0.95, 0.7);
    s.position.set(x, 5.6, z); s.target.position.set(x, 0, z + 0.4);
    s.userData.volumetric = 0.9; s.userData.shadow = lamps.length < 2;
    root.add(s, s.target); lamps.push(s);
  }
  for (const [x, z, ry, c] of [[-15.5, 8.2, Math.PI / 2, 0x3a3f46], [-8, -8.2, -Math.PI / 2, 0x51151a], [4, 8.2, Math.PI / 2, 0x1c2128]]) { const s = sedan(c); s.position.set(x, 0, z); s.rotation.y = ry; root.add(s); }
  const v = van({ open: false, dirt: 0.4 }); v.position.set(9, 0, -8.5); v.rotation.y = -Math.PI / 2; root.add(v);
  const city = skyline({ centre: [0, 0], rInner: 60, rOuter: 800, ground: -26, downtown: [180, -300], count: 520, seed: 23 });
  root.add(city.group);
  root.add(streetGlow({ y: -26.5 }));
  const marks = {
    roofLedge: { pos: [-4, 0, -13.6], yaw: 0 }, roofNadia: { pos: [-4.3, 0, -11.6], yaw: 180 }, roofDoor: { pos: [11.2, 0, 9.5], yaw: 225 }, roofEdge: { pos: [-2, 0, -14.2], yaw: 180 },
    ledgeHold: { pos: [2, 0, -14.35], yaw: 180 }, ledgeDangle: { pos: [2, -0.95, -15.95], yaw: 0 }, ledgeSafe: { pos: [2, 0, -13.3], yaw: 180 },
  };
  return {
    name: 'garageRoof', root, marks, points: { city: [180, -10, -300] },
    sun: { dir: [0.3, 0.7, 0.5], color: [0.55, 0.65, 0.9], intensity: 0.1 },
    weather: { rain: 0.6, wind: 0.5, night: 1, overcast: 0.95, lightning: 0.2 },
    cityGlow: [0.08, 0.05, 0.028],
    fog: { density: 0.008, height: -15, falloff: 0.02, mist: 0, maxDist: 300, anisotropy: 0.6, glow: [0.045, 0.03, 0.018] },
    exposure: { key: 0.1, minEV: -3, maxEV: 4.5 },
    grade: { lift: [0.01, 0.012, 0.02], gain: [1.0, 0.99, 0.98], shadowTint: [0.88, 0.98, 1.08], highTint: [1.06, 1.0, 0.9], saturation: 0.85, contrast: 1.1, temperature: -0.15, halation: 0.22 },
    envIntensity: 0.6,
    bounds: { min: new Vector3(-30, -4, -30), max: new Vector3(30, 20, 30) },
    space: 'open',
    update(dt, t) { city.update(t); },
  };
}
