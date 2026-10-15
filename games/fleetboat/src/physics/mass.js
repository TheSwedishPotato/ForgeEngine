/**
 * What the boat weighs and where: the centre of gravity and the moments of inertia that the
 * dynamics needs, rebuilt as the tanks fill and empty, the fuel is burnt (and replaced by sea
 * water), and the crew move about.
 *
 * The yard's tabulation of weights in normal diving trim (General Information Book A-1-a) gives
 * the loads; the light ship is what remains of 1,806.2 tons. Its centre is put where the whole
 * comes out at the yard's figures: centre of gravity 2.22 ft abaft frame 69, and high enough for
 * a transverse metacentric height of 1.49 ft on the surface (KG = KB + BM - GM = 10.91 ft).
 * The heavy machinery is placed where it is (the two batteries, the four engines and their
 * generators, the motors and reduction gears); the rest of the light ship (the hull's steel and
 * outfit) is spread along the length in proportion to the hull's sections.
 *
 * Then the 2026 refit: torpedoes, warheads, ammunition and the 4"/50 gun ashore; the owner's
 * acrylic observation deck on the main deck where the gun stood; lead in the keel, forward and
 * aft, so that she floats and dives in her old trim.
 */
import { HYDROSTATICS, WEIGHTS, FUEL_TANKS, STORES_TANKS, RHO_FUEL, BATTERY, MAIN_ENGINE, HULL, frameX, FT, LONG_TON, LB } from '../data/boat.js';
import { buildSlices } from './hull.js';

const YA = HULL.axisY;
const t = (tons) => tons * LONG_TON;
const ft = (f) => f * FT;

/** The owner's observation deck (estimates for the design; acrylic per ASME PVHO-1 practice). */
export const OBS_DECK = {
  x: ft(-2.0), axisY: ft(24.9),           // centre: on the hull top amidships, in a saddle through the deck
  rIn: 1.10, wall: 0.16, length: 4.0,      // inner radius, wall, length of the cylinder between the domes (m)
  acrylic: 1190,                            // kg/m^3
  fittings: 4.0e3, interior: 0.8e3,        // saddle, frames, trunk and hatch; floor, chairs, instruments (kg)
  get rOut() { return this.rIn + this.wall; },
  get volumeOut() { return Math.PI * this.rOut ** 2 * this.length + (4 / 3) * Math.PI * this.rOut ** 3; },
  get volumeIn() { return Math.PI * this.rIn ** 2 * this.length + (4 / 3) * Math.PI * this.rIn ** 3; },
  get mass() { return (this.volumeOut - this.volumeIn) * this.acrylic + this.fittings + this.interior; },
};

/**
 * Fixed loads in normal diving trim (tons, ft forward of frame 66 1/2, ft above keel).
 * Positions are where the stowage is (estimates within each compartment).
 */
const LOADS = [
  { name: 'Air, oil and water in the systems', tons: WEIGHTS.airOilWaterInSystem, x: -10, y: 8 },
  { name: 'Officers, men and effects', tons: WEIGHTS.officersMenEffects, x: 5, y: 14, crew: true },
  { name: 'Ammunition', tons: WEIGHTS.ammunition, x: 12, y: 7, refit: 'ashore' },
  { name: 'Torpedoes forward (16)', tons: WEIGHTS.torpedoes * 16 / 24, x: 100, y: 13, refit: 'ashore' },
  { name: 'Torpedoes aft (8)', tons: WEIGHTS.torpedoes * 8 / 24, x: -120, y: 14, refit: 'ashore' },
  { name: 'Provisions', tons: WEIGHTS.provisions, x: 12, y: 7 },
  { name: 'General stores', tons: WEIGHTS.generalStores, x: 0, y: 9 },
  { name: 'Lube oil', tons: WEIGHTS.lubeOil, x: -60, y: 6 },
  { name: 'Emergency provisions and water', tons: WEIGHTS.emergencyProvisions, x: 20, y: 10 },
  { name: 'Potable water (emergency tanks)', tons: WEIGHTS.potableWater - 4 * 3.67, x: 60, y: 9 },
];

