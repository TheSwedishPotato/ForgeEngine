/**
 * The repair guide (K, or the Guide button): a troubleshooting assistant that reads the elevator as
 * an engineer's service tool would, finds what keeps it out of service, and shows the next step of
 * the repair: what to do, with which tool, and where. A bouncing arrow stands over the very thing to
 * work on, and an arrow at the edge of the screen points the way when it is out of sight.
 *
 * The order is the order a lift engineer works in: make it safe first (lock out the main switch
 * before the ropes or the brakes), repair, reset the safety devices (governor, then free the safety
 * gear by moving the car up on emergency electrical operation), clear the faults, put every switch
 * back to normal (and take your own tools out: no wedge, no padlock left behind), then return it to
 * service. Each step is checked against the elevator itself, so the guide moves on when it is done.
 */
import { Group, Mesh, MeshBasicMaterial, Color, Vector3 } from 'three';
import { cylGeo } from '../render/build.js';
import { SHEAVE, MR, floorY, FLOORS, SPEC, CAR } from '../data/spec.js';
import { HATCH, ROOF } from '../render/elevatorGL.js';

const _v = new Vector3();

export class Guide {
  constructor(game) {
    this.game = game;
    this.on = true;
    // the arrow in the world
    const mat = new MeshBasicMaterial({ color: new Color(1.6, 1.0, 0.1) });
    const g = (this.arrow = new Group());
    const shaft = new Mesh(cylGeo(0.035, 0.35, 'y', 10), mat); shaft.position.y = 0.32; g.add(shaft);
    const head = new Mesh(cylGeo(0.0, 0.18, 'y', 16, 0.11), mat); head.position.y = 0.06; g.add(head);
    g.visible = false; game.stage.scene.add(g);
    // the words and the arrow on the screen
    const ui = document.getElementById('ui');
    this.box = document.createElement('div'); this.box.className = 'guide'; ui.append(this.box);
    this.edge = document.createElement('div'); this.edge.className = 'guide-edge'; this.edge.textContent = '➜'; ui.append(this.edge);
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyK' && e.target?.tagName !== 'INPUT') this.toggle(); });
    this.t = 0;
  }

  toggle() { this.on = !this.on; this.game.sim.say(this.on ? 'Repair guide on.' : 'Repair guide off.', 'Guide'); }

  /** Where a control is in the world. */
  at(id) { const c = this.game.controls.list.find((k) => k.id === id || k.id.startsWith(id)); return c ? c.meshes[0].getWorldPosition(new Vector3()) : null; }

