import { NODES, BUILDING, BUILDINGS, PLACES, path, nearestNode, groundY } from '../world/town.js';
import { makePeople, scheduled } from './people.js';
import { NEEDS, GOODS, SHOPS, LAW, ARMY_RANKS, ARMY_RANK, START_DATE, CURFEW, DAWN, dateText, BELLS, STARTS, fmtMoney } from './data.js';
import { Justice } from './Crime.js';
import { remember, gossip, serializeMemories } from './Memory.js';

const WALK = 1.35;            // m/s, a townsman's pace
const RUN = 2.7, HURRY = 2.2; // m/s, chasing a thief; the watch closing in
const PATROL = ['sq', 'n', 'sq', 'sqE', 'e1', 'sqE', 'sq', 'b', 'south', 'b', 'sq', 'sqW', 'w1', 'sqW'];
const FEASTS = new Set(['9-28']);   // St Wenceslas

/** Where inside or outside a person stands for a place. */
function spotFor(place, idx) {
  const pl = PLACES[place];
  if (pl) {
    const a = idx * 2.39996, r = 0.6 + (idx % 4) * 0.55;
    return { x: pl.x + Math.cos(a) * r, z: pl.z + Math.sin(a) * r, node: pl.node, inside: null };
  }
  const b = BUILDING[place];
  if (b) return { x: b.door.x, z: b.door.z, node: b.node, inside: b.id };
  return { x: NODES.sq[0], z: NODES.sq[1], node: 'sq', inside: null };
}

/**
 * The living town: a clock, everyone's day, the player's body and purse,
 * the law, and the garrison. Headless: the renderer and the UI read it.
 * Time is in game hours from midnight before 27 September 1403.
 */
export class LifeSim {
  constructor({ seed = 1403, start = STARTS[0], name = 'Jan', sex = 'm' } = {}) {
    this.t = START_DATE.h;
    this.rate = 1 / 60;        // game hours per real second (a game minute per second)
    this.people = makePeople(seed);
    this.byId = Object.fromEntries(this.people.map((p) => [p.id, p]));
    this.events = [];
    this.listeners = [];
    this.lastBell = -1;
    // agents: everyone starts where their morning has them
    const now = this.date();
    for (const p of this.people) {
      const s = this._schedule(p, now);
      const sp = spotFor(s.place, p.idx);
      p.agent = { x: sp.x, z: sp.z, y: groundY(sp.x, sp.z), yaw: (p.idx * 1.7) % 6.28, inside: sp.inside, place: s.place, act: s.act, route: [], speed: 0, wait: 0 };
    }
    // the player
    const st = start;
    const home = BUILDING[st.home];
    this.player = {
      name, sex, start: st.id, rank: st.rank, estate: st.estate, noble: !!st.noble, startName: st.name,
      x: home ? home.door.x + Math.sign(home.door.x - home.x) * (Math.abs(home.door.x - home.x) / home.w > Math.abs(home.door.z - home.z) / home.d ? 1.6 : 0) : 0,
      z: home ? home.door.z + Math.sign(home.door.z - home.z) * (Math.abs(home.door.x - home.x) / home.w > Math.abs(home.door.z - home.z) / home.d ? 0 : 1.6) : 95,
      y: 0, yaw: home ? Math.atan2(home.door.x - home.x, home.door.z - home.z) : Math.PI, inside: null,
      money: st.money, skills: { labour: 10, sword: 10, crossbow: 5, speech: 10, trade: 5, letters: 0, riding: 0, stealth: 5, ...st.skills },
      needs: { hunger: 25, thirst: 30, bladder: 35, bowels: 20, fatigue: 10, dirt: 20 }, health: 100, drunk: 0,
      inventory: { bread: 1 }, dress: { ...st.dress }, colors: { ...st.colors }, weapon: st.weapon ?? null, weaponDrawn: false,
      home: st.home, reputation: 0, crimes: [], wanted: 0, jailUntil: 0, army: null, renown: 0, alive: true, deathCause: null,
      knownNames: new Set(),
    };
    this.player.y = groundY(this.player.x, this.player.z);
    this.justice = new Justice(this);
    this.lastGossip = this.t;
  }

  /** Remember something (see Memory.js). */
  remember(p, m) { return remember(p, m, this.t); }

  on(fn) { this.listeners.push(fn); }
  emit(e) { e.t = this.t; this.events.push(e); if (this.events.length > 200) this.events.shift(); for (const f of this.listeners) f(e); }

  date() { return dateText(this.t); }
  isFeast(d = this.date()) { return FEASTS.has(`${d.m}-${d.d}`); }
  isNight(h = this.date().h) { return h >= CURFEW || h < DAWN; }

