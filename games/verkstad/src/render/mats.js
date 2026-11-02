/**
 * Materials, and the textures drawn for them on canvases: car paint with its clear coat, cast iron
 * and machined steel, the tyre's tread and sidewall, friction material, brake discs with their
 * machining rings, a workshop floor of painted concrete with its oil stains, pegboard, rubber,
 * the plastics of an engine bay. Names match the shapes' `m` in car/assembly.js.
 */
import { MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial, CanvasTexture, RepeatWrapping, SRGBColorSpace, Color, FrontSide } from 'three';

const S = (o) => new MeshStandardMaterial(o);

export function canvasTex(w, h, draw, { repeat = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function noise(g, w, h, a, n = 4000, dark = 0.5) { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${Math.random() < dark ? '0,0,0' : '255,255,255'},${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); } }

const floorTex = () => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#7b8086'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 0.08, 9000);
  for (let i = 0; i < 9; i++) { const x = Math.random() * w, y = Math.random() * h, r = 10 + Math.random() * 50; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(20,18,14,0.35)'); gr.addColorStop(1, 'rgba(20,18,14,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  g.strokeStyle = 'rgba(40,40,40,0.4)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
});
const tyreTex = () => canvasTex(64, 512, (g, w, h) => {
  g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) { g.fillStyle = '#0e0e0e'; g.fillRect(8, y, 4, 10); g.fillRect(w - 12, y + 6, 4, 10); g.fillRect(20, y + 3, w - 40, 3); }
  g.fillStyle = '#0c0c0c'; g.fillRect(w * 0.33, 0, 3, h); g.fillRect(w * 0.66, 0, 3, h);
  noise(g, w, h, 0.06, 1500);
});
const discTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#8c8d8e'; g.fillRect(0, 0, w, h);
  for (let r = 4; r < w / 2; r += 2) { g.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '40,40,40'},${Math.random() * 0.12})`; g.beginPath(); g.arc(w / 2, h / 2, r, 0, Math.PI * 2); g.stroke(); }
  noise(g, w, h, 0.1, 1200);
}, { repeat: false });
const pegTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#c9b48a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#3a3226'; for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) { g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill(); }
});
const brickTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#bfbab0'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) { g.fillStyle = `hsl(40,6%,${68 + Math.random() * 8}%)`; g.fillRect(x * 64 + (y % 2) * 32 + 1, y * 32 + 1, 62, 30); }
  noise(g, w, h, 0.06, 2000);
});
const corrTex = () => canvasTex(128, 128, (g, w, h) => { for (let x = 0; x < w; x++) { const v = 150 + 40 * Math.sin((x / w) * Math.PI * 8); g.fillStyle = `rgb(${v * 0.9},${v * 0.93},${v})`; g.fillRect(x, 0, 1, h); } });
const fabricTex = () => canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#4a4d52'; g.fillRect(0, 0, w, h); for (let i = 0; i < w; i += 2) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(i, 0, 1, h); g.fillRect(0, i, w, 1); } noise(g, w, h, 0.08, 1500); });
const asphaltTex = () => canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#3b3d3f'; g.fillRect(0, 0, w, h); noise(g, w, h, 0.18, 9000); });
const radTex = () => canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#26282a'; g.fillRect(0, 0, w, h); g.fillStyle = '#5b5f62'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1); for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h); });
const plankTex = () => canvasTex(64, 256, (g, w, h) => { g.fillStyle = '#c7a26b'; g.fillRect(0, 0, w, h); noise(g, w, h, 0.12, 900); });
const carbonTex = () => canvasTex(64, 64, (g, w, h) => { for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { g.fillStyle = (x + y) % 16 ? '#1a1b1d' : '#2a2c30'; g.fillRect(x, y, 8, 8); } });


// ---- details traced from reference photos (docs/references.md): lamps, grilles, trim, tyres, interior
const lensTex = (kind) => canvasTex(256, 128, (g, w, h) => {
  if (kind === 'volvo') {
    // a 240's rectangular headlamp: a fluted glass over a deep reflector, the amber indicator at the outer end
    g.fillStyle = '#c9ced2'; g.fillRect(0, 0, w, h);
    const gr = g.createRadialGradient(w * 0.42, h * 0.5, 4, w * 0.42, h * 0.5, w * 0.4); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#d8dde1'); gr.addColorStop(1, '#7e868c');
    g.fillStyle = gr; g.fillRect(0, 0, w * 0.8, h);
    for (let x = 0; x < w * 0.8; x += 6) { g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x, 0, 2, h); }
    for (let y = 0; y < h; y += 10) { g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, y, w * 0.8, 1); }
    const am = g.createLinearGradient(w * 0.8, 0, w, 0); am.addColorStop(0, '#f08a10'); am.addColorStop(1, '#c86400'); g.fillStyle = am; g.fillRect(w * 0.8, 0, w * 0.2, h);
    for (let y = 0; y < h; y += 8) { g.fillStyle = 'rgba(255,220,150,0.25)'; g.fillRect(w * 0.8, y, w * 0.2, 2); }
    g.strokeStyle = '#e8ecef'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); g.fillStyle = '#e8ecef'; g.fillRect(w * 0.8 - 2, 0, 4, h);
  } else if (kind === 'golf') {
    // a Golf VII's headlamp: black housing, two projector lenses, the chrome bar, LED running light along the bottom
    g.fillStyle = '#16191c'; g.fillRect(0, 0, w, h);
    for (const [x, r] of [[w * 0.3, 30], [w * 0.62, 26]]) { const gr = g.createRadialGradient(x, h * 0.48, 2, x, h * 0.48, r); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, '#9aa6b0'); gr.addColorStop(1, '#2a3036'); g.fillStyle = gr; g.beginPath(); g.arc(x, h * 0.48, r, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#c8ced2'; g.lineWidth = 4; g.stroke(); }
    g.fillStyle = '#d6dadc'; g.fillRect(w * 0.05, h * 0.08, w * 0.9, 5);
    g.fillStyle = '#f4f7fa'; g.fillRect(w * 0.08, h * 0.84, w * 0.78, 6);
  } else if (kind === 'tailVolvo') {
    // the 240 saloon's tall rear lamps: red tail and stop, amber indicator, white reversing, ribbed
    const bands = [['#9a0f12', 0.42], ['#d07010', 0.2], ['#e8e8e4', 0.14], ['#8a0d10', 0.24]];
    let y = 0; for (const [c, f] of bands) { g.fillStyle = c; g.fillRect(0, y, w, h * f); y += h * f; }
    for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, 0, 3, h); }
    g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  } else {
    // the Golf's rear lamp: deep red with the L of its tail light
    g.fillStyle = '#5c0608'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c4161b'; g.fillRect(w * 0.1, h * 0.25, w * 0.8, 10); g.fillRect(w * 0.1, h * 0.25, 10, h * 0.55);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(w * 0.55, h * 0.55, w * 0.3, h * 0.25);
  }
}, { repeat: false });
const grilleTex = (kind) => canvasTex(256, 96, (g, w, h) => {
  g.fillStyle = '#0c0d0e'; g.fillRect(0, 0, w, h);
  if (kind === 'volvo') { for (let x = 6; x < w; x += 7) { g.fillStyle = '#2a2c2e'; g.fillRect(x, 4, 3, h - 8); } g.strokeStyle = '#dfe3e6'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); g.lineWidth = 7; g.beginPath(); g.moveTo(w * 0.62, 8); g.lineTo(w * 0.4, h - 8); g.stroke(); }
  else if (kind === 'honeycomb') { for (let y = 0; y < h; y += 10) for (let x = (y / 10) % 2 ? 6 : 0; x < w; x += 12) { g.strokeStyle = '#2b2e31'; g.lineWidth = 2; g.strokeRect(x, y, 9, 7); } }
  else { for (let y = 8; y < h; y += 14) { g.fillStyle = '#25282b'; g.fillRect(0, y, w, 5); } g.fillStyle = '#d6dadc'; g.fillRect(0, h * 0.62, w, 5); }
}, { repeat: false });
const tyreSideTex = (size) => canvasTex(2048, 128, (g, w, h) => {
  // around the tyre (x) by across it (y): both sidewalls with their size and load marking, the tread between
  g.fillStyle = '#18181a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#0d0d0e'; for (let x = 0; x < w; x += 18) { g.fillRect(x, h * 0.36, 8, h * 0.28); g.fillRect(x + 9, h * 0.3, 3, h * 0.4); }
  g.fillRect(0, h * 0.42, w, 3); g.fillRect(0, h * 0.58, w, 3);
  g.fillStyle = '#3a3a3c'; g.font = '700 22px Arial, Helvetica, sans-serif'; g.textBaseline = 'middle';
  for (const y of [h * 0.12, h * 0.88]) for (let x = 40; x < w; x += 1000) { g.fillText(`${size}   88T   M+S   TUBELESS   RADIAL`, x, y); }
}, { repeat: true });
const leatherTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#1e1d1c'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 32) { const gr = g.createLinearGradient(x, 0, x + 32, 0); gr.addColorStop(0, '#0f0f0f'); gr.addColorStop(0.5, '#2c2a28'); gr.addColorStop(1, '#0f0f0f'); g.fillStyle = gr; g.fillRect(x, 0, 32, h); }
  noise(g, w, h, 0.06, 2500);
});
const woodTex = () => canvasTex(256, 32, (g, w, h) => { g.fillStyle = '#8a4f22'; g.fillRect(0, 0, w, h); for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(60,25,8,${0.15 + Math.random() * 0.2})`; g.beginPath(); g.moveTo(0, Math.random() * h); g.bezierCurveTo(w / 3, Math.random() * h, w * 0.66, Math.random() * h, w, Math.random() * h); g.stroke(); } });
const ventTex = () => canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, w, h); for (let y = 4; y < h; y += 8) { g.fillStyle = '#2a2a2a'; g.fillRect(2, y, w - 4, 3); } });
const gaugesTex = () => canvasTex(512, 128, (g, w, h) => {
  g.fillStyle = '#050505'; g.fillRect(0, 0, w, h);
  for (const [x, r, max] of [[110, 52, 8], [256, 56, 22], [410, 44, 4]]) { g.strokeStyle = '#d9d9d2'; g.lineWidth = 2; g.beginPath(); g.arc(x, 70, r, Math.PI * 0.8, Math.PI * 2.2); g.stroke(); for (let i = 0; i <= max; i++) { const a = Math.PI * 0.8 + (i / max) * Math.PI * 1.4; g.beginPath(); g.moveTo(x + Math.cos(a) * (r - 8), 70 + Math.sin(a) * (r - 8)); g.lineTo(x + Math.cos(a) * r, 70 + Math.sin(a) * r); g.stroke(); } g.fillStyle = '#ff6a1a'; g.save(); g.translate(x, 70); g.rotate(Math.PI * 0.85); g.fillRect(0, -1.5, r - 10, 3); g.restore(); }
}, { repeat: false });

