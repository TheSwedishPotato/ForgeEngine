/**
 * The few words on the screen: where you are, the time, what the nearest gauges say (as you
 * would read them over a shoulder), and what you can do here.
 */
import { fmt } from '../sim.js';

export class HUD {
  constructor(root, game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'hud';
    root.append(this.el);
    this.hint = document.createElement('div');
    this.hint.className = 'hint';
    root.append(this.hint);
    this.log = document.createElement('div');
    this.log.className = 'log';
    root.append(this.log);
    this.help = document.createElement('div');
    this.help.className = 'help';
    this.help.style.display = 'none';
    this.help.innerHTML = `<h3>Aboard</h3><table>
      <tr><td>Mouse</td><td>look (click the view to hold the mouse; Esc lets go)</td></tr>
      <tr><td>W A S D</td><td>walk (Shift: hurry); through the open doors fore and aft</td></tr>
      <tr><td>E</td><td>up or down a ladder: the trunk to the crew's mess, the conning tower, the bridge, the pump room</td></tr>
      <tr><td>E at a periscope</td><td>in the conning tower, with it up: look through it (mouse trains it, F for 1.5 or 6 power, E to step back)</td></tr>
      <tr><td>Look at a control</td><td>left button: open, turn, throw, switch on · right button: shut, back, off</td></tr>
      <tr><td>Tab</td><td>orders to the captain: dive, surface, depth, speed, course, engines, lights, time</td></tr>
      <tr><td>V</td><td>step outside: drag to look round her, wheel to come closer</td></tr>
      <tr><td>+ / −</td><td>time faster or slower</td></tr>
      <tr><td>P · T · H</td><td>pause · the words on the screen · these keys</td></tr></table>
      <p>You are in your observation deck, aft of the bridge. The crew run the boat: give the captain an order (Tab) and watch them work it, or go below and put your own hands on her.</p>`;
    root.append(this.help);
    // the periscope's eyepiece: the circle of the field, the cross wires and the stadimeter's marks
    this.eyepiece = document.createElement('div');
    this.eyepiece.className = 'eyepiece';
    this.eyepiece.style.display = 'none';
    this.eyepiece.innerHTML = '<div class="wire h"></div><div class="wire v"></div>' + [-3, -2, -1, 1, 2, 3].map((k) => `<div class="tick" style="left:calc(50% + ${k * 6}vmin)"></div>`).join('');
    root.append(this.eyepiece);
    game.ui = { ...(game.ui ?? {}), scope: (on) => { this.eyepiece.style.display = on ? '' : 'none'; } };
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyH') this.help.style.display = this.help.style.display === 'none' ? '' : 'none'; });
    this.t = 0;
    this.intro = 14;
  }
  toggle() { this.hidden = !this.hidden; for (const e of [this.el, this.hint, this.log]) e.style.display = this.hidden ? 'none' : ''; }
  update(dt) {
    this.t += dt;
    if (this.t < 0.2) return;
    this.t = 0;
    const g = this.game, s = g.sim, G = s.plant.g, P = g.player;
    const x = g.timeScale > 1 ? ` <i>×${g.timeScale}</i>` : '';
    this.el.innerHTML = `<b>${P.where()}</b><span>${fmt(s.clock)} HST${x}</span><span>Depth ${G.depth?.toFixed(0)} ft</span><span>${G.speed?.toFixed(1)} kn</span><span>Course ${G.heading?.toFixed(0).padStart(3, '0')}°</span>`;
    this.intro -= 0.2;
    this.hint.textContent = P.hint || (this.intro > 0 ? (g.touch ? 'Left stick: walk · drag: look · Use / Back: the control in the middle · Orders: the captain · ?: help' : 'H: the keys · Tab: orders to the captain · E: the ladder down to the crew\'s mess') : '');
    this.log.innerHTML = s.log.slice(-5).map((l) => `<div>${fmt(l.t).slice(0, 5)} ${l.who ? `<b>${l.who}:</b> ` : ''}${l.text}</div>`).join('');
  }
}
