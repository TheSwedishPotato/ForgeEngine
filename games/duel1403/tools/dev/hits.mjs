import { FightSim } from '../../src/game/FightSim.js';
import { KnightAI } from '../../src/game/AI.js';
import { OPPONENTS } from '../../src/data/opponents.js';
const f = (O) => ({ name: O.name, items: O.items, weapon: O.weapon, offhand: O.offhand, skill: O.skill, strength: O.strength, height: O.body.height, mass: O.body.mass });
const A = OPPONENTS[process.argv[2] ?? 'knight'], B = OPPONENTS[process.argv[3] ?? 'squire'];
const sim = new FightSim({ fighters: [f(A), f(B)], separation: 3.6 });
const ais = [new KnightAI(sim.a, { style: A.style, skill: A.skill, aggression: A.aggression }), new KnightAI(sim.b, { style: B.style, skill: B.skill, aggression: B.aggression })];
sim.settle(1.3);
const rows = [];
sim.damage.on((e) => { if (e.type !== 'hit') return; const att = e.attacker; rows.push({ t: sim.time.toFixed(2), att: att?.name?.split(' ')[0], atk: att?.attack ? `${att.attack.name}/${att.attack.phase}` : 'NONE', E: (e.energy ?? 0).toFixed(1), how: e.how ?? e.kind ?? '', zone: e.zone, text: e.text }); });
for (let i = 0; i < 60 * 30; i++) { for (const ai of ais) ai.update(1 / 60); sim.step(); }
const none = rows.filter((r) => r.atk === 'NONE');
console.log(`hits ${rows.length}, with no attack in progress ${none.length}`);
const byE = [0, 2, 5, 10, 20, 50, 1e9]; const h = new Array(byE.length - 1).fill(0);
for (const r of rows) for (let i = 0; i < h.length; i++) if (r.E >= byE[i] && r.E < byE[i + 1]) h[i]++;
console.log('energy J bins [0-2 2-5 5-10 10-20 20-50 50+]', h.join(' '));
console.log(rows.slice(0, 25).map((r) => `${r.t} ${r.att} ${r.atk} E=${r.E} ${r.zone} | ${r.text}`).join('\n'));