  _schedule(p, d) {
    if (!p.alive) return { place: p.agent?.place ?? 'church', act: 'lying dead' };
    if (p.override && p.override.until > this.t) return p.override;
    return scheduled(p, d.h, d.wd, this.isFeast(d));
  }

  // --- per frame ----------------------------------------------------------------------------

  /** Advance by real seconds dtReal (walking is real time; the clock runs at `rate`). */
  update(dtReal, { skipHours = 0 } = {}) {
    const dh = dtReal * this.rate + skipHours;
    const before = this.date();
    this.t += dh;
    const d = this.date();
    // bells
    for (const b of BELLS) {
      const crossed = (before.h < b.h && d.h >= b.h) || (d.h < before.h && (b.h > before.h || b.h <= d.h));
      if (crossed) this.emit({ type: 'bell', bell: b });
    }
    if (d.d !== before.d) { this.player.curfewChecked = false; this.emit({ type: 'day', date: d }); }
    if (d.h >= 6 && (before.h < 6 || d.d !== before.d)) this._payCompanions();
    for (const p of this.people) this._updatePerson(p, dtReal, d, skipHours > 0);
    this._updatePlayer(dh, d);
    this.justice.update(dtReal, d);
    this.justice.npcCrimes(d);
    if (this.t - this.lastGossip > 0.2) { this.lastGossip = this.t; gossip(this); }
  }

  _updatePerson(p, dt, d, teleport) {
    const a = p.agent;
    if (p.follow && !a.pursuit && p.alive) { this._follow(p, a, dt, teleport, d); a.y = groundY(a.x, a.z); return; }
    const s = a.pursuit ? { place: a.place, act: a.pursuit === 'hue' ? 'running after you, shouting' : 'coming for you' } : this._schedule(p, d);
    const place = s.place;
    if (!a.pursuit && (place !== a.place || s.act !== a.act)) {
      a.act = s.act;
      if (place !== a.place) {
        a.place = place;
        if (place === 'patrol') { a.patrolIx = p.idx % PATROL.length; a.route = this._routeTo(a, PATROL[a.patrolIx], null); }
        else {
          const sp = spotFor(place, p.idx);
          a.route = this._routeTo(a, sp.node, sp);
          a.target = sp;
        }
      }
    }
    if (teleport && a.route.length) {
      const last = a.route[a.route.length - 1];
      a.x = last[0]; a.z = last[1]; a.route = [];
      if (a.place !== 'patrol') a.inside = a.target?.inside ?? null;
    }
    // walk the route
    if (a.route.length) {
      if (a.inside) { const b = BUILDING[a.inside]; a.x = b.door.x; a.z = b.door.z; a.inside = null; }
      const [tx, tz] = a.route[0];
      const dx = tx - a.x, dz = tz - a.z, dist = Math.hypot(dx, dz);
      const step = (a.pursuit === 'hue' ? RUN * (0.85 + 0.2 * p.traits.courage) : a.pursuit ? HURRY : WALK * (0.9 + 0.2 * p.traits.conscientiousness)) * dt;
      if (dist <= step) {
        a.x = tx; a.z = tz; a.route.shift();
        if (!a.route.length) {
          if (a.place === 'patrol') { a.patrolIx = (a.patrolIx + 1) % PATROL.length; a.route = this._routeTo(a, PATROL[a.patrolIx], null); }
          else if (a.target?.inside) a.inside = a.target.inside;
        }
        a.speed = 0;
      } else {
        a.x += (dx / dist) * step; a.z += (dz / dist) * step;
        a.yaw = Math.atan2(dx, dz);
        a.speed = step / Math.max(1e-4, dt);
      }
    } else a.speed = 0;
    a.y = groundY(a.x, a.z);
  }

