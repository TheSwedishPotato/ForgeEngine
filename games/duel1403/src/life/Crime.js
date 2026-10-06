import { LAW, GOODS, SHOPS, fmtMoney } from './data.js';
import { BUILDING, PLACES, NODES, groundY, navRoute, doorApproach } from '../world/town.js';
import { remember, knowsCrime } from './Memory.js';

/**
 * Crime and justice in a Bohemian subject town, 1403.
 *
 * - Whoever sees a crime raises the hue and cry ("Zloděj! Pomoc!"); everyone
 *   who hears it is bound to give chase, and the able men do. The thief
 *   taken with the stolen thing still on him (the "hand-having deed",
 *   handhaftige Tat) has no defence; it is tied to his back and he is led
 *   to the judge.
 * - The town court is the headman (rychtář) with two aldermen (konšelé). The
 *   accuser speaks, the witnesses swear. Two sworn witnesses, or capture in
 *   the act, prove the deed. Otherwise the accused may clear himself on
 *   oath with oath-helpers (compurgators) who swear to his good name: two
 *   for a small matter, six for a great one ("with seven hands").
 * - Sentences: fines and amends, restoration twofold, the pillory, the
 *   whip and banishment for petty theft; the gallows for great theft or
 *   theft by night; the sword for killing, unless the dead man's kin accept
 *   a reconciliation (smír): money, Masses, a pilgrimage and a stone cross.
 *
 * The townsfolk break the law too: pilfering at the market, tavern brawls.
 * Their trials and punishments are news, and news is gossip.
 */

export const PETTY = 360;            // parvi: theft above half a kopa is great theft
export const COMPURGATORS = { small: 2, great: 6 };
const SMIR = 1440;                   // parvi: two kopa for a commoner's death (estimate; settlements varied widely)
const SEVERITY = { privy: 1, curfew: 1, insult: 1, weapons: 1, gambling: 1, market: 1, sunday: 1, brawl: 2, theft: 2, housebreaking: 2, killing: 5, outlaw: 5, perjury: 2 };

const VERB = {
  theft: (c, s) => c.item ? `stole ${GOODS[c.item]?.name.toLowerCase() ?? c.item}${c.victim ? ` from ${s.byId[c.victim]?.fullName ?? 'someone'}` : ''}` : `cut ${s.byId[c.victim]?.fullName ?? 'someone'}'s purse (${fmtMoney(c.value)})`,
  brawl: (c, s) => `struck ${s.byId[c.victim]?.fullName ?? 'a man'}${c.blood ? ' and drew blood' : ''}`,
  killing: (c, s) => `killed ${s.byId[c.victim]?.fullName ?? 'a man'}${c.selfDefence ? ' (who had attacked first)' : ''}`,
  housebreaking: (c) => `broke into ${BUILDING[c.where]?.name.toLowerCase() ?? 'a house'}${c.night ? ' by night' : ''}`,
  privy: () => 'relieved themself in the street',
  insult: (c, s) => `insulted ${s.byId[c.victim]?.fullName ?? 'someone'}`,
  weapons: () => 'carried a sword in town',
  curfew: () => 'walked the streets after the curfew bell',
  outlaw: () => 'came back to the town after being banished',
  perjury: () => 'swore a false oath before the court',
};

export function crimeText(sim, c) { return (VERB[c.law] ?? (() => LAW[c.law]?.name.toLowerCase() ?? c.law))(c, sim); }
export function severity(c) { return c.law === 'theft' ? (c.value > PETTY || c.night ? 4 : 2) : c.law === 'brawl' && c.blood ? 3 : c.law === 'housebreaking' && c.night ? 3 : SEVERITY[c.law] ?? 1; }

export class Justice {
  constructor(sim) {
    this.sim = sim;
    this.nextId = 1;
    this.hue = null;            // {crier, since, lastSeen, crime}
    this.news = [];             // [{t, text}] the town's talk
    this.trial = null;
    this.lastNpcCrime = sim.t;
  }

  // --- the player's offences -----------------------------------------------------------------------

