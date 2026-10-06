import {
  Group, Mesh, BoxGeometry, CylinderGeometry, ConeGeometry, BufferGeometry, Float32BufferAttribute, MeshStandardMaterial,
  DoubleSide, TorusGeometry,
} from 'three';
import { canvas, finish, speckle, woodTexture } from './textures.js';
import { BUILDINGS, BUILDING, PLACES, NODES, EDGES, CASTLE, CASTLE_PLAN, addSolid, doorApproach } from '../world/town.js';
import { heightAt, castleTerraceY } from '../world/terrain.js';
import {
  Batch, barrel, tub, crate, sack, woodpile, cart, bench, trough, haystack, wattle, goods, stall, aleStake, well, pillory,
  privy, dungHeap, grave, stool,
} from './props.js';

// ---- textures (generated, tileable, one metre = 1 uv unless scaled) ---------------------------
const tex = {};
function make(key, W, H, draw) {
  if (tex[key]) return tex[key];
  const c = canvas(W, H), g = c.getContext('2d');
  draw(g, W, H);
  return (tex[key] = finish(c, { repeat: true }));
}
/** Lime plaster over wattle and daub: off-white, patchy, dirtier toward the foot. */
const plaster = () => make('plaster', 256, 256, (g, W, H) => {
  g.fillStyle = '#ddd2b8'; g.fillRect(0, 0, W, H);
  speckle(g, W, H, 2600, ['#c9bc9c', '#eee6d2', '#b8aa8a', '#d6c8a6'], 2, 12, 31);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(120,100,70,${0.03 + Math.random() * 0.05})`; g.beginPath(); g.ellipse(Math.random() * W, Math.random() * H, 10 + Math.random() * 40, 6 + Math.random() * 30, 0, 0, 7); g.fill(); }
});
/** Cut stone in courses with lime mortar. */
const ashlar = (base = '#b9b09c', key = 'ashlar') => make(key, 256, 256, (g, W, H) => {
  g.fillStyle = '#8a8270'; g.fillRect(0, 0, W, H);
  const rows = 8, rh = H / rows;
  for (let r = 0; r < rows; r++) {
    let x = (r % 2) * -24;
    while (x < W) {
      const w = 36 + Math.random() * 40;
      const v = (Math.random() - 0.5) * 26;
      const c0 = parseInt(base.slice(1), 16);
      const R = Math.min(255, ((c0 >> 16) & 255) + v), G = Math.min(255, ((c0 >> 8) & 255) + v), Bc = Math.min(255, (c0 & 255) + v * 0.9);
      g.fillStyle = `rgb(${R | 0},${G | 0},${Bc | 0})`;
      g.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
      x += w;
    }
  }
  speckle(g, W, H, 1800, ['rgba(60,55,45,0.25)', 'rgba(230,225,210,0.2)'], 1, 4, 7);
});
/** Rough rubble stone for plinths. */
const rubble = () => make('rubble', 128, 128, (g, W, H) => {
  g.fillStyle = '#6e685a'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) { const v = 100 + Math.random() * 70; g.fillStyle = `rgb(${v},${v - 6},${v - 16})`; g.beginPath(); g.ellipse(Math.random() * W, Math.random() * H, 6 + Math.random() * 10, 4 + Math.random() * 7, Math.random() * 3, 0, 7); g.fill(); }
});
const thatch = () => make('thatch', 256, 256, (g, W) => {
  g.fillStyle = '#8a744a'; g.fillRect(0, 0, W, W);
  for (let i = 0; i < 3200; i++) {
    const x = Math.random() * W, y = Math.random() * W;
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '60,48,28' : '186,166,112'},${0.15 + Math.random() * 0.3})`;
    g.lineWidth = 1 + Math.random();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y + 10 + Math.random() * 16); g.stroke();
  }
  for (let y = 0; y < W; y += 32) { g.fillStyle = 'rgba(40,30,15,0.28)'; g.fillRect(0, y, W, 3); }
});
const shingle = (base = [70, 40]) => make('shingle' + base, 256, 256, (g, W) => {
  g.fillStyle = '#5a4636'; g.fillRect(0, 0, W, W);
  for (let y = 0; y < W; y += 16) for (let x = (y / 16) % 2 ? -12 : 0; x < W; x += 24) {
    const v = base[0] + Math.random() * base[1];
    g.fillStyle = `rgb(${v + 20},${v},${v - 18})`; g.fillRect(x + 1, y + 1, 22, 15);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + 13, 24, 3);
  }
});
/** Fired clay roof tiles (monk and nun), for the castle and the church. */
const tiles = () => make('tiles', 256, 256, (g, W) => {
  g.fillStyle = '#6a2a1a'; g.fillRect(0, 0, W, W);
  for (let x = 0; x < W; x += 16) for (let y = (x / 16) % 2 ? -8 : 0; y < W; y += 22) {
    const v = Math.random() * 30;
    const grd = g.createLinearGradient(x, 0, x + 16, 0);
    grd.addColorStop(0, `rgb(${110 + v},${44 + v * 0.4},${28})`); grd.addColorStop(0.5, `rgb(${160 + v},${70 + v * 0.5},${44})`); grd.addColorStop(1, `rgb(${100 + v},${40},${26})`);
    g.fillStyle = grd; g.fillRect(x + 1, y, 14, 21);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y + 19, 16, 3);
  }
});
const hay = () => make('hay', 128, 128, (g, W) => {
  g.fillStyle = '#b89a52'; g.fillRect(0, 0, W, W);
  for (let i = 0; i < 1400; i++) { g.strokeStyle = `rgba(${Math.random() < 0.5 ? '120,96,40' : '230,206,140'},0.4)`; g.beginPath(); const x = Math.random() * W, y = Math.random() * W; g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 12, y + (Math.random() - 0.5) * 12); g.stroke(); }
});
const wattleTex = () => make('wattle', 64, 64, (g, W) => {
  g.fillStyle = '#5a4630'; g.fillRect(0, 0, W, W);
  for (let y = 0; y < W; y += 8) { g.fillStyle = 'rgba(140,110,70,0.6)'; g.fillRect(0, y + 1, W, 5); }
});

function std(opts) { return new MeshStandardMaterial({ roughness: 0.9, ...opts }); }

