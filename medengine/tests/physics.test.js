import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion } from '../src/math/index.js';
import { BoxGeometry } from '../src/scene/Geometry.js';
import { Matrix4 } from '../src/math/core.js';
import {
  AABBTree, Contacts, capsuleVsPlane, capsuleVsBox, capsuleVsCapsule, capsuleVsTriangle, rayTriangle, rayBox, raySphere, rayCapsule,
  PlaneCollider, BoxCollider, SphereCollider, CapsuleCollider, MeshCollider, RigidBody, BallJoint, HingeJoint, World, Character, Ragdoll,
} from '../src/physics/index.js';
import { Humanoid } from '../src/anim/Humanoid.js';

const V = (x, y, z) => new Vector3(x, y, z);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
const DT = 1 / 60;
const floor = (w) => w.addCollider(new PlaneCollider(V(0, 1, 0), 0));

// ------------------------------------------------------------------------------------------------ narrow phase

test('capsule vs plane: a contact per end, depth and normal', () => {
  const out = new Contacts();
  capsuleVsPlane(V(0, 0.05, 0), V(0, 0.65, 0), 0.1, 0, 1, 0, 0, out);
  assert.equal(out.n, 1);                                     // only the lower end touches
  near(out.d[6], 0.05, 1e-9, 'depth'); near(out.d[4], 1, 1e-9, 'normal.y'); near(out.d[1], 0, 1e-9, 'point on the plane');
  out.clear();
  capsuleVsPlane(V(0, 0.05, 0), V(1, 0.05, 0), 0.1, 0, 1, 0, 0, out);
  assert.equal(out.n, 2);                                     // lying down touches at both ends
  out.clear();
  const p = V(0, 0.05, 0);
  capsuleVsPlane(p, p, 0.1, 0, 1, 0, 0, out);
  assert.equal(out.n, 1);                                     // a sphere (a === b) gives one contact
});

test('capsule vs box: pushes out through the nearest face, and handles an end inside the box', () => {
  const box = new BoxCollider({ center: V(0, 0.5, 0), half: V(1, 0.5, 1) });
  const out = new Contacts();
  box.collideCapsule(V(0, 1.2, 0), V(0, 1.9, 0), 0.25, out);
  assert.ok(out.n >= 1);
  near(out.d[6], 0.05, 1e-4, 'depth'); near(out.d[4], 1, 1e-6, 'normal.y'); near(out.d[1], 1, 1e-6, 'point on the top face');
  out.clear();
  box.collideCapsule(V(0.9, 0.9, 0), V(0.9, 1.5, 0), 0.1, out);   // lower end 0.1 inside the top face, 0.1 from the +x face
  assert.ok(out.n >= 1);
  // pushed out along +y or +x, never deeper into the box
  const nx = out.d[3], ny = out.d[4];
  assert.ok(ny > 0.9 || nx > 0.9, `normal (${nx}, ${ny})`);
  // a rotated box
  const rot = new BoxCollider({ center: V(0, 0, 0), half: V(1, 0.1, 1), rotation: new Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 4) });
  out.clear();
  rot.collideCapsule(V(0, 0.4, 0), V(0, 0.4, 0), 0.2, out);
  assert.equal(out.n, 1);
  near(out.d[3], -Math.SQRT1_2, 1e-6, 'rotated normal x'); near(out.d[4], Math.SQRT1_2, 1e-6, 'rotated normal y');
});

test('capsule vs capsule: contact point lies on the other capsule\'s surface', () => {
  const out = new Contacts();
  capsuleVsCapsule(V(0.35, 0, 0), V(0.35, 1, 0), 0.2, V(0, 0, 0), V(0, 1, 0), 0.2, out);   // parallel, overlapping by 0.05
  assert.ok(out.n >= 1);
  for (let i = 0; i < out.n; i++) {
    near(out.d[i * 7 + 6], 0.05, 1e-9, 'depth'); near(out.d[i * 7 + 3], 1, 1e-9, 'normal x');
    near(out.d[i * 7], 0.2, 1e-9, 'point on the surface of B (x = 0.2)');
  }
  assert.equal(out.n, 2, 'two contacts for parallel capsules');
  out.clear();
  const c = V(0, 0, 0);
  capsuleVsCapsule(V(0.25, 0, 0), V(0.25, 0, 0), 0.1, c, c, 0.2, out);                       // two spheres
  assert.equal(out.n, 1);
  near(out.d[0], 0.2, 1e-9, 'sphere-sphere point'); near(out.d[6], 0.05, 1e-9);
  out.clear();
  capsuleVsCapsule(V(1, 0, 0), V(1, 1, 0), 0.1, c, c, 0.2, out);
  assert.equal(out.n, 0);
});

