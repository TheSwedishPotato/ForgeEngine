import { FightSim } from '/home/user/ForgeEngine/games/duel1403/src/game/FightSim.js';
import { PRESETS } from '/home/user/ForgeEngine/games/duel1403/src/data/armour.js';
import { Vector3 } from 'three';
for (const [w, kit] of [['longsword', 'knight'], ['longsword', 'blossfechten'], ['poleaxe', 'knight'], ['messer', 'blossfechten']]) {
  const sim = new FightSim({ fighters: [{ weapon: w, items: PRESETS[kit].items }, { weapon: 'longsword', items: PRESETS.blossfechten.items }], separation: 3.6 });
  sim.settle(2);
  for (let i = 0; i < 60; i++) sim.step();
  const k = sim.a;
  const up = new Vector3(0, 1, 0);
  const lean = (b) => { const u = up.clone().applyQuaternion(b.q); return Math.atan2(u.dot(k.forward), u.y) * 180 / Math.PI; };
  const pel = k.b.pelvis.pos, ch = k.b.chest.pos, hd = k.b.head.pos;
  const fwdOff = (p) => p.clone().sub(k.center).dot(k.forward).toFixed(2);
  console.log(`${w}/${kit} guard=${k.guard.id ?? k.guard.name} lean pelvis ${lean(k.b.pelvis).toFixed(0)}° chest ${lean(k.b.chest).toFixed(0)}° head ${lean(k.b.head).toFixed(0)}°  fwd: pelvis ${fwdOff(pel)} chest ${fwdOff(ch)} head ${fwdOff(hd)}  feet L ${fwdOff(k.feet.L.pos)} R ${fwdOff(k.feet.R.pos)}`);
}
