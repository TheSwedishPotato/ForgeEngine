// Procedural canvas textures: upholstery, carpet, panels, placards, faces, clouds.
import * as THREE from 'three';
import { rng } from './core.js';

export let MAX_ANISO = 4;
export function setMaxAniso(a) { MAX_ANISO = a; }

export function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
export function canvasTex(w, h, draw, { repeat = false, srgb = true, aniso = true, mips = true } = {}) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (aniso) t.anisotropy = MAX_ANISO;
  if (!mips) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  return t;
}

function noiseFill(g, w, h, base, amp, seed, scale = 1) {
  const img = g.getImageData(0, 0, w, h); const d = img.data; const r = rng(seed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amp;
    d[i] = Math.max(0, Math.min(255, (base[0] + n) * scale));
    d[i + 1] = Math.max(0, Math.min(255, (base[1] + n) * scale));
    d[i + 2] = Math.max(0, Math.min(255, (base[2] + n) * scale));
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

export function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}

// rounded rectangle with elliptical corners (rx, ry in px)
export function rre(g, x, y, w, h, rx, ry) {
  rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
  g.beginPath();
  g.moveTo(x + rx, y); g.lineTo(x + w - rx, y); g.ellipse(x + w - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0);
  g.lineTo(x + w, y + h - ry); g.ellipse(x + w - rx, y + h - ry, rx, ry, 0, 0, Math.PI / 2);
  g.lineTo(x + rx, y + h); g.ellipse(x + rx, y + h - ry, rx, ry, 0, Math.PI / 2, Math.PI);
  g.lineTo(x, y + ry); g.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 1.5); g.closePath();
}

const cache = {};
const once = (k, f) => cache[k] || (cache[k] = f());

// Woven upholstery: white-ish weave; tinted by vertex colours. Top-right 16px is flat white.
export const fabricTex = () => once('fabric', () => canvasTex(256, 256, (g, w, h) => {
  noiseFill(g, w, h, [226, 226, 226], 40, 3);
  g.globalAlpha = 0.18;
  for (let y = 0; y < h; y += 2) { g.fillStyle = y % 4 ? '#fff' : '#9a9a9a'; g.fillRect(0, y, w, 1); }
  for (let x = 0; x < w; x += 3) { g.fillStyle = x % 6 ? '#fff' : '#a0a0a0'; g.fillRect(x, 0, 1, h); }
  g.globalAlpha = 1; g.fillStyle = '#ffffff'; g.fillRect(w - 16, 0, 16, 16);
}, { repeat: true }));
export const FLAT_UV = [0.985, 0.985];

export const carpetTex = () => once('carpet', () => canvasTex(512, 512, (g, w, h) => {
  noiseFill(g, w, h, [52, 62, 84], 26, 7);
  const r = rng(11);
  g.globalAlpha = 0.25;
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = r() < 0.5 ? '#6f7fa3' : '#27304a';
    g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2);
  }
  g.globalAlpha = 0.14; g.strokeStyle = '#8fa2c9'; g.lineWidth = 2;
  for (let y = 32; y < h; y += 64) { g.beginPath(); for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * 0.05) * 6); g.stroke(); }
  g.globalAlpha = 1;
}, { repeat: true }));

export const plasticTex = () => once('plastic', () => canvasTex(256, 256, (g, w, h) => {
  noiseFill(g, w, h, [236, 236, 233], 10, 5);
}, { repeat: true }));

// Grained sidewall with window/door holes drawn into an alpha map.
export function sidewallTextures(lenPx, arcPx, holes) {
  const color = canvasTex(1024, 256, (g, w, h) => {
    noiseFill(g, w, h, [233, 233, 229], 8, 21);
    g.fillStyle = 'rgba(0,0,0,0.05)';
    for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 1, h); // panel joints
    g.fillStyle = 'rgba(80,90,110,0.16)'; g.fillRect(0, h * 0.84, w, h * 0.16); // dado
    g.fillStyle = 'rgba(0,0,0,0.14)';
    for (let x = 6; x < w; x += 16) g.fillRect(x, h * 0.9, 8, h * 0.05); // air return grille
  }, { repeat: true });
  const alpha = canvasTex(lenPx, arcPx, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#000';
    for (const o of holes) { rre(g, o.u0 * w, (1 - o.v1) * h, (o.u1 - o.u0) * w, (o.v1 - o.v0) * h, o.rx * w, o.ry * h); g.fill(); }
  }, { srgb: false, aniso: true });
  return { color, alpha };
}

