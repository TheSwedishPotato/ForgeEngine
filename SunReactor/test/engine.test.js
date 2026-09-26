'use strict';
// Run with:  node --test SunReactor/test
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');
const { run, startup } = require('./operator.js');

const close = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel;

test('Bosch–Hale D-T reactivity matches the published table', () => {
  // Bosch & Hale (1992) Table VIII: <σv> in cm³/s
  assert.ok(close(E.sigmavDT(10) * 1e6, 1.136e-16, 0.01));
  assert.ok(close(E.sigmavDT(20) * 1e6, 4.330e-16, 0.01));
  assert.ok(close(E.sigmavDDn(10) * 1e6, 6.023e-19, 0.01));
  assert.ok(close(E.sigmavDDp(10) * 1e6, 5.781e-19, 0.01));
});

test('solar p-p reactivity reproduces the Sun core power density', () => {
  const sv = E.sigmavPP(E.SUN.coreT_keV);
  const np = 3.05e31;
  const P = 0.5 * np * np * sv * 13.1 * 1.602176634e-13;   // ~13.1 MeV deposited per p-p step of the chain
  assert.ok(close(P, E.SUN.corePowerDensity, 0.05), 'got ' + P);
});

test('a protium plasma at reactor conditions makes essentially no fusion power', () => {
  const s = E.createState(3);
  s.fuel.blend = 'HH';
  s.pl.NH = s.pl.ND + s.pl.NT; s.pl.ND = 0; s.pl.NT = 0;
  E.derive(s);
  assert.ok(s.d.Pfus < 1e-6, 'p-p fusion power ' + s.d.Pfus + ' W');
  assert.ok(s.d.T > 5, 'plasma is still hot');
});

test('IC-3 holds a steady D-T burn and follows Solhavn demand for an hour', () => {
  const s = E.createState(3);
  assert.ok(s.pl.on && s.pl.hmode && s.tg.breaker);
  let worst = 0;
  for (let k = 0; k < 60; k++) {
    run(s, 60);
    assert.ok(s.pl.on, 'plasma lost: ' + JSON.stringify(s.events.slice(-3)));
    worst = Math.max(worst, Math.abs(s.d.Pnet - s.grid.D));
  }
  assert.ok(s.d.Pfus > 1.2e9 && s.d.Pfus < 2.6e9, 'fusion power ' + s.d.Pfus / 1e6 + ' MW');
  assert.ok(s.d.Q > 20, 'Q ' + s.d.Q);
  assert.ok(worst < 60, 'worst dispatch error ' + worst.toFixed(0) + ' MW');
  assert.equal(s.grid.shedBlocks, 0);
  assert.ok(Math.abs(s.grid.f - 50) < 0.1);
});

test('OP-101 cold start from IC-1 reaches a synchronised, load-following plant', () => {
  const s = E.createState(1);
  startup(s);
  assert.ok(s.pl.on && s.pl.hmode);
  assert.ok(s.tg.breaker);
  assert.ok(s.d.Pnet > 200);
  assert.equal(s.pl.dCount, 0, 'no disruptions during start-up');
});

test('breakdown is inhibited until every permissive is met', () => {
  const s = E.createState(1);
  const r = E.command(s, 'initiate');
  assert.equal(r.ok, false);
  assert.match(r.msg, /Toroidal field/);
  assert.equal(s.pl.on, false);
});

test('losing vertical control causes a VDE; armed DMS mitigates it', () => {
  const s = E.createState(3);
  s.mag.vsCmd = false;
  run(s, 5, x => !x.pl.on);
  assert.equal(s.pl.on, false);
  assert.match(s.pl.lastDisruption.reason, /VERTICAL/);
  assert.equal(s.pl.lastDisruption.mitigated, true);
  assert.ok(s.dmg.fw < 1, 'mitigated damage ' + s.dmg.fw);
});

test('an unmitigated disruption damages the first wall', () => {
  const s = E.createState(3);
  s.safety.dmsArmed = false;
  s.mag.vsCmd = false;
  run(s, 5, x => !x.pl.on);
  assert.equal(s.pl.lastDisruption.mitigated, false);
  assert.ok(s.dmg.fw > 3, 'damage ' + s.dmg.fw);
});

test('loss of coolant flow trips the plasma through CSS-02', () => {
  const s = E.createState(3);
  s.htx.pumpACmd = false; s.htx.pumpBCmd = false;
  run(s, 60, x => !x.pl.on);
  assert.equal(s.pl.on, false);
  assert.ok(s.events.some(e => /CSS-0[12]/.test(e.text)));
  assert.ok(s.htx.Tfw < 520 + 5);
});

test('a cryoplant trip at full power quenches the TF coils and ends the plasma', () => {
  const s = E.createState(3);
  s.malf.cryo = true;
  run(s, 60, x => x.mag.quench);
  assert.ok(s.mag.quench);
  run(s, 1);
  assert.equal(s.pl.on, false);
  assert.ok(s.dmg.mag > 0);
});

test('a turbine trip opens 52G on reverse power and Solhavn loses districts', () => {
  const s = E.createState(3);
  E.command(s, 'turbTrip');
  run(s, 10);
  assert.equal(s.tg.breaker, false);
  assert.ok(s.events.some(e => /reverse power/.test(e.text)));
  assert.ok(s.grid.f < 50);
  assert.ok(s.pl.on, 'plasma rides through on the steam dump');
});

test('the sync-check relay blocks an out-of-phase breaker closure', () => {
  const s = E.createState(3);
  E.command(s, 'breakerOpen');
  run(s, 1);
  s.tg.phase = 120;
  const r = E.command(s, 'breakerClose');
  assert.equal(r.ok, false);
  assert.match(r.msg, /SYNC CHECK/);
});

test('the simulation is deterministic for a given seed', () => {
  const a = E.createState(3), b = E.createState(3);
  run(a, 120); run(b, 120);
  assert.equal(a.d.Pfus, b.d.Pfus);
  assert.equal(a.grid.f, b.grid.f);
});

test('CS flux eventually runs out and the pulse ends with a controlled ramp-down', () => {
  const s = E.createState(3);
  s.mag.flux = 0.2;                    // ~30 s left at the 6 mV flat-top loop voltage
  run(s, 400, x => !x.pl.on);
  assert.equal(s.pl.on, false);
  assert.ok(s.events.some(e => /CS FLUX EXHAUSTED/.test(e.text)));
  assert.ok(s.events.some(e => /ended normally/.test(e.text)));
});
