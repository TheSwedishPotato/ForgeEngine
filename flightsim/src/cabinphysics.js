// What the flight physics does to the people and things in the cabin.
//
// Every body samples the real specific force at its own place in the cabin (the rigid-body
// model adds the rotational terms, so the back of the aircraft moves more than the seats
// over the wing). A belted passenger's head sways on a spring-damper; an unbelted body lifts
// off the seat when the load factor drops below zero g and can hit the overhead bins; people
// standing in the aisle can resist about a quarter of a g with their feet, then they slide,
// stagger and fall. Drinks spill, bins burst open and trolleys roll when the forces are big
// enough, and the oxygen masks drop when the cabin altitude passes 14,000 ft.
import * as THREE from 'three';
import { G, clamp, damp, lerp } from './core.js';

const tmp = new THREE.Vector3();

// A body that can leave its support: y is the height above the seat or floor (m).
class VBody {
  constructor(ceiling, belt) { this.y = 0; this.vy = 0; this.ceiling = ceiling; this.belt = belt; this.airT = 0; this.hit = 0; }
  // aRel: relative vertical acceleration of a free body in the cabin frame (= -specific force y)
  step(dt, aRel, belted) {
    let a = aRel;
    if (belted && this.y > this.belt) a -= 900 * (this.y - this.belt) + 40 * this.vy; // lap belt stretches a little
    this.vy += a * dt; this.y += this.vy * dt;
    let impact = 0;
    if (this.y <= 0) { if (this.vy < -1.2) impact = -this.vy; this.y = 0; this.vy = Math.max(0, this.vy) * 0; }
    if (this.y >= this.ceiling) { if (this.vy > 0.8) { impact = this.vy; this.hit = this.vy; } this.y = this.ceiling; this.vy = -Math.abs(this.vy) * 0.3; }
    this.airT = this.y > 0.02 ? this.airT + dt : 0;
    return impact;
  }
}

export class CabinDynamics {
  constructor(sim) {
    this.sim = sim;
    this.head = new THREE.Vector3(); this.headV = new THREE.Vector3();
    this.player = new VBody(0.36, 0.035);
    this.playerSlide = new THREE.Vector2();
    this.events = [];
    this.masks = false; this.binsOpen = false; this.spilled = false;
    this.sfCabin = new THREE.Vector3(0, G, 0);
    this.severity = 0;        // smoothed |nz - 1|, for crew and passenger reactions
    this.minNz = 1; this.maxNz = 1;
    this.injuries = { player: 0, crew: 0, pax: 0 };
    this._paxT = 0;
  }

  emit(e, data) { this.events.push({ e, data }); }

  // Called by the flight model on every physics step (120 Hz), so short jolts are felt at any time speed.
  substep(h) {
    const S = this.sim, fm = S.fm, P = S.player;
    if (!P) return;
    const e = P.eye;
    fm.accelAt(e.x, e.y, e.z, tmp);
    this.sfCabin.copy(tmp);
    const nzHere = tmp.y / G;
    this.minNz = Math.min(this.minNz, nzHere); this.maxNz = Math.max(this.maxNz, nzHere);
    const seated = P.state === 'seated';
    this.player.ceiling = seated ? 0.36 : 0.45;
    // head on a spring-damper (seated) or knees (standing); relative acceleration = -(specific force deviation)
    const k = seated ? 70 : 45, c = seated ? 11 : 9;
    const ax = -(tmp.x) - k * this.head.x - c * this.headV.x;
    const ay = -(tmp.y - G) - k * this.head.y - c * this.headV.y;
    const az = -(tmp.z) - k * this.head.z - c * this.headV.z;
    this.headV.x += ax * h; this.headV.y += ay * h; this.headV.z += az * h;
    this.head.x += this.headV.x * h; this.head.y += this.headV.y * h; this.head.z += this.headV.z * h;
    // the whole body leaving the seat or the floor
    const impact = this.player.step(h, -tmp.y, seated && P.belt);
    if (impact > 1.2) this._playerImpact(impact, seated);
    this._people(h);
    this._nzWin = Math.min(this._nzWin ?? 9, nzHere); this._nzWinMax = Math.max(this._nzWinMax ?? -9, nzHere);
  }

