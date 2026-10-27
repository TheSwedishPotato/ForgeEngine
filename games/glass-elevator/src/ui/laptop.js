/**
 * The service laptop, plugged into the controller, the drive or the car's panel: what a
 * lift engineer's service tool shows. The fault log (the controller's event buffer, newest first,
 * with codes), the active faults, the safety chain contact by contact, live values, and the few
 * commands a technician has: clear the log, reset faults, re-learn the encoder, reset the governor.
 */
import { fmt } from '../sim.js';
import { floorY } from '../data/spec.js';

// event text -> fault code (this installation's own numbering)
const CODES = [
  [/Emergency stop/, 'E101', 'Emergency stop'],
  [/Governor overspeed switch/, 'E201', 'Overspeed switch'],
  [/Governor tripped/, 'E202', 'Governor tripped'],
  [/Safety gear set/, 'E203', 'Safety gear set'],
  [/Unintended car movement/, 'E301', 'UCM detected'],
  [/Overload/, 'E401', 'Overload'],
  [/reopening/, 'E502', 'Door reopen'],
  [/Nudging/, 'E503', 'Door nudging'],
  [/lock contact stays open|force/, 'E504', 'Landing door forced'],
  [/did not lift/, 'E601', 'Brake lift fault'],
  [/slipping/, 'E701', 'Rope slip'],
  [/struck its buffer/, 'E702', 'Buffer strike'],
  [/parted/, 'E703', 'Hoist rope parted'],
  [/mains supply lost/, 'E801', 'Mains failure'],
  [/Automatic rescue/, 'E802', 'Rescue run'],
  [/Trap door open/, 'E505', 'Roof trap door open'],
];

export class Laptop {
  constructor(game) {
    this.game = game;
    this.cleared = -1;
    const el = (this.el = document.createElement('div'));
    el.className = 'laptop'; el.hidden = true;
    document.getElementById('ui').append(el);
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const a = e.target.closest('[data-a]')?.dataset.a, s = game.sim;
      if (a === 'close') el.hidden = true;
      if (a === 'clear') { this.cleared = s.log.length ? s.log[s.log.length - 1].t : s.clock; s.ctl.resetFaults(); s.say('Service tool: fault log cleared, faults reset.', 'Laptop'); }
      if (a === 'encoder') { const f = s.drive.fault; s.drive.fault = null; s.say(f ? 'Service tool: encoder offset re-learnt, drive fault cleared.' : 'Service tool: encoder re-learnt (it was fine).', 'Laptop'); }
      if (a === 'gov') s.say(s.hoist.resetGovernor() ? 'Service tool: governor reset.' : 'Service tool: the car must stand still.', 'Laptop');
      this.render();
    });
    setInterval(() => { if (!el.hidden) this.render(); }, 400);
  }

  open(where) { this.where = where; this.el.hidden = false; document.exitPointerLock?.(); this.render(); }

  render() {
    const s = this.game.sim, h = s.hoist, c = s.ctl, d = s.doors, dr = s.drive;
    const log = s.log.filter((l) => l.t > this.cleared).map((l) => { const k = CODES.find(([re]) => re.test(l.text)); return k ? { t: l.t, code: k[1], name: k[2], text: l.text } : null; }).filter(Boolean).reverse().slice(0, 14);
    const active = [];
    if (dr.fault) active.push(['E901', 'Drive: encoder signal implausible (speed feedback 60 %)']);
    if (h.brakes.some((b) => b.fail)) active.push(['E602', 'Brake: holding torque test failed (linings)']);
    if (d.curtainFail) active.push(['E505', 'Light curtain: no beams received']);
    const smashed = this.game.controls.list.filter((k) => k.broken).length;
    if (smashed) active.push(['E810', `Damaged devices: ${smashed} (no response)`]);
    if (c.inputs.lwBypass) active.push(['W110', 'Load weighing bypassed (overload ignored)']);
    if (h.ropesLeft < 8) active.push(['E703', `Hoist ropes: ${h.ropesLeft} of 8 (rope monitor)`]);
    d.landing.forEach((L, n) => { if (L?.broken) active.push(['E504', `Landing door ${n}: lock contact open (forced)`]); });
    if (h.gov.tripped) active.push(['E202', 'Governor tripped: reset required']);
    if (h.sg.set) active.push(['E203', 'Safety gear set: move car up on EEO to release']);
    if (c.faults.ucm) active.push(['E301', 'UCM lockout: reset required']);
    const chain = c.chainList.map(([, label, ok]) => `<li class="${ok ? 'ok' : 'bad'}">${ok ? 'closed' : 'OPEN'} · ${label}</li>`).join('');
    const where = { controller: 'Controller (machine room)', drive: 'Drive (inverter)', car: 'Car operating panel (service port)' }[this.where] ?? '';
    this.el.innerHTML = `<div class="bar"><b>Service tool</b> · ${where}<button data-a="close">Close</button></div>
      <div class="cols"><section><h4>Active faults</h4>${active.length ? active.map(([k, t]) => `<p><code>${k}</code> ${t}</p>`).join('') : '<p class="ok">None</p>'}
      <h4>Fault log (newest first)</h4>${log.length ? log.map((l) => `<p title="${l.text.replace(/"/g, '')}"><code>${l.code}</code> ${fmt(l.t)} ${l.name}</p>`).join('') : '<p class="dim">Empty</p>'}</section>
      <section><h4>Live</h4><p>Mode ${c.mode} · phase ${c.phase} · floor ${c.floor} (${((h.yc - floorY(c.floor)) * 1000).toFixed(1)} mm)</p>
      <p>Speed ${h.vc.toFixed(3)} m/s · ref ${(dr.dir * dr.v).toFixed(3)} · torque ${(h.motor.torque / 1000).toFixed(2)} kN·m</p>
      <p>Load ${Math.round(c.loadKg)} kg · brakes ${h.brakes.map((b) => (b.lift >= 1 ? 'open' : 'set')).join('/')} · doors ${c.door} ${Math.round(d.car.x * 100)} %</p>
      <h4>Safety chain ${c.chainOK ? '<span class="ok">made</span>' : '<span class="bad">open</span>'}</h4><ul>${chain}</ul></section></div>
      <div class="bar"><button data-a="clear">Clear log + reset faults</button><button data-a="encoder">Re-learn encoder</button><button data-a="gov">Reset governor</button></div>`;
  }
}