  /** The first thing wrong, and the step that mends it: { problem, step, tool, pos }. */
  diagnose() {
    const g = this.game, s = g.sim, h = s.hoist, c = s.ctl, d = s.doors, I = c.inputs, T = g.tools;
    const has = (t) => T.belt.some((b) => b.tool === t);
    const tool = (t, name) => (has(t) ? { tool: t, toolName: name } : { tool: t, toolName: name, missing: true });
    const lockedOut = !I.mainSwitch && c.lockout;
    const mr = (id) => this.at(id);
    const sheave = new Vector3(SHEAVE.x, SHEAVE.y, SHEAVE.z);
    const lockout = (why) => (lockedOut ? null : { problem: why, step: I.mainSwitch ? 'Make it safe first: lock out the main switch (padlock and tag on it) before you touch the machine or the ropes.' : 'Put your padlock and tag on the main switch, so nobody switches it on while you work.', ...tool('padlock', 'Lockout padlock and tag'), pos: mr('main') });
    // ---- power -----------------------------------------------------------------------------
    if (!I.mains) return { problem: 'Mains supply lost: the building\'s power is off (brakes set, car on its battery lighting).', step: 'Restore the mains: the AC switch on the yellow simulator panel in the machine room.', pos: mr('mains') };
    // ---- repairs that need the power locked off ---------------------------------------------
    if (h.ropesCut || h.ropesLeft < SPEC.ropes.n) {
      const lo = lockout(`Hoist ropes: ${h.ropesCut ? 'all parted' : `${h.ropesLeft} of 8 left`}.`); if (lo) return lo;
      return { problem: `Hoist ropes: ${h.ropesCut ? 'all parted (the car stands on its safety gear)' : `${h.ropesLeft} of 8 left`}.`, step: 'Re-hang the ropes one at a time: the spanner set on the traction sheave (or the car\'s rope hitch).', ...tool('spanner', 'Spanner set'), pos: sheave };
    }
    if (h.brakes.some((b) => b.fail)) {
      const lo = lockout('Brakes: the linings will not hold (brake torque test fails).'); if (lo) return lo;
      return { problem: 'Brakes: contaminated linings, no holding torque.', step: 'Reline both brake sets: the brake linings on the machine\'s brakes.', ...tool('linings', 'Brake linings'), pos: sheave.clone().add(new Vector3(0, 0, 0.25)) };
    }
    if (c.lockout) return { problem: 'Repairs done, the main switch is still locked out.', step: 'Take your padlock and tag off the main switch (padlock on the switch again).', ...tool('padlock', 'Lockout padlock and tag'), pos: mr('main') };
    if (!I.mainSwitch) return { problem: 'The main switch is off.', step: 'Switch the main switch on (by the machine room door).', pos: mr('main') };
    // ---- the drive -----------------------------------------------------------------------------
    if (s.drive.fault) return { problem: 'Drive fault E901: encoder signal implausible.', step: 'Plug the service laptop into the drive cabinet and press "Re-learn encoder".', ...tool('laptop', 'Service laptop'), pos: mr('target.drive') ?? mr('driveCover') };
    // ---- doors, the trap door, the light curtain ----------------------------------------------
    for (let n = 1; n <= FLOORS; n++) {
      const L = d.landing[n];
      if (L.broken) return { problem: `Landing door ${n}: forced, its interlock hook bent; lock contact open (E504).`, step: `Go to floor ${n} and straighten and reset the interlock: the spanner set on floor ${n}'s landing door.`, ...tool('spanner', 'Spanner set'), pos: this.at(`landingDoor.${n}.`) };
      if (L.wedge) return { problem: `Landing door ${n} is wedged open.`, step: `Take your wedge out of floor ${n}'s landing door (the door wedge on it).`, ...tool('wedge', 'Door wedge'), pos: this.at(`landingDoor.${n}.`) };
    }
    if (d.car.wedge) return { problem: 'The car door is wedged open.', step: 'Take the wedge out of the car door.', ...tool('wedge', 'Door wedge'), pos: this.at('carDoor') };
    if ((d.hatch ?? 0) > 0.05) return { problem: 'The car roof trap door is open: its contact opens the safety chain.', step: 'Shut the trap door on the car roof (click it).', pos: new Vector3((HATCH.x0 + HATCH.x1) / 2, h.yc + ROOF + 0.1, HATCH.z1 - 0.25) };
    if (d.curtainFail) return { problem: 'Light curtain: no beams (E505). The doors would close on people.', step: 'Re-seat and align the light curtain: the screwdriver on the car door.', ...tool('screwdriver', 'Screwdriver'), pos: this.at('carDoor') };
    if (I.brkDoor || I.brkLight) {
      if (g.buildingGL.driveCover.position.y > -100) return { problem: `A breaker is off in the drive cabinet (${I.brkDoor ? 'door operator' : 'car lighting'}).`, step: 'Take the drive cabinet\'s cover off: the screwdriver on it.', ...tool('screwdriver', 'Screwdriver'), pos: mr('driveCover') };
      return { problem: `The ${I.brkDoor ? 'door operator' : 'car lighting'} breaker is off.`, step: 'Switch the breaker back on.', pos: mr(I.brkDoor ? 'brkDoor' : 'brkLight') };
    }
    // ---- stop switches and special modes --------------------------------------------------------
    if (I.mrStop) return { problem: 'The machine room STOP switch is pulled.', step: 'Reset the STOP switch on the controller cabinet.', pos: mr('mrStop') };
    if (I.pitStop) return { problem: 'The pit STOP switch is pulled.', step: 'Go down to the pit (the pit door on the plaza) and reset the STOP switch by the ladder.', pos: mr('pitStop') };
    if (I.carTopStop) return { problem: 'The car roof STOP switch is pulled.', step: 'Reset the STOP switch on the inspection station on the car roof.', pos: mr('carTopStop') };
    // ---- the governor and the safety gear ------------------------------------------------------
    if (h.gov.tripped) return { problem: 'Overspeed governor tripped (E202): its jaws hold the governor rope.', step: 'Reset the governor: the RST button on the controller cabinet (or the spanner on the governor).', pos: mr('govReset') };
    if (h.sg.set) {
      if (!I.eeo) return { problem: 'The safety gear has set (E203): the wedges hold the car on its rails.', step: 'Free it by moving the car UP: switch on emergency electrical operation (EEO) on the controller cabinet.', pos: mr('eeo') };
      return { problem: 'Safety gear set: freeing it.', step: 'Press and hold the UP button on the cabinet (RUN goes in with it) for a second or two: the car rises off the wedges.', pos: mr('eeoUp') };
    }
    const lim = h.yc > floorY(FLOORS) + 0.15 || h.yc < floorY(1) - 0.15 || h.buf.car > 0.02 || h.buf.cw > 0.02;
    if (lim) {
      if (!I.eeo) return { problem: 'The car is beyond a terminal floor (final limit or a buffer).', step: 'Switch on emergency electrical operation on the controller cabinet to drive it back.', pos: mr('eeo') };
      return { problem: 'Car beyond a terminal floor.', step: `Press and hold ${h.yc > 50 ? 'DOWN' : 'UP'} on the cabinet (RUN goes in with it) until the car is back at the ${h.yc > 50 ? 'top' : 'bottom'} floor.`, pos: mr(h.yc > 50 ? 'eeoDown' : 'eeoUp') };
    }
    if (c.faults.ucm || c.faults.brake) return { problem: `Lockout fault: ${c.faults.ucm ? 'unintended car movement (E301)' : 'brake lift (E601)'}.`, step: 'Clear it: the FLT (fault reset) button on the controller cabinet, or the laptop\'s "Clear log + reset faults".', pos: mr('faultReset') };
    if (I.eeo) return { problem: 'Emergency electrical operation is still switched on.', step: 'Switch EEO off on the controller cabinet to return the car to normal.', pos: mr('eeo') };
    if (I.insp) return { problem: 'Inspection is still switched on (car roof).', step: 'Switch the inspection switch back to NORMAL on the car roof station.', pos: mr('insp') };
    if (I.fire1 !== 'off' || I.fire2 !== 'off' || c.fire.latched) return { problem: 'Firefighters\' service is active.', step: I.fire2 !== 'off' ? 'Turn the Phase II key in the car to OFF.' : 'Turn the Phase I key at the lobby to RESET, then OFF.', pos: this.at(I.fire2 !== 'off' ? 'fire2' : 'fire1') };
    if (I.independent) return { problem: 'Independent service is on: the car ignores hall calls.', step: 'Turn the independent service key in the car to off.', pos: this.at('independent') };
    if (c.overload) return { problem: `Overload: ${Math.round(c.loadKg)} kg in a 1600 kg car.`, step: 'Take weight out of the car until the buzzer stops.', pos: new Vector3(0, h.yc + 1, CAR.zc) };
    for (let n = 1; n <= FLOORS; n++) if (!d.landing[n].locked && d.coupled !== n) return { problem: `Landing door ${n} is not locked.`, step: `Let floor ${n}'s landing door close (it shuts on its weight), or push it shut.`, pos: this.at(`landingDoor.${n}.`) };
    if (!c.chainOK && c.phase === 'idle' && c.door === 'closed') { const open = c.chainList.find((k) => !k[2]); return { problem: `Safety chain open: ${open?.[1]}.`, step: 'Measure the chain with the multimeter in the controller cabinet to find it.', ...tool('meter', 'Multimeter'), pos: mr('target.cabinet') }; }
    return null;
  }

