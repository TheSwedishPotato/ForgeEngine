// Measures blows: node tools/blowtest.mjs [weapon] [distance] [targetPreset]
import { FightSim } from '../src/game/FightSim.js';
import { PRESETS } from '../src/data/armour.js';
import { Vector3 } from 'three';

const [weapon = 'longsword', dist = '1.75', tp = 'blossfechten', ap = 'blossfechten'] = process.argv.slice(2);
const blows = [
  ['zornhau', -1, -1], ['oberL', 1, -1], ['zwerch', -1, 0], ['scheitel', 0, -1], ['unterR', -1, 1], ['thrust'],
];
for (const [label, dx, dy] of blows) {
  const sim = new FightSim({ separation: Number(dist), fighters: [
    { weapon, items: PRESETS[ap].items }, { weapon: 'longsword', items: PRESETS[tp].items } ] });
  sim.settle(1.5);
  sim.b.setParry(false);
  let hit = null, peak = 0, clash = null;
  sim.damage.on((e) => { if (e.type === 'hit' && !hit) hit = e; if (e.type !== 'hit' && !clash) clash = e; });
  const a = label === 'thrust' ? sim.a.thrust() : sim.a.swipe(dx, dy);
  const W = sim.a.weapon;
  const p = new Vector3(), v = new Vector3();
  let tImpact = null;
  for (let i = 0; i < 70; i++) {
    sim.step();
    W.worldPoint(label === 'thrust' ? W.tipY : W.strikeY, p);
    const s = W.body.velocityAt(p, v).length();
    if (!hit) peak = Math.max(peak, s);
    if (hit && tImpact === null) tImpact = sim.time;
  }
  const t = tImpact ? (tImpact - 1.5).toFixed(2) : '-';
  console.log(`${weapon} ${label.padEnd(9)} ${a?.name?.padEnd(18) ?? '-'.padEnd(18)} peak ${peak.toFixed(1)} m/s  t ${t}s  ` +
    (hit ? `E ${hit.energy.toFixed(0)} J v ${hit.speed.toFixed(1)} ${hit.kind} @${hit.zone}: ${hit.text}` : clash ? `${clash.type} ${clash.energy?.toFixed(0)} J` : 'miss'));
}