test('capsule vs triangle: face, edge and vertex contacts', () => {
  const out = new Contacts();
  const a = V(-1, 0, -1), b = V(1, 0, -1), c = V(0, 0, 1);       // faces +y or -y depending on winding
  const s = V(0, 0.15, 0);
  capsuleVsTriangle(s, s, 0.2, a, b, c, out);
  assert.equal(out.n, 1);
  near(Math.abs(out.d[4]), 1, 1e-9, 'normal is the face normal'); near(out.d[6], 0.05, 1e-9);
  assert.ok(out.d[4] > 0, 'pushes the sphere out on its own side');
  out.clear();
  const e = V(0, 0.1, -1.1);                                     // above the edge a-b, 0.1 outside it
  capsuleVsTriangle(e, e, 0.2, a, b, c, out);
  assert.equal(out.n, 1);
  near(out.d[6], 0.2 - Math.hypot(0.1, 0.1), 1e-9, 'edge depth');
  out.clear();
  const f = V(-1.1, 0, -1.1);                                    // beside the vertex a
  capsuleVsTriangle(f, f, 0.2, a, b, c, out);
  assert.equal(out.n, 1);
  near(out.d[6], 0.2 - Math.hypot(0.1, 0.1), 1e-9, 'vertex depth');
  out.clear();
  const g = V(0, 0.5, 0);
  capsuleVsTriangle(g, g, 0.2, a, b, c, out);
  assert.equal(out.n, 0);
  // a one-sided triangle ignores a capsule behind it
  out.clear();
  const back = V(0, -0.1, 0);
  capsuleVsTriangle(back, back, 0.2, a, b, c, out, false);
  const winding = V(0, 0, 0).copy(b).sub(a).cross(V(0, 0, 0).copy(c).sub(a));
  assert.equal(out.n, winding.y > 0 ? 0 : 1);
});

test('rays hit triangles, boxes, spheres and capsules at the right distance', () => {
  near(rayTriangle(0, 5, 0, 0, -1, 0, V(-1, 0, -1), V(1, 0, -1), V(0, 0, 1), 100), 5, 1e-9, 'triangle');
  assert.equal(rayTriangle(5, 5, 0, 0, -1, 0, V(-1, 0, -1), V(1, 0, -1), V(0, 0, 1), 100), -1);
  assert.equal(rayTriangle(0, 5, 0, 0, -1, 0, V(-1, 0, -1), V(1, 0, -1), V(0, 0, 1), 3), -1, 'beyond maxT');
  const hit = {};
  const box = new BoxCollider({ center: V(2, 0, 0), half: V(0.5, 0.5, 0.5) });
  assert.ok(box.raycast(0, 0, 0, 1, 0, 0, 10, hit));
  near(hit.t, 1.5, 1e-9, 'box t'); near(hit.nx, -1, 1e-9, 'box normal');
  assert.ok(!box.raycast(0, 2, 0, 1, 0, 0, 10, hit));
  near(raySphere(0, 0, 0, 1, 0, 0, V(3, 0, 0), 1, 100), 2, 1e-9, 'sphere');
  assert.equal(raySphere(0, 0, 0, -1, 0, 0, V(3, 0, 0), 1, 100), -1);
  near(rayCapsule(0, 0.5, 0, 1, 0, 0, V(3, 0, 0), V(3, 1, 0), 0.25, 100), 2.75, 1e-9, 'capsule side');
  near(rayCapsule(3, 3, 0, 0, -1, 0, V(3, 0, 0), V(3, 1, 0), 0.25, 100), 1.75, 1e-9, 'capsule cap');
});

