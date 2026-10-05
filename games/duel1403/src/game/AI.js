import { Vector3 } from 'three';
import { clamp } from '../physics/math.js';

const UP = new Vector3(0, 1, 0);

/**
 * Fencing doctrines. Each opponent fights the way their kind fought:
 *  liechtenauer  takes the initiative (Vor), breaks guards with the master
 *                strikes, cuts at the openings and works the bind
 *  fiore         the same longsword/poleaxe logic, more patient, more thrusts
 *  halfsword     in harness: half-sword thrusts into the gaps, Mordschlag on
 *                the helmet, wrestling when close (Kampffechten)
 *  i33           sword and buckler: waits in a ward, binds, cuts the hands
 *  cuman         quick in and out, many cuts, keeps moving
 *  militia       keeps the spear between himself and you, thrusts
 *  brawler       closes and hammers at the head
 */
const STYLE = {
  liechtenauer: { guards: ['vomTag', 'ochsR', 'pflugR', 'alber', 'langort', 'stier', 'eber', 'luginsland'], tempo: 1.0, thrust: 0.3, counter: 0.55, measure: 0.1, footwork: 1 },
  fiore: { guards: ['donna', 'finestra', 'breve', 'dente', 'azzaDonna', 'azzaBreve', 'azzaDente', 'azzaFinestra'], tempo: 0.8, thrust: 0.5, counter: 0.45, measure: 0.15, footwork: 0.8 },
  halfsword: { guards: ['halbAchsel', 'halbOben', 'halbUnten', 'vomTag', 'pflugR'], tempo: 0.75, thrust: 0.75, counter: 0.3, measure: -0.1, footwork: 0.6, wrestle: 0.35 },
  i33: { guards: ['prima', 'secunda', 'sexta', 'langortI33', 'quarta'], tempo: 0.7, thrust: 0.25, counter: 0.5, measure: 0.15, footwork: 0.8 },
  cuman: { guards: ['ohShoulder', 'ohHigh', 'ohBreast'], tempo: 1.3, thrust: 0.1, counter: 0.25, measure: 0.25, footwork: 1.4 },
  militia: { guards: ['spearBreve', 'spearFinestra', 'spearDente'], tempo: 0.65, thrust: 0.9, counter: 0.2, measure: 0.35, footwork: 0.7 },
  brawler: { guards: ['ohShoulder', 'ohHigh', 'ohSide'], tempo: 1.1, thrust: 0.2, counter: 0.15, measure: -0.05, footwork: 0.9, wrestle: 0.15 },
};

/** How well each zone is protected against cuts / thrusts / blunt blows (0 = open). */
function protection(k, zone) {
  const L = k.profile.layersAt(zone, k.visorDown);
  let cut = 0, thrust = 0, blunt = 0;
  for (const l of L) {
    const c = l.cover;
    if (l.mat === 'plate') { cut = Math.max(cut, c); thrust = Math.max(thrust, c * Math.min(1, l.t / 1.2)); blunt = Math.max(blunt, 0.45 * c); }
    else if (l.mat === 'mail') { cut = Math.max(cut, 0.95 * c); thrust = Math.max(thrust, 0.55 * c); blunt = Math.max(blunt, 0.1); }
    else if (l.mat === 'pad') { const p = Math.min(1, l.n / 26); cut = Math.max(cut, 0.75 * p * c); thrust = Math.max(thrust, 0.4 * p * c); blunt = Math.max(blunt, 0.35 * p); }
    else if (l.mat === 'leather') { cut = Math.max(cut, 0.25 * c); thrust = Math.max(thrust, 0.15 * c); }
  }
  return { cut, thrust, blunt };
}

const TARGETS = [
  // zone, how valuable a hit there is, which blow fits
  { zone: 'face', value: 1.0, line: 'high' },
  { zone: 'skull', value: 0.8, line: 'high' },
  { zone: 'throat', value: 1.0, line: 'high' },
  { zone: 'armpit', value: 0.9, line: 'mid' },
  { zone: 'chest', value: 0.7, line: 'mid' },
  { zone: 'belly', value: 0.6, line: 'mid' },
  { zone: 'groin', value: 0.8, line: 'low' },
  { zone: 'hand', value: 0.6, line: 'hand' },
  { zone: 'forearm', value: 0.45, line: 'hand' },
  { zone: 'thigh', value: 0.45, line: 'low' },
];