export const binTex = () => once('bin', () => canvasTex(512, 128, (g, w, h) => {
  noiseFill(g, w, h, [238, 238, 235], 6, 31);
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, h - 5, w, 5);
  // latch
  rr(g, w / 2 - 50, h * 0.12, 100, 20, 8); g.fillStyle = '#c9ccd2'; g.fill();
  g.fillStyle = '#7f858f'; rr(g, w / 2 - 40, h * 0.15, 80, 10, 5); g.fill();
}));

export const ceilingTex = () => once('ceiling', () => canvasTex(512, 256, (g, w, h) => {
  noiseFill(g, w, h, [244, 244, 242], 5, 41);
  g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, 0, w, 2); g.fillRect(0, h / 2, w, 1);
  g.fillStyle = 'rgba(0,0,0,0.10)';
  for (let i = 0; i < 12; i++) for (let j = 0; j < 4; j++) { g.beginPath(); g.arc(w * 0.47 + i * 4, h * 0.25 + j * 4, 1.2, 0, 7); g.fill(); }
}, { repeat: true }));

// Passenger service unit strip under the bins, row labels drawn at their positions.
export function psuTexture(lenPx, rows, zA, zB, side) {
  return canvasTex(lenPx, 128, (g, w, h) => {
    noiseFill(g, w, h, [226, 227, 229], 6, 51);
    const zx = (z) => (z - zA) / (zB - zA) * w;
    for (const r of rows) {
      const x = zx(r.z);
      // reading lights & call button (closest to aisle = top of texture)
      g.fillStyle = '#d6d8dc'; rr(g, x - 38, 10, 76, 46, 8); g.fill();
      g.fillStyle = '#8b9099';
      for (let k = -1; k <= 1; k++) { g.beginPath(); g.arc(x + k * 22, 24, 7, 0, 7); g.fill(); }
      g.fillStyle = '#b3b8c0'; for (let k = -1; k <= 1; k++) { g.beginPath(); g.arc(x + k * 22, 44, 4, 0, 7); g.fill(); }
      // gaspers
      g.fillStyle = '#9ca1aa'; for (let k = -1; k <= 1; k++) { g.beginPath(); g.arc(x + k * 22, 80, 8, 0, 7); g.fill(); g.fillStyle = '#5d626b'; g.beginPath(); g.arc(x + k * 22, 80, 3, 0, 7); g.fill(); g.fillStyle = '#9ca1aa'; }
      // row label
      g.save(); g.translate(x, 118); g.scale(-1, 1);
      g.fillStyle = '#394150'; g.font = 'bold 22px Arial, sans-serif'; g.textAlign = 'center';
      g.fillText(`${r.row}  ${side === 'L' ? 'ABC' : 'DEF'}`, 0, 0); g.restore();
      // oxygen door seam
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.strokeRect(x - 70, 58, 140, 40);
    }
  });
}

export function signTexture(kind) {
  return once('sign-' + kind, () => canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#1b1d22'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.lineCap = 'round';
    if (kind === 'belt') {
      // seatbelt pictogram
      rr(g, 38, 22, 52, 22, 6); g.lineWidth = 4; g.stroke();
      g.fillRect(56, 27, 16, 12);
      g.beginPath(); g.moveTo(10, 33); g.lineTo(38, 33); g.moveTo(90, 33); g.lineTo(118, 33); g.stroke();
    } else if (kind === 'nosmoke') {
      g.lineWidth = 4; g.beginPath(); g.arc(64, 32, 24, 0, 7); g.stroke();
      g.fillRect(44, 30, 34, 8); g.fillRect(80, 30, 4, 8);
      g.beginPath(); g.moveTo(47, 15); g.lineTo(81, 49); g.stroke();
    } else if (kind === 'lav') {
      g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.fillText('WC', 64, 44);
    }
  }));
}

