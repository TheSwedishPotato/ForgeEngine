/**
 * Textures for the trees, drawn once at load on a canvas: a spruce branch (the Alpine
 * "comb" form: a main shoot with hanging side twigs, dense short needles, snow lying along
 * the top), a whole spruce seen from afar (for the distant impostor), and a fan of fine bare
 * twigs for the winter crowns of beech, sycamore and larch.
 *
 * Colours: Norway spruce needles are a dark, slightly blue green; beech bark a smooth
 * grey, larch bark grey-brown and fissured; the twigs of both read purplish grey-brown.
 */
import { CanvasTexture, RepeatWrapping, ClampToEdgeWrapping, LinearMipmapLinearFilter, LinearFilter } from 'three';

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

function canvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  return c;
}

function toTexture(c, { repeat = false } = {}) {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const NEEDLE = ['#16241a', '#1b2c1f', '#203423', '#14201a', '#243a28'];

/**
 * A spruce branch, trunk end at the left, tip at the right, the top of the branch up.
 * snow 0..1: how much snow lies on it.
 */
export function spruceBranchTexture(snow = 0.5, seed = 3) {
  const W = 256, H = 128, c = canvas(W, H), g = c.getContext('2d'), r = rng(seed);
  g.clearRect(0, 0, W, H);
  const y0 = 40;
  const main = (x) => y0 + (x / W) * 10 - Math.sin((x / W) * Math.PI) * 6;
  // hanging side twigs, each with needles all round
  for (let x = 14; x < W - 8; x += 7 + r() * 4) {
    const len = (1 - x / W) * 70 + 18 + r() * 14;
    const ang = Math.PI / 2 - 0.25 + (r() - 0.5) * 0.5;      // hang down, a little forward
    const bx = x, by = main(x);
    let px = bx, py = by;
    const steps = 9;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const ex = bx + Math.cos(ang) * len * t + t * t * 6, ey = by + Math.sin(ang) * len * t;
      g.strokeStyle = '#2a2018'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(px, py); g.lineTo(ex, ey); g.stroke();
      // needles: short strokes either side
      for (let n = 0; n < 7; n++) {
        const na = ang + (r() < 0.5 ? -1 : 1) * (0.9 + r() * 0.6);
        const nl = 4 + r() * 4;
        g.strokeStyle = NEEDLE[Math.floor(r() * NEEDLE.length)]; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex + Math.cos(na) * nl, ey + Math.sin(na) * nl); g.stroke();
      }
      px = ex; py = ey;
    }
  }
  // the main shoot, with its own needles along the top
  g.strokeStyle = '#2c2119'; g.lineWidth = 3;
  g.beginPath(); for (let x = 0; x < W - 4; x += 4) { const y = main(x); if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke();
  for (let x = 4; x < W - 6; x += 2) {
    const y = main(x);
    for (let n = 0; n < 3; n++) {
      const na = -Math.PI / 2 + (r() - 0.5) * 2.2;
      g.strokeStyle = NEEDLE[Math.floor(r() * NEEDLE.length)]; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(na) * (5 + r() * 4), y + Math.sin(na) * (5 + r() * 4)); g.stroke();
    }
  }
  // snow along the top of the branch and caught on the twigs
  if (snow > 0.02) {
    for (let x = 6; x < W - 10; x += 3) {
      if (r() > 0.35 + snow * 0.6) continue;
      const y = main(x) - 4 - r() * 3;
      const rad = (2.5 + r() * 4) * (0.5 + snow * 0.7) * (1 - x / W * 0.4);
      g.fillStyle = r() < 0.7 ? '#f2f4f7' : '#dfe4ec';
      g.beginPath(); g.ellipse(x, y, rad * 1.5, rad, 0, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 70 * snow; i++) {
      const x = 10 + r() * (W - 30), y = main(x) + 8 + r() * 40 * (1 - x / W);
      g.fillStyle = '#e9edf3';
      g.beginPath(); g.ellipse(x, y, 2 + r() * 3, 1.4 + r() * 1.5, 0, 0, Math.PI * 2); g.fill();
    }
  }
  return toTexture(c);
}

