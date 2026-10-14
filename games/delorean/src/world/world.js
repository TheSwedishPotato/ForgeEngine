/**
 * Hill Valley on the Med Engine, on any date: the valley floor and the hills round it, the
 * roads (dirt tracks before 1920, asphalt after), the courthouse and the storefronts, the
 * farm or the mall, the twin pines, the street lamps of the period. Rebuilt whenever the date
 * changes what stands (a jump through time, or the lightning); the clock tower's hands, the
 * lamps and the windows follow the hour.
 *
 * Also the ground under the tyres (asphalt, dirt, grass, field) and what the car can hit.
 */
import { Group, Mesh, PlaneGeometry, BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, Color, PointLight, DoubleSide, Vector3 } from 'three';
import { Builder } from '../car/geom.js';
import { rng } from '../car/textures.js';
import * as T from './textures.js';
import { MAIN_Z, MAIN_W, MAIN_X0, MAIN_X1, ROAD_W, COUNTY_X1, SQUARE, SIDE_STREETS, NORTH_STREET, LOT, SURFACE } from './map.js';
import { buildCourthouse, buildStorefronts, setClock } from './town.js';
import { buildFarm, buildMall, buildPines } from './outskirts.js';
import { streetLamp, oak } from './props.js';

const V = (x, y, z) => new Vector3(x, y, z);