  /**
   * Record an offence by the player. info: {victim, item, value, blood, seen,
   * selfDefence, cry}. Witnesses remember it; if any saw it and it is more
   * than a small matter, the hue and cry goes up.
   */
  offence(lawId, info = {}) {
    const s = this.sim, P = s.player;
    const seen = info.seen ?? s.witnesses(P.x, P.z, P.inside);
    const c = { id: 'c' + this.nextId++, law: lawId, t: s.t, victim: info.victim?.id ?? null, item: info.item ?? null, value: info.value ?? 0, blood: !!info.blood, selfDefence: !!info.selfDefence, where: P.inside ?? 'street', night: s.isNight(), seen: seen.map((p) => p.id), settled: false };
    c.severity = severity(c);
    P.crimes.push(c);
    const text = crimeText(s, c);
    for (const w of seen) {
      const isVictim = w.id === c.victim;
      const hurt = (isVictim ? 2 : 1) * (lawId === 'privy' ? 3 : 6 + 5 * c.severity);
      w.attitude = Math.max(-100, w.attitude - hurt);
      const t2 = isVictim ? 'the stranger ' + text.split(w.fullName + "'s").join('my').split(w.fullName).join('me') : `the stranger ${text}`;
      remember(w, { kind: isVictim ? 'done' : 'saw', text: t2, weight: 2 + 2 * c.severity, crime: c.id, att: -hurt }, s.t);
    }
    // the victim knows what happened to them even unseen (a purse found empty, a shop short a loaf)
    if (info.victim && !seen.includes(info.victim) && info.victimLearns) remember(info.victim, { kind: 'done', text: info.victimLearns, weight: 3, crime: c.id, att: -4 }, s.t);
    if (seen.length) {
      P.reputation -= lawId === 'privy' ? 2 : 4 * c.severity;
      P.wanted = Math.max(P.wanted, c.severity >= 4 ? 3 : c.severity >= 2 ? 2 : 1);
      s.emit({ type: 'crime', law: LAW[lawId] ?? { name: lawId }, crime: c, seen: seen.length, text: `${LAW[lawId]?.name ?? lawId}: ${seen.length} ${seen.length === 1 ? 'person' : 'people'} saw you.` });
      if (c.severity >= 2 && info.cry !== false) {
        const crier = seen.find((p) => p.id === c.victim) ?? seen.slice().sort((a, b) => b.traits.courage - a.traits.courage)[0];
        this.raiseHue(crier, c);
      }
    }
    return c;
  }

  /** The hue and cry: a shout, and every able man in earshot gives chase. */
  raiseHue(crier, c) {
    const s = this.sim, P = s.player;
    const cry = c.law === 'theft' ? 'Zloděj! Thief! Stop him!' : c.law === 'killing' ? 'Vražda! Murder! Help!' : 'Pomoc! Help! Seize him!';
    const pursuers = [];
    for (const p of s.people) {
      if (!p.alive || p.follow) continue;
      const a = p.agent;
      const near = P.inside ? a.inside === P.inside || (!a.inside && Math.hypot(a.x - BUILDING[P.inside].door.x, a.z - BUILDING[P.inside].door.z) < 30) : !a.inside && Math.hypot(a.x - P.x, a.z - P.z) < 35;
      if (!near) continue;
      const able = p.sex === 'm' && p.age >= 16 && p.age <= 62 && (p.watch || p.traits.courage > 0.45 || p.id === c.victim);
      if (able) { a.pursuit = 'hue'; a.place = 'pursuit'; a.route = []; a.seizeT = 0; pursuers.push(p); }
    }
    this.hue = { crier: crier.id, since: s.t, crime: c.id, out: 0, wall: 0 };
    s.emit({ type: 'hue', crier, text: `${crier.name} cries out: "${cry}"${pursuers.length ? ` ${pursuers.length} ${pursuers.length === 1 ? 'man gives' : 'men give'} chase.` : ''}`, pursuers: pursuers.length });
  }

