// The vehicles stand on the rails: in every canted curve each wheel's tread meets its rail head
// (track.js lays the rails, trainGL.js poses the bodies on them).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Object3D, Vector3 } from 'three';
import { Route } from '../src/world/route.js';
import { poseOnTrack } from '../src/render/trainGL.js';

const route = await Route.load();

test('in the curves the cars lean with the cant: every wheel on its rail', () => {
  const L = route.run, RP = 1.507, pose = {}, o = new Object3D();
  let worst = 0, n = 0;
  for (let s = 2000; s < 28000; s += 37) {
    if (Math.abs(L.cantAt(s)) < 0.03) continue;
    poseOnTrack(L, s + 9, s - 9, pose);
    o.position.set(pose.x, pose.z, -pose.y);
    o.rotation.copy(new Euler(pose.roll, pose.yaw, pose.pitch, 'YZX'));
    o.updateMatrixWorld();
    for (const x of [9, -9]) for (const side of [-1, 1]) {
      const w = new Vector3(x, 0, side * 0.75).applyMatrix4(o.matrixWorld);
      const q = s + x, k = L.curvatureAt(q), p = L.pos(q);
      const rail = p.z + side * 0.75 * Math.sin(-Math.atan2(L.cantAt(q), RP));
      // the outer rail is the higher (left in a right-hand curve)
      if (Math.abs(k) > 1e-3) assert.ok(Math.sign(rail - p.z) === -Math.sign(k) * side, `at ${q.toFixed(0)} the inner rail is the higher`);
      worst = Math.max(worst, Math.abs(w.y - rail));
    }
    n++;
  }
  assert.ok(n > 50, `canted curves sampled (${n})`);
  assert.ok(worst < 0.012, `a wheel ${(worst * 1000).toFixed(0)} mm off its rail`);
});

// ---- derailment: nothing but the physics holds a vehicle on the rails
import { Sim, hms } from '../src/sim.js';

/** The special put down at chainage sFront running at kmh, nobody driving. */
function placed(sFront, kmh) {
  const sim = new Sim(route, { weather: 'clear', startClock: hms('10:12') });
  sim.crew.setManual(true);
  const T = sim.train, d = sFront - T.front;
  for (const v of T.veh) { v.s += d; v.v = kmh / 3.6; }
  T.brake.handle = 'running';
  return sim;
}

test('the sharpest curve (252 m, 141 mm cant) holds the train at 100 km/h and throws it over at 140', () => {
  const ok = placed(10650, 100);
  for (let i = 0; i < 80; i++) ok.advance(0.1);
  assert.ok(!ok.train.derail.any, `derailed at 100 km/h: ${ok.train.derail.cause?.why}`);
  const fast = placed(10650, 140);
  for (let i = 0; i < 80; i++) fast.advance(0.1);
  assert.match(fast.train.derail.cause?.why ?? '', /overturned/);
  for (let i = 0; i < 300; i++) fast.advance(0.1);
  const W = fast.train.veh[0].wreck, q = route.run.locate(W.x, W.y, fast.train.veh[0].s, 200);
  assert.ok(q.d > 3 && Math.abs(fast.train.veh[0].v) < 0.1, `the engine lies ${q.d.toFixed(1)} m off the track, at rest`);
  assert.equal(fast.train.brake.handle, 'emergency');
});

test('running into a standing train: the collision throws the engine off the rails', () => {
  const sim = new Sim(route, { weather: 'clear', startClock: hms('10:12') });
  while (!sim.traffic.runs.some((r) => r.onMap && !r.done && r.occupies().some(([t]) => t === 'L'))) sim.advance(5);
  const r = sim.traffic.runs.find((x) => x.onMap && !x.done && x.occupies().some(([t]) => t === 'L'));
  r.v = 0; r.dwellUntil = sim.clock + 5000;
  const [, a, b] = r.occupies().find(([t]) => t === 'L');
  sim.crew.setManual(true);
  const T = sim.train, d = Math.min(a, b) - 60 - T.front;
  for (const v of T.veh) { v.s += d; v.v = 60 / 3.6; }
  T.brake.handle = 'running';
  for (let i = 0; i < 150; i++) sim.advance(0.1);
  assert.ok(r.crashed, 'they met');
  assert.ok(T.veh[0].wreck, 'the engine is off the rails');
});