/** Materials by key (shared by the town, the castle and interiors). */
export function townMaterials() {
  if (tex.mats) return tex.mats;
  const m = {
    plaster: std({ map: plaster(), roughness: 0.95 }),
    limewash: std({ map: ashlar('#ddd6c4', 'limewash'), roughness: 0.92 }),
    stone: std({ map: ashlar(), roughness: 0.93 }),
    rubble: std({ map: rubble(), roughness: 1 }),
    beam: std({ map: woodTexture('#4a3422'), roughness: 0.85 }),
    planks: std({ map: woodTexture('#6b4c30'), roughness: 0.85 }),
    door: std({ map: woodTexture('#5a3e26'), roughness: 0.8 }),
    log: std({ map: woodTexture('#7a6248'), roughness: 0.95 }),
    logEnd: std({ color: '#b8956a', roughness: 0.95 }),
    stave: std({ map: woodTexture('#7a5634'), roughness: 0.75 }),
    thatch: std({ map: thatch(), roughness: 1, side: DoubleSide }),
    shingle: std({ map: shingle(), roughness: 0.9, side: DoubleSide }),
    shingleProp: std({ map: shingle([60, 30]), roughness: 0.9, side: DoubleSide }),
    tile: std({ map: tiles(), roughness: 0.8, side: DoubleSide }),
    iron: std({ color: '#2e2e30', metalness: 0.85, roughness: 0.55 }),
    dark: std({ color: '#140e0a', roughness: 1 }),
    hay: std({ map: hay(), roughness: 1 }),
    wattle: std({ map: wattleTex(), roughness: 1 }),
    sack: std({ color: '#b8a782', roughness: 1 }),
    bread: std({ color: '#9a6430', roughness: 0.8 }),
    pottery: std({ color: '#9a5a36', roughness: 0.7 }),
    meat: std({ color: '#8a3a32', roughness: 0.6 }),
    leather: std({ color: '#4a3020', roughness: 0.7 }),
    apple: std({ color: '#a8402a', roughness: 0.5 }),
    clothRed: std({ color: '#8a1c1c', roughness: 0.95 }),
    clothBlue: std({ color: '#1c3a6a', roughness: 0.95 }),
    awning: std({ color: '#b8a070', roughness: 0.95, side: DoubleSide }),
    awningRed: std({ color: '#9a2a20', roughness: 0.95, side: DoubleSide }),
    water: std({ color: '#2a3a3a', roughness: 0.08, metalness: 0.1 }),
    rope: std({ color: '#8a7a5a', roughness: 1 }),
    dung: std({ color: '#3a2c1c', roughness: 1 }),
    earthProp: std({ color: '#5a4630', roughness: 1 }),
    leaves: std({ color: '#3a5a2a', roughness: 0.9 }),
  };
  for (const k of ['sack', 'clothRed', 'clothBlue', 'awning', 'awningRed', 'rope']) m[k].userData.cloth = true;
  return (tex.mats = m);
}
const UVS = { plaster: 0.5, limewash: 0.45, stone: 0.4, rubble: 0.8, beam: 0.6, planks: 0.8, door: 1, log: 1, stave: 1.5, hay: 0.8, wattle: 1.2, tile: 0.7, shingle: 0.8, shingleProp: 0.8, thatch: 0.6 };

// ---- roofs --------------------------------------------------------------------------------------
/** A gabled roof slab (top surface with its own UVs) over a w x d box, ridge along the longer side. */
function roofSlab(w, d, rise, over, thick) {
  const along = w >= d;
  const L = (along ? w : d) / 2 + over, S = (along ? d : w) / 2 + over;
  const p = [], uv = [];
  const quad = (a, b, c, dd, u, v) => { p.push(...a, ...b, ...c, ...a, ...c, ...dd); uv.push(0, 0, u, 0, u, v, 0, 0, u, v, 0, v); };
  const sl = Math.hypot(S, rise) * 1.5;
  const map = (x, y, z) => (along ? [x, y, z] : [z, y, x]);
  for (const [dy, flip] of [[0, false], [-thick, true]]) {
    for (const side of [1, -1]) {
      const a = map(-L, dy, side * S), b = map(L, dy, side * S), c = map(L, rise + dy, 0), dd = map(-L, rise + dy, 0);
      if ((side > 0) !== flip !== along) quad(a, b, c, dd, L / 0.7, sl); else quad(b, a, dd, c, L / 0.7, sl);
    }
  }
  // the eaves' edge (thickness), front and back
  for (const side of [1, -1]) {
    const a = map(-L, 0, side * S), b = map(L, 0, side * S), c = map(L, -thick, side * S), dd = map(-L, -thick, side * S);
    if ((side > 0) !== along) quad(a, dd, c, b, L, 0.3); else quad(a, b, c, dd, L, 0.3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
/** A triangle in a vertical plane (gable end), centred, width W, height H, facing +z. */
function triangle(W, H) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-W / 2, 0, 0, W / 2, 0, 0, 0, H, 0, W / 2, 0, 0, -W / 2, 0, 0, 0, H, 0], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0.5, 1, 1, 0, 0, 0, 0.5, 1], 2));
  g.computeVertexNormals();
  return g;
}

// ---- a timber-framed house -----------------------------------------------------------------------
/**
 * Stone sill wall, plastered wattle-and-daub panels between oak posts,
 * rails and braces standing proud of the plaster; a plank door in a framed
 * opening with iron straps; small windows with open shutters; a thatched or
 * shingled gable roof with boarded gables; a chimney on the shingled
 * (craftsmen's) houses. All in local coordinates (door side found from the
 * door point), placed at the building's ground height.
 */
