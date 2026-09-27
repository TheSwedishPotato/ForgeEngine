import { Vector3 } from 'three';
import { clamp } from '../physics/math.js';

export const DIFFICULTY = {
  rookie:   { reaction: 0.34, defense: 0.18, counter: 0.15, aggression: 0.45, accuracy: 0.75, footwork: 0.6, combo: 0.35 },
  pro:      { reaction: 0.25, defense: 0.38, counter: 0.3,  aggression: 0.6,  accuracy: 0.88, footwork: 0.8, combo: 0.55 },
  contender:{ reaction: 0.19, defense: 0.55, counter: 0.45, aggression: 0.7,  accuracy: 0.94, footwork: 0.9, combo: 0.7 },
  champion: { reaction: 0.14, defense: 0.7,  counter: 0.6,  aggression: 0.78, accuracy: 0.98, footwork: 1.0, combo: 0.85 },
};

// Combinations are written for the fighter's own stance ("lead"/"rear").
const COMBOS = [
  { seq: ['jab'], range: 'long', w: 3 },
  { seq: ['jab', 'jab'], range: 'long', w: 2 },
  { seq: ['jab', 'cross'], range: 'mid', w: 3 },
  { seq: ['jab', 'cross', 'leadHook'], range: 'mid', w: 2 },
  { seq: ['cross', 'leadHook'], range: 'mid', w: 1.5 },
  { seq: ['leadHook', 'cross'], range: 'mid', w: 1.2 },
  { seq: ['jab', 'body:cross'], range: 'mid', w: 1.2 },
  { seq: ['body:jab', 'leadHook'], range: 'mid', w: 1 },
  { seq: ['body:leadHook', 'leadHook'], range: 'short', w: 1.4 },
  { seq: ['leadUppercut', 'cross'], range: 'short', w: 1 },
  { seq: ['rearUppercut', 'leadHook'], range: 'short', w: 1 },
  { seq: ['leadHook', 'rearHook'], range: 'short', w: 1 },
  { seq: ['jab', 'cross', 'leadHook', 'cross'], range: 'mid', w: 0.8 },
  { seq: ['body:rearHook', 'leadHook'], range: 'short', w: 0.8 },
];

const RANGES = { long: 1.08, mid: 0.97, short: 0.9 };

/**
 * Opponent brain. It only ever uses the same controls as the player
 * (move, punch, slip, block) and reacts to what it can "see" through a
 * reaction delay, so its hits and misses are decided by the physics.
 */
export class BoxerAI {
  constructor(boxer, difficulty = 'pro') {
    this.boxer = boxer;
    this.setDifficulty(difficulty);
    this.combo = [];
    this.comboTimer = 0;
    this.thinkTimer = 0;
    this.circle = Math.random() < 0.5 ? 1 : -1;
    this.circleTimer = 2;
    this.plannedRange = RANGES.mid;
    this.reactQueue = [];
    this.seenPunch = null;
    this.blockHold = 0;
    this.counterReady = 0;
    this.feint = 0;
    this.rhythm = Math.random() * 10;
    this.style = { bodyFocus: 0.25 + Math.random() * 0.2 };
  }

  setDifficulty(name) {
    this.difficultyName = name;
    this.d = DIFFICULTY[name] ?? DIFFICULTY.pro;
  }

  update(dt) {
    const me = this.boxer, opp = me.opponent;
    const intent = me.intent;
    if (!me.canAct || !opp) {
      intent.moveX = 0;
      intent.moveY = 0;
      intent.block = false;
      this.combo.length = 0;
      return;
    }
    const d = this.d;
    this.rhythm += dt;

    const dist = Math.hypot(opp.center.x - me.center.x, opp.center.z - me.center.z);
    const hurt = me.stun > 0.45;
    const tired = me.stamina < 25;
    const oppHurt = opp.stun > 0.4 || opp.isDown;
    const healthEdge = (me.health - opp.health) / 100;

    // ---- perception with reaction delay -----------------------------------
    const op = opp.punchPhase();
    if (op && op.extending && (!this.seenPunch || this.seenPunch.id !== opp.punch)) {
      this.seenPunch = { id: opp.punch, type: op.type, level: op.level, side: op.side };
      this.reactQueue.push({ at: d.reaction * (0.8 + Math.random() * 0.5), p: this.seenPunch });
    }
    for (const r of this.reactQueue) r.at -= dt;
    while (this.reactQueue.length && this.reactQueue[0].at <= 0) {
      const r = this.reactQueue.shift();
      // Still coming?
      const now = opp.punchPhase();
      if (now && now.extending && opp.punch === r.p.id) this._defend(r.p, now);
    }

    // ---- range management ---------------------------------------------------
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.35 + Math.random() * 0.5;
      const aggressive = d.aggression + 0.25 * healthEdge + (oppHurt ? 0.3 : 0) - (hurt ? 0.5 : 0) - (tired ? 0.25 : 0);
      if (hurt) this.plannedRange = 1.45;
      else if (aggressive > 0.75) this.plannedRange = RANGES.short + Math.random() * 0.06;
      else if (aggressive > 0.5) this.plannedRange = RANGES.mid + (Math.random() - 0.5) * 0.08;
      else this.plannedRange = RANGES.long + Math.random() * 0.1;
    }
    this.circleTimer -= dt;
    if (this.circleTimer <= 0) {
      this.circle = Math.random() < 0.5 ? -this.circle : this.circle;
      if (Math.random() < 0.25) this.circle = 0;
      this.circleTimer = 1 + Math.random() * 2.5;
    }
    // Rope awareness: circle towards the centre when near the ropes.
    const r = Math.hypot(me.center.x, me.center.z);
    let circle = this.circle;
    if (r > 2.0) {
      // cross product sign tells which way round is towards the centre
      const tx = -me.center.x, tz = -me.center.z;
      const side = Math.sign(me.left.x * tx + me.left.z * tz);
      circle = -side;       // moveX>0 means "right" (= -left)
    }
    const rangeErr = dist - this.plannedRange;
    intent.moveY = clamp(rangeErr * 3.2, -1, 1) * d.footwork;
    // Bounce in and out a little like a real fighter.
    intent.moveY += Math.sin(this.rhythm * 2.1) * 0.15;
    intent.moveX = circle * (0.35 + 0.25 * Math.sin(this.rhythm * 0.7)) * d.footwork;
    if (hurt) intent.moveX *= 1.6;

