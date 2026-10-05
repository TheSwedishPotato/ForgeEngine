import { Vector3, Quaternion } from 'three';
import { clamp } from '../physics/math.js';

/**
 * What a blow does, from the physics.
 *
 * Every contact between a weapon and a body is measured by the solver: the
 * normal impulse J and the closing speed v give the energy delivered,
 * E ≈ ½·J·v. The weapon's own motion at the contact point says whether it
 * arrived edge-first (a cut), point-first (a thrust) or flat / with a blunt
 * head. The contact point on the body picks the zone, and the zone's armour
 * layers, outermost first, decide what gets through:
 *
 *  plate   stops cuts (the energy that is not glanced away arrives as a
 *          blow); a point only goes through if E > 40·t^1.7 J (t in mm) —
 *          beyond a hand-driven sword on 2 mm, within reach of a hammer's
 *          beak or a spike on thin limb plate
 *  mail    stops cuts; a narrow point splits riveted rings above ~70 J
 *  padding absorbs ≈ 0.43·n^1.89 J of a cut (80 J at 16 layers, 200 J at
 *          26, Williams 2003) and ~60 % of that against a point
 *
 * What remains cuts or pierces (bleeding by zone, limb function lost), and
 * the blunt part bruises, breaks bones or concusses.
 */

const _p = new Vector3(), _l = new Vector3(), _v = new Vector3(), _r = new Vector3();
const _ax = new Vector3(), _ex = new Vector3(), _fx = new Vector3(), _qi = new Quaternion();

const ZONE_NAMES = {
  skull: 'helmet/skull', face: 'face', nape: 'back of the neck', throat: 'throat',
  chest: 'chest', back: 'back', armpit: 'armpit', belly: 'belly', loins: 'loins', groin: 'groin', hips: 'hip',
  shoulder: 'shoulder', upperArm: 'upper arm', innerArm: 'inside of the arm', elbow: 'elbow', elbowInner: 'bend of the elbow',
  forearm: 'forearm', hand: 'hand', palm: 'palm',
  thigh: 'thigh', thighBack: 'back of the thigh', knee: 'knee', kneeBack: 'hollow of the knee', shin: 'shin', calf: 'calf', foot: 'foot',
};

// Bleeding (litres per minute for a severity-1 wound) and how vital a zone is.
const ZONE = {
  skull: { bleed: 0.25, vital: 'brain' }, face: { bleed: 0.4, vital: 'brain' }, nape: { bleed: 0.5, vital: 'spine' },
  throat: { bleed: 4.5, vital: 'throat', arterial: true },
  chest: { bleed: 1.2, vital: 'heart' }, back: { bleed: 0.8, vital: 'lung' }, armpit: { bleed: 3.0, arterial: true },
  belly: { bleed: 0.9, vital: 'gut' }, loins: { bleed: 0.9, vital: 'kidney' }, groin: { bleed: 3.0, arterial: true }, hips: { bleed: 0.5 },
  shoulder: { bleed: 0.5, limb: 'arm' }, upperArm: { bleed: 0.6, limb: 'arm' }, innerArm: { bleed: 1.8, limb: 'arm', arterial: true },
  elbow: { bleed: 0.3, limb: 'arm', joint: true }, elbowInner: { bleed: 1.3, limb: 'arm', joint: true },
  forearm: { bleed: 0.5, limb: 'arm' }, hand: { bleed: 0.3, limb: 'arm', hand: true }, palm: { bleed: 0.4, limb: 'arm', hand: true },
  thigh: { bleed: 1.0, limb: 'leg' }, thighBack: { bleed: 1.1, limb: 'leg' }, knee: { bleed: 0.3, limb: 'leg', joint: true },
  kneeBack: { bleed: 1.4, limb: 'leg', joint: true, arterial: true }, shin: { bleed: 0.3, limb: 'leg' }, calf: { bleed: 0.6, limb: 'leg' }, foot: { bleed: 0.3, limb: 'leg' },
};

const MAT_NAMES = { plate: 'plate', mail: 'mail', pad: 'padding', leather: 'leather', cloth: 'cloth' };

