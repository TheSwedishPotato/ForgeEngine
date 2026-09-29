// A320neo cabin interior in SAS configuration (180 seats, 3-3, rows 1-31 without 13).
// Aircraft-local frame: x = right (starboard), y = up (cabin floor = 0), z = aft.
//
// Cross-section: the upper lobe of the A320 fuselage is a 1.98 m circle about a point 0.52 m above
// the cabin floor (3.95 m wide, widest at armrest height); the lining sits 0.13 m inside the skin,
// which gives the published 3.70 m cabin width. Towards the cockpit and the rear pressure bulkhead
// the fuselage narrows, and the lining (and everything fixed to it) narrows with it.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { sweepProfile, rrLoop, tunnel, mergeColored, trs, colorize } from './geom.js';
import * as TX from './textures.js';
import { rng, clamp } from './core.js';
import { SKIN, DOOR_Z, COCKPIT_DOOR_Z, AFT_BULKHEAD_Z, fusHalfWidthAt } from './airframe.js';

export const LINING = 0.13;
export const CAB = {
  yc: SKIN.yc, Rw: SKIN.R - LINING, Rpane: SKIN.R - 0.03, Rskin: SKIN.R,
  zFront: COCKPIT_DOOR_Z, zAft: AFT_BULKHEAD_Z,
  winY: 1.10, winW: 0.268, winH: 0.378, paneW: 0.228, paneH: 0.33,
  binBottomY: 1.62, ceilingY: 2.24,
};
// how much narrower the cabin is at z than in the constant section (1 = full width)
const W_REF = fusHalfWidthAt(8, CAB.winY);
export const taperK = (z) => clamp(fusHalfWidthAt(z, CAB.winY) / W_REF, 0.5, 1);
export const wallX = (y, z = 8) => Math.sqrt(Math.max(0, CAB.Rw * CAB.Rw - (y - CAB.yc) ** 2)) * taperK(z);
// scale x of every vertex by the local taper
export function taperGeometry(g) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * taperK(p.getZ(i)));
  p.needsUpdate = true; g.computeVertexNormals();
  return g;
}
export const ROWS = [...Array(12).keys()].map((i) => i + 1).concat([...Array(18).keys()].map((i) => i + 14));
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const SEAT_X = { A: -1.512, B: -1.005, C: -0.498, D: 0.498, E: 1.005, F: 1.512 };
export const BUSINESS_ROWS = 4;
export const EXIT_ROWS = [11, 12];

// Seat pitch on SAS's A320neo (seat maps): rows 2-10 30 in, exit rows 11 and 12 34 and 33 in,
// rows 14-29 29 in, rows 30-31 28 in. Row 1 starts 0.6 m behind the forward doors.
const IN = 0.0254;
const PITCH = (r) => (r <= 10 ? 30 : r === 11 ? 34 : r === 12 ? 33 : r <= 29 ? 29 : 28) * IN;
export const DOORS = { L1: { side: -1, z: DOOR_Z.L1 }, R1: { side: 1, z: DOOR_Z.L1 }, L4: { side: -1, z: DOOR_Z.L4 }, R4: { side: 1, z: DOOR_Z.L4 } };
export const DOOR_W = 0.81, DOOR_H = 1.85;
const ROW_Z = (() => {
  const m = {}; let z = DOOR_Z.L1 + DOOR_W / 2 + 0.6 + 0.26;
  for (const r of ROWS) { if (r !== 1) z += PITCH(r); m[r] = z; }
  return m;
})();
export const rowZ = (r) => ROW_Z[r];
export const HATCH_Z = [rowZ(11) - 0.47, rowZ(12) - 0.47];
// Monuments: the forward lavatory (left) reaches forward beside the cockpit door, galley G1 on the
// right; two lavatories and the galley at the back behind doors 4 (Airbus Space-Flex).
export const LAYOUT = {
  fwdLavZ0: -3.95, fwdMonAftZ: -2.87,    // forward lav/galley: aft faces just ahead of doors 1
  aftMonZ: DOOR_Z.L4 + DOOR_W / 2 + 0.12, // aft lavatories' forward faces, just behind doors 4
  aftGalleyZ: 23.30,                      // aft galley face (between the aft lavatories)
  aftStandZ: DOOR_Z.L4,                   // where the aft crew work, between doors 4
  fwdStandZ: DOOR_Z.L1,
  aisleZ0: -2.85, aisleZ1: DOOR_Z.L4 + DOOR_W / 2 + 0.1,
};

// Windows every 21 in (the frame pitch) from door 1 to door 4, the grid anchored on the two
// overwing exits (which carry their own windows).
export function windowList() {
  const wins = [];
  const P = 0.5334, zMin = DOOR_Z.L1 + DOOR_W / 2 + 0.3, zMax = DOOR_Z.L4 - DOOR_W / 2 - 0.3;
  const zs = [];
  for (let z = HATCH_Z[0] - P; z > zMin; z -= P) zs.push(z);
  for (let z = HATCH_Z[1] + P; z < zMax; z += P) zs.push(z);
  for (const side of [-1, 1]) {
    for (const z of zs) wins.push({ side, z, hatch: false });
    for (const hz of HATCH_Z) wins.push({ side, z: hz, hatch: true });
  }
  return wins;
}

// point on the lining circle of radius R at angle th (from +x about (0,yc)) for a side
const cyl = (side, R, th, z) => new THREE.Vector3(side * R * Math.cos(th), CAB.yc + R * Math.sin(th), z);
const thOfY = (R, y) => Math.asin((y - CAB.yc) / R);

function windowLoop(side, R, z, w, h, r, yCentre = CAB.winY) {
  const th0 = thOfY(CAB.Rw, yCentre), k = taperK(z);
  return rrLoop(w, h, r, 32).map(([a, b]) => { const p = cyl(side, R, th0 + b / R, z + a * (side > 0 ? 1 : -1)); p.x *= k; return p; });
}

export class Cabin {
  constructor({ quality = 'medium', seed = 7 } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'cabin';
    this.interactables = [];
    this.windows = [];
    this.seats = [];
    this.signMats = { belt: [], smoke: [] };
    this.moodMats = [];
    this.quality = quality;
    this.r = rng(seed);
    this.lightLevel = 1;
    this.mood = new THREE.Color('#fff4e6');
    this._buildMaterials();
    this._buildShell();
    this._buildWindows();
    this._buildBins();
    this._buildSeats();
    this._buildMonuments();
    this._buildDoors();
    this._buildSigns();
    this._buildLights();
    this._buildMasks();
  }

  _std(opts) { const m = new THREE.MeshStandardMaterial(opts); return m; }

  _buildMaterials() {
    this.mat = {
      wall: this._std({ color: '#e4e3df', roughness: 0.62, metalness: 0 }),
      plastic: this._std({ color: '#eeeeeb', roughness: 0.55, map: TX.plasticTex() }),
      ceiling: this._std({ color: '#ecebe8', roughness: 0.7, map: TX.ceilingTex(), emissive: '#ffffff', emissiveIntensity: 0.0 }),
      carpet: this._std({ color: '#ffffff', roughness: 0.95, map: TX.carpetTex(), normalMap: TX.carpetNormalTex(), normalScale: new THREE.Vector2(0.5, 0.5) }),
      bin: this._std({ color: '#efeeeb', roughness: 0.5, map: TX.binTex() }),
      binInside: this._std({ color: '#4a4f58', roughness: 0.9 }),
      seatFabric: this._std({ vertexColors: true, roughness: 0.9, map: TX.fabricTex(), normalMap: TX.fabricNormalTex(), normalScale: new THREE.Vector2(0.7, 0.7) }),
      seatLeather: this._std({ vertexColors: true, roughness: 0.55, map: TX.fabricTex(), normalMap: TX.leatherNormalTex(), normalScale: new THREE.Vector2(0.5, 0.5) }),
      seatHard: this._std({ vertexColors: true, roughness: 0.5, metalness: 0.05 }),
      seatBack: this._std({ color: '#c3c7cd', roughness: 0.42, map: TX.seatBackTex(), emissive: '#ffffff', emissiveMap: TX.seatBackEmissive(), emissiveIntensity: 1.2 }),
      wood: this._std({ color: '#ffffff', roughness: 0.35, map: TX.woodTex() }),
      bulkhead: this._std({ color: '#ffffff', roughness: 0.35, map: TX.bulkheadTex() }),
      metal: this._std({ color: '#c7cbd1', roughness: 0.35, metalness: 0.7, map: TX.metalTex() }),
      galley: this._std({ color: '#ffffff', roughness: 0.35, metalness: 0.55, map: TX.galleyTex() }),
      dark: this._std({ color: '#2a2e36', roughness: 0.8 }),
      reveal: this._std({ color: '#e2e1dd', roughness: 0.5, side: THREE.DoubleSide }),
      shade: this._std({ color: '#e4e3df', roughness: 0.6, side: THREE.DoubleSide, map: TX.plasticTex() }),
      curtain: this._std({ color: '#2c3a5e', roughness: 0.95, map: TX.fabricTex(), side: THREE.DoubleSide }),
      floorStrip: this._std({ color: '#cfd8c8', roughness: 0.5, emissive: '#9fb89a', emissiveIntensity: 0.25 }),
    };
    for (const m of Object.values(this.mat)) m.envMapIntensity = 0.6;
    this.mat.seatFabric.normalMap.repeat.set(3, 3); this.mat.seatLeather.normalMap.repeat.set(2, 2);
  }

