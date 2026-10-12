/**
 * The weather on the line, as physics: air temperature and density along the
 * climb, wind, falling snow, snow lying on the rails, and the state of the rail
 * head that sets the adhesion. Inside the tunnels the rails stay dry and the air
 * is milder; near the portals they are damp.
 *
 * Presets are typical December situations in the Reuss valley (MeteoSwiss
 * climate normals for Altdorf and Andermatt guide the temperatures; see README).
 */

export const PRESETS = {
  clear: {
    label: 'Clear and frosty', desc: 'High pressure, a cold clear day. Hoar frost on the rails in the shaded gorge, sun on the peaks.',
    tempErstfeld: -3, tempGoeschenen: -9, wind: 1.5, windFrom: 0, snowfall: 0, visibility: 60000, cloud: 0.05,
    rail: 'frost', railSun: 'dry', snowOnRail: 0, groundSnowValley: 0.10, groundSnowHigh: 0.55, qnh: 1031,
  },
  snowfall: {
    label: 'Light snow', desc: 'Overcast with steady light snow. Snow settling on the railheads between trains.',
    tempErstfeld: -1, tempGoeschenen: -6, wind: 3, windFrom: 315, snowfall: 0.6, visibility: 2500, cloud: 1.0,
    rail: 'snow', railSun: 'snow', snowOnRail: 0.01, groundSnowValley: 0.18, groundSnowHigh: 0.70, qnh: 1012,
  },
  heavy: {
    label: 'Heavy snowfall', desc: 'A northern Stau: heavy snow, 3 cm an hour, poor visibility, the rails buried between ploughs.',
    tempErstfeld: -2, tempGoeschenen: -8, wind: 6, windFrom: 340, snowfall: 3.0, visibility: 350, cloud: 1.0,
    rail: 'snow', railSun: 'snow', snowOnRail: 0.04, groundSnowValley: 0.35, groundSnowHigh: 1.10, qnh: 1004,
  },
  foehn: {
    label: 'Föhn', desc: 'Warm south wind gusting down the valley. Thawing snow, wet rails, crystal-clear air.',
    tempErstfeld: 9, tempGoeschenen: 4, wind: 14, windFrom: 180, snowfall: 0, visibility: 80000, cloud: 0.35,
    rail: 'wet', railSun: 'wet', snowOnRail: 0, groundSnowValley: 0.0, groundSnowHigh: 0.45, qnh: 1001,
  },
  fog: {
    label: 'Freezing fog', desc: 'Low cloud filling the valley at minus seven. Rime on every twig and wire, glaze on the rails.',
    tempErstfeld: -7, tempGoeschenen: -6, wind: 1, windFrom: 0, snowfall: 0, visibility: 150, cloud: 1.0, fog: true,
    rail: 'ice', railSun: 'ice', snowOnRail: 0, groundSnowValley: 0.15, groundSnowHigh: 0.60, qnh: 1026,
  },
  blizzard: {
    label: 'Blizzard', desc: 'North wind and driving snow at minus fourteen. Drifts on the line.',
    tempErstfeld: -9, tempGoeschenen: -15, wind: 13, windFrom: 0, snowfall: 2.0, visibility: 200, cloud: 1.0,
    rail: 'snow', railSun: 'snow', snowOnRail: 0.06, groundSnowValley: 0.40, groundSnowHigh: 1.30, qnh: 998,
  },
};

const Z_ERSTFELD = 472, Z_GOESCHENEN = 1106;

export class Weather {
  constructor(route, preset = 'clear', overrides = {}) {
    this.route = route;
    this.set(preset, overrides);
    this._cache = new Map();
    this.time = 0;
  }

  set(preset, overrides = {}) {
    this.name = preset;
    this.p = { ...PRESETS[preset] ?? PRESETS.clear, ...overrides };
    this._cache = new Map();
  }

  /** Air temperature at height z (m), linear between the two stations' values, lapse beyond. */
  tempAt(z) {
    const p = this.p, t = (z - Z_ERSTFELD) / (Z_GOESCHENEN - Z_ERSTFELD);
    return p.tempErstfeld + (p.tempGoeschenen - p.tempErstfeld) * t;
  }

  /** Air density (kg/m³) at height z: barometric formula from QNH, ideal gas. */
  rhoAt(z, tempC) {
    const p0 = (this.p.qnh ?? 1013.25) * 100;
    const P = p0 * Math.pow(1 - 2.25577e-5 * z, 5.25588);
    return P / (287.05 * (tempC + 273.15));
  }

  /** Conditions at chainage s on the running path. */
  at(s, t) {
    const key = Math.round(s / 10);
    let c = this._cache.get(key);
    if (c) return c;
    s = key * 10;   // the cell's own centre, so the answer does not depend on who asked first
    const R = this.route, z = R.run.pos(s).z, p = this.p;
    const tun = R.inTunnel(s);
    let tempC = this.tempAt(z);
    let rail = p.rail;
    if (tun) {
      const depth = Math.min(s - tun.s0, tun.s1 - s);
      const inner = Math.min(1, depth / 250);
      tempC = tempC + (2 - tempC) * inner * 0.7;      // rock-warmed air deep inside
      rail = depth < 60 ? (p.rail === 'wet' ? 'wet' : 'damp') : 'dry';
    }
    c = {
      tempC, rho: this.rhoAt(z, tempC), wind: tun ? 0.5 : p.wind, windFrom: (p.windFrom * Math.PI) / 180,
      rail, tunnel: !!tun, snowOnRail: tun ? 0 : p.snowOnRail, cleaned: 0,
    };
    this._cache.set(key, c);
    return c;
  }
}
