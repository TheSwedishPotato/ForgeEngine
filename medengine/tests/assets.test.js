import test from 'node:test';
import assert from 'node:assert/strict';
import { NodePlatform } from '../src/platform/node.js';
import {
  GLTFLoader, GLTFAsset, splitGLB, AssetManager, cloneModel, parseOBJ, parseMTL,
  Animator, AnimationClip, Track, Scene, Group, Matrix4, Vector3, Quaternion, DoubleSide, Bone, SkinnedMesh, Mesh,
  Engine,
} from '../src/index.js';
import { GLTFBuilder, triangle, arm, png, dataURI } from './helpers/gltf.js';

const near = (a, b, eps = 1e-5, msg) => assert.ok(Math.abs(a - b) <= eps, msg ?? `${a} is not within ${eps} of ${b}`);
const platform = new NodePlatform();
const load = (builder, opts = {}) => new GLTFLoader({ platform, ...opts }).parse(builder.glb(), opts);

// -------------------------------------------------------------------------------------------------- container

test('GLB container: chunks are split and errors are clear', () => {
  const b = triangle();
  const { json, bin } = splitGLB(b.glb());
  assert.equal(json.asset.version, '2.0');
  assert.ok(bin.length >= b.length);
  assert.throws(() => splitGLB(new Uint8Array(40)), /missing "glTF" header/);
  const v1 = b.glb(); new DataView(v1.buffer).setUint32(4, 1, true);
  assert.throws(() => splitGLB(v1), /version 1/);
});

test('a triangle loads from .glb, from .gltf with a data URI and from .gltf with an external .bin', async () => {
  const b = triangle();
  for (const gltf of [await load(b), await new GLTFLoader({ platform }).parse(b.gltf()), await (async () => {
    const { json, bin } = b.gltf({ external: 'tri.bin' });
    return new GLTFLoader({ platform, readFile: async (u) => { assert.equal(u, 'models/tri.bin'); return bin; } }).parse(json, { baseUrl: 'models/' });
  })()]) {
    assert.ok(gltf instanceof GLTFAsset);
    assert.equal(gltf.scene.children.length, 1);
    const m = gltf.scene.children[0];
    assert.ok(m.isMesh && !m.isSkinnedMesh);
    assert.equal(m.name, 'Tri');
    assert.deepEqual([...m.geometry.attributes.position.array], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    assert.deepEqual([...m.geometry.attributes.uv.array], [0, 0, 1, 0, 0, 1]);
    assert.deepEqual([...m.geometry.index.array], [0, 1, 2]);
    assert.ok(m.castShadow && m.receiveShadow);
    // glTF's default material: white, metallic 1, roughness 1
    assert.equal(m.material.metalness, 1); assert.equal(m.material.roughness, 1);
  }
});

test('loading refuses what it cannot show correctly', async () => {
  const b = triangle(); b.json.extensionsRequired = ['KHR_draco_mesh_compression'];
  await assert.rejects(() => load(b), /Draco|compress/i);
  const c = triangle(); c.json.extensionsRequired = ['VENDOR_magic'];
  await assert.rejects(() => load(c), /VENDOR_magic/);
  const d = triangle(); d.json.asset.version = '1.0';
  await assert.rejects(() => load(d), /version 1\.0/);
  const e = triangle(); e.json.meshes[0].primitives[0].indices = 99;
  await assert.rejects(() => load(e), /accessor 99/);
  const f = triangle(); f.json.buffers[0].byteLength += 1000;
  await assert.rejects(() => load(f), /buffer 0 is/);
});

// -------------------------------------------------------------------------------------------------- accessors

test('interleaved, normalised and quantised vertex data is de-interleaved and converted to floats', async () => {
  const b = new GLTFBuilder();
  const bytes = new ArrayBuffer(20 * 3), dv = new DataView(bytes);
  const pos = [[0, 0, 0], [1, 0, 0], [0, 1, 0]], uv = [[0, 0], [65535, 0], [0, 32768]], col = [[255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 0]];
  for (let i = 0; i < 3; i++) {
    pos[i].forEach((v, k) => dv.setFloat32(i * 20 + k * 4, v, true));
    dv.setUint16(i * 20 + 12, uv[i][0], true); dv.setUint16(i * 20 + 14, uv[i][1], true);
    col[i].forEach((v, k) => dv.setUint8(i * 20 + 16 + k, v));
  }
  const view = b.view(new Uint8Array(bytes), { stride: 20, target: 34962 });
  b.json.accessors.push({ bufferView: view, byteOffset: 0, componentType: 5126, count: 3, type: 'VEC3' });
  b.json.accessors.push({ bufferView: view, byteOffset: 12, componentType: 5123, normalized: true, count: 3, type: 'VEC2' });
  b.json.accessors.push({ bufferView: view, byteOffset: 16, componentType: 5121, normalized: true, count: 3, type: 'VEC4' });
  b.add('meshes', { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1, COLOR_0: 2 } }] });
  b.node({ mesh: 0 });
  const g = (await load(b)).scene.children[0];
  assert.deepEqual([...g.geometry.attributes.position.array], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const u = g.geometry.attributes.uv.array;
  near(u[2], 1); near(u[5], 32768 / 65535, 1e-6);
  const c = g.geometry.attributes.color;
  assert.equal(c.itemSize, 4);
  near(c.array[0], 1); near(c.array[4 + 1], 1); near(c.array[4 + 3], 128 / 255, 1e-6);
  assert.ok(g.material.vertexColors, 'COLOR_0 turns on vertex colours');
  assert.ok(g.material.flatShading, 'a primitive without NORMAL is flat shaded');
  assert.equal(g.geometry.index, null);
});

