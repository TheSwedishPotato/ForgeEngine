/**
 * Your story: a chronicle of what you have done that matters, and the
 * threads of story that grow out of it.
 *
 * The chronicle is plain record: crimes, trials, service, gifts, debts,
 * promises, quarrels, kept per day. Each morning (and after something
 * grave) the storyteller looks at the town as it is (who lives where, what
 * weighs on them, who likes or hates you, what you have done) and opens a
 * thread or two: a matter between you and someone in the town, with what
 * they want of you, what is at stake, and how long it can wait. Claude
 * writes them when it is available; otherwise a few scripted matters drawn
 * from the same facts.
 *
 * Threads are lived, not ticked off: the people in them know their part
 * when you talk to them (see Dialogue), and they settle them in
 * conversation, by what you pay or bring, by your enlisting, or by your
 * letting the day pass. Their givers come looking for you. What comes of
 * each goes into the chronicle, and the chronicle feeds the next morning's
 * threads, so your choices shape what happens to you.
 */
import { fmtMoney, GOODS, dateText } from './data.js';
import { CARES } from './Dialogue.js';
import { worldText } from './history.js';
import { loreFull, PASTS } from './lore.js';
import { BUILDING } from '../world/town.js';

const MAX_OPEN = 3;

export class Story {
  constructor(sim) {
    this.sim = sim;
    this.chronicle = [];   // {t, text, weight, who: [ids]}
    this.threads = [];     // see _open
    this.nextId = 1;
    this.lastPlan = -1e9;
    this.planning = false;
    this.sample = null;    // Claude, shared with the dialogue when it is granted
    this.listeners = [];
    sim.story = this;
    sim.on((e) => this._event(e));
  }

  on(fn) { this.listeners.push(fn); }
  _emit(e) { for (const f of this.listeners) f(e); }

  // --- the chronicle --------------------------------------------------------------------------

  note(text, weight = 3, who = []) {
    const last = this.chronicle[this.chronicle.length - 1];
    if (last && last.text === text && this.sim.t - last.t < 2) return;
    this.chronicle.push({ t: this.sim.t, text: String(text).slice(0, 200), weight, who });
    if (this.chronicle.length > 160) {
      // drop the slightest of the oldest half
      const old = this.chronicle.slice(0, 80);
      const i = old.reduce((b, x, j) => (x.weight < old[b].weight ? j : b), 0);
      this.chronicle.splice(i, 1);
    }
  }

  _event(e) {
    const P = this.sim.player;
    switch (e.type) {
      case 'crime': this.note(`You broke the law: ${e.law?.name ?? 'a crime'}${e.seen ? `, seen by ${e.seen}` : ', unseen'}.`, e.seen ? 7 : 4); this._soon(); break;
      case 'trial': this.note('You were brought before the headman and the aldermen.', 8); this._soon(); break;
      case 'army': if (/take you on|enlist|sworn|promot/i.test(e.text)) { this.note(e.text, 7); } this._check('army'); break;
      case 'give': this.note(e.text, 3, e.to ? [e.to.id] : []); break;
      case 'work': this.note(e.text, 2); break;
      case 'law': this.note(e.text, 5); break;
      case 'news': if (e.text && e.text.includes(P.name)) this.note(e.text, 6); break;
      case 'death': this.note(`${P.name} died${e.cause ? ` (${e.cause})` : ''}.`, 10); break;
      case 'day': this._lapse(); this.plan(); break;
      default: break;
    }
  }

  /** Something grave happened: let the storyteller look again soon. */
  _soon() { this.lastPlan = Math.min(this.lastPlan, this.sim.t - 20); setTimeout(() => this.plan(), 1500); }

  // --- threads --------------------------------------------------------------------------------

  open() { return this.threads.filter((x) => x.status === 'open'); }
  involving(p) { return this.open().filter((x) => x.giver === p.id || x.involved.includes(p.id)); }

