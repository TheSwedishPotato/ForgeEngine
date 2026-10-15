// A forenoon at sea, headless: orders to the captain at set times, the crew carrying them out by
// hand, the boat's log and her state printed as she goes.
//   node tools/patrol.mjs [minutes=40] [--quiet]
// The orders: dive to periscope depth, run submerged, go deep, change course, come up to
// periscope depth, surface, put two diesels on propulsion and two on charge, run on the surface.
// (The coast lies to the east: her navigator watches the fathometer and keeps her off it.)
import { Sim, fmt } from '../src/sim.js';
import { FT } from '../src/data/boat.js';

const minutes = Number(process.argv[2] ?? 40);
const quiet = process.argv.includes('--quiet');
const sim = new Sim({ start: 'dive', wind: 5 });
const C = sim.crew, P = sim.plant, g = P.g;
const plan = [
  [0.2, 'Dive to periscope depth', () => C.order('dive', { depth: 60 * FT })],
  [5, 'Ahead two thirds', () => C.order('speed', { bell: 'ahead2' })],
  [7, 'Make depth 100 feet', () => C.order('changeDepth', { depth: 100 * FT })],
  [12, 'Left 90 (to seaward)', () => C.order('course', { heading: C.orders.heading - 90 })],
  [17, 'Make depth 60 feet', () => C.order('changeDepth', { depth: 60 * FT })],
  [21, 'Surface', () => C.order('surface')],
  [29, 'Diesels: two on propulsion, two charging', () => C.order('dieselPropulsion', { charge: true })],
  [33, 'Ahead standard', () => C.order('speed', { bell: 'standard' })],
];
let n = 0, next = 0;
const t0 = Date.now();
const state = () => `depth ${g.depth.toFixed(0).padStart(3)} ft  ${g.speed.toFixed(1).padStart(4)} kn  course ${g.heading.toFixed(0).padStart(3, '0')}  pitch ${g.pitch.toFixed(1).padStart(4)}  bat ${(P.elec.batteries.fwd.soc * 100).toFixed(1)} %  air ${g.hpManifold.toFixed(0)} psi  baro ${g.barometer.toFixed(2)}  CO2 ${g.co2.toFixed(2)} %  eng ${P.engines.map((e) => (e.state === 'running' ? 'R' : '-')).join('')}  water ${P.flood.total.toFixed(2)} m3`;
for (let s = 0; s < minutes * 60; s++) {
  while (next < plan.length && s >= plan[next][0] * 60) { console.log(`\n${fmt(sim.clock)}  ORDER: ${plan[next][1]}`); plan[next][2](); next++; }
  sim.advance(1);
  if (!quiet) while (n < sim.log.length) { const l = sim.log[n++]; console.log(`${fmt(l.t)}  ${l.who ? `${l.who}: ` : ''}${l.text}`); }
  if (s % 60 === 59) console.log(`${fmt(sim.clock)}  ${state()}`);
}
console.log(`\n${minutes} minutes of boat time in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
