import { Group, Object3D, PointLight, SpotLight, Color, Vector3, Mesh, PlaneGeometry, ConeGeometry, CylinderGeometry, MeshStandardMaterial, CanvasTexture, SRGBColorSpace, RepeatWrapping } from 'three';
import { pbr, mat, box, boxes, cylinder, prop, skyline, extrude, uvMeters } from '../../../../medengine/src/world/Kit.js';

/**
 * St. Brigid's Cathedral: the north-west corner of the nave roof, sixty metres over Vesper.
 * A gargoyle (a lion's head on a corbel) juts from the parapet; Batman crouches on it.
 * Behind: the slate roof, a pinnacle, a saint in a niche. Below: the city, its towers lit,
 * streets of sodium light in the haze. Night (rain) or dawn.
 */
export function streetGlow({ size = 1400, y = -60, spacing = 70 } = {}) {
  // the street grid far below as an emissive texture: avenues of orange, a few white
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 1024, 1024);
  const step = 1024 / (size / spacing);
  for (let i = 0; i < 1024; i += step / 2) {
    const avenue = Math.round(i / step) * step === i;
    x.fillStyle = avenue ? 'rgba(255,150,60,0.8)' : 'rgba(255,140,55,0.35)';
    x.fillRect(0, i + Math.random() * 2, 1024, avenue ? 1.4 : 0.8);
    x.fillRect(i + Math.random() * 2, 0, avenue ? 1.4 : 0.8, 1024);
  }
  for (let k = 0; k < 900; k++) { x.fillStyle = Math.random() < 0.5 ? 'rgba(255,240,220,0.9)' : 'rgba(255,40,30,0.9)'; x.fillRect(Math.random() * 1024, Math.random() * 1024, 1.5, 1.5); }
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  const m = new MeshStandardMaterial({ color: 0x050506, roughness: 0.3, emissive: new Color(1, 1, 1), emissiveMap: t, emissiveIntensity: 0.9 });
  m.userData.puddles = false;
  const mesh = new Mesh(new PlaneGeometry(size, size), m);
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = y;
  mesh.userData.static = true;
  return mesh;
}

