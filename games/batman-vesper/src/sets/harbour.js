import {
  Group, Mesh, BufferGeometry, BufferAttribute, InstancedMesh, BoxGeometry, TorusGeometry, Matrix4, Color, Vector3, Quaternion, Euler,
  PointLight, SpotLight, MeshStandardMaterial, MathUtils, CanvasTexture, SRGBColorSpace, RepeatWrapping,
} from 'three';
import { pbr, mat, box, boxes, cylinder, prop, skyline, uvMeters } from '../../../../medengine/src/world/Kit.js';

/**
 * Vesper Harbour in a storm: the sea (Gerstner waves on the CPU, foam on the crests), the
 * MV Acheron (a 140 m freighter: lofted hull, containers, superstructure, bridge wings,
 * cranes, floodlights), the Nightjar (Batman's boat), the cranes of the container port and
 * the city behind. Two stagings: 'harbour' (the chase, the ship under way) and 'acheron'
 * (her deck, stopped).
 */

// ---------------------------------------------------------------------------
// The sea

const WAVES = [[0.25, 64, 1.5], [0.95, 33, 0.75], [-0.55, 19, 0.42], [1.7, 9.5, 0.2], [-1.25, 5.5, 0.09]];
export function waveAt(x, z, t, storm = 1, out = { y: 0, nx: 0, nz: 0 }) {
  let y = 0, dx = 0, dz = 0;
  for (const [ang, len, amp] of WAVES) {
    const k = (2 * Math.PI) / len, c = Math.sqrt(9.81 / k), dX = Math.cos(ang), dZ = Math.sin(ang);
    const f = k * (dX * x + dZ * z - c * t);
    const a = amp * storm;
    y += a * Math.sin(f);
    dx += a * k * dX * Math.cos(f); dz += a * k * dZ * Math.cos(f);
  }
  out.y = y; out.nx = -dx; out.nz = -dz;
  return out;
}

class Sea {
  constructor({ size = 520, n = 150, storm = 1 } = {}) {
    this.n = n; this.size = size; this.storm = storm;
    const g = new BufferGeometry();
    const N = (n + 1) * (n + 1);
    this.pos = new BufferAttribute(new Float32Array(N * 3), 3); this.pos.setUsage(35048);
    this.nor = new BufferAttribute(new Float32Array(N * 3), 3); this.nor.setUsage(35048);
    this.col = new BufferAttribute(new Float32Array(N * 3), 3); this.col.setUsage(35048);
    // radial spacing: dense near the centre, coarse at the horizon
    this.grid = new Float32Array((n + 1) * 2);
    for (let i = 0; i <= n; i++) { const u = (i / n) * 2 - 1; this.grid[i] = Math.sign(u) * Math.pow(Math.abs(u), 2.2) * size / 2; }
    const idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2); }
    g.setAttribute('position', this.pos); g.setAttribute('normal', this.nor); g.setAttribute('color', this.col);
    g.setAttribute('uv', new BufferAttribute(new Float32Array(N * 2), 2));
    g.setIndex(idx);
    const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.07, metalness: 0, vertexColors: true });
    m.userData.wetFactor = 0;
    this.mesh = new Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true; this.mesh.castShadow = false;
    this._w = { y: 0, nx: 0, nz: 0 };
  }
  update(t, centre) {
    const n = this.n, P = this.pos.array, Nn = this.nor.array, C = this.col.array, w = this._w;
    const cx = Math.round(centre.x / 4) * 4, cz = Math.round(centre.z / 4) * 4;
    let k = 0;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++, k++) {
      const x = cx + this.grid[i], z = cz + this.grid[j];
      waveAt(x, z, t, this.storm, w);
      P[k * 3] = x; P[k * 3 + 1] = w.y; P[k * 3 + 2] = z;
      const l = Math.hypot(w.nx, 1, w.nz);
      Nn[k * 3] = w.nx / l; Nn[k * 3 + 1] = 1 / l; Nn[k * 3 + 2] = w.nz / l;
      // foam where the crests are steep and high, streaked by the wind
      const steep = Math.hypot(w.nx, w.nz);
      const foam = MathUtils.clamp((w.y - 0.9 * this.storm) * 0.7 + steep * 0.9 - 0.45, 0, 1) * (0.6 + 0.4 * Math.sin(x * 0.7 + z * 0.3 + t));
      const base = 0.012;
      C[k * 3] = base + foam * 0.55; C[k * 3 + 1] = base * 1.25 + foam * 0.58; C[k * 3 + 2] = base * 1.4 + foam * 0.6;
    }
    this.pos.needsUpdate = true; this.nor.needsUpdate = true; this.col.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Lofted hulls

