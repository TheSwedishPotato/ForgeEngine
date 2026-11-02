// Plays the whole episode through the story runner thousands of times with random choices,
// QTE results, free text (offline fallbacks) and conversation turns, against a mock theatre:
// every path must reach the end card without an exception, and every branch must be reachable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runner, matchOption } from '../src/story/Runner.js';
import { CAST } from '../src/story/episode1.js';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

class MockTheatre {
  constructor(rand) { this.rand = rand; this.log = []; this.ended = false; this.lines = 0; }
  chapterCard(id) { this.log.push('chapter:' + id); }
  stage() {} place() {} act() {} cut(s) { assert.ok(s && typeof s === 'object'); } weather() {} music() {} sfx() {} ambience() {} space() {} lights() {} strike() {} kick() {} sting() {}
  wait() {} caption(t) { assert.equal(typeof t, 'string'); } objective() {} notify() {} fade() {} thinking() {} meter() {}
  special(n) { this.log.push('special:' + n); } headline(h) { this.log.push('headline:' + h); }
  endCard() { this.ended = true; }
  fight() {}
  line(who, text) { assert.ok(CAST[who], `unknown speaker ${who}`); assert.ok(text && text.length < 300, 'line text'); this.lines++; }
  qte(spec) { assert.ok(spec.keys?.length); return this.rand() < 0.6; }
  explore(spec, visit) { return (async () => { for (const s of spec.spots) if (this.rand() < 0.8 || spec.need.includes(s.id)) await visit(s); })(); }
  choose(spec) {
    assert.ok(spec.options.length > 0, `choice ${spec.id} has no options`);
    if (spec.allowFree && this.rand() < 0.25) return { free: ['I am ready', 'kill the lights', 'think about Lucia', 'tell me who pays you', 'save them', 'something odd entirely'][Math.floor(this.rand() * 6)] };
    return { id: spec.options[Math.floor(this.rand() * spec.options.length)].id };
  }
}

test('every random playthrough reaches the end', async () => {
  const outcomes = { nadia: new Set(), rook: new Set(), marrow: new Set(), approach: new Set() };
  for (let seed = 1; seed <= 1500; seed++) {
    const T = new MockTheatre(rng(seed));
    const R = new Runner(T, null, { save: false });
    await R.play();
    assert.ok(T.ended, `seed ${seed} did not reach the end`);
    assert.ok(T.lines > 40, `seed ${seed}: only ${T.lines} lines`);
    outcomes.nadia.add(R.state.nadia); outcomes.rook.add(R.state.rook); outcomes.marrow.add(R.state.marrow);
    for (const k of Object.keys(R.state.flags)) if (k.startsWith('approach_')) outcomes.approach.add(k);
  }
  // the branches are all reachable
  for (const v of ['safe', 'hurt']) assert.ok(outcomes.nadia.has(v), 'nadia ' + v);
  for (const v of ['informant', 'arrested', 'fled', 'dead']) assert.ok(outcomes.rook.has(v), 'rook ' + v);
  for (const v of ['arrested', 'dead', 'escaped']) assert.ok(outcomes.marrow.has(v), 'marrow ' + v);
  assert.ok(outcomes.approach.size === 3, 'all three approaches');
});

test('offline free text maps onto the right options', () => {
  const opts = [{ id: 'ready', label: '"I\'m ready."' }, { id: 'unsure', label: '"I don\'t know if I am."' }, { id: 'quiet', label: '"Stay off the line."' }];
  assert.equal(matchOption('yeah im ready lets go', opts), 'ready');
  assert.equal(matchOption('honestly im scared', opts), 'unsure');
  assert.equal(matchOption('Mags, shut it', opts), 'quiet');
});
