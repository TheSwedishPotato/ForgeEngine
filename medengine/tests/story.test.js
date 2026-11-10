import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NodePlatform } from '../src/platform/node.js';
import {
  StoryRunner, StorySystem, compileExpr, compileStatement, validateStory, normalizeStory, storyGraph, toMermaid, toDOT, fuzzStory, playRandom, Engine,
} from '../src/index.js';

const FORD = JSON.parse(fs.readFileSync(new URL('../assets/story/ford.story.json', import.meta.url), 'utf8'));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
const env = (vars = {}, items = {}, extra = {}) => ({ vars, items: new Map(Object.entries(items)), visits: {}, used: new Set(), rng: () => 0.5, fns: {}, ...extra });

/** A tiny story from nodes, ending nodes added automatically. */
const mini = (nodes, extra = {}) => ({ title: 'mini', start: 'a', nodes: { ...nodes, win: { type: 'end', ending: 'win' }, lose: { type: 'end', ending: 'lose' } }, ...extra });

// ---------------------------------------------------------------------------------------------------- expressions

test('expressions: arithmetic, precedence, logic, ternary, strings, functions, unknown names', () => {
  const e = env({ gold: 7, a: 2, name: 'Mara' }, { key: 1, coin: 3 }, { visits: { temple: 2 } });
  const v = (s) => compileExpr(s).run(e);
  assert.equal(v('2 + 3 * 4 - 1'), 13);
  assert.equal(v('(1 + 2) * 3 % 4'), 1);
  assert.equal(v('-a + 5'), 3);
  assert.equal(v('10 / 4'), 2.5);
  assert.equal(v('10 / 0'), 0, 'division by zero is 0, not Infinity');
  assert.equal(v('gold >= 5 and not has("key")'), false);
  assert.equal(v("gold >= 5 && has('key')"), true);
  assert.equal(v('1 > 2 or 3 > 2'), true);
  assert.equal(v('visited("temple") ? "yes" : "no"'), 'yes');
  assert.equal(v('visits("temple") + count("coin")'), 5);
  assert.equal(v("name == 'Mara'"), true);
  assert.equal(v('missing + 1'), 1, 'unknown variables read as 0');
  assert.equal(v('min(4, 2, 9) + max(1, 6) + abs(-3) + floor(2.9) + ceil(2.1) + round(2.5) + clamp(15, 0, 10)'), 2 + 6 + 3 + 2 + 3 + 3 + 10);
  assert.equal(v('d(20)'), 11, 'd(n) uses the seeded generator');
  assert.equal(v('chance(0.6)'), true);
  assert.equal(v('1 == "1"'), true); assert.equal(v('1 === "1"'), false);
  assert.deepEqual([...compileExpr('gold + king.trust > has("x")').ids].sort(), ['gold', 'king.trust']);
  assert.throws(() => v('nope(1)'), /unknown function nope/);
});

test('expressions are data: nothing can run code or escape', () => {
  for (const evil of ['constructor', 'process.exit()', '__proto__', 'this', 'globalThis', 'a.b.c(', '`x`', 'x = 1', 'x; y']) {
    let ok = true;
    try { compileExpr(evil).run(env()); } catch { ok = false; }
    // either a parse error or harmless data (an unknown variable reads 0): never an effect
    assert.ok(!ok || compileExpr(evil).run(env()) === 0, evil);
  }
  assert.equal(globalThis.__story_pwned, undefined);
  const e = env();
  compileStatement('__proto__.polluted = 1').run(e);
  assert.equal({}.polluted, undefined);
});

test('statements: assignment operators, items, errors', () => {
  const e = env({ gold: 10 }, {});
  for (const s of ['gold -= 3', 'gold *= 2', 'gold += 1', 'gold /= 5', 'flag = true', 'name = "x" + "y"', 'give key', 'give coin 3', 'take coin']) compileStatement(s).run(e);
  assert.equal(e.vars.gold, 3); assert.equal(e.vars.flag, true); assert.equal(e.vars.name, 'xy');
  assert.equal(e.items.get('key'), 1); assert.equal(e.items.get('coin'), 2);
  compileStatement('take coin 5').run(e);
  assert.equal(e.items.has('coin'), false, 'items never go negative');
  compileStatement('x %= 0').run(e);
  assert.throws(() => compileStatement('gold >= 3'), /bad statement/);
  assert.throws(() => compileStatement('= 4'), /bad statement/);
  assert.throws(() => compileStatement('gold = '), /bad statement/);
});

// ---------------------------------------------------------------------------------------------------- scenes, text, choices

