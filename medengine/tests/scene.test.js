import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion, Matrix4, Box3, Euler } from '../src/math/index.js';
import {
  Object3D, Group, Scene, Mesh, SkinnedMesh, Bone, Skeleton, InstancedMesh, BufferGeometry, BufferAttribute,
  BoxGeometry, SphereGeometry, PlaneGeometry, CylinderGeometry, CapsuleGeometry, ExtrudeGeometry, Shape, mergeGeometries,
  PerspectiveCamera, OrthographicCamera, StandardMaterial, Texture, DataTexture, DirectionalLight, SpotLight,
} from '../src/scene/index.js';

const close = (a, b, e = 1e-5, m = '') => assert.ok(Math.abs(a - b) <= e, `${m} ${a} vs ${b}`);
const v3 = (v) => [v.x, v.y, v.z];

/** Signed volume of an indexed triangle mesh: positive when the triangles wind counter-clockwise seen from outside. */
function volume(g) {
  const p = g.attributes.position, idx = g.index.array;
  let v = 0;
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(p, idx[i]); b.fromBufferAttribute(p, idx[i + 1]); c.fromBufferAttribute(p, idx[i + 2]);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
}
/** How many triangle faces have a geometric normal that disagrees with their vertex normals. */
function badNormals(g) {
  const p = g.attributes.position, n = g.attributes.normal, idx = g.index.array;
  let bad = 0;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), vn = new Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(p, idx[i]); b.fromBufferAttribute(p, idx[i + 1]); c.fromBufferAttribute(p, idx[i + 2]);
    const fn = b.clone().sub(a).cross(c.clone().sub(a));
    if (fn.lengthSq() < 1e-14) continue;
    vn.fromBufferAttribute(n, idx[i]).add(new Vector3().fromBufferAttribute(n, idx[i + 1])).add(new Vector3().fromBufferAttribute(n, idx[i + 2]));
    if (fn.dot(vn) <= 0) bad++;
  }
  return bad;
}