function house(B, b) {
  const y = heightAt(b.x, b.z);
  const { w, d, h } = b;
  const plinth = 0.45;
  B.put('rubble', new BoxGeometry(w + 0.12, plinth, d + 0.12), b.x, y + plinth / 2 - 0.05, b.z);
  B.put('plaster', new BoxGeometry(w, h - plinth, d), b.x, y + plinth + (h - plinth) / 2, b.z);
  const dx = b.door.x - b.x, dz = b.door.z - b.z;
  const doorOnX = Math.abs(dx) / w > Math.abs(dz) / d;
  // each face: centre, the direction along it, its length, outward normal
  const faces = [
    { n: [0, 1], len: w, c: [b.x, b.z + d / 2], along: [1, 0] },
    { n: [0, -1], len: w, c: [b.x, b.z - d / 2], along: [1, 0] },
    { n: [1, 0], len: d, c: [b.x + w / 2, b.z], along: [0, 1] },
    { n: [-1, 0], len: d, c: [b.x - w / 2, b.z], along: [0, 1] },
  ];
  const T = 0.16, proud = 0.03;
  const top = y + h;
  for (const f of faces) {
    const ry = f.along[0] ? 0 : Math.PI / 2;
    const isDoor = doorOnX ? f.n[0] === Math.sign(dx) : f.n[1] === Math.sign(dz);
    const off = (t) => [f.c[0] + f.along[0] * t + f.n[0] * proud, f.c[1] + f.along[1] * t + f.n[1] * proud];
    // where along the face the door is
    const doorT = isDoor ? (f.along[0] ? b.door.x - f.c[0] : b.door.z - f.c[1]) : null;
    // sill, mid rail and wall plate
    for (const [yy, skipDoor] of [[y + plinth + T / 2, false], [y + plinth + (h - plinth) * 0.52, true], [top - T / 2, false]]) {
      if (skipDoor && doorT !== null) {
        const a = -f.len / 2, b2 = f.len / 2, d0 = doorT - 0.75, d1 = doorT + 0.75;
        for (const [s0, s1] of [[a, d0], [d1, b2]]) if (s1 - s0 > 0.2) { const [px, pz] = off((s0 + s1) / 2); B.put('beam', new BoxGeometry(s1 - s0, T, T), px, yy, pz, ry); }
      } else { const [px, pz] = off(0); B.put('beam', new BoxGeometry(f.len + T, T, T), px, yy, pz, ry); }
    }
    // posts every ~1.6 m, braces in the end panels
    const n = Math.max(2, Math.round(f.len / 1.6));
    for (let i = 0; i <= n; i++) {
      const t = -f.len / 2 + (f.len * i) / n;
      if (doorT !== null && Math.abs(t - doorT) < 0.75) continue;
      const [px, pz] = off(t);
      B.put('beam', new BoxGeometry(T, h - plinth, T), px, y + plinth + (h - plinth) / 2, pz, ry);
    }
    for (const side of [-1, 1]) {
      const t0 = side * f.len / 2, t1 = t0 - side * (f.len / n);
      if (doorT !== null && Math.min(Math.abs(t0 - doorT), Math.abs(t1 - doorT)) < 1.2) continue;
      const mid = (t0 + t1) / 2, dl = Math.abs(t1 - t0), dh = (h - plinth) * 0.48;
      const [px, pz] = off(mid);
      const brace = new BoxGeometry(Math.hypot(dl, dh), T * 0.8, T * 0.8);
      brace.rotateZ(side * Math.atan2(dh, dl) * (f.along[0] ? 1 : -1) * (f.n[0] + f.n[1] > 0 ? 1 : -1));
      B.put('beam', brace, px, y + plinth + dh / 2 + 0.08, pz, ry);
    }
    // windows (one or two), with their shutters folded open
    const wins = f.len > 6 ? [-f.len / 4, f.len / 4] : [f.len > 4.5 ? (doorT !== null && doorT > 0 ? -f.len / 4 : f.len / 4) : null].filter((v) => v !== null);
    for (const t of wins) {
      if (doorT !== null && Math.abs(t - doorT) < 1.3) continue;
      const [px, pz] = off(t);
      const wy = y + plinth + (h - plinth) * 0.62;
      B.put('dark', new BoxGeometry(0.62, 0.52, 0.06), px, wy, pz, ry);
      B.put('beam', new BoxGeometry(0.8, 0.1, 0.12), px, wy + 0.31, pz, ry);
      B.put('beam', new BoxGeometry(0.8, 0.1, 0.16), px, wy - 0.31, pz, ry);
      for (const s of [-1, 1]) {
        const tt = t + s * 0.62;
        const [sx, sz] = [f.c[0] + f.along[0] * tt + f.n[0] * (proud + 0.08), f.c[1] + f.along[1] * tt + f.n[1] * (proud + 0.08)];
        B.put('planks', new BoxGeometry(0.34, 0.54, 0.035), sx, wy, sz, ry + s * 0.35 * (f.n[0] + f.n[1]));
      }
    }
    if (doorT !== null) {
      const [px, pz] = off(doorT);
      const dw = 1.05, dh = 2.0;
      // frame (jambs and lintel), the plank leaf with two iron straps, a stone step
      for (const s of [-1, 1]) { const [jx, jz] = off(doorT + s * (dw / 2 + 0.08)); B.put('beam', new BoxGeometry(T, dh + 0.2, T), jx, y + (dh + 0.2) / 2, jz, ry); }
      B.put('beam', new BoxGeometry(dw + 0.4, 0.2, T + 0.02), px, y + dh + 0.1, pz, ry);
      const [lx, lz] = [px - f.n[0] * 0.02, pz - f.n[1] * 0.02];
      B.put('door', new BoxGeometry(dw, dh, 0.06), lx, y + dh / 2, lz, ry);
      for (const yy of [0.45, 1.5]) B.put('iron', new BoxGeometry(dw * 0.8, 0.05, 0.075), lx, y + yy, lz, ry);
      B.put('iron', new TorusGeometry(0.06, 0.012, 4, 10), px + f.n[0] * 0.02 + f.along[0] * 0.3, y + 1.0, pz + f.n[1] * 0.02 + f.along[1] * 0.3, ry);
      B.put('rubble', new BoxGeometry(dw + 0.5, 0.12, 0.5), px + f.n[0] * 0.25, y + 0.06, pz + f.n[1] * 0.25, ry);
    }
  }
  // roof: thick slab, ridge, boarded gables
  const rise = Math.min(w, d) * (b.roof === 'thatch' ? 0.85 : 0.7);
  const thick = b.roof === 'thatch' ? 0.32 : 0.1;
  B.put(b.roof === 'thatch' ? 'thatch' : 'shingle', roofSlab(w, d, rise, b.roof === 'thatch' ? 0.55 : 0.4, thick), b.x, top + thick * 0.6, b.z, 0, { keepUV: true });
  const along = w >= d, L = (along ? w : d) + (b.roof === 'thatch' ? 1.1 : 0.8);
  const ridge = new CylinderGeometry(b.roof === 'thatch' ? 0.24 : 0.09, b.roof === 'thatch' ? 0.24 : 0.09, L, 8);
  ridge.rotateZ(Math.PI / 2);
  B.put(b.roof === 'thatch' ? 'thatch' : 'beam', ridge, b.x, top + rise + thick * 0.4, b.z, along ? 0 : Math.PI / 2);
  for (const s of [-1, 1]) {
    const S = along ? d : w;
    const tri = triangle(S, rise);
    const gx = b.x + (along ? s * (w / 2) : 0), gz = b.z + (along ? 0 : s * (d / 2));
    B.put('planks', tri, gx, top, gz, along ? (s > 0 ? Math.PI / 2 : -Math.PI / 2) : (s > 0 ? 0 : Math.PI));
    // the smoke hole under the ridge (most houses had no chimney yet)
    if (b.roof === 'thatch') B.put('dark', new BoxGeometry(along ? 0.05 : 0.4, 0.3, along ? 0.4 : 0.05), gx + (along ? s * 0.02 : 0), top + rise * 0.72, gz + (along ? 0 : s * 0.02));
  }
  if (b.roof !== 'thatch') {
    // a stone chimney through the shingles near the ridge
    const cx = b.x + (along ? w * 0.25 : 0.4), cz = b.z + (along ? 0.4 : d * 0.25);
    B.put('rubble', new BoxGeometry(0.7, rise + 1.2, 0.7), cx, top + (rise + 1.2) / 2 + 0.2, cz);
    B.put('stone', new BoxGeometry(0.85, 0.15, 0.85), cx, top + rise + 1.4, cz);
  }
}

