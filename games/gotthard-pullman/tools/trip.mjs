// The whole trip headless: the crew drive the C 5/6 and the Pullmans from Erstfeld to Göschenen.
//   node tools/trip.mjs [weather] [--cars=sleeper,diner,parlor,observation] [--every=60] [--seed=1] [--quiet]
import { Sim, fmt, hms } from '../src/sim.js';
import { PRESETS } from '../src/world/weather.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const weather = args.find((a) => !a.startsWith('--')) ?? 'clear';
if (!PRESETS[weather]) { console.error('weather presets:', Object.keys(PRESETS).join(' ')); process.exit(1); }
const every = Number(opt('every', 60)), quiet = args.includes('--quiet');
const cars = opt('cars', null)?.split(',');

const sim = await Sim.create({ weather, cars, seed: Number(opt('seed', 1)), log: quiet ? null : (s) => console.log(s) });
const T = sim.train, L = T.loco, R = sim.route;
const rows = [];
let next = 0, slipTime = 0, maxCoupler = 0, minCoupler = 0, minP = 99, minLevel = 999, maxLevel = -999, maxSlip = 0, sv = 0;
const t0 = Date.now();
while (sim.clock < hms('13:00') && sim.crew.phase !== 'arrived') {
  sim.advance(0.25);
  const v = T.speed;
  if (L.out.slip > 0.7) slipTime += 0.25;
  maxSlip = Math.max(maxSlip, L.out.slip);
  for (const f of T.couplerForce) { maxCoupler = Math.max(maxCoupler, f); minCoupler = Math.min(minCoupler, f); }
  if (sim.clock > hms('10:15')) { minP = Math.min(minP, L.p); minLevel = Math.min(minLevel, L.out.crownCover); maxLevel = Math.max(maxLevel, L.out.levelTrue); }
  if (L.out.svFlow > 0) sv += 0.25;
  if (sim.clock >= next) {
    next = sim.clock + every;
    rows.push({
      time: fmt(sim.clock, true), km: R.kmAt(T.front).toFixed(2), 'km/h': (v * 3.6).toFixed(1), '‰': (R.run.gradeAt(T.front) * 1000).toFixed(1),
      phase: sim.crew.phase, reg: L.c.regulator.toFixed(2), cut: L.c.reverser.toFixed(2), bar: (L.p - 1.013).toFixed(1), glass: L.out.level.toFixed(0),
      'coal kg/h': (L.out.coalRate * 3600).toFixed(0), 'steam kg/h': (L.out.steamRate * 3600).toFixed(0), 'kN': (L.out.Fadh / 1e3).toFixed(0), BP: T.brake.v[0].pBP.toFixed(2), BC: T.brake.v[3].pBC.toFixed(2),
      tunnel: R.inTunnel(T.front)?.name ?? (R.inTunnel(T.front) ? 'tunnel' : ''),
    });
  }
}
console.table(rows);
console.log(`\nweather: ${PRESETS[weather].label}; consist ${T.veh.map((v) => v.name).join(' + ')}; ${(T.mass / 1000).toFixed(1)} t, ${T.length.toFixed(1)} m`);
for (const st of sim.timetable.stops.slice(1)) {
  const a = sim.arrivals[st.name];
  console.log(`  ${st.name.padEnd(16)} booked ${st.arr}  actual ${a ? fmt(a, true) : '—'}  ${a ? ((a - hms(st.arr)) / 60).toFixed(1) + ' min' : ''}`);
}
console.log(`coal ${(8000 - L.tenderCoal).toFixed(0)} kg, water ${(18000 - L.tenderWater).toFixed(0)} kg, sand ${(300 - L.sand).toFixed(1)} kg; slipping ${slipTime.toFixed(1)} s (max slip ${maxSlip.toFixed(2)} m/s); safety valves ${sv.toFixed(0)} s`);
console.log(`couplings: max tension ${(maxCoupler / 1e3).toFixed(0)} kN, max compression ${(-minCoupler / 1e3).toFixed(0)} kN; boiler min ${(minP - 1.013).toFixed(1)} bar; water over the crown sheet min ${minLevel.toFixed(0)} mm, true level max ${maxLevel.toFixed(0)} mm; brake blocks max ${Math.max(...T.brake.v.map((x) => x.tBlock)).toFixed(0)} °C`);
console.log(`(simulated ${((sim.clock - hms('10:00')) / 60).toFixed(0)} min in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
