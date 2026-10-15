/**
 * The main engines: four Fairbanks-Morse 38D 8-1/8, ten cylinders, opposed piston, two-stroke,
 * 1,600 bhp at 720 rpm, each driving a 1,100 kW generator through a flexible coupling; and the
 * auxiliary, a seven-cylinder 38E 5-1/4 of 440 bhp at 1,200 rpm with its 300 kW generator.
 *
 * Nothing about an engine is automatic except its governor. To run, an engine needs:
 *  - air: the scavenging blower draws 6,000 cubic feet a minute at full speed through the
 *    engine room's induction hull valve from the main induction (the big outboard valve aft of
 *    the conning tower). Shut the induction and the engines draw on the boat's own air, and the
 *    pressure in the boat falls fast (the barometer shows it);
 *  - an open exhaust: the inboard and outboard exhaust valves. Shut, and the back pressure stops
 *    her in seconds; open under water, and the sea comes back up the exhaust;
 *  - cooling: the engine-driven sea water pump needs the sea suction open, or the jacket water
 *    climbs past 170 F toward a seized piston;
 *  - lube oil: the engine-driven pump makes pressure with the speed (17 to 32 psi at the upper
 *    header at full speed); start her without priming with the standby pump and the bearings
 *    suffer; the low-pressure alarm sounds below 10 psi;
 *  - fuel from the clean fuel oil tank;
 *  - starting air: the control lever to START admits 250-lb air (from the 3000-lb system through
 *    the reducing valve) through the distributor to the cylinders, turning her over; when she
 *    fires, the lever goes to RUN.
 * The governor (a hydraulic Woodward type) moves the fuel racks to hold the speed set from the
 * maneuvering room; the overspeed trip shuts her down at 800 rpm.
 *
 * Fuel: the yard's consumption table (pounds a brake horsepower-hour at load and speed,
 * 0.364 to 0.555), interpolated; the air to fuel ratio 47 : 1 at full load.
 */
import { MAIN_ENGINE, AUX_ENGINE, LB, FT3 } from '../data/boat.js';
import { ATM, R_GAS, HP } from './units.js';

const RPM = Math.PI / 30;

/** Fuel (kg/s) at brake power P (W) and speed rpm, from the yard's table (bilinear over load and speed). */
export function fuelRate(P, rpm) {
  const bhp = Math.max(0, P / HP);
  // the table's load points at 720 rpm and 648 rpm; scale specific consumption by load fraction
  const load = bhp / MAIN_ENGINE.bhp;
  const sfc720 = interp([[0.25, 0.555], [0.5, 0.419], [0.75, 0.381], [1.0, 0.375]], load);
  const sfc648 = interp([[0.225, 0.529], [0.45, 0.405], [0.6, 0.368], [0.8, 0.364]], load);
  const f = Math.max(0, Math.min(1, (720 - rpm) / 72));
  const sfc = sfc720 + (sfc648 - sfc720) * f;               // lb/bhp-hr
  // at no load an engine still burns its friction: about 6 % of full-load fuel at speed
  const idle = 0.06 * MAIN_ENGINE.bhp * 0.375 * (rpm / 720);
  return (Math.max(idle, bhp * sfc) * LB) / 3600;
}
function interp(tab, x) {
  if (x <= tab[0][0]) return tab[0][1] * (tab[0][0] / Math.max(0.05, x)) ** 0.35;
  for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) { const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return tab[tab.length - 1][1];
}

export class Engine {
  constructor(id, { aux = false } = {}) {
    this.id = id; this.aux = aux;
    const S = aux ? AUX_ENGINE : MAIN_ENGINE;
    this.spec = S;
    this.ratedRpm = S.rpm;
    this.ratedPower = S.bhp * HP;
    this.Tmax = this.ratedPower / (S.rpm * RPM) * 1.08;      // N m, a little above rated torque
    this.J = aux ? 180 : 1450;                                 // kg m^2: engine, flywheel, generator armature (estimate)
    this.omega = 0;
    this.rack = 0;                                             // fuel racks 0..1
    this.lever = 'stop';                                       // stop | start | run (at the engine)
    this.setRpm = S.rpm;                                       // the governor's setting (from the maneuvering room)
    this.state = 'stopped';                                    // stopped | cranking | running | tripped
    this.tJacket = 85;                                         // F
    this.tLube = 85;
    this.pLube = 0;                                            // psi at the upper header
    this.primed = 0;                                           // 0..1: oil pumped round by the standby pump
    this.bearingWear = 0;                                      // 0..1 (1: a wiped bearing)
    this.alarms = new Set();
    this.integral = 0;
    this.fuel = 0;                                             // kg/s
    this.airIn = 0;                                            // mol/s drawn
    this.exhaust = 0;                                          // mol/s out
    this.startAir = 0;                                         // mol/s of starting air used
    this.power = 0;                                            // W brake power
    this.rpm = 0;
    this.firing = false;
  }

