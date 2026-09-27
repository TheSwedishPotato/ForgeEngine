import { Vector3 } from 'three';

const _v = new Vector3(), _l = new Vector3();

const HEAD_PARTS = new Set(['skull', 'jaw']);
const BODY_PARTS = new Set(['chest', 'abdomen', 'pelvis']);
const GUARD_PARTS = new Set(['glove', 'forearm', 'upperArm']);

/**
 * Injury model driven by what the physics actually did to the target.
 *
 * Head: brain injury correlates with the head's change in rotational and
 * linear velocity (Holbourn; King et al. 2003; Walilko, Viano & Bir 2005
 * measured Olympic punches at 1.4-3.5 m/s dV and up to ~9000 rad/s^2).
 * We read the struck head's delta-omega and delta-v straight from the
 * solver, so a braced neck, a punch partly caught on the gloves, or a shot
 * that only grazes all naturally do less.
 *
 * Body: rated from the impulse delivered in the first ~50 ms. Shots that
 * land on the liver (the right side of the lower rib cage) are far more
 * debilitating, as in the real sport.
 */
export class DamageModel {
  constructor(sim) {
    this.sim = sim;
    this.active = new Map();
    this.events = [];
    this.headPrev = sim.boxers.map(() => ({ v: new Vector3(), w: new Vector3() }));
    this.scale = 1;
  }

  /** Call right before each physics step. */
  pre() {
    this.sim.boxers.forEach((bx, i) => {
      this.headPrev[i].v.copy(bx.b.head.vel);
      this.headPrev[i].w.copy(bx.b.head.omega);
    });
  }

  /** Call right after each physics step. Returns this frame's events. */
  post() {
    const events = this.events;
    events.length = 0;
    const boxers = this.sim.boxers;
    const touched = new Set();

    for (const imp of this.sim.world.impacts) {
      const ua = imp.shapeA.userData, ub = imp.shapeB.userData;
      if (ua.boxer === undefined || ub.boxer === undefined || ua.boxer === ub.boxer) continue;
      let gloveU, otherU, gloveShape;
      if (ua.part === 'glove' && ub.part !== 'glove') { gloveU = ua; otherU = ub; gloveShape = imp.shapeA; }
      else if (ub.part === 'glove' && ua.part !== 'glove') { gloveU = ub; otherU = ua; gloveShape = imp.shapeB; }
      else if (ua.part === 'glove' && ub.part === 'glove') {
        // Glove on glove: credit whichever glove belongs to a punch in flight.
        const pa = boxers[ua.boxer].punch, pb = boxers[ub.boxer].punch;
        const aPunching = pa && ua.segment === 'forearm' + pa.side;
        const bPunching = pb && ub.segment === 'forearm' + pb.side;
        if (aPunching && !bPunching) { gloveU = ua; otherU = ub; gloveShape = imp.shapeA; }
        else if (bPunching && !aPunching) { gloveU = ub; otherU = ua; gloveShape = imp.shapeB; }
        else continue;
      } else continue;

      const attacker = boxers[gloveU.boxer], defender = boxers[otherU.boxer];
      const key = `${gloveU.boxer}:${gloveU.segment}`;
      touched.add(key);
      let rec = this.active.get(key);
      if (!rec) {
        const side = gloveU.segment.slice(-1);
        const punch = attacker.punch && attacker.punch.side === side ? attacker.punch : null;
        rec = {
          attacker, defender, side, punch,
          punchType: punch ? punch.type : null,
          frames: 0,
          impulse: 0,
          earlyImpulse: 0,
          peak: 0,
          speed: imp.approachSpeed,
          parts: new Map(),
          point: new Vector3(),
          normal: new Vector3(),
          dv: 0,
          dw: 0,
          gloveShape,
        };
        this.active.set(key, rec);
        // Immediate feedback event (sound, particles) on first contact.
        const zone = zoneOf(otherU.part);
        events.push({
          kind: 'contact', attacker, defender, zone, part: otherU.part,
          point: imp.point.clone(), normal: imp.normal.clone(),
          speed: imp.approachSpeed, force: imp.peakForce, impulse: imp.impulse,
          punchType: rec.punchType,
        });
      }
      rec.frames++;
      rec.impulse += imp.impulse;
      if (rec.frames <= 3) rec.earlyImpulse += imp.impulse;
      rec.peak = Math.max(rec.peak, imp.peakForce);
      rec.speed = Math.max(rec.speed, imp.approachSpeed);
      rec.parts.set(otherU.part, (rec.parts.get(otherU.part) ?? 0) + imp.impulse);
      if (rec.frames === 1) {
        rec.point.copy(imp.point);
        rec.normal.copy(imp.normal);
      }
      if (HEAD_PARTS.has(otherU.part)) {
        const hp = this.headPrev[defender.id];
        rec.dw = Math.max(rec.dw, _v.subVectors(defender.b.head.omega, hp.w).length());
        rec.dv = Math.max(rec.dv, _l.subVectors(defender.b.head.vel, hp.v).length());
      }
    }

    // Contacts that ended (or have lasted long enough) become resolved hits.
    for (const [key, rec] of this.active) {
      if (touched.has(key) && rec.frames < 5) continue;
      if (!touched.has(key) || rec.frames >= 5) {
        if (!rec.resolved) {
          rec.resolved = true;
          const ev = this._resolve(rec);
          if (ev) events.push(ev);
        }
        if (!touched.has(key)) this.active.delete(key);
      }
    }
    return events;
  }