export function exitSignTexture() {
  return once('exit', () => canvasTex(256, 96, (g, w, h) => {
    g.fillStyle = '#0d8f4c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = 'bold 54px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('EXIT', w / 2 + 26, h / 2 + 2);
    // running man
    g.strokeStyle = '#fff'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.arc(36, 22, 7, 0, 7); g.fill();
    g.beginPath(); g.moveTo(34, 32); g.lineTo(28, 56); g.lineTo(40, 72); g.moveTo(28, 56); g.lineTo(16, 70);
    g.moveTo(33, 38); g.lineTo(48, 46); g.moveTo(33, 38); g.lineTo(20, 44); g.stroke();
  }));
}

export function placardTexture(lines, { bg = '#f4f1e8', fg = '#16233f', w = 256, h = 128, font = 'bold 22px Arial', accent } = {}) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (accent) { g.fillStyle = accent; g.fillRect(0, 0, w, 10); }
    g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (parseInt(font.match(/(\d+)px/)[1]) * 1.2)));
  });
}

export const seatBackTex = () => once('seatback', () => canvasTex(256, 512, (g, w, h) => {
  noiseFill(g, w, h, [205, 208, 212], 8, 61);
  // tray table outline
  g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 3; rr(g, 26, 150, w - 52, 190, 18); g.stroke();
  g.fillStyle = '#8f949c'; rr(g, w / 2 - 22, 136, 44, 14, 5); g.fill(); // latch
  // literature pocket
  g.fillStyle = 'rgba(40,45,55,0.55)'; rr(g, 30, 372, w - 60, 90, 10); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(40, 380, w - 80, 4);
  // USB-C with blue ring
  g.fillStyle = '#23262b'; rr(g, w - 56, 100, 26, 12, 5); g.fill();
  g.strokeStyle = '#3a8cff'; g.lineWidth = 2; rr(g, w - 58, 98, 30, 16, 6); g.stroke();
  // placard
  g.fillStyle = '#2b3140'; g.font = 'bold 13px Arial'; g.textAlign = 'center';
  g.fillText('FASTEN SEAT BELT WHILE SEATED', w / 2, 300);
}));

export const trayTex = () => once('tray', () => canvasTex(256, 160, (g, w, h) => {
  noiseFill(g, w, h, [214, 216, 219], 8, 71);
  g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = 3; g.beginPath(); g.arc(200, 60, 26, 0, 7); g.stroke(); // cup holder
  g.fillStyle = '#39414f'; g.font = 'bold 12px Arial'; g.textAlign = 'center';
  g.fillText('FASTEN SEAT BELT WHILE SEATED', w / 2, h - 16);
}));

export const metalTex = () => once('metal', () => canvasTex(256, 256, (g, w, h) => {
  noiseFill(g, w, h, [190, 193, 198], 18, 81);
  g.globalAlpha = 0.15; for (let y = 0; y < h; y++) { g.fillStyle = y % 2 ? '#fff' : '#777'; g.fillRect(0, y, w, 1); }
  g.globalAlpha = 1;
}, { repeat: true }));

export const galleyTex = () => once('galley', () => canvasTex(512, 512, (g, w, h) => {
  noiseFill(g, w, h, [178, 182, 188], 16, 91);
  // cart bays and ovens
  g.strokeStyle = 'rgba(30,35,45,0.6)'; g.lineWidth = 3;
  for (let i = 0; i < 3; i++) { g.strokeRect(12 + i * 166, 300, 150, 200); g.fillStyle = '#9aa1ab'; g.fillRect(40 + i * 166, 390, 90, 10); g.fillStyle = '#24304f'; g.fillRect(12 + i * 166, 300, 150, 16); }
  for (let i = 0; i < 4; i++) { g.strokeRect(12 + i * 124, 40, 112, 100); g.fillStyle = '#20242b'; g.fillRect(24 + i * 124, 54, 88, 60); }
  for (let i = 0; i < 6; i++) { g.strokeRect(12 + i * 82, 160, 72, 110); g.fillStyle = '#ccd0d6'; g.fillRect(40 + i * 82, 205, 16, 16); }
  g.fillStyle = '#2b3342'; g.font = 'bold 16px Arial'; g.fillText('COFFEE', 30, 34); g.fillText('OVEN 1', 150, 34);
}));

