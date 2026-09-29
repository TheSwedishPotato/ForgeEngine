// The A320neo flight deck behind the cockpit door: shell, glareshield with the FCU, six display
// units drawn live from the aircraft (PFD, ND, E/WD, SD on the captain's, centre and first
// officer's panels), the pedestal with thrust, flap and speed-brake levers that move with the
// crew's hands, sidesticks, overhead panel, the two pilots, and a third-occupant (jump) seat.
// Layout measured from the FlightGear A320 flight deck and the FlyByWire A32NX panel
// photographs: displays at z -5.6, FCU at z -5.44, pedestal from -5.5 to -4.6, overhead panel from
// -4.7 to -4.2, pilots' eyes about 1.2 m above the floor at x = -/+0.54.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fusPoint, fusSection, fusHalfWidthAt, COCKPIT_PANES, COCKPIT_DOOR_Z } from './airframe.js';
import { canvasTex } from './textures.js';
import { Human, crewAppearance, POSES, composePose } from './humans.js';
import { rng, clamp, lerp, DEG, KT, FT } from './core.js';

const Z0 = -6.02, Z1 = COCKPIT_DOOR_Z;       // flight deck from the windshield to the cockpit door
const EYE = { z: -4.85, y: 1.2, x: 0.54 };
const FEMALE = /Karin|Maria|Sofie|Emma/;

// ---------------- display units ----------------
const DU = 512;
// A320 overhead panel, aft to forward rows as seen from below (FCOM 1.95 layout, simplified)
const OVH = ['ADIRS', 'ADIRS', 'FLT CTL', 'EVAC', 'EMER ELEC', 'GPWS', 'RCDR', 'OXYGEN', 'CALLS', 'WIPER', 'FIRE', 'ENG 1',
  'HYD', 'HYD', 'FUEL', 'FUEL', 'FUEL', 'ENG 2', 'ELEC', 'ELEC', 'AIR COND', 'AIR COND', 'ANTI ICE', 'PROBE HEAT',
  'CAB PRESS', 'CAB PRESS', 'EXT LT', 'EXT LT', 'APU', 'SIGNS', 'INT LT', 'CARGO', 'VENT', 'ENG MAN START', 'CARGO HEAT', 'WIPER',
  'FLT CTL', 'FAC 2', 'ELAC 2', 'SEC 2', 'FUEL', 'CVR', 'MAINT', 'BLOWER', 'EXTRACT', 'APU FIRE', 'GEN 1', 'GEN 2'];
