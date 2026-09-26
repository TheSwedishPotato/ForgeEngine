// A320neo exterior as seen from the cabin windows: wings with moving slats, flaps,
// spoilers and ailerons, sharklets, CFM LEAP-1A nacelles with thrust reversers,
// fuselage skin (SAS livery) and exterior lights. Aircraft-local frame as cabin.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, glowTex, rr } from './textures.js';
import { windowList, CAB, DOORS, DOOR_W, DOOR_H } from './cabin.js';
import { DEG, clamp, lerp } from './core.js';

// ---- planform (s = spanwise distance from centreline, m) ----
const S_ROOT = 1.9, S_KINK = 6.3, S_TIP = 17.05;
const LE = (s) => (s < S_KINK ? 5.0 + (s - S_ROOT) * (2.25 / 4.4) : 7.25 + (s - S_KINK) * (5.65 / 10.75));
const TE = (s) => (s < S_KINK ? 12.9 + (s - S_ROOT) * (0.05 / 4.4) : 12.95 + (s - S_KINK) * (1.55 / 10.75));
const TR = (s) => (s < S_KINK ? lerp(0.145, 0.122, (s - S_ROOT) / 4.4) : lerp(0.122, 0.102, (s - S_KINK) / 10.75));
const Y0 = (s) => -0.34 + (s - S_ROOT) * Math.tan(5.1 * DEG);
const TWIST = (s) => lerp(2.2, -1.6, (s - S_ROOT) / (S_TIP - S_ROOT)) * DEG;

function airfoil(x, t) { // returns [upper, lower] offsets (fraction of chord)
  const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const m = 0.022, p = 0.42;
  const yc = x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x);
  return [yc + yt, yc - yt * 0.92];
}

function wingPoint(side, s, x, upper, out = new THREE.Vector3()) {
  const le = LE(s), c = TE(s) - le;
  const [yu, yl] = airfoil(x, TR(s));
  const yy = (upper ? yu : yl) * c;
  const tw = TWIST(s);
  const dz = x * c - 0.25 * c;
  // twist about quarter chord
  const z = le + 0.25 * c + dz * Math.cos(tw) + yy * Math.sin(tw);
  const y = Y0(s) + yy * Math.cos(tw) - dz * Math.sin(tw);
  return out.set(side * s, y, z);
}