export const padCutAbsorb = (n) => 0.43 * Math.pow(n, 1.89);
export const platePierce = (t) => 40 * Math.pow(t, 1.7);

export class DamageModel {
  constructor(sim) {
    this.sim = sim;
    this.episodes = new Map();
    this.events = [];
    this.listeners = [];
    this.rng = Math.random;
  }

  on(fn) {
    this.listeners.push(fn);
  }

  emit(e) {
    this.events.push(e);
    for (const fn of this.listeners) fn(e);
  }

  /** Call after each world step. */
  process() {
    const sim = this.sim;
    const now = sim.time;
    for (const imp of sim.world.impacts) {
      const A = imp.shapeA.userData, B = imp.shapeB.userData;
      if (A.fighter === undefined || B.fighter === undefined) {
        // Weapon or body on the ground.
        if ((A.weapon || B.weapon) && imp.isNew && imp.approachSpeed > 2) this.emit({ type: 'ground', point: imp.point.clone(), speed: imp.approachSpeed });
        continue;
      }
      if (A.fighter === B.fighter) continue;
      if (A.weapon && B.weapon) {
        this._weaponContact(imp, A, B, now);
        continue;
      }
      if (!A.weapon && !B.weapon) continue;
      const wShape = A.weapon ? imp.shapeA : imp.shapeB;
      const bShape = A.weapon ? imp.shapeB : imp.shapeA;
      // One blow = one contact episode: sum the impulse over its first
      // three frames (~50 ms), then judge it once.
      const key = wShape.body.id + ':' + bShape.body.id + ':' + (bShape.userData.part ?? '');
      let ep = this.episodes.get(key);
      if (!ep || now - ep.last > 0.15) {
        ep = { start: now, last: now, J: 0, work: 0, v: 0, point: imp.point.clone(), normal: new Vector3(), wShape, bShape, evaluated: false, frames: 0 };
        ep.preV = this._preVelocity(wShape, imp.point, new Vector3());
        this.episodes.set(key, ep);
      }
      ep.last = now;
      if (ep.evaluated) continue;
      ep.J += imp.impulse + imp.impulseT;
      ep.work += imp.work;
      ep.v = Math.max(ep.v, imp.approachSpeed);
      ep.frames++;
      // normal pointing from the weapon into the body
      ep.normal.addScaledVector(imp.normal, (A.weapon ? -1 : 1) * imp.impulse);
      if (ep.frames >= 3) {
        ep.evaluated = true;
        this._evaluate(ep);
      }
    }
    for (const [key, ep] of this.episodes) {
      // Contact ended before three frames: judge what we have.
      if (!ep.evaluated && ep.last < now) {
        ep.evaluated = true;
        this._evaluate(ep);
      }
      if (now - ep.last > 0.4) this.episodes.delete(key);
    }
  }

  _preVelocity(shape, point, out) {
    const b = shape.body;
    const pre = b.userData.pre;
    if (!pre) return b.velocityAt(point, out);
    _r.subVectors(point, pre.pos);
    return out.crossVectors(pre.omega, _r).add(pre.vel);
  }

  _weaponContact(imp, A, B, now) {
    const sim = this.sim;
    const ka = sim.knights[A.fighter], kb = sim.knights[B.fighter];
    ka.bound = 0.25; kb.bound = 0.25;
    if (!imp.isNew) return;
    const E = 0.5 * imp.impulse * imp.approachSpeed;
    for (const [att, def] of [[ka, kb], [kb, ka]]) {
      if (att.attack && att.attack.striking && !att.attack.hit && !att.attack.blocked) {
        att.attack.blocked = true;
        if (def.parrying || (def.attack && def.attack.striking)) {
          def.stats.parries++;
          this.emit({ type: 'parry', attacker: att, defender: def, blow: att.attack.name, point: imp.point.clone(), energy: E, speed: imp.approachSpeed, buckler: A.weaponPart === 'buckler' || B.weaponPart === 'buckler' });
          return;
        }
      }
    }
    this.emit({ type: 'clash', point: imp.point.clone(), energy: E, speed: imp.approachSpeed, a: ka, b: kb });
  }

