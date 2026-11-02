/**
 * The air round a 672 m tower, and the tower in it.
 *  - The standard atmosphere: temperature falls 6.5 K a kilometre, pressure p = p0 (1 - 2.25577e-5 h)^5.25588
 *    (about 0.12 hPa a metre near the ground), density from the gas law.
 *  - The wind's speed grows with height by the power law v(z) = v10 (z / 10)^a, a = 0.25 for a city
 *    (codes use 0.25 to 0.40); gusts are a filtered random process whose intensity falls with height.
 *  - The cloud base where rising air reaches its dew point: about 125 m for each kelvin of the
 *    dew-point spread (a late-October Stockholm day: 8 °C, dew point 2.8 °C, a stratocumulus deck from
 *    about 650 m, so the top floors are in it).
 *  - The tower's first sway mode, period 10 s (a supertall's), 1.5 % damping, pushed along the wind by its
 *    gusts and across it by vortex shedding at f = St v / B (St ~ 0.12 for a rectangular plan, B its
 *    width): when that frequency nears the tower's own, the sway grows (lock-in). A tuned mass damper at the
 *    top (2 % of the modal mass, tuned and damped after Den Hartog) takes the edge off, as Taipei 101's does.
 *    Comfort codes put the limit at about 10 to 25 milli-g peak at the top floor.
 *  - The car's air pressure: a sealed glass car with blowers that hold the change to 1.26 hPa/s at most
 *    (as Taipei 101's cars); your middle ear catches up in pops.
 *  - The wind on the car: it runs outside the curtain wall, so the wind at its height pushes it sideways
 *    (0.5 rho v² Cd A) into its roller guides, which with the rail joints at speed set its ride vibration.
 *  - The stack effect: warm air inside, cold air outside: the pressure across the landing doors grows with
 *    the distance from the neutral plane at mid-height (dp = g drho dz), presses the panels into their guides
 *    and, in a hard winter, makes them bind (tall buildings' doors are re-adjusted twice a year for it).
 *  - The machine room's air: the machine's losses warm it, the roof's cold draws heat out; a thermostat runs
 *    a heater below 7 °C and a fan above 30 °C (the equipment is rated for 5 to 40 °C, and lifts do stop in
 *    the cold when it leaves that band).
 *  - Rime: in cloud below 0 °C the droplets freeze on what they hit: ice grows on the car (collection
 *    efficiency 0.5, liquid water 0.3 g/m³) and on its rails, and melts again above freezing.
 */
const G = 9.80665;

export class Atmos {
  constructor(H) {
    this.H = H;
    this.T0 = 8; this.Td = 2.8; this.p0 = 1013.25;        // ground air (°C, °C, hPa)
    this.v10 = 5.5; this.dir = (225 * Math.PI) / 180;      // mean wind at 10 m (m/s), from the south-west
    this.alpha = 0.25;
    this.cloudBase = 125 * (this.T0 - this.Td); this.cloudTop = this.cloudBase + 320;
    this.n = 0; this.nd = 0;                              // gust and direction noise (normalised)
    // the tower: modal displacement at the top along (x) and across (y) the wind, and the damper's
    const f1 = 0.1; this.w = 2 * Math.PI * f1; this.zeta = 0.015;
    this.mu = 0.02; this.wd = this.w / (1 + this.mu); this.zd = Math.sqrt((3 * this.mu) / (8 * (1 + this.mu) ** 3));
    this.x = [0, 0]; this.v = [0, 0]; this.u = [0, 0]; this.ud = [0, 0];
    this.phase = 0; this.a = [0, 0]; this.top = [0, 0, 0]; this.peak = 0; this.t = 0;
    this.ca = 4.1e-4; this.cc = 0.35 * 4.1e-4;            // tower top displacement per (m/s)² along and across
    this.cab = null;
    this.Tin = 21;                                        // the building's air (°C)
    this.spread = 5.2;                                    // dew-point spread (K)
    this.car = { x: [0, 0], v: [0, 0], a: [0, 0], peak: 0, F: [0, 0], rail: [0, 0], railV: [0, 0] };
    this.ice = 0;                                         // rime on the car (kg)
    this.mr = { T: 15, heater: false, fan: false };
    this.season = 'autumn'; this.windName = 'normal';
  }

