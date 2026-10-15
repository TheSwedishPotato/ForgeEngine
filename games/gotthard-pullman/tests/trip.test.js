// The trip, the people and the steam, checked against what the real things do.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Route } from '../src/world/route.js';
import { Sim, hms } from '../src/sim.js';
import { PRESETS } from '../src/world/weather.js';
import { SteamPlume, rhoSat } from '../src/render/steam.js';

const route = await Route.load();

/** Runs the trip; returns what happened. */
async function trip(weather, { until = '12:30', watch = null } = {}) {
  const sim = new Sim(route, { weather, startClock: hms('10:12') });
  const T = sim.train, L = T.loco;
  const out = { minCrown: 1e9, minP: 99, maxP: 0, departed: null, wassenOut: 0, wassenBack: null, sim };
  while (sim.clock < hms(until) && sim.crew.phase !== 'arrived') {
    sim.advance(0.5);
    if (!out.departed && T.speed > 0.2) out.departed = sim.clock;
    if (sim.clock > hms('10:15')) { out.minCrown = Math.min(out.minCrown, L.out.crownCover); out.minP = Math.min(out.minP, L.p); out.maxP = Math.max(out.maxP, L.p); }
    if (sim.arrivals.Wassen && !sim.arrivals.Göschenen) {
      out.wassenOut = Math.max(out.wassenOut, sim.passengers.list.filter((p) => p.pos?.space === 'out').length);
      if (out.wassenOut > 0 && !out.wassenBack && sim.boardingDone) out.wassenBack = sim.clock;
    }
    watch?.(sim);
  }
  return out;
}

test('clear weather: on time, the boiler safe, everyone aboard before each departure', async () => {
  const r = await trip('clear');
  const { sim } = r;
  assert.ok(r.departed >= hms('10:14') && r.departed < hms('10:14:30'), `left Erstfeld at ${r.departed - hms('10:14')} s after 10:14`);
  for (const st of sim.timetable.stops.slice(1)) {
    const late = (sim.arrivals[st.name] - hms(st.arr)) / 60;
    assert.ok(Math.abs(late) < 4, `${st.name}: ${late.toFixed(1)} min against the timetable`);
  }
  assert.ok(r.minCrown > 0, 'the crown sheet stays under water');
  assert.ok(r.minP - 1.013 > 10 && r.maxP - 1.013 < 16.1, `boiler between ${(r.minP - 1.013).toFixed(1)} and ${(r.maxP - 1.013).toFixed(1)} bar`);
  assert.ok(r.wassenOut > 20, `${r.wassenOut} people out at the Wassen photo stop`);
  assert.ok(r.wassenBack && r.wassenBack < hms('11:18'), 'all back aboard before the booked departure from Wassen');
});

test('the passengers ride with the train: mass in each car matches the people in it', async () => {
  const sim = new Sim(route, { weather: 'clear', startClock: hms('10:12') });
  const check = () => {
    const want = new Float64Array(sim.train.veh.length);
    for (const p of [...sim.passengers.list, sim.passengers.conductor]) if ((p.aboard ?? true) && p.state !== 'gone') want[p.car] += p.mass;
    sim.train.passengers.forEach((m, i) => assert.ok(Math.abs(m - want[i]) < 1e-6, `car ${i}: ${m.toFixed(1)} kg in the train, ${want[i].toFixed(1)} kg of people`));
  };
  check();
  // every minute of the trip: boarding, the ticket round, the photo stop, everyone out at the end
  for (let t = hms('10:12:30'); t < hms('11:40'); t += 60) { while (sim.clock < t) sim.advance(0.5); check(); }
});

test('the same seed gives the same trip', async () => {
  const a = await trip('snowfall', { until: '10:40' }), b = await trip('snowfall', { until: '10:40' });
  assert.equal(a.sim.train.front, b.sim.train.front);
  assert.equal(a.sim.arrivals.Gurtnellen, b.sim.arrivals.Gurtnellen);
});

test('every weather gets the train to Göschenen', { timeout: 600000 }, async () => {
  for (const w of Object.keys(PRESETS)) {
    const r = await trip(w, { until: '13:30' });
    assert.ok(r.sim.arrivals['Göschenen'], `${w}: the train reaches Göschenen`);
    assert.ok(r.minCrown > 0, `${w}: the crown sheet stays covered`);
  }
});

