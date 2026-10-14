/**
 * Things that stand about the town: street lamps of each period (gas lamps on posts in 1885,
 * cast-iron globes in the 1950s, sodium cobra-heads by 1985, white LED heads in 2015), trees
 * (valley oaks, the twin pines as saplings or grown), sign boards and the mall's pylon.
 * Built into a geometry Builder; lamps also return their light points.
 */
import { Vector3, Matrix4, Color, MeshStandardMaterial } from 'three';
import { plateTexture, rng } from '../car/textures.js';

const V = (x, y, z) => new Vector3(x, y, z);

export const LAMP_COLORS = {
  gas: new Color(1.0, 0.7, 0.38), incandescent: new Color(1.0, 0.78, 0.5), sodium: new Color(1.0, 0.62, 0.24), led: new Color(0.92, 0.95, 1.0), mercury: new Color(0.8, 0.95, 1.0),
};

/**
 * A street lamp at (x, z), facing the road along `facing` (radians about y: the arm points
 * that way). Returns its light: { pos, color, power } (power in candela / 10 000 at the lamp).
 */
export function streetLamp(b, kind, x, z, facing = 0) {
  const c = Math.cos(facing), s = Math.sin(facing);
  const dir = V(c, 0, -s);
  if (kind === 'gas') {
    b.cylinder('ironBlack', V(x, 0, z), V(x, 3.0, z), 0.07, 0.05, { segs: 8 });
    b.box('ironBlack', [x - 0.22, 3.0, z - 0.22], [x + 0.22, 3.04, z + 0.22]);
    b.box('lampGlass', [x - 0.18, 3.04, z - 0.18], [x + 0.18, 3.5, z + 0.18]);
    b.cylinder('ironBlack', V(x, 3.5, z), V(x, 3.75, z), 0.26, 0.02, { segs: 4 });
    return { pos: V(x, 3.3, z), color: LAMP_COLORS.gas, power: 0.006, range: 14 };
  }
  if (kind === 'incandescent') {
    // a fluted cast-iron post with a white globe on top
    b.lathe('ironBlack', V(x, 0, z), V(0, 1, 0), [[0.2, 0], [0.18, 0.4], [0.1, 0.6], [0.08, 3.6], [0.12, 3.8], [0.12, 3.9]], { segs: 10 });
    b.lathe('lampGlass', V(x, 3.9, z), V(0, 1, 0), [[0.12, 0], [0.26, 0.2], [0.3, 0.42], [0.24, 0.66], [0.08, 0.76], [0.0, 0.78]], { segs: 14 });
    return { pos: V(x, 4.3, z), color: LAMP_COLORS.incandescent, power: 0.035, range: 22 };
  }
  // a tall pole with a mast arm and a cobra head (sodium) or a flat LED head
  const h = kind === 'led' ? 9 : 9.5;
  b.cylinder('steelPole', V(x, 0, z), V(x, h, z), 0.11, 0.07, { segs: 8 });
  const tip = V(x, h, z).addScaledVector(dir, 2.4);
  b.cylinder('steelPole', V(x, h - 0.2, z), tip.clone().setY(h + 0.15), 0.045, 0.04, { segs: 6 });
  const m = new Matrix4().makeRotationY(facing).setPosition(tip.x, h + 0.05, tip.z);
  b.transform(m);
  if (kind === 'led') { b.box('steelPole', [-0.1, -0.06, -0.18], [0.65, 0.04, 0.18]); b.box('lampGlass', [0.0, -0.075, -0.14], [0.6, -0.06, 0.14]); }
  else { b.box('steelPole', [-0.15, -0.12, -0.2], [0.6, 0.08, 0.2]); b.box('lampGlass', [0.0, -0.18, -0.15], [0.52, -0.12, 0.15]); }
  b.transform(null);
  const p = tip.clone().addScaledVector(dir, 0.3).setY(h - 0.15);
  return { pos: p, color: kind === 'led' ? LAMP_COLORS.led : LAMP_COLORS.sodium, power: kind === 'led' ? 0.16 : 0.22, range: 42 };
}

