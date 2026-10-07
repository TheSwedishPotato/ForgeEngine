// Life in Skalice: words become deeds, memory and gossip, crime and the court, saves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LifeSim } from '../src/life/LifeSim.js';
import { Dialogue, scripted, parseMoney } from '../src/life/Dialogue.js';
import { STARTS } from '../src/life/data.js';
import { BUILDING, PLACES } from '../src/world/town.js';
import { about } from '../src/life/Memory.js';

const fresh = () => new LifeSim({ start: STARTS[3], name: 'Jan' });   // a burgher's son: money to spend
const role = (s, r) => s.people.find((p) => p.role === r);

test('handing someone money moves it from your purse to theirs', () => {
  const s = fresh(), d = new Dialogue(s), p = role(s, 'beggar');
  const before = s.player.money, theirs = p.money;
  const r = d.apply(p, scripted(s, p, 'Here, take two groschen for bread.'), 'Here, take two groschen for bread.');
  assert.equal(r.actions[0].type, 'accept');
  assert.equal(s.player.money, before - 24);
  assert.equal(p.money, theirs + 24);
  assert.ok(about(p).some((m) => /gave me/.test(m.text)));
  assert.ok(p.attitude > -100);
});

test('nobody can give what they have not got, and you cannot hand over more than you have', () => {
  const s = fresh(), d = new Dialogue(s), p = role(s, 'beggar');
  p.money = 3;
  const r = d.apply(p, { say: 'Here.', actions: [{ type: 'give', money: 500 }] });
  assert.equal(r.actions[0].ok, true);
  assert.equal(p.money, 0);           // gave all three, not 500
  const r2 = d.apply(p, { say: 'Thanks.', actions: [{ type: 'accept', money: 999999 }] });
  assert.equal(r2.actions[0].ok, false);
});

test('a hired man follows you, into buildings too, and is paid each morning', () => {
  const s = fresh(), d = new Dialogue(s), p = role(s, 'cottager');
  const r = d.apply(p, { say: 'Done.', actions: [{ type: 'follow', wage: 12 }] });
  assert.ok(r.actions[0].ok);
  assert.ok(p.follow);
  s.player.x = 0; s.player.z = 100;
  for (let i = 0; i < 120; i++) s.update(0.1);
  assert.ok(Math.hypot(p.agent.x - s.player.x, p.agent.z - s.player.z) < 3, 'keeps close');
  s.enter(BUILDING.tavern);
  for (let i = 0; i < 400; i++) s.update(0.1);
  assert.equal(p.agent.inside, 'tavern');
  const m = s.player.money;
  s.advance(24);
  assert.ok(s.player.money <= m - 12 || !p.follow);
});

test('gossip carries what someone saw to people who did not see it', () => {
  const s = fresh();
  const a = role(s, 'innkeeper'), b = role(s, 'innwife');
  for (const p of [a, b]) { p.agent.inside = 'tavern'; p.agent.route = []; p.agent.act = 'serving'; }
  a.traits.extraversion = 1;
  s.remember(a, { kind: 'saw', text: 'the stranger kicked a dog', weight: 6, att: -10 });
  for (let i = 0; i < 20 && !about(b).length; i++) { s.lastGossip = -99; s.update(0.01); }
  assert.ok(about(b).some((m) => /kicked a dog/.test(m.text) && m.kind === 'heard'));
});

test('a theft seen raises the hue and cry; caught with the goods there is no oath; the court sentences', () => {
  const s = fresh();
  s.t = 5.5 + 3;                       // mid-morning
  s.player.inside = 'bakery';
  const baker = role(s, 'baker');
  baker.agent.inside = 'bakery'; baker.agent.route = []; baker.agent.act = 'selling bread';
  let r;
  for (let i = 0; i < 30; i++) { r = s.justice.steal(); if (r.seen) break; }
  assert.ok(r.seen > 0, 'seen in the end');
  assert.ok(s.justice.hue, 'hue and cry');
  assert.ok(s.player.wanted >= 2);
  // the pursuers come in and seize you
  for (let i = 0; i < 600 && !s.pendingStop; i++) s.update(0.05);
  assert.ok(s.pendingStop, 'seized');
  s.resolveStop('submit');
  const T = s.justice.trial;
  assert.ok(T, 'trial opens');
  assert.equal(T.counts[0].proof, 'handhafte');
  const v = s.justice.plead('deny');
  assert.equal(v.verdict, 'guilty');
  assert.match(v.sentence.text, /restoration twofold|pillory|whip/);
  const money = s.player.money;
  s.justice.execute(v.sentence);
  assert.ok(s.player.money < money);
  s.justice.endTrial();
  assert.equal(s.player.wanted, 0);
});