export const lavDoorTex = () => once('lavdoor', () => canvasTex(256, 512, (g, w, h) => {
  noiseFill(g, w, h, [226, 227, 224], 6, 101);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3; g.strokeRect(6, 6, w - 12, h - 12);
  g.beginPath(); g.moveTo(w / 2, 8); g.lineTo(w / 2, h - 8); g.stroke(); // bifold
  g.fillStyle = '#20242c'; g.font = 'bold 36px Arial'; g.textAlign = 'center'; g.fillText('WC', w / 2 + 60, 110);
  g.fillStyle = '#9aa0a8'; rr(g, w / 2 + 20, 240, 60, 22, 8); g.fill();
  g.font = 'bold 14px Arial'; g.fillText('NO SMOKING', w / 2 + 60, 150);
}));

export const doorTex = () => once('door', () => canvasTex(256, 512, (g, w, h) => {
  noiseFill(g, w, h, [228, 229, 226], 6, 111);
  g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 4; rr(g, 8, 8, w - 16, h - 16, 24); g.stroke();
  g.fillStyle = '#b8bcc3'; rr(g, w * 0.3, h * 0.46, w * 0.4, 30, 10); g.fill(); // handle
  g.fillStyle = '#c93b2e'; g.fillRect(w * 0.12, h * 0.62, w * 0.76, 10); // girt bar indicator
  g.fillStyle = '#1b2438'; g.font = 'bold 16px Arial'; g.textAlign = 'center';
  g.fillText('EMERGENCY OPERATION', w / 2, h * 0.72); g.fillText('LIFT HANDLE FULLY', w / 2, h * 0.76);
  g.fillStyle = '#1e7c3b'; g.fillRect(w * 0.7, h * 0.52, 30, 18);
}));

export const hatchTex = () => once('hatch', () => canvasTex(256, 512, (g, w, h) => {
  noiseFill(g, w, h, [230, 230, 227], 6, 121);
  g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 4; rr(g, 6, 6, w - 12, h - 12, 30); g.stroke();
  g.fillStyle = '#b3261e'; rr(g, w * 0.34, 30, w * 0.32, 40, 10); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 14px Arial'; g.textAlign = 'center'; g.fillText('PULL', w / 2, 56);
  g.fillStyle = '#b3261e'; g.font = 'bold 18px Arial'; g.fillText('EMERGENCY EXIT', w / 2, 100);
  g.fillStyle = '#1d2433'; g.font = '13px Arial'; g.fillText('1. PULL HANDLE  2. THROW OUT', w / 2, 122);
}));

