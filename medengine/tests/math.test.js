import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  Vector3, Quaternion, Euler, Matrix4, Matrix3, Box3, Sphere, Ray, Triangle, Frustum, Plane, Color, MathUtils,
} from '../src/math/index.js';

// Numbers recorded from an independent, widely used reference implementation (see tools/ in the repository history:
// the fixture was generated once; nothing here imports it).
const F = JSON.parse(fs.readFileSync(new URL('./fixtures/math-parity.json', import.meta.url)));
const near = (a, b, eps = 1e-5, msg = '') => {
  assert.equal(a.length, b.length, msg + ' length');
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= eps * Math.max(1, Math.abs(b[i])), `${msg} [${i}] ${a[i]} vs ${b[i]}`);
};
const nearQ = (a, b, eps = 1e-5, msg = '') => { // quaternions: q and -q are the same rotation
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  near(a.map((x) => x * s), b, eps, msg);
};
const arr = (o) => Array.from(o.elements ?? o.toArray());

test('Euler -> Quaternion / Matrix4 (all six orders)', () => {
  for (const c of F.euler) {
    const e = new Euler(c.e[0], c.e[1], c.e[2], c.e[3]);
    near(arr(new Quaternion().setFromEuler(e)), c.q, 1e-6, `q ${c.e[3]}`);
    near(arr(new Matrix4().makeRotationFromEuler(e)), c.m, 1e-6, `m ${c.e[3]}`);
  }
});
test('Matrix4 -> Euler / Quaternion', () => {
  for (const c of F.eulerFromMat) {
    const m = new Matrix4().fromArray(c.m);
    near(arr(new Euler().setFromRotationMatrix(m, c.order)).slice(0, 3), c.e, 1e-4, `euler ${c.order}`);
    nearQ(arr(new Quaternion().setFromRotationMatrix(m)), c.q, 1e-5, 'q from m');
  }
});
test('Quaternion multiply, slerp, setFromUnitVectors', () => {
  for (const c of F.quatMul) near(arr(new Quaternion().fromArray(c.a).multiply(new Quaternion().fromArray(c.b))), c.r, 1e-6, 'mul');
  for (const c of F.slerp) nearQ(arr(new Quaternion().fromArray(c.a).slerp(new Quaternion().fromArray(c.b), c.t)), c.r, 1e-5, 'slerp');
  for (const c of F.unitVec) nearQ(arr(new Quaternion().setFromUnitVectors(new Vector3().fromArray(c.a), new Vector3().fromArray(c.b))), c.q, 1e-5, 'unit');
});
test('Matrix4 compose / decompose / invert / determinant / lookAt', () => {
  for (const c of F.matCompose) {
    const m = new Matrix4().compose(new Vector3().fromArray(c.p), new Quaternion().fromArray(c.q), new Vector3().fromArray(c.s));
    near(arr(m), c.m, 1e-5, 'compose');
    assert.ok(Math.abs(m.determinant() - c.det) < 1e-3 * Math.max(1, Math.abs(c.det)), 'det');
    const p = new Vector3(), q = new Quaternion(), s = new Vector3();
    m.decompose(p, q, s);
    near(arr(p), c.p2, 1e-5, 'dec p'); near(arr(s), c.s2, 1e-5, 'dec s'); nearQ(arr(q), c.q, 1e-4, 'dec q');
  }
  for (const c of F.matInvert) near(arr(new Matrix4().fromArray(c.m).invert()), c.inv, 2e-4, 'invert');
  for (const c of F.lookAt) near(arr(new Matrix4().lookAt(new Vector3().fromArray(c.eye), new Vector3().fromArray(c.target), new Vector3(0, 1, 0))), c.m, 1e-5, 'lookAt');
});
test('Vector3 transforms and normal matrix', () => {
  for (const c of F.applyM4) {
    const m = new Matrix4().fromArray(c.m);
    near(arr(new Vector3().fromArray(c.v).applyMatrix4(m)), c.r, 1e-4, 'applyMatrix4');
    near(arr(new Vector3().fromArray(c.v).transformDirection(m)), c.d, 1e-5, 'transformDirection');
  }
  for (const c of F.applyQ) near(arr(new Vector3().fromArray(c.v).applyQuaternion(new Quaternion().fromArray(c.q))), c.r, 1e-5, 'applyQuaternion');
  for (const c of F.normalMatrix) near(arr(new Matrix3().getNormalMatrix(new Matrix4().fromArray(c.m))), c.n, 1e-4, 'normalMatrix');
});
test('Box3.applyMatrix4, Ray-triangle, closest point on triangle', () => {
  for (const c of F.box) {
    const b = new Box3(new Vector3().fromArray(c.min), new Vector3().fromArray(c.max)).applyMatrix4(new Matrix4().fromArray(c.m));
    near(arr(b.min), c.rmin, 1e-4, 'box min'); near(arr(b.max), c.rmax, 1e-4, 'box max');
  }
  for (const c of F.tri) {
    const [a, b, d] = c.tri.map((t) => new Vector3().fromArray(t));
    const ray = new Ray(new Vector3().fromArray(c.o), new Vector3().fromArray(c.d));
    const hit = ray.intersectTriangle(a, b, d, false);
    if (c.hit === null) assert.equal(hit, null); else near(arr(hit), c.hit, 1e-4, 'ray-tri');
  }
  for (const c of F.closest) {
    const [a, b, d] = c.tri.map((t) => new Vector3().fromArray(t));
    near(arr(Triangle.closestPoint(new Vector3().fromArray(c.p), a, b, d)), c.r, 1e-5, 'closest');
  }
});

