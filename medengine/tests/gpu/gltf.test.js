// glTF assets drawn by the real renderer: skinning, morph targets and texture orientation must come out the way the glTF spec says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gpuContext, makePlatform } from './helpers.js';
import { Engine, DirectionalLight, Animator, GLTFLoader } from '../../src/index.js';
import { GLTFBuilder, arm, png, dataURI } from '../helpers/gltf.js';

const ctx = await gpuContext();
const skip = ctx ? false : 'WebGPU not available';
const W = 320, H = 180;
const px = (img, x, y) => { const o = (Math.round(y) * img.width + Math.round(x)) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
/** The fraction of the pixels in a box that are not sky (the sky is blue-ish: b >= r). */
const coverage = (img, x0, y0, x1, y1) => {
  let n = 0, tot = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const [r, , b] = px(img, x, y); tot++; if (r > b * 1.25) n++; }
  return n / tot;
};

async function stage(model) {
  const platform = makePlatform({ width: W, height: H });
  const engine = await Engine.create({ platform, quality: 'low' });
  engine.stage.renderer.gpu.errors.length = 0;
  const sun = new DirectionalLight(0xffffff, 6); sun.position.set(2, 4, 6); engine.scene.add(sun);
  const loader = new GLTFLoader({ platform });
  const gltf = await loader.parse(model.glb());
  engine.scene.add(gltf.scene);
  engine.camera.fov = 35;
  engine.camera.position.set(0.5, 0.5, 3); engine.camera.lookAt(0.5, 0.5, 0);
  engine.stage.fitCamera();
  return { engine, gltf };
}

test('glTF skinning in the renderer: the elbow bends and the mesh node transform is ignored', { skip }, async () => {
  const { engine, gltf } = await stage(arm());
  const anim = new Animator(gltf.scene);
  engine.run(14, 1 / 60);
  const rest = await engine.screenshot();
  // The arm lies along +X from the origin although its node sits at (10, 20, 30). Screen scale: ~95 px per metre, world (0.5, 0.5) at the centre.
  // upper arm (x 0..0.5, y ~ 0): pixels around world (0.25, 0) -> screen (136, 137); forearm tip world (0.8, 0) -> (188, 137)
  assert.ok(coverage(rest, 126, 132, 146, 142) > 0.8, 'upper arm is drawn at the origin, not at the node transform');
  assert.ok(coverage(rest, 180, 132, 196, 142) > 0.8, 'the straight forearm reaches x = 0.8');
  assert.ok(coverage(rest, 154, 100, 166, 118) < 0.05, 'nothing above the elbow while the arm is straight');

  anim.play(gltf.clip('bend'), { fade: 0, loop: false });
  anim.update(1);
  engine.run(14, 1 / 60);
  const bent = await engine.screenshot();
  assert.ok(coverage(bent, 126, 132, 146, 142) > 0.8, 'the upper arm does not move');
  assert.ok(coverage(bent, 154, 100, 166, 118) > 0.8, 'the forearm now points up from the elbow');
  assert.ok(coverage(bent, 180, 132, 196, 142) < 0.05, 'and is gone from x = 0.8');
  assert.deepEqual(engine.stage.renderer.gpu.errors, []);
  engine.dispose();
});

