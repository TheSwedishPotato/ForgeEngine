/**
 * The cloud deck: a stratocumulus layer from the cloud base (where the air reaches its dew point,
 * physics/atmos.js) to its top, drifting with the wind at its height. Seen from below it is a broken
 * grey underside, from above a sunlit white floor with gaps, and from inside it the world goes white:
 * layered veils round the tower thin the view out to a few tens of metres, as a cloud's droplets do
 * (visibility in stratocumulus is typically 30 to 100 m).
 */
import { Mesh, BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, MeshBasicMaterial, CanvasTexture, RepeatWrapping, SRGBColorSpace, Color, Group } from 'three';

function noiseTex(size, cover, seed) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size);
  // value noise, five octaves, tileable
  const lat = (n, s) => { const a = new Float32Array(n * n); let x = s; for (let i = 0; i < a.length; i++) { x = (x * 16807) % 2147483647; a[i] = x / 2147483647; } return a; };
  const oct = [4, 8, 16, 32, 64].map((n, i) => ({ n, a: lat(n, seed + i * 977), w: 1 / (1 << i) }));
  const sm = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, wsum = 0;
    for (const o of oct) {
      const fx = (x / size) * o.n, fy = (y / size) * o.n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
      const A = (i, j) => o.a[((j % o.n) * o.n + (i % o.n))];
      v += o.w * ((A(x0, y0) * (1 - tx) + A(x0 + 1, y0) * tx) * (1 - ty) + (A(x0, y0 + 1) * (1 - tx) + A(x0 + 1, y0 + 1) * tx) * ty); wsum += o.w;
    }
    v /= wsum;
    const d = Math.max(0, Math.min(1, (v - (1 - cover) * 0.75 - 0.12) * 3));
    const k = (y * size + x) * 4, l = 200 + 55 * d;
    img.data[k] = l; img.data[k + 1] = l; img.data[k + 2] = l + 3; img.data[k + 3] = Math.round(255 * d);
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace;
  return t;
}

/** A flat rectangle at height y over [x0, x1] x [z0, z1], facing up or down, its texture laid in world metres. */
function sheet(x0, x1, z0, z1, y, up, scale) {
  const p = up ? [x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0] : [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new Float32BufferAttribute([0, up ? 1 : -1, 0, 0, up ? 1 : -1, 0, 0, up ? 1 : -1, 0, 0, up ? 1 : -1, 0], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 2, 4, 5, 6, 8, 9, 11].map((i) => p[i] / scale), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
/** A vertical rectangle from a to b (x, z) between heights y0 and y1, facing the tower (inward). */
function wall(a, b, y0, y1, scale) {
  const p = [a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]];
  const nx = -(b[1] - a[1]), nz = b[0] - a[0], l = Math.hypot(nx, nz);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new Float32BufferAttribute(Array(4).fill([nx / l, 0, nz / l]).flat(), 3));
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) / scale;
  g.setAttribute('uv', new Float32BufferAttribute([0, y0 / scale, L, y0 / scale, L, y1 / scale, 0, y1 / scale], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

export class Clouds {
  constructor(scene, atmos, hole) {
    this.A = atmos;
    const base = atmos.cloudBase, top = atmos.cloudTop, R = 5000, [hx0, hx1, hz0, hz1] = hole;
    this.deckTex = noiseTex(512, 0.8, 11);
    const deck = new MeshStandardMaterial({ color: 0xffffff, map: this.deckTex, alphaTest: 0.35, roughness: 1, metalness: 0 });
    // the underside: lit by the sky through the cloud, not by the sun: an even grey
    const under = new MeshBasicMaterial({ color: new Color(0.5, 0.52, 0.56), map: this.deckTex, alphaTest: 0.35 });
    const g = (this.group = new Group()); scene.add(g);
    // the deck's underside and top, round the tower (the tower's own floors are not cut by it)
    const frame = [[-R, R, -R, hz0], [-R, R, hz1, R], [-R, hx0, hz0, hz1], [hx1, R, hz0, hz1]];
    for (const [x0, x1, z0, z1] of frame) {
      g.add(new Mesh(sheet(x0, x1, z0, z1, base, false, 900), under));
      g.add(new Mesh(sheet(x0, x1, z0, z1, top, true, 900), deck));
      g.add(new Mesh(sheet(x0, x1, z0, z1, (base + top) / 2, true, 700), deck));
    }
    // inside the cloud: veils round the tower at 25, 45 and 70 m, the farthest solid white
    this.veilTex = noiseTex(256, 0.95, 5);
    this.veils = new Group(); scene.add(this.veils);
    [[25, 0.55], [45, 0.4], [70, 0]].forEach(([d, at], i) => {
      const m = new MeshBasicMaterial({ color: new Color(0.62, 0.64, 0.68), map: at ? this.veilTex : null, alphaTest: at || 0, });
      const x0 = hx0 - d, x1 = hx1 + d, z0 = hz0 - d, z1 = hz1 + d;
      for (const [a, b] of [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]]) this.veils.add(new Mesh(wall(a, b, base, top, 60 + i * 20), m));
      this.veils.add(new Mesh(sheet(x0, x1, z0, z1, base + 0.5, true, 60), m), new Mesh(sheet(x0, x1, z0, z1, top - 0.5, false, 60), m));
    });
    for (const m of [...g.children, ...this.veils.children]) { m.frustumCulled = false; m.castShadow = false; }
  }

  /** The deck drifts with the wind at its height; the veils are there only while you are in the cloud. */
  update(dt, cam) {
    const A = this.A, v = A.mean((A.cloudBase + A.cloudTop) / 2), d = A.dir + A.nd;
    // the wind blows from dir: the cloud moves the other way
    this.deckTex.offset.x -= (Math.sin(d) * v * dt) / 900; this.deckTex.offset.y -= (Math.cos(d) * v * dt) / 900;
    const y = cam.position.y;
    this.veils.visible = y > A.cloudBase - 2 && y < A.cloudTop + 2;
  }
}