test('KHR_mesh_quantization: non-normalised int16 positions are cast, normalised ones scaled', async () => {
  const b = new GLTFBuilder();
  const p = b.accessor(new Int16Array([0, 0, 0, 100, 0, 0, 0, 200, 0]), 'VEC3');
  const n = b.accessor(new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127]), 'VEC3', { normalized: true });
  b.add('meshes', { primitives: [{ attributes: { POSITION: p, NORMAL: n } }] });
  b.node({ mesh: 0, scale: [0.01, 0.01, 0.01] });
  const g = (await load(b)).scene.children[0];
  assert.deepEqual([...g.geometry.attributes.position.array], [0, 0, 0, 100, 0, 0, 0, 200, 0]);
  near(g.geometry.attributes.normal.array[2], 1);
  near(g.scale.x, 0.01);
});

test('sparse accessors overwrite a zero base; strips and fans become triangles', async () => {
  const b = new GLTFBuilder();
  const idxView = b.view(new Uint8Array(new Uint16Array([1, 4]).buffer));
  const valView = b.view(new Uint8Array(new Float32Array([1, 2, 3, 4, 5, 6]).buffer));
  b.json.accessors.push({ componentType: 5126, count: 6, type: 'VEC3', sparse: { count: 2, indices: { bufferView: idxView, componentType: 5123 }, values: { bufferView: valView } } });
  b.add('meshes', { primitives: [{ attributes: { POSITION: 0 } }] });
  b.node({ mesh: 0 });
  const g = (await load(b)).scene.children[0];
  assert.deepEqual([...g.geometry.attributes.position.array], [0, 0, 0, 1, 2, 3, 0, 0, 0, 0, 0, 0, 4, 5, 6, 0, 0, 0]);

  const s = triangle();
  const four = s.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 'VEC3');
  const ids = s.accessor(new Uint16Array([0, 1, 2, 3]), 'SCALAR');
  s.json.meshes[0].primitives.push({ attributes: { POSITION: four }, indices: ids, mode: 5 }, { attributes: { POSITION: four }, indices: ids, mode: 6 }, { attributes: { POSITION: four }, mode: 1 });
  const sg = await load(s);
  const meshes = sg.meshes;
  assert.equal(meshes.length, 3, 'the line primitive is skipped');
  assert.deepEqual([...meshes[1].geometry.index.array], [0, 1, 2, 2, 1, 3], 'strip');
  assert.deepEqual([...meshes[2].geometry.index.array], [0, 1, 2, 0, 2, 3], 'fan');
  assert.ok(sg.warnings.some((w) => /lines/.test(w)));
  assert.ok(meshes[1].parent.type === 'Group' && meshes[1].parent.name === 'Tri', 'a node with several primitives is a Group of meshes');
});

test('eight joint influences per vertex keep the strongest four, weights are renormalised', async () => {
  const b = new GLTFBuilder();
  const P = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3');
  const J0 = b.accessor(new Uint8Array([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]), 'VEC4');
  const J1 = b.accessor(new Uint8Array([4, 5, 6, 7, 4, 5, 6, 7, 4, 5, 6, 7]), 'VEC4');
  const w0 = [0.1, 0.12, 0.08, 0.11], w1 = [0.3, 0.14, 0.05, 0.05];
  const W0 = b.accessor(new Float32Array([...w0, ...w0, ...w0]), 'VEC4');
  const W1 = b.accessor(new Float32Array([...w1, ...w1, ...w1]), 'VEC4');
  b.add('meshes', { primitives: [{ attributes: { POSITION: P, JOINTS_0: J0, WEIGHTS_0: W0, JOINTS_1: J1, WEIGHTS_1: W1 } }] });
  const nodes = [];
  for (let i = 0; i < 8; i++) nodes.push(b.node({ name: `j${i}` }, false));
  b.add('skins', { joints: nodes });
  b.node({ mesh: 0, skin: 0 });
  const g = await load(b);
  const m = g.skinnedMeshes[0];
  assert.deepEqual([...m.geometry.attributes.skinIndex.array.slice(0, 4)], [4, 5, 1, 3]);
  const w = m.geometry.attributes.skinWeight.array;
  near(w[0] + w[1] + w[2] + w[3], 1, 1e-6);
  assert.ok(w[0] > w[1] && w[1] >= w[2]);
  assert.ok(g.warnings.some((x) => /8 joint/.test(x)));
});

