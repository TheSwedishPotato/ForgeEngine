/**
 * The boat's physical plant, stepped together: the hull in the sea (dynamics.js), the mass that
 * moves about in it (mass.js), the ballast tanks (tanks.js), the compressed air (air.js), and the
 * rest of the machinery as it is added (trim, hydraulics, electric drive, engines, atmosphere,
 * flooding). Nothing here decides anything: valves and levers are where hands (the crew's or
 * yours) have put them.
 */
import { HULL, FUEL_TANKS, STORES_TANKS, RHO_FUEL, FT, WEIGHTS } from '../data/boat.js';
import { Dynamics, deckHeight, YA } from './dynamics.js';
import { MassModel, OBS_DECK } from './mass.js';
import { makeTanks } from './tanks.js';
import { AirSystem } from './air.js';
import { ATM, G } from './units.js';
import { fromAttitude } from './vec.js';

export class Boat {
  constructor({ refit = true } = {}) {
    this.mass = new MassModel({ refit });
    this.dyn = new Dynamics();
    if (refit) this._addObsDeckToHull();
    this.tanks = makeTanks();
    this.tank = Object.fromEntries(this.tanks.map((t) => [t.id, t]));
    this.air = new AirSystem();
    // fuel: the normal fuel oil tanks full (175.5 tons), compensated with sea water as it burns
    const scale = WEIGHTS.fuelOil / 177.04;
    this.fuel = FUEL_TANKS.map((f) => ({ ...f, oil: f.volume * scale }));
    this.stores = STORES_TANKS.map((s) => ({ ...s, water: s.id.startsWith('fw') || s.id.startsWith('bw') ? s.volume : 0 }));
    this.people = [];             // { kg, x, y, z } set by the crew model
    this.extraMass = [];          // flood water and the like: { kg, x, y, z }
    this.time = 0;
    this._massDirty = 0;
    this.massProps = null;
  }

  /** The observation deck displaces water: its cylinder and domes go into the hull's slices. */
  _addObsDeckToHull() {
    const D = OBS_DECK, yc = D.axisY - YA;
    const x0 = D.x - D.length / 2 - D.rOut, x1 = D.x + D.length / 2 + D.rOut;
    for (const s of this.dyn.slices) {
      if (s.x < x0 || s.x > x1) continue;
      const dxEnd = Math.max(0, Math.abs(s.x - D.x) - D.length / 2);
      const r = Math.sqrt(Math.max(0, D.rOut ** 2 - dxEnd ** 2));
      if (r < 0.05) continue;
      const poly = [];
      for (let i = 0; i < 20; i++) { const a = -Math.PI / 2 + (i / 20) * 2 * Math.PI; poly.push([r * Math.cos(a), yc + r * Math.sin(a)]); }
      s.polys.push(poly);
      s.area += Math.PI * r * r;
      s.ymax = Math.max(s.ymax, yc + r);
    }
    this.dyn._vol = null;
  }

  /** Sets the variable ballast (tons in each tank) and the main ballast state. */
  setBallast({ variable = WEIGHTS.variable, mbt = 'dry', safety = 0, negative = 0 } = {}) {
    const rhoT = 1025;
    const v = { fwdWRT: variable.fwdWRT, aftWRT: variable.aftWRT, fwdTrim: variable.fwdTrim, aux1: variable.aux / 2, aux2: variable.aux / 2, aftTrim: variable.aftTrim };
    for (const tk of this.tanks) {
      if (tk.kind === 'variable') tk.set(Math.min(1, (v[tk.id] ?? 0) * 1016.05 / rhoT / tk.volume), ATM);
    }
    this._mbtState = { mbt, safety, negative };
  }

  /** Puts the boat at a place: keel depth (m) of the origin's frame, heading (rad). */
  place({ x = 0, z = 0, keelDepth = HULL.innerHullTop * 0 + 4.65, heading = 0, pitch = 0, heel = 0 } = {}) {
    const d = this.dyn;
    d.q = fromAttitude(heading, pitch, heel);
    d.pos = [x, -keelDepth + YA, z];
    d.v = [0, 0, 0]; d.w = [0, 0, 0];
  }

  /** Initial tank air: each tank's bubble at its port pressure (dry) or flooded. */
  initTanks(sea) {
    const st = this._mbtState ?? { mbt: 'dry' };
    for (const tk of this.tanks) {
      if (tk.kind === 'variable') continue;
      const env = this.tankEnv(tk, sea);
      const flooded = tk.kind === 'safety' ? st.safety : tk.kind === 'negative' ? st.negative : st.mbt === 'flooded' ? 1 : 0;
      if (flooded >= 1) tk.set(1, env.pPort);
      else tk.set(0, env.pPort);
    }
  }

