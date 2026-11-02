import {
  BufferGeometry, BufferAttribute, SkinnedMesh, MeshPhysicalMaterial, CanvasTexture, SRGBColorSpace, Vector3, DoubleSide, RepeatWrapping,
} from 'three';
import { Cloth } from './Cloth.js';

/**
 * Garments the engine builds at load from a character's own body surface (so they fit
 * exactly and deform with the skin): masks and cowls, belts, decals, buzz cuts; and capes
 * simulated as GPU cloth. Each takes the Human (src/human/Human.js).
 */

const _v = new Vector3();

/** Rest-pose landmarks of a character (metres, facing +z). */
export function landmarks(h) {
  const r = (n) => h.bones[n].userData.rest.clone();
  const eyeL = r('eye_l'), eyeR = r('eye_r');
  return { head: r('head'), neck: r('neck_01'), chest: r('spine_03'), spine1: r('spine_01'), pelvis: r('pelvis'), eyeL, eyeR, eyeY: (eyeL.y + eyeR.y) / 2, eyeZ: (eyeL.z + eyeR.z) / 2 };
}

/**
 * Copies the triangles of the body whose three vertices pass `keep(p, n)` into a new skinned
 * mesh, each vertex pushed out along its normal by `offset(p, n)` metres. Skin weights and the
 * face shapes (morph slots) are shared with the body, so the piece moves with the face.
 */