test('AABBTree queries match brute force', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const n = 400, boxes = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const x = rnd() * 40, y = rnd() * 40, z = rnd() * 40, w = 0.2 + rnd() * 2, h = 0.2 + rnd() * 2, d = 0.2 + rnd() * 2;
    boxes.set([x, y, z, x + w, y + h, z + d], i * 6);
  }
  const tree = new AABBTree(boxes);
  for (let k = 0; k < 40; k++) {
    const q = [rnd() * 35, rnd() * 35, rnd() * 35]; const q1 = q.map((v) => v + 1 + rnd() * 8);
    const got = []; tree.query(q[0], q[1], q[2], q1[0], q1[1], q1[2], (i) => { got.push(i); });
    const want = [];
    for (let i = 0; i < n; i++) {
      const b = i * 6;
      if (!(boxes[b] > q1[0] || boxes[b + 3] < q[0] || boxes[b + 1] > q1[1] || boxes[b + 4] < q[1] || boxes[b + 2] > q1[2] || boxes[b + 5] < q[2])) want.push(i);
    }
    assert.deepEqual(got.sort((a, b) => a - b), want);
  }
  // ray: the set of items reported must include every box the ray really crosses
  for (let k = 0; k < 30; k++) {
    const o = [rnd() * 40, rnd() * 40, -5], d = [rnd() - 0.5, rnd() - 0.5, 1]; const l = Math.hypot(...d); d.forEach((v, i) => { d[i] = v / l; });
    const seen = new Set(); tree.raycast(o[0], o[1], o[2], d[0], d[1], d[2], 100, (i) => { seen.add(i); });
    for (let i = 0; i < n; i++) {
      const b = i * 6; let t0 = 0, t1 = 100, ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        if (Math.abs(d[a]) < 1e-12) { if (o[a] < boxes[b + a] || o[a] > boxes[b + 3 + a]) ok = false; continue; }
        let u = (boxes[b + a] - o[a]) / d[a], v = (boxes[b + 3 + a] - o[a]) / d[a]; if (u > v) [u, v] = [v, u];
        t0 = Math.max(t0, u); t1 = Math.min(t1, v); if (t0 > t1) ok = false;
      }
      if (ok) assert.ok(seen.has(i), `ray ${k} crosses box ${i} but the tree skipped it`);
    }
  }
});

test('MeshCollider from a geometry: rays and capsules', () => {
  const geo = new BoxGeometry(2, 2, 2);
  const m = MeshCollider.fromGeometry(geo, new Matrix4().makeTranslation(5, 1, 0));
  assert.equal(m.triangleCount, 12);
  const hit = {};
  assert.ok(m.raycast(0, 1, 0, 1, 0, 0, 100, hit));
  near(hit.t, 4, 1e-6, 'ray to the cube'); near(hit.nx, -1, 1e-6, 'face normal');
  const out = new Contacts();
  m.collideCapsule(V(3.8, 1, 0), V(3.8, 1.5, 0), 0.3, out);          // 0.1 into the -x face
  assert.ok(out.n >= 1);
  near(out.d[6], 0.1, 1e-6, 'depth'); near(out.d[3], -1, 1e-6, 'normal');
});

// ------------------------------------------------------------------------------------------------ dynamics

test('a dropped sphere comes to rest on the floor and falls asleep', () => {
  const w = new World(); floor(w);
  const b = w.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.3 }, mass: 2, position: V(0, 2, 0) }));
  for (let i = 0; i < 200; i++) w.step(DT);
  near(b.position.y, 0.3, 0.004, 'rest height');
  assert.ok(b.sleeping, 'should sleep');
  assert.equal(b.linearVelocity.length(), 0);
  b.applyImpulse(V(0, 4, 0));                                          // an impulse wakes it
  assert.ok(!b.sleeping);
  for (let i = 0; i < 20; i++) w.step(DT);
  assert.ok(b.position.y > 0.4);
});

test('restitution: bounce height follows e squared', () => {
  const w = new World(); floor(w);
  const b = w.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.1 }, mass: 1, position: V(0, 2, 0), restitution: 0.6, linearDamping: 0 }));
  let bounced = false, apex = 0;
  for (let i = 0; i < 240; i++) { w.step(1 / 120); if (b.linearVelocity.y > 0.5) bounced = true; if (bounced) apex = Math.max(apex, b.position.y - 0.1); }
  near(apex, 0.36 * 1.9, 0.08, 'apex');
});