/** A whole spruce from afar: a ragged dark cone with snow on the tiers. Base at the bottom. */
export function spruceImpostorTexture(snow = 0.5, seed = 9) {
  const W = 128, H = 256, c = canvas(W, H), g = c.getContext('2d'), r = rng(seed);
  g.clearRect(0, 0, W, H);
  // trunk
  g.fillStyle = '#2b221b'; g.fillRect(W / 2 - 3, H * 0.62, 6, H * 0.38);
  const tiers = 26;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);                 // 0 bottom of the crown, 1 top
    const y = H * (0.74 - f * 0.72);
    const half = (W * 0.46) * Math.pow(1 - f, 0.95) + 3;
    // a drooping skirt of twigs
    for (let k = 0; k < 40; k++) {
      const u = (k / 39) * 2 - 1;
      const x = W / 2 + u * half;
      const drop = Math.abs(u) * 14 * (1 - f) + 6;
      g.strokeStyle = NEEDLE[Math.floor(r() * NEEDLE.length)]; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(W / 2 + u * half * 0.2, y); g.quadraticCurveTo(x, y - 2, x + (r() - 0.5) * 4, y + drop + r() * 6); g.stroke();
    }
    if (snow > 0.02) {
      for (let k = 0; k < 10 * snow; k++) {
        const u = (r() * 2 - 1) * 0.9, x = W / 2 + u * half;
        g.fillStyle = '#e6eaf0';
        g.beginPath(); g.ellipse(x, y + Math.abs(u) * 6 * (1 - f) - 1, 3 + r() * 4, 1.5 + r() * 1.5, 0, 0, Math.PI * 2); g.fill();
      }
    }
  }
  return toTexture(c);
}

/** A fan of fine bare twigs (for the winter crowns). */
export function twigTexture({ color = '#5d5550', seed = 5 } = {}) {
  const W = 256, H = 256, c = canvas(W, H), g = c.getContext('2d'), r = rng(seed);
  g.clearRect(0, 0, W, H);
  const twig = (x, y, a, len, w, depth) => {
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
    if (depth >= 5 || len < 5) return;
    const n = 2 + (r() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) twig(ex, ey, a + (r() - 0.5) * 1.3, len * (0.62 + r() * 0.2), Math.max(0.6, w * 0.68), depth + 1);
  };
  for (let i = 0; i < 5; i++) twig(W / 2 + (r() - 0.5) * 40, H - 2, -Math.PI / 2 + (r() - 0.5) * 1.1, 70 + r() * 20, 3.2, 0);
  return toTexture(c);
}

/**
 * One atlas per spruce look (512 x 256): the branch at the top left (u 0-0.5, v 0.5-1),
 * a bark strip under it (v 0.469-0.5), the whole-tree impostor at u 0.5-0.75.
 */
export function spruceAtlas(snow = 0.5) {
  const c = canvas(512, 256), g = c.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  g.drawImage(spruceBranchTexture(snow).image, 0, 0);
  g.fillStyle = '#3a2f27'; g.fillRect(0, 128, 256, 8);
  for (let i = 0; i < 60; i++) { g.fillStyle = i % 2 ? '#2a221c' : '#4a3d33'; g.fillRect(Math.random() * 256, 128 + Math.random() * 8, 6, 1); }
  g.drawImage(spruceImpostorTexture(snow).image, 256, 0);
  return toTexture(c);
}

/** Atlas for the bare trees: twigs at the top left (u 0-0.5, v 0.5-1), bark strip below. */
export function bareAtlas({ bark = '#4e4b47', twig = '#5d5550' } = {}) {
  const c = canvas(512, 256), g = c.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  g.drawImage(twigTexture({ color: twig }).image, 0, 0, 256, 128);
  g.fillStyle = bark; g.fillRect(0, 128, 256, 8);
  return toTexture(c);
}