test('scenes: text interpolation, speakers, conditional lines, hidden / disabled / once choices, implicit continue', () => {
  const s = StoryRunner.from(mini({
    a: {
      speaker: 'Narrator',
      text: ['You have {gold} gold and {gold * 2} dreams. {{not a variable}}', { speaker: 'Ann', text: 'Hello' }, { if: 'gold > 100', text: 'Rich!' }, { if: 'gold < 100', text: 'Poor.' }],
      choices: [
        { text: 'Visible', goto: 'b' },
        { text: 'Hidden unless rich', if: 'gold > 100', goto: 'b' },
        { text: 'Disabled unless rich', if: 'gold > 100', show: 'disabled', hint: 'Need {100 - gold} more', goto: 'b' },
        { text: 'Only once', once: true, say: 'Done {gold}.', do: ['gold += 1'] },
      ],
    },
    b: { text: 'Next', goto: 'win' },
  }, { vars: { gold: 5 } }), { seed: 1 });
  const v = s.start();
  assert.deepEqual(v.lines, [
    { speaker: 'Narrator', text: 'You have 5 gold and 10 dreams. {not a variable}' },
    { speaker: 'Ann', text: 'Hello' },
    { speaker: 'Narrator', text: 'Poor.' },
  ]);
  assert.deepEqual(v.choices.map((c) => [c.text, c.enabled, c.hint]), [['Visible', true, null], ['Disabled unless rich', false, 'Need 95 more'], ['Only once', true, null]]);
  assert.throws(() => s.choose(1), /not available.*Need 95 more/);
  const v2 = s.choose(2);                                   // 'Only once': stays, says something, and disappears
  assert.equal(v2.id, 'a'); assert.equal(v2.message, 'Done 6.'); assert.equal(s.vars.gold, 6);
  assert.deepEqual(v2.choices.map((c) => c.text), ['Visible', 'Disabled unless rich']);
  const v3 = s.choose(0);
  assert.equal(v3.id, 'b');
  assert.deepEqual(v3.choices.map((c) => [c.text, c.implicit]), [['Continue', true]], 'a goto-only scene offers an implicit Continue');
  s.choose(0);
  assert.deepEqual(s.ended, { ending: 'win', node: 'win' });
  assert.throws(() => s.choose(0), /it is over/);
  assert.deepEqual(s.path, ['a', 'b', 'win'], 'staying on a node (a once-only choice) is not entering it again');
  assert.throws(() => StoryRunner.from(mini({ a: { text: 'x', goto: 'win' } })).choose(0), /not started/);
});

test('on-enter effects, once ids, visits, check nodes and branch / random nodes', () => {
  const s = StoryRunner.from(mini({
    a: { on: ['n += 1'], text: 'a', choices: [{ text: 'again', goto: 'a' }, { text: 'go', goto: 'br' }] },
    br: { type: 'branch', cases: [{ if: 'n >= 3', goto: 'win', do: ['via = 1'] }, { if: 'n == 2', goto: 'mid' }], else: 'a' },
    mid: { text: 'mid', goto: 'a' },
  }, { vars: { n: 0 } }), { seed: 3 });
  s.start();
  s.choose(1);                                              // n = 1: branch else -> a (n = 2)
  assert.equal(s.node, 'a'); assert.equal(s.vars.n, 2);
  s.choose(1);                                              // n == 2 -> mid
  assert.equal(s.node, 'mid');
  s.choose(0);                                              // a again: n = 3
  s.choose(1);                                              // branch: n >= 3 -> win
  assert.equal(s.vars.via, 1); assert.equal(s.ended.ending, 'win');
  assert.equal(s.visits.a, 3);
  // an automatic loop that depends on state is caught at run time instead of hanging (the validator cannot know the state)
  const loop = StoryRunner.from(mini({ a: { type: 'branch', cases: [{ if: 'x < 5', goto: 'b' }], else: 'win' }, b: { type: 'branch', cases: [{ goto: 'a' }] } }, { vars: { x: 0 } }));
  assert.throws(() => loop.start(), /automatic nodes in a row/);
  // while one that changes the state ends normally
  const count = StoryRunner.from(mini({ a: { type: 'branch', cases: [{ if: 'x < 5', goto: 'b' }], else: 'win' }, b: { type: 'branch', cases: [{ goto: 'a', do: ['x += 1'] }] } }, { vars: { x: 0 } }));
  count.start();
  assert.equal(count.ended.ending, 'win'); assert.equal(count.vars.x, 5);
  // a story whose every route is a closed loop is rejected up front
  assert.throws(() => StoryRunner.from(mini({ a: { type: 'branch', cases: [{ goto: 'b' }] }, b: { type: 'branch', cases: [{ goto: 'a' }] } })), /no ending can be reached/);
});