  /** The weather: wind at 10 m and the season (temperature and dew-point spread, so the cloud base). */
  setWeather({ v10, season }) {
    if (v10 !== undefined) { this.v10 = v10; this.windName = { 2: 'calm', 5.5: 'normal', 10: 'strong', 15: 'storm' }[v10] ?? `${v10} m/s`; }
    if (season) { const S = { autumn: [8, 5.2], winter: [-6, 3.0], summer: [24, 10] }[season]; this.season = season; this.T0 = S[0]; this.spread = S[1]; }
    this.Td = this.T0 - this.spread; this.cloudBase = 125 * this.spread; this.cloudTop = this.cloudBase + 320;
  }
  /** Stack effect: pressure across a landing door at height y (Pa, + pushes from the building into the hoistway). */
  stack(y) { const ri = (this.p(y) * 100) / (287.05 * (this.Tin + 273.15)); return 0.4 * (this.rho(y) - ri) * G * (y - this.H / 2); }

  T(y) { return this.T0 - 0.0065 * y; }
  p(y) { return this.p0 * Math.pow(1 - 2.25577e-5 * y, 5.25588); }
  rho(y) { return (this.p(y) * 100) / (287.05 * (this.T(y) + 273.15)); }
  /** Turbulence intensity: about 0.3 near a city's streets, 0.1 high above them. */
  I(y) { return Math.min(0.35, 0.3 * Math.pow(Math.max(y, 10) / 10, -0.27)); }
  mean(y) { return this.v10 * Math.pow(Math.max(y, 10) / 10, this.alpha); }
  /** The wind at height y now (m/s): mean times (1 + gust). */
  wind(y) { return Math.max(0, this.mean(y) * (1 + this.I(y) * this.n)); }
  inCloud(y) { return y > this.cloudBase && y < this.cloudTop; }

