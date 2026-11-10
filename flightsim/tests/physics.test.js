/**
 * The aeroplane against its handbook. Nothing in the simulation is told these numbers: they come out of the airflow, the
 * propeller's blade elements and the engine's cycle, and the tests check they land where the Cessna 172P's Pilot's Operating
 * Handbook says the real aeroplane does (within a few per cent). Run with `npm test`; no graphics are involved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { make, run, loadUp, pilot } from './helpers.js';
import { KT, FT, DEG, LB, RPM, clamp } from '../src/sim/util.js';
import { buildNav } from './nav.js';

const between = (v, lo, hi, what) => assert.ok(v >= lo && v <= hi, `${what}: ${v.toFixed(2)} is not within ${lo} .. ${hi}`);

test('weight and balance are inside the envelope', () => {
  const ac = make('cold');
  between(ac.mass / LB, 1600, 2400, 'weight solo, lb');
  between(ac.cgPercentMac, 15, 36.5, 'centre of gravity solo, % MAC');
  loadUp(ac); ac.massProps();
  between(ac.mass / LB, 2300, 2400, 'weight loaded, lb');
  between(ac.cgPercentMac, 15, 36.5, 'centre of gravity loaded, % MAC');
});

test('engine: 160 hp at 2700 rpm, full throttle, sea level', () => {
  const ac = make('ready'); ac.eng.throttle = 1; ac.eng.cht = 180; ac.eng.oilT = 85; ac.eng.magL = ac.eng.magR = true;
  const air = ac.weather.air(0);
  for (let i = 0; i < 400; i++) { ac.eng.omega = 2700 * RPM; ac.eng.step(1 / 240, air, 0, 45); }
  between(ac.eng.torque * 2700 * RPM / 745.7, 155, 165, 'brake horsepower');
  between(ac.eng.mapInHg, 27.5, 29.92, 'manifold pressure, in Hg');
  between(ac.eng.gph, 11.5, 15, 'fuel flow full rich, US gal/h');
});

test('static run-up: 2300 to 2420 rpm at full throttle, and it idles', () => {
  const ac = make('ready'); ac.eng.cht = 150; ac.eng.oilT = 80; ac.eng.throttle = 0;
  run(ac, 20);
  between(ac.eng.rpm, 550, 800, 'warm idle rpm');
  between(ac.eng.oilP, 25, 60, 'oil pressure at idle, psi');
  ac.eng.throttle = 1; run(ac, 15);
  between(ac.eng.rpm, 2300, 2420, 'static rpm');
  assert.ok(Math.abs(ac.pos.z) < 2, 'the parking brake holds it');
});

test('top speed at sea level is about 123 knots at about 2700 rpm', () => {
  const ac = make('cruise', { alt: 300 }); loadUp(ac); ac.eng.throttle = 1;
  run(ac, 150, pilot({ alt: 300 / FT }));
  between(ac.tas / KT, 117, 128, 'KTAS');
  between(ac.eng.rpm, 2600, 2760, 'rpm');
});

test('cruise at 2500 rpm is about 75 % power and 110 to 118 knots', () => {
  const ac = make('cruise', { alt: 900 }); ac.eng.throttle = 0.62;
  run(ac, 120, pilot({ alt: 900 / FT }));
  between(ac.eng.rpm, 2450, 2650, 'rpm'); between(ac.eng.hp, 105, 130, 'horsepower'); between(ac.tas / KT, 108, 120, 'KTAS');
});

test('best rate of climb at 76 KIAS and full weight is about 700 ft/min', () => {
  const ac = make('cruise', { alt: 100 }); loadUp(ac); ac.eng.throttle = 1;
  const p = pilot({ kias: 76 }); run(ac, 40, p);
  const h0 = ac.altitude, t0 = ac.time; run(ac, 40, p);
  between((ac.altitude - h0) / FT / (ac.time - t0) * 60, 600, 790, 'ft/min');
  assert.ok(ac.ctl.yaw > 0.02, `climbing at full power needs right rudder (got ${ac.ctl.yaw.toFixed(3)})`);
});

test('glide with the engine dead: between 9 and 11 to 1 at 65 KIAS', () => {
  const ac = make('cruise', { alt: 1200 }); loadUp(ac); ac.eng.throttle = 0; ac.eng.mixture = 0;
  const p = pilot({ kias: 65 }); run(ac, 40, p);
  const h0 = ac.altitude, z0 = ac.pos.z; run(ac, 40, p);
  between((z0 - ac.pos.z) / (h0 - ac.altitude), 8.5, 11, 'glide ratio');
  assert.ok(ac.eng.rpm > 300, 'the propeller windmills');
});

for (const [flaps, lo, hi] of [[0, 48, 54], [3, 44, 50]]) {
  test(`stall, power off, flaps ${flaps * 10}: ${lo} to ${hi} KCAS, with the horn first`, () => {
    const ac = make('cruise', { alt: 1200 }); loadUp(ac); ac.eng.throttle = 0; ac.ctl.flapLever = flaps;
    const p = pilot({ kias: (t) => Math.max(20, 75 - Math.max(0, t - 25) * 0.7) });
    let min = 999, horn = null;
    run(ac, 110, (a, t) => { p(a, t); if (t > 25) { const k = a.tas / KT; if (k < min) min = k; if (horn === null && a.horn > 0.5) horn = k; } });
    between(min, lo, hi, 'slowest speed, KCAS');
    assert.ok(horn !== null && horn - min > 3 && horn - min < 14, `the horn sounds 3 to 14 knots before (it sounded at ${horn?.toFixed(1)}, slowest ${min.toFixed(1)})`);
    assert.equal(ac.crashed, null);
  });
}

test('take-off: airborne in about 300 m at full weight', () => {
  const ac = make('ready'); loadUp(ac); ac.eng.cht = 150; ac.eng.oilT = 80; ac.ctl.parkBrake = false; ac.eng.throttle = 1;
  let lift = null, ip = 0;
  run(ac, 45, (a) => {
    a.ctl.roll = clamp(-a.bank * 0.03, -1, 1); a.ctl.yaw = clamp(-(((a.heading + 180) % 360) - 180) * 0.08 + a.om.y / DEG * 0.05, -1, 1);
    if (a.inst.kias > 50) { ip = clamp(ip + (9.5 - a.pitch) * 0.004, 0, 1); a.ctl.pitch = clamp((9.5 - a.pitch) * 0.1 + ip - a.om.x / DEG * 0.03, -1, 1); }
    if (!lift && !a.gear.weightOnWheels && a.agl > 0.3) lift = { d: -a.pos.z, kias: a.inst.kias };
  });
  assert.ok(lift, 'it left the ground'); between(lift.d, 220, 420, 'ground roll, m'); between(lift.kias, 48, 64, 'lift-off KIAS');
  assert.equal(ac.crashed, null);
});

test('roll and yaw: it rolls about 50 degrees a second, and a rudder kick dies out', () => {
  const ac = make('cruise'); ac.eng.throttle = 0.7; run(ac, 40, pilot({ alt: 900 / FT }));
  let peak = 0; run(ac, 2, (a) => { a.ctl.roll = 1; peak = Math.max(peak, -a.om.z / DEG); });
  between(peak, 35, 75, 'peak roll rate, deg/s');
  const b = make('cruise'); b.eng.throttle = 0.7; run(b, 40, pilot({ alt: 900 / FT }));
  run(b, 1, (a) => { a.ctl.yaw = 0.6; }); const kicked = Math.abs(b.beta);
  run(b, 8, (a) => { a.ctl.yaw = 0; a.ctl.roll = 0; });
  assert.ok(kicked > 4 && Math.abs(b.beta) < 3, `sideslip ${kicked.toFixed(1)} deg after the kick, ${Math.abs(b.beta).toFixed(1)} eight seconds later`);
});

test('starting from cold needs the primer; too much floods it', () => {
  const start = (primes, oat = 15) => {
    const ac = make('cold', {}, { oat, dewpoint: oat - 6 });
    ac.elec.masterBat = ac.elec.masterAlt = true; ac.eng.mixture = 1; ac.eng.throttle = 0.12; ac.fuel.selector = 2;
    run(ac, 1);
    for (let i = 0; i < primes; i++) { ac.ctl.primer = 1; run(ac, 0.5); ac.ctl.primer = 0; run(ac, 0.5); }
    let t = null, low = 99; ac.ctl.magKey = 4;
    run(ac, 12, (a, tt) => { low = Math.min(low, a.elec.volts); if (t === null && a.eng.rpm > 500) { t = tt; a.ctl.magKey = 3; } });
    ac.ctl.magKey = 3; run(ac, 15);
    return { t, low, ac };
  };
  const primed = start(3), dry = start(0), flooded = start(9);
  assert.ok(primed.t !== null && primed.t < 4, 'three strokes: it starts');
  assert.equal(dry.t, null, 'no priming on a cold engine: it only cranks');
  assert.ok(flooded.t === null || flooded.t > primed.t + 1.5, 'nine strokes: flooded, slow to start');
  between(primed.low, 15, 23, 'bus volts while cranking');
  between(primed.ac.eng.rpm, 800, 1200, 'rpm at a tenth throttle after the start');
  assert.ok(primed.ac.elec.battAmps > 0 && primed.ac.elec.volts > 27.5, 'the alternator is charging the battery');
  assert.ok(primed.ac.eng.oilP > 25, 'oil pressure');
});

test('magneto check at 1700 rpm: a drop on each, none when both', () => {
  const ac = make('ready'); ac.eng.cht = 150; ac.eng.oilT = 80; ac.eng.throttle = 0.36; run(ac, 15);
  const both = ac.eng.rpm; ac.ctl.magKey = 1; run(ac, 6); const right = ac.eng.rpm; ac.ctl.magKey = 2; run(ac, 6); const left = ac.eng.rpm; ac.ctl.magKey = 0; run(ac, 4);
  between(both, 1500, 1950, 'rpm for the check'); between(both - right, 25, 150, 'drop on the right magneto'); between(both - left, 25, 150, 'drop on the left magneto');
  assert.ok(ac.eng.rpm < 300, 'with the key off it stops');
});

test('the fuel selector on OFF starves the engine; the mixture knob stops it', () => {
  const ac = make('ready'); ac.eng.throttle = 0.3; run(ac, 5); assert.ok(ac.eng.rpm > 1200);
  ac.fuel.selector = 0; run(ac, 90); assert.ok(ac.eng.rpm < 200, `selector off: ${ac.eng.rpm.toFixed(0)} rpm after 90 s`);
  const b = make('ready'); b.eng.throttle = 0.1; run(b, 5); b.eng.mixture = 0; run(b, 8); assert.ok(b.eng.rpm < 200, 'idle cut-off');
});

test('carburettor ice builds in cool damp air at part throttle, and heat clears it', () => {
  const ac = make('cruise', { alt: 600 }, { oat: 8, dewpoint: 7 }); ac.eng.throttle = 0.42;
  const p = pilot({ alt: 600 / FT }); run(ac, 30, p); const clean = ac.eng.rpm;
  run(ac, 420, p);
  assert.ok(ac.eng.ice > 0.15, `ice ${ac.eng.ice.toFixed(2)}`); assert.ok(ac.eng.rpm < clean - 40, `rpm fell from ${clean.toFixed(0)} to ${ac.eng.rpm.toFixed(0)}`);
  ac.eng.carbHeat = 1; run(ac, 90, p);
  assert.ok(ac.eng.ice < 0.02, 'heat melted it');
});

test('leaning at altitude gives power back', () => {
  const ac = make('cruise', { alt: 2400 }); ac.eng.throttle = 1;
  const p = pilot({ alt: 2400 / FT }); run(ac, 60, p); const rich = ac.eng.hp, phi = ac.eng.phi;
  ac.eng.mixture = 0.72; run(ac, 40, p);
  assert.ok(phi > 1.35, `full rich at 8000 ft is over-rich (phi ${phi.toFixed(2)})`);
  assert.ok(ac.eng.hp > rich + 1.5, `leaned ${ac.eng.hp.toFixed(1)} hp against ${rich.toFixed(1)} rich`);
});

test('electrics: the battery runs down, breakers cut their circuits', () => {
  const ac = make('cold'); ac.elec.masterBat = true; ac.ctl.lights.land = true; ac.ctl.lights.nav = true; ac.ctl.pitotHeat = true;
  const soc = ac.elec.soc; run(ac, 120);
  assert.ok(ac.elec.battAmps < -15, `discharging at ${ac.elec.battAmps.toFixed(1)} A`); assert.ok(ac.elec.soc < soc - 0.02); assert.ok(ac.elec.lowVolt, 'low-voltage light');
  const amps = ac.elec.loadAmps; ac.elec.breaker.LDG_LT = false; run(ac, 1);
  assert.ok(ac.elec.loadAmps < amps - 6, 'pulling the landing-light breaker sheds its load');
  ac.ctl.flapLever = 2; run(ac, 3); const moved = ac.flapDeg; ac.elec.breaker.FLAP = false; run(ac, 5);
  assert.ok(moved > 5 && Math.abs(ac.flapDeg - moved) < 0.1, 'the flap motor stops with its breaker out');
});

test('instruments: altimeter, gyros and the compass behave like the real ones', () => {
  const ac = make('ready', { heading: 0 }, { qnh: 101800, fieldElev: 43 });
  run(ac, 5); between(ac.inst.altFt, 125, 157, 'altimeter with the QNH set reads the field elevation, ft');
  const cold = make('cold'); cold.elec.masterBat = true; run(cold, 20);
  assert.ok(cold.inst.aiSpin < 0.05 && cold.inst.flag.tc === false, 'no suction: the attitude gyro is not spinning; the electric turn coordinator is');
  // a turn through north: the compass lags and leads, the heading indicator does not
  const f = make('cruise', { heading: 330 }); f.eng.throttle = 0.6;
  run(f, 30, pilot({ alt: 900 / FT }));
  let worst = 0; const p = pilot({ alt: 900 / FT, bank: 20 });
  run(f, 20, (a, t) => { p(a, t); if (t > 6) { const err = Math.abs((((a.inst.compass - (a.heading - 7)) + 540) % 360) - 180); worst = Math.max(worst, err); } });
  assert.ok(worst > 12, `turning through north the compass was up to ${worst.toFixed(0)} degrees out`);
  const dgErr = Math.abs((((f.inst.dg - (f.heading - 7)) + 540) % 360) - 180);
  assert.ok(dgErr < 3, `the heading indicator stayed within ${dgErr.toFixed(1)} degrees`);
  between(Math.abs(f.inst.aiBank / DEG), 15, 25, 'attitude indicator bank in the turn');
});

test('an ILS approach flown on the needles ends on the runway at a survivable sink rate', () => {
  const nav = buildNav();
  const ac = make('final', { x: 0, z: -6800, heading: 180, alt: 6800 * Math.tan(3 * DEG) }, {}, nav);
  ac.radios.nav.active = 110.3; ac.radios.nav.on = true;
  let sink = null, ig = 0, il = 0, flare = 0;
  run(ac, 260, (a) => {
    const c = a.radios.cdi, agl = a.agl, dt = 1 / 60;
    if (a.gear.weightOnWheels) { sink ??= a.gear.hardest; a.eng.throttle = 0; a.ctl.pitch = 0.2; a.ctl.roll = 0; a.ctl.brakeL = a.ctl.brakeR = a.tas < 25 ? 0.6 : 0; a.ctl.yaw = clamp(-(a.heading - 180) * 0.1, -1, 1); return; }
    if (agl < 4) flare = Math.min(1, flare + dt / 2.5);
    il = clamp(il + c.needle * dt * 0.3, -3, 3);
    const bankCmd = clamp(c.needle * 14 + il - (a.heading - 180) * 0.6, -15, 15);
    a.ctl.roll = clamp((bankCmd - a.bank) * 0.04 + a.om.z / DEG * 0.012, -1, 1); a.ctl.yaw = clamp(a.beta * 0.05, -1, 1);
    ig = clamp(ig + c.gs * dt * 0.02, -0.3, 0.3);
    a.eng.throttle = clamp(0.30 + c.gs * 0.18 + ig, 0, 1) * (1 - flare);
    const th = flare > 0 ? 1 + 5 * flare : clamp((66 - a.inst.kias) * -0.5, -8, 6);
    a.ctl.pitch = clamp((th - a.pitch) * 0.12 - a.om.x / DEG * 0.03 + 0.12, -1, 1);
  });
  assert.equal(ac.crashed, null); assert.ok(sink !== null, 'it touched down');
  assert.ok(sink < 3.0, `touchdown sink ${(sink / FT * 60).toFixed(0)} ft/min`);
  assert.ok(Math.abs(ac.pos.x) < 11 && ac.pos.z > -620 && ac.pos.z < 620, `stopped on the runway (x ${ac.pos.x.toFixed(1)}, z ${ac.pos.z.toFixed(0)})`);
  assert.ok(ac.tas < 12, 'and slowed down');
});