test('friction on an incline: stays below the friction angle, slides above it', () => {
  const run = (deg) => {
    const w = new World({ sleeping: false }); const th = deg * Math.PI / 180;
    const n = V(-Math.sin(th), Math.cos(th), 0);
    w.addCollider(new PlaneCollider(n, 0));
    const down = V(-Math.cos(th), -Math.sin(th), 0);                // along the slope, downhill
    const q = new Quaternion().setFromUnitVectors(V(0, 1, 0), down);
    const b = w.addBody(new RigidBody({ shape: { type: 'capsule', radius: 0.1, length: 0.6 }, mass: 3, position: n.clone().multiplyScalar(0.1), rotation: q, friction: 0.5 }));
    const p0 = b.position.clone();
    for (let i = 0; i < 60; i++) w.step(DT);
    return b.position.clone().sub(p0).dot(down);
  };
  assert.ok(run(15) < 0.03, `15 deg moved ${run(15)}`);
  const d = run(40);
  assert.ok(d > 0.9 && d < 1.7, `40 deg slid ${d} m in 1 s (a = g(sin - mu cos) = 2.55 gives about 1.3)`);
});

test('two spheres collide elastically and conserve momentum', () => {
  const w = new World({ gravity: V(0, 0, 0), sleeping: false });
  const a = w.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.2 }, mass: 1, position: V(0, 0, 0), restitution: 1, linearDamping: 0 }));
  const b = w.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.2 }, mass: 3, position: V(2, 0, 0), restitution: 1, linearDamping: 0 }));
  a.linearVelocity.set(4, 0, 0);
  const p0 = 1 * 4, e0 = 0.5 * 16;
  for (let i = 0; i < 120; i++) w.step(DT);
  const p = a.linearVelocity.x + 3 * b.linearVelocity.x, e = 0.5 * a.linearVelocity.x ** 2 + 1.5 * b.linearVelocity.x ** 2;
  near(p, p0, 0.08, 'momentum'); near(e, e0, 0.8, 'energy');
  near(a.linearVelocity.x, -2, 0.25, 'a bounces back'); near(b.linearVelocity.x, 2, 0.25, 'b moves on');
});

test('collision filtering and ignore groups', () => {
  const w = new World({ gravity: V(0, 0, 0), sleeping: false });
  const a = w.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.5 }, mass: 1, position: V(0, 0, 0), ignoreGroup: 7 }));
  const b = w.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.5 }, mass: 1, position: V(0.5, 0, 0), ignoreGroup: 7 }));
  for (let i = 0; i < 30; i++) w.step(DT);
  near(b.position.x - a.position.x, 0.5, 1e-6, 'same ignoreGroup: no collision');
  const c = w.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.5 }, mass: 1, position: V(0, 3, 0), group: 2, mask: 0b100 }));
  const d = w.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.5 }, mass: 1, position: V(0.2, 3, 0), group: 1, mask: 0xffff }));
  for (let i = 0; i < 30; i++) w.step(DT);
  near(Math.abs(d.position.x - c.position.x), 0.2, 1e-6, 'masks that exclude each other: no collision');
});

test('ball joint pendulum keeps its anchor and has the right period', () => {
  const w = new World({ sleeping: false });
  const L = 1, r = 0.05;
  const b = w.addBody(new RigidBody({ shape: { type: 'sphere', radius: r }, mass: 1, position: V(L * Math.sin(0.2), 3 - L * Math.cos(0.2), 0), linearDamping: 0, angularDamping: 0 }));
  const j = w.addJoint(new BallJoint(w.ground, b, V(0, 3, 0)));
  const crossings = []; let prev = b.position.x, t = 0, maxErr = 0;
  for (let i = 0; i < 600; i++) { w.step(1 / 120); t += 1 / 120; if (prev > 0 && b.position.x <= 0) crossings.push(t); prev = b.position.x; maxErr = Math.max(maxErr, j.anchorError()); }
  const T = 2 * Math.PI * Math.sqrt((0.4 * r * r + L * L) / (9.81 * L));
  assert.ok(crossings.length >= 3);
  near(crossings[2] - crossings[1], T, 0.03 * T, 'period');
  assert.ok(maxErr < 1e-3, `anchor drift ${maxErr}`);
});

