// A320neo exterior as seen from the cabin windows: wings with moving slats, flaps,
// spoilers and ailerons, sharklets, CFM LEAP-1A nacelles with thrust reversers,
// fuselage skin (SAS livery) and exterior lights. Aircraft-local frame as cabin.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, glowTex, rr } from './textures.js';
import { windowList, CAB, DOORS, DOOR_W, DOOR_H } from './cabin.js';
import { DEG, clamp, lerp, exposeMaterial, sharedUniforms } from './core.js';

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

// Plan-view silhouette of the airframe, blurred, for the contact shadow on the tarmac.
// Canvas covers x -19..19 m, z -9..32 m (top = nose).
const SH_X = 19, SH_Z0 = -9, SH_Z1 = 32;
function shadowTexture() {
  return canvasTex(256, 280, (g, w, h) => {
    const X = (x) => (x + SH_X) / (2 * SH_X) * w, Z = (z) => (z - SH_Z0) / (SH_Z1 - SH_Z0) * h;
    const c = document.createElement('canvas'); c.width = w; c.height = h; const k = c.getContext('2d');
    k.fillStyle = '#fff';
    // fuselage: radome, constant section, tail cone
    k.beginPath();
    for (let z = -7.4; z <= 30.4; z += 0.4) { const r = z < -3.2 ? 1.99 * Math.pow(Math.min(1, (z + 7.4) / 4.2), 0.5) : z > 24 ? 1.99 * (1 - 0.8 * ((z - 24) / 6.4) ** 2) : 1.99; k.lineTo(X(r), Z(z)); }
    for (let z = 30.4; z >= -7.4; z -= 0.4) { const r = z < -3.2 ? 1.99 * Math.pow(Math.min(1, (z + 7.4) / 4.2), 0.5) : z > 24 ? 1.99 * (1 - 0.8 * ((z - 24) / 6.4) ** 2) : 1.99; k.lineTo(X(-r), Z(z)); }
    k.fill();
    for (const side of [-1, 1]) {
      // wing from the real planform
      k.beginPath(); k.moveTo(X(0), Z(LE(S_ROOT)));
      for (let s = S_ROOT; s <= S_TIP + 0.01; s += 0.5) k.lineTo(X(side * s), Z(LE(s)));
      for (let s = S_TIP; s >= S_ROOT - 0.01; s -= 0.5) k.lineTo(X(side * s), Z(TE(s)));
      k.lineTo(X(0), Z(TE(S_ROOT))); k.fill();
      // engine nacelle and pylon
      k.fillRect(X(side * 5.75 - 1.1), Z(2.35), X(2.2) - X(0), Z(6.4) - Z(2.35) + 1);
      // horizontal stabiliser
      k.beginPath(); k.moveTo(X(side * 0.9), Z(26.1)); k.lineTo(X(side * 6.2), Z(28.8)); k.lineTo(X(side * 6.2), Z(30.1)); k.lineTo(X(side * 0.9), Z(29.4)); k.fill();
    }
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.filter = 'blur(3px)'; g.drawImage(c, 0, 0);
    g.filter = 'blur(9px)'; g.globalAlpha = 0.55; g.drawImage(c, 0, 0);
  }, { srgb: false });
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

function skinTexture(holes, side) {
  // u along z (-7.5..31.5), v around the side (-90° bottom .. +90° top).
  // 2019 SAS livery: fresh grey fuselage, blue belly extending from the tail, tone-on-tone
  // silver-grey "SAS" up front, "Scandinavian" on the underside, SkyTeam logo by door L1.
  const zA = -7.5, zB = 31.5;
  const X = (z) => (z - zA) / (zB - zA);
  const color = canvasTex(4096, 1024, (g, w, h) => {
    const vOf = (deg) => (deg + 90) / 180;
    const Y = (deg) => h - vOf(deg) * h;
    const U = (z) => X(z) * w;
    g.fillStyle = '#cdd0d5'; g.fillRect(0, 0, w, h);
    // belly: blue sweeps up towards the tail (the tail is all blue)
    g.fillStyle = '#1d3a86'; g.beginPath();
    g.moveTo(0, Y(-40)); g.lineTo(U(18), Y(-40)); g.quadraticCurveTo(U(24), Y(-30), U(26), Y(10)); g.lineTo(U(31.5), Y(90)); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill();
    // subtle panel lines & rivet rows
    g.strokeStyle = 'rgba(60,65,75,0.22)'; g.lineWidth = 1.2;
    for (let z = zA + 0.5334 * 2; z < zB; z += 0.5334 * 3) { g.beginPath(); g.moveTo(U(z), 0); g.lineTo(U(z), h); g.stroke(); }
    for (let a2 = -80; a2 < 90; a2 += 14) { g.beginPath(); g.moveTo(0, Y(a2)); g.lineTo(w, Y(a2)); g.stroke(); }
    // text helpers: on the right side the texture is viewed mirrored, so flip glyphs
    const text = (str, z, deg, px, fill, opts = {}) => {
      g.save(); g.translate(U(z), Y(deg)); if (side > 0) g.scale(-1, 1); if (opts.rot) g.rotate(opts.rot);
      g.fillStyle = fill; g.font = `${opts.weight || 'bold'} ${px}px ${opts.font || 'Arial, Helvetica, sans-serif'}`; g.textAlign = opts.align || 'center'; g.textBaseline = 'middle';
      g.fillText(str, 0, 0); g.restore();
    };
    text('SAS', -1.6, 32, 150, '#b9bcc2', { weight: '900' });                 // big tone-on-tone titles up front
    text('SE-ROX', 27.3, 4, 30, '#2b3140');                                    // registration
    text('Scandinavian', 9, -78, 92, '#dfe4ee', { weight: '600' });              // belly titles
    text('roar viking', 2.0, 22, 18, '#5b6270', { weight: 'normal', font: 'Georgia, serif' });
    // SkyTeam logo (stylised ribbon) beside door L1 and a Swedish flag
    g.save(); g.translate(U(-3.55), Y(26)); if (side > 0) g.scale(-1, 1);
    g.fillStyle = '#1d3a86'; g.beginPath(); g.ellipse(0, 0, 22, 22, 0, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, 13, 0.3, 4.6); g.stroke(); g.beginPath(); g.arc(4, -3, 8, 2.8, 6.4); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 13px Arial'; g.textAlign = 'left'; g.fillText('SkyTeam', 28, 5); g.restore();
    g.save(); g.translate(U(-4.4), Y(38)); if (side > 0) g.scale(-1, 1);
    g.fillStyle = '#0a5aa8'; g.fillRect(-16, -10, 32, 20); g.fillStyle = '#fecb00'; g.fillRect(-16, -2, 32, 4); g.fillRect(-6, -10, 4, 20); g.restore();
    // door outlines (L1/L4 or R1/R4), cargo doors on the right, over-wing hatches
    const doorOutline = (z, deg0, deg1, wz) => { g.strokeStyle = 'rgba(40,45,55,0.55)'; g.lineWidth = 2.2; rr(g, U(z - wz / 2), Y(deg1), U(z + wz / 2) - U(z - wz / 2), Y(deg0) - Y(deg1), 10); g.stroke(); };
    doorOutline(-2.3, -28, 26, 0.86); doorOutline(24.2, -28, 26, 0.86);
    doorOutline(10.1, -19, 12, 0.52); doorOutline(11.0, -19, 12, 0.52);
    if (side > 0) { doorOutline(-0.4, -75, -40, 1.8); doorOutline(20.0, -75, -40, 1.8); doorOutline(28.0, -70, -48, 0.9); }
    // static discharge/dirt streaks aft of the windows, grime along the belly
    g.fillStyle = 'rgba(60,60,70,0.07)'; for (let z = 0; z < 26; z += 1.6) g.fillRect(U(z), Y(6), 60, 16);
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, Y(-60), w, Y(-88) - Y(-60));
  });
  const alpha = canvasTex(4096, 512, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#000';
    for (const o of holes) { rr(g, X(o.z0) * w, h - o.v1 * h, (X(o.z1) - X(o.z0)) * w, (o.v1 - o.v0) * h, 5); g.fill(); }
  }, { srgb: false });
  return { color, alpha, zA, zB };
}

