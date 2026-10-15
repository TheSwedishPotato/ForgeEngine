// The crew working the boat by hand: a dive and a surfacing from start to finish, nothing set
// but by their hands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim.js';
import { FT } from '../src/data/boat.js';
import { levelRoute } from '../src/crew/person.js';

const said = (sim, re) => sim.log.some((l) => re.test(l.text));

test('the ladders between the levels', () => {
  assert.deepEqual(levelRoute('bridge', 'pump').map((l) => l.id), ['bridgeLadder', 'ctLadder', 'pumpLadder']);
  assert.deepEqual(levelRoute('obs', 'ct').map((l) => l.id), ['obsLadder', 'ctLadder']);
});

test('the crew dives the boat to periscope depth and trims her', () => {
  const sim = new Sim({ start: 'dive', wind: 2 });
  sim.advance(5);
  sim.crew.order('dive', { depth: 60 * FT });
  let t60 = null;
  for (let t = 0; t < 360; t++) { sim.advance(1); if (t60 == null && sim.plant.g.depth > 55) t60 = t; }
  assert.ok(said(sim, /Clear the bridge/), 'the OOD cleared the bridge');
  assert.ok(said(sim, /Hatch secured/), 'the hatch was shut');
  assert.ok(said(sim, /Straight board/), 'a straight board');
  assert.ok(said(sim, /Pressure in the boat, holding/), 'the bleed held');
  assert.ok(t60 != null && t60 < 90, `periscope depth in ${t60} s`);
  assert.ok(Math.abs(sim.plant.g.depth - 60) < 4, `holding ${sim.plant.g.depth.toFixed(1)} ft`);
  assert.equal(sim.plant.ctl['hatch.ctUpper'], 0);
  assert.ok(sim.plant.board?.length !== 0);
  assert.ok((sim.plant.g.tanks.negative ?? 0) < 100, 'negative blown to the mark');
});

test('the crew surfaces her, opens the hatch and starts the diesels', () => {
  const sim = new Sim({ start: 'submerged', wind: 2 });
  sim.advance(5);
  sim.crew.order('surface');
  for (let t = 0; t < 420; t++) sim.advance(1);
  assert.ok(sim.plant.g.depth < 20, `on the surface (${sim.plant.g.depth.toFixed(1)} ft)`);
  assert.ok(sim.plant.ctl['hatch.ctUpper'] > 0.9, 'the upper hatch open');
  assert.ok(sim.plant.g.hpManifold > 1600, `the banks spared (${sim.plant.g.hpManifold.toFixed(0)} psi)`);
  sim.crew.order('dieselPropulsion', { charge: true });
  for (let t = 0; t < 150; t++) sim.advance(1);
  const running = sim.plant.engines.filter((e) => e.state === 'running').length;
  assert.equal(running, 4, 'all four engines running');
  assert.ok(sim.plant.g.amps.fwdBat < -500, 'the battery charging');
});
