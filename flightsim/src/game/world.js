/**
 * The place: Forge Field, a grass-and-asphalt aerodrome at 59 degrees north, 141 ft above the sea. One runway, 09/27,
 * 1200 x 23 m, marked and lit to the ICAO pattern (threshold bars, designators, centre line, aiming points, edge lights, a
 * four-box PAPI at each end that shows red and white by the angle you really see it from), a taxiway, an apron and hangars, a
 * windsock that flies in the simulated wind, a VOR on the field and an ILS on runway 27. Around it: fields, woods, a lake,
 * farms, and hills on the horizon. The sun is where it would be for the date, the hour and the latitude.
 */
import {
  Group, Mesh, PlaneGeometry, BoxGeometry, ConeGeometry, CylinderGeometry, SphereGeometry, InstancedMesh, DirectionalLight, Matrix4, Vector3,
  Quaternion, Color,
} from '../../../medengine/src/index.js';
import { mat, paint, Batch, box, tube, loft, disc } from './build.js';

const DEG = Math.PI / 180, NM = 1852;
export const FIELD = { name: 'Forge Field', ident: 'ESFG', elevFt: 141, heading: 96, magVar: 7, length: 1200, width: 23, latitude: 59.35 };
const H = FIELD.heading * DEG, F = { x: Math.sin(H), z: -Math.cos(H) }, R = { x: Math.cos(H), z: Math.sin(H) };
/** Position along the runway (metres toward the 27 threshold... positive toward heading 096) and across it (positive to the south). */
export const toField = (x, z) => ({ a: x * F.x + z * F.z, c: x * R.x + z * R.z });
export const fromField = (a, c) => ({ x: a * F.x + c * R.x, z: a * F.z + c * R.z });

function rnd(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

function landTexture() {
  return paint(2048, 2048, (c, W) => {
    const r = rnd(42);
    c.fillStyle = '#56703a'; c.fillRect(0, 0, W, W);
    const fields = ['#6f8a3f', '#7d9447', '#8a9a4c', '#a9a45a', '#bcae62', '#667f38', '#93874f', '#5f7a3a', '#74903f', '#9aa355'];
    for (let i = 0; i < 150; i++) {                              // a patchwork of fields, kept clear of the tile's edge so it repeats cleanly
      const w = 80 + r() * 260, h = 60 + r() * 200, x = 60 + r() * (W - 120 - w), y = 60 + r() * (W - 120 - h);
      c.save(); c.translate(x + w / 2, y + h / 2); c.rotate((r() - 0.5) * 0.5); c.fillStyle = fields[(r() * fields.length) | 0]; c.fillRect(-w / 2, -h / 2, w, h);
      c.strokeStyle = 'rgba(40,60,25,0.5)'; c.lineWidth = 3; c.strokeRect(-w / 2, -h / 2, w, h);
      if (r() < 0.5) { c.strokeStyle = 'rgba(0,0,0,0.06)'; c.lineWidth = 2; for (let k = -h / 2; k < h / 2; k += 9) { c.beginPath(); c.moveTo(-w / 2, k); c.lineTo(w / 2, k); c.stroke(); } }
      c.restore();
    }
    for (let i = 0; i < 900; i++) {                              // woods
      const x = r() * W, y = r() * W, s = 12 + r() * 46, g = 40 + r() * 30;
      if ((Math.sin(x * 0.006) + Math.cos(y * 0.007 + 1)) < 0.4) continue;
      c.fillStyle = `rgb(${g * 0.55 | 0},${g + 28 | 0},${g * 0.5 | 0})`; c.beginPath(); c.arc(x, y, s, 0, 7); c.fill();
    }
    c.strokeStyle = '#8f8a7c'; c.lineWidth = 5; c.beginPath(); c.moveTo(0, 700); c.bezierCurveTo(600, 640, 1300, 900, 2048, 700); c.stroke();     // a road that meets itself at the edges
    c.lineWidth = 3; c.beginPath(); c.moveTo(900, 0); c.bezierCurveTo(1000, 700, 700, 1400, 900, 2048); c.stroke();
    const id = c.getImageData(0, 0, W, W), d = id.data;         // grain
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.6; }
    c.putImageData(id, 0, 0);
  }, { repeat: [48, 48], aniso: 16 });
}
function grassTexture() {
  return paint(512, 512, (c, W) => {
    const r = rnd(7); c.fillStyle = '#5f7f3a'; c.fillRect(0, 0, W, W);
    for (let i = 0; i < 26000; i++) { const g = 90 + r() * 70; c.fillStyle = `rgb(${g * 0.62 | 0},${g | 0},${g * 0.36 | 0})`; c.fillRect(r() * W, r() * W, 2, 3 + r() * 5); }
  }, { repeat: [300, 120], aniso: 16 });
}
function asphaltTexture(base, rep) {
  return paint(512, 512, (c, W) => {
    const r = rnd(9); c.fillStyle = base; c.fillRect(0, 0, W, W);
    for (let i = 0; i < 30000; i++) { const g = 40 + r() * 60; c.fillStyle = `rgba(${g},${g},${g},0.35)`; c.fillRect(r() * W, r() * W, 2, 2); }
    c.strokeStyle = 'rgba(20,20,20,0.35)'; c.lineWidth = 1.5; for (let i = 0; i < 14; i++) { c.beginPath(); let x = r() * W, y = r() * W; c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 90; y += (r() - 0.5) * 90; c.lineTo(x, y); } c.stroke(); }
  }, { repeat: rep, aniso: 16 });
}