  /** A companion keeps at your shoulder, and goes in and out of doors with you. */
  _follow(p, a, dt, teleport, d) {
    const P = this.player;
    a.act = p.follow.wage ? 'in your hire, walking with you' : 'walking with you';
    a.place = 'following';
    a.route = [];
    // the unhired go home at the curfew bell, or when they have had enough of you
    if (!p.follow.wage && (this.isNight(d.h) || p.attitude < -10 || this.t - p.follow.since > 8)) {
      p.follow = null;
      a.place = null;
      this.emit({ type: 'info', text: `${p.name} leaves you: ${this.isNight(d.h) ? '"It\'s past the curfew bell. I\'m for home."' : '"I have my own work to see to."'}` });
      return;
    }
    if (P.inside) {
      if (a.inside === P.inside) { a.speed = 0; return; }
      const b = BUILDING[P.inside];
      if (a.inside) { const o = BUILDING[a.inside]; a.x = o.door.x; a.z = o.door.z; a.inside = null; }
      const dx = b.door.x - a.x, dz = b.door.z - a.z, dist = Math.hypot(dx, dz), step = Math.min(dist, 2.6 * dt);
      if (teleport || dist < 0.6) { a.x = b.door.x; a.z = b.door.z; a.inside = P.inside; a.speed = 0; return; }
      a.x += dx / dist * step; a.z += dz / dist * step; a.yaw = Math.atan2(dx, dz); a.speed = step / Math.max(1e-4, dt);
      return;
    }
    if (a.inside) { const o = BUILDING[a.inside]; a.x = o.door.x; a.z = o.door.z; a.inside = null; }
    // a place a little behind and to the side of you
    const side = p.idx % 2 ? 1 : -1;
    const tx = P.x - Math.sin(P.yaw) * 1.3 + Math.cos(P.yaw) * 0.8 * side, tz = P.z - Math.cos(P.yaw) * 1.3 - Math.sin(P.yaw) * 0.8 * side;
    const dx = tx - a.x, dz = tz - a.z, dist = Math.hypot(dx, dz);
    if (teleport || dist > 40) { a.x = tx; a.z = tz; a.speed = 0; return; }
    if (dist < 0.35) { a.speed = 0; let e = P.yaw - a.yaw; e = Math.atan2(Math.sin(e), Math.cos(e)); a.yaw += e * Math.min(1, dt * 3); return; }
    const sp = Math.min(dist > 5 ? 3.0 : dist > 1.5 ? 1.9 : 1.2, dist / Math.max(dt, 1e-4));
    a.x += dx / dist * sp * dt; a.z += dz / dist * sp * dt;
    a.yaw = Math.atan2(dx, dz); a.speed = sp;
  }

  /** Pay hired companions at dawn; the unpaid walk off. */
  _payCompanions() {
    const P = this.player;
    for (const p of this.people) {
      if (!p.follow?.wage) continue;
      if (P.money >= p.follow.wage) { P.money -= p.follow.wage; p.money += p.follow.wage; this.emit({ type: 'info', text: `You pay ${p.name} the day's ${fmtMoney(p.follow.wage)}.` }); }
      else { p.follow = null; p.attitude -= 15; p.agent.place = null; this.remember(p, { kind: 'done', text: 'did not pay my wage', weight: 6, att: -15 }); this.emit({ type: 'info', text: `${p.name} leaves your service: you could not pay the day's wage.` }); }
    }
  }

  /** Someone joins you (wage in parvi a day, 0 for a friend keeping you company). */
  join(p, wage = 0) {
    if (!p.alive || p.watch || p.role === 'burgrave') return { ok: false, why: `${p.name} has duties and cannot leave them.` };
    if (wage && this.player.money < wage) return { ok: false, why: `You cannot pay ${fmtMoney(wage)}.` };
    if (wage) { this.player.money -= wage; p.money += wage; }
    p.follow = { since: this.t, wage };
    p.override = null;
    this.remember(p, { kind: wage ? 'got' : 'met', text: wage ? `took service with them for ${fmtMoney(wage)} a day` : 'went along with them', weight: 4, att: 3 });
    return { ok: true };
  }

  dismiss(p) { if (p.follow) { p.follow = null; p.agent.place = null; } }
  companions() { return this.people.filter((p) => p.follow && p.alive); }

  /** Someone goes somewhere for a while ("meet me at the tavern"). */
  sendTo(p, place, hours = 1.5) {
    if (!PLACES[place] && !BUILDING[place]) return false;
    p.follow = null;
    p.override = { place, act: 'waiting for you', until: this.t + hours };
    return true;
  }

  // --- giving and taking --------------------------------------------------------------------------

  /** Money or a thing passes from the player to someone (they accepted it). */
  giveTo(p, { money = 0, item = null } = {}) {
    const P = this.player;
    money = Math.max(0, Math.round(money));
    if (money > P.money) return { ok: false, why: `You only have ${fmtMoney(P.money)}.` };
    if (item && !(P.inventory[item] > 0)) return { ok: false, why: `You have no ${GOODS[item]?.name.toLowerCase() ?? item}.` };
    P.money -= money; p.money += money;
    if (item) { P.inventory[item]--; p.inventory[item] = (p.inventory[item] ?? 0) + 1; }
    const what = [money ? fmtMoney(money) : '', item ? GOODS[item]?.name.toLowerCase() ?? item : ''].filter(Boolean).join(' and ');
    // a gift is worth more to the poor
    const worth = money / Math.max(12, p.money * 0.15) + (item ? (GOODS[item]?.price ?? 4) / 20 : 0);
    const att = Math.round(Math.min(15, 3 * worth));
    p.attitude = Math.min(100, p.attitude + att);
    this.remember(p, { kind: 'got', text: `gave me ${what}`, weight: Math.min(8, 2 + Math.round(worth * 2)), att });
    this.emit({ type: 'give', to: p, text: `You give ${p.name} ${what}.` });
    return { ok: true, what };
  }

