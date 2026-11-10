/**
 * The radio stack: a NAV/COM, the course deviation indicator it drives, and a transponder. Stations transmit from real places on
 * the map; reception is line-of-sight; the needles are worked out from where the aeroplane actually is relative to the
 * station's radial or the localiser and glide-slope beams.
 */
import { DEG, NM, FT, clamp, wrap360, wrapPi, lag, rng } from './util.js';

const brg = (fx, fz, tx, tz) => wrap360(Math.atan2(tx - fx, -(tz - fz)) / DEG);      // true bearing from f to t

export class Radios {
  /** @param {object} nav { vor: [{id, freq, x, z, y}], ils: [{id, freq, course, loc:{x,z}, gs:{x,z,y}, angle}], com: [{id, freq, x, z, kind}] } */
  constructor(nav, o = {}) {
    this.db = nav; this.magVar = o.magVar ?? 7; this.rand = rng(5);
    this.com = { on: false, vol: 0.6, active: 122.8, standby: nav.com?.[0]?.freq ?? 126.025, squelch: false };
    this.nav = { on: false, vol: 0.4, active: nav.ils?.[0]?.freq ?? 110.3, standby: nav.vor?.[0]?.freq ?? 113.9, ident: false };
    this.obs = 276;
    this.xpdr = { mode: 0, code: [7, 0, 0, 0], ident: 0, reply: false, _next: 3 };    // 0 OFF 1 SBY 2 ON 3 ALT 4 TST
    this.cdi = { needle: 0, gs: 0, toFrom: 0, navFlag: true, gsFlag: true, id: '', dme: 0, isLoc: false };
    this.heard = null;             // the COM station being received, if any
    this.elt = false;
  }
  tune(radio, part, steps) {
    const r = this[radio], isCom = radio === 'com';
    let mhz = Math.floor(r.standby + 1e-6), khz = Math.round((r.standby - mhz) * 1000);
    if (part === 'mhz') mhz = isCom ? 118 + (((mhz - 118 + steps) % 19) + 19) % 19 : 108 + (((mhz - 108 + steps) % 10) + 10) % 10;
    else khz = ((khz + steps * (isCom ? 25 : 50)) % 1000 + 1000) % 1000;
    r.standby = mhz + khz / 1000;
  }
  swap(radio) { const r = this[radio]; [r.active, r.standby] = [r.standby, r.active]; }

  step(dt, ac) {
    const e = ac.elec, x = ac.pos.x, z = ac.pos.z, y = ac.pos.y, c = this.cdi;
    const los = (sx, sz, sy = 0) => {            // radio horizon
      const d = Math.hypot(sx - x, sz - z);
      return d < 1.23 * NM * (Math.sqrt(Math.max(y, 0) / FT) + Math.sqrt(Math.max(sy, 8) / FT)) && d < 45 * NM;
    };
    // ---- NAV receiver
    const navOn = this.nav.on && e.has('RADIO1', true);
    let needle = 0, gs = 0, toFrom = 0, navFlag = true, gsFlag = true, id = '', isLoc = false, dme = 0;
    if (navOn) {
      const f = this.nav.active;
      const vor = this.db.vor.find((s) => Math.abs(s.freq - f) < 0.01), ils = this.db.ils.find((s) => Math.abs(s.freq - f) < 0.01);
      if (vor && los(vor.x, vor.z, vor.y)) {
        const dist = Math.hypot(x - vor.x, z - vor.z), radial = brg(vor.x, vor.z, x, z) - this.magVar;
        const dev = (radial - this.obs) * DEG, cone = Math.atan2(y - vor.y, dist) > 60 * DEG;
        id = vor.id; dme = Math.hypot(dist, y - vor.y);
        if (!cone) {
          navFlag = false;
          needle = clamp(-Math.asin(Math.sin(dev)) / (10 * DEG), -1.2, 1.2);
          toFrom = Math.abs(Math.cos(dev)) < 0.09 ? 0 : Math.cos(dev) > 0 ? -1 : 1;
        }
      } else if (ils && los(ils.loc.x, ils.loc.z)) {
        const d = wrapPi((brg(ils.loc.x, ils.loc.z, x, z) - (ils.course + 180)) * DEG);
        id = ils.id; isLoc = true;
        if (Math.abs(d) < 35 * DEG && Math.hypot(x - ils.loc.x, z - ils.loc.z) < 25 * NM) {
          navFlag = false; needle = clamp(d / (ils.width * DEG), -1.2, 1.2);
          const dg = Math.hypot(x - ils.gs.x, z - ils.gs.z), ang = Math.atan2(y - ils.gs.y, dg);
          if (Math.abs(d) < 8 * DEG && dg < 10 * NM && ang > 0.5 * DEG && ang < 6 * DEG) { gsFlag = false; gs = clamp((ils.angle * DEG - ang) / (0.7 * DEG), -1.2, 1.2); }
        }
      }
    }
    const k = lag(dt, 0.35);
    c.needle += (needle - c.needle) * k; c.gs += (gs - c.gs) * k;
    c.toFrom = toFrom; c.navFlag = navFlag; c.gsFlag = gsFlag; c.id = id; c.isLoc = isLoc; c.dme = dme;

    // ---- COM receiver
    this.heard = null;
    if (this.com.on && e.has('RADIO1', true)) {
      const s = this.db.com.find((st) => Math.abs(st.freq - this.com.active) < 0.006);
      if (s && los(s.x, s.z, 15)) this.heard = s;
      if (this.elt && Math.abs(this.com.active - 121.5) < 0.006) this.heard = { id: 'ELT', kind: 'elt' };
    }

    // ---- transponder: replies when a radar sweeps it
    const xp = this.xpdr, xOn = xp.mode >= 2 && e.has('RADIO2', true);
    if (xp.ident > 0) xp.ident -= dt;
    xp._next -= dt;
    if (xp._next < -0.12) xp._next = 2 + this.rand() * 6;
    xp.reply = e.has('RADIO2', true) && (xp.mode === 4 || (xOn && (xp.ident > 0 || (xp._next < 0 && y > 150))));
  }
}