    // ---- defense state ----------------------------------------------------------
    this.blockHold = Math.max(0, this.blockHold - dt);
    intent.block = this.blockHold > 0 || (hurt && Math.random() < 0.6 && !me.punch);

    // ---- offense -------------------------------------------------------------------
    this.counterReady = Math.max(0, this.counterReady - dt);
    this.comboTimer -= dt;
    if (this.combo.length) {
      this._continueCombo();
      return;
    }
    if (hurt && !oppHurt) return;
    if (me.punch || me.defense) return;

    const staminaOk = me.stamina > 12;
    if (this.counterReady > 0 && staminaOk && dist < 1.05) {
      this.counterReady = 0;
      this._startCombo(this._pick(dist, true));
      return;
    }
    if (this.comboTimer > 0) return;
    // Output: roughly 30-45 punches a minute for a fresh pro, fewer when tired.
    const rate = (0.32 + d.aggression * 0.55 + (oppHurt ? 0.7 : 0)) * (tired ? 0.45 : 1);
    this.comboTimer = (0.5 + Math.random() * 1.4) / rate;
    if (!staminaOk) return;
    if (dist > RANGES.long + 0.12) return;
    this._startCombo(this._pick(dist, false));
  }

  _pick(dist, counter) {
    const d = this.d;
    const inRange = COMBOS.filter((c) => dist <= RANGES[c.range] + 0.08);
    const pool = inRange.length ? inRange : COMBOS.filter((c) => c.range === 'long');
    const maxLen = Math.random() < d.combo ? 4 : 2;
    const cands = pool.filter((c) => c.seq.length <= maxLen);
    let total = 0;
    for (const c of cands) total += c.w * (counter && c.seq.length > 1 ? 1.4 : 1);
    let x = Math.random() * total;
    for (const c of cands) {
      x -= c.w * (counter && c.seq.length > 1 ? 1.4 : 1);
      if (x <= 0) return c;
    }
    return cands[0];
  }

  _startCombo(c) {
    this.combo = c.seq.map((s) => {
      let [level, type] = s.includes(':') ? s.split(':') : ['head', s];
      if (level === 'head' && type !== 'jab' && Math.random() < this.style.bodyFocus * 0.5) level = 'body';
      return { type, level };
    });
    this._continueCombo();
  }

  _continueCombo() {
    const me = this.boxer;
    const next = this.combo[0];
    if (!next) return;
    if (!me.punch) {
      this._aim();
      if (me.throwPunch(next.type, next.level)) this.combo.shift();
    } else {
      // queue while the current punch returns
      const ph = me.punchPhase();
      if (ph && ph.s > 0.45 && !me.queued) {
        me.throwPunch(next.type, next.level);
        if (me.queued) this.combo.shift();
      }
    }
    if (me.stamina < 6) this.combo.length = 0;
  }

  _aim() {
    // Imperfect aim: small random error in the target point.
    const e = (1 - this.d.accuracy) * 0.35;
    this.boxer.aimError = new Vector3((Math.random() - 0.5) * e, (Math.random() - 0.5) * e, (Math.random() - 0.5) * e);
  }

  _defend(p) {
    const me = this.boxer;
    const d = this.d;
    if (me.punch && me.punchPhase()?.extending) return;   // committed
    if (Math.random() > d.defense) return;
    const roll = Math.random();
    const opp = me.opponent;
    const straight = p.type === 'jab' || p.type === 'cross';
    const hook = p.type === 'leadHook' || p.type === 'rearHook';
    if (p.level === 'body') {
      this.blockHold = 0.45;
    } else if (straight && roll < 0.55) {
      // Slip to the outside of the incoming hand.
      const fromLeft = (p.side === 'L') === (opp.ss > 0);
      me.defend(fromLeft ? 'slipRight' : 'slipLeft');
      this.counterReady = Math.random() < d.counter ? 0.5 : 0;
    } else if (hook && roll < 0.45) {
      me.defend('duck');
      this.counterReady = Math.random() < d.counter ? 0.6 : 0;
    } else if (roll < 0.8) {
      this.blockHold = 0.4 + Math.random() * 0.25;
      this.counterReady = Math.random() < d.counter * 0.6 ? 0.5 : 0;
    } else {
      me.defend('pull');
      this.counterReady = Math.random() < d.counter ? 0.4 : 0;
    }
  }
}
