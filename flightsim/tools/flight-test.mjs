// Headless flight test: flies the whole route on the physics model in about two seconds.
// usage: node tools/flight-test.mjs [calm|clear|fair|broken|rain] [maxSeconds] [--trace] [--seed=N]
//        [--sc=efato|rto|ga|shear|cat|depress|dual|return|hyd|eo]  (a failure scenario)
import { buildRoute, buildReturnRoute } from '../src/flight.js';
import { FlightModel } from '../src/physics.js';
import { Atmosphere } from '../src/atmosphere.js';
import { KT, FT, DEG } from '../src/core.js';
const WEATHER = {
  clear: { cumulus: 0.0, cuBase: 1400, cuTop: 2200, stratus: null, turb: 0.18, rain: 0, wind: '210° / 8 kt' },
  fair: { cumulus: 0.34, cuBase: 1150, cuTop: 2100, stratus: null, turb: 0.4, rain: 0, wind: '220° / 12 kt' },
  broken: { cumulus: 0.62, cuBase: 900, cuTop: 2000, stratus: null, turb: 0.55, rain: 0, wind: '230° / 16 kt' },
  rain: { cumulus: 0.0, cuBase: 900, cuTop: 1800, stratus: { base: 420, top: 2300 }, turb: 0.5, rain: 0.8, wind: '200° / 14 kt' },
  calm: { cumulus: 0, turb: 0, wind: 'calm' },
};
const wx = process.argv[2] || 'clear', maxT = +(process.argv[3] || 5400), trace = process.argv.includes('--trace');
const route = buildRoute();
const seedArg = process.argv.find((a) => a.startsWith('--seed=')); const atmo = new Atmosphere(WEATHER[wx], { seed: seedArg ? +seedArg.slice(7) : 7 });
atmo.sunHeat = 0.8;
const fm = new FlightModel(route, { atmosphere: atmo, wet: WEATHER[wx].rain > 0 });
const f = (x, n = 1) => (x ?? NaN).toFixed(n);
const row = (tag) => `${f(fm.t, 0).padStart(5)}s ${tag.padEnd(22)} ph=${fm.phase.padEnd(9)} s=${f(fm.s, 0).padStart(6)} h=${f(fm.h / FT, 0).padStart(6)}ft ias=${f(fm.ias, 0).padStart(4)} gs=${f(fm.gs / KT, 0).padStart(4)} vs=${f(fm.vs / FT * 60, 0).padStart(6)}fpm th=${f(fm.pitch / DEG)} ph=${f(fm.bank / DEG)} a=${f(fm.alpha / DEG)} n1=${f(fm.n1[0] * 100, 0)}/${f(fm.n1[1] * 100, 0)} cfg=${fm.cfgTarget} gear=${f(fm.gear, 1)} xtk=${f(fm.xtk, 0)} nz=${f(fm.nz, 2)} m=${f(fm.mass / 1000, 1)}t`;
let t = 0, lastPhase = '', dt = 0.5, nzMin = 9, nzMax = -9, maxXtk = 0, lastTrace = -99;
const t0 = Date.now();
while (t < maxT && fm.phase !== 'arrived' && fm.phase !== 'rto-stop' && !(fm.crashed && fm.crashStopped)) {
  if (t > 12) fm.clearTaxi = true;
  if (t > 26 && !fm._cfgSet) { fm._cfgSet = true; fm.setConfig(2); }
  if (fm.phase === 'hold') fm.clearLineup = true;
  if (fm.phase === 'lineup' && fm.gs < 0.3 && fm.s > fm.m.lineup - 2) fm.clearTakeoff = true;
  const sc = (process.argv.find((x) => x.startsWith('--sc=')) || '').slice(5);
  if (sc === 'efato' && fm._flags.rotate === undefined && fm.rotating && !fm._scDone) { fm._scDone = 1; fm.failEngine(0, 2); fm.toga = true; fm.levelOff = 1524; }
  if (sc === 'return' && fm.phase === 'climb' && fm.h > 400 && !fm._scDone) { fm._scDone = 1; fm.failEngine(0, 2); fm.toga = true; fm.levelOff = 914; const G2 = fm.pos; fm.divert(buildReturnRoute({ x: G2.x, z: G2.z }, { x: fm.V.x, z: fm.V.z })); }
  if (sc === 'rto' && fm.phase === 'takeoff' && fm.ias > 100 && !fm._scDone) { fm._scDone = 1; fm.rejectTakeoff(); }
  if (sc === 'ga' && fm.phase === 'approach' && fm.agl < 150 && !fm._scDone) { fm._scDone = 1; fm.goAround('runway'); }
  if (sc === 'shear' && fm.phase === 'approach' && fm.m.touchdown - fm.s < 9000 && !fm._scDone) { fm._scDone = 1; const p = fm.path.sample(fm.m.touchdown - 3500, {}); atmo.addMicroburst(p.x, p.z, { R: 900, u: 14, w: 10 }); }
  if (sc === 'shear' && fm._scDone === 1 && !fm.onGround && fm.phase === 'approach') { const dv = fm.ias - (fm._iasPrev ?? fm.ias); fm._iasPrev = fm.ias; if (fm.vs < -8 || (fm._shearT = (dv < -0.35 ? (fm._shearT || 0) + dt : 0)) > 2) { fm._scDone = 2; fm.goAround('windshear'); } }
  if (sc === 'cat' && fm.phase === 'cruise' && !fm._scDone) { fm._scDone = 1; atmo.addCAT(5.0, 50, 19, 0.28); }
  if (sc === 'hyd' && fm.phase === 'cruise' && !fm._scDone) { fm._scDone = 1; fm.hyd.green = false; fm.abMed = true; }
  if (sc === 'eo' && fm.phase === 'cruise' && !fm._scDone) { fm._scDone = 1; fm.failEngine(1, 1); fm.abMed = true; fm.levelOff = 5800; }
  if (sc === 'depress' && fm.phase === 'cruise' && !fm._scDone) { fm._scDone = 1; fm.depressurise(1); fm.emergencyDescent(3048); }
  if (sc === 'dual' && fm.phase === 'climb' && fm.h > 900 && !fm._scDone) { fm._scDone = 1; fm.failEngine(0, 2); fm.failEngine(1, 2); }
  fm.update(dt); t += dt;
  if (sc === 'cat' && fm.phase === 'cruise') { nzMin = Math.min(nzMin, fm.nz); }
  while (fm.events.length) { const e = fm.events.shift(); if (!['flaps'].includes(e)) console.log(row('EV ' + e)); }
  if (fm.phase !== lastPhase) { lastPhase = fm.phase; }
  if (!fm.onGround) { nzMin = Math.min(nzMin, fm.nz); nzMax = Math.max(nzMax, fm.nz); maxXtk = Math.max(maxXtk, Math.abs(fm.xtk || 0)); }
  if (trace && t - lastTrace >= (fm.onGround ? 10 : 30)) { lastTrace = t; console.log(row('')); }
  if (process.argv.includes('--flare') && !fm.onGround && fm.h < 40 && fm.phase !== 'climb') console.log(row('F wg=' + fm.atmo.wg.toFixed(1)+' ug='+fm.atmo.ug.toFixed(1)));
  if (!isFinite(fm.P.x) || !isFinite(fm.P.y)) { console.log('NaN!', row('')); break; }
}
console.log(row('END'));
console.log(`runtime ${(Date.now() - t0) / 1000}s  nz ${f(nzMin, 2)}..${f(nzMax, 2)}  maxXtk ${f(maxXtk, 0)}m  touchdownSink ${f(fm.touchdownSink, 2)}m/s  tdS-thr ${f((fm.touchdownS ?? 0) - fm.m.thr, 0)}m fuel ${f(fm.fuel, 0)} damage ${Object.keys(fm.damage).join(',')}`);
