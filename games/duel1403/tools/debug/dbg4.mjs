import { FightSim } from '../../src/game/FightSim.js';
import { PRESETS } from '../../src/data/armour.js';
import { Vector3 } from 'three';
const [weapon = 'longsword', guard = 'halbAchsel', mode = 'half', preset='knight'] = process.argv.slice(2);
const sim = new FightSim({ separation: 2.4, fighters: [{ weapon, items: PRESETS[preset].items }, { weapon: 'longsword', items: PRESETS.blossfechten.items }] });
if (mode === 'half') sim.a.toggleMode();
sim.a.setGuardById(guard);
const W = sim.a.weapon, k = sim.a;
const f = (x) => x.toArray().map((q) => q.toFixed(2)).join(',');
const ax = new Vector3(), h = new Vector3(), t = new Vector3();
for (let i = 0; i < 120; i++) {
  sim.step();
  if (i % 10 === 0) {
    const ap = k.actualPose(new Vector3(), new Vector3(), new Vector3());
    console.log(i, 'grips', JSON.stringify(W.gripY), 'joints', Object.keys(W.joints).join(''), 'pending', !!W.pending, 'cmdHand', f(k.cmd.hand), 'actHand', f(ap.hand), 'cmdDir', f(k.cmd.dir), 'actDir', f(ap.dir), 'drive k', k.drive.k, 'maxF', k.drive.maxF.toFixed(0));
  }
}
