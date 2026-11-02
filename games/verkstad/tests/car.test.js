// The car model against the workshop's rules: what comes apart in what order, what the faults do,
// what the instruments read. node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Assembly, newCond } from '../src/car/assembly.js';
import { CARS } from '../src/data/cars.js';
import { CarSim } from '../src/sim/vehicle.js';
import { applyFault, stillPresent, forCar, FAULTS } from '../src/data/faults.js';
import { turn, TOOL_TORQUE, judge } from '../src/sim/fastener.js';

const seeded = (s = 7) => () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
const undo = (A, id, tool = 'breaker') => { for (const f of A.part(id).fasteners.map((x) => A.fast(x))) { let n = 0; while (!f.out && n++ < 200) turn(f, -1, 90, TOOL_TORQUE[tool]); } };
const doUp = (A, id, tool = 'torqueWrench') => { for (const f of A.part(id).fasteners.map((x) => A.fast(x))) { let n = 0; while (n++ < 400) { const r = turn(f, 1, 30, TOOL_TORQUE[tool], { clickAt: f.spec }); if (r.event === 'click') break; } } };

test('every car builds, with its parts and fasteners', () => {
  for (const id of Object.keys(CARS)) {
    const A = new Assembly(CARS[id], { rand: seeded() });
    assert.ok(A.parts.size > 25, `${id}: ${A.parts.size} parts`);
    assert.ok(A.fasteners.size > 10, `${id}: ${A.fasteners.size} fasteners`);
    for (const p of A.parts.values()) for (const b of p.blockers) assert.ok(A.parts.has(b), `${id}: ${p.id} blocked by unknown ${b}`);
  }
});

test('a wheel comes off only in the air and only with its nuts out; the pads only after what is in front of them', () => {
  for (const id of ['volvo240', 'golf7']) {
    const A = new Assembly(CARS[id], { rand: seeded(), mileage: 0 });
    assert.equal(A.canRemove('wheelFL'), false);
    undo(A, 'wheelFL');
    assert.equal(A.canRemove('wheelFL'), false, 'still on the ground');
    A.state.raised.FL = true;
    assert.ok(A.remove('wheelFL'));
    assert.equal(A.canRemove('padOFL'), false, 'the pad is behind its caliper (or pins)');
    if (id === 'golf7') { undo(A, 'caliperFL'); assert.ok(A.remove('caliperFL')); } else assert.ok(A.remove('pinsFL'));
    assert.ok(A.remove('padOFL') && A.remove('padIFL'));
    // the Golf's rear pads: the electric parking brake must be wound back first
    if (id === 'golf7') {
      A.state.raised.RL = true; undo(A, 'wheelRL'); A.remove('wheelRL'); undo(A, 'caliperRL');
      assert.match(A.obstacles('caliperRL').join(), /parking brake/);
      A.state.epbService = true;
      assert.ok(A.remove('caliperRL'));
    }
  }
});

test('fasteners: torque wrench clicks at spec, a rusty one needs the breaker bar, over-tightening stretches', () => {
  const A = new Assembly(CARS.volvo240, { rand: seeded(), mileage: 0 });
  const f = A.fast('wheelFL.n1');
  f.seize = 250;
  assert.equal(turn(f, -1, 30, TOOL_TORQUE.ratchet12).event, 'seized');
  assert.equal(turn(f, -1, 30, TOOL_TORQUE.breaker + 200).event, 'broke-loose');
  while (!f.out) turn(f, -1, 90, 50);
  let r; do r = turn(f, 1, 20, TOOL_TORQUE.torqueWrench, { clickAt: f.spec }); while (r.event !== 'click');
  assert.equal(judge(f), 'ok');
  assert.ok(Math.abs(f.clamp - f.spec) < 1);
  const g = A.fast('wheelFR.n1');
  for (let i = 0; i < 60; i++) turn(g, 1, 20, TOOL_TORQUE.impact, { impact: true });
  assert.ok(g.stretched || g.snapped, 'an impact gun to the end of its travel overloads a wheel stud');
});

