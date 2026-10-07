// The director's replies are checked before the film plays them; the story folds them in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanReply, placeOf, directorPrompt } from '../src/director.js';
import { newStory, applyReply, OPENINGS } from '../src/story.js';

const story = () => newStory({ premise: OPENINGS[0].premise, player: { name: 'Anna', sex: 'f', who: 'a miner\'s child' } });

test('places Claude names map onto sets we can paint', () => {
  assert.equal(placeOf('The Black Ox inn'), 'tavern');
  assert.equal(placeOf('St Barbara\'s church'), 'church');
  assert.equal(placeOf('a narrow alley'), 'street');
  assert.equal(placeOf('xyzzy'), 'street');
});

test('a wild reply is made safe', () => {
  const s = story();
  const r = cleanReply({
    scene: { place: 'Old inn', time: 'midnight', weather: 'acid', light: 'neon', present: ['marta', 'ghost'] },
    cast: [{ id: 'Marta!', name: 'Marta', sex: 'f', age: 300, look: { skin: 'red', hairStyle: 'mohawk' }, feeling: 999 }, { id: 'you', name: 'Me' }],
    beats: [{ shot: 'drone', who: 'marta', line: 'Hello.', emotion: 'giddy' }, { who: 'nobody', line: 'x' }, { narration: '' }],
    suggestions: [{ kind: 'fly', text: 'Leave' }, 'bad', { text: '' }],
  }, s);
  assert.equal(r.scene.place, 'tavern');
  assert.equal(r.scene.time, 'day');
  assert.deepEqual(r.scene.present, ['marta']);
  const m = r.cast.marta;
  assert.ok(m && m.age === 95 && m.feeling === 100 && m.look.skin === '#d2a07c' && m.look.hairStyle === 'short');
  assert.ok(!r.cast.you, 'the player is not cast by Claude');
  assert.equal(r.beats.length, 1, 'beats with nobody known speaking and nothing to show are dropped');
  assert.equal(r.beats[0].shot, 'medium'); assert.equal(r.beats[0].emotion, 'neutral');
  assert.deepEqual(r.suggestions, [{ kind: 'say', text: 'Leave' }]);
  assert.ok(r.scene.cut);
});

test('the story keeps what was said and what matters', () => {
  const s = story();
  const r = cleanReply({ scene: { place: 'street', present: ['jitka'] }, cast: [{ id: 'jitka', name: 'Jitka', sex: 'f', age: 50, feeling: 20 }], beats: [{ narration: 'Snow.' }, { who: 'jitka', line: 'Child!' }], summary: 'It began.', memory: 'You met Jitka.' }, s);
  applyReply(s, { kind: 'say', text: 'Good morning.' }, r);
  assert.equal(s.turns, 1);
  assert.deepEqual(s.log.map((l) => l.who), ['you', null, 'jitka']);
  assert.equal(s.summary, 'It began.');
  assert.deepEqual(s.chronicle, ['You met Jitka.']);
  const p = directorPrompt(s, { kind: 'do', text: 'I hug her' });
  assert.ok(p.includes('THE PLAYER NOW DOES: I hug her') && p.includes('Jitka') && p.includes('Never write the player'));
});
