// Headless day in Skalice: where everyone is, hour by hour, and the player's body.
//   node tools/lifetest.mjs [hours=24]
import { LifeSim } from '../src/life/LifeSim.js';
import { STARTS } from '../src/life/data.js';
const sim = new LifeSim({ start: STARTS[0], name: 'Jan' });
const hours = Number(process.argv[2] ?? 24);
let nan = 0, stuck = 0;
sim.on((e) => { if (['bell', 'accident', 'crime', 'faint', 'death'].includes(e.type)) console.log(`  ${sim.date().clock} ${e.type}: ${e.bell?.name ?? e.text ?? ''}`); });
console.log(sim.people.length, 'people;', sim.situation());
for (let h = 0; h < hours; h++) {
  for (let i = 0; i < 60; i++) sim.update(1);   // 60 real s = 1 game hour
  for (const p of sim.people) if (!Number.isFinite(p.agent.x)) nan++;
  const where = {};
  for (const p of sim.people) { const k = p.agent.inside ?? (p.agent.route.length ? 'walking' : p.agent.place); where[k] = (where[k] ?? 0) + 1; }
  const N = sim.player.needs;
  console.log(sim.date().clock, JSON.stringify(where), `needs h${N.hunger.toFixed(0)} t${N.thirst.toFixed(0)} b${N.bladder.toFixed(0)} f${N.fatigue.toFixed(0)} hp${sim.player.health.toFixed(0)}`);
}
for (const p of sim.people.slice(0, 6)) console.log(p.fullName, '-', p.title, '-', p.words.join(', '), '-', p.agent.act);
console.log({ nan, stuck });
