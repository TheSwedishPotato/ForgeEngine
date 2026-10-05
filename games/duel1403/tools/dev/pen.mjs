import { Vector3 } from 'three';
import { FightSim } from '../../src/game/FightSim.js';
import { KnightAI } from '../../src/game/AI.js';
import { OPPONENTS } from '../../src/data/opponents.js';
import { closestPtSegmentSegment } from '../../src/physics/math.js';
const f = (o) => ({ name: o.name, items: o.items, weapon: o.weapon, offhand: o.offhand, skill: o.skill, height: o.body.height, mass: o.body.mass });
const c1 = new Vector3(), c2 = new Vector3();
for (const [a,b] of [['knight','fencer'],['squire','mercenary'],['fencer','militia'],['condottiere','knight']]) {
  const sim = new FightSim({ fighters: [f(OPPONENTS[a]), f(OPPONENTS[b])], separation: 3.6 });
  const ais = [a,b].map((x,i)=>new KnightAI(sim.knights[i],{style:OPPONENTS[x].style,skill:OPPONENTS[x].skill,aggression:OPPONENTS[x].aggression}));
  sim.settle(1.3);
  const pens=[]; let deep=0,n=0;
  for (let i=0;i<60*25;i++){ for(const ai of ais) ai.update(1/60); sim.step(); n++;
    for (const k of sim.knights){ const o=k.opponent; let worst=0;
      for (const ws of k.weapon.body.shapes){ if(ws.type!=='capsule')continue; ws.updateWorld();
        for (const bb of o.ragdoll.list) for (const s of bb.shapes){ if(s.type==='box')continue; s.updateWorld();
          const A=s.type==='sphere'?s.wCenter:s.wA, B=s.type==='sphere'?s.wCenter:s.wB;
          const d=Math.sqrt(closestPtSegmentSegment(ws.wA,ws.wB,A,B,c1,c2)); const pen=s.radius+ws.radius-d; if(pen>worst)worst=pen; } }
      if (worst>0) pens.push(worst); if (worst>0.04) deep++; } }
  pens.sort((x,y)=>x-y);
  console.log(a,b,'contacts',pens.length,'median pen cm',(100*(pens[pens.length>>1]??0)).toFixed(1),'p95',(100*(pens[Math.floor(pens.length*0.95)]??0)).toFixed(1),'max',(100*(pens.at(-1)??0)).toFixed(1),'deep>4cm frames%',(100*deep/n).toFixed(1));
}
