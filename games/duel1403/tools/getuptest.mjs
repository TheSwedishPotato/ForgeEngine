// Knocks each kit's knight flat, then checks he can get up and fight on.
import { FightSim } from '../src/game/FightSim.js';
import { PRESETS } from '../src/data/armour.js';
let fails = 0;
for (const kit of Object.keys(PRESETS)) for (const weapon of ['longsword', 'poleaxe', 'messer']) {
  const sim = new FightSim({ fighters: [{ weapon, items: PRESETS[kit].items, name: 'A' }, { weapon: 'longsword', items: PRESETS.blossfechten.items, name: 'B' }], separation: 6 });
  sim.settle(1.2);
  const k = sim.a;
  // shove him over backwards
  for (const b of k.ragdoll.list) b.vel.addScaledVector(k.forward, -3.5).setY(b.vel.y + 0.5);
  k.knockDown('thrown');
  let t = 0, getups = 0, falls = 0, upAt = null;
  k.onDown = () => falls++;
  for (let i = 0; i < 60 * 12; i++) {
    if (k.state === 'down' && k.canGetUp() && k.downTime > 2.2) { k.startGetUp(); getups++; }
    sim.step(); t += 1 / 60;
    if (k.state === 'fight' && upAt === null) upAt = t;
  }
  const ok = k.state === 'fight' && k.b.pelvis.pos.y > 0.7;
  if (!ok) fails++;
  console.log(`${kit.padEnd(12)} ${weapon.padEnd(9)} ${ok ? 'UP  ' : 'FAIL'} state=${k.state} getups=${getups} refalls=${falls} up@${upAt?.toFixed(1)}s pelvisY=${k.b.pelvis.pos.y.toFixed(2)}`);
}
process.exit(fails ? 1 : 0);