test('random nodes follow their weights and conditions, and are deterministic per seed', () => {
  const data = mini({ a: { type: 'random', options: [{ weight: 3, goto: 'win' }, { weight: 1, goto: 'lose' }, { goto: 'never', if: 'false' }] }, never: { type: 'end' } });
  const tally = (seed) => { let w = 0; for (let i = 0; i < 4000; i++) { const s = StoryRunner.from(data, { seed: seed + i }); s.start(); if (s.ended.ending === 'win') w++; } return w / 4000; };
  near(tally(1), 0.75, 0.03);
  const a = StoryRunner.from(data, { seed: 99 }), b = StoryRunner.from(data, { seed: 99 });
  a.start(); b.start();
  assert.equal(a.ended.ending, b.ended.ending);
  assert.throws(() => StoryRunner.from(mini({ a: { type: 'random', options: [{ goto: 'win', if: 'false' }] } })).start(), /no option whose condition holds/);
});

test('skill checks use the seeded dice and land on success or fail', () => {
  const data = mini({ a: { text: 'Lift the gate', choices: [{ text: 'Try', check: 'd(20) + str >= 12', success: 'win', fail: 'lose', passText: 'It rises.', failText: 'It does not budge.' }] } }, { vars: { str: 4 } });
  const wins = [];
  for (let seed = 0; seed < 600; seed++) { const s = StoryRunner.from(data, { seed }); s.start(); const v = s.choose(0); wins.push(s.ended.ending === 'win'); assert.equal(v.message, wins.at(-1) ? 'It rises.' : 'It does not budge.'); }
  near(wins.filter(Boolean).length / wins.length, 13 / 20, 0.06);       // d20 + 4 >= 12 -> d20 >= 8 -> 13 of 20
  // the same seed always rolls the same
  const x = StoryRunner.from(data, { seed: 5 }), y = StoryRunner.from(data, { seed: 5 });
  x.start(); y.start(); x.choose(0); y.choose(0);
  assert.equal(x.ended.ending, y.ended.ending);
});

// ---------------------------------------------------------------------------------------------------- timers, QTEs, negotiation, exploration

test('timed nodes count down in game time and take the timeout route (or the chosen default choice)', () => {
  const data = mini({
    a: { type: 'timed', text: 't', seconds: 5, choices: [{ text: 'quick', goto: 'win' }, { text: 'slow', goto: 'lose' }], timeout: 'lose' },
    b: { type: 'timed', text: 't', seconds: 2, choices: [{ text: 'first', goto: 'lose' }, { text: 'second', goto: 'win' }], timeout: 1 },
  });
  let s = StoryRunner.from(data); s.start();
  assert.deepEqual(s.view.timer, { total: 5, left: 5 });
  s.update(2); near(s.view.timer.left, 3);
  s.paused = true; s.update(100); near(s.view.timer.left, 3); s.paused = false;
  s.update(2.9); assert.equal(s.ended, null);
  s.update(0.2); assert.equal(s.ended.ending, 'lose');
  s = StoryRunner.from(data); s.start();
  s.update(1); s.choose(0); assert.equal(s.ended.ending, 'win', 'choosing in time cancels the clock');
  s.update(100); assert.equal(s.ended.ending, 'win');
  s = StoryRunner.from(data); s.start('b'); s.update(2.5);
  assert.equal(s.ended.ending, 'win', 'a numeric timeout picks that choice');
  const seen = []; s = StoryRunner.from(data); s.on('timeout', (e) => seen.push(e.node)); s.start(); s.update(9);
  assert.deepEqual(seen, ['a']);
});

test('quick-time events: sequences, misses, timeouts and button mashing', () => {
  const seq = mini({ a: { type: 'qte', text: 'go', keys: ['KeyA', 'KeyD', 'Space'], window: 1, allowMisses: 1, success: 'win', fail: 'lose' } });
  let s = StoryRunner.from(seq); s.start();
  assert.deepEqual(s.view.qte, { mode: 'sequence', keys: ['KeyA', 'KeyD', 'Space'], index: 0, window: 1, left: 1, misses: 0, allowMisses: 1 });
  assert.equal(s.input('a'), true, 'key names are compared loosely');
  assert.equal(s.input('KeyX'), false);
  assert.equal(s.view.qte.misses, 1); assert.equal(s.view.qte.index, 1);
  s.input('d'); s.input('Space');
  assert.equal(s.ended.ending, 'win');
  s = StoryRunner.from(seq); s.start(); s.input('x'); s.input('y');
  assert.equal(s.ended.ending, 'lose', 'one miss too many');
  s = StoryRunner.from(seq); s.start(); s.update(0.9); s.input('a'); near(s.view.qte.left, 1, 1e-9); s.update(1.1);
  assert.equal(s.view.qte.misses, 1, 'a window that runs out is a miss'); assert.equal(s.ended, null);
  s.update(1.0); assert.equal(s.ended.ending, 'lose');
  s = StoryRunner.from(seq); s.start(); s.update(10);
  assert.equal(s.ended.ending, 'lose', 'one long frame cannot skip the failure');

  const mash = mini({ a: { type: 'qte', text: 'mash', mash: { key: 'Space', count: 5, seconds: 2 }, success: 'win', fail: 'lose' } });
  s = StoryRunner.from(mash); s.start();
  for (let i = 0; i < 4; i++) s.input('Space');
  assert.equal(s.view.qte.count, 4); s.update(1);
  assert.equal(s.input('KeyA'), false);
  s.input('Space'); assert.equal(s.ended.ending, 'win');
  s = StoryRunner.from(mash); s.start(); s.input('Space'); s.update(2.1); assert.equal(s.ended.ending, 'lose');
  s = StoryRunner.from(seq); s.start();
  assert.throws(() => s.choose(0), /quick-time/, 'choices do not apply to a quick-time event');
  assert.equal(StoryRunner.from(seq).input('a'), false, 'input before start() is ignored');
  s.input('a'); s.input('d'); s.input('Space');
  assert.equal(s.input('a'), false, 'and so is input after the end');
});

