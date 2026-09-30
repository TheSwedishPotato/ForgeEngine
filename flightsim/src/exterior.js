// A320neo exterior: fuselage lofted from measured stations, the wing with its real planform
// (kinked trailing edge, 27 degree leading-edge sweep) and moving slats, flaps, spoilers and
// ailerons, sharklets, CFM LEAP-1A nacelles with translating reverser sleeves, the trimmable
// tailplane with elevators, the fin and rudder, the landing gear, cockpit glazing, the 2019 SAS
// livery and the exterior lights. Geometry from airframe.js; aircraft-local frame as cabin.js.
import * as THREE from 'three';
import { canvasTex, glowTex, rr } from './textures.js';
import { windowList, CAB, DOORS, DOOR_W, DOOR_H, HATCH_Z } from './cabin.js';
import { DEG, clamp, lerp, exposeMaterial, sharedUniforms } from './core.js';
import {
  NOSE_Z, TAIL_Z, fusSection, fusPoint, fusHalfWidthAt, WING, wingLE, wingTE, wingChord, wingYqc, wingInc, wingTC,
  SLATS, FLAPS, SPOILERS, AILERON, CANOES, flapChord, SHARKLET, HTP, htpLE, htpTE, htpY, HTP_PIVOT, FIN, RUDDER_XC,
  ENGINE, NACELLE, REVERSER_Z, CORE, PLUG, PYLON, NOSE_GEAR, MAIN_GEAR, COCKPIT_PANES, paneOutline,
} from './airframe.js';

const FUS_L = TAIL_Z - NOSE_Z;
const S0 = 1.70;                          // the wing mesh starts inside the fuselage
const S_TIP = WING.tip;

// ---------------- wing section ----------------
function airfoil(x, t) { // [upper, lower] offsets in chords; aft-loaded, flat-topped section
  const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const m = 0.02, p = 0.55;
  const yc = x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x);
  return [yc + yt * 0.95, yc - yt * 1.02];
}
function wingPoint(side, s, x, upper, out = new THREE.Vector3()) {
  const le = wingLE(s), c = wingChord(s);
  const [yu, yl] = airfoil(clamp(x, 0, 1), wingTC(s));
  const yy = (upper ? yu : yl) * c;
  const inc = wingInc(s);
  const dz = (x - 0.25) * c;
  const z = le + 0.25 * c + dz * Math.cos(inc) + yy * Math.sin(inc);
  const y = wingYqc(s) + yy * Math.cos(inc) - dz * Math.sin(inc);
  return out.set(side * s, y, z);
}
const fx = (f, s) => (typeof f === 'function' ? f(s) : f);

