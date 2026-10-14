/**
 * The town's surfaces, drawn on canvases: asphalt (fresh black in 2015, grey and patched by
 * 1985), concrete pavements, the valley's grass (golden in the dry autumn), dirt roads,
 * ploughed fields, brick, painted clapboard, shingles, stucco, cream stone for the courthouse.
 */
import { canvas, tex, rng } from '../car/textures.js';

const cache = new Map();
function once(key, f) { if (!cache.has(key)) cache.set(key, f()); return cache.get(key); }

function noiseFill(g, W, H, base, amp, seed, grain = 1) {
  const im = g.createImageData(W, H), r = rng(seed);
  for (let i = 0; i < W * H; i++) {
    const v = 1 + (r() - 0.5) * amp * grain;
    im.data[i * 4] = base[0] * v; im.data[i * 4 + 1] = base[1] * v; im.data[i * 4 + 2] = base[2] * v; im.data[i * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0);
}

/** Blotches: soft darker/lighter patches (wear, stains, patches of growth). */
function blotches(g, W, H, n, color, rmin, rmax, seed) {
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const x = r() * W, y = r() * H, rad = rmin + r() * (rmax - rmin);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) { g.save(); g.translate(ox, oy); g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill(); g.restore(); }
  }
}

export function asphalt(age = 'worn') {
  return once(`asphalt:${age}`, () => {
    const W = 512, c = canvas(W, W), g = c.getContext('2d');
    const base = age === 'new' ? [40, 40, 42] : age === 'old' ? [84, 82, 79] : [64, 63, 61];
    noiseFill(g, W, W, base, 0.16, 21);
    blotches(g, W, W, 40, age === 'new' ? 'rgba(20,20,22,0.25)' : 'rgba(30,30,30,0.18)', 20, 90, 22);
    blotches(g, W, W, 25, 'rgba(140,138,130,0.12)', 10, 60, 23);
    if (age !== 'new') {
      // cracks and sealed seams
      const r = rng(24);
      g.strokeStyle = 'rgba(15,15,15,0.55)'; g.lineWidth = 1.5;
      for (let k = 0; k < 14; k++) { let x = r() * W, y = r() * W; g.beginPath(); g.moveTo(x, y); for (let s = 0; s < 8; s++) { x += (r() - 0.5) * 40; y += (r() - 0.3) * 30; g.lineTo(x, y); } g.stroke(); }
    }
    const t = tex(c); t.repeat.set(1, 1);
    return t;
  });
}

export function concrete() {
  return once('concrete', () => {
    const W = 256, c = canvas(W, W), g = c.getContext('2d');
    noiseFill(g, W, W, [168, 164, 156], 0.25, 31);
    blotches(g, W, W, 18, 'rgba(90,85,78,0.12)', 10, 40, 32);
    g.strokeStyle = 'rgba(60,58,54,0.6)'; g.lineWidth = 2;
    g.strokeRect(1, 1, W - 2, W - 2);
    return tex(c);
  });
}

export function grass(season = 'autumn') {
  return once(`grass:${season}`, () => {
    const W = 512, c = canvas(W, W), g = c.getContext('2d');
    const base = season === 'green' ? [72, 96, 44] : [138, 122, 70];
    noiseFill(g, W, W, base, 0.55, 41);
    blotches(g, W, W, 60, season === 'green' ? 'rgba(40,70,24,0.3)' : 'rgba(96,104,52,0.35)', 15, 80, 42);
    blotches(g, W, W, 40, 'rgba(170,150,96,0.25)', 10, 60, 43);
    // blades: short strokes
    const r = rng(44);
    for (let k = 0; k < 9000; k++) {
      const x = r() * W, y = r() * W, l = 2 + r() * 4;
      g.strokeStyle = `rgba(${season === 'green' ? '50,80,30' : '180,160,100'},${0.15 + r() * 0.2})`;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 2, y - l); g.stroke();
    }
    return tex(c);
  });
}

export function dirt() {
  return once('dirt', () => {
    const W = 512, c = canvas(W, W), g = c.getContext('2d');
    noiseFill(g, W, W, [128, 104, 76], 0.45, 51);
    blotches(g, W, W, 50, 'rgba(90,70,50,0.3)', 10, 60, 52);
    blotches(g, W, W, 30, 'rgba(170,146,110,0.25)', 8, 40, 53);
    // pebbles
    const r = rng(54);
    for (let k = 0; k < 1500; k++) { g.fillStyle = `rgba(${150 + r() * 60},${130 + r() * 50},${100 + r() * 40},0.6)`; g.fillRect(r() * W, r() * W, 1 + r() * 2, 1 + r() * 2); }
    return tex(c);
  });
}

