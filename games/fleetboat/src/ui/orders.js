/**
 * Your orders to the captain (you own her; he commands her): a panel of what can be ordered,
 * opened with Tab. Each order goes to the crew (crew.js / procedures.js), who carry it out with
 * their hands, in their own time, and report.
 */
import { FT } from '../data/boat.js';

const GROUPS = [
  ['Diving', [
    ['Dive to periscope depth, 60 ft', (c) => c.order('dive', { depth: 60 * FT })],
    ['Dive to 150 ft', (c) => c.order('dive', { depth: 150 * FT })],
    ['Dive to 300 ft', (c) => c.order('dive', { depth: 300 * FT })],
    ['Surface', (c) => c.order('surface')],
  ]],
  ['Depth', [60, 100, 150, 200, 300, 400].map((d) => [`Make depth ${d} ft`, (c) => c.order('changeDepth', { depth: d * FT })])],
  ['Speed', [['Stop', 'stop'], ['Ahead one third', 'ahead1'], ['Ahead two thirds', 'ahead2'], ['Ahead standard', 'standard'], ['Ahead full', 'full'], ['Ahead flank', 'flank'], ['Back one third', 'back1'], ['Back full', 'backFull']].map(([l, b]) => [l, (c) => c.order('speed', { bell: b })])],
  ['Course', [
    ['Left 10°', (c) => c.order('course', { heading: c.orders.heading - 10 })], ['Right 10°', (c) => c.order('course', { heading: c.orders.heading + 10 })],
    ['Left 90°', (c) => c.order('course', { heading: c.orders.heading - 90 })], ['Right 90°', (c) => c.order('course', { heading: c.orders.heading + 90 })],
    ['Reverse course (hard right)', (c) => c.order('course', { heading: c.orders.heading + 180, rudder: 35 })],
  ]],
  ['Engines', [
    ['Diesels: two on propulsion, two charging', (c) => c.order('dieselPropulsion', { charge: true })],
    ['Diesels: all four on propulsion', (c) => { c.order('dieselPropulsion', { charge: false }); c.order('startEngine3Prop'); c.order('startEngine4Prop'); }],
    ['Shift to the battery', (c) => c.order('shiftToBattery')],
  ]],
  ['Lights', [['Rig for red', (c) => c.order('rigForRed')], ['Rig for white', (c) => c.order('rigForWhite')]]],
];

export class Orders {
  constructor(root, game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'orders';
    this.el.style.display = 'none';
    this.el.innerHTML = `<h3>Orders to the captain</h3>` + GROUPS.map(([g, list], i) => `<section><h4>${g}</h4>${list.map(([l], k) => `<button data-g="${i}" data-k="${k}">${l}</button>`).join('')}</section>`).join('')
      + `<section><h4>Time</h4>${[1, 2, 4, 8].map((t) => `<button data-t="${t}">×${t}</button>`).join('')}</section><p class="small">Tab closes. The crew carry out each order by hand and report.</p>`;
    root.append(this.el);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.t) { game.timeScale = Number(b.dataset.t); return; }
      const [, list] = GROUPS[Number(b.dataset.g)];
      const [label, fn] = list[Number(b.dataset.k)];
      fn(game.sim.crew);
      game.sim.say(label, 'You');
      this.toggle(false);
    });
    window.addEventListener('keydown', (e) => { if (e.code === 'Tab') { e.preventDefault(); this.toggle(); } });
  }
  toggle(on = this.el.style.display === 'none') {
    this.el.style.display = on ? '' : 'none';
    if (on && document.pointerLockElement) document.exitPointerLock();
  }
}