  /** Steal from the shop or stall you stand at. */
  steal() {
    const s = this.sim, P = s.player;
    let shop = null, owner = null;
    if (P.inside && SHOPS[P.inside]) { shop = P.inside; owner = s.people.find((p) => p.sells === shop && p.alive && p.agent.inside === shop && !p.agent.route.length); }
    else if (!P.inside && Math.hypot(P.x - PLACES.market.x, P.z - PLACES.market.z) < 7) { shop = 'market'; owner = s.people.find((p) => p.sells === 'market' && p.alive && !p.agent.inside && Math.hypot(p.agent.x - PLACES.market.x, p.agent.z - PLACES.market.z) < 8); }
    if (!shop) return { ok: false, why: 'There is nothing here to take. Stalls are at the market; goods lie on the counters in the shops.' };
    const goods = (SHOPS[shop] ?? []).filter((k) => GOODS[k].kind !== 'service');
    if (!goods.length) return { ok: false, why: 'Nothing here you could carry off.' };
    const item = goods.reduce((best, k) => (GOODS[k].price > GOODS[best].price ? k : best), goods[0]);
    const value = GOODS[item].price;
    const seen = this._detect(owner, 0.62);
    P.inventory[item] = (P.inventory[item] ?? 0) + 1;
    P.stolen = { ...(P.stolen ?? {}), [item]: (P.stolen?.[item] ?? 0) + 1 };
    P.skills.stealth = Math.min(100, (P.skills.stealth ?? 5) + 1);
    if (!seen.length) {
      if (owner) remember(owner, { kind: 'done', text: `${GOODS[item].name.toLowerCase()} went missing while the stranger was in the shop`, weight: 4, att: -8 }, s.t);
      if (owner) owner.attitude -= 8;
      s.emit({ type: 'info', text: `You slip ${GOODS[item].name.toLowerCase()} under your coat. Nobody saw.` });
      const c = { id: 'c' + this.nextId++, law: 'theft', t: s.t, victim: owner?.id ?? null, item, value, where: P.inside ?? 'street', night: s.isNight(), seen: [], settled: false, unseen: true };
      c.severity = severity(c); P.crimes.push(c);
      return { ok: true, seen: 0, item };
    }
    this.offence('theft', { victim: owner, item, value, seen });
    return { ok: true, seen: seen.length, item };
  }

  /** Cut a purse. */
  pickpocket(p) {
    const s = this.sim, P = s.player;
    if (!p || p.money <= 0) return { ok: false, why: 'Their purse is empty.' };
    const stealth = P.skills.stealth ?? 5;
    const noticed = Math.random() < 0.55 - stealth / 220 + 0.25 * p.traits.neuroticism - (p.agent.act.includes('drink') ? 0.2 : 0);
    const others = this._detect(null, 0, p);
    const take = Math.max(1, Math.min(p.money, Math.round(p.money * (0.1 + 0.3 * Math.random()))));
    const seen = noticed ? [p, ...others] : others;
    P.skills.stealth = Math.min(100, stealth + 1.5);
    if (seen.length && noticed) {
      this.offence('theft', { victim: p, value: take, seen });
      return { ok: true, caught: true, money: 0 };
    }
    p.money -= take; P.money += take;
    if (seen.length) this.offence('theft', { victim: p, value: take, seen, victimLearns: `found my purse ${fmtMoney(take)} lighter` });
    else {
      remember(p, { kind: 'done', text: `found my purse ${fmtMoney(take)} lighter after the stranger brushed past`, weight: 4, att: -10 }, s.t + 1);
      const c = { id: 'c' + this.nextId++, law: 'theft', t: s.t, victim: p.id, value: take, where: P.inside ?? 'street', night: s.isNight(), seen: [], settled: false, unseen: true };
      c.severity = severity(c); P.crimes.push(c);
      s.emit({ type: 'info', text: `You lift ${fmtMoney(take)} from ${p.name}'s purse.` });
    }
    return { ok: true, caught: false, money: seen.length ? take : take };
  }

  /** Strike someone. They fight back, run, or cry out, as they are. */
  strike(p) {
    const s = this.sim;
    const fightsBack = p.watch || p.traits.courage + p.traits.temper > 1.05;
    p.hurt = Math.min(1, (p.hurt ?? 0) + 0.15);
    const c = this.offence('brawl', { victim: p, cry: !fightsBack });
    remember(p, { kind: 'done', text: 'struck me', weight: 7, crime: c.id, att: -30 }, s.t);
    return { fightsBack, crime: c };
  }

