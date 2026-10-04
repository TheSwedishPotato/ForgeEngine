// How often does each fighter fall over by himself? node tools/falltest.mjs [runs] [seconds]
import { FightSim } from '../src/game/FightSim.js';
import { KnightAI } from '../src/game/AI.js';
import { OPPONENTS, OPPONENT_ORDER } from '../src/data/opponents.js';
import { PRESETS } from '../src/data/armour.js';
const runs = Number(process.argv[2] ?? 3), secs = Number(process.argv[3] ?? 15);
const only = process.argv[4];
for (const id of OPPONENT_ORDER) {
  if (only && id !== only) continue;
  const O = OPPONENTS[id];
  let falls = 0, hitsDown = 0, causes = [];
  for (let r = 0; r < runs; r++) {
    const sim = new FightSim({ separation: 3.6, fighters: [{ weapon: 'longsword', items: PRESETS.squire.items }, { weapon: O.weapon, items: O.items, offhand: O.offhand, height: O.body.height, mass: O.body.mass, strength: O.strength, skill: O.skill }] });
    const ais = [new KnightAI(sim.a, { style: 'liechtenauer', skill: 0.6, aggression: 0.5 }), new KnightAI(sim.b, { style: O.style, skill: O.skill, aggression: O.aggression })];
    sim.settle(1.3);
    let lastHit = -10;
    sim.damage.on((e) => { if (e.type === 'hit' && e.defender === sim.b) lastHit = sim.time; });
    for (let i = 0; i < 60 * secs; i++) {
      for (const ai of ais) ai.update(sim.dt);
      sim.step();
      if (sim.b.state !== 'fight' && sim.b.state !== 'getup') {
        if (sim.b.downCause === 'fell' && sim.time - lastHit > 0.6) { falls++; causes.push(sim.time.toFixed(1)); } else { hitsDown++; causes.push(sim.b.downCause + '@' + sim.time.toFixed(1) + ' stun' + sim.b.stun.toFixed(2) + ' blood' + sim.b.blood.toFixed(2)); }
        break;
      }
      if (sim.a.isDown) break;
    }
  }
  console.log(id.padEnd(12), 'self-falls', falls, '/', runs, causes.join(','), 'downed by blows', hitsDown);
}