  _open(th) {
    const s = this.sim;
    const giver = s.byId[th.giver];
    if (!giver || !giver.alive) return null;
    if (this.open().some((x) => x.giver === th.giver)) return null;   // one matter at a time with each person
    const x = {
      id: this.nextId++, title: String(th.title ?? 'A matter').slice(0, 80), giver: th.giver,
      involved: (th.involved ?? []).filter((id) => s.byId[id] && id !== th.giver).slice(0, 3),
      summary: String(th.summary ?? '').slice(0, 400), want: String(th.want ?? '').slice(0, 240), stakes: String(th.stakes ?? '').slice(0, 240),
      kind: ['pay', 'bring', 'enlist', 'talk', 'any'].includes(th.kind) ? th.kind : 'any',
      amount: Math.max(0, Math.round(Number(th.amount) || 0)), item: GOODS[th.item] ? th.item : null,
      started: s.t, due: s.t + Math.max(6, Math.min(24 * 7, Number(th.hours) || 48)),
      status: 'open', outcome: null, raised: false, steps: [],
    };
    this.threads.push(x);
    // the giver seeks you out, by day
    giver.seek = x.id;
    this.note(`A matter began: ${x.title} (with ${giver.fullName}).`, 4, [giver.id, ...x.involved]);
    this._emit({ type: 'thread', thread: x, giver });
    return x;
  }

  /** Settle a thread: outcome 'done' | 'failed' | 'progress'. */
  resolve(id, outcome, note = '') {
    const s = this.sim, x = this.threads.find((t) => t.id === Number(id));
    if (!x || x.status !== 'open') return null;
    const giver = s.byId[x.giver];
    if (outcome === 'progress') {
      if (note) x.steps.push({ t: s.t, text: String(note).slice(0, 160) });
      x.due = Math.max(x.due, s.t + 12);
      return x;
    }
    x.status = outcome === 'done' ? 'done' : 'failed';
    x.outcome = String(note || (outcome === 'done' ? 'settled' : 'it came to nothing')).slice(0, 200);
    if (giver) {
      giver.seek = null;
      giver.attitude = Math.max(-100, Math.min(100, giver.attitude + (x.status === 'done' ? 15 : -15)));
      s.remember(giver, { kind: x.status === 'done' ? 'got' : 'done', text: `${x.title}: ${x.outcome}`, weight: x.status === 'done' ? 6 : 6, att: x.status === 'done' ? 12 : -12 });
    }
    s.player.reputation += x.status === 'done' ? 2 : -2;
    this.note(`${x.title}: ${x.outcome}.`, 6, [x.giver, ...x.involved]);
    this._emit({ type: 'resolved', thread: x, giver });
    return x;
  }

  _lapse() {
    for (const x of this.open()) if (this.sim.t > x.due) this.resolve(x.id, 'failed', 'the time ran out and nothing was done');
  }

  /** Settle threads the world settles by itself: a payment, a thing brought, enlisting. */
  _check(what, p = null, act = null) {
    for (const x of this.open()) {
      if (what === 'army' && x.kind === 'enlist' && this.sim.player.army) this.resolve(x.id, 'done', 'you took service in the garrison');
      if (what === 'act' && p && x.giver === p.id && act?.ok) {
        if (x.kind === 'pay' && act.type === 'accept' && (act.money ?? 0) >= x.amount) this.resolve(x.id, 'done', `you paid ${fmtMoney(act.money)}`);
        if (x.kind === 'bring' && act.type === 'accept' && act.item && act.item === x.item) this.resolve(x.id, 'done', `you brought ${GOODS[x.item].name.toLowerCase()}`);
      }
      if (what === 'talk' && p && x.kind === 'talk' && (x.involved[0] ?? x.giver) === p.id && x.raised) this.resolve(x.id, 'done', `you spoke with ${p.fullName}`);
    }
  }