test('hinge joint respects its angle limits', () => {
  const w = new World({ sleeping: false });
  const rod = w.addBody(new RigidBody({ shape: { type: 'capsule', radius: 0.05, length: 0.8 }, mass: 2, position: V(0.45, 3, 0), rotation: new Quaternion().setFromAxisAngle(V(0, 0, 1), -Math.PI / 2) }));
  const j = w.addJoint(new HingeJoint(w.ground, rod, V(0, 3, 0), V(0, 0, 1), { min: -1.0, max: 0.5 }));
  let lo = 0, hi = 0;
  for (let i = 0; i < 480; i++) { w.step(1 / 120); lo = Math.min(lo, j.angle); hi = Math.max(hi, j.angle); }
  assert.ok(lo > -1.0 - 0.04, `lower limit exceeded: ${lo}`);
  assert.ok(lo < -0.9, `should swing down to the limit, got ${lo}`);
  assert.ok(hi <= 0.04, `should not swing up: ${hi}`);
  assert.ok(j.anchorError() < 1e-3);
  // swing the other way to the upper limit with an impulse
  rod.applyImpulse(V(0, 40, 0), V(0.9, 3, 0));
  hi = 0;
  for (let i = 0; i < 120; i++) { w.step(1 / 120); hi = Math.max(hi, j.angle); }
  assert.ok(hi < 0.5 + 0.05, `upper limit exceeded: ${hi}`);
  assert.ok(hi > 0.3, `impulse should reach the upper limit region: ${hi}`);
});

test('ball joint cone limit holds a swinging arm', () => {
  const w = new World({ sleeping: false });
  const arm = w.addBody(new RigidBody({ shape: { type: 'capsule', radius: 0.05, length: 0.8 }, mass: 2, position: V(0, 2.55, 0) }));   // hangs from y=3 down
  const j = w.addJoint(new BallJoint(w.ground, arm, V(0, 3, 0), { axis: V(0, -1, 0), coneAngle: 40 * Math.PI / 180 }));
  arm.applyImpulse(V(30, 0, 0), V(0, 2.2, 0));
  let maxSwing = 0;
  for (let i = 0; i < 360; i++) { w.step(1 / 120); maxSwing = Math.max(maxSwing, j.measure().swing); }
  assert.ok(maxSwing < 40 * Math.PI / 180 + 0.06, `swing ${maxSwing * 180 / Math.PI} deg`);
  assert.ok(maxSwing > 30 * Math.PI / 180, 'should reach the limit');
});

test('a sleeping body wakes when something fast hits it', () => {
  const w = new World();
  floor(w);
  const a = w.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.3 }, mass: 2, position: V(0, 0.3, 0) }));
  for (let i = 0; i < 100; i++) w.step(DT);
  assert.ok(a.sleeping);
  const b = w.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.3 }, mass: 2, position: V(-2, 0.3, 0) }));
  b.linearVelocity.set(6, 0, 0);
  for (let i = 0; i < 40; i++) w.step(DT);
  assert.ok(a.position.x > 0.2, `a was hit and moved to ${a.position.x}`);
});

test('raycast and sphereCast', () => {
  const w = new World(); floor(w);
  w.addCollider(new BoxCollider({ center: V(5, 1, 0), half: V(0.5, 1, 3) }));
  w.addCollider(new SphereCollider(V(0, 5, 0), 1));
  const body = w.addBody(new RigidBody({ shape: { type: 'capsule', radius: 0.3, length: 1 }, mass: 1, position: V(-4, 1, 0), gravityScale: 0 }));
  let h = w.raycast(V(0, 1, 0), V(1, 0, 0));
  near(h.t, 4.5, 1e-6, 'box'); near(h.normal.x, -1, 1e-6); assert.ok(h.collider instanceof BoxCollider);
  h = w.raycast(V(0, 10, 0), V(0, -1, 0));
  near(h.t, 4, 1e-6, 'sphere on top'); assert.ok(h.collider instanceof SphereCollider);
  h = w.raycast(V(0, 1, 0), V(-1, 0, 0));
  near(h.t, 3.7, 1e-6, 'body'); assert.equal(h.body, body);
  assert.equal(w.raycast(V(0, 1, 0), V(-1, 0, 0), 3), null, 'maxT');
  assert.equal(w.raycast(V(0, 1, 0), V(-1, 0, 0), Infinity, { bodies: false }), null, 'ignoring bodies there is nothing along -x');
  h = w.raycast(V(0, 3, 0), V(0, 1, 0), 100);
  assert.equal(h.collider.type, 'sphere'); near(h.t, 1, 1e-6, 'from below');
  h = w.raycast(V(0, 3, 0), V(0, 1, 0), 100, { mask: 0 });
  assert.equal(h, null, 'a zero mask hits nothing');
  const s = w.sphereCast(V(0, 1.5, 0), V(1, 0, 0), 0.4, 10);
  near(s.t, 5 - 0.5 - 0.4 - 0, 0.03, 'sphere cast stops 0.4 before the box face'); near(s.normal.x, -1, 0.05);
  assert.equal(w.sphereCast(V(0, 1.5, 0), V(0, 0, 1), 0.2, 5), null);
});

