// Headless jousts, AI against AI: what the lances do, who stays in the saddle.
//   node tools/jousttest.mjs [jousts=6] [seed=1] [verbose]
import { JoustSim, seeded } from '../src/joust/JoustSim.js';
import { JoustAI } from '../src/joust/JoustAI.js';
import { JOUSTERS } from '../src/data/joust.js';

const N = Number(process.argv[2] ?? 6), seed0 = Number(process.argv[3] ?? 1), verbose = process.argv[4] === 'v', noBrace = process.argv.includes('nobrace');
const tally = { courses: 0, strikes: 0, breaks: 0, helmBreaks: 0, attaints: 0, misses: 0, fouls: 0, unhorse: 0, unhelm: 0, nan: 0, forces: [], impulses: [], speeds: [], ends: {} };
const t0 = performance.now();
let steps = 0;
for (let k = 0; k < N; k++) {
  const A = JOUSTERS[k % JOUSTERS.length], B = JOUSTERS[(k + 1 + Math.floor(k / JOUSTERS.length)) % JOUSTERS.length];
  const sim = new JoustSim({ riders: [{ ...A }, { ...B }], seed: seed0 * 1000 + k, saddle: process.argv.includes('war') ? 'war' : 'hohenzeug' });
  const rand = seeded(seed0 * 77 + k);
  const ais = sim.riders.map((r, i) => new JoustAI(sim, r, { aim: [A, B][i].aim, rand }));
  sim.on((e) => {
    if (e.type === 'break') { tally.breaks++; tally.forces.push(e.force); tally.impulses.push(e.impulse); tally.speeds.push(e.speed); if (e.zone === 'head') tally.helmBreaks++; }
    if (e.type === 'unhorse') tally.unhorse++;
    if (e.type === 'unhelm') tally.unhelm++;
    if (e.type === 'score') for (const r of e.results) { tally.courses += 0.5; if (!r.strike) tally.misses++; else { tally.strikes++; if (!r.strike.broke && r.strike.kind !== 'foul') tally.attaints++; if (r.strike.kind === 'foul') tally.fouls++; } }
    if (verbose && e.type !== 'course' && e.type !== 'charge') console.log(`  t=${e.t.toFixed(2)} ${e.type}`, e.type === 'score' ? e.results.map((r) => `${r.rider.name}: ${r.text} (${r.pts})${r.strike ? ` F=${(r.strike.force / 1000).toFixed(1)}kN J=${r.strike.impulse.toFixed(0)}Ns v=${r.strike.speed.toFixed(1)} ${r.strike.zone}` : ''}`).join(' | ') : e.type === 'unhorse' ? `${e.rider.name} (${e.cause})` : e.type === 'break' ? `${e.rider.name} on ${e.zone} ${(e.force / 1000).toFixed(1)} kN ${e.how}` : e.type === 'end' ? `${e.winner?.name ?? 'none'} ${e.how}` : '');
    if (e.type === 'end') tally.ends[e.how] = (tally.ends[e.how] ?? 0) + 1;
  });
  let maxDisp = 0, maxBack = 0;
  if (noBrace) for (const ai of ais) ai.braced = true, ai._newCourse = ((f) => function () { f.call(this); this.braceLead = -1; })(ai._newCourse);
  for (let i = 0; i < 60 * 120 && !(sim.over && sim.phaseT > 3); i++) {
    for (const ai of ais) ai.update();
    sim.step();
    steps++;
    for (const r of sim.riders) {
      for (const b of r.ragdoll.list) if (!Number.isFinite(b.pos.x)) { tally.nan++; break; }
      if (r.seated) { maxDisp = Math.max(maxDisp, r.displacement().seat); maxBack = Math.max(maxBack, r.displacement().back); }
    }
  }
  console.log(`${A.name} v ${B.name}: ${sim.a.score.points}-${sim.b.score.points} after ${sim.course} courses, winner ${sim.winner?.name ?? '-'}; max seat displacement ${(maxDisp * 100).toFixed(0)} cm, back ${(maxBack * 57.3).toFixed(0)} deg`);
}
const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : 0);
console.log('\nper rider-course:', JSON.stringify({ ...tally, forces: undefined, impulses: undefined, speeds: undefined }));
console.log(`breaks: median force ${(med(tally.forces) / 1000).toFixed(1)} kN, impulse ${med(tally.impulses).toFixed(0)} N s, closing ${med(tally.speeds).toFixed(1)} m/s`);
console.log(`${steps} steps in ${((performance.now() - t0) / 1000).toFixed(1)} s (${((performance.now() - t0) / steps).toFixed(2)} ms/step)`);
