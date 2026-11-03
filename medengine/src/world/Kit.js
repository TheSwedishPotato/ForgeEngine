import {
  BoxGeometry, CylinderGeometry, PlaneGeometry, BufferGeometry, BufferAttribute, Mesh, InstancedMesh, Group, MeshStandardMaterial,
  MeshPhysicalMaterial, TextureLoader, SRGBColorSpace, RepeatWrapping, CanvasTexture, Matrix4, Vector3, Quaternion, Color, Object3D,
  ExtrudeGeometry, Shape, MathUtils, Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { isPacked, fetchBytes, toGLB } from './Packed.js';

/**
 * Med Engine 2 world kit: what sets are built from.
 *  - pbr(name, { scale }): a physically based material from a texture set (diffuse, normal,
 *    roughness) tiled at `scale` metres per repeat, with the engine's wet-surface flags
 *  - box/slab/column: geometry whose UVs are in metres, so every surface tiles at true scale
 *  - prop(url): a glTF model (cached), cloned per use
 *  - skyline(): a city of towers with lit windows (instanced, emissive window textures)
 *  - sign(): an emissive sign from text
 */

const loader = new TextureLoader();
const texCache = new Map();
export let TEX_ROOT = './assets/tex';
export function setTexRoot(r) { TEX_ROOT = r; }

function tex(url, srgb) {
  let t = texCache.get(url);
  if (!t) {
    t = loader.load(url);
    t.wrapS = t.wrapT = RepeatWrapping;
    if (srgb) t.colorSpace = SRGBColorSpace;
    texCache.set(url, t);
  }
  return t;
}

/** A tiled PBR material. UVs are expected in metres (see box() and uvMeters()). */
export function pbr(name, { scale = 2, color = 0xffffff, roughness = 1, metalness = 0, normalScale = 1, puddles = false, streaks = false, wet = 1, emissive = null } = {}) {
  const m = new MeshStandardMaterial({ color, roughness, metalness });
  const set = (t) => { const c = t.clone(); c.repeat.set(1 / scale, 1 / scale); c.needsUpdate = true; return c; };
  m.map = set(tex(`${TEX_ROOT}/${name}_diff.webp`, true));
  m.normalMap = set(tex(`${TEX_ROOT}/${name}_nor.webp`, false));
  m.normalScale.set(normalScale, normalScale);
  m.roughnessMap = set(tex(`${TEX_ROOT}/${name}_rough.webp`, false));
  m.userData.puddles = puddles; m.userData.streaks = streaks; m.userData.wetFactor = wet;
  if (emissive) m.emissive = new Color(emissive);
  return m;
}

/** A plain material in the engine's language. */
export function mat(color, { roughness = 0.6, metalness = 0, clearcoat = 0, emissive = null, intensity = 1, type = null, wet = 1 } = {}) {
  const m = clearcoat ? new MeshPhysicalMaterial({ color, roughness, metalness, clearcoat }) : new MeshStandardMaterial({ color, roughness, metalness });
  if (emissive) { m.emissive = new Color(emissive); m.emissiveIntensity = intensity; }
  if (type) m.userData.medType = type;
  m.userData.wetFactor = wet;
  return m;
}

/** Rewrites a geometry's UVs as world metres from its positions (planar per face direction). */
export function uvMeters(g) {
  g = g.index ? g.toNonIndexed() : g;
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  const uv = new Float32Array((p.length / 3) * 2);
  for (let i = 0; i < p.length / 3; i++) {
    const ax = Math.abs(n[i * 3]), ay = Math.abs(n[i * 3 + 1]), az = Math.abs(n[i * 3 + 2]);
    let u, v;
    if (ay >= ax && ay >= az) { u = p[i * 3]; v = p[i * 3 + 2]; } else if (ax >= az) { u = p[i * 3 + 2]; v = p[i * 3 + 1]; } else { u = p[i * 3]; v = p[i * 3 + 1]; }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return g;
}

/** A box at a position with metre UVs. */
export function box(w, h, d, material, pos = [0, 0, 0], { rotY = 0, cast = true, receive = true } = {}) {
  const g = new BoxGeometry(w, h, d);
  g.rotateY(rotY);
  g.translate(pos[0], pos[1], pos[2]);
  const m = new Mesh(uvMeters(g), material);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

/** Many boxes of one material merged into one mesh (static architecture). */
export function boxes(list, material, { cast = true } = {}) {
  const gs = list.map(([w, h, d, x, y, z, ry = 0]) => { const g = new BoxGeometry(w, h, d); g.rotateY(ry); g.translate(x, y, z); return uvMeters(g); });
  const m = new Mesh(mergeGeometries(gs), material);
  m.castShadow = cast; m.receiveShadow = true;
  m.userData.static = true;
  return m;
}

export function cylinder(r, h, material, pos = [0, 0, 0], { seg = 16, r2 = r, rotX = 0, rotZ = 0 } = {}) {
  const g = new CylinderGeometry(r2, r, h, seg);
  g.rotateX(rotX); g.rotateZ(rotZ);
  g.translate(pos[0], pos[1], pos[2]);
  const m = new Mesh(uvMeters(g), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** An extruded 2D outline (x,y points) to depth d, standing in the xy plane. */
export function extrude(points, depth, material, { bevel = 0.01 } = {}) {
  const s = new Shape(points.map(([x, y]) => new Vector2(x, y)));
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
  g.computeVertexNormals();
  return new Mesh(uvMeters(g), material);
}

// ---------------------------------------------------------------------------
// glTF props

const gltf = new GLTFLoader();
const propCache = new Map();
export let MODEL_ROOT = './assets/models';
export function setModelRoot(r) { MODEL_ROOT = r; }

/** Loads a Poly Haven-style model folder (name/name_1k.gltf); returns a fresh clone each call. */
export async function prop(name, { scale = 1, wet = 1 } = {}) {
  let p = propCache.get(name);
  if (!p) {
    const dir = `${MODEL_ROOT}/${name}/`, file = `${dir}${name}_1k.gltf`;
    // packed pages carry the buffer as text: the glTF is assembled into a GLB in memory
    const load = isPacked()
      ? fetch(file).then((r) => r.json()).then(async (j) => gltf.parseAsync(toGLB(j, await fetchBytes(dir + j.buffers[0].uri)), dir))
      : gltf.loadAsync(file);
    p = load.then((g) => {
      g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) o.material.userData.wetFactor = wet; } });
      return g.scene;
    });
    propCache.set(name, p);
  }
  const src = await p;
  const c = src.clone(true);
  c.scale.setScalar(scale);
  return c;
}

// ---------------------------------------------------------------------------
// The city: towers with lit windows

/** A canvas texture of a facade's windows: a few lit warm or cold, most dark, some blinds. */
function windowTexture(seed, cols = 8, rows = 24, lit = 0.28) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  // a faint fill (the facade catching the city's glow) and a lit crown band on some towers
  x.fillStyle = 'rgb(9,10,13)'; x.fillRect(0, 0, 128, 256);
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const cw = 128 / cols, ch = 256 / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (r() > lit) continue;
    const warm = r() < 0.7;
    const b = 0.35 + r() * 0.65;
    x.fillStyle = warm ? `rgba(255,${180 + r() * 40 | 0},${110 + r() * 50 | 0},${b})` : `rgba(${170 + r() * 40 | 0},${200 + r() * 30 | 0},255,${b})`;
    x.fillRect(i * cw + cw * 0.28, j * ch + ch * 0.25, cw * 0.44, ch * 0.5);
    if (r() < 0.3) { x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(i * cw + cw * 0.15, j * ch + ch * 0.2, cw * 0.7, ch * 0.6 * r()); }
  }
  if (seed % 3 === 0) { x.fillStyle = 'rgba(160,200,255,0.55)'; x.fillRect(0, 0, 128, 3); }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/**
 * A skyline around `centre`: towers on a jittered grid between rInner and rOuter, taller
 * toward a downtown point, each with lit windows (emissive), roof boxes, and blinking red
 * aircraft lights on the tallest. Returns { group, beacons } (beacons blink in update()).
 */