// -------------------------------------------------------------------------------------------------- materials & textures

test('PBR material factors, alpha modes, double sided, emissive strength, unlit', async () => {
  const b = triangle();
  b.json.extensionsUsed = ['KHR_materials_emissive_strength', 'KHR_materials_unlit'];
  b.json.materials = [
    { name: 'steel', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.25, 0.125, 0.5], metallicFactor: 0.9, roughnessFactor: 0.2 }, emissiveFactor: [1, 0.5, 0], extensions: { KHR_materials_emissive_strength: { emissiveStrength: 8 } }, doubleSided: true },
    { name: 'leaf', alphaMode: 'MASK', alphaCutoff: 0.3, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.7] } },
    { name: 'glass', alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.25] } },
    { name: 'sign', extensions: { KHR_materials_unlit: {} } },
  ];
  const g = await load(b);
  const [steel, leaf, glass, sign] = g.materials;
  near(steel.color.r, 0.5); near(steel.color.g, 0.25); near(steel.opacity, 1, 1e-9, 'OPAQUE ignores alpha');
  assert.equal(steel.metalness, 0.9); assert.equal(steel.roughness, 0.2);
  assert.equal(steel.emissiveIntensity, 8); near(steel.emissive.g, 0.5);
  assert.equal(steel.side, DoubleSide);
  assert.equal(leaf.alphaTest, 0.3); assert.equal(leaf.transparent, false); near(leaf.opacity, 0.7);
  assert.equal(glass.transparent, true); near(glass.opacity, 0.25);
  assert.equal(sign.unlit, true);
  assert.equal(g.warnings.length, 0, g.warnings.join('; '));
});

test('textures: images from data URIs and buffer views, samplers, colour-space slots, texture transform', async () => {
  const red = png(4, 4, () => [255, 0, 0, 255]), green = png(2, 2, () => [0, 255, 0, 255]);
  const b = triangle();
  const gv = b.view(green);
  b.json.images = [{ uri: dataURI(red) }, { bufferView: gv, mimeType: 'image/png' }];
  b.json.samplers = [{ magFilter: 9728, minFilter: 9987, wrapS: 33071, wrapT: 33648 }, { minFilter: 9729 }];
  b.json.textures = [{ source: 0, sampler: 0 }, { source: 1, sampler: 1 }, { source: 0 }];
  b.json.materials = [{
    pbrMetallicRoughness: { baseColorTexture: { index: 0, extensions: { KHR_texture_transform: { offset: [0.25, 0.5], scale: [2, 3], rotation: 0.5 } } }, metallicRoughnessTexture: { index: 1 } },
    normalTexture: { index: 2, scale: 0.5 },
  }];
  b.json.extensionsUsed = ['KHR_texture_transform'];
  const g = await load(b);
  const m = g.materials[0];
  assert.equal(m.map.image.width, 4);
  assert.equal(m.map.flipY, false, 'glTF images are not flipped');
  assert.equal(m.map.wrapS, 1001); assert.equal(m.map.wrapT, 1002);          // clamp, mirror
  assert.equal(m.map.magFilter, 1003);                                         // nearest
  near(m.map.offset.x, 0.25); near(m.map.repeat.y, 3); near(m.map.rotation, 0.5);
  assert.equal(m.roughnessMap.image.width, 2);
  assert.equal(m.metalnessMap, m.roughnessMap, 'metallic-roughness is one texture read for both');
  assert.equal(m.roughnessMap.generateMipmaps, false, 'minFilter LINEAR means no mip chain');
  near(m.normalScale.x, 0.5);
  assert.equal(m.normalMap.image.width, 4);
  assert.equal(g.textures[0].image.data[0], 255);
});

test('an undecodable texture warns and the material keeps its colour; strictTextures makes it an error', async () => {
  const b = triangle();
  b.json.images = [{ uri: dataURI(new Uint8Array([1, 2, 3, 4]), 'image/jpeg') }];
  b.json.textures = [{ source: 0 }];
  b.json.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], baseColorTexture: { index: 0 } } }];
  const g = await load(b);
  assert.equal(g.materials[0].map, null);
  assert.ok(g.warnings.some((w) => /texture 0 not loaded/.test(w)), g.warnings.join('|'));
  await assert.rejects(() => load(b, { strictTextures: true }), /texture 0/);
});