  /** Who notices: the shop's owner with probability pOwner, others by distance and light. */
  _detect(owner, pOwner, victim = null) {
    const s = this.sim, P = s.player;
    const night = s.isNight();
    const stealth = (P.skills.stealth ?? 5) / 140;
    const out = [];
    for (const w of s.witnesses(P.x, P.z, P.inside)) {
      if (w === victim) continue;
      if (w.follow && w.attitude > 30) continue;     // your companion looks away
      const d = P.inside ? 3 : Math.hypot(w.agent.x - P.x, w.agent.z - P.z);
      const base = w === owner ? pOwner : Math.max(0, 0.42 - d * 0.025) * (w.agent.speed > 0.1 ? 0.6 : 1);
      if (Math.random() < base * (night ? 0.5 : 1) * (1 - stealth)) out.push(w);
    }
    return out;
  }

  // --- pursuit and arrest ---------------------------------------------------------------------------

  /** Per frame: the watch looks for the wanted and night walkers; the hue and cry runs you down. */
  update(dtReal, d) {
    const s = this.sim, P = s.player;
    if (!P.alive || P.sleepingUntil > s.t || s.pendingStop || this.trial || P.held || P.restrained) return;
    // banished men found in town are taken
    if (P.banished && P.banished > s.t && this._inTown() && !P.crimes.some((c) => c.law === 'outlaw' && !c.settled)) {
      const w = s.witnesses(P.x, P.z, P.inside).find((p) => p.watch || p.role === 'headman');
      if (w) this.offence('outlaw', { seen: [w] });
    }
    const night = s.isNight(d.h);
    let anyClose = false;
    for (const p of s.people) {
      if (!p.alive) continue;
      const a = p.agent;
      // the curfew is for the streets: nobody is taken up for it indoors
      const curfew = p.watch && night && !P.army && !P.curfewChecked && !P.inside;
      const hunting = a.pursuit === 'hue' || (p.watch && P.wanted > 0) || curfew;
      if (!hunting) { if (a.pursuit === 'watch') this._release(p); continue; }
      // where is the player, as this person can reach them
      if (P.inside) {
        const b = BUILDING[P.inside];
        if (a.inside === P.inside) {
          a.seizeT = (a.seizeT ?? 0) + dtReal;
          if (a.seizeT > 3) return this._seize(p);
          anyClose = true;
          continue;
        }
        if (a.inside) continue;
        const dist = Math.hypot(a.x - b.door.x, a.z - b.door.z);
        if (a.pursuit !== 'hue' && dist > 25) { if (a.pursuit) this._release(p); continue; }
        if (a.pursuit === 'hue' && dist > 70) continue;
        a.pursuit ||= 'watch'; a.place = 'pursuit';
        { const ap = doorApproach(b); a.route = navRoute([[a.x, a.z], [ap.x, ap.z], [b.door.x, b.door.z]], { skipLast: b.id }).slice(1); a.skip = new Set([b.id]); }
        if (dist < 1.2) { a.inside = P.inside; a.route = []; a.seizeT = 0; }
        anyClose ||= dist < 45;
        continue;
      }
      if (a.inside) {
        if (a.pursuit === 'hue') { const b = BUILDING[a.inside]; a.x = b.door.x; a.z = b.door.z; a.inside = null; }
        else continue;
      }
      const dist = Math.hypot(a.x - P.x, a.z - P.z);
      if (a.pursuit !== 'hue') {
        // the watch: the wanted within sight, or night walkers close by; lost sight of, they go back to their rounds
        const sees = (P.wanted > 0 && dist < (a.pursuit ? 40 : 25)) || (curfew && dist < (a.pursuit ? 16 : 10));
        if (!sees) { if (a.pursuit) this._release(p); continue; }
        a.pursuit = 'watch'; a.place = 'pursuit';
      }
      if (dist > 70) continue;
      anyClose ||= dist < 45;
      if (dist > 1.5) { a.route = navRoute([[a.x, a.z], [P.x, P.z]]).slice(1); a.skip = null; }
      else return this._seize(p);
    }
    // a hue and cry runs out when you are out of reach long enough
    if (this.hue) {
      this.hue.wall += dtReal;
      this.hue.out = anyClose ? 0 : this.hue.out + dtReal;
      if (this.hue.out > 40 || this.hue.wall > 240) this.endHue(true);
    }
  }

  _release(p) { p.agent.pursuit = false; p.agent.place = null; p.agent.route = []; p.agent.seizeT = 0; }

