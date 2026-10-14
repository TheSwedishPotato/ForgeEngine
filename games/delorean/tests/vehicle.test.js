import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, MPH } from '../src/physics/vehicle.js';

function run(v, seconds, f) { const dt = 1 / 120; for (let t = 0; t < seconds; t += dt) { f?.(v, t); v.step(dt); } }

test('0-60 mph, 0-88 mph and top speed are the DMC-12\'s', () => {
  const v = new Vehicle();
  v.input.throttle = 1;
  let t60 = null, t88 = null, d88 = null, t = 0;
  const dt = 1 / 120;
  for (; t < 90; t += dt) {
    v.step(dt);
    const mph = v.speedoMph;
    if (t60 == null && mph >= 60) t60 = t;
    if (t88 == null && mph >= 88) { t88 = t; d88 = v.odometer; }
  }
  const top = v.speedoMph;
  console.log(`0-60 ${t60?.toFixed(1)} s, 0-88 ${t88?.toFixed(1)} s over ${d88?.toFixed(0)} m, after 90 s ${top.toFixed(1)} mph in ${v.gear}, ${v.rpm.toFixed(0)} rpm`);
  // period road tests: 8.8 to 10.5 s to 60; top speed 109-130 mph
  assert.ok(t60 > 8 && t60 < 11.5, `0-60 in ${t60}`);
  assert.ok(t88 < 25, `0-88 in ${t88}`);
  assert.ok(top > 105 && top < 130, `top ${top}`);
});

test('turns left for a left steer, and holds a steady circle', () => {
  const v = new Vehicle();
  v.reset({ speed: 15, gear: 3 });
  v.input.throttle = 0.3; v.input.steer = -0.5;
  const h0 = v.heading;
  run(v, 6);
  assert.ok(v.heading > h0 + 0.5, `heading ${v.heading}`);
  assert.ok(Math.abs(v.ay) < 9.81 * 1.1, `ay ${v.ay}`);
  assert.ok(v.speed > 5);
});

test('brakes from 60 mph in a DMC-12-like distance', () => {
  const v = new Vehicle();
  v.reset({ speed: 60 / MPH, gear: 4 });
  v.input.brake = 1;
  let t = 0; const dt = 1 / 240;
  while (v.speed > 0.3 && t < 10) { v.step(dt); t += dt; }
  console.log(`60-0 in ${v.odometer.toFixed(1)} m, ${t.toFixed(1)} s`);
  assert.ok(v.odometer > 32 && v.odometer < 55, `stopping distance ${v.odometer}`);
});
