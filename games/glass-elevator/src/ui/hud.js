/**
 * The words on the screen: where you are and what the elevator is doing; the engineer's panel (T)
 * with everything the physics knows (the drive, the ropes and their traction, the brakes, the
 * governor and safety gear, the buffers, the load weighing, the doors' kinetic energy, the
 * safety chain switch by switch, the calls); the keys (H); and a quick way about the building (G).
 */
import { fmt } from '../sim.js';
import { SPEC, FLOORS, floorY, tractionLimit, G, CAR } from '../data/spec.js';
import { ROOF } from '../render/elevatorGL.js';
import { LOBBY, LOBBY1, PIT } from '../render/buildingGL.js';
import { MR, PIT_Y, FACADE } from '../data/spec.js';
import { MU_STICK } from '../physics/hoist.js';

const kN = (n) => (n / 1000).toFixed(1);

export class HUD {
  constructor(root, game) {
    this.game = game;
    const el = (cls, html = '') => { const e = document.createElement('div'); e.className = cls; e.innerHTML = html; root.append(e); return e; };
    this.top = el('hud');
    this.hint = el('hint');
    this.log = el('log');
    this.tele = el('tele'); this.tele.style.display = 'none';
    this.help = el('help', `<h3>Glass Elevator · the keys</h3><table>
      <tr><td>Mouse</td><td>look (click the view to hold the mouse, Esc lets go; or drag)</td></tr>
      <tr><td>W A S D</td><td>walk (Shift: hurry)</td></tr>
      <tr><td>Left button</td><td>press a button, flip a switch, turn a key · <b>hold</b> on a loose thing to pick it up (wheel: nearer / further, right button: throw) · hold on a door panel or a lever and drag</td></tr>
      <tr><td>E · Q</td><td>at a stairs door: up / down a floor (floor 30: up to the machine room) · the pit door and ladder</td></tr>
      <tr><td>I · R · X · 1-9</td><td>your tools (inventory) · use the one in your hand on what you look at · put it down · choose one</td></tr>
      <tr><td>G</td><td>go somewhere: the lobby, the car, its roof, any floor, the machine room, the pit</td></tr>
      <tr><td>V</td><td>step outside to watch (drag, wheel, W/S up and down, F follow the car)</td></tr>
      <tr><td>T</td><td>the engineer's panel: drive, ropes, traction, brakes, governor, safety chain, doors</td></tr>
      <tr><td>+ / −</td><td>time faster or slower (the physics keeps its 1000 steps a second)</td></tr>
      <tr><td>P · H</td><td>pause · these keys</td></tr></table>
      <p>Press a hall button, step in, choose a floor. Everything is worked by its real mechanism: the machine room on the roof (stairs from floor 30) has the main switch, emergency electrical operation, the governor test, the brake release lever and a panel of failures to try the safety gear with; the car roof has the inspection station (reach it from a landing with the triangle key, as engineers do).</p>`);
    this.help.style.display = 'none';
    this.goto = el('goto', `<h3>Go to</h3>
      <button data-go="lobby">Lobby (floor 1)</button><button data-go="car">In the car</button><button data-go="roof">Car roof</button>
      <div><input type="number" min="1" max="${FLOORS}" value="15" id="gofloor"/><button data-go="floor">Floor lobby</button></div>
      <button data-go="mr">Machine room</button><button data-go="pit">Pit</button><button data-go="plaza">Plaza</button><button data-go="out">Watch from outside</button>`);
    this.goto.style.display = 'none';
    // a button for the same, for screens without keys
    const gb = el('gobtn', 'Go to…');
    gb.addEventListener('click', () => { this.goto.style.display = this.goto.style.display === 'none' ? '' : 'none'; document.exitPointerLock?.(); });
    this.goto.addEventListener('click', (e) => { const g = e.target?.dataset?.go; if (g) { this.go(g); this.goto.style.display = 'none'; } });
    window.addEventListener('keydown', (e) => {
      if (e.target?.tagName === 'INPUT') return;
      if (e.code === 'KeyH') this.help.style.display = this.help.style.display === 'none' ? '' : 'none';
      if (e.code === 'KeyT') this.tele.style.display = this.tele.style.display === 'none' ? '' : 'none';
      if (e.code === 'KeyG') { this.goto.style.display = this.goto.style.display === 'none' ? '' : 'none'; if (this.goto.style.display === '') document.exitPointerLock?.(); }
    });
    this.t = 0; this.intro = 16;
  }