  _inTown() { const P = this.sim.player; return !!P.inside && P.inside !== 'hall' && P.inside !== 'barracks' || (Math.abs(P.x) < 60 && P.z > 62 && P.z < 145); }

  endHue(escaped = false) {
    const s = this.sim;
    for (const p of s.people) if (p.agent.pursuit) { p.agent.pursuit = false; p.agent.place = null; p.agent.route = []; p.agent.seizeT = 0; }
    if (this.hue && escaped) s.emit({ type: 'law', text: 'The shouting dies away behind you. You have got clear — for now. Everyone who saw you knows your face.' });
    this.hue = null;
  }

  _seize(by) {
    const s = this.sim, P = s.player;
    const open = P.crimes.filter((c) => !c.settled && c.seen.length);
    // caught with the goods: the handhafte deed
    for (const c of open) if (s.t - c.t < 3 && (c.item ? (P.inventory[c.item] ?? 0) > 0 : true) && this.hue) c.handhafte = true;
    const serious = open.some((c) => c.severity >= 2);
    s.pendingStop = { by, reason: P.wanted > 0 || open.length ? 'wanted' : 'curfew', serious, seizedBy: by.watch ? 'watch' : 'townsfolk' };
    s.emit({ type: 'stopped', by, reason: s.pendingStop.reason, serious, seizedBy: s.pendingStop.seizedBy });
    return true;
  }

  // --- the court ------------------------------------------------------------------------------------

  /** The court: the headman and two aldermen, or the burgrave if they are gone. */
  court() {
    const s = this.sim;
    const judge = s.people.find((p) => p.role === 'headman' && p.alive) ?? s.people.find((p) => p.role === 'burgrave' && p.alive);
    const aldermen = s.people.filter((p) => p.rank === 'alderman' && p.alive).slice(0, 2);
    return { judge, aldermen };
  }

  /** Open a trial for the player's unsettled serious crimes (they are held in the rychta). */
  openTrial() {
    const s = this.sim, P = s.player;
    const charges = P.crimes.filter((c) => !c.settled && (c.seen.length || c.handhafte) && c.severity >= 2);
    if (!charges.length) return null;
    this.endHue(false);
    // the court sits by day: a night in the lock-up first
    const h = s.date().h;
    if (h < 6 || h > 17) {
      const wait = h > 17 ? 24 - h + 7.5 : 7.5 - h;
      s.emit({ type: 'law', text: `You are locked in the rychta's cellar until the court sits in the morning.` });
      P.inside = 'rychta';
      s.emit({ type: 'moved' });
      P.held = true;
      s.advance(wait);
      P.held = false;
    }
    P.inside = 'rychta';
    s.emit({ type: 'moved' });
    const { judge, aldermen } = this.court();
    const counts = charges.map((c) => {
      const victim = c.victim ? s.byId[c.victim] : null;
      const accuser = victim?.alive ? victim : c.victim && victim?.spouse && s.byId[victim.spouse]?.alive ? s.byId[victim.spouse] : s.byId[c.seen[0]] ?? null;
      const witnesses = s.people.filter((p) => p.alive && p !== accuser && knowsCrime(p, c.id, true));
      const proof = c.handhafte ? 'handhafte' : witnesses.length + (accuser && knowsCrime(accuser, c.id, true) ? 1 : 0) >= 2 ? 'witnesses' : witnesses.length + (accuser && knowsCrime(accuser, c.id, true) ? 1 : 0) === 1 ? 'one' : 'none';
      return { c, text: crimeText(s, c), accuser, witnesses, proof, great: c.severity >= 4 };
    });
    this.trial = { judge, aldermen, counts, i: 0, t: s.t, log: [] };
    s.emit({ type: 'trial', trial: this.trial });
    return this.trial;
  }

  /** People who would swear to your good name: those who think well of you and did not see you do it. */
  oathHelpers(count) {
    const s = this.sim;
    return s.people.filter((p) => p.alive && p.attitude >= 35 && !knowsCrime(p, count.c.id, true) && p !== count.accuser && !/beggar/.test(p.role)).sort((a, b) => b.attitude - a.attitude);
  }

