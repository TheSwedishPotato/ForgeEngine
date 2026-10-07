// ORRERY in the film: replies are checked before they play, read while they stream, and folded into the story.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanReply, typeOf, directorPrompt, reportPrompt, sheetPrompt, Director } from '../src/orrery/director.js';
import { newStory, applyReply, reportDue, continuityLedger, recap } from '../src/orrery/state.js';
import { StreamReader } from '../src/orrery/stream.js';
import { OPENINGS } from '../src/orrery/openings.js';
import { PACKS } from '../src/orrery/research.js';

const story = () => newStory({ premise: OPENINGS[0].premise, opening: 'kutna', player: { name: 'Anna', sex: 'f', who: 'a miner\'s child' } });

test('places Claude names map onto places the stage can build', () => {
  assert.equal(typeOf('The Black Ox inn'), 'tavern');
  assert.equal(typeOf('St Barbara\'s church'), 'church');
  assert.equal(typeOf('a glass furnace'), 'workshop');
  assert.equal(typeOf('the apothecary'), 'shop');
  assert.equal(typeOf('xyzzy'), 'street');
});

test('a wild reply is made safe', () => {
  const s = story();
  const r = cleanReply({
    scene: { id: 'Black Ox!', name: 'The Black Ox', type: 'old inn', style: 'baroque', walls: 'glass', time: 'midnight', weather: 'acid', present: ['marta', 'ghost'] },
    cast: [{ id: 'Marta!', name: 'Marta', sex: 'f', age: 300, tier: 'god', axes: { trust: 99, fear: -4 }, look: { skin: 'red', hairStyle: 'mohawk' } }, { id: 'you', name: 'Me' }],
    beats: [{ shot: 'drone', who: 'marta', line: 'Hello.', emotion: 'giddy', gesture: 'dab', moves: [{ who: 'marta', to: 'hearth' }, { who: 'ghost', to: 'door' }] }, { who: 'nobody', line: 'x' }, { narration: '' }],
    choices: [{ kind: 'fly', text: 'Leave', risk: 'none' }, 'bad', { text: '' }],
    turn: { resolution: { action: 'lift the beam', band: 'Lucky', why: 'strong' } },
  }, s);
  assert.equal(r.scene.place, 'tavern'); assert.equal(r.scene.spec.id, 'blackox'); assert.equal(r.scene.spec.style, 'generic'); assert.equal(r.scene.spec.walls, undefined);
  assert.equal(r.scene.time, 'day');
  assert.deepEqual(r.scene.present, ['marta']);
  const m = r.cast.marta;
  assert.ok(m && m.age === 95 && m.axes.trust === 10 && m.axes.fear === 0 && m.tier === 'standing' && m.look.skin === '#d2a07c' && m.look.hairStyle === 'short');
  assert.ok(!r.cast.you, 'the player is not cast by Claude');
  assert.equal(r.beats.length, 1, 'beats with nobody known speaking and nothing to show are dropped');
  assert.equal(r.beats[0].shot, 'medium'); assert.equal(r.beats[0].emotion, 'neutral'); assert.equal(r.beats[0].gesture, 'none');
  assert.deepEqual(r.beats[0].moves, [{ who: 'marta', to: 'hearth' }]);
  assert.deepEqual(r.choices, [{ kind: 'say', text: 'Leave', risk: 'none' }]);
  assert.equal(r.turn.resolution.band, 'Partial');
  assert.ok(r.scene.cut);
});