export function buildWorld(weather) {
  const group = new Group(); group.name = 'world';
  const field = new Group(); field.rotation.y = -H; group.add(field);          // in here: x is across (south +), -z is along toward 096
  const B = new Batch(), half = FIELD.length / 2, hw = FIELD.width / 2;
  const flat = (w, l, x, z, y, m) => B.add(new PlaneGeometry(w, l).rotateX(-Math.PI / 2).translate(x, y, z), m);
  const wet = { puddles: true };

  // ---- the land
  // (the countryside lies a little below the aerodrome's own surfaces, so the two never fight for the same pixels)
  const land = new Mesh(new PlaneGeometry(96000, 96000, 48, 48).rotateX(-Math.PI / 2), mat({ map: landTexture(), roughness: 0.95 }));
  land.position.y = -0.45; land.receiveShadow = true; group.add(land);
  const grassM = mat({ map: grassTexture(), roughness: 0.95, medType: 'foliage' });
  const asphalt = mat({ map: asphaltTexture('#34363a', [8, 400]), roughness: 0.9, ...wet }), concrete = mat({ map: asphaltTexture('#77797a', [30, 30]), roughness: 0.9, ...wet });
  const taxiM = mat({ map: asphaltTexture('#3d3f43', [4, 40]), roughness: 0.9, ...wet });
  const whiteP = mat({ color: 0xe9e9e4, roughness: 0.85 }), yellowP = mat({ color: 0xe0b41c, roughness: 0.85 });
  B.add(new PlaneGeometry(420, 1900, 6, 24).rotateX(-Math.PI / 2).translate(60, -0.035, 0), grassM);
  B.add(new PlaneGeometry(FIELD.width, FIELD.length + 120, 1, 22).rotateX(-Math.PI / 2).translate(0, -0.014, 0), asphalt);
  B.add(new PlaneGeometry(108.5, 10).rotateX(-Math.PI / 2).translate(11.5 + 54.25, -0.016, 0), taxiM);
  flat(80, 110, 160, 0, -0.015, concrete);

  // ---- runway markings (metres from the centre; both ends alike)
  const M = -0.002;
  for (const s of [-1, 1]) {
    const z0 = s * half;                                                        // this end's threshold
    for (let i = 0; i < 6; i++) flat(1.5, 30, (i - 2.5) * 3.2 + Math.sign(i - 2.5) * 0.9, z0 - s * 21, M, whiteP);       // threshold "piano keys"
    for (const x of [-5.5, 5.5]) flat(4, 36, x, z0 - s * (250 + 18), M, whiteP);                                         // aiming points
    for (const d of [150, 450]) for (const x of [-4.2, 4.2]) flat(1.5, 22.5, x, z0 - s * (d + 11), M, whiteP);           // touchdown zone
    flat(FIELD.width, 0.9, 0, z0 + s * 0.45, M, whiteP);
  }
  for (let z = -half + 95; z < half - 95; z += 50) flat(0.45, 30, 0, z + 15, M, whiteP);                                 // centre line
  for (const x of [-hw + 0.4, hw - 0.4]) flat(0.45, FIELD.length, x, 0, M, whiteP);                                      // side stripes
  B.add(new PlaneGeometry(95, 0.15).rotateX(-Math.PI / 2).translate(11.5 + 54, M, 0), yellowP);                           // taxiway centre line
  for (const dx of [0, 0.45]) B.add(new PlaneGeometry(0.15, 10).rotateX(-Math.PI / 2).translate(45 + dx, M, 0), yellowP); // holding position
  for (const dz of [-4, -2, 0, 2, 4]) B.add(new PlaneGeometry(0.15, 1).rotateX(-Math.PI / 2).translate(44.2, M, dz), yellowP);
  const numeral = (s) => mat({ map: paint(256, 256, (c, W) => { c.fillStyle = '#34363a'; c.fillRect(0, 0, W, W); c.fillStyle = '#e9e9e4'; c.font = 'bold 190px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s, W / 2, W / 2 + 10); }), roughness: 0.88 });
  const n09 = new Mesh(new PlaneGeometry(12, 12).rotateX(-Math.PI / 2), numeral('09')); n09.position.set(0, M, half - 48); field.add(n09);
  const n27 = new Mesh(new PlaneGeometry(12, 12).rotateX(-Math.PI / 2).rotateY(Math.PI), numeral('27')); n27.position.set(0, M, -half + 48); field.add(n27);

  // ---- buildings on the south side
  const wall = mat({ color: 0xb9b6ad, roughness: 0.8 }), roof = mat({ color: 0x6d3a2e, roughness: 0.7 }), door = mat({ color: 0x4a5560, roughness: 0.6, metalness: 0.4 });
  const hangar = (x, z, w, d, h) => {
    B.add(box(w, h, d, x, h / 2, z), wall).add(box(0.3, h * 0.8, d * 0.74, x - w / 2 - 0.05, h * 0.4, z), door);
    const s = [[-w / 2, h], [0, h + w * 0.16], [w / 2, h]].map(([px, py]) => [px, py]);
    B.add(loft([[...s, [w / 2, h - 0.01], [-w / 2, h - 0.01]].map(([px, py]) => [x + px, py, z - d / 2 - 0.4]), [...s, [w / 2, h - 0.01], [-w / 2, h - 0.01]].map(([px, py]) => [x + px, py, z + d / 2 + 0.4])], { capStart: true, capEnd: true }), roof);
  };
  hangar(225, -32, 26, 22, 7); hangar(225, 6, 26, 22, 7); hangar(222, 42, 18, 16, 5.5);
  B.add(box(8, 9, 8, 205, 4.5, -62), wall).add(box(9.4, 2.6, 9.4, 205, 10.3, -62), mat({ color: 0x2c3d4a, roughness: 0.2, metalness: 0.3 })).add(box(10, 0.4, 10, 205, 11.8, -62), roof);
  B.add(box(2.2, 1.6, 1.2, 150, 0.8, 52), mat({ color: 0xc03020, roughness: 0.5 })).add(box(3.2, 0.2, 2.2, 150, 2.6, 52), wall).add(tube([149, 0, 52], [149, 2.6, 52], 0.06), wall).add(tube([151, 0, 52], [151, 2.6, 52], 0.06), wall);
  // VOR on the north side: a counterpoise with a cone on it
  const vorAt = { a: -180, c: -330 };
  B.add(new CylinderGeometry(9, 9, 0.4, 28).translate(vorAt.c, 3.4, -vorAt.a), wall).add(new CylinderGeometry(2.4, 3, 3.2, 16).translate(vorAt.c, 1.6, -vorAt.a), wall).add(new ConeGeometry(1.6, 3.4, 16).translate(vorAt.c, 5.3, -vorAt.a), mat({ color: 0xf2f2f0, roughness: 0.5 }));
  B.build(field, { cast: true });

  // ---- lights
  const lampM = (color) => mat({ color: 0x222222, emissive: color, emissiveIntensity: 1, roughness: 0.4 });
  const ball = new SphereGeometry(0.16, 8, 6), tmp = new Matrix4();
  const place = (list, material) => { const im = new InstancedMesh(ball, material, list.length); list.forEach(([x, z, s = 1], i) => im.setMatrixAt(i, tmp.makeScale(s, s, s).setPosition(x, 0.35, z))); im.computeBoundingSphere(); im.frustumCulled = false; field.add(im); return im; };
  const edge = [], thr = [], end = [];
  for (let z = -half; z <= half + 1; z += 60) { edge.push([-hw - 1.5, z], [hw + 1.5, z]); }
  for (let i = 0; i < 8; i++) { const x = (i - 3.5) * 3.2; thr.push([x, half + 1.5, 1.2], [x, -half - 1.5, 1.2]); }
  const edgeL = place(edge, lampM(0xfff2cc)), thrL = place(thr, lampM(0x20ff50));
  const papi = [];
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {                       // left of the runway as you land; inner box set highest
    const x = s * (hw + 15 + i * 9) * 1, z = s * (half - 250);
    const m = new Mesh(new SphereGeometry(0.42, 10, 8), lampM(0xffffff)); m.position.set(s > 0 ? -Math.abs(x) : Math.abs(x), 0.6, z); field.add(m);
    papi.push({ m, angle: [3.5, 3.17, 2.83, 2.5][i] * DEG, dir: s });
  }
  const beacon = new Mesh(new SphereGeometry(0.5, 10, 8), lampM(0xffffff)); beacon.position.set(205, 12.6, -62); field.add(beacon);

  // ---- windsock: a tapered sleeve on a mast, free to swing
  const sock = new Group(); sock.position.set(-48, 6, 120); field.add(sock);
  field.add(Object.assign(new Mesh(tube([-48, 0, 120], [-48, 6.2, 120], 0.07), wall), { castShadow: true }));
  const sleeve = [];
  for (let i = 0; i < 5; i++) {
    const seg = new Group(), r0 = 0.45 - i * 0.055, r1 = 0.45 - (i + 1) * 0.055;
    const ringAt = (z, r) => Array.from({ length: 10 }, (_, k) => [r * Math.cos(k / 10 * 6.2832), r * Math.sin(k / 10 * 6.2832), z]);
    const m = new Mesh(loft([ringAt(0, r0), ringAt(0.72, r1)]), mat({ color: i % 2 ? 0xf2f2ee : 0xe8501c, roughness: 0.8, side: 2 })); m.castShadow = true;
    seg.add(m); (i ? sleeve[i - 1] : sock).add(seg); if (i) seg.position.z = 0.72; sleeve.push(seg);
  }

  // ---- trees, farms, hills, a lake
  const r = rnd(1234), trees = [];
  for (let i = 0; i < 5200 && trees.length < 3000; i++) {
    const cx = (r() - 0.5) * 9000, cz = (r() - 0.5) * 9000;
    if (Math.sin(cx * 0.0016 + 1) + Math.cos(cz * 0.0019) < 0.25) continue;
    const f = toField(cx, cz);
    if (Math.abs(f.c) < 150 && Math.abs(f.a) < 3200) continue;                // keep the strip and both approaches clear
    if (f.c > 0 && f.c < 300 && Math.abs(f.a) < 200) continue;
    trees.push([cx, cz, 7 + r() * 11, 0.7 + r() * 0.6]);
  }
  const cone = new ConeGeometry(0.28, 1, 7).translate(0, 0.62, 0), trunk = new CylinderGeometry(0.03, 0.04, 0.3, 5).translate(0, 0.15, 0);
  const leaves = new InstancedMesh(cone, mat({ color: 0x2f5a2a, roughness: 0.95, medType: 'foliage' }), trees.length), trunks = new InstancedMesh(trunk, mat({ color: 0x4a3a2a, roughness: 1 }), trees.length);
  const q = new Quaternion(), col = new Color();
  trees.forEach(([x, z, h, w], i) => { tmp.compose(new Vector3(x, 0, z), q, new Vector3(h * w, h, h * w)); leaves.setMatrixAt(i, tmp); trunks.setMatrixAt(i, tmp); leaves.setColorAt(i, col.setRGB(0.75 + r() * 0.4, 0.8 + r() * 0.35, 0.7 + r() * 0.3)); });
  for (const m of [leaves, trunks]) { m.computeBoundingSphere(); m.castShadow = true; group.add(m); }
  const farms = [];
  for (let i = 0; i < 220; i++) { const x = (r() - 0.5) * 16000, z = (r() - 0.5) * 16000, f = toField(x, z); if (Math.abs(f.c) < 400 && Math.abs(f.a) < 2500) continue; farms.push([x, z, 8 + r() * 14, 3 + r() * 3, 6 + r() * 6, r() * 3.14]); }
  const houses = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat({ color: 0xa8423a, roughness: 0.85 }), farms.length);
  farms.forEach(([x, z, w, h, d, a], i) => { tmp.compose(new Vector3(x, 0, z), q.setFromAxisAngle(new Vector3(0, 1, 0), a), new Vector3(w, h, d)); houses.setMatrixAt(i, tmp); houses.setColorAt(i, col.setRGB(0.7 + r() * 0.5, 0.7 + r() * 0.5, 0.7 + r() * 0.5)); });
  houses.computeBoundingSphere(); houses.castShadow = true; group.add(houses);
  const hills = new InstancedMesh(new SphereGeometry(1, 20, 10), mat({ color: 0x4d6a4a, roughness: 1 }), 26);
  for (let i = 0; i < 26; i++) { const a = i / 26 * 6.283 + r() * 0.2, d = 21000 + r() * 16000, w = 2500 + r() * 4500; tmp.compose(new Vector3(Math.sin(a) * d, -40, Math.cos(a) * d), q.identity(), new Vector3(w, 250 + r() * 650, w * (0.7 + r() * 0.6))); hills.setMatrixAt(i, tmp); }
  hills.computeBoundingSphere(); group.add(hills);
  const lake = new Mesh(disc(1, 48).rotateX(-Math.PI / 2), mat({ color: 0x1d3f55, roughness: 0.08, medType: 'water' })); lake.scale.set(900, 1, 520); lake.position.set(2600, -0.40, -1900); lake.rotation.y = 0.5; group.add(lake);

  // ---- the sun
  const sun = new DirectionalLight(0xfff1dc, 7); sun.castShadow = true; sun.position.set(-9, 13, 7);
  const sky = { night: 0, sunEl: 0.8 };

  // ---- what the wheels stand on
  const SURF = { h: 0, mu: 0.8, rr: 0.02, rough: 0, kind: 'asphalt' };
  function ground(x, z) {
    const a = x * F.x + z * F.z, c = x * R.x + z * R.z, w = 1 - 0.4 * weather.rain;
    const hard = (Math.abs(a) <= half + 60 && Math.abs(c) <= hw) || (Math.abs(a) <= 5 && c > 0 && c <= 121) || (c >= 120 && c <= 200 && Math.abs(a) <= 55);
    if (hard) { SURF.mu = 0.8 * w; SURF.rr = 0.02; SURF.rough = 0; SURF.kind = 'asphalt'; } else { SURF.mu = 0.55 * w; SURF.rr = 0.065; SURF.rough = Math.abs(c) < 210 && Math.abs(a) < 950 ? 0.012 : 0.03; SURF.kind = 'grass'; }
    return SURF;
  }

  const at = (a, c) => fromField(a, c);
  const nav = {
    vor: [{ id: 'FRG', freq: 113.9, y: 6, ...at(vorAt.a, vorAt.c) }],
    ils: [{ id: 'IFRG', freq: 110.3, course: 276, width: 3.0, angle: 3, loc: at(-half - 150, 0), gs: { ...at(half - 290, -55), y: 0 } }],
    com: [{ id: 'ATIS', kind: 'atis', freq: 126.025, ...at(0, 205) }, { id: 'Forge Radio', kind: 'unicom', freq: 122.8, ...at(0, 205) }],
  };
  const spawn = {
    ramp: { ...at(22, 165), heading: 276 }, runway: { ...at(half - 20, 0), heading: 276 }, runway09: { ...at(-half + 20, 0), heading: 96 },
    final: { ...at(half + 4 * NM, 0), heading: 276, alt: (4 * NM + 290) * Math.tan(3 * DEG) }, cruise: { ...at(3500, -2500), heading: 276, alt: 900 },
  };

  const _v = new Vector3();
  /** `cam`: the camera's world position (what the PAPI and the beacon are seen from). */
  function update(dt, cam, stage) {
    // sun, sky and weather
    const s = weather.sun(), el = s.el, night = sky.night = Math.min(1, Math.max(0, (2 * DEG - el) / (8 * DEG)));
    sky.sunEl = el;
    const up = el > -1 * DEG, e2 = up ? Math.max(el, 2 * DEG) : 35 * DEG, az = up ? s.az : s.az + 2.2;      // below the horizon the moon takes over
    sun.position.set(Math.sin(az) * Math.cos(e2) * 1000, Math.sin(e2) * 1000, -Math.cos(az) * Math.cos(e2) * 1000);
    const day = Math.min(1, Math.max(0, (el + 1 * DEG) / (14 * DEG))), cloud = weather.cloudCover;
    sun.intensity = up ? (0.6 + 6.8 * day) * (1 - 0.72 * Math.max(0, cloud - 0.6) / 0.4) : 0.12;
    if (up) sun.color.setRGB(1, 0.80 + 0.14 * day, 0.58 + 0.28 * day); else sun.color.setRGB(0.6, 0.7, 1);
    const rr = stage?.renderer;
    if (rr) { rr.cloudCover = Math.min(0.95, cloud); rr.weather.night = night; rr.weather.overcast = Math.max(0, (cloud - 0.7) / 0.3) * 0.9; rr.wetness = weather.rain; rr.rain = weather.rain; }
    // lamps come up as the light goes
    const glow = 0.15 + 26 * Math.max(night, cloud > 0.9 ? 0.25 : 0);
    edgeL.material.emissiveIntensity = glow; thrL.material.emissiveIntensity = glow * 1.4;
    const f = toField(cam.x, cam.z);
    for (const p of papi) {                                     // each box shows white above its angle and red below
      const along = p.dir > 0 ? -(f.a + (half - 250)) : f.a - (half - 250);
      const elv = Math.atan2(cam.y - 0.6, Math.max(along, 1));
      p.m.material.emissive.setRGB(1, elv > p.angle ? 1 : 0.04, elv > p.angle ? 0.92 : 0.03);
      p.m.material.emissiveIntensity = along > 5 ? 30 + 60 * night : 0;
    }
    const bt = (weather.time * 0.8) % 2;
    beacon.material.emissive.setRGB(bt < 1 ? 1 : 0.1, 1, bt < 1 ? 1 : 0.2); beacon.material.emissiveIntensity = (bt % 1) < 0.18 ? 40 * (0.2 + night) : 0;
    // the windsock
    const w = weather.wind(sock.position.x, 6, sock.position.z, _v, false), sp = Math.hypot(w.x, w.z);
    const wf = toField(w.x, w.z);                               // downwind direction in the field's own axes
    sock.rotation.y = Math.atan2(wf.c, -wf.a) + Math.sin(weather.time * 3.1) * 0.05 * Math.min(1, sp / 3);
    const droop = Math.max(0, 1 - sp / 7.7) * 0.42;             // straight out at 15 knots
    sleeve.forEach((g, i) => { g.rotation.x = droop * (i ? 1 : 0.6) + Math.sin(weather.time * 5 + i) * 0.03 * Math.min(1, sp / 2); });
  }
  return { group, sun, sky, ground, nav, spawn, update, toField, fromField };
}