  /** Money or a thing passes from someone to the player. */
  takeFrom(p, { money = 0, item = null } = {}) {
    const P = this.player;
    money = Math.max(0, Math.min(Math.round(money), p.money));
    if (item && !(p.inventory?.[item] > 0)) item = null;
    if (!money && !item) return { ok: false, why: `${p.name} has nothing like that to give.` };
    p.money -= money; P.money += money;
    if (item) { p.inventory[item]--; P.inventory[item] = (P.inventory[item] ?? 0) + 1; }
    const what = [money ? fmtMoney(money) : '', item ? GOODS[item]?.name.toLowerCase() ?? item : ''].filter(Boolean).join(' and ');
    this.remember(p, { kind: 'gave', text: `I gave them ${what}`, weight: 3 + Math.min(4, Math.round(money / 60)), att: 0 });
    this.emit({ type: 'give', from: p, text: `${p.name} gives you ${what}.` });
    return { ok: true, what };
  }

  _routeTo(a, node, spot) {
    const from = nearestNode(a.x, a.z);
    const nodes = path(from, node);
    const route = nodes.map((n) => [...NODES[n]]);
    if (spot) route.push([spot.x, spot.z]);
    return route;
  }

  // --- the player ----------------------------------------------------------------------------------

  _updatePlayer(dh, d) {
    const P = this.player;
    if (!P.alive) return;
    const sleeping = P.sleepingUntil && this.t < P.sleepingUntil;
    for (const [k, n] of Object.entries(NEEDS)) {
      let r = n.rate;
      if (sleeping) r = k === 'fatigue' ? -14 : k === 'thirst' || k === 'hunger' ? r * 0.5 : k === 'bladder' ? r * 0.4 : r;
      if (P.inArmy && k === 'fatigue' && !sleeping) r *= 1.1;
      P.needs[k] = Math.max(0, Math.min(110, P.needs[k] + r * dh));
    }
    P.drunk = Math.max(0, P.drunk - 9 * dh);
    // the body's limits
    if (P.needs.hunger >= 100) P.health -= 0.35 * dh;
    if (P.needs.thirst >= 100) P.health -= 2 * dh;
    if (P.needs.fatigue >= 100 && !sleeping) { this.emit({ type: 'faint', text: 'You can no longer keep your eyes open and fall asleep where you stand.' }); this.sleep(6, 'street'); }
    for (const k of ['bladder', 'bowels']) {
      if (P.needs[k] >= 105) {
        P.needs[k] = 0;
        P.needs.dirt = Math.min(100, P.needs.dirt + (k === 'bowels' ? 45 : 25));
        const seen = this.witnesses(P.x, P.z, P.inside).length;
        if (seen) { P.reputation -= k === 'bowels' ? 6 : 3; }
        this.emit({ type: 'accident', need: k, seen, text: k === 'bowels' ? 'You could not hold it any longer. You have soiled your hose.' : 'You could not hold it any longer and wet yourself.' });
      }
    }
    if (P.health < 100 && P.needs.hunger < 60 && P.needs.thirst < 60) P.health = Math.min(100, P.health + 2 * dh);
    if (P.health <= 0) this.die(P.needs.thirst >= 100 ? 'thirst' : P.needs.hunger >= 100 ? 'hunger' : 'wounds');
    if (sleeping) return;
    // army: pay and duties
    if (P.army) {
      const day = Math.floor(this.t / 24);
      if (P.army.paidDay !== day && d.h >= 18 && d.h < 19) {
        P.army.paidDay = day;
        const rank = ARMY_RANK[P.army.rank];
        if (P.army.absent > 1) { this.emit({ type: 'army', text: `The captain docks your pay: you were not at your post.` }); }
        else { P.money += rank.pay; this.emit({ type: 'army', text: `Pay day: ${fmtMoney(rank.pay)} from the captain's clerk.` }); }
        P.army.days++;
        P.army.absent = 0;
      }
      const duty = this.dutyNow(d);
      if (duty && !this.atPlace(duty.place) && P.army.lastCheck !== Math.floor(this.t * 2)) {
        P.army.lastCheck = Math.floor(this.t * 2);
        P.army.absent += 0.5;
      }
    }
  }

  /** What the garrison expects of you now (if you serve). */
  dutyNow(d = this.date()) {
    if (!this.player.army) return null;
    if (d.h >= 5.5 && d.h < 8) return { place: 'yard', what: 'morning drill in the castle yard' };
    if (d.h >= 8 && d.h < 12) return { place: 'gate', what: 'watch at the castle gate' };
    if (d.h >= 13 && d.h < 16) return { place: 'yard', what: 'drill and weapon work' };
    return null;
  }