export class KnightAI {
  constructor(knight, { style = 'liechtenauer', skill = 0.7, aggression = 0.6 } = {}) {
    this.k = knight;
    this.style = STYLE[style] ?? STYLE.liechtenauer;
    this.styleId = style;
    this.skill = skill;
    this.aggression = aggression;
    this.t = 0;
    this.nextGuardChange = 1 + Math.random() * 2;
    this.attackCooldown = 1.2;
    this.reactAt = null;
    this.watched = null;
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = 0;
    this.downT = 0;
    this.yielded = false;
    this.lastMsg = '';
    // Pick a starting guard from the doctrine that exists for this weapon.
    this._pickGuard(true);
  }

  _guardsAvailable() {
    const ids = this.k.guards.map((g) => g.id);
    const pref = this.style.guards.filter((g) => ids.includes(g));
    return pref.length ? pref : ids;
  }

  _pickGuard(initial = false) {
    const k = this.k, o = k.opponent;
    const list = this._guardsAvailable();
    let id = list[Math.floor(Math.random() * list.length)];
    // Liechtenauer: choose the guard that answers his (e.g. Ochs against vom Tag).
    if (!initial && o && this.skill > 0.6 && Math.random() < this.skill) {
      const og = o.guard?.id;
      if (og === 'vomTag' && list.includes('ochsR')) id = 'ochsR';
      if (og === 'alber' && list.includes('vomTag')) id = 'vomTag';
      if ((og === 'ochsR' || og === 'ochsL') && list.includes('pflugR')) id = 'pflugR';
    }
    k.setGuardById(id);
  }

  /** Zones worth hitting on him with this weapon, best first. */
  _chooseTarget() {
    const k = this.k, o = k.opponent;
    const W = k.weapon.def;
    const canThrust = W.damage.point > 0.6 && (this.style.thrust > 0.2 || k.mode === 'half');
    const blunt = W.damage.blunt > 0.8;
    let best = null;
    for (const T of TARGETS) {
      const p = protection(o, T.zone);
      let score;
      let kind;
      const cutScore = (1 - p.cut) * W.damage.edge;
      const thrustScore = canThrust ? (1 - p.thrust) * W.damage.point * (0.6 + 0.6 * this.skill) * (0.5 + this.style.thrust) : 0;
      const bluntScore = blunt ? (T.zone === 'skull' || T.zone === 'face' ? 0.9 : 0.4) * (1 - p.blunt) : 0;
      score = Math.max(cutScore, thrustScore, bluntScore);
      kind = score === thrustScore ? 'thrust' : score === bluntScore ? 'blunt' : 'cut';
      score *= T.value * (0.75 + 0.5 * Math.random());
      // Precise targets need skill.
      if (T.zone === 'armpit' || T.zone === 'face' || T.zone === 'throat' || T.zone === 'hand') score *= 0.4 + 0.6 * this.skill;
      if (!best || score > best.score) best = { ...T, score, kind };
    }
    return best;
  }

  _targetPoint(zone) {
    const o = this.k.opponent;
    const B = o.b;
    const out = new Vector3();
    const fwd = new Vector3().subVectors(this.k.center, o.center).setY(0).normalize();   // his front faces me
    const left = new Vector3(fwd.z, 0, -fwd.x);
    const side = Math.random() < 0.5 ? 1 : -1;
    switch (zone) {
      case 'face': return out.copy(B.head.pos).addScaledVector(fwd, 0.06).addScaledVector(UP, -0.01);
      case 'skull': return out.copy(B.head.pos).addScaledVector(UP, 0.06);
      case 'throat': return out.copy(B.head.pos).addScaledVector(UP, -0.12).addScaledVector(fwd, 0.04);
      case 'armpit': return out.copy(B.chest.pos).addScaledVector(left, side * 0.15).addScaledVector(UP, 0.04).addScaledVector(fwd, 0.04);
      case 'chest': return out.copy(B.chest.pos).addScaledVector(fwd, 0.08);
      case 'belly': return out.copy(B.abdomen.pos).addScaledVector(fwd, 0.08);
      case 'groin': return out.copy(B.pelvis.pos).addScaledVector(fwd, 0.1).addScaledVector(UP, -0.06);
      case 'hand': return o.ragdoll.bodies.forearmR.localToWorld(o.ragdoll.bones.armR.lowerEnd.clone(), out);
      case 'forearm': return out.copy(B.forearmR.pos);
      case 'thigh': return out.copy(side > 0 ? B.thighL.pos : B.thighR.pos).addScaledVector(fwd, 0.06);
      default: return out.copy(B.chest.pos);
    }
  }