test('a separate occlusion texture is packed with metallic-roughness into the ORM layout', async () => {
  const ao = png(2, 2, (x, y) => [x * 255, 0, 0, 255]);             // occlusion in R: 0, 255 across
  const mr = png(4, 4, () => [10, 100, 200, 255]);                    // G = roughness 100, B = metalness 200
  const b = triangle();
  b.json.images = [{ uri: dataURI(ao) }, { uri: dataURI(mr) }];
  b.json.textures = [{ source: 0 }, { source: 1 }];
  b.json.materials = [{ pbrMetallicRoughness: { metallicRoughnessTexture: { index: 1 } }, occlusionTexture: { index: 0, strength: 0.6 } }];
  const g = await load(b);
  const m = g.materials[0];
  assert.ok(m.aoMap && m.aoMap === m.roughnessMap && m.roughnessMap === m.metalnessMap);
  near(m.aoMapIntensity, 0.6);
  const px = m.aoMap.image;
  assert.equal(px.width, 4);
  assert.deepEqual([...px.data.slice(0, 4)], [0, 100, 200, 255]);          // left half: no occlusion light
  assert.deepEqual([...px.data.slice(12, 16)], [255, 100, 200, 255]);      // right half

  // occlusion and metallic-roughness already in one texture: shared, not copied
  const c = triangle();
  c.json.images = [{ uri: dataURI(mr) }]; c.json.textures = [{ source: 0 }];
  c.json.materials = [{ pbrMetallicRoughness: { metallicRoughnessTexture: { index: 0 } }, occlusionTexture: { index: 0 } }];
  const m2 = (await load(c)).materials[0];
  assert.equal(m2.aoMap, m2.roughnessMap);
  assert.equal(m2.roughnessMap.image.data.length, 64);

  // occlusion alone: roughness and metalness factors pass through (G = B = 255)
  const d = triangle();
  d.json.images = [{ uri: dataURI(ao) }]; d.json.textures = [{ source: 0 }];
  d.json.materials = [{ occlusionTexture: { index: 0 } }];
  const m3 = (await load(d)).materials[0];
  assert.deepEqual([...m3.aoMap.image.data.slice(4, 8)], [255, 255, 255, 255]);
});

// -------------------------------------------------------------------------------------------------- skins & animation

test('skin: bones, inverse bind matrices, identity bind (the mesh node transform is ignored)', async () => {
  const g = await load(arm());
  const mesh = g.skinnedMeshes[0];
  assert.ok(mesh instanceof SkinnedMesh);
  assert.equal(mesh.skeleton.bones.length, 2);
  assert.ok(mesh.skeleton.bones.every((b) => b instanceof Bone));
  assert.deepEqual(mesh.skeleton.bones.map((b) => b.name), ['shoulder', 'elbow']);
  near(mesh.skeleton.boneInverses[1].elements[12], -0.5);
  assert.deepEqual([...mesh.bindMatrix.elements], [...new Matrix4().elements]);
  assert.equal(mesh.geometry.attributes.skinIndex.array.constructor, Uint8Array);
  // in the rest pose every skin matrix is the identity
  g.scene.updateMatrixWorld(true);
  mesh.skeleton.update();
  for (let i = 0; i < 32; i++) near(mesh.skeleton.boneMatrices[i], new Matrix4().elements[i % 16], 1e-6);
  assert.equal(g.skeletons.length, 1);
});

test('skin animation: bending the elbow moves the forearm exactly as the glTF spec says', async () => {
  const g = await load(arm());
  const mesh = g.skinnedMeshes[0];
  const clip = g.clip('bend');
  assert.equal(clip.duration, 1);
  assert.equal(clip.tracks[0].bone, 'elbow'); assert.equal(clip.tracks[0].kind, 'quaternion');
  const anim = new Animator(g.scene);
  anim.play(clip, { fade: 0, loop: false });
  anim.update(1);
  g.scene.updateMatrixWorld(true);
  mesh.skeleton.update();
  // vertex 16..19 is the tip ring (x = 1, joint 1 only): world = boneWorld * IBM * v
  const bm = new Matrix4().fromArray(mesh.skeleton.boneMatrices, 16);
  const tip = new Vector3(1, 0, 0).applyMatrix4(bm);
  near(tip.x, 0.5); near(tip.y, 0.5); near(tip.z, 0);
  // the shoulder end does not move
  const root = new Vector3(0, 0, 0).applyMatrix4(new Matrix4().fromArray(mesh.skeleton.boneMatrices, 0));
  near(root.length(), 0);
});