test('negotiation: the meter moves, risky options can backfire, win / lose / round limit end it', () => {
  const nego = (extra = {}) => mini({
    a: {
      type: 'negotiation', text: 'Parley', meter: { name: 'trust', min: -5, max: 5, start: 0 }, win: 3, lose: -3, rounds: 4, onWin: 'win', onLose: 'lose', ...extra,
      options: [
        { text: 'kind', delta: 2, reply: 'Warm.' },
        { text: 'rude', delta: -2 },
        { text: 'gamble', delta: 2, risk: 1, riskDelta: -3, failText: 'Ouch.' },
        { text: 'costly', if: 'gold >= 1', show: 'disabled', delta: 1, do: ['gold -= 1'], once: true },
      ],
    },
  }, { vars: { gold: 1 } });
  let s = StoryRunner.from(nego()); s.start();
  assert.deepEqual(s.view.meter, { name: 'trust', value: 0, min: -5, max: 5, win: 3, lose: -3, round: 0, rounds: 4 });
  const moves = []; s.on('meter', (m) => moves.push([m.from, m.to, m.risky]));
  s.choose(0); assert.equal(s.view.message, 'Warm.'); assert.equal(s.vars.trust, 2);
  s.choose(3); assert.equal(s.ended.ending, 'win'); assert.equal(s.vars.gold, 0);
  assert.deepEqual(moves, [[0, 2, false], [2, 3, false]]);
  s = StoryRunner.from(nego()); s.start(); s.choose(2);
  assert.equal(s.vars.trust, -3); assert.equal(s.ended.ending, 'lose'); assert.equal(s.view.message, 'Ouch.');
  // rounds run out: above the midpoint wins, below loses, or a dedicated route
  s = StoryRunner.from(nego({ rounds: 2, win: 5, lose: -5 })); s.start(); s.choose(0); s.choose(1); assert.equal(s.ended.ending, 'win');
  s = StoryRunner.from(nego({ rounds: 2, win: 5, lose: -5 })); s.start(); s.choose(1); s.choose(1); assert.equal(s.ended.ending, 'lose');
  s = StoryRunner.from(nego({ rounds: 1, win: 5, lose: -5, onTimeout: 'lose' })); s.start(); s.choose(0); assert.equal(s.ended.ending, 'lose');
  // clamped to the meter's range
  s = StoryRunner.from(nego({ win: 5, lose: -5, rounds: 9, meter: { name: 'trust', min: -5, max: 5, start: 4 } })); s.start(); s.choose(0); assert.equal(s.ended.ending, 'win');
});

test('exploration: spots can be examined, once-only, and some lead away', () => {
  const s = StoryRunner.from(mini({
    a: {
      type: 'explore', text: 'A courtyard',
      spots: [
        { text: 'Search the well', once: true, say: 'You find a coin.', do: ['give coin'] },
        { text: 'Pet the dog', say: 'Woof.' },
        { text: 'Open the door', if: "has('coin')", show: 'disabled', hint: 'It wants a coin', goto: 'win' },
      ],
    },
  }));
  s.start();
  assert.equal(s.view.choices[2].enabled, false);
  assert.equal(s.choose(1).message, 'Woof.');
  assert.equal(s.view.choices.length, 3, 'repeatable spots stay');
  s.choose(0);
  assert.equal(s.items.get('coin'), 1);
  assert.deepEqual(s.view.choices.map((c) => c.text), ['Pet the dog', 'Open the door']);
  assert.equal(s.node, 'a'); assert.equal(s.view.choices[1].enabled, true);
  s.choose(1);
  assert.equal(s.node, 'win');
});