  _evaluate(ep) {
    const sim = this.sim;
    const wud = ep.wShape.userData, bud = ep.bShape.userData;
    const att = sim.knights[wud.fighter], def = sim.knights[bud.fighter];
    if (!att || !def || def.state === 'dead') return;
    const v = Math.max(ep.v, ep.preV.length() * 0.5);
    // Energy the contact actually absorbed (normal compression + the edge
    // dragging through), as measured by the solver.
    const E = ep.work;
    if (E < 2 || v < 0.6) return;
    if (ep.normal.lengthSq() > 0) ep.normal.normalize();

    // ---- how did the weapon arrive? ----------------------------------------
    const W = att.weapon;
    const wb = W.body;
    const pre = wb.userData.pre;
    const q = pre ? pre.q : wb.q;
    _ax.set(0, 1, 0).applyQuaternion(q);     // blade / haft axis
    _ex.set(1, 0, 0).applyQuaternion(q);     // true edge direction
    _fx.set(0, 0, 1).applyQuaternion(q);     // flat
    const vel = ep.preV;
    const speed = vel.length() || 1;
    const vA = vel.dot(_ax), vE = vel.dot(_ex), vF = vel.dot(_fx);
    // Contact point along the weapon (hilt frame y).
    _qi.copy(q).invert();
    const pos = pre ? pre.pos : wb.pos;
    _l.subVectors(ep.point, pos).applyQuaternion(_qi);
    const yLocal = _l.y + W.com.y;
    const part = wud.weaponPart;
    const dmg = W.def.damage;
    let type = 'blunt', sharp = 0, pointF = 0, conc = 0.5;
    if (part === 'blade') {
      const nearTip = yLocal > W.tipY - 0.07;
      if (nearTip && vA > 0.55 * speed) { type = 'thrust'; pointF = dmg.point; }
      else if (Math.abs(vE) > 1.15 * Math.abs(vF)) {
        const blade = W.def.parts.find((p) => p.kind === 'blade');
        const backEdge = vE < 0 && blade.edges === 1 && !(blade.clip && yLocal > W.tipY - blade.clip);
        if (backEdge) { type = 'blunt'; conc = 0.45; }
        else { type = 'cut'; sharp = dmg.edge * clamp((Math.abs(vE) / speed - 0.35) / 0.5, 0.25, 1); }
      } else { type = 'blunt'; conc = 0.4; }
    } else if (part === 'spike' || part === 'butt') {
      const along = part === 'butt' ? -vA : vA;
      if (along > 0.55 * speed) { type = 'thrust'; pointF = part === 'butt' ? 0.7 : 1; } else { type = 'blunt'; conc = 0.5; }
    } else if (part === 'beak') {
      if (vE * (wud.faceX ?? 1) > 0.5 * speed) { type = 'thrust'; pointF = 1; } else { type = 'blunt'; conc = 0.5; }
    } else if (part === 'axe') {
      if (vE > 0.5 * speed) { type = 'cut'; sharp = dmg.edge; } else { type = 'blunt'; conc = 0.6; }
    } else if (part === 'hammer') { type = 'blunt'; conc = 0.85; }
    else if (part === 'flanges') { type = 'blunt'; conc = 0.8; }
    else if (part === 'pommel' || part === 'cross') { type = 'blunt'; conc = 0.7; }
    else { type = 'blunt'; conc = 0.4; }

    // ---- where? -------------------------------------------------------------
    const seg = def.b[bud.segment];
    const zone = this._zone(def, bud, seg, ep.point, ep.normal, att);
    const side = /L$/.test(bud.segment) ? 'left' : /R$/.test(bud.segment) ? 'right' : '';
    const layersAll = def.profile.layersAt(zone.zone, def.visorDown);

    // ---- through the layers --------------------------------------------------------
    let e = E;                // energy still carried by the edge / point
    let blunt = 0;            // energy arriving as a blow
    const met = [];
    let stoppedBy = null;
    let glanced = false;
    for (const L of layersAll) {
      if (L.cover < 1 && this.rng() > L.cover) continue;
      if (L.visor && zone.sight && type === 'thrust' && W.def.parts.some((p) => p.kind === 'blade' ? p.w1 < 0.015 : p.sub === 'spike') && this.rng() < 0.16) {
        met.push('the sight of the visor');
        continue;
      }
      met.push(MAT_NAMES[L.mat]);
      if (type === 'cut') {
        if (L.mat === 'plate') {
          glanced = true;
          blunt += e * 0.35; e = 0; stoppedBy = L; break;
        } else if (L.mat === 'mail') {
          blunt += e * 0.7; e = 0; stoppedBy = L; break;
        } else {
          const ab = L.mat === 'pad' ? padCutAbsorb(L.n) : L.mat === 'leather' ? 15 : 3;
          if (e <= ab) { blunt += e * 0.25; e = 0; stoppedBy = L; break; }
          e -= ab;
        }
      } else if (type === 'thrust') {
        const angle = Math.abs(ep.normal.dot(_ax));      // 1 = square on
        if (L.mat === 'plate') {
          const need = platePierce(L.t) / Math.max(0.3, pointF);
          if (angle < 0.6 || e * angle < need) {
            glanced = angle < 0.6;
            blunt += e * 0.3; e = 0; stoppedBy = L; break;
          }
          e -= need;
        } else if (L.mat === 'mail') {
          const need = 70 / Math.max(0.3, pointF);
          if (e < need) { blunt += e * 0.6; e = 0; stoppedBy = L; break; }
          e -= need;
        } else {
          const ab = (L.mat === 'pad' ? padCutAbsorb(L.n) * 0.6 : L.mat === 'leather' ? 10 : 2);
          if (e <= ab) { blunt += e * 0.2; e = 0; stoppedBy = L; break; }
          e -= ab;
        }
      } else {
        // Blunt: plate spreads it, padding soaks some, mail barely helps.
        if (L.mat === 'plate') e *= clamp(0.38 + 0.4 * conc - 0.04 * L.t, 0.25, 0.8);
        else if (L.mat === 'mail') e *= 0.92;
        else if (L.mat === 'pad') e *= 1 - Math.min(0.55, L.n * 0.018);
        else if (L.mat === 'leather') e *= 0.92;
      }
    }
    if (type === 'blunt') { blunt = e; e = 0; }

    // ---- what it does to him -------------------------------------------------------------
    const Z = ZONE[zone.zone] ?? { bleed: 0.5 };
    const res = {
      type: 'hit', attacker: att, defender: def, blow: att.attack?.name ?? (type === 'thrust' ? 'Thrust' : 'Blow'),
      zone: zone.zone, zoneName: ZONE_NAMES[zone.zone], side, kind: type, energy: E, sharp: e, blunt,
      layers: met, stoppedBy: stoppedBy ? MAT_NAMES[stoppedBy.mat] : null,
      stopItem: stoppedBy ? (stoppedBy.item.slot === 'head' && stoppedBy.mat === 'mail' && zone.zone === 'throat' && stoppedBy.item.id !== 'mailCoif' ? 'mail aventail' : stoppedBy.item.name) : null, glanced,
      point: ep.point.clone(), speed: v, severity: 0, wound: null, fatal: false, part,
    };
    if (e > 0) {
      const sev = type === 'thrust' ? clamp(e / 38, 0, 2) : clamp(e / 55, 0, 2) * (0.5 + 0.5 * sharp);
      res.severity = sev;
      const wound = { zone: zone.zone, side, kind: type === 'thrust' ? 'stab' : 'cut', severity: sev, bleed: Z.bleed * sev * (type === 'thrust' ? 0.9 : 1), arterial: false, t: sim.time };
      if (Z.arterial && sev > 0.5) { wound.arterial = true; wound.bleed *= 1.6; }
      // Vital organs.
      if (type === 'thrust') {
        if ((zone.zone === 'face' && e > 22) || (zone.zone === 'skull' && e > 45)) { res.fatal = true; this._fatal(def, 0.2, 'thrust through the ' + (zone.sight ? 'visor' : 'face')); }
        else if (zone.zone === 'throat' && sev > 0.35) { wound.arterial = true; wound.bleed = Math.max(wound.bleed, 5); res.fatal = sev > 0.9; if (res.fatal) this._fatal(def, 2.5, 'thrust through the throat'); }
        else if (zone.zone === 'chest' && sev > 0.8) { wound.bleed = Math.max(wound.bleed, 2.6); res.fatal = sev > 1.3; if (res.fatal) this._fatal(def, 4, 'thrust to the heart'); }
        else if ((zone.zone === 'armpit' || zone.zone === 'groin') && sev > 0.5) { wound.arterial = true; wound.bleed = Math.max(wound.bleed, 3.2); }
      } else if (zone.zone === 'throat' && sev > 0.7) { wound.arterial = true; wound.bleed = Math.max(wound.bleed, 5); }
      else if ((zone.zone === 'skull' || zone.zone === 'face') && sev > 1.2) { def.stun += 0.8; }
      def.wounds.push(wound);
      def.bleed = def.wounds.reduce((s, w) => s + w.bleed, 0);
      def.pain = Math.min(1.5, def.pain + 0.25 * sev);
      def.stamina = Math.max(0, def.stamina - 10 * sev);
      if (Z.limb) {
        const limb = Z.limb + (side === 'left' ? 'L' : 'R');
        const k = Z.hand ? 0.85 : Z.joint ? 0.75 : 0.55;
        def.impairLimb(limb, sev * k);
      }
      res.wound = wound;
      def.stats.wounds++;
    }
    if (blunt > 2) {
      this._blunt(def, zone.zone, side, blunt, res);
    }
    def.flinch = Math.min(1, def.flinch + clamp(E / 120, 0, 0.8));
    def.lastHitTime = sim.time;
    att.stats.hits += res.severity > 0.15 || res.concussion > 0.15 ? 1 : 0;
    // One blow can touch several parts as the blade carries on (shoulder, then
    // arm). The first contact is the blow; the rest are its follow-through,
    // logged only if they wound.
    if (att.attack) {
      if (!att.attack.hit) { att.attack.hit = res; att.attack.hitT = att.attack.t; }
      else res.followUp = true;
    } else {
      const lb = this.lastBlow?.get(att);
      if (lb && sim.time - lb < 0.3) res.followUp = true;
    }
    (this.lastBlow ??= new Map()).set(att, sim.time);
    res.text = describe(res);
    this.emit(res);
  }

