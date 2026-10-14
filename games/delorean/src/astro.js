/**
 * The sky's clockwork for any date the time circuits can show (year 1 to 9999):
 * the sun (NOAA's algorithm after Meeus), the moon (Meeus ch. 47, the larger terms),
 * the sidereal time that turns the stars, and California's clocks (Pacific time with
 * the daylight-saving rules of each period), so that 1:20 AM on 26 October 1985 at the
 * Twin Pines Mall is dark under a waxing gibbous moon, and 6:00 AM on 5 November 1955
 * at Peabody's farm is the first grey of dawn.
 *
 * Hill Valley is fictional; the films were shot round Los Angeles (Universal's
 * backlot, Whittier, Pasadena), so it is put there: 34.14 N, 118.13 W.
 *
 * World axes as in the Med Engine: X east, Y up, Z south.
 */

export const LAT = 34.14, LON = -118.13;
const RAD = Math.PI / 180;

// ---------------------------------------------------------------------------------------------
// civil time

/** Milliseconds of a UTC date-time for any year 1..9999 (Date.UTC maps 0..99 to the 1900s). */
export function utcMsOf(y, mo, d, h = 0, mi = 0, s = 0) {
  const t = new Date(Date.UTC(2000, mo - 1, d, h, mi, s));
  t.setUTCFullYear(y, mo - 1, d);
  return t.getTime();
}

/** Day of the week (0 Sunday) of a civil date. */
export function weekday(y, mo, d) { return new Date(utcMsOf(y, mo, d, 12)).getUTCDay(); }
function lastSunday(y, mo) { const n = daysInMonth(y, mo); return n - weekday(y, mo, n); }
function nthSunday(y, mo, k) { const first = (7 - weekday(y, mo, 1)) % 7 + 1; return first + 7 * (k - 1); }
export function daysInMonth(y, mo) { return new Date(utcMsOf(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1) - 86400000).getUTCDate(); }

/**
 * Daylight-saving time in California: [start month, start day, end month, end day] of a
 * year, or null. (Changes at 2 AM local.) From the Uniform Time Act and California's own
 * rules before it: war time 1918-19 and 1942-45; the state's summer time from 1948; the
 * 1974-75 energy-crisis years; the 1987 and 2007 changes.
 */
export function dstRule(y) {
  if (y === 1918 || y === 1919) return [3, lastSunday(y, 3), 10, lastSunday(y, 10)];
  if (y === 1942) return [2, 9, 12, 31];
  if (y >= 1943 && y <= 1944) return [1, 1, 12, 31];
  if (y === 1945) return [1, 1, 9, 30];
  if (y === 1948) return [3, 14, 12, 31];
  if (y === 1949) return [1, 1, 1, 1];
  if (y >= 1950 && y <= 1961) return [4, lastSunday(y, 4), 9, lastSunday(y, 9)];
  if (y >= 1962 && y <= 1973) return [4, lastSunday(y, 4), 10, lastSunday(y, 10)];
  if (y === 1974) return [1, 6, 10, lastSunday(y, 10)];
  if (y === 1975) return [2, 23, 10, lastSunday(y, 10)];
  if (y >= 1976 && y <= 1986) return [4, lastSunday(y, 4), 10, lastSunday(y, 10)];
  if (y >= 1987 && y <= 2006) return [4, nthSunday(y, 4, 1), 10, lastSunday(y, 10)];
  if (y >= 2007) return [3, nthSunday(y, 3, 2), 11, nthSunday(y, 11, 1)];
  return null;
}

/** Hours to add to UTC for Hill Valley's clocks on a local date-time. */
export function utcOffset(y, mo, d, h = 12) {
  // before the railways' standard time (18 November 1883): local mean time
  if (y < 1883 || (y === 1883 && (mo < 11 || (mo === 11 && d < 18)))) return LON / 15;
  const r = dstRule(y);
  if (!r) return -8;
  const k = mo * 100 + d + h / 100, a = r[0] * 100 + r[1] + 0.02, b = r[2] * 100 + r[3] + 0.02;
  return k >= a && k < b ? -7 : -8;
}