/** The mall's lot lights: a tall pole with two square heads back to back. */
export function lotLight(b, x, z) {
  b.cylinder('steelPole', V(x, 0, z), V(x, 11, z), 0.14, 0.09, { segs: 8 });
  b.box('concreteBase', [x - 0.4, 0, z - 0.4], [x + 0.4, 0.6, z + 0.4]);
  const out = [];
  for (const s of [1, -1]) {
    b.box('steelPole', [Math.min(x + s * 0.1, x + s * 1.1), 10.8, z - 0.05], [Math.max(x + s * 0.1, x + s * 1.1), 10.9, z + 0.05]);
    const hx = x + s * 1.3;
    b.box('steelPole', [hx - 0.35, 10.6, z - 0.35], [hx + 0.35, 10.95, z + 0.35]);
    b.box('lampGlass', [hx - 0.3, 10.55, z - 0.3], [hx + 0.3, 10.6, z + 0.3]);
    out.push({ pos: V(hx, 10.4, z), color: LAMP_COLORS.sodium, power: 0.32, range: 48 });
  }
  return out;
}

/** A valley oak: a short trunk, a broad lumpy crown (clusters of soft blobs). */
export function oak(b, x, z, size = 1, seed = 1) {
  const r = rng(seed * 7919 + 13);
  const h = 3.2 * size;
  b.cylinder('bark', V(x, 0, z), V(x + (r() - 0.5) * 0.6, h, z + (r() - 0.5) * 0.6), 0.35 * size, 0.26 * size, { segs: 8 });
  const n = 7 + Math.floor(r() * 5);
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2, d = (1.5 + r() * 3.2) * size, y = h + (0.6 + r() * 3.5) * size, rad = (1.7 + r() * 1.6) * size;
    b.soft('leaves', [x + Math.cos(a) * d - rad, y - rad * 0.75, z + Math.sin(a) * d - rad], [x + Math.cos(a) * d + rad, y + rad * 0.75, z + Math.sin(a) * d + rad], rad * 0.95, { k: 2 });
  }
}

/** A pine: grown (by 1985) or a sapling (in 1955). */
export function pine(b, x, z, height, seed = 1) {
  const r = rng(seed * 104729 + 7);
  b.cylinder('bark', V(x, 0, z), V(x, height * 0.95, z), Math.max(0.05, height * 0.022), 0.03, { segs: 7 });
  const tiers = Math.max(3, Math.round(height / 1.4));
  for (let k = 0; k < tiers; k++) {
    const t = k / tiers, y0 = height * (0.18 + t * 0.78), rad = height * 0.3 * (1 - t * 0.85) * (0.9 + r() * 0.2);
    b.cylinder('needles', V(x, y0, z), V(x, y0 + height * 0.2, z), rad, rad * 0.15, { segs: 9, phase: r() * 3 });
  }
}

/** A text sign texture: colour, letters. */
export function signTexture(text, { w = 1024, h = 256, bg = '#1c2a52', fg = '#f4ead2', font = 'bold 120px Georgia, serif', border = null, sub = null, subFont = 'bold 52px Arial, sans-serif' } = {}) {
  return plateTexture(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (border) { g.strokeStyle = border; g.lineWidth = 12; g.strokeRect(10, 10, w - 20, h - 20); }
    g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, sub ? h * 0.4 : h / 2 + 4);
    if (sub) { g.font = subFont; g.fillText(sub, w / 2, h * 0.78); }
  });
}

export function signMaterial(text, opts = {}, { glow = 0 } = {}) {
  const t = signTexture(text, opts);
  return new MeshStandardMaterial({ map: t, roughness: 0.55, emissiveMap: glow ? t : null, emissive: new Color(glow, glow, glow) });
}