test('triggers report enter and exit for characters', () => {
  const w = new World(); floor(w);
  const ch = w.addCharacter(new Character(w, { position: V(-3, 0, 0) })); ch.snapToGround();
  const events = [];
  w.addTrigger(new BoxCollider({ center: V(0, 1, 0), half: V(1, 1, 1) }), { onEnter: () => events.push('in'), onExit: () => events.push('out') });
  for (let i = 0; i < 240; i++) { ch.update(DT, V(2, 0, 0)); w.step(DT); }
  assert.deepEqual(events, ['in', 'out']);
});

// ------------------------------------------------------------------------------------------------ character

function level() { const w = new World(); floor(w); return w; }
function hero(w, p = V(0, 0, 0), o = {}) { const c = w.addCharacter(new Character(w, { position: p, ...o })); c.snapToGround(); return c; }
function run(w, c, seconds, wish = V(0, 0, 0), each = null) { for (let i = 0; i < seconds / DT; i++) { each?.(i); c.update(DT, wish); w.step(DT); } }

test('character stands on the floor and walks at the requested speed', () => {
  const w = level(), c = hero(w, V(0, 0.4, 0));
  assert.ok(c.grounded);
  run(w, c, 1);
  near(c.position.y, 0, 0.005, 'resting height'); assert.ok(c.grounded);
  run(w, c, 3, V(2, 0, 0));
  near(c.position.x, 6, 0.15, 'distance in 3 s at 2 m/s'); near(c.velocity.x, 2, 0.05);
});

test('character slides along a wall instead of sticking to it', () => {
  const w = level(); w.addCollider(new BoxCollider({ center: V(3, 1, 0), half: V(0.5, 1, 50) }));
  const c = hero(w);
  run(w, c, 3, V(2, 0, 2));
  near(c.position.x, 2.5 - 0.3, 0.02, 'stopped at the wall');
  near(c.position.z, 6, 0.3, 'kept sliding along z at full speed');
});

test('character steps up small ledges and stairs but not tall ones', () => {
  const climb = (h) => {
    const w = level(); w.addCollider(new BoxCollider({ center: V(3, h / 2, 0), half: V(1, h / 2, 5) }));
    const c = hero(w); run(w, c, 2, V(2, 0, 0));
    return c.position;
  };
  assert.ok(climb(0.2).x > 2.5, 'climbs 0.2 m');
  assert.ok(climb(0.3).x > 2.5, 'climbs 0.3 m');
  near(climb(0.5).x, 2 - 0.3, 0.05, 'stops at 0.5 m');
  const w = level();
  for (let i = 0; i < 8; i++) w.addCollider(new BoxCollider({ center: V(2 + i * 0.3 + 0.15, (i + 1) * 0.18 / 2, 0), half: V(0.15, (i + 1) * 0.18 / 2, 3) }));
  w.addCollider(new BoxCollider({ center: V(6.5, 0.72, 0), half: V(2.5, 0.72, 3) }));                     // landing at the top (1.44 m)
  const c = hero(w);
  run(w, c, 3.5, V(2, 0, 0));
  near(c.position.y, 1.44, 0.03, 'on top of the stairs'); assert.ok(c.grounded);
});