/**
 * A moment in Hill Valley: { y, mo, d, h, mi, s } local. Converts both ways with the UTC
 * milliseconds that drive the sky.
 */
export function localToUtc(t) {
  const off = utcOffset(t.y, t.mo, t.d, t.h);
  return utcMsOf(t.y, t.mo, t.d, t.h, t.mi, t.s ?? 0) - off * 3600000;
}
export function utcToLocal(ms) {
  // the offset depends on the local date; try the standard offset first, then correct
  let d = new Date(ms - 8 * 3600000);
  let off = utcOffset(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours());
  d = new Date(ms + off * 3600000);
  off = utcOffset(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours());
  d = new Date(ms + off * 3600000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() + d.getUTCMilliseconds() / 1000, offset: off };
}

// ---------------------------------------------------------------------------------------------
// the sun

export function julianDay(ms) { return ms / 86400000 + 2440587.5; }

/** Sun's elevation and azimuth (degrees; azimuth from north, clockwise) with refraction. */
export function sunPosition(ms, lat = LAT, lon = LON) {
  const jd = julianDay(ms);
  const T = (jd - 2451545.0) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps = obliquity(T) + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const ra = Math.atan2(Math.cos(eps * RAD) * Math.sin(lambda * RAD), Math.cos(lambda * RAD)) / RAD;
  return horizontal(ms, ra, decl, lat, lon, true, { lambda });
}

function obliquity(T) { return 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60; }

/** Greenwich mean sidereal time in degrees (Meeus 12.4). */
export function gmst(ms) {
  const jd = julianDay(ms), T = (jd - 2451545.0) / 36525;
  const g = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + T * T * (0.000387933 - T / 38710000);
  return ((g % 360) + 360) % 360;
}

/** Equatorial (RA, Dec in degrees) to horizontal at a place and time. */
export function horizontal(ms, ra, decl, lat = LAT, lon = LON, refract = true, extra = {}) {
  const ha = ((gmst(ms) + lon - ra) % 360 + 540) % 360 - 180;
  const sinEl = Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(ha * RAD);
  let el = Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD;
  const az = (Math.atan2(Math.sin(ha * RAD), Math.cos(ha * RAD) * Math.sin(lat * RAD) - Math.tan(decl * RAD) * Math.cos(lat * RAD)) / RAD + 180 + 360) % 360;
  if (refract && el > -2) el += 1.02 / Math.tan((el + 10.3 / (el + 5.11)) * RAD) / 60;
  return { elevation: el, azimuth: az, ra, declination: decl, hourAngle: ha, ...extra };
}

/** Unit vector toward a body in the renderer's world (X east, Y up, Z south). */
export function skyVector(pos, out = { x: 0, y: 0, z: 0 }) {
  const el = pos.elevation * RAD, az = pos.azimuth * RAD;
  out.x = Math.cos(el) * Math.sin(az);
  out.y = Math.sin(el);
  out.z = -Math.cos(el) * Math.cos(az);
  return out;
}

// ---------------------------------------------------------------------------------------------
// the moon (Meeus, Astronomical Algorithms, ch. 47: the principal periodic terms, good to
// a few arcminutes, plenty for a disc 0.5 degrees across)

const LR = [ // D, M, M', F, sum l (1e-6 deg), sum r (1e-3 km)
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
];
const B = [ // D, M, M', F, sum b (1e-6 deg)
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
];

