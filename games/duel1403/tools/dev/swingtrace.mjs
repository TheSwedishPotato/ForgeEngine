// Player swings through the real input path (Knight.swipe with an aim point on
// the opponent, as a click-drag gives), traced phase by phase in the swinger's
// fight frame (x forward, y left, z up). Flags a blade that goes behind him.
// node tools/dev/swingtrace.mjs [system] [weapon-opponent]
import { Vector3 } from 'three';
import { FightSim } from '../../src/game/FightSim.js';
import { OPPONENTS } from '../../src/data/opponents.js';
const f = (O) => ({ name: O.name, items: O.items, weapon: O.weapon, offhand: O.offhand, skill: 0.85, strength: 1.02, height: 1.78, mass: 78 });
const sys = process.argv[2] ?? null, who = process.argv[3] ?? 'fencer';
const dirs = { down: [0, -1], up: [0, 1], 'L→R': [1, 0], 'R→L': [-1, 0], 'down-right': [0.7, -0.7], 'down-left': [-0.7, -0.7], 'up-right': [0.7, 0.7], 'up-left': [-0.7, 0.7] };
const parts = ['head', 'chest'];
let worst = 0, total = 0;
const tip = new Vector3(), hilt = new Vector3(), T = new Vector3();
for (let g = 0; g < 8; g++) for (const part of parts) {
  for (const [name, [dx, dy]] of Object.entries(dirs)) {
    const sim = new FightSim({ fighters: [f(OPPONENTS[who]), f(OPPONENTS.squire)], separation: 2.6 });
    const k = sim.a;
    if (sys === 'half') k.toggleMode(); else if (sys) k.setSystem(sys);
    k.setGuard(g); if (k.guardIndex !== g) continue;
    sim.settle(1.3);
    const aimBody = sim.b.b[part] ?? sim.b.b.chest;
    const a = k.swipe(dx, dy, aimBody.pos.clone(), part);
    if (!a) { console.log(part, name, 'no blow'); continue; }
    const rows = {}; let behind = 0, n = 0, reached = Infinity;
    for (let i = 0; i < 90 && k.attack === a; i++) {
      sim.step();
      const W = k.weapon;
      W.worldPoint(W.tipY, tip); W.worldPoint(W.gripY.R ?? W.grips.main, hilt);
      const p = k.toFightFrame(tip, T);
      const ph = a.phase;
      (rows[ph] ??= { minX: 9, maxX: -9, n: 0 });
      rows[ph].minX = Math.min(rows[ph].minX, p.x); rows[ph].maxX = Math.max(rows[ph].maxX, p.x); rows[ph].n++;
      n++; if (p.x < -0.3 && p.z < 1.95) behind++;   // the tip behind his back below the crown of the head
      reached = Math.min(reached, tip.distanceTo(aimBody.pos));
    }
    total++; if (behind > 2) worst++;
    const s = Object.entries(rows).map(([ph, r]) => `${ph}:${r.minX.toFixed(2)}..${r.maxX.toFixed(2)}`).join(' ');
    if (behind > 2 || process.env.ALL) console.log(`g${g} ${k.guard?.name ?? ''} ${part.padEnd(6)} ${name.padEnd(10)} ${a.name.padEnd(22)} ${s}  behind ${behind}/${n}  closest ${reached.toFixed(2)}m`);
  }
}
console.log(`${worst}/${total} blows put the tip behind the body for more than 2 frames`);