function fmtAlt(ft) { return String(Math.round(ft / 10) * 10); }
class Display {
  constructor(kind) { this.kind = kind; this.c = document.createElement('canvas'); this.c.width = this.c.height = DU; this.g = this.c.getContext('2d'); this.tex = new THREE.CanvasTexture(this.c); this.tex.colorSpace = THREE.SRGBColorSpace; }
  draw(d) {
    const g = this.g, W = DU;
    g.fillStyle = '#05070a'; g.fillRect(0, 0, W, W);
    g.textBaseline = 'middle'; g.font = 'bold 22px monospace';
    if (this.kind === 'pfd') this._pfd(g, d, W); else if (this.kind === 'nd') this._nd(g, d, W); else if (this.kind === 'ewd') this._ewd(g, d, W); else this._sd(g, d, W);
    this.tex.needsUpdate = true;
  }
  _pfd(g, d, W) {
    // FMA
    g.fillStyle = '#0a0c10'; g.fillRect(0, 0, W, 64);
    g.strokeStyle = '#6b6f76'; g.lineWidth = 2; for (const x of [100, 200, 300, 400]) { g.beginPath(); g.moveTo(x, 4); g.lineTo(x, 60); g.stroke(); }
    const f = d.fma; g.font = 'bold 17px monospace'; g.textAlign = 'center';
    g.fillStyle = '#35e05a'; g.fillText((f.thr || '').slice(0, 9), 50, 20); g.fillText((f.vert || '').split(' · ')[0].slice(0, 9), 150, 20); g.fillText((f.lat || '').split(' · ')[0].slice(0, 9), 250, 20);
    g.fillStyle = '#29c5ff'; g.fillText(((f.vert || '').split(' · ')[1] || '').slice(0, 9), 150, 44); g.fillText(((f.lat || '').split(' · ')[1] || '').slice(0, 9), 250, 44);
    g.fillStyle = '#fff'; g.fillText((f.ap || '').slice(0, 12), 450, 32);
    // attitude
    const cx = 256, cy = 250, R = 120, ppd = 5.2;
    g.save(); g.beginPath(); g.rect(cx - R, cy - R, 2 * R, 2 * R); g.clip();
    g.translate(cx, cy); g.rotate(-d.bank); g.translate(0, d.pitch / DEG * ppd);
    g.fillStyle = '#1f7ad8'; g.fillRect(-400, -800, 800, 800); g.fillStyle = '#8a5a26'; g.fillRect(-400, 0, 800, 800);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(-400, 0); g.lineTo(400, 0); g.stroke();
    g.font = '14px monospace'; g.fillStyle = '#fff'; g.textAlign = 'left';
    for (let p = -30; p <= 30; p += 2.5) { if (!p) continue; const y = -p * ppd, w = p % 10 === 0 ? 50 : p % 5 === 0 ? 28 : 12; g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke(); if (p % 10 === 0) g.fillText(String(Math.abs(p)), w + 4, y); }
    g.restore();
    g.strokeStyle = '#ffd400'; g.lineWidth = 5; g.beginPath(); g.moveTo(cx - 90, cy); g.lineTo(cx - 35, cy); g.lineTo(cx - 35, cy + 12); g.moveTo(cx + 90, cy); g.lineTo(cx + 35, cy); g.lineTo(cx + 35, cy + 12); g.stroke(); g.fillStyle = '#ffd400'; g.fillRect(cx - 4, cy - 4, 8, 8);
    // speed tape
    g.fillStyle = '#3a3f47'; g.fillRect(20, 130, 80, 240); g.save(); g.beginPath(); g.rect(20, 130, 80, 240); g.clip();
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.font = '16px monospace'; g.textAlign = 'right'; g.lineWidth = 2;
    for (let v = Math.floor(d.ias / 10) * 10 - 60; v < d.ias + 70; v += 10) { const y = cy - (v - d.ias) * 3.2; g.beginPath(); g.moveTo(92, y); g.lineTo(100, y); g.stroke(); if (v % 20 === 0 && v >= 30) g.fillText(String(v), 86, y); }
    if (d.vls) { const y = cy - (d.vls - d.ias) * 3.2; g.fillStyle = '#e8b400'; g.fillRect(94, y, 6, 240); }
    if (d.spd) { const y = cy - (d.spd - d.ias) * 3.2; g.fillStyle = '#e94ce0'; g.beginPath(); g.moveTo(100, y); g.lineTo(88, y - 8); g.lineTo(88, y + 8); g.fill(); }
    g.restore(); g.fillStyle = '#ffd400'; g.fillRect(14, cy - 2, 92, 4);
    // altitude tape
    g.fillStyle = '#3a3f47'; g.fillRect(400, 130, 70, 240); g.save(); g.beginPath(); g.rect(400, 130, 70, 240); g.clip();
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = '15px monospace';
    for (let a = Math.floor(d.alt / 100) * 100 - 600; a < d.alt + 700; a += 100) { const y = cy - (a - d.alt) * 0.19; g.fillRect(400, y - 1, 8, 2); if (a % 500 === 0) g.fillText(String(a / 100 | 0).padStart(3, '0'), 412, y); }
    g.restore(); g.fillStyle = '#000'; g.fillRect(398, cy - 18, 90, 36); g.strokeStyle = '#ffd400'; g.strokeRect(398, cy - 18, 90, 36);
    g.fillStyle = '#35e05a'; g.font = 'bold 20px monospace'; g.fillText(fmtAlt(d.alt), 402, cy);
    g.fillStyle = '#29c5ff'; g.font = '16px monospace'; g.fillText(String(d.fcuAlt ?? ''), 404, 118);
    g.fillStyle = d.std ? '#29c5ff' : '#fff'; g.fillText(d.std ? 'STD' : `QNH ${d.qnh ?? ''}`, 404, 392);
    // vertical speed
    g.fillStyle = '#35e05a'; g.font = '15px monospace'; g.fillText(`${d.vs >= 0 ? '+' : '-'}${String(Math.abs(Math.round(d.vs / 100))).padStart(2, '0')}`, 474, cy + (d.vs > 0 ? -50 : 50));
    // speed box
    g.fillStyle = '#000'; g.fillRect(16, cy - 18, 70, 36); g.fillStyle = '#fff'; g.font = 'bold 20px monospace'; g.textAlign = 'right'; g.fillText(String(Math.round(d.ias)), 80, cy);
    if (d.mach > 0.5) { g.fillStyle = '#35e05a'; g.font = '16px monospace'; g.fillText(`.${Math.round(d.mach * 1000).toString().padStart(3, '0').slice(0, 3)}`, 90, 396); }
    // heading scale
    g.fillStyle = '#3a3f47'; g.fillRect(140, 400, 232, 44); g.save(); g.beginPath(); g.rect(140, 400, 232, 44); g.clip();
    g.fillStyle = '#fff'; g.font = '15px monospace'; g.textAlign = 'center';
    for (let h = Math.floor(d.hdg / 5) * 5 - 30; h < d.hdg + 35; h += 5) { const x = 256 + (h - d.hdg) * 4; g.fillRect(x - 1, 400, 2, h % 10 === 0 ? 10 : 5); if (h % 10 === 0) g.fillText(String(((h % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), x, 425); }
    g.restore(); g.fillStyle = '#ffd400'; g.fillRect(254, 396, 4, 20);
    if (d.warn) { g.fillStyle = '#ff2b2b'; g.font = 'bold 28px monospace'; g.textAlign = 'center'; g.fillText(d.warn, 256, 480); }
  }
  _nd(g, d, W) {
    const cx = 256, cy = 400, R = 300;
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, Math.PI * 1.17, Math.PI * 1.83); g.stroke();
    g.fillStyle = '#fff'; g.font = '16px monospace'; g.textAlign = 'center';
    for (let h = Math.floor(d.hdg / 10) * 10 - 60; h <= d.hdg + 60; h += 10) {
      const a = (h - d.hdg) * DEG - Math.PI / 2; if (Math.abs(h - d.hdg) > 58) continue;
      const x1 = cx + Math.cos(a) * R, y1 = cy + Math.sin(a) * R; g.beginPath(); g.moveTo(x1, y1); g.lineTo(cx + Math.cos(a) * (R - 14), cy + Math.sin(a) * (R - 14)); g.stroke();
      if (h % 30 === 0) g.fillText(String((((h % 360) + 360) % 360) / 10 | 0), cx + Math.cos(a) * (R - 30), cy + Math.sin(a) * (R - 30));
    }
    // flight plan (magenta) ahead of the aircraft
    if (d.route) {
      g.strokeStyle = '#35e05a'; g.lineWidth = 3; g.beginPath();
      d.route.forEach(([x, y], i) => { const px = cx + x * d.ndScale, py = cy - y * d.ndScale; if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke();
    }
    g.strokeStyle = '#ffd400'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy - 22); g.lineTo(cx, cy + 20); g.moveTo(cx - 18, cy - 4); g.lineTo(cx + 18, cy - 4); g.moveTo(cx - 8, cy + 16); g.lineTo(cx + 8, cy + 16); g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = '17px monospace';
    g.fillText(`GS ${Math.round(d.gs)}  TAS ${Math.round(d.tas)}`, 14, 24); g.fillText(d.wind, 14, 48);
    g.fillStyle = '#35e05a'; g.textAlign = 'right'; g.fillText(d.dest || '', 500, 24); g.fillText(`${Math.round(d.distNm)} NM`, 500, 48);
    g.fillStyle = '#29c5ff'; g.textAlign = 'left'; g.fillText(`${d.range ?? 40}`, 14, 480);
    if (d.wx) { g.fillStyle = 'rgba(40,200,60,0.35)'; for (const c of d.wx) { g.beginPath(); g.arc(cx + c[0] * d.ndScale, cy - c[1] * d.ndScale, c[2] * d.ndScale, 0, 7); g.fill(); } }
  }
  _ewd(g, d, W) {
    g.textAlign = 'center';
    for (let i = 0; i < 2; i++) {
      const cx = 140 + i * 232, cy = 130, R = 70, n1 = d.n1[i];
      g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.85, Math.PI * 2.05); g.stroke();
      const a = Math.PI * 0.85 + Math.PI * 1.2 * clamp(n1 / 110, 0, 1);
      g.strokeStyle = n1 > 101 ? '#ff2b2b' : '#35e05a'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
      g.fillStyle = '#35e05a'; g.font = 'bold 26px monospace'; g.fillText(n1.toFixed(1), cx + 28, cy + 36);
      g.fillStyle = '#35e05a'; g.font = '20px monospace'; g.fillText(String(Math.round(d.egt[i])), cx, cy + 110);
      g.fillText(String(Math.round(d.ff[i] * 3600 / 10) * 10), cx, cy + 190);
      if (d.fail[i]) { g.fillStyle = '#ffae00'; g.fillText('FAIL', cx, cy - 20); }
    }
    g.fillStyle = '#fff'; g.font = '18px monospace'; g.fillText('N1 %', 256, 130); g.fillText('EGT °C', 256, 240); g.fillText('FF KG/H', 256, 320);
    g.textAlign = 'left'; g.fillText(`FOB: ${Math.round(d.fob / 10) * 10} KG`, 18, 372);
    g.fillStyle = '#29c5ff'; g.font = 'bold 22px monospace'; g.fillText(d.flaps === '0' ? '' : `FLAP ${d.flaps}`, 340, 372);
    g.fillStyle = '#fff'; g.fillRect(0, 398, W, 2);
    g.font = '18px monospace'; let y = 424;
    for (const m of d.memo) { g.fillStyle = m.c || '#35e05a'; g.fillText(m.t, 18, y); y += 26; if (y > 500) break; }
  }
  _sd(g, d, W) {
    g.fillStyle = '#fff'; g.font = 'bold 22px monospace'; g.textAlign = 'center'; g.fillText(d.sdPage, 256, 28);
    g.font = '18px monospace'; g.textAlign = 'left';
    const rows = d.sdRows; let y = 80;
    for (const [k, v, c] of rows) { g.fillStyle = '#fff'; g.fillText(k, 30, y); g.fillStyle = c || '#35e05a'; g.textAlign = 'right'; g.fillText(v, 482, y); g.textAlign = 'left'; y += 34; }
    g.fillStyle = '#fff'; g.fillRect(0, 440, W, 2);
    g.fillStyle = '#35e05a'; g.fillText(`TAT ${d.tat > 0 ? '+' : ''}${Math.round(d.tat)} °C`, 20, 470); g.fillText(`SAT ${d.sat > 0 ? '+' : ''}${Math.round(d.sat)} °C`, 20, 496);
    g.textAlign = 'right'; g.fillText(d.utc, 492, 470); g.fillText(`GW ${Math.round(d.gw / 100) * 100} KG`, 492, 496);
  }
}

// ---------------- the flight deck ----------------
export class FlightDeck {
  constructor(scene, { seed = 3, crew = null } = {}) {
    this.group = new THREE.Group(); this.group.name = 'flightdeck'; scene.add(this.group);
    this.r = rng(seed);
    this.maskMeshes = []; this.interactables = [];
    const M = this.mats = {
      lining: new THREE.MeshStandardMaterial({ color: '#8d959f', roughness: 0.75 }),
      panel: new THREE.MeshStandardMaterial({ color: '#4a5563', roughness: 0.6 }),
      dark: new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.7 }),
      floor: new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.95 }),
      seat: new THREE.MeshStandardMaterial({ color: '#2d3440', roughness: 0.85 }),
      metal: new THREE.MeshStandardMaterial({ color: '#b8bdc4', roughness: 0.35, metalness: 0.7 }),
      screenOff: new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.2 }),
    };
    this._shell(); this._panels(); this._pedestal(); this._overhead(); this._seats(); this._lights();
    if (crew) this.setCrew(crew);
    this.t = 0; this.drawT = 0;
  }
  _add(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; this.group.add(m); return m; }

  // lining following the nose section 6 cm inside the skin, with the six windows cut out
  _shell() {
    const M = this.mats;
    const holes = [];
    const vOf = (z, y) => { const s = fusSection(z); const up = y >= s.yw, n = up ? s.nU : s.nL, b = up ? s.top - s.yw : s.yw - s.bot; const d = clamp(Math.abs(y - s.yw) / Math.max(b, 1e-3), 0, 1); return 0.5 + (up ? 1 : -1) * Math.asin(Math.pow(d, n / 2)) / Math.PI; };
    for (const p of COCKPIT_PANES) holes.push(p.pts.map(([z, y]) => [z, vOf(z, y)]));
    const alpha = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#000';
      for (const poly of holes) { g.beginPath(); poly.forEach(([z, v], i) => { const cz = z + (z - poly.reduce((a, q) => a + q[0], 0) / poly.length) * 0.04; const X = (cz - Z0) / (Z1 - Z0) * w, Y = h - v * h; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }); g.closePath(); g.fill(); }
    }, { srgb: false });
    const mat = M.lining.clone(); mat.alphaMap = alpha; mat.alphaTest = 0.5; mat.side = THREE.DoubleSide;
    const NZ = 40, NA = 60, P = new THREE.Vector3();
    for (const side of [-1, 1]) {
      const pos = [], uv = [], idx = [];
      for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NA; i++) {
        const z = lerp(Z0, Z1, j / NZ), u = lerp(-0.45, 1, i / NA);
        fusPoint(z, side, u, P, -0.06); pos.push(P.x, Math.max(0, P.y), P.z); uv.push(j / NZ, (u + 1) / 2);
      }
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; this.group.add(m);
    }
    // floor
    const fl = new THREE.Shape(); const N = 16;
    for (let i = 0; i <= N; i++) { const z = lerp(Z0 + 0.3, Z1, i / N); const x = fusHalfWidthAt(z, 0.02) - 0.08; if (i) fl.lineTo(x, z); else fl.moveTo(x, z); }
    for (let i = N; i >= 0; i--) { const z = lerp(Z0 + 0.3, Z1, i / N); fl.lineTo(-(fusHalfWidthAt(z, 0.02) - 0.08), z); }
    const fg = new THREE.ShapeGeometry(fl); fg.rotateX(Math.PI / 2); this._add(fg, M.floor, 0, 0.005, 0);
    // window masks: where the outside world is drawn (just inside the glass)
    const mm = new THREE.MeshBasicMaterial({ visible: false });
    for (const side of [-1, 1]) for (const p of COCKPIT_PANES) {
      const cz = p.pts.reduce((a, q) => a + q[0], 0) / p.pts.length, cy = p.pts.reduce((a, q) => a + q[1], 0) / p.pts.length;
      const loop = p.pts.map(([z, y]) => { const zz = cz + (z - cz) * 1.03, yy = cy + (y - cy) * 1.03; return new THREE.Vector3(side * (fusHalfWidthAt(zz, yy) - 0.03), yy, zz); });
      const c = new THREE.Vector3(side * (fusHalfWidthAt(cz, cy) - 0.03), cy, cz);
      const verts = [c, ...loop], arr = []; verts.forEach((v) => arr.push(v.x, v.y, v.z));
      const idx = []; for (let i = 0; i < loop.length; i++) idx.push(0, 1 + i, 1 + (i + 1) % loop.length);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.setIndex(idx);
      const m = new THREE.Mesh(g, mm); this.group.add(m); this.maskMeshes.push(m);
    }
  }

  _panels() {
    const M = this.mats;
    // main instrument panel, tilted back 12 degrees, and the glareshield above it
    const panel = this._add(new THREE.BoxGeometry(1.9, 0.62, 0.08), M.panel, 0, 0.62, -5.66); panel.rotation.x = -0.21;
    this._add(new RoundedBoxGeometry(2.0, 0.07, 0.42, 2, 0.02), M.dark, 0, 0.96, -5.66);
    // FCU and the two EFIS control panels on the glareshield face
    const fcuTex = canvasTex(1024, 128, (g, w, h) => {
      g.fillStyle = '#39424e'; g.fillRect(0, 0, w, h); g.fillStyle = '#10141a';
      for (const x of [300, 440, 590, 760]) g.fillRect(x - 55, 20, 110, 44);
      g.fillStyle = '#dfe6ee'; g.font = 'bold 18px Arial'; g.textAlign = 'center';
      for (const [x, t] of [[300, 'SPD'], [440, 'HDG'], [590, 'ALT'], [760, 'V/S']]) g.fillText(t, x, 90);
      for (const [x, t] of [[70, 'EFIS'], [954, 'EFIS'], [520, 'AP1  AP2  A/THR']]) g.fillText(t, x, 116);
    });
    this.fcuTex = fcuTex;
    const fcu = this._add(new THREE.PlaneGeometry(1.5, 0.19), new THREE.MeshStandardMaterial({ map: fcuTex, roughness: 0.5 }), 0, 0.905, -5.448);
    fcu.rotation.x = -0.1;
    this.fcuCanvas = document.createElement('canvas'); this.fcuCanvas.width = 512; this.fcuCanvas.height = 48; this.fcuWin = new THREE.CanvasTexture(this.fcuCanvas);
    const win = this._add(new THREE.PlaneGeometry(0.72, 0.045), new THREE.MeshBasicMaterial({ map: this.fcuWin }), 0.05, 0.935, -5.444); win.rotation.x = -0.1;
    // display units: captain PFD, ND; centre E/WD over SD; first officer ND, PFD
    this.displays = [];
    const du = (kind, x, y, mirror) => {
      const d = new Display(kind);
      const m = this._add(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: d.tex, toneMapped: false }), x, y, -5.615 + (0.66 - y) * 0.21);
      m.rotation.x = -0.21; d.mesh = m; d.side = mirror; this.displays.push(d); return d;
    };
    du('pfd', -0.73, 0.66, -1); du('nd', -0.49, 0.66, -1); du('ewd', 0, 0.72, 0); du('nd', 0.49, 0.66, 1); du('pfd', 0.73, 0.66, 1);
    // SD on the pedestal's forward face, MCDUs below
    const sd = new Display('sd'); const sm = this._add(new THREE.PlaneGeometry(0.19, 0.19), new THREE.MeshBasicMaterial({ map: sd.tex, toneMapped: false }), 0, 0.47, -5.52); sm.rotation.x = -0.55; this.displays.push(sd);
    const mcduTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#39424e'; g.fillRect(0, 0, w, h); g.fillStyle = '#05070a'; g.fillRect(28, 16, 200, 110); g.fillStyle = '#35e05a'; g.font = '14px monospace'; g.fillText(' SK1415  ESSA/EKCH', 34, 34); g.fillStyle = '#fff'; g.fillText(' INIT  PERF  F-PLN', 34, 58); g.fillStyle = '#dfe6ee'; for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) g.fillRect(30 + c * 33, 140 + r * 19, 26, 14); });
    for (const x of [-0.17, 0.17]) { const m = this._add(new THREE.PlaneGeometry(0.17, 0.2), new THREE.MeshStandardMaterial({ map: mcduTex, roughness: 0.5 }), x, 0.35, -5.33); m.rotation.x = -0.9; }
    // rudder pedals
    this.pedals = [];
    for (const px of [-0.54, 0.54]) for (const dx of [-0.1, 0.1]) { const p = this._add(new THREE.BoxGeometry(0.08, 0.2, 0.03), M.metal, px + dx, 0.18, -5.78); p.rotation.x = -0.5; this.pedals.push({ m: p, dx }); }
    // sidesticks on the side consoles
    this.sticks = [];
    for (const side of [-1, 1]) {
      this._add(new THREE.BoxGeometry(0.34, 0.6, 1.1), M.panel, side * 1.02, 0.3, -5.0);
      const pivot = new THREE.Group(); pivot.position.set(side * 0.93, 0.62, -5.02); this.group.add(pivot);
      const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.13, 4, 8), M.dark); grip.position.y = 0.09; pivot.add(grip);
      this.sticks.push({ pivot, side });
    }
  }

  _pedestal() {
    const M = this.mats;
    this._add(new THREE.BoxGeometry(0.46, 0.66, 1.0), M.panel, 0, 0.33, -5.02);
    const topTex = canvasTex(256, 512, (g, w, h) => { g.fillStyle = '#39424e'; g.fillRect(0, 0, w, h); g.strokeStyle = '#1c2128'; for (let y = 40; y < h; y += 70) g.strokeRect(10, y, w - 20, 60); g.fillStyle = '#dfe6ee'; g.font = 'bold 16px Arial'; g.textAlign = 'center'; g.fillText('ENG 1   MASTER   ENG 2', w / 2, 330); g.fillText('SPD BRK            FLAPS', w / 2, 90); g.fillText('PARK BRK', w / 2, 460); });
    const top = this._add(new THREE.PlaneGeometry(0.46, 1.0), new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.6 }), 0, 0.662, -5.02); top.rotation.x = -Math.PI / 2;
    // thrust levers: pivot at the quadrant, travel from max reverse through idle to TOGA
    this.thrLevers = [];
    for (const x of [-0.07, 0.07]) {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.62, -5.12); this.group.add(pivot);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.03), M.metal); arm.position.y = 0.1; pivot.add(arm);
      const knob = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.05), M.dark); knob.position.y = 0.2; pivot.add(knob);
      this.thrLevers.push(pivot);
    }
    const mkLever = (x, z, col) => { const pivot = new THREE.Group(); pivot.position.set(x, 0.64, z); this.group.add(pivot); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.11, 0.018), M.metal); arm.position.y = 0.055; pivot.add(arm); const k = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.04), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 })); k.position.y = 0.11; pivot.add(k); return pivot; };
    this.flapLever = mkLever(0.16, -5.28, '#d9dde2');
    this.sbLever = mkLever(-0.16, -5.28, '#8a8f97');
    this.gearLever = this._add(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 10), new THREE.MeshStandardMaterial({ color: '#f2f2f2' }), 0.17, 0.62, -5.60);
    this.gearLights = ['#1a1', '#1a1', '#1a1'].map((c, i) => this._add(new THREE.PlaneGeometry(0.025, 0.02), new THREE.MeshBasicMaterial({ color: '#111' }), 0.24 + (i - 1) * 0.03, 0.66, -5.58));
  }

  _overhead() {
    const tex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#4a5563'; g.fillRect(0, 0, w, h);
      const r = rng(9);
      for (let py = 8; py < h - 20; py += 64) for (let px = 8; px < w - 20; px += 84) {
        g.strokeStyle = '#2a3038'; g.strokeRect(px, py, 76, 56);
        for (let k = 0; k < 3; k++) { g.fillStyle = r() < 0.12 ? '#e0b000' : r() < 0.1 ? '#29c5ff' : '#1a1e24'; g.fillRect(px + 6 + k * 24, py + 18, 18, 14); }
        g.fillStyle = '#dfe6ee'; g.font = '9px Arial'; g.fillText(OVH[((py - 8) / 64) * 6 + (px - 8) / 84] || '', px + 6, py + 48);
      }
    });
    this.overheadTex = tex;
    // hangs about 12 cm under the crown lining from just behind the windshield to above the seats,
    // sloping up about 20 degrees; only its lower face carries the panels
    const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const m = this._add(new THREE.BoxGeometry(0.82, 0.08, 0.8), [this.mats.panel, this.mats.panel, this.mats.panel, face, this.mats.panel, this.mats.panel], 0, 1.74, -4.66);
    m.rotation.x = -0.34;
  }

  _seats() {
    const M = this.mats;
    const seat = (x, z, face = 0) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = face; this.group.add(g);
      const add = (geo, px, py, pz, rx = 0) => { const m = new THREE.Mesh(geo, M.seat); m.position.set(px, py, pz); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; };
      add(new RoundedBoxGeometry(0.5, 0.1, 0.5, 2, 0.03), 0, 0.46, 0);
      add(new RoundedBoxGeometry(0.48, 0.62, 0.1, 2, 0.03), 0, 0.84, 0.27, 0.12);
      add(new RoundedBoxGeometry(0.26, 0.17, 0.09, 2, 0.03), 0, 1.24, 0.31, 0.12);
      add(new THREE.CylinderGeometry(0.05, 0.08, 0.4, 8), 0, 0.2, 0);
      for (const s of [-1, 1]) add(new RoundedBoxGeometry(0.06, 0.05, 0.36, 2, 0.02), s * 0.28, 0.7, 0.05);
      return g;
    };
    seat(-EYE.x, -4.7); seat(EYE.x, -4.7);
    // third occupant seat behind the centre pedestal, facing forward
    this.jumpSeat = seat(0, -4.1);
    this.jumpSeat.scale.set(0.85, 0.95, 0.85);
    const hot = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.45), new THREE.MeshBasicMaterial({ visible: false })); hot.position.set(0, 0.6, -4.1); this.group.add(hot);
    hot.userData.interact = { kind: 'jumpseat', prompt: () => 'Sit on the observer (jump) seat' };
    this.interactables.push(hot);
    this.jumpEye = new THREE.Vector3(0, 1.2, -4.02);
  }

  _lights() {
    this.dome = new THREE.PointLight('#fff1dc', 0.6, 4, 1.5); this.dome.position.set(0, 1.9, -4.6); this.group.add(this.dome);
    this.panelGlow = new THREE.PointLight('#bcd4ff', 0.25, 1.6, 2); this.panelGlow.position.set(0, 0.8, -5.3); this.group.add(this.panelGlow);
  }

  setCrew(crew) {
    this.pilots = [];
    const r = this.r;
    for (const [p, x] of [[crew.capt, -EYE.x], [crew.fo, EYE.x]]) {
      const app = crewAppearance(r, { female: FEMALE.test(p.name), name: p.name });
      app.top = '#f3f4f6'; app.scarf = null; app.jacket = false; // jackets off in the seat: white shirt
      const h = new Human(app, { detail: 2 });
      h.root.position.set(x, 0.49 - 0.84 * h.s, -4.62); h.root.rotation.y = Math.PI;
      this.group.add(h.root);
      this.pilots.push({ h, p, x, look: 0, lookT: 2 + r() * 4, lookTgt: 0 });
    }
  }

  // Per frame, only while someone can see the flight deck
  update(dt, S, visible) {
    this.t += dt;
    const fm = S.fm, afs = fm.afs, c = fm.ctl;
    // levers and sticks follow the crew's hands
    for (let i = 0; i < 2; i++) this.thrLevers[i].rotation.x = -0.75 * clamp(c.thr[i], -1, 1);
    this.flapLever.rotation.x = -c.flapLever * 0.18;
    this.sbLever.rotation.x = -(c.speedbrake || 0) * 0.5;
    for (const s of this.sticks) { s.pivot.rotation.x = -c.stickY * 0.3; s.pivot.rotation.z = -c.stickX * 0.3; }
    for (const p of this.pedals) p.m.position.z = -5.78 + (p.dx < 0 ? 1 : -1) * c.pedal * 0.04;
    this.gearLever.position.y = c.gearLever ? 0.6 : 0.66;
    for (const l of this.gearLights) l.material.color.set(fm.gear > 0.99 ? '#22dd33' : fm.gear > 0.01 ? '#ff2b2b' : '#111');
    // pilots: heads scan the instruments and look out; the pilot flying's hand on the stick
    if (this.pilots) for (const pl of this.pilots) {
      pl.lookT -= dt; if (pl.lookT < 0) { pl.lookT = 1.5 + this.r() * 5; pl.lookTgt = (this.r() - 0.5) * 1.2; pl.pitchTgt = this.r() < 0.5 ? -0.25 : 0.05; }
      pl.look += (pl.lookTgt - pl.look) * Math.min(1, dt * 3);
      const manual = !afs.ap && S.crew && S.crew.pf === pl.p && !fm.onGround;
      const armOut = pl.x < 0 ? { lShoulder: [-0.7, 0, -0.35], lElbow: [-0.9, 0.3, 0] } : { rShoulder: [-0.7, 0, 0.35], rElbow: [-0.9, -0.3, 0] };
      pl.h.setPose(composePose(POSES.stand, POSES.sit, manual ? armOut : {}, { neck: [(pl.pitchTgt || 0) * 0.6, pl.look * 0.6, 0], head: [(pl.pitchTgt || 0) * 0.4, pl.look * 0.4, 0] }));
    }
    if (!visible) return;
    this.drawT -= dt;
    if (this.drawT > 0) return;
    this.drawT = 0.2;
    const d = this._data(S);
    for (const du of this.displays) du.draw(du.kind === 'nd' ? { ...d, ...d.ndFor } : d);
    // FCU windows
    const g = this.fcuCanvas.getContext('2d'); g.fillStyle = '#0b0d10'; g.fillRect(0, 0, 512, 48); g.fillStyle = '#ffb347'; g.font = 'bold 30px monospace';
    g.fillText(afs.fcu.spd ? String(Math.round(afs.fcu.spd)) : '---', 20, 36); g.fillText(afs.fcu.hdg != null ? String(Math.round(afs.fcu.hdg)).padStart(3, '0') : '---', 140, 36); g.fillText(String(afs.fcu.alt).padStart(5, '0'), 262, 36); g.fillText(afs.vert === 'V/S' ? String(afs.fcu.vs) : '-----', 400, 36);
    this.fcuWin.needsUpdate = true;
  }

  _data(S) {
    const fm = S.fm, afs = fm.afs, air = fm.air || {};
    const w = fm.wind || {}; const wd = Math.hypot(w.wx || 0, w.wz || 0); const from = ((Math.atan2(-(w.wx || 0), (w.wz || 0)) / DEG) + 360) % 360;
    const sat = (air.T ?? 288) - 273.15, tat = sat + (air.T ?? 288) * 0.2 * fm.mach * fm.mach;
    const egt = fm.n1.map((n, i) => (fm.engineRunning[i] ? 380 + 520 * Math.max(0, n - 0.2) ** 1.4 : Math.max(20, sat + 10)));
    const memo = [];
    if (fm.onGround && fm.phase !== 'takeoff') memo.push({ t: `T.O ${fm.ctl.autobrake === 'MAX' ? 'AUTO BRK MAX' : 'CONFIG'}` });
    if (fm.ctl.parkBrake) memo.push({ t: 'PARK BRK', c: '#35e05a' });
    if (S.director?.seatbelt) memo.push({ t: 'SEAT BELTS', c: '#35e05a' });
    if (fm.ctl.spoilersArmed) memo.push({ t: 'GND SPLRS ARMED', c: '#35e05a' });
    for (let i = 0; i < 2; i++) if (fm.engFire[i]) memo.unshift({ t: `ENG ${i + 1} FIRE`, c: '#ff2b2b' }); else if (fm.engFail[i]) memo.unshift({ t: `ENG ${i + 1} FAIL`, c: '#ffae00' });
    if (!fm.pressurised) memo.unshift({ t: 'CAB PR EXCESS CAB ALT', c: '#ff2b2b' });
    // route ahead for the navigation display (north-up rotated to the heading), 1 NM = 5 px at 40 NM
    const ndScale = 280 / 40 / 1852, pts = [], tp = {}, hd = fm.heading;
    for (let s = fm.s; s < fm.s + 90000 && s < fm.route.path.length; s += 2500) { fm.route.path.sample(s, tp); const dx = tp.x - fm.pos.x, dz = tp.z - fm.pos.z; pts.push([dx * Math.cos(hd) + dz * Math.sin(hd), dx * Math.sin(hd) - dz * Math.cos(hd)]); }
    const vls = afs.vls ? afs.vls(Math.min(5, Math.round(fm.cfgf ?? 0))) : 0;
    return {
      fma: afs.fma(), ias: fm.ias, mach: fm.mach, alt: fm.altInd / FT, vs: fm.vs / FT * 60, pitch: fm.pitch, bank: fm.bank, hdg: ((fm.heading / DEG) + 360) % 360,
      std: fm.baro == null, qnh: fm.baro ? Math.round(fm.baro) : '', fcuAlt: afs.fcu.alt, spd: afs.spdTarget, vls: fm.onGround ? 0 : vls,
      warn: fm.stallWarn ? 'STALL' : fm.overspeed ? 'OVERSPEED' : '',
      gs: fm.gs / KT, tas: fm.tas / KT, wind: wd < 0.5 ? 'CALM' : `${String(Math.round(from)).padStart(3, '0')}°/${Math.round(wd / KT)}`,
      dest: fm.airport === 'ARN' ? 'ESSA' : 'EKCH', distNm: (fm.m.stand - fm.s) / 1852, route: pts, ndScale,
      n1: fm.n1.map((n) => n * 100), egt, ff: fm.ff || [0, 0], fail: fm.engFail, fob: fm.fuel,
      flaps: ['0', '1', '1+F', '2', '3', 'FULL'][fm.cfgTarget] || '0', memo,
      sdPage: fm.onGround ? 'WHEEL' : 'CRUISE',
      sdRows: fm.onGround
        ? [['BRAKES', fm.ctl.parkBrake ? 'PARK' : 'RELEASED'], ['AUTO BRK', fm.ctl.autobrake], ['NW STEER', `${Math.round(fm.steer / DEG)}°`], ['GEAR', 'DN LOCKED'], ['HYD G/B/Y', `${fm.hyd.green ? 3000 : 0}/${fm.hyd.blue ? 3000 : 0}/${fm.hyd.yellow ? 3000 : 0}`]]
        : [['CAB ALT', `${Math.round(fm.cabinAlt / FT / 50) * 50} FT`, fm.cabinAlt > 3048 ? '#ff2b2b' : null], ['CAB V/S', '0 FT/MIN'], ['DELTA P', `${fm.pressurised ? Math.max(0, Math.min(8.3, (fm.h - fm.cabinAlt) / 1200)).toFixed(1) : '0.0'} PSI`], ['FUEL USED', `${Math.round(Math.max(0, (S._fuel0 ??= fm.fuel) - fm.fuel))} KG`], ['OIL 1/2', '17 / 17 QT'], ['VIB N1', '0.3 / 0.3']],
      tat, sat, utc: S.utc || '', gw: fm.mass,
    };
  }

  // what the player can reach standing: from the cockpit door to behind the pilots' seats
  walkable(x, z) { return z > -3.95 && z < COCKPIT_DOOR_Z + 0.1 && Math.abs(x) < 0.34; }
}
