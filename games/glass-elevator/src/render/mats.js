/**
 * Materials and the textures drawn for them on a canvas: brushed stainless steel, painted steel,
 * granite, the tower's mirror-glass curtain wall, the city's windows, paving; and the label atlas
 * (floor numbers, arrows, symbols) for the buttons and signs, and the dot-matrix displays.
 */
import { MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial, CanvasTexture, RepeatWrapping, SRGBColorSpace, PlaneGeometry, BufferAttribute, Mesh, Color } from 'three';

const S = (o) => new MeshStandardMaterial(o);

function canvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function noise(g, w, h, a, n = 4000) { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); } }

// the curtain wall: one module 1.5 m wide, one storey (3.9 m) high, with its spandrel and mullions
const facadeTex = () => canvas(128, 332, (g, w, h) => {
  g.fillStyle = '#2b3946'; g.fillRect(0, 0, w, h);
  const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, '#34485a'); grad.addColorStop(1, '#1d2a35');
  g.fillStyle = grad; g.fillRect(4, 4, w - 8, h * 0.74);
  g.fillStyle = '#1a232c'; g.fillRect(4, h * 0.77, w - 8, h * 0.21);      // spandrel
  g.fillStyle = '#9aa3aa'; g.fillRect(0, 0, 4, h); g.fillRect(w - 4, 0, 4, h); g.fillRect(0, h * 0.755, w, 5); g.fillRect(0, h - 3, w, 3);
});
const cityTex = (tone) => canvas(128, 128, (g, w, h) => {
  g.fillStyle = tone; g.fillRect(0, 0, w, h);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const lit = Math.random(); g.fillStyle = lit > 0.85 ? '#7d7a6a' : `hsl(205, 15%, ${10 + lit * 12}%)`; g.fillRect(x * 32 + 5, y * 32 + 6, 22, 18); }
  noise(g, w, h, 0.05, 600);
});
const paverTex = () => canvas(256, 256, (g, w, h) => {
  g.fillStyle = '#8a8580'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) { const l = 52 + Math.random() * 10; g.fillStyle = `hsl(30, 5%, ${l}%)`; g.fillRect(x * 64 + (y % 2) * 32 + 1, y * 32 + 1, 62, 30); }
  noise(g, w, h, 0.08);
});
const graniteTex = (base) => canvas(256, 256, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); noise(g, w, h, 0.25, 9000); });
const brushedTex = () => canvas(256, 256, (g, w, h) => { g.fillStyle = '#c9cdd0'; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '90,95,100'},${Math.random() * 0.12})`; g.fillRect(0, Math.random() * h, w, 1); } });
const concreteTex = () => canvas(256, 256, (g, w, h) => { g.fillStyle = '#9b9a96'; g.fillRect(0, 0, w, h); noise(g, w, h, 0.12, 7000); });

export function makeMaterials() {
  const brushed = brushedTex();
  const facade = facadeTex(); facade.repeat.set(1, 1);
  const M = {
    stainless: S({ color: 0xd8dcdf, metalness: 1, roughness: 0.32, map: brushed }),
    mirrorSteel: S({ color: 0xe6e9eb, metalness: 1, roughness: 0.12 }),
    steel: S({ color: 0x5d6368, metalness: 0.85, roughness: 0.45 }),
    rail: S({ color: 0x9aa0a4, metalness: 1, roughness: 0.22 }),
    railWeb: S({ color: 0x2c2f31, metalness: 0.6, roughness: 0.6 }),
    rope: S({ color: 0x55585a, metalness: 1, roughness: 0.42 }),
    paintGrey: S({ color: 0x4b5157, metalness: 0.2, roughness: 0.55 }),
    paintDark: S({ color: 0x24282c, metalness: 0.25, roughness: 0.5 }),
    paintYellow: S({ color: 0xd8a514, metalness: 0.1, roughness: 0.5 }),
    paintRed: S({ color: 0xa3201b, metalness: 0.1, roughness: 0.45 }),
    paintBlue: S({ color: 0x1f4f8a, metalness: 0.2, roughness: 0.45 }),
    paintGreen: S({ color: 0x2f6b3d, metalness: 0.1, roughness: 0.5 }),
    cabinet: S({ color: 0xc9c8c1, metalness: 0.1, roughness: 0.5 }),
    motor: S({ color: 0x2d3e52, metalness: 0.35, roughness: 0.4 }),
    castIron: S({ color: 0x3a3b3c, metalness: 0.7, roughness: 0.6 }),
    rubber: S({ color: 0x151515, metalness: 0, roughness: 0.85 }),
    concrete: S({ color: 0xffffff, metalness: 0, roughness: 0.9, map: concreteTex() }),
    plaster: S({ color: 0xe8e4dc, metalness: 0, roughness: 0.85 }),
    ceiling: S({ color: 0xf1efe9, metalness: 0, roughness: 0.9 }),
    wood: S({ color: 0x8a5a36, metalness: 0, roughness: 0.6 }),
    lobbyFloor: S({ color: 0xffffff, metalness: 0, roughness: 0.25, map: graniteTex('#3c3a38') }),
    carpet: S({ color: 0x4a5058, metalness: 0, roughness: 0.95 }),
    carFloor: S({ color: 0xffffff, metalness: 0, roughness: 0.3, map: graniteTex('#262626') }),
    paver: S({ color: 0xffffff, metalness: 0, roughness: 0.8, map: paverTex() }),
    asphalt: S({ color: 0x2f3133, metalness: 0, roughness: 0.92 }),
    grass: S({ color: 0x3d5229, metalness: 0, roughness: 0.95 }),
    water: S({ color: 0x0b1820, metalness: 0, roughness: 0.06 }),
    curtain: new MeshPhysicalMaterial({ color: 0x9fb0be, metalness: 0.75, roughness: 0.07, map: facade, clearcoat: 0.6 }),
    aluminium: S({ color: 0xb6bcc1, metalness: 1, roughness: 0.35 }),
    cityA: S({ color: 0xffffff, metalness: 0.3, roughness: 0.4, map: cityTex('#3b4044') }),
    cityB: S({ color: 0xffffff, metalness: 0.1, roughness: 0.7, map: cityTex('#8f8174') }),
    cityC: S({ color: 0xffffff, metalness: 0.5, roughness: 0.2, map: cityTex('#26333d') }),
    cardboard: S({ color: 0xa47a4c, metalness: 0, roughness: 0.85 }),
    plastic: S({ color: 0x1d1f22, metalness: 0, roughness: 0.4 }),
    orange: S({ color: 0xe0561b, metalness: 0, roughness: 0.5 }),
    leaf: S({ color: 0x2f5a25, metalness: 0, roughness: 0.8 }),
    // lights and lit things
    lampPanel: S({ color: 0x000000, emissive: new Color(1, 0.95, 0.86), emissiveIntensity: 1.6 }),
    downlight: S({ color: 0x000000, emissive: new Color(1, 0.93, 0.82), emissiveIntensity: 6 }),
    btnRing: S({ color: 0x8a8f93, metalness: 1, roughness: 0.3 }),
    btnLit: S({ color: 0x000000, emissive: new Color(1, 0.62, 0.25), emissiveIntensity: 3 }),
    btnOff: S({ color: 0x1a1c1e, metalness: 0.3, roughness: 0.35 }),
    upLit: S({ color: 0x000000, emissive: new Color(0.3, 1, 0.45), emissiveIntensity: 3 }),
    downLit: S({ color: 0x000000, emissive: new Color(1, 0.25, 0.2), emissiveIntensity: 3 }),
    redLit: S({ color: 0x000000, emissive: new Color(1, 0.12, 0.08), emissiveIntensity: 3 }),
    greenLit: S({ color: 0x000000, emissive: new Color(0.2, 1, 0.3), emissiveIntensity: 3 }),
    amberLit: S({ color: 0x000000, emissive: new Color(1, 0.7, 0.1), emissiveIntensity: 3 }),
    lensOff: S({ color: 0x222426, metalness: 0, roughness: 0.2 }),
  };
  return M;
}

// ---------------------------------------------------------------------------------------------
// The label atlas: everything printed or engraved, in 64 x 64 cells (or wider strips for words)

export class Labels {
  constructor() {
    this.c = document.createElement('canvas'); this.c.width = 2048; this.c.height = 1024;
    this.g = this.c.getContext('2d');
    this.g.fillStyle = '#000'; this.g.fillRect(0, 0, 2048, 1024);
    this.at = new Map(); this.x = 0; this.y = 0; this.rowH = 0;
    this.tex = new CanvasTexture(this.c); this.tex.colorSpace = SRGBColorSpace; this.tex.anisotropy = 8;
    this.engraved = new MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.5, map: this.tex });
    // lit lettering: unlit, so the label's own colour is what it gives off
    this.glow = new MeshBasicMaterial({ color: new Color(0.55, 0.55, 0.55), map: this.tex });
    this.glowGreen = new MeshBasicMaterial({ color: new Color(0.12, 0.7, 0.22), map: this.tex });
  }

  /** Reserves a w x h pixel cell for key, drawn by draw(g, w, h) (white on black). */
  cell(key, w, h, draw) {
    if (this.at.has(key)) return this.at.get(key);
    if (this.x + w > 2048) { this.x = 0; this.y += this.rowH + 2; this.rowH = 0; }
    const g = this.g, x = this.x, y = this.y;
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip();
    g.fillStyle = '#fff'; g.strokeStyle = '#fff';
    draw(g, w, h);
    g.restore();
    const r = { u0: x / 2048, v0: 1 - (y + h) / 1024, u1: (x + w) / 2048, v1: 1 - y / 1024, w, h };
    this.at.set(key, r);
    this.x += w + 2; this.rowH = Math.max(this.rowH, h);
    this.tex.needsUpdate = true;
    return r;
  }
  text(key, txt, { w = 64, h = 64, size = 40, weight = 600, font = 'Inter, Helvetica, Arial, sans-serif' } = {}) {
    return this.cell(key, w, h, (g, W, H) => { g.font = `${weight} ${size}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, W / 2, H / 2 + size * 0.04); });
  }
  symbol(key) {
    return this.cell(key, 64, 64, (g) => {
      g.lineWidth = 5; g.lineJoin = 'round';
      const tri = (pts) => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.closePath(); g.fill(); };
      if (key === 'up') tri([[32, 12], [52, 44], [12, 44]]);
      if (key === 'down') tri([[32, 52], [52, 20], [12, 20]]);
      if (key === 'open') { tri([[6, 32], [24, 18], [24, 46]]); tri([[58, 32], [40, 18], [40, 46]]); g.fillRect(30, 12, 4, 40); }
      if (key === 'close') { tri([[28, 32], [10, 18], [10, 46]]); tri([[36, 32], [54, 18], [54, 46]]); g.fillRect(30, 12, 4, 40); }
      if (key === 'bell') { g.beginPath(); g.moveTo(14, 46); g.quadraticCurveTo(18, 14, 32, 12); g.quadraticCurveTo(46, 14, 50, 46); g.closePath(); g.fill(); g.beginPath(); g.arc(32, 50, 5, 0, Math.PI * 2); g.fill(); }
      if (key === 'key') { g.beginPath(); g.arc(22, 32, 11, 0, Math.PI * 2); g.lineWidth = 6; g.stroke(); g.fillRect(32, 29, 24, 6); g.fillRect(48, 35, 5, 9); }
      if (key === 'fire') { g.beginPath(); g.moveTo(32, 8); g.quadraticCurveTo(54, 34, 44, 52); g.quadraticCurveTo(32, 60, 20, 52); g.quadraticCurveTo(10, 34, 32, 8); g.fill(); }
      if (key === 'triangle') { g.lineWidth = 6; g.beginPath(); g.moveTo(32, 12); g.lineTo(54, 50); g.lineTo(10, 50); g.closePath(); g.stroke(); }
    });
  }

  /** A flat rectangle w x h (m) showing the cell, facing +z. */
  quad(cell, w, h, mat = this.engraved) {
    const g = new PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    uv.setXY(0, cell.u0, cell.v1); uv.setXY(1, cell.u1, cell.v1); uv.setXY(2, cell.u0, cell.v0); uv.setXY(3, cell.u1, cell.v0);
    void BufferAttribute;
    return new Mesh(g, mat);
  }
}

