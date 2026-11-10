/**
 * The instrument panel's artwork: every dial face, scale, coloured arc, placard and label, painted once into a 4096-pixel
 * texture from the same tables the needles use, so a needle always points at the number the simulation means.
 *
 * Markings are the 172P's: airspeed white arc 33-85, green 44-127, yellow 127-158, red line 158 KIAS; tachometer green arc
 * 2100-2700 with the red line at 2700; oil temperature green 100-245 F; oil pressure red lines at 20 and 115 psi, green 60-90;
 * suction green 4.5-5.4 in Hg.
 */
import { paint } from './build.js';

export const PANEL = { x0: -0.53, x1: 0.53, y0: 0.98, y1: 1.42, z: 0.43, S: 4096 / 1.06 };
const { S } = PANEL;
const X = (u) => (u - PANEL.x0) * S, Y = (v) => (PANEL.y1 - v) * S, D = Math.PI / 180;

/** Angle (degrees clockwise from 12 o'clock) for a value on a dial's scale: piecewise linear between the calibration points. */
export function dialAngle(scale, v) {
  const n = scale.length;
  if (v <= scale[0][0]) return scale[0][1];
  if (v >= scale[n - 1][0]) return scale[n - 1][1];
  let i = 1; while (scale[i][0] < v) i++;
  return scale[i - 1][1] + (scale[i][1] - scale[i - 1][1]) * (v - scale[i - 1][0]) / (scale[i][0] - scale[i - 1][0]);
}

const range = (a, b, s) => { const o = []; for (let v = a; v <= b + 1e-9; v += s) o.push(+v.toFixed(6)); return o; };
export const DIALS = {
  asi: { x: -0.365, y: 1.335, r: 0.041, scale: [[0, 0], [40, 32], [60, 70], [80, 115], [100, 160], [120, 200], [140, 238], [160, 272], [180, 300], [200, 325]],
    major: range(40, 200, 10), minor: range(40, 200, 5), labels: range(40, 200, 20), title: 'AIRSPEED', sub: 'KNOTS',
    arcs: [[33, 85, '#f2f2f2', 0.80, 0.06], [44, 127, '#28b04a', 0.90, 0.07], [127, 158, '#f0c020', 0.90, 0.07]], red: [158] },
  alt: { x: -0.145, y: 1.335, r: 0.041, scale: [[0, 0], [10, 360]], major: range(0, 9.5, 0.5), minor: range(0, 9.9, 0.1), labels: range(0, 9, 1), title: 'ALT', sub: '', big: true },
  vsi: { x: -0.145, y: 1.225, r: 0.041, scale: [[-20, 135], [-15, 165], [-10, 200], [-5, 235], [0, 270], [5, 305], [10, 340], [15, 375], [20, 405]],
    major: range(-20, 20, 5), minor: range(-20, 20, 1), labels: [-20, -15, -10, -5, 5, 10, 15, 20], abs: true, title: 'VERTICAL SPEED', sub: '100 FT PER MIN', zero: true },
  tach: { x: -0.365, y: 1.112, r: 0.041, scale: [[0, -150], [35, 150]], major: range(0, 35, 5), minor: range(0, 35, 1), labels: range(0, 35, 5), title: 'RPM', sub: 'X 100',
    arcs: [[21, 27, '#28b04a', 0.90, 0.07]], red: [27] },
  egt: { x: -0.145, y: 1.112, r: 0.031, scale: [[0, -60], [24, 60]], major: range(0, 24, 4), minor: range(0, 24, 1), labels: [], title: 'EGT', sub: '25 F / DIV' },
  suction: { x: -0.475, y: 1.262, r: 0.023, scale: [[3, -70], [7, 70]], major: range(3, 7, 1), minor: range(3, 7, 0.5), labels: [3, 4, 5, 6, 7], title: 'SUCTION', sub: 'IN HG',
    arcs: [[4.5, 5.4, '#28b04a', 0.88, 0.1]] },
  amps: { x: -0.475, y: 1.070, r: 0.023, scale: [[-60, -60], [60, 60]], major: [-60, -30, 0, 30, 60], minor: range(-60, 60, 10), labels: [-60, 0, 60], abs: true, title: 'AMP', sub: '- +' },
  clock: { x: -0.475, y: 1.335, r: 0.031, scale: [[0, 0], [12, 360]], major: range(0, 11, 1), minor: range(0, 11.8, 0.2), labels: range(1, 12, 1), title: '', sub: '' },
};
// the four little edgewise gauges at the far left: the needle swings from a pivot below the scale
export const STRIPS = {
  fuelL: { x: -0.495, y: 1.200, scale: [[-1.5, -42], [0, -34], [21, 34]], marks: [[0, 'E'], [5, ''], [10, '1/2'], [15, ''], [21, 'F']], title: 'LEFT', red: [0] },
  fuelR: { x: -0.455, y: 1.200, scale: [[-1.5, -42], [0, -34], [21, 34]], marks: [[0, 'E'], [5, ''], [10, '1/2'], [15, ''], [21, 'F']], title: 'RIGHT', red: [0] },
  oilT: { x: -0.495, y: 1.138, scale: [[60, -36], [100, -24], [245, 30]], marks: [[100, ''], [245, '']], title: 'TEMP', arc: [100, 245], red: [245] },
  oilP: { x: -0.455, y: 1.138, scale: [[0, -36], [20, -26], [60, 2], [90, 22], [115, 34]], marks: [[20, ''], [60, ''], [90, ''], [115, '']], title: 'PRESS', arc: [60, 90], red: [20, 115] },
};
export const STRIP_R = 0.030;       // needle length, pivot to tip