export function makeMaterials() {
  const disc = discTex();
  const tyre = tyreTex(); tyre.repeat.set(1, 1);
  const floor = floorTex(); floor.repeat.set(6, 5);
  const carbon = carbonTex(); carbon.repeat.set(30, 30);
  const M = {
    // car finishes
    paint: new MeshPhysicalMaterial({ color: 0x7d1e22, metalness: 0.1, roughness: 0.32, clearcoat: 0.9 }),
    chrome: S({ color: 0xe8ecef, metalness: 1, roughness: 0.08 }),
    glass: new MeshStandardMaterial({ color: 0x06090c, metalness: 0.0, roughness: 0.06, side: FrontSide }),
    lens: S({ color: 0xd8dde0, metalness: 0.4, roughness: 0.05 }),
    lensRed: S({ color: 0x8a0d10, metalness: 0.2, roughness: 0.15 }),
    lensAmber: S({ color: 0xc87010, metalness: 0.2, roughness: 0.15 }),
    rubber: S({ color: 0x141414, metalness: 0, roughness: 0.88 }),
    tyre: S({ color: 0xffffff, metalness: 0, roughness: 0.9, map: tyre }),
    tyreYellow: S({ color: 0xe8c21a, metalness: 0, roughness: 0.6 }),
    rimSilver: S({ color: 0xb9bdc0, metalness: 0.9, roughness: 0.35 }),
    rimAlu: S({ color: 0xc8ccd0, metalness: 1, roughness: 0.22 }),
    rimDark: S({ color: 0x2b2d30, metalness: 0.8, roughness: 0.4 }),
    // metals
    steel: S({ color: 0x8e9398, metalness: 0.9, roughness: 0.4 }),
    castIron: S({ color: 0x45474a, metalness: 0.7, roughness: 0.7 }),
    alu: S({ color: 0xa9adb1, metalness: 0.85, roughness: 0.45 }),
    titanium: S({ color: 0x8a8d90, metalness: 1, roughness: 0.3 }),
    copper: S({ color: 0xb86f3e, metalness: 1, roughness: 0.35 }),
    lead: S({ color: 0x8b8e90, metalness: 0.6, roughness: 0.5 }),
    brakeDisc: S({ color: 0xffffff, metalness: 0.8, roughness: 0.45, map: disc }),
    carbonDisc: S({ color: 0x2e2c2a, metalness: 0.1, roughness: 0.8 }),
    padFriction: S({ color: 0x3b3631, metalness: 0.2, roughness: 0.95 }),
    exhaust: S({ color: 0x6a6460, metalness: 0.6, roughness: 0.75 }),
    exhaustHot: S({ color: 0x5b4f48, metalness: 0.6, roughness: 0.6 }),
    springPaint: S({ color: 0x23272b, metalness: 0.5, roughness: 0.45 }),
    paintBlack: S({ color: 0x1b1d1f, metalness: 0.3, roughness: 0.55 }),
    caliperPaint: S({ color: 0x8e1b18, metalness: 0.3, roughness: 0.45 }),
    // engine
    redBlock: S({ color: 0x9c2a1c, metalness: 0.25, roughness: 0.6 }),
    engineGrey: S({ color: 0x55585b, metalness: 0.6, roughness: 0.6 }),
    camCoverVolvo: S({ color: 0x1d1e20, metalness: 0.4, roughness: 0.5 }),
    blackPlastic: S({ color: 0x18191a, metalness: 0, roughness: 0.55 }),
    redPlastic: S({ color: 0xb01e1e, metalness: 0, roughness: 0.5 }),
    yellowCap: S({ color: 0xe8b51a, metalness: 0, roughness: 0.45 }),
    blueCap: S({ color: 0x2a5aa8, metalness: 0, roughness: 0.45 }),
    distCap: S({ color: 0x1a1a1a, metalness: 0, roughness: 0.3 }),
    leadRed: S({ color: 0x9a1d18, metalness: 0, roughness: 0.6 }),
    wire: S({ color: 0x1a1a1a, metalness: 0, roughness: 0.6 }),
    hvCable: S({ color: 0xf06b0a, metalness: 0, roughness: 0.5 }),
    orange: S({ color: 0xf06b0a, metalness: 0, roughness: 0.5 }),
    hose: S({ color: 0x161616, metalness: 0, roughness: 0.75 }),
    ceramic: S({ color: 0xf2efe8, metalness: 0, roughness: 0.3 }),
    filterBlue: S({ color: 0x1f4f9a, metalness: 0.3, roughness: 0.45 }),
    filterWhite: S({ color: 0xe9e9e4, metalness: 0.3, roughness: 0.45 }),
    filterPaper: S({ color: 0xd9cfae, metalness: 0, roughness: 0.95 }),
    batteryCase: S({ color: 0x232527, metalness: 0, roughness: 0.6 }),
    radiator: S({ color: 0xffffff, metalness: 0.5, roughness: 0.6, map: radTex() }),
    translucent: S({ color: 0xd8d4c4, metalness: 0, roughness: 0.35 }),
    translucentBlue: S({ color: 0x9ab8d8, metalness: 0, roughness: 0.35 }),
    fuseClear: S({ color: 0xd8dde0, metalness: 0, roughness: 0.2 }), fuseYellow: S({ color: 0xe8c21a, roughness: 0.3 }), fuseBlue: S({ color: 0x2a62c8, roughness: 0.3 }), fuseRed: S({ color: 0xc81e1e, roughness: 0.3 }), fuseTan: S({ color: 0xb59a6a, roughness: 0.3 }),
    bulbGlass: S({ color: 0xf6f6f2, metalness: 0.3, roughness: 0.05 }),
    redLens: S({ color: 0x300000, emissive: new Color(1, 0.05, 0.02), emissiveIntensity: 0 }),
    ersLight: S({ color: 0x050505, emissive: new Color(1, 0.05, 0.03), emissiveIntensity: 4 }),
    // interior
    dash: S({ color: 0x1e1f21, metalness: 0, roughness: 0.75 }),
    seatFabric: S({ color: 0xffffff, metalness: 0, roughness: 0.95, map: fabricTex() }),
    carpet: S({ color: 0x232426, metalness: 0, roughness: 1 }),
    clusterScreen: S({ color: 0x020202, emissive: new Color(1, 1, 1), emissiveIntensity: 1.2, roughness: 0.3 }),
    carbon: S({ color: 0xffffff, metalness: 0.3, roughness: 0.35, map: carbon }),
    plank: S({ color: 0xffffff, metalness: 0, roughness: 0.8, map: plankTex() }),
    // the workshop
    floor: S({ color: 0xffffff, metalness: 0, roughness: 0.55, map: floor }),
    wallBrick: S({ color: 0xffffff, metalness: 0, roughness: 0.9, map: brickTex() }),
    corrugated: S({ color: 0xffffff, metalness: 0.6, roughness: 0.45, map: corrTex() }),
    ceiling: S({ color: 0xd6d6d2, metalness: 0.2, roughness: 0.8 }),
    pegboard: S({ color: 0xffffff, metalness: 0, roughness: 0.85, map: pegTex() }),
    benchTop: S({ color: 0x8a6a45, metalness: 0, roughness: 0.7 }),
    toolRed: S({ color: 0xb0161b, metalness: 0.3, roughness: 0.35 }),
    liftBlue: S({ color: 0x1f4f9a, metalness: 0.35, roughness: 0.45 }),
    liftYellow: S({ color: 0xe0b012, metalness: 0.3, roughness: 0.5 }),
    shelfGrey: S({ color: 0x6a7076, metalness: 0.6, roughness: 0.5 }),
    cardboard: S({ color: 0xa47a4c, metalness: 0, roughness: 0.85 }),
    asphalt: S({ color: 0xffffff, metalness: 0, roughness: 0.92, map: asphaltTex() }),
    grass: S({ color: 0x3d5229, metalness: 0, roughness: 0.95 }),
    wood: S({ color: 0x8a5a36, metalness: 0, roughness: 0.6 }),
    whiteboard: S({ color: 0xf2f2ee, metalness: 0, roughness: 0.25 }),
    screen: S({ color: 0x020202, emissive: new Color(0.55, 0.7, 0.9), emissiveIntensity: 0.02, roughness: 0.3 }),
    ledPanel: S({ color: 0x000000, emissive: new Color(1, 0.97, 0.92), emissiveIntensity: 2.2 }),
    oilBlack: S({ color: 0x0a0806, metalness: 0.2, roughness: 0.05 }),
    highlight: new MeshBasicMaterial({ color: new Color(0.35, 0.8, 1.0) }),
    ghost: new MeshBasicMaterial({ color: new Color(0.2, 0.6, 0.3) }),
  };
  Object.assign(M, {
    lensVolvo: S({ color: 0xffffff, metalness: 0.3, roughness: 0.08, map: lensTex('volvo') }),
    lensGolf: S({ color: 0xffffff, metalness: 0.4, roughness: 0.06, map: lensTex('golf') }),
    tailVolvo: S({ color: 0xffffff, metalness: 0.1, roughness: 0.12, map: lensTex('tailVolvo') }),
    tailGolf: S({ color: 0xffffff, metalness: 0.1, roughness: 0.1, map: lensTex('tailGolf') }),
    grilleVolvo: S({ color: 0xffffff, metalness: 0.5, roughness: 0.35, map: grilleTex('volvo') }),
    grilleGolf: S({ color: 0xffffff, metalness: 0.3, roughness: 0.4, map: grilleTex('golf') }),
    honeycomb: S({ color: 0xffffff, metalness: 0.1, roughness: 0.6, map: grilleTex('honeycomb') }),
    trimBlack: S({ color: 0x111213, metalness: 0.1, roughness: 0.45 }),
    rubStrip: S({ color: 0x1a1b1c, metalness: 0.05, roughness: 0.6 }),
    leather: S({ color: 0xffffff, metalness: 0, roughness: 0.55, map: leatherTex() }),
    woodTrim: S({ color: 0xffffff, metalness: 0, roughness: 0.35, map: woodTex() }),
    vent: S({ color: 0xffffff, metalness: 0, roughness: 0.7, map: ventTex() }),
    gauges: S({ color: 0x000000, emissive: new Color(0.6, 0.6, 0.55), emissiveIntensity: 0.05, emissiveMap: gaugesTex(), roughness: 0.2 }),
    headliner: S({ color: 0xcfc8b8, metalness: 0, roughness: 0.95 }),
    mirrorGlass: S({ color: 0xdfe6ea, metalness: 1, roughness: 0.02 }),
    tyreVolvo: S({ color: 0xffffff, metalness: 0, roughness: 0.88, map: tyreSideTex('185/65 R15') }),
    tyreGolf: S({ color: 0xffffff, metalness: 0, roughness: 0.88, map: tyreSideTex('205/55 R16') }),
  });
  M.discTex = disc;
  return M;
}

/** A paint for this car: the body colour under a clear coat. */
export function paintMat(hex) { return new MeshPhysicalMaterial({ color: new Color(hex), metalness: 0.15, roughness: 0.3, clearcoat: 0.9 }); }