// Surface patch over chord range [x0,x1] (numbers or functions of span) and span [s0,s1]; closed box.
function wingPatch(side, s0, s1, x0, x1, { ns = 8, nx = 10, upperOnly = false, lowerOnly = false, thickPad = 0, cluster = true } = {}) {
  const pos = [], uv = [], idx = [];
  const surf = (upper) => {
    const base = pos.length / 3;
    for (let j = 0; j <= ns; j++) {
      const s = lerp(s0, s1, j / ns);
      const a = fx(x0, s), b = fx(x1, s);
      for (let i = 0; i <= nx; i++) {
        const t = i / nx;
        const xx = a === 0 && cluster ? (1 - Math.cos(t * Math.PI / 2)) * (b - a) + a : a + (b - a) * t;
        const p = wingPoint(side, s, Math.max(1e-4, xx), upper);
        if (thickPad) p.y += upper ? thickPad : -thickPad;
        pos.push(p.x, p.y, p.z);
        uv.push((s - WING.root) / (S_TIP - WING.root), (p.z - 4) / 12);
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
    const row = nx + 1;
    for (const j of [0, ns]) for (let i = 0; i < nx; i++) {
      const a = bu + j * row + i, b = a + 1, c = bl + j * row + i, d = c + 1;
      const flip = (j === 0 ? 1 : -1) * side > 0;
      if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
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

// chord fractions of the moving surfaces
const xFlap = (s) => 1 - flapChord(s) / wingChord(s);
const xSpoil0 = (s) => xFlap(s) - Math.min(0.78, 0.2 * wingChord(s)) / wingChord(s);
const X_SLAT = 0.13, X_AIL = 0.70;

function grid(nu, nv, fn, { flip = false, uvFn = null } = {}) {
  const pos = [], uv = [], idx = [], p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    fn(i / nu, j / nv, p); pos.push(p.x, p.y, p.z);
    if (uvFn) uv.push(...uvFn(i / nu, j / nv)); else uv.push(i / nu, j / nv);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// v coordinate (0 bottom .. 1 top) of height y on the section at z
function vOf(z, y) {
  const s = fusSection(z);
  const up = y >= s.yw, n = up ? s.nU : s.nL, b = up ? s.top - s.yw : s.yw - s.bot;
  const d = clamp(Math.abs(y - s.yw) / Math.max(b, 1e-3), 0, 1);
  const phi = Math.asin(Math.pow(d, n / 2));
  return 0.5 + (up ? 1 : -1) * phi / Math.PI;
}

// ---------------- textures ----------------
function wingTexture() {
  return canvasTex(2048, 1024, (g, w, h) => {
    // u: span root->tip, v: z (v=0 at z=4, v=1 at z=16; canvas y flipped)
    g.fillStyle = '#c3c7cd'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 8; d[i] += n; d[i + 1] += n; d[i + 2] += n + 1; }
    g.putImageData(img, 0, 0);
    const Z = (z) => h - (z - 4) / 12 * h, U = (s) => (s - WING.root) / (S_TIP - WING.root) * w;
    g.strokeStyle = 'rgba(60,65,75,0.35)'; g.lineWidth = 1.2;
    for (let s = WING.root; s < S_TIP; s += 0.55) { g.beginPath(); g.moveTo(U(s), Z(wingLE(s))); g.lineTo(U(s), Z(wingTE(s))); g.stroke(); }
    for (let f = 0.15; f < 0.7; f += 0.075) { g.beginPath(); for (let s = WING.root; s <= S_TIP; s += 0.25) g.lineTo(U(s), Z(wingLE(s) + f * wingChord(s))); g.stroke(); }
    g.fillStyle = 'rgba(70,70,80,0.25)';
    for (let s = WING.root; s < S_TIP; s += 0.55) for (let f = 0.15; f < 0.68; f += 0.012) g.fillRect(U(s) - 1, Z(wingLE(s) + f * wingChord(s)), 2, 1);
    // overwing escape route: black-edged path from the exits, NO STEP everywhere else
    g.strokeStyle = 'rgba(20,20,25,0.85)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(U(2.0), Z(HATCH_Z[0] - 0.4)); g.lineTo(U(4.4), Z(HATCH_Z[0] + 0.3)); g.lineTo(U(4.4), Z(10.3)); g.lineTo(U(2.0), Z(10.6)); g.closePath(); g.stroke();
    g.fillStyle = '#2b2d33'; g.font = 'bold 22px Arial';
    for (const [s, z, px] of [[5.6, 9.2, 22], [9.5, 10.6, 18], [13.0, 12.0, 16]]) { g.save(); g.translate(U(s), Z(z)); g.rotate(-Math.PI / 2); g.font = `bold ${px}px Arial`; g.fillText('NO STEP', -40, 0); g.restore(); }
    g.strokeStyle = 'rgba(50,55,65,0.5)'; g.lineWidth = 2;
    for (let s = 3; s < 15; s += 1.4) { const z = wingLE(s) + 0.45 * wingChord(s); g.beginPath(); g.ellipse(U(s), Z(z), 12, 7, 0, 0, 7); g.stroke(); }
    g.fillStyle = '#9ea3ab'; g.beginPath(); g.arc(U(12.5), Z(wingLE(12.5) + 0.35 * wingChord(12.5)), 8, 0, 7); g.fill();
    g.fillStyle = 'rgba(220,225,232,0.9)';
    g.beginPath(); for (let s = WING.root; s <= S_TIP; s += 0.25) g.lineTo(U(s), Z(wingLE(s))); for (let s = S_TIP; s >= WING.root; s -= 0.25) g.lineTo(U(s), Z(wingLE(s) + 0.1 * wingChord(s))); g.fill();
    g.fillStyle = 'rgba(80,70,60,0.12)'; g.beginPath(); g.ellipse(U(ENGINE.x), Z(10.5), 60, 170, 0, 0, 7); g.fill();
  });
}

// Plan-view silhouette for the contact shadow on the tarmac. Canvas covers x -19..19, z -9..32.
const SH_X = 19, SH_Z0 = -9, SH_Z1 = 32;
function shadowTexture() {
  return canvasTex(256, 280, (g, w, h) => {
    const X = (x) => (x + SH_X) / (2 * SH_X) * w, Z = (z) => (z - SH_Z0) / (SH_Z1 - SH_Z0) * h;
    const c = document.createElement('canvas'); c.width = w; c.height = h; const k = c.getContext('2d');
    k.fillStyle = '#fff';
    k.beginPath();
    for (let z = NOSE_Z; z <= TAIL_Z; z += 0.3) k.lineTo(X(fusSection(z).hw), Z(z));
    for (let z = TAIL_Z; z >= NOSE_Z; z -= 0.3) k.lineTo(X(-fusSection(z).hw), Z(z));
    k.fill();
    for (const side of [-1, 1]) {
      k.beginPath(); k.moveTo(X(0), Z(wingLE(WING.root)));
      for (let s = WING.root; s <= S_TIP + 0.01; s += 0.5) k.lineTo(X(side * s), Z(wingLE(s)));
      for (let s = S_TIP; s >= WING.root - 0.01; s -= 0.5) k.lineTo(X(side * s), Z(wingTE(s)));
      k.lineTo(X(0), Z(wingTE(WING.root))); k.fill();
      k.fillRect(X(side * ENGINE.x - 1.25), Z(ENGINE.zLip), X(2.5) - X(0), Z(ENGINE.zEnd) - Z(ENGINE.zLip));
      k.beginPath(); k.moveTo(X(side * HTP.root), Z(htpLE(HTP.root))); k.lineTo(X(side * HTP.tip), Z(htpLE(HTP.tip))); k.lineTo(X(side * HTP.tip), Z(htpTE(HTP.tip))); k.lineTo(X(side * HTP.root), Z(htpTE(HTP.root))); k.fill();
    }
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.filter = 'blur(3px)'; g.drawImage(c, 0, 0);
    g.filter = 'blur(9px)'; g.globalAlpha = 0.55; g.drawImage(c, 0, 0);
  }, { srgb: false });
}

// LEAP-1A nacelle (2019 livery): silver grey with an SAS-blue inlet cowl ("crown"), the
// "Scandinavian" word mark in dark grey. u runs round the nacelle, v along it (inlet at v=0).
function nacelleTexture() {
  return canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#b8bcc3'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 6; d[i] += n; d[i + 1] += n; d[i + 2] += n + 2; }
    g.putImageData(img, 0, 0);
    const V = (z) => h - (z - ENGINE.zLip) / (ENGINE.zNozzle - ENGINE.zLip) * h; // canvas row of station z (v rises aft)
    g.fillStyle = '#1b3a88'; g.fillRect(0, V(4.85), w, h - V(4.85));    // blue inlet cowl
    g.fillStyle = '#dfe3e8'; g.fillRect(0, V(4.02), w, h - V(4.02));    // bare lip
    g.strokeStyle = 'rgba(50,55,65,0.5)'; g.lineWidth = 2;
    for (const z of [4.85, 5.95, REVERSER_Z, 7.4]) { g.beginPath(); g.moveTo(0, V(z)); g.lineTo(w, V(z)); g.stroke(); }
    // word mark on both sides of the nacelle (u = 0.25 is +x, u = 0.75 is -x), reading left to right
    g.fillStyle = '#434954'; g.font = 'bold 50px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [uc, rot] of [[0.25, 1], [0.75, -1]]) { g.save(); g.translate(uc * w, V(5.45)); g.rotate(rot * Math.PI / 2); g.fillText('Scandinavian', 0, 0); g.restore(); }
  });
}

function sharkletTexture() {
  return canvasTex(256, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#20398a'); gr.addColorStop(1, '#172c6b');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.save(); g.translate(w * 0.52, h * 0.4); g.rotate(-Math.PI / 2 + 0.2);
    g.fillStyle = '#ffffff'; g.font = 'italic bold 104px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('SAS', 0, 36);
    g.restore();
  });
}

// Fuselage livery for one side: u along z (nose..tail), v round the side (bottom..top).
// 2019 SAS livery: a fresh light grey, the SAS blue of the tail carried down the rear fuselage and
// along the belly, a big silver-grey SAS logo up front, "Scandinavian" under the belly.
function skinTexture(holes, side) {
  const X = (z) => (z - NOSE_Z) / FUS_L;
  const color = canvasTex(4096, 1024, (g, w, h) => {
    const Y = (v) => h - v * h, U = (z) => X(z) * w;
    g.fillStyle = '#d3d6db'; g.fillRect(0, 0, w, h);
    // belly blue: low on the sides, sweeping up the tail cone into the fin
    g.fillStyle = '#1d3a86'; g.beginPath();
    g.moveTo(U(-5.2), 0 + h); g.lineTo(U(-5.2), Y(0.12));
    g.bezierCurveTo(U(-3), Y(0.2), U(0), Y(0.215), U(8), Y(0.215));
    g.bezierCurveTo(U(16), Y(0.215), U(20), Y(0.26), U(23.5), Y(0.5));
    g.bezierCurveTo(U(25.5), Y(0.66), U(26.4), Y(0.9), U(27.2), Y(1.0));
    g.lineTo(w, 0); g.lineTo(w, h); g.closePath(); g.fill();
    // radome: a slightly different grey
    g.fillStyle = 'rgba(150,154,160,0.12)'; g.fillRect(0, 0, U(-5.8), h);
    // panel lines & rivets
    g.strokeStyle = 'rgba(60,65,75,0.13)'; g.lineWidth = 1.2;
    for (let z = -5.9; z < 29; z += 0.5334 * 3) { g.beginPath(); g.moveTo(U(z), 0); g.lineTo(U(z), h); g.stroke(); }
    for (let v = 0.08; v < 1; v += 0.08) { g.beginPath(); g.moveTo(U(-5), Y(v)); g.lineTo(U(28), Y(v)); g.stroke(); }
    // canvas pixels per metre differ along (z) and round (v) the fuselage: squeeze text to true shape
    const ASP = (w / FUS_L) / (h / 6.41);
    const text = (str, z, v, px, fill, opts = {}) => {
      g.save(); g.translate(U(z), Y(v)); if (side > 0) g.scale(-1, 1); if (opts.rot) g.rotate(opts.rot);
      g.scale(ASP * (opts.sx || 1), 1);
      g.fillStyle = fill; g.font = `${opts.weight || 'bold'} ${px}px ${opts.font || 'Arial, Helvetica, sans-serif'}`; g.textAlign = opts.align || 'center'; g.textBaseline = 'middle';
      g.fillText(str, 0, 0); g.restore();
    };
    // the big silver-grey logo: from just behind door 1, window line to near the crown
    text('SAS', 2.4, 0.745, 330, '#9ba2ac', { weight: '900', sx: 1.18 });
    text('SE-ROX', 26.0, 0.64, 34, '#2b3140');
    text('Roar Viking', -0.3, 0.55, 22, '#5b6270', { weight: 'normal', font: 'Georgia, serif' });
    // SkyTeam member logo near door 1, national flag under the cockpit
    g.save(); g.translate(U(-1.1), Y(0.66)); if (side > 0) g.scale(-1, 1); g.scale(ASP, 1);
    g.fillStyle = '#1d3a86'; g.beginPath(); g.ellipse(0, 0, 20, 20, 0, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, 12, 0.3, 4.6); g.stroke(); g.beginPath(); g.arc(4, -3, 7, 2.8, 6.4); g.stroke();
    g.fillStyle = '#1d3a86'; g.font = 'bold 13px Arial'; g.textAlign = 'left'; g.fillText('SkyTeam', 25, 5); g.restore();
    g.save(); g.translate(U(-4.0), Y(0.60)); if (side > 0) g.scale(-1, 1); g.scale(ASP, 1);
    g.fillStyle = '#0a5aa8'; g.fillRect(-16, -10, 32, 20); g.fillStyle = '#fecb00'; g.fillRect(-16, -2, 32, 4); g.fillRect(-6, -10, 4, 20); g.restore();
    // door, hatch, cargo door and gear bay outlines
    const outline = (z0, z1, v0, v1, r = 10, a = 0.55) => { g.strokeStyle = `rgba(40,45,55,${a})`; g.lineWidth = 2.2; rr(g, U(z0), Y(v1), U(z1) - U(z0), Y(v0) - Y(v1), r); g.stroke(); };
    for (const d of Object.values(DOORS)) if (d.side === side) outline(d.z - DOOR_W / 2 - 0.03, d.z + DOOR_W / 2 + 0.03, vOf(d.z, -0.02), vOf(d.z, DOOR_H + 0.03), 12);
    for (const hz of HATCH_Z) outline(hz - 0.27, hz + 0.27, vOf(hz, 0.28), vOf(hz, 1.40), 12);
    if (side > 0) {
      outline(-0.14, 1.68, vOf(0.8, -1.58), vOf(0.8, -0.07), 8);          // forward cargo door
      outline(14.37, 16.19, vOf(15.3, -1.58), vOf(15.3, -0.07), 8);       // aft cargo door
      outline(18.44, 19.30, vOf(18.9, -1.30), vOf(18.9, -0.45), 8);       // bulk cargo door
    }
    outline(-4.38, -1.77, 0, vOf(-3, -1.36), 4, 0.4);                     // nose gear bay
    // grime along the belly, exhaust streaks behind the APU
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, Y(0.08), w, Y(0.0) - Y(0.08));
    g.fillStyle = 'rgba(40,40,45,0.25)'; g.fillRect(U(29.2), Y(0.62), U(TAIL_Z) - U(29.2), Y(0.48) - Y(0.62));
  });
  const alpha = canvasTex(4096, 1024, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#000';
    for (const o of holes) {
      if (o.poly) { g.beginPath(); o.poly.forEach(([z, v], i) => (i ? g.lineTo(X(z) * w, h - v * h) : g.moveTo(X(z) * w, h - v * h))); g.closePath(); g.fill(); continue; }
      rr(g, X(o.z0) * w, h - o.v1 * h, (X(o.z1) - X(o.z0)) * w, (o.v1 - o.v0) * h, o.r ?? 7); g.fill();
    }
  }, { srgb: false });
  return { color, alpha };
}