  _blunt(def, zone, side, B, res) {
    const head = zone === 'skull' || zone === 'face' || zone === 'nape';
    if (head) {
      const c = B / 42;
      def.stun += c;
      res.concussion = c;
      if (B > 75 && !def.profile.layersAt(zone, def.visorDown).some((l) => l.mat === 'plate')) {
        res.fracture = 'skull';
        this._fatal(def, 3, 'skull broken');
        res.fatal = true;
      }
    } else if (zone === 'throat') {
      def.stun += B / 60;
      res.concussion = B / 60;
    } else if (['chest', 'back', 'belly', 'loins', 'armpit', 'hips', 'groin'].includes(zone)) {
      def.stamina = Math.max(0, def.stamina - B * 0.35);
      def.pain = Math.min(1.5, def.pain + B / 250);
      if (B > 55 && (zone === 'chest' || zone === 'back')) {
        res.fracture = 'ribs';
        def.wounds.push({ zone, side, kind: 'broken ribs', severity: 0.6, bleed: 0, t: this.sim.time });
      }
    } else {
      const Z = ZONE[zone];
      if (Z?.limb) {
        const limb = Z.limb + (side === 'left' ? 'L' : 'R');
        const brk = Z.hand ? 32 : Z.joint ? 45 : 55;
        if (B > brk) {
          res.fracture = Z.hand ? 'hand' : Z.limb === 'arm' ? 'arm' : 'leg';
          def.impairLimb(limb, 0.7);
          def.wounds.push({ zone, side, kind: 'broken ' + (Z.hand ? 'hand' : Z.joint ? (Z.limb === 'arm' ? 'elbow' : 'knee') : Z.limb), severity: 0.8, bleed: 0, t: this.sim.time });
          def.pain = Math.min(1.5, def.pain + 0.4);
        } else {
          def.impairLimb(limb, B / 220, false);
        }
      }
    }
  }

