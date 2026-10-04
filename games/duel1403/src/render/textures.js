import {
  CanvasTexture, DataTexture, RGBAFormat, RepeatWrapping, SRGBColorSpace, LinearMipmapLinearFilter,
  LinearFilter, NoColorSpace,
} from 'three';

// All textures are generated at load time: no downloads, fully offline.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable fBm value noise sampled on an n x n grid. */
export function tileableNoise(n, { octaves = 5, base = 8, seed = 1, persistence = 0.5 } = {}) {
  const out = new Float32Array(n * n);
  const rand = rng(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = base << o;
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    for (let y = 0; y < n; y++) {
      const gy = (y / n) * cells;
      const y0 = Math.floor(gy), fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const y1 = (y0 + 1) % cells;
      for (let x = 0; x < n; x++) {
        const gx = (x / n) * cells;
        const x0 = Math.floor(gx), fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const x1 = (x0 + 1) % cells;
        const a = grid[y0 * cells + x0], b = grid[y0 * cells + x1];
        const c = grid[y1 * cells + x0], d = grid[y1 * cells + x1];
        out[y * n + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
      }
    }
    total += amp;
    amp *= persistence;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Tangent-space normal map from a height field. */
export function normalMapFromHeight(h, n, strength = 2) {
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const l = h[y * n + ((x - 1 + n) % n)], r = h[y * n + ((x + 1) % n)];
      const u = h[((y - 1 + n) % n) * n + x], d = h[((y + 1) % n) * n + x];
      let nx = (l - r) * strength * n / 64, ny = (u - d) * strength * n / 64, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * n + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, n, n, RGBAFormat);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const cache = new Map();
export function noiseNormal(key, { size = 256, octaves = 4, base = 16, seed = 3, strength = 2, persistence = 0.5 } = {}) {
  if (cache.has(key)) return cache.get(key);
  const h = tileableNoise(size, { octaves, base, seed, persistence });
  const t = normalMapFromHeight(h, size, strength);
  cache.set(key, t);
  return t;
}

/** Skin pores + fine wrinkles. */
export function skinNormal() {
  if (cache.has('skin')) return cache.get('skin');
  const n = 256;
  const h = tileableNoise(n, { octaves: 5, base: 24, seed: 11, persistence: 0.55 });
  const rand = rng(99);
  // pores: small pits
  for (let k = 0; k < 2200; k++) {
    const cx = rand() * n, cy = rand() * n, r = 0.8 + rand() * 1.2;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = (Math.floor(cx) + dx + n) % n, y = (Math.floor(cy) + dy + n) % n;
      const d2 = (dx * dx + dy * dy) / (r * r);
      if (d2 < 1) h[y * n + x] -= 0.12 * (1 - d2);
    }
  }
  const t = normalMapFromHeight(h, n, 1.6);
  cache.set('skin', t);
  return t;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { srgb = true, repeat = false, anisotropy = 8 } = {}) {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

function speckle(ctx, w, h, count, colors, rmin, rmax, seed) {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    const r = rmin + rand() * (rmax - rmin);
    ctx.globalAlpha = 0.03 + rand() * 0.06;
    ctx.beginPath();
    ctx.arc(rand() * w, rand() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Iris texture for the eyes (front of the sphere at u = 0.5). */
export function eyeTexture(iris = '#4a2e1c') {
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#ece6df';
  g.fillRect(0, 0, S, S);
  // veins
  g.strokeStyle = 'rgba(170,40,40,0.25)';
  const rand = rng(8);
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    const y = rand() * S;
    g.moveTo(rand() < 0.5 ? 0 : S, y);
    g.quadraticCurveTo(S / 2, y + (rand() - 0.5) * 60, S / 2 + (rand() - 0.5) * 30, S / 2 + (rand() - 0.5) * 30);
    g.stroke();
  }
  const cx = S / 2, cy = S / 2;
  const ir = g.createRadialGradient(cx, cy, 4, cx, cy, 34);
  ir.addColorStop(0, '#000');
  ir.addColorStop(0.35, '#000');
  ir.addColorStop(0.4, iris);
  ir.addColorStop(0.95, '#1c120b');
  ir.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = ir;
  g.beginPath();
  g.arc(cx, cy, 34, 0, Math.PI * 2);
  g.fill();
  return finish(c);
}

// ---------------------------------------------------------------------------
// Materials of 1403: mail, quilted linen, wool, leather, wood, grass, heraldry

function heightToNormal(key, n, fill, strength) {
  if (cache.has(key)) return cache.get(key);
  const h = new Float32Array(n * n);
  fill(h, n);
  const t = normalMapFromHeight(h, n, strength);
  cache.set(key, t);
  return t;
}

/** Riveted mail: rows of rings, each linked through four others. */
export function mailNormal() {
  return heightToNormal('mail', 256, (h, n) => {
    const rows = 16, cols = 16;
    const cw = n / cols, rh = n / rows;
    const R = cw * 0.46, r = cw * 0.13;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let best = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const row = Math.floor(y / rh) + dy;
          const off = (row & 1) ? cw / 2 : 0;
          const cy = (row + 0.5) * rh;
          for (let dx = -1; dx <= 1; dx++) {
            const col = Math.floor((x - off) / cw) + dx;
            const cx = (col + 0.5) * cw + off;
            const ex = (x - cx), ey = (y - cy) * 1.25;
            const d = Math.abs(Math.hypot(ex, ey) - R);
            if (d < r) {
              const v = Math.sqrt(1 - (d / r) ** 2) * (0.75 + 0.25 * ((row & 1) ? 1 : 0.6));
              if (v > best) best = v;
            }
          }
        }
        h[y * n + x] = best;
      }
    }
  }, 5);
}

/** Vertical quilting channels of a gambeson. */
export function quiltNormal(spacing = 18) {
  return heightToNormal('quilt' + spacing, 256, (h, n) => {
    const noise = tileableNoise(n, { octaves: 3, base: 32, seed: 21 });
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const u = (x % spacing) / spacing;
        const puff = Math.sin(u * Math.PI) ** 0.6;
        h[y * n + x] = puff * 0.9 + noise[y * n + x] * 0.15;
      }
    }
  }, 2.2);
}

