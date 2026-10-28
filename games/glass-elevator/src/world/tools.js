/**
 * The lift engineer's tools, and your tool belt. The tools lie on a technician's trolley in the
 * lobby, real things you can pick up: clicking one puts it on your belt (keys 1-9 choose, X puts
 * the chosen one down in front of you). R uses the chosen tool on what the crosshair rests on, as
 * an engineer would:
 *
 *  - hoistway door key (drop key): lifts a landing door's interlock from the landing side;
 *  - door wedge: props a landing door open (again: takes it out);
 *  - pry bar: forces a door open; on a landing door it bends the interlock hook, and that door's
 *    lock contact stays open (the elevator is out of service) until it is mended;
 *  - spanner set: mends a forced landing door lock; re-hangs a parted hoist rope at the car's
 *    rope hitch or the machine (main switch locked off first); resets the governor by hand;
 *  - brake linings: relines both brake sets (main switch off first);
 *  - multimeter: across the safety chain in the controller cabinet, says which contact is open;
 *  - service laptop: on the drive, finds and clears its encoder fault; on the controller, resets
 *    faults;
 *  - screwdriver: re-seats and re-aligns the car door's light curtain;
 *  - padlock and tag: locks the machine room main switch off (lockout/tagout); again, removes it.
 */
import { Group, Mesh, MeshBasicMaterial, BoxGeometry, Vector3 } from 'three';
import { Body } from '../physics/bodies.js';
import { TS_Y0 } from '../physics/hoist.js';
import { boxMesh, cylGeo } from '../render/build.js';
import { MR, SHEAVE, GOVERNOR, CAR, SPEC, cwYForCar, floorY, FACADE } from '../data/spec.js';

/** A smashed control made whole again. */
export const mend = (c) => { c.broken = false; for (const m of c.meshes) if (m.userData.rot0) m.rotation.copy(m.userData.rot0); };

const TOOLS = [
  ['key', 'Hoistway door key', [0.12, 0.02, 0.04], 0.2, 'paintDark'],
  ['wedge', 'Door wedge', [0.18, 0.05, 0.06], 0.3, 'orange'],
  ['prybar', 'Pry bar', [0.75, 0.03, 0.03], 2.0, 'paintRed'],
  ['spanner', 'Spanner set', [0.35, 0.06, 0.18], 3.5, 'steel'],
  ['linings', 'Brake linings (a pair)', [0.3, 0.08, 0.12], 4.0, 'rubber'],
  ['meter', 'Multimeter', [0.09, 0.18, 0.05], 0.4, 'paintYellow'],
  ['laptop', 'Service laptop', [0.34, 0.03, 0.24], 2.0, 'plastic'],
  ['screwdriver', 'Screwdriver', [0.22, 0.03, 0.03], 0.15, 'paintBlue'],
  ['padlock', 'Lockout padlock and tag', [0.06, 0.08, 0.03], 0.25, 'paintRed'],
  ['rope', 'Rescue rope and harness', [0.3, 0.15, 0.3], 6, 'paintYellow'],
  ['hammer', 'Sledgehammer', [0.7, 0.08, 0.08], 5, 'paintDark'],
];

export class ToolBelt {
  constructor(game) {
    this.game = game;
    this.belt = [];
    this.active = 0;
    const { world, M, stage, props } = game;
    // the technician's trolley by the lobby's west wall
    const trolley = new Group(); trolley.position.set(-7.2, 0, 11.2); stage.scene.add(trolley);
    const top = boxMesh(M.paintGrey, 1.0, 0.04, 0.6); top.position.y = 0.8; trolley.add(top);
    for (const [x, z] of [[-0.45, -0.25], [0.45, -0.25], [-0.45, 0.25], [0.45, 0.25]]) { const l = new Mesh(cylGeo(0.02, 0.8, 'y', 8), M.steel); l.position.set(x, 0.4, z); trolley.add(l); }
    world.solid([-7.7, 0, 10.9], [-6.7, 0.82, 11.5]);
    TOOLS.forEach(([id, name, size, mass, mat], i) => {
      const pos = [-7.6 + (i % 3) * 0.33, 0.84 + size[1] / 2 + Math.floor(i / 3) * 0.002, 11.0 + Math.floor(i / 3) * 0.2];
      const b = world.add(new Body({ name, size, mass, pos, mu: 0.5 }));
      b.home = [...pos]; b.tool = id;
      const g = new Group(); stage.scene.add(g);
      const m = boxMesh(M[mat], ...size); m.castShadow = true; m.userData.body = b; g.add(m);
      props.list.push({ b, g });
      b.mesh = g;
      this.take(b, true);              // you start with the whole kit in your bag
    });
    this._panel();
    this._targets();
    window.addEventListener('keydown', (e) => {
      if (e.target?.tagName === 'INPUT') return;
      if (e.code === 'KeyR') this.apply();
      if (e.code === 'KeyX') this.drop();
      if (/^Digit[1-9]$/.test(e.code)) { const k = Number(e.code.slice(5)) - 1; if (this.belt[k]) this.active = k; }
    });
  }