  _resolve(rec) {
    const { attacker, defender } = rec;
    // Dominant zone by impulse.
    let best = null, bestJ = -1;
    for (const [part, J] of rec.parts) if (J > bestJ) { bestJ = J; best = part; }
    const zone = zoneOf(best);
    const isPower = rec.punchType && rec.punchType !== 'jab';
    const ev = {
      kind: 'hit', attacker, defender, zone, part: best,
      point: rec.point, normal: rec.normal,
      speed: rec.speed, force: rec.peak, impulse: rec.earlyImpulse,
      punchType: rec.punchType, isPower, severity: 0, liver: false, dv: rec.dv, dw: rec.dw,
    };
    if (defender.isDown) return null;

    if (zone === 'head') {
      // Concussive load from the measured head kinematics (+ a little from
      // peak force, which captures very short, sharp impacts).
      const s = 0.5 * (rec.dw / 20) ** 2 + 0.5 * (rec.dv / 3) ** 2 + 0.25 * (rec.peak / 3000) ** 2;
      let conc = Math.min(1.3, s) * 0.8 * this.scale;
      if (rec.speed < 1.2) conc *= 0.3;          // pushes and pawing, not punches
      ev.severity = conc;
      defender.applyTrauma({ concussion: conc, body: 0, direction: rec.normal });
      defender.faceDamage = Math.min(100, defender.faceDamage + conc * 40 + rec.earlyImpulse * 0.15);
    } else if (zone === 'body') {
      // Liver: the defender's right side, lower ribs.
      const local = defender.b.abdomen.worldToLocal(rec.point, _v);
      const liver = local.x < -0.04 && local.y > -0.09 && local.y < 0.12;
      const b = Math.pow(Math.max(0, rec.earlyImpulse) / 9, 1.15) * (liver ? 1.9 : 1) * this.scale;
      ev.severity = b / 6;
      ev.liver = liver;
      defender.applyTrauma({ concussion: 0, body: b, direction: rec.normal });
      // A hard liver shot can drop a fighter a moment later.
      if (liver && b > 4 && defender.bodyDamage > 35 && Math.random() < Math.min(0.6, (b - 4) * 0.12 + defender.bodyDamage / 250)) {
        defender.pendingCollapse = 0.6 + Math.random() * 0.5;
      }
    } else {
      // Blocked: the guard absorbs it, at a stamina cost.
      ev.zone = 'block';
      ev.severity = 0;
      defender.stamina = Math.max(0, defender.stamina - rec.earlyImpulse * 0.12);
    }

    if (rec.punch && (zone === 'head' || zone === 'body') && !rec.punch.landed && rec.speed > 1.2) {
      rec.punch.landed = true;
      attacker.stats.landed++;
      attacker.roundStats.landed++;
      if (isPower) {
        attacker.stats.powerLanded++;
        attacker.roundStats.powerLanded++;
      }
      const dmg = zone === 'head' ? ev.severity * 30 : ev.severity * 12;
      attacker.stats.damageDealt += dmg;
      attacker.roundStats.damage += dmg;
    }
    return ev;
  }
}

export function zoneOf(part) {
  if (HEAD_PARTS.has(part)) return 'head';
  if (BODY_PARTS.has(part)) return 'body';
  if (GUARD_PARTS.has(part)) return 'block';
  return 'other';
}
