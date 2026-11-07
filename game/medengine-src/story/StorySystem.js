/**
 * Plugs a StoryRunner into the Engine: ticks its clock, turns number keys / arrows + Enter into choices and forwards key presses to
 * quick-time events. Draw `runner.view` however you like (HTML overlay, in-world text, a diegetic UI).
 *
 *   const story = StoryRunner.from(json);
 *   const sys = new StorySystem(story);
 *   engine.add(sys);
 *   story.start();
 *   // each frame: sys.selected is the highlighted choice index (arrow keys), story.view is what to draw
 *
 * Keys: 1-9 (or numpad) pick that choice; Up / Down move `selected`, Enter / Space pick it; during a quick-time event every key
 * goes to `story.input(code)`.
 */

/** @import { StoryRunner } from './StoryRunner.js' */

export class StorySystem {
  /**
   * @param {StoryRunner} runner
   * @param {object} [o]
   * @param {boolean} [o.keys]     handle keyboard input (default true)
   * @param {boolean} [o.pauseWithEngine] stop the story clock while the engine is paused (default true; a scaled engine clock scales it)
   */
  constructor(runner, { keys = true, pauseWithEngine = true } = {}) {
    this.runner = runner;
    this.keys = keys;
    this.pauseWithEngine = pauseWithEngine;
    /** Index in `runner.view.choices` highlighted by the arrow keys. */
    this.selected = 0;
    this._off = [];
  }

  onAdd(engine) {
    this.engine = engine;
    this._off.push(this.runner.on('enter', () => this._reset()), this.runner.on('update', () => this._clamp()));
    if (this.keys) this._off.push(engine.platform.on('key', (e) => this._key(e)));
    this._reset();
  }

  update(dt) { if (!this.runner.paused) this.runner.update(dt); }

  _open() { return (this.runner.view?.choices ?? []).filter((c) => c.enabled).map((c) => c.index); }
  _reset() { this.selected = this._open()[0] ?? 0; }
  _clamp() { const o = this._open(); if (!o.includes(this.selected)) this.selected = o[0] ?? 0; }

  _key(e) {
    if (!e.down || e.repeat) return;
    const r = this.runner, v = r.view;
    if (!v || r.ended || r.paused) return;
    if (v.type === 'qte') { r.input(e.code); return; }
    const num = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    const open = this._open();
    if (num) { const i = +num[1] - 1; if (open.includes(i)) r.choose(i); return; }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      if (!open.length) return;
      const at = open.indexOf(this.selected), step = e.code === 'ArrowDown' ? 1 : -1;
      this.selected = open[(at + step + open.length) % open.length];
    } else if ((e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') && open.includes(this.selected)) r.choose(this.selected);
  }

  dispose() { for (const f of this._off) f(); this._off.length = 0; }
}