test('transforms compose down the hierarchy', () => {
  const root = new Group(), arm = new Object3D(), hand = new Object3D();
  root.add(arm); arm.add(hand);
  root.position.set(10, 0, 0);
  arm.rotation.y = Math.PI / 2;
  arm.position.set(0, 2, 0);
  hand.position.set(0, 0, -3);
  root.updateMatrixWorld();
  // arm rotated +90 degrees about Y: local -Z becomes -X
  const p = hand.getWorldPosition(new Vector3());
  close(p.x, 7); close(p.y, 2); close(p.z, 0);
  // euler <-> quaternion are linked both ways
  arm.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.5);
  close(arm.rotation.x, 0.5);
  arm.rotation.set(0, 0, 0.25);
  close(arm.quaternion.z, Math.sin(0.125));
});
test('attach keeps the world transform; add moves between parents', () => {
  const a = new Group(), b = new Group(), o = new Object3D();
  a.position.set(5, 0, 0); b.position.set(0, 3, 0); b.rotation.z = 1;
  a.add(o); o.position.set(1, 1, 1);
  const scene = new Scene(); scene.add(a, b);
  scene.updateMatrixWorld();
  const before = o.getWorldPosition(new Vector3());
  b.attach(o);
  scene.updateMatrixWorld();
  const after = o.getWorldPosition(new Vector3());
  close(before.distanceTo(after), 0, 1e-5);
  assert.equal(o.parent, b); assert.equal(a.children.length, 0);
});
test('lookAt: cameras look down -Z, other objects face +Z toward the target', () => {
  const cam = new PerspectiveCamera(50, 1, 0.1, 100);
  cam.position.set(0, 0, 0); cam.lookAt(0, 0, -10);
  cam.updateMatrixWorld();
  const d = cam.getWorldDirection(new Vector3());
  close(d.z, -1);
  cam.lookAt(10, 0, 0); cam.updateMatrixWorld();
  const d2 = cam.getWorldDirection(new Vector3());
  close(d2.x, 1);
  const o = new Object3D(); o.lookAt(0, 0, 5); o.updateMatrixWorld();
  close(o.getWorldDirection(new Vector3()).z, 1);
  // view matrix is the inverse of the world matrix
  const m = new Matrix4().multiplyMatrices(cam.matrixWorld, cam.matrixWorldInverse);
  for (let i = 0; i < 16; i++) close(m.elements[i], i % 5 === 0 ? 1 : 0, 1e-5);
});
test('PerspectiveCamera: focal length <-> field of view, reversed depth', () => {
  const cam = new PerspectiveCamera(35, 16 / 9, 0.1, 1000);
  cam.setFocalLength(50);
  // 35 mm film gate (height 35/aspect... here width-based for aspect>1: film height = 35/1.78 = 19.7 mm)
  close(cam.getFocalLength(), 50, 1e-6);
  const z = (d) => new Vector3(0, 0, -d).applyMatrix4(cam.projectionMatrix).z;
  close(z(0.1), 1, 1e-6); close(z(1000), 0, 1e-5);
  assert.ok(z(1) > z(10) && z(10) > z(100), 'depth decreases with distance (reversed-Z)');
  const ortho = new OrthographicCamera(-5, 5, 5, -5, 0.1, 50);
  close(new Vector3(0, 0, -0.1).applyMatrix4(ortho.projectionMatrix).z, 1, 1e-6);
});
test('primitives: indexed, outward winding, unit normals that agree with the faces', () => {
  const shapes = {
    box: new BoxGeometry(2, 3, 4, 2, 2, 2), sphere: new SphereGeometry(1.5, 24, 12), cylinder: new CylinderGeometry(1, 1, 2, 24, 3),
    cone: new CylinderGeometry(0, 1, 2, 24), capsule: new CapsuleGeometry(0.5, 1, 6, 16),
  };
  for (const [name, g] of Object.entries(shapes)) {
    assert.ok(g.index.count % 3 === 0, name);
    assert.ok(volume(g) > 0, `${name}: outward winding (volume ${volume(g)})`);
    assert.equal(badNormals(g), 0, `${name}: normals agree with winding`);
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i += 7) close(new Vector3().fromBufferAttribute(n, i).length(), 1, 1e-4, `${name} unit normal`);
  }
  close(volume(shapes.box), 24, 1e-4, 'box volume');
  close(volume(shapes.sphere), (4 / 3) * Math.PI * 1.5 ** 3, 0.6, 'sphere volume (tessellated)');
  close(volume(shapes.cylinder), Math.PI * 2, 0.1, 'cylinder volume');
  const bb = new Box3().setFromArray(shapes.capsule.attributes.position.array);
  close(bb.max.y, 1.0, 1e-5, 'capsule height 1 + 2*0.5 = 2');
  const plane = new PlaneGeometry(4, 2);
  assert.equal(plane.attributes.position.count, 4);
  close(new Vector3().fromBufferAttribute(plane.attributes.normal, 0).z, 1);
});
test('ExtrudeGeometry: closed, outward-facing, right volume (CCW and CW outlines, with bevel)', () => {
  const L = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]];       // an L shape, area 4 + 2 = 6
  for (const pts of [L, [...L].reverse()]) {
    const g = new ExtrudeGeometry(new Shape(pts), { depth: 2 });
    close(volume(g), 12, 1e-4, 'L prism volume');
    assert.equal(badNormals(g), 0, 'normals');
    const bevelled = new ExtrudeGeometry(new Shape(pts), { depth: 2, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1 });
    assert.ok(volume(bevelled) > 12, 'bevel adds material around the outline');
    assert.equal(badNormals(bevelled), 0, 'bevel normals');
  }
});
test('computeVertexNormals, bounds, applyMatrix4, merge, toNonIndexed', () => {
  const g = new BoxGeometry(2, 2, 2);
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  assert.ok(g.attributes.normal.count === g.attributes.position.count);
  g.computeBoundingBox(); g.computeBoundingSphere();
  close(g.boundingBox.max.x, 1); close(g.boundingSphere.radius, Math.sqrt(3), 1e-5);
  g.translate(1, 2, 3);
  close(g.boundingBox.min.x, 0); close(g.boundingBox.max.z, 4);
  const a = new BoxGeometry(1, 1, 1), b = new SphereGeometry(1, 8, 6);
  const m = mergeGeometries([a, b], true);
  assert.equal(m.attributes.position.count, a.attributes.position.count + b.attributes.position.count);
  assert.equal(m.index.count, a.index.count + b.index.count);
  assert.equal(m.groups.length, 2);
  assert.ok(Math.max(...m.index.array) < m.attributes.position.count);
  const ni = a.toNonIndexed();
  assert.equal(ni.attributes.position.count, a.index.count);
  assert.equal(ni.index, null);
});
test('Skeleton: skin matrices are identity in the bind pose and follow bone motion', () => {
  const root = new Bone(), mid = new Bone(), tip = new Bone();
  root.position.set(0, 0, 0); mid.position.set(0, 1, 0); tip.position.set(0, 1, 0);
  root.add(mid); mid.add(tip);
  const g = new BoxGeometry(0.2, 2, 0.2, 1, 4, 1);
  const n = g.attributes.position.count;
  g.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(n * 4), 4));
  g.setAttribute('skinWeight', new BufferAttribute(new Float32Array(n * 4), 4));
  for (let i = 0; i < n; i++) {
    const y = g.attributes.position.getY(i) + 1; // 0..2
    g.attributes.skinIndex.setXYZW(i, y < 1 ? 0 : 1, y < 1 ? 1 : 2, 0, 0);
    g.attributes.skinWeight.setXYZW(i, 1 - (y % 1), y % 1 || (y >= 2 ? 1 : 0), 0, 0);
  }
  const mesh = new SkinnedMesh(g, new StandardMaterial());
  const sc = new Scene(); sc.add(root, mesh);
  sc.updateMatrixWorld(true);
  const sk = new Skeleton([root, mid, tip]);
  mesh.bind(sk);
  sk.update();
  for (let i = 0; i < 3 * 16; i++) close(sk.boneMatrices[i], (i % 16) % 5 === 0 ? 1 : 0, 1e-5, 'bind pose is identity');
  root.rotation.z = Math.PI / 2; sc.updateMatrixWorld(true); sk.update();
  // the whole chain rotated about the origin: a point of bone `tip` at (0,2,0) goes to (-2,0,0)
  const p = new Vector3(0, 2, 0).applyMatrix4(new Matrix4().fromArray(Array.from(sk.boneMatrices.subarray(32, 48))));
  close(p.x, -2, 1e-5); close(p.y, 0, 1e-5);
  // moving the whole character (the mesh's parent) must not distort: pose() restores the bind pose
  sk.pose(); sc.updateMatrixWorld(true); sk.update();
  for (let i = 0; i < 16; i++) close(sk.boneMatrices[i], i % 5 === 0 ? 1 : 0, 1e-5, 'pose() restores');
});
test('InstancedMesh stores matrices and colours', () => {
  const im = new InstancedMesh(new BoxGeometry(1, 1, 1), new StandardMaterial(), 3);
  im.setMatrixAt(1, new Matrix4().makeTranslation(5, 0, 0));
  assert.equal(im.instanceMatrix.array[16 + 12], 5);
  im.setColorAt(2, { toArray: (a, o) => { a[o] = 0.1; a[o + 1] = 0.2; a[o + 2] = 0.3; } });
  close(im.instanceColor.array[8], 0.3);
  im.computeBoundingSphere();
  assert.ok(im.boundingSphere.radius >= 2.5);
});
test('materials, textures and lights', () => {
  const m = new StandardMaterial({ color: 0xff0000, roughness: 0.3, medType: 'skin' });
  close(m.color.r, 1); close(m.roughness, 0.3); assert.equal(m.medType, 'skin');
  const c = m.clone(); c.color.setRGB(0, 1, 0); close(m.color.g, 0, 1e-9, 'clone does not share colour');
  const t = new DataTexture(new Uint8Array(16), 2, 2);
  t.repeat.set(2, 3); t.updateMatrix();
  close(t.matrix.elements[0], 2); close(t.matrix.elements[4], 3);
  const v = t.version; t.needsUpdate = true; assert.equal(t.version, v + 1);
  const sun = new DirectionalLight(0xfff0e0, 7);
  sun.position.set(1, 2, 3); sun.target.position.set(0, 0, 0);
  assert.ok(sun.isLight && sun.isDirectionalLight && sun.target.isObject3D);
  assert.ok(new SpotLight().isSpotLight);
  void Texture; void Euler; void v3;
});