  _attack() {
    const k = this.k;
    const T = this._chooseTarget();
    if (!T) return false;
    const aim = this._targetPoint(T.zone);
    // Aim error: less skilled fighters miss the small targets.
    const err = (1 - this.skill) * 0.12 * (1.4 - k.vision * 0.4);
    aim.x += (Math.random() - 0.5) * err; aim.y += (Math.random() - 0.5) * err; aim.z += (Math.random() - 0.5) * err;
    let a;
    if (T.kind === 'thrust') {
      if (k.weaponId === 'longsword' && k.opponent.profile.total > 15 && k.mode !== 'half' && this.styleId === 'halfsword') k.toggleMode();
      a = k.thrust(aim);
    } else {
      if (k.mode === 'half' && T.kind !== 'blunt') {
        // From the half-sword, a swing is the Mordschlag — good on a helmet.
        if (T.zone === 'skull' || T.zone === 'face') a = k.swipe(-0.4, -1, k.opponent.b.head.pos.clone());
        else a = k.thrust(aim);
      } else {
        let dx, dy;
        if (T.line === 'high') { const r = Math.random(); [dx, dy] = r < 0.45 ? [-1, -1] : r < 0.7 ? [0, -1] : r < 0.85 ? [-0.27, -1] : [1, -1]; }
        else if (T.line === 'hand') { [dx, dy] = Math.random() < 0.6 ? [-1, -0.9] : [-1, 0]; }
        else if (T.line === 'mid') { [dx, dy] = Math.random() < 0.5 ? [-1, 0] : [1, 0]; }
        else { [dx, dy] = Math.random() < 0.5 ? [-1, 1] : [1, 1]; }
        a = k.swipe(dx, dy, aim, T.zone === 'hand' ? 'hand' : null);
      }
    }
    return !!a;
  }