export async function build({ time = 'night' } = {}) {
  const dawn = time === 'dawn';
  const root = new Group();
  const stone = pbr('castle_wall_slates', { scale: 2.2, roughness: 1, streaks: true });
  const stoneTop = pbr('castle_wall_slates', { scale: 1.5, roughness: 1, puddles: true });
  const slate = pbr('grey_roof_tiles', { scale: 1.6, roughness: 0.9, streaks: true });
  const lead = mat(0x3a3d40, { roughness: 0.5, metalness: 0.6 });
  // parapet walk: a stone gutter path along the roof edge (x along the nave, z outward = +z)
  root.add(boxes([[30, 0.5, 2.4, -6, -0.25, -0.2]], stoneTop, { cast: false }));
  // the parapet: a wall with crenellations on the outside edge
  const par = [];
  par.push([30, 1.0, 0.45, -6, 0.5, 1.1]);
  for (let x = -20; x <= 8; x += 1.4) par.push([0.7, 0.45, 0.5, x, 1.22, 1.1]);
  root.add(boxes(par, stone));
  // the outer wall dropping away below the parapet (sixty metres), with buttresses
  root.add(boxes([[30, 60, 1.2, -6, -30.5, 1.0]], stone, { cast: false }));
  for (const x of [-17, -9, -1, 7]) root.add(boxes([[1.4, 50, 2.0, x, -35, 2.2], [1.1, 4, 1.6, x, -8.5, 2.0]], stone));
  // the nave roof rising behind (pitched slate) and its ridge
  const roof = box(30, 0.3, 12, slate, [-6, 4.6, -6.8]);
  roof.rotation.x = 0.72; root.add(roof);
  root.add(box(30, 0.35, 0.35, lead, [-6, 9.0, -11.2]));
  // the corner pinnacle behind the gargoyle
  root.add(box(2.2, 6, 2.2, stone, [3.2, 2.4, -0.4]));
  const spire = new Mesh(uvMeters(new ConeGeometry(1.25, 6.5, 4)), stone); spire.position.set(3.2, 8.6, -0.4); spire.rotation.y = Math.PI / 4; spire.castShadow = true; root.add(spire);
  for (const [dx, dz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) { const p = new Mesh(uvMeters(new ConeGeometry(0.28, 1.8, 4)), stone); p.position.set(3.2 + dx, 6.3, -0.4 + dz); p.castShadow = true; root.add(p); }
  // a pointed-arch niche with a saint
  const arch = extrude([[-0.75, 0], [0.75, 0], [0.75, 2.2], [0.35, 2.9], [0, 3.1], [-0.35, 2.9], [-0.75, 2.2]], 0.3, stone, { bevel: 0.03 });
  arch.position.set(0.4, 0.5, -0.2); root.add(arch);
  try { const st = await prop('gothic_statue', { scale: 1.0 }); st.position.set(0.4, 0.5, 0.25); st.rotation.y = 0.1; root.add(st); } catch { /* */ }
  // the gargoyle: a corbel out of the parapet, the lion's head at its end
  root.add(box(0.9, 0.7, 2.2, stone, [0, 0.75, 2.2]));
  root.add(box(0.7, 0.35, 0.9, stone, [0, 1.25, 2.7]));
  try { const lion = await prop('lion_head', { scale: 2.4 }); lion.position.set(0, 0.55, 3.25); lion.rotation.y = 0; root.add(lion); } catch { /* */ }
  // drip lines: rain pouring off the gargoyle's mouth is the rain pass's job; the stone streaks
  // the city
  const city = skyline({ centre: [0, 40], rInner: 140, rOuter: 1100, ground: -60, downtown: [220, 520], count: 560, seed: 11 });
  root.add(city.group);
  root.add(streetGlow({ y: -60.5 }));
  // a warm lamp in a lancet window below, and a cold flood on the west front
  const lamp = new PointLight(new Color(1, 0.6, 0.3), dawn ? 0 : 6, 8); lamp.position.set(-4, -2.5, 2.4); root.add(lamp);
  const flood = new SpotLight(new Color(0.75, 0.82, 1.0), dawn ? 0 : 900, 90, 0.35, 0.6);
  flood.position.set(-10, -40, 40); flood.target.position.set(0, 0, 1); flood.userData.volumetric = 0.8; flood.userData.shadow = true;
  root.add(flood, flood.target);
  // a rim from the city: a broad, dim warm light from below-front
  // the city lights the gargoyle from in front and below; the moon rims it from behind
  const cityRim = new SpotLight(new Color(1, 0.6, 0.32), dawn ? 0 : 9000, 90, 0.2, 0.9); cityRim.position.set(14, -18, 48); cityRim.target.position.set(0, 1.4, 2.7); root.add(cityRim, cityRim.target);
  const marks = { perch: { pos: [0, 1.42, 2.75], yaw: 0 }, ledge: { pos: [-3, 0, 0.4], yaw: 0 }, roofCenter: { pos: [-8, 0, -0.4], yaw: 90 } };
  const points = { gargoylePhone: [0.08, 0.95, 3.6], city: [140, -20, 300] };
  const specials = {
    async glide(T) {
      const B = T.actors.batman;
      // stand, open the cape, fall forward off the gargoyle, then glide down over the city
      B.posture('stand_wide', 0.4);
      await T.wait(0.6);
      T.cut({ type: 'ms', on: 'batman', angle: 180, height: 0.3 });
      await T.wait(0.8);
      T.audio?.sfx('whoosh');
      const start = B.position.clone();
      const path = (u) => new Vector3(start.x + Math.sin(u * 1.2) * 18, start.y - 4 - u * 38 + Math.sin(u * 3) * 2, start.z + 4 + u * 260);
      B.posture('glide', 0.35);
      let u = 0;
      T._special = (dt) => {
        u = Math.min(1, u + dt / 9);
        const p = path(u), q = path(Math.min(1, u + 0.01));
        B.root.position.copy(p);
        B.yaw = Math.atan2(q.x - p.x, q.z - p.z);
        if (B.garments.cape) B.garments.cape.wind.set(-(q.x - p.x) * 120, 8, -(q.z - p.z) * 120);
      };
      T.cut({ type: 'mls', on: 'batman', angle: 200, height: 1.2, move: 'track', lens: 24 });
      await T.wait(2.5);
      T.cut({ type: 'ws', on: 'batman', angle: 80, height: 3, move: 'track', lens: 20 });
      T.audio?.sfx('cape');
      await T.wait(2.2);
      T.cut({ type: 'cu', on: 'batman', angle: 20, move: 'track', lens: 50 });
      await T.wait(1.6);
      T.cut({ type: 'ews', on: 'batman', angle: 180, height: 12, move: 'track', lens: 24 });
      await T.wait(2.4);
      T._special = null;
      if (B.garments.cape) B.garments.cape.wind.set(0, 0, 0);
      await T.fade(1, 0.6);
    },
  };
  return {
    name: 'cathedral', root, marks, points, specials,
    sun: dawn ? { dir: [-0.6, 0.12, 0.8], color: [1.0, 0.72, 0.48], intensity: 3.5 } : { dir: [0.4, 0.6, -0.4], color: [0.55, 0.65, 0.9], intensity: 0.12 },
    weather: dawn ? { rain: 0, wind: 0.3, night: 0.12, overcast: 0.35, lightning: 0, wetness: 0.8 } : { rain: 0.75, wind: 0.6, night: 1, overcast: 0.95, lightning: 0.25 },
    cityGlow: [0.07, 0.045, 0.025],
    fog: dawn ? { density: 0.0035, height: -30, falloff: 0.02, mist: 0, maxDist: 400, anisotropy: 0.7, glow: [0, 0, 0] } : { density: 0.0018, height: -20, falloff: 0.006, mist: 0, maxDist: 500, anisotropy: 0.6, glow: [0.014, 0.009, 0.0055] },
    exposure: dawn ? { key: 0.18, minEV: -4, maxEV: 3 } : { key: 0.12, minEV: -2, maxEV: 6 },
    grade: dawn ? { lift: [0.01, 0.01, 0.02], gain: [1.04, 1.0, 0.95], shadowTint: [0.92, 0.98, 1.06], highTint: [1.06, 1.0, 0.92], saturation: 1.0, contrast: 1.06, temperature: 0.4, halation: 0.2 }
      : { lift: [0.008, 0.013, 0.022], gain: [0.98, 1, 1.02], shadowTint: [0.86, 0.98, 1.1], highTint: [1.04, 1.0, 0.94], saturation: 0.85, contrast: 1.12, temperature: -0.45, halation: 0.18 },
    envIntensity: dawn ? 1 : 0.6,
    space: 'open',
    update(dt, t) { city.update(t); },
  };
}
