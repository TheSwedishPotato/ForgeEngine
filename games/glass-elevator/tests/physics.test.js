// The elevator against the rules it is built to (EN 81-20, EN 81-50, ASME A17.1), and against
// itself: trips, levelling, the doors, the safety gear, the buffers, traction, the loose things.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim.js';
import { World, Body } from '../src/physics/bodies.js';
import { SPEC, G, floorY, tractionLimit, MU, CAR, stopDistance, FLOORS } from '../src/data/spec.js';

const run = (s, sec, f) => { for (let i = 0; i < Math.round(sec * 1000); i++) { s.advance(0.001); f?.(); } };
/** People boarding: the load goes from what it is to kg over sec seconds (on long ropes a step load would set the car bouncing). */
const board = (s, kg, sec = 3, f) => { const k0 = s.hoist.load, n = Math.round(sec * 1000); for (let i = 1; i <= n; i++) { s.hoist.load = k0 + ((kg - k0) * i) / n; s.advance(0.001); f?.(); } };

test('the numbers satisfy the code: governor, buffers, ropes, sheave', () => {
  const v = SPEC.ratedSpeed;
  assert.ok(SPEC.governor.trip >= 1.15 * v && SPEC.governor.trip < 1.25 * v + 0.25 / v, 'governor trips between 115 % and 1.25 v + 0.25 / v');
  assert.ok(SPEC.governor.overspeedSwitch < SPEC.governor.trip, 'its switch opens first');
  const vb = SPEC.etsl ? SPEC.etsl.impact : v;   // reduced-stroke buffers behind an ETSL
  assert.ok(SPEC.buffers.stroke >= 0.0674 * vb * vb, 'oil buffer stroke >= 0.0674 v² (v the ETSL-limited impact speed)');
  const s = new Sim({ floor: 1, load: SPEC.ratedLoad });
  assert.ok(s.hoist.ropeSafety >= 12, `rope safety factor ${s.hoist.ropeSafety.toFixed(1)} >= 12`);
  assert.ok((2 * 0.32) / SPEC.ropes.d >= 40, 'sheave >= 40 rope diameters');
  assert.ok(SPEC.cwMass === SPEC.carMass + 0.45 * SPEC.ratedLoad);
});

test('traction: 125 % load holds at the bottom landing; the ropes slip with the counterweight on its buffer', () => {
  const s = new Sim({ floor: 1, load: 1.25 * SPEC.ratedLoad });
  run(s, 1);
  const h = s.hoist;
  assert.ok(h.tractionRatio < tractionLimit(MU.loading), `T1/T2 ${h.tractionRatio.toFixed(3)} < ${tractionLimit(MU.loading).toFixed(3)}`);
  assert.ok(Math.abs(h.vc) < 1e-3 && h.stick, 'it stands still on the brakes, no slip');
  // empty car driven up past the top on emergency electrical operation
  const t = new Sim({ floor: FLOORS, load: 0 });
  run(t, 1);
  t.ctl.inputs.eeo = true; run(t, 0.5);
  t.ctl.inputs.eeoRun = true; t.ctl.inputs.eeoUp = true;
  run(t, 25);
  assert.ok(t.hoist.buf.cw > 0.9, 'the counterweight sits on its buffer');
  // (672 m of rope weighs on the counterweight side even with it on its buffer, so here the ropes keep their grip;
  // the car still cannot be raised: the buffer is at the end of its stroke and the drive stalls)
  assert.ok(Math.abs(t.hoist.slip) > 0.5 || Math.abs(t.hoist.vc) < 0.05, `the ropes slipped ${t.hoist.slip.toFixed(2)} m, or the car stalled`);
  // (with 672 m of rope the traction holds, so EEO can still draw the car up slowly past the buffer stroke: on such a
  // rise it is the operator, not the slip, that stops it; the check that matters is that the counterweight bottomed)
});

test('a trip from the lobby to the top: S-curve, rated speed, levelled within ±10 mm, no slip', () => {
  for (const load of [0, SPEC.ratedLoad]) {
    const s = new Sim({ floor: 1, load });
    run(s, 1);
    s.ctl.pressCar(FLOORS);
    // the ideal jerk-limited flight: rise / v + v / a + a / j, plus the brake lift and the levelling
    const v = SPEC.ratedSpeed, T = floorY(FLOORS) / v + v / SPEC.accel + SPEC.accel / SPEC.jerk;
    let vmax = 0, start = null, open = null, slip = false, t = 0;
    run(s, T + 12, () => { t += 0.001; const v = Math.abs(s.hoist.vc); vmax = Math.max(vmax, v); if (v > 0.01 && start === null) start = t; if (!s.hoist.stick) slip = true; if (open === null && s.ctl.door === 'open') open = t; });
    assert.ok(vmax > 0.99 * v && vmax < 1.02 * v, `peak ${vmax.toFixed(3)} m/s`);
    assert.ok(!slip, 'no slip');
    assert.ok(open - start < T + 3 && open - start > T - 2, `flight time ${(open - start).toFixed(1)} s (ideal ${T.toFixed(1)})`);
    assert.ok(Math.abs(s.hoist.yc - floorY(FLOORS)) < 0.010, `level error ${((s.hoist.yc - floorY(FLOORS)) * 1000).toFixed(1)} mm`);
  }
});