test('every fault applies to the cars it is for and is cured by new parts or by putting things right', () => {
  for (const id of ['volvo240', 'golf7', 'f1_2026']) {
    for (const f of forCar(id)) {
      const A = new Assembly(CARS[id], { rand: seeded(3), mileage: 50000 });
      const rec = applyFault(A, f.id, null, seeded(5));
      assert.ok(rec, `${id} ${f.id}`);
      if (f.id === 'winter_tyres') { for (const k of ['FL', 'FR', 'RL', 'RR']) A.part('wheel' + k).cond.season = 'winter'; assert.equal(stillPresent(A, rec), false); continue; }
      assert.equal(stillPresent(A, rec), true, `${id} ${f.id} should be present`);
      // the cure: every part in the car as new, fluids topped up, fasteners at spec
      for (const p of A.parts.values()) p.cond = { ...p.cond, ...newCond(p, A.spec) };
      for (const fa of A.fasteners.values()) { fa.clamp = fa.spec; fa.engaged = fa.len; fa.out = false; }
      A.part('engine').cond.oil = A.spec.engine.oil.capacity; A.part('engine').cond.oilAge = 0;
      if (A.part('exptank')) A.part('exptank').cond.level = 0.9;
      if (A.part('reservoir')) A.part('reservoir').cond.water = 0.5;
      if (A.part('nose')) A.part('nose').cond.damage = 0;
      for (const fu of A.byKind('fuse')) fu.cond.short = false;
      assert.equal(stillPresent(A, rec), false, `${id} ${f.id} should be cured`);
    }
  }
});

test('the Golf starts, idles, and a dead coil gives P0352 and a misfire on cylinder 2', () => {
  const A = new Assembly(CARS.golf7, { rand: seeded(), mileage: 60000 });
  applyFault(A, 'coil_dead', 2);
  const S = new CarSim(A);
  A.state.ignition = 3;
  for (let t = 0; t < 2 && !S.E.running; t += 0.02) S.step(0.02);
  assert.ok(S.E.running, 'it starts on three cylinders');
  A.state.ignition = 2;
  for (let t = 0; t < 40; t += 0.05) S.step(0.05);
  const codes = S.scan().codes.map((c) => c.code);
  assert.ok(codes.includes('P0352'), codes.join());
  assert.ok(codes.includes('P0302'), codes.join());
  assert.ok(S.roadTest().some((o) => /shakes/.test(o.what)));
});

test('the Volvo has no OBD: a dead lead is found by pulling leads with the engine running', () => {
  const A = new Assembly(CARS.volvo240, { rand: seeded(), mileage: 300000 });
  applyFault(A, 'lead_dead', 3);
  const S = new CarSim(A);
  assert.match(S.scan().error, /No OBD-II/);
  A.state.ignition = 3;
  for (let t = 0; t < 2 && !S.E.running; t += 0.02) S.step(0.02);
  A.state.ignition = 2;
  for (let t = 0; t < 20; t += 0.05) S.step(0.05);
  const idle = () => { let s = 0; for (let i = 0; i < 60; i++) { S.step(0.05); s += S.E.rpm; } return s / 60; };
  // the idle controller makes up for a pulled lead given time, so read the drop straight away
  const drop = (c) => { const before = S.E.rpm; A.part('lead' + c).removed = true; let m = 1e9; for (let i = 0; i < 20; i++) { S.step(0.05); m = Math.min(m, S.E.rpm); } A.part('lead' + c).removed = false; idle(); return before - m; };
  const d1 = drop(1), d3 = drop(3);
  assert.ok(d1 > 60, `pulling a good lead drops the idle (${d1.toFixed(0)} rpm)`);
  assert.ok(d3 < d1 / 2, `pulling the dead one changes little (${d3.toFixed(0)} vs ${d1.toFixed(0)})`);
});

test('the oil drains through the plug hole, into the pan if one is under it', () => {
  const A = new Assembly(CARS.volvo240, { rand: seeded(), mileage: 0 });
  const S = new CarSim(A);
  S.drainPan = true;
  undo(A, 'drainplug');
  for (let t = 0; t < 600; t += 0.5) S.step(0.5);
  assert.ok(A.part('engine').cond.oil < 0.3, `left in the sump: ${A.part('engine').cond.oil.toFixed(2)} l`);
  assert.ok(S.oilCaught > 3.4 && S.oilSpilt === 0);
});

test('all faults are in the catalogue once', () => {
  const ids = FAULTS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});
