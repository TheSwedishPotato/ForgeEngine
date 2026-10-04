import { FightSim } from '../../src/game/FightSim.js';
import { PRESETS } from '../../src/data/armour.js';
import { Vector3 } from 'three';
const [weapon = 'longsword', guard = 'langort', sep = '1.75', mode = ''] = process.argv.slice(2);
const sim = new FightSim({ separation: Number(sep), fighters: [{ weapon, items: PRESETS.blossfechten.items }, { weapon: 'longsword', items: PRESETS.blossfechten.items }] });
if (mode === 'half') sim.a.toggleMode();
sim.a.setGuardById(guard);
sim.settle(1.5);
const W = sim.a.weapon, D = sim.a.drive;
const ax = new Vector3(), tip = new Vector3(), v = new Vector3();
const f = (x) => x.toArray().map((q) => q.toFixed(2)).join(',');
console.log('guard', sim.a.guard.name, 'tip', f(W.worldPoint(W.tipY, tip)), 'axis', f(W.axis(ax)), 'B chest', f(sim.b.b.chest.pos));
sim.damage.on((e) => { if (e.type === 'hit') console.log('HIT', e.kind, e.zone, e.energy.toFixed(0), e.text); });
const a = sim.a.thrust(sim.b.b.chest.pos.clone());
console.log('thrust', a.name, 'stepIn', a.stepIn.toFixed(2), 'durPrep', a.durPrep.toFixed(2), 'durMain', a.durMain.toFixed(2), 'D', f(a.D));
for (let i = 0; i < 40; i++) {
  sim.step();
  W.worldPoint(W.tipY, tip);
  W.body.velocityAt(tip, v);
  W.axis(ax);
  console.log(i, sim.a.attack?.phase, 'tip', f(tip), 'tipV', v.length().toFixed(1), 'vAlongAxis', v.dot(ax).toFixed(1), 'grips', Object.keys(W.joints).join(''));
}