test('saturation vapour density (Magnus) against the steam tables', () => {
  // ρsat: 4.85 g/m³ at 0 °C, 17.3 g/m³ at 20 °C, 0.598 kg/m³ at 100 °C (IAPWS)
  assert.ok(Math.abs(rhoSat(0) / 0.00485 - 1) < 0.01);
  assert.ok(Math.abs(rhoSat(20) / 0.0173 - 1) < 0.02);
  assert.ok(Math.abs(rhoSat(100) / 0.598 - 1) < 0.03);
});

test('steam: a blast stops within a second, and hangs in fog but vanishes in the föhn', () => {
  const run = (rh, T) => {
    const p = new SteamPlume({});
    p.air = { x: 0, y: 0, z: 0 }; p.rh = rh; p.tempC = T;
    p.puff({ x: 0, y: 0, z: 0 }, { x: 0, y: 60, z: 0 }, 0.1);
    const cam = { x: 0, y: 0, z: 0 };
    let tAlive = 0, h1 = null;
    for (let t = 0; t < 120 && p.live; t += 0.02) {
      p.simulate(0.02, cam);
      tAlive = t;
      if (h1 == null && t >= 1) h1 = { y: p.pos[1], u: Math.hypot(p.u[0], p.u[1], p.u[2]), s: p.sig[0] };
    }
    return { tAlive, h1 };
  };
  const fog = run(1.0, -7), foehn = run(0.4, 9);
  assert.ok(fog.h1.u < 6, `after 1 s the blast is down to ${fog.h1.u.toFixed(1)} m/s`);
  assert.ok(fog.h1.y > 3 && fog.h1.y < 20, `and it has risen ${fog.h1.y.toFixed(1)} m`);
  assert.ok(fog.tAlive > 40, `in freezing fog it lasts ${fog.tAlive.toFixed(0)} s`);
  assert.ok(foehn.tAlive < 10, `in the föhn it is gone after ${foehn.tAlive.toFixed(1)} s`);
});

test('the Treno Gottardo overtakes at Gurtnellen and comes down past the photo stop at Wassen', async () => {
  const { Traffic } = await import('../src/world/traffic.js');
  const traffic = new Traffic(route);
  const sim = new Sim(route, { weather: 'clear', startClock: hms('10:12') });
  const near = (tr, s) => { const p = route.run.pos(s); let bd = 1e18, bt = null; for (let i = 0; i < tr.t.length; i += 2) { const q = tr.path.pos(i * 2); const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (d < bd) { bd = d; bt = tr.t[i]; } } return { d: Math.sqrt(bd), t: bt }; };
  const [south, north] = traffic.trains;
  while (sim.clock < hms('11:12') && sim.crew.phase !== 'arrived') sim.advance(1);
  const g = sim.route.stations.find((x) => x.name === 'Gurtnellen'), w = sim.route.stations.find((x) => x.name === 'Wassen');
  const pg = near(south, g.s), pw = near(north, w.s);
  const depG = hms('10:49'), arrW = sim.arrivals.Wassen;
  assert.ok(pg.d > 3 && pg.d < 7, `it passes on the other track (${pg.d.toFixed(1)} m across)`);
  assert.ok(pg.t > sim.arrivals.Gurtnellen && pg.t < depG, 'while the special waits at Gurtnellen');
  assert.ok(pw.d > 3 && pw.d < 7 && pw.t > arrW + 60 && pw.t < hms('11:15'), 'and the northbound one passes the photo stop while people are out');
});

