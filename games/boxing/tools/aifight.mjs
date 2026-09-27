// Headless AI vs AI bout: node tools/aifight.mjs [rounds] [roundSeconds] [diffA] [diffB]
import { FightSim } from '../src/game/FightSim.js';
import { DamageModel } from '../src/game/Damage.js';
import { BoxerAI } from '../src/game/AI.js';
import { Match } from '../src/game/Match.js';

const [, , rounds = '3', len = '60', da = 'pro', db = 'pro'] = process.argv;
const sim = new FightSim();
const dmg = new DamageModel(sim);
const ais = [new BoxerAI(sim.a, da), new BoxerAI(sim.b, db)];
const match = new Match(sim, { rounds: +rounds, roundLength: +len, restLength: 2 });
match.on((type, d) => {
  if (['roundStart', 'roundEnd', 'knockdown', 'gettingUp', 'resume', 'over'].includes(type)) {
    const extra = type === 'knockdown' ? `${d.boxer.name} down (#${d.count})` : type === 'over' ? `${d.method} ${d.winner ? d.winner.name : ''} ${d.detail}` : '';
    console.log(`[${type}] r${match.round} ${(match.roundLength - match.clock).toFixed(1)}s ${extra}`);
  }
});
match.start();
const t0 = performance.now();
let frames = 0, maxV = 0, hits = { head: 0, body: 0, block: 0 }, sev = [];
while (match.state !== 'over' && frames < 60 * 60 * 20) {
  if (match.fighting) for (const ai of ais) ai.update(sim.dt);
  match.update(sim.dt);
  dmg.pre();
  sim.step();
  for (const ev of dmg.post()) if (ev.kind === 'hit') { hits[ev.zone] = (hits[ev.zone] ?? 0) + 1; if (ev.zone === 'head') sev.push(ev.severity); }
  for (const b of sim.world.bodies) maxV = Math.max(maxV, b.vel.length());
  frames++;
}
const ms = performance.now() - t0;
for (const bx of sim.boxers) {
  const s = bx.stats;
  console.log(`${bx.name}: thrown ${s.thrown} landed ${s.landed} (${((s.landed / Math.max(1, s.thrown)) * 100).toFixed(0)}%) power ${s.powerLanded}/${s.powerThrown} kd ${s.knockdowns} health ${bx.health.toFixed(0)} stamina ${bx.stamina.toFixed(0)} body ${bx.bodyDamage.toFixed(0)}`);
}
sev.sort((x, y) => y - x);
console.log('hits', hits, 'top head severities', sev.slice(0, 8).map((x) => x.toFixed(2)).join(' '));
console.log(`frames ${frames} (${(frames / 60).toFixed(0)}s sim) in ${(ms / 1000).toFixed(1)}s -> ${(ms / frames).toFixed(2)} ms/frame, max body speed ${maxV.toFixed(1)} m/s`);