/** Heavy machinery of the light ship (estimates of mass and place except the batteries). */
const MACHINERY = [
  { name: 'Forward battery (126 cells)', kg: BATTERY.cells * BATTERY.cellMass, x: 60.8, y: 6.2 },
  { name: 'After battery (126 cells)', kg: BATTERY.cells * BATTERY.cellMass, x: -8.2, y: 6.2 },
  { name: 'Main engines 1, 2 and generators', kg: 2 * (MAIN_ENGINE.wetWeight + 24000 * LB), x: -38, y: 8.5 },
  { name: 'Main engines 3, 4 and generators', kg: 2 * (MAIN_ENGINE.wetWeight + 24000 * LB), x: -65, y: 8.5 },
  { name: 'Auxiliary engine and generator', kg: 22000 * LB, x: -70, y: 5 },
  { name: 'Main motors and reduction gears', kg: 4 * 17000 * LB + 2 * 22000 * LB, x: -90, y: 5.5 },
];

const GUN_4IN = { name: '4"/50 gun and mount', kg: 9500 * LB, x: -2, y: 27.9 };   // estimate; GIB: axis 27'-11 7/8" above base

export class MassModel {
  constructor({ refit = true } = {}) {
    // ---- the light ship, solved from the yard's totals
    const total = HYDROSTATICS.displacementSurface;
    const xG = HYDROSTATICS.lcgSurface;               // m (x forward of frame 66 1/2)
    const kG = HYDROSTATICS.kbSurface + HYDROSTATICS.bmT - HYDROSTATICS.gmSurface;
    this.kGdesign = kG;
    const items = [];
    for (const l of LOADS) items.push({ ...l, kg: t(l.tons), x: ft(l.x), y: ft(l.y) });
    // the tanks' contents in normal diving trim (filled by the tank models; counted here for the balance)
    const tankLoads = [];
    // fuel: 175.5 tons of oil; the compensated tanks (outside the hull) are kept full with sea water
    for (const f of FUEL_TANKS) { const oil = f.volume * (WEIGHTS.fuelOil / 177.04); tankLoads.push({ kg: oil * RHO_FUEL + (f.inside ? 0 : (f.volume - oil) * 1025), x: f.x, y: f.y }); }
    for (const s of STORES_TANKS) if (s.id.startsWith('fw') || s.id.startsWith('bw')) tankLoads.push({ kg: s.volume * 1000, x: s.x, y: s.y });
    this.machinery = MACHINERY.map((m) => ({ ...m, x: ft(m.x), y: ft(m.y) }));
    let m = 0, mx = 0, my = 0;
    for (const it of [...items, ...tankLoads, ...this.machinery, { kg: GUN_4IN.kg, x: ft(GUN_4IN.x), y: ft(GUN_4IN.y) }]) { m += it.kg; mx += it.kg * it.x; my += it.kg * it.y; }
    // the variable ballast and the main ballast tanks' residual water, as the yard had them
    this.designVariable = WEIGHTS.variable;
    const variableTons = Object.values(WEIGHTS.variable).reduce((a, b) => a + b, 0);
    const residual = t(6.8);
    // (their moments: put at the variable tanks' centres)
    const vx = (2.5 * 98.35 + 2.2 * -120.75 + 3.7 * 113.18 + 18.4 * 0 + 11.1 * -139.11) / variableTons;
    m += t(variableTons) + residual; mx += t(variableTons) * ft(vx) + residual * ft(-6.4); my += t(variableTons) * ft(10) + residual * ft(1);
    const hullKg = total - m;
    const hullX = (total * xG - mx) / hullKg;
    const hullY = (total * kG - my) / hullKg;
    this.hull = { kg: hullKg, x: hullX, y: hullY };
    // spread along the length by the hull's sections (for the inertia), centred on hullX
    const slices = buildSlices(48);
    const wsum = slices.reduce((a, s) => a + s.area, 0);
    const sx = slices.reduce((a, s) => a + s.area * s.x, 0) / wsum;
    this.hullParts = slices.map((s) => ({ kg: hullKg * s.area / wsum, x: s.x - sx + hullX, y: hullY }));
    this.fixed = items;
    this.gun = { ...GUN_4IN, x: ft(GUN_4IN.x), y: ft(GUN_4IN.y) };
    this.refit = null;
    if (refit) this._refit();
    this.extra = [];                 // flood water, people, ... (set each step)
  }