/** What stands about a building: by kind, against the side or back walls, out of the way of the door. */
function yardFor(B, b, rand) {
  const y = heightAt(b.x, b.z);
  const dx = b.door.x - b.x, dz = b.door.z - b.z;
  const onX = Math.abs(dx) / b.w > Math.abs(dz) / b.d;
  const nx = onX ? Math.sign(dx) : 0, nz = onX ? 0 : Math.sign(dz);    // door side
  const bx = -nx, bz = -nz;                                              // back
  const halfN = onX ? b.w / 2 : b.d / 2, halfT = onX ? b.d / 2 : b.w / 2;
  // a point at (along, out) from the face with normal (fx, fz)
  const at = (fx, fz, along, out) => [b.x + fx * ((fx ? b.w : 0) / 2 + out) + (fz ? along : 0), b.z + fz * ((fz ? b.d : 0) / 2 + out) + (fx ? along : 0)];
  const sideX = onX ? 0 : 1, sideZ = onX ? 1 : 0;                       // a side wall's normal
  const ryBack = Math.atan2(bx, bz);
  const solid = (id, x, z, w, d, rot = 0) => addSolid(`${b.id}-${id}`, x, z, w, d, rot);
  const k = b.kind;
  if (k === 'house' || k === 'cottage') {
    // firewood against a side wall
    const [wx, wz] = at(sideX, sideZ, 0, 0.4);
    if (clearOf(wx, wz, onX ? 2.6 : 0.6, onX ? 0.6 : 2.6)) woodpile(B, wx, y, wz, { len: Math.min(2.6, (onX ? b.w : b.d) - 1), h: 1.0, ry: Math.atan2(sideX, sideZ) + Math.PI / 2 });
    if (clearOf(wx, wz, onX ? 2.6 : 0.6, onX ? 0.6 : 2.6)) solid('wood', wx, wz, onX ? 2.6 : 0.6, onX ? 0.6 : 2.6);
    if (b.id === 'h16') { bench(B, ...xyAt(at(nx, nz, (onX ? b.d : b.w) * 0.3, 0.4), y), { ry: Math.atan2(nx, nz) }); return; }
    // farmsteads: a fenced yard behind with a cart, a haystack, a dung heap, a trough
    if (b.name === 'Farmstead' || k === 'cottage') {
      const depth = k === 'cottage' ? 4 : 7, wide = (onX ? b.d : b.w) + (k === 'cottage' ? 0 : 1);
      const [c0x, c0z] = at(bx, bz, -wide / 2, 0.3), [c1x, c1z] = at(bx, bz, wide / 2, 0.3);
      const [f0x, f0z] = [c0x + bx * depth, c0z + bz * depth], [f1x, f1z] = [c1x + bx * depth, c1z + bz * depth];
      if (!clearOf((c0x + f1x) / 2, (c0z + f1z) / 2, onX ? depth : wide, onX ? wide : depth)) return;
      wattle(B, c0x, c0z, f0x, f0z, y); wattle(B, f0x, f0z, f1x, f1z, y); wattle(B, f1x, f1z, c1x, c1z, y);
      // the fence is solid
      const mx = (c0x + f1x) / 2, mz = (c0z + f1z) / 2;
      const yw = onX ? depth + 0.3 : wide + 0.3, yd = onX ? wide + 0.3 : depth + 0.3;
      solid('yard', mx, mz, yw, yd);
      if (k !== 'cottage') {
        cart(B, mx + (onX ? 0 : -wide * 0.25), y, mz + (onX ? -wide * 0.25 : 0), { ry: ryBack + 0.4 });
        haystack(B, mx + (onX ? bx * 1.5 : wide * 0.25), y, mz + (onX ? wide * 0.25 : bz * 1.5), { r: 1.3, h: 2.6 });
        dungHeap(B, mx + (onX ? -bx * 1.8 : wide * 0.28), y, mz + (onX ? wide * 0.28 : -bz * 1.8));
        trough(B, mx, y, mz, { len: 1.8, ry: ryBack + Math.PI / 2 });
      } else {
        for (let i = 0; i < 5; i++) B.put('leaves', new BoxGeometry(0.7, 0.25, 0.5), mx + (rand() - 0.5) * 2, y + 0.12, mz + (rand() - 0.5) * 2);   // cabbages in the garden
      }
    } else {
      bench(B, ...xyAt(at(nx, nz, (onX ? b.d : b.w) * 0.28, 0.35), y), { ry: Math.atan2(nx, nz) });
      barrel(B, ...xyAt(at(sideX, sideZ, -1, 0.45), y), {});
    }
    return;
  }
  const front = (along, out) => xyAt(at(nx, nz, along, out), y);
  const side = (along, out) => xyAt(at(sideX, sideZ, along, out), y);
  const ryFront = Math.atan2(nx, nz);
  if (k === 'tavern') {
    aleStake(B, ...front(-1.6, 0.02), ryFront + Math.PI / 2);
    bench(B, ...front(2.4, 0.45), { ry: ryFront + Math.PI / 2, w: 2.2 });
    for (let i = 0; i < 3; i++) barrel(B, ...side(-2.5 + i * 0.62, 0.4), {});
    barrel(B, ...side(1.4, 0.45), { lying: true, ry: 0 });
    solid('barrels', ...xzOf(side(-1.5, 0.45)), onX ? 3 : 0.8, onX ? 0.8 : 3);
  } else if (k === 'smithy') {
    // the anvil block and quench tub under a lean-to by the side wall
    const [sx, , sz] = side(0, 1.2);
    for (const s of [-1, 1]) B.put('beam', new BoxGeometry(0.14, 2.4, 0.14), sx + (onX ? s * 1.4 : 0.9), y + 1.2, sz + (onX ? 0.9 : s * 1.4));
    B.put('shingleProp', new BoxGeometry(onX ? 3.4 : 2.4, 0.06, onX ? 2.4 : 3.4), sx, y + 2.55, sz, 0, { rx: onX ? -0.25 : 0, rz: onX ? 0 : 0.25 });
    B.put('log', new CylinderGeometry(0.28, 0.32, 0.55, 10), sx, y + 0.28, sz);
    B.put('iron', new BoxGeometry(0.55, 0.22, 0.2), sx, y + 0.66, sz);
    tub(B, sx + 0.9, y, sz + 0.6, { key: 'stave' });
    woodpile(B, ...side(-2.2, 0.35), { len: 1.6, h: 0.9, ry: onX ? 0 : Math.PI / 2 });
    solid('leanto', sx, sz, onX ? 3.4 : 2.4, onX ? 2.4 : 3.4);
  } else if (k === 'bakery') {
    woodpile(B, ...side(0, 0.4), { len: 3, h: 1.3, ry: onX ? 0 : Math.PI / 2 });
    solid('wood', ...xzOf(side(0, 0.4)), onX ? 3.2 : 0.7, onX ? 0.7 : 3.2);
    // loaves on a board under the window
    const [gx, gy, gz] = front(-1.6, 0.35);
    B.put('planks', new BoxGeometry(onX ? 0.5 : 1.6, 0.05, onX ? 1.6 : 0.5), gx, gy + 0.9, gz);
    for (const s of [-1, 1]) B.put('beam', new BoxGeometry(0.06, 0.9, 0.06), gx + (onX ? 0 : s * 0.7), gy + 0.45, gz + (onX ? s * 0.7 : 0));
    goods(B, 'bread', gx, gy + 0.93, gz, { ry: onX ? Math.PI / 2 : 0 });
    sack(B, ...side(2.2, 0.4), { seed: 2 }); sack(B, ...side(2.7, 0.35), { seed: 5, s: 0.9 });
  } else if (k === 'butcher') {
    const [gx, gy, gz] = front(1.6, 0.5);
    B.put('beam', new BoxGeometry(onX ? 0.08 : 1.6, 0.08, onX ? 1.6 : 0.08), gx, gy + 2.1, gz);
    goods(B, 'meat', gx, gy + 2.05, gz, { ry: onX ? Math.PI / 2 : 0, n: 3 });
    B.put('log', new CylinderGeometry(0.35, 0.38, 0.8, 10), ...front(-1.8, 0.6));
    tub(B, ...side(1, 0.5), {});
  } else if (k === 'workshop') {
    const [gx, gy, gz] = front(-1.5, 0.35);
    B.put('planks', new BoxGeometry(onX ? 0.45 : 1.4, 0.05, onX ? 1.4 : 0.45), gx, gy + 0.85, gz);
    for (const s of [-1, 1]) B.put('beam', new BoxGeometry(0.06, 0.85, 0.06), gx + (onX ? 0 : s * 0.6), gy + 0.42, gz + (onX ? s * 0.6 : 0));
    goods(B, b.id === 'cobbler' ? 'shoes' : 'cloth', gx, gy + 0.88, gz, { ry: onX ? Math.PI / 2 : 0, n: b.id === 'cobbler' ? 6 : 3 });
    stool(B, ...front(1.8, 0.5));
  } else if (k === 'bath') {
    woodpile(B, ...side(0, 0.4), { len: 3.4, h: 1.3, ry: onX ? 0 : Math.PI / 2 });
    solid('wood', ...xzOf(side(0, 0.4)), onX ? 3.6 : 0.7, onX ? 0.7 : 3.6);
    tub(B, ...front(2.4, 0.6), { r: 0.45, h: 0.55 });
    tub(B, ...front(3.4, 0.6), { r: 0.35, h: 0.4 });
  } else if (k === 'rychta') {
    bench(B, ...front(-2.4, 0.4), { ry: ryFront + Math.PI / 2, w: 2.4 });
    barrel(B, ...side(1.8, 0.4), {});
  }
  void ryBack; void halfN; void halfT; void BUILDING;
}
function xyAt([x, z], y) { return [x, y, z]; }