  // --------------- shell: floor, sidewalls, ceiling ---------------
  _buildShell() {
    const zA = CAB.zFront, zB = CAB.zAft, L = zB - zA;
    const g = this.group;
    const SEG = 120; // along z, so the taper at both ends is smooth
    // floor (narrows with the fuselage; the carpet texture tiles every 1.2 m)
    const fw = wallX(0);
    const floor = new THREE.PlaneGeometry(fw * 2, L, 1, SEG);
    floor.rotateX(-Math.PI / 2); floor.translate(0, 0, (zA + zB) / 2);
    const uv = floor.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * fw * 2 / 1.2, uv.getY(i) * L / 1.2);
    taperGeometry(floor);
    const fm = new THREE.Mesh(floor, this.mat.carpet); fm.receiveShadow = true; g.add(fm);
    // floor path marking strips
    for (const s of [-1, 1]) {
      const len = LAYOUT.aisleZ1 - (rowZ(1) - 1.0);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.004, len), this.mat.floorStrip);
      st.position.set(s * 0.262, 0.002, rowZ(1) - 1.0 + len / 2); g.add(st);
    }
    // sidewalls with alpha-tested window and door holes
    const th0 = thOfY(CAB.Rw, 0), th1 = thOfY(CAB.Rw, CAB.binBottomY + 0.02);
    const arcLen = CAB.Rw * (th1 - th0);
    const holes = [];
    const hole = (z0, z1, y0, y1, r) => {
      const v0 = (CAB.Rw * (thOfY(CAB.Rw, y0) - th0)) / arcLen, v1 = (CAB.Rw * (Math.min(thOfY(CAB.Rw, Math.min(y1, 2.8)), th1 + 0.5) - th0)) / arcLen;
      holes.push({ u0: (z0 - zA) / L, u1: (z1 - zA) / L, v0, v1, rx: r / L, ry: r / arcLen });
    };
    // window holes are cut 6 mm inside the reveal so no gap can show at the corners
    const thW = thOfY(CAB.Rw, CAB.winY);
    for (const w of windowList()) {
      const ya = CAB.yc + CAB.Rw * Math.sin(thW - (CAB.winH / 2 - 0.006) / CAB.Rw), yb = CAB.yc + CAB.Rw * Math.sin(thW + (CAB.winH / 2 - 0.006) / CAB.Rw);
      hole(w.z - CAB.winW / 2 + 0.006, w.z + CAB.winW / 2 - 0.006, ya, yb, 0.08);
    }
    for (const d of Object.values(DOORS)) hole(d.z - DOOR_W / 2, d.z + DOOR_W / 2, 0.02, 3, 0.1);
    for (const hz of HATCH_Z) hole(hz - 0.255, hz + 0.255, 0.3, 1.36, 0.12);
    // left and right alpha maps are mirrored in z-direction (u flips), so build one per side
    const holesL = holes.filter((h, i) => true);
    this.wallTex = TX.sidewallTextures(4096, 512, holesL);
    const segs = 24;
    const prof = []; for (let i = 0; i <= segs; i++) { const th = th0 + (th1 - th0) * i / segs; prof.push([CAB.Rw * Math.cos(th), CAB.yc + CAB.Rw * Math.sin(th)]); }
    for (const side of [-1, 1]) {
      const geo = taperGeometry(sweepProfile(prof, zA, zB, { segZ: SEG, uScale: L, vScale: arcLen, flipX: side < 0, invert: true }));
      // second uv set for the tiled colour texture
      const mat = this._std({ color: '#ecebe8', roughness: 0.6, alphaMap: this.wallTex.alpha, alphaTest: 0.5, map: this.wallTex.color, side: THREE.FrontSide });
      mat.map.repeat.set(L / 1.2, 1);
      mat.onBeforeCompile = (sh) => { // separate uv transform for map (tiled) vs alpha (whole)
        sh.fragmentShader = sh.fragmentShader.replace('#include <alphamap_fragment>', 'diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;');
      };
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh);
      this.moodMats.push(mat);
    }
    // upper sidewall above bins at door zones & the band behind the bins
    // ceiling (centre panel) and cove
    const ceilProf = [];
    for (let i = 0; i <= 10; i++) { const x = -0.86 + 1.72 * i / 10; ceilProf.push([x, CAB.ceilingY - 0.14 * (x / 0.86) ** 2]); }
    const ceil = taperGeometry(sweepProfile(ceilProf, zA, zB, { segZ: SEG, uScale: 1.6, vScale: 1.72 }));
    const cm = new THREE.Mesh(ceil, this.mat.ceiling); cm.receiveShadow = true; g.add(cm);
    // end walls cut to the local cabin section: the rear pressure bulkhead, and the cockpit
    // partition with its door opening (left of x = -0.48 the forward lavatory takes the space)
    const k0 = taperK(zA), kB = taperK(zB);
    const aft = new THREE.Shape();
    for (let i = 0; i <= 48; i++) { const th = -Math.PI / 2 + Math.PI * 2 * i / 48; const x = CAB.Rw * Math.cos(th) * kB, y = CAB.yc + CAB.Rw * Math.sin(th); if (i === 0) aft.moveTo(x, Math.max(0, y)); else aft.lineTo(x, Math.max(0, y)); }
    const am = new THREE.Mesh(new THREE.ShapeGeometry(aft, 4), this.mat.wall); am.position.z = zB; am.rotation.y = Math.PI; g.add(am);
    const part = new THREE.Shape();
    const xL = -0.48, thL = Math.PI - Math.acos(Math.min(1, -xL / (CAB.Rw * k0)));
    part.moveTo(xL, 0); part.lineTo(wallX(0, zA), 0);
    for (let i = 0; i <= 32; i++) { const th = thOfY(CAB.Rw, 0) + (thL - thOfY(CAB.Rw, 0)) * i / 32; part.lineTo(CAB.Rw * Math.cos(th) * k0, CAB.yc + CAB.Rw * Math.sin(th)); }
    part.lineTo(xL, 0);
    const door = new THREE.Path(); door.moveTo(-0.42, 0.001); door.lineTo(0.42, 0.001); door.lineTo(0.42, 1.98); door.lineTo(-0.42, 1.98); door.lineTo(-0.42, 0.001);
    part.holes.push(door);
    const pm = new THREE.Mesh(new THREE.ShapeGeometry(part, 6), this.mat.wall2 || (this.mat.wall2 = Object.assign(this.mat.wall.clone(), { side: THREE.DoubleSide })));
    pm.position.z = zA; g.add(pm);
    this.cockpitDoorOpening = { x0: -0.42, x1: 0.42, z: zA, h: 1.98 };
  }

  // --------------- windows: reveals, shades, panes ---------------
  _buildWindows() {
    const g = this.group;
    const paneMat = this.paneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uFrost: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 }, uSpeed: { value: 0 }, uFog: { value: 0 }, uTint: { value: new THREE.Color('#bfd3d6') }, uLight: { value: 1 } },
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        varying vec2 vUv; varying vec3 vW;
        uniform float uFrost, uRain, uTime, uSpeed, uFog, uLight; uniform vec3 uTint;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
        float sdRR(vec2 p, vec2 b, float r){ vec2 q = abs(p)-b+r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
        void main(){
          vec2 p = (vUv-0.5)*vec2(0.228,0.33);
          float d = sdRR(p, vec2(0.114,0.165), 0.07);
          if (d > 0.0) discard;
          float edge = clamp(-d/0.05, 0.0, 1.0);
          float a = 0.05;
          vec3 col = uTint;
          // scratches & bleed hole
          float sc = smoothstep(0.985, 1.0, n(vUv*vec2(160.0,6.0)+3.0)) * 0.10;
          a += sc; col = mix(col, vec3(1.0), sc*4.0);
          float bh = length((vUv - vec2(0.5, 0.12))*vec2(0.228,0.33));
          if (bh < 0.0016) { col = vec3(0.1); a = 0.8; }
          // frost crystals creeping from the edges at cruise
          float fr = n(vUv*vec2(40.0,58.0)) * 0.6 + n(vUv*vec2(120.0,170.0))*0.4;
          float frost = uFrost * smoothstep(0.35, 0.9, (1.0-edge)*1.1 + fr*0.5);
          col = mix(col, vec3(0.93,0.96,1.0), frost); a = max(a, frost*0.85);
          // condensation fog
          a = max(a, uFog * 0.35 * (0.6+0.4*fr)); col = mix(col, vec3(0.9), uFog*0.4);
          // rain: small beads that streak aft along the pane as airspeed rises
          if (uRain > 0.0) {
            float stretch = 1.0 + uSpeed * 0.06;
            vec2 dir = normalize(vec2(-1.0, 0.18 + 0.4 / stretch));
            for (int k = 0; k < 3; k++) {
              float sc = 14.0 + float(k) * 9.0;
              vec2 q = vUv * vec2(sc * 0.7, sc);
              q -= dir * uTime * (0.3 + uSpeed * 0.02) * float(k + 1);
              vec2 cell = floor(q); vec2 f = fract(q) - 0.5;
              float rnd = h(cell + float(k) * 7.1);
              if (rnd < uRain * 0.55) {
                vec2 o = f - (vec2(h(cell * 3.1), h(cell * 4.3)) - 0.5) * 0.6;
                o.x /= stretch;
                float r = 0.08 + 0.1 * h(cell * 1.7);
                float d = length(o);
                float body = smoothstep(r, r * 0.55, d);
                float rim = smoothstep(r * 0.5, r * 0.9, d) * body;
                float spark = smoothstep(r * 0.35, 0.0, length(o - vec2(-r * 0.3, r * 0.35)));
                col = mix(col, vec3(1.0), spark * 0.6);
                a = max(a, body * 0.07 + rim * 0.12 + spark * 0.35);
              }
            }
          }
          gl_FragColor = vec4(col*uLight, a);
        }`,
    });
    this.paneMat = paneMat;
    const shadeGeoCache = new Map();
    for (const w of windowList()) {
      const side = w.side;
      const th = thOfY(CAB.Rw, CAB.winY);
      const inner = windowLoop(side, CAB.Rw - 0.001, w.z, CAB.winW, CAB.winH, 0.085);
      const mid = windowLoop(side, CAB.Rw + 0.06, w.z, CAB.winW - 0.028, CAB.winH - 0.03, 0.08);
      const outer = windowLoop(side, CAB.Rskin + 0.01, w.z, CAB.paneW, CAB.paneH, 0.07);
      const rev = mergeColored([{ geo: tunnel(inner, mid), color: '#ecebe7' }, { geo: tunnel(mid, outer), color: '#d8d8d4' }]);
      const rm = new THREE.Mesh(rev, this.mat.reveal); rm.castShadow = true; rm.receiveShadow = true;
      this.group.add(rm);
      // pane
      const k = taperK(w.z);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), paneMat);
      const c = cyl(side, CAB.Rpane, th, w.z); c.x *= k;
      const nrm = new THREE.Vector3(side * Math.cos(th), Math.sin(th), 0); // outward
      pane.position.copy(c);
      pane.lookAt(c.clone().sub(nrm)); // face inward
      pane.scale.set(CAB.paneW, CAB.paneH, 1);
      pane.renderOrder = 5;
      g.add(pane);
      // shade (curved panel sliding in the reveal)
      const key = side;
      if (!shadeGeoCache.has(key)) {
        const sw = CAB.winW - 0.03, sh = CAB.winH + 0.01;
        const R = CAB.Rw + 0.025;
        const prof = []; const n = 8;
        for (let i = 0; i <= n; i++) { const b = -sh / 2 + sh * i / n; const t2 = b / R; prof.push([R * Math.cos(t2), R * Math.sin(t2)]); }
        const sg = sweepProfile(prof, -sw / 2, sw / 2, { flipX: side < 0, invert: side > 0 });
        shadeGeoCache.set(key, sg);
      }
      const shadeRoot = new THREE.Group(); shadeRoot.position.set(0, CAB.yc, w.z); shadeRoot.rotation.z = side > 0 ? th : -th;
      const shade = new THREE.Mesh(shadeGeoCache.get(key), this.mat.shade); shade.castShadow = true; shade.receiveShadow = true;
      shadeRoot.add(shade);
      const narrow = new THREE.Group(); narrow.scale.x = k; narrow.add(shadeRoot); g.add(narrow); // follows the taper
      const centre = cyl(side, CAB.Rw, th, w.z); centre.x *= k;
      const win = { side, z: w.z, hatch: w.hatch, centre, normal: nrm.clone().negate(), shade: 0, shadeTarget: 0, shadeRoot, shadeMesh: shade, th, pane };
      shade.userData.interact = { kind: 'shade', win, prompt: () => (win.shadeTarget > 0.5 ? 'Open window shade' : 'Close window shade') };
      this.windows.push(win);
      this.setShade(win, 0, true);
    }
  }

  setShade(win, v, instant = false) {
    win.shadeTarget = v; if (instant) win.shade = v;
    const R = CAB.Rw + 0.025;
    const open = 1 - win.shade; // 1 = fully open -> shade slid up by winH
    const off = (open * (CAB.winH + 0.02)) / R;
    win.shadeRoot.rotation.z = (win.side > 0 ? win.th + off : -(win.th + off));
    win.shadeMesh.visible = win.shade > 0.02;
  }

  // --------------- overhead bins, PSU, cove lights ---------------
  _buildBins() {
    const g = this.group;
    const z0 = DOOR_Z.L1 + DOOR_W / 2 + 0.15, z1 = DOOR_Z.L4 - DOOR_W / 2 - 0.15;
    this.binZ = [z0, z1];
    const L = z1 - z0;
    const yb = CAB.binBottomY;
    const xw = wallX(yb) - 0.01;
    // PSU / bin bottom surface
    const psuProf = [[0.97, yb + 0.045], [xw, yb]];
    const rows = ROWS.map((r) => ({ row: r, z: rowZ(r) - 0.28 }));
    const SEG = 60;
    for (const side of [-1, 1]) {
      const tex = TX.psuTexture(4096, rows, z0, z1, side < 0 ? 'L' : 'R');
      const mat = this._std({ color: '#ffffff', roughness: 0.55, map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.18 });
      this.psuMats = this.psuMats || []; this.psuMats.push(mat);
      const geo = taperGeometry(sweepProfile(psuProf, z0, z1, { segZ: SEG, uScale: L, vScale: 0.76, flipX: side < 0 }));
      const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.castShadow = true; g.add(m);
      // bin body back, following the curved upper wall - mostly hidden, darker
      const back = taperGeometry(sweepProfile([[xw, yb], [wallX(1.8) - 0.01, 1.8], [wallX(2.0) - 0.01, 2.0], [0.84, 2.13]], z0, z1, { segZ: SEG, flipX: side < 0, invert: true }));
      const bm = new THREE.Mesh(back, this.mat.binInside); g.add(bm);
      // cove light strip (between bin top and ceiling), in segments for the mood scenes
      const NSEG = 24;
      for (let k = 0; k < NSEG; k++) {
        const za = z0 + L * k / NSEG, zb = z0 + L * (k + 1) / NSEG, kz = taperK((za + zb) / 2);
        const cove = new THREE.Mesh(new THREE.PlaneGeometry(0.09, zb - za), this._coveMat(1, (k + 0.5) / NSEG, side));
        cove.rotation.x = -Math.PI / 2; cove.rotation.y = side * 0.5; cove.position.set(side * 0.855 * kz, 2.105, (za + zb) / 2);
        g.add(cove);
        // wash light under the bin lip, lighting the window band
        const wash = new THREE.Mesh(new THREE.PlaneGeometry(0.05, zb - za), this._coveMat(0.6, (k + 0.5) / NSEG, side));
        wash.rotation.x = Math.PI / 2; wash.position.set(side * 1.0 * kz, yb + 0.028, (za + zb) / 2);
        g.add(wash);
      }
    }
    // end caps closing the bin run at both ends
    const capShape = (side, k) => {
      const sh = new THREE.Shape(); const pts = [[xw, yb], [0.97, yb + 0.045], [0.87, 2.1], [wallX(2.1) - 0.01, 2.1], [wallX(1.9) - 0.01, 1.9]];
      pts.forEach(([x, y], i) => (i ? sh.lineTo(side * x * k, y) : sh.moveTo(side * x * k, y))); sh.closePath(); return new THREE.ShapeGeometry(sh);
    };
    for (const side of [-1, 1]) for (const z of [z0, z1]) {
      const cap = new THREE.Mesh(capShape(side, taperK(z)), this.mat.wall2 || (this.mat.wall2 = Object.assign(this.mat.wall.clone(), { side: THREE.DoubleSide })));
      cap.position.z = z; g.add(cap);
    }
    // bin doors: segments ~1.52 m, hinge at top, open upward
    this.bins = [];
    const segLen = (z1 - z0) / 16;
    const lidProf = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; lidProf.push([0.97 - 0.1 * Math.sin(t * Math.PI / 2) - 0.02 * t, yb + 0.045 + (2.1 - yb - 0.045) * t]); }
    for (const side of [-1, 1]) {
      for (let k = 0; k < 16; k++) {
        const za = z0 + k * segLen + 0.004, zb = za + segLen - 0.008;
        const geo = sweepProfile(lidProf.map(([x, y]) => [x, y - 2.1]), za, zb, { uScale: segLen, vScale: 0.5, flipX: side < 0, invert: true });
        const lid = new THREE.Mesh(geo, this.mat.bin); lid.castShadow = true; lid.receiveShadow = true;
        const kz = taperK((za + zb) / 2);
        const pivot = new THREE.Group(); pivot.position.set(side * 0.85 * kz, 2.1, 0); pivot.scale.x = kz; lid.position.set(-side * 0.85, 0, 0);
        pivot.add(lid); g.add(pivot);
        // interior (visible when open)
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, segLen - 0.02), this.mat.binInside);
        box.position.set(side * 1.2 * kz, 1.84, (za + zb) / 2); g.add(box);
        const bin = { side, z0: za, z1: zb, pivot, open: 0, target: 0 };
        lid.userData.interact = { kind: 'bin', bin, prompt: () => (bin.target > 0.5 ? 'Close overhead bin' : 'Open overhead bin') };
        this.bins.push(bin);
      }
    }
  }

  _coveMat(k = 1, u = 0.5, side = 1) {
    const m = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: true, side: THREE.DoubleSide });
    m.userData.k = k; m.userData.u = u; m.userData.side = side; m.userData.cur = new THREE.Color('#fff4e6');
    this.coveMats = this.coveMats || []; this.coveMats.push(m); return m;
  }

  // Mood-lighting scenes (Airbus LED cabin lighting as used by SAS): returns the colour of
  // a strip at position u (0 front .. 1 aft) for a named scene.
  sceneColor(scene, u, side, out) {
    switch (scene) {
      case 'sweden': { // blue field with the yellow cross: crossbar a third of the way back
        const bar = Math.abs(u - 0.36) < 0.05; out.set(bar ? '#ffd23f' : '#2f7fe0'); break; }
      case 'denmark': { const bar = Math.abs(u - 0.36) < 0.05; out.set(bar ? '#ffffff' : '#e8323c'); break; }
      case 'norway': { const bar = Math.abs(u - 0.36) < 0.06; out.set(bar ? (Math.abs(u - 0.36) < 0.03 ? '#2a4fb5' : '#ffffff') : '#e03a3e'); break; }
      case 'sunset': { const c1 = new THREE.Color('#ff9a3c'), c2 = new THREE.Color('#7b4bb8'); out.copy(c1).lerp(c2, side > 0 ? u : 1 - u); break; }
      case 'boarding': out.set('#dfe9ff'); break;
      case 'night': out.set('#5b78c8'); break;
      case 'dim': out.set('#ffd9b0'); break;
      default: out.copy(this.mood); break;
    }
    return out;
  }

  // --------------- seats (instanced) ---------------
  _buildSeats() {
    const FLAT = TX.FLAT_UV;
    const fabric = '#5b5f68', headCover = '#33373f', shell = '#c9ccd1', frame = '#8e939b';
    // base: cushion + pan + legs + one armrest (left)
    const cushion = new RoundedBoxGeometry(0.43, 0.11, 0.46, 3, 0.035);
    const basePartsFab = [{ geo: cushion, color: fabric, matrix: trs(0, 0.40, -0.03) }];
    const baseHard = [
      { geo: new THREE.BoxGeometry(0.43, 0.04, 0.44), color: '#5a5f68', matrix: trs(0, 0.33, -0.02), flatUV: FLAT },
      { geo: new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6), color: frame, matrix: trs(0, 0.28, -0.2, 0, 0, Math.PI / 2), flatUV: FLAT },
      { geo: new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6), color: frame, matrix: trs(0, 0.28, 0.16, 0, 0, Math.PI / 2), flatUV: FLAT },
      { geo: new THREE.BoxGeometry(0.03, 0.3, 0.03), color: frame, matrix: trs(-0.2, 0.14, -0.18), flatUV: FLAT },
      { geo: new THREE.BoxGeometry(0.03, 0.3, 0.03), color: frame, matrix: trs(-0.2, 0.14, 0.16), flatUV: FLAT },
      { geo: new THREE.BoxGeometry(0.03, 0.02, 0.44), color: frame, matrix: trs(-0.2, 0.01, -0.01), flatUV: FLAT },
      { geo: new RoundedBoxGeometry(0.05, 0.05, 0.38, 2, 0.02), color: '#4b505a', matrix: trs(-0.235, 0.635, 0.02), flatUV: FLAT },
      { geo: new THREE.BoxGeometry(0.02, 0.2, 0.04), color: '#6c717a', matrix: trs(-0.235, 0.52, 0.14), flatUV: FLAT },
      { geo: new THREE.BoxGeometry(0.34, 0.07, 0.2), color: '#454a52', matrix: trs(0, 0.24, 0.02), flatUV: FLAT }, // life vest pouch
    ];
    const baseGeoF = mergeColored(basePartsFab);
    const baseGeoH = mergeColored(baseHard);
    // back (pivot at bottom rear of cushion), in back-local frame: y up the backrest
    const backFab = mergeColored([
      { geo: new RoundedBoxGeometry(0.43, 0.48, 0.075, 3, 0.03), color: fabric, matrix: trs(0, 0.25, 0) },
    ]);
    const headGeo = mergeColored([
      { geo: new RoundedBoxGeometry(0.40, 0.2, 0.09, 3, 0.035), color: headCover, matrix: trs(0, 0.58, -0.006) },
      { geo: new THREE.BoxGeometry(0.40, 0.012, 0.094), color: '#2f6bd6', matrix: trs(0, 0.482, -0.006), flatUV: FLAT }, // blue piping
    ]);
    const backShell = new THREE.BoxGeometry(0.43, 0.62, 0.02);
    backShell.translate(0, 0.33, 0.05);
    // map the seat back texture onto the +z (rear) face only; other faces flat
    const uvs = backShell.attributes.uv, nrm = backShell.attributes.normal;
    for (let i = 0; i < uvs.count; i++) if (nrm.getZ(i) < 0.9) uvs.setXY(i, 0.5, 0.95);
    this.seatGeo = { baseGeoF, baseGeoH, backFab, backShell, headGeo };

    // build seat records
    const seats = [];
    for (const r of ROWS) for (const L of LETTERS) {
      const blocked = r <= BUSINESS_ROWS && (L === 'B' || L === 'E');
      seats.push({ row: r, letter: L, id: `${r}${L}`, x: SEAT_X[L], z: rowZ(r), recline: 0, occupant: null, blocked, business: r <= BUSINESS_ROWS, exitRow: EXIT_ROWS.includes(r), index: seats.length });
    }
    this.seats = seats;
    const N = seats.length;
    const mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, N); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.group.add(m); return m; };
    this.iBaseF = mk(baseGeoF, this.mat.seatFabric);
    this.iBaseH = mk(baseGeoH, this.mat.seatHard);
    this.iBackF = mk(backFab, this.mat.seatFabric);
    this.iBackS = mk(backShell, this.mat.seatBack);
    this.iHead = mk(headGeo, this.mat.seatLeather);
    // extra right armrests for C and F, and aisle armrests on D (left of D is aisle side)
    const armGeo = mergeColored([{ geo: new RoundedBoxGeometry(0.05, 0.05, 0.38, 2, 0.02), color: '#4b505a', matrix: trs(0, 0.635, 0.02), flatUV: FLAT }, { geo: new THREE.BoxGeometry(0.02, 0.2, 0.04), color: '#6c717a', matrix: trs(0, 0.52, 0.14), flatUV: FLAT }]);
    const extra = seats.filter((s) => s.letter === 'C' || s.letter === 'F');
    this.iArm = new THREE.InstancedMesh(armGeo, this.mat.seatHard, extra.length);
    extra.forEach((s, i) => this.iArm.setMatrixAt(i, trs(s.x + 0.235, 0, s.z)));
    this.iArm.castShadow = true; this.group.add(this.iArm);
    for (const s of seats) this.updateSeat(s);
    // blocked middle seats in SAS Business: cocktail table on the seat
    const tbl = mergeColored([
      { geo: new RoundedBoxGeometry(0.4, 0.03, 0.34, 2, 0.01), color: '#d8d9dc', matrix: trs(0, 0.66, -0.02), flatUV: FLAT },
      { geo: new THREE.BoxGeometry(0.36, 0.2, 0.3), color: '#30343c', matrix: trs(0, 0.55, 0.0), flatUV: FLAT },
    ]);
    for (const s of seats.filter((q) => q.blocked)) {
      const m = new THREE.Mesh(tbl, this.mat.seatHard); m.position.set(s.x, 0, s.z); m.castShadow = true; this.group.add(m);
    }
    // empty-seat belts lying buckled on the cushion
    this.beltGeo = mergeColored([
      { geo: new THREE.BoxGeometry(0.2, 0.006, 0.045), color: '#2b2f37', matrix: trs(-0.1, 0.458, 0.05, 0, 0.3, 0), flatUV: FLAT },
      { geo: new THREE.BoxGeometry(0.2, 0.006, 0.045), color: '#2b2f37', matrix: trs(0.1, 0.458, 0.05, 0, -0.3, 0), flatUV: FLAT },
      { geo: new THREE.BoxGeometry(0.06, 0.012, 0.05), color: '#b9bdc4', matrix: trs(0, 0.46, 0.02), flatUV: FLAT },
    ]);
    this.iBelts = new THREE.InstancedMesh(this.beltGeo, this.mat.seatHard, N);
    this.iBelts.count = 0; this.group.add(this.iBelts);
  }

  seatBackMatrix(s, extraTilt = 0) {
    const tilt = (14 + s.recline * 9) * Math.PI / 180 + extraTilt;
    return trs(s.x, 0.455, s.z + 0.2, tilt, 0, 0);
  }

  updateSeat(s) {
    const i = s.index;
    const base = trs(s.x, 0, s.z);
    this.iBaseF.setMatrixAt(i, base); this.iBaseH.setMatrixAt(i, base);
    const bm = this.seatBackMatrix(s);
    this.iBackF.setMatrixAt(i, bm); this.iBackS.setMatrixAt(i, bm); this.iHead.setMatrixAt(i, bm);
    this.iBaseF.instanceMatrix.needsUpdate = this.iBaseH.instanceMatrix.needsUpdate = true;
    this.iBackF.instanceMatrix.needsUpdate = this.iBackS.instanceMatrix.needsUpdate = this.iHead.instanceMatrix.needsUpdate = true;
  }

  refreshEmptyBelts(except = null) {
    let n = 0;
    for (const s of this.seats) {
      if (s.occupant || s.blocked || s === except) continue;
      this.iBelts.setMatrixAt(n++, trs(s.x, 0, s.z));
    }
    this.iBelts.count = n; this.iBelts.instanceMatrix.needsUpdate = true;
  }

  seat(id) { return this.seats.find((s) => s.id === id); }

  // --------------- galleys, lavatories, cockpit door, jump seats, curtains ---------------
  _buildMonuments() {
    const g = this.group, M = this.mat;
    const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    // forward lavatory (left) and galley (right)
    this.lavs = [];
    const lavDoorMat = this._std({ color: '#ffffff', roughness: 0.5, map: TX.lavDoorTex() });
    // doorFace: -1 door in the forward wall, +1 in the aft wall, 'in' in the inboard side wall
    // (then doorZ is the door's centre along z)
    const mkLav = (x0, x1, z0, z1, doorFace, name, doorZc = null) => {
      const w = x1 - x0, d = z1 - z0;
      const walls = new THREE.Group();
      const t = 0.04, H = 2.12;
      const ww = (sw, sh, sd, px, py, pz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), M.wall); m.position.set(px, py, pz); m.castShadow = true; m.receiveShadow = true; walls.add(m); };
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = Math.sign(cx);
      const side = doorFace === 'in';
      const xin = sx < 0 ? x1 : x0, xout = sx < 0 ? x0 : x1; // inboard and outboard walls
      ww(t, H, d, xout, H / 2, cz);
      ww(w, 0.04, d, cx, H, cz);
      let pivot, door, dz, indPos, indRot;
      if (side) {
        ww(w, H, t, cx, H / 2, z0); ww(w, H, t, cx, H / 2, z1);
        // inboard wall with the door opening (0.56 m) centred at doorZc
        const a = doorZc - 0.28, b = doorZc + 0.28;
        if (a - z0 > 0.02) ww(t, H, a - z0, xin, H / 2, (z0 + a) / 2);
        if (z1 - b > 0.02) ww(t, H, z1 - b, xin, H / 2, (b + z1) / 2);
        ww(t, H - 1.9, 0.56, xin, 1.9 + (H - 1.9) / 2, doorZc);
        door = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.9, 0.56), lavDoorMat);
        pivot = new THREE.Group(); pivot.position.set(xin, 0.95, a); door.position.set(0, 0, 0.28);
        dz = doorZc; indPos = [xin - sx * 0.02, 1.97, doorZc]; indRot = -sx * Math.PI / 2;
      } else {
        ww(w, H, t, cx, H / 2, doorFace < 0 ? z1 : z0); // back wall
        ww(t, H, d, xin, H / 2, cz);
        dz = doorFace < 0 ? z0 : z1;
        door = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.9, 0.03), lavDoorMat);
        const hingeX = cx - 0.3 * sx;
        pivot = new THREE.Group(); pivot.position.set(hingeX, 0.95, dz); door.position.set(0.3 * sx, 0, 0);
        const rem = w - 0.62;
        if (rem > 0.02) { const m = new THREE.Mesh(new THREE.BoxGeometry(rem, H, t), M.wall); m.position.set(cx + sx * (0.31 + rem / 2), H / 2, dz); g.add(m); }
        indPos = [cx, 1.97, dz + (doorFace < 0 ? -0.02 : 0.02)]; indRot = doorFace < 0 ? Math.PI : 0;
      }
      g.add(walls);
      pivot.add(door); g.add(pivot);
      // occupied indicator
      const ind = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.04), new THREE.MeshBasicMaterial({ color: '#2ecc71' }));
      ind.position.set(...indPos); ind.rotation.y = indRot; g.add(ind);
      // interior fixtures: toilet against the outboard wall, sink, mirror
      const toilet = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.42, 12), this._std({ color: '#d9dcdf', roughness: 0.25, metalness: 0.5 }));
      toilet.position.set(xout - sx * 0.3, 0.21, side ? z0 + 0.35 : (doorFace < 0 ? z1 - 0.3 : z0 + 0.3)); g.add(toilet);
      const sink = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.4), this._std({ color: '#e9eaea', roughness: 0.3 }));
      sink.position.set(side ? cx : cx - sx * 0.18, 0.85, side ? z1 - 0.25 : cz); g.add(sink);
      const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.5), this._std({ color: '#b8c4cc', roughness: 0.05, metalness: 1 }));
      mirror.position.set(xout - sx * 0.03, 1.45, cz); mirror.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; g.add(mirror);
      const lamp = new THREE.PointLight('#fff1dc', 0, 2.2, 2); lamp.position.set(cx, 2.0, cz); g.add(lamp);
      const lav = { name, x0, x1, z0, z1, door: pivot, doorMesh: door, indicator: ind, open: 0, target: 0, occupied: false, lamp, toilet, doorZ: dz, doorFace, doorX: side ? xin : cx, cx, cz, sideDoor: side };
      door.userData.interact = { kind: 'lavdoor', lav, prompt: () => (lav.occupied ? 'Occupied' : lav.target > 0.5 ? 'Close door' : 'Open lavatory door') };
      toilet.userData.interact = { kind: 'flush', lav, prompt: () => 'Flush' };
      sink.userData.interact = { kind: 'sink', lav, prompt: () => 'Wash hands' };
      this.lavs.push(lav);
      return lav;
    };
    const F = LAYOUT;
    // forward lavatory: left, from beside the cockpit door back to door 1L; its door opens into the
    // vestibule in front of the cockpit door
    mkLav(-1.42, -0.48, F.fwdLavZ0, F.fwdMonAftZ, 'in', 'Lavatory A', (CAB.zFront + F.fwdMonAftZ) / 2);
    // Space-Flex rear: two lavatories in the corners behind doors 4, the galley between them
    mkLav(-1.30, -0.55, F.aftMonZ, CAB.zAft - 0.06, -1, 'Lavatory D');
    mkLav(0.55, 1.30, F.aftMonZ, CAB.zAft - 0.06, -1, 'Lavatory E');
    // forward galley G1 (right), working face towards the door area
    box(1.02, 2.1, F.fwdMonAftZ - CAB.zFront, 0.99, 1.05, (CAB.zFront + F.fwdMonAftZ) / 2, M.wall);
    const fgFace = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.0), M.galley); fgFace.position.set(0.99, 1.02, F.fwdMonAftZ + 0.005); g.add(fgFace);
    fgFace.userData.interact = { kind: 'galley', prompt: () => 'Galley' };
    // aft galley (centre, against the pressure bulkhead)
    box(1.06, 2.1, CAB.zAft - F.aftGalleyZ, 0, 1.05, (CAB.zAft + F.aftGalleyZ) / 2, M.wall);
    const agFace = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 2.0), M.galley); agFace.position.set(0, 1.02, F.aftGalleyZ - 0.005); agFace.rotation.y = Math.PI; g.add(agFace);
    agFace.userData.interact = { kind: 'galley', prompt: () => 'Galley' };
    this.aftGalley = { z: F.aftGalleyZ - 0.1 };
    // Scandinavian wood-effect panel with the SAS logo on the lavatory wall facing door 1
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.05), M.bulkhead); panel.position.set(-0.95, 1.05, F.fwdMonAftZ + 0.03); panel.receiveShadow = true; g.add(panel);
    box(0.94, 0.04, 0.03, -0.95, 2.1, F.fwdMonAftZ + 0.03, M.metal);
    // cockpit door: hinged on its left, swinging into the flight deck
    const cdMat = this._std({ color: '#b9bdc3', roughness: 0.45 });
    const cdPivot = new THREE.Group(); cdPivot.position.set(-0.42, 0, CAB.zFront); g.add(cdPivot);
    const cd = new THREE.Mesh(new THREE.BoxGeometry(0.84, 1.97, 0.05), cdMat); cd.position.set(0.42, 0.985, 0); cd.castShadow = true; cdPivot.add(cd);
    const peep = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), M.dark); peep.position.set(0.42, 1.55, 0.027); cdPivot.add(peep);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.05), M.metal); handle.position.set(0.74, 1.0, 0.05); cdPivot.add(handle);
    const keypad = box(0.02, 0.12, 0.08, -0.465, 1.3, CAB.zFront + 0.25, M.dark);
    this.cockpitDoor = { pivot: cdPivot, mesh: cd, open: 0, target: 0, locked: true };
    const cdi = { kind: 'cockpit', prompt: () => (this.cockpitDoor.target > 0.5 ? 'Close the cockpit door' : this.cockpitDoor.locked ? 'Cockpit door (locked)' : 'Open the cockpit door') };
    cd.userData.interact = cdi; keypad.userData.interact = { kind: 'keypad', prompt: () => 'Cockpit door keypad: ask for access' };
    this.jumpSeats = [];
    const js = (x, z, face) => {
      const seat = new THREE.Group(); seat.position.set(x, 0, z); seat.rotation.y = face > 0 ? 0 : Math.PI;
      const cush = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.08, 0.36, 2, 0.02), M.curtain); cush.position.set(0, 0.47, -0.18); seat.add(cush);
      const back = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.55, 0.06, 2, 0.02), M.curtain); back.position.set(0, 0.8, 0.02); seat.add(back);
      g.add(seat); this.jumpSeats.push({ x, z: z + (face > 0 ? -0.18 : 0.18), face, root: seat });
    };
    // front double cabin-crew seat on the lavatory wall (facing aft, towards door 1L)
    js(-1.18, F.fwdMonAftZ + 0.05, -1); js(-0.74, F.fwdMonAftZ + 0.05, -1);
    // aft seats folding down from the galley face (facing forward)
    js(-0.25, F.aftGalleyZ - 0.03, 1); js(0.25, F.aftGalleyZ - 0.03, 1);
    // business curtain (open, gathered at the bins)
    this.curtains = [];
    const zc = rowZ(BUSINESS_ROWS) + 0.47;
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 1.35, 6, 1), M.curtain);
      const pos = c.geometry.attributes.position; for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 40) * 0.03);
      c.geometry.computeVertexNormals();
      c.position.set(s * 0.95, 1.5, zc); c.rotation.y = Math.PI / 2; g.add(c);
      this.curtains.push({ mesh: c, side: s, z: zc, closed: 0 });
    }
    const rail = box(2.0, 0.02, 0.03, 0, 2.2, zc, M.metal);
  }

  setCurtain(closed) {
    for (const c of this.curtains) {
      c.closed = closed;
      c.mesh.scale.x = closed ? 3.2 : 1;
      c.mesh.position.x = c.side * (closed ? 0.52 : 0.95);
      c.mesh.position.y = closed ? 1.2 : 1.5; c.mesh.scale.y = closed ? 1.6 : 1;
    }
  }

  // --------------- doors & overwing hatches ---------------
  _buildDoors() {
    const g = this.group;
    const doorMat = this._std({ color: '#ffffff', roughness: 0.5, map: TX.doorTex() });
    this.doors = {};
    for (const [name, d] of Object.entries(DOORS)) {
      const prof = []; const n = 10;
      for (let i = 0; i <= n; i++) { const y = 0.02 + (DOOR_H) * i / n; prof.push([wallX(y, d.z) - 0.02, y]); }
      const geo = sweepProfile(prof, -DOOR_W / 2, DOOR_W / 2, { uScale: DOOR_W, vScale: DOOR_H, flipX: d.side < 0, invert: d.side > 0 });
      // hinge on the forward edge, just outside the skin
      const hx = d.side * (fusHalfWidthAt(d.z, 1.0) - 0.05), hz = d.z - DOOR_W / 2;
      const pivot = new THREE.Group(); pivot.position.set(hx, 0, hz);
      const mesh = new THREE.Mesh(geo, doorMat); mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.position.set(-hx, 0, d.z - hz);
      pivot.add(mesh); g.add(pivot);
      // door surround (upper wall where the bins stop): between the monuments and the bin run
      const za = d.z < 10 ? LAYOUT.fwdMonAftZ : this.binZ[1], zb = d.z < 10 ? this.binZ[0] : LAYOUT.aftMonZ;
      const up = taperGeometry(sweepProfile([[wallX(CAB.binBottomY), CAB.binBottomY], [wallX(2.0) - 0.02, 2.0], [0.86, 2.13]], za, zb, { segZ: 4, flipX: d.side < 0, invert: true }));
      if (!this.mat.wall2) { this.mat.wall2 = this.mat.wall.clone(); this.mat.wall2.side = THREE.DoubleSide; }
      g.add(new THREE.Mesh(up, this.mat.wall2));
      // window in the door (small)
      const pane = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), this.paneMat);
      pane.position.set(d.side * (wallX(1.38, d.z) - 0.01) - hx, 1.38, d.z - hz);
      pane.rotation.set(0, d.side > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
      pivot.add(pane);
      this.doors[name] = { name, side: d.side, z: d.z, pivot, mesh, open: 0, target: 0, armed: true, hx, hz };
    }
    // overwing exit hatches
    const hatchMat = this._std({ color: '#ffffff', roughness: 0.5, map: TX.hatchTex() });
    this.hatches = [];
    for (const side of [-1, 1]) for (const hz of HATCH_Z) {
      const prof = []; const n = 8;
      for (let i = 0; i <= n; i++) { const y = 0.3 + 1.06 * i / n; prof.push([wallX(y, hz) - 0.012, y]); }
      const geo = sweepProfile(prof, hz - 0.255, hz + 0.255, { uScale: 0.51, vScale: 1.06, flipX: side < 0, invert: side > 0 });
      // cut a hole for the window using alpha map
      const m = new THREE.Mesh(geo, hatchMat); m.castShadow = true; g.add(m);
      this.hatches.push({ side, z: hz, mesh: m });
    }
    hatchMat.alphaTest = 0.5;
    hatchMat.alphaMap = TX.canvasTex(64, 128, (gg, w, h) => {
      gg.fillStyle = '#fff'; gg.fillRect(0, 0, w, h);
      // window hole: hatch spans y 0.3..1.36, window centre at winY
      const v0 = (CAB.winY - CAB.winH / 2 - 0.3) / 1.06, v1 = (CAB.winY + CAB.winH / 2 - 0.3) / 1.06;
      const u0 = (0.255 - CAB.winW / 2) / 0.51, u1 = (0.255 + CAB.winW / 2) / 0.51;
      gg.fillStyle = '#000'; TX.rr(gg, u0 * w, (1 - v1) * h, (u1 - u0) * w, (v1 - v0) * h, 10); gg.fill();
    }, { srgb: false });
  }

  // --------------- signs (PSU pictograms, EXIT) ---------------
  _buildSigns() {
    const g = this.group;
    const beltTex = TX.signTexture('belt'), smokeTex = TX.signTexture('nosmoke');
    const mkSignMat = (tex) => { const m = new THREE.MeshStandardMaterial({ color: '#222', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 1, roughness: 0.4, map: tex }); return m; };
    this.beltSignMat = mkSignMat(beltTex); this.smokeSignMat = mkSignMat(smokeTex);
    const geo = new THREE.PlaneGeometry(0.09, 0.045);
    const yb = CAB.binBottomY;
    for (const side of [-1, 1]) {
      for (let k = 0; k < ROWS.length; k += 2) {
        const r = ROWS[k];
        const z = rowZ(r) - 0.46;
        for (const [j, mat] of [[0, this.beltSignMat], [1, this.smokeSignMat]]) {
          const m = new THREE.Mesh(geo, mat);
          const x = side * (1.05 + 0.02);
          m.position.set(side * 1.1, yb + 0.034, z + (j ? 0.1 : 0));
          m.rotation.x = Math.PI / 2; m.rotation.z = side > 0 ? Math.PI / 2 : -Math.PI / 2;
          m.rotation.y = side * -0.06;
          g.add(m);
        }
      }
    }
    // EXIT signs hanging from the ceiling (double-sided)
    const exitTex = TX.exitSignTexture();
    const exitMat = new THREE.MeshBasicMaterial({ map: exitTex, side: THREE.DoubleSide });
    this.exitMat = exitMat;
    for (const z of [DOOR_Z.L1 + 0.75, (HATCH_Z[0] + HATCH_Z[1]) / 2, DOOR_Z.L4 - 0.75]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.105), exitMat);
      s.position.set(0, 2.08, z); g.add(s);
    }
    // life vest placards on seat backs are in texture; "EXIT" placards next to hatches
    for (const side of [-1, 1]) for (const hz of HATCH_Z) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.075), exitMat);
      s.position.set(side * (wallX(1.5, hz) - 0.01), 1.5, hz); s.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; g.add(s);
    }
  }

  // Passenger reading light: a glowing lens and a faint cone of light.
  setReadingLight(seat, on) {
    this._rl = this._rl || new Map();
    let m = this._rl.get(seat.id);
    if (!m && on) {
      const side = Math.sign(seat.x), li = { A: 0, B: 1, C: 2, D: 2, E: 1, F: 0 }[seat.letter];
      const g = new THREE.Group(); g.position.set(side * (1.3 - li * 0.11), CAB.binBottomY + 0.015, seat.z - 0.28);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), new THREE.MeshBasicMaterial({ color: '#fff6dd' })); lens.rotation.x = Math.PI / 2; g.add(lens);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.05, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#ffeccc', transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      cone.position.y = -0.53; cone.rotation.z = side * 0.18; g.add(cone);
      this.group.add(g); this._rl.set(seat.id, m = g);
    }
    if (m) m.visible = on;
  }
  allReadingLights(on) { if (this._rl) for (const m of this._rl.values()) m.visible = on && m.visible; }

  setSigns(belt, smoke = true) {
    this.beltSignMat.emissiveIntensity = belt ? 1.4 : 0.0;
    this.beltSignMat.color.set(belt ? '#222' : '#15171b');
    this.smokeSignMat.emissiveIntensity = smoke ? 1.4 : 0;
  }

  // --------------- cabin lighting ---------------
  _buildLights() {
    this.hemi = new THREE.HemisphereLight('#fff6ea', '#39445a', 1.0);
    this.group.add(this.hemi);
    this.amb = new THREE.AmbientLight('#ffffff', 0.25);
    this.group.add(this.amb);
    // two long ceiling "light lines" approximated by a few point lights along the aisle (no shadows)
    this.pl = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#fff4e6', 1.0, 9, 1.6);
      l.position.set(0, 2.0, 1 + i * 6.5); this.group.add(l); this.pl.push(l);
    }
    // reading light for the player's seat (spot)
    this.readingLight = new THREE.SpotLight('#fff3dd', 0, 2.4, 0.38, 0.6, 1.5);
    this.group.add(this.readingLight); this.group.add(this.readingLight.target);
  }

  // Emergency lighting: the normal lights go out; the floor path marking glows along both sides of
  // the aisle and the EXIT signs light up, so you can find the exits in darkness or smoke.
  setEmergency(on) {
    if (!this.pathStrips) {
      const mat = new THREE.MeshBasicMaterial({ color: '#c8ff9e' });
      this.pathStrips = new THREE.Group();
      for (const x of [-0.27, 0.27]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.004, 26.5), mat); m.position.set(x, 0.006, 11.4); this.pathStrips.add(m); }
      this.group.add(this.pathStrips);
    }
    // the normal ceiling lights double as the (dim, battery-powered) emergency lights, so no new
    // lights are added mid-flight (that would force every cabin material to recompile)
    this.pathStrips.visible = on;
    if (this.exitMat) this.exitMat.color.setScalar(on ? 2.2 : 1);
    this.emergency = on;
  }

  // Dust motes: a cloud of tiny additive sprites around a seat, lit only where the sun comes in.
  buildDust(seat) {
    const N = 420, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = seat.x + (Math.random() - 0.5) * 1.3; pos[i * 3 + 1] = 0.5 + Math.random() * 1.3; pos[i * 3 + 2] = seat.z - 1.2 + Math.random() * 2.4; seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSun: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSide: { value: Math.sign(seat.x) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float seed; uniform float uTime, uSun, uSide; uniform vec3 uSunDir; varying float vA;
        void main(){
          vec3 p = position; float t = uTime * 0.12 + seed * 30.0;
          p.x += sin(t * 1.3 + seed * 9.0) * 0.06; p.y += sin(t * 0.9 + seed * 5.0) * 0.05 - fract(t * 0.05) * 0.2 + 0.1; p.z += cos(t * 1.1 + seed * 7.0) * 0.06;
          // only motes on the sunny side of the seat, in the band the sun reaches through the window
          float sunny = clamp(-uSunDir.x * uSide, 0.0, 1.0) * clamp(uSunDir.y * 3.0, 0.0, 1.0);
          vA = uSun * sunny * (0.15 + 0.85 * pow(seed, 2.0)) * smoothstep(1.9, 1.2, p.y) * smoothstep(0.35, 0.7, p.y);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.5 + seed * 2.0) * (300.0 / max(-mv.z, 0.2));
        }`,
      fragmentShader: `varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard; gl_FragColor = vec4(vec3(1.0, 0.96, 0.9) * (1.0 - r) * vA * 0.35, 1.0); }`,
    });
    this.dust = new THREE.Points(g, mat); this.dust.frustumCulled = false; this.group.add(this.dust);
  }
  updateDust(t, sunI, sunLocal) { if (!this.dust) return; const u = this.dust.material.uniforms; u.uTime.value = t; u.uSun.value = Math.min(1, sunI / 2.5); u.uSunDir.value.copy(sunLocal); }

  setLighting(level, moodColor, daylight = 0, scene = 'warm') {
    this.lightLevel = level;
    this.mood.set(moodColor);
    this.scene = scene;
    const L = level;
    this.hemi.color.copy(this.mood); this.hemi.intensity = 0.45 * L + 0.2 * daylight + 0.02;
    this.hemi.groundColor.set('#3a4458').multiplyScalar(0.6 + daylight * 0.4);
    this.amb.intensity = 0.12 * L + 0.18 * daylight + 0.015;
    for (const l of this.pl) { l.color.copy(this.mood); l.intensity = this.emergency ? 0.3 : 1.7 * L; }
    const tmp = this._tmpC || (this._tmpC = new THREE.Color());
    const flag = scene === 'sweden' || scene === 'denmark' || scene === 'norway';
    for (const m of this.coveMats || []) {
      this.sceneColor(scene, m.userData.u, m.userData.side, tmp);
      m.userData.cur.lerp(tmp, 0.03);
      m.color.copy(m.userData.cur).multiplyScalar((flag ? 0.9 : 0.35 + 1.4 * L) * m.userData.k);
    }
    // the point lights and the ceiling glow follow the scene tint so the whole cabin takes on the colour
    const tint = this._tint || (this._tint = new THREE.Color());
    this.sceneColor(scene, 0.5, 1, tint);
    const soft = this._soft || (this._soft = new THREE.Color('#ffffff')); soft.lerp(tint, 0.05);
    for (const l of this.pl) l.color.copy(this.mood).multiply(soft.clone().lerp(new THREE.Color('#ffffff'), 0.5));
    this.mat.ceiling.emissive.copy(soft); this.mat.ceiling.emissiveIntensity = (flag ? 0.35 : 0.12) * L;
    this.exitMat.color.setScalar(L < 0.3 ? 1.4 : 1.1);
    for (const m of this.psuMats || []) { m.emissive.copy(this.mood); m.emissiveIntensity = 0.05 + 0.2 * L; }
  }

  // Passenger oxygen masks: stowed in the PSUs, four per three-seat group (one spare), dropped
  // automatically when the cabin altitude passes 14,000 ft. Yellow cups on clear tubes.
  _buildMasks() {
    const spots = [];
    for (const r of ROWS) for (const side of [-1, 1]) {
      const kz = taperK(rowZ(r)), xs = [0.98, 1.14, 1.3, 1.44].map((x) => side * x * kz); // across the PSU
      for (const x of xs) spots.push({ x, z: rowZ(r) - 0.16 + (Math.random() - 0.5) * 0.06, ph: Math.random() * 6.28, len: 0.5 + Math.random() * 0.12 });
    }
    this.maskSpots = spots;
    const cupGeo = new THREE.CylinderGeometry(0.055, 0.034, 0.075, 12, 1, true).translate(0, -0.0375, 0);
    const bagGeo = new THREE.SphereGeometry(0.03, 8, 6).scale(1, 1.6, 0.6).translate(0, -0.12, 0); // the reservoir bag hangs below the cup
    const tubeGeo = new THREE.CylinderGeometry(0.004, 0.004, 1, 5).translate(0, -0.5, 0);
    const n = spots.length;
    this.maskCups = new THREE.InstancedMesh(cupGeo, new THREE.MeshStandardMaterial({ color: '#f2c200', roughness: 0.55, side: THREE.DoubleSide }), n);
    this.maskBags = new THREE.InstancedMesh(bagGeo, new THREE.MeshStandardMaterial({ color: '#dfe8ee', roughness: 0.25, transparent: true, opacity: 0.3, depthWrite: false }), n);
    this.maskTubes = new THREE.InstancedMesh(tubeGeo, new THREE.MeshStandardMaterial({ color: '#dfe6ea', roughness: 0.2, transparent: true, opacity: 0.7 }), n);
    for (const m of [this.maskCups, this.maskBags, this.maskTubes]) { m.visible = false; m.frustumCulled = false; this.group.add(m); }
    this.maskK = 0; this.masksDown = false;
  }
  dropMasks() { if (this.masksDown) return; this.masksDown = true; this.maskK = 0; for (const m of [this.maskCups, this.maskBags, this.maskTubes]) m.visible = true; }
  _updateMasks(dt, t) {
    if (!this.masksDown) return;
    this.maskK = Math.min(1, this.maskK + dt * 1.8);
    const k = this.maskK, drop = k < 1 ? 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI * 3) * 0.08 * (1 - k) : 1;
    const yb = CAB.binBottomY, M = this._mm || (this._mm = new THREE.Matrix4()), q = this._mq || (this._mq = new THREE.Quaternion()), e = this._me || (this._me = new THREE.Euler());
    const one = this._m1 || (this._m1 = new THREE.Vector3(1, 1, 1)), pos = this._mp || (this._mp = new THREE.Vector3()), sc = this._ms || (this._ms = new THREE.Vector3());
    this.maskSpots.forEach((s, i) => {
      const len = s.len * drop;
      const sw = Math.sin(t * 1.7 + s.ph) * 0.05 + (this.maskSway || 0) * 0.3;
      e.set(sw, 0, Math.cos(t * 1.3 + s.ph) * 0.04); q.setFromEuler(e);
      pos.set(s.x, yb, s.z); sc.set(1, Math.max(0.001, len), 1);
      M.compose(pos, q, sc); this.maskTubes.setMatrixAt(i, M);
      pos.set(s.x + Math.sin(e.z) * len * -1, yb - len * Math.cos(sw), s.z + Math.sin(sw) * len);
      M.compose(pos, q, one); this.maskCups.setMatrixAt(i, M); this.maskBags.setMatrixAt(i, M);
    });
    for (const m of [this.maskCups, this.maskBags, this.maskTubes]) m.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    this._maskT = (this._maskT || 0) + dt;
    this._updateMasks(dt, this._maskT);
    for (const w of this.windows) {
      if (Math.abs(w.shade - w.shadeTarget) > 1e-3) { w.shade += Math.sign(w.shadeTarget - w.shade) * Math.min(Math.abs(w.shadeTarget - w.shade), dt * 1.6); this.setShade(w, w.shadeTarget, false); this.setShadeInternal(w); }
    }
    for (const b of this.bins) {
      if (Math.abs(b.open - b.target) > 1e-3) { b.open += Math.sign(b.target - b.open) * Math.min(Math.abs(b.target - b.open), dt * 2.2); }
      b.pivot.rotation.z = b.side * b.open * 1.05;
    }
    for (const l of this.lavs) {
      if (Math.abs(l.open - l.target) > 1e-3) l.open += Math.sign(l.target - l.open) * Math.min(Math.abs(l.target - l.open), dt * 2.5);
      l.door.rotation.y = l.sideDoor ? -Math.sign(l.cx) * l.open * 1.35 : -Math.sign(l.cx) * l.open * 1.35 * (l.doorFace < 0 ? -1 : 1);
      l.indicator.material.color.set(l.occupied ? '#e74c3c' : '#2ecc71');
    }
    for (const d of Object.values(this.doors)) {
      if (Math.abs(d.open - d.target) > 1e-3) d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), dt * (d.fast ? 0.8 : 0.35)); // emergency: the door's power assist throws it open
      // A320 doors lift slightly, push outboard, then swing forward against the fuselage
      const o = d.open, k1 = Math.min(o * 3, 1), k2 = Math.max(0, (o - 0.33) / 0.67);
      d.pivot.position.set(d.hx + d.side * k1 * 0.12, k1 * 0.04, d.hz);
      d.pivot.rotation.y = d.side * k2 * 1.72;
    }
    const cd = this.cockpitDoor;
    if (Math.abs(cd.open - cd.target) > 1e-3) cd.open += Math.sign(cd.target - cd.open) * Math.min(Math.abs(cd.target - cd.open), dt * 1.4);
    cd.pivot.rotation.y = cd.open * 1.6; // swings into the flight deck
  }
  setShadeInternal(w) {
    const R = CAB.Rw + 0.025;
    const off = ((1 - w.shade) * (CAB.winH + 0.02)) / R;
    w.shadeRoot.rotation.z = w.side > 0 ? w.th + off : -(w.th + off);
    w.shadeMesh.visible = w.shade > 0.02;
  }
}