/** Lofts stations [{x, pts:[[y,z]...] (one side, keel to gunwale)}] into a closed hull mesh. */
function loft(stations, material, colorFn) {
  const pos = [], col = [], idx = [];
  const ring = stations[0].pts.length;
  for (const st of stations) {
    const side = [...st.pts.map(([y, z]) => [st.x, y, z]), ...st.pts.slice().reverse().map(([y, z]) => [st.x, y, -z])];
    for (const p of side) { pos.push(...p); const c = colorFn ? colorFn(p) : [1, 1, 1]; col.push(...c); }
  }
  const R = ring * 2;
  for (let s = 0; s < stations.length - 1; s++) for (let i = 0; i < R - 1; i++) {
    const a = s * R + i, b = a + R;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new Mesh(uvMeters(g), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function windowsTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 256, 128);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 12; i++) {
    if (Math.random() < 0.45) continue;
    x.fillStyle = Math.random() < 0.8 ? 'rgba(255,215,160,0.9)' : 'rgba(170,210,255,0.8)';
    x.fillRect(i * 21 + 5, j * 32 + 10, 12, 12);
  }
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

function acheron() {
  const g = new Group();
  // hull: stations from stern (-70) to bow (+70); half-width w, deck at y=10, keel at -8
  const st = [];
  for (let k = 0; k <= 24; k++) {
    const x = -70 + k * (140 / 24);
    const bow = MathUtils.smoothstep(x, 40, 70), stern = MathUtils.smoothstep(-x, 60, 70);
    const w = 11 * (1 - bow * 0.97) * (1 - stern * 0.25);
    const keel = -8 + bow * 6 + stern * 3;
    const flare = 1 + bow * 0.35;
    st.push({ x, pts: [[keel, 0.01], [keel + 1.5, w * 0.6], [keel + 4, w * 0.95], [2, w], [10, w * flare], [11.2, w * flare]] });
  }
  const hullM = mat(0xffffff, { roughness: 0.55, metalness: 0.3 });
  hullM.vertexColors = true; hullM.userData.streaks = true;
  g.add(loft(st, hullM, ([, y]) => (y < 1.2 ? [0.18, 0.025, 0.02] : [0.03, 0.03, 0.035])));
  // deck
  const deckM = pbr('metal_plate', { scale: 2, roughness: 0.7, puddles: true });
  g.add(boxes([[118, 0.4, 21, -2, 10, 0]], deckM, { cast: false }));
  // name on the bow and stern
  // railings
  const rail = mat(0xb0a070, { roughness: 0.5, metalness: 0.6 });
  const rails = [];
  for (const s of [-1, 1]) { rails.push([116, 0.06, 0.06, -2, 11.2, s * 10.4], [116, 0.05, 0.05, -2, 10.7, s * 10.4]); for (let x = -60; x <= 56; x += 2) rails.push([0.05, 1.0, 0.05, x, 10.7, s * 10.4]); }
  g.add(boxes(rails, rail));
  // containers: bays of stacks, with colour variation (instanced)
  const cont = pbr('container_side', { scale: 1, roughness: 0.6, streaks: true });
  const list = [];
  for (let x = -32; x <= 50; x += 13) for (let zi = -3; zi <= 3; zi++) {
    const h = (Math.abs(zi) === 3 ? 1 : 2) + ((x * 7 + zi * 3) % 3 === 0 ? 1 : 0);
    for (let k = 0; k < h; k++) list.push([x, 10.2 + 1.3 + k * 2.6, zi * 2.5]);
  }
  const ig = new BoxGeometry(12.2, 2.59, 2.44);
  const im = new InstancedMesh(uvMeters(ig), cont, list.length);
  const palette = [[0.55, 0.12, 0.08], [0.1, 0.25, 0.45], [0.75, 0.55, 0.12], [0.2, 0.35, 0.22], [0.5, 0.5, 0.52], [0.6, 0.3, 0.1]];
  const m4 = new Matrix4(), col = new Color();
  list.forEach((p, i) => { im.setMatrixAt(i, m4.makeTranslation(p[0], p[1], p[2])); const c = palette[(i * 7) % palette.length]; im.setColorAt(i, col.setRGB(c[0], c[1], c[2])); });
  im.castShadow = true; im.receiveShadow = true;
  g.add(im);
  // the one container: VTX-4471, aft row, its doors facing the stern
  g.add(box(12.2, 2.59, 2.44, cont, [-38.5, 11.5, -3.2]));
  // superstructure aft: five decks, then the bridge with wings
  const white = mat(0xd8d6cf, { roughness: 0.5, metalness: 0.2 });
  white.userData.streaks = true;
  for (let d = 0; d < 5; d++) g.add(box(12 - d * 0.6, 2.8, 18 - d * 0.4, white, [-56, 10.2 + 1.4 + d * 2.8, 0]));
  const winM = new MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.1, emissive: new Color(1.4, 1.2, 1.0), emissiveMap: windowsTexture() });
  for (let d = 0; d < 5; d++) for (const s of [-1, 1]) { const w = box(11, 1.0, 0.05, winM, [-56, 11.6 + d * 2.8, s * (9.02 - d * 0.2)], { cast: false }); g.add(w); }
  // bridge wings (catwalks) on deck 4, with railings
  for (const s of [-1, 1]) {
    g.add(box(3.4, 0.25, 5.5, white, [-52.5, 21.2, s * 11.6]));
    g.add(boxes([[3.4, 0.06, 0.06, -52.5, 22.3, s * 14.3], [0.06, 1.1, 5.5, -50.85, 21.75, s * 11.6], [0.06, 1.1, 5.5, -54.15, 21.75, s * 11.6]], rail));
  }
  // funnel
  g.add(box(5, 7, 4, mat(0x0d0d10, { roughness: 0.6 }), [-60, 27, 0]));
  g.add(box(5.05, 1.2, 4.05, mat(0x7a1010, { roughness: 0.5 }), [-60, 29.5, 0]));
  // deck cranes
  const craneM = mat(0xb08a20, { roughness: 0.5, metalness: 0.4 });
  for (const x of [-20, 8, 34]) {
    g.add(cylinder(0.9, 9, craneM, [x, 14.5, 9.2]));
    const jib = box(16, 0.9, 0.9, craneM, [x - 6, 18.5, 9.2]); jib.rotation.z = 0.35; g.add(jib);
  }
  // lights: floodlights on the deck from the superstructure; nav lights; mast light
  const lights = [];
  for (const [x, z] of [[-50, -6], [-50, 6], [-10, 0]]) {
    const s = new SpotLight(new Color(1, 0.72, 0.42), 1200, 60, 0.6, 0.6);
    s.position.set(x, x < -40 ? 24 : 22, z); s.target.position.set(x + 22, 10, z * 0.3);
    s.userData.volumetric = 0.8; s.userData.shadow = true;
    g.add(s, s.target); lights.push(s);
  }
  const navR = new PointLight(new Color(1, 0.05, 0.05), 40, 14); navR.position.set(-52.5, 22, -14.2); g.add(navR);
  const navG = new PointLight(new Color(0.05, 1, 0.2), 40, 14); navG.position.set(-52.5, 22, 14.2); g.add(navG);
  const mast = new PointLight(new Color(1, 0.95, 0.85), 60, 30); mast.position.set(60, 22, 0); g.add(mast);
  g.add(box(0.4, 12, 0.4, mat(0x222222), [60, 16, 0]));
  return g;
}

