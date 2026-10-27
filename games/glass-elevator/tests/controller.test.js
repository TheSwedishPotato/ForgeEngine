// The controller's logic: collective dispatching, the hall lantern, fire service, inspection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim.js';
import { floorY } from '../src/data/spec.js';

const run = (s, sec) => { for (let i = 0; i < Math.round(sec * 1000); i++) s.advance(0.001); };
const stops = (s, sec) => { const out = []; let was = null; for (let i = 0; i < sec * 1000; i++) { s.advance(0.001); if (s.ctl.door === 'opening' && was !== 'opening') out.push(s.ctl.floor); was = s.ctl.door; } return out; };

test('selective collective: up calls on the way up, the down call at the top, then down', () => {
  const s = new Sim({ floor: 1 });
  run(s, 1);
  s.ctl.pressCar(20);
  run(s, 2);
  s.ctl.pressHall(8, 1);      // on the way, same direction: answered
  s.ctl.pressHall(12, -1);    // on the way, opposite direction: passed, answered coming down
  s.ctl.pressHall(25, -1);    // beyond the car call: the reversal
  const order = stops(s, 150);
  assert.deepEqual(order.slice(0, 4), [8, 20, 25, 12]);
});

test('firefighters\' Phase I: the car goes back to the lobby nonstop and stands there with its doors open', () => {
  const s = new Sim({ floor: 1 });
  run(s, 1);
  s.ctl.pressCar(18); run(s, 8);
  s.ctl.inputs.fire1 = 'on';
  run(s, 40);
  assert.ok(Math.abs(s.hoist.yc - floorY(1)) < 0.01, 'at the lobby');
  assert.equal(s.ctl.mode, 'fire1');
  assert.ok(s.doors.car.x > 0.99, 'doors open');
  s.ctl.pressCar(10); run(s, 5);
  assert.ok(Math.abs(s.hoist.yc) < 0.01, 'car calls ignored on Phase I');
});

test('inspection from the car roof: hold-to-run at 0.3 m/s, the brakes drop as soon as you let go', () => {
  const s = new Sim({ floor: 10 });
  run(s, 1);
  Object.assign(s.ctl.inputs, { insp: true });
  run(s, 0.5);
  Object.assign(s.ctl.inputs, { inspCommon: true, inspUp: true });
  let vmax = 0;
  for (let i = 0; i < 5000; i++) { s.advance(0.001); vmax = Math.max(vmax, Math.abs(s.hoist.vc)); }
  assert.ok(vmax <= 0.63 && vmax > 0.25, `inspection speed ${vmax.toFixed(2)} m/s`);
  Object.assign(s.ctl.inputs, { inspUp: false });
  run(s, 1.5);
  assert.ok(Math.abs(s.hoist.vc) < 0.01);
  assert.ok(s.hoist.brakes.every((b) => b.lift === 0));
});

test('mains failure: the automatic rescue device brings the car to a floor and opens the doors', () => {
  const s = new Sim({ floor: 1 });
  run(s, 1);
  s.ctl.pressCar(14); run(s, 9);
  s.ctl.inputs.mains = false;
  run(s, 60);
  const n = s.ctl._atFloor();
  assert.ok(n > 0 && Math.abs(s.hoist.yc - floorY(n)) < 0.02, `at floor ${n}`);
  assert.ok(s.doors.car.x > 0.99, 'doors open on the battery');
});