  /** Called by the dialogue after each reply. */
  afterTalk(p, done, said) {
    const s = this.sim;
    for (const x of this.involving(p)) if (x.giver === p.id) { x.raised = true; p.seek = null; p.seekArrived = 0; }
    for (const a of done) {
      if (a.type === 'thread' && a.ok) continue;
      this._check('act', p, a);
      const big = { accept: 3, give: 3, follow: 4, teach: 3, enlist: 7, attack: 7, call_watch: 6, drop_charges: 5, hire_day: 3, stop_follow: 2 }[a.type];
      if (big && a.ok !== false) {
        const what = { accept: `You gave ${p.fullName} ${a.money ? fmtMoney(a.money) : a.item ?? 'something'}.`, give: `${p.fullName} gave you ${a.money ? fmtMoney(a.money) : a.item ?? 'something'}.`, follow: `${p.fullName} came along with you.`, teach: `${p.fullName} taught you.`, enlist: `${p.fullName} took you into the garrison.`, attack: `${p.fullName} attacked you.`, call_watch: `${p.fullName} raised the hue and cry against you.`, drop_charges: `${p.fullName} forgave you.`, hire_day: `${p.fullName} hired you for a day's work.`, stop_follow: `${p.fullName} went their own way.` }[a.type];
        this.note(what, big, [p.id]);
      }
    }
    if (said && /\b(swear|promise|vow|i will|i'll)\b/i.test(said)) this.note(`You told ${p.fullName}: "${said.slice(0, 120)}"`, 4, [p.id]);
    this._check('talk', p);
    this._check('army');
    void s;
  }

  // --- the storyteller ------------------------------------------------------------------------

  async plan() {
    const s = this.sim;
    if (this.planning || !s.player.alive) return;
    if (s.t - this.lastPlan < 20) return;              // at most about once a day, sooner after grave things
    if (this.open().length >= MAX_OPEN) return;
    this.planning = true;
    this.lastPlan = s.t;
    try {
      let list = null;
      if (this.sample) {
        try {
          const r = await this.sample.json([{ role: 'user', content: this._prompt() }], { modelTier: 'default', cache: false });
          list = Array.isArray(r?.threads) ? r.threads : null;
        } catch (e) { if (e?.code === 'cancelled') return; list = null; }
      }
      if (!list) list = this._scripted();
      for (const th of list.slice(0, MAX_OPEN - this.open().length)) this._open(th);
    } finally { this.planning = false; }
  }

  _prompt() {
    const s = this.sim, P = s.player;
    const fam = s.people.filter((p) => p.kin).map((p) => `${p.id} ${p.fullName}: ${p.kin}`).join('; ');
    const people = s.people.filter((p) => p.alive).map((p) => `${p.id} | ${p.fullName} | ${p.title}, ${p.age} | home ${BUILDING[p.home]?.name ?? p.home} | attitude to the player ${p.attitude}${p.kin ? ` | KIN: ${p.kin}` : ''}${CARES[p.role] ? ` | cares: ${CARES[p.role]}` : ''}`).join('\n');
    const chron = this.chronicle.slice(-30).map((c) => `[${dateText(c.t).text}, ${dateText(c.t).clock}] ${c.text}`).join('\n') || '(nothing yet: the story is just beginning)';
    const open = this.threads.slice(-12).map((x) => `#${x.id} ${x.status}: ${x.title} (giver ${x.giver})${x.outcome ? ` -> ${x.outcome}` : ''}`).join('\n') || '(none)';
    return `You are the storyteller of an open-world role play set in Skalice, a small subject town in the Kingdom of Bohemia, autumn 1403. What is known in the town: ${worldText(s.t)} Everything must be true to the place, the year and the social order: no magic, no anachronism, no grand destinies. Stories are personal and local: family, debt, rent and tithe, work, love and marriage, feuds and honour, the law and its punishments, faith, the war on the roads.

Today: ${s.situation()}.

THE PLAYER (everything, secrets included: the townsfolk know only what they would)
${loreFull(P)}
${P.name}, ${P.sex === 'f' ? 'a woman' : 'a man'} of about twenty, ${P.startName}. ${P.native ? 'Born and raised in the town.' : 'A newcomer, a stranger to everyone.'} Home: ${BUILDING[P.home]?.name ?? P.home}. Purse: ${P.money} parvi (12 parvi = 1 groschen). Reputation ${P.reputation}.${P.army ? ' Serves in the castle garrison.' : ''}${P.crimes.length ? ` Crimes: ${P.crimes.map((c) => c.law + (c.settled ? ' (settled)' : '')).join(', ')}.` : ''}
Family and household: ${fam || 'none here'}.

WHAT HAS HAPPENED (the player's chronicle, oldest first)
${chron}

THREADS SO FAR
${open}

THE PEOPLE OF THE TOWN (id | name | station | home | attitude -100..100 | kin | cares)
${people}

YOUR TASK
Open 1 or 2 new threads of story for the player, starting today. Each is a matter between the player and one person (the giver) who comes to the player about it. Grow them out of what has happened (the chronicle and earlier threads: consequences of the player's choices come first), out of the givers' cares and relations to the player, and out of the season. Vary them. Prefer people with something at stake with the player. Give the player a real choice: helping one person may cost them with another. Never repeat a thread that is open or recently settled.
A thread must be possible to settle in this game: by talking to people, paying or giving money or goods (${Object.keys(GOODS).join(', ')}), coming along with someone, working, enlisting with the captain, or standing up for or against someone.

Reply with ONLY JSON:
{"threads":[{"title":"<short, plain>","giver":"<person id>","involved":["<other person ids, 0-2>"],"summary":"<2-3 sentences: the situation, in plain words, as the giver sees it>","want":"<what the giver asks of the player>","stakes":"<what happens if it goes well, and if not>","kind":"pay|bring|enlist|talk|any","amount":<parvi, for pay>,"item":"<goods id, for bring>","hours":<game hours before it lapses, 12-120>}]}`;
  }

  /** Without Claude: a few matters from the same facts. */
  _scripted() {
    const s = this.sim, P = s.player, out = [];
    const by = (f) => s.people.find((p) => p.alive && f(p) && !this.threads.some((x) => x.giver === p.id));
    const parent = by((p) => /father|householder|master|lord/.test(p.kin ?? ''));
    if (parent && P.native) out.push({ title: 'The rent at St Gall', giver: parent.id, summary: `The half-year rent is due to the lord on St Gall's day, and ${parent.name} is short after the bad spring. The headman will not wait.`, want: 'Help with 3 groschen toward the rent.', stakes: 'Paid, the household keeps its good name; unpaid, the headman will distrain a beast or the plough.', kind: 'pay', amount: 36, hours: 72 });
    // what marks you comes back to you
    const L = P.lore, seed = L && PASTS[L.past]?.seed;
    if (seed) {
      const who = L.past === 'sweetheart' ? s.byId[L.sweetheart] : s.people.find((p) => p.role === PASTS[L.past].who);
      if (who && !this.threads.some((x) => x.title === seed.title)) out.unshift({ ...seed, giver: who.id, summary: `${seed.title}. ${PASTS[L.past].text.replace(/\byou\b/gi, P.name).replace(/\byour\b/gi, P.sex === 'f' ? 'her' : 'his')}` });
    }
    const priest = by((p) => p.role === 'priest');
    if (priest && out.length < 2) out.push({ title: 'Confession before the feast', giver: priest.id, summary: 'The feast of St Wenceslas is at hand and the priest expects every soul of the parish at confession first.', want: 'Come to the church and speak with him.', stakes: 'A good name with the church, or the priest\'s displeasure from the pulpit.', kind: 'talk', hours: 48 });
    const captain = by((p) => p.role === 'captain');
    if (captain && !P.army && !P.noble && out.length < 2) out.push({ title: 'Men for the garrison', giver: captain.id, summary: 'With masterless soldiers on the roads and fear the Hungarians will return, the captain needs more foot servants and has heard you are able-bodied.', want: 'Take service in the castle garrison.', stakes: 'Pay, bread and a coat, and the captain\'s favour; refused, he will not ask twice.', kind: 'enlist', hours: 96 });
    const smith = by((p) => p.role === 'smith');
    if (smith && out.length < 2) out.push({ title: 'Bread for the forge', giver: smith.id, summary: 'The smith cannot leave the forge with the garrison\'s order on the anvil, and his apprentice is useless.', want: 'Bring him a loaf of bread from the bakery.', stakes: 'A friend at the forge, or a grumble.', kind: 'bring', item: 'bread', hours: 10 });
    return out;
  }

  /** Lines for a person's prompt: the matters they share with the player. */
  personaLines(p) {
    const s = this.sim;
    return this.involving(p).map((x) => {
      const giver = s.byId[x.giver];
      const role = x.giver === p.id ? 'This is YOUR matter: you came to the stranger about it.' : `${giver?.fullName ?? 'Someone'} has brought this matter to the stranger; you are part of it.`;
      return `A MATTER BETWEEN YOU AND THE STRANGER (thread ${x.id}): "${x.title}". ${x.summary} ${role} ${x.giver === p.id ? `What you want of them: ${x.want}` : ''} Stakes: ${x.stakes} Time left: about ${Math.max(1, Math.round(x.due - s.t))} hours.${x.steps.length ? ` So far: ${x.steps.map((st) => st.text).join('; ')}.` : ''} Raise it yourself if they do not. When, in this talk, the matter is settled for good or ill, or moves on, add {"type":"thread","id":${x.id},"outcome":"done|failed|progress","note":"<what happened, in a few words>"} to your actions.`;
    });
  }

  serialize() { return { chronicle: this.chronicle, threads: this.threads, nextId: this.nextId, lastPlan: this.lastPlan }; }
  restore(o) {
    if (!o) return;
    this.chronicle = o.chronicle ?? []; this.threads = o.threads ?? []; this.nextId = o.nextId ?? this.threads.length + 1; this.lastPlan = o.lastPlan ?? -1e9;
    for (const x of this.open()) { const g = this.sim.byId[x.giver]; if (g && !x.raised) g.seek = x.id; }
  }
}

