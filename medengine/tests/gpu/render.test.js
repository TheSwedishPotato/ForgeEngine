// End-to-end renderer tests: real frames through the WebGPU pipeline (Dawn; software Vulkan on CI
// machines without a GPU), read back and checked pixel by pixel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gpuContext } from './helpers.js';
import { Renderer } from '../../src/render/Renderer.js';
import {
  Scene, Mesh, PlaneGeometry, SphereGeometry, BoxGeometry, CylinderGeometry, StandardMaterial, DirectionalLight, PointLight, SpotLight, TubeLight,
  PerspectiveCamera, InstancedMesh, Group, Matrix4, Color, Vector3, SkinnedMesh, Skeleton, Bone, Float32BufferAttribute, Uint16BufferAttribute,
} from '../../src/index.js';

const ctx = await gpuContext();
const skip = ctx ? false : 'WebGPU not available';

function setup({ width = 320, height = 180, quality = 'medium' } = {}) {
  const { platform, gpu } = ctx;
  const surface = platform.createSurface({ width, height });
  surface.configure(gpu);
  gpu.errors.length = 0;
  const renderer = new Renderer({ gpu, platform, surface, quality });
  return { renderer, gpu, surface, platform, width, height };
}

/** Scene used by several tests: ground, three objects, a sun from the upper left in front. */
function demoScene() {
  const scene = new Scene();
  const ground = new Mesh(new PlaneGeometry(60, 60), new StandardMaterial({ color: 0x808080, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const ball = new Mesh(new SphereGeometry(1, 48, 24), new StandardMaterial({ color: 0xcc3322, roughness: 0.4 }));
  ball.position.set(0, 1, 0); ball.castShadow = true; scene.add(ball);
  const mirror = new Mesh(new SphereGeometry(0.8, 48, 24), new StandardMaterial({ color: 0xdddddd, roughness: 0.05, metalness: 1 }));
  mirror.position.set(2.5, 0.8, -1); mirror.castShadow = true; scene.add(mirror);
  const box = new Mesh(new BoxGeometry(1.4, 1.5, 1.4), new StandardMaterial({ color: 0x3366aa, roughness: 0.7 }));
  box.position.set(-2.5, 0.75, -0.5); box.castShadow = true; scene.add(box);
  const sun = new DirectionalLight(0xfff0dd, 7); sun.position.set(-5, 8, 6); sun.castShadow = true; scene.add(sun);
  const cam = new PerspectiveCamera(45, 16 / 9, 0.1, 500); cam.position.set(0, 2.2, 7.5); cam.lookAt(0, 1, 0);
  return { scene, cam, ball, mirror, box, ground, sun };
}

const settle = async (r, scene, cam, n = 14) => { for (let i = 0; i < n; i++) r.render(scene, cam, 1 / 60); return r.capture(); };
const pixel = (img, x, y) => { const o = (Math.round(y) * img.width + Math.round(x)) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
const luma = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
/** World point -> pixel in the captured image. */
function toPixel(cam, img, v) { const p = new Vector3(v[0], v[1], v[2]).project(cam); return [(p.x * 0.5 + 0.5) * img.width, (0.5 - p.y * 0.5) * img.height]; }

test('a lit scene: sky, sun shading, cast shadows, mirror reflection', { skip }, async () => {
  const { renderer: r, gpu, width, height } = setup({ width: 480, height: 270 });
  const { scene, cam } = demoScene();
  cam.aspect = width / height; cam.updateProjectionMatrix();
  const img = await settle(r, scene, cam);
  assert.deepEqual(gpu.errors, [], 'no GPU validation errors');
  assert.equal(img.width, width);
  // sky: the upper part of the frame is sky, brighter in blue than in red (Rayleigh), never black
  const sky = pixel(img, width / 2, 6);
  assert.ok(sky[2] > sky[0] && luma(sky) > 60, `sky colour ${sky}`);
  // the sun is at the upper left in front: its shadow of the ball falls to the right and behind
  const [sx, sy] = toPixel(cam, img, [0.65, 0, -0.75]);        // centre of the ball's shadow on the ground
  const [lx, ly] = toPixel(cam, img, [-1.5, 0, 3]);             // sunlit ground in front
  const shadow = luma(pixel(img, sx, sy)), lit = luma(pixel(img, lx, ly));
  assert.ok(lit > shadow * 1.8, `shadow ${shadow.toFixed(0)} should be much darker than lit ground ${lit.toFixed(0)}`);
  // the red ball: red dominates, and the lit side (upper left) is brighter than the shaded side (lower right)
  const [bx, by] = toPixel(cam, img, [0, 1, 0]);
  const c = pixel(img, bx, by);
  assert.ok(c[0] > c[1] * 2 && c[0] > c[2] * 2, `ball colour ${c}`);
  const litSide = luma(pixel(img, bx - 22, by - 14)), darkSide = luma(pixel(img, bx + 24, by + 22));
  assert.ok(litSide > darkSide * 1.25, `ball lit side ${litSide.toFixed(0)} vs dark side ${darkSide.toFixed(0)}`);
  // the chrome ball reflects sky above and ground below
  const [mx, my] = toPixel(cam, img, [2.5, 0.8, -1]);
  const top = luma(pixel(img, mx, my - 14)), bottom = luma(pixel(img, mx, my + 14));
  assert.ok(top > bottom * 1.3, `mirror: top ${top.toFixed(0)} should reflect brighter sky than its bottom ${bottom.toFixed(0)}`);
});

test('the image converges: a static scene does not shimmer once temporal accumulation settles', { skip }, async () => {
  const { renderer: r, width, height } = setup();
  r.composite.grain = 0;                      // film grain is meant to move
  const { scene, cam } = demoScene();
  cam.aspect = width / height; cam.updateProjectionMatrix();
  const a = await settle(r, scene, cam, 24);
  const b = await settle(r, scene, cam, 1);
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4) sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
  const mean = sum / (a.data.length / 4 * 3);
  assert.ok(mean < 0.5, `mean frame-to-frame difference ${mean.toFixed(3)} / 255`);
});

test('every quality preset builds valid pipelines', { skip }, async () => {
  for (const q of ['low', 'medium', 'high']) {
    const { renderer: r, gpu, width, height } = setup({ width: 192, height: 108, quality: q });
    const { scene, cam } = demoScene();
    cam.aspect = width / height; cam.updateProjectionMatrix();
    const img = await settle(r, scene, cam, 3);
    assert.deepEqual(gpu.errors, [], `quality ${q}`);
    assert.ok(luma(pixel(img, width / 2, 4)) > 20, `quality ${q} drew the sky`);
    r.dispose();
  }
});

test('frustum culling: objects behind the camera cost nothing', { skip }, async () => {
  const { renderer: r, width, height } = setup({ width: 128, height: 72 });
  const { scene, cam } = demoScene();
  cam.aspect = width / height; cam.updateProjectionMatrix();
  r.render(scene, cam, 1 / 60);
  const before = r.stats.drawCalls;
  for (let i = 0; i < 20; i++) { const m = new Mesh(new SphereGeometry(0.5, 8, 6), new StandardMaterial()); m.position.set(i - 10, 1, 40); scene.add(m); }
  r.render(scene, cam, 1 / 60);
  assert.ok(r.stats.drawCalls <= before + 1, `drew ${r.stats.drawCalls} (was ${before})`);
  assert.ok(r.stats.culled >= 20, `culled ${r.stats.culled}`);
});

/** A dark night scene (no sun, no sky light, frozen exposure): only the lights placed by the test matter. */
function nightScene(width, height) {
  const t = setup({ width, height });
  t.renderer.envIntensity = 0.02;
  t.renderer.exposure.minEV = 0; t.renderer.exposure.maxEV = 0;     // no eye adaptation: the numbers are absolute
  const scene = new Scene();
  const ground = new Mesh(new PlaneGeometry(40, 40), new StandardMaterial({ color: 0xaaaaaa, roughness: 0.8 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const sun = new DirectionalLight(0x8899ff, 0.05); sun.position.set(0, 10, 0); scene.add(sun);
  const cam = new PerspectiveCamera(50, width / height, 0.1, 100); cam.position.set(0, 3.2, 7); cam.lookAt(0, 0.3, 0);
  return { ...t, scene, cam };
}

test('point and tube lights light the ground in their own colour', { skip }, async () => {
  const { renderer: r, gpu, scene, cam, width, height } = nightScene(320, 180);
  const red = new PointLight(0xff2200, 5, 8); red.position.set(-4.5, 1.2, 0.5); scene.add(red);
  const tube = new TubeLight(0x22ff44, 4, 8, 2); tube.position.set(4.5, 1.2, 0.5); scene.add(tube);
  const img = await settle(r, scene, cam, 14);
  assert.deepEqual(gpu.errors, []);
  assert.equal(r.stats.lights, 2);
  const rgb = (v) => pixel(img, ...toPixel(cam, img, v));
  const nearRed = rgb([-4.5, 0, 0.9]), nearTube = rgb([4.5, 0, 0.9]), dark = rgb([-9, 0, -6]);
  assert.ok(nearRed[0] > dark[0] * 2.5, `red point light brightens its surroundings (${nearRed} vs ${dark})`);
  assert.ok(nearTube[1] > dark[1] * 2.5, `tube light brightens its surroundings (${nearTube} vs ${dark})`);
  assert.ok(nearRed[0] > nearRed[2] * 2.5, `red light is red: ${nearRed}`);
  assert.ok(nearTube[1] > nearTube[0] * 1.8, `tube light is green: ${nearTube}`);
  // the light dies out with distance
  const far = rgb([-4.5, 0, -7]);
  assert.ok(far[0] < nearRed[0] * 0.6, `falloff: near ${nearRed[0]}, far ${far[0]}`);
});

test('a shadow-casting spot light: cone, penumbra and the shadow of a post', { skip }, async () => {
  const { renderer: r, gpu, scene, cam, width, height } = nightScene(320, 180);
  const post = new Mesh(new BoxGeometry(0.4, 2, 0.4), new StandardMaterial({ color: 0x777777 }));
  post.position.set(0, 1, -1); post.castShadow = true; scene.add(post);
  const spot = new SpotLight(0xffffff, 300, 14, 0.6, 0.3); spot.position.set(3.5, 5, 2.5); spot.target.position.set(0, 0, -1); spot.castShadow = true; scene.add(spot); scene.add(spot.target);
  const img = await settle(r, scene, cam, 14);
  assert.deepEqual(gpu.errors, []);
  assert.equal(r.stats.shadowedLights, 1);
  const px = (v) => luma(pixel(img, ...toPixel(cam, img, v)));
  // the spot sits to the right, in front and above: the post's shadow falls to the left and behind it
  const inShadow = px([-1.2, 0, -2.2]), lit = px([0.9, 0, -0.9]);
  assert.ok(lit > inShadow * 1.8, `shadow ${inShadow.toFixed(1)} vs lit ${lit.toFixed(1)}`);
  // outside the cone it is dark
  const outside = px([-8, 0, 3]);
  assert.ok(lit > outside * 2.5, `cone: inside ${lit.toFixed(1)} vs outside ${outside.toFixed(1)}`);
});

test('instancing, scene graph transforms and per-instance colour', { skip }, async () => {
  const { renderer: r, gpu, width, height } = setup({ width: 256, height: 144 });
  const scene = new Scene();
  const sun = new DirectionalLight(0xffffff, 5); sun.position.set(2, 6, 4); scene.add(sun);
  const inst = new InstancedMesh(new BoxGeometry(0.8, 0.8, 0.8), new StandardMaterial({ roughness: 0.6 }), 3);
  const m = new Matrix4();
  for (let i = 0; i < 3; i++) { m.makeTranslation((i - 1) * 2, 0.4, 0); inst.setMatrixAt(i, m); }
  inst.setColorAt(0, new Color(1, 0, 0)); inst.setColorAt(1, new Color(0, 1, 0)); inst.setColorAt(2, new Color(0, 0, 1));
  inst.instanceMatrix.needsUpdate = true; inst.instanceColor.needsUpdate = true;
  inst.userData.cullMargin = 0;
  scene.add(inst);
  const ground = new Mesh(new PlaneGeometry(30, 30), new StandardMaterial({ color: 0x999999 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const cam = new PerspectiveCamera(45, width / height, 0.1, 100); cam.position.set(0, 2.5, 6); cam.lookAt(0, 0.4, 0);
  const img = await settle(r, scene, cam, 14);
  assert.deepEqual(gpu.errors, []);
  const col = (x) => pixel(img, ...toPixel(cam, img, [x, 0.4, 0.4]));
  const [a, b, c] = [col(-2), col(0), col(2)];
  assert.ok(a[0] > a[1] * 2 && a[0] > a[2] * 2, `left box red ${a}`);
  assert.ok(b[1] > b[0] * 2 && b[1] > b[2] * 2, `middle box green ${b}`);
  assert.ok(c[2] > c[0] * 2 && c[2] > c[1] * 1.5, `right box blue ${c}`);
  // a parent group moves its children
  const g = new Group(); scene.add(g); g.position.set(0, 0, 0);
  const marker = new Mesh(new SphereGeometry(0.3, 16, 8), new StandardMaterial({ color: 0xffff00, unlit: true })); marker.position.set(0, 1.6, 0); g.add(marker);
  g.position.x = 1; r.render(scene, cam, 1 / 60);
  const img2 = await settle(r, scene, cam, 10);
  const yellow = pixel(img2, ...toPixel(cam, img2, [1, 1.6, 0]));
  assert.ok(yellow[0] > 80 && yellow[1] > 80 && yellow[2] < yellow[0] * 0.5, `parent transform moves child, got ${yellow}`);
});

test('resizing the surface keeps rendering', { skip }, async () => {
  const { renderer: r, gpu, surface } = setup({ width: 200, height: 120 });
  const { scene, cam } = demoScene();
  await settle(r, scene, cam, 3);
  surface.resize(256, 144);
  const img = await settle(r, scene, cam, 6);
  assert.equal(img.width, 256);
  assert.deepEqual(gpu.errors, []);
  assert.ok(luma(pixel(img, 128, 5)) > 20);
});

test('skinning: bending a bone bends the mesh (and the previous-frame palette feeds motion vectors)', { skip }, async () => {
  const { renderer: r, gpu, width, height } = setup({ width: 256, height: 144 });
  const scene = new Scene();
  const sun = new DirectionalLight(0xffffff, 3); sun.position.set(0, 5, 5); scene.add(sun);
  // a 2 m column, bone 0 at the foot, bone 1 at 1 m; weights blend over the middle
  const geo = new CylinderGeometry(0.25, 0.25, 2, 16, 16);
  geo.translate(0, 1, 0);
  const pos = geo.attributes.position, n = pos.count;
  const idx = new Uint16Array(n * 4), wts = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i), t = Math.min(1, Math.max(0, (y - 0.6) / 0.8));
    idx[i * 4] = 0; idx[i * 4 + 1] = 1; wts[i * 4] = 1 - t; wts[i * 4 + 1] = t;
  }
  geo.setAttribute('skinIndex', new Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new Float32BufferAttribute(wts, 4));
  const root = new Bone(), mid = new Bone(); mid.position.set(0, 1, 0); root.add(mid);
  const mesh = new SkinnedMesh(geo, new StandardMaterial({ color: 0xff00ff, unlit: true }));
  mesh.add(root); scene.add(mesh); mesh.updateMatrixWorld(true);
  mesh.bind(new Skeleton([root, mid]));
  const cam = new PerspectiveCamera(40, width / height, 0.1, 50); cam.position.set(0, 1.2, 5); cam.lookAt(0, 1, 0);
  const at = (img, x, y) => pixel(img, ...toPixel(cam, img, [x, y, 0]));
  const isMagenta = (c) => c[0] > 100 && c[2] > 100 && c[1] < c[0] * 0.5;
  const straight = await settle(r, scene, cam, 8);
  assert.deepEqual(gpu.errors, []);
  assert.ok(isMagenta(at(straight, 0, 1.8)), `straight column reaches y=1.8: ${at(straight, 0, 1.8)}`);
  assert.ok(!isMagenta(at(straight, 0.7, 1.7)), `nothing at (0.7, 1.7) yet: ${at(straight, 0.7, 1.7)}`);
  mid.rotation.z = -Math.PI / 2;                 // fold the upper half to the right
  const bent = await settle(r, scene, cam, 8);
  assert.ok(isMagenta(at(bent, 0.7, 1.0)), `the upper half now lies along +x at y~1: ${at(bent, 0.7, 1.0)}`);
  assert.ok(!isMagenta(at(bent, 0, 1.8)), `and has left (0, 1.8): ${at(bent, 0, 1.8)}`);
  assert.ok(isMagenta(at(bent, 0, 0.5)), 'the lower half stays put');
  // moving the whole character moves it through the root, bind-pose preserved
  mesh.position.x = -1;
  const moved = await settle(r, scene, cam, 8);
  assert.ok(isMagenta(at(moved, -1, 0.5)), `moved with the mesh: ${at(moved, -1, 0.5)}`);
});

test('morph targets: the influence weight blends vertex deltas', { skip }, async () => {
  const { renderer: r, gpu, width, height } = setup({ width: 256, height: 144 });
  const scene = new Scene();
  const sun = new DirectionalLight(0xffffff, 3); sun.position.set(0, 5, 5); scene.add(sun);
  const geo = new SphereGeometry(0.5, 32, 16);
  const pos = geo.attributes.position, d = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { d[i * 3] = pos.getX(i); d[i * 3 + 1] = pos.getY(i); d[i * 3 + 2] = pos.getZ(i); }   // + position = double the radius
  geo.morphAttributes.position = [new Float32BufferAttribute(d, 3)];
  const mesh = new Mesh(geo, new StandardMaterial({ color: 0x00ffff, unlit: true }));
  mesh.morphTargetInfluences = [0];
  mesh.position.y = 1; scene.add(mesh);
  const cam = new PerspectiveCamera(40, width / height, 0.1, 50); cam.position.set(0, 1, 5); cam.lookAt(0, 1, 0);
  const at = (img, x) => pixel(img, ...toPixel(cam, img, [x, 1, 0]));
  const isCyan = (c) => c[1] > 100 && c[2] > 100 && c[0] < c[1] * 0.5;
  const base = await settle(r, scene, cam, 8);
  assert.deepEqual(gpu.errors, []);
  assert.ok(isCyan(at(base, 0.3)) && !isCyan(at(base, 0.8)), `weight 0: radius 0.5 (${at(base, 0.3)} / ${at(base, 0.8)})`);
  mesh.morphTargetInfluences[0] = 1;
  const full = await settle(r, scene, cam, 8);
  assert.ok(isCyan(at(full, 0.8)), `weight 1: radius 1.0 covers x=0.8 (${at(full, 0.8)})`);
  mesh.morphTargetInfluences[0] = 0.5;
  const half = await settle(r, scene, cam, 8);
  assert.ok(isCyan(at(half, 0.6)) && !isCyan(at(half, 0.9)), `weight 0.5: radius 0.75 (${at(half, 0.6)} / ${at(half, 0.9)})`);
});
