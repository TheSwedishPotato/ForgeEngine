/**
 * A customer and their car, from the moment they walk in to the moment they drive off.
 *
 * profile: who they are (from Claude or ai/offline.js); records: the faults and jobs actually
 * written into the car; history: the conversation (the mechanic's lines, theirs, and [events]);
 * estimate / approved: what was agreed (konsumenttjänstlagen: no more than about 15 % over the
 * estimate without asking); invoice and verdict at the end.
 */
import { Assembly } from '../car/assembly.js';
import { CarSim } from '../sim/vehicle.js';
import { CARS, plate } from '../data/cars.js';
import { applyFault, stillPresent, byId } from '../data/faults.js';
import { offlineReply, offlineDecide, offlineVerdict } from './offline.js';

let NEXT = 1;

export class Customer {
  constructor(profile, { rand = Math.random } = {}) {
    this.id = NEXT++;
    this.profile = profile;
    const spec = CARS[profile.car] ?? CARS.volvo240;
    this.spec = spec;
    const paint = /^#[0-9a-f]{6}$/i.test(profile.paint) ? profile.paint : spec.paint[0];
    this.A = new Assembly(spec, { paint, mileage: profile.mileage_km ?? 150000, rand });
    this.records = [];
    for (const f of profile.faults ?? []) {
      const where = parseWhere(f.where, byId(f.id)?.where);
      const rec = applyFault(this.A, f.id, where, rand);
      if (rec) this.records.push(rec);
    }
    // a fuse that blew because of something in its socket
    const fuse = this.records.find((r) => r.id === 'fuse_blown');
    if (fuse && /socket|Lighter/i.test(this.A.part(fuse.extra)?.cond.circuit ?? '') && rand() < 0.6) {
      this.A.part(fuse.extra).cond.short = true;
      this.A.items.push({ id: 'item' + this.A.items.length, label: 'a two-krona coin wedged in the 12 V socket', location: 'socket', found: false, rattles: false, whereText: 'in the 12 V socket', shorts: fuse.extra });
    }
    if (profile.item?.location && profile.item.location !== 'none') this.A.items.push({ id: 'item' + this.A.items.length, label: profile.item.label, location: profile.item.location, found: false, rattles: !!profile.item.rattles, whereText: WHERE_TEXT[profile.item.location] ?? 'somewhere' });
    if (this.records.some((r) => r.id === 'winter_tyres')) this.winterSet = true;
    this.S = new CarSim(this.A);
    this.plate = plate(rand);
    this.history = [];
    this.state = 'arriving';
    this.estimate = null; this.approved = 0;
    this.arrivedAt = null; this.startedWork = null;
    this.before = this.S.roadTest();
    this.labourMin = 0;
  }

  get name() { return this.profile.name; }
  get firstName() { return this.profile.name.split(' ')[0]; }

  say(who, text) { this.history.push({ who, text, at: Date.now() }); this.onLine?.(who, text); }

  /** The mechanic says something; the customer answers (Claude, or the canned lines). */
  async talk(brain, text) {
    this.say('mechanic', text);
    let reply;
    if (brain.online) {
      try { reply = await brain.reply(this); } catch (e) { reply = `*${this.firstName} looks at you blankly* (${e.message})`; }
    } else reply = offlineReply(this, text);
    this.say('customer', reply);
    return reply;
  }

  /** Puts a proposal to them: an estimate, or extra work found on the way. */
  async propose(brain, kind, lines, total) {
    const what = lines.map((l) => `${l.text}: ${l.sek} SEK`).join('; ');
    const event = kind === 'estimate'
      ? `The mechanic hands you a written estimate: ${what}. Total ${total} SEK including VAT.`
      : `The mechanic phones you about extra work found while working on the car: ${what}. That adds ${total} SEK to the estimate.`;
    let d;
    if (brain.online) { try { d = await brain.decide(this, event); } catch (e) { d = offlineDecide(this, total); d.says += ` (${e.message})`; } }
    else d = offlineDecide(this, total);
    this.say('event', event);
    this.say('customer', d.says);
    if (d.accept) { if (kind === 'estimate') { this.estimate = { lines, total }; this.state = 'agreed'; } else this.approved += total; }
    return d;
  }