function nightjar() {
  const g = new Group();
  const st = [];
  for (let k = 0; k <= 12; k++) {
    const x = -5 + k * (10 / 12);
    const bow = MathUtils.smoothstep(x, 2, 5);
    const w = 1.45 * (1 - bow * 0.96);
    st.push({ x, pts: [[-0.55 + bow * 0.4, 0.01], [0.05 + bow * 0.2, w * 0.85], [0.95, w], [1.05, w * 0.98]] });
  }
  const hull = loft(st, mat(0x0a0a0c, { roughness: 0.25, clearcoat: 1, metalness: 0.3 }));
  g.add(hull);
  const dark = mat(0x101114, { roughness: 0.6 });
  g.add(box(9.4, 0.08, 2.4, mat(0x1b1c20, { roughness: 0.8 }), [-0.2, 0.92, 0]));
  g.add(box(1.0, 1.0, 1.2, dark, [0.2, 1.42, 0]));                        // console
  const glass = mat(0x0b0e12, { roughness: 0.03, clearcoat: 1 });
  const ws = box(0.05, 0.7, 1.6, glass, [0.75, 1.95, 0]); ws.rotation.z = -0.5; g.add(ws);
  const wheel = new Mesh(new TorusGeometry(0.19, 0.025, 8, 24), mat(0x222222, { roughness: 0.4, metalness: 0.5 }));
  wheel.position.set(-0.32, 1.72, 0); wheel.rotation.y = Math.PI / 2; wheel.rotation.x = -0.4; g.add(wheel);
  g.wheel = wheel;
  g.add(box(0.8, 1.0, 0.6, dark, [-4.9, 0.9, 0.55]), box(0.8, 1.0, 0.6, dark, [-4.9, 0.9, -0.55]));
  g.add(box(0.05, 0.05, 0.05, mat(0x000000, { emissive: 0xff2020, intensity: 8 }), [4.6, 1.0, -0.6]));
  g.add(box(0.05, 0.05, 0.05, mat(0x000000, { emissive: 0x20ff40, intensity: 8 }), [4.6, 1.0, 0.6]));
  const lamp = new SpotLight(new Color(0.85, 0.9, 1), 240, 70, 0.3, 0.5);
  lamp.position.set(1.2, 2.2, 0); lamp.target.position.set(30, -1, 0); lamp.userData.volumetric = 1;
  g.add(lamp, lamp.target);
  return g;
}

