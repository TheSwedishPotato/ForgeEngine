/**
 * Drawn textures for the Pullman cars: the riveted steel side (a normal map: rivet rows along
 * the side sill, the belt rail, the window heads and the letterboard, and up every window
 * post), the gold "PULLMAN" letterboard and the car's name, mahogany veneer for the panelling,
 * the carpet, and the plush of the chairs.
 */
import { CanvasTexture, RepeatWrapping, ClampToEdgeWrapping, LinearMipmapLinearFilter, LinearFilter, SRGBColorSpace } from 'three';

function canvas(w, h) {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
}
function tex(c, repeat = true) {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/**
 * Rivets as a normal map. u: 1 texture width = one window pitch (posts at u = 0); v covers the
 * side from the side sill (y 1.02) to the eaves (y 3.30): rivet rows at the given heights.
 */
export function rivetNormalMap({ pitch = 1.1, y0 = 1.02, y1 = 3.30, rows = [1.06, 1.24, 1.89, 2.90, 2.95, 3.26] } = {}) {
  const W = 256, H = 1024, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, W, H);
  const pxPerM = H / (y1 - y0), rivetR = 0.0095 * pxPerM;
  const bump = (x, y, r) => {
    // a domed rivet head: normal tilts outward from its centre
    const img = g.getImageData(Math.floor(x - r - 1), Math.floor(y - r - 1), Math.ceil(2 * r + 3), Math.ceil(2 * r + 3));
    const d = img.data, w = img.width;
    for (let j = 0; j < img.height; j++) for (let i = 0; i < w; i++) {
      const dx = (i + Math.floor(x - r - 1)) - x + 0.5, dy = (j + Math.floor(y - r - 1)) - y + 0.5, q = Math.hypot(dx, dy) / r;
      if (q >= 1) continue;
      const nz = Math.sqrt(1 - q * q * 0.7);
      const nx = (dx / r) * 0.75, ny = -(dy / r) * 0.75;
      const k = (j * w + i) * 4;
      d[k] = 128 + nx * 127; d[k + 1] = 128 + ny * 127; d[k + 2] = 128 + nz * 127;
    }
    g.putImageData(img, Math.floor(x - r - 1), Math.floor(y - r - 1));
  };
  const step = 0.075 / pitch * W;
  for (const yy of rows) {
    const py = H - (yy - y0) * pxPerM;
    for (let x = step / 2; x < W; x += step) bump(x, py, rivetR);
    // the seam: a faint groove above the row
    g.fillStyle = 'rgba(128,150,240,0.6)'; g.fillRect(0, py - rivetR * 2.4, W, 1.5);
  }
  // window posts: columns of rivets either side of u = 0
  for (const px of [6, W - 6]) for (let y = H - (1.95 - y0) * pxPerM; y > H - (2.86 - y0) * pxPerM; y -= 0.075 * pxPerM) bump(px, y, rivetR);
  const t = tex(c);
  t.colorSpace = '';
  return t;
}

/** Gold letters on the paint: the letterboard ("PULLMAN") or the car's name. */
export function letteringTexture(text, { w = 2048, h = 160, paint = '#1d3a43', gold = '#c8a24e', size = 104, spacing = 0.18, font = 'Playfair Display, Georgia, serif' } = {}) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = paint; g.fillRect(0, 0, w, h);
  g.font = `600 ${size}px ${font}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const letters = [...text];
  const widths = letters.map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * size * (letters.length - 1);
  let x = w / 2 - total / 2;
  // a dark shadow line under the gold (gilded and shaded letters)
  letters.forEach((ch, i) => {
    const cx = x + widths[i] / 2;
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(ch, cx + 3, h / 2 + 4);
    const grad = g.createLinearGradient(0, h / 2 - size / 2, 0, h / 2 + size / 2);
    grad.addColorStop(0, '#f1d792'); grad.addColorStop(0.45, gold); grad.addColorStop(1, '#8a6a2a');
    g.fillStyle = grad; g.fillText(ch, cx, h / 2);
    x += widths[i] + spacing * size;
  });
  const t = tex(c, false);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Mahogany veneer, quarter-sawn, with a varnish depth. 1 texture = 1 m. */
export function mahoganyTexture(seed = 4) {
  const W = 512, H = 512, c = canvas(W, H), g = c.getContext('2d'), r = rng(seed);
  const img = g.createImageData(W, H), d = img.data;
  const ph = Array.from({ length: 6 }, () => r() * 6.28);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const wave = Math.sin(v * 3 + ph[0]) * 0.02 + Math.sin(v * 11 + ph[1]) * 0.006;
    const grain = Math.sin((u + wave) * 180 + Math.sin(u * 23 + ph[2]) * 1.6) * 0.5 + 0.5;
    const fleck = Math.sin((u + wave) * 760 + ph[3]) * Math.sin(v * 37 + ph[4]);
    const k = 0.78 + grain * 0.22 + fleck * 0.03;
    d[(y * W + x) * 4] = 150 * k; d[(y * W + x) * 4 + 1] = 66 * k; d[(y * W + x) * 4 + 2] = 38 * k; d[(y * W + x) * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = tex(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A Wilton carpet: a small repeating pattern in deep green and burgundy. 1 texture = 1 m. */
export function carpetTexture({ base = '#2c3b2a', figure = '#5a1f22', line = '#8c7140' } = {}) {
  const W = 256, H = 256, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  g.strokeStyle = line; g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * 64); g.lineTo(W, i * 64); g.moveTo(i * 64, 0); g.lineTo(i * 64, H); g.stroke(); }
  g.fillStyle = figure;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const cx = i * 64 + 32, cy = j * 64 + 32;
    g.beginPath(); g.moveTo(cx, cy - 18); g.lineTo(cx + 18, cy); g.lineTo(cx, cy + 18); g.lineTo(cx - 18, cy); g.closePath(); g.fill();
  }
  // pile: fine noise
  const img = g.getImageData(0, 0, W, H), d = img.data, r = rng(9);
  for (let k = 0; k < d.length; k += 4) { const n = (r() - 0.5) * 18; d[k] += n; d[k + 1] += n; d[k + 2] += n; }
  g.putImageData(img, 0, 0);
  const t = tex(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