let _wm = null;
export function worldMaterials() {
  if (_wm) return _wm;
  const std = (o) => new MeshStandardMaterial(o);
  const rep = (t, x, y = x) => { const c = t.clone(); c.needsUpdate = true; c.repeat.set(x, y); return c; };
  _wm = {
    stone: std({ map: T.stone(), roughness: 0.8 }),
    stoneNew: std({ map: T.stone(), color: new Color(1.05, 1.02, 0.98), roughness: 0.75 }),
    stoneDirty: std({ map: T.stone(), color: new Color(0.62, 0.6, 0.56), roughness: 0.9 }),
    stoneDark: std({ map: T.stone(), color: new Color(0.7, 0.68, 0.64), roughness: 0.85 }),
    trimWhite: std({ color: new Color(0.82, 0.8, 0.76), roughness: 0.6 }),
    roof: std({ color: new Color(0.16, 0.17, 0.18), roughness: 0.7, metalness: 0.2, side: DoubleSide }),
    window: std({ color: new Color(0.03, 0.035, 0.04), roughness: 0.06, metalness: 0.4 }),
    windowDark: std({ color: new Color(0.02, 0.022, 0.025), roughness: 0.1, metalness: 0.3 }),
    windowDirty: std({ color: new Color(0.06, 0.06, 0.055), roughness: 0.35, metalness: 0.2 }),
    windowLit: std({ color: new Color(0.3, 0.3, 0.28), roughness: 0.2, emissive: new Color(1, 0.9, 0.72), emissiveIntensity: 0 }),
    boarded: std({ color: new Color(0.42, 0.33, 0.22), roughness: 0.85 }),
    doorWood: std({ color: new Color(0.22, 0.12, 0.06), roughness: 0.6 }),
    wood: std({ map: T.clapboard([150, 120, 86], 83), roughness: 0.85, side: DoubleSide }),
    barnWood: std({ map: T.clapboard([118, 96, 78], 84), roughness: 0.9, side: DoubleSide }),
    roofTin: std({ color: new Color(0.32, 0.3, 0.28), roughness: 0.55, metalness: 0.6, side: DoubleSide }),
    shingle: std({ map: T.shingles([64, 58, 54]), roughness: 0.9, side: DoubleSide }),
    clap0: std({ map: T.clapboard([226, 220, 206], 85), roughness: 0.8, side: DoubleSide }),
    clap1: std({ map: T.clapboard([170, 150, 120], 86), roughness: 0.85, side: DoubleSide }),
    clap2: std({ map: T.clapboard([138, 70, 52], 87), roughness: 0.85, side: DoubleSide }),
    brick0: std({ map: T.brick([140, 62, 46], 71), roughness: 0.9 }),
    brick1: std({ map: T.brick([120, 74, 52], 72), roughness: 0.9 }),
    brick2: std({ map: T.brick([168, 120, 84], 73), roughness: 0.9 }),
    brick3: std({ map: T.brick([96, 46, 38], 74), roughness: 0.9 }),
    stucco0: std({ map: T.stucco([222, 210, 186], 101), roughness: 0.9 }),
    stucco1: std({ map: T.stucco([214, 200, 170], 102), roughness: 0.9 }),
    stucco2: std({ map: T.stucco([200, 186, 160], 103), roughness: 0.9 }),
    stucco3: std({ map: T.stucco([196, 208, 196], 104), roughness: 0.9 }),
    brickChimney: std({ map: T.brick([130, 60, 44], 75), roughness: 0.9 }),
    awning0: std({ color: new Color(0.45, 0.06, 0.05), roughness: 0.9, side: DoubleSide }),
    awning1: std({ color: new Color(0.06, 0.2, 0.12), roughness: 0.9, side: DoubleSide }),
    awning2: std({ color: new Color(0.1, 0.12, 0.3), roughness: 0.9, side: DoubleSide }),
    ironBlack: std({ color: new Color(0.025, 0.025, 0.027), roughness: 0.5, metalness: 0.6 }),
    steelPole: std({ color: new Color(0.42, 0.43, 0.44), roughness: 0.45, metalness: 0.9 }),
    concreteBase: std({ map: T.concrete(), roughness: 0.9 }),
    lampGlass: std({ color: new Color(0.85, 0.82, 0.75), roughness: 0.3, emissive: new Color(1, 0.8, 0.55), emissiveIntensity: 0 }),
    bark: std({ color: new Color(0.16, 0.13, 0.1), roughness: 0.95 }),
    leaves: std({ color: new Color(0.11, 0.14, 0.06), roughness: 0.9, userData: { foliage: true } }),
    needles: std({ color: new Color(0.05, 0.1, 0.05), roughness: 0.9 }),
    burlap: std({ color: new Color(0.45, 0.36, 0.22), roughness: 1 }),
    straw: std({ color: new Color(0.62, 0.5, 0.26), roughness: 1 }),
    vanWhite: std({ color: new Color(0.78, 0.77, 0.74), roughness: 0.4 }),
    tireWorld: std({ color: new Color(0.02, 0.02, 0.02), roughness: 0.85 }),
    // the ground
    grass: std({ map: rep(T.grass('autumn'), 400), roughness: 0.95 }),
    lawn: std({ map: rep(T.grass('green'), 18), roughness: 0.9 }),
    field: std({ map: rep(T.field(), 40), roughness: 1 }),
    dirt: std({ map: T.dirt(), roughness: 0.95 }),
    asphalt: std({ map: T.asphalt('worn'), roughness: 0.82 }),
    asphaltNew: std({ map: T.asphalt('new'), roughness: 0.7 }),
    asphaltOld: std({ map: T.asphalt('old'), roughness: 0.88 }),
    concrete: std({ map: T.concrete(), roughness: 0.85 }),
    markWhite: std({ map: T.markings('solid'), roughness: 0.7, alphaTest: 0.5 }),
    markDash: std({ map: T.markings('dashed'), roughness: 0.7, alphaTest: 0.5 }),
    markYellow: std({ map: T.markings('yellow'), roughness: 0.7, alphaTest: 0.5 }),
    hills: std({ vertexColors: true, roughness: 0.95 }),
  };
  _wm.leaves.userData.foliage = true;
  return _wm;
}

/** A flat rectangle on the ground (y), textured in metres. */
function flat(b, mat, x0, z0, x1, z1, y = 0.02, scale = 0.25) {
  b.quad(mat, V(x0, y, z1), V(x1, y, z1), V(x1, y, z0), V(x0, y, z0), [x0 * scale, z1 * scale, x1 * scale, z0 * scale]);
}

