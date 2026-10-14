/**
 * The faces of the time machine's instruments, drawn on canvases:
 *
 *  - the time circuits: three rows, each a silver plate with red tags (MONTH DAY YEAR HOUR MIN)
 *    over black windows of segment displays (fourteen-segment letters for the month, seven-
 *    segment digits), AM and PM lamps, the blinking colon, and a black strip with the row's
 *    name: DESTINATION TIME in red, PRESENT TIME in green, LAST TIME DEPARTED in amber
 *    (as on the prop in the Universal and Petersen cars: Wikimedia Commons photographs). The
 *    unlit segments show faintly through the filter, as on the real displays.
 *  - the digital speedometer on top of the dash (red seven-segment digits),
 *  - the DMC-12's own dials: the 85 mph speedometer (the US limit of the time), the tach to
 *    7000 rpm red from 6500, temperature, fuel ("UNLEADED FUEL ONLY"), voltage, oil pressure,
 *  - Doc's meters on the passenger side: PRIMARY, PERCENT POWER, and the plutonium chamber's
 *    ROENTGENS meter.
 *
 * Each display has a base map (what it looks like unlit) and an emissive map (what glows).
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, ClampToEdgeWrapping } from 'three';
import { canvas, gaugeFace } from './textures.js';

function texOf(c) {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------------------------
// segments

const SEG7 = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', ' ': '', '-': 'g' };
const SEG14 = {
  A: 'a b c e f g1 g2', B: 'a b c d i l g2', C: 'a d e f', D: 'a b c d i l', E: 'a d e f g1 g2', F: 'a e f g1',
  G: 'a c d e f g2', J: 'b c d e', L: 'd e f', M: 'b c e f h j', N: 'b c e f h m', O: 'a b c d e f',
  P: 'a b e f g1 g2', R: 'a b e f g1 g2 m', S: 'a c d f g1 g2', T: 'a i l', U: 'b c d e f', V: 'e f k j', Y: 'h j l', ' ': '',
  0: 'a b c d e f', 1: 'b c', 2: 'a b g1 g2 e d', 3: 'a b g2 c d', 4: 'f g1 g2 b c', 5: 'a f g1 g2 c d', 6: 'a f g1 g2 e c d', 7: 'a b c', 8: 'a b c d e f g1 g2', 9: 'a b c d f g1 g2',
};

/** Paths of the segments of a character cell (x, y top-left, w x h), slanted like the real ones. */
function segPaths(x, y, w, h, fourteen) {
  const t = Math.max(3, w * 0.13), sl = w * 0.08;     // stroke, slant
  const X = (u, v) => [x + u * w + (1 - v) * sl, y + v * h];
  const bar = (u0, v0, u1, v1) => {
    // a hexagonal bar from (u0, v0) to (u1, v1) in cell units
    const [ax, ay] = X(u0, v0), [bx, by] = X(u1, v1);
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L * t / 2, ny = dx / L * t / 2, ex = dx / L * t * 0.5, ey = dy / L * t * 0.5;
    return [[ax + ex * 0.2, ay + ey * 0.2], [ax + ex + nx, ay + ey + ny], [bx - ex + nx, by - ey + ny], [bx - ex * 0.2, by - ey * 0.2], [bx - ex - nx, by - ey - ny], [ax + ex - nx, ay + ey - ny]];
  };
  const p = {
    a: bar(0.08, 0.04, 0.92, 0.04), d: bar(0.08, 0.96, 0.92, 0.96),
    f: bar(0.04, 0.08, 0.04, 0.48), e: bar(0.04, 0.52, 0.04, 0.92),
    b: bar(0.96, 0.08, 0.96, 0.48), c: bar(0.96, 0.52, 0.96, 0.92),
    g: bar(0.08, 0.5, 0.92, 0.5),
  };
  if (fourteen) {
    Object.assign(p, {
      g1: bar(0.08, 0.5, 0.47, 0.5), g2: bar(0.53, 0.5, 0.92, 0.5),
      i: bar(0.5, 0.1, 0.5, 0.46), l: bar(0.5, 0.54, 0.5, 0.9),
      h: bar(0.14, 0.12, 0.44, 0.44), j: bar(0.86, 0.12, 0.56, 0.44),
      k: bar(0.44, 0.56, 0.14, 0.88), m: bar(0.56, 0.56, 0.86, 0.88),
    });
  }
  return p;
}

function drawChar(g, ch, x, y, w, h, color, ghost, fourteen) {
  const p = segPaths(x, y, w, h, fourteen);
  const on = new Set((fourteen ? SEG14[ch] ?? '' : SEG7[ch] ?? '').split(fourteen ? ' ' : ''));
  for (const [k, poly] of Object.entries(p)) {
    if (fourteen && k === 'g') continue;
    const lit = on.has(k);
    if (!lit && !ghost) continue;
    g.fillStyle = lit ? color : ghost;
    g.beginPath(); poly.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.fill();
  }
}

// ---------------------------------------------------------------------------------------------
// the time circuits

