// Headless flight test: the whole flight flown by the crew agents through the physics, with ATC
// and the weather, in a few seconds.
// usage: node tools/flight-test.mjs [preset] [maxSeconds] [--trace] [--radio] [--seed=N] [--wind=DDD/SS[/GG]]
//        [--boarding] [--win=<t>:<halfwidth>] [--sc=efato|rto|engcruise|fire|fire2|depress|dual|hyd|cat|shear|ga|gear|medical|medical2|shearto]
import { buildRoute } from '../src/flight.js';
import { FlightModel } from '../src/physics.js';
import { Atmosphere } from '../src/atmosphere.js';
import { Weather, presetWeather } from '../src/weather.js';
import { ATC } from '../src/atc.js';
import { Crew } from '../src/crew.js';
import { KT, FT, DEG } from '../src/core.js';

const args = process.argv.slice(2);
const preset = args[0] && !args[0].startsWith('--') ? args[0] : 'fair';
const maxT = +(args[1] && !args[1].startsWith('--') ? args[1] : 6000);
const opt = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const flag = (k) => args.includes(`--${k}`);
const seed = +(opt('seed') ?? 7);
const w = presetWeather(preset);
const wind = opt('wind');
if (wind) { const [d, s, g] = wind.split('/').map(Number); for (const k of ['arn', 'cph']) Object.assign(w[k], { wdir: d, wspd: s, gust: g || 0 }); }
if (opt('vis')) w.cph.vis = +opt('vis');
const wx = new Weather(w, { seed });
const atc = new ATC(wx, { seed, events: opt('events') || 'realistic' });
const route = buildRoute(atc.depRwy, atc.arrRwy);
const atmo = new Atmosphere(wx, { seed });
atmo.sunHeat = 0.8;
const fm = new FlightModel(route, { atmosphere: atmo, ...(flag('boarding') ? { coldStart: true, stand: route.gate } : {}) });
const log = [];
const crew = new Crew(fm, atc, { seed, hooks: { log: (m) => { log.push(m); if (flag('radio')) console.log(`${String(Math.round(fm.t)).padStart(5)}s  ${m.kind.padEnd(7)} ${m.who.padEnd(18)} ${m.text}`); }, seatbelt: (on) => { if (flag('radio')) console.log(`${String(Math.round(fm.t)).padStart(5)}s  [seatbelt sign ${on ? 'ON' : 'OFF'}]`); }, cabinReady: () => true } });
if (flag('boarding')) crew.boardingDone = true; // from the gate: pushback and engine start
const f = (x, n = 1) => (x ?? NaN).toFixed(n);
const row = (tag) => `${f(fm.t, 0).padStart(5)}s ${tag.padEnd(22)} ph=${fm.phase.padEnd(9)} s=${f(fm.s, 0).padStart(6)} h=${f(fm.altInd / FT, 0).padStart(6)}ft ias=${f(fm.ias, 0).padStart(4)} gs=${f(fm.gs / KT, 0).padStart(4)} vs=${f(fm.vs / FT * 60, 0).padStart(6)}fpm th=${f(fm.pitch / DEG)} bk=${f(fm.bank / DEG)} a=${f(fm.alpha / DEG)} n1=${f(fm.n1[0] * 100, 0)}/${f(fm.n1[1] * 100, 0)} cfg=${fm.cfgTarget} gear=${f(fm.gear, 1)} xtk=${f(fm.xtk, 0)} nz=${f(fm.nz, 2)} ${fm.afs.ap ? 'AP' : 'man'} ${fm.afs.thr}|${fm.afs.vert}|${fm.afs.lat} stk=${f(fm.ctl.stickY, 2)}`;
console.log(`weather ${preset}: ${wx.metar('ARN')} | ${wx.metar('CPH')} | runways ${atc.depRwy} -> ${atc.arrRwy} | PF ${crew.pf.name}`);
let t = 0, dt = 0.25, nzMin = 9, nzMax = -9, lastTrace = -99, tdSink = null;
const sc = opt('sc');
const t0 = Date.now();
while (t < maxT && fm.phase !== 'arrived' && fm.phase !== 'rto-stop' && fm.phase !== 'runway-stop' && !(fm.crashed && fm.crashStopped)) {
  // physical failures (what the crew does about them is up to the crew)
  if (sc === 'efato' && fm.phase === 'takeoff' && fm.ias > fm.afs.v1 + 3 && !fm._sc) { fm._sc = 1; fm.failEngine(0, 2); }
  if (sc === 'rto' && fm.phase === 'takeoff' && fm.ias > 100 && !fm._sc) { fm._sc = 1; fm.failEngine(1, 2); }
  if (sc === 'engcruise' && fm.phase === 'cruise' && !fm._sc) { fm._sc = 1; fm.failEngine(1, 1); }
  if (sc === 'fire' && fm.phase === 'climb' && fm.altInd > 3000 * FT && !fm._sc) { fm._sc = 1; fm.engFire[0] = true; fm.failEngine(0, 1); }
  if (sc === 'depress' && fm.phase === 'cruise' && !fm._sc) { fm._sc = 1; fm.depressurise(1); }
  if (sc === 'dual' && fm.phase === 'climb' && fm.agl > 900 && !fm._sc) { fm._sc = 1; fm.failEngine(0, 2); fm.failEngine(1, 2); }
  if (sc === 'hyd' && fm.phase === 'cruise' && !fm._sc) { fm._sc = 1; fm.hyd.green = false; }
  if (sc === 'cat' && fm.phase === 'cruise' && !fm._sc) { fm._sc = 1; atmo.addCAT(5.0, 50, 19, 0.28); }
  if (sc === 'fire2' && fm.phase === 'cruise' && !fm._sc) { fm._sc = 1; fm.engFire[1] = true; }
  if (sc === 'gear' && fm.phase === 'descent' && !fm._sc) { fm._sc = 1; fm.gearFailLeg = 2; }
  if (sc === 'medical' && fm.phase === 'cruise' && !fm._sc) { fm._sc = 1; crew.medical(true); }
  if (sc === 'medical2' && fm.phase === 'climb' && fm.altInd > 12000 * FT && !fm._sc) { fm._sc = 1; crew.medical(true); }
  if (sc === 'ga' && fm.phase === 'approach' && fm.m.touchdown - fm.s < 15000 && !fm._sc) { fm._sc = 1; atc.blockRunway((fm.m.touchdown - fm.s) / Math.max(fm.gs, 60) + 30); }
  if (sc === 'fire2' && fm.engFire[1] && fm.ctl.engMaster[1] === false && !fm._fx) { fm._fx = 1; setTimeout(() => {}, 0); fm._fxT = fm.t + 12; }
  if (fm._fxT && fm.t > fm._fxT) { fm.engFire[1] = false; fm._fxT = null; }
  if (sc === 'shearto' && fm.phase === 'climb' && fm.agl > 60 && !fm._sc) { fm._sc = 1; const p = fm.path.sample(fm.s + 700, {}); atmo.addMicroburst(p.x, p.z, { R: 1000, u: 16, w: 12 }); }
  if (sc === 'shear' && fm.phase === 'approach' && fm.m.touchdown - fm.s < 9000 && !fm._sc) { fm._sc = 1; const p = fm.path.sample(fm.m.touchdown - 3500, {}); atmo.addMicroburst(p.x, p.z, { R: 900, u: 14, w: 10 }); }
  fm.update(dt); t += dt;
  while (fm.events.length) { const e = fm.events.shift(); if (!['flaps', 'alt-star', 'alt-captured', 'ap-off'].includes(e) || flag('trace')) console.log(row('EV ' + e)); if (e === 'touchdown') tdSink = fm.touchdownSink; }
  if (!fm.onGround && fm.phase !== 'climb') { nzMin = Math.min(nzMin, fm.nz); nzMax = Math.max(nzMax, fm.nz); }
  if (flag('trace') && t - lastTrace >= (fm.onGround ? 10 : 30)) { lastTrace = t; console.log(row('')); }
  if (opt('win') && Math.abs(fm.t - +opt('win').split(':')[0]) < +(opt('win').split(':')[1] || 5)) console.log(`${f(fm.t, 2)} bk=${f(fm.bank / DEG, 2)} p=${f(fm.p / DEG, 1)} th=${f(fm.pitch / DEG, 2)} wow=${fm.wow.map(Number).join('')} str=${fm.strutC.map((x) => f(x, 3)).join('/')} sx=${f(fm.ctl.stickX, 2)} da=${f(fm.da / DEG, 1)} sp=${f(fm.groundSpoiler, 2)} gs=${f(fm.gs / KT, 0)} law=${fm.fbwMode}`);
  if (flag('final') && !fm.onGround && fm.agl < 200 && fm.phase !== 'climb') console.log(row('F'));
  if (!isFinite(fm.P.x) || !isFinite(fm.P.y)) { console.log('NaN!', row('')); break; }
}
console.log(row('END'));
console.log(`runtime ${(Date.now() - t0) / 1000}s  nz ${f(nzMin, 2)}..${f(nzMax, 2)}  touchdownSink ${f(tdSink, 2)}m/s (${f((tdSink ?? 0) / FT * 60, 0)} fpm)  tdS-thr ${f((fm.touchdownS ?? 0) - fm.m.thr, 0)}m  fuel ${f(fm.fuel, 0)}  go-arounds ${crew.goArounds}  damage ${Object.keys(fm.damage).join(',')}  radio ${log.filter((m) => m.kind === 'atc').length} calls`);