test('STEP holds a value until the next key; CUBICSPLINE is baked along the Hermite curve', async () => {
  const b = new GLTFBuilder();
  const n = b.node({ name: 'thing' });
  const t = b.accessor(new Float32Array([0, 1, 2]), 'SCALAR');
  const stepV = b.accessor(new Float32Array([0, 0, 0, 5, 0, 0, 9, 0, 0]), 'VEC3');
  // cubic: in-tangent, value, out-tangent per key, flat tangents -> smoothstep between values 0 and 10
  const cubic = b.accessor(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, /* key0 */ 0, 0, 0, 10, 0, 0, 0, 0, 0, /* key1 */ 0, 0, 0, 10, 0, 0, 0, 0, 0 /* key2 */]), 'VEC3');
  b.add('animations', { name: 'a', samplers: [{ input: t, output: stepV, interpolation: 'STEP' }, { input: t, output: cubic, interpolation: 'CUBICSPLINE' }], channels: [{ sampler: 0, target: { node: n, path: 'translation' } }] });
  b.add('animations', { name: 'b', samplers: [{ input: t, output: cubic, interpolation: 'CUBICSPLINE' }], channels: [{ sampler: 0, target: { node: n, path: 'translation' } }] });
  const g = await load(b, { animationFps: 30 });
  const step = g.clip('a').tracks[0], tmp = new Float32Array(3);
  step.sample(0.5, tmp); near(tmp[0], 0);
  step.sample(0.9999, tmp); near(tmp[0], 0, 1e-3);
  step.sample(1.0, tmp); near(tmp[0], 5);
  step.sample(1.5, tmp); near(tmp[0], 5);
  step.sample(2, tmp); near(tmp[0], 9);
  const cub = g.clip('b').tracks[0];
  cub.sample(0, tmp); near(tmp[0], 0);
  cub.sample(0.5, tmp); near(tmp[0], 5, 0.2);                       // smoothstep midpoint (the baked keys are linear in between)
  cub.sample(1, tmp); near(tmp[0], 10);
  cub.sample(2, tmp); near(tmp[0], 10);
  assert.ok(cub.count > 30, 'baked to many keys');
});

test('scale tracks and morph weights animate through the Animator', async () => {
  const b = new GLTFBuilder();
  const P = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3');
  const T0 = b.accessor(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 1]), 'VEC3');
  const T1 = b.accessor(new Float32Array([0, 0, 0, 0, 0, 0, 0, 1, 0]), 'VEC3');
  // two primitives share one weights array
  b.add('meshes', { name: 'face', extras: { targetNames: ['smile', 'blink'] }, weights: [0, 0.25], primitives: [{ attributes: { POSITION: P }, targets: [{ POSITION: T0 }, { POSITION: T1 }] }, { attributes: { POSITION: P }, targets: [{ POSITION: T0 }, { POSITION: T1 }] }] });
  const face = b.node({ name: 'Face', mesh: 0 });
  const box = b.node({ name: 'Box' });
  const t = b.accessor(new Float32Array([0, 1]), 'SCALAR');
  const w = b.accessor(new Float32Array([0, 0, 1, 1]), 'SCALAR');       // 2 keys x 2 targets
  const s = b.accessor(new Float32Array([1, 1, 1, 2, 3, 4]), 'VEC3');
  b.add('animations', { name: 'act', samplers: [{ input: t, output: w }, { input: t, output: s }], channels: [{ sampler: 0, target: { node: face, path: 'weights' } }, { sampler: 1, target: { node: box, path: 'scale' } }] });
  const g = await load(b);
  const group = g.scene.children[0];
  assert.equal(group.type, 'Group');
  const [m0, m1] = group.children;
  assert.equal(m0.morphTargetInfluences, m1.morphTargetInfluences, 'primitives of one mesh share their weights');
  assert.deepEqual(m0.morphTargetInfluences, [0, 0.25], 'default weights from the mesh');
  assert.deepEqual(m0.geometry.userData.morphNames, ['smile', 'blink']);
  const clip = g.clip('act');
  assert.deepEqual(clip.tracks.map((x) => [x.kind, x.size]).sort(), [['scale', 3], ['weights', 2]]);
  const anim = new Animator(g.scene);
  anim.play(clip, { fade: 0 });
  anim.update(0.5);
  near(m0.morphTargetInfluences[0], 0.5); near(m0.morphTargetInfluences[1], 0.5);
  near(g.find('Box').scale.x, 1.5); near(g.find('Box').scale.z, 2.5);
  anim.update(0.5);
  near(m1.morphTargetInfluences[0], 1); near(m1.morphTargetInfluences[1], 1);
  near(g.find('Box').scale.y, 3);
});