// ---------------- faces ----------------
export function faceTexture(skin, { female = false, age = 35, eye = '#3b5a7a', seed = 1, beard = null, lipstick = false, freckles = false } = {}) {
  const key = `face-${skin}-${female}-${age > 55 ? 'o' : 'y'}-${eye}-${beard}-${lipstick}-${freckles}-${seed % 3}`;
  return once(key, () => canvasTex(256, 128, (g, w, h) => {
    // u in [0,1] wraps around the head; the face is centred at u=0.5 (front, +z).
    g.fillStyle = skin; g.fillRect(0, 0, w, h);
    const r = rng(seed);
    const img = g.getImageData(0, 0, w, h); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    const cx = w * 0.5, ey = h * 0.44;
    // cheeks
    g.fillStyle = 'rgba(210,90,90,0.10)';
    g.beginPath(); g.ellipse(cx - 22, h * 0.6, 10, 7, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(cx + 22, h * 0.6, 10, 7, 0, 0, 7); g.fill();
    // eye sockets shading
    g.fillStyle = 'rgba(60,30,20,0.10)';
    g.beginPath(); g.ellipse(cx - 13, ey, 9, 6, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(cx + 13, ey, 9, 6, 0, 0, 7); g.fill();
    for (const s of [-1, 1]) {
      const ex = cx + s * 13;
      g.fillStyle = '#f4f1ec'; g.beginPath(); g.ellipse(ex, ey, 6, 3.2, 0, 0, 7); g.fill();
      g.fillStyle = eye; g.beginPath(); g.arc(ex, ey, 2.8, 0, 7); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.arc(ex, ey, 1.3, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(ex + 0.6, ey - 1.6, 1, 1);
      g.strokeStyle = 'rgba(30,20,15,0.8)'; g.lineWidth = female ? 1.6 : 1.1; g.beginPath(); g.ellipse(ex, ey, 6, 3.2, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      // brows
      g.strokeStyle = beard || (female ? 'rgba(70,45,30,0.75)' : 'rgba(60,40,28,0.9)'); g.lineWidth = female ? 1.6 : 2.4;
      g.beginPath(); g.moveTo(ex - 7, ey - 7); g.quadraticCurveTo(ex, ey - 10, ex + 7, ey - 7 + s * 0.5); g.stroke();
      if (age > 50) { g.strokeStyle = 'rgba(80,50,40,0.25)'; g.lineWidth = 1; g.beginPath(); g.moveTo(ex + s * 8, ey + 1); g.lineTo(ex + s * 11, ey + 4); g.stroke(); }
    }
    // nose shading
    g.strokeStyle = 'rgba(90,50,40,0.25)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx - 2, ey + 4); g.quadraticCurveTo(cx - 5, h * 0.62, cx - 4, h * 0.64); g.stroke();
    g.fillStyle = 'rgba(80,40,30,0.3)'; g.beginPath(); g.ellipse(cx - 3, h * 0.655, 1.8, 1, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(cx + 3, h * 0.655, 1.8, 1, 0, 0, 7); g.fill();
    // mouth
    g.fillStyle = lipstick ? '#b23a48' : 'rgba(160,80,75,0.85)';
    g.beginPath(); g.ellipse(cx, h * 0.76, 7.5, 2.2, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(70,25,25,0.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 7.5, h * 0.76); g.quadraticCurveTo(cx, h * 0.77, cx + 7.5, h * 0.76); g.stroke();
    if (freckles) { g.fillStyle = 'rgba(140,80,50,0.35)'; for (let i = 0; i < 30; i++) g.fillRect(cx - 25 + r() * 50, h * 0.5 + r() * 14, 1, 1); }
    if (beard) {
      g.fillStyle = beard; g.globalAlpha = 0.85;
      g.beginPath(); g.moveTo(cx - 30, h * 0.6); g.quadraticCurveTo(cx, h * 1.02, cx + 30, h * 0.6); g.lineTo(cx + 26, h * 0.9); g.lineTo(cx - 26, h * 0.9); g.fill();
      g.beginPath(); g.ellipse(cx, h * 0.71, 11, 3, 0, 0, 7); g.fill();
      g.globalAlpha = 1; g.fillStyle = lipstick ? '#b23a48' : 'rgba(150,75,70,0.9)'; g.beginPath(); g.ellipse(cx, h * 0.765, 6, 1.8, 0, 0, 7); g.fill();
    }
  }));
}

// Soft cloud puff sprites (2x2 atlas).
export const cloudTex = () => once('cloud', () => {
  const S = 512, c = makeCanvas(S, S), g = c.getContext('2d');
  const img = g.createImageData(S, S); const d = img.data;
  const r = rng(77);
  const perm = new Float32Array(64 * 64).map(() => r());
  const vn = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const a = perm[(ix & 63) + (iy & 63) * 64], b = perm[((ix + 1) & 63) + (iy & 63) * 64], c2 = perm[(ix & 63) + ((iy + 1) & 63) * 64], d2 = perm[((ix + 1) & 63) + ((iy + 1) & 63) * 64];
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * ux + (c2 - a) * uy + (a - b - c2 + d2) * ux * uy;
  };
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * 256, oy = Math.floor(q / 2) * 256;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const nx = (x - 128) / 128, ny = (y - 128) / 128;
      const rad = Math.sqrt(nx * nx + ny * ny);
      let n = 0, amp = 0.5, f = 3 + q;
      for (let o = 0; o < 5; o++) { n += amp * vn(x / 256 * f + q * 17, y / 256 * f + q * 29); f *= 2; amp *= 0.5; }
      let a = Math.max(0, 1 - rad * (1.05 + (0.5 - n) * 0.9));
      a = Math.pow(a, 1.25);
      const i = ((oy + y) * S + ox + x) * 4;
      const shade = 0.78 + 0.22 * (1 - (ny + 1) / 2) + (n - 0.5) * 0.25;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, shade * 255));
      d[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
});

export const glowTex = () => once('glow', () => canvasTex(64, 64, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.8)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}, { srgb: false }));