/** The moon: horizontal position, distance (km) and the phase (illuminated fraction, 0 new .. 1 full). */
export function moonPosition(ms, lat = LAT, lon = LON) {
  const jd = julianDay(ms), T = (jd - 2451545.0) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T;
  const D = 297.8501921 + 445267.1114034 * T;
  const M = 357.5291092 + 35999.0502909 * T;
  const Mp = 134.9633964 + 477198.8675055 * T;
  const F = 93.2720950 + 483202.0175233 * T;
  const E = 1 - 0.002516 * T;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of LR) {
    const arg = (d * D + m * M + mp * Mp + f * F) * RAD;
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sl += l * e * Math.sin(arg); sr += r * e * Math.cos(arg);
  }
  for (const [d, m, mp, f, b] of B) {
    const arg = (d * D + m * M + mp * Mp + f * F) * RAD;
    const e = Math.abs(m) === 1 ? E : 1;
    sb += b * e * Math.sin(arg);
  }
  const lambda = Lp + sl / 1e6, beta = sb / 1e6, dist = 385000.56 + sr / 1000;
  const eps = obliquity(T) * RAD;
  const lr = lambda * RAD, br = beta * RAD;
  const ra = Math.atan2(Math.sin(lr) * Math.cos(eps) - Math.tan(br) * Math.sin(eps), Math.cos(lr)) / RAD;
  const decl = Math.asin(Math.sin(br) * Math.cos(eps) + Math.cos(br) * Math.sin(eps) * Math.sin(lr)) / RAD;
  // phase angle from the elongation (Meeus 48.2-48.3, low precision)
  const i = 180 - D - 6.289 * Math.sin(Mp * RAD) + 2.1 * Math.sin(M * RAD) - 1.274 * Math.sin((2 * D - Mp) * RAD)
    - 0.658 * Math.sin(2 * D * RAD) - 0.214 * Math.sin(2 * Mp * RAD) - 0.11 * Math.sin(D * RAD);
  const k = (1 + Math.cos(i * RAD)) / 2;
  // parallax: the moon seen from the ground sits lower by up to a degree
  const pos = horizontal(ms, ((ra % 360) + 360) % 360, decl, lat, lon, false);
  pos.elevation -= Math.asin(6378.14 / dist) / RAD * Math.cos(pos.elevation * RAD);
  if (pos.elevation > -2) pos.elevation += 1.02 / Math.tan((pos.elevation + 10.3 / (pos.elevation + 5.11)) * RAD) / 60;
  pos.distance = dist; pos.phase = k; pos.phaseAngle = ((i % 360) + 360) % 360;
  return pos;
}

/**
 * The rotation from the sky's equatorial frame to the world, as a column-major 3x3
 * (for the stars): an equatorial unit vector (x to RA 0h, z to the north celestial pole)
 * goes to world X east, Y up, Z south.
 */
export function equatorialToWorld(ms, lat = LAT, lon = LON) {
  const lst = (gmst(ms) + lon) * RAD, phi = lat * RAD;
  // a star at RA a, Dec d has hour angle H = lst - a. Local horizon: north component
  // n = cos(phi) sin(d) - sin(phi) cos(d) cos(H), east e = -cos(d) sin(H),
  // up u = sin(phi) sin(d) + cos(phi) cos(d) cos(H).
  // With x = cos d cos a, y = cos d sin a, z = sin d: cos d cos H = x cos lst + y sin lst,
  // cos d sin H = x sin lst - y cos lst.
  const cl = Math.cos(lst), sl = Math.sin(lst), cp = Math.cos(phi), sp = Math.sin(phi);
  // world = (east, up, -north)
  const ex = [-sl, cl, 0];
  const up = [sp * 0 + cp * cl, cp * sl, sp];
  const no = [-sp * cl, -sp * sl, cp];
  // columns: images of the equatorial x, y, z axes
  return [ex[0], up[0], -no[0], ex[1], up[1], -no[1], ex[2], up[2], -no[2]];
}

/** Illuminance of the sun's and the moon's direct light in the engine's units (1 = 10 000 lux). */
export function moonIlluminance(moon) {
  // full moon at the zenith ~0.27 lux; the phase law of Allen (opposition surge ignored)
  const a = moon.phaseAngle > 180 ? 360 - moon.phaseAngle : moon.phaseAngle;
  const mag = -12.73 + 0.026 * a + 4e-9 * a ** 4;
  const lux = 0.27 * Math.pow(10, -0.4 * (mag + 12.73));
  return lux / 10000;
}