function finTexture() {
  return canvasTex(1024, 1024, (g, w, h) => {
    // u = chord (0 leading edge), v = span (0 root)
    g.fillStyle = '#1d3a86'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2;
    for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(0, h * i / 8); g.lineTo(w, h * i / 8); g.stroke(); }
    g.fillStyle = '#ffffff'; g.font = '900 250px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(w * 0.5, h * 0.42); g.rotate(-0.06); g.fillText('SAS', 0, 0); g.restore();
    // rudder hinge line
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3; g.beginPath(); g.moveTo(w * 0.68, 0); g.lineTo(w * 0.68, h); g.stroke();
  });
}

// What the logo lights on top of the tailplane paint onto the fin: brightest just above the
// stabiliser, fading towards the tip and the leading/trailing edges.
function finGlowTexture(src) {
  return canvasTex(512, 512, (g, w, h) => {
    g.drawImage(src.image, 0, 0, w, h);
    g.globalCompositeOperation = 'multiply';
    const gy = g.createLinearGradient(0, h, 0, 0); // canvas bottom = fin root
    gy.addColorStop(0, '#ffffff'); gy.addColorStop(0.5, '#a8a8a8'); gy.addColorStop(1, '#141414');
    g.fillStyle = gy; g.fillRect(0, 0, w, h);
    const gx = g.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, '#5a5a5a'); gx.addColorStop(0.45, '#ffffff'); gx.addColorStop(1, '#6a6a6a');
    g.fillStyle = gx; g.fillRect(0, 0, w, h);
  });
}