// Surface patch over chord range [x0,x1], span range [s0,s1]; closed box with end caps.
function wingPatch(side, s0, s1, x0, x1, { ns = 8, nx = 10, upperOnly = false, lowerOnly = false, uvMode = 'planform', thickPad = 0 } = {}) {
  const pos = [], uv = [], idx = [];
  const surf = (upper) => {
    const base = pos.length / 3;
    for (let j = 0; j <= ns; j++) {
      const s = lerp(s0, s1, j / ns);
      for (let i = 0; i <= nx; i++) {
        const t = i / nx; const x = x0 + (x1 - x0) * (upper ? t : t);
        const xx = x0 === 0 ? (1 - Math.cos(t * Math.PI / 2)) * (x1 - x0) + x0 : x; // cluster at LE
        const p = wingPoint(side, s, Math.max(1e-4, xx), upper);
        if (thickPad) p.y += upper ? thickPad : -thickPad;
        pos.push(p.x, p.y, p.z);
        uv.push(uvMode === 'planform' ? (s - S_ROOT) / (S_TIP - S_ROOT) : t, (p.z - 4) / 12);
      }
    }
    for (let j = 0; j < ns; j++) for (let i = 0; i < nx; i++) {
      const a = base + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      const flip = (upper ? 1 : -1) * side > 0;
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    return base;
  };
  let bu = -1, bl = -1;
  if (!lowerOnly) bu = surf(true);
  if (!upperOnly) bl = surf(false);
  if (bu >= 0 && bl >= 0) {
    // end caps & trailing/leading closure
    const row = nx + 1;
    for (const j of [0, ns]) {
      for (let i = 0; i < nx; i++) {
        const a = bu + j * row + i, b = a + 1, c = bl + j * row + i, d = c + 1;
        const flip = (j === 0 ? 1 : -1) * side > 0;
        if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
    }
    for (const i of [0, nx]) for (let j = 0; j < ns; j++) {
      const a = bu + j * row + i, b = bu + (j + 1) * row + i, c = bl + j * row + i, d = bl + (j + 1) * row + i;
      const flip = (i === 0 ? -1 : 1) * side > 0;
      if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function wingTexture() {
  return canvasTex(2048, 1024, (g, w, h) => {
    // u: span root->tip, v: chord position (z) — v=0 at z=4, v=1 at z=16 (canvas y flipped)
    g.fillStyle = '#c9ccd1'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 8; d[i] += n; d[i + 1] += n; d[i + 2] += n + 1; }
    g.putImageData(img, 0, 0);
    const Z = (z) => h - (z - 4) / 12 * h, U = (s) => (s - S_ROOT) / (S_TIP - S_ROOT) * w;
    // panel lines (chordwise ribs & spanwise stringers)
    g.strokeStyle = 'rgba(60,65,75,0.35)'; g.lineWidth = 1.2;
    for (let s = S_ROOT; s < S_TIP; s += 0.6) { g.beginPath(); g.moveTo(U(s), Z(LE(s))); g.lineTo(U(s), Z(TE(s))); g.stroke(); }
    for (let f = 0.15; f < 0.75; f += 0.075) { g.beginPath(); for (let s = S_ROOT; s <= S_TIP; s += 0.25) { const z = LE(s) + f * (TE(s) - LE(s)); g.lineTo(U(s), Z(z)); } g.stroke(); }
    // rivet rows
    g.fillStyle = 'rgba(70,70,80,0.25)';
    for (let s = S_ROOT; s < S_TIP; s += 0.6) for (let f = 0.15; f < 0.72; f += 0.012) { const z = LE(s) + f * (TE(s) - LE(s)); g.fillRect(U(s) - 1, Z(z), 2, 1); }
    // walkway (darker) near root with NO STEP boundary
    g.fillStyle = 'rgba(70,74,82,0.55)';
    g.beginPath(); g.moveTo(U(2.0), Z(8.5)); g.lineTo(U(4.2), Z(9.3)); g.lineTo(U(4.2), Z(11.4)); g.lineTo(U(2.0), Z(11.6)); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(20,20,25,0.8)'; g.lineWidth = 3; g.stroke();
    g.save(); g.translate(U(5.3), Z(10.3)); g.rotate(-Math.PI / 2); g.fillStyle = '#2b2d33'; g.font = 'bold 22px Arial'; g.fillText('NO STEP', -40, 0); g.restore();
    g.save(); g.translate(U(9.3), Z(11.6)); g.rotate(-Math.PI / 2); g.fillStyle = '#2b2d33'; g.font = 'bold 18px Arial'; g.fillText('NO STEP', -35, 0); g.restore();
    // fuel access panels & overwing refuel cap
    g.strokeStyle = 'rgba(50,55,65,0.5)'; g.lineWidth = 2;
    for (let s = 3; s < 15; s += 1.4) { const z = LE(s) + 0.45 * (TE(s) - LE(s)); g.beginPath(); g.ellipse(U(s), Z(z), 12, 7, 0, 0, 7); g.stroke(); }
    g.fillStyle = '#9ea3ab'; g.beginPath(); g.arc(U(12.5), Z(LE(12.5) + 0.35 * (TE(12.5) - LE(12.5))), 8, 0, 7); g.fill();
    // leading edge (slat) bare metal band
    g.fillStyle = 'rgba(220,225,232,0.9)';
    g.beginPath(); for (let s = S_ROOT; s <= S_TIP; s += 0.25) g.lineTo(U(s), Z(LE(s))); for (let s = S_TIP; s >= S_ROOT; s -= 0.25) g.lineTo(U(s), Z(LE(s) + 0.1 * (TE(s) - LE(s)))); g.fill();
    // wear / exhaust staining behind the engine
    g.fillStyle = 'rgba(80,70,60,0.12)'; g.beginPath(); g.ellipse(U(5.75), Z(12), 60, 170, 0, 0, 7); g.fill();
  });
}

function nacelleTexture() {
  return canvasTex(1024, 512, (g, w, h) => {
    // u around circumference (0 at bottom? lathe: u=0 at +x...), v along length (front at v=0)
    g.fillStyle = '#b9bdc4'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 7; d[i] += n; d[i + 1] += n; d[i + 2] += n + 2; }
    g.putImageData(img, 0, 0);
    // panel lines
    g.strokeStyle = 'rgba(50,55,65,0.45)'; g.lineWidth = 2;
    for (const v of [0.12, 0.38, 0.62, 0.8]) { g.beginPath(); g.moveTo(0, v * h); g.lineTo(w, v * h); g.stroke(); }
    // SAS blue crown on top (u around 0.25 is top when lathe starts at +x... we paint both halves symmetric)
    g.fillStyle = '#1d3780';
    for (const uc of [0.25]) { g.beginPath(); g.moveTo((uc - 0.12) * w, 0.12 * h); g.lineTo((uc + 0.12) * w, 0.12 * h); g.lineTo((uc + 0.05) * w, 0.3 * h); g.lineTo((uc - 0.05) * w, 0.3 * h); g.fill(); }
    // wordmark on both sides
    g.fillStyle = '#3a3f4a'; g.font = 'bold 44px Arial, sans-serif'; g.textAlign = 'center';
    for (const [uc, flip] of [[0.5, 1], [0.0, 1], [1.0, 1]]) {
      g.save(); g.translate(uc * w, 0.5 * h); g.rotate(Math.PI / 2); g.fillText('Scandinavian', 0, 12); g.restore();
    }
    // lip
    g.fillStyle = '#dfe3e8'; g.fillRect(0, 0, w, 0.05 * h);
  }, { repeat: false });
}

function sharkletTexture() {
  return canvasTex(256, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#20398a'); gr.addColorStop(1, '#172c6b');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.save(); g.translate(w * 0.55, h * 0.42); g.rotate(-Math.PI / 2 + 0.25);
    g.fillStyle = '#ffffff'; g.font = 'italic bold 110px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('SAS', 0, 36);
    g.restore();
  });
}

function skinTexture(holes) {
  // u along z (-7..31), v around (angle). Livery: silver-grey, blue belly, window holes via alpha.
  const zA = -7.5, zB = 31.5;
  const color = canvasTex(2048, 512, (g, w, h) => {
    g.fillStyle = '#cfd2d7'; g.fillRect(0, 0, w, h);
    // v: 0 = bottom (-90°), 1 = top (+90°) on this side; belly blue below ~ -40°
    const vOf = (deg) => (deg + 90) / 180;
    g.fillStyle = '#1d3a86'; g.fillRect(0, h - vOf(-38) * h, w, vOf(-38) * h);
    g.strokeStyle = 'rgba(60,65,75,0.35)'; g.lineWidth = 1;
    for (let z = zA; z < zB; z += 0.5334) { const x = (z - zA) / (zB - zA) * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let a = -80; a < 90; a += 12) { g.beginPath(); g.moveTo(0, h - vOf(a) * h); g.lineTo(w, h - vOf(a) * h); g.stroke(); }
  });
  const alpha = canvasTex(4096, 512, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#000';
    for (const o of holes) { rr(g, (o.z0 - zA) / (zB - zA) * w, h - o.v1 * h, (o.z1 - o.z0) / (zB - zA) * w, (o.v1 - o.v0) * h, 5); g.fill(); }
  }, { srgb: false });
  return { color, alpha, zA, zB };
}

export class Exterior {
  constructor() {
    this.group = new THREE.Group();
    this.parts = { flaps: [], slats: [], spoilers: [], ailerons: [], reversers: [], fans: [] };
    this.flexU = { value: 0 };
    const wingTex = wingTexture();
    const mk = (opts) => {
      const m = new THREE.MeshStandardMaterial(opts);
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uFlex = this.flexU;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uFlex;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float sp = clamp((abs(position.x) - 1.9) / 15.15, 0.0, 1.2);
            transformed.y += uFlex * sp * sp;`);
      };
      return m;
    };
    this.mats = {
      wing: mk({ color: '#ffffff', map: wingTex, roughness: 0.42, metalness: 0.35 }),
      wingLower: mk({ color: '#b8bcc3', roughness: 0.55, metalness: 0.3 }),
      metal: mk({ color: '#d7dbe1', roughness: 0.28, metalness: 0.8 }),
      flap: mk({ color: '#c3c7cd', roughness: 0.45, metalness: 0.35 }),
      dark: mk({ color: '#2d3139', roughness: 0.6, metalness: 0.3 }),
      nacelle: new THREE.MeshStandardMaterial({ color: '#ffffff', map: nacelleTexture(), roughness: 0.35, metalness: 0.45 }),
      lip: new THREE.MeshStandardMaterial({ color: '#e8ebef', roughness: 0.15, metalness: 0.95 }),
      core: new THREE.MeshStandardMaterial({ color: '#5a5f68', roughness: 0.5, metalness: 0.6 }),
      fan: new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.4, metalness: 0.7 }),
      sharklet: mk({ color: '#ffffff', map: sharkletTexture(), roughness: 0.35, metalness: 0.25 }),
      pylon: new THREE.MeshStandardMaterial({ color: '#c5c9cf', roughness: 0.45, metalness: 0.35 }),
      fairing: new THREE.MeshStandardMaterial({ color: '#c8ccd2', roughness: 0.5, metalness: 0.25 }),
    };
    for (const side of [-1, 1]) this._buildWing(side);
    for (const side of [-1, 1]) this._buildEngine(side);
    this._buildFuselage();
    this._buildLights();
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  }

  _add(geo, mat, parent = this.group) { const m = new THREE.Mesh(geo, mat); parent.add(m); return m; }

  _buildWing(side) {
    const M = this.mats;
    // main box (upper textured, lower plain)
    this._add(wingPatch(side, S_ROOT, S_TIP, 0.13, 0.76, { ns: 24, nx: 14, upperOnly: true }), M.wing);
    this._add(wingPatch(side, S_ROOT, S_TIP, 0.13, 0.76, { ns: 24, nx: 10, lowerOnly: true }), M.wingLower);
    // fixed leading edge near root & inboard of slats
    this._add(wingPatch(side, S_ROOT, 2.4, 0, 0.13, { ns: 2, nx: 6 }), M.metal);
    // slats: 5 panels (1 inboard, 4 outboard of engine)
    const slatSpans = [[2.4, 5.1], [6.6, 9.3], [9.3, 12.0], [12.0, 14.6], [14.6, 16.9]];
    // gap filler where the pylon meets the wing
    this._add(wingPatch(side, 5.1, 6.6, 0, 0.13, { ns: 2, nx: 6 }), M.metal);
    this._add(wingPatch(side, 16.9, S_TIP, 0, 0.13, { ns: 1, nx: 6 }), M.metal);
    for (const [a, b] of slatSpans) {
      const geo = wingPatch(side, a, b, 0, 0.135, { ns: 4, nx: 8 });
      const pivot = this._hinged(geo, M.metal, side, a, b, 0.11, -0.06);
      this.parts.slats.push({ pivot, side, sign: -1 });
    }
    // spoilers (upper surface panels ahead of the flaps)
    const spoil = [[3.0, 4.9], [6.7, 8.3], [8.3, 9.9], [9.9, 11.5], [11.5, 13.1]];
    for (const [a, b] of spoil) {
      const geo = wingPatch(side, a, b, 0.6, 0.755, { ns: 3, nx: 4, upperOnly: true, thickPad: 0.012 });
      const pivot = this._hinged(geo, M.wing, side, a, b, 0.6, 0.0, true);
      this.parts.spoilers.push({ pivot, side });
    }
    // flaps (inboard + outboard) and aileron
    for (const [a, b] of [[S_ROOT + 0.1, S_KINK], [S_KINK, 13.3]]) {
      const geo = wingPatch(side, a, b, 0.755, 1.0, { ns: 6, nx: 7 });
      const pivot = this._hinged(geo, M.flap, side, a, b, 0.8, -0.16);
      this.parts.flaps.push({ pivot, side, s0: a, s1: b });
      // flap track fairings (canoes)
    }
    for (const s of [3.6, 7.2, 9.6, 12.0]) {
      const le = LE(s), c = TE(s) - le;
      const canoe = new THREE.CapsuleGeometry(0.17, 2.4, 4, 8); canoe.rotateX(Math.PI / 2); canoe.scale(0.7, 1.15, 1);
      const p = wingPoint(side, s, 0.85, false);
      canoe.translate(side * s, p.y - 0.18, le + 0.9 * c);
      this._add(canoe, M.wingLower);
    }
    {
      const geo = wingPatch(side, 13.3, 16.6, 0.755, 1.0, { ns: 4, nx: 6 });
      const pivot = this._hinged(geo, M.flap, side, 13.3, 16.6, 0.755, 0.0);
      this.parts.ailerons.push({ pivot, side });
    }
    this._add(wingPatch(side, 16.6, S_TIP, 0.755, 1.0, { ns: 1, nx: 5 }), M.flap);
    // sharklet: blended winglet rising from the tip
    const tip = wingPoint(side, S_TIP, 0.0, true);
    const chordTip = TE(S_TIP) - LE(S_TIP);
    const shape = [];
    const nY = 10;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= nY; j++) {
      const t = j / nY;
      const hgt = 2.43 * t;
      const cant = side * (0.35 * t * t + 0.05 * t);
      const chord = lerp(chordTip * 1.05, 0.55, t ** 0.8);
      const zLe = LE(S_TIP) + 0.05 + 1.2 * t ** 1.3;
      for (let i = 0; i <= 8; i++) {
        const x = i / 8; const th = Math.sin(x * Math.PI) * 0.06 * chord * (1 - 0.5 * t);
        for (const sgn of [1, -1]) { /* both faces generated below */ }
        pos.push(side * S_TIP + cant + side * th * 0.5 - side * 0.03 * Math.sin(t * Math.PI / 2), tip.y + hgt * (1 - 0.15 * t) + 0.15 * Math.sin(t * Math.PI / 2) * (1 - t), zLe + x * chord);
        uv.push(side < 0 ? 1 - x : x, t); // logo reads correctly from the cabin on both sides
      }
    }
    for (let j = 0; j < nY; j++) for (let i = 0; i < 8; i++) { const a = j * 9 + i, b = a + 1, c = a + 9, d = c + 1; idx.push(a, b, c, b, d, c); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); sg.setIndex(idx); sg.computeVertexNormals();
    const shark = this._add(sg, M.sharklet); shark.material = M.sharklet.clone(); shark.material.side = THREE.DoubleSide;
    shark.material.onBeforeCompile = M.sharklet.onBeforeCompile;
    this[side < 0 ? 'tipL' : 'tipR'] = new THREE.Vector3(side * S_TIP, tip.y + 0.1, LE(S_TIP) + 0.6);
    // wing-body fairing
    const fair = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
    fair.scale(2.25, 1.0, 5.5); fair.translate(0, -0.55, 9.3);
    if (side > 0) this._add(fair, M.fairing);
  }

  // Build a hinged part: geometry is in aircraft coords; pivot at hinge line at chord fraction xh with vertical offset (fraction of chord).
  _hinged(geo, mat, side, s0, s1, xh, yOff, top = false) {
    const pA = wingPoint(side, s0, xh, top), pB = wingPoint(side, s1, xh, top);
    const cA = TE(s0) - LE(s0), cB = TE(s1) - LE(s1);
    pA.y += yOff * cA; pB.y += yOff * cB;
    const axis = pB.clone().sub(pA).normalize();
    const pivot = new THREE.Group();
    pivot.position.copy(pA);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pA).negate();
    pivot.add(m);
    this.group.add(pivot);
    pivot.userData.axis = axis; pivot.userData.chord = (cA + cB) / 2; pivot.userData.base = pA.clone();
    return pivot;
  }

  _setHinge(pivot, angle, slideAft = 0, slideDown = 0) {
    pivot.quaternion.setFromAxisAngle(pivot.userData.axis, angle);
    pivot.position.copy(pivot.userData.base);
    pivot.position.z += slideAft; pivot.position.y -= slideDown;
  }

  _buildEngine(side) {
    const M = this.mats;
    const cx = side * 5.75, cy = -1.72, z0 = 2.35;
    const eng = new THREE.Group(); eng.position.set(cx, cy, 0); this.group.add(eng);
    // nacelle profile (radius, z)
    const prof = [[0.93, 0], [1.02, 0.06], [1.1, 0.25], [1.13, 0.6], [1.12, 1.2], [1.09, 2.0], [1.04, 2.7], [0.98, 3.3], [0.93, 3.62]];
    const lathe = (pts, segs = 40) => { const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), segs); g.rotateX(Math.PI / 2); return g; };
    const fwd = prof.slice(0, 7);
    const cowl = this._add(lathe(fwd), M.nacelle, eng); cowl.position.z = z0;
    // translating reverser sleeve (rear part)
    const sleeve = new THREE.Group(); eng.add(sleeve);
    this._add(lathe(prof.slice(6)), M.nacelle, sleeve).position.z = z0;
    const cascade = this._add(new THREE.CylinderGeometry(1.03, 1.03, 0.55, 32, 1, true).rotateX(Math.PI / 2), M.dark, eng); cascade.position.z = z0 + 2.95; cascade.visible = false;
    this.parts.reversers.push({ sleeve, cascade, side });
    // inlet lip & inner duct
    const lip = this._add(new THREE.TorusGeometry(0.95, 0.07, 10, 40), M.lip, eng); lip.position.z = z0 + 0.03;
    const duct = this._add(new THREE.CylinderGeometry(0.93, 0.95, 0.5, 40, 1, true).rotateX(Math.PI / 2), M.core, eng); duct.position.z = z0 + 0.25; duct.material = M.core.clone(); duct.material.side = THREE.BackSide;
    // fan & spinner
    const fan = new THREE.Group(); fan.position.z = z0 + 0.5; eng.add(fan);
    const bladeG = new THREE.BoxGeometry(0.1, 0.9, 0.03); bladeG.translate(0, 0.5, 0);
    for (let i = 0; i < 18; i++) { const b = this._add(bladeG, M.fan, fan); b.rotation.z = i / 18 * Math.PI * 2; b.rotation.y = 0.5; }
    const spinner = this._add(new THREE.ConeGeometry(0.28, 0.55, 20).rotateX(-Math.PI / 2), M.lip, fan); spinner.position.z = -0.1;
    this.parts.fans.push({ fan, side, angle: 0 });
    // core cowl, nozzle and plug
    const coreG = lathe([[0.72, 0], [0.7, 0.4], [0.6, 1.0], [0.48, 1.4]], 32); const core = this._add(coreG, M.core, eng); core.position.z = z0 + 3.62;
    const plug = this._add(new THREE.ConeGeometry(0.3, 0.9, 20).rotateX(Math.PI / 2), M.core, eng); plug.position.z = z0 + 5.3;
    const noz = this._add(new THREE.CylinderGeometry(0.93, 0.9, 0.06, 40, 1, true).rotateX(Math.PI / 2), M.dark, eng); noz.position.z = z0 + 3.62; noz.material = M.dark.clone(); noz.material.side = THREE.DoubleSide;
    // pylon
    const pyl = new THREE.Shape();
    pyl.moveTo(0, 0); pyl.lineTo(4.8, 0); pyl.lineTo(5.6, 0.6); pyl.lineTo(3.5, 1.35); pyl.lineTo(0.6, 1.2); pyl.closePath();
    const pg = new THREE.ExtrudeGeometry(pyl, { depth: 0.36, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
    pg.rotateY(-Math.PI / 2); pg.translate(0.18, 0, 0);
    const py = this._add(pg, M.pylon, eng); py.position.set(0, 0.95, z0 + 0.7);
  }

  _buildFuselage() {
    const holes = [];
    const zOf = (z) => z;
    for (const w of windowList()) {
      if (w.side > 0) continue;
      const th = Math.asin((CAB.winY - CAB.yc) / CAB.Rw);
      const vc = (th / DEG + 90) / 180, hv = (CAB.paneH / CAB.Rskin) / DEG / 180 / 2;
      holes.push({ z0: w.z - CAB.paneW / 2, z1: w.z + CAB.paneW / 2, v0: vc - hv, v1: vc + hv });
    }
    // door openings (only visible when a door is open)
    for (const d of Object.values(DOORS)) {
      if (d.side > 0) continue;
      const a0 = Math.asin((0.0 - CAB.yc) / CAB.Rskin) / DEG, a1 = Math.asin((DOOR_H + 0.02 - CAB.yc) / CAB.Rskin) / DEG;
      holes.push({ z0: d.z - DOOR_W / 2 + 0.02, z1: d.z + DOOR_W / 2 - 0.02, v0: (a0 + 90) / 180, v1: (a1 + 90) / 180 });
    }
    const tex = skinTexture(holes);
    // radius profile along z (nose & tail cones)
    const R = (z) => {
      if (z < -3.2) { const t = clamp((z + 7.3) / 4.1, 0, 1); return 1.99 * Math.sqrt(1 - (1 - t) ** 2.2); }
      if (z > 26.5) { const t = clamp((z - 26.5) / 5.0, 0, 1); return 1.99 * (1 - 0.72 * t * t); }
      return 1.99;
    };
    const Yc = (z) => CAB.yc + (z > 26.5 ? ((z - 26.5) / 5.0) ** 2 * 1.1 : 0) - (z < -3.2 ? ((-3.2 - z) / 4.1) ** 2 * 0.35 : 0);
    for (const side of [-1, 1]) {
      const pos = [], uv = [], idx = [];
      const nz = 80, na = 24;
      for (let j = 0; j <= nz; j++) {
        const z = lerp(tex.zA + 0.2, tex.zB - 0.6, j / nz);
        const r = R(z), yc = Yc(z);
        for (let i = 0; i <= na; i++) {
          const a = -Math.PI / 2 + Math.PI * i / na;
          pos.push(side * r * Math.cos(a), yc + r * Math.sin(a), z);
          uv.push((z - tex.zA) / (tex.zB - tex.zA), i / na);
        }
      }
      for (let j = 0; j < nz; j++) for (let i = 0; i < na; i++) {
        const a = j * (na + 1) + i, b = a + 1, c = a + na + 1, d = c + 1;
        if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex.color, alphaMap: tex.alpha, alphaTest: 0.5, roughness: 0.38, metalness: 0.3 });
      this._add(g, mat);
    }
  }

  _buildLights() {
    const glow = glowTex();
    const mkSprite = (color, size) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.scale.setScalar(size); this.group.add(s); return s; };
    this.lights = {};
    this.lights.navL = mkSprite('#ff2a1a', 0.9); this.lights.navL.position.copy(this.tipL).add(new THREE.Vector3(0.05, -0.05, -0.4));
    this.lights.navR = mkSprite('#22ff66', 0.9); this.lights.navR.position.copy(this.tipR).add(new THREE.Vector3(-0.05, -0.05, -0.4));
    this.lights.strobeL = mkSprite('#ffffff', 3.2); this.lights.strobeL.position.copy(this.tipL).add(new THREE.Vector3(0, 0, 0.6));
    this.lights.strobeR = mkSprite('#ffffff', 3.2); this.lights.strobeR.position.copy(this.tipR).add(new THREE.Vector3(0, 0, 0.6));
    this.lights.beaconB = mkSprite('#ff2020', 1.6); this.lights.beaconB.position.set(0, -1.0, 11.5);
    this.lights.scan = mkSprite('#fff4e0', 0.7); this.lights.scan.position.set(-1.95, 0.9, 3.8);
    this.navLightL = new THREE.PointLight('#ff3020', 0, 5, 2); this.navLightL.position.copy(this.lights.navL.position); this.group.add(this.navLightL);
    this.navLightR = new THREE.PointLight('#30ff60', 0, 5, 2); this.navLightR.position.copy(this.lights.navR.position); this.group.add(this.navLightR);
    this.strobeLight = new THREE.PointLight('#ffffff', 0, 14, 1.5); this.group.add(this.strobeLight);
    this.beaconLight = new THREE.PointLight('#ff1a10', 0, 9, 1.5); this.beaconLight.position.set(0, -1.1, 11.5); this.group.add(this.beaconLight);
    // wing scan light illuminating the leading edge and engine
    this.scanLight = new THREE.SpotLight('#fff1dc', 0, 22, 0.45, 0.5, 1.2);
    this.scanLight.position.set(-2.0, 0.9, 3.6); this.scanLight.target.position.set(-8, -0.5, 9); this.group.add(this.scanLight, this.scanLight.target);
    this.scanLightR = this.scanLight.clone(); this.scanLightR.position.x = 2.0; this.scanLightR.target = new THREE.Object3D(); this.scanLightR.target.position.set(8, -0.5, 9); this.group.add(this.scanLightR, this.scanLightR.target);
    // lighting for the exterior scene (set per frame from world)
    this.sun = new THREE.DirectionalLight('#ffffff', 3); this.sun.position.set(0, 50, 0); this.group.add(this.sun); this.group.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight('#bcd4ff', '#556070', 0.8); this.group.add(this.hemi);
    this.amb = new THREE.AmbientLight('#ffffff', 0.05); this.group.add(this.amb);
  }

  update(dt, t, fm, env) {
    const P = this.parts;
    // flaps: Fowler motion (aft + down + rotation)
    const fk = fm.flap / 35, sk = fm.slat / 27;
    // flaps: trailing edge down + Fowler travel aft/down
    for (const f of P.flaps) this._setHinge(f.pivot, f.side * fm.flap * DEG * 0.9, 0.22 * fk, 0.04 * fk);
    // slats: leading edge droops and extends forward
    for (const sl of P.slats) this._setHinge(sl.pivot, -sl.side * fm.slat * 0.85 * DEG, -0.3 * sk, 0.1 * sk);
    // spoilers / speedbrakes: panels rise up to ~48 degrees
    for (const sp of P.spoilers) this._setHinge(sp.pivot, -sp.side * fm.spoiler * 48 * DEG, 0, 0);
    // ailerons follow roll rate (+ small turbulence corrections)
    const bankRate = dt > 0 ? (fm.bank + (fm.turbBank || 0) - (this._pb ?? fm.bank)) / dt : 0;
    this._pb = fm.bank + (fm.turbBank || 0);
    this._ail = (this._ail || 0) + (clamp(bankRate * 4, -1, 1) - (this._ail || 0)) * Math.min(1, dt * 4);
    for (const ai of P.ailerons) this._setHinge(ai.pivot, -this._ail * 12 * DEG, 0, 0);
    for (const r of P.reversers) { r.sleeve.position.z = fm.reverse * 0.55; r.cascade.visible = fm.reverse > 0.05; }
    for (const f of P.fans) { const n1 = fm.n1[f.side < 0 ? 0 : 1]; f.angle += n1 * 64 * 2 * Math.PI * dt * 0.25; f.fan.rotation.z = f.angle; }
    // wing flex: up in flight with load, down on the ground; turbulence adds bounce
    const flexTarget = fm.onGround ? -0.12 : 0.35 + fm.bump * 0.35 + (fm.accel ? fm.accel.y * 0.03 : 0);
    this.flexU.value += (flexTarget - this.flexU.value) * Math.min(1, dt * 3);
    // lights
    const L = this.lights, nightK = env.nightK;
    const navOn = true;
    L.navL.visible = L.navR.visible = navOn;
    L.navL.material.opacity = L.navR.material.opacity = 0.35 + 0.65 * nightK;
    this.navLightL.intensity = this.navLightR.intensity = 0.8 * nightK;
    const strobeOn = env.strobes;
    const ph = t % 1.2;
    const flash = strobeOn && (ph < 0.05 || (ph > 0.13 && ph < 0.18));
    L.strobeL.visible = L.strobeR.visible = flash;
    L.strobeL.material.opacity = L.strobeR.material.opacity = 0.6 + 0.4 * nightK;
    this.strobeLight.intensity = flash ? 30 * (0.2 + nightK) : 0;
    this.strobeLight.position.copy(ph < 0.09 ? L.strobeL.position : L.strobeR.position);
    const bph = (t + 0.4) % 1.1;
    const bOn = env.beacon && bph < 0.12;
    L.beaconB.visible = bOn; this.beaconLight.intensity = bOn ? 8 * (0.15 + nightK) : 0;
    const scanOn = env.scan && nightK > 0.3;
    this.scanLight.intensity = this.scanLightR.intensity = scanOn ? 60 : 0;
    L.scan.visible = scanOn;
  }
}