// ---------------------------------------------------------------------------

export async function build({ staging = 'harbour' } = {}) {
  const root = new Group();
  const sea = new Sea({ storm: 1 });
  root.add(sea.mesh);
  const ship = acheron();
  root.add(ship);
  const boat = nightjar();
  if (staging === 'harbour') root.add(boat);
  // the port behind: gantry cranes with lights, the city
  const portM = mat(0x8c2a1a, { roughness: 0.6, metalness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const x = -160 + i * 55, z = -230;
    root.add(boxes([[2, 40, 2, x - 10, 20, z], [2, 40, 2, x + 10, 20, z], [2, 40, 2, x - 10, 20, z + 18], [2, 40, 2, x + 10, 20, z + 18], [24, 3, 22, x, 41, z + 9], [3, 3, 70, x, 42, z - 12]], portM));
    const l = new PointLight(new Color(1, 0.7, 0.4), 900, 90); l.position.set(x, 44, z + 9); root.add(l);
  }
  root.add(boxes([[700, 4, 60, 0, 2, -260]], pbr('concrete_wall_006', { scale: 4 }), { cast: false }));
  const city = skyline({ centre: [0, -600], rInner: 80, rOuter: 600, ground: 4, downtown: [0, -700], count: 380, seed: 31 });
  root.add(city.group);
  try { for (const [x, z] of [[120, 60], [40, -70], [-60, 90]]) { const b = await prop('ocean_buoy', { scale: 1.6 }); b.position.set(x, 0, z); b.userData.buoy = true; root.add(b); } } catch { /* */ }
  const t0 = { v: 0 };
  const shipState = { x: 0, speed: staging === 'harbour' ? 4 : 0 };
  const boatState = { x: -150, z: 46, speed: 0, yaw: 0, on: false };
  const _w = { y: 0, nx: 0, nz: 0 };
  const update = (dt, t, T) => {
    t0.v = t;
    shipState.x += shipState.speed * dt;
    ship.position.x = shipState.x;
    // the ship rolls a little in the swell
    waveAt(ship.position.x, 0, t, 1, _w);
    ship.position.y = _w.y * 0.25; ship.rotation.z = _w.nx * 0.04; ship.rotation.x = _w.nz * 0.05;
    if (staging === 'harbour') {
      if (boatState.on) {
        // the boat closes on the ship's port quarter, bouncing over the swell
        const tx = shipState.x - 30, tz = 20;
        boatState.speed += ((boatState.x < tx ? 15 : shipState.speed) - boatState.speed) * Math.min(1, dt * 0.8);
        boatState.x += boatState.speed * dt;
        boatState.z += (tz - boatState.z) * Math.min(1, dt * 0.15);
      }
      waveAt(boatState.x, boatState.z, t, 1, _w);
      boat.position.set(boatState.x, _w.y + 0.1, boatState.z);
      boat.rotation.set(_w.nz * 0.5, 0, -_w.nx * 0.5 + Math.sin(t * 2.1) * 0.02);
      boat.wheel.rotation.z = Math.sin(t * 1.3) * 0.6;
      const B = T?.actors?.batman;
      if (B && boatState.on) {
        const p = new Vector3(-0.85, 0.96, 0).applyEuler(boat.rotation).add(boat.position);
        B.root.position.copy(p); B.yaw = Math.PI / 2;
        if (B.garments.cape) B.garments.cape.wind.set(-boatState.speed * 2.5, 2, 3);
        T.audio?.engineLoad?.(Math.min(1, boatState.speed / 15));
      }
    }
    for (const c of root.children) if (c.userData.buoy) { waveAt(c.position.x, c.position.z, t, 1, _w); c.position.y = _w.y - 0.6; }
    const cam = T?.stageE?.camera.position ?? new Vector3();
    sea.update(t, cam);
    city.update(t);
  };
  const deckY = 10.2;
  const marks = staging === 'harbour'
    ? { boat: { pos: [-150, 1, 46], yaw: 90 } }
    : {
      deckAft: { pos: [-46, deckY, 2], yaw: 90 }, deckGuard: { pos: [-41.5, deckY, 2.4], yaw: 270 }, containerRow: { pos: [-44.6, deckY, -3.2], yaw: 90 },
      bridgeWing: { pos: [-52.5, 21.35, 12.4], yaw: 200 }, bridgeWingBat: { pos: [-52.5, 21.35, 10.0], yaw: 20 }, bridgeStair: { pos: [-49.5, deckY, 8.5], yaw: 0 },
    };
  const points = staging === 'harbour' ? { acheron: [0, 14, 0] } : { container: [-44.6, 11.5, -3.2], acheron: [-56, 22, 0] };
  const specials = {
    async boat(T, { late }) {
      boatState.on = true;
      boatState.x = shipState.x - (late ? 210 : 150);
      const B = T.actors.batman;
      T.place('batman', [boatState.x, 1, boatState.z], 90);
      B.posture('steer', 0.01);
      B.lookAt(ship.position.clone().setY(14), 0.6);
      T._special = null;
      T.cut({ type: 'ews', on: 'batman', angle: 100, height: 1.5, lens: 28, move: 'track' });
      T.audio?.sfx('hull');
      await T.wait(3);
      T.cut({ type: 'mcu', on: 'batman', angle: 35, move: 'track', handheld: 1 });
      await T.wait(2.4);
      T.cut({ type: 'ots', over: 'batman', on: 'acheron', move: 'track', handheld: 0.8 });
      T.strike(0.25);
      await T.wait(2.2);
      T.cut({ type: 'ws', on: 'batman', angle: 160, height: 0.4, lens: 24, move: 'track', handheld: 1.2 });
    },
    async board(T) {
      T.cut({ type: 'ws', on: 'acheron', at: 'acheron', angle: 0, lens: 28 });
      T.audio?.sfx('grapple');
      await T.wait(1.2);
      T.audio?.sfx('land');
      boatState.on = false;
      await T.fade(1, 0.5);
    },
  };
  return {
    name: staging, root, marks, points, specials,
    sun: { dir: [0.3, 0.7, -0.4], color: [0.55, 0.65, 0.9], intensity: 0.12 },
    weather: { rain: 1, wind: 0.95, night: 1, overcast: 1, lightning: 0.6 },
    cityGlow: [0.06, 0.04, 0.025],
    fog: { density: 0.006, height: 0, falloff: 0.02, mist: 0.01, mistHeight: 3, maxDist: 300, anisotropy: 0.6, glow: [0.03, 0.025, 0.022] },
    exposure: { key: 0.12, minEV: -2, maxEV: 6 },
    grade: { lift: [0.008, 0.012, 0.02], gain: [0.98, 1, 1.03], shadowTint: [0.85, 0.98, 1.12], highTint: [1.02, 1.0, 0.95], saturation: 0.8, contrast: 1.12, temperature: -0.55, halation: 0.2 },
    envIntensity: 0.5,
    space: staging === 'acheron' ? 'deck' : 'open',
    update,
  };
}

void Quaternion; void Euler;