// switches and labelled things along the bottom of the panel; the cockpit builds the parts at the same places
export const LABELS = [
  [-0.497, 1.052, 'PRIMER'], [-0.447, 1.052, 'ALT'], [-0.423, 1.052, 'BAT'], [-0.435, 1.064, 'MASTER'], [-0.375, 1.060, 'MAGNETOS'],
  [-0.315, 1.046, 'PANEL LT'], [-0.283, 1.046, 'RADIO LT'], [-0.215, 1.046, 'PITOT', 'HEAT'], [-0.185, 1.046, 'NAV', 'LT'], [-0.155, 1.046, 'STROBE'],
  [-0.125, 1.046, 'BCN'], [-0.095, 1.046, 'TAXI'], [-0.065, 1.046, 'LAND'], [-0.035, 1.046, 'DOME'], [-0.002, 1.046, 'AVIONICS', 'MASTER'],
  [0.035, 1.052, 'ALT STATIC', 'PULL ON'], [0.078, 1.064, 'CARB HEAT', 'PULL ON'], [0.145, 1.070, 'THROTTLE'], [0.215, 1.070, 'MIXTURE', 'PULL LEAN'],
  [0.300, 1.090, 'WING FLAPS'], [0.375, 1.052, 'CABIN HT', 'PULL ON'], [0.425, 1.052, 'CABIN AIR', 'PULL ON'], [-0.40, 0.992, 'PARKING BRAKE - PULL'],
  [-0.425, 1.392, 'LOW', 'VOLTAGE'],
];
export const KEY_POS = ['OFF', 'R', 'L', 'BOTH', 'START'];

function text(c, s, u, v, h, { color = '#e8e8e4', align = 'center', bold = true, font = 'Arial, Helvetica, sans-serif' } = {}) {
  c.fillStyle = color; c.font = `${bold ? 'bold ' : ''}${h * S}px ${font}`; c.textAlign = align; c.textBaseline = 'middle';
  c.fillText(s, X(u), Y(v));
}
const polar = (g, r, a) => [X(g.x) + r * S * Math.sin(a * D), Y(g.y) - r * S * Math.cos(a * D)];

