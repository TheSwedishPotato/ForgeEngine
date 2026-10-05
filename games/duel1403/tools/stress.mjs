// AI-vs-AI tournament that looks for misbehaviour: NaNs, explosions, sinking,
// leaving the lists, stalemates, unprovoked falls, dropped weapons.
//   node tools/stress.mjs [seconds=60] [filter]
import { FightSim } from '../src/game/FightSim.js';
import { KnightAI } from '../src/game/AI.js';
import { OPPONENTS, OPPONENT_ORDER } from '../src/data/opponents.js';
import { LISTS_RADIUS } from '../src/knight/Knight.js';

const secs = Number(process.argv[2] ?? 60), filter = process.argv[3];
const fighter = (O) => ({ name: O.name, items: O.items, weapon: O.weapon, offhand: O.offhand, skill: O.skill, strength: O.strength, height: O.body.height, mass: O.body.mass });
const report = [];
let n = 0;
for (const ia of OPPONENT_ORDER) for (const ib of OPPONENT_ORDER) {
  if (ia >= ib) continue;
  if (filter && !`${ia}-${ib}`.includes(filter)) continue;
  const A = OPPONENTS[ia], B = OPPONENTS[ib];
  const sim = new FightSim({ fighters: [fighter(A), fighter(B)], separation: 3.6 });
  const ais = [new KnightAI(sim.a, { style: A.style, skill: A.skill, aggression: A.aggression }), new KnightAI(sim.b, { style: B.style, skill: B.skill, aggression: B.aggression })];
  sim.settle(1.3);
  const issues = new Set();
  let hits = 0, attacks = 0, lastHitT = 0, maxV = 0, maxWho = '', ended = null, falls = [], drops = 0;
  const lastHurt = [0, 0];
  sim.damage.on((e) => { if (e.type === 'hit') { hits++; lastHitT = sim.time; lastHurt[e.defender.id] = sim.time; } });
  for (const k of sim.knights) { k.onDown = (kk, cause) => falls.push({ who: kk.id, cause, t: sim.time, sinceHit: sim.time - lastHurt[kk.id] }); k.onDrop = () => drops++; }
  const steps = secs * 60;
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) {
    const prevA = [sim.a.attack?.name, sim.b.attack?.name];
    for (const ai of ais) ai.update(1 / 60);
    for (const k of sim.knights) if (k.state === 'down' && k.canGetUp() && k.downTime > 2.2) k.startGetUp();
    sim.step();
    if (sim.a.attack && sim.a.attack.name !== prevA[0]) attacks++;
    if (sim.b.attack && sim.b.attack.name !== prevA[1]) attacks++;
    for (const k of sim.knights) {
      for (const b of k.ragdoll.list) {
        const p = b.pos, v = b.vel ?? b.v;
        if (!Number.isFinite(p.x + p.y + p.z)) issues.add('NaN position');
        if (v && v.length() > maxV) { maxV = v.length(); maxWho = `${k.name.split(' ')[0]}.${b.name}@${sim.time.toFixed(2)}s(${k.state}${k.attack ? ' ' + k.attack.name : ''})`; }
        if (p.y < -0.15) issues.add(`${k.name}.${b.name} below ground y=${p.y.toFixed(2)}`);
      }
      const c = k.center;
      if (Math.hypot(c.x, c.z) > LISTS_RADIUS + 1.5) issues.add(`${k.name} outside lists r=${Math.hypot(c.x, c.z).toFixed(1)}`);
      const wp = k.weapon?.body?.pos;
      if (wp && !Number.isFinite(wp.x)) issues.add('NaN weapon');
    }
    if (!ended) {
      for (const k of sim.knights) if (k.state === 'dead' || (k.state === 'out' && k.downTime > 2.5) || (k.state === 'down' && k.downTime > 8)) ended = `${k.name} ${k.state} @${sim.time.toFixed(1)}s`;
      if (ended) break;
    }
  }
  if (maxV > 60) issues.add(`max body speed ${maxV.toFixed(0)} m/s`);
  if (!ended && sim.time - lastHitT > 25) issues.add(`no hits for ${(sim.time - lastHitT).toFixed(0)} s`);
  for (const f of falls) if (f.sinceHit > 3 && f.cause !== 'thrown') issues.add(`${sim.knights[f.who].name} fell (${f.cause}) ${f.sinceHit.toFixed(1)} s after last hit`);
  n++;
  const ms = (performance.now() - t0) / (sim.time * 1000) * 1000;
  report.push(`${ia} v ${ib}: ${ended ?? 'no result'} hits=${hits} attacks=${attacks} falls=${falls.length} drops=${drops} maxV=${maxV.toFixed(1)} ${maxWho} rt=${ms.toFixed(0)}ms/s ${[...issues].join('; ')}`);
  console.log(report[report.length - 1]);
}
