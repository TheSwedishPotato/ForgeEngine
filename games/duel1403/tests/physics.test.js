import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion } from 'three';
import { World, Body, Joint, Shape } from '../src/physics/index.js';

const DT = 1 / 60;

function sphereInertia(m, r) {
  const i = 0.4 * m * r * r;
  return new Vector3(i, i, i);
}

function ground(world, opts = {}) {
  const g = new Body({ name: 'ground' });
  g.addShape(Shape.plane(new Vector3(0, 1, 0), 0, { friction: 0.8, ...opts }));
  world.addBody(g);
  return g;
}

test('free fall matches y = y0 - g t^2 / 2', () => {
  const world = new World({ substeps: 20 });
  const b = world.addBody(new Body({ mass: 2, inertia: sphereInertia(2, 0.1), position: new Vector3(0, 10, 0) }));
  for (let i = 0; i < 60; i++) world.step(DT);
  const expected = 10 - 0.5 * 9.81 * 1 * 1;
  // Symplectic Euler is first order: the error is g * h * t / 2 (4 mm here).
  const h = DT / 20;
  assert.ok(Math.abs(b.pos.y - expected) <= 9.81 * h * 1 / 2 + 1e-6, `y=${b.pos.y} expected ${expected}`);
  assert.ok(Math.abs(b.vel.y + 9.81) < 1e-3, `vy=${b.vel.y}`);
});

test('pendulum period matches the physical-pendulum formula', () => {
  const world = new World({ substeps: 40 });
  const anchor = world.addBody(new Body({ position: new Vector3(0, 2, 0) }));
  const L = 1.0, m = 1, r = 0.05;
  const I = sphereInertia(m, r);
  const bob = world.addBody(new Body({ mass: m, inertia: I, position: new Vector3(0, 2 - L, 0) }));
  const j = world.addJoint(new Joint(anchor, bob, { anchor: new Vector3(0, 2, 0) }));
  j.hasLimits = false;
  // Small initial angle: 5 degrees about Z.
  const theta0 = (5 * Math.PI) / 180;
  bob.pos.set(Math.sin(theta0) * L, 2 - Math.cos(theta0) * L, 0);
  bob.q.setFromAxisAngle(new Vector3(0, 0, 1), theta0);
  // Measure time between successive crossings of x = 0 going positive.
  let prevX = bob.pos.x, t = 0;
  const crossings = [];
  for (let i = 0; i < 60 * 12; i++) {
    world.step(DT);
    t += DT;
    const x = bob.pos.x;
    if (prevX < 0 && x >= 0) crossings.push(t - DT * (x / (x - prevX)));
    prevX = x;
  }
  const periods = crossings.slice(1).map((c, i) => c - crossings[i]);
  const T = periods.reduce((a, b) => a + b, 0) / periods.length;
  const Ipivot = I.x + m * L * L;
  const expected = 2 * Math.PI * Math.sqrt(Ipivot / (m * 9.81 * L)) * (1 + theta0 * theta0 / 16);
  assert.ok(Math.abs(T - expected) / expected < 0.01, `T=${T.toFixed(4)} expected ${expected.toFixed(4)}`);
});

test('elastic head-on collision of equal spheres exchanges velocity', () => {
  const world = new World({ substeps: 20, gravity: new Vector3() });
  const a = world.addBody(new Body({ mass: 1, inertia: sphereInertia(1, 0.1), position: new Vector3(-0.5, 0, 0) }));
  const b = world.addBody(new Body({ mass: 1, inertia: sphereInertia(1, 0.1), position: new Vector3(0.5, 0, 0) }));
  a.addShape(Shape.sphere(0.1, new Vector3(), { restitution: 1, friction: 0 }));
  b.addShape(Shape.sphere(0.1, new Vector3(), { restitution: 1, friction: 0 }));
  world.shapes.push(...a.shapes, ...b.shapes);
  a.vel.set(2, 0, 0);
  for (let i = 0; i < 60; i++) world.step(DT);
  const p = a.vel.x * a.mass + b.vel.x * b.mass;
  assert.ok(Math.abs(p - 2) < 1e-6, `momentum ${p}`);
  assert.ok(Math.abs(a.vel.x) < 0.05, `a.vx=${a.vel.x}`);
  assert.ok(Math.abs(b.vel.x - 2) < 0.05, `b.vx=${b.vel.x}`);
});

test('soft (padded) contact lasts ~ pi * sqrt(m_eff / k) and conserves momentum', () => {
  const world = new World({ substeps: 40, gravity: new Vector3() });
  const k = 1e5; // N/m, glove padding
  const m = 2;
  const a = world.addBody(new Body({ mass: m, inertia: sphereInertia(m, 0.06), position: new Vector3(-0.3, 0, 0) }));
  const b = world.addBody(new Body({ mass: 5, inertia: sphereInertia(5, 0.1), position: new Vector3(0.3, 0, 0) }));
  a.addShape(Shape.sphere(0.06, new Vector3(), { compliance: 1 / k, friction: 0 }));
  b.addShape(Shape.sphere(0.1, new Vector3(), { friction: 0 }));
  world.shapes.push(...a.shapes, ...b.shapes);
  a.vel.set(8, 0, 0);
  let contactFrames = 0, J = 0, peak = 0;
  // Step with a fine frame so we can time the contact.
  const fine = 1 / 1000;
  for (let i = 0; i < 200; i++) {
    world.step(fine);
    const imp = world.impacts.find((x) => x.bodyA !== x.bodyB);
    if (imp) { contactFrames++; J += imp.impulse; peak = Math.max(peak, imp.peakForce); }
  }
  const mEff = (m * 5) / (m + 5);
  const expected = Math.PI * Math.sqrt(mEff / k);
  const measured = contactFrames * fine;
  assert.ok(Math.abs(measured - expected) / expected < 0.15, `contact ${measured * 1000}ms expected ${(expected * 1000).toFixed(1)}ms`);
  const p = a.vel.x * m + b.vel.x * 5;
  assert.ok(Math.abs(p - 16) < 1e-6, `momentum ${p}`);
  // Impulse on b equals its momentum change.
  assert.ok(Math.abs(J - b.vel.x * 5) / (b.vel.x * 5) < 0.05, `J=${J} dp=${b.vel.x * 5}`);
  assert.ok(peak > 1000, `peak force ${peak}`);
});