/** Is a box (centre, size) clear of the streets, the nodes and every door's approach? */
function clearOf(x, z, w, d) {
  const pts = [...Object.values(NODES), ...BUILDINGS.map((b) => { const a = doorApproach(b); return [a.x, a.z]; }), ...Object.values(PLACES).map((p) => [p.x, p.z])];
  for (const [px, pz] of pts) if (Math.abs(px - x) < w / 2 + 1.2 && Math.abs(pz - z) < d / 2 + 1.2) return false;
  // and the street segments themselves
  for (const [a, b] of EDGES) {
    const [ax, az] = NODES[a], [bx, bz] = NODES[b];
    for (let t = 0; t <= 1; t += 0.05) { const px = ax + (bx - ax) * t, pz = az + (bz - az) * t; if (Math.abs(px - x) < w / 2 + 1.0 && Math.abs(pz - z) < d / 2 + 1.0) return false; }
  }
  return true;
}
function xzOf([x, , z]) { return [x, z]; }

// ---- the church of St Wenceslas -------------------------------------------------------------
/**
 * A small Gothic parish church: a west tower with a shingled octagonal
 * spire over the portal, an aisleless nave with buttresses and lancet
 * windows, a narrower chancel; lime-washed stone, steep roofs. Graves in the
 * churchyard beside it.
 */
