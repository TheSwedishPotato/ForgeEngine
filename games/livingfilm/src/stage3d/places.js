/**
 * Places, built in the Med Engine from the director's description, once.
 *
 * When the story first goes somewhere, Claude describes the place: what
 * kind it is (a tavern, a cottage, a glass furnace, a street, a riverbank),
 * its building tradition (Bohemian, Italian, English, Japanese), its size,
 * walls and floor, and what is in it. The builder turns that into a set:
 * walls, beams and windows, the hearth with its fire and its light, the
 * tables, benches, barrels and beds, or the houses, wells and carts of a
 * street. It is built before anyone walks in, from a seed taken from the
 * description, and kept for the rest of the story: go back, and it is the
 * same room, exactly as it was. A saved story rebuilds each place from its
 * description and seed, identically.
 *
 * Every place lists its marks: where people stand and sit, the door, the
 * hearth, the window, the table; and its lights.
 */
import {
  Group, Mesh, BoxGeometry, CylinderGeometry, SphereGeometry, PlaneGeometry, ConeGeometry, TorusGeometry,
  MeshStandardMaterial, MeshBasicMaterial, PointLight, DoubleSide, Color, CanvasTexture, RepeatWrapping, SRGBColorSpace,
} from 'three';
import { townMaterials, props } from './engine.js';

const { Batch, barrel, tub, crate, sack, woodpile, cart, bench: benchProp, stool, trough, haystack, goods, stall, well, grave, dungHeap } = props;

export const PLACE_TYPES = ['tavern', 'hall', 'chamber', 'cottage', 'church', 'workshop', 'cellar', 'dungeon', 'kitchen', 'stable', 'shop',
  'street', 'market', 'square', 'forest', 'field', 'road', 'river', 'bridge', 'castle', 'camp', 'hilltop', 'garden', 'shore', 'ship', 'cave', 'graveyard', 'gate', 'courtyard'];
export const INDOOR = new Set(['tavern', 'hall', 'chamber', 'cottage', 'church', 'workshop', 'cellar', 'dungeon', 'kitchen', 'stable', 'shop', 'cave']);
export const STYLES = ['bohemian', 'italian', 'english', 'japanese', 'generic'];
export const WALLS = ['plaster', 'stone', 'timber', 'wattle', 'wood', 'brick', 'paper'];
export const FLOORS = ['earth', 'planks', 'flagstone', 'rushes', 'tatami', 'cobbles', 'grass', 'sand', 'snow', 'mud'];

const UVS = { plaster: 0.5, limewash: 0.45, stone: 0.4, rubble: 0.8, beam: 0.6, planks: 0.8, door: 1, log: 1, stave: 1.5, hay: 0.8, wattle: 1.2, tile: 0.7, shingle: 0.8, shingleProp: 0.8, thatch: 0.6 };