test('character: walkable slopes are climbed at full speed, steep ones are not', () => {
  const ramp = (deg) => {
    const a = deg * Math.PI / 180, L = 10, x0 = 2, x1 = x0 + L * Math.cos(a), y1 = L * Math.sin(a), z = 5;
    return new MeshCollider([x0, 0, -z, x1, y1, -z, x1, y1, z, x0, 0, z], [0, 2, 1, 0, 3, 2]);
  };
  for (const deg of [20, 35]) {
    const w = level(); w.addCollider(ramp(deg));
    const c = hero(w); run(w, c, 2.5, V(2, 0, 0));
    near(c.position.x, 5, 0.2, `${deg} deg: horizontal speed kept`); assert.ok(c.grounded);
    near(c.slopeAngle, deg, 1.5, 'reported slope');
    assert.ok(c.position.y > (c.position.x - 2) * Math.tan(deg * Math.PI / 180) * 0.9, 'it is actually up the ramp');
  }
  const w = level(); w.addCollider(ramp(60));
  const c = hero(w); run(w, c, 3, V(2, 0, 0));
  assert.ok(c.position.y < 0.05, `60 deg ramp must not be climbed (y = ${c.position.y})`);
  assert.ok(c.position.x < 2);
});

test('character jumps to the expected height, lands, and bumps its head', () => {
  const w = level(), c = hero(w);
  let apex = 0, landed = 0, speed = 0;
  for (let i = 0; i < 120; i++) { if (i === 5) assert.ok(c.jump(4.43)); c.update(DT, V()); w.step(DT); apex = Math.max(apex, c.position.y); if (c.justLanded) { landed++; speed = c.landingSpeed; } }
  near(apex, 1.0, 0.07, 'apex'); assert.equal(landed, 1); near(speed, 4.4, 0.4, 'landing speed'); assert.ok(c.grounded);
  assert.ok(!c.jump(4) || c.grounded);
  const w2 = level(); w2.addCollider(new BoxCollider({ center: V(0, 3, 0), half: V(5, 0.5, 5) }));
  const c2 = hero(w2); let head = 0;
  for (let i = 0; i < 90; i++) { if (i === 3) c2.jump(6); c2.update(DT, V()); w2.step(DT); head = Math.max(head, c2.position.y + c2.height); }
  assert.ok(head <= 2.5 + 0.01, `head went to ${head}`);
});

test('character walks off a ledge, falls, and gets coyote time', () => {
  const w = new World(); w.addCollider(new BoxCollider({ center: V(0, -0.5, 0), half: V(2, 0.5, 5) })); w.addCollider(new PlaneCollider(V(0, 1, 0), -3));
  const c = hero(w);
  let left = -1, i = 0;
  for (; i < 200; i++) { c.update(DT, V(2, 0, 0)); w.step(DT); if (c.justLeftGround && left < 0) left = i; if (left >= 0 && i === left + 3) { assert.ok(c.jump(4), 'coyote jump just after leaving the ledge'); } }
  assert.ok(left > 0);
  assert.ok(c.position.y < 0.5);
  run(w, c, 3);
  near(c.position.y, -3, 0.02, 'landed on the lower floor'); assert.ok(c.grounded);
});

test('character pushes a loose body and is blocked by a heavy wall of bodies', () => {
  const w = level();
  const ball = w.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.3 }, mass: 5, position: V(1.5, 0.3, 0), friction: 0.4 }));
  const c = hero(w);
  run(w, c, 3, V(1.5, 0, 0));
  assert.ok(ball.position.x > 3, `ball pushed to ${ball.position.x}`);
  assert.ok(c.position.x < ball.position.x - 0.55, 'character stays behind the ball');
});

test('a dynamic body cannot pass through the character', () => {
  const w = level();
  const c = hero(w, V(0, 0, 0));
  const b = w.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.2 }, mass: 1, position: V(2, 0.2, 0) }));
  b.linearVelocity.set(-5, 0, 0);
  for (let i = 0; i < 120; i++) { c.update(DT, V()); w.step(DT); }
  assert.ok(b.position.x > 0.3, `ball at ${b.position.x}`);
});

test('crouching: standing up is refused under a low ceiling', () => {
  const w = level(); w.addCollider(new BoxCollider({ center: V(0, 1.6, 0), half: V(3, 0.5, 3) }));   // underside at 1.1 m
  const c = hero(w, V(0, 0, 0), { height: 1.75 });
  // start crouched
  assert.ok(c.setHeight(1.0));
  run(w, c, 0.5);
  assert.equal(c.setHeight(1.75), false, 'no room to stand');
  assert.equal(c.height, 1.0);
  assert.equal(c.setHeight(1.05), true);
});