  go(where) {
    const P = this.game.player, h = this.game.sim.hoist;
    const n = Math.max(1, Math.min(FLOORS, Number(document.getElementById('gofloor')?.value) || 1));
    if (where === 'lobby') P.teleport([0.6, 0, 12.4], Math.PI / 2);
    if (where === 'car') P.teleport([0, h.yc + 0.01, CAR.zc + 0.2], -Math.PI / 2);
    if (where === 'roof') P.teleport([-0.3, h.yc + ROOF + 0.01, 16.4], -Math.PI / 2);
    if (where === 'floor') P.teleport([0.6, floorY(n), 12.6], Math.PI / 2);
    if (where === 'mr') P.teleport([1.9, MR.floor, MR.z0 + 0.7], Math.PI / 2);
    if (where === 'pit') P.teleport([PIT.x1 - 0.3, PIT_Y, PIT.z1 - 0.55], -Math.PI / 2);
    if (where === 'plaza') P.teleport([3.5, 0, FACADE + 6], -Math.PI / 2 - 0.4);
    if (where === 'out') { P.mode = 'orbit'; P.orbit.follow = true; }
    void LOBBY; void LOBBY1;
  }

  update(dt) {
    this.t += dt;
    if (this.t < 0.2) return;
    this.t = 0;
    const g = this.game, s = g.sim, h = s.hoist, c = s.ctl, d = s.doors, dr = s.drive, P = g.player;
    const x = g.timeScale !== 1 ? ` <i>×${g.timeScale}</i>` : '';
    const arrow = c.display.dir > 0 ? '▲' : c.display.dir < 0 ? '▼' : '';
    this.top.innerHTML = `<b>${P.where()}</b><span>${fmt(s.clock)}${x}</span><span>Car ${arrow} ${c.floor}${c.display.msg ? ` · ${c.display.msg}` : ''}</span><span>${Math.abs(h.vc).toFixed(2)} m/s</span><span>${Math.max(0, Math.round(c.loadKg))} kg</span>${g.tools?.tool ? `<span>Tool: ${g.tools.tool.name} (${g.tools.active + 1}/${g.tools.belt.length})</span>` : ''}${g.paused ? '<span>PAUSED</span>' : ''}`;
    this.intro -= 0.2;
    this.hint.textContent = (g.touch && P.hint ? P.hint.replace(/hold the left button to pick it up/g, 'tap Use to carry it').replace(/let go to drop/g, 'tap Drop to put it down').replace(/hold the left button/g, 'hold Use').replace(/left button/g, 'Use').replace(/click/g, 'tap Use') : P.hint) || (this.intro > 0 && g.touch ? 'Stick: walk · drag: look · Use: press, or hold to carry · Go to: anywhere' : this.intro > 0 ? 'H: the keys · G: go anywhere · T: the engineer\'s panel · the hall buttons are beside the landing door' : '');
    this.log.innerHTML = s.log.slice(-6).map((l) => `<div>${fmt(l.t).slice(0, 8)} ${l.who ? `<b>${l.who}:</b> ` : ''}${l.text}</div>`).join('');
    if (this.tele.style.display !== 'none') this._tele(s, h, c, d, dr);
  }

