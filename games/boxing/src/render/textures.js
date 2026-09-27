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

/** The ring canvas: taut vinyl-coated fabric with a centre logo and wear. */
export function ringCanvasTexture({ title = 'FORGE', subtitle = 'BOXING', accent = '#b3121f' } = {}) {
  const S = 2048;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  // base colour with gentle vignette towards the ropes (dirt)
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.72);
  grd.addColorStop(0, '#aebbc8');
  grd.addColorStop(1, '#8f9cab');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  // weave
  g.globalAlpha = 0.05;
  g.fillStyle = '#000';
  for (let i = 0; i < S; i += 4) {
    g.fillRect(i, 0, 1, S);
    g.fillRect(0, i, S, 1);
  }
  g.globalAlpha = 1;
  speckle(g, S, S, 9000, ['#7a8591', '#ffffff', '#5d6671'], 0.6, 3, 7);
  // scuffs and sweat stains
  const rand = rng(42);
  for (let i = 0; i < 140; i++) {
    const x = S * (0.2 + 0.6 * rand()), y = S * (0.2 + 0.6 * rand());
    const r = 20 + rand() * 90;
    const sg = g.createRadialGradient(x, y, 0, x, y, r);
    sg.addColorStop(0, `rgba(80,90,100,${0.05 + rand() * 0.06})`);
    sg.addColorStop(1, 'rgba(80,90,100,0)');
    g.fillStyle = sg;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // corner triangles (red/blue)
  const tri = (x, y, sx, sy, col) => {
    g.fillStyle = col;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + sx * 190, y);
    g.lineTo(x, y + sy * 190);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
  };
  const m = 110;
  tri(m, m, 1, 1, '#b3121f');
  tri(S - m, S - m, -1, -1, '#1846b8');
  // centre logo
  g.save();
  g.translate(S / 2, S / 2);
  g.strokeStyle = 'rgba(20,24,30,0.55)';
  g.lineWidth = 16;
  g.beginPath();
  g.arc(0, 0, 330, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 5;
  g.beginPath();
  g.arc(0, 0, 300, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = accent;
  g.globalAlpha = 0.9;
  g.font = 'bold 190px Oswald, Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(title, 0, -30);
  g.globalAlpha = 0.8;
  g.fillStyle = '#1b2029';
  g.font = '600 84px Oswald, Impact, "Arial Black", sans-serif';
  g.fillText(subtitle, 0, 120);
  g.restore();
  // apron edge text rotated on each side
  g.fillStyle = 'rgba(25,30,38,0.5)';
  g.font = '600 64px Oswald, Impact, sans-serif';
  g.textAlign = 'center';
  for (let k = 0; k < 4; k++) {
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate((k * Math.PI) / 2);
    g.fillText('WORLD CHAMPIONSHIP  •  FORGE ENGINE', 0, S * 0.455);
    g.restore();
  }
  return finish(c, { anisotropy: 16 });
}

/** Printed apron skirt around the platform. */
export function apronTexture() {
  const W = 2048, H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#15171c');
  grd.addColorStop(1, '#0b0c10');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#b3121f';
  g.fillRect(0, 0, W, 14);
  g.fillRect(0, H - 10, W, 10);
  const words = ['FORGE', 'XPBD PHYSICS', 'CHAMPIONSHIP', 'FORGE', 'FIGHT NIGHT'];
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  words.forEach((w, i) => {
    const x = (i + 0.5) * (W / words.length);
    g.font = `bold ${i % 2 ? 84 : 110}px Oswald, Impact, sans-serif`;
    g.fillStyle = i % 2 ? '#d9dde3' : '#f2f2f2';
    g.fillText(w, x, H / 2 + 6);
  });
  return finish(c, { repeat: true });
}

/** LED advertising board. */
export function ledBoardTexture(lines) {
  const W = 2048, H = 128;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#050608';
  g.fillRect(0, 0, W, H);
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  lines.forEach((l, i) => {
    g.fillStyle = l.color;
    g.font = `bold 72px Oswald, Impact, sans-serif`;
    g.fillText(l.text, (i + 0.5) * (W / lines.length), H / 2 + 4);
  });
  // LED dot grid
  g.globalAlpha = 0.35;
  g.fillStyle = '#000';
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
  g.globalAlpha = 1;
  return finish(c, { repeat: true });
}

/** Satin boxing trunks with waistband and side stripes. */
export function trunksTexture({ base = '#b3121f', trim = '#f4d27a', text = 'FORGE' } = {}) {
  const W = 1024, H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  // satin sheen streaks
  const rand = rng(5);
  for (let i = 0; i < 60; i++) {
    g.globalAlpha = 0.04 + rand() * 0.05;
    g.fillStyle = rand() < 0.5 ? '#ffffff' : '#000000';
    g.fillRect(rand() * W, 0, 2 + rand() * 18, H);
  }
  g.globalAlpha = 1;
  // waistband (top 22%)
  g.fillStyle = trim;
  g.fillRect(0, 0, W, H * 0.2);
  g.fillStyle = base;
  g.fillRect(0, H * 0.2, W, 6);
  g.fillStyle = '#111';
  g.font = 'bold 64px Oswald, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, W * 0.5, H * 0.1);   // front (u=0.5 faces forward)
  // side stripes at the sides (u = 0.25, 0.75)
  for (const u of [0.25, 0.75]) {
    g.fillStyle = trim;
    g.fillRect(W * u - 14, H * 0.2, 28, H);
    g.fillStyle = '#ffffff';
    g.fillRect(W * u - 4, H * 0.2, 8, H);
  }
  return finish(c);
}

/** Leather colour texture for gloves: base + white cuff label. */
export function gloveTexture({ base = '#b3121f', label = 'FORGE' } = {}) {
  const W = 512, H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 600, ['#000000', '#ffffff'], 0.5, 1.5, 21);
  // cuff band region: v in [0, 0.18] is the cuff (texture top)
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, W, H * 0.07);
  g.fillStyle = '#111';
  g.font = 'bold 34px Oswald, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) g.fillText(label, (i + 0.5) * (W / 4), H * 0.035 + 2);
  return finish(c);
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
