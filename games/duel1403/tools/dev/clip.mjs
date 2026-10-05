import { Vector3 } from 'three';
import { FightSim } from '../../src/game/FightSim.js';
import { KnightAI } from '../../src/game/AI.js';
import { OPPONENTS } from '../../src/data/opponents.js';
import { closestPtSegmentSegment } from '../../src/physics/math.js';
const f = (o) => ({ name: o.name, items: o.items, weapon: o.weapon, offhand: o.offhand, skill: o.skill, height: o.body.height, mass: o.body.mass });
const pairs = [['knight','fencer'],['squire','mercenary'],['fencer','militia'],['condottiere','knight']];
const c1 = new Vector3(), c2 = new Vector3();
for (const [a,b] of pairs) {
  const sim = new FightSim({ fighters: [f(OPPONENTS[a]), f(OPPONENTS[b])], separation: 3.6 });
  const ais = [new KnightAI(sim.a,{style:OPPONENTS[a].style,skill:OPPONENTS[a].skill,aggression:OPPONENTS[a].aggression}), new KnightAI(sim.b,{style:OPPONENTS[b].style,skill:OPPONENTS[b].skill,aggression:OPPONENTS[b].aggression})];
  sim.settle(1.3);
  const tally={}; let n=0, close=0, overlap=0, selfIn=0, minD=9;
  for (let i=0;i<60*25;i++){ for(const ai of ais) ai.update(1/60); sim.step(); n++;
    const d = sim.a.center.distanceTo(sim.b.center); minD=Math.min(minD,d); if (d<0.8) close++;
    // torso overlap: chest capsules
    const A=sim.a.b.chest.pos, B=sim.b.b.chest.pos; if (A.distanceTo(B)<0.36) overlap++;
    for (const k of sim.knights){ const W=k.weapon; const g0=(W.gripY?.R ?? W.grips.main); const p=W.worldPoint(W.tipY,new Vector3()), q=W.worldPoint(g0+0.15*(W.tipY-g0),new Vector3());
      for (const bn of ['chest','abdomen']) for (const s of k.b[bn].shapes){ if(s.type!=='capsule')continue; s.updateWorld(); const d2=closestPtSegmentSegment(p,q,s.wA,s.wB,c1,c2); if (d2 < (s.radius-0.03)**2){selfIn++; const key=(k.attack?k.attack.name+'/'+k.attack.phase:k.parrying?'parry':'guard '+(k.guard?.id??k.guard?.name))+' '+k.weapon.mode; tally[key]=(tally[key]??0)+1;} } }
  }
  console.log(Object.entries(tally).sort((x,y)=>y[1]-x[1]).slice(0,6)); console.log(a,b,'minDist',minD.toFixed(2),'close%',(100*close/n).toFixed(1),'chestOverlap%',(100*overlap/n).toFixed(1),'selfBladeInTorso%',(100*selfIn/n/2).toFixed(1));
}