  _tele(s, h, c, d, dr) {
    const rpm = (h.vs / 0.32) * 60 / (2 * Math.PI), Tlim = tractionLimit(MU_STICK);
    const calls = (a) => a.map((v, i) => (v ? i : 0)).filter(Boolean).join(' ') || '–';
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    const chain = c.chainList.map(([, label, ok]) => `<span class="${ok ? 'ok' : 'bad'}">${ok ? '●' : '○'} ${label}</span>`).join('');
    const locked = d.landing.filter((L) => L && L.locked).length;
    this.tele.innerHTML = `<h3>Engineer's panel</h3><table>
      ${row('Mode · phase', `${c.mode} · ${c.phase}${c.faulted ? ' · <b class="bad">FAULT</b>' : ''}`)}
      ${row('Car', `${h.yc.toFixed(3)} m (floor ${c.floor}, level error ${((h.yc - floorY(c.floor)) * 1000).toFixed(1)} mm)`)}
      ${row('Speed · accel', `${h.vc.toFixed(3)} m/s · ${h.ac.toFixed(2)} m/s² · ref ${(dr.dir * dr.v).toFixed(2)} m/s, ${(dr.a).toFixed(2)} m/s², jerk ${dr.jerk.toFixed(2)} m/s³`)}
      ${row('Machine', `${rpm.toFixed(1)} rpm · ${(h.motor.torque / 1000).toFixed(2)} kN·m (≈ ${Math.round(Math.abs(h.motor.torque) / 36)} A) · ${(dr.power / 1000).toFixed(1)} kW ${dr.power < -500 ? '(regenerating)' : ''}`)}
      ${row('Energy', `${(dr.energy / 3.6e6).toFixed(3)} kWh drawn (− = returned to the grid)`)}
      ${row('Brakes', `${h.brakes.map((b, i) => `B${i + 1} ${b.lift >= 1 ? 'lifted' : b.lift > 0 ? Math.round(b.lift * 100) + ' %' : 'set'}${b.fail ? ' (FAILED)' : ''}`).join(' · ')} · ${(h.brakeTorque / 1000).toFixed(1)} kN·m${h.manualRelease > 0.01 ? ` · hand release ${Math.round(h.manualRelease * 100)} %` : ''}`)}
      ${row('Hoist ropes', h.ropesCut ? '<b class="bad">PARTED</b>' : `car side ${kN(h.Tc)} kN, cw side ${kN(h.Tw)} kN · stretch ${(h.ec * 1000).toFixed(0)} mm · safety factor ${h.ropeSafety.toFixed(1)}`)}
      ${row('Traction', `T1/T2 ${isFinite(h.tractionRatio) ? h.tractionRatio.toFixed(3) : '∞'} of e^(fα) ${Tlim.toFixed(3)} · grooves using ${isFinite(h.tractionUse) ? Math.round(h.tractionUse * 100) + ' %' : 'all (slipping)'} · slip ${(h.slip * 1000).toFixed(1)} mm`)}
      ${row('Counterweight', `${h.yw.toFixed(2)} m · ${h.vw.toFixed(2)} m/s`)}
      ${row('Compensation', `tension sheave ${(h.ts).toFixed(3)} m · loop ${kN(h.Tb)} kN${h.tieDown.engaged ? ' · tie-down holding' : ''}`)}
      ${row('Governor', `${h.gov.speed.toFixed(2)} m/s (switch 4.40, trips 4.80) ${h.gov.switchOpen ? '· switch OPEN' : ''} ${h.gov.tripped ? '· <b class="bad">TRIPPED</b>' : ''}${h.gov.testTrip && !h.gov.tripped ? ' · test armed' : ''}`)}
      ${row('Safety gear', h.sg.set ? `<b class="bad">SET</b> ${Math.round(h.sg.engage * 100)} %` : 'clear')}
      ${row('Buffers', `car ${(h.buf.car * 1000).toFixed(0)} mm · cw ${(h.buf.cw * 1000).toFixed(0)} mm of ${SPEC.buffers.stroke * 1000}`)}
      ${row('Load weighing', `${Math.round(c.loadKg)} kg (${Math.round((c.loadKg / SPEC.ratedLoad) * 100)} %)${c.overload ? ' · <b class="bad">OVERLOAD</b>' : c.fullLoad ? ' · full: passing hall calls' : ''} · rated ${SPEC.ratedLoad} kg`)}
      ${row('Car door', `${Math.round(d.car.x * 100)} % · ${d.car.v.toFixed(2)} m/s · ${d.car.ke.toFixed(1)} J now · last close ${d.car.avgClose ? `${d.car.avgClose.toFixed(2)} m/s average, ${d.car.avgKE.toFixed(1)} J (max 10)` : '–'}`)}
      ${row('Landing doors', `${locked} of ${FLOORS} locked · coupled to floor ${d.coupled || '–'} · light curtain ${d.curtainFail ? 'FAILED' : d.curtainBlocked ? 'interrupted' : 'clear'}`)}
      ${row('Calls', `car ${calls(c.calls.car)} · up ${calls(c.calls.up)} · down ${calls(c.calls.down)}`)}
      </table><div class="chain"><b>Safety chain ${c.chainOK ? '<span class="ok">made</span>' : '<span class="bad">OPEN</span>'}</b>${chain}</div>`;
    void G;
  }
}