// Symmetric aerofoil surface: pts along a spanwise axis with chord/lead per station.
function foilSurface(stations, mirrorUV = false) {
  // stations: [{p: Vector3 leading edge, chordDir: Vector3 (unit), chord, thick, thickDir: Vector3}]
  const nx = 12, pos = [], uv = [], idx = [];
  for (let j = 0; j < stations.length; j++) {
    const st = stations[j];
    for (let k = 0; k < 2; k++) for (let i = 0; i <= nx; i++) {
      const x = i / nx;
      const yt = st.thick * (1.4845 * Math.sqrt(x) - 0.63 * x - 1.758 * x * x + 1.4215 * x ** 3 - 0.5075 * x ** 4) * st.chord;
      const sgn = k ? -1 : 1;
      const P = st.p.clone().addScaledVector(st.chordDir, x * st.chord).addScaledVector(st.thickDir, sgn * yt);
      pos.push(P.x, P.y, P.z); uv.push(mirrorUV && k ? 1 - x : x, j / (stations.length - 1));
    }
  }
  const row = (nx + 1) * 2;
  for (let j = 0; j < stations.length - 1; j++) for (let k = 0; k < 2; k++) for (let i = 0; i < nx; i++) {
    const a = j * row + k * (nx + 1) + i, b = a + 1, c = a + row, d = c + 1;
    if (k === 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
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
      return exposeMaterial(m);
    };
    const ex = (m) => exposeMaterial(m);
    this.mats = {
      wing: mk({ color: '#ffffff', map: wingTex, roughness: 0.42, metalness: 0.35 }),
      wingLower: mk({ color: '#b8bcc3', roughness: 0.55, metalness: 0.3 }),
      metal: mk({ color: '#d7dbe1', roughness: 0.28, metalness: 0.8 }),
      flap: mk({ color: '#c3c7cd', roughness: 0.45, metalness: 0.35 }),
      dark: mk({ color: '#2d3139', roughness: 0.6, metalness: 0.3 }),
      nacelle: ex(new THREE.MeshStandardMaterial({ color: '#ffffff', map: nacelleTexture(), roughness: 0.35, metalness: 0.45 })),
      lip: ex(new THREE.MeshStandardMaterial({ color: '#e8ebef', roughness: 0.15, metalness: 0.95 })),
      core: ex(new THREE.MeshStandardMaterial({ color: '#5a5f68', roughness: 0.5, metalness: 0.6 })),
      fan: ex(new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.4, metalness: 0.7 })),
      sharklet: mk({ color: '#ffffff', map: sharkletTexture(), roughness: 0.35, metalness: 0.25 }),
      pylon: ex(new THREE.MeshStandardMaterial({ color: '#c5c9cf', roughness: 0.45, metalness: 0.35 })),
      fairing: ex(new THREE.MeshStandardMaterial({ color: '#c8ccd2', roughness: 0.5, metalness: 0.25 })),
    };
    for (const side of [-1, 1]) this._buildWing(side);
    for (const side of [-1, 1]) this._buildEngine(side);
    this._buildFuselage();
    this._buildVortices();
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
    // two single-sided skins so the "SAS" on the sharklet reads correctly from inboard and outboard
    const pa = new THREE.Vector3().fromArray(pos, idx[0] * 3), pb = new THREE.Vector3().fromArray(pos, idx[1] * 3), pc = new THREE.Vector3().fromArray(pos, idx[2] * 3);
    const frontOutboard = Math.sign(pb.sub(pa).cross(pc.sub(pa)).x) === side;
    const sgFlip = sg.clone(); const fu = sgFlip.attributes.uv; for (let i = 0; i < fu.count; i++) fu.setX(i, 1 - fu.getX(i));
    for (const [geo, face] of [[frontOutboard ? sgFlip : sg, THREE.FrontSide], [frontOutboard ? sg : sgFlip, THREE.BackSide]]) {
      const shark = this._add(geo, M.sharklet); shark.material = M.sharklet.clone(); shark.material.side = face;
      shark.material.onBeforeCompile = M.sharklet.onBeforeCompile;
    }
    this[side < 0 ? 'tipL' : 'tipR'] = new THREE.Vector3(side * S_TIP, tip.y + 0.1, LE(S_TIP) + 0.6);
    // wing-body fairing
    const fair = new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55);
    fair.scale(2.3, 1.05, 6.3); fair.translate(0, -0.2, 9.8); // shallow wing-to-body fairing housing the main gear bays
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
    this.doorPlugs = {};
    const holes = [];
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
    // radius profile along z: radome, constant section, tail cone rising to the APU
    const R = (z) => {
      if (z < -3.2) { const t = clamp((z + 7.4) / 4.2, 0, 1); return 1.99 * Math.pow(1 - Math.pow(1 - t, 2.4), 0.55); }
      if (z > 24.0) { const t = clamp((z - 24.0) / 6.2, 0, 1); return 1.99 * (1 - 0.86 * t * t) + 0.06 * t; }
      return 1.99;
    };
    const Yc = (z) => CAB.yc + (z > 24.0 ? Math.pow((z - 24.0) / 6.2, 1.8) * 1.45 : 0) - (z < -3.2 ? ((-3.2 - z) / 4.2) ** 2 * 0.42 : 0);
    for (const side of [-1, 1]) {
      const tex = skinTexture(holes, side);
      const pos = [], uv = [], idx = [];
      const nz = 120, na = 28;
      for (let j = 0; j <= nz; j++) {
        const z = lerp(tex.zA + 0.12, tex.zB - 1.3, j / nz);
        const r = R(z), yc = Yc(z);
        for (let i = 0; i <= na; i++) {
          const a = -Math.PI / 2 + Math.PI * i / na;
          pos.push(side * r * Math.cos(a), yc + r * Math.sin(a), z);
          uv.push((z - tex.zA) / (tex.zB - tex.zA), i / na);
        }
      }
      for (let j = 0; j < nz; j++) for (let i = 0; i < na; i++) {
        const a = j * (na + 1) + i, b = a + 1, c = a + na + 1, d = c + 1;
        if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d); // outward-facing on both sides
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      const mat = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex.color, alphaMap: tex.alpha, alphaTest: 0.5, roughness: 0.36, metalness: 0.32 }));
      this._add(g, mat);
      // closed doors: skin plugs over the door cut-outs (the painted outline shows the seams)
      const plugMat = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex.color, roughness: 0.36, metalness: 0.32 }));
      for (const d of Object.values(DOORS)) {
        if (d.side !== side) continue;
        const a0 = Math.asin((0.0 - CAB.yc) / CAB.Rskin) - 0.01, a1 = Math.asin((DOOR_H + 0.02 - CAB.yc) / CAB.Rskin) + 0.01;
        const pp = [], pu = [], pi = [], nzp = 4, nap = 8, rP = CAB.Rskin + 0.004;
        for (let j = 0; j <= nzp; j++) for (let i = 0; i <= nap; i++) {
          const z = d.z - DOOR_W / 2 - 0.01 + (DOOR_W + 0.02) * j / nzp, a = a0 + (a1 - a0) * i / nap;
          pp.push(side * rP * Math.cos(a), CAB.yc + rP * Math.sin(a), z); pu.push((z - tex.zA) / (tex.zB - tex.zA), (a / DEG + 90) / 180);
        }
        for (let j = 0; j < nzp; j++) for (let i = 0; i < nap; i++) {
          const a = j * (nap + 1) + i, b = a + 1, c = a + nap + 1, e = c + 1;
          if (side > 0) pi.push(a, b, c, b, e, c); else pi.push(a, c, b, b, c, e);
        }
        const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3)); pg.setAttribute('uv', new THREE.Float32BufferAttribute(pu, 2)); pg.setIndex(pi); pg.computeVertexNormals();
        const plug = this._add(pg, plugMat);
        this.doorPlugs[(side < 0 ? 'L' : 'R') + (d.z < 10 ? '1' : '4')] = plug;
      }
    }
    // what you see through the windows from outside: tinted acrylic over a dim cabin that glows
    // warm after dark (outward-facing, so it is culled from inside the cabin)
    this.cabinGlow = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#1b2129', roughness: 0.15, metalness: 0.4, emissive: '#ffdcaa', emissiveIntensity: 0 }));
    const inner = new THREE.CylinderGeometry(CAB.Rskin - 0.035, CAB.Rskin - 0.035, 28.6, 40, 1, true).rotateX(Math.PI / 2);
    this._add(inner, this.cabinGlow).position.set(0, CAB.yc, 10.7);
    const M = this.mats;
    // cockpit glazing: a dark band with six panes
    const glass = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#0e141c', roughness: 0.08, metalness: 0.6 }));
    for (const side of [-1, 1]) {
      for (const [z0, z1, a0, a1] of [[-5.55, -4.75, 12, 30], [-4.7, -4.05, 12, 30], [-4.0, -3.4, 12, 28]]) {
        const pos = [], idx = [];
        const N = 6;
        for (let j = 0; j <= 1; j++) for (let i = 0; i <= N; i++) {
          const z = lerp(z0, z1, i / N), a = lerp(a0, a1, j) * DEG; const r = R(z) + 0.012, yc = Yc(z);
          pos.push(side * r * Math.cos(a), yc + r * Math.sin(a), z);
        }
        for (let i = 0; i < N; i++) { const a = i, b = a + 1, c = a + N + 1, d = c + 1; if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        this._add(g, glass);
      }
    }
    // radome tip (slightly different grey) and the nose gear bay
    const radome = this._add(new THREE.SphereGeometry(0.62, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), M.fairing);
    radome.rotation.x = -Math.PI / 2; radome.scale.set(1, 1, 2.1); radome.position.set(0, Yc(-7.3), -6.9);
    // vertical fin: 5.9 m root chord, ~6.3 m high, swept 35°
    this.finTex = finTexture();
    const finMat = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#ffffff', map: this.finTex, roughness: 0.4, metalness: 0.25, emissive: '#fff3de', emissiveMap: finGlowTexture(this.finTex), emissiveIntensity: 0 }));
    this.finMat = finMat;
    const finSt = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, y = 2.6 + 6.4 * t, z = 22.4 + 4.6 * t * 1.05, chord = lerp(6.1, 2.2, t), thick = lerp(0.1, 0.08, t);
      finSt.push({ p: new THREE.Vector3(0, y, z), chordDir: new THREE.Vector3(0, 0.09, 1).normalize(), chord, thick, thickDir: new THREE.Vector3(1, 0, 0) });
    }
    this._add(foilSurface(finSt, true), finMat);
    const finRoot = this._add(new THREE.BoxGeometry(0.6, 0.5, 7.0), M.fairing); finRoot.position.set(0, 2.55, 25.4);
    // horizontal stabilisers, 12.45 m span, 6° dihedral
    for (const side of [-1, 1]) {
      const st = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6, x = side * (0.9 + 5.3 * t), y = 2.05 + 0.6 * t, z = 26.1 + 2.7 * t, chord = lerp(3.3, 1.3, t);
        st.push({ p: new THREE.Vector3(x, y, z), chordDir: new THREE.Vector3(0, 0, 1), chord, thick: 0.1, thickDir: new THREE.Vector3(0, 1, 0) });
      }
      this._add(foilSurface(st), M.wingLower);
    }
    // APU exhaust
    const apu = this._add(new THREE.CylinderGeometry(0.16, 0.22, 0.7, 12).rotateX(Math.PI / 2), M.dark); apu.position.set(0, Yc(30.2) + 0.1, 30.4);
    this._buildGear();
    // soft ground shadow under the aircraft (only shown on the ground)
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2 * SH_X, SH_Z1 - SH_Z0), new THREE.MeshBasicMaterial({ alphaMap: shadowTexture(), color: '#000000', transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.set(0, -3.36, (SH_Z0 + SH_Z1) / 2); this.shadow.renderOrder = -1; this.group.add(this.shadow);
  }

  // Condensation streams shed from the flap edges and engine pylons on humid days with flaps out.
  _buildVortices() {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    this.vortices = [];
    for (const side of [-1, 1]) for (const s0 of [S_KINK, 13.3, 6.3]) {
      const p = wingPoint(side, s0, 0.9, true);
      const g = new THREE.CylinderGeometry(0.09, 0.28, 9, 8, 1, true); g.rotateX(Math.PI / 2); g.translate(0, 0, 4.5);
      const m = new THREE.Mesh(g, mat.clone()); m.position.set(p.x, p.y + 0.05, p.z + 0.2); this.group.add(m); this.vortices.push(m);
    }
  }

  // Retractable undercarriage: twin-wheel nose leg, two twin-wheel main legs with doors.
  _buildGear() {
    const M = this.mats;
    const tyre = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#17181a', roughness: 0.9 }));
    const hub = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.4, metalness: 0.6 }));
    const strut = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#d6d9de', roughness: 0.35, metalness: 0.7 }));
    const wheel = (r, w) => { const g = new THREE.Group(); const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 20).rotateZ(Math.PI / 2), tyre); const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 14).rotateZ(Math.PI / 2), hub); g.add(t, h); return g; };
    this.gear = { main: [], nose: null, doors: [] };
    // main gear (track 7.59 m): pivot at the top of each leg under the wing; the leg folds inboard
    // so the twin wheels lie flat in the belly bay. Tyres 46x17R20 (r 0.58), contact at G_LOCAL.y = -3.4.
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(side * 3.8, -0.55, 11.5); this.group.add(pivot); // rear-spar trunnion
      const legLen = 2.27; // axle 0.58 m above the ground
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, legLen, 10), strut); leg.position.set(0, -legLen / 2, 0); pivot.add(leg);
      const sideStay = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.53, 8), strut); sideStay.position.set(-side * 0.65, -0.62, 0.1); sideStay.rotation.z = side * 0.9; pivot.add(sideStay);
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8).rotateZ(Math.PI / 2), strut); axle.position.set(0, -legLen, 0); pivot.add(axle);
      for (const w of [-0.42, 0.42]) { const wh = wheel(0.58, 0.36); wh.position.set(w, -legLen, 0); pivot.add(wh); }
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.5, 1.0), M.wingLower); door.position.set(side * 0.16, -1.0, 0); pivot.add(door);
      this.gear.main.push({ pivot, side });
    }
    // nose gear: retracts forward into the bay under the flight deck
    const np = new THREE.Group(); np.position.set(0, -0.6, -2.3); this.group.add(np);
    const nl = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.45, 10), strut); nl.position.set(0, -1.22, 0); np.add(nl);
    const drag = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 8), strut); drag.position.set(0, -1.0, 0.55); drag.rotation.x = 0.7; np.add(drag); this.gear.drag = drag;
    for (const w of [-0.24, 0.24]) { const wh = wheel(0.36, 0.2); wh.position.set(w, -2.45, 0); np.add(wh); }
    // forward bay doors hinge at the bay edges: open while the gear is down, flush with the belly when up
    for (const sd of [-1, 1]) {
      const hinge = new THREE.Group(); hinge.position.set(sd * 0.36, -0.93, -3.0); this.group.add(hinge);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.36, 1.5), M.wingLower); door.position.y = -0.18; hinge.add(door);
      this.gear.doors.push({ hinge, sd });
    }
    this.gear.nose = np;
    // taxi light on the nose leg
    this.taxiLight = new THREE.SpotLight('#fff3dc', 0, 90, 0.35, 0.5, 1.1); this.taxiLight.position.set(0, -1.6, -2.4); this.taxiLight.target.position.set(0, -3.3, -40); this.group.add(this.taxiLight, this.taxiLight.target);
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
    // vortex condensation: humid air (rain / low cloud), flaps out, enough speed
    const vk = (env.humidity || 0) * clamp(fm.flap / 20, 0, 1) * (fm.ias > 120 && !fm.onGround ? 1 : 0);
    for (const v of this.vortices) { v.material.opacity += ((0.22 + 0.1 * Math.sin(t * 9 + v.position.x)) * vk - v.material.opacity) * Math.min(1, dt * 3); v.visible = v.material.opacity > 0.01; }
    // undercarriage: main legs fold inboard, the nose leg forward
    const gk = clamp(fm.gear, 0, 1);
    for (const g of this.gear.main) g.pivot.rotation.z = -g.side * (1 - gk) * 1.57; // inboard
    this.gear.nose.rotation.x = (1 - gk) * 1.62; // forward
    this.gear.drag.visible = gk > 0.35; // the drag brace folds into the bay
    if (this.doorPlugs.L1) this.doorPlugs.L1.visible = (env.doorL1 ?? 0) < 0.02;
    for (const d of this.gear.doors) d.hinge.rotation.z = lerp(-d.sd * Math.PI / 2, d.sd * 0.15, clamp(gk * 1.4, 0, 1));
    // contact shadow: slides away from the sun and sharpens in direct sunlight, a soft blot under overcast
    this.shadow.visible = fm.onGround || fm.h < 60;
    const sl = env.sunLocal, direct = sl && sl.y > 0.08 ? clamp(env.direct ?? 1, 0, 1) : 0;
    const hgt = 3.1 + Math.max(0, fm.h);
    this.shadow.position.x = direct ? clamp(-sl.x / sl.y * hgt, -14, 14) * direct : 0;
    this.shadow.position.z = (SH_Z0 + SH_Z1) / 2 + (direct ? clamp(-sl.z / sl.y * hgt, -14, 14) * direct : 0);
    this.shadow.material.opacity = (0.34 + 0.26 * direct) * clamp(1 - fm.h / 60, 0, 1) * (0.4 + 0.6 * (1 - env.nightK));
    this.taxiLight.intensity = env.landing && fm.onGround ? 40 : 0;
    for (const f of P.fans) { const n1 = fm.n1[f.side < 0 ? 0 : 1]; f.angle += n1 * 64 * 2 * Math.PI * dt * 0.25; f.fan.rotation.z = f.angle; }
    // wing flex: up in flight with load, down on the ground; turbulence adds bounce
    const flexTarget = fm.onGround ? -0.12 : 0.35 + fm.bump * 0.35 + (fm.accel ? fm.accel.y * 0.03 : 0);
    this.flexU.value += (flexTarget - this.flexU.value) * Math.min(1, dt * 3);
    // lights
    const L = this.lights, nightK = env.nightK, pe = sharedUniforms.uPreExp.value;
    for (const [k, c] of [['navL', '#ff2a1a'], ['navR', '#22ff66'], ['strobeL', '#ffffff'], ['strobeR', '#ffffff'], ['beaconB', '#ff2020'], ['scan', '#fff4e0']]) L[k].material.color.set(c).multiplyScalar(pe * 1.6);
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
    // NAV & LOGO: logo lights only work with the main gear compressed or the slats out
    this.cabinGlow.emissiveIntensity = 0.55 * (env.cabinLight ?? 1) * clamp(nightK * 1.3, 0, 1);
    const logoOn = !env.logoOff && (fm.onGround || fm.slat > 1);
    this.finMat.emissiveIntensity += ((logoOn ? 0.45 * clamp(nightK * 1.4, 0, 1) : 0) - this.finMat.emissiveIntensity) * Math.min(1, dt * 8);
    const scanOn = env.scan && nightK > 0.3;
    this.scanLight.intensity = this.scanLightR.intensity = scanOn ? 60 : 0;
    L.scan.visible = scanOn;
  }
}
