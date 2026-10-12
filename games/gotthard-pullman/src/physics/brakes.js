/**
 * The automatic air brake (UIC), plus the engine's direct brake.
 *
 * The driver's brake valve (self-lapping, like the FV4a used on Swiss engines) sets
 * the brake-pipe pressure: 5.0 bar is "released", every 0.1 bar below makes the
 * distributors put about 0.25 bar into the brake cylinders, 3.5 bar is a full
 * service application (3.8 bar in the cylinders), venting the pipe is the emergency
 * brake. Pressure changes run down the train at about 250 m/s and fill each
 * vehicle's share of the pipe, so the brakes come on from the front.
 *
 * Cast-iron blocks on the wheel treads: friction coefficient from the classic law
 * phi = 0.6 (16K+100)/(80K+100) * (V+100)/(5V+100), K the force per block in
 * tonnes-force, V in km/h (Russian traction rules; also given in the brake
 * literature cited in the README). The friction falls with speed and with block
 * force. What the blocks absorb heats them (energy is conserved): the kinetic and
 * potential energy of the train going into iron.
 */

export const BP_RUN = 5.0;          // bar gauge
export const BP_FULL = 3.5;
export const BC_MAX = 3.8;

export function blockFriction(kmh, Ktf) {
  const K = Math.max(0.05, Ktf);
  return 0.6 * ((16 * K + 100) / (80 * K + 100)) * ((kmh + 100) / (5 * kmh + 100));
}

export class AirBrake {
  /** vehicles: [{ name, length, brakeForce (N total block force at BC_MAX), blocks, direct: bool }] */
  constructor(vehicles) {
    this.v = vehicles.map((veh) => ({
      ...veh, pBP: BP_RUN, pBC: 0, pBCdirect: 0, tBlock: 0, heat: 0,
    }));
    this.handle = 'running';        // 'release' | 'running' | 'lap' | 'service' | 'emergency'
    this.serviceTarget = BP_RUN;    // BP target while in the service range (self-lapping)
    this.equalising = BP_RUN;       // the valve's control (equalising) reservoir
    this.direct = 0;                // engine's direct brake 0..1
    this.airDemand = 0;             // kg/s of air taken from the main reservoir
    this._tempInit = false;
  }

  /** The handle's service range: 0 = first stage (0.4 bar reduction), 1 = full service. */
  setService(x) { this.handle = 'service'; this.serviceTarget = BP_RUN - 0.4 - 1.1 * Math.max(0, Math.min(1, x)); }

  step(dt, pMR, ambientC) {
    const V = this.v;
    if (!this._tempInit) { for (const x of V) x.tBlock = ambientC; this._tempInit = true; }
    // ---- the driver's valve controls the equalising reservoir; the relay valve makes the pipe follow it
    let target = this.equalising, rate = 0;
    switch (this.handle) {
      case 'release': target = Math.min(BP_RUN + 0.4, pMR - 0.5); rate = 1.2; break;   // filling stroke: a little overcharge
      case 'running': target = BP_RUN; rate = 0.6; break;
      case 'lap': target = this.equalising; rate = 0; break;
      case 'service': target = this.serviceTarget; rate = 0.35; break;              // ~0.35 bar/s service reduction
      case 'emergency': target = 0; rate = 4; break;
    }
    if (target > this.equalising) target = Math.min(target, pMR - 0.3);
    const d = target - this.equalising;
    this.equalising += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    // the overcharge bleeds away slowly in running position
    // ---- pipe pressure along the train: each vehicle's section follows the one ahead (~250 m/s)
    let up = this.equalising, air = 0;
    for (let i = 0; i < V.length; i++) {
      const x = V[i];
      if (x.own && !this.helperCoupled) { x.pBP = 5.0; continue; }   // a light engine on its own brake
      const tau = Math.max(0.05, (x.length / 250) * 2.2);
      const prev = x.pBP;
      x.pBP += (up - x.pBP) * Math.min(1, dt / tau);
      if (x.pBP > prev) air += (x.pBP - prev) * (x.pipeVolume ?? 0.2) * 1e5 / (287 * 275);
      up = x.pBP;
    }
    // ---- distributors (UIC, passenger setting): graduated application and release
    for (const x of V) {
      const want = Math.max(0, Math.min(BC_MAX, (BP_RUN - x.pBP) * (BC_MAX / (BP_RUN - BP_FULL))));
      const tApply = x.pBP < 2.5 ? 3.5 : 4.5, tRelease = 17;
      const prev = x.pBC;
      if (want > x.pBC) x.pBC += Math.min(want - x.pBC, (BC_MAX / tApply) * dt * 1.6);
      else x.pBC -= Math.min(x.pBC - want, (BC_MAX / tRelease) * dt * 1.6);
      if (x.pBC > prev) air += 0; // the cylinder fills from the vehicle's own auxiliary reservoir (recharged from the pipe)
      if (x.direct) {
        const wd = BC_MAX * this.direct;
        x.pBCdirect += (wd - x.pBCdirect) * Math.min(1, dt / 1.5);
        if (wd > x.pBCdirect) air += 0.002 * dt;
      }
    }
    this.airDemand = air / Math.max(dt, 1e-6);
  }

  /**
   * Brake force on vehicle i (N, opposing motion), given its speed and the rail adhesion
   * limit; also heats its blocks. Returns { F, sliding }.
   */
  force(i, v, dt, normal, muRail, ambientC) {
    const x = this.v[i];
    const pc = Math.max(x.pBC, x.pBCdirect);
    const Ktot = x.brakeForce * (pc / BC_MAX);
    const Kblock = Ktot / Math.max(1, x.blocks) / 9806.65;     // tonnes-force per block
    const kmh = Math.abs(v) * 3.6;
    let F = Ktot * blockFriction(kmh, Kblock);
    // wheel slide: the blocks grip the wheel harder than the rail does
    const limit = muRail * normal;
    let sliding = false;
    if (F > limit && Math.abs(v) > 0.3) { F = limit * 0.6; sliding = true; }   // locked wheels skid at the kinetic level
    // block and tread temperature: absorbed power in, convection out (heat capacity ~0.3 MJ/K per vehicle)
    const P = F * Math.abs(v);
    const h = 60 + 25 * Math.abs(v);
    x.tBlock += ((P - h * (x.tBlock - ambientC)) / (x.heatCapacity ?? 3e5)) * dt;
    x.heat += P * dt;
    x.sliding = sliding;
    return { F, sliding };
  }
}