test('weights and scale tracks survive clone, crop, reverse and the binary form', () => {
  const clip = new AnimationClip('c', [new Track('Face', 'weights', [0, 0, 1, 1, 0, 0.5], [0, 1, 2], 0, 2), new Track('Box', 'scale', [1, 1, 1, 2, 2, 2], [0, 1])]);
  for (const c of [clip.clone(), clip.crop(0.5, 1.5, 10), clip.reverse(), AnimationClip.fromBinary(clip.toBinary()), clip.mirror(), clip.makeAdditive(0)]) {
    assert.equal(c.tracks.length, 2);
    assert.equal(c.byBone.get('Face').w.size, 2);
    assert.ok(c.byBone.get('Box').s);
  }
  const v = new Float32Array(2);
  AnimationClip.fromBinary(clip.toBinary()).tracks[0].sample(1.5, v);
  near(v[0], 0.5); near(v[1], 0.75);
  assert.throws(() => new Track('x', 'weights', [1, 2], [0]), /size/);
  assert.throws(() => new Track('x', 'spin', [1, 2, 3], [0]), /unknown kind/);
});

// -------------------------------------------------------------------------------------------------- cameras, lights, hierarchy

test('cameras, punctual lights, node hierarchy, matrices, unique names and extras', async () => {
  const b = new GLTFBuilder();
  b.json.extensionsUsed = ['KHR_lights_punctual'];
  b.json.extensions = { KHR_lights_punctual: { lights: [
    { type: 'directional', color: [1, 0.9, 0.8], intensity: 3 },
    { type: 'spot', intensity: 20, range: 12, spot: { innerConeAngle: 0.2, outerConeAngle: 0.4 } },
    { type: 'point', intensity: 5 },
  ] } };
  b.json.cameras = [{ type: 'perspective', perspective: { yfov: Math.PI / 3, znear: 0.1, aspectRatio: 2 } }, { type: 'orthographic', orthographic: { xmag: 4, ymag: 2, znear: 0, zfar: 50 } }];
  const kid = b.node({ name: 'same', translation: [1, 2, 3] }, false);
  const kid2 = b.node({ name: 'same', rotation: [0, Math.sin(0.25), 0, Math.cos(0.25)], extras: { hp: 7 } }, false);
  b.node({ name: 'parent', matrix: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5, 0, 0, 1], children: [kid, kid2] });
  b.node({ name: 'sun', extensions: { KHR_lights_punctual: { light: 0 } }, rotation: [-Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)] });
  b.node({ name: 'lamp', extensions: { KHR_lights_punctual: { light: 1 } } });
  b.node({ name: 'bulb', extensions: { KHR_lights_punctual: { light: 2 } } });
  b.node({ name: 'cam', camera: 0, translation: [0, 1, 5] });
  b.node({ name: 'ortho', camera: 1 });
  const g = await load(b, { lightScale: 0.5 });
  g.scene.updateMatrixWorld(true);
  const parent = g.find('parent');
  near(parent.scale.x, 2); near(parent.position.x, 5);
  const [a, c] = parent.children;
  assert.equal(a.name, 'same'); assert.equal(c.name, 'same_1', 'duplicate names are made unique');
  assert.equal(c.userData.hp, 7);
  const wp = a.getWorldPosition(new Vector3());
  near(wp.x, 7); near(wp.y, 4); near(wp.z, 6);
  // lights
  const sun = g.find('sun');
  assert.ok(sun.isDirectionalLight); near(sun.intensity, 1.5); near(sun.color.g, 0.9);
  // the node was turned to point down: its -Z is the light direction; the engine wants "towards the light" = position - target
  const toLight = sun.getWorldPosition(new Vector3()).sub(sun.target.getWorldPosition(new Vector3()));
  near(toLight.y, 1, 1e-6); near(toLight.x, 0, 1e-6);
  const spot = g.find('lamp');
  assert.ok(spot.isSpotLight); near(spot.angle, 0.4); near(spot.penumbra, 0.5); assert.equal(spot.distance, 12);
  assert.ok(g.find('bulb').isPointLight);
  // cameras
  const cam = g.find('cam');
  assert.ok(cam.isPerspectiveCamera); near(cam.fov, 60, 1e-6); near(cam.aspect, 2); assert.equal(cam.far, Infinity);
  assert.ok(g.find('ortho').isOrthographicCamera);
  assert.equal(g.cameras.length, 2); assert.equal(g.lights.length, 3);
});