test('hinge limit holds against gravity', () => {
  const world = new World({ substeps: 20 });
  const base = world.addBody(new Body({ position: new Vector3(0, 1, 0) }));
  const arm = world.addBody(new Body({ mass: 1, inertia: new Vector3(0.02, 0.002, 0.02), position: new Vector3(0, 1, 0.25) }));
  // Hinge about X: arm sticks out along +Z and may rotate at most 30 deg down.
  const j = world.addJoint(new Joint(base, arm, {
    anchor: new Vector3(0, 1, 0),
    twistAxis: new Vector3(1, 0, 0),
    swingAxis1: new Vector3(0, 1, 0),
    twist: [0, (30 * Math.PI) / 180],
    swing1: [0, 0],
    swing2: [0, 0],
  }));
  for (let i = 0; i < 120; i++) world.step(DT);
  const rel = j.getRelative(new Quaternion());
  const angle = 2 * Math.acos(Math.min(1, Math.abs(rel.w)));
  assert.ok(Math.abs(angle - Math.PI / 6) < 0.02, `angle=${(angle * 180 / Math.PI).toFixed(2)}deg`);
  // Swing locked: the arm stays in the Y-Z plane.
  assert.ok(Math.abs(arm.pos.x) < 1e-3, `x drift ${arm.pos.x}`);
});

test('muscle drive holds a load with the static error tau / k', () => {
  const world = new World({ substeps: 20 });
  const base = world.addBody(new Body({ position: new Vector3(0, 1, 0) }));
  const m = 2, L = 0.3;
  const arm = world.addBody(new Body({ mass: m, inertia: new Vector3(0.015, 0.001, 0.015), position: new Vector3(0, 1, L) }));
  const j = world.addJoint(new Joint(base, arm, { anchor: new Vector3(0, 1, 0) }));
  j.hasLimits = false;
  const k = 400;
  j.setDrive(k, 20, 1000);
  for (let i = 0; i < 180; i++) world.step(DT);
  const tau = m * 9.81 * L;
  const rel = j.getRelative(new Quaternion());
  const err = 2 * Math.asin(Math.min(1, Math.hypot(rel.x, rel.y, rel.z)));
  // Small-angle: err ~ tau / k (the lever shortens slightly as it droops).
  assert.ok(Math.abs(err - tau / k) / (tau / k) < 0.05, `err=${err} expected ${tau / k}`);
  // Torque saturation: a weak muscle cannot hold it up.
  j.setDrive(k, 20, 2);
  for (let i = 0; i < 180; i++) world.step(DT);
  assert.ok(arm.pos.y < 0.8, `arm should droop under a 2 Nm muscle, y=${arm.pos.y}`);
});

test('friction: box sticks on a slope below atan(mu) and slides above it', () => {
  for (const [deg, shouldSlide] of [[20, false], [40, true]]) {
    const world = new World({ substeps: 20 });
    const a = (deg * Math.PI) / 180;
    const n = new Vector3(-Math.sin(a), Math.cos(a), 0);
    const g = new Body();
    g.addShape(Shape.plane(n, 0, { friction: 0.6 }));
    world.addBody(g);
    const box = new Body({ mass: 1, inertia: new Vector3(0.01, 0.01, 0.01), position: n.clone().multiplyScalar(0.05) });
    box.q.setFromUnitVectors(new Vector3(0, 1, 0), n);
    box.addShape(Shape.box(new Vector3(0.1, 0.05, 0.1), new Vector3(), { friction: 0.6, restitution: 0 }));
    world.addBody(box);
    const start = box.pos.clone();
    for (let i = 0; i < 120; i++) world.step(DT);
    const moved = box.pos.distanceTo(start);
    if (shouldSlide) assert.ok(moved > 0.5, `${deg}deg should slide, moved ${moved}`);
    else assert.ok(moved < 0.01, `${deg}deg should stick, moved ${moved}`);
  }
});

test('resting sphere on the ground does not jitter or sink', () => {
  const world = new World({ substeps: 20 });
  ground(world);
  const b = new Body({ mass: 5, inertia: sphereInertia(5, 0.1), position: new Vector3(0, 0.5, 0) });
  b.addShape(Shape.sphere(0.1, new Vector3(), { restitution: 0.3 }));
  world.addBody(b);
  for (let i = 0; i < 300; i++) world.step(DT);
  assert.ok(Math.abs(b.pos.y - 0.1) < 1e-3, `y=${b.pos.y}`);
  assert.ok(b.vel.length() < 1e-3, `v=${b.vel.length()}`);
});