export function skyline({ centre = [0, 0], rInner = 60, rOuter = 520, ground = -40, downtown = [120, -260], count = 420, seed = 7 } = {}) {
  const group = new Group();
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const facade = [0, 1, 2, 3].map((k) => {
    const m = new MeshStandardMaterial({ color: 0x15171b, roughness: 0.55, metalness: 0.2 });
    m.emissiveMap = windowTexture(seed * 13 + k * 101, 8, 24, 0.22 + k * 0.05);
    m.emissive = new Color(4.2, 3.6, 3.0);
    m.map = null;
    m.userData.wetFactor = 1;
    return m;
  });
  const geos = [[], [], [], []];
  const tall = [];
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = rInner + Math.sqrt(r()) * (rOuter - rInner);
    const x = centre[0] + Math.cos(a) * d, z = centre[1] + Math.sin(a) * d;
    const dt = Math.hypot(x - downtown[0], z - downtown[1]);
    const near = MathUtils.smoothstep(d, rInner, rInner * 2.5);
    const h = (28 + r() * 55) * (1 + 3.2 * Math.exp(-dt / 220)) * (r() < 0.08 ? 1.7 : 1) * (0.35 + 0.65 * near);
    const w = 14 + r() * 22, dd = 14 + r() * 22;
    const g = new BoxGeometry(w, h, dd);
    g.translate(x, ground + h / 2, z);
    // UVs: windows every ~3.5 m (one texture repeat = 8 x 24 windows)
    const p = g.attributes.position.array, n = g.attributes.normal.array, uv = g.attributes.uv.array;
    for (let v = 0; v < p.length / 3; v++) {
      const side = Math.abs(n[v * 3]) > 0.5 ? p[v * 3 + 2] : p[v * 3];
      uv[v * 2] = side / 28; uv[v * 2 + 1] = (p[v * 3 + 1] - ground) / 84;
      if (Math.abs(n[v * 3 + 1]) > 0.5) { uv[v * 2] = 0.02; uv[v * 2 + 1] = 0.997; }
    }
    geos[i % 4].push(g);
    if (h > 110) tall.push([x, ground + h, z]);
    // a setback crown on some towers
    if (h > 60 && r() < 0.5) { const g2 = new BoxGeometry(w * 0.6, h * 0.12, dd * 0.6); g2.translate(x, ground + h + h * 0.06, z); geos[(i + 1) % 4].push(g2); }
  }
  geos.forEach((gs, k) => { if (!gs.length) return; const m = new Mesh(mergeGeometries(gs), facade[k]); m.userData.static = true; m.castShadow = false; m.frustumCulled = false; group.add(m); });
  // beacons: small emissive spheres-as-boxes, blinking
  const beaconMat = new MeshStandardMaterial({ color: 0x000000, emissive: new Color(8, 0.3, 0.2) });
  const beacons = new InstancedMesh(new BoxGeometry(0.8, 0.8, 0.8), beaconMat, Math.max(1, tall.length));
  const m4 = new Matrix4();
  tall.forEach((p, i) => beacons.setMatrixAt(i, m4.makeTranslation(p[0], p[1] + 1.2, p[2])));
  beacons.count = tall.length;
  group.add(beacons);
  return { group, beacons, update(t) { beaconMat.emissiveIntensity = (Math.sin(t * 3) > 0.6 ? 1 : 0.05); } };
}

/** An emissive sign from text (neon, exit signs, pillar numbers). */
export function sign(text, { w = 1, h = 0.3, color = '#ff3355', bg = null, font = 'bold 72px sans-serif', intensity = 3, glow = true } = {}) {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); } else x.clearRect(0, 0, c.width, c.height);
  x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (glow) { x.shadowColor = color; x.shadowBlur = 18; }
  x.fillStyle = color; x.fillText(text, c.width / 2, c.height / 2);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  const m = new MeshStandardMaterial({ color: 0x000000, emissive: new Color(1, 1, 1), emissiveMap: t, emissiveIntensity: intensity, map: bg ? t : null, alphaTest: bg ? 0 : 0.05, transparent: false });
  if (!bg) { m.map = t; m.alphaTest = 0.1; }
  const mesh = new Mesh(new PlaneGeometry(w, h), m);
  return mesh;
}

export { Group, Mesh, Vector3, Color, Object3D, MathUtils, Quaternion, Matrix4, InstancedMesh, mergeGeometries, BufferGeometry, BufferAttribute, PlaneGeometry, BoxGeometry, CylinderGeometry, MeshStandardMaterial, MeshPhysicalMaterial };