test('cloneModel gives each copy its own bones, weights and light targets', async () => {
  const g = await load(arm());
  const copy = cloneModel(g.scene);
  const a = g.skinnedMeshes[0];
  let b;
  copy.traverse((o) => { if (o.isSkinnedMesh) b = o; });
  assert.ok(b && b !== a);
  assert.notEqual(b.skeleton, a.skeleton);
  assert.equal(b.skeleton.bones[1], copy.getObjectByName('elbow'));
  assert.notEqual(b.skeleton.bones[1], a.skeleton.bones[1]);
  assert.equal(b.geometry, a.geometry, 'geometry is shared');
  // animating the copy leaves the original alone
  const anim = new Animator(copy);
  anim.play(g.clip('bend'), { fade: 0, loop: false });
  anim.update(1);
  near(copy.getObjectByName('elbow').quaternion.z, Math.sin(Math.PI / 4), 1e-5);
  near(g.scene.getObjectByName('elbow').quaternion.z, 0);
  copy.position.set(100, 0, 0);
  near(g.scene.position.x, 0);

  const L = await load((() => { const q = new GLTFBuilder(); q.json.extensionsUsed = ['KHR_lights_punctual']; q.json.extensions = { KHR_lights_punctual: { lights: [{ type: 'spot', intensity: 9, spot: { outerConeAngle: 0.5 } }] } }; q.node({ name: 'l', extensions: { KHR_lights_punctual: { light: 0 } } }); return q; })());
  const lc = cloneModel(L.scene).children[0];
  near(lc.intensity, 9); near(lc.angle, 0.5);
  assert.ok(lc.children.includes(lc.target) && lc.target !== L.find('l').target);
});

// -------------------------------------------------------------------------------------------------- OBJ / MTL

test('OBJ: polygons are triangulated, indices may be negative, objects and materials split meshes', () => {
  const { group, materialLibraries } = parseOBJ(`
# a quad and a triangle
mtllib scene.mtl
o Quad
usemtl red
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 1
f 1/1/1 2/2/1 3/3/1 4/4/1
o Tri
usemtl blue
v 5 0 0
v 6 0 0
v 5 1 0
f -3 -2 -1
`);
  assert.deepEqual(materialLibraries, ['scene.mtl']);
  assert.equal(group.children.length, 2);
  const [quad, tri] = group.children;
  assert.equal(quad.name, 'Quad:red');
  assert.equal(quad.geometry.index.count, 6);
  assert.deepEqual([...quad.geometry.attributes.normal.array.slice(0, 3)], [0, 0, 1]);
  assert.equal(quad.geometry.attributes.uv.count, 4);
  assert.equal(tri.geometry.index.count, 3);
  assert.deepEqual([...tri.geometry.attributes.position.array.slice(0, 3)], [5, 0, 0]);
  near(tri.geometry.attributes.normal.array[2], 1, 1e-6, 'missing normals are computed');
  assert.throws(() => parseOBJ('v 0 0 0\nf 1 2 9'), /out of range/);
  assert.equal(parseOBJ('v 0 0 0\nv 2 0 0\nv 0 2 0\nf 1 2 3', { scale: 0.5 }).group.children[0].geometry.attributes.position.array[3], 1);
});

test('MTL: colours, shininess to roughness, opacity and texture names', () => {
  const { materials, textures } = parseMTL('newmtl wood\nKd 0.5 0.25 0.1\nNs 100\nd 0.5\nmap_Kd wood.png\nmap_bump wood_n.png\nnewmtl glow\nKe 1 1 0\n');
  const w = materials.get('wood');
  near(w.color.g, 0.25); assert.ok(w.roughness > 0.5 && w.roughness < 0.8); assert.ok(w.transparent); near(w.opacity, 0.5);
  assert.deepEqual(textures.get('wood'), { map: 'wood.png', normalMap: 'wood_n.png' });
  near(materials.get('glow').emissive.r, 1);
});

// -------------------------------------------------------------------------------------------------- AssetManager

/** A platform whose files live in a Map, counting reads. */
function memoryPlatform(files) {
  const p = new NodePlatform();
  p.reads = [];
  p.readFile = async (path) => {
    p.reads.push(path);
    const f = files[path];
    if (f === undefined) throw new Error(`ENOENT ${path}`);
    return typeof f === 'string' ? new TextEncoder().encode(f) : f;
  };
  return p;
}

