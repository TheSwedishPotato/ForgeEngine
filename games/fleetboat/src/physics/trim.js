/**
 * The trim and drain systems (Fleet Type Submarine chapter 10; NavPers 16166).
 *
 * The trim manifold on the control room's port side has, for every variable tank and for the sea,
 * a valve to the suction line and a valve to the discharge line. The trim pump in the pump room
 * (a centrifugal pump, primed first by its priming pump to 21 inches of vacuum) takes from the
 * suction line and delivers to the discharge line. Open forward trim's suction and after trim's
 * discharge, start the pump: water goes aft. Open the sea's suction and auxiliary's discharge
 * with the pump stopped: the sea floods the auxiliary tank by its own pressure ("flood auxiliary
 * from sea"). Pumping to sea at depth needs the pump's stages in series (twice the pressure,
 * half the flow), as the manual has it below about 250 feet; the test depth of 400 feet was set
 * by what the pump could still do there.
 *
 * Pump curves (estimates, in the class's terms): parallel, 300 gpm free delivery, shut-off
 * 110 psi; series, 150 gpm, shut-off 220 psi. Q = Q0 sqrt(1 - H / H0).
 *
 * The drain pump (a duplex reciprocating pump, positive displacement) takes the bilges to sea:
 * 75 gpm up to its relief at 250 psi (estimate).
 */
import { GAL, PSI } from '../data/boat.js';
import { G } from './units.js';
import { waterFlowSmooth } from './gas.js';

export const TRIM_NODES = ['fwdTrim', 'fwdWRT', 'aux1', 'aux2', 'aftWRT', 'aftTrim', 'negative', 'safety', 'sea'];
const LINE_CdA = 1.6e-3;          // a 2 1/2" trim line with its valves (estimate)

export class TrimSystem {
  constructor() {
    this.suction = Object.fromEntries(TRIM_NODES.map((n) => [n, 0]));
    this.discharge = Object.fromEntries(TRIM_NODES.map((n) => [n, 0]));
    this.pump = false;
    this.series = false;
    this.primed = 0;               // 0..1, the priming pump drawing the air out
    this.priming = false;
    this.flow = 0;                 // m^3/s moved by the pump (for the gauges and the log)
    this.drainPump = false;
    this.drainFlow = 0;
    this.moved = {};               // m^3 by node this step (for the tank models)
  }

  pumpCurve(head) {
    const Q0 = (this.series ? 150 : 300) * GAL / 60, H0 = (this.series ? 220 : 110) * PSI;
    if (head >= H0) return 0;
    return Q0 * Math.sqrt(Math.max(0, 1 - Math.max(0, head) / H0));
  }

  /**
   * Moves water between the tanks and the sea. nodes: { id: { p: pressure at its connection (Pa),
   * water (m^3) available, room (m^3) it can take } }. Returns { id: dV } (m^3, + into the node).
   */
  step(dt, nodes, rho) {
    const out = Object.fromEntries(TRIM_NODES.map((n) => [n, 0]));
    if (this.priming) this.primed = Math.min(1, this.primed + dt / 25);
    if (!this.pump && !this.priming) this.primed = Math.max(0, this.primed - dt / 600);
    const S = TRIM_NODES.filter((n) => this.suction[n] > 0.5 && nodes[n]);
    const D = TRIM_NODES.filter((n) => this.discharge[n] > 0.5 && nodes[n]);
    this.flow = 0;
    if (this.pump && this.primed > 0.9 && S.length && D.length) {
      const pS = Math.min(...S.map((n) => nodes[n].p)), pD = Math.max(...D.map((n) => nodes[n].p));
      let Q = this.pumpCurve(pD - pS) * dt;
      const avail = S.reduce((a, n) => a + nodes[n].water, 0), room = D.reduce((a, n) => a + nodes[n].room, 0);
      Q = Math.min(Q, avail, room);
      for (const n of S) out[n] -= Q * (nodes[n].water / Math.max(1e-9, avail));
      for (const n of D) out[n] += Q * (nodes[n].room / Math.max(1e-9, room));
      this.flow = Q / dt;
    } else if (!this.pump) {
      // no pump: water finds its own way, from the higher pressure to the lower, along the lines and
      // through the idle centrifugal pump between them ("flood auxiliary from sea": the sea's
      // suction and the auxiliary tank's discharge open, the pump stopped)
      const line = [...new Set([...S, ...D])];
      {
        if (line.length < 2) return (this.moved = out);
        const hi = line.reduce((a, n) => (nodes[n].p > nodes[a].p ? n : a), line[0]);
        for (const n of line) {
          if (n === hi) continue;
          let Q = waterFlowSmooth(LINE_CdA, nodes[hi].p - nodes[n].p, rho) * dt;
          Q = Math.max(0, Math.min(Q, nodes[hi].water, nodes[n].room));
          out[hi] -= Q; out[n] += Q;
        }
      }
    }
    this.moved = out;
    return out;
  }

  /** The drain pump: bilge water (m^3 available) out against the sea's pressure. Returns m^3 pumped. */
  drain(dt, available, pSea, pBoat) {
    this.drainFlow = 0;
    if (!this.drainPump || available <= 0) return 0;
    if (pSea - pBoat > 250 * PSI) return 0;
    const q = Math.min(available, (75 * GAL / 60) * dt);
    this.drainFlow = q / dt;
    return q;
  }
}

export { G };
