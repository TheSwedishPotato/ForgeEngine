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
    this.t = 0;
  }
  toggle() { this.hidden = !this.hidden; for (const e of [this.el, this.hint, this.log]) e.style.display = this.hidden ? 'none' : ''; }
  update(dt) {
    this.t += dt;
    if (this.t < 0.2) return;
    this.t = 0;
    const g = this.game, s = g.sim, G = s.plant.g, P = g.player;
    const x = g.timeScale > 1 ? ` <i>×${g.timeScale}</i>` : '';
    this.el.innerHTML = `<b>${P.where()}</b><span>${fmt(s.clock)} HST${x}</span><span>Depth ${G.depth?.toFixed(0)} ft</span><span>${G.speed?.toFixed(1)} kn</span><span>Course ${G.heading?.toFixed(0).padStart(3, '0')}°</span>`;
    this.hint.textContent = P.hint ?? '';
    this.log.innerHTML = s.log.slice(-5).map((l) => `<div>${fmt(l.t).slice(0, 5)} ${l.who ? `<b>${l.who}:</b> ` : ''}${l.text}</div>`).join('');
  }
}