test('with no witnesses and friends to swear, the oath clears you', () => {
  const s = fresh();
  const victim = role(s, 'weaver');
  const c = s.crime('brawl', { victim, seen: [victim], cry: false });
  victim.memories = victim.memories.filter((m) => m.crime !== c.id);    // he is the only one who knows, and says he did not see
  s.people.filter((p) => p.role === 'farmer').slice(0, 3).forEach((p) => { p.attitude = 60; });
  s.justice.openTrial();
  const k = s.justice.trial.counts[0];
  assert.ok(k.proof === 'none' || k.proof === 'one');
  const v = s.justice.plead('deny');
  assert.equal(v.verdict, 'cleared');
});

test('a killing can be settled with the kin by reconciliation', () => {
  const s = fresh();
  const v = role(s, 'farmer');
  v.alive = false;
  const wife = s.byId[v.spouse];
  s.player.money = 6000;
  s.crime('killing', { victim: v, seen: [wife] });
  s.justice.openTrial();
  const k = s.justice.trial.counts[0];
  const price = s.justice.smirPrice(k);
  assert.ok(price && price.price >= 1440);
  const r = s.justice.plead('smir');
  assert.equal(r.verdict, 'settled');
  assert.equal(s.player.alive, true);
});

test('money words parse', () => {
  assert.equal(parseMoney('here, take two groschen'), 24);
  assert.equal(parseMoney('half a kopa'), 360);
  assert.equal(parseMoney('6 parvi'), 6);
});

test('the town saves and comes back the same', () => {
  const s = fresh();
  const p = role(s, 'smith');
  s.remember(p, { kind: 'met', text: 'asked about swords', weight: 4 });
  s.player.money = 777;
  s.advance(3);
  const o = JSON.parse(JSON.stringify(s.serialize()));
  const r = LifeSim.restore(o);
  assert.equal(r.player.money, 777);
  assert.ok(Math.abs(r.t - s.t) < 1e-9);
  assert.ok(about(r.byId[p.id]).some((m) => m.text === 'asked about swords'));
  for (let i = 0; i < 60; i++) r.update(1);
  assert.ok(r.people.every((q) => Number.isFinite(q.agent.x)));
});

test('a person you talk to stays and faces you; afterwards goes on', () => {
  const s = fresh();
  s.t = 10.2;
  s.update(0.1);
  const p = s.people.find((q) => q.agent.route.length > 2 && !q.agent.inside);
  assert.ok(p, 'someone walking');
  s.talkingWith = p;
  const x = p.agent.x, z = p.agent.z;
  for (let i = 0; i < 30; i++) s.update(0.1);
  assert.equal(p.agent.x, x); assert.equal(p.agent.z, z);
  assert.equal(p.agent.speed, 0);
  s.talkingWith = null;
  for (let i = 0; i < 30; i++) s.update(0.1);
  assert.ok(Math.hypot(p.agent.x - x, p.agent.z - z) > 0.3, 'walks on after the talk');
});

test('forms of address follow rank: no "pane" for a farmer, "pane" for a squire', async () => {
  const { addressOf, playerWho, personWho } = await import('../src/life/address.js');
  const s = fresh();
  for (const p of s.people) {
    const toFarmer = addressOf(personWho(p), playerWho({ rank: 'sedlak', sex: 'm' }));
    assert.ok(!/^pane$|^paní$/.test(toFarmer.cz), `${p.role} would call a farmer ${toFarmer.cz}`);
  }
  const smith = s.people.find((p) => p.role === 'smith'), priest = s.people.find((p) => p.role === 'priest');
  assert.equal(addressOf(personWho(smith), playerWho({ rank: 'squire', noble: true, sex: 'm' })).cz, 'pane');
  assert.equal(addressOf(playerWho({ rank: 'sedlak', sex: 'm' }), personWho(smith)).cz, 'mistře');
  assert.equal(addressOf(personWho(priest), playerWho({ rank: 'sedlak', sex: 'm' })).cz, 'synu');
});

test('born here: known by all, family at home; a newcomer is a stranger at the inn', () => {
  const nat = new LifeSim({ start: STARTS[1], name: 'Jan', origin: 'native' });
  const father = nat.people.find((p) => p.home === nat.player.home && p.role === 'farmer');
  assert.ok(father && /father/.test(father.kin));
  assert.equal(nat.player.knownNames.size, nat.people.length);
  assert.ok(father.attitude > 40);
  const neu = new LifeSim({ start: STARTS[1], name: 'Jan', origin: 'newcomer' });
  assert.equal(neu.player.home, 'tavern');
  assert.equal(neu.player.knownNames.size, 0);
  assert.ok(!neu.people.some((p) => p.kin));
});

test('memories fade: trifles go in a day, grave things last', async () => {
  const { remember, fade } = await import('../src/life/Memory.js');
  const p = { memories: [] };
  remember(p, { text: 'nodded at me', weight: 1 }, 0);
  remember(p, { text: 'stole my purse', weight: 8 }, 0);
  fade(p, 30);
  assert.deepEqual(p.memories.map((m) => m.text), ['stole my purse']);
  fade(p, 24 * 30);
  assert.equal(p.memories.length, 0);
});