  update(dt) {
    if (dt <= 0) return;
    const S = this.sim, P = S.player;
    const tmpY = this.sfCabin.y;
    const nzLo = this._nzWin ?? tmpY / G, nzHi = this._nzWinMax ?? tmpY / G;
    this._nzWin = null; this._nzWinMax = null;
    const worst = Math.abs(nzLo - 1) > Math.abs(nzHi - 1) ? nzLo : nzHi;
    this.severity = damp(this.severity, Math.min(3, Math.abs(worst - 1) * 3 + Math.abs(this.sfCabin.x) / G * 4), 1.5, dt);
    this.head.clampLength(0, 0.09);
    // standing: feet resist about 0.25 g; beyond that the player slides and staggers
    const tmp2 = this.sfCabin;
    if (P.state === 'standing' && !P.fallen) {
      const grip = 0.25 * Math.max(0, tmp2.y);
      const lat = -tmp2.x, lon = -tmp2.z;
      const excess = Math.hypot(lat, lon) - grip;
      if (excess > 0 || this.player.y > 0.02) {
        const kk = excess > 0 ? excess / Math.hypot(lat, lon) : 0.2;
        this.playerSlide.x += lat * kk * dt; this.playerSlide.y += lon * kk * dt;
      }
      this.playerSlide.multiplyScalar(Math.exp(-dt * 2.5));
      const nx = P.pos.x + this.playerSlide.x * dt, nz = P.pos.z + this.playerSlide.y * dt;
      if (P._walkable(nx, nz)) { P.pos.x = nx; P.pos.z = nz; }
      else { if (this.playerSlide.length() > 0.8) this._playerImpact(this.playerSlide.length() * 1.5, false); this.playerSlide.set(0, 0); }
      if ((excess > 0.28 * G || this.player.airT > 0.35 || this.player.y > 0.12) && !P.fallen) this._playerFall();
    } else this.playerSlide.set(0, 0);
    this._peopleFrame(dt);
    this._objects(dt, worst);
  }

  // Camera offset for the player: head sway plus the body lifting off its seat.
  headOffset(out) {
    const P = this.sim.player;
    out.copy(this.head);
    out.y += this.player.y;
    return out;
  }

  _playerImpact(v, seated) {
    const S = this.sim;
    this.injuries.player += v;
    this.emit('player-impact', { v, seated });
    S.audio?.thump(Math.min(1, v / 3), 90);
    if (seated) S.ui?.toast(v > 3 ? 'You were thrown against the overhead bin. Your head is bleeding.' : 'You hit your head on the overhead panel!', 4);
    S.flashRed = Math.min(1, (S.flashRed || 0) + v / 4);
  }

  _playerFall() {
    const S = this.sim, P = S.player;
    P.fallen = true; P.fallT = 0;
    this.emit('player-fall');
    S.audio?.thump(0.8, 70);
    S.ui?.toast('You lost your footing and fell in the aisle. Press Space to get up.', 5);
    S.flashRed = Math.min(1, (S.flashRed || 0) + 0.4);
  }