/** A dot-matrix (or TFT) display: a canvas the controller's state is drawn on, glowing. */
export class Display {
  constructor(w = 192, h = 96) {
    this.c = document.createElement('canvas'); this.c.width = w; this.c.height = h;
    this.g = this.c.getContext('2d');
    this.tex = new CanvasTexture(this.c); this.tex.colorSpace = SRGBColorSpace;
    this.mat = new MeshStandardMaterial({ color: 0x000000, emissive: new Color(1, 1, 1), emissiveMap: this.tex, emissiveIntensity: 2.4, roughness: 0.2 });
    this.key = '';
  }
  draw(text, dir, msg, colour = '#ff8a2a') {
    const key = text + '|' + dir + '|' + msg;
    if (key === this.key) return;
    this.key = key;
    const g = this.g, W = this.c.width, H = this.c.height;
    g.fillStyle = '#050505'; g.fillRect(0, 0, W, H);
    g.fillStyle = colour;
    if (dir) { g.beginPath(); const x = W * 0.2, y = H * 0.42, s = H * 0.22; if (dir > 0) { g.moveTo(x, y - s); g.lineTo(x + s, y + s * 0.6); g.lineTo(x - s, y + s * 0.6); } else { g.moveTo(x, y + s); g.lineTo(x + s, y - s * 0.6); g.lineTo(x - s, y - s * 0.6); } g.fill(); }
    g.font = `700 ${Math.round(H * 0.55)}px Inter, Helvetica, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, W * 0.62, H * 0.42);
    if (msg) { g.font = `600 ${Math.round(H * 0.17)}px Inter, Helvetica, Arial, sans-serif`; g.fillText(msg, W / 2, H * 0.86); }
    this.tex.needsUpdate = true;
  }
}