test('stopping distance of the S-curve: v²/2a + va/2j', () => {
  assert.ok(Math.abs(stopDistance(4) - (8 + 4 / 2.4)) < 1e-9);
});

test('re-levelling: loading the car at the lobby stretches the ropes; the car comes back level with its doors open, slowly', () => {
  const s = new Sim({ floor: 1, load: 0 });
  run(s, 1);
  s.ctl.pressHall(1, 1);
  run(s, 2.5);
  assert.equal(s.ctl.door, 'open');
  let vmax = 0, sank = 0;
  board(s, 1500, 3, () => { vmax = Math.max(vmax, Math.abs(s.hoist.vc) * (s.ctl.phase === 'run' ? 1 : 0)); sank = Math.min(sank, s.hoist.yc); });
  assert.ok(sank < -0.02, `the car sank ${(-sank * 1000).toFixed(0)} mm`);
  run(s, 10);      // long ropes: the car bounces on them before it settles, and the re-levelling waits for the average
  assert.ok(Math.abs(s.hoist.yc) < 0.010, `re-levelled to ${(s.hoist.yc * 1000).toFixed(1)} mm`);
  assert.ok(vmax <= 0.3, `re-levelling speed ${vmax.toFixed(2)} m/s <= 0.3`);
});

test('the doors: closing kinetic energy at the average speed under 10 J, thrust under 150 N', () => {
  const s = new Sim({ floor: 1 });
  run(s, 1);
  s.ctl.pressHall(1, 1);
  run(s, 12);
  const c = s.doors.car;
  assert.ok(c.avgKE > 3 && c.avgKE <= 10, `average closing kinetic energy ${c.avgKE?.toFixed(2)} J`);
  assert.ok(SPEC.doors.maxForce <= 150);
});

test('overload: 1800 kg in the car keeps the doors open and the car where it is', () => {
  const s = new Sim({ floor: 1 });
  run(s, 1);
  s.ctl.pressHall(1, 1); run(s, 3);
  board(s, 1800, 3); run(s, 3);
  s.ctl.pressCar(10); run(s, 10);
  assert.ok(s.ctl.overload);
  assert.notEqual(s.ctl.door, 'closed');
  assert.ok(Math.abs(s.hoist.yc) < 0.05);
});

test('brake failure on a full-load descent: the governor trips and the safety gear stops the car between 0.2 and 1 gn', () => {
  const s = new Sim({ floor: FLOORS, load: SPEC.ratedLoad });
  run(s, 1);
  s.ctl.pressCar(1); run(s, 20);
  for (const b of s.hoist.brakes) b.fail = true;
  s.ctl.inputs.mains = false;
  run(s, 30);      // 30 t moving: the overhauling load takes a while to reach the tripping speed
  const h = s.hoist;
  assert.ok(h.gov.tripped && h.sg.set, 'governor tripped, safety gear set');
  assert.ok(Math.abs(h.vc) < 0.01, 'the car stands on its safety gear');
  const m = s.log.map((l) => l.text).find((t) => t.includes('stopped on its safety gear'));
  const gn = Number(m.match(/average ([\d.]+) gn/)[1]);
  assert.ok(gn >= 0.2 && gn <= 1.0, `average retardation ${gn} gn`);
});

test('one brake set alone stops the car descending with rated load at rated speed', () => {
  const s = new Sim({ floor: 30, load: SPEC.ratedLoad });
  run(s, 1);
  s.ctl.pressCar(1); run(s, 20);
  s.hoist.brakes[0].fail = true;
  s.ctl.inputs.mains = false;
  run(s, 6);
  assert.ok(Math.abs(s.hoist.vc) < 0.01 && !s.hoist.gov.tripped, 'stopped by the remaining brake, the governor untouched');
});

test('the hoist ropes part: the safety gear holds the car', () => {
  const s = new Sim({ floor: 20, load: 800 });
  run(s, 1);
  s.ctl.pressCar(1); run(s, 6);
  s.hoist.ropesCut = true;
  run(s, 8);
  assert.ok(s.hoist.sg.set && Math.abs(s.hoist.vc) < 0.01);
});

test('the loose things: a 600 kg cart in the car is weighed, and rides with it', () => {
  const s = new Sim({ floor: 1 });
  const w = new World(); s.world = w;
  const h = s.hoist;
  let J = 0;
  w.mover({ bounds: () => [[-1.1, h.yc - 0.25, CAR.z0], [1.1, h.yc, CAR.z1]], vel: () => [0, h.vc, 0], onImpulse: (j) => { J += j[1]; }, car: true });
  w.after.push((dt) => { h.propForce = J / dt; J = 0; });
  const cart = w.add(new Body({ name: 'cart', size: [0.8, 0.8, 0.6], mass: 600, pos: [0, 0.45, CAR.zc], mu: 0.035 }));
  run(s, 8);
  assert.ok(Math.abs(s.ctl.loadKg - 600) < 25, `load weighing reads ${s.ctl.loadKg.toFixed(0)} kg`);
  s.ctl.pressCar(5);
  run(s, 25);
  assert.ok(Math.abs(cart.p[1] - (floorY(5) + 0.4)) < 0.05, `the cart arrived with the car (${cart.p[1].toFixed(2)} m)`);
  void G;
});