/** Tabby weave of wool or linen. */
export function clothNormal() {
  return heightToNormal('cloth', 128, (h, n) => {
    const noise = tileableNoise(n, { octaves: 2, base: 16, seed: 5 });
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const a = Math.sin((x / n) * Math.PI * 2 * 32), b = Math.sin((y / n) * Math.PI * 2 * 32);
        h[y * n + x] = (((Math.floor(x / 4) + Math.floor(y / 4)) & 1) ? a : b) * 0.25 + noise[y * n + x] * 0.3;
      }
    }
  }, 1.4);
}

export function leatherNormal() {
  return noiseNormal('leather', { size: 256, base: 48, octaves: 3, seed: 13, strength: 1.0 });
}

/** Hammered steel: very faint planishing marks. */
export function steelNormal() {
  return heightToNormal('steel', 256, (h, n) => {
    const rand = rng(77);
    const base = tileableNoise(n, { octaves: 3, base: 6, seed: 33 });
    for (let i = 0; i < h.length; i++) h[i] = base[i] * 0.3;
    for (let k = 0; k < 900; k++) {
      const cx = rand() * n, cy = rand() * n, r = 3 + rand() * 6;
      for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) {
        const x = (Math.floor(cx) + dx + n) % n, y = (Math.floor(cy) + dy + n) % n;
        const d2 = (dx * dx + dy * dy) / (r * r);
        if (d2 < 1) h[y * n + x] -= 0.05 * (1 - d2);
      }
    }
  }, 0.9);
}

export function woodTexture(base = '#6b4a2c') {
  const key = 'wood' + base;
  if (cache.has(key)) return cache.get(key);
  const W = 256, H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  const rand = rng(41);
  for (let i = 0; i < 90; i++) {
    const x = rand() * W;
    g.strokeStyle = rand() < 0.5 ? 'rgba(0,0,0,0.13)' : 'rgba(255,230,190,0.07)';
    g.lineWidth = 0.5 + rand() * 2;
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= H; y += 16) g.lineTo(x + Math.sin(y * 0.05 + i) * 3, y);
    g.stroke();
  }
  const t = finish(c, { repeat: true });
  cache.set(key, t);
  return t;
}