// ---------------------------------------------------------------------------------------------------- saves, determinism, endings

test('save / load restores the exact state, including the dice and a running timer', () => {
  const data = mini({
    a: { text: 'a', choices: [{ text: 'on', goto: 't', do: ['x += 1'] }] },
    t: { type: 'timed', text: 'hurry', seconds: 10, choices: [{ text: 'roll', check: 'd(6) >= 4', success: 'win', fail: 'lose' }], timeout: 'lose' },
  }, { vars: { x: 0 } });
  const a = StoryRunner.from(data, { seed: 21 }); a.start(); a.choose(0); a.update(4);
  const save = JSON.parse(JSON.stringify(a.save()));        // survives JSON
  const b = StoryRunner.from(data, { seed: 1 });
  b.load(save);
  assert.equal(b.node, 't'); assert.equal(b.vars.x, 1);
  near(b.view.timer.left, 6);
  b.update(2); a.update(2);
  near(b.view.timer.left, 4); near(a.view.timer.left, 4);
  a.choose(0); b.choose(0);
  assert.equal(a.ended.ending, b.ended.ending, 'the same dice after loading');
  assert.deepEqual(b.path, a.path);
  assert.throws(() => b.load({ v: 1, title: 'other', node: 'a' }), /from "other"/);
  assert.throws(() => b.load({ v: 2 }), /unknown save format/);
  assert.throws(() => b.load({ ...save, node: 'gone' }), /no longer exists/);
});

const pickText = (s, text) => { const i = s.view.choices.findIndex((c) => c.text === text); assert.ok(i >= 0, `no choice "${text}" at '${s.node}': ${s.view.choices.map((c) => c.text).join(' | ')}`); return s.choose(i); };

test('save / load keeps once-only choices, items and the transcript', () => {
  const s = StoryRunner.from(FORD, { seed: 4 }); s.start();
  pickText(s, 'Look around the riverside village first');
  pickText(s, 'Search the empty hut');
  assert.equal(s.view.message, 'Under a loose board you find a coil of good rope.');
  const save = JSON.parse(JSON.stringify(s.save()));
  const t = StoryRunner.from(FORD, { seed: 99 }); t.load(save);
  assert.deepEqual(t.view.choices.map((c) => c.text), ['Draw water from the well', 'Talk to the smith', 'Head down to the ford'], 'the hut is not offered twice');
  assert.equal(t.items.get('rope'), 1); assert.equal(t.items.get('letter'), 1);
  assert.equal(t.view.message, s.view.message);
  assert.deepEqual(t.transcript, s.transcript);
  assert.deepEqual(t.flowchart().edges.filter((e) => e.taken), s.flowchart().edges.filter((e) => e.taken));
});

test('save / load keeps a negotiation mid-way: meter, round and what happens next', () => {
  const s = StoryRunner.from(FORD, { seed: 4 }); s.start();
  pickText(s, 'Go down to the ford'); pickText(s, 'Haggle with the ferryman');
  pickText(s, 'Offer two coins');
  assert.deepEqual([s.view.meter.value, s.view.meter.round, s.vars.gold], [2, 1, 6]);
  const t = StoryRunner.from(FORD); t.load(JSON.parse(JSON.stringify(s.save())));
  assert.deepEqual(t.view.meter, s.view.meter);
  assert.deepEqual(t.view.choices.map((c) => c.text), ['Admire his boat', 'Offer two coins', 'Show him the Guild seal', 'Threaten him']);
  pickText(t, 'Offer two coins');
  assert.equal(t.node, 'ferry', 'the second offer reaches the winning line (4) in the restored negotiation');
  assert.equal(t.vars.gold, 4);
  // a save taken before start() restores to "not started", keeping only the endings seen
  const fresh = StoryRunner.from(FORD); fresh.meta.endings.add('drowned');
  const empty = StoryRunner.from(FORD); empty.load(fresh.save());
  assert.equal(empty.node, null); assert.deepEqual([...empty.meta.endings], ['drowned']);
});

test('endings seen survive restarts and can be asked about in conditions', () => {
  const data = mini({ a: { type: 'branch', cases: [{ if: "ended('lose')", goto: 'win' }], else: 'lose' } });
  const s = StoryRunner.from(data); s.start();
  assert.equal(s.ended.ending, 'lose');
  s.start();
  assert.equal(s.ended.ending, 'win', 'the second run knows about the first ending');
  assert.deepEqual([...s.meta.endings].sort(), ['lose', 'win']);
  const t = StoryRunner.from(data); t.load(s.save());
  assert.deepEqual(t.ended, { ending: 'win', node: 'win' });
  assert.deepEqual([...t.meta.endings].sort(), ['lose', 'win']);
  s.reset(true); assert.equal(s.meta.endings.size, 0);
});