test('AssetManager loads by type, caches, shares in-flight loads, reports progress and instantiates', async () => {
  const b = arm();
  const files = {
    'game/models/arm.glb': b.glb(),
    'game/tex/red.png': png(8, 4, () => [255, 0, 0, 255]),
    'game/data/items.json': '{"sword": 3}',
    'game/notes.txt': 'hello',
    'game/clips/bend.medclip': new Uint8Array(new AnimationClip('bend', [new Track('elbow', 'quaternion', [0, 0, 0, 1, 0, 0, 1, 0], [0, 1])]).toBinary()),
    'game/mocap/x.bvh': 'HIERARCHY\nROOT Hips\n{\nOFFSET 0 0 0\nCHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation\nEnd Site\n{\nOFFSET 0 10 0\n}\n}\nMOTION\nFrames: 2\nFrame Time: 0.0333333\n0 0 0 0 0 0\n0 1 0 0 0 0\n',
  };
  const p = memoryPlatform(files);
  const assets = new AssetManager({ platform: p, baseUrl: 'game' });
  const seen = [];
  const out = await assets.loadAll({ arm: 'models/arm.glb', red: { url: 'tex/red.png', flipY: false, wrap: 'clamp' }, items: 'data/items.json', notes: 'notes.txt', bend: 'clips/bend.medclip', mocap: 'mocap/x.bvh' }, { onProgress: (x) => seen.push(x.done) });
  assert.ok(out.arm instanceof GLTFAsset);
  assert.equal(out.red.image.width, 8); assert.equal(out.red.flipY, false); assert.equal(out.red.wrapS, 1001);
  assert.deepEqual(out.items, { sword: 3 }); assert.equal(out.notes, 'hello');
  assert.equal(out.bend.duration, 1); assert.equal(out.mocap.frames, 2);
  assert.equal(assets.progress.total, 6); assert.equal(assets.progress.done, 6); assert.ok(assets.progress.bytes > 100);
  assert.equal(seen.length, 6); assert.equal(seen.at(-1), 6);
  assert.equal(assets.get('arm'), out.arm);
  assert.throws(() => assets.get('nope'), /nothing loaded as 'nope'/);

  // cached: the same object, no new reads
  const reads = p.reads.length;
  assert.equal(await assets.model('models/arm.glb'), out.arm);
  // ... but other options are another entry; the default flipY for plain textures is true
  const t2 = await assets.texture('tex/red.png');
  assert.notEqual(t2, out.red); assert.equal(t2.flipY, true);
  // two requests at once share one read
  const [x, y] = await Promise.all([assets.text('extra.txt').catch(() => 'missing'), assets.text('extra.txt').catch(() => 'missing')]);
  assert.equal(x, 'missing'); assert.equal(y, 'missing');
  assert.equal(p.reads.filter((r) => r === 'game/extra.txt').length, 1, 'two requests at once share one read');
  await assets.text('extra.txt').catch(() => 'missing');
  assert.equal(p.reads.filter((r) => r === 'game/extra.txt').length, 2, 'a failed load is not cached: the next request tries again');
  assert.ok(p.reads.length > reads);

  // failures say what and why
  await assert.rejects(() => assets.load('models/missing.glb'), /could not load 'models\/missing\.glb' as gltf: ENOENT/);
  assert.equal(assets.progress.failed >= 1, true);

  // instances are independent
  const a = assets.instantiate('arm'), c = assets.instantiate(out.arm);
  assert.notEqual(a, c);
  assert.notEqual(a.getObjectByName('elbow'), c.getObjectByName('elbow'));
  a.getObjectByName('elbow').rotation.z = 1;
  near(c.getObjectByName('elbow').rotation.z, 0);
  await assets.dispose();
  assert.deepEqual(assets.named, {});
});

test('AssetManager: OBJ with its MTL and textures; custom types; absolute and data URLs', async () => {
  const files = {
    'm/crate.obj': 'mtllib crate.mtl\nusemtl wood\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\n',
    'm/crate.mtl': 'newmtl wood\nKd 1 1 1\nmap_Kd wood.png\n',
    'm/wood.png': png(2, 2, () => [120, 80, 40, 255]),
    'sfx/hit.wav': new Uint8Array([1, 2, 3]),
  };
  const p = memoryPlatform(files);
  const assets = new AssetManager({ platform: p });
  const crate = await assets.load('m/crate.obj');
  assert.equal(crate.children[0].material.map.image.width, 2);
  assert.equal(crate.children[0].material.map.flipY, true, 'OBJ textures use the bottom-left UV origin');
  assets.register('wav', 'audio', async (bytes, url) => ({ url, size: bytes.length }));
  assert.deepEqual(await assets.load('sfx/hit.wav'), { url: 'sfx/hit.wav', size: 3 });
  assert.equal(new AssetManager({ platform: p, baseUrl: 'a/b' }).url('x.png'), 'a/b/x.png');
  assert.equal(new AssetManager({ platform: p, baseUrl: 'a/b' }).url('https://x.org/y.png'), 'https://x.org/y.png');
  assert.equal(new AssetManager({ platform: p, baseUrl: 'a/b' }).url('/abs/y.png'), '/abs/y.png');
  assert.throws(() => new AssetManager({}), /platform is required/);
});

test('Engine owns an AssetManager that resolves paths against baseUrl', async () => {
  const p = memoryPlatform({ 'root/cfg.json': '{"ok":true}' });
  const e = await Engine.create({ platform: p, render: false, baseUrl: 'root' });
  assert.deepEqual(await e.assets.json('cfg.json'), { ok: true });
  e.dispose();
  void Scene; void Group; void Quaternion; void Mesh;
});