export function bodyPiece(h, keep, offset, material, { name = 'piece', uv = null } = {}) {
  const g = h.body.geometry;
  const P = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array;
  const n = P.length / 3;
  const ok = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], q = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
    ok[v] = keep(p, q) ? 1 : 0;
  }
  const map = new Int32Array(n).fill(-1);
  const idx = [];
  let count = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (!(ok[a] && ok[b] && ok[c])) continue;
    for (const v of [a, b, c]) { if (map[v] < 0) map[v] = count++; idx.push(map[v]); }
  }
  const geo = new BufferGeometry();
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
  const si = new Uint16Array(count * 4), sw = new Float32Array(count * 4), ms = new Float32Array(count);
  const SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, UV = g.attributes.uv.array, MS = g.attributes.morphSlot?.array;
  for (let v = 0; v < n; v++) {
    const k = map[v];
    if (k < 0) continue;
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], q = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
    const o = offset(p, q);
    for (let c = 0; c < 3; c++) { pos[k * 3 + c] = p[c] + q[c] * o; nor[k * 3 + c] = q[c]; }
    const u = uv ? uv(p, q) : [UV[v * 2], UV[v * 2 + 1]];
    uvs[k * 2] = u[0]; uvs[k * 2 + 1] = u[1];
    for (let c = 0; c < 4; c++) { si[k * 4 + c] = SI[v * 4 + c]; sw[k * 4 + c] = SW[v * 4 + c]; }
    ms[k] = MS ? MS[v] : -1;
  }
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nor, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setAttribute('skinIndex', new BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new BufferAttribute(sw, 4));
  if (MS) geo.setAttribute('morphSlot', new BufferAttribute(ms, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mesh = new SkinnedMesh(geo, material);
  mesh.name = name;
  mesh.castShadow = true; mesh.frustumCulled = false;
  if (h.body.userData.morph && MS) mesh.userData.morph = h.body.userData.morph;
  h.root.add(mesh);
  mesh.bind(h.skeleton, h.body.bindMatrix);
  h.meshes.push(mesh);
  return mesh;
}

/** A rigid mesh riding one bone (pouches, ears, buckles). Geometry in rest-pose coordinates. */
export function rigidPiece(h, geo, boneName, material, name = 'rigid') {
  const n = geo.attributes.position.count;
  const bi = h.skeleton.bones.indexOf(h.bones[boneName]);
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
  geo.setAttribute('skinIndex', new BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new BufferAttribute(sw, 4));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const mesh = new SkinnedMesh(geo, material);
  mesh.name = name; mesh.castShadow = true; mesh.frustumCulled = false;
  h.root.add(mesh);
  mesh.bind(h.skeleton, h.body.bindMatrix);
  h.meshes.push(mesh);
  return mesh;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------
// The cowl

/** Darkens the skin around the eyes (the black under the mask). */
function eyeMakeup(h, L) {
  const g = h.body.geometry, P = g.attributes.position.array, n = P.length / 3;
  const col = new Float32Array(n * 3).fill(1);
  for (let v = 0; v < n; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    for (const e of [L.eyeL, L.eyeR]) {
      const d = Math.hypot((x - e.x) / 0.034, (y - e.y + 0.003) / 0.024) ;
      if (z > e.z - 0.03) { const k = 1 - smooth(0.75, 1.15, d); for (let c = 0; c < 3; c++) col[v * 3 + c] = Math.min(col[v * 3 + c], 1 - k * 0.94); }
    }
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  h.materials.skin.vertexColors = true;
  h.materials.skin.needsUpdate = true;
}

export function makeCowl(h) {
  const L = landmarks(h);
  eyeMakeup(h, L);
  const mat = new MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.34, clearcoat: 0.25 });
  mat.userData.medType = 'coat'; mat.userData.detail = 'leather'; mat.userData.wetFactor = 1;
  const neckBottom = L.neck.y - 0.045;
  const mouthC = new Vector3(0, L.eyeY - 0.088, 0);
  const keep = ([x, y, z], [nx, , nz]) => {
    if (y < neckBottom) return false;
    const front = z > L.head.z + 0.02 && nz > 0.1;
    // the mouth and chin stay bare: an oval under the nose
    if (front && Math.hypot(x / 0.056, (y - mouthC.y) / 0.062) < 1 && y < L.eyeY - 0.034) return false;
    // eye openings
    for (const e of [L.eyeL, L.eyeR]) if (front && Math.hypot((x - e.x) / 0.02, (y - e.y + 0.002) / 0.0125) < 1) return false;
    return true;
  };
  const offset = ([, y]) => 0.0035 + 0.006 * smooth(L.eyeY - 0.12, neckBottom, y);
  const cowl = bodyPiece(h, keep, offset, mat, { name: 'cowl' });
  // the ears: tapered, slightly swept back, on the crown
  let top = -Infinity;
  const P = h.body.geometry.attributes.position.array;
  for (let i = 1; i < P.length; i += 3) top = Math.max(top, P[i]);
  for (const s of [1, -1]) {
    const geo = earGeometry(0.075, 0.024);
    geo.rotateZ(-0.12 * s); geo.rotateX(-0.12);
    geo.translate(0.047 * s, top - 0.022, L.head.z + 0.005);
    rigidPiece(h, geo, 'head', mat, 'cowl-ear');
  }
  return cowl;
}

function earGeometry(height, base) {
  // a three-sided tapered spike with a flattened front: what reads as a bat ear in silhouette
  const ring = (y, r, flat) => [0, 1, 2, 3, 4, 5].map((k) => { const a = (k / 6) * Math.PI * 2; return [Math.cos(a) * r, y, Math.sin(a) * r * flat]; });
  const rings = [ring(0, base, 0.7), ring(height * 0.45, base * 0.6, 0.6), ring(height * 0.85, base * 0.18, 0.5)];
  const tip = [0, height, -0.004];
  const pos = [], idx = [];
  rings.forEach((r) => r.forEach((p) => pos.push(...p)));
  pos.push(...tip);
  for (let j = 0; j < 2; j++) for (let k = 0; k < 6; k++) {
    const a = j * 6 + k, b = j * 6 + ((k + 1) % 6), c = a + 6, d = b + 6;
    idx.push(a, c, b, b, c, d);
  }
  for (let k = 0; k < 6; k++) idx.push(12 + k, 18, 12 + ((k + 1) % 6));
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Belt and emblem

export function makeBelt(h) {
  const L = landmarks(h);
  const y0 = L.spine1.y - 0.075, y1 = y0 + 0.055;
  const mat = new MeshPhysicalMaterial({ color: 0x1c1a16, roughness: 0.4, metalness: 0.0, clearcoat: 0.2 });
  mat.userData.medType = 'coat'; mat.userData.detail = 'leather';
  const belt = bodyPiece(h, ([, y]) => y > y0 && y < y1, () => 0.016, mat, { name: 'belt' });
  // pouches around the belt line, and a buckle
  const metal = new MeshPhysicalMaterial({ color: 0x2a2924, roughness: 0.28, metalness: 0.85 });
  // find the belt's radius at a given angle from the body surface
  const P = h.body.geometry.attributes.position.array;
  const radiusAt = (ang) => {
    let best = 0;
    for (let i = 0; i < P.length; i += 3) {
      const y = P[i + 1];
      if (y < y0 || y > y1) continue;
      const a = Math.atan2(P[i], P[i + 2] - L.pelvis.z);
      if (Math.abs(a - ang) < 0.08) best = Math.max(best, Math.hypot(P[i], P[i + 2] - L.pelvis.z));
    }
    return best || 0.15;
  };
  const yc = (y0 + y1) / 2;
  for (const ang of [0.55, 0.95, 1.4, -0.55, -0.95, -1.4, 2.4, -2.4]) {
    const r = radiusAt(ang) + 0.028;
    const geo = roundedBox(0.05, 0.062, 0.03);
    geo.rotateY(ang);
    geo.translate(Math.sin(ang) * r, yc - 0.004, Math.cos(ang) * r + L.pelvis.z);
    rigidPiece(h, geo, 'pelvis', mat, 'pouch');
  }
  const buckle = roundedBox(0.07, 0.045, 0.012);
  buckle.translate(0, yc, radiusAt(0) + 0.024 + L.pelvis.z);
  rigidPiece(h, buckle, 'pelvis', metal, 'buckle');
  return belt;
}

function roundedBox(w, hgt, d) {
  // an eight-sided prism with bevelled edges
  const g = new BufferGeometry();
  const b = Math.min(w, hgt, d) * 0.25;
  const pts = [];
  const prof = [[-w / 2 + b, -hgt / 2], [w / 2 - b, -hgt / 2], [w / 2, -hgt / 2 + b], [w / 2, hgt / 2 - b], [w / 2 - b, hgt / 2], [-w / 2 + b, hgt / 2], [-w / 2, hgt / 2 - b], [-w / 2, -hgt / 2 + b]];
  for (const z of [-d / 2, d / 2 - b, d / 2]) for (const [x, y] of prof) {
    const s = z === d / 2 ? 0.88 : 1;
    pts.push(x * s, y * s, z);
  }
  const idx = [];
  for (let j = 0; j < 2; j++) for (let k = 0; k < 8; k++) {
    const a = j * 8 + k, c = j * 8 + ((k + 1) % 8);
    idx.push(a, c, a + 8, c, c + 8, a + 8);
  }
  for (let k = 1; k < 7; k++) idx.push(16, 16 + k, 16 + k + 1);
  g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array((pts.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** An original bat sigil for this Earth: angular, three points to each wing, drawn on a canvas. */
export function sigilTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  x.clearRect(0, 0, size, size);
  x.translate(size / 2, size / 2);
  x.scale(size / 2, size / 2);
  x.fillStyle = '#fff';
  x.beginPath();
  // right half, mirrored
  const half = [[0, -0.18], [0.05, -0.3], [0.08, -0.16], [0.2, -0.2], [0.55, -0.42], [0.98, -0.1], [0.74, 0.0], [0.62, 0.22], [0.42, 0.08], [0.3, 0.3], [0.14, 0.12], [0, 0.42]];
  x.moveTo(0, -0.18);
  for (const [px, py] of half) x.lineTo(px, py);
  for (let i = half.length - 1; i >= 0; i--) x.lineTo(-half[i][0], half[i][1]);
  x.closePath();
  x.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function makeEmblem(h) {
  const L = landmarks(h);
  const cy = L.chest.y + 0.03, w = 0.30, hh = 0.15;
  const mat = new MeshPhysicalMaterial({ color: 0x16161a, roughness: 0.3, metalness: 0.2, clearcoat: 0.4, alphaTest: 0.5 });
  mat.map = sigilTexture();
  mat.userData.medType = 'coat';
  return bodyPiece(h,
    ([x, y, z], [, , nz]) => nz > 0.35 && Math.abs(x) < w / 2 + 0.01 && Math.abs(y - cy) < hh / 2 + 0.01 && z > L.chest.z,
    () => 0.013, mat,
    { name: 'emblem', uv: ([x, y]) => [x / w + 0.5, (y - cy) / hh * 0.5 + 0.5] });
}

// ---------------------------------------------------------------------------
// Buzz cut: a stubble layer over the scalp, from the hairline back

function stubbleTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 512, 512);
  for (let i = 0; i < 60000; i++) {
    const a = 0.25 + Math.random() * 0.6;
    x.fillStyle = `rgba(20,16,13,${a})`;
    x.fillRect(Math.random() * 512, Math.random() * 512, 1, 1 + Math.random() * 1.5);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(6, 6);
  return t;
}

export function makeBuzzcut(h) {
  const L = landmarks(h);
  const mat = new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.7, alphaTest: 0.25, map: stubbleTexture(), transparent: false, side: DoubleSide });
  mat.userData.medType = 'hair'; mat.userData.dither = true;
  return bodyPiece(h, ([x, y, z]) => {
    const theta = Math.abs(Math.atan2(x, z - L.head.z));
    const line = L.eyeY + 0.064 + (L.neck.y + 0.06 - (L.eyeY + 0.064)) * smooth(0.9, 2.7, theta);
    if (Math.abs(x) > 0.062 && y < L.eyeY + 0.03 && theta < 2.4) return false;   // ears and sideburn gap
    return y > line;
  }, () => 0.0012, mat, { name: 'buzzcut' });
}

// ---------------------------------------------------------------------------
// The cape: GPU cloth hung from the shoulders, colliding with the body

export class Cape {
  constructor(h, r, { length = 1.34, width = 0.98, color = 0x07070a } = {}) {
    this.h = h;
    const mat = new MeshPhysicalMaterial({ color, roughness: 0.58, sheen: 0.35 });
    mat.userData.medType = 'cloth'; mat.userData.detail = 'fabric';
    this.cloth = new Cloth({ width, length, material: mat, scallops: 7, scallopDepth: 0.075 });
    this.mesh = this.cloth.mesh;
    this.caps = Array.from({ length: 9 }, () => ({ a: new Vector3(), b: new Vector3(), r: 0.1 }));
    this.wind = new Vector3();
    this._t = performance.now();
  }
  get visible() { return this.mesh.visible; }
  set visible(v) { this.mesh.visible = v; }
  update(dt = 1 / 60) {
    const B = this.h.bones, c = this.cloth;
    if (!this.mesh.parent && this.h.root.parent) this.h.root.parent.add(this.mesh);
    const back = new Vector3(0, 0, -1).applyQuaternion(B.spine_03.getWorldQuaternion(this.mesh.quaternion.clone()));
    const left = B.upperarm_l.getWorldPosition(new Vector3()).addScaledVector(back, 0.07); left.y += 0.06;
    const right = B.upperarm_r.getWorldPosition(new Vector3()).addScaledVector(back, 0.07); right.y += 0.06;
    const w = (a, b, i, r) => { B[a].getWorldPosition(this.caps[i].a); B[b].getWorldPosition(this.caps[i].b); this.caps[i].r = r; };
    w('spine_01', 'spine_03', 0, 0.16); w('pelvis', 'spine_01', 1, 0.16);
    w('thigh_l', 'calf_l', 2, 0.09); w('thigh_r', 'calf_r', 3, 0.09);
    w('calf_l', 'foot_l', 4, 0.065); w('calf_r', 'foot_r', 5, 0.065);
    w('upperarm_l', 'lowerarm_l', 6, 0.065); w('upperarm_r', 'lowerarm_r', 7, 0.065);
    w('spine_03', 'neck_01', 8, 0.11);
    c.setAnchors(right, left, back);
    c.caps = this.caps;
    c.ground = this.h.root.getWorldPosition(new Vector3()).y;
    c.wind.copy(this.wind);
    c.step(dt);
  }
}

/** Applies the garments named in a character's meta (from its recipe). */
export function dress(h, r) {
  const out = {};
  for (const g of h.meta.garments ?? []) {
    if (g === 'cowl') out.cowl = makeCowl(h);
    else if (g === 'belt') out.belt = makeBelt(h);
    else if (g === 'emblem') out.emblem = makeEmblem(h);
    else if (g === 'buzzcut') out.buzzcut = makeBuzzcut(h);
    else if (g === 'cape' && r) out.cape = new Cape(h, r);
  }
  return out;
}