// ---------------------------------------------------------------------------------------------------- validation

test('validation lists every problem in one go', () => {
  const bad = validateStory({
    title: 'bad', start: 'a',
    nodes: {
      a: { text: 'x', choices: [{ text: 'dangling', goto: 'nowhere' }, { text: 'bad expr', if: 'gold >=', goto: 'b' }, { goto: 'b' }] },
      b: { text: 'stuck' },
      c: { type: 'qte', keys: [], success: 'a' },
      d: { type: 'timed', text: 't', seconds: 0, choices: [{ text: 'x', goto: 'a' }] },
      e: { type: 'negotiation', meter: { name: 'm', min: 0, max: 5 }, win: 9, lose: 1, options: [] },
      f: { type: 'explore', spots: [{ text: 'look' }] },
      g: { type: 'branch', cases: [{ if: 'x ===', goto: 'a' }] },
      h: { type: 'wat' },
    },
  });
  const all = bad.errors.join('\n');
  for (const re of [/node 'nowhere'|leads to 'nowhere'/, /gold >=/, /needs 'text'/, /node 'b'.*choices.*goto/, /node 'c'.*keys/, /node 'c'.*success.*fail/, /node 'd'.*seconds/, /node 'd'.*timeout/, /node 'e'.*win.*range|node 'e'.*options/, /node 'f'.*never leave/, /node 'g'/, /unknown type 'wat'/, /no ending can be reached/]) assert.match(all, re);
  assert.throws(() => normalizeStory({ title: 'bad', start: 'a', nodes: { a: { text: 'x' } } }), /1 problem|2 problems/);
  assert.throws(() => StoryRunner.from({ title: 't', start: 'nope', nodes: { a: { type: 'end' } } }), /'start'/);
  assert.deepEqual(validateStory(FORD).errors, []);
  assert.deepEqual(validateStory(FORD).warnings, []);
});

test('validation warns about unreachable nodes, undeclared variables and branches that may fail', () => {
  const v = validateStory(mini({
    a: { text: 'x', choices: [{ text: 'go', if: 'tpyo > 1', goto: 'win' }] },
    orphan: { type: 'end' },
    br: { type: 'branch', cases: [{ if: 'true', goto: 'win' }] },
  }, { vars: { unused: 1 } }));
  assert.deepEqual(v.errors, []);
  const w = v.warnings.join('\n');
  assert.match(w, /'orphan' can never be reached/);
  assert.match(w, /'tpyo' is read .* but never declared/);
  assert.match(w, /'unused' is declared but never used/);
  assert.match(w, /no 'else'/);
});

// ---------------------------------------------------------------------------------------------------- flowchart & fuzz