  /** The 2026 refit: ashore what she no longer carries, the observation deck aboard, lead to keep her trim. */
  _refit() {
    let dm = 0, dmx = 0, dmy = 0;
    const ashore = this.fixed.filter((i) => i.refit === 'ashore');
    for (const i of ashore) { dm -= i.kg; dmx -= i.kg * i.x; dmy -= i.kg * i.y; }
    dm -= this.gun.kg; dmx -= this.gun.kg * this.gun.x; dmy -= this.gun.kg * this.gun.y;
    // the observation deck: its weight, and its own buoyancy (it is watertight: a displacement added)
    const D = OBS_DECK;
    const obsKg = D.mass;
    const obsBuoyKg = D.volumeOut * 1025;       // the extra weight the boat must carry to stay neutral
    dm += obsKg; dmx += obsKg * D.x; dmy += obsKg * D.axisY;
    // lead to make up: weight dm short plus the deck's displacement; two pigs, forward and aft, low in the keel
    const need = -dm + obsBuoyKg;
    const needMoment = -dmx + obsBuoyKg * D.x;  // keep the same centre of gravity relative to the buoyancy
    const xa = ft(85), xb = ft(-95), yl = ft(1.2);
    // a + b = need; a xa + b xb = needMoment
    const a = (needMoment - need * xb) / (xa - xb), b = need - a;
    this.fixed = this.fixed.filter((i) => i.refit !== 'ashore');
    this.gun = null;
    this.obsDeck = { kg: obsKg, x: D.x, y: D.axisY, volume: D.volumeOut };
    this.lead = [{ kg: a, x: xa, y: yl }, { kg: b, x: xb, y: yl }];
    this.refit = { ashoreKg: -dm + obsKg, obsKg, obsBuoyKg, leadKg: need, leadFwd: a, leadAft: b };
  }

  /**
   * Totals about the dynamics' origin (frame 66 1/2 on the pressure hull's axis).
   * extra: [{ kg, x, y, z }] (tank water, fuel, flood water, people), in boat coordinates (y above keel).
   */
  compute(extra) {
    let m = 0, sx = 0, sy = 0, sz = 0;
    let Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0;
    const add = (kg, x, y, z = 0, kr = 0) => {
      const yy = y - YA;
      m += kg; sx += kg * x; sy += kg * yy; sz += kg * z;
      Ixx += kg * (yy * yy + z * z + kr * kr); Iyy += kg * (x * x + z * z + kr * kr); Izz += kg * (x * x + yy * yy + kr * kr);
      Ixy -= kg * x * yy; Ixz -= kg * x * z; Iyz -= kg * yy * z;
    };
    // the hull's steel spread over its section (radius of gyration ~ the section's, 2.4 m)
    for (const p of this.hullParts) add(p.kg, p.x, p.y, 0, 2.4);
    for (const p of this.machinery) add(p.kg, p.x, p.y, 0, 1.0);
    for (const p of this.fixed) if (!p.crew) add(p.kg, p.x, p.y);
    if (this.gun) add(this.gun.kg, this.gun.x, this.gun.y);
    if (this.obsDeck) add(this.obsDeck.kg, this.obsDeck.x, this.obsDeck.y, 0, 1.0);
    if (this.lead) for (const p of this.lead) add(p.kg, p.x, p.y);
    for (const e of extra) add(e.kg, e.x, e.y, e.z ?? 0);
    return {
      m, rg: [sx / m, sy / m, sz / m],
      I: [[Ixx, Ixy, Ixz], [Ixy, Iyy, Iyz], [Ixz, Iyz, Izz]],
      kg: sy / m + YA, lcg: sx / m,
    };
  }

  /** The crew's nominal weight in the yard's figures (replaced by the real people at their places). */
  get crewNominal() { return this.fixed.find((i) => i.crew); }
}