test('story: matters open from the facts, the giver comes to you, paying settles, time lapses', async () => {
  const { Story } = await import('../src/life/Story.js');
  const s = new LifeSim({ start: STARTS[1], name: 'Jan', origin: 'native' });
  const story = new Story(s);
  s.t = 9;
  await story.plan();
  const open = story.open();
  assert.ok(open.length >= 1 && open.length <= 3, `opened ${open.length}`);
  const rent = open.find((x) => x.kind === 'pay');
  assert.ok(rent, 'the rent matter');
  const father = s.byId[rent.giver];
  assert.equal(father.seek, rent.id);
  // the father walks up to the player out of doors
  s.player.inside = null;
  father.agent.inside = null; father.agent.x = s.player.x + 20; father.agent.z = s.player.z;
  let came = false;
  s.on((e) => { if (e.type === 'approach' && e.by === father) came = true; });
  for (let i = 0; i < 200 && !came; i++) s.update(0.1);
  assert.ok(came, 'he came to find you');
  // he is in the prompt, and paying him settles it
  const d = new Dialogue(s);
  assert.ok(story.personaLines(father).some((l) => l.includes(rent.title)));
  const r = d.apply(father, { say: 'God bless you.', actions: [{ type: 'accept', money: 36 }] });
  story.afterTalk(father, r.actions, 'Here, take three groschen for the rent.');
  assert.equal(rent.status, 'done');
  assert.ok(story.chronicle.some((c) => c.text.includes(rent.title)));
  // an unattended matter lapses
  const other = story.open()[0];
  if (other) { s.t = other.due + 1; story._lapse(); assert.equal(other.status, 'failed'); }
  // and the story survives a save
  const again = new Story(new LifeSim({ start: STARTS[1], name: 'Jan' }));
  again.restore(JSON.parse(JSON.stringify(story.serialize())));
  assert.equal(again.threads.length, story.threads.length);
});

test('your past: siblings live in the house, kin labels follow the parents, secrets stay secret', async () => {
  const { loreKnownBy } = await import('../src/life/lore.js');
  const s = new LifeSim({ start: STARTS[1], name: 'Jan', origin: 'native', lore: { parents: 'widowed', siblings: 'both', past: 'smir', faith: 'devout', own: 'I keep bees.' } });
  const sibs = s.people.filter((p) => p.rel);
  assert.equal(sibs.length, 2);
  assert.ok(sibs.every((p) => p.home === s.player.home && p.agent));
  assert.ok(s.people.some((p) => /stepfather/.test(p.kin ?? '')));
  assert.ok(s.player.skills.sword >= 18, 'the killing left its mark on the sword skill');
  const stranger = s.people.find((p) => p.role === 'smith');
  assert.ok(!loreKnownBy(s, stranger).includes('dead by your knife') && !/knife/.test(loreKnownBy(s, stranger)), 'a secret is not known to the smith');
  const bro = sibs.find((p) => p.sex === 'm');
  assert.ok(loreKnownBy(s, bro).includes('bees'), 'kin know your own story');
  // siblings survive a save
  const r = LifeSim.restore(JSON.parse(JSON.stringify(s.serialize())));
  assert.equal(r.people.filter((p) => p.rel).length, 2);
});

test('deeds: effects are checked against the world', async () => {
  const { Deeds } = await import('../src/life/Deeds.js');
  const s = fresh(); s.t = 10;
  const d = new Deeds(s);
  const money = s.player.money, t0 = s.t;
  const near = s.people.slice(0, 2);
  const r = d.apply({ narration: 'You do it.', hours: 9, money: 5000, needs: { hunger: -500 }, skill: { name: 'letters', gain: 50 }, witnesses: [{ id: near[0].id, remember: 'x', attitude: 99 }, { id: 'p999', remember: 'y' }] }, near);
  assert.ok(s.t - t0 <= 4.01, 'at most four hours');
  assert.equal(s.player.money, money + 12, 'found money is capped');
  assert.ok(r.narration === 'You do it.');
  const lose = d.apply({ narration: 'x', money: -1e6 }, []);
  assert.equal(s.player.money, 0, 'cannot spend more than you have'); void lose;
});

test('history: rent at St Gall, news arrives on its day', async () => {
  const { tOf, newsKnown, calendarAhead, HOLY } = await import('../src/life/history.js');
  assert.ok(HOLY.has('9-28') && HOLY.has('11-1'));
  assert.equal(newsKnown(10).length, 0);
  assert.ok(newsKnown(tOf(10, 8, 12)).some((n) => /Pope/.test(n.text)));
  assert.ok(newsKnown(tOf(11, 16, 12)).some((n) => /free/.test(n.text)));
  assert.ok(calendarAhead(tOf(10, 10, 8)).some((c) => /St Gall/.test(c.name)));
});
