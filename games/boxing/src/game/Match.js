import { Vector3 } from 'three';
import { clamp } from '../physics/math.js';

/**
 * Bout rules: timed rounds, the referee's count, the three-knockdown rule,
 * and 10-point-must scoring by three judges (each with a slightly different
 * eye for activity vs. power).
 */
export class Match {
  constructor(sim, { rounds = 3, roundLength = 120, restLength = 8 } = {}) {
    this.sim = sim;
    this.rounds = rounds;
    this.roundLength = roundLength;
    this.restLength = restLength;
    this.round = 1;
    this.clock = roundLength;
    this.state = 'intro';
    this.stateTime = 0;
    this.count = 0;
    this.downed = null;
    this.result = null;
    this.listeners = new Set();
    this.judges = [0, 1, 2].map(() => ({ bias: 0.85 + Math.random() * 0.3, cards: [] }));
    this.getUpMeter = 0;          // player-driven recovery (0..1)
    this.getUpNeed = 1;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, data = {}) {
    for (const fn of this.listeners) fn(type, data);
  }

  get fighting() {
    return this.state === 'fight';
  }

  start() {
    this._setState('intro');
  }

  _setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  _placeCenter() {
    const [a, b] = this.sim.boxers;
    a.placeAt(new Vector3(0, 0, -0.75), 0);
    b.placeAt(new Vector3(0, 0, 0.75), Math.PI);
  }

  update(dt) {
    this.stateTime += dt;
    const [a, b] = this.sim.boxers;
    switch (this.state) {
      case 'intro':
        if (this.stateTime === dt) {
          this._placeCenter();
          this.emit('intro');
        }
        if (this.stateTime > 3.2) this._startRound();
        break;
      case 'fight': {
        this.clock -= dt;
        for (const bx of [a, b]) {
          if (bx.state === 'down') {
            this._knockdown(bx);
            return;
          }
        }
        if (this.clock <= 0) {
          this.clock = 0;
          this._endRound();
        }
        break;
      }
      case 'count':
        this._updateCount(dt);
        break;
      case 'roundEnd':
        if (this.stateTime > 2.5) {
          if (this.round >= this.rounds) this._decision();
          else {
            this._setState('rest');
            this.emit('rest', { round: this.round });
          }
        }
        break;
      case 'rest':
        if (this.stateTime > this.restLength) {
          this.round++;
          this._startRound();
        }
        break;
      case 'over':
        break;
      default:
        break;
    }
  }

  _startRound() {
    const [a, b] = this.sim.boxers;
    this.clock = this.roundLength;
    if (this.round > 1) {
      // The minute in the corner: water, ice, the cutman.
      for (const bx of [a, b]) {
        bx.stamina = Math.min(bx.maxStamina, bx.stamina + 55);
        bx.stun = 0;
        bx.health = Math.min(100, bx.health + 6);
        bx.knockdownsThisRound = 0;
        bx.roundStats = { thrown: 0, landed: 0, powerLanded: 0, damage: 0, knockdowns: 0 };
      }
    }
    this._placeCenter();
    this._setState('fight');
    this.emit('roundStart', { round: this.round });
  }

  _endRound() {
    this._scoreRound();
    this._setState('roundEnd');
    this.emit('roundEnd', { round: this.round });
  }

  _knockdown(bx) {
    this.downed = bx;
    this.count = 0;
    this.countTimer = -0.8;           // referee gets into position
    this.getUpMeter = 0;
    const other = bx.opponent;
    bx.roundStats.knockdowns++;
    // Decide (for the AI) whether and when he beats the count.
    const will = bx.health > 0 && bx.knockdownsThisRound < 3 && Math.random() < 0.25 + 0.75 * (bx.health / 100) ** 0.7;
    bx.willGetUp = will;
    bx.getUpAt = will ? clamp(2.5 + (1 - bx.health / 100) * 4 + Math.random() * 2, 2.5, 6.8) : 99;
    // Player recovery difficulty scales with damage.
    this.getUpNeed = 1;
    this.getUpRate = 0.06 + 0.1 * (bx.health / 100);
    this._setState('count');
    this.emit('knockdown', { boxer: bx, attacker: other, count: bx.knockdownsThisRound });
    if (bx.knockdownsThisRound >= 3) {
      this._stoppage(other, bx, 'TKO', 'Three knockdowns');
    }
  }

