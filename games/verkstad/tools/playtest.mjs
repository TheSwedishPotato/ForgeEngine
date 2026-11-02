// A front brake job on a Golf, start to finish, through the game's own hands and tools (headless).
// node tools/playtest.mjs   (with `npm run dev` on port 5190)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT ?? 'playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5190}/?manual=1&q=low&car=golf7&fault=pads_worn:F`);
await page.waitForFunction(() => window.game?.ready, null, { timeout: 180000 });
const out = await page.evaluate(async () => {
  const g = window.game.game, A = g.cust.A, log = [];
  const at = (kind, id, point) => { g.player.target = { kind, id, point: point ?? null, dist: 1 }; };
  const homePoint = (pid) => { const h = g.carGL.homeOf(pid); return h.parent.localToWorld(h.pos.clone()); };
  const turnAll = (pid, tool, socket, dir, setting) => {
    g.selectTool(tool); g.socket = socket; g.dir = dir; if (setting) g.torqueSet = setting;
    for (const fid of A.part(pid).fasteners) {
      at('fast', fid); g.press();
      for (let i = 0; i < 400 && g.turning; i++) { g.player.mouse.down = true; g.player.mouse.dx = 40; g._hold(0.05); }
      g.player.mouse.down = false; g.release();
    }
  };
  const take = (pid) => { g.selectTool('hand'); at('part', pid); g.press(); const ok = !!g.held; if (ok) g._drop(null); return ok; };
  const fit = (pid) => { at('part', pid, homePoint(pid)); g.press(); return !A.part(pid).removed; };
  const pickLoose = (pid) => { const l = g.loose.find((x) => x.partId === pid && x !== g.held); if (!l) throw new Error('no loose ' + pid); at('loose', l.id); g.press(); return !!g.held; };
  try {
  // 1. the customer: an estimate
  const est = await g.cust.propose(g.brain, 'estimate', [{ text: 'Front brake pads', sek: 580 }, { text: 'Labour 1 h', sek: 1095 }], 1675);
  log.push(`estimate: ${est.accept ? 'accepted' : 'declined'} — ${est.says}`);
  log.push(`pads before: ${['padOFL', 'padIFL'].map((p) => A.part(p).cond.mm.toFixed(1)).join(', ')} mm`);
  // 2. the lift: four arms under, then up
  for (let i = 0; i < 4; i++) g._world('arm' + i);
  g.workshop.lift.y = 1.3; for (let i = 0; i < 5; i++) g.frame(0.05);
  log.push(`car on the lift: ${g.carLift().toFixed(2)} m up, FL raised ${A.state.raised.FL}`);
  // 3. the wheel: the impact gun (17 mm), then off
  turnAll('wheelFL', 'impact', 17, -1);
  log.push(`wheel bolts out: ${A.part('wheelFL').fasteners.every((f) => A.fast(f).out)}`);
  log.push(`wheel off: ${take('wheelFL')}`);
  // 4. the caliper's guide bolts (13 mm), the caliper, the pads
  turnAll('caliperFL', 'ratchet', 13, -1);
  log.push(`caliper off: ${take('caliperFL')}; pads out: ${take('padOFL')} ${take('padIFL')}`);
  // 5. new pads from the shelf, the old caliper back, its bolts to 28 N·m
  g.takeNew('padOFL'); log.push(`new outer pad fitted: ${fit('padOFL')}`);
  g.takeNew('padIFL'); log.push(`new inner pad fitted: ${fit('padIFL')}`);
  pickLoose('caliperFL'); log.push(`caliper back: ${fit('caliperFL')}`);
  turnAll('caliperFL', 'torque', 13, 1, 28);
  log.push(`guide bolts: ${A.part('caliperFL').fasteners.map((f) => Math.round(A.fast(f).clamp)).join(', ')} N·m`);
  // 6. the wheel back, bolts to 120 N·m with the torque wrench (the car on the ground for that? on the lift with a brick on the brake)
  pickLoose('wheelFL'); log.push(`wheel back: ${fit('wheelFL')}`);
  A.state.brakePedal = 1;
  turnAll('wheelFL', 'torque', 17, 1, 120);
  log.push(`wheel bolts: ${A.part('wheelFL').fasteners.map((f) => Math.round(A.fast(f).clamp)).join(', ')} N·m`);
  A.state.brakePedal = 0;
  // the other side the same way
  turnAll('wheelFR', 'impact', 17, -1); take('wheelFR'); turnAll('caliperFR', 'ratchet', 13, -1); take('caliperFR'); take('padOFR'); take('padIFR');
  g.takeNew('padOFR'); fit('padOFR'); g.takeNew('padIFR'); fit('padIFR'); pickLoose('caliperFR'); fit('caliperFR'); turnAll('caliperFR', 'torque', 13, 1, 28);
  pickLoose('wheelFR'); fit('wheelFR'); A.state.brakePedal = 1; turnAll('wheelFR', 'torque', 17, 1, 120); A.state.brakePedal = 0;
  g.workshop.lift.y = 0.08; for (let i = 0; i < 5; i++) g.frame(0.05);
  // 7. hand it back
  const a = g.cust.assess();
  log.push(`faults left: ${a.left.map((r) => r.id).join(', ') || 'none'}; loose fasteners: ${a.audit.bad.length}; road test: ${a.now.map((o) => o.what).join(' / ') || 'nothing'}`);
  g.clock += 3600;
  const v = await g.handOver([{ text: 'Front brake pads (pair)', sek: 580 }, { text: 'Labour 1.0 h', sek: 1095 }], 'New front pads, guide bolts and wheel bolts torqued to spec.');
  log.push(`verdict: ${v.stars} stars, paid ${v.pays_sek} — ${v.says}`);
  } catch (e) { log.push('ERROR ' + e.message); }
  log.push(...g.log.slice(-8).map((l) => '  · ' + l.text));
  return log;
});
console.log(out.join('\n'));
console.log(errors.slice(0, 10).join('\n') || 'no errors');
await browser.close();
