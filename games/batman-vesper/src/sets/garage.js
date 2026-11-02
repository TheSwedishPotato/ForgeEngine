import { Group, Object3D, PointLight, SpotLight, Color, Vector3 } from 'three';
import { pbr, mat, box, boxes, cylinder, prop, sign } from '../../../../medengine/src/world/Kit.js';
import { van, sedan } from './vehicles.js';

/**
 * Harrow Street Municipal Parking, level B3. 40 x 24 m of concrete under a 2.75 m ceiling,
 * a grid of columns, fluorescent tubes in rows (one dying), a stairwell door at the west
 * end, the ramp up at the east, and the white van in the aisle with its rear doors open.
 */
export async function build() {
  const root = new Group();
  const floor = pbr('concrete_floor_worn_001', { scale: 3, roughness: 0.9, puddles: true });
  const walls = pbr('concrete_wall_006', { scale: 2.5, streaks: false });
  const ceilingM = pbr('brushed_concrete', { scale: 3, roughness: 1 });
  const columnM = pbr('concrete_wall_006', { scale: 1.6 });
  const paintW = mat(0xb9b6a8, { roughness: 0.55 });
  const paintY = mat(0xc9a21c, { roughness: 0.5 });
  const paintK = mat(0x111111, { roughness: 0.6 });
  const steel = mat(0x5d6166, { roughness: 0.45, metalness: 0.8 });
  const X = 20, Z = 12, H = 2.75;
  root.add(boxes([[2 * X + 6, 0.3, 2 * Z, 3, -0.15, 0]], floor, { cast: false }));
  root.add(boxes([[2 * X + 6, 0.3, 2 * Z, 3, H + 0.15, 0]], ceilingM, { cast: false }));
  // walls (east end open to the ramp)
  root.add(boxes([[0.4, H, 2 * Z, -X - 0.2, H / 2, 0], [2 * X + 6, H, 0.4, 3, H / 2, -Z - 0.2], [2 * X + 6, H, 0.4, 3, H / 2, Z + 0.2]], walls));
  // downstand beams across, every 8 m, and columns
  const beams = [], cols = [];
  for (const x of [-16, -8, 0, 8, 16]) {
    beams.push([0.5, 0.45, 2 * Z, x, H - 0.225, 0]);
    for (const z of [-4.2, 4.2]) cols.push([0.62, H, 0.62, x, H / 2, z]);
  }
  root.add(boxes(beams, ceilingM));
  root.add(boxes(cols, columnM));
  // hazard paint on the column feet, and the level stencil
  const hz = [];
  for (const x of [-16, -8, 0, 8, 16]) for (const z of [-4.2, 4.2]) { hz.push([0.64, 0.5, 0.64, x, 0.25, z]); }
  root.add(boxes(hz, paintY, { cast: false }));
  for (const x of [-16, -8, 0, 8, 16]) for (const z of [-4.2, 4.2]) {
    for (const f of [1, -1]) {
      const s = sign(`B3·${String(((x + 16) / 8) * 2 + (z > 0 ? 2 : 1)).padStart(2, '0')}`, { w: 0.55, h: 0.3, color: '#e8e2cc', font: 'bold 150px sans-serif', intensity: 0.15, glow: false });
      s.position.set(x, 1.65, z + f * 0.315); s.rotation.y = f > 0 ? 0 : Math.PI;
      root.add(s);
    }
  }
  // bays: white lines along both sides
  const lines = [];
  for (let x = -18.5; x <= 18.5; x += 2.6) for (const z of [-8.2, 8.2]) lines.push([0.1, 0.012, 7.2, x, 0.006, z]);
  lines.push([2 * X, 0.012, 0.12, 0, 0.006, -4.6], [2 * X, 0.012, 0.12, 0, 0.006, 4.6]);
  root.add(boxes(lines, paintW, { cast: false }));
  // arrows down the aisle
  for (const x of [-12, 4]) root.add(box(1.8, 0.012, 0.25, paintW, [x, 0.006, 0], { cast: false }));
  // pipes and a cable tray under the ceiling
  root.add(cylinder(0.09, 2 * X + 6, steel, [3, H - 0.62, -10.6], { rotZ: Math.PI / 2 }));
  root.add(cylinder(0.06, 2 * X + 6, mat(0x8a2a1e, { roughness: 0.5 }), [3, H - 0.5, -10.2], { rotZ: Math.PI / 2 }));
  root.add(cylinder(0.05, 2 * X + 6, steel, [3, H - 0.55, 10.4], { rotZ: Math.PI / 2 }));
  root.add(boxes([[2 * X + 6, 0.06, 0.35, 3, H - 0.32, -2.2]], steel));
  // stairwell door (west) with its exit sign and a caged light
  const doorM = mat(0x2d4a5c, { roughness: 0.4, metalness: 0.4, clearcoat: 0.3 });
  root.add(box(0.1, 2.1, 1.0, doorM, [-X + 0.06, 1.05, -6]));
  root.add(box(0.12, 0.08, 1.15, steel, [-X + 0.06, 2.14, -6]));
  const exit = sign('EXIT', { w: 0.5, h: 0.18, color: '#2bff7a', bg: '#06200f', intensity: 4 });
  exit.position.set(-X + 0.15, 2.35, -6); exit.rotation.y = Math.PI / 2; root.add(exit);
  // the breaker panel on the north wall
  const panel = box(0.7, 1.0, 0.18, mat(0x6e7378, { roughness: 0.4, metalness: 0.6 }), [-12, 1.5, -Z + 0.09]);
  root.add(panel);
  root.add(box(0.3, 0.12, 0.02, mat(0x000000, { emissive: 0xffd040, intensity: 2 }), [-12, 1.9, -Z + 0.19], { cast: false }));
  // the ramp at the east end: a sloped slab rising out of the level
  const ramp = box(8, 0.3, 7, floor, [X + 6, 0.9, 0]);
  ramp.rotation.z = 0.22; root.add(ramp);
  // vehicles: the van in the aisle, cars in the bays
  const theVan = van({ open: true });
  theVan.position.set(3.5, 0, 0.6); theVan.rotation.y = 0.04;
  root.add(theVan);
  const cars = [[-17.2, -8.4, Math.PI / 2, 0x283039], [-9.4, -8.4, Math.PI / 2, 0x5a1414], [12.6, -8.4, Math.PI / 2, 0x1d2a20], [-12, 8.4, -Math.PI / 2, 0x7a7e84], [9.4, 8.4, -Math.PI / 2, 0x101418]];
  for (const [x, z, ry, c] of cars) { const s = sedan(c); s.position.set(x, 0, z); s.rotation.y = ry; root.add(s); }
  for (const [x, z, ry] of [[-4.2, -8.6, 0.05], [1.0, 8.6, Math.PI + 0.1], [17.2, 8.6, Math.PI]]) {
    try { const c = await prop('covered_car'); c.position.set(x, 0, z); c.rotation.y = ry + Math.PI / 2; root.add(c); } catch { /* model missing */ }
  }
  for (const [x, z] of [[-19, 10.8], [-18.2, 11.0], [19.2, -11]]) { try { const b = await prop('barrel_03'); b.position.set(x, 0, z); root.add(b); } catch { /* */ } }
  try { const c = await prop('wooden_crate_01'); c.position.set(-19.2, 0, 8.6); root.add(c); } catch { /* */ }
  // lights: rows of fluorescent tubes along the aisle and over the bays
  const tubes = [];
  const fixtureM = mat(0xdddddd, { roughness: 0.3, emissive: 0xe8f2ff, intensity: 5 });
  for (let x = -18; x <= 18; x += 6) for (const z of [-0.2, -8.2, 8.2]) {
    const L = new Object3D();
    L.position.set(x, H - 0.12, z);
    const flicker = x === 6 && z === -0.2;
    L.userData.light = { type: 'tube', length: 1.2, color: new Color(0.82, 0.92, 1.0), intensity: z === -0.2 ? 9 : 6, range: 9 };
    L.userData.radius = 0.02;
    L.userData.flicker = flicker;
    if (z === -0.2 && (x === 0 || x === 6 || x === -6)) L.userData.volumetric = 0.25;
    root.add(L);
    const fx = box(1.25, 0.05, 0.12, fixtureM, [x, H - 0.1, z], { cast: false });
    fx.userData.fixture = L;
    root.add(fx);
    tubes.push({ light: L, fixture: fx, base: L.userData.light.intensity, flicker });
  }
  // emergency lights (red) for the dark
  const emergency = [];
  for (const [x, z] of [[-19.5, -6], [0, -11.6], [0, 11.6], [19, 0]]) {
    const p = new PointLight(new Color(1, 0.12, 0.08), 0, 7);
    p.position.set(x, 2.3, z);
    root.add(p); emergency.push(p);
  }
  // sodium spill down the ramp from the street
  const ramplight = new SpotLight(new Color(1, 0.62, 0.3), 30, 18, 0.7, 0.8);
  ramplight.position.set(X + 6, 5, 0); ramplight.target.position.set(X - 2, 0, 0);
  ramplight.userData.volumetric = 0.5; ramplight.userData.shadow = true;
  root.add(ramplight, ramplight.target);
  // a key spot over the van (a single unshaded work lamp someone left), shadowed
  const key = new SpotLight(new Color(1, 0.95, 0.88), 18, 10, 0.75, 0.6);
  key.position.set(1, H - 0.2, -2.4); key.target.position.set(3, 0, 0.5); key.userData.shadow = true;
  root.add(key, key.target);
  let mode = 'on';
  const marks = {
    stairDoor: { pos: [-X + 0.9, 0, -6], yaw: 90 }, pillarB: { pos: [-8.6, 0, -3.6], yaw: 90 }, breaker: { pos: [-12, 0, -Z + 0.8], yaw: 180 },
    lightPool: { pos: [-2.5, 0, -0.8], yaw: 90 }, ramp: { pos: [X + 2, 0, 0], yaw: 90 }, van: { pos: [-0.6, 0, 0.6], yaw: 90 }, vanFront: { pos: [6.3, 0, -0.7], yaw: 270 },
    nadiaStart: { pos: [0.4, 0, 1.8], yaw: 270 }, kowStart: { pos: [-0.2, 0, 2.6], yaw: 120 }, dezStart: { pos: [14.5, 0, -1.2], yaw: 90 }, rookPhone: { pos: [8.5, 0, 3.5], yaw: 200 },
    standoffRook: { pos: [0.2, 0, -0.6], yaw: 270 }, standoffNadia: { pos: [-0.25, 0, -0.55], yaw: 270 }, standoffBat: { pos: [-3.6, 0, -0.9], yaw: 90 },
  };
  const points = { van: [1.0, 1.3, 0.6], breakerPanel: [-12, 1.5, -Z + 0.3], cam_stairs: [-X + 0.6, 1.7, -5.6], vanFrontP: [6.0, 1.1, 0.3] };
  return {
    name: 'garage', root, marks, points,
    bounds: { min: new Vector3(-X + 0.3, 0.25, -Z + 0.3), max: new Vector3(X + 8, H - 0.25, Z - 0.3) },
    sun: { dir: [0.2, 1, 0.3], color: [0.5, 0.6, 0.8], intensity: 0.0 },
    weather: { rain: 0, wind: 0, night: 1, overcast: 1, lightning: 0, wetness: 0.35 },
    fog: { density: 0.012, height: 0, falloff: 0.15, mist: 0, maxDist: 40, anisotropy: 0.5 },
    exposure: { key: 0.13, minEV: -3, maxEV: 6 },
    grade: { lift: [0.012, 0.016, 0.02], gamma: [1, 1, 1], gain: [1, 1.0, 0.98], shadowTint: [0.88, 1.0, 1.06], highTint: [1.0, 1.02, 0.96], saturation: 0.82, contrast: 1.1, temperature: -0.3, halation: 0.12 },
    envIntensity: 0.25,
    lights(m) {
      mode = m;
      for (const t of tubes) { t.light.userData.light.intensity = m === 'on' ? t.base : 0; t.fixture.material = m === 'on' ? fixtureM : mat(0x777777, { roughness: 0.3 }); }
      for (const e of emergency) e.intensity = m === 'emergency' ? 4 : 0;
      key.intensity = m === 'on' ? 18 : 0;
    },
    update(dt, t) {
      if (mode !== 'on') return;
      for (const tb of tubes) if (tb.flicker) {
        const f = Math.sin(t * 37) * Math.sin(t * 11.3) > 0.55 ? 0.08 : (Math.sin(t * 0.7) > 0.95 ? 0.3 : 1);
        tb.light.userData.light.intensity = tb.base * f;
      }
    },
  };
}