  // bodies at the physics rate: passengers (every 4th step), crew and walkers, trolleys
  _people(h) {
    const S = this.sim, fm = S.fm, people = S.people;
    if (!people) return;
    const signOn = S.director?.seatbelt;
    this._paxAcc = (this._paxAcc || 0) + h;
    if (this._paxAcc >= 1 / 30) {
      const hp = this._paxAcc; this._paxAcc = 0;
      for (const p of people.pax) {
        if (p.away || !p.group) continue;
        if (p.baseY == null) { p.baseY = p.group.position.y; p.baseRX = p.group.rotation.x; p.belted = Math.random() < 0.72; p.vb = new VBody(0.38, 0.03); }
        const sf = fm.accelAt(p.seat.x, 1.0, p.seat.z, tmp);
        const imp = p.vb.step(hp, -sf.y, p.belted || signOn);
        if (imp > 1.5) { this.injuries.pax += imp; if (imp > 2.5) this.emit('pax-impact', { p, v: imp }); }
        p.group.position.y = p.baseY + p.vb.y;
        p.group.rotation.x = p.baseRX + (p.brace ? -0.55 : 0) + clamp(sf.z * 0.004, -0.06, 0.06);
      }
    }
    for (const a of people.crew) this._actorBody(a, h);
    for (const a of people.walkers) this._actorBody(a, h);
    for (const run of people.carts || []) {
      if (run.finished || !run.cart) continue;
      const sf = fm.accelAt(0, 0.5, run.cart.position.z, tmp);
      const loose = Math.abs(sf.z) > 0.3 * G || sf.y < 0.25 * G || run.crew?.fallen;
      run.rollV = (run.rollV || 0) + (loose ? -sf.z : 0) * h;
      run.rollV *= Math.exp(-h * (loose ? 0.6 : 3));
      run.rollZ = clamp((run.rollZ || 0) + run.rollV * h, -4, 4) * (loose ? 1 : Math.exp(-h * 0.25));
      run.vy = (run.vy || 0) + (sf.y < 0 || run.lift > 0 ? -sf.y : 0) * h; run.lift = Math.max(0, (run.lift || 0) + run.vy * h); if (run.lift <= 0) run.vy = 0;
      if (run.lift > 0.3) { run.lift = 0.3; run.vy = -Math.abs(run.vy) * 0.3; }
      if (Math.abs(run.rollV) > 0.4 && !run.rolled) { run.rolled = true; this.emit('cart-roll', { run }); }
      if (Math.abs(run.rollV) < 0.05) run.rolled = false;
    }
  }
  _actorBody(a, h) {
    const fm = this.sim.fm;
    if (!a.vb) { a.vb = new VBody(0.42, 0.03); a.slide = new THREE.Vector2(); }
    const sf = fm.accelAt(a.x, 1.0, a.z, tmp);
    a.vb.step(h, -sf.y, a.seated);
    a.lift = a.vb.y;
    if (!a.seated) {
      const grip = 0.25 * Math.max(0, sf.y), lat = -sf.x, lon = -sf.z, mag = Math.hypot(lat, lon);
      if (mag > grip) { a.slide.x += lat * (mag - grip) / mag * h; a.slide.y += lon * (mag - grip) / mag * h; }
      a.slide.multiplyScalar(Math.exp(-h * 3));
      if (a.slide.lengthSq() > 1e-4) {
        const nx = a.x + a.slide.x * h;
        if (Math.abs(nx) < 0.45 || Math.abs(nx) < Math.abs(a.x)) a.x = nx; // seat rows stop a sideways slide
        a.z += a.slide.y * h;
      }
      if (!a.fallen && (a.vb.airT > 0.25 || a.vb.y > 0.15 || mag > 0.45 * G)) { a.fallen = true; a.fallT = 0; this.injuries.crew += 1; this.emit('crew-fall', { a }); }
    }
  }
  _peopleFrame(dt) {
    const people = this.sim.people; if (!people) return;
    for (const a of [...people.crew, ...people.walkers]) {
      a.bracing = !a.seated && this.severity > 0.9;
      if (a.fallen) { a.fallT += dt; if (a.fallT > 6 && this.severity < 0.4) { a.fallen = false; this.emit('crew-up', { a }); } }
    }
  }

  _objects(dt, nz) {
    const S = this.sim, P = S.player, cabin = S.cabin;
    // drinks spill above ~0.35 g of vertical disturbance
    if (!this.spilled && Math.abs(nz - 1) > 0.45 && P.trayItems?.children.length) {
      this.spilled = true;
      if (P.spill?.()) { this.emit('spill'); S.ui?.toast('The jolt knocked your drink over. It is all over the tray.', 4); }
    }
    if (Math.abs(nz - 1) < 0.2) this.spilled = false;
    // overhead bins pop open under strong negative g or a violent jolt
    if (!this.binsOpen && (nz < -0.2 || Math.abs(nz - 1) > 1.4) && cabin?.bins) {
      this.binsOpen = true; this.emit('bins-open');
      for (const b of cabin.bins) if (Math.random() < 0.35) b.target = 1;
      S.audio?.binOpen();
    }
    // oxygen masks drop automatically at 14,000 ft cabin altitude
    if (!this.masks && S.fm.cabinAlt > 4267) { this.masks = true; this.emit('masks'); cabin?.dropMasks?.(); S.audio?.masks(); }
  }
}