function church(B, b) {
  const y = heightAt(b.x, b.z);
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, zS = b.z - b.d / 2, zN = b.z + b.d / 2;
  const tw = 6, tz0 = zS, tz1 = zS + tw;            // the tower over the south door
  const nz0 = tz1, nz1 = zN - 5.5, cz1 = zN;        // nave, then chancel
  const nh = 8.5, ch = 7.4, cw = 6.4;
  B.put('rubble', new BoxGeometry(b.w + 0.3, 0.6, b.d + 0.3), b.x, y + 0.25, b.z);
  B.put('limewash', new BoxGeometry(b.w, nh, nz1 - nz0), b.x, y + nh / 2, (nz0 + nz1) / 2);
  B.put('limewash', new BoxGeometry(cw, ch, cz1 - nz1), b.x, y + ch / 2, (nz1 + cz1) / 2);
  // buttresses along the nave, stepped
  for (let z = nz0 + 1.2; z < nz1 - 0.5; z += 3.2) for (const s of [-1, 1]) {
    const bxp = s > 0 ? x1 + 0.4 : x0 - 0.4;
    B.put('stone', new BoxGeometry(0.8, nh * 0.7, 0.9), bxp, y + nh * 0.35, z);
    B.put('stone', new BoxGeometry(0.55, nh * 0.25, 0.75), bxp - s * 0.12, y + nh * 0.82, z, 0, { rz: s * 0.3 });
  }
  // lancet windows: a deep dark slot with a pointed head
  const lancet = (x, z, wy, h, ry) => {
    B.put('dark', new BoxGeometry(0.55, h, 0.12), x, wy, z, ry);
    const head = new BoxGeometry(0.39, 0.39, 0.12); head.rotateZ(Math.PI / 4);
    B.put('dark', head, x, wy + h / 2, z, ry);
    B.put('stone', new BoxGeometry(0.85, 0.12, 0.2), x, wy - h / 2 - 0.06, z, ry);
  };
  for (let z = nz0 + 2.8; z < nz1 - 0.5; z += 3.2) for (const s of [-1, 1]) lancet(s > 0 ? x1 + 0.03 : x0 - 0.03, z, y + 4.4, 2.6, Math.PI / 2);
  for (const s of [-1, 1]) lancet(b.x + s * (cw / 2 + 0.03), (nz1 + cz1) / 2, y + 3.9, 2.4, Math.PI / 2);
  lancet(b.x, cz1 + 0.03, y + 4, 3, 0);
  // roofs
  B.put('shingle', roofSlab(b.w, nz1 - nz0 + 0.2, b.w * 0.95, 0.4, 0.12), b.x, y + nh, (nz0 + nz1) / 2, 0, { keepUV: true });
  B.put('shingle', roofSlab(cw, cz1 - nz1, cw * 0.95, 0.35, 0.12), b.x, y + ch, (nz1 + cz1) / 2, 0, { keepUV: true });
  B.put('limewash', triangle(b.w, b.w * 0.95), b.x, y + nh, nz1, 0);
  B.put('limewash', triangle(cw, cw * 0.95), b.x, y + ch, cz1, 0);
  // the tower: four stages, belfry openings, an octagonal spire
  const th = 17;
  B.put('limewash', new BoxGeometry(tw, th, tw), b.x, y + th / 2, (tz0 + tz1) / 2);
  for (const yy of [6, 11.5]) B.put('stone', new BoxGeometry(tw + 0.2, 0.25, tw + 0.2), b.x, y + yy, (tz0 + tz1) / 2);
  for (const [fx, fz] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
    const ox = b.x + fx * (tw / 2 + 0.02), oz = (tz0 + tz1) / 2 + fz * (tw / 2 + 0.02), ry = fx ? Math.PI / 2 : 0;
    for (const s of [-0.7, 0.7]) lancet(ox + (fx ? 0 : s), oz + (fx ? s : 0), y + 14, 1.6, ry);
  }
  const spire = new ConeGeometry(tw * 0.72, 13, 8);
  B.put('shingle', spire, b.x, y + th + 6.5, (tz0 + tz1) / 2, Math.PI / 8);
  B.put('iron', new BoxGeometry(0.08, 1.4, 0.08), b.x, y + th + 13.6, (tz0 + tz1) / 2);
  B.put('iron', new BoxGeometry(0.7, 0.08, 0.08), b.x, y + th + 13.9, (tz0 + tz1) / 2);
  // the portal: a pointed arch of cut stone with the door
  const pz = tz0 - 0.03;
  B.put('stone', new BoxGeometry(2.4, 3.4, 0.25), b.x, y + 1.7, pz);
  B.put('dark', new BoxGeometry(1.5, 2.6, 0.27), b.x, y + 1.3, pz);
  const arch = new BoxGeometry(1.06, 1.06, 0.27); arch.rotateZ(Math.PI / 4);
  B.put('dark', arch, b.x, y + 2.6, pz);
  B.put('door', new BoxGeometry(1.4, 2.5, 0.05), b.x, y + 1.25, pz - 0.12);
  for (const yy of [0.5, 1.4, 2.1]) B.put('iron', new BoxGeometry(1.2, 0.05, 0.07), b.x, y + yy, pz - 0.15);
  // the churchyard: graves to the east
  for (let i = 0; i < 6; i++) grave(B, x1 + 2.4 + (i % 2) * 1.6, y, nz0 + 2 + Math.floor(i / 2) * 3.2, 0);
}

// ---- the castle ---------------------------------------------------------------------------------
/**
 * Skalice castle, built in its own frame on the levelled hilltop: curtain
 * walls with a wall-walk, merlons and arrow slits; a gate tower with a
 * vaulted passage, a raised portcullis and the gate leaves open; a round
 * keep with a door high up and a conical roof; the great hall with tall
 * windows and tiled roof; the garrison's and the stables' lean-tos; a well,
 * a pell and butts for drill in the bailey.
 */