  atPlace(place) {
    const P = this.player;
    const pl = PLACES[place];
    if (pl) return !P.inside && Math.hypot(P.x - pl.x, P.z - pl.z) < 9;
    return P.inside === place;
  }

  /** People who can see a spot right now: awake, close, same room or both outside. */
  witnesses(x, z, inside = null, except = null) {
    const out = [];
    for (const p of this.people) {
      if (!p.alive || p === except) continue;
      const a = p.agent;
      if (/sleep/.test(a.act) && !a.route.length) continue;
      if (inside) { if (a.inside === inside && !a.route.length) out.push(p); continue; }
      if (a.inside) continue;
      const dd = Math.hypot(a.x - x, a.z - z);
      if (dd < (this.isNight() ? 8 : 18)) out.push(p);
    }
    return out;
  }

  /** People near the player (for talking). */
  nearby(r = 2.6) {
    const P = this.player;
    return this.people.filter((p) => p.alive && (P.inside ? p.agent.inside === P.inside && !p.agent.route.length : !p.agent.inside && Math.hypot(p.agent.x - P.x, p.agent.z - P.z) < r))
      .sort((a, b) => Math.hypot(a.agent.x - P.x, a.agent.z - P.z) - Math.hypot(b.agent.x - P.x, b.agent.z - P.z));
  }