// ------------------------------------------------------------------------------------------------ ragdoll

test('ragdoll: builds from a humanoid, collapses stably and respects its joints', () => {
  const w = new World({ iterations: 6 }); floor(w);
  const h = new Humanoid({ height: 1.75 });
  h.root.position.set(0, 0.3, 0); h.root.updateMatrixWorld(true);
  const rag = new Ragdoll(h, w);
  assert.equal(rag.parts.length, 16);
  near(rag.parts.reduce((t, p) => t + p.mass, 0), 77, 1e-6, 'total mass');
  rag.activate({});
  assert.equal(Object.keys(rag.bodies).length, 16); assert.equal(rag.joints.length, 15);
  for (let i = 0; i < 300; i++) {
    w.step(DT); rag.update();
    for (const b of Object.values(rag.bodies)) assert.ok(Number.isFinite(b.position.x + b.position.y + b.position.z), 'NaN');
  }
  let minY = Infinity;
  for (const [name, b] of Object.entries(rag.bodies)) { minY = Math.min(minY, b.position.y - b.shape.radius); assert.ok(b.position.y - b.shape.radius > -0.02, `${name} sank into the floor`); }
  for (const j of rag.joints) assert.ok(j.anchorError() < 0.01, `${j.bodyB.userData.part} anchor error ${j.anchorError()}`);
  for (const j of rag.joints) {
    const m = j.measure();
    if (j.useAngle !== undefined) assert.ok(m.angle >= j.min - 0.08 && m.angle <= j.max + 0.08, `${j.bodyB.userData.part} hinge ${m.angle}`);
    else if (j.useCone) assert.ok(m.swing <= j.coneAngle + 0.08, `${j.bodyB.userData.part} swing ${m.swing} > ${j.coneAngle}`);
  }
  assert.ok(rag.isSettled(0.3), 'should be at rest after 5 s');
  assert.ok(rag.bodies.pelvis.position.y < 0.3, 'lies on the floor');
  const lying = rag.lying();
  assert.ok(typeof lying.faceUp === 'boolean'); near(lying.direction.length(), 1, 1e-6);
  // the skeleton follows: the head bone is where the head body is
  const hp = h.bones.head.getWorldPosition(new Vector3());
  assert.ok(hp.distanceTo(rag.bodies.head.position) < 0.25, `head bone ${hp.distanceTo(rag.bodies.head.position)} m from its body`);
  // the snapshot is a clip with a track per bone
  const clip = rag.snapshotClip('pose');
  assert.equal(clip.tracks.filter((t) => t.kind === 'quaternion').length, h.boneList.length);
  assert.ok(clip.tracks.some((t) => t.kind === 'position' && t.bone === 'pelvis'));
  rag.deactivate();
  assert.equal(w.bodies.length, 0); assert.equal(w.joints.length, 0);
});

test('ragdoll: inherits the motion it had while animated, and an impulse knocks it over', () => {
  const w = new World(); floor(w);
  const h = new Humanoid({ height: 1.75 });
  h.root.position.set(0, 0, 0); h.root.updateMatrixWorld(true);
  const rag = new Ragdoll(h, w);
  for (let i = 0; i < 10; i++) { h.root.position.x += 3 * DT; h.root.updateMatrixWorld(true); rag.track(DT); }
  rag.activate({});
  near(rag.bodies.pelvis.linearVelocity.x, 3, 0.2, 'pelvis velocity');
  near(rag.bodies.head.linearVelocity.x, 3, 0.2, 'head velocity');
  rag.deactivate();
  // standing still, then hit in the chest from behind: falls forward
  const w2 = new World(); floor(w2);
  const h2 = new Humanoid({ height: 1.75 }); h2.root.updateMatrixWorld(true);
  const r2 = new Ragdoll(h2, w2);
  r2.activate({ impulse: { point: V(0, 1.3, -0.1), vector: V(0, 0, 220) } });
  for (let i = 0; i < 240; i++) { w2.step(DT); r2.update(); }
  assert.ok(r2.bodies.head.position.z > 0.6, `head ended at z = ${r2.bodies.head.position.z}`);
  assert.ok(r2.bodies.pelvis.position.y < 0.3);
});