function drawDial(c, g) {
  const cx = X(g.x), cy = Y(g.y), R = g.r * S;
  c.fillStyle = '#2b2c2e'; c.beginPath(); c.arc(cx, cy, R * 1.13, 0, 7); c.fill();          // bezel shadow
  c.fillStyle = '#0b0b0c'; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fill();
  for (const [a, b, col, rad, w] of g.arcs ?? []) {
    c.strokeStyle = col; c.lineWidth = R * w; c.beginPath();
    c.arc(cx, cy, R * rad, (dialAngle(g.scale, a) - 90) * D, (dialAngle(g.scale, b) - 90) * D); c.stroke();
  }
  c.strokeStyle = '#f0f0ec'; c.lineCap = 'butt';
  for (const [list, len, w] of [[g.minor ?? [], 0.07, 0.012], [g.major ?? [], 0.14, 0.022]]) for (const v of list) {
    const a = dialAngle(g.scale, v), p = polar(g, g.r * 0.96, a), q = polar(g, g.r * (0.96 - len), a);
    c.lineWidth = R * w; c.beginPath(); c.moveTo(...p); c.lineTo(...q); c.stroke();
  }
  for (const v of g.red ?? []) { const a = dialAngle(g.scale, v), p = polar(g, g.r * 0.98, a), q = polar(g, g.r * 0.74, a); c.strokeStyle = '#e02020'; c.lineWidth = R * 0.035; c.beginPath(); c.moveTo(...p); c.lineTo(...q); c.stroke(); }
  c.fillStyle = '#f0f0ec'; c.font = `bold ${R * (g.big ? 0.26 : 0.19)}px Arial, Helvetica, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const v of g.labels ?? []) { const p = polar(g, g.r * (g.big ? 0.66 : 0.64), dialAngle(g.scale, v)); c.fillText(String(g.abs ? Math.abs(v) : v), ...p); }
  if (g.zero) { const p = polar(g, g.r * 0.64, 270); c.fillText('0', ...p); c.font = `bold ${R * 0.12}px Arial`; c.fillText('UP', ...polar(g, g.r * 0.42, 300)); c.fillText('DN', ...polar(g, g.r * 0.42, 240)); }
  c.font = `bold ${R * 0.13}px Arial, Helvetica, sans-serif`;
  if (g.title) c.fillText(g.title, cx, cy - R * 0.30);
  if (g.sub) c.fillText(g.sub, cx, cy + R * 0.34);
}

function drawStrip(c, g) {
  const px = X(g.x), py = Y(g.y - 0.022), R = STRIP_R * S;
  c.fillStyle = '#0b0b0c'; c.fillRect(X(g.x - 0.0185), Y(g.y + 0.024), 0.037 * S, 0.050 * S);
  const arc = (a, b, col, w) => { c.strokeStyle = col; c.lineWidth = w * S; c.beginPath(); c.arc(px, py, R * 0.93, (dialAngle(g.scale, a) - 90) * D, (dialAngle(g.scale, b) - 90) * D); c.stroke(); };
  arc(g.scale[1][0], g.scale[g.scale.length - 1][0], '#f0f0ec', 0.0006);
  if (g.arc) arc(g.arc[0], g.arc[1], '#28b04a', 0.0022);
  c.font = `bold ${0.0042 * S}px Arial`; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const [v, s] of g.marks) {
    const a = dialAngle(g.scale, v) * D, red = (g.red ?? []).includes(v);
    c.strokeStyle = red ? '#e02020' : '#f0f0ec'; c.lineWidth = (red ? 0.0012 : 0.0007) * S;
    c.beginPath(); c.moveTo(px + R * Math.sin(a), py - R * Math.cos(a)); c.lineTo(px + R * 0.8 * Math.sin(a), py - R * 0.8 * Math.cos(a)); c.stroke();
    if (s) { c.fillStyle = '#f0f0ec'; c.fillText(s, px + R * 0.62 * Math.sin(a), py - R * 0.62 * Math.cos(a)); }
  }
  c.fillStyle = '#f0f0ec'; c.fillText(g.title, X(g.x), Y(g.y - 0.019));
}

/** The whole panel. Returns the texture. */
export function paintPanel({ registration = 'SE-MED' } = {}) {
  return paint(4096, Math.round(0.44 * S), (c, W, H) => {
    c.fillStyle = '#6f7275'; c.fillRect(0, 0, W, H);
    // a little grain so the paint is not flat
    for (let i = 0; i < 9000; i++) { c.fillStyle = `rgba(${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},0.035)`; c.fillRect(Math.random() * W, Math.random() * H, 3, 3); }
    c.fillStyle = '#1c1d1f'; c.fillRect(0, Y(1.075), X(0.02), H);                                   // the black sub-panel under the flight instruments
    c.fillRect(X(0.02), Y(1.10), W, H);
    c.fillStyle = '#17181a'; c.fillRect(X(0.070), Y(1.398), 0.19 * S, 0.335 * S);                    // the radio stack's bay
    for (const g of Object.values(DIALS)) drawDial(c, g);
    c.fillStyle = '#3a3b3d'; c.fillRect(X(-0.518), Y(1.227), 0.086 * S, 0.118 * S);                  // the cluster's frame
    for (const g of Object.values(STRIPS)) drawStrip(c, g);
    text(c, 'FUEL QTY', -0.475, 1.220, 0.0042); text(c, 'OIL', -0.475, 1.158, 0.0042);
    // the faces drawn in 3D (attitude, turn coordinator, heading, course) get a dark well and a bezel
    for (const [x, y, r] of [[-0.255, 1.335, 0.041], [-0.365, 1.225, 0.041], [-0.255, 1.225, 0.041], [-0.035, 1.335, 0.041]]) {
      c.fillStyle = '#2b2c2e'; c.beginPath(); c.arc(X(x), Y(y), r * S * 1.13, 0, 7); c.fill();
      c.fillStyle = '#0b0b0c'; c.beginPath(); c.arc(X(x), Y(y), r * S, 0, 7); c.fill();
    }
    // turn coordinator's markings
    { const g = { x: -0.365, y: 1.225, r: 0.041 }; c.strokeStyle = '#f0f0ec'; c.lineWidth = 0.0016 * S;
      for (const a of [-90, -72, 72, 90]) { c.beginPath(); c.moveTo(...polar(g, 0.039, a)); c.lineTo(...polar(g, 0.032, a)); c.stroke(); }
      text(c, 'L', -0.396, 1.208, 0.006); text(c, 'R', -0.334, 1.208, 0.006); text(c, 'TURN COORDINATOR', -0.365, 1.250, 0.0036);
      text(c, '2 MIN', -0.365, 1.192, 0.0042); text(c, 'NO PITCH INFORMATION', -0.365, 1.187, 0.0026);
      c.fillStyle = '#d8d8d2'; c.beginPath(); c.roundRect(X(-0.387), Y(1.2075), 0.044 * S, 0.0085 * S, 0.004 * S); c.fill();          // the ball's tube
      c.strokeStyle = '#111'; c.lineWidth = 0.0007 * S; for (const dx of [-0.0048, 0.0048]) { c.beginPath(); c.moveTo(X(-0.365 + dx), Y(1.2075)); c.lineTo(X(-0.365 + dx), Y(1.199)); c.stroke(); } }
    // attitude indicator: the bank scale round the top
    { const g = { x: -0.255, y: 1.335, r: 0.041 }; c.strokeStyle = '#f0f0ec';
      for (const a of [-90, -60, -30, -20, -10, 0, 10, 20, 30, 60, 90]) { c.lineWidth = (a % 30 ? 0.0008 : 0.0016) * S; c.beginPath(); c.moveTo(...polar(g, 0.0405, a)); c.lineTo(...polar(g, a % 30 ? 0.037 : 0.035, a)); c.stroke(); } }
    // lower panel labels and placards
    for (const [u, v, a, b] of LABELS) { text(c, a, u, v + (b ? 0.0028 : 0), 0.0044); if (b) text(c, b, u, v - 0.0028, 0.0044); }
    KEY_POS.forEach((s, i) => { const a = (-60 + i * 30) * D; text(c, s, -0.375 + 0.027 * Math.sin(a), 1.02 + 0.027 * Math.cos(a), 0.0036); });
    for (const [i, s] of ['UP', '10°', '20°', 'FULL'].entries()) text(c, s, 0.325, 1.070 - i * 0.0167, 0.0042, { align: 'left' });
    c.fillStyle = '#0b0b0c'; c.fillRect(X(0.292), Y(1.078), 0.012 * S, 0.066 * S);                  // flap lever slot
    c.fillRect(X(0.309), Y(1.078), 0.006 * S, 0.066 * S);
    // the breakers
    c.fillStyle = '#101112'; c.fillRect(X(-0.232), Y(1.098), 0.252 * S, 0.022 * S);
    text(c, 'CIRCUIT BREAKERS - PUSH TO RESET', -0.105, 1.1005, 0.0034);
    // radio faceplates
    const plate = (v0, v1, name) => { c.fillStyle = '#26282b'; c.fillRect(X(0.075), Y(v1), 0.18 * S, (v1 - v0) * S); c.strokeStyle = '#0c0c0d'; c.lineWidth = 0.001 * S; c.strokeRect(X(0.075), Y(v1), 0.18 * S, (v1 - v0) * S); text(c, name, 0.165, v1 - 0.0045, 0.0034, { color: '#b9bcc0' }); };
    plate(1.318, 1.393, 'NAV / COMM'); plate(1.250, 1.312, 'TRANSPONDER'); plate(1.066, 1.244, '');
    text(c, 'COMM', 0.118, 1.3775, 0.0036); text(c, 'NAV', 0.212, 1.3775, 0.0036);
    for (const [u, a, b] of [[0.094, 'OFF', 'VOL'], [0.145, 'MHZ', 'KHZ'], [0.196, 'VOL', 'IDENT'], [0.238, 'MHZ', 'KHZ']]) text(c, `${a}  ${b}`, u, 1.322, 0.0030, { color: '#c8cacc' });
    for (const [i, s] of ['OFF', 'SBY', 'ON', 'ALT', 'TST'].entries()) { const a = (-70 + i * 35) * D; text(c, s, 0.094 + 0.0165 * Math.sin(a), 1.279 + 0.0165 * Math.cos(a), 0.0028, { color: '#c8cacc' }); }
    text(c, 'IDENT', 0.240, 1.2595, 0.0030, { color: '#c8cacc' });
    // the right-hand side: placards a real one carries
    c.fillStyle = '#0d0d0e'; c.fillRect(X(0.300), Y(1.380), 0.21 * S, 0.060 * S);
    for (const [i, s] of ['THIS AIRPLANE MUST BE OPERATED AS A NORMAL OR UTILITY', 'CATEGORY AIRPLANE IN COMPLIANCE WITH THE OPERATING',
      'LIMITATIONS STATED IN THE FORM OF PLACARDS, MARKINGS', 'AND MANUALS.   MAX: NORMAL 2400 LBS  UTILITY 2100 LBS',
      'MANEUVERING SPEED 99 KIAS.  NO ACROBATIC MANEUVERS', 'INCLUDING SPINS APPROVED IN NORMAL CATEGORY.'].entries()) text(c, s, 0.405, 1.372 - i * 0.0088, 0.0050, { color: '#e6e6e0', bold: false });
    c.fillStyle = '#d9d6c8'; c.fillRect(X(0.33), Y(1.30), 0.15 * S, 0.03 * S); text(c, registration, 0.405, 1.285, 0.016, { color: '#111' });
    c.strokeStyle = '#4a4c4f'; c.lineWidth = 0.0012 * S; c.strokeRect(X(0.315), Y(1.245), 0.185 * S, 0.105 * S); text(c, 'MAP COMPARTMENT', 0.4075, 1.193, 0.0045, { color: '#33363a' });
    text(c, 'HOURS', -0.035, 1.137, 0.0036); text(c, 'AVOID SLIPS WITH FLAPS EXTENDED', 0.300, 1.108, 0.0030, { color: '#c8cacc' });
    // screws
    c.fillStyle = '#3f4144'; for (const [u, v] of [[-0.52, 1.41], [0.52, 1.41], [-0.52, 0.99], [0.52, 0.99], [0, 1.41], [0.28, 1.41], [0.045, 1.41]]) { c.beginPath(); c.arc(X(u), Y(v), 0.003 * S, 0, 7); c.fill(); }
  }, { aniso: 16 });
}

/** The attitude indicator's ball: sky over earth with a pitch ladder, centred where the sphere faces the pilot. */
export function paintHorizon() {
  return paint(1024, 512, (c, W, H) => {
    c.fillStyle = '#2f7fd1'; c.fillRect(0, 0, W, H / 2); c.fillStyle = '#6b4424'; c.fillRect(0, H / 2, W, H / 2);
    c.fillStyle = '#f4f4f0'; c.fillRect(0, H / 2 - 2, W, 4);
    const cx = W * 0.25, perDeg = H / 180;
    c.strokeStyle = '#f4f4f0'; c.fillStyle = '#f4f4f0'; c.font = 'bold 15px Arial'; c.textBaseline = 'middle';
    for (let p = -60; p <= 60; p += 5) {
      if (!p) continue;
      const y = H / 2 - p * perDeg, w = p % 10 ? 12 : 26;
      c.lineWidth = 3; c.beginPath(); c.moveTo(cx - w, y); c.lineTo(cx + w, y); c.stroke();
      if (p % 10 === 0) { c.textAlign = 'right'; c.fillText(String(Math.abs(p)), cx - w - 4, y); c.textAlign = 'left'; c.fillText(String(Math.abs(p)), cx + w + 4, y); }
    }
  }, { aniso: 8 });
}

/** A compass rose for the heading indicator and the course card: numbers every 30 degrees, read from outside the ring. */
export function paintRose(size = 512, { letters = true } = {}) {
  return paint(size, size, (c, W) => {
    const R = W / 2;
    c.clearRect(0, 0, W, W); c.fillStyle = '#0b0b0c'; c.beginPath(); c.arc(R, R, R, 0, 7); c.fill();
    c.strokeStyle = '#f0f0ec'; c.fillStyle = '#f0f0ec'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let a = 0; a < 360; a += 5) {
      c.save(); c.translate(R, R); c.rotate(a * D);
      c.lineWidth = a % 10 ? 2 : 3.5; c.beginPath(); c.moveTo(0, -R * 0.97); c.lineTo(0, -R * (a % 10 ? 0.90 : 0.84)); c.stroke();
      if (a % 30 === 0) { c.font = `bold ${R * 0.17}px Arial`; c.fillText(letters && a % 90 === 0 ? 'NESW'[a / 90] : String(a / 10), 0, -R * 0.70); }
      c.restore();
    }
  }, { aniso: 8 });
}

/** The magnetic compass card, wrapped round a drum: the pilot reads the back of it, so the numbers run the other way. */
export function paintCompassBand() {
  return paint(1024, 64, (c, W, H) => {
    c.fillStyle = '#0b0b0c'; c.fillRect(0, 0, W, H); c.fillStyle = '#f0f0ec'; c.strokeStyle = '#f0f0ec'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let h = 0; h < 360; h += 5) {
      const x = ((360 - h) % 360) / 360 * W;
      for (const xx of [x, x + W, x - W]) {
        c.lineWidth = 2; c.beginPath(); c.moveTo(xx, H); c.lineTo(xx, H * (h % 10 ? 0.78 : 0.62)); c.stroke();
        if (h % 30 === 0) { c.font = 'bold 30px Arial'; c.fillText(h % 90 === 0 ? 'NESW'[h / 90] : String(h / 10), xx, H * 0.32); }
      }
    }
  }, { aniso: 4 });
}