  /** Player mashing to get up. */
  pushGetUp() {
    if (this.state !== 'count' || !this.downed || this.downed.state !== 'down') return;
    this.getUpMeter = Math.min(1, this.getUpMeter + this.getUpRate);
  }

  _updateCount(dt) {
    const bx = this.downed;
    if (!bx) return;
    const other = bx.opponent;
    // Send the other fighter to a neutral corner.
    const corner = new Vector3(Math.sign(-bx.center.x || 1) * 2.2, 0, Math.sign(-bx.center.z || 1) * 2.2);
    const to = corner.sub(other.center);
    to.y = 0;
    if (to.length() > 0.3) {
      to.normalize();
      other.intent.moveY = to.dot(other.forward);
      other.intent.moveX = -to.dot(other.left);
    } else {
      other.intent.moveX = other.intent.moveY = 0;
    }
    other.intent.block = false;

    this.countTimer += dt;
    if (this.countTimer >= 1) {
      this.countTimer -= 1;
      this.count++;
      this.emit('count', { count: this.count, boxer: bx });
    }

    if (bx.state === 'down') {
      const aiUp = !bx.isPlayer && this.count >= bx.getUpAt;
      const playerUp = bx.isPlayer && this.getUpMeter >= this.getUpNeed && bx.health > 0;
      if ((aiUp || playerUp) && bx.downTime > 1.5) {
        bx.startGetUp();
        this.emit('gettingUp', { boxer: bx });
      }
    }
    if (this.count >= 10 && bx.state !== 'fight') {
      bx.finish();
      this._stoppage(other, bx, 'KO', `Counted out in round ${this.round}`);
      return;
    }
    // Up and ready: mandatory eight count, then fight on.
    if (bx.state === 'fight' && this.count >= 8) {
      this.downed = null;
      this._setState('fight');
      this.emit('resume', {});
    }
  }

  _stoppage(winner, loser, method, detail) {
    this.result = { winner, loser, method, detail, round: this.round, time: this.roundLength - this.clock };
    this._setState('over');
    this.emit('over', this.result);
  }

  _roundScore(bx, judge) {
    const r = bx.roundStats;
    return (r.landed * 1 + r.powerLanded * 1.2 * judge.bias + r.damage * 0.08 * judge.bias + r.thrown * 0.05);
  }

  _scoreRound() {
    const [a, b] = this.sim.boxers;
    for (const j of this.judges) {
      const sa = this._roundScore(a, j), sb = this._roundScore(b, j);
      let pa = 10, pb = 10;
      if (Math.abs(sa - sb) > 0.8) {
        if (sa > sb) pb = 9; else pa = 9;
      } else if (Math.random() < 0.5) pb = 9; else pa = 9;
      pa -= b.roundStats.knockdowns;   // each knockdown costs a point
      pb -= a.roundStats.knockdowns;
      j.cards.push([Math.max(6, pa), Math.max(6, pb)]);
    }
  }

  totals() {
    return this.judges.map((j) => j.cards.reduce((t, c) => [t[0] + c[0], t[1] + c[1]], [0, 0]));
  }

  _decision() {
    const [a, b] = this.sim.boxers;
    const tots = this.totals();
    let va = 0, vb = 0;
    for (const [x, y] of tots) {
      if (x > y) va++;
      else if (y > x) vb++;
    }
    let method, winner = null, loser = null;
    if (va === vb) method = 'Draw';
    else {
      winner = va > vb ? a : b;
      loser = winner === a ? b : a;
      const wv = Math.max(va, vb), lv = Math.min(va, vb);
      method = wv === 3 ? 'Unanimous Decision' : lv === 1 ? 'Split Decision' : 'Majority Decision';
    }
    this.result = { winner, loser, method, detail: tots.map(([x, y]) => `${x}-${y}`).join(', '), round: this.round, cards: tots };
    this._setState('over');
    this.emit('over', this.result);
  }
}