// -- WebGPU conventions: not available from the reference (its depth range is -1..1) ----------------
test('perspective: x/y rows match the reference; depth is 0..1 and reversed on request', () => {
  for (const c of F.persp) {
    const top = c.near * Math.tan((c.fov * Math.PI) / 360), right = top * c.asp;
    const m = new Matrix4().makePerspective(-right, right, top, -top, c.near, c.far, false), e = m.elements;
    for (const i of [0, 1, 4, 5, 8, 9, 3, 7, 11, 15, 12, 13]) assert.ok(Math.abs(e[i] - c.m[i]) < 1e-5 * Math.max(1, Math.abs(c.m[i])), `elem ${i}`);
    const proj = (z, mat) => { const v = new Vector3(0, 0, z).applyMatrix4(mat); return v.z; };
    assert.ok(Math.abs(proj(-c.near, m)) < 1e-6, 'near -> 0');
    assert.ok(Math.abs(proj(-c.far, m) - 1) < 1e-4, 'far -> 1');
    const rz = new Matrix4().makePerspective(-right, right, top, -top, c.near, c.far, true);
    assert.ok(Math.abs(proj(-c.near, rz) - 1) < 1e-6, 'reversed: near -> 1');
    assert.ok(Math.abs(proj(-c.far, rz)) < 1e-4, 'reversed: far -> 0');
    const inf = new Matrix4().makePerspective(-right, right, top, -top, c.near, Infinity, true);
    assert.ok(Math.abs(proj(-c.near, inf) - 1) < 1e-6 && proj(-1e7, inf) < 1e-6, 'reversed infinite far');
  }
});
test('orthographic maps the box to x,y in -1..1 and z in 0..1', () => {
  for (const reversed of [false, true]) {
    const m = new Matrix4().makeOrthographic(-4, 4, 3, -3, 1, 21, reversed);
    const p = (x, y, z) => new Vector3(x, y, z).applyMatrix4(m);
    near(arr(p(-4, -3, -1)), [-1, -1, reversed ? 1 : 0], 1e-6);
    near(arr(p(4, 3, -21)), [1, 1, reversed ? 0 : 1], 1e-6);
  }
});
test('Frustum from a reversed-Z perspective matrix culls correctly', () => {
  const m = new Matrix4().makePerspectiveFov(60, 1.5, 0.5, 100, true);
  const f = new Frustum().setFromProjectionMatrix(m); // camera at origin looking down -Z
  assert.ok(f.containsPoint(new Vector3(0, 0, -10)));
  assert.ok(!f.containsPoint(new Vector3(0, 0, 10)), 'behind');
  assert.ok(!f.containsPoint(new Vector3(0, 0, -0.2)), 'in front of near');
  assert.ok(!f.containsPoint(new Vector3(0, 0, -101)), 'beyond far');
  assert.ok(!f.containsPoint(new Vector3(50, 0, -10)), 'right of view');
  assert.ok(f.intersectsSphere(new Sphere(new Vector3(30, 0, -10), 30)));
  assert.ok(!f.intersectsBox(new Box3(new Vector3(-1, -1, 5), new Vector3(1, 1, 7))));
  assert.ok(f.intersectsBox(new Box3(new Vector3(-1, -1, -30), new Vector3(1, 1, -20))));
});
test('Plane, Sphere, Ray basics', () => {
  const pl = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), new Vector3(0, 2, 0));
  assert.equal(pl.distanceToPoint(new Vector3(5, 5, 5)), 3);
  const hit = new Ray(new Vector3(0, 10, 0), new Vector3(0, -1, 0)).intersectPlane(pl);
  assert.equal(hit.y, 2);
  const s = new Sphere(new Vector3(0, 0, 0), 1);
  assert.ok(new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1)).intersectSphere(s));
  assert.equal(new Ray(new Vector3(0, 3, 5), new Vector3(0, 0, -1)).intersectSphere(s), null);
  assert.equal(new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1)).distanceToBox(new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))), 4);
});
test('Color: hex is sRGB, stored linear, round-trips', () => {
  const c = new Color(0x808080);
  assert.ok(Math.abs(c.r - 0.2158605) < 1e-5);
  assert.equal(c.getHex(), 0x808080);
  assert.equal(new Color('#ff8000').getHexString(), 'ff8000');
});
test('MathUtils', () => {
  assert.equal(MathUtils.euclideanModulo(-1, 5), 4);
  assert.equal(MathUtils.smoothstep(0.5, 0, 1), 0.5);
  const r1 = MathUtils.seededRandom(7), r2 = MathUtils.seededRandom(7);
  for (let i = 0; i < 5; i++) assert.equal(r1(), r2());
  assert.match(MathUtils.generateUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