  _fatal(def, seconds, cause) {
    if (!def.fatal || def.fatal.t > seconds) def.fatal = { t: seconds, cause };
    if (seconds < 0.5) def.collapse(cause);
  }

  /** Which zone a contact point is in, from the segment's local frame. */
  _zone(def, bud, body, point, normal, att) {
    const s = def.scale;
    _l.subVectors(point, body.pos).applyQuaternion(_qi.copy(body.q).invert());
    const x = _l.x, y = _l.y, z = _l.z;
    const seg = bud.segType;
    const sideSign = /L$/.test(bud.segment) ? 1 : -1;
    let zone = 'chest', sight = false;
    switch (seg) {
      case 'head':
        if (bud.part === 'neck' || y < -0.085 * s) zone = z > -0.015 * s ? 'throat' : 'nape';
        else if (z > 0.035 * s && y < 0.06 * s) { zone = 'face'; sight = Math.abs(y - 0.0) < 0.03 * s; }
        else if (z < -0.035 * s && y < 0.0) zone = 'nape';
        else zone = 'skull';
        break;
      case 'chest':
        if (Math.abs(x) > 0.105 * s && y > -0.05 * s && y < 0.115 * s && Math.abs(z) < 0.07 * s) zone = 'armpit';
        else zone = z >= 0 ? 'chest' : 'back';
        break;
      case 'abdomen':
        zone = z >= 0 ? 'belly' : 'loins';
        break;
      case 'pelvis':
        zone = z > 0.03 * s && Math.abs(x) < 0.08 * s && y < 0.0 ? 'groin' : 'hips';
        break;
      case 'upperArm':
        if (y > 0.09 * s) zone = 'shoulder';
        else if (x * sideSign < -0.02 * s) zone = 'innerArm';
        else zone = 'upperArm';
        break;
      case 'forearm':
        if (bud.part === 'hand') zone = x * sideSign < -0.005 * s ? 'palm' : 'hand';
        else if (y > 0.07 * s) zone = z < 0 ? 'elbow' : 'elbowInner';
        else zone = 'forearm';
        break;
      case 'thigh':
        zone = z >= 0 ? 'thigh' : 'thighBack';
        break;
      case 'shin':
        if (y > 0.13 * s) zone = z >= 0 ? 'knee' : 'kneeBack';
        else zone = z >= 0 ? 'shin' : 'calf';
        break;
      case 'foot':
        zone = 'foot';
        break;
      default: break;
    }
    void normal; void att;
    return { zone, sight };
  }
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A one-line account of a blow for the fight log. */
export function describe(r) {
  const where = (r.side ? r.side + ' ' : '') + r.zoneName;
  const blow = r.blow;
  if (r.fatal) return `${blow} — ${where}: ${r.fracture === 'skull' ? 'the skull breaks' : 'a mortal wound'}.`;
  if (r.wound) {
    const sev = r.severity > 1.1 ? 'deep' : r.severity > 0.5 ? 'serious' : 'light';
    const through = r.layers.length ? ` through the ${r.layers.filter((x) => x !== 'cloth').join(' and ') || 'cloth'}` : '';
    const what = r.wound.kind === 'stab' ? 'stab' : 'cut';
    return `${blow} — ${where}: ${sev} ${what}${through}${r.wound.arterial ? ', bleeding hard' : ''}.`;
  }
  if (r.fracture) return `${blow} — ${where}: ${r.fracture === 'ribs' ? 'ribs crack' : 'the bone breaks'} under the ${r.stopItem ? r.stopItem.toLowerCase() : 'blow'}.`;
  if (r.stoppedBy) {
    const conc = r.concussion > 0.45 ? ', the helmet rings' : '';
    const how = r.glanced ? 'glances off' : r.kind === 'cut' ? 'is stopped by' : r.kind === 'thrust' ? 'fails to pierce' : 'is dulled by';
    return `${blow} — ${where}: ${how} the ${r.stopItem ? r.stopItem.toLowerCase() : r.stoppedBy}${conc}.`;
  }
  if (r.concussion > 0.3) return `${blow} — ${where}: a stunning blow.`;
  return `${cap(blow)} — ${where}: a bruising blow.`;
}