/** Trampled grass for the field around the lists. */
export function grassTexture() {
  if (cache.has('grass')) return cache.get('grass');
  const S = 512;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#4c5a2a';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 9000, ['#5f6e34', '#3d4a22', '#6f7a3a', '#556328', '#7a7a44'], 1, 4, 3);
  const rand = rng(12);
  for (let i = 0; i < 14000; i++) {
    const x = rand() * S, y = rand() * S, l = 3 + rand() * 7, a = -Math.PI / 2 + (rand() - 0.5) * 0.9;
    g.strokeStyle = ['#6d8038', '#4e5f26', '#86904a', '#3c4a1e'][Math.floor(rand() * 4)];
    g.globalAlpha = 0.35;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = finish(c, { repeat: true });
  cache.set('grass', t);
  return t;
}

/** Sanded, trodden earth inside the lists. */
export function earthTexture() {
  if (cache.has('earth')) return cache.get('earth');
  const S = 512;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#8a7556';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 12000, ['#9c8664', '#6f5c42', '#a8956e', '#7d6a4c', '#5d4c36'], 1, 6, 9);
  const rand = rng(4);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(60,45,30,0.18)' : 'rgba(200,180,140,0.12)';
    g.beginPath();
    g.ellipse(rand() * S, rand() * S, 2 + rand() * 6, 1 + rand() * 3, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = finish(c, { repeat: true });
  cache.set('earth', t);
  return t;
}

/** Linen or wool base colour with faint variation (repeats). */
export function fabricTexture(color, { stripes = null, rivets = false, lacing = false } = {}) {
  const key = 'fab' + color + (stripes ?? '') + rivets + lacing;
  if (cache.has(key)) return cache.get(key);
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 1800, ['#000000', '#ffffff'], 1, 3, 31);
  if (stripes) {
    g.fillStyle = stripes;
    for (let x = 0; x < S; x += 32) g.fillRect(x, 0, 16, S);
  }
  if (rivets) {
    // brass-capped rivets in rows, as on a brigandine
    for (let y = 8; y < S; y += 21) for (let x = 6; x < S; x += 16) {
      const gr = g.createRadialGradient(x - 1, y - 1, 0.5, x, y, 4);
      gr.addColorStop(0, '#f6e2a0');
      gr.addColorStop(0.6, '#b08a3a');
      gr.addColorStop(1, 'rgba(60,40,10,0.6)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, 3.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = finish(c, { repeat: true });
  cache.set(key, t);
  return t;
}

/** A coat of arms painted on cloth: field and charge. */
export function heraldryTexture(her, fallback = '#7a1c1c') {
  const key = 'her' + (her?.name ?? 'none') + fallback;
  if (cache.has(key)) return cache.get(key);
  const W = 512, H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const field = her?.field ?? fallback;
  g.fillStyle = field;
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 2500, ['#000000', '#ffffff'], 1, 3, 17);
  // The texture wraps around the torso: u = 0.5 is the chest, 0/1 the back.
  const drawCharge = (cx, cy, s) => {
    g.save();
    g.translate(cx, cy);
    g.scale(s, s);
    g.fillStyle = her.chargeColor;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 2.5 / s;
    if (her.charge === 'lion') drawLion(g);
    else if (her.charge === 'rose') drawRose(g, her.chargeColor);
    g.restore();
  };
  if (her?.charge === 'barry') {
    // Hungary (ancient): barry of eight gules and argent; the double cross on the other half.
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? her.chargeColor : field;
      g.fillRect(0, (i * H) / 8, W / 2, H / 8);
    }
    g.fillStyle = field;
    g.fillRect(W / 2, 0, W / 2, H);
    g.fillStyle = her.chargeColor;
    const x = W * 0.75;
    g.fillRect(x - 10, H * 0.18, 20, H * 0.62);
    g.fillRect(x - 46, H * 0.3, 92, 18);
    g.fillRect(x - 64, H * 0.44, 128, 18);
    g.fillStyle = '#2e6a2a';
    g.beginPath();
    g.ellipse(x, H * 0.84, 70, 26, 0, Math.PI, 0);
    g.fill();
  } else if (her?.charge === 'chequy') {
    const n = 8;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = (i + j) % 2 ? her.chargeColor : field;
      g.fillRect((i * W) / n, (j * H) / n, W / n, H / n);
    }
  } else if (her?.charge) {
    drawCharge(W * 0.5, H * 0.52, 1.25);
    drawCharge(W * 0.0, H * 0.52, 1.0);
    drawCharge(W * 1.0, H * 0.52, 1.0);
  }
  const t = finish(c);
  cache.set(key, t);
  return t;
}

/** The Bohemian lion: rampant, double-tailed, crowned (drawn at ~200 px). */
function drawLion(g) {
  g.beginPath();
  // body
  g.moveTo(-30, 60);
  g.bezierCurveTo(-40, 20, -30, -10, -10, -30);
  g.bezierCurveTo(0, -40, 10, -55, 5, -70);   // neck
  g.bezierCurveTo(20, -90, 50, -85, 55, -65); // head top
  g.lineTo(62, -60); g.lineTo(52, -52);         // muzzle
  g.lineTo(58, -44); g.lineTo(44, -42);        // jaw
  g.bezierCurveTo(40, -30, 50, -20, 70, -30);  // fore paw raised
  g.lineTo(78, -22); g.lineTo(66, -16);
  g.bezierCurveTo(48, -6, 34, -4, 26, 6);
  g.bezierCurveTo(44, 4, 60, 10, 70, 2);       // second fore paw
  g.lineTo(76, 12); g.lineTo(62, 18);
  g.bezierCurveTo(44, 26, 30, 30, 22, 40);
  g.bezierCurveTo(30, 60, 46, 74, 58, 90);     // hind leg forward
  g.lineTo(66, 100); g.lineTo(48, 98);
  g.bezierCurveTo(30, 84, 14, 74, 4, 70);
  g.bezierCurveTo(0, 86, -6, 96, -2, 108);     // hind leg back
  g.lineTo(-12, 112); g.lineTo(-18, 100);
  g.bezierCurveTo(-22, 88, -26, 76, -30, 60);
  g.closePath();
  g.fill();
  g.stroke();
  // two tails
  g.lineWidth = 7;
  g.strokeStyle = g.fillStyle;
  for (const k of [0, 1]) {
    g.beginPath();
    g.moveTo(-28, 50);
    g.bezierCurveTo(-70, 30 - k * 30, -60, -30 - k * 20, -40 + k * 10, -60 - k * 18);
    g.stroke();
  }
  // crown (or)
  g.fillStyle = '#e0b030';
  g.beginPath();
  g.moveTo(20, -86); g.lineTo(24, -104); g.lineTo(31, -92); g.lineTo(37, -108); g.lineTo(43, -92); g.lineTo(50, -104); g.lineTo(52, -84);
  g.closePath();
  g.fill();
}

function drawRose(g, color) {
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    g.fillStyle = color;
    g.beginPath();
    g.arc(Math.cos(a) * 34, Math.sin(a) * 34, 32, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.fillStyle = '#e0b030';
  g.beginPath();
  g.arc(0, 0, 20, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2e6a2a';
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * Math.PI) / 5 - Math.PI / 2 + Math.PI / 5;
    g.beginPath();
    g.moveTo(Math.cos(a) * 30, Math.sin(a) * 30);
    g.lineTo(Math.cos(a) * 62, Math.sin(a) * 62);
    g.lineTo(Math.cos(a + 0.25) * 36, Math.sin(a + 0.25) * 36);
    g.fill();
  }
}

/** A flag of the Kingdom of Bohemia (or other arms) for banners. */
export function bannerTexture(her) {
  return heraldryTexture(her);
}

export { rng, canvas, finish, speckle };
