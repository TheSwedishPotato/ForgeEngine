// Distance profile of AI fights: where do they stand, where do blows start, how many land.
import { FightSim } from '../../src/game/FightSim.js';
import { KnightAI } from '../../src/game/AI.js';
import { OPPONENTS } from '../../src/data/opponents.js';
const pairs = [['fencer', 'mercenary'], ['knight', 'squire'], ['cuman', 'hungarian'], ['fencer', 'condottiere'], ['militia', 'robber']];
const f = (O) => ({ name: O.name, items: O.items, weapon: O.weapon, offhand: O.offhand, skill: O.skill, strength: O.strength, height: O.body.height, mass: O.body.mass });
for (const [a, b] of pairs) {
  const A = OPPONENTS[a], B = OPPONENTS[b];
  const sim = new FightSim({ fighters: [f(A), f(B)], separation: 3.6 });
  const ais = [new KnightAI(sim.a, { style: A.style, skill: A.skill, aggression: A.aggression }), new KnightAI(sim.b, { style: B.style, skill: B.skill, aggression: B.aggression })];
  sim.settle(1.3);
  const hist = new Array(8).fill(0); let starts = [], hits = 0, parries = 0, n = 0;
  sim.damage.on((e) => { if (e.type === 'hit') hits++; if (e.type === 'parry') parries++; });
  let prev = [null, null];
  for (let i = 0; i < 60 * 40; i++) {
    for (const ai of ais) ai.update(1 / 60);
    for (const k of sim.knights) if (k.state === 'down' && k.canGetUp() && k.downTime > 2.2) k.startGetUp();
    sim.step();
    const d = sim.a.center.distanceTo(sim.b.center);
    if (sim.a.state === 'fight' && sim.b.state === 'fight') { hist[Math.min(7, Math.floor(d / 0.5))]++; n++; }
    sim.knights.forEach((k, j) => { if (k.attack && k.attack !== prev[j]) starts.push(d); prev[j] = k.attack; });
  }
  const pct = hist.map((h) => Math.round(100 * h / Math.max(1, n)));
  const med = starts.sort((x, y) => x - y)[Math.floor(starts.length / 2)] ?? 0;
  console.log(`${a} v ${b}: distance % [0-.5 .5-1 1-1.5 1.5-2 2-2.5 2.5-3 3-3.5 3.5+] = ${pct.join(' ')}  attacks ${starts.length} (median start ${med.toFixed(2)} m) hits ${hits} parries ${parries}`);
}
