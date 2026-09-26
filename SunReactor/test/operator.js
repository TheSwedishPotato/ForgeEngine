'use strict';
// Scripted operator that performs OP-101 (plant start-up) from IC-1 using only the
// switches and commands available on the benchboards. Shared by the tests.
const E = require('../js/engine.js');

function run(s, seconds, until, dt = 0.05) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    E.step(s, dt);
    if (until && until(s)) return true;
  }
  return !until;
}

function startup(s, log = () => {}) {
  const must = (ok, what) => { if (!ok) throw new Error('Start-up stalled at: ' + what + ' (t=' + s.t.toFixed(0) + ' s)'); log(what, s); };
  // 1. auxiliaries
  s.vac.pumpCmd = true;
  s.mag.cryoCmd = true;
  s.htx.pumpACmd = s.htx.pumpBCmd = true;
  s.htx.cwCmd = true; s.htx.fwACmd = s.htx.fwBCmd = true; s.htx.fwAuto = true;
  s.tri.ispCmd = true;
  s.safety.dmsArmed = true;
  must(run(s, 300, x => x.mag.coilT < 22.5), 'magnets cold');
  // 2. toroidal field
  s.mag.tfCmd = true;
  must(run(s, 200, x => x.mag.BT >= 3.55), 'TF at 3.6 T');
  s.mag.vsCmd = true;
  must(E.command(s, 'premag').ok, 'premag accepted');
  must(run(s, 60, x => x.mag.flux >= 215), 'CS charged');
  // 3. prefill + EC assist
  s.vac.prefillCmd = true;
  s.heat.ecCmd = true; s.heat.ecSet = 5;
  must(run(s, 60, x => x.vac.P > 1.5e-3 && x.heat.ecP >= 2), 'prefill in window');
  must(E.command(s, 'initiate').ok, 'breakdown');
  // 4. current ramp in deuterium
  s.fuel.blend = 'DD'; s.fuel.auto = true; s.fuel.nG = 0.4;
  s.pl.IpSet = 23; s.pl.ramp = 0.25;
  must(run(s, 60, x => x.pl.Ip >= 8), 'Ip 8 MA');
  s.heat.nbiCmd = true; s.heat.nbiSet = 25;
  s.heat.icCmd = true; s.heat.icSet = 20;
  s.heat.ecSet = 15;
  must(run(s, 200, x => x.pl.hmode), 'H-mode');
  s.heat.rmpCmd = true; s.fuel.seed = 50; s.fuel.pelletCmd = true; s.fuel.pumpSpeed = 80;
  must(run(s, 120, x => x.pl.Ip >= 22.9), 'Ip flat-top');
  // 5. D-T burn
  s.fuel.blend = 'DT'; s.fuel.tFrac = 0.5; s.fuel.nG = 0.7;
  must(run(s, 120, x => x.d.Pfus > 1000e6), 'burning plasma');
  // hold fusion power low until the generator can take the steam (dump capacity is 50 %)
  s.pl.burnAuto = true; s.pl.PfusSet = 600;
  s.heat.icCmd = false;
  // 6. steam and turbine
  s.htx.msivCmd = true;
  must(run(s, 400, x => x.htx.sgP > 6.8), 'steam pressure');
  must(E.command(s, 'turbReset').ok, 'turbine latched');
  must(E.command(s, 'runup').ok, 'run-up');
  must(run(s, 240, x => x.tg.rpm > 2990), 'turbine at speed');
  s.tg.excCmd = true;
  must(E.command(s, 'autoSync').ok, 'auto-sync engaged');
  must(run(s, 120, x => x.tg.breaker), 'synchronised');
  s.tg.unitAuto = true;
  must(run(s, 600, x => Math.abs(x.d.Pnet - x.grid.D) < 25), 'following demand');
  return s;
}

module.exports = { run, startup };