test('flowchart: the whole graph, what was visited, Mermaid and DOT export', () => {
  const g = storyGraph(FORD);
  assert.equal(g.nodes.length, Object.keys(FORD.nodes).length);
  assert.ok(g.edges.some((e) => e.from === 'ford' && e.to === 'parley' && e.label === 'Haggle with the ferryman'));
  assert.ok(g.edges.some((e) => e.from === 'swept' && e.to === 'end_drowned' && /✗/.test(e.label)));
  assert.ok(g.edges.some((e) => e.from === 'mist' && e.to === 'swept' && e.kind === 'timeout'));
  assert.ok(g.edges.some((e) => e.from === 'wade' && e.to === 'swept' && e.label === '25%'));
  assert.ok(g.edges.some((e) => e.from === 'wade' && e.to === 'fort_road' && e.label === '75%'));
  const s = StoryRunner.from(FORD, { seed: 2 }); s.start(); s.choose(0);       // camp -> ford
  const f = s.flowchart();
  assert.equal(f.nodes.find((n) => n.id === 'ford').current, true);
  assert.equal(f.nodes.find((n) => n.id === 'camp').visits, 1);
  assert.equal(f.edges.find((e) => e.from === 'camp' && e.to === 'ford').taken, true);
  assert.equal(f.edges.find((e) => e.from === 'camp' && e.to === 'village').taken, false);
  const m = toMermaid(FORD, f);
  assert.match(m, /^flowchart TD/);
  assert.match(m, /n_camp\["camp: /);
  assert.match(m, /n_camp ==>\|"Go down to the ford"\| n_ford/, 'taken edges are drawn thick');
  assert.match(m, /n_camp -->\|"Look around the riverside village first"\| n_village/);
  assert.match(m, /n_wade\{"wade"\}/, 'a node without text is labelled with its id once, not "wade: wade"');
  assert.match(m, /class n_camp visited;/); assert.match(m, /class n_ford current;/); assert.match(m, /class .*n_end_delivered.* ending;/);
  assert.doesNotMatch(m, /\bend;|classDef end\b/, "'end' alone breaks Mermaid flowcharts");
  assert.match(toDOT(FORD), /^digraph story \{[\s\S]*"camp" -> "ford"/);
  // labels with quotes, angle brackets, pipes and backslashes stay well-formed in both formats
  const odd = mini({ a: { text: 'Say "hi" <b> & | \\ done', choices: [{ text: 'a > b | "c"', goto: 'win' }] } });
  const mm = toMermaid(odd), dot = toDOT(odd);
  assert.match(mm, /n_a\["a: Say #quot;hi#quot; #lt;b#gt; #amp; #124; \\ done"\]/);
  assert.match(mm, /n_a -->\|"a #gt; b #124; #quot;c#quot;"\| n_win/);
  assert.match(dot, /"a" \[label="a\\nSay \\"hi\\" <b> & \| \\\\ done"\];/);
  assert.match(dot, /"a" -> "win" \[label="a > b \| \\"c\\""\];/);
});

test('1,500 random playthroughs: no softlocks, no endless loops, every ending and every node reachable', () => {
  const rep = fuzzStory(FORD, { runs: 1500, seed: 1 });
  assert.deepEqual(rep.softlocks, []);
  assert.deepEqual(rep.loops, []);
  assert.deepEqual(rep.unvisited, []);
  assert.deepEqual(Object.keys(rep.endings).sort(), ['beaten', 'delivered', 'drowned', 'empty_handed', 'gave_up', 'sold']);
  assert.equal(Object.values(rep.endings).reduce((a, b) => a + b, 0), 1500);
  assert.ok(rep.ok && rep.avgSteps > 3);
  // and the same seed always gives the same report
  assert.deepEqual(fuzzStory(FORD, { runs: 100, seed: 5 }).endings, fuzzStory(FORD, { runs: 100, seed: 5 }).endings);
  // the bot does notice a trap
  const trap = fuzzStory(mini({ a: { text: 'x', choices: [{ text: 'go', goto: 'dead' }, { text: 'out', goto: 'win' }] }, dead: { text: 'dead end', choices: [{ text: 'never', if: 'false', goto: 'win' }] } }), { runs: 50 });
  assert.ok(trap.softlocks.length > 0 && !trap.ok);
  assert.equal(trap.softlocks[0].node, 'dead');
  // a story that can be left on paper but not in play (the way out is locked for good) is reported as a loop
  const cyc = playRandom(mini({ a: { text: 'x', choices: [{ text: 'again', goto: 'a' }, { text: 'out', if: 'false', show: 'disabled', goto: 'win' }] } }), { maxSteps: 50 });
  assert.equal(cyc.result, 'loop'); assert.equal(cyc.steps, 50);
});

test('a hand-played route through the sample story: the good ending', () => {
  const s = StoryRunner.from(FORD, { seed: 12 });
  s.start();
  const pick = (text) => pickText(s, text);
  pick('Go down to the ford');
  pick('Haggle with the ferryman');
  assert.equal(s.view.type, 'negotiation');
  pick('Offer two coins');                                   // +2
  pick('Offer two coins');                                   // +2 -> 4 = the winning line
  assert.equal(s.node, 'ferry');
  pick('Continue');                                          // a scene with only a `goto` offers an implicit Continue
  assert.equal(s.node, 'fort_road');
  assert.equal(s.vars.gold, 4);
  pick('Walk to the main gate');
  assert.equal(s.node, 'gate_guard', 'the gate is a branch: with the letter in the coat the sergeant listens');
  pick('Hand over the letter');
  assert.equal(s.ended.ending, 'delivered');
  assert.match(s.transcript.at(-1).text, /garrison is marching/);
  assert.deepEqual(s.path, ['camp', 'ford', 'parley', 'ferry', 'fort_road', 'gate', 'gate_guard', 'end_delivered']);
  assert.deepEqual([...s.meta.endings], ['delivered']);
});

test('hand-played routes through the other endings', () => {
  const play = (seed, ...steps) => {
    const s = StoryRunner.from(FORD, { seed }); s.start();
    for (const st of steps) { if (typeof st === 'string') pickText(s, st); else st(s); }
    return s;
  };
  const stones = (r) => { for (const k of ['KeyA', 'KeyD', 'KeyA', 'KeyD', 'KeyA']) r.input(k); };
  const firstSeed = (fn, max = 500) => { for (let seed = 1; seed <= max; seed++) { const r = fn(seed); if (r) return r; } assert.fail(`none of ${max} seeds gave the route`); };

  // sell the letter at the postern: the seal was studied first, so the stranger says something extra
  let s = play(1, "Study the letter's seal", 'Go down to the ford', 'Wait for the mist to thin', 'Shout for the ferryman', 'Offer two coins', 'Offer two coins', 'Continue', 'Circle round to the postern');
  assert.ok(s.view.lines.some((l) => /second mark/.test(l.text)), 'knowing about the seal changes what the stranger says');
  pickText(s, 'Sell the letter');
  assert.equal(s.ended.ending, 'sold'); assert.match(s.transcript.at(-1).text, /^24 coins weigh more/);

  // dawdling at the ford: the sluice opens, the river takes three coins and gives a bruise
  s = play(2, 'Go down to the ford', 'Wait for the mist to thin', (r) => r.update(9));
  assert.equal(s.node, 'swept');
  assert.deepEqual([s.vars.gold, s.vars.wounds], [5, 1]);

  // the river can also take the letter: swept, a lucky check, a 30% roll, and the sergeant does not believe you
  s = firstSeed((seed) => {
    const r = play(seed, 'Go down to the ford', 'Wait for the mist to thin', (x) => x.update(9), 'Fight for the bank');
    return r.node === 'ashore_lost' ? r : null;
  });
  assert.equal(s.items.has('letter'), false);
  pickText(s, 'Continue'); pickText(s, 'Walk to the main gate');
  assert.equal(s.ended.ending, 'empty_handed');

  // a failed fight for the bank is the end of Mara
  s = firstSeed((seed) => { const r = play(seed, 'Go down to the ford', 'Wait for the mist to thin', (x) => x.update(9), 'Fight for the bank'); return r.ended ? r : null; });
  assert.equal(s.ended.ending, 'drowned'); assert.equal(s.view.message, 'The river is stronger than you.');

  // lose the negotiation, then give up
  s = firstSeed((seed) => { const r = play(seed, 'Go down to the ford', 'Haggle with the ferryman', (x) => { while (x.node === 'parley') pickText(x, 'Threaten him'); }); return r.node === 'ferry_refused' ? r : null; });
  pickText(s, 'Give up and turn back');
  assert.equal(s.ended.ending, 'gave_up');

  // the scuffle at the postern is a button mash: eight presses of Space within three seconds
  s = play(5, 'Go down to the ford', 'Hop across the stepping stones', stones, 'Circle round to the postern', 'Shove him aside');
  assert.deepEqual(s.view.qte, { mode: 'mash', key: 'Space', count: 0, need: 8, total: 3, left: 3 });
  for (let i = 0; i < 8; i++) s.input('Space');
  assert.equal(s.node, 'gate_guard');
  s = play(5, 'Go down to the ford', 'Hop across the stepping stones', stones, 'Circle round to the postern', 'Shove him aside', (r) => { for (let i = 0; i < 5; i++) r.input('Space'); r.update(3.1); });
  assert.equal(s.ended.ending, 'beaten');
});

// ---------------------------------------------------------------------------------------------------- engine integration

test('StorySystem: number keys, arrows + Enter and QTE keys drive the story; timers use game time', async () => {
  const engine = await Engine.create({ platform: new NodePlatform(), render: false });
  const story = StoryRunner.from(FORD, { seed: 8 });
  const sys = new StorySystem(story);
  engine.add(sys);
  story.start();
  assert.equal(sys.selected, 0);
  engine.platform.injectKey('ArrowDown');
  assert.equal(sys.selected, 1);
  engine.platform.injectKey('ArrowDown'); engine.platform.injectKey('ArrowDown');
  assert.equal(sys.selected, 0, 'the selection wraps');
  engine.platform.injectKey('Digit1');                       // camp: Go down to the ford
  assert.equal(story.node, 'ford');
  engine.platform.injectKey('Digit4');                       // Wait for the mist to thin
  assert.equal(story.node, 'mist');
  engine.run(60 * 3, 1 / 60, { draw: false });
  near(story.view.timer.left, 5, 0.05);
  engine.platform.injectKey('Digit1');                       // run for the stepping stones
  assert.equal(story.view.type, 'qte');
  for (const k of ['KeyA', 'KeyD', 'KeyA', 'KeyD', 'KeyA']) engine.platform.injectKey(k);
  assert.equal(story.node, 'fort_road');
  engine.platform.injectKey('ArrowDown'); engine.platform.injectKey('Enter');
  assert.equal(story.node, 'postern');
  engine.platform.injectKey('Digit9');                       // no such choice: ignored
  assert.equal(story.node, 'postern');
  // keys held down (auto-repeat) do not trigger twice
  engine.platform.injectKey('Digit2', true, { repeat: true });
  assert.equal(story.node, 'postern');
  engine.dispose();
  engine.platform.injectKey('Digit2');
  assert.equal(story.node, 'postern', 'a disposed system no longer listens');
});