/** Ploughed field: furrows along v. */
export function field() {
  return once('field', () => {
    const W = 256, c = canvas(W, W), g = c.getContext('2d');
    noiseFill(g, W, W, [104, 84, 60], 0.4, 61);
    for (let x = 0; x < W; x += 16) {
      const grd = g.createLinearGradient(x, 0, x + 16, 0);
      grd.addColorStop(0, 'rgba(60,46,32,0.5)'); grd.addColorStop(0.5, 'rgba(150,128,96,0.25)'); grd.addColorStop(1, 'rgba(60,46,32,0.5)');
      g.fillStyle = grd; g.fillRect(x, 0, 16, W);
    }
    // stubble
    const r = rng(62);
    for (let k = 0; k < 2500; k++) { g.fillStyle = `rgba(190,165,105,${0.3 + r() * 0.4})`; g.fillRect(Math.floor(r() * 16) * 16 + 7 + (r() - 0.5) * 4, r() * W, 1, 2 + r() * 3); }
    return tex(c);
  });
}

export function brick(color = [140, 62, 46], seed = 71) {
  return once(`brick:${color}:${seed}`, () => {
    const W = 256, H = 256, c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = 'rgb(176,168,154)'; g.fillRect(0, 0, W, H);
    const r = rng(seed);
    const bh = 16, bw = 48;
    for (let row = 0; row < H / bh; row++) {
      const off = (row % 2) * bw / 2;
      for (let x = -bw; x < W + bw; x += bw) {
        const v = 0.8 + r() * 0.35;
        g.fillStyle = `rgb(${color[0] * v},${color[1] * v},${color[2] * v})`;
        g.fillRect(x + off + 1.5, row * bh + 1.5, bw - 3, bh - 3);
      }
    }
    blotches(g, W, H, 10, 'rgba(40,30,25,0.15)', 20, 60, seed + 1);
    return tex(c);
  });
}

export function clapboard(color = [214, 206, 188], seed = 81) {
  return once(`clap:${color}:${seed}`, () => {
    const W = 128, H = 256, c = canvas(W, H), g = c.getContext('2d');
    noiseFill(g, W, H, color, 0.12, seed);
    for (let y = 0; y < H; y += 16) {
      const grd = g.createLinearGradient(0, y, 0, y + 16);
      grd.addColorStop(0, 'rgba(0,0,0,0.25)'); grd.addColorStop(0.15, 'rgba(255,255,255,0.08)'); grd.addColorStop(1, 'rgba(0,0,0,0.05)');
      g.fillStyle = grd; g.fillRect(0, y, W, 16);
    }
    blotches(g, W, H, 8, 'rgba(90,80,60,0.15)', 10, 40, seed + 1);
    return tex(c);
  });
}

export function shingles(color = [70, 64, 60]) {
  return once(`shingle:${color}`, () => {
    const W = 256, c = canvas(W, W), g = c.getContext('2d');
    g.fillStyle = `rgb(${color})`; g.fillRect(0, 0, W, W);
    const r = rng(91);
    for (let row = 0; row < 16; row++) for (let k = 0; k < 10; k++) {
      const v = 0.75 + r() * 0.4, x = k * 26 + (row % 2) * 13 - 13;
      g.fillStyle = `rgb(${color[0] * v},${color[1] * v},${color[2] * v})`;
      g.fillRect(x, row * 16, 24, 15);
    }
    return tex(c);
  });
}

export function stucco(color = [222, 210, 186], seed = 101) {
  return once(`stucco:${color}:${seed}`, () => {
    const W = 256, c = canvas(W, W), g = c.getContext('2d');
    noiseFill(g, W, W, color, 0.18, seed);
    blotches(g, W, W, 20, 'rgba(120,100,80,0.12)', 10, 60, seed + 1);
    return tex(c);
  });
}

/** The courthouse's cream stone with joints. */
export function stone() {
  return once('stone', () => {
    const W = 256, c = canvas(W, W), g = c.getContext('2d');
    noiseFill(g, W, W, [212, 200, 176], 0.14, 111);
    g.strokeStyle = 'rgba(120,110,95,0.5)'; g.lineWidth = 1.5;
    for (let y = 0; y < W; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); for (let x = (y / 32) % 2 * 32; x < W; x += 64) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); } }
    blotches(g, W, W, 14, 'rgba(110,100,80,0.14)', 20, 70, 112);
    return tex(c);
  });
}

/** Painted road markings on a transparent ground (lane lines etc.), for alpha-tested quads. */
export function markings(kind) {
  return once(`mark:${kind}`, () => {
    const W = 64, H = 512, c = canvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.fillStyle = kind === 'yellow' ? 'rgba(214,170,40,0.95)' : 'rgba(225,222,210,0.95)';
    if (kind === 'dashed') g.fillRect(24, 0, 16, H * 0.4);
    else g.fillRect(24, 0, 16, H);
    const t = tex(c); return t;
  });
}
