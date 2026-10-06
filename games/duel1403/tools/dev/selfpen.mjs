// How far does each fighter's own weapon sink into his own body (and the clothes on it)?
//   node tools/dev/selfpen.mjs [seconds=25]
import { Vector3 } from 'three';
// the same fights every run
let _seed = 7; Math.random = () => { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; };
import { FightSim } from '../../src/game/FightSim.js';
import { KnightAI } from '../../src/game/AI.js';
import { OPPONENTS } from '../../src/data/opponents.js';
import { closestPtSegmentSegment } from '../../src/physics/math.js';
const f = (o) => ({ name: o.name, items: o.items, weapon: o.weapon, offhand: o.offhand, skill: o.skill, height: o.body.height, mass: o.body.mass });
const c1 = new Vector3(), c2 = new Vector3();
const secs = Number(process.env.SECS ?? process.argv[2] ?? 25) || 25;
const CLOTH = 0.03;   // what the clothes/armour meshes add over the capsules (m)
const tally = {};
for (const [a, b] of [['knight', 'fencer'], ['squire', 'mercenary'], ['fencer', 'militia'], ['condottiere', 'knight'], ['militia', 'squire']]) {
  const sim = new FightSim({ fighters: [f(OPPONENTS[a]), f(OPPONENTS[b])], separation: 3.6 });
  const ais = [a, b].map((x, i) => new KnightAI(sim.knights[i], { style: OPPONENTS[x].style, skill: OPPONENTS[x].skill, aggression: OPPONENTS[x].aggression }));
  sim.settle(1.3);
  let n = 0, bad = 0, worstAll = 0; const seg = {};
  for (let i = 0; i < 60 * secs; i++) {
    for (const ai of ais) ai.update(1 / 60); sim.step(); n++;
    for (const k of sim.knights) {
      let worst = 0, wseg = '';
      for (const ws of k.weapon.body.shapes) {
        if (ws.type !== 'capsule' || ['grip', 'pommel'].includes(ws.userData.part)) continue;
        ws.updateWorld();
        for (const bb of k.ragdoll.list) {
          if (/forearm/.test(bb.name)) continue;      // the hands hold it
          for (const s of bb.shapes) {
            if (s.type === 'box' || s.userData.part === 'hand') continue; s.updateWorld();
            const A = s.type === 'sphere' ? s.wCenter : s.wA, B = s.type === 'sphere' ? s.wCenter : s.wB;
            const d = Math.sqrt(closestPtSegmentSegment(ws.wA, ws.wB, A, B, c1, c2));
            const pen = s.radius + CLOTH + ws.radius - d;
            if (pen > worst) { worst = pen; wseg = bb.name + ':' + (ws.userData.part ?? '?'); }
          }
        }
      }
      if (worst > 0.02) { bad++; const key = wseg + '@' + (k.state ?? '') + '/' + (k.attack?.phase ?? k.mode ?? ''); seg[key] = (seg[key] ?? 0) + 1; }
      worstAll = Math.max(worstAll, worst);
    }
  }
  console.log(a, b, 'frames with own weapon >2cm inside own body/clothes:', (100 * bad / (2 * n)).toFixed(1) + '%', 'worst', (worstAll * 100).toFixed(1) + 'cm', JSON.stringify(Object.entries(seg).sort((x, y) => y[1] - x[1]).slice(0, 5)));
}