test('the story keeps everything ORRERY tracks', () => {
  const s = story();
  const r = cleanReply({
    scene: { id: 'lane', name: 'The lane below the mint', type: 'street', present: ['jitka'], new: true },
    cast: [{ id: 'jitka', name: 'Jitka', sex: 'f', age: 50, tier: 'core', axes: { trust: 6, affection: 5 }, model: { want: 'to keep the oven', fear: 'the soldiers' } }],
    extras: [{ id: 'x1', label: 'a carter', sex: 'm', task: 'sweep' }],
    remarks: [{ who: 'x1', text: 'Mind the ice, girl.' }, { who: 'nobody', text: 'x' }],
    beats: [{ narration: 'Snow.' }, { who: 'jitka', line: 'Child!', action: 'drops her broom' }, { who: 'x1', line: 'Hah.' }],
    choices: [1, 2, 3, 4, 5, 6].map((i) => ({ kind: 'do', text: `option ${i}` })),
    turn: { line: 'Anna met Jitka in the snow.' },
    clock: { date: '3 February 1403', time: 'dawn' },
    sheet: { body: { fatigue: 12, hunger: 9 }, skills: { Mining: { v: 4, why: 'her father' } }, means: { money: '3 groschen' }, knowledge: { knows: ['Jitka feeds children'] } },
    ledger: [{ action: 'defied a soldier', pending: [{ horizon: 'ripple', what: 'he asks about her' }] }],
    promises: [{ id: 'oven', planted: 'something under the oven', payoff: 'silver', status: 'OPEN' }],
    threads: { A: { name: 'The mint', status: 'quiet' } },
    silent: { wrongAbout: ['that Jitka is poor'] },
    places: [{ id: 'ox', name: 'The Black Ox', type: 'tavern' }],
    chapter: { title: 'Snow' },
    summary: 'It began.', memory: 'You met Jitka.',
  }, s);
  assert.equal(r.choices.length, 5, 'five choices; the sixth is always your own words');
  assert.equal(r.remarks.length, 1);
  assert.ok(r.extras.x1 && r.extras.x1.task === 'sweep');
  assert.equal(r.beats[2].who, 'x1', 'bystanders may speak');
  applyReply(s, { kind: 'say', text: 'Good morning.' }, r);
  assert.equal(s.counters.turns, 1); assert.equal(s.counters.scenes, 1); assert.equal(s.counters.sinceReport, 1);
  assert.deepEqual(s.log.map((l) => l.who), ['you', null, 'jitka', 'x1']);
  assert.equal(s.player.body.fatigue, 10); assert.equal(s.player.body.hunger, 9);
  assert.equal(s.player.skills.Mining.v, 4); assert.equal(s.player.means.money, '3 groschen');
  assert.equal(s.cast.jitka.axes.trust, 6); assert.equal(s.cast.jitka.model.want, 'to keep the oven');
  assert.equal(s.ledger[0].status, 'armed'); assert.equal(s.promises[0].scene, 1);
  assert.equal(s.threads.A.name, 'The mint'); assert.deepEqual(s.silent.wrongAbout, ['that Jitka is poor']);
  assert.ok(s.places.lane && s.places.ox, 'places seen and places ahead are kept, to build once');
  assert.equal(s.chapters[0].title, 'Snow'); assert.equal(s.chapters[0].scenes[0].beats.length, 3); assert.deepEqual(s.chapters[0].scenes[0].lines, ['Anna met Jitka in the snow.']);
  assert.equal(s.clock.date, '3 February 1403');
  assert.deepEqual(s.chronicle, ['You met Jitka.']);
  const p = directorPrompt(s, { kind: 'do', text: 'I hug her' }, { codexText: PACKS.kutna.facts.join('\n') });
  for (const want of ['THE PLAYER NOW DOES: I hug her', 'Jitka', 'HIDDEN MODEL', 'trust 6', 'ORRERY GOVERNS', 'THE AGENCY LINE', 'Ius Regale Montanorum', 'defied a soldier', 'that Jitka is poor', 'Places already built']) assert.ok(p.includes(want), want);
  assert.ok(!p.includes('"report"'), 'no report asked for before it is due');
  const say = directorPrompt(s, { kind: 'say', text: 'Where is my mother?' });
  assert.ok(say.includes('verbatim'));
  assert.ok(continuityLedger(s).includes('CONTINUITY LEDGER') && continuityLedger(s).includes('Jitka'));
  assert.equal(recap(s).who, 'Jitka');
});

test('the full status update comes every three to five scenes, and on [[stats]]', () => {
  const s = story();
  assert.ok(!reportDue(s));
  s.counters.sinceReport = 3;
  assert.ok(reportDue(s));
  assert.ok(directorPrompt(s, null).includes('THE FULL STATUS UPDATE IS DUE') && directorPrompt(s, null).includes('"report"'));
  s.counters.sinceReport = 0;
  assert.ok(reportPrompt(s, '').includes('"report"'));
  const r = cleanReply({ report: { profile: 'Anna, 17', npcs: [{ name: 'Jitka', trust: 7, suspicion: 22 }], inMotion: ['a knock'] } }, s);
  applyReply(s, null, r);
  assert.equal(s.reports.length, 1); assert.equal(s.reports[0].report.npcs[0].suspicion, 10); assert.equal(s.counters.sinceReport, 0);
  assert.ok(sheetPrompt(s, '').includes('coreWound'));
});

test('the reply is read while it is written: each beat as soon as it closes', () => {
  const got = [];
  const R = new StreamReader({ onValue: (k, v) => got.push(['v', k, v]), onElement: (k, v) => got.push(['e', k, v]) });
  const full = '```json\n{"scene": {"id": "a", "name": "A \\"quoted\\" {place}"}, "cast": [{"id": "j"}], "beats": [{"narration": "One ]"}, {"who": "j", "line": "Two", "on": ["j"]}], "summary": "x"}\n```';
  for (let i = 1; i <= full.length; i += 7) R.feed(full.slice(0, i));
  R.feed(full);
  const kinds = got.map(([t, k]) => `${t}:${k}`);
  assert.deepEqual(kinds, ['v:scene', 'e:cast', 'v:cast', 'e:beats', 'e:beats', 'v:beats']);
  assert.equal(got[0][2].name, 'A "quoted" {place}');
  assert.equal(got[3][2].narration, 'One ]');
});

test('the director plays beats as they stream, then hands over the whole reply', async () => {
  const s = story();
  const reply = { scene: { id: 'lane', name: 'Lane', type: 'street', present: [], new: true }, cast: [{ id: 'j', name: 'J', sex: 'f' }], beats: [{ narration: 'Snow falls.' }, { who: 'j', line: 'Hello.' }], choices: [{ kind: 'say', text: 'Hi' }] };
  const text = JSON.stringify(reply);
  const sample = { json: async (_p, { onText }) => { for (let i = 10; i < text.length; i += 9) onText({ text: text.slice(0, i) }); onText({ text }); return reply; } };
  const seen = [];
  const r = await new Director(sample).turn(s, null, { hooks: { onScene: (sc) => seen.push('scene:' + sc.spec.id), onCast: (c) => seen.push('cast:' + Object.keys(c)), onBeat: (b) => seen.push('beat:' + (b.line || b.narration)) } });
  assert.deepEqual(seen, ['scene:lane', 'cast:j', 'beat:Snow falls.', 'beat:Hello.']);
  assert.equal(r.streamed, 2);
});