function castle(B) {
  const C = CASTLE_PLAN, { x0, x1, z0, z1 } = C.bailey, T = C.wallT, H = C.wallH;
  const wall = (cx, cz, len, alongX, outward) => {
    const ry = alongX ? 0 : Math.PI / 2;
    B.put('stone', new BoxGeometry(len, H, T), cx, H / 2 - 0.5, cz, ry);
    B.put('rubble', new BoxGeometry(len + 0.4, 1.2, T + 0.8), cx, 0.1, cz, ry);           // battered foot
    // merlons on the outer edge, a low parapet on the inner
    const n = Math.floor(len / 2.2);
    for (let i = 0; i < n; i++) {
      const t = -len / 2 + 1.1 + i * 2.2;
      const mx = cx + (alongX ? t : outward[0] * (T / 2 - 0.25)), mz = cz + (alongX ? outward[1] * (T / 2 - 0.25) : t);
      B.put('stone', new BoxGeometry(1.2, 1.3, 0.5), mx, H - 0.5 + 0.65, mz, ry);
      if (i % 2 === 0) B.put('dark', new BoxGeometry(0.16, 1.4, 0.1), cx + (alongX ? t : outward[0] * (T / 2 + 0.01)), H * 0.55, cz + (alongX ? outward[1] * (T / 2 + 0.01) : t), ry);
    }
    B.put('stone', new BoxGeometry(len, 0.6, 0.3), cx - (alongX ? 0 : outward[0] * (T / 2 - 0.15)), H - 0.2, cz - (alongX ? outward[1] * (T / 2 - 0.15) : 0), ry);
  };
  const g = C.gate, gl = g.x - g.w / 2, gr = g.x + g.w / 2;
  wall((x0 + x1) / 2, z1, x1 - x0 + T, true, [0, 1]);
  wall(x0, (z0 + z1) / 2, z1 - z0 + T, false, [-1, 0]);
  wall(x1, (z0 + z1) / 2, z1 - z0 + T, false, [1, 0]);
  wall((x0 + gl) / 2, z0, gl - x0, true, [0, -1]);
  wall((gr + x1) / 2, z0, x1 - gr, true, [0, -1]);
  // corner turrets
  for (const [cx, cz] of [[x0, z1], [x1, z1], [x1, z0], [x0, z0]]) {
    B.put('stone', new CylinderGeometry(2.4, 2.7, H + 2, 14), cx, (H + 2) / 2 - 0.5, cz);
    B.put('tile', new ConeGeometry(3.0, 4.5, 14), cx, H + 1.5 + 2.25, cz);
  }
  // the gate tower: two flanks, the vault over the passage, the upper storey, a pyramid roof
  const fw = (g.w - g.pass) / 2;
  for (const s of [-1, 1]) B.put('stone', new BoxGeometry(fw, g.h, g.d), g.x + s * (g.pass / 2 + fw / 2), g.h / 2 - 0.5, g.z);
  B.put('stone', new BoxGeometry(g.pass, g.h - 4.6, g.d), g.x, 4.6 + (g.h - 4.6) / 2 - 0.5, g.z);
  const vault = new CylinderGeometry(g.pass / 2, g.pass / 2, g.d, 12, 1, true, Math.PI / 2, Math.PI);
  vault.rotateX(Math.PI / 2);
  B.put('stone', vault, g.x, 3.4 - 0.5, g.z, 0, { rz: 0 });
  B.put('iron', new BoxGeometry(g.pass - 0.1, 1.0, 0.12), g.x, 3.9, g.z - g.d / 2 + 0.6);                  // the portcullis, raised
  for (let i = 0; i < 7; i++) B.put('iron', new BoxGeometry(0.06, 1.3, 0.06), g.x - g.pass / 2 + 0.25 + i * 0.42, 3.6, g.z - g.d / 2 + 0.6);
  for (const s of [-1, 1]) B.put('door', new BoxGeometry(0.12, 3.6, g.pass / 2), g.x + s * (g.pass / 2 - 0.1), 1.3, g.z + g.d / 2 - g.pass / 4 - 0.2, 0);   // gate leaves, open
  for (const [fx, fz] of [[0, -1], [1, 0], [-1, 0]]) for (const yy of [7, 11]) B.put('dark', new BoxGeometry(fx ? 0.1 : 0.18, 1.2, fx ? 0.18 : 0.1), g.x + fx * (g.w / 2 + 0.01), yy, g.z + fz * (g.d / 2 + 0.01));
  B.put('tile', new ConeGeometry(g.w * 0.78, 5.5, 4), g.x, g.h - 0.5 + 2.75, g.z, Math.PI / 4);
  // the keep
  const k = C.keep;
  B.put('stone', new CylinderGeometry(k.r, k.r * 1.06, k.h, 20), k.x, k.h / 2 - 0.5, k.z);
  B.put('stone', new CylinderGeometry(k.r + 0.35, k.r + 0.35, 1.2, 20), k.x, k.h - 0.5, k.z);
  B.put('tile', new ConeGeometry(k.r + 0.6, 8.5, 20), k.x, k.h + 4.2, k.z);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; for (const yy of [10, 17, 23]) B.put('dark', new BoxGeometry(0.16, 1.1, 0.12), k.x + Math.cos(a) * (k.r + 0.01), yy, k.z + Math.sin(a) * (k.r + 0.01), -a + Math.PI / 2); }
  const da = -0.9;   // the door 8 m up, facing the bailey, reached by a timber stair
  B.put('door', new BoxGeometry(1.0, 2.0, 0.1), k.x + Math.cos(da) * (k.r + 0.02), 8.5, k.z + Math.sin(da) * (k.r + 0.02), -da + Math.PI / 2);
  for (let i = 0; i < 12; i++) { const r = k.r + 1.2 + i * 0.25; B.put('planks', new BoxGeometry(1.0, 0.08, 0.3), k.x + Math.cos(da - 0.55 + i * 0.05) * r, 0.2 + i * 0.68, k.z + Math.sin(da - 0.55 + i * 0.05) * r, -da); }
  B.put('beam', new BoxGeometry(0.14, 8.2, 0.14), k.x + Math.cos(da - 0.2) * (k.r + 3.6), 3.6, k.z + Math.sin(da - 0.2) * (k.r + 3.6));
  // the great hall
  const h = C.hall;
  B.put('stone', new BoxGeometry(h.w, h.h, h.d), h.x, h.h / 2 - 0.5, h.z);
  B.put('tile', roofSlab(h.w, h.d, h.d * 0.8, 0.5, 0.15), h.x, h.h - 0.5, h.z, 0, { keepUV: true });
  for (const s of [-1, 1]) B.put('stone', triangle(h.d, h.d * 0.8), h.x + s * h.w / 2, h.h - 0.5, h.z, s > 0 ? Math.PI / 2 : -Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const wx = h.x - h.w / 2 + 2 + i * 3.5;
    if (Math.abs(wx - h.x) < 1) continue;
    for (const [yy, hh] of [[3, 1.6], [7.2, 2.4]]) {
      B.put('dark', new BoxGeometry(0.9, hh, 0.12), wx, yy, h.z - h.d / 2 - 0.02);
      const head = new BoxGeometry(0.64, 0.64, 0.12); head.rotateZ(Math.PI / 4);
      B.put('dark', head, wx, yy + hh / 2, h.z - h.d / 2 - 0.02);
      B.put('stone', new BoxGeometry(1.2, 0.14, 0.3), wx, yy - hh / 2 - 0.07, h.z - h.d / 2 - 0.1);
    }
  }
  B.put('stone', new BoxGeometry(2.4, 3.6, 0.3), h.x, 1.3, h.z - h.d / 2 - 0.1);
  B.put('door', new BoxGeometry(1.5, 2.6, 0.06), h.x, 0.8, h.z - h.d / 2 - 0.27);
  for (let i = 0; i < 3; i++) B.put('stone', new BoxGeometry(2.6, 0.18, 0.4), h.x, -0.42 + i * 0.18, h.z - h.d / 2 - 0.4 - (2 - i) * 0.35);
  for (const s of [-1, 1]) { B.put('stone', new BoxGeometry(0.9, 4, 0.9), h.x + s * 5, h.h + 1.5, h.z + 1.2); }
  // the garrison's room against the west wall and the stables against the east: timber lean-tos
  const lean = (p, wallX, open) => {
    const { x, z, w, d, h: lh } = p;
    const inner = x + (wallX < x ? 1 : -1) * w / 2;
    B.put(open ? 'beam' : 'plaster', new BoxGeometry(open ? 0.16 : 0.2, lh - 0.6, d), inner, (lh - 0.6) / 2 - 0.5, z);
    if (open) for (let i = 0; i <= 3; i++) B.put('beam', new BoxGeometry(0.18, lh - 0.6, 0.18), inner, (lh - 0.6) / 2 - 0.5, z - d / 2 + (d * i) / 3);
    for (const s of [-1, 1]) B.put('planks', new BoxGeometry(w, lh, 0.15), x, lh / 2 - 0.5, z + s * d / 2);
    B.put('shingleProp', new BoxGeometry(w + 0.8, 0.12, d + 0.6), x, lh - 0.1, z, 0, { rz: (wallX < x ? -1 : 1) * 0.32 });
    if (!open) {
      B.put('door', new BoxGeometry(0.06, 2.0, 1.0), inner + (wallX < x ? 0.12 : -0.12), 0.5, z);
      for (const s of [-2, 2]) B.put('dark', new BoxGeometry(0.06, 0.5, 0.6), inner + (wallX < x ? 0.12 : -0.12), 1.8, z + s);
    }
  };
  lean(C.barracks, x0, false);
  lean(C.stable, x1, true);
  for (let i = 0; i < 3; i++) haystackSmall(B, C.stable.x + 0.6, -0.5, C.stable.z - 3 + i * 2.6);
  trough(B, C.stable.x - C.stable.w / 2 - 0.8, -0.5, C.stable.z, { len: 3, ry: Math.PI / 2 });
  // the bailey: a well, a pell and straw butts for drill, firewood, barrels
  well(B, C.well.x, -0.5, C.well.z);
  B.put('log', new CylinderGeometry(0.13, 0.15, 1.9, 8), -8, 0.45, 2);
  for (let i = 0; i < 2; i++) { const bt = new CylinderGeometry(0.6, 0.6, 0.5, 14); bt.rotateX(Math.PI / 2); B.put('hay', bt, 8 + i * 3, 0.5, -12.5); B.put('beam', new BoxGeometry(0.1, 1.4, 0.1), 8 + i * 3, 0.2, -12.2); }
  woodpile(B, h.x - 4, -0.5, h.z - h.d / 2 - 0.5, { len: 3, h: 1.2 });
  for (let i = 0; i < 4; i++) barrel(B, -12 + i * 0.6, -0.5, -13.6, {});
  cart(B, 14, -0.5, -10, { ry: 2.4 });
}
function haystackSmall(B, x, y, z) { const g = new CylinderGeometry(0.6, 0.6, 1.2, 10); g.rotateZ(Math.PI / 2); B.put('hay', g, x, y + 0.6, z); }