  /**
   * One step. env: {
   *   airP (Pa) at the engine's intake (the induction's or the boat's air), airOK (an intake path),
   *   exhaustOpen (both valves open), exhaustFlooded (water in the exhaust),
   *   seaSuction (sea water to the cooler open), startAirP (Pa of the 250-lb starting air, 0 if none),
   *   fuelOK, loadTorque (N m, the generator's), standbyLube (the standby pump running)
   * }
   */
  step(dt, env) {
    const S = this.spec;
    this.rpm = this.omega / RPM;
    this.alarms.clear();
    // ---- lube oil: the engine-driven pump's pressure with the speed; the standby pump primes
    const pumpP = 32 * Math.min(1, this.rpm / (S.rpm * 0.9)) * (1 - 0.4 * Math.max(0, (this.tLube - 160) / 60));
    const standbyP = env.standbyLube ? 14 : 0;
    this.pLube += (Math.max(pumpP, standbyP) - this.pLube) * Math.min(1, dt * 2);
    if (env.standbyLube) this.primed = Math.min(1, this.primed + dt / 60);
    if (this.rpm > 30 && this.pLube < 8) this.bearingWear += dt * (this.rpm / S.rpm) * (8 - this.pLube) / 8 / 120;
    if (this.state === 'stopped' && !env.standbyLube) this.primed = Math.max(0, this.primed - dt / 7200);
    if (this.rpm > 100 && this.pLube < 10) this.alarms.add('low lube oil pressure');
    // ---- starting: air on the pistons until she fires
    let Tstart = 0;
    this.startAir = 0;
    if (this.lever === 'start' && env.startAirP > ATM * 3) {
      if (this.state === 'stopped') this.state = 'cranking';
      // starting torque from the air in the cylinders that are on their power stroke
      Tstart = this.Tmax * 0.55 * Math.min(1, (env.startAirP - ATM) / (S.startingAirReduced ?? 250 * 6894.76)) * Math.max(0, 1 - this.rpm / 220);
      // about 1.5 cubic feet of 250-lb air a revolution of the crankshaft (estimate)
      const revPerS = Math.max(1, this.rpm) / 60;
      this.startAir = (env.startAirP * 1.5 * FT3) / (R_GAS * 288) * revPerS * 0.6;
      // first start without priming: the dry bearings
      if (this.primed < 0.5) this.bearingWear += dt * 0.004;
    }
    // ---- combustion: fuel goes in with the lever at RUN; she fires above ~110 rpm if she can breathe
    const canBreathe = env.airOK && env.exhaustOpen && !env.exhaustFlooded && env.airP > ATM * 0.55;
    const firing = this.lever === 'run' && env.fuelOK && canBreathe && this.rpm > 110 && this.state !== 'tripped' && this.bearingWear < 1;
    this.firing = firing;
    if (firing) this.state = 'running';
    else if (this.state === 'running' && this.rpm < 60) this.state = 'stopped';
    if (this.state === 'cranking' && this.lever === 'stop') this.state = 'stopped';
    // ---- the governor: PI on speed, droop 3 %
    let Tcomb = 0;
    if (firing) {
      const err = (this.setRpm - this.rpm) / S.rpm;
      this.integral = Math.max(-0.2, Math.min(1.2, this.integral + err * dt * 0.8));
      const want = Math.max(0, Math.min(1, err * 12 + this.integral));
      this.rack += (want - this.rack) * Math.min(1, dt * 4);        // the racks' servo
      // the air the cylinders get: less if the intake is starved (the boat's pressure falling)
      const breath = Math.min(1, Math.max(0, (env.airP / ATM - 0.55) / 0.35));
      Tcomb = this.Tmax * this.rack * breath * Math.min(1, this.rpm / (S.rpm * 0.3));
      if (env.backPressure) Tcomb *= Math.max(0, 1 - env.backPressure);
    } else { this.rack = 0; this.integral = 0; }
    // ---- friction and pumping losses (about 10 % of rated at speed)
    const Tfric = (0.06 + 0.04 * this.rpm / S.rpm) * this.Tmax * Math.min(1, this.rpm / 20) + (this.rpm < 1 ? 0 : 0);
    const Tload = env.loadTorque ?? 0;
    const acc = (Tcomb + Tstart - Tfric - Tload) / this.J;
    this.omega = Math.max(0, this.omega + acc * dt);
    // overspeed trip
    if (this.omega / RPM > (S.overspeedTrip ?? S.rpm * 1.11)) { this.state = 'tripped'; this.alarms.add('overspeed trip'); }
    if (this.state === 'tripped' && this.lever === 'stop' && this.omega < 1) this.state = 'stopped';
    this.power = Tcomb * this.omega;
    this.fuel = firing ? fuelRate(this.power, this.omega / RPM) * (this.aux ? AUX_ENGINE.bhp / MAIN_ENGINE.bhp : 1) : 0;
    // ---- air through the engine: the blower's displacement turns with the crankshaft
    const cfm = (this.aux ? 2280 : MAIN_ENGINE.blower.cfm) * (this.omega / RPM) / S.rpm;
    this.airIn = this.rpm > 5 ? (cfm * FT3 / 60) * Math.max(0.2, env.airP) / (R_GAS * 300) : 0;
    this.exhaust = this.airIn;
    // ---- temperatures: heat into the jacket water against the cooler's sea water
    const heat = this.power * 0.3 + this.Tmax * 0.02 * this.omega;       // ~30 % of the fuel's work goes to the jacket (W)
    // the cooler takes heat to the sea water; a thermostatic bypass holds the jacket near 150 F
    // (the yard's operating figures: 140 to 170 F at the outlet)
    const bypass = Math.max(0.12, Math.min(1, (this.tJacket - 130) / 20));
    const cool = env.seaSuction && this.rpm > 50 ? 3600 * (this.tJacket - env.seaTempF) * bypass * Math.min(1, this.rpm / (S.rpm * 0.5)) * (this.aux ? 0.3 : 1) : 350 * (this.tJacket - 75);
    this.tJacket += dt * (heat - cool) / (this.aux ? 1.5e6 : 6e6);       // J per F: the block and its water (estimate)
    this.tLube += dt * ((this.tJacket + 10 - this.tLube) * 0.01);
    if (this.tJacket > 180) this.alarms.add('high jacket water temperature');
    if (this.tJacket > 235) { this.bearingWear += dt / 60; this.alarms.add('engine overheating'); }
    if (this.bearingWear >= 1 && this.state === 'running') { this.state = 'tripped'; this.alarms.add('bearing wiped'); }
  }
}

export { RPM };
