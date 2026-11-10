// What the tests share: an aeroplane in still, standard air, a clock, and a simple pilot.
import { Weather } from '../src/sim/atmosphere.js';
import { Aircraft } from '../src/sim/aircraft.js';
import { DEG, FT, clamp } from '../src/sim/util.js';

/** Still ISA air at sea level unless `wx` says otherwise. */
export function make(kind = 'ready', at = {}, wx = {}, nav) {
  const weather = new Weather({ windSpeed: 0, gust: 0, aloftSpeed: 0, turbulence: 0, oat: 15, dewpoint: 0, qnh: 101325, fieldElev: 0, ...wx });
  const ac = new Aircraft({ weather, nav });
  ac.reset(kind, { x: 0, z: 0, heading: 0, alt: 900, ...at });
  return ac;
}
/** Run for `secs`; `each(ac, t)` is called before every 1/60 s step. */
export function run(ac, secs, each) {
  const n = Math.round(secs * 60);
  for (let i = 0; i < n; i++) { ac.weather.step(1 / 60); each?.(ac, i / 60); ac.step(1 / 60); }
}
/** Full fuel, four people and bags: 2360 lb, close to the 2400 lb limit. */
export function loadUp(ac) { ac.payload.copilot = 80; ac.payload.rear = 77; ac.payload.baggage = 50; ac.fuel.tank = [58, 58]; }

/**
 * A pilot who keeps the wings level and the slip ball centred, and holds either an airspeed (`kias`, a number or a function of
 * time), an altitude (`alt`, ft) or a pitch attitude (`theta`, degrees) with the elevator. Returns the function to pass to run().
 */
export function pilot(o) {
  const s = { i: 0, ip: 0, ir: 0, ia: 0 }, dt = 1 / 60;
  return (a, t) => {
    let th;
    if (o.theta !== undefined) th = o.theta;
    else if (o.kias !== undefined) { const e = a.inst.kias - (typeof o.kias === 'function' ? o.kias(t) : o.kias); s.i = clamp(s.i + e * dt * 0.25, -12, 14); th = clamp(e * 0.6 + s.i, -15, 18); }
    else { const e = o.alt - a.altitude / FT; s.i = clamp(s.i + e * dt * 0.004, -6, 14); th = clamp(e * 0.03 + s.i - a.inst.vsFpm * 0.004, -8, 16); }
    const pe = th - a.pitch; s.ip = clamp(s.ip + pe * dt * 0.25, -1, 1);
    a.ctl.pitch = clamp(pe * 0.12 + s.ip - a.om.x / DEG * 0.03, -1, 1);
    const bank = o.bank ?? 0;
    s.ia = clamp(s.ia - (a.bank - bank) * dt * 0.02, -1, 1);
    a.ctl.roll = clamp(-(a.bank - bank) * 0.03 + s.ia + a.om.z / DEG * 0.01, -1, 1);
    s.ir = clamp(s.ir + a.beta * dt * 0.04, -1, 1);
    a.ctl.yaw = clamp(a.beta * 0.05 + s.ir + a.om.y / DEG * 0.03, -1, 1);
  };
}