/**
 * The town of Skalice, the church and the castle, modelled: see house(),
 * yardFor(), church() and castle(). Props that stand in the way are
 * registered with the town's colliders, so nobody walks through a cart.
 */
export class TownMesh {
  constructor(scene) {
    this.group = new Group();
    this.group.name = 'town';
    scene.add(this.group);
    const M = townMaterials();
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const B = new Batch();
    for (const b of BUILDINGS) {
      if (b.builtBy === 'castle') continue;
      if (b.kind === 'church') { church(B, b); continue; }
      house(B, b);
      yardFor(B, b, rand);
    }
    // the square
    well(B, PLACES.well.x, heightAt(PLACES.well.x, PLACES.well.z), PLACES.well.z, { ry: 0.3 });
    pillory(B, PLACES.pillory.x, heightAt(PLACES.pillory.x, PLACES.pillory.z), PLACES.pillory.z);
    const mk = PLACES.market;
    const wares = [['bread', 'awning'], ['pots', 'awningRed'], ['cloth', 'awning'], ['apples', 'awningRed']];
    for (let i = 0; i < 4; i++) {
      const sx = mk.x - 13 + i * 3.3, sz = mk.z - 2.2;
      stall(B, sx, heightAt(sx, sz), sz, { ry: Math.PI, ware: wares[i][0], awning: wares[i][1] });
      addSolid('stall' + i, sx, sz, 2.6, 1.2);
    }
    for (let i = 0; i < 3; i++) crate(B, mk.x - 15.3 + i * 0.7, 0, mk.z - 3.8, { ry: i * 0.3 });
    sack(B, mk.x - 15.5, 0, mk.z - 0.6, { seed: 3 }); sack(B, mk.x - 15, 0, mk.z - 0.2, { seed: 9 });
    const pr = PLACES.privy;
    privy(B, pr.x, heightAt(pr.x, pr.z), pr.z + 1.6, 0);
    this._emit(B, M);
    // the castle in its own frame
    const CB = new Batch();
    castle(CB);
    const cg = new Group();
    cg.name = 'castle';
    cg.position.set(CASTLE.x, castleTerraceY() + 0.5, CASTLE.z);
    cg.rotation.y = CASTLE.rot;
    this._emit(CB, M, cg);
    this.group.add(cg);
  }

  _emit(B, M, parent = this.group) {
    for (const [key, geo] of B.build(UVS)) {
      const mat = M[key] ?? M.planks;
      const mesh = new Mesh(geo, mat);
      mesh.name = 'town-' + key;
      mesh.castShadow = !['dark', 'water'].includes(key);
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }
}