export const TC_ROWS = [
  { name: 'DESTINATION TIME', lit: '#ff3322', ghost: 'rgba(120,10,6,0.55)', glow: [1.0, 0.12, 0.06] },
  { name: 'PRESENT TIME', lit: '#4dff7a', ghost: 'rgba(10,80,26,0.55)', glow: [0.2, 1.0, 0.35] },
  { name: 'LAST TIME DEPARTED', lit: '#ffb01e', ghost: 'rgba(110,64,6,0.55)', glow: [1.0, 0.62, 0.08] },
];
export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const W = 1024, H = 256;
// field layout of a row (px): [x, characters, cell width, label]
const FIELDS = { month: [36, 3, 60, 'MONTH'], day: [262, 2, 54, 'DAY'], year: [404, 4, 54, 'YEAR'], hour: [716, 2, 54, 'HOUR'], min: [870, 2, 54, 'MIN'] };
const DIG_Y = 72, DIG_H = 98;

function drawPlate(g, row) {
  // brushed aluminium
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#c9ccd0'); grd.addColorStop(0.5, '#aeb2b6'); grd.addColorStop(1, '#bfc2c6');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(0, Math.random() * H, W, 1); }
  for (const [x, n, cw, label] of Object.values(FIELDS)) {
    const fw = n * cw + 18;
    // the red tag above the window, white letters
    g.fillStyle = '#c4161c'; g.fillRect(x + fw / 2 - 52, 18, 104, 36);
    g.fillStyle = '#fff'; g.font = 'bold 26px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, x + fw / 2, 37);
    // the window
    g.fillStyle = '#060606'; g.fillRect(x, DIG_Y - 8, fw, DIG_H + 16);
  }
  // AM / PM lamps with their labels
  g.fillStyle = '#c4161c'; g.font = 'bold 20px Arial, sans-serif'; g.textAlign = 'center';
  g.fillText('AM', 676, 92); g.fillText('PM', 676, 150);
  g.fillStyle = '#1a0a08'; for (const y of [114, 172]) { g.beginPath(); g.arc(676, y, 9, 0, 7); g.fill(); }
  // the colon's dots
  for (const y of [112, 148]) { g.beginPath(); g.arc(848, y, 7, 0, 7); g.fill(); }
  // the name strip
  g.fillStyle = '#0a0a0a'; g.fillRect(W / 2 - 230, 196, 460, 46);
  g.fillStyle = '#f2f0ea'; g.font = 'bold 30px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(row.name, W / 2, 220);
}

/**
 * The three rows of the time circuits. set(i, t, { on, colon }) with t = { y, mo, d, h, mi }.
 * base[i] / glow[i] are the textures of row i.
 */
export class TimeCircuitsFace {
  constructor() {
    this.base = []; this.glow = []; this._g = []; this._key = [];
    TC_ROWS.forEach((row, i) => {
      const cb = canvas(W, H), gb = cb.getContext('2d');
      drawPlate(gb, row);
      // the ghost segments in every window
      for (const [key, [x, n, cw]] of Object.entries(FIELDS)) for (let k = 0; k < n; k++) drawChar(gb, '8', x + 9 + k * cw, DIG_Y, cw - 10, DIG_H, row.ghost, null, key === 'month');
      for (const [x, n, cw] of [FIELDS.month]) for (let k = 0; k < n; k++) drawChar(gb, 'M', x + 9 + k * cw, DIG_Y, cw - 10, DIG_H, row.ghost, row.ghost, true);
      this.base.push(texOf(cb));
      const ce = canvas(W, H);
      this._g.push(ce.getContext('2d'));
      this.glow.push(texOf(ce));
      this._key.push(null);
    });
  }