test('glTF morph targets in the renderer: animated weights move the vertices', { skip }, async () => {
  const b = new GLTFBuilder();
  // a 0.6 x 0.6 square left of the centre; target 0 slides it 0.8 to the right, target 1 raises it 0.8
  const P = b.accessor(new Float32Array([0.0, 0.2, 0, 0.6, 0.2, 0, 0.6, 0.8, 0, 0.0, 0.2, 0, 0.6, 0.8, 0, 0.0, 0.8, 0]), 'VEC3');
  const slide = new Float32Array(18); for (let i = 0; i < 6; i++) slide[i * 3] = 0.8;
  const rise = new Float32Array(18); for (let i = 0; i < 6; i++) rise[i * 3 + 1] = 0.8;
  const T0 = b.accessor(slide, 'VEC3'), T1 = b.accessor(rise, 'VEC3');
  b.add('materials', { pbrMetallicRoughness: { baseColorFactor: [1, 0.3, 0.1, 1], metallicFactor: 0, roughnessFactor: 1 }, emissiveFactor: [1, 0.3, 0.1], doubleSided: true });
  b.add('meshes', { name: 'quad', primitives: [{ attributes: { POSITION: P }, material: 0, targets: [{ POSITION: T0 }, { POSITION: T1 }] }] });
  const node = b.node({ name: 'Quad', mesh: 0 });
  const t = b.accessor(new Float32Array([0, 1]), 'SCALAR');
  const w = b.accessor(new Float32Array([0, 0, 1, 0]), 'SCALAR');
  b.add('animations', { name: 'slide', samplers: [{ input: t, output: w }], channels: [{ sampler: 0, target: { node, path: 'weights' } }] });
  const { engine, gltf } = await stage(b);
  const anim = new Animator(gltf.scene);
  engine.run(14, 1 / 60);
  const a = await engine.screenshot();
  // the square covers world x 0..0.6 (screen 113..170), y 0.2..0.8 (screen 118..61)
  assert.ok(coverage(a, 120, 80, 160, 110) > 0.8, 'at weight 0 the square is on the left');
  assert.ok(coverage(a, 190, 80, 230, 110) < 0.05);
  anim.play(gltf.clip('slide'), { fade: 0, loop: false });
  anim.update(1);                                                   // weight 1 on target 0: moved right by 0.8 m = 76 px
  engine.run(14, 1 / 60);
  const c = await engine.screenshot();
  assert.ok(coverage(c, 120, 80, 160, 110) < 0.1, 'it left the left side');
  assert.ok(coverage(c, 196, 80, 236, 110) > 0.8, 'and arrived on the right');
  assert.deepEqual(engine.stage.renderer.gpu.errors, []);
  engine.dispose();
});

test('glTF textures are upright: the first image row is the top of the quad', { skip }, async () => {
  // 2x2 image: top-left red, top-right green, bottom-left blue, bottom-right white; glTF UV (0,0) is the top-left of the image
  const img = png(2, 2, (x, y) => (y === 0 ? (x === 0 ? [255, 0, 0, 255] : [0, 255, 0, 255]) : (x === 0 ? [0, 0, 255, 255] : [255, 255, 255, 255])));
  const b = new GLTFBuilder();
  b.json.extensionsUsed = ['KHR_materials_unlit'];
  const P = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]), 'VEC3');
  const UV = b.accessor(new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]), 'VEC2');
  b.json.images = [{ uri: dataURI(img) }];
  b.json.samplers = [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }];
  b.json.textures = [{ source: 0, sampler: 0 }];
  b.add('materials', { pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, extensions: { KHR_materials_unlit: {} } });
  b.add('meshes', { primitives: [{ attributes: { POSITION: P, TEXCOORD_0: UV }, material: 0 }] });
  b.node({ mesh: 0 });
  const { engine } = await stage(b);
  engine.run(14, 1 / 60);
  const s = await engine.screenshot();
  // the quad spans world (0..1, 0..1): screen x 113..207, y 137..43
  const tl = px(s, 135, 66), tr = px(s, 185, 66), bl = px(s, 135, 115), br = px(s, 185, 115);
  // (tone mapping dims saturated colours, so classify by hue rather than comparing with 255)
  const hue = ([r, g, bl2]) => {
    const m = Math.max(r, g, bl2), lo = Math.min(r, g, bl2);
    if (m < 80) return 'dark';
    if (lo > m * 0.75) return 'white';
    return r === m && g < r * 0.3 && bl2 < r * 0.3 ? 'red' : g === m && r < g * 0.3 && bl2 < g * 0.3 ? 'green' : bl2 === m && r < bl2 * 0.3 && g < bl2 * 0.3 ? 'blue' : `mixed ${r},${g},${bl2}`;
  };
  assert.equal(hue(tl), 'red', `top-left ${tl}`);
  assert.equal(hue(tr), 'green', `top-right ${tr}`);
  assert.equal(hue(bl), 'blue', `bottom-left ${bl}`);
  assert.equal(hue(br), 'white', `bottom-right ${br}`);
  assert.deepEqual(engine.stage.renderer.gpu.errors, []);
  engine.dispose();
});