  get tool() { return this.belt[this.active]; }

  /** A tool clicked: onto the belt (out of the world). */
  take(b, quiet = false) {
    const W = this.game.world, i = W.bodies.indexOf(b);
    if (i >= 0) W.bodies.splice(i, 1);
    b.mesh.visible = false;
    this.belt.push(b); this.active = this.belt.length - 1;
    this.render?.();
    if (!quiet) this.say(`${b.name} on your belt (${this.belt.length}). R: use it on what you look at · X: put it down · 1-9: choose.`);
  }
  drop() {
    const b = this.tool; if (!b) return;
    const cam = this.game.stage.camera, P = this.game.player;
    const d = cam.getWorldDirection(cam.position.clone().set(0, 0, 0));
    b.p = [P.p[0] + d.x * 0.6, P.p[1] + 1.2, P.p[2] + d.z * 0.6]; b.v = [0, 0, 0]; b.q = [0, 0, 0, 1]; b.wake();
    this.game.world.bodies.push(b); b.mesh.visible = true;
    this.belt.splice(this.active, 1); this.active = Math.max(0, Math.min(this.active, this.belt.length - 1));
    this.render();
  }
  cycle() { if (this.belt.length) this.active = (this.active + 1) % this.belt.length; this.render(); }

  /** The inventory: every tool you carry; tap one to have it in your hand. */
  _panel() {
    const el = (this.el = document.createElement('div'));
    el.className = 'inv'; el.hidden = true;
    document.getElementById('ui').append(el);
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const k = e.target.closest('[data-i]')?.dataset.i;
      if (k === 'close') { el.hidden = true; return; }
      if (k === 'drop') { this.drop(); return; }
      if (k !== undefined) { this.active = Number(k); this.render(); }
    });
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyI' && e.target?.tagName !== 'INPUT') this.toggle(); });
    this.render();
  }
  toggle() { this.el.hidden = !this.el.hidden; if (!this.el.hidden) document.exitPointerLock?.(); this.render(); }
  render() {
    if (!this.el) return;
    const hint = this.game.touch ? 'Apply' : 'R';
    this.el.innerHTML = `<h3>Tools <span>${hint}: use the one in your hand on what you look at</span></h3><div class="slots">${this.belt.map((b, i) => `<button data-i="${i}" class="${i === this.active ? 'on' : ''}"><b>${i + 1}</b>${b.name}</button>`).join('') || '<p>Your bag is empty: the tools you put down are where you left them (click one to pick it up).</p>'}</div><div class="row"><button data-i="drop">Put down</button><button data-i="close">Close</button></div>`;
  }
  say(t) { this.game.sim.say(t, 'You'); }

  /** Invisible places a tool can be put to: the rope hitch, the brakes, the cabinets, the governor. */
  _targets() {
    const g = this.game, C = g.controls, mat = new MeshBasicMaterial({ transparent: true, opacity: 0 });
    const spot = (parent, x, y, z, w, h, d, target, label) => {
      const m = new Mesh(new BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m);
      C.add(m, { id: 'target.' + target + '.' + x, label, kind: 'target', target, down: () => this.say(`${label}: that needs a tool (R with the right one on your belt).`) });
    };
    const S = g.stage.scene, y = MR.floor;
    spot(g.elevatorGL.car, 0, 3.42, CAR.zc, 0.25, 0.3, 0.4, 'ropes', 'The car\'s rope hitch (eight rope terminations)');
    spot(S, SHEAVE.x, SHEAVE.y, SHEAVE.z, 0.75, 0.75, 0.3, 'ropes', 'The traction sheave and its ropes');
    spot(S, SHEAVE.x, SHEAVE.y, SHEAVE.z + 0.25, 1.0, 0.4, 0.25, 'brakes', 'The machine brakes (two sets)');
    spot(S, -2.35, y + 1.2, MR.z0 + 0.42, 1.9, 1.6, 0.05, 'cabinet', 'The controller cabinet');
    spot(S, -0.75, y + 1.2, MR.z0 + 0.42, 1.1, 1.6, 0.05, 'drive', 'The drive (inverter) cabinet');
    spot(S, GOVERNOR.x, GOVERNOR.y, GOVERNOR.z, 0.3, 0.4, 0.4, 'governor', 'The overspeed governor');
  }

  /** The sledgehammer: a loose thing is knocked flying, a device is smashed and does what a smashed one would. */
  _smash(hit) {
    const g = this.game, s = g.sim, h = s.hoist, d = s.doors;
    if (!hit) return this.say('Nothing within reach to swing the sledgehammer at.');
    s.sfx('snap', { at: [hit.point.x, hit.point.y, hit.point.z] });
    if (hit.body) {
      const v = g.stage.camera.getWorldDirection(new Vector3()), k = Math.min(12, 600 / hit.body.mass);
      hit.body.v = [hit.body.v[0] + v.x * k, hit.body.v[1] + v.y * k + 1, hit.body.v[2] + v.z * k];
      return this.say(`You swing the sledgehammer into the ${hit.body.name.toLowerCase()}.`);
    }
    const c = hit.control, id = c.id, tg = c.target;
    const floor = c.floor ?? Number(/^(?:unlock|landingDoor)\.(\d+)/.exec(id)?.[1] ?? 0);
    if (floor && (id.startsWith('unlock') || id.startsWith('landingDoor'))) {
      const L = d.landing[floor]; L.broken = true; L.locked = false; L.x = Math.max(L.x, 0.3); L.wedge = 0.3;
      return this.say(`Floor ${floor}'s landing door smashed in: the panels are bent and its interlock is broken (spanner to mend).`);
    }
    if (id.startsWith('carDoor')) { d.curtainFail = true; d.car.x = Math.max(d.car.x, 0.3); return this.say('The car door is dented and its light curtain smashed: no beams (E505).'); }
    if (tg === 'ropes') {
      if (h.ropesLeft <= 0) return this.say('There is no rope left to hit.');
      h.ropesLeft -= 1; if (h.ropesLeft === 0) h.ropesCut = true;
      return this.say(h.ropesCut ? 'The last hoist rope parts under the hammer.' : `A hoist rope's strands burst: ${h.ropesLeft} of 8 still hold the car.`);
    }
    if (tg === 'brakes') { for (const k of h.brakes) k.fail = true; return this.say('The brake linings shatter: the brakes no longer hold (E602).'); }
    if (tg === 'governor') { h.gov.tripped = true; h.gov.switchOpen = true; return this.say('The governor\'s jaws are knocked shut and its switch is open (E202).'); }
    if (tg === 'drive' || tg === 'cabinet' || tg === 'driveCover') { s.drive.fault = 'runaway'; return this.say('The drive cabinet is caved in: the encoder cable is crushed (E901). The drive is fed a wrong speed.'); }
    if (c.broken) return this.say(`${c.label} is already smashed.`);
    c.broken = true;
    for (const m of c.meshes) { m.userData.rot0 ??= m.rotation.clone(); m.rotation.x += 0.35; m.rotation.z += 0.2; }
    c.up?.();
    return this.say(`${c.label}: smashed. It does nothing now (spanner to fix).`);
  }

  /** Uses the chosen tool on what the crosshair rests on. */
  apply() {
    const g = this.game, P = g.player, b = this.tool;
    if (!b) { this.say('No tool on your belt: the tools are on the technician\'s trolley in the lobby.'); return; }
    const hit = P._pick(g.touch || document.pointerLockElement ? null : P.mouse);
    if (b.tool === 'hammer') return this._smash(hit);
    const c = hit?.control;
    if (!c) { this.say(`Nothing within reach to use the ${b.name.toLowerCase()} on.`); return; }
    const s = g.sim, h = s.hoist, d = s.doors, ctl = s.ctl, t = b.tool, id = c.id;
    const floor = c.floor ?? (/^(unlock|landingDoor)\.(\d+)/.exec(id) ? Number(/^(?:unlock|landingDoor)\.(\d+)/.exec(id)[1]) : 0);
    const landing = floor && (id.startsWith('unlock') || id.startsWith('landingDoor'));
    const carDoor = id.startsWith('carDoor');
    const locked = () => { if (!ctl.inputs.mainSwitch) return false; this.say('Lock out the main switch in the machine room first (the padlock): never work on the machine or the ropes with power on.'); return true; };
    s.sfx('clack');
    if (t === 'key') {
      if (!landing) return this.say('The hoistway door key fits the keyhole in a landing door\'s head.');
      d.unlock(floor); return this.say(`The drop key lifts floor ${floor}'s interlock: pull the door open by hand (it closes and locks itself again on its weight).`);
    }
    if (t === 'wedge') {
      if (landing) { const L = d.landing[floor]; if (L.wedge) { L.wedge = 0; return this.say('Wedge out: the landing door can close.'); } if (L.x < 0.2) return this.say('Open the door first, then wedge it.'); L.wedge = L.x; return this.say(`Floor ${floor}'s landing door wedged open. (The elevator cannot run with it open.)`); }
      if (carDoor) { if (d.car.wedge) { d.car.wedge = 0; return this.say('Wedge out of the car door.'); } d.car.wedge = Math.max(0.2, d.car.x); return this.say('Car door wedged open.'); }
      return this.say('A door wedge goes in a door.');
    }
    if (t === 'prybar') {
      if (landing) { const L = d.landing[floor]; L.broken = true; L.locked = false; L.x = Math.max(L.x, 0.62); L.wedge = 0.62; s.sfx('snap'); return this.say(`You lever floor ${floor}'s landing door open by force. The bent door jams half open, its interlock hook bent: the lock contact stays open, the elevator is out of service until it is mended (spanner).`); }
      if (carDoor) { d.car.x = Math.max(d.car.x, 0.4); s.sfx('snap'); return this.say('You force the car door open. Its contact opens the safety chain: if the car was moving, it has just made an emergency stop.'); }
      return this.say('The pry bar is for forcing doors.');
    }
    if (t === 'spanner' && c.broken) { mend(c); return this.say(`${c.label}: the smashed parts replaced and refitted. It works again.`); }
    if (t === 'spanner') {
      if (landing && d.landing[floor].broken) { d.landing[floor].broken = false; d.landing[floor].wedge = 0; return this.say(`Floor ${floor}'s interlock hook straightened and reset: the door locks again.`); }
      if (c.target === 'governor') return this.say(h.resetGovernor() ? 'Governor reset by hand. If the safety gear has set, move the car up on emergency electrical operation to free it.' : 'Not while the car moves.');
      if (c.target === 'ropes') {
        if (locked()) return;
        if (h.ropesCut) {
          h.ropesCut = false; h.ropesLeft = 1; h.yw = cwYForCar(h.yc); h.vw = 0; h.ts = TS_Y0; h.vts = 0; h.buf.cw = 0; h.vu = 0; h.vs = 0; h.stick = true; h._settle();
          return this.say('With the counterweight jacked back into place, the first new rope is reeved over the sheave and socketed at both hitches. 1 of 8: keep going.');
        }
        if (h.ropesLeft >= SPEC.ropes.n) return this.say('All eight ropes are in place; their tensions are even.');
        h.ropesLeft += 1;
        return this.say(`A new rope reeved, socketed and its tension matched to the others: ${h.ropesLeft} of 8.`);
      }
      return this.say('Nothing here to undo with a spanner.');
    }
    if (t === 'linings') {
      if (c.target !== 'brakes') return this.say('Brake linings go on the machine\'s brakes.');
      if (locked()) return;
      for (const k of h.brakes) k.fail = false;
      return this.say('Both brake sets relined and their air gaps set. Test them before handing the elevator back.');
    }
    if (t === 'meter') {
      if (c.target !== 'cabinet') return this.say('Measure the safety chain in the controller cabinet.');
      const open = ctl.chainList.filter((k) => !k[2]).map((k) => k[1]);
      return this.say(open.length ? `Safety chain: voltage lost after ${open.join(', ')}.` : 'Safety chain: full voltage to the end. Everything is made.');
    }
    if (t === 'laptop' && (c.target === 'cabinet' || c.target === 'drive' || c.target === 'driveCover' || id.startsWith('car.'))) {
      g.laptop.open(c.target === 'drive' || c.target === 'driveCover' ? 'drive' : id.startsWith('car.') ? 'car' : 'controller');
      return this.say('Laptop plugged in: the service tool reads the fault log.');
    }
    if (t === 'laptop') {
      if (c.target === 'drive') { const f = s.drive.fault; s.drive.fault = null; return this.say(f ? 'Drive log: encoder signal fault. Encoder re-seated and its offset re-learnt: fault cleared.' : 'Drive log: no faults.'); }
      if (c.target === 'cabinet') { ctl.resetFaults(); return this.say('Controller: fault log read and cleared.'); }
      return this.say('Plug the laptop into the drive or the controller.');
    }
    if (t === 'screwdriver' && id.startsWith('car.')) {
      const pl = g.elevatorGL.copPlate, on = pl.position.y > 0;
      pl.position.y = on ? -1000 : 1.25;
      return this.say(on ? 'Six screws out: the faceplate comes off. Behind it the button board, its chips and the loom.' : 'Faceplate back on.');
    }
    if (t === 'screwdriver' && c.target === 'driveCover') {
      const cv = g.buildingGL.driveCover; cv.position.y -= 1000;
      return this.say('Cover off the drive cabinet: the heat sink, the DC-link capacitors, the contactors and two breakers. (Screwdriver on the cabinet again: cover back on.)');
    }
    if (t === 'screwdriver' && c.target === 'drive' && g.buildingGL.driveCover.position.y < -100) { g.buildingGL.driveCover.position.y += 1000; return this.say('Cover back on.'); }
    if (t === 'screwdriver') {
      if (!carDoor) return this.say('A screwdriver for: the car panel\'s faceplate, the drive cabinet\'s cover, the light curtain on the car door.');
      d.curtainFail = false; return this.say('Light curtain edges re-seated and aligned: all 32 beams seen.');
    }
    if (t === 'rope') {
      if (P.rope) { P.rope = null; return this.say('You unclip from the rope.'); }
      const n = floor || (P.ropeLeft && Math.hypot(P.p[0] - P.ropeLeft.anchor[0], P.p[2] - P.ropeLeft.anchor[2]) < 2.5 ? P.ropeLeft.floor : 0);
      if (!n || !(landing || P.ropeLeft)) return this.say('Anchor the rope at an open landing door (look at the door).');
      const L = d.landing[n];
      if (L.x < 0.3 && d.coupled !== n) return this.say('Open the landing door first: the pry bar, or the hoistway door key and your hands.');
      const y0 = floorY(n);
      P.rope = { floor: n, y0, anchor: [0, y0 + 2.05, FACADE - 0.12] };
      P.ropeLeft = P.rope;
      if (P.p[1] < y0 - 0.5) { P.rope.fresh = true; return this.say(`You clip onto the rope hanging from floor ${n}. Forward: climb up · back: lower yourself.`); }
      P._release?.(); P.p = [0, y0, FACADE + 0.45]; P.v = [0, 0, 0]; P.grounded = false; P.ground = null; P.yaw = -Math.PI / 2;
      return this.say(`Rope anchored in floor ${n}'s door head, harness on: you swing out into the hoistway. Back (S, or the stick down): lower yourself onto the car roof · forward: climb · R with the rope: unclip.`);
    }
    if (t === 'padlock') {
      if (!(c.target === 'cabinet' || id === 'main')) return this.say('The padlock goes on the main switch in the machine room.');
      if (ctl.lockout) { ctl.lockout = false; return this.say('Your padlock and tag off the main switch.'); }
      ctl.inputs.mainSwitch = false; ctl.lockout = true;
      return this.say('Main switch OFF, your padlock and tag on it: nobody can switch the elevator on while you work.');
    }
  }
}