  /** What the kin (or victim) would take for a reconciliation, or null if they will not. */
  smirPrice(count) {
    const s = this.sim, c = count.c;
    const v = c.victim ? s.byId[c.victim] : null;
    const kin = v?.alive ? v : v?.spouse ? s.byId[v.spouse] : null;
    if (!kin || !kin.alive) return c.law === 'killing' ? { price: SMIR, kin: null } : null;
    const base = c.law === 'killing' ? SMIR * (v.rank === 'alderman' || v.rank === 'rychtar' ? 2 : v.estate === 'knights' ? 4 : 1) : c.law === 'brawl' ? (c.blood ? 120 : 36) : c.law === 'theft' ? c.value * 2 + 24 : 60;
    if (kin.attitude < -80 && c.law !== 'killing') return null;
    const price = Math.round(base * (1 + Math.max(0, -kin.attitude) / 100) * (0.8 + 0.4 * kin.traits.greed));
    return { price, kin };
  }

  /**
   * The accused's plea on the current count: 'confess' | 'deny' | 'smir' (settle).
   * Returns {verdict: 'guilty'|'cleared'|'settled', text, sentence}.
   */
  plead(plea) {
    const s = this.sim, P = s.player, T = this.trial;
    const k = T.counts[T.i];
    const lines = [];
    let verdict = 'guilty';
    if (plea === 'smir') {
      const sm = this.smirPrice(k);
      if (sm && P.money >= sm.price) {
        P.money -= sm.price;
        if (sm.kin) { sm.kin.money += sm.price; sm.kin.attitude = Math.min(100, sm.kin.attitude + 35); remember(sm.kin, { kind: 'got', text: `paid ${fmtMoney(sm.price)} in reconciliation for what they did`, weight: 6, crime: k.c.id, att: 30 }, s.t); }
        lines.push(`${sm.kin ? sm.kin.fullName : 'The kin'} take${sm.kin ? 's' : ''} ${fmtMoney(sm.price)} in reconciliation (smír)${k.c.law === 'killing' ? ', and you swear to have Masses said, to go on pilgrimage to Aachen, and to set up a stone cross where he fell' : ''}. The court records the settlement and pardons the deed.`);
        verdict = 'settled';
      } else lines.push(sm ? `They ask ${fmtMoney(sm.price)}. You cannot pay it.` : `${k.accuser?.name ?? 'The accuser'} will not be reconciled.`);
    }
    if (verdict !== 'settled') {
      if (plea === 'deny' || plea === 'smir') {
        if (k.proof === 'handhafte') lines.push(`You were taken with the deed in hand${k.c.item ? `, the ${GOODS[k.c.item].name.toLowerCase()} on you` : ''}: there is no oath against that.`);
        else if (k.proof === 'witnesses') lines.push(`${k.witnesses.slice(0, 2).map((w) => w.fullName).join(' and ')} swear on the relics that they saw it. Two witnesses are proof.`);
        else {
          const need = k.great ? COMPURGATORS.great : COMPURGATORS.small;
          const helpers = this.oathHelpers(k).slice(0, need);
          if (k.proof === 'none' && !k.great && helpers.length >= Math.min(need, 1) || helpers.length >= need) {
            verdict = 'cleared';
            lines.push(`You swear your innocence with ${helpers.length ? helpers.map((h) => h.fullName).join(', ') : 'your own hand'} swearing to your good name. The oath stands: you are cleared.`);
            if (k.accuser) { k.accuser.attitude -= 10; remember(k.accuser, { kind: 'met', text: 'swore their way clear of my accusation in court', weight: 5, att: -10 }, s.t); }
            for (const h of helpers) remember(h, { kind: 'gave', text: 'swore to their good name in court', weight: 4, att: 5 }, s.t);
          } else {
            lines.push(`You need ${need} oath-helpers to swear for you; ${helpers.length ? `only ${helpers.map((h) => h.name).join(', ')} will` : 'no one in the town will'}. The oath fails.`);
          }
        }
      } else lines.push('You confess the deed before the court.');
    }
    let sentence = null;
    if (verdict === 'guilty') sentence = this.sentence(k, plea === 'confess');
    for (const p of s.people) if (p.alive && (p === T.judge || T.aldermen.includes(p) || p === k.accuser || k.witnesses.includes(p))) {
      remember(p, { kind: 'saw', text: verdict === 'cleared' ? `the court cleared them of: ${k.text}` : verdict === 'settled' ? `they settled with reconciliation for: ${k.text}` : `the court found them guilty: ${k.text}; ${sentence.text}`, weight: 6, crime: k.c.id, att: verdict === 'guilty' ? -6 : 0 }, s.t);
    }
    k.c.settled = true;
    this.news.push({ t: s.t, text: `The stranger ${P.name} was ${verdict === 'cleared' ? 'cleared on oath of' : verdict === 'settled' ? 'reconciled with the kin for' : 'found guilty of'} ${k.text.replace(/^the stranger /, '')}${sentence ? ` and sentenced: ${sentence.text}` : ''}.` });
    T.log.push(...lines);
    T.i++;
    return { verdict, text: lines.join(' '), sentence };
  }