  update(dt) {
    const k = this.k, o = k.opponent;
    this.t += dt;
    if (!o) return;
    if (k.state === 'down') {
      this.downT += dt;
      if (k.canGetUp() && this.downT > 1.2 + Math.random()) { k.startGetUp(); this.downT = 0; }
      return;
    }
    if (!k.canAct) return;
    // A beaten man asks for mercy.
    if (!this.yielded && (k.blood < 3.4 || (k.limb.armR < 0.25 && k.limb.armL < 0.25) || (!k.armed && o.armed && k.blood < 4.5))) {
      this.yielded = true;
      k.yielded = true;
      return;
    }
    if (o.isDown) {
      // Stand over him: the fight ends when he cannot rise (the judges call it).
      k.intent.moveX = 0;
      k.intent.moveY = 0;
      k.setParry(false);
      return;
    }

    const d = Math.hypot(o.center.x - k.center.x, o.center.z - k.center.z);
    const W = k.weapon;
    const reach = 0.75 * k.scale + (W.tipY - (W.gripY.R ?? W.grips.main)) + 0.15;
    // Zufechten: wait just out of his reach (and ours), so that every blow
    // must be made with a step — the "wide measure" of the German masters,
    // about a fathom from the hands (Meyer 1570). Close fighters (half-sword,
    // dagger, the brawler) want the bind and grappling distance instead.
    const closeFighter = this.styleId === 'halfsword' || this.styleId === 'brawler' || k.weaponId === 'dagger';
    const oReach = 0.75 * o.scale + (o.weapon.tipY - (o.weapon.gripY.R ?? o.weapon.grips.main)) + 0.15;
    const outOfReach = Math.max(reach, oReach) + 0.35;
    const want = (closeFighter ? reach : outOfReach) + this.style.measure + (k.stamina < 35 ? 0.4 : 0);
    const stepReach = reach + 0.8 * k.scale;   // what one passing step brings into range

    // --- defence: read his blow --------------------------------------------------
    const oa = o.attack;
    if (oa && oa !== this.watched && (oa.phase === 'prep' || oa.phase === 'strike')) {
      this.watched = oa;
      const reaction = (0.34 - 0.2 * this.skill) * (1.3 - 0.3 * k.vision) + Math.random() * 0.08;
      this.reactAt = this.t + reaction;
      this.response = null;
    }
    if (this.reactAt !== null && this.t >= this.reactAt) {
      this.reactAt = null;
      const roll = Math.random();
      if (!k.attack && k.armed && roll < 0.55 + 0.4 * this.skill) {
        // Versetzen: cover the line; the skilled ones answer with a blow.
        if (Math.random() < this.style.counter * this.skill && d < reach + 0.3) this.response = 'counter';
        else this.response = 'parry';
      } else if (roll < 0.9) this.response = 'void';
    }
    if (this.response === 'parry') {
      k.setParry(true);
      if (!oa || oa.phase === 'recover' || oa.done) { k.setParry(false); this.response = null; this.attackCooldown = Math.min(this.attackCooldown, 0.15 + 0.3 * (1 - this.skill)); }
    } else if (this.response === 'counter') {
      this._attack();
      this.response = null;
    } else {
      k.setParry(false);
    }

    // --- footwork ---------------------------------------------------------------------
    let my = 0, mx = 0;
    const err = d - want;
    if (this.response === 'void') { my = -1; if (!oa || oa.phase === 'recover') this.response = null; }
    else if (k.attack && k.attack.phase !== 'recover') my = 0.3;
    else if (!closeFighter && err < -0.25 && (!this.pressT || this.pressT <= 0)) my = -1;   // Abziehen: step back out of measure after the exchange
    else if (err > 0.35) my = 1;
    else if (err > 0.08) my = 0.5;
    else if (err < -0.35) my = -0.8;
    this.pressT = (this.pressT ?? 0) - dt;
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = 1 + Math.random() * 2.5; if (Math.random() < 0.35) this.strafe = 0; }
    mx = this.strafe * 0.45 * this.style.footwork;
    // Keep off the barrier.
    const r = Math.hypot(k.center.x, k.center.z);
    if (r > 4.2) { my += 0.4; mx *= 0.3; }
    k.intent.moveX = mx;
    k.intent.moveY = clamp(my, -1, 1);

    // --- visor: lower it to fight, lift it to breathe ------------------------------------
    if (k.profile.hasVisor) {
      if (!k.visorDown && d < want + 1.2) k.toggleVisor();
      else if (k.visorDown && d > want + 2.2 && k.stamina < 40) k.toggleVisor();
    }

    // --- guards ---------------------------------------------------------------------------
    this.nextGuardChange -= dt;
    if (this.nextGuardChange <= 0 && !k.attack && !k.parrying) {
      this._pickGuard();
      this.nextGuardChange = 2 + Math.random() * 4 / this.style.tempo;
    }
    // Armoured fight: take the half-sword when close.
    if (this.styleId === 'halfsword' && k.weaponId === 'longsword') {
      const wantHalf = d < reach + 0.4 && o.profile.total > 15;
      if (wantHalf !== (k.mode === 'half') && !k.attack) k.toggleMode();
    }

    // --- attack -------------------------------------------------------------------------
    this.attackCooldown -= dt;
    // Attack from wide measure with a step, or when he has come too close.
    const inMeasure = d < stepReach && (closeFighter || d > reach - 0.65);
    const opening = !o.attack || o.attack.phase === 'recover' || o.stun > 0.4 || o.stamina < 20;
    if (this.attackCooldown <= 0 && inMeasure && !k.attack && k.armed && k.stamina > 15 && this.response !== 'parry') {
      const p = (0.35 + 0.9 * this.aggression) * this.style.tempo * (opening ? 1.5 : 0.6) * (0.5 + 0.5 * k.stamina / 100);
      if (Math.random() < p * dt * 3) {
        if (this.style.wrestle && d < 0.95 && Math.random() < this.style.wrestle) k.shove();
        else this._attack();
        this.attackCooldown = (0.45 + Math.random() * 0.9) / this.style.tempo;
        // stay in to follow up (Nachreisen) for a moment before withdrawing
        this.pressT = 0.6 * this.aggression;
      }
    }
  }
}