test('the signals hold a following train behind the special, and the AI never trips Signum', { timeout: 600000 }, async () => {
  globalThis.window ??= { addEventListener() {} };
  const { Driving } = await import('../src/drive.js');
  // you take over on the climb out of Erstfeld and stop her on the open line
  const sim = new Sim(route, { weather: 'clear', startClock: hms('10:12') });
  while (sim.clock < hms('10:20')) sim.advance(1);
  const D = new Driving({ sim, player: { setCab() {} } });
  D.toggle();
  D.press('KeyS', true); for (let i = 0; i < 40; i++) { D.update(0.1); sim.advance(0.1); } D.press('KeyS', false);
  for (let i = 0; i < 6; i++) D.press('BracketRight', true);
  const T = sim.train, tg = sim.traffic.runs[0];               // the Treno Gottardo coming up behind
  let minGap = 1e9, held = false;
  while (sim.clock < hms('10:55')) {
    D.update(0.5); sim.advance(0.5);
    const k = tg._i(tg.u);
    if (tg.onMap && tg.track[k] === 'L' && tg.ts[k] < T.front) {
      minGap = Math.min(minGap, T.rear - tg.ts[k]);
      if (tg.v < 0.1) held = true;
    }
  }
  assert.ok(Math.abs(T.speed) < 0.1, 'the special stands');
  assert.ok(minGap > 0, `the following train never reaches the special (closest ${minGap.toFixed(0)} m)`);
  assert.ok(held, 'it is stopped at a signal behind it');
  // an ordinary trip: the driver obeys every signal (Signum never has to brake)
  const r = await trip('clear');
  assert.equal(r.sim.signals.signum.tripped, null, 'no Signum intervention on the driver\'s trip');
});

test('you can drive: the regulator moves her, the brake valve stops her', async () => {
  globalThis.window ??= { addEventListener() {} };
  const { Driving } = await import('../src/drive.js');
  const sim = new Sim(route, { weather: 'clear', startClock: hms('10:12') });
  while (sim.clock < hms('10:15')) sim.advance(1);
  const D = new Driving({ sim, player: { setCab() {} } });
  D.toggle();
  const T = sim.train, run = (sec) => { for (let i = 0; i < sec * 10; i++) { D.update(0.1); sim.advance(0.1); } };
  const v0 = T.speed;
  D.press('KeyS', true); run(3); D.press('KeyS', false);                   // steam off
  for (let i = 0; i < 6; i++) D.press('BracketRight', true);               // brake valve to service
  run(90);
  assert.ok(v0 > 3 && Math.abs(T.speed) < 0.1, `stopped from ${(v0 * 3.6).toFixed(0)} km/h`);
  assert.ok(T.brake.v[1].pBC > 1, 'the cars\' brake cylinders are charged');
  // a hill start on 13 per mille, full gear and sand: hold her on the engine brake, release the train, steam on, then let go
  D.press('Period', true); run(2); D.press('Period', false);
  for (let i = 0; i < 9; i++) D.press('BracketLeft', true);                // brake valve to release: the pipe recharges
  run(25); D.press('BracketRight', true);                                  // back to running
  D.press('KeyQ', true); run(3); D.press('KeyQ', false); D.press('KeyX', true);
  D.press('KeyW', true); run(2); D.press('KeyW', false);                   // regulator open
  D.press('KeyG', true); run(3);                                           // the starting valve: live steam to the LP side
  D.press('Comma', true); run(2); D.press('Comma', false);                 // engine brake off as she takes the load
  run(8); D.press('KeyG', false); D.press('KeyX', false);
  run(30);
  assert.ok(!T.loco.failed, 'the boiler survives the stop');
  assert.ok(T.speed > 4, `she moves again (${(T.speed * 3.6).toFixed(0)} km/h)`);
});

test('leaving before the booked time: the exit signal is at Halt and Signum stops the train', async () => {
  globalThis.window ??= { addEventListener() {} };
  const { Driving } = await import('../src/drive.js');
  const sim = new Sim(route, { weather: 'clear', startClock: hms('10:12') });
  sim.advance(5);
  const D = new Driving({ sim, player: { setCab() {} } });
  D.toggle();
  const run = (sec) => { for (let i = 0; i < sec * 10; i++) { D.update(0.1); sim.advance(0.1); } };
  assert.equal(sim.signals.ahead(sim.train.front, { kind: 'main' }).aspect, 'stop');
  D.press('KeyQ', true); run(6); D.press('KeyQ', false);
  D.press('KeyW', true); run(2); D.press('KeyW', false);
  D.press('Comma', true); run(2); D.press('Comma', false);
  run(80);
  assert.match(sim.signals.signum.tripped?.why ?? '', /Erstfeld exit at danger/);
  assert.ok(Math.abs(sim.train.speed) < 0.1 && sim.train.brake.handle === 'emergency', `braked to a stand (${(sim.train.speed * 3.6).toFixed(1)} km/h, ${sim.train.brake.handle})`);
});