  /** dt (s); quake the ground's acceleration [x, , z] (an earthquake) or null; carY and carMoving for the car's air. */
  step(dt, quake, carY, carMoving, ex = {}) {
    this.t += dt;
    // gusts: an Ornstein-Uhlenbeck process, time scale ~ 12 s; the direction wanders slowly
    const g = () => { let s = 0; for (let i = 0; i < 6; i++) s += Math.random(); return (s - 3) / Math.sqrt(0.5); };
    this.n += (-this.n / 12) * dt + Math.sqrt((2 * dt) / 12) * g();
    this.nd += (-this.nd / 300) * dt + Math.sqrt((2 * dt) / 300) * g() * 0.15;
    const vt = this.wind(this.H), w = this.w, wd = this.wd;
    // forcing at the top: along the wind by v², across it by vortex shedding
    this.phase += 2 * Math.PI * ((0.12 * vt) / 33) * dt;
    const F = [w * w * this.ca * vt * vt, w * w * this.cc * vt * vt * Math.sin(this.phase)];
    const dir = this.dir + this.nd, cs = Math.cos(dir), sn = Math.sin(dir);
    // an earthquake shakes the base: the top feels about 1.4 times it (the first mode's participation)
    const qa = quake ? [-1.4 * (quake[0] * cs + quake[2] * sn), -1.4 * (-quake[0] * sn + quake[2] * cs)] : [0, 0];
    for (let k = 0; k < 2; k++) {
      const fd = this.mu * (2 * this.zd * wd * this.ud[k] + wd * wd * this.u[k]);     // the damper pulls on the tower
      const acc = F[k] + qa[k] - 2 * this.zeta * w * this.v[k] - w * w * this.x[k] + fd;
      this.v[k] += acc * dt; this.x[k] += this.v[k] * dt;
      const accD = -acc - 2 * this.zd * wd * this.ud[k] - wd * wd * this.u[k];       // the damper's mass, relative to the tower
      this.ud[k] += accD * dt; this.u[k] += this.ud[k] * dt;
      this.a[k] = acc;
    }
    // top-floor acceleration in world axes (x east, z south), and its peak over the last minute
    this.top = [this.a[0] * cs - this.a[1] * sn, 0, this.a[0] * sn + this.a[1] * cs];
    const mg = (Math.hypot(this.a[0], this.a[1]) / G) * 1000;
    this.peak = Math.max(mg, this.peak - dt * 0.2);
    // the car's air: the blowers hold its pressure change to 1.26 hPa/s; with the doors open it is the floor's
    const out = this.p(carY + 1.2);
    if (this.cab === null) this.cab = out;
    const lim = 1.26 * dt;
    this.cab = carMoving ? this.cab + Math.max(-lim, Math.min(lim, out - this.cab)) : this.cab + (out - this.cab) * Math.min(1, dt / 2);
    // ---- the wind on the car, its roller guides and the rail joints --------------------------------------
    const y = carY + 1.25, vw = this.wind(y), rho = this.rho(y), vc = ex.vc ?? 0, m = (ex.mass ?? 2500) + this.ice;
    // the tower shelters the car (on its south face) from a north wind: then it sits in the wake
    const shelter = Math.cos(dir) > 0.3 ? 0.35 : 1, q = 0.5 * rho * vw * vw * 1.2 * shelter;
    const C = this.car, Ff = [q * 4.9 * -sn, q * 6.2 * cs];                    // along the facade (x) and through it (z), N
    const k = 2.5e5, cz = 2 * 0.15 * Math.sqrt(k * m);                      // guide stiffness (N/m), damping
    const tau = 5 / Math.max(0.3, Math.abs(vc)), rough = 0.00015 * (1 + 2 * Math.min(1, this.ice / 20)) * Math.min(1, Math.abs(vc) / 2);
    for (let i = 0; i < 2; i++) {
      // the rails' alignment as the car runs over them: a random profile, 5 m sections
      C.railV[i] += (-C.railV[i] / tau) * dt + rough * Math.sqrt((2 * dt) / tau) * g() / Math.max(dt, 1e-3) * dt * 3;
      C.rail[i] += (C.railV[i] - C.rail[i] / tau) * dt;
      const acc = (Ff[i] - k * (C.x[i] - C.rail[i]) - cz * C.v[i]) / m;
      C.v[i] += acc * dt; C.x[i] += C.v[i] * dt; C.a[i] = acc; C.F[i] = k * (C.x[i] - C.rail[i]);
    }
    C.peak = Math.max((Math.hypot(C.a[0], C.a[1]) / G) * 1000, C.peak - dt * 2);
    // ---- rime on the car in freezing cloud; melting above 0 °C ------------------------------------------
    const Tc = this.T(y);
    if (this.inCloud(y) && Tc < 0) this.ice += 0.5 * 0.3e-3 * Math.max(vw, Math.abs(vc)) * 6.2 * shelter * dt;
    else if (Tc > 0.5) this.ice = Math.max(0, this.ice - 0.004 * Tc * dt);
    // ---- the machine room's air --------------------------------------------------------------------------
    const R = this.mr, Tout = this.T(this.H + 8), loss = 300 + 0.07 * Math.abs(ex.power ?? 0);
    if (R.T < 7) R.heater = true; else if (R.T > 10) R.heater = false;
    if (R.T > 30) R.fan = true; else if (R.T < 26) R.fan = false;
    R.T += ((loss + (R.heater ? 6000 : 0) - (R.fan ? 1500 : 300) * (R.T - Tout)) / 2e5) * dt;
  }

  /** The tower's sway acceleration at height y (world [x, 0, z], m/s²): the first mode's shape (y / H)^1.5. */
  accelAt(y) { const f = Math.pow(Math.max(0, Math.min(1, y / this.H)), 1.5); return [this.top[0] * f, 0, this.top[2] * f]; }
  /** Sway displacement of the top (m), along and across. */
  get sway() { return Math.hypot(this.x[0], this.x[1]); }
  get dirName() { const d = ((((this.dir + this.nd) * 180) / Math.PI) % 360 + 360) % 360; return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8]; }
}