  /** What has been fixed, what has not, and what is newly wrong: for the invoice and the verdict. */
  assess() {
    const left = this.records.filter((r) => stillPresent(this.A, r));
    const fixed = this.records.filter((r) => !stillPresent(this.A, r));
    const now = this.S.roadTest();
    const was = new Set(this.before.map((o) => o.what));
    const problems = now.filter((o) => !was.has(o.what) && o.sev >= 2);
    const items = this.A.items.filter((i) => i.found);
    return { fixed, left, now, problems, items, audit: this.A.audit() };
  }

  /** The handover: they hear what was done, drive it, read the bill. */
  async handover(brain, invoice, workDone) {
    const a = this.assess();
    const limit = (this.estimate?.total ?? 0) * 1.15 + this.approved;
    const extraUnapproved = Math.max(0, invoice.total - limit);
    const notice = a.now.filter((o) => o.sev >= 1).map((o) => o.what);
    const complaintGone = this.before.filter((o) => !a.now.some((n) => n.what === o.what)).map((o) => o.what);
    const report = [
      `The mechanic hands the car back. Work done, as the mechanic tells it: ${workDone || '(nothing said)'}.`,
      `The invoice: ${invoice.lines.map((l) => `${l.text} ${l.sek} SEK`).join('; ')}. Total ${invoice.total} SEK. The agreed estimate was ${this.estimate ? this.estimate.total + ' SEK' : 'never given'}${this.approved ? `, plus ${this.approved} SEK of extra work you approved on the phone` : ''}.`,
      `You drive it round the block. What you notice now: ${notice.length ? notice.join(' ') : 'nothing wrong at all; it feels right.'}`,
      complaintGone.length ? `What has gone since you brought it in: ${complaintGone.join(' ')}` : 'Everything you noticed before is still there.',
      a.items.length ? `The mechanic also gives you back: ${a.items.map((i) => i.label).join(', ')}.` : '',
      a.problems.length ? `New problems that were not there before: ${a.problems.map((p) => p.what).join(' ')}` : '',
      extraUnapproved > 0 ? `The bill is ${Math.round(extraUnapproved)} SEK over what you agreed (more than 15 % over the estimate without asking you).` : '',
      'Now react, decide how much you pay (in SEK, you may refuse what you never agreed to, or tip), give 1-5 stars and write a short review.',
    ].filter(Boolean).join('\n');
    let v;
    const summary = { fixedAll: a.left.length === 0, fixedSome: a.fixed.length > 0, total: invoice.total, extraUnapproved, problems: a.problems };
    if (brain.online) { try { v = await brain.verdict(this, report); } catch (e) { v = offlineVerdict(this, summary); v.says += ` (${e.message})`; } }
    else v = offlineVerdict(this, summary);
    v.stars = Math.max(1, Math.min(5, Math.round(v.stars)));
    v.pays_sek = Math.max(0, Math.round(v.pays_sek));
    this.say('event', report.split('\n')[0]);
    this.say('customer', v.says);
    this.verdict = { ...v, assess: a, invoice };
    this.state = 'paid';
    return this.verdict;
  }
}

const WHERE_TEXT = { airbox: 'in the air filter housing', underseat: 'under the driver\'s seat', glovebox: 'in the glovebox', boot: 'in the boot', enginebay: 'in the engine bay', socket: 'in the 12 V socket' };

function parseWhere(w, kind) {
  if (w == null || w === '') return null;
  const s = String(w).toUpperCase().trim();
  if (kind === 'corner') return ['FL', 'FR', 'RL', 'RR'].includes(s) ? s : null;
  if (kind === 'axle') return s[0] === 'F' || s[0] === 'R' ? s[0] : null;
  if (kind === 'side') return s[0] === 'L' || s[0] === 'R' ? s[0] : null;
  if (kind === 'cyl') { const n = parseInt(s.replace(/\D/g, ''), 10); return n >= 1 && n <= 6 ? n : null; }
  return null;
}