/** The hills round the valley: a ring from 2.4 km out, rising to 300 m, golden grass and dark oak. */
function hills() {
  const cx = 350, cz = 0, NA = 160, NR = 12, r = rng(9);
  const P = [], C = [], idx = [];
  const ph = [r() * 9, r() * 9, r() * 9];
  for (let j = 0; j <= NR; j++) {
    const t = j / NR, R = 2400 + t * t * 4200;
    for (let i = 0; i <= NA; i++) {
      const a = (i / NA) * Math.PI * 2;
      const n = 0.55 + 0.25 * Math.sin(a * 3 + ph[0]) + 0.15 * Math.sin(a * 7 + ph[1]) + 0.08 * Math.sin(a * 17 + ph[2]);
      const h = j === 0 ? -1 : (Math.min(1, t * 2.2) * 320 * n + (r() - 0.5) * 18 * t);
      P.push(cx + Math.cos(a) * R, h, cz + Math.sin(a) * R);
      const oak = 0.25 + 0.5 * Math.max(0, Math.sin(a * 11 + j * 1.7));
      C.push(0.42 * (1 - oak) + 0.12 * oak, 0.36 * (1 - oak) + 0.15 * oak, 0.2 * (1 - oak) + 0.07 * oak);
    }
  }
  for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) {
    const a = j * (NA + 1) + i, b2 = a + 1, c = a + NA + 1, d = c + 1;
    idx.push(a, b2, c, b2, d, c);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(P, 3));
  g.setAttribute('color', new Float32BufferAttribute(C, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class World {
  constructor(stage, timeline) {
    this.stage = stage;
    this.timeline = timeline;
    this.M = worldMaterials();
    this.root = new Group();
    this.root.name = 'world';
    stage.scene.add(this.root);
    // the valley floor and the hills never change
    const ground = new Mesh(new PlaneGeometry(9000, 9000), this.M.grass);
    ground.rotation.x = -Math.PI / 2; ground.position.set(350, 0, 0);
    ground.castShadow = false;
    this.root.add(ground);
    const hm = new Mesh(hills(), this.M.hills); hm.castShadow = false;
    this.root.add(hm);
    this.era = new Group();
    this.root.add(this.era);
    this.lamps = [];
    this.colliders = [];
    this.key = null;
    this.clock = null;
  }

  /** The world as it stands at a moment (utc ms; local time { y, ... }). */
  setTime(utc, local) {
    const s = this.timeline.at(utc, local.y);
    this.state = s;
    const key = JSON.stringify([s.era, s.courthouse, s.clock, s.pines, s.farm, s.mall, s.lamps, s.paved]);
    if (key !== this.key) { this.key = key; this._build(s, local.y); }
    // the clock's hands, the lamps by the hour
    const hours = local.h + local.mi / 60 + (local.s ?? 0) / 3600;
    setClock(this.clock, hours);
    const sunEl = this.stage.sunPos?.elevation ?? 10;
    const dark = sunEl < 2;
    if (dark !== this._dark) {
      this._dark = dark;
      for (const l of this.lamps) l.visible = dark && l.userData.on !== false;
      this.M.lampGlass.emissiveIntensity = dark ? 6 : 0;
      this.M.windowLit.emissiveIntensity = dark ? 0.05 : 0.01;
      if (this.clock?.faceMat) this.clock.faceMat.emissive.setScalar(dark && s.era !== 'decline' ? 0.012 : 0);
    }
  }

  _build(s, year) {
    const M = this.M;
    for (const c of [...this.era.children]) { this.era.remove(c); c.traverse?.((o) => o.geometry?.dispose?.()); }
    this.lamps = [];
    this.colliders = [];
    this._dark = null;
    const b = new Builder();
    const add = (r) => { if (!r) return; this.era.add(r.group); this.colliders.push(...(r.colliders ?? [])); for (const l of r.lights ?? []) this._lamp(l); };
    // --- roads -----------------------------------------------------------------------------
    const paved = s.paved, road = s.era === 'future' ? 'asphaltNew' : s.era === 'decline' ? 'asphaltOld' : 'asphalt';
    this.roads = [];
    const roadRect = (x0, z0, x1, z1, mat, kind) => { flat(b, mat, x0, z0, x1, z1, kind === 'lot' ? 0.018 : 0.02, mat === 'dirt' ? 0.12 : 0.08); this.roads.push({ x0, z0, x1, z1, kind: mat === 'dirt' ? 'dirt' : 'asphalt' }); };
    if (s.era !== 'wild') {
      if (paved) {
        roadRect(MAIN_X0, MAIN_Z - MAIN_W / 2, MAIN_X1, MAIN_Z + MAIN_W / 2, road);
        roadRect(MAIN_X1, MAIN_Z - ROAD_W / 2, COUNTY_X1, MAIN_Z + ROAD_W / 2, road);
        for (const st of SIDE_STREETS) roadRect(st.x - 6, st.z0, st.x + 6, st.z1, road);
        roadRect(NORTH_STREET.x0 - 6, NORTH_STREET.z - 6, NORTH_STREET.x1 + 6, NORTH_STREET.z + 6, road);
        for (const x of [-300, 300]) roadRect(x - 5, -200, x + 5, 260, road);
        // markings: a white dashed centre line in the 1950s, double yellow later
        const centre = s.era === 'classic' ? ['markDash'] : ['markYellow', 'markYellow'];
        centre.forEach((m, k) => {
          const off = centre.length > 1 ? (k - 0.5) * 0.3 : 0;
          for (let x = MAIN_X0; x < COUNTY_X1; x += 8) b.quad(m, V(x, 0.03, MAIN_Z + off + 0.06), V(x + 8, 0.03, MAIN_Z + off + 0.06), V(x + 8, 0.03, MAIN_Z + off - 0.06), V(x, 0.03, MAIN_Z + off - 0.06), [0, 0, 1, 1]);
        });
        // pavements downtown
        for (const zz of [[MAIN_Z - MAIN_W / 2 - 4.5, MAIN_Z - MAIN_W / 2], [MAIN_Z + MAIN_W / 2, MAIN_Z + MAIN_W / 2 + 4.5]]) flat(b, 'concrete', -420, zz[0], 400, zz[1], 0.06, 0.4);
      } else {
        roadRect(MAIN_X0 * 0.5, MAIN_Z - 10, MAIN_X1 * 0.6, MAIN_Z + 10, 'dirt');
        roadRect(MAIN_X1 * 0.6, MAIN_Z - 3.5, COUNTY_X1 + 300, MAIN_Z + 3.5, 'dirt');
      }
      // the lawn of the square
      if (s.courthouse !== 'none') flat(b, s.era === 'frontier' ? 'dirt' : 'lawn', SQUARE.x0, SQUARE.z0, SQUARE.x1, SQUARE.z1, 0.025, 0.2);
    }
    // the mall's lot, or the farm's fields and its lane
    if (s.mall) roadRect(LOT.x0, LOT.z0, LOT.x1, LOT.z1, road === 'asphaltNew' ? 'asphalt' : road, 'lot');
    else if (s.farm) {
      flat(b, 'field', LOT.x0 + 30, LOT.z0 - 40, LOT.x1, 52, 0.015, 0.05);
      flat(b, 'field', LOT.x0 + 30, 66, LOT.x1, LOT.z1, 0.015, 0.05);
      roadRect(1080, 36, 1300, 44, 'dirt');
      this.fields = [{ x0: LOT.x0 + 30, z0: LOT.z0 - 40, x1: LOT.x1, z1: LOT.z1 }];
    }
    if (!s.farm) this.fields = [];
    // --- street lamps --------------------------------------------------------------------
    const kind = { gas: 'gas', incandescent: 'incandescent', sodium: 'sodium', none: null }[s.lamps] ?? null;
    const lampKind = s.era === 'future' ? 'led' : kind;
    if (lampKind && s.era !== 'wild') {
      const step = lampKind === 'gas' ? 60 : 32;
      for (let x = -400; x <= 380; x += step) {
        for (const side of [-1, 1]) {
          const z = MAIN_Z + side * (MAIN_W / 2 + 0.8);
          if (lampKind === 'gas' && side > 0) continue;
          this._lamp(streetLamp(b, lampKind, x + (side > 0 ? step / 2 : 0), z, side > 0 ? Math.PI / 2 : -Math.PI / 2));
          this.colliders.push({ type: 'circle', x: x + (side > 0 ? step / 2 : 0), z, r: 0.25, soft: true, name: 'lamp' });
        }
      }
      if (lampKind !== 'gas') for (let x = 420; x < COUNTY_X1; x += 70) { this._lamp(streetLamp(b, lampKind === 'incandescent' ? 'sodium' : lampKind, x, MAIN_Z - ROAD_W / 2 - 1, -Math.PI / 2)); }
    }
    // --- trees: the square's oaks, and oaks dotted over the valley ---------------------------
    const r = rng(31);
    if (s.courthouse !== 'none' && s.era !== 'frontier') for (const [x, z] of [[-55, -40], [55, -40], [-55, 10], [55, 10], [-25, 14], [25, 14]]) { oak(b, x, z, 1.1, Math.round(x * 3 + z)); this.colliders.push({ type: 'circle', x, z, r: 0.5, hard: true }); }
    for (let k = 0; k < 220; k++) {
      const x = -1800 + r() * 4000, z = -1600 + r() * 3200;
      if (Math.abs(z - MAIN_Z) < 40 || (x > -450 && x < 420 && z > -220 && z < 120) || (x > LOT.x0 - 20 && x < LOT.x1 + 40 && z > -260 && z < LOT.z1 + 20) || (Math.abs(x - 300) < 20 || Math.abs(x + 300) < 20)) continue;
      oak(b, x, z, 0.8 + r() * 0.6, k + 100);
      this.colliders.push({ type: 'circle', x, z, r: 0.5, hard: true });
    }
    this.era.add(b.build(M));
    // --- buildings ---------------------------------------------------------------------------
    const ch = buildCourthouse(M, s);
    add(ch);
    this.clock = ch.clock;
    add(buildStorefronts(M, s));
    if (s.farm) add(buildFarm(M, s));
    if (s.mall) add(buildMall(M, s));
    if (year >= 1945) add(buildPines(M, s, year));
    for (const o of this.era.children) o.traverse((m) => { if (m.isMesh && m.castShadow === false && m.material !== M.grass) m.castShadow = true; });
    this.stage.taa.reset = true;
  }

  _lamp(l) {
    if (!l || !(l.power > 0)) return;
    const p = new PointLight(l.color, l.power, l.range ?? 20);
    p.position.copy(l.pos);
    p.visible = false;
    this.era.add(p);
    this.lamps.push(p);
  }

  /** The ground under (x, z): its friction and rolling resistance. */
  surfaceAt(x, z) {
    for (const r of this.roads ?? []) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return SURFACE[r.kind];
    for (const f of this.fields ?? []) if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) return SURFACE.field;
    return SURFACE.grass;
  }

  /** The weather on a date (the famous storms), for the sky: clouds and the night's glow. */
  air(local, utc) {
    const s = this.state;
    const sodium = s?.era === 'decline' || s?.era === 'future';
    const g = (s?.glow ?? 0) * 2.6e-5;
    const glow = sodium ? [g, g * 0.58, g * 0.24] : [g, g * 0.72, g * 0.45];
    let clouds = [0.12, 0, 1, 0], rain = 0;
    const { y, mo, d, h } = local;
    if (y === 1955 && mo === 11 && d === 12 && h >= 17) { clouds = [1, 0.97, 0.45, 0.35]; rain = 0.85; }
    else if (y === 2015 && mo === 10 && d === 21 && (h < 16 || (h === 16 && local.mi < 29) || (h === 16 && local.mi === 29 && (local.s ?? 0) < 5))) { clouds = [1, 0.92, 0.6, 0.4]; rain = 0.7; }
    else {
      // otherwise a fair autumn: the day's own cloud from its date
      const k = Math.sin((y * 372 + mo * 31 + d) * 12.9898) * 43758.5453;
      const f = k - Math.floor(k);
      clouds = f < 0.65 ? [0.08 + f * 0.3, 0, 1, 0] : [0.5 + f * 0.4, f > 0.9 ? 0.6 : 0, 0.9, 0];
    }
    void utc;
    return { glow, clouds, haze: sodium ? 2.6e-5 : 1.6e-5, rain };
  }
}