function finTexture() {
  return canvasTex(1024, 1024, (g, w, h) => {
    // u = chord (0 leading edge), v = height (0 root)
    g.fillStyle = '#1d3a86'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2;
    for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(0, h * i / 8); g.lineTo(w, h * i / 8); g.stroke(); }
    g.fillStyle = '#ffffff'; g.font = '900 250px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(w * 0.48, h * 0.45); g.rotate(-0.06); g.fillText('SAS', 0, 0); g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3; g.beginPath(); g.moveTo(w * RUDDER_XC, 0); g.lineTo(w * RUDDER_XC, h); g.stroke();
  });
}
function finGlowTexture(src) {
  return canvasTex(512, 512, (g, w, h) => {
    g.drawImage(src.image, 0, 0, w, h);
    g.globalCompositeOperation = 'multiply';
    const gy = g.createLinearGradient(0, h, 0, 0);
    gy.addColorStop(0, '#ffffff'); gy.addColorStop(0.5, '#a8a8a8'); gy.addColorStop(1, '#141414');
    g.fillStyle = gy; g.fillRect(0, 0, w, h);
    const gx = g.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, '#5a5a5a'); gx.addColorStop(0.45, '#ffffff'); gx.addColorStop(1, '#6a6a6a');
    g.fillStyle = gx; g.fillRect(0, 0, w, h);
  });
}

