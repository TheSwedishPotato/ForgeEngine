/**
 * What hard or fast running does to the engine, the bearings and the track (estimates where noted).
 *
 *  - The engine's motion. The C 5/6 was built for 65 km/h. Faster, the coupled wheels turn more
 *    often than their rods, crankpins and big ends were balanced and lubricated for: the hammer
 *    blow and the bearing loads grow with the square of the speed. Stress accumulates as
 *    ((v / 65)^4 - 1): at 75 km/h it lasts about seven minutes, at 90 km/h about two (estimate).
 *    The crew hear the motion knock first; then a coupling rod breaks and the engine can no
 *    longer drive her wheels (she coasts, brakes still work).
 *
 *  - Hot axle boxes. The plain bearings' oil film carries the axle; friction heats the box in
 *    proportion to load and speed, the air cools it. Run far over the design speed the film
 *    thins and the heat runs away. Each vehicle's boxes run a little differently (wear, oil).
 *    Over about 90 K above the air the crew smell it, at 160 K it smokes; at 230 K the white metal
 *    melts and the bearing seizes: the axle drags, and in a couple of kilometres the journal
 *    burns off and drops the axle (a derailment).
 *
 *  - The track. Too much sideways force from the wheels shifts the whole track in its ballast
 *    (Prud'homme's limit, as the UIC applies it: an axle's lateral force over 0.85 (10 + P/3) kN,
 *    P its load in kN). Held for a couple of seconds, the track moves out of line under the
 *    vehicle and it comes off. The limit is a little lower on a frosty, snowed-up bed.
 */

const G = 9.80665;
const VMAX = 65 / 3.6;

export class Wear {
  constructor(train) {
    this.train = train;
    this.motion = 0;                 // 0..1, the engine's motion's accumulated overstress
    this.rodBroken = false;
    this.box = [];                   // per vehicle: temperature of its hottest axle box over the air (K)
    this.quality = [];               // per vehicle: how its boxes run (wear, oil): 0.85..1.35
    this.seized = [];                // per vehicle: metres run on a seized bearing (null = not seized)
    this.shift = [];                 // per vehicle: seconds over the track-shift limit
    this.said = new Set();
  }

  _say(key, text) { if (this.said.has(key)) return; this.said.add(key); this.train.events.push({ type: 'wear', text }); }

  step(dt) {
    const T = this.train, R = T.route.run;
    // ---- the engine's motion
    const e = T.veh[0], v = Math.abs(e.v);
    if (!e.wreck && !this.rodBroken) {
      const r = (v / VMAX) ** 4 - 1;
      if (r > 0) this.motion += (r / 320) * dt;
      else this.motion = Math.max(0, this.motion - dt / 3600);      // (a little settles back; nothing really heals)
      if (this.motion > 0.3) this._say('knock1', 'Fireman: listen to her - the motion is knocking! Too fast for her.');
      if (this.motion > 0.7) this._say('knock2', 'Fireman: the big ends are hammering - ease her or something will break!');
      if (this.motion >= 1) {
        this.rodBroken = true;
        T.loco.failed ??= 'coupling rod';
        this._say('rod', `A coupling rod has broken at ${(v * 3.6).toFixed(0)} km/h! The engine can no longer drive her wheels.`);
      }
    }
    // ---- the axle boxes, and the track under each vehicle
    for (let i = 0; i < T.veh.length; i++) {
      const w = T.veh[i];
      if (w.wreck || !w.mNow) continue;
      this.quality[i] ??= 0.85 + 0.5 * frac(Math.sin((i + 1) * 12.9898) * 43758.5453);
      const vi = Math.abs(w.v), over = Math.max(0, vi * 3.6 / 75 - 1);
      const eq = 25 * (vi / 14) * (1 + 20 * over * over) * this.quality[i];       // K over the air at this speed, in the long run
      const b = (this.box[i] ??= 15);
      this.box[i] = b + (eq - b) * Math.min(1, dt / 600);                            // (about ten minutes to settle)
      const name = w.name;
      if (this.box[i] > 90) this._say(`hot${i}`, `Hot axle box on the ${name}: the smell of hot oil.`);
      if (this.box[i] > 160) this._say(`smoke${i}`, `The ${name}'s axle box is smoking - stop her!`);
      if (this.box[i] > 230 && this.seized[i] == null) { this.seized[i] = 0; this._say(`seize${i}`, `A bearing on the ${name} has seized: the white metal has run.`); }
      if (this.seized[i] != null) {
        this.seized[i] += vi * dt;
        // the seized axle drags (its wheels slide on the rail)
        w.drag = 0.12 * (w.mNow * G) / w.axles;
        if (this.seized[i] > 2000 || (this.seized[i] > 300 && vi > 60 / 3.6)) T.derail.derail(i, 'dropped an axle - its journal burnt off', { lat: 0.4 });
      }
      // the track: an axle's lateral force against Prud'homme's limit
      const ay = Math.abs(T.derail.lateral(i, w.cond));
      const P = (w.mNow * G) / w.axles / 1000;                                        // axle load, kN
      const Y = ((w.mNow * ay) / w.axles) * 1.3 / 1000;                               // the leading axle's share, kN
      const frost = (w.cond?.tempC ?? 5) < -5 ? 0.92 : 1;
      if (Y > 0.85 * (10 + P / 3) * frost) {
        this.shift[i] = (this.shift[i] ?? 0) + dt;
        if (this.shift[i] > 0.6) this._say(`shiftw${i}`, `The track is groaning under the ${name}!`);
        if (this.shift[i] > 2) T.derail.derail(i, 'shifted the track out of line', { lat: Math.sign(T.derail.lateral(i, w.cond)) * 0.5 });
      } else this.shift[i] = Math.max(0, (this.shift[i] ?? 0) - dt);
    }
  }

  /** The hottest axle box (K over the air) and its vehicle. */
  hottest() {
    let best = { k: 0, name: '' };
    this.box.forEach((k, i) => { if (k > best.k) best = { k, name: this.train.veh[i]?.name ?? '' }; });
    return best;
  }
}

function frac(x) { return x - Math.floor(x); }