  update(dt) {
    this.t += dt;
    const g = this.game, cam = g.stage.camera;
    const r = this.on ? (this._r && this.t < 0.5 ? this._r : (this.t = 0, (this._r = this.diagnose()))) : null;
    this.arrow.visible = !!r?.pos;
    this.box.hidden = !r;
    this.edge.hidden = true;
    if (!r) return;
    const toolLine = r.tool ? `<p class="tool">Tool: <b>${r.toolName}</b>${r.missing ? ' — it is not in your bag: pick it up where you left it' : g.tools.tool?.tool === r.tool ? ' (in your hand)' : ` (${g.touch ? 'Tool' : 'I'}: choose it, then ${g.touch ? 'Apply' : 'R'} on the marked part)`}</p>` : '';
    const where = r.pos && r.pos.y > MR.floor - 0.5 && cam.position.y < MR.floor - 0.5 ? '<p class="dim">It is in the machine room on the roof: G → Machine room, or the stairs from floor 30.</p>' : '';
    this.box.innerHTML = `<b>Repair guide</b><p class="prob">${r.problem}</p><p>${r.step}</p>${toolLine}${where}`;
    if (!r.pos) return;
    this.arrow.position.copy(r.pos).add(_v.set(0, 0.25 + Math.abs(Math.sin(performance.now() / 300)) * 0.12, 0));
    this.arrow.rotation.y += dt * 2;
    // off screen (or behind you): an arrow at the edge pointing the way
    const p = r.pos.clone().project(cam);
    const behind = p.z > 1;
    if (behind || Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.9) {
      let x = behind ? -p.x : p.x, y = behind ? -p.y : p.y;
      const k = 0.85 / Math.max(Math.abs(x), Math.abs(y), 1e-3);
      x *= k; y *= k;
      this.edge.hidden = false;
      this.edge.style.left = `${(x * 0.5 + 0.5) * 100}%`; this.edge.style.top = `${(-y * 0.5 + 0.5) * 100}%`;
      this.edge.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(-y, x)}rad)`;
    }
  }
}