// Symmetric aerofoil loft: stations [{p: leading edge, chordDir, chord, thick (t/c), thickDir}],
// optional chord range [x0, x1] for control surfaces.
function foilSurface(stations, { mirrorUV = false, x0 = 0, x1 = 1, nx = 12, closeEnds = false } = {}) {
  const pos = [], uv = [], idx = [];
  // winding so that every face points out of the section: + when span x chord points along thickDir
  const st0 = stations[0], stN = stations[stations.length - 1];
  const spanV = stN.p.clone().sub(st0.p);
  const sgn = Math.sign(spanV.clone().cross(st0.chordDir).dot(st0.thickDir)) || 1;
  for (let j = 0; j < stations.length; j++) {
    const st = stations[j];
    for (let k = 0; k < 2; k++) for (let i = 0; i <= nx; i++) {
      const x = x0 + (x1 - x0) * (x0 === 0 ? 1 - Math.cos(i / nx * Math.PI / 2) : i / nx);
      const yt = st.thick * (1.4845 * Math.sqrt(x) - 0.63 * x - 1.758 * x * x + 1.4215 * x ** 3 - 0.5075 * x ** 4) * st.chord;
      const sgn = k ? -1 : 1;
      const P = st.p.clone().addScaledVector(st.chordDir, x * st.chord).addScaledVector(st.thickDir, sgn * Math.max(yt, 0.002));
      pos.push(P.x, P.y, P.z); uv.push(mirrorUV && k === 0 ? 1 - x : x, st.v ?? j / (stations.length - 1));
    }
  }
  const row = (nx + 1) * 2;
  for (let j = 0; j < stations.length - 1; j++) for (let k = 0; k < 2; k++) for (let i = 0; i < nx; i++) {
    const a = j * row + k * (nx + 1) + i, b = a + 1, c = a + row, d = c + 1;
    if ((k === 0) === (sgn > 0)) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  if (closeEnds) for (const j of [0, stations.length - 1]) for (let i = 0; i < nx; i++) {
    const a = j * row + i, b = a + 1, c = j * row + nx + 1 + i, d = c + 1;
    if ((j === 0) === (sgn > 0)) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export class Exterior {
  constructor() {
    this.group = new THREE.Group();
    this.parts = { flaps: [], slats: [], spoilers: [], ailerons: [], reversers: [], fans: [], elevators: [] };
    this.flexU = { value: 0 }; this.flexAU = { value: 0 };
    const wingTex = wingTexture();
    const span = WING.tip - WING.root;
    const mk = (opts) => {
      const m = new THREE.MeshStandardMaterial(opts);
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uFlex = this.flexU; sh.uniforms.uFlexA = this.flexAU;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uFlex; uniform float uFlexA;')
          .replace('#include <project_vertex>', `
            // first bending mode of the wing (tip deflection uFlex, metres, from the shape drawn here),
            // plus the antisymmetric mode (one wing up, the other down). Applied in the aircraft frame
            // after the flaps, slats and spoilers have moved, so they bend with the wing.
            vec4 wpF = modelMatrix * vec4(transformed, 1.0);
            float spF = clamp((abs(wpF.x) - ${WING.root.toFixed(2)}) / ${span.toFixed(2)}, 0.0, 1.2);
            wpF.y += (uFlex + sign(wpF.x) * uFlexA) * spF * spF * (1.0 + 0.25 * spF) / 1.25;
            vec4 mvPosition = viewMatrix * wpF;
            gl_Position = projectionMatrix * mvPosition;`);
      };
      return exposeMaterial(m);
    };
    const ex = (m) => exposeMaterial(m);
    this.mats = {
      wing: mk({ color: '#ffffff', map: wingTex, roughness: 0.42, metalness: 0.35 }),
      wingLower: mk({ color: '#b3b8bf', roughness: 0.55, metalness: 0.3 }),
      metal: mk({ color: '#d7dbe1', roughness: 0.28, metalness: 0.8 }),
      flap: mk({ color: '#bfc3c9', roughness: 0.45, metalness: 0.35 }),
      dark: mk({ color: '#2d3139', roughness: 0.6, metalness: 0.3 }),
      nacelle: ex(new THREE.MeshStandardMaterial({ color: '#ffffff', map: nacelleTexture(), roughness: 0.35, metalness: 0.45 })),
      lip: ex(new THREE.MeshStandardMaterial({ color: '#e8ebef', roughness: 0.15, metalness: 0.95 })),
      core: ex(new THREE.MeshStandardMaterial({ color: '#5d626b', roughness: 0.5, metalness: 0.6 })),
      hot: ex(new THREE.MeshStandardMaterial({ color: '#6b5d52', roughness: 0.55, metalness: 0.7 })),
      fan: ex(new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.35, metalness: 0.6 })),
      duct: ex(new THREE.MeshStandardMaterial({ color: '#3b3f47', roughness: 0.6, metalness: 0.4, side: THREE.BackSide })),
      sharklet: mk({ color: '#ffffff', map: sharkletTexture(), roughness: 0.35, metalness: 0.25, side: THREE.DoubleSide }),
      pylon: ex(new THREE.MeshStandardMaterial({ color: '#c3c7cd', roughness: 0.45, metalness: 0.35 })),
      fairing: ex(new THREE.MeshStandardMaterial({ color: '#c8ccd2', roughness: 0.5, metalness: 0.25 })),
      grey: ex(new THREE.MeshStandardMaterial({ color: '#c9ccd2', roughness: 0.45, metalness: 0.3 })),
    };
    for (const side of [-1, 1]) this._buildWing(side);
    for (const side of [-1, 1]) this._buildEngine(side);
    this._buildFuselage();
    this._buildTail();
    this._buildGear();
    this._buildVortices();
    this._buildEngineFx();
    this._buildSlides();
    this._buildLights();
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  }

  _add(geo, mat, parent = this.group) { const m = new THREE.Mesh(geo, mat); parent.add(m); return m; }

  // ---------------- wing ----------------
  _buildWing(side) {
    const M = this.mats;
    // wing box: upper skin (textured) up to the spoiler line, lower skin up to the flaps/aileron
    const xTE = (s) => (s < AILERON[0] ? xFlap(s) : X_AIL);
    this._add(wingPatch(side, S0, S_TIP, X_SLAT, xSpoil0, { ns: 36, nx: 14, upperOnly: true }), M.wing);
    this._add(wingPatch(side, S0, S_TIP, X_SLAT, xTE, { ns: 36, nx: 10, lowerOnly: true }), M.wingLower);
    // fixed leading edge where there is no slat (root, pylon, tip)
    for (const [a, b] of [[S0, SLATS[0][0]], [SLATS[0][1], SLATS[1][0]], [SLATS[4][1], S_TIP]]) this._add(wingPatch(side, a, b, 0, X_SLAT + 0.005, { ns: 2, nx: 8 }), M.metal);
    for (const [a, b] of SLATS) {
      const geo = wingPatch(side, a, b, 0, X_SLAT + 0.005, { ns: 4, nx: 8 });
      const pivot = this._hinged(geo, M.metal, side, a, b, X_SLAT - 0.02, -0.05);
      this.parts.slats.push({ pivot, side });
    }
    // spoilers ahead of the flaps (upper surface only; the lower skin continues under them)
    for (const [a, b] of SPOILERS) {
      const sm = (a + b) / 2;
      const geo = wingPatch(side, a, b, xSpoil0(sm), xFlap(sm) + 0.01, { ns: 3, nx: 4, upperOnly: true, thickPad: 0.008 });
      const pivot = this._hinged(geo, M.wing, side, a, b, xSpoil0(sm), 0.0, true);
      this.parts.spoilers.push({ pivot, side });
    }
    // fixed upper skin behind the spoiler line where there is no spoiler
    for (const [a, b] of [[S0, SPOILERS[0][0]], [SPOILERS[0][1], SPOILERS[1][0]], [SPOILERS[4][1], S_TIP]]) this._add(wingPatch(side, a, b, xSpoil0, xTE, { ns: 3, nx: 3, upperOnly: true }), M.wing);
    // single-slotted Fowler flaps, inboard and outboard
    for (const [a, b] of FLAPS) {
      const geo = wingPatch(side, a, b, xFlap, 1.0, { ns: 8, nx: 7 });
      const pivot = this._hinged(geo, M.flap, side, a, b, xFlap((a + b) / 2) + 0.05, -0.1);
      this.parts.flaps.push({ pivot, side, s0: a, s1: b });
    }
    // fixed trailing edge between the outboard flap and the aileron
    this._add(wingPatch(side, FLAPS[1][1], AILERON[0], xFlap, 1.0, { ns: 1, nx: 5 }), M.flap);
    for (const s of CANOES) {
      const le = wingLE(s), c = wingChord(s);
      const canoe = new THREE.CapsuleGeometry(0.16, 2.2, 4, 10); canoe.rotateX(Math.PI / 2); canoe.scale(0.72, 1.15, 1);
      const p = wingPoint(side, s, 0.8, false);
      canoe.translate(side * s, p.y - 0.17, le + 0.93 * c);
      this._add(canoe, M.wingLower);
    }
    {
      const geo = wingPatch(side, AILERON[0], AILERON[1], X_AIL, 1.0, { ns: 5, nx: 6 });
      const pivot = this._hinged(geo, M.flap, side, AILERON[0], AILERON[1], X_AIL + 0.02, 0.0);
      this.parts.ailerons.push({ pivot, side });
    }
    this._add(wingPatch(side, AILERON[1], S_TIP, X_AIL, 1.0, { ns: 1, nx: 5 }), M.flap);
    this._buildSharklet(side);
    this[side < 0 ? 'tipL' : 'tipR'] = new THREE.Vector3(side * (S_TIP + 0.1), wingYqc(S_TIP) + 0.02, wingLE(S_TIP) + 0.15);
  }

  _buildSharklet(side) {
    // lofted along the measured spine from the wing tip up to the top of the sharklet
    const st = SHARKLET;
    const N = 16, nx = 10, pos = [], uv = [], idx = [];
    const sample = (t) => {
      const f = t * (st.length - 1), i = Math.min(st.length - 2, Math.floor(f)), k = f - i;
      const a = st[i], b = st[i + 1];
      return { y: lerp(a[0], b[0], k), le: lerp(a[1], b[1], k), te: lerp(a[2], b[2], k), sp: lerp(a[3], b[3], k) };
    };
    for (let j = 0; j <= N; j++) {
      const t = j / N, s = sample(t), s2 = sample(Math.min(1, t + 0.02)), s1 = sample(Math.max(0, t - 0.02));
      // thickness direction: normal to the spine in the spanwise-vertical plane
      const dx = s2.sp - s1.sp, dy = s2.y - s1.y, l = Math.hypot(dx, dy) || 1;
      const nX = -dy / l, nY = dx / l; // rotate the tangent +90 degrees
      const chord = s.te - s.le, th = lerp(0.1, 0.075, t) * chord;
      for (let k = 0; k < 2; k++) for (let i = 0; i <= nx; i++) {
        const x = 1 - Math.cos(i / nx * Math.PI / 2);
        const yt = th * (1.4845 * Math.sqrt(x) - 0.63 * x - 1.758 * x * x + 1.4215 * x ** 3 - 0.5075 * x ** 4) * 0.5 * 2;
        const sg = k ? -1 : 1;
        pos.push(side * (s.sp + nX * sg * yt), s.y + nY * sg * yt, s.le + x * chord);
        uv.push((k === 1) === (side > 0) ? 1 - x : x, t); // the logo reads the right way round from either side
      }
    }
    const row = (nx + 1) * 2;
    for (let j = 0; j < N; j++) for (let k = 0; k < 2; k++) for (let i = 0; i < nx; i++) {
      const a = j * row + k * (nx + 1) + i, b = a + 1, c = a + row, d = c + 1;
      const f = (k === 0) !== (side < 0);
      if (f) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    this._add(g, this.mats.sharklet); // double-sided material shared by both sharklets
  }

  // Hinged part: pivot on the hinge line at chord fraction xh (vertical offset yOff chords).
  _hinged(geo, mat, side, s0, s1, xh, yOff, top = false) {
    const pA = wingPoint(side, s0, xh, top), pB = wingPoint(side, s1, xh, top);
    pA.y += yOff * wingChord(s0); pB.y += yOff * wingChord(s1);
    const axis = pB.clone().sub(pA).normalize();
    const pivot = new THREE.Group();
    pivot.position.copy(pA);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pA).negate();
    pivot.add(m);
    this.group.add(pivot);
    pivot.userData.axis = axis; pivot.userData.base = pA.clone();
    return pivot;
  }
  _setHinge(pivot, angle, slideAft = 0, slideDown = 0) {
    pivot.quaternion.setFromAxisAngle(pivot.userData.axis, angle);
    pivot.position.copy(pivot.userData.base);
    pivot.position.z += slideAft; pivot.position.y -= slideDown;
  }

  // ---------------- engines ----------------
  _buildEngine(side) {
    const M = this.mats, E = ENGINE;
    const eng = new THREE.Group(); eng.position.set(side * E.x, E.y, 0); this.group.add(eng);
    // LatheGeometry revolves a (r, h) profile about y; rotating it +90 degrees about x turns h into z
    // (aft) and puts u = 0 at the bottom. Profiles with rising z face outwards.
    const lathe = (pts, segs = 48) => { const g = new THREE.LatheGeometry(pts.map(([z, r]) => new THREE.Vector2(r, z)), segs); g.rotateX(Math.PI / 2); return g; };
    const fwd = [[E.zLip + 0.06, 1.075], ...NACELLE.filter(([z]) => z > E.zLip + 0.06 && z <= REVERSER_Z + 1e-6)];
    const aft = NACELLE.filter(([z]) => z >= REVERSER_Z - 1e-6);
    const setUV = (g) => { const p = g.attributes.position, uvA = g.attributes.uv; for (let i = 0; i < p.count; i++) uvA.setY(i, (p.getZ(i) - E.zLip) / (E.zNozzle - E.zLip)); return g; };
    this._add(setUV(lathe(fwd)), M.nacelle, eng);
    const sleeve = new THREE.Group(); eng.add(sleeve);
    this._add(setUV(lathe(aft)), M.nacelle, sleeve);
    // the sleeve's inner wall (bypass duct outer wall) and the cascades it uncovers
    this._add(lathe([[REVERSER_Z, 1.08], [E.zNozzle, 1.0]], 40), M.duct, sleeve);
    const cascade = this._add(new THREE.CylinderGeometry(1.2, 1.2, 0.55, 40, 1, true).rotateX(Math.PI / 2), M.dark, eng); cascade.position.z = REVERSER_Z + 0.3; cascade.visible = false;
    this.parts.reversers.push({ sleeve, cascade, side });
    // inlet: lip and duct to the fan
    this._add(lathe([[E.zLip + 0.02, 0.985], [E.zLip + 0.3, 0.99], [E.zFan + 0.1, 0.99]], 48), M.duct, eng);
    this._add(lathe([[E.zLip + 0.03, 0.985], [E.zLip, 1.01], [E.zLip + 0.015, 1.04], [E.zLip + 0.06, 1.075]], 48), M.lip, eng);
    // fan: 18 composite blades and the spinner
    const fan = new THREE.Group(); fan.position.z = E.zFan; eng.add(fan);
    // wide-chord swept blades: each tapers and twists from root to tip, so together they close the disc
    const blade = new THREE.PlaneGeometry(0.34, 0.72, 1, 6); blade.translate(0, 0.63, 0);
    { const p = blade.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), t = (y - 0.27) / 0.72, x = p.getX(i); p.setX(i, x * (0.75 + 0.35 * t) + 0.05 * t * t); p.setZ(i, -x * (0.9 - 0.5 * t)); } blade.computeVertexNormals(); }
    const bladeMat = M.fan.clone(); bladeMat.side = THREE.DoubleSide; bladeMat.customProgramCacheKey = M.fan.customProgramCacheKey; bladeMat.onBeforeCompile = M.fan.onBeforeCompile;
    for (let i = 0; i < 18; i++) { const b = this._add(blade, bladeMat, fan); b.rotation.z = i / 18 * Math.PI * 2; }
    const disc = this._add(new THREE.CircleGeometry(0.98, 40), M.dark, eng); disc.position.z = E.zFan + 0.35; disc.rotation.y = Math.PI; // booster face behind the fan, facing forward
    const spinner = this._add(new THREE.ConeGeometry(0.3, 0.55, 24).rotateX(-Math.PI / 2), M.lip, fan); spinner.position.z = -0.12;
    const hub = this._add(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 24).rotateX(Math.PI / 2), M.fan, fan); hub.position.z = 0.18;
    this.parts.fans.push({ fan, side, angle: 0 });
    // core cowl, core nozzle and plug; the bypass exit ring
    this._add(lathe(CORE, 40), M.core, eng);
    this._add(lathe(PLUG, 32), M.hot, eng);
    const ring = this._add(new THREE.RingGeometry(0.74, 1.0, 40), M.dark, eng); ring.position.z = E.zNozzle - 0.05; // faces aft
    // pylon: the side outline (z, y) extruded 0.36 m across; rotating -90 degrees about y maps the
    // outline's x to z and the extrusion to x
    const sh = new THREE.Shape();
    PYLON.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
    const pg = new THREE.ExtrudeGeometry(sh, { depth: 0.36, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.06, bevelSegments: 2 });
    pg.translate(0, 0, -0.18); pg.rotateY(-Math.PI / 2);
    const py = this._add(pg, M.pylon); py.position.set(side * E.x, 0, 0);
  }

  // ---------------- fuselage ----------------
  _buildFuselage() {
    this.doorPlugs = {};
    const holes = [];
    const tilt = (z) => { const e = 0.02; const a = fusHalfWidthAt(z, CAB.winY - e), b = fusHalfWidthAt(z, CAB.winY + e); return Math.atan2(a - b, 2 * e); };
    for (const w of windowList()) {
      if (w.side > 0) continue;
      const hh = CAB.paneH / 2 * Math.cos(tilt(w.z));
      holes.push({ z0: w.z - CAB.paneW / 2, z1: w.z + CAB.paneW / 2, v0: vOf(w.z, CAB.winY - hh), v1: vOf(w.z, CAB.winY + hh), r: 9 });
    }
    for (const d of Object.values(DOORS)) {
      if (d.side > 0) continue;
      holes.push({ z0: d.z - DOOR_W / 2 + 0.02, z1: d.z + DOOR_W / 2 - 0.02, v0: vOf(d.z, 0.0), v1: vOf(d.z, DOOR_H + 0.02), r: 12 });
    }
    // the six flight-deck windows, so the world shows through them from inside
    for (const pane of COCKPIT_PANES) holes.push({ poly: paneOutline(pane, 1).pts.map(([z, u]) => [z, (u + 1) / 2]) });
    // stations: fine at the nose and tail
    const zs = [];
    for (let z = NOSE_Z; z < -3.4; z += 0.08) zs.push(z);
    for (let z = -3.4; z < 17; z += 0.25) zs.push(z);
    for (let z = 17; z < TAIL_Z; z += 0.18) zs.push(z);
    zs.push(TAIL_Z);
    const NA = 56;
    const p = new THREE.Vector3();
    for (const side of [-1, 1]) {
      const tex = skinTexture(holes, side);
      const pos = [], uv = [], idx = [];
      zs.forEach((z) => {
        for (let i = 0; i <= NA; i++) {
          const u = -1 + 2 * i / NA;
          fusPoint(z, side, u, p);
          pos.push(p.x, p.y, p.z); uv.push((z - NOSE_Z) / FUS_L, (u + 1) / 2);
        }
      });
      for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < NA; i++) {
        const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1;
        if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      const mat = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex.color, alphaMap: tex.alpha, alphaTest: 0.5, roughness: 0.34, metalness: 0.3 }));
      this._add(g, mat);
      // closed doors: skin plugs over the door cut-outs
      const plugMat = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex.color, roughness: 0.34, metalness: 0.3 }));
      for (const [name, d] of Object.entries(DOORS)) {
        if (d.side !== side) continue;
        const za = d.z - DOOR_W / 2 - 0.01, zb = d.z + DOOR_W / 2 + 0.01;
        const va = vOf(d.z, -0.01), vb = vOf(d.z, DOOR_H + 0.03);
        const pg = grid(4, 10, (a, b, o) => { const z = lerp(za, zb, a), v = lerp(va, vb, b); fusPoint(z, side, v * 2 - 1, o, 0.004); }, { flip: side > 0, uvFn: (a, b) => [(lerp(za, zb, a) - NOSE_Z) / FUS_L, lerp(va, vb, b)] });
        this.doorPlugs[name] = this._add(pg, plugMat);
      }
    }
    // what you see through the windows from outside: a dim cabin that glows warm after dark
    this.cabinGlow = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#1b2129', roughness: 0.15, metalness: 0.4, emissive: '#ffdcaa', emissiveIntensity: 0 }));
    for (const side of [-1, 1]) {
      const z0 = DOORS.L1.z - 0.6, z1 = DOORS.L4.z + 0.6;
      this._add(grid(40, 8, (a, b, o) => fusPoint(lerp(z0, z1, a), side, lerp(-0.05, 0.75, b), o, -0.05), { flip: side > 0 }), this.cabinGlow);
    }
    this._buildBellyTitle();
    this._buildCockpitGlazing();
    // belly fairing seam, APU exhaust, antennas, pitot probes
    const M = this.mats;
    const apu = this._add(new THREE.CylinderGeometry(0.17, 0.2, 0.35, 16, 1, true).rotateX(Math.PI / 2), M.dark); apu.position.set(0, 1.43, TAIL_Z - 0.1);
    apu.material = M.dark.clone(); apu.material.side = THREE.DoubleSide;
    const blade = new THREE.BoxGeometry(0.02, 0.28, 0.32); blade.translate(0, 0.14, 0);
    for (const [z, top] of [[-0.8, true], [6.5, true], [13.0, true], [2.0, false], [16.5, false]]) {
      const s = fusSection(z); const b = this._add(blade, M.grey); b.position.set(0, top ? s.top : s.bot, z); if (!top) b.rotation.z = Math.PI;
    }
    const satcom = this._add(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.grey); satcom.scale.set(0.45, 0.16, 1.1); satcom.position.set(0, fusSection(12.5).top - 0.02, 12.5);
    for (const side of [-1, 1]) for (const [z, y] of [[-5.35, 0.25], [-5.1, -0.35]]) {
      const pt = this._add(new THREE.CylinderGeometry(0.012, 0.018, 0.2, 6).rotateZ(Math.PI / 2), M.metal);
      pt.position.set(side * (fusHalfWidthAt(z, y) + 0.08), y, z);
    }
    // soft ground shadow under the aircraft (only shown on the ground)
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2 * SH_X, SH_Z1 - SH_Z0), new THREE.MeshBasicMaterial({ alphaMap: shadowTexture(), color: '#000000', transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.set(0, NOSE_GEAR.y + 0.02, (SH_Z0 + SH_Z1) / 2); this.shadow.renderOrder = -1; this.group.add(this.shadow);
  }

  // Six cockpit windows following the skin, with a dark seal round each. The windshields sit on the
  // crown of the nose, so they are projected vertically onto the skin; the side windows sideways.
  _buildCockpitGlazing() {
    const glass = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#0c1219', roughness: 0.06, metalness: 0.85, envMapIntensity: 1.4, side: THREE.DoubleSide }));
    const seal = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.7, side: THREE.DoubleSide }));
    this.cockpitGlass = glass; this.cockpitGlazing = [];
    // a point on the upper lobe (an ellipse), pushed out along its normal
    const onSkin = (z, x, y, grow) => { const s = fusSection(z); const a = s.hw, b = s.top - s.yw; let nx = Math.abs(x) / (a * a), ny = (y - s.yw) / (b * b); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; return [Math.abs(x) + nx * grow, y + ny * grow]; };
    const onTop = (z, x) => { const s = fusSection(z); const d = clamp(Math.abs(x) / Math.max(s.hw, 1e-3), 0, 1); return s.yw + (s.top - s.yw) * Math.sqrt(Math.max(0, 1 - d * d)); };
    for (const side of [-1, 1]) {
      for (const pane of COCKPIT_PANES) {
        const vertical = pane.name === 'windshield';
        // work in (z, a): a = |x| for the windshield, y for the side windows
        const pts = pane.pts.map(([z, y, x]) => [z, vertical ? Math.abs(x) : y]);
        const cz = pts.reduce((a, p) => a + p[0], 0) / pts.length, ca = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        for (const [mat, scale, grow] of [[seal, 1.07, 0.008], [glass, 1.0, 0.016]]) {
          const pos = [], idx = [];
          const ring = pts.map(([z, a]) => [cz + (z - cz) * scale, ca + (a - ca) * scale]);
          const R = 6;
          const put = (z, a) => {
            const [px, py] = vertical ? onSkin(z, a, onTop(z, a), grow) : onSkin(z, fusHalfWidthAt(z, a), a, grow);
            pos.push(side * px, py, z);
          };
          put(cz, ca);
          for (let r = 1; r <= R; r++) for (let k = 0; k < ring.length; k++) for (let q = 0; q < 4; q++) {
            const A = ring[k], B = ring[(k + 1) % ring.length], t = q / 4;
            put(cz + (lerp(A[0], B[0], t) - cz) * r / R, ca + (lerp(A[1], B[1], t) - ca) * r / R);
          }
          const nPer = ring.length * 4;
          for (let i = 0; i < nPer; i++) idx.push(0, 1 + i, 1 + (i + 1) % nPer);
          for (let r = 1; r < R; r++) for (let i = 0; i < nPer; i++) {
            const a = 1 + (r - 1) * nPer + i, b = 1 + (r - 1) * nPer + (i + 1) % nPer, c = a + nPer, d = b + nPer;
            idx.push(a, c, b, b, c, d);
          }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
          this.cockpitGlazing.push(this._add(g, mat)); // double-sided: three.js turns the normals to face the viewer
        }
      }
      // wiper parked at the bottom of each windshield
      const w = this._add(new THREE.BoxGeometry(0.03, 0.02, 0.62), this.mats.dark);
      const z = -5.72, y = 0.95; w.position.set(side * (fusHalfWidthAt(z, y) * 0.45), y + 0.02, z); w.rotation.y = side * 0.9;
    }
  }

  // "Scandinavian" under the belly (2019 livery), one decal across both halves of the skin, reading
  // from nose to tail for someone underneath with the left wing at the top of their view.
  _buildBellyTitle() {
    const z0 = -1.2, z1 = 13.8, uEdge = -0.72;
    const P = new THREE.Vector3(), Q = new THREE.Vector3();
    // arc length across the belly, for true letter proportions
    let across = 0; for (let i = 0; i < 20; i++) { fusPoint(6, 1, -1 + (1 + uEdge) * i / 20, P); fusPoint(6, 1, -1 + (1 + uEdge) * (i + 1) / 20, Q); across += P.distanceTo(Q); }
    across *= 2;
    const W = 2048, H = 256, kx = (W / (z1 - z0)) / (H / across);
    const tex = canvasTex(W, H, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.save(); g.translate(w / 2, h / 2); g.scale(kx * 0.92, 1);
      g.fillStyle = '#dfe4ee'; g.font = '600 150px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('Scandinavian', 0, 6); g.restore();
    });
    // b runs from the right edge (+x) through the keel to the left edge, so canvas-up is the left side
    const geo = grid(60, 16, (a, b, o) => { const side = b < 0.5 ? 1 : -1; fusPoint(lerp(z0, z1, a), side, -1 + (1 + uEdge) * Math.abs(2 * b - 1), o, 0.006); });
    const m = new THREE.Mesh(geo, exposeMaterial(new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false })));
    this.group.add(m);
  }

  // ---------------- tail ----------------
  _buildTail() {
    const M = this.mats;
    this.finTex = finTexture();
    const finMat = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#ffffff', map: this.finTex, roughness: 0.4, metalness: 0.25, emissive: '#fff3de', emissiveMap: finGlowTexture(this.finTex), emissiveIntensity: 0 }));
    this.finMat = finMat;
    // fixed fin (leading edge to the rudder hinge) and the rudder on its hinge line
    const y0 = FIN[0][0], y1 = FIN[FIN.length - 1][0];
    const finSt = FIN.map(([y, le, te, ht]) => ({ p: new THREE.Vector3(0, y, le), chordDir: new THREE.Vector3(0, 0, 1), chord: te - le, thick: 2 * ht / (te - le), thickDir: new THREE.Vector3(1, 0, 0), v: (y - y0) / (y1 - y0) }));
    this._add(foilSurface(finSt, { mirrorUV: true, x0: 0, x1: RUDDER_XC + 0.01, nx: 14, closeEnds: true }), finMat);
    const rudG = foilSurface(finSt.filter((s) => s.p.y >= 2.45), { mirrorUV: true, x0: RUDDER_XC, x1: 1, nx: 6, closeEnds: true });
    const hinge = FIN.filter(([y]) => y >= 2.45).map(([y, le, te]) => new THREE.Vector3(0, y, le + RUDDER_XC * (te - le)));
    const rp = new THREE.Group(); rp.position.copy(hinge[0]); this.group.add(rp);
    const rm = new THREE.Mesh(rudG, finMat); rm.position.copy(hinge[0]).negate(); rp.add(rm);
    rp.userData.axis = hinge[hinge.length - 2].clone().sub(hinge[0]).normalize();
    this.rudder = rp;
    // trimmable horizontal stabiliser (pivots at its rear spar) with the elevators hinged behind it
    this.ths = new THREE.Group(); this.ths.position.set(0, HTP_PIVOT.y, HTP_PIVOT.z); this.group.add(this.ths);
    const off = new THREE.Vector3(0, -HTP_PIVOT.y, -HTP_PIVOT.z);
    const EX = 0.70;
    for (const side of [-1, 1]) {
      const stations = [];
      for (let i = 0; i <= 8; i++) {
        const s = lerp(HTP.root, HTP.tip, i / 8), le = htpLE(s), c = htpTE(s) - le;
        stations.push({ p: new THREE.Vector3(side * s, htpY(s), le).add(off), chordDir: new THREE.Vector3(0, 0, 1), chord: c, thick: lerp(0.1, 0.08, i / 8), thickDir: new THREE.Vector3(0, 1, 0) });
      }
      const fixed = foilSurface(stations, { x0: 0, x1: EX + 0.01, nx: 12, closeEnds: true });
      this._add(fixed, M.grey, this.ths);
      const elev = foilSurface(stations.filter((_, i) => i > 0), { x0: EX, x1: 1, nx: 5, closeEnds: true });
      const h0 = new THREE.Vector3(side * lerp(HTP.root, HTP.tip, 1 / 8), htpY(lerp(HTP.root, HTP.tip, 1 / 8)), htpLE(lerp(HTP.root, HTP.tip, 1 / 8)) + EX * (htpTE(lerp(HTP.root, HTP.tip, 1 / 8)) - htpLE(lerp(HTP.root, HTP.tip, 1 / 8)))).add(off);
      const h1 = new THREE.Vector3(side * HTP.tip, htpY(HTP.tip), htpLE(HTP.tip) + EX * (htpTE(HTP.tip) - htpLE(HTP.tip))).add(off);
      const ep = new THREE.Group(); ep.position.copy(h0); this.ths.add(ep);
      const em = new THREE.Mesh(elev, M.grey); em.position.copy(h0).negate(); ep.add(em);
      ep.userData.axis = h1.clone().sub(h0).normalize();
      this.parts.elevators.push({ pivot: ep, side });
    }
  }

  // Condensation streams shed from the flap edges on humid days with flaps out.
  _buildVortices() {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    this.vortices = [];
    for (const side of [-1, 1]) for (const s0 of [FLAPS[0][1], FLAPS[1][1], ENGINE.x + 0.4]) {
      const p = wingPoint(side, s0, 0.95, true);
      const g = new THREE.CylinderGeometry(0.09, 0.28, 9, 8, 1, true); g.rotateX(Math.PI / 2); g.translate(0, 0, 4.5);
      const m = new THREE.Mesh(g, mat.clone()); m.position.set(p.x, p.y + 0.05, p.z + 0.2); this.group.add(m); this.vortices.push(m);
    }
  }

  // ---------------- landing gear ----------------
  // Twin-wheel nose leg retracting forwards; two twin-wheel main legs hinged at the wing rear spar
  // folding inboard into the belly.
  _buildGear() {
    const M = this.mats;
    const tyre = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#17181a', roughness: 0.9 }));
    const hub = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.4, metalness: 0.6 }));
    const strut = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#d6d9de', roughness: 0.35, metalness: 0.7 }));
    const chrome = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#eef1f4', roughness: 0.12, metalness: 1 }));
    const wheel = (r, w) => {
      const g = new THREE.Group();
      const t = new THREE.Mesh(new THREE.TorusGeometry(r - w * 0.32, w * 0.45, 10, 28), tyre); t.rotation.y = Math.PI / 2; t.scale.set(1, 1, 1.0);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, w * 0.8, 20).rotateZ(Math.PI / 2), hub);
      g.add(t, core); return g;
    };
    this.gear = { main: [], nose: null, doors: [], mainDoors: [] };
    const MG = MAIN_GEAR;
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(side * MG.x, MG.pivotY, MG.z); this.group.add(pivot);
      const axleY = MG.y + MG.r - MG.pivotY; // axle height relative to the pivot
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, -axleY * 0.62, 12), strut); upper.position.y = axleY * 0.31; pivot.add(upper);
      const slide = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, -axleY * 0.45, 10), chrome); slide.position.y = axleY * 0.78; pivot.add(slide);
      const sideStay = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 8), strut); sideStay.position.set(-side * 0.72, -0.6, 0.12); sideStay.rotation.z = side * 0.95; pivot.add(sideStay);
      const torque = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.35, 0.2), strut); torque.position.set(0, axleY + 0.35, -0.16); pivot.add(torque);
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2 * MG.wheelX, 8).rotateZ(Math.PI / 2), strut); axle.position.y = axleY; pivot.add(axle);
      for (const w of [-MG.wheelX, MG.wheelX]) { const wh = wheel(MG.r, 0.43); wh.position.set(w, axleY, 0); pivot.add(wh); }
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.35, 0.95), M.grey); door.position.set(side * 0.2, -0.75, 0); pivot.add(door);
      this.gear.main.push({ pivot, side });
      // belly bay door: opens while the gear travels, closed with the gear down or up
      const bh = new THREE.Group(); bh.position.set(side * 0.22, fusSection(MG.z).bot + 0.04, MG.z); this.group.add(bh);
      const bd = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.03, 1.8), M.grey); bd.position.x = side * 0.85; bh.add(bd);
      this.gear.mainDoors.push({ hinge: bh, side });
    }
    // nose gear
    const NG = NOSE_GEAR;
    const pivY = -1.05;
    const np = new THREE.Group(); np.position.set(0, pivY, NG.z); this.group.add(np);
    const axleY = NG.y + NG.r - pivY;
    const nl = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, -axleY * 0.7, 10), strut); nl.position.y = axleY * 0.35; np.add(nl);
    const ns = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, -axleY * 0.4, 10), chrome); ns.position.y = axleY * 0.8; np.add(ns);
    const drag = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 8), strut); drag.position.set(0, -0.72, -0.5); drag.rotation.x = -0.75; np.add(drag); this.gear.drag = drag;
    for (const w of [-NG.wheelX, NG.wheelX]) { const wh = wheel(NG.r, 0.23); wh.position.set(w, axleY, 0); np.add(wh); }
    // taxi & take-off light and the runway turn-off lights on the nose leg
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.06), exposeMaterial(new THREE.MeshStandardMaterial({ color: '#dfe6ee', emissive: '#fff4dc', emissiveIntensity: 0, roughness: 0.2 })));
    lamp.position.set(0, axleY + 0.75, -0.14); np.add(lamp); this.noseLamp = lamp;
    for (const sd of [-1, 1]) {
      const hinge = new THREE.Group(); hinge.position.set(sd * 0.36, fusSection(-3.2).bot + 0.06, -3.3); this.group.add(hinge);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.36, 2.1), M.grey); door.position.y = -0.18; hinge.add(door);
      this.gear.doors.push({ hinge, sd });
    }
    this.gear.nose = np;
    this.taxiLight = new THREE.SpotLight('#fff3dc', 0, 90, 0.35, 0.5, 1.1); this.taxiLight.position.set(0, NG.y + 1.3, NG.z - 0.2); this.taxiLight.target.position.set(0, NG.y, NG.z - 40); this.group.add(this.taxiLight, this.taxiLight.target);
  }

  // ---------------- lights ----------------
  _buildLights() {
    const glow = glowTex();
    const mkSprite = (color, size) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.scale.setScalar(size); this.group.add(s); return s; };
    this.lights = {};
    // navigation lights in the wing tips (red left, green right), white on the tail cone
    this.lights.navL = mkSprite('#ff2a1a', 0.9); this.lights.navL.position.copy(this.tipL);
    this.lights.navR = mkSprite('#22ff66', 0.9); this.lights.navR.position.copy(this.tipR);
    this.lights.navT = mkSprite('#ffffff', 0.6); this.lights.navT.position.set(0, 1.45, TAIL_Z + 0.05);
    this.lights.strobeL = mkSprite('#ffffff', 3.2); this.lights.strobeL.position.copy(this.tipL).add(new THREE.Vector3(0, 0, 0.9));
    this.lights.strobeR = mkSprite('#ffffff', 3.2); this.lights.strobeR.position.copy(this.tipR).add(new THREE.Vector3(0, 0, 0.9));
    this.lights.strobeT = mkSprite('#ffffff', 2.2); this.lights.strobeT.position.set(0, 1.5, TAIL_Z + 0.1);
    // anti-collision beacons on top and underneath the fuselage
    this.lights.beaconT = mkSprite('#ff2020', 1.6); this.lights.beaconT.position.set(0, fusSection(8.0).top + 0.12, 8.0);
    this.lights.beaconB = mkSprite('#ff2020', 1.6); this.lights.beaconB.position.set(0, fusSection(12.0).bot - 0.1, 12.0);
    // wing scan lights on the fuselage sides ahead of the wing
    this.lights.scan = mkSprite('#fff4e0', 0.7); this.lights.scan.position.set(-(fusHalfWidthAt(3.6, 0.9) + 0.03), 0.9, 3.6);
    this.navLightL = new THREE.PointLight('#ff3020', 0, 5, 2); this.navLightL.position.copy(this.lights.navL.position); this.group.add(this.navLightL);
    this.navLightR = new THREE.PointLight('#30ff60', 0, 5, 2); this.navLightR.position.copy(this.lights.navR.position); this.group.add(this.navLightR);
    this.strobeLight = new THREE.PointLight('#ffffff', 0, 14, 1.5); this.group.add(this.strobeLight);
    this.beaconLight = new THREE.PointLight('#ff1a10', 0, 9, 1.5); this.beaconLight.position.copy(this.lights.beaconB.position); this.group.add(this.beaconLight);
    this.scanLight = new THREE.SpotLight('#fff1dc', 0, 22, 0.45, 0.5, 1.2);
    this.scanLight.position.set(-2.05, 0.9, 3.5); this.scanLight.target.position.set(-8, -0.5, 9.5); this.group.add(this.scanLight, this.scanLight.target);
    this.scanLightR = this.scanLight.clone(); this.scanLightR.position.x = 2.05; this.scanLightR.target = new THREE.Object3D(); this.scanLightR.target.position.set(8, -0.5, 9.5); this.group.add(this.scanLightR, this.scanLightR.target);
    this.sun = new THREE.DirectionalLight('#ffffff', 3); this.sun.position.set(0, 50, 0); this.group.add(this.sun); this.group.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight('#bcd4ff', '#556070', 0.8); this.group.add(this.hemi);
    this.amb = new THREE.AmbientLight('#ffffff', 0.05); this.group.add(this.amb);
  }

  // Fire and smoke streaming from an engine (index 0 = left), and compressor-stall flames.
  _buildEngineFx() {
    const N = 260;
    this.fx = [];
    const tex = glowTex();
    for (const side of [-1, 1]) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({ size: 2.4, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
      const smokeMat = new THREE.PointsMaterial({ size: 5.5, map: tex, color: '#3a3a3c', transparent: true, opacity: 0.4, depthWrite: false, sizeAttenuation: true });
      const fire = new THREE.Points(geo, mat), smokeGeo = geo.clone(), smoke = new THREE.Points(smokeGeo, smokeMat);
      fire.frustumCulled = smoke.frustumCulled = false; fire.visible = smoke.visible = false;
      this.group.add(fire, smoke);
      const parts = []; for (let i = 0; i < N; i++) parts.push({ life: -1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
      const sparts = []; for (let i = 0; i < N; i++) sparts.push({ life: -1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
      this.fx.push({ side, fire, smoke, parts, sparts, fireK: 0, smokeK: 0, stall: 0, cx: side * ENGINE.x, cy: ENGINE.y, cz: ENGINE.zNozzle });
    }
  }
  setEngineFx(i, { fire, smoke, stall } = {}) { const f = this.fx[i]; if (fire != null) f.fireK = fire; if (smoke != null) f.smokeK = smoke; if (stall) f.stall = Math.max(f.stall, stall); }
  _updateEngineFx(dt, fm) {
    const pe = sharedUniforms.uPreExp.value;
    const air = Math.max(20, Math.min(fm.tas || 0, 120));
    for (const f of this.fx) {
      const fireOn = f.fireK > 0.01 || f.stall > 0;
      f.fire.visible = fireOn; f.smoke.visible = f.smokeK > 0.01 || fireOn;
      f.stall = Math.max(0, f.stall - dt);
      const emitF = (f.fireK + f.stall * 3) * 420 * dt, emitS = (f.smokeK + f.fireK * 0.8) * 110 * dt;
      let ef = emitF, es = emitS;
      const pos = f.fire.geometry.attributes.position.array, col = f.fire.geometry.attributes.color.array;
      f.parts.forEach((p, i) => {
        if (p.life <= 0 && ef > Math.random()) { ef -= 1; p.life = 0.2 + Math.random() * 0.35; p.max = p.life; p.x = f.cx + (Math.random() - 0.5) * 0.8; p.y = f.cy - 0.2 + (Math.random() - 0.5) * 0.8; p.z = f.cz - 0.6 + Math.random() * 0.8; p.vx = (Math.random() - 0.5) * 1.5; p.vy = (Math.random() - 0.2) * 1.5; p.vz = 8 + air * (0.08 + Math.random() * 0.1); }
        if (p.life > 0) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
        const k = p.life > 0 ? p.life / p.max : 0;
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.life > 0 ? p.y : -999; pos[i * 3 + 2] = p.z;
        col[i * 3] = 2.6 * k * pe; col[i * 3 + 1] = (0.45 + 1.1 * k * k) * k * pe; col[i * 3 + 2] = 0.12 * k * k * pe;
      });
      f.fire.geometry.attributes.position.needsUpdate = true; f.fire.geometry.attributes.color.needsUpdate = true;
      const sp = f.smoke.geometry.attributes.position.array;
      f.sparts.forEach((p, i) => {
        if (p.life <= 0 && es > Math.random()) { es -= 1; p.life = 2 + Math.random() * 2; p.x = f.cx + (Math.random() - 0.5) * 0.8; p.y = f.cy + (Math.random() - 0.5) * 0.8; p.z = f.cz + 1.5; p.vx = (Math.random() - 0.5) * 3; p.vy = Math.random() * 1.5; p.vz = 10 + air * (0.2 + Math.random() * 0.15); }
        if (p.life > 0) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
        sp[i * 3] = p.x; sp[i * 3 + 1] = p.life > 0 ? p.y : -999; sp[i * 3 + 2] = p.z;
      });
      f.smoke.geometry.attributes.position.needsUpdate = true;
      f.smoke.material.color.setRGB(0.23 * pe, 0.23 * pe, 0.24 * pe);
    }
  }

  // Evacuation slides: yellow inflated chutes from the four doors down to the ground.
  _buildSlides() {
    const mat = exposeMaterial(new THREE.MeshStandardMaterial({ color: '#f5c518', roughness: 0.6 }));
    this.slides = {};
    for (const [name, d] of Object.entries(DOORS)) {
      const side = d.side, z = d.z;
      const g = new THREE.Group();
      const len = 7.2, drop = 3.4;
      const bed = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, len), mat);
      const angle = Math.atan2(drop, len);
      const pivot = new THREE.Group(); pivot.add(bed);
      for (const sx of [-0.8, 0.8]) { const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, len, 10).rotateX(Math.PI / 2), mat); rail.position.set(sx, 0.15, 0); pivot.add(rail); }
      pivot.rotation.y = side * Math.PI / 2;
      g.add(pivot);
      g.position.set(side * (fusHalfWidthAt(z, 0) + len / 2 * Math.cos(angle)), -drop / 2, z);
      g.rotation.z = side * -angle;
      g.visible = false;
      this.group.add(g);
      this.slides[name] = { g, k: 0, on: false };
    }
  }
  deploySlide(name) { const s = this.slides[name]; if (s && !s.on) { s.on = true; s.k = 0; s.g.visible = true; } }
  _updateSlides(dt) { for (const s of Object.values(this.slides)) if (s.on && s.k < 1) { s.k = Math.min(1, s.k + dt / 5); const k = 1 - Math.pow(1 - s.k, 3); s.g.scale.set(Math.max(0.05, k), Math.max(0.05, k), Math.max(0.05, k)); } }

  update(dt, t, fm, env) {
    this._updateEngineFx(dt, fm);
    this._updateSlides(dt);
    const P = this.parts;
    // flaps: Fowler motion (aft, down and rotating); slats droop and extend forward
    const fk = fm.flap / 35, sk = fm.slat / 27;
    for (const f of P.flaps) this._setHinge(f.pivot, f.side * fm.flap * DEG * 0.9, 0.38 * fk, 0.06 * fk);
    for (const sl of P.slats) this._setHinge(sl.pivot, -sl.side * fm.slat * 0.85 * DEG, -0.28 * sk, 0.1 * sk);
    // spoilers: speed brake, ground spoilers, and roll spoilers on the down-going wing
    const ail = fm.ctrl ? fm.ctrl.ail : 0;
    for (const sp of P.spoilers) {
      const roll = clamp(sp.side * ail * 1.6 - 0.25, 0, 1) * 0.7;
      const k = Math.max(fm.spoiler || 0, fm.groundSpoiler || 0, roll);
      sp.k = (sp.k ?? 0) + (k - (sp.k ?? 0)) * Math.min(1, dt * 6);
      this._setHinge(sp.pivot, -sp.side * sp.k * 48 * DEG, 0, 0);
    }
    // ailerons (right aileron up for a right roll), elevators, rudder and the trimmable stabiliser
    this._ail = (this._ail || 0) + (ail - (this._ail || 0)) * Math.min(1, dt * 10);
    for (const ai of P.ailerons) this._setHinge(ai.pivot, -this._ail * 25 * DEG, 0, 0);
    const elev = fm.ctrl ? fm.ctrl.elev : 0, rud = fm.ctrl ? fm.ctrl.rud : 0;
    this._elev = (this._elev || 0) + (elev - (this._elev || 0)) * Math.min(1, dt * 10);
    for (const e of P.elevators) e.pivot.quaternion.setFromAxisAngle(e.pivot.userData.axis, e.side * this._elev * 25 * DEG);
    this._rud = (this._rud || 0) + (rud - (this._rud || 0)) * Math.min(1, dt * 10);
    this.rudder.quaternion.setFromAxisAngle(this.rudder.userData.axis, this._rud * 30 * DEG); // right rudder: trailing edge to the right
    this.ths.rotation.x = fm.ths ?? 0;                                                          // nose-up trim: leading edge down
    for (const r of P.reversers) { r.sleeve.position.z = (fm.reverse || 0) * 0.55; r.cascade.visible = (fm.reverse || 0) > 0.05; }
    const vk = (env.humidity || 0) * clamp(fm.flap / 20, 0, 1) * (fm.ias > 120 && !fm.onGround ? 1 : 0);
    for (const v of this.vortices) { v.material.opacity += ((0.22 + 0.1 * Math.sin(t * 9 + v.position.x)) * vk - v.material.opacity) * Math.min(1, dt * 3); v.visible = v.material.opacity > 0.01; }
    // undercarriage: main legs fold inboard, the nose leg forward; bay doors open while it moves
    const gk = clamp(fm.gear, 0, 1);
    for (const g of this.gear.main) { const failed = fm.gearCollapsed && fm.gearCollapsed[g.side < 0 ? 1 : 2]; g.pivot.rotation.z = -g.side * (failed ? 1 : 1 - gk) * 1.57; }
    this.gear.nose.rotation.x = (1 - gk) * 1.6;
    this.gear.drag.visible = gk > 0.35;
    const moving = gk > 0.01 && gk < 0.99;
    this._bayK = (this._bayK || 0) + ((moving ? 1 : 0) - (this._bayK || 0)) * Math.min(1, dt * 2.5);
    for (const d of this.gear.mainDoors) d.hinge.rotation.z = -d.side * this._bayK * 1.4;
    for (const d of this.gear.doors) d.hinge.rotation.z = lerp(0, d.sd * 1.35, clamp(Math.max(gk * 1.4 - 0.2, this._bayK), 0, 1));
    for (const [name, key] of [['L1', 'doorL1'], ['R1', 'doorR1'], ['L4', 'doorL4'], ['R4', 'doorR4']]) if (this.doorPlugs[name]) this.doorPlugs[name].visible = (env[key] ?? 0) < 0.02;
    // contact shadow: slides away from the sun and sharpens in direct sunlight
    this.shadow.visible = fm.onGround || fm.h < 60;
    const sl = env.sunLocal, direct = sl && sl.y > 0.08 ? clamp(env.direct ?? 1, 0, 1) : 0;
    const hgt = 3.1 + Math.max(0, fm.h);
    this.shadow.position.x = direct ? clamp(-sl.x / sl.y * hgt, -14, 14) * direct : 0;
    this.shadow.position.z = (SH_Z0 + SH_Z1) / 2 + (direct ? clamp(-sl.z / sl.y * hgt, -14, 14) * direct : 0);
    this.shadow.material.opacity = (0.34 + 0.26 * direct) * clamp(1 - fm.h / 60, 0, 1) * (0.4 + 0.6 * (1 - env.nightK));
    this.taxiLight.intensity = env.landing && fm.onGround ? 40 : 0;
    this.noseLamp.material.emissiveIntensity = this.taxiLight.intensity > 0 ? 3 : 0;
    for (const f of P.fans) { const n1 = fm.n1[f.side < 0 ? 0 : 1]; f.angle += n1 * 64 * 2 * Math.PI * dt * 0.25; f.fan.rotation.z = f.angle; }
    this.flexU.value = (fm.wingFlex ?? 0) + 0.18;
    this.flexAU.value = fm.wingTwist ?? 0;
    // lights
    const L = this.lights, nightK = env.nightK, pe = sharedUniforms.uPreExp.value;
    for (const [k, c] of [['navL', '#ff2a1a'], ['navR', '#22ff66'], ['navT', '#ffffff'], ['strobeL', '#ffffff'], ['strobeR', '#ffffff'], ['strobeT', '#ffffff'], ['beaconB', '#ff2020'], ['beaconT', '#ff2020'], ['scan', '#fff4e0']]) L[k].material.color.set(c).multiplyScalar(pe * 1.6);
    const navOn = env.nav ?? true;
    L.navL.visible = L.navR.visible = L.navT.visible = navOn;
    L.navL.material.opacity = L.navR.material.opacity = L.navT.material.opacity = 0.35 + 0.65 * nightK;
    this.navLightL.intensity = this.navLightR.intensity = navOn ? 0.8 * nightK : 0;
    const ph = t % 1.2;
    const flash = env.strobes && (ph < 0.05 || (ph > 0.13 && ph < 0.18));
    L.strobeL.visible = L.strobeR.visible = L.strobeT.visible = flash;
    L.strobeL.material.opacity = L.strobeR.material.opacity = L.strobeT.material.opacity = 0.6 + 0.4 * nightK;
    this.strobeLight.intensity = flash ? 30 * (0.2 + nightK) : 0;
    this.strobeLight.position.copy(ph < 0.09 ? L.strobeL.position : L.strobeR.position);
    const bph = (t + 0.4) % 1.1;
    const bOn = env.beacon && bph < 0.12;
    L.beaconB.visible = L.beaconT.visible = bOn; this.beaconLight.intensity = bOn ? 8 * (0.15 + nightK) : 0;
    this.cabinGlow.emissiveIntensity = 0.55 * (env.cabinLight ?? 1) * clamp(nightK * 1.3, 0, 1);
    const logoOn = !env.logoOff && (fm.onGround || fm.slat > 1);
    this.finMat.emissiveIntensity += ((logoOn ? 0.45 * clamp(nightK * 1.4, 0, 1) : 0) - this.finMat.emissiveIntensity) * Math.min(1, dt * 8);
    const scanOn = env.scan && nightK > 0.3;
    this.scanLight.intensity = this.scanLightR.intensity = scanOn ? 60 : 0;
    L.scan.visible = scanOn;
  }
}