  /** The building door the player is next to, if any. */
  doorNear(r = 2.2) {
    const P = this.player;
    if (P.inside) return null;
    let best = null, bd = r;
    for (const b of BUILDINGS) {
      const d = Math.hypot(b.door.x - P.x, b.door.z - P.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // --- actions -------------------------------------------------------------------------------

  /** Whether the player may go in: houses are private, shops open by day, the castle to its people. */
  mayEnter(b) {
    const d = this.date(), P = this.player;
    const open = { tavern: d.h >= 5.5 && d.h < 22, church: true, bakery: d.h >= 5 && d.h < 16, smithy: d.h >= 5.5 && d.h < 18, butcher: d.h >= 6 && d.h < 17, workshop: d.h >= 6 && d.h < 18, bath: d.h >= 6 && d.h < 19, rychta: d.h >= 6 && d.h < 18 }[b.kind];
    if (b.id === P.home) return { ok: true };
    if (b.kind === 'hall') return P.noble || P.army ? { ok: true } : { ok: false, why: 'The gatekeeper bars the way: the hall is for the burgrave\'s household and his guests.' };
    if (b.kind === 'barracks') return P.army ? { ok: true } : { ok: false, why: 'A soldier blocks the door: the garrison\'s room is not for townsfolk. Ask the captain if you want to serve.' };
    if (b.kind === 'house' || b.kind === 'cottage') return { ok: false, private: true, why: 'This is someone\'s home. Entering uninvited is a breach of the house peace.' };
    if (open === false) return { ok: false, why: `${b.name} is shut at this hour.` };
    return { ok: true };
  }

  enter(b, force = false) {
    const m = this.mayEnter(b);
    if (!m.ok && !force) return m;
    this.player.inside = b.id;
    if (!m.ok && force && m.private) {
      const owner = this.people.find((p) => p.home === b.id && p.alive && p.agent.inside === b.id);
      this.crime('housebreaking', { victim: owner ?? null });
    }
    this.emit({ type: 'enter', building: b });
    return { ok: true };
  }

  leave() {
    const P = this.player, b = BUILDING[P.inside];
    if (!b) return;
    P.inside = null;
    P.x = b.door.x + (b.door.x - b.x) * 0.15; P.z = b.door.z + (b.door.z - b.z) * 0.15;
    P.y = groundY(P.x, P.z);
    P.yaw = Math.atan2(b.door.x - b.x, b.door.z - b.z);
    this.emit({ type: 'leave', building: b });
  }

  buy(itemId, seller = null, price = null) {
    const P = this.player, g = GOODS[itemId];
    if (!g) return { ok: false, why: 'No such thing for sale.' };
    const cost = price ?? g.price;
    if (P.money < cost) return { ok: false, why: `You need ${fmtMoney(cost)} and have ${fmtMoney(P.money)}.` };
    P.money -= cost;
    if (seller) seller.money += cost;
    if (g.kind === 'service') {
      if (itemId === 'bed') { this.emit({ type: 'info', text: 'You have paid for a place to sleep in the loft.' }); P.bedPaidUntil = this.t + 16; }
      if (itemId === 'bath') { P.needs.dirt = 0; P.health = Math.min(100, P.health + 5); this.advance(0.75); this.emit({ type: 'info', text: 'Hot water, a scrub with lye soap, a shave. You feel a new man.' }); }
    } else {
      P.inventory[itemId] = (P.inventory[itemId] ?? 0) + 1;
      if (g.kind === 'food' || g.kind === 'drink') this.consume(itemId);
    }
    this.emit({ type: 'buy', item: itemId, price: cost, seller: seller?.id });
    return { ok: true };
  }

  consume(itemId) {
    const P = this.player, g = GOODS[itemId];
    if (!P.inventory[itemId]) return false;
    P.inventory[itemId]--;
    if (g.food) P.needs.hunger = Math.max(0, P.needs.hunger - g.food);
    if (g.water) P.needs.thirst = Math.max(0, P.needs.thirst - g.water);
    if (g.drunk) P.drunk += g.drunk;
    P.needs.bladder += (g.water ?? 0) * 0.4;
    P.needs.bowels += (g.food ?? 0) * 0.15;
    const d = this.date();
    if (g.fastBreak && (d.wd === 5 || d.wd === 6)) this.emit({ type: 'info', text: 'Meat on a fast day. The priest would not like it.' });
    return true;
  }

  drinkWell() {
    if (Math.hypot(this.player.x - PLACES.well.x, this.player.z - PLACES.well.z) > 3) return false;
    this.player.needs.thirst = Math.max(0, this.player.needs.thirst - 40);
    this.player.needs.bladder += 12;
    this.emit({ type: 'info', text: 'You draw a bucket from the well and drink. The water tastes of iron and leaves.' });
    return true;
  }

  /** Relieve yourself: proper at a privy or at home; in the street it is an offence if seen. */
  relieve() {
    const P = this.player;
    const atPrivy = (!P.inside && Math.hypot(P.x - PLACES.privy.x, P.z - PLACES.privy.z) < 3) || P.inside === P.home || P.inside === 'tavern' || P.inside === 'barracks';
    const inFields = !P.inside && Math.hypot(P.x - PLACES.fields.x, P.z - PLACES.fields.z) < 25;
    P.needs.bladder = 0;
    if (P.needs.bowels > 30) P.needs.bowels = 0;
    this.advance(0.08);
    if (atPrivy || inFields) { this.emit({ type: 'info', text: atPrivy ? 'You use the privy. It is dark and it stinks, as privies do.' : 'You find a hedge at the edge of the field.' }); return; }
    const seen = this.witnesses(P.x, P.z, P.inside);
    if (seen.length) this.crime('privy', { seen });
    else this.emit({ type: 'info', text: 'Nobody saw. You were lucky.' });
  }

  sleep(hours, where = 'bed') {
    const P = this.player;
    const ok = where === 'street' || P.inside === P.home || (P.inside === 'tavern' && P.bedPaidUntil > this.t) || (P.inside === 'barracks' && P.army);
    if (!ok) return { ok: false, why: P.inside === 'tavern' ? 'Pay the innkeeper for a place in the loft first.' : 'You have nowhere to sleep here. Go home, take a bed at the tavern, or sleep in the barracks if you serve.' };
    P.sleepingUntil = this.t + hours;
    this.advance(hours);
    P.sleepingUntil = 0;
    if (where === 'street') { P.needs.dirt += 15; P.health -= 4; if (Math.random() < 0.3 && P.money > 6) { const lost = Math.floor(P.money * 0.3); P.money -= lost; this.emit({ type: 'info', text: `You wake stiff and cold. Your purse is ${fmtMoney(lost)} lighter.` }); } }
    this.emit({ type: 'sleep', hours });
    return { ok: true };
  }

  /** Let time pass (waiting, working). People are moved to where they should be. */
  advance(hours) {
    const steps = Math.ceil(hours / 0.25);
    for (let i = 0; i < steps; i++) {
      this.update(0, { skipHours: hours / steps });
      if (this.pendingStop || !this.player.alive) break;   // the watch (or death) interrupts
    }
  }

  /** A day's work for wages, where someone will hire you. */
  work(kind = 'fields') {
    const P = this.player, d = this.date();
    if (d.h < 5 || d.h > 14) return { ok: false, why: 'Nobody takes on day labourers this late. Come at dawn.' };
    if (d.wd === 0 || this.isFeast(d)) return { ok: false, why: 'No work on a Sunday or a feast day: the priest and the headman would fine whoever hired you.' };
    const hours = Math.min(17.5 - d.h, 10);
    const pay = Math.round(12 * hours / 10 * (0.8 + P.skills.labour / 200));
    this.advance(hours);
    P.money += pay;
    P.needs.dirt += 25;
    P.skills.labour = Math.min(100, P.skills.labour + 1.5);
    this.emit({ type: 'work', text: `You thresh and cart dung for ${hours.toFixed(0)} hours and are paid ${fmtMoney(pay)}.` });
    return { ok: true, pay };
  }

  // --- law and crime ------------------------------------------------------------------------------

  crime(lawId, info = {}) { return this.justice.offence(lawId, info); }

  /**
   * Settle with whoever stopped you. Small matters are settled on the spot
   * (a fine, or the night in the gate tower); serious ones go before the
   * court. choice: 'explain' | 'pay' | 'submit' | 'resist' | 'bribe'.
   */
  resolveStop(choice, bribe = 0) {
    const P = this.player, s = this.pendingStop, J = this.justice;
    if (!s) return;
    this.pendingStop = null;
    J.endHue(false);
    const open = P.crimes.filter((c) => !c.settled && (c.seen.length || c.handhafte));
    const serious = open.some((c) => c.severity >= 2);
    if (s.reason === 'curfew' && !open.length) {
      P.curfewChecked = true;
      const light = P.inventory.candle > 0;
      if (choice === 'explain' && (light || s.by.attitude > -10 || P.army)) { this.emit({ type: 'law', text: light ? `You show your light and say where you are going. ${s.by.name} waves you on.` : `${s.by.name} looks you over, tells you to get home, and lets you pass this time.` }); return; }
    }
    if (choice === 'resist') {
      P.wanted = 3;
      s.by.attitude -= 40;
      this.remember(s.by, { kind: 'done', text: 'resisted arrest', weight: 7, att: -40 });
      this.emit({ type: 'resist', by: s.by, text: `You tear free of ${s.by.name}. He goes for his weapon.` });
      return;
    }
    if (choice === 'bribe') {
      const by = s.by, max = open.reduce((m, c) => Math.max(m, c.severity), 0);
      const takes = by.watch && max < 4 && (by.traits.greed > 0.55 || by.traits.honesty < 0.38) && bribe >= 12 * (1 + max) && P.money >= bribe;
      if (takes) {
        P.money -= bribe; by.money += bribe;
        for (const c of open) if (c.severity < 4) c.settled = true;
        if (!P.crimes.some((c) => !c.settled && c.seen.length)) P.wanted = 0;
        P.curfewChecked = true;
        this.remember(by, { kind: 'got', text: `bribed me with ${fmtMoney(bribe)} to look the other way`, weight: 5, att: 4 });
        this.emit({ type: 'law', text: `${by.name} weighs the coins in his hand, looks up and down the street, and lets you go.` });
        return;
      }
      by.attitude -= 12;
      this.remember(by, { kind: 'done', text: 'tried to bribe me', weight: 5, att: -12 });
      this.emit({ type: 'law', text: `${by.name} knocks the money out of your hand. "You'll answer for that too."` });
    }
    if (serious) { J.openTrial(); return; }
    const fine = open.reduce((sum, c) => sum + (LAW[c.law].fine ?? 0), 0) + (s.reason === 'curfew' && !open.length ? LAW.curfew.fine : 0);
    if (choice === 'pay' && P.money >= fine) {
      P.money -= fine; for (const c of open) c.settled = true; P.wanted = 0;
      this.emit({ type: 'law', text: `You pay ${fmtMoney(fine)} to the rychta through ${s.by.name}. The matter is closed.` });
    } else {
      for (const c of open) c.settled = true;
      P.wanted = 0;
      P.reputation -= 3;
      this.emit({ type: 'law', text: 'You spend the night locked in the gate tower and are let out at the morning bell.' });
      const h = this.date().h;
      this.advance(h >= 5 && h < 20 ? 6 : h >= 20 ? 29 - h : 5 - h);
    }
    P.curfewChecked = true;
  }

  die(cause) {
    const P = this.player;
    if (!P.alive) return;
    P.alive = false;
    P.deathCause = cause;
    this.emit({ type: 'death', cause });
  }

  // --- the army ------------------------------------------------------------------------------------

  /** Join the garrison company: the captain decides (dialogue checks his mood); this records it. */
  enlist(rankId = 'pacholek') {
    const P = this.player;
    if (P.army) return { ok: false, why: 'You already serve.' };
    if (P.sex === 'f') return { ok: false, why: 'The captain does not take women into the company. (Women followed armies as cooks, laundresses and sutlers, but were not enlisted as soldiers.)' };
    P.army = { rank: rankId, since: this.t, days: 0, absent: 0, paidDay: Math.floor(this.t / 24) };
    P.inArmy = true;
    const r = ARMY_RANK[rankId];
    if (r.kit) for (const [slot, item] of Object.entries(r.kit)) P.dress[slot] = item;
    P.weapon = r.weapon ?? P.weapon;
    this.emit({ type: 'army', text: `You swear to serve the captain of Skalice as ${r.name.toLowerCase()} for ${fmtMoney(r.pay)} a day, bread and beer. You are issued: ${Object.values(r.kit ?? {}).join(', ')}.` });
    this.emit({ type: 'dress' });
    return { ok: true };
  }

  /** Drill raises weapon skill; enough service and skill and the captain promotes you. */
  drill(hours = 2) {
    const P = this.player;
    if (!P.army) return { ok: false, why: 'Only the garrison drills in the yard.' };
    this.advance(hours);
    const r = ARMY_RANK[P.army.rank];
    const skill = r.id === 'strelec' ? 'crossbow' : 'sword';
    P.skills[skill] = Math.min(100, P.skills[skill] + 1.2 * hours);
    P.skills[skill === 'sword' ? 'crossbow' : 'sword'] = Math.min(100, P.skills[skill === 'sword' ? 'crossbow' : 'sword'] + 0.4 * hours);
    P.needs.fatigue += 6 * hours; P.needs.thirst += 6 * hours;
    this.emit({ type: 'army', text: `You drill for ${hours} hours: ${skill === 'crossbow' ? 'spanning and loosing at the butts' : 'spear and sword against the pell and each other'}.` });
    this._promotion();
    return { ok: true };
  }

  _promotion() {
    const P = this.player;
    const i = ARMY_RANKS.findIndex((r) => r.id === P.army.rank);
    const next = ARMY_RANKS.slice(i + 1).find((r) => {
      const n = r.need ?? {};
      return (!n.noble || P.noble) && (n.sword ?? 0) <= P.skills.sword && (n.crossbow ?? 0) <= P.skills.crossbow && (n.service ?? 0) <= P.army.days && (n.renown ?? 0) <= P.renown;
    });
    if (next) {
      P.army.rank = next.id;
      if (next.kit) for (const [slot, item] of Object.entries(next.kit)) P.dress[slot] = item;
      if (next.weapon) P.weapon = next.weapon;
      this.emit({ type: 'army', text: `The captain makes you ${next.name.toLowerCase()}. Pay: ${fmtMoney(next.pay)} a day.` });
      this.emit({ type: 'dress' });
    }
  }

  // --- saving ---------------------------------------------------------------------------------

  serialize() {
    const P = this.player;
    return {
      v: 1, t: this.t, lastBell: this.lastBell,
      player: { ...P, knownNames: [...P.knownNames] },
      people: this.people.map((p) => ({ id: p.id, attitude: p.attitude, mood: p.mood, money: p.money, alive: p.alive, hurt: p.hurt, inventory: p.inventory, follow: p.follow, override: p.override, memories: serializeMemories(p), agent: { x: p.agent.x, z: p.agent.z, inside: p.agent.inside, yaw: p.agent.yaw } })),
      justice: this.justice.serialize(),
    };
  }

  static restore(o, opts = {}) {
    const sim = new LifeSim({ ...opts, start: STARTS.find((x) => x.id === o.player.start) ?? STARTS[0], name: o.player.name, sex: o.player.sex });
    sim.t = o.t; sim.lastBell = o.lastBell ?? -1; sim.lastGossip = o.t;
    Object.assign(sim.player, o.player, { knownNames: new Set(o.player.knownNames ?? []), sleepingUntil: 0, restrained: null, held: false });
    sim.player.inside = null;
    for (const q of o.people ?? []) {
      const p = sim.byId[q.id];
      if (!p) continue;
      Object.assign(p, { attitude: q.attitude, mood: q.mood, money: q.money, alive: q.alive, hurt: q.hurt ?? 0, inventory: q.inventory ?? p.inventory, follow: q.follow ?? null, override: q.override ?? null, memories: (q.memories ?? []).map((m) => ({ ...m, told: m.told ?? [] })) });
      Object.assign(p.agent, { x: q.agent.x, z: q.agent.z, inside: q.agent.inside, yaw: q.agent.yaw, route: [], place: null, pursuit: false });
      p.agent.y = groundY(p.agent.x, p.agent.z);
    }
    sim.justice.restore(o.justice ?? {});
    // you wake where you were, or at your door if you were inside somewhere
    if (o.player.inside) { const b = BUILDING[o.player.inside]; if (b) { sim.player.x = b.door.x; sim.player.z = b.door.z; } }
    sim.player.y = groundY(sim.player.x, sim.player.z);
    return sim;
  }

  /** A short text of the town's situation for prompts and the journal. */
  situation() {
    const d = this.date();
    return `${d.text}, ${d.clock}${this.isFeast(d) ? ' (feast of St Wenceslas)' : d.d === 27 && d.m === 9 ? ' (eve of the feast of St Wenceslas)' : ''}; ${this.isNight(d.h) ? 'night, after the curfew bell' : d.h < 12 ? 'morning' : d.h < 17.75 ? 'afternoon' : 'evening'}`;
  }
}

export { spotFor };