  /** The sentence for a count (carried out by `execute`). */
  sentence(k, confessed) {
    const c = k.c, P = this.sim.player;
    const prior = P.crimes.filter((x) => x !== c && x.law === c.law && x.settled && x.convicted).length;
    c.convicted = true;
    if (c.law === 'killing') return c.selfDefence ? { fine: 240, amends: 0, text: 'killing in defence of your life: a fine of 20 groschen to the court', pillory: 0 } : { death: 'the sword', text: 'death by the sword' };
    if (c.law === 'outlaw') return { death: 'the gallows', text: 'hanging, having come back from banishment' };
    if (c.law === 'theft') {
      if (k.great && !confessed) return { death: 'the gallows', text: `hanging, for great theft${c.night ? ' by night' : ''}` };
      if (k.great) return { flog: true, banish: true, restore: c.value * 2, text: 'for confessing a great theft: restoration twofold, the whip, and banishment from the lordship' };
      if (prior) return { flog: true, banish: true, restore: c.value * 2, text: 'a second theft: restoration twofold, the whip and banishment' };
      return { restore: c.value * 2, pillory: 6, text: 'restoration twofold and six hours in the pillory' };
    }
    if (c.law === 'brawl') return { fine: c.blood ? 120 : 24, amends: c.blood ? 60 : 12, text: c.blood ? 'a fine of 10 groschen and 5 groschen wound-money to the man you hurt' : 'a fine of 2 groschen and a groschen\'s amends', pillory: 0 };
    if (c.law === 'housebreaking') return c.night ? { flog: true, banish: true, text: 'breaking the house peace by night: the whip and banishment' } : { fine: 60, text: 'a fine of 5 groschen for breaking the house peace' };
    return { fine: LAW[c.law]?.fine ?? 12, text: `a fine of ${fmtMoney(LAW[c.law]?.fine ?? 12)}` };
  }

  /** Beg for mercy before a sentence of death: friends and the priest may intercede. */
  mercy(sentence) {
    const s = this.sim;
    const friends = s.people.filter((p) => p.alive && p.attitude >= 50);
    const priest = s.people.find((p) => p.role === 'priest');
    const chance = 0.1 + 0.12 * friends.length + (priest?.attitude > 20 ? 0.15 : 0) + (s.player.reputation > 10 ? 0.1 : 0);
    const granted = Math.random() < Math.min(0.85, chance);
    const who = friends.slice(0, 3).map((p) => p.name).join(', ');
    if (granted) return { granted, sentence: { flog: true, banish: true, text: 'commuted at the plea of ' + (who || 'the priest') + ': the whip and banishment' } };
    return { granted, sentence };
  }