  set(i, t, { on = true, colon = true } = {}) {
    const key = on && t ? `${t.y}|${t.mo}|${t.d}|${t.h}|${t.mi}|${colon}` : 'off';
    if (key === this._key[i]) return;
    this._key[i] = key;
    const g = this._g[i], row = TC_ROWS[i];
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    if (on && t) {
      const h12 = ((t.h + 11) % 12) + 1, pm = t.h >= 12;
      const fields = {
        month: MONTHS[t.mo - 1] ?? '   ', day: String(t.d).padStart(2, '0'), year: String(t.y).padStart(4, '0'),
        hour: String(h12).padStart(2, '0'), min: String(t.mi).padStart(2, '0'),
      };
      g.shadowColor = row.lit; g.shadowBlur = 10;
      for (const [key, [x, n, cw]] of Object.entries(FIELDS)) {
        const s = fields[key];
        for (let k = 0; k < n; k++) drawChar(g, s[k] ?? ' ', x + 9 + k * cw, DIG_Y, cw - 10, DIG_H, row.lit, null, key === 'month');
      }
      g.fillStyle = row.lit;
      g.beginPath(); g.arc(676, pm ? 172 : 114, 9, 0, 7); g.fill();
      if (colon) for (const y of [112, 148]) { g.beginPath(); g.arc(848, y, 7, 0, 7); g.fill(); }
      g.shadowBlur = 0;
    }
    this.glow[i].needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------
// the digital speedometer on the dash: a white box, red digits

export class SpeedoFace {
  constructor() {
    this.cb = canvas(256, 128);
    const g = this.cb.getContext('2d');
    g.fillStyle = '#e9e7e1'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#c4161c'; g.font = 'bold 18px Arial, sans-serif'; g.textAlign = 'center';
    g.fillText('MPH', 46, 104);
    g.fillStyle = '#100404'; g.fillRect(96, 14, 148, 100);
    for (let k = 0; k < 2; k++) drawChar(g, '8', 106 + k * 68, 22, 58, 84, 'rgba(90,8,4,0.6)', null, false);
    this.base = texOf(this.cb);
    this.ce = canvas(256, 128);
    this.ge = this.ce.getContext('2d');
    this.glow = texOf(this.ce);
    this._v = null;
  }
  set(mph, on = true) {
    const v = on ? Math.max(0, Math.min(99, Math.floor(mph))) : -1;
    if (v === this._v) return;
    this._v = v;
    const g = this.ge;
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 128);
    if (v >= 0) {
      const s = String(v).padStart(2, ' ');
      g.shadowColor = '#ff2a1a'; g.shadowBlur = 12;
      for (let k = 0; k < 2; k++) drawChar(g, s[k], 106 + k * 68, 22, 58, 84, '#ff3322', null, false);
      g.shadowBlur = 0;
    }
    this.glow.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------
// dials

export function dmcDials() {
  return {
    speedo: texOf(gaugeFace({ min: 0, max: 85, major: 10, minor: 5, a0: -130, a1: 130, title: 'MPH', sub: 'km/h', labelScale: 1.1 }).image),
    tach: texOf(gaugeFace({ min: 0, max: 7, major: 1, minor: 0.5, a0: -130, a1: 130, title: 'RPM x 1000', redFrom: 6.5, labelScale: 1.2 }).image),
    temp: texOf(gaugeFace({ min: 100, max: 260, major: 80, minor: 20, a0: -60, a1: 60, title: 'TEMP', digits: (v) => `${v}` }).image),
    fuel: texOf(gaugeFace({ min: 0, max: 4, major: 2, minor: 1, a0: -60, a1: 60, title: 'FUEL', sub: 'UNLEADED FUEL ONLY', digits: (v) => (v === 0 ? 'E' : v === 2 ? '1/2' : 'F') }).image),
    volt: texOf(gaugeFace({ min: 10, max: 16, major: 2, minor: 1, a0: -60, a1: 60, title: 'VOLTS' }).image),
    oil: texOf(gaugeFace({ min: 0, max: 80, major: 40, minor: 10, a0: -60, a1: 60, title: 'OIL', sub: 'PSI' }).image),
    // Doc's: white faces
    primary: texOf(gaugeFace({ min: 0, max: 100, major: 20, minor: 10, a0: -50, a1: 50, title: 'PRIMARY', face: '#ecebe4', ink: '#141414' }).image),
    power: texOf(gaugeFace({ min: 0, max: 100, major: 20, minor: 10, a0: -50, a1: 50, title: 'PERCENT', sub: 'POWER', face: '#ecebe4', ink: '#141414' }).image),
  };
}

/** The plutonium chamber's meter: a rectangular white face, ROENTGENS, an arc of ticks. */
export function roentgenFace() {
  const c = canvas(512, 384), g = c.getContext('2d');
  g.fillStyle = '#ecebe4'; g.fillRect(0, 0, 512, 384);
  g.strokeStyle = '#141414'; g.fillStyle = '#141414';
  const cx = 256, cy = 330, R = 250;
  for (let k = 0; k <= 20; k++) {
    const a = (-50 + k * 5 - 90) * Math.PI / 180, major = k % 5 === 0;
    g.lineWidth = major ? 4 : 2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * R * (major ? 0.8 : 0.86), cy + Math.sin(a) * R * (major ? 0.8 : 0.86)); g.lineTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92); g.stroke();
    if (major) { g.font = '26px Arial, sans-serif'; g.textAlign = 'center'; g.fillText(String(k * 5), cx + Math.cos(a) * R * 0.68, cy + Math.sin(a) * R * 0.68 + 8); }
  }
  g.fillStyle = '#c4161c'; g.beginPath(); g.arc(cx, cy, R * 0.92, (-90 + 30) * Math.PI / 180, (-90 + 50) * Math.PI / 180); g.lineTo(cx, cy); g.fill();
  g.fillStyle = '#141414'; g.font = 'bold 34px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('ROENTGENS', cx, 250);
  return texOf(c);
}

/** Black plates with white or red lettering (labels on Doc's panels). */
export function plateLabel(text, { w = 512, h = 96, bg = '#0b0b0c', fg = '#f1efe9', size = 44 } = {}) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = `bold ${size}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  return texOf(c);
}