  /** The sea around one tank: pressure at its flood ports and at the outlet of its vent. */
  tankEnv(tk, sea) {
    const d = this.dyn;
    const port = d.toWorld([tk.x, tk.y0 - YA, tk.zOff]);
    const etaP = sea.eta(port[0], port[2]);
    const depthP = etaP - port[1];
    const vent = d.toWorld([tk.x, deckHeight(tk.x / FT) * FT - YA, 0]);
    const etaV = sea.eta(vent[0], vent[2]);
    const depthV = etaV - vent[1];
    const col = sea.column;
    return {
      pPort: depthP > 0 ? col.pressureAt(depthP) : ATM,
      ventOutlet: depthV > 0 ? col.pressureAt(depthV) : ATM,
      ventInAir: depthV <= 0,
      rho: col.densityAt(Math.max(0, depthP)),
      T: 273.15 + col.temperatureAt(Math.max(0, depthP)),
      depthPort: depthP,
    };
  }

  /** Everything that weighs and moves with the tanks, the fuel, the people. */
  massItems() {
    const out = [];
    for (const tk of this.tanks) if (tk.water > 0) out.push({ kg: tk.water * (tk.kind === 'variable' ? 1025 : this._rhoSea ?? 1025), x: tk.x, y: tk.y0 + tk.level / 2, z: tk.zOff });
    for (const f of this.fuel) {
      const water = f.volume - f.oil;
      out.push({ kg: f.oil * RHO_FUEL + (f.inside ? 0 : water * 1025), x: f.x, y: f.y });
    }
    for (const s of this.stores) if (s.water > 0) out.push({ kg: s.water * 1000, x: s.x, y: s.y });
    for (const p of this.people) out.push(p);
    for (const e of this.extraMass) out.push(e);
    return out;
  }

  /**
   * The diving officer's compensation (the daily trim sheet): the variable ballast that makes her
   * neutral and level when submerged at `depth` (m, keel) in this sea, with the main ballast and
   * safety tanks flooded and negative blown to the mark. Weight from the auxiliary tanks (amidships),
   * moment by moving water between the forward and after trim tanks. Returns the changes (tons).
   */
  compensate(sea, depth = 60 * FT) {
    const rho = sea.column.densityAt(Math.max(1, depth - YA));      // at the hull's axis
    const keep = this.tanks.map((tk) => [tk, tk.water, tk.n]);
    for (const tk of this.tanks) {
      if (tk.kind === 'mbt' || tk.kind === 'fbt' || tk.kind === 'safety' || tk.kind === 'bowBuoyancy') tk.water = tk.volume;
      if (tk.kind === 'negative') tk.water = 0;
    }
    this._rhoSea = rho;
    let V = 0, xB = 0;
    for (const s of this.dyn.slices) { V += s.area * s.dx; xB += s.area * s.dx * s.x; }
    xB /= V;
    const T = this.tank, rhoT = 1025;
    const res = { aux: 0, fwdTrim: 0, aftTrim: 0 };
    for (let it = 0; it < 4; it++) {
      const m = this.mass.compute(this.massItems());
      const dW = rho * V - m.m;                       // kg to take on (+) or pump off (-)
      const dM = rho * V * xB - m.m * m.lcg;          // moment still wanted (kg m); the auxiliary tanks sit amidships
      const auxRoom = T.aux1.volume + T.aux2.volume;
      const aux = Math.max(0, Math.min(auxRoom, T.aux1.water + T.aux2.water + dW / rhoT));
      res.aux += (aux - T.aux1.water - T.aux2.water) * rhoT / 1016;
      T.aux1.water = T.aux2.water = aux / 2;
      // move d m^3 from aft to forward trim (or back)
      const d = dM / (rhoT * (T.fwdTrim.x - T.aftTrim.x));
      const dd = Math.max(-T.fwdTrim.water, Math.min(T.aftTrim.water, d));
      T.fwdTrim.water += dd; T.aftTrim.water -= dd;
      res.fwdTrim += dd * rhoT / 1016; res.aftTrim -= dd * rhoT / 1016;
    }
    // put the other tanks back as they were
    for (const [tk, w, n] of keep) if (tk.kind !== 'variable') { tk.water = w; tk.n = n; }
    this.massProps = null;
    return res;
  }

  updateMass() {
    this.massProps = this.mass.compute(this.massItems());
    return this.massProps;
  }

  /** One physics step of dt seconds. */
  step(dt, sea, { screws = [{ T: 0 }, { T: 0 }], blow = {} } = {}) {
    this.time += dt;
    // the tanks
    let toBoat = 0, fromSupply = 0;
    const bySupply = {};
    for (const tk of this.tanks) {
      if (tk.kind === 'variable') continue;
      const env = this.tankEnv(tk, sea);
      this._rhoSea = env.rho;
      env.pBoat = this.pBoat ?? ATM;
      const b = blow[tk.id];
      if (b) { env.blow = b.supply; env.blowOpen = b.open; }
      const r = tk.step(dt, env);
      toBoat += r.toBoat; fromSupply += r.fromSupply;
      if (b && r.fromSupply) bySupply[b.line ?? 'hp'] = (bySupply[b.line ?? 'hp'] ?? 0) + r.fromSupply;
    }
    this.tankFlows = { toBoat, fromSupply, bySupply };
    if (!this.massProps || (this._massDirty++ % 6) === 0) this.updateMass();
    const out = this.dyn.step(dt, { mass: this.massProps, sea, screws });
    return out;
  }
}

export { G };
