/**
 * Drawn textures for the car: the brushed stainless steel of the DMC-12's body (a normal map
 * of fine grain lines along the brushing, and a roughness map with its streaks), grey leather,
 * charcoal carpet, the black textured plastic of the bumpers, and the lettering and dials
 * (DMC on the grille, OUTATIME on the plate, the gauge faces, the time circuits' labels).
 */
import { CanvasTexture, RepeatWrapping, ClampToEdgeWrapping, LinearMipmapLinearFilter, LinearFilter } from 'three';

export function canvas(w, h) {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
}
export function tex(c, repeat = true, linear = false) {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  t.anisotropy = 8;
  if (linear) t.colorSpace = '';
  t.needsUpdate = true;
  return t;
}
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

let _brushed = null;
/**
 * Brushed stainless (No. 4 finish): grain lines along u. Returns { normal, rough }: the normal
 * map tilts across the lines; the roughness map (green channel) varies along them.
 * One texture repeat = 0.5 m along u and 0.25 m across.
 */
export function brushedSteel() {
  if (_brushed) return _brushed;
  const W = 1024, H = 512, r = rng(7);
  // a height field of lines: each row a sum of random scratches along x
  const h = new Float32Array(W * H);
  for (let k = 0; k < 2600; k++) {
    const y = Math.floor(r() * H), x0 = Math.floor(r() * W), len = 40 + r() * 700, a = (r() - 0.5) * 0.9, wdt = r() < 0.85 ? 1 : 2;
    for (let i = 0; i < len; i++) {
      const x = (x0 + i) % W;
      const fade = Math.sin((i / len) * Math.PI);
      for (let j = 0; j < wdt; j++) h[((y + j) % H) * W + x] += a * fade;
    }
  }
  // a fine random grain on top, smoothed along x (the abrasive's direction)
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let x = 0; x < W * 2; x++) { acc = acc * 0.9 + (r() - 0.5) * 0.25; if (x >= W) h[y * W + (x - W)] += acc; }
  }
  const cn = canvas(W, H), gn = cn.getContext('2d'), imN = gn.createImageData(W, H);
  const cr = canvas(W, H), gr = cr.getContext('2d'), imR = gr.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const up = h[((y + H - 1) % H) * W + x], dn = h[((y + 1) % H) * W + x];
    const lf = h[y * W + (x + W - 1) % W], rt = h[y * W + (x + 1) % W];
    const dy = (dn - up) * 0.5, dx = (rt - lf) * 0.12;
    const nx = -dx, ny = dy, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const k = i * 4;
    imN.data[k] = 128 + (nx / l) * 127; imN.data[k + 1] = 128 + (ny / l) * 127; imN.data[k + 2] = 128 + (nz / l) * 127; imN.data[k + 3] = 255;
    const v = Math.max(0, Math.min(255, 200 + h[i] * 60 + (r() - 0.5) * 18));
    imR.data[k] = v; imR.data[k + 1] = v; imR.data[k + 2] = v; imR.data[k + 3] = 255;
  }
  gn.putImageData(imN, 0, 0); gr.putImageData(imR, 0, 0);
  _brushed = { normal: tex(cn, true, true), rough: tex(cr, true, true) };
  _brushed.normal.repeat.set(2, 4); _brushed.rough.repeat.set(2, 4);
  return _brushed;
}

/** A pebbled grain (leather, textured plastic): a normal map. */
export function grainNormal(seed = 3, scale = 1, strength = 1) {
  const W = 256, H = 256, r = rng(seed);
  const h = new Float32Array(W * H);
  for (let k = 0; k < 2200 * scale; k++) {
    const cx = r() * W, cy = r() * H, rad = 1.5 + r() * 3.5;
    for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) {
      const d = Math.hypot(i, j) / rad;
      if (d < 1) h[((Math.floor(cy) + j + H) % H) * W + (Math.floor(cx) + i + W) % W] += (1 - d * d) * (0.6 + r() * 0.4);
    }
  }
  const c = canvas(W, H), g = c.getContext('2d'), im = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (h[y * W + (x + 1) % W] - h[y * W + (x + W - 1) % W]) * 0.5 * strength;
    const dy = (h[((y + 1) % H) * W + x] - h[((y + H - 1) % H) * W + x]) * 0.5 * strength;
    const l = Math.hypot(dx, dy, 1), k = (y * W + x) * 4;
    im.data[k] = 128 - dx / l * 127; im.data[k + 1] = 128 + dy / l * 127; im.data[k + 2] = 128 + 127 / l; im.data[k + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return tex(c, true, true);
}