function rng(seed) {
  let s = [...String(seed)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// --- extra materials the town did not need ----------------------------------------------------------

const cache = {};
function canvasTex(key, size, paint, repeat = 1) {
  if (cache[key]) return cache[key];
  const c = document.createElement('canvas'); c.width = c.height = size;
  paint(c.getContext('2d'), size);
  const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.repeat.set(repeat, repeat); t.anisotropy = 8;
  return (cache[key] = t);
}
function noiseFill(g, S, base, amp, n = 4000) {
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let i = 0; i < n; i++) { const v = (Math.random() - 0.5) * amp; g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`; g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 1 + Math.random() * 3); }
}
export function extraMaterials() {
  if (cache.mats) return cache.mats;
  const std = (o) => new MeshStandardMaterial({ roughness: 0.9, ...o });
  const tatami = canvasTex('tatami', 256, (g, S) => { noiseFill(g, S, '#b8b070', 0.12); g.strokeStyle = 'rgba(80,70,30,0.25)'; for (let y = 0; y < S; y += 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); } g.fillStyle = '#2a2a1a'; g.fillRect(0, 0, 8, S); });
  const shoji = canvasTex('shoji', 256, (g, S) => { g.fillStyle = '#f2ece0'; g.fillRect(0, 0, S, S); g.strokeStyle = '#6a4a2a'; g.lineWidth = 6; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * S / 4, 0); g.lineTo(i * S / 4, S); g.stroke(); } for (let j = 0; j <= 6; j++) { g.beginPath(); g.moveTo(0, j * S / 6); g.lineTo(S, j * S / 6); g.stroke(); } });
  const brick = canvasTex('brick', 256, (g, S) => { noiseFill(g, S, '#a0563a', 0.1); g.strokeStyle = 'rgba(220,210,190,0.7)'; g.lineWidth = 3; for (let y = 0; y < S; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); for (let x = (y / 16) % 2 ? 16 : 0; x < S; x += 32) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke(); } } });
  const stucco = (c) => canvasTex('stucco' + c, 256, (g, S) => noiseFill(g, S, c, 0.12, 6000));
  const flag = canvasTex('flag', 256, (g, S) => { noiseFill(g, S, '#8a8478', 0.14); g.strokeStyle = 'rgba(40,36,30,0.6)'; g.lineWidth = 3; for (let y = 0; y < S; y += 64) for (let x = (y / 64) % 2 ? 40 : 0; x < S; x += 80) g.strokeRect(x, y, 80, 64); });
  const earth = canvasTex('earth', 256, (g, S) => noiseFill(g, S, '#5a4632', 0.18, 8000));
  const rushes = canvasTex('rushes', 256, (g, S) => { noiseFill(g, S, '#7a6a3a', 0.1); g.strokeStyle = 'rgba(160,140,80,0.5)'; for (let i = 0; i < 500; i++) { const x = Math.random() * S, y = Math.random() * S, a = Math.random() * 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 20, y + Math.sin(a) * 20); g.stroke(); } });
  const grass = canvasTex('grass', 256, (g, S) => { noiseFill(g, S, '#4a5a2a', 0.2, 9000); });
  const sand = canvasTex('sand', 256, (g, S) => noiseFill(g, S, '#c8b48a', 0.1, 6000));
  const snow = canvasTex('snow', 256, (g, S) => noiseFill(g, S, '#e8ecf0', 0.05, 3000));
  const mud = canvasTex('mud', 256, (g, S) => noiseFill(g, S, '#4a3a28', 0.15, 6000));
  return (cache.mats = {
    tatami: std({ map: tatami, roughness: 0.95 }), shoji: std({ map: shoji, roughness: 0.9, side: DoubleSide, emissive: new Color('#fff4e0'), emissiveIntensity: 0.05 }),
    brick: std({ map: brick }), flag: std({ map: flag }), earth: std({ map: earth, roughness: 1 }), rushes: std({ map: rushes, roughness: 1 }),
    grass: std({ map: grass, roughness: 1 }), sand: std({ map: sand }), snow: std({ map: snow, roughness: 0.7 }), mud: std({ map: mud, roughness: 0.6 }),
    stuccoOchre: std({ map: stucco('#c89a5a') }), stuccoRose: std({ map: stucco('#c08070') }), stuccoWhite: std({ map: stucco('#d8d0bc') }),
    darkWood: std({ color: '#3a2618', roughness: 0.75 }), roofTile: std({ color: '#5a5a5c', roughness: 0.7, side: DoubleSide }), terracotta: std({ color: '#9a4a2a', roughness: 0.8, side: DoubleSide }),
    paperGlow: new MeshBasicMaterial({ color: new Color(2.4, 1.5, 0.8) }), fireGlow: new MeshBasicMaterial({ color: new Color(6, 2.4, 0.6) }), candleGlow: new MeshBasicMaterial({ color: new Color(5, 3.4, 1.6) }), ember: new MeshBasicMaterial({ color: new Color(1.6, 0.35, 0.08) }),
    water: std({ color: '#203840', roughness: 0.05, metalness: 0.2 }), linen: std({ color: '#d8ccb0', roughness: 1 }), wool: std({ color: '#7a2a22', roughness: 1 }),
    gold: std({ color: '#c8a050', metalness: 0.9, roughness: 0.35 }), glass: std({ color: '#3a8a6a', roughness: 0.1, metalness: 0.1, emissive: new Color('#1a4a3a'), emissiveIntensity: 0.4 }),
  });
}

const box = (w, h, d) => new BoxGeometry(w, h, d);
const cyl = (r0, r1, h, n = 12) => new CylinderGeometry(r0, r1, h, n);

/** What a description asks for: the place's features as tokens we can build. */
export function featuresOf(spec) {
  const text = [...(spec.features ?? []), spec.name ?? '', spec.type ?? ''].join(' ').toLowerCase();
  const has = (re) => re.test(text);
  return {
    hearth: has(/hearth|fireplace|fire\b|open fire/), stove: has(/stove/), tables: has(/table|trestle|board/), benches: has(/bench/), counter: has(/counter|bar\b|tap\b|taproom/),
    barrels: has(/barrel|cask|keg/), crates: has(/crate|box|chest|coffer/), sacks: has(/sack|grain|flour/), bed: has(/bed|pallet|cot|futon/), shelves: has(/shel|pot|jug|jar/),
    altar: has(/altar|crucifix|cross|shrine|icon/), candles: has(/candle|lamp|lantern|taper/), anvil: has(/anvil|smith|forge/), furnace: has(/furnace|kiln|glass|oven/),
    loom: has(/loom|weav|spin/), desk: has(/desk|lectern|book|ledger|writ|scroll/), hay: has(/hay|straw|manger/), tapestry: has(/tapestr|banner|hanging|cloth/),
    woodpile: has(/woodpile|firewood|logs/), tub: has(/tub|bucket|basin/), herbs: has(/herb|drying/), weapons: has(/weapon|spear|rack|armou?r/), chains: has(/chain|shackle|manacle/),
    pillars: has(/pillar|column|arch/), well: has(/well\b/), cart: has(/cart|wagon/), stalls: has(/stall|market|booth/), fountain: has(/fountain/), trees: has(/tree|orchard|grove|wood/),
    fence: has(/fence|hedge|paling/), boats: has(/boat|gondola|barge|skiff/), tents: has(/tent|pavilion/), campfire: has(/campfire|bonfire|fire pit/), graves: has(/grave|tomb|headstone/),
    pillory: has(/pillory|stocks|gallows/), dung: has(/dung|midden/), rocks: has(/rock|boulder|stone/), water: has(/river|canal|stream|lake|sea|water|harbou?r|quay/), lowtable: has(/low table|chabudai|cushion|zabuton/),
  };
}

/**
 * Build a place. spec: { id, name, type, style, size, walls, floor, features[] }.
 * Returns { group, marks: {name: {x, z, yaw, posture}}, stands: [...], lights: [...], indoor, bounds: {W, D, H} }.
 */
export function buildPlace(spec) {
  const M = { ...townMaterials(), ...extraMaterials() };
  const R = rng(`${spec.id}|${spec.name}|${spec.type}|${spec.style}`);
  const indoor = INDOOR.has(spec.type);
  const F = featuresOf(spec);
  const B = new Batch();
  const group = new Group(); group.name = 'place-' + spec.id;
  const out = { group, marks: {}, stands: [], lights: [], indoor, bounds: null, spec };
  const add = (geo, mat, x, y, z, ry = 0) => { const m = new Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; group.add(m); return m; };
  const mark = (name, x, z, yaw = 0, posture = 'stand') => { out.marks[name] = { x, z, yaw, posture }; return out.marks[name]; };
  // a fire as tongues of flame (cones) over a bed of embers; the stage makes them flicker
  const flame = (x, y, z, size = 1, mat = M.fireGlow) => {
    const g = new Group(); g.position.set(x, y, z); g.userData.flame = { size, seed: x * 3.1 + z * 1.7 };
    const n = size > 0.5 ? 5 : 1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = n > 1 ? 0.12 * size : 0;
      const c = new Mesh(new ConeGeometry(0.07 * size + 0.012, (0.32 + (i % 2) * 0.12) * size + 0.04, 7), i === 0 && n > 1 ? M.candleGlow : mat);
      c.position.set(Math.cos(a) * r, (0.16 + (i % 2) * 0.06) * size + 0.02, Math.sin(a) * r); c.castShadow = false; g.add(c);
    }
    if (size > 0.5) { const e = new Mesh(new CylinderGeometry(0.28 * size, 0.32 * size, 0.04, 12), M.ember); e.castShadow = false; g.add(e); }
    group.add(g); return g;
  };
  const light = (x, y, z, color = 0xffa050, power = 9, dist = 10, kind = 'fire') => { const L = new PointLight(color, power, dist, 2); L.position.set(x, y, z); group.add(L); out.lights.push({ L, x, y, z, power, kind }); return L; };
  light.flame = flame;
  if (indoor) interior(spec, F, R, M, B, add, mark, light, out);
  else exterior(spec, F, R, M, B, add, mark, light, out);
  for (const [key, geo] of B.build(UVS)) {
    const mesh = new Mesh(geo, M[key] ?? M.planks);
    mesh.castShadow = !['dark', 'water', 'fireGlow', 'candleGlow', 'paperGlow'].includes(key); mesh.receiveShadow = true;
    group.add(mesh);
  }
  // people stand in a loose arc facing the middle of the room, nearer the camera's side
  if (!out.stands.length) for (let i = 0; i < 8; i++) { const a = -1.1 + (i / 7) * 2.2, r = indoor ? Math.min(out.bounds.W, out.bounds.D) * 0.28 : 3.2; out.stands.push({ x: Math.sin(a) * r, z: Math.cos(a) * r * 0.6 - 0.3, yaw: Math.PI + a * 0.6, posture: 'stand' }); }
  mark('center', 0, 0.4);
  return out;
}

// --- inside -----------------------------------------------------------------------------------------

function interior(spec, F, R, M, B, add, mark, light, out) {
  const T = spec.type, style = spec.style ?? 'bohemian', jp = style === 'japanese';
  const big = spec.size === 'large' || T === 'hall' || T === 'church', small = spec.size === 'small' || T === 'cellar' || T === 'dungeon' || T === 'chamber';
  const W = big ? 14 : small ? 6 : 9, D = big ? 12 : small ? 5.5 : 8, H = T === 'church' ? 9 : T === 'hall' ? 7.5 : jp ? 2.9 : T === 'cave' ? 4 : 3.2;
  out.bounds = { W, D, H };
  const wallKey = jp ? 'shoji' : T === 'cave' ? 'rubble' : spec.walls === 'stone' || T === 'church' || T === 'dungeon' || T === 'cellar' ? 'stone' : spec.walls === 'brick' ? 'brick' : spec.walls === 'wood' || spec.walls === 'timber' ? 'planks' : spec.walls === 'wattle' ? 'wattle' : style === 'italian' ? 'stuccoWhite' : 'plaster';
  const floorKey = jp ? 'tatami' : { planks: 'planks', flagstone: 'flag', rushes: 'rushes', earth: 'earth', cobbles: 'flag', tatami: 'tatami' }[spec.floor] ?? (T === 'church' || T === 'hall' || T === 'dungeon' || T === 'cellar' ? 'flag' : T === 'stable' ? 'earth' : 'rushes');
  // the shell: floor, walls with the door on the right, the ceiling and its beams
  B.put(floorKey, box(W, 0.2, D), 0, -0.1, 0);
  B.put(T === 'cave' ? 'rubble' : 'dark', box(W, 0.2, D), 0, H + 0.1, 0);
  B.put(wallKey, box(W, H, 0.25), 0, H / 2, -D / 2);
  B.put(wallKey, box(0.25, H, D), -W / 2, H / 2, 0);
  B.put(wallKey, box(0.25, H, D * 0.35), W / 2, H / 2, -D * 0.325);
  B.put(wallKey, box(0.25, H, D * 0.35), W / 2, H / 2, D * 0.325);
  B.put(wallKey, box(0.25, H - 2.1, D * 0.3), W / 2, 2.1 + (H - 2.1) / 2, 0);
  // the front wall: low, so the camera can see in (and it closes the room for the light)
  B.put(wallKey, box(W, H, 0.25), 0, H / 2, D / 2);
  B.put('door', box(0.08, 2.0, 1.0), W / 2 - 0.05, 1.0, 0.55);   // the door, half open
  mark('door', W / 2 - 0.9, 0, -Math.PI / 2);
  if (!jp && T !== 'church' && T !== 'cave') for (let x = -W / 2 + 0.9; x < W / 2; x += 1.5) B.put('beam', box(0.2, 0.24, D), x, H - 0.12, 0);
  if (jp) for (let x = -W / 2; x <= W / 2; x += W / 4) B.put('darkWood', box(0.12, H, 0.12), x, H / 2, -D / 2 + 0.1);
  // windows on the back and left walls (not underground)
  if (!['cellar', 'dungeon', 'cave'].includes(T)) {
    const n = big ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? -W * 0.25 : -W / 2 + (i + 1) * W / (n + 1), wy = T === 'church' ? 5 : T === 'hall' ? 4.2 : 1.7, wh = T === 'church' ? 3.4 : 1.0, ww = T === 'church' ? 1.0 : 0.9;
      const pane = add(new PlaneGeometry(ww, wh), new MeshBasicMaterial({ color: new Color(1.5, 1.45, 1.3) }), x, wy, -D / 2 + 0.14);
      pane.castShadow = false; pane.userData.window = true;
      B.put('beam', box(ww + 0.16, 0.1, 0.16), x, wy + wh / 2, -D / 2 + 0.16); B.put('beam', box(ww + 0.16, 0.1, 0.16), x, wy - wh / 2, -D / 2 + 0.16);
      B.put('beam', box(0.06, wh, 0.12), x, wy, -D / 2 + 0.17);
      mark(i === 0 ? 'window' : 'window' + i, x, -D / 2 + 1.0, 0);
    }
  }
  const back = -D / 2;
  // the hearth (or the forge, or the furnace) on the back wall
  const hearth = F.hearth || T === 'tavern' || T === 'cottage' || T === 'kitchen' || T === 'hall';
  if (F.furnace || (T === 'workshop' && !F.anvil)) {
    B.put('rubble', new SphereGeometry(1.1, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), W * 0.22, 0, back + 1.3);
    add(new CylinderGeometry(0.3, 0.3, 0.05, 16), M.fireGlow, W * 0.22, 0.55, back + 0.42).rotation.x = Math.PI / 2;
    light(W * 0.22, 0.6, back + 0.8, 0xff8030, 18, 9);
    mark('furnace', W * 0.22 - 0.4, back + 2.4, Math.PI);
  } else if (hearth && !jp) {
    const hx = T === 'hall' ? 0 : W * 0.2;
    B.put('stone', box(2.0, 1.4, 0.8), hx, 0.7, back + 0.4);
    B.put('stone', box(1.4, H - 1.4, 0.6), hx, 1.4 + (H - 1.4) / 2, back + 0.3);
    B.put('dark', box(1.2, 0.9, 0.3), hx, 0.55, back + 0.68);
    for (let i = 0; i < 3; i++) B.put('log', cyl(0.07, 0.07, 0.8, 8), hx - 0.2 + i * 0.2, 0.18, back + 0.95, i * 0.7, { rz: Math.PI / 2 });
    light.flame(hx, 0.24, back + 0.95, 1);
    light(hx, 0.7, back + 1.4, 0xff9a40, 14, 11);
    mark('hearth', hx - 0.6, back + 2.2, Math.PI);
  } else if (F.stove) {
    B.put('tile', box(1.3, 1.2, 1.0), -W / 2 + 0.9, 0.6, back + 0.8);
    light(-W / 2 + 0.9, 1.0, back + 1.5, 0xff8040, 4, 6);
  }
  if (F.anvil || (T === 'workshop' && !F.furnace)) {
    B.put('iron', box(0.6, 0.25, 0.25), -W * 0.1, 0.75, back + 2.2); B.put('log', cyl(0.25, 0.28, 0.62, 10), -W * 0.1, 0.31, back + 2.2);
    B.put('stone', box(1.6, 0.9, 1.0), -W * 0.3, 0.45, back + 0.6);
    add(new BoxGeometry(0.9, 0.05, 0.5), M.fireGlow, -W * 0.3, 0.92, back + 0.6).castShadow = false;
    light(-W * 0.3, 1.2, back + 1.0, 0xff6020, 12, 8);
    mark('anvil', -W * 0.1 + 0.6, back + 2.6, Math.PI * 0.9);
  }
  // tables and benches
  const tables = F.tables || T === 'tavern' || T === 'hall' || T === 'kitchen';
  let seat = 0;
  if (tables && !jp) {
    const rows = T === 'hall' ? [[0, -D * 0.05, W * 0.6]] : T === 'tavern' ? [[-W * 0.22, -D * 0.08, 2.4], [W * 0.18, D * 0.08, 2.0]] : [[-W * 0.15, 0, 1.8]];
    for (const [x, z, w] of rows) {
      B.put('planks', box(w, 0.08, 0.8), x, 0.76, z);
      for (const sx of [-1, 1]) B.put('planks', box(0.1, 0.72, 0.6), x + sx * (w / 2 - 0.2), 0.36, z);
      benchProp(B, x, 0, z - 0.68, { w: w - 0.2 }); benchProp(B, x, 0, z + 0.68, { w: w - 0.2 });
      for (const sx of [-0.3, 0.3]) { mark('seat' + ++seat, x + sx * w, z - 0.68, 0, 'sit'); mark('seat' + ++seat, x + sx * w, z + 0.68, Math.PI, 'sit'); }
      mark(seat <= 4 ? 'table' : 'table2', x, z + 1.2, Math.PI);
      for (let i = 0; i < 3; i++) B.put('pottery', cyl(0.05, 0.06, 0.14, 8), x - w / 3 + i * w / 3 + (R() - 0.5) * 0.2, 0.87, z + (R() - 0.5) * 0.3);
    }
  }
  if (jp) {
    B.put('darkWood', box(1.2, 0.32, 0.8), 0, 0.16, -D * 0.1);
    for (const [x, z, y] of [[-0.9, -D * 0.1, Math.PI / 2], [0.9, -D * 0.1, -Math.PI / 2]]) { B.put('wool', box(0.55, 0.08, 0.55), x, 0.04, z); mark('seat' + ++seat, x, z, y, 'sit'); }
    // the alcove with a hanging scroll, a lantern
    B.put('darkWood', box(1.6, 0.15, 0.6), -W * 0.3, 0.08, back + 0.35);
    add(new PlaneGeometry(0.5, 1.2), M.linen, -W * 0.3, 1.5, back + 0.14);
    add(new CylinderGeometry(0.18, 0.18, 0.5, 8), M.paperGlow, W * 0.3, 0.45, back + 1.0).castShadow = false;
    light(W * 0.3, 0.6, back + 1.2, 0xffc080, 5, 6, 'lamp');
    mark('alcove', -W * 0.3, back + 1.4, Math.PI);
  }
  if (F.counter || T === 'tavern' || T === 'shop') {
    B.put('planks', box(0.6, 1.05, 2.6), W / 2 - 1.5, 0.52, -D * 0.25);
    for (let i = 0; i < 3; i++) barrel(B, W / 2 - 0.55, 0, -D * 0.25 - 0.9 + i * 0.9, { lying: true });
    mark('counter', W / 2 - 2.2, -D * 0.25, Math.PI / 2);
  }
  if (F.barrels && T !== 'tavern') for (let i = 0; i < 4; i++) barrel(B, -W / 2 + 0.5 + (i % 2) * 0.6, 0, D * 0.2 + Math.floor(i / 2) * 0.6);
  if (F.crates || F.sacks || T === 'cellar' || T === 'shop') { for (let i = 0; i < 3; i++) crate(B, -W / 2 + 0.5, i % 2 ? 0.45 : 0, -D * 0.1 + Math.floor(i / 2) * 0.6, { ry: R() }); for (let i = 0; i < 3; i++) sack(B, -W / 2 + 1.2 + i * 0.4, 0, D * 0.3, { seed: i + 3 }); }
  if (T === 'cellar') for (let i = 0; i < 6; i++) barrel(B, -W / 2 + 0.6 + i * 0.9, 0, back + 0.5);
  if (F.bed || T === 'chamber' || (T === 'cottage' && R() < 0.7)) {
    const bx = -W / 2 + 1.2;
    B.put(jp ? 'linen' : 'planks', box(1.0, jp ? 0.1 : 0.45, 2.0), bx, jp ? 0.05 : 0.22, back + 1.3);
    B.put('linen', box(0.95, 0.12, 1.95), bx, jp ? 0.14 : 0.5, back + 1.3);
    B.put('wool', box(0.97, 0.06, 1.3), bx, jp ? 0.21 : 0.58, back + 1.6);
    mark('bed', bx + 0.9, back + 1.4, -Math.PI / 2);
  }
  if (F.shelves || T === 'kitchen' || T === 'cottage' || T === 'shop') {
    B.put('planks', box(1.8, 0.05, 0.3), -W / 2 + 1.4, 1.5, back + 0.2); B.put('planks', box(1.8, 0.05, 0.3), -W / 2 + 1.4, 1.1, back + 0.2);
    for (let i = 0; i < 6; i++) B.put('pottery', cyl(0.07, 0.09, 0.22, 8), -W / 2 + 0.7 + i * 0.28, 1.25 + (i % 2) * 0.4, back + 0.2);
  }
  if (F.altar || T === 'church') {
    B.put('limewash', box(2.2, 1.0, 0.9), 0, 0.5, back + 1.0);
    B.put('linen', box(2.3, 0.04, 1.0), 0, 1.02, back + 1.0);
    B.put('gold', box(0.08, 1.0, 0.06), 0, 1.6, back + 0.8); B.put('gold', box(0.55, 0.08, 0.06), 0, 1.8, back + 0.8);
    for (const x of [-0.8, 0.8]) { B.put('linen', cyl(0.025, 0.025, 0.35, 6), x, 1.22, back + 1.0); light.flame(x, 1.39, back + 1.0, 0.12, M.candleGlow); light(x, 1.5, back + 1.2, 0xffc070, 2.5, 5, 'candle'); }
    mark('altar', 0, back + 2.2, Math.PI);
    if (T === 'church') for (let i = 0; i < 4; i++) for (const s of [-1, 1]) benchProp(B, s * 2.2, 0, -D * 0.05 + i * 1.3, { w: 2.6 });
  }
  if (F.pillars || T === 'church' || T === 'hall') for (let i = 0; i < 3; i++) for (const s of [-1, 1]) B.put('stone', cyl(0.3, 0.34, H, 12), s * W * 0.32, H / 2, -D * 0.3 + i * D * 0.3);
  if (F.candles && T !== 'church') for (let i = 0; i < 2; i++) { const x = -W * 0.2 + i * W * 0.4, z = -D * 0.08; light.flame(x, 0.955, z, 0.12, M.candleGlow); B.put('linen', cyl(0.025, 0.025, 0.16, 6), x, 0.88, z); light(x, 1.1, z, 0xffc070, 2.2, 5, 'candle'); }
  if (F.tapestry || T === 'hall') for (const x of [-W * 0.3, W * 0.05]) add(new PlaneGeometry(1.4, 2.4), new MeshStandardMaterial({ color: R() < 0.5 ? '#7a1018' : '#1c3a6a', roughness: 1, side: DoubleSide }), x, H * 0.55, back + 0.15);
  if (F.loom) { for (const s of [-1, 1]) B.put('planks', box(0.08, 1.7, 0.08), W * 0.3 + s * 0.7, 0.85, D * 0.1); B.put('planks', box(1.5, 0.08, 0.08), W * 0.3, 1.7, D * 0.1); add(new PlaneGeometry(1.3, 1.0), new MeshStandardMaterial({ color: '#c8b898', roughness: 1, side: DoubleSide }), W * 0.3, 1.1, D * 0.1); mark('loom', W * 0.3, D * 0.1 + 0.8, Math.PI); }
  if (F.desk) { B.put('planks', box(1.2, 0.06, 0.6), W * 0.3, 0.9, -D * 0.25); for (const s of [-1, 1]) B.put('planks', box(0.06, 0.88, 0.5), W * 0.3 + s * 0.5, 0.44, -D * 0.25); B.put('linen', box(0.4, 0.06, 0.3), W * 0.3, 0.96, -D * 0.25); stool(B, W * 0.3, 0, -D * 0.25 + 0.6); mark('desk', W * 0.3, -D * 0.25 + 0.7, Math.PI, 'sit'); }
  if (F.hay || T === 'stable') { for (let i = 0; i < 3; i++) { B.put('hay', new SphereGeometry(0.9, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), -W * 0.3 + i * 1.6, 0, back + 1.0); B.put('planks', box(0.08, 1.3, 1.8), -W * 0.3 + i * 1.6 + 0.8, 0.65, back + 1.0); } }
  if (F.woodpile) woodpile(B, -W / 2 + 0.5, 0, D * 0.25, { ry: Math.PI / 2, len: 1.6 });
  if (F.tub) tub(B, W * 0.15, 0, D * 0.25);
  if (F.herbs || T === 'cottage' || T === 'kitchen') for (let i = 0; i < 7; i++) B.put('leaves', new ConeGeometry(0.08, 0.35, 6), -W * 0.3 + i * 0.35, H - 0.5, -D * 0.2, 0, { rx: Math.PI });
  if (F.weapons) for (let i = 0; i < 5; i++) B.put('beam', cyl(0.02, 0.02, 2.4, 6), -W / 2 + 0.3, 1.2, -D * 0.25 + i * 0.25, 0, { rz: 0.1 });
  if (F.chains || T === 'dungeon') { for (let i = 0; i < 2; i++) add(new TorusGeometry(0.08, 0.015, 6, 12), M.iron, -W * 0.2 + i * 1.4, 1.5, back + 0.15); mark('wall', -W * 0.2, back + 1.0, Math.PI); }
  if (T === 'dungeon' || T === 'cellar' || T === 'cave' || (!hearth && !F.candles && !F.furnace && !jp && T !== 'church')) {
    // a torch on the wall
    const tx = W * 0.3, tz = back + 0.25;
    B.put('beam', cyl(0.03, 0.04, 0.5, 6), tx, 1.9, tz + 0.1, 0, { rx: 0.4 });
    light.flame(tx, 2.12, tz + 0.2, 0.35);
    light(tx, 2.2, tz + 0.5, 0xff9040, 6, 8, 'torch');
  }
  // stools and a few things about the floor
  if (!jp && T !== 'church') for (let i = 0; i < 2; i++) stool(B, (R() - 0.5) * W * 0.5, 0, D * 0.15 + R() * 0.8);
}

// --- outside ----------------------------------------------------------------------------------------

function facade(B, M, x, z, w, h, ry, style, R, night, add, light) {
  // a house front: walls, a roof, a door, windows; timber-framed, stuccoed or wooden by tradition
  const it = style === 'italian', jp = style === 'japanese';
  const wall = it ? ['stuccoOchre', 'stuccoRose', 'stuccoWhite'][Math.floor(R() * 3)] : jp ? 'darkWood' : 'plaster';
  const d = 5;
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  let [px, pz] = at(0, -d / 2);
  B.put(wall, box(w, h, d), px, h / 2, pz, ry);
  // roof
  if (it) { [px, pz] = at(0, -d / 2); B.put('terracotta', box(w + 0.4, 0.2, d + 0.6), px, h + 0.1, pz, ry); }
  else {
    const rise = jp ? 1.0 : 2.2 + R() * 0.8, key = jp ? 'roofTile' : R() < 0.5 ? 'shingle' : 'thatch';
    for (const sd of [-1, 1]) {
      const slope = Math.atan2(rise, d / 2 + 0.4), len = Math.hypot(rise, d / 2 + 0.4);
      [px, pz] = at(0, -d / 2 + sd * (d / 4 + 0.2));
      B.put(key, box(w + 0.5, 0.18, len), px, h + rise / 2, pz, ry, { rx: -sd * slope });
    }
  }
  // timber frame on the front (Bohemian and English traditions)
  if (!it && !jp) {
    for (const lx of [-w / 2 + 0.1, 0, w / 2 - 0.1]) { [px, pz] = at(lx, 0.04); B.put('beam', box(0.18, h, 0.1), px, h / 2, pz, ry); }
    [px, pz] = at(0, 0.04); B.put('beam', box(w, 0.18, 0.1), px, h * 0.5, pz, ry); B.put('beam', box(w, 0.18, 0.1), px, h - 0.1, pz, ry);
  }
  if (jp) for (let i = 0; i < 9; i++) { [px, pz] = at(-w / 2 + 0.4 + i * (w - 0.8) / 8, 0.05); B.put('beam', box(0.05, h * 0.55, 0.05), px, h * 0.3, pz, ry); }
  // the door and windows, lit within at night
  [px, pz] = at(-w * 0.2, 0.06); B.put('door', box(1.0, 2.0, 0.08), px, 1.0, pz, ry);
  for (const lx of [w * 0.2, -w * 0.2]) {
    const wy = lx < 0 ? h * 0.72 : h * 0.4;
    [px, pz] = at(lx + (lx < 0 ? 0.6 : 0), 0.07);
    const lit = night && R() < 0.6;
    const m = add(new PlaneGeometry(0.8, it ? 1.3 : 0.8), lit ? M.paperGlow : new MeshStandardMaterial({ color: '#141008', roughness: 0.6 }), px, wy, pz, ry);
    m.castShadow = false;
    if (lit && R() < 0.4) light(px + Math.sin(ry) * 1.2, wy, pz + Math.cos(ry) * 1.2, 0xffa860, 3, 7, 'window');
  }
  if (jp && R() < 0.7) { [px, pz] = at(-w * 0.2, 0.5); const l = add(new CylinderGeometry(0.16, 0.16, 0.42, 10), M.paperGlow, px, 2.3, pz); l.castShadow = false; if (night) light(px, 2.2, pz, 0xffb070, 3, 6, 'lantern'); }
}

function exterior(spec, F, R, M, B, add, mark, light, out) {
  const T = spec.type, style = spec.style ?? 'bohemian', night = spec.time === 'night';
  out.bounds = { W: 30, D: 30, H: 12 };
  const floorKey = { cobbles: 'stone', grass: 'grass', sand: 'sand', snow: 'snow', mud: 'mud', earth: 'earth', flagstone: 'flag' }[spec.floor]
    ?? (['street', 'market', 'square', 'courtyard', 'gate', 'castle'].includes(T) ? (style === 'italian' ? 'flag' : 'stone') : T === 'shore' ? 'sand' : T === 'road' ? 'mud' : 'grass');
  B.put(floorKey, box(120, 0.2, 120), 0, -0.1, 0);
  const town = ['street', 'market', 'square', 'courtyard', 'gate'].includes(T) || (T === 'bridge' && style === 'italian');
  if (town) {
    // two rows of houses facing each other across the way, one closing the far end
    const across = T === 'street' ? 7 : 11;
    let x = -16;
    while (x < 16) { const w = 4 + R() * 2.5; facade(B, M, x + w / 2, -across, w, 3.6 + R() * 2.4, 0, style, R, night, add, light); x += w + 0.1; }
    for (const sd of [-1, 1]) for (let z = -across + 3; z < 8; z += 5.5) facade(B, M, sd * (T === 'street' ? 14 : 16), z, 5, 3.8 + R() * 2, sd * Math.PI / 2 * -1, style, R, night, add, light);
  }
  if (T === 'castle' || T === 'gate' || T === 'courtyard') {
    B.put('stone', box(40, 9, 2.4), 0, 4.5, -14);
    for (let i = -18; i <= 18; i += 2.2) B.put('stone', box(1.2, 1.2, 2.4), i, 9.6, -14);
    for (const x of [-14, 0, 14]) { B.put('stone', cyl(3, 3.2, 16, 16), x, 8, -14); B.put('shingle', new ConeGeometry(3.6, 4.5, 16), x, 18.2, -14); }
    if (T === 'gate') { B.put('dark', box(3.6, 4.6, 2.6), 0, 2.3, -14); mark('gate', 0, -11.5, Math.PI); }
  }
  if (T === 'church' || T === 'graveyard') { B.put('stone', box(9, 9, 16), -8, 4.5, -16); B.put('stone', box(3.5, 20, 3.5), -8, 10, -7); B.put('shingle', new ConeGeometry(2.8, 7, 4), -8, 23.5, -7, Math.PI / 4); }
  if (F.graves || T === 'graveyard') for (let i = 0; i < 12; i++) grave(B, -6 + (i % 6) * 2.2, 0, -4 - Math.floor(i / 6) * 2.6, (R() - 0.5) * 0.2);
  if (F.trees || ['forest', 'field', 'road', 'hilltop', 'garden', 'river', 'camp'].includes(T)) {
    const n = T === 'forest' ? 60 : 16;
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, r = (T === 'forest' ? 4 : 12) + R() * (T === 'forest' ? 30 : 30);
      const x = Math.sin(a) * r, z = Math.cos(a) * r - (T === 'forest' ? 0 : 8);
      if (T !== 'forest' && z > 4) continue;
      const h = 5 + R() * 7, conifer = style === 'japanese' ? R() < 0.5 : R() < 0.45;
      B.put('log', cyl(0.12 + h * 0.012, 0.2 + h * 0.02, h, 8), x, h / 2, z);
      if (conifer) for (let k = 0; k < 3; k++) B.put('leaves', new ConeGeometry(1.6 + h * 0.12 - k * 0.5, h * 0.35, 9), x, h * (0.45 + k * 0.2), z);
      else B.put('leaves', new SphereGeometry(1.4 + h * 0.15, 10, 8), x, h * 0.85, z);
    }
  }
  if (T === 'field') for (let i = 0; i < 40; i++) B.put('earth', box(0.4, 0.15, 30), -16 + i * 0.8, 0.05, -10);
  if (T === 'road') B.put('mud', box(4, 0.05, 80), 0, 0.02, -20);
  if (T === 'hilltop') B.put('grass', new SphereGeometry(30, 24, 12, 0, Math.PI * 2, 0, 0.4), 0, -27.5, -6);
  if (F.water || ['river', 'shore', 'bridge', 'ship'].includes(T)) {
    const wz = T === 'shore' || T === 'ship' ? -16 : -9;
    add(new BoxGeometry(160, 0.1, T === 'river' || T === 'bridge' ? 9 : 60), M.water, 0, -0.02, wz - (T === 'river' || T === 'bridge' ? 0 : 26)).receiveShadow = true;
    if (T === 'bridge') { B.put('stone', box(4, 0.6, 12), 0, 1.4, wz); for (const s of [-1, 1]) B.put('stone', box(0.3, 0.8, 12), s * 1.9, 2.1, wz); mark('bridge', 0, wz + 3, Math.PI); }
  }
  if (F.boats || T === 'shore' || T === 'ship') for (let i = 0; i < (T === 'ship' ? 1 : 3); i++) { const x = -8 + i * 7, z = T === 'ship' ? 0 : -12; B.put('planks', box(2.0, 0.7, 6), x, 0.25, z); B.put('beam', cyl(0.08, 0.1, T === 'ship' ? 9 : 4, 8), x, 2, z); }
  if (F.well || T === 'square' || T === 'courtyard') { well(B, 2.5, 0, -2.5); mark('well', 2.5, -0.8, Math.PI); }
  if (F.cart || T === 'road' || T === 'market') cart(B, -4.5, 0, -1.5, { ry: 0.5 });
  if (F.stalls || T === 'market') for (let i = 0; i < 4; i++) { stall(B, -7 + i * 4.6, 0, -4.2, { ware: ['bread', 'pots', 'cloth', 'apples'][i], awning: i % 2 ? 'awningRed' : 'awning' }); if (i === 1) mark('stall', -7 + i * 4.6, -2.6, Math.PI); }
  if (F.fountain) { B.put('stone', cyl(1.8, 1.9, 0.6, 20), 0, 0.3, -3); add(new CylinderGeometry(1.6, 1.6, 0.05, 20), M.water, 0, 0.58, -3); B.put('stone', cyl(0.25, 0.3, 1.8, 10), 0, 1.2, -3); mark('fountain', 0, -0.8, Math.PI); }
  if (F.fence || T === 'garden' || T === 'field') for (let x = -14; x < 14; x += 1.2) { B.put('beam', box(0.08, 1.0, 0.08), x, 0.5, -6); B.put('beam', box(1.2, 0.06, 0.06), x + 0.6, 0.8, -6); }
  if (F.tents || T === 'camp') for (let i = 0; i < 5; i++) { const x = -10 + i * 5, z = -6 - (i % 2) * 3; B.put('linen', new ConeGeometry(2.2, 2.8, 4), x, 1.4, z, Math.PI / 4); }
  if (F.campfire || T === 'camp') { for (let i = 0; i < 6; i++) B.put('rubble', new SphereGeometry(0.18, 6, 5), Math.sin(i) * 0.6, 0.1, -1.5 + Math.cos(i) * 0.6); light.flame(0, 0.12, -1.5, 1.3); light(0, 0.8, -1.5, 0xff9040, 16, 12); mark('fire', 0.8, -0.2, Math.PI * 1.1); }
  if (F.haystack || F.hay) haystack(B, 6, 0, -5);
  if (F.pillory) { B.put('beam', box(0.2, 2.2, 0.2), 4, 1.1, -3); B.put('planks', box(1.4, 0.3, 0.12), 4, 1.7, -3); }
  if (F.dung) dungHeap(B, -6, 0, -3);
  if (F.rocks || T === 'hilltop' || T === 'cave') for (let i = 0; i < 8; i++) B.put('rubble', new SphereGeometry(0.4 + R() * 0.9, 7, 6), (R() - 0.5) * 24, 0.2, -4 - R() * 12);
  if (T === 'cave') { B.put('rubble', new SphereGeometry(9, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0, -14); B.put('dark', box(4, 3.6, 0.5), 0, 1.8, -5.3); }
}