  /** Carry out a sentence. */
  execute(sen) {
    const s = this.sim, P = s.player;
    const out = [];
    if (sen.death) { s.die(sen.death); return 'dead'; }
    let fine = (sen.fine ?? 0) + (sen.amends ?? 0) + (sen.restore ?? 0);
    if (fine) {
      const paid = Math.min(P.money, fine);
      P.money -= paid;
      if (paid < fine) { out.push(`You cannot pay all of it (${fmtMoney(fine - paid)} short): the rest is taken in the pillory.`); sen.pillory = Math.max(sen.pillory ?? 0, 4); }
      else out.push(`You pay ${fmtMoney(fine)}.`);
    }
    if (sen.pillory) {
      P.inside = null; P.x = PLACES.pillory.x; P.z = PLACES.pillory.z; P.y = groundY(P.x, P.z);
      s.emit({ type: 'moved' });
      P.restrained = 'pillory';
      for (const w of s.witnesses(P.x, P.z, null)) remember(w, { kind: 'saw', text: 'stood in the pillory in the square', weight: 5, att: -4 }, s.t);
      s.advance(sen.pillory);
      P.restrained = null;
      P.needs.dirt = Math.min(110, P.needs.dirt + 30);
      P.reputation -= 8;
      out.push(`${sen.pillory} hours in the pillory, while the town jeers and throws muck.`);
    }
    if (sen.flog) { P.health = Math.max(5, P.health - 30); P.reputation -= 15; out.push('The executioner\'s man whips you at the pillory, forty strokes.'); }
    if (sen.banish) {
      P.banished = s.t + 24 * 365;
      P.inside = null; P.x = NODES.south[0] + 2; P.z = NODES.south[1] - 6; P.y = groundY(P.x, P.z);
      s.emit({ type: 'moved' });
      out.push('You are put out on the south road and told that if you are found in Skalice again you will hang.');
    }
    return out.join(' ');
  }

  endTrial() {
    const s = this.sim, P = s.player;
    this.trial = null;
    if (!P.crimes.some((c) => !c.settled && c.seen.length)) P.wanted = 0;
    s.emit({ type: 'trialEnd' });
  }

  // --- the townsfolk's own crimes -------------------------------------------------------------------

  /** Now and then someone pilfers at the market or a drunk starts a fight in the tavern. */
  npcCrimes(d) {
    const s = this.sim;
    if (s.t - this.lastNpcCrime < 5) return;
    if (Math.random() > 0.08) return;
    this.lastNpcCrime = s.t;
    const at = (place) => s.people.filter((p) => p.alive && (p.agent.inside === place || (!p.agent.inside && p.agent.place === place)) && !p.agent.route.length);
    if (d.h >= 7 && d.h < 16) {
      const market = at('market');
      const thief = market.filter((p) => p.traits.honesty < 0.35 && p.traits.greed > 0.5 && p.money < 200 && !p.watch).sort(() => Math.random() - 0.5)[0];
      const owner = s.people.find((p) => p.sells === 'market');
      if (!thief || !owner) return;
      const seen = market.filter((p) => p !== thief && Math.random() < 0.5);
      const text = `${thief.fullName} stole a hood from ${owner.fullName}'s stall`;
      for (const w of seen) remember(w, { kind: 'saw', text, about: thief.id, weight: 5, att: 0 }, s.t);
      if (seen.length) {
        thief.override = { place: 'pillory', act: 'standing in the pillory for theft', until: s.t + 6 };
        this.news.push({ t: s.t, text: `${text}; the hue and cry went up, the watch took him, and the headman put him in the pillory for six hours.` });
        s.emit({ type: 'news', text: `In the market: "${seen[0].name} cries thief!" ${thief.fullName} is taken and put in the pillory.` });
      } else this.news.push({ t: s.t, text: `A hood went missing from ${owner.fullName}'s stall and nobody saw who took it.` });
    } else if (d.h >= 18.5 && d.h < 20.5) {
      const tav = at('tavern').filter((p) => p.sex === 'm' && p.traits.temper > 0.6);
      if (tav.length < 2) return;
      const [a, b] = tav.sort(() => Math.random() - 0.5);
      const text = `${a.fullName} and ${b.fullName} came to blows in the tavern`;
      for (const w of at('tavern')) if (w !== a && w !== b) remember(w, { kind: 'saw', text, about: a.id, weight: 4 }, s.t);
      a.money = Math.max(0, a.money - 24); b.money = Math.max(0, b.money - 24);
      a.hurt = Math.min(1, (a.hurt ?? 0) + 0.2);
      this.news.push({ t: s.t, text: `${text}; the headman fined them both two groschen.` });
      if (s.player.inside === 'tavern') s.emit({ type: 'news', text: `${a.name} throws a mug at ${b.name}, and they go at each other across the table until the innkeeper pulls them apart.` });
    }
    if (this.news.length > 20) this.news.shift();
  }

  serialize() { return { nextId: this.nextId, news: this.news, lastNpcCrime: this.lastNpcCrime }; }
  restore(o) { Object.assign(this, { nextId: o.nextId ?? 1, news: o.news ?? [], lastNpcCrime: o.lastNpcCrime ?? this.sim.t }); }
}