/** Charcoal carpet: colour with a cut-pile speckle. */
export function carpetTexture(base = [46, 46, 48]) {
  const W = 256, c = canvas(W, W), g = c.getContext('2d'), im = g.createImageData(W, W), r = rng(11);
  for (let i = 0; i < W * W; i++) {
    const v = 0.7 + r() * 0.6;
    im.data[i * 4] = base[0] * v; im.data[i * 4 + 1] = base[1] * v; im.data[i * 4 + 2] = base[2] * v; im.data[i * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const t = tex(c); t.repeat.set(6, 6);
  return t;
}

/** Text or symbols drawn on a plate: a colour texture of w x h px. */
export function plateTexture(w, h, draw, repeat = false) {
  const c = canvas(w, h), g = c.getContext('2d');
  draw(g, w, h);
  return tex(c, repeat);
}

/** The 1980s California plate, dark blue with yellow characters: OUTATIME. */
export function californiaPlate(text = 'OUTATIME') {
  return plateTexture(600, 300, (g, w, h) => {
    g.fillStyle = '#16245c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d9b638'; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#e8c547';
    g.font = 'bold 44px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('CALIFORNIA', w / 2, 52);
    g.font = 'bold 148px "Arial Narrow", Impact, sans-serif';
    g.save(); g.translate(w / 2, 178); g.scale(0.78, 1); g.fillText(text, 0, 0); g.restore();
    // registration stickers in the corners
    g.fillStyle = '#c03a2b'; g.fillRect(30, 26, 52, 34); g.fillStyle = '#2e8a46'; g.fillRect(w - 82, 26, 52, 34);
    // bolt holes
    g.fillStyle = '#0a1030'; for (const x of [140, w - 140]) { g.beginPath(); g.arc(x, 30, 9, 0, 7); g.fill(); g.beginPath(); g.arc(x, h - 30, 9, 0, 7); g.fill(); }
  });
}

/** White letters on black (or a given colour): a label strip. */
export function labelTexture(text, { w = 512, h = 64, bg = '#0b0b0c', fg = '#f1efe9', font = 'bold 40px Arial, sans-serif', squeeze = 1 } = {}) {
  return plateTexture(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(w / 2, h / 2 + 2); g.scale(squeeze, 1); g.fillText(text, 0, 0); g.restore();
  });
}

/**
 * A round gauge face. opts: { ticks: [{v, label}], min, max, a0, a1 (degrees, clockwise from
 * up), title, unit, redFrom, face colour, minor step }.
 */
export function gaugeFace({ size = 512, min = 0, max = 85, major = 10, minor = 2.5, a0 = -135, a1 = 135, labels = true, title = '', sub = '', redFrom = null, face = '#0c0c0d', ink = '#f2f0ea', labelEvery = null, labelScale = 1, digits = (v) => String(v) } = {}) {
  return plateTexture(size, size, (g, w) => {
    const c = w / 2, R = w * 0.46;
    g.fillStyle = face; g.beginPath(); g.arc(c, c, w / 2, 0, 7); g.fill();
    const ang = (v) => ((a0 + (a1 - a0) * (v - min) / (max - min)) - 90) * Math.PI / 180;
    if (redFrom != null) {
      g.strokeStyle = '#c8261d'; g.lineWidth = w * 0.035;
      g.beginPath(); g.arc(c, c, R * 0.93, ang(redFrom), ang(max)); g.stroke();
    }
    g.strokeStyle = ink; g.fillStyle = ink;
    for (let v = min; v <= max + 1e-6; v += minor) {
      const a = ang(v), isMajor = Math.abs((v - min) / major - Math.round((v - min) / major)) < 1e-6;
      const r0 = isMajor ? R * 0.8 : R * 0.88;
      g.lineWidth = isMajor ? w * 0.012 : w * 0.006;
      g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * R, c + Math.sin(a) * R); g.stroke();
      if (labels && isMajor && (labelEvery == null || Math.round((v - min) / major) % labelEvery === 0)) {
        g.font = `${Math.round(w * 0.085 * labelScale)}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(digits(v), c + Math.cos(a) * R * 0.62, c + Math.sin(a) * R * 0.62);
      }
    }
    g.font = `${Math.round(w * 0.07)}px Arial, sans-serif`; g.textAlign = 'center';
    if (title) g.fillText(title, c, c + R * 0.42);
    if (sub) { g.font = `${Math.round(w * 0.05)}px Arial, sans-serif`; g.fillText(sub, c, c + R * 0.58); }
  });
}
