/**
 * Where the sun is: the NOAA solar position algorithm (after Meeus, "Astronomical
 * Algorithms"), good to a hundredth of a degree for this century, with the standard
 * refraction correction near the horizon.
 *
 * On Friday 11 December 2026 at Gurtnellen (46.74 N, 8.63 E) the sun culminates at
 * about 12:19 CET only some 20 degrees high, so the deep valley floor stays in the
 * shadow of its own mountains for most of the day.
 */

const RAD = Math.PI / 180;

/** Julian day of a UTC time in milliseconds. */
export function julianDay(ms) { return ms / 86400000 + 2440587.5; }

/**
 * Sun position for a UTC time (ms) at latitude/longitude (degrees, east positive).
 * Returns { elevation, azimuth } in degrees (azimuth from north, clockwise), plus
 * the declination and the equation of time (minutes).
 */
export function sunPosition(ms, lat, lon) {
  const jd = julianDay(ms);
  const T = (jd - 2451545.0) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  const d = new Date(ms);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000;
  let tst = (minutes + eqTime + 4 * lon) % 1440;
  if (tst < 0) tst += 1440;
  let ha = tst / 4 - 180;
  if (ha < -180) ha += 360;
  const cosZen = Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(ha * RAD);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen))) / RAD;
  let elev = 90 - zen;
  // refraction (NOAA's piecewise fit)
  let refr = 0;
  if (elev < 85) {
    const te = Math.tan(elev * RAD);
    if (elev > 5) refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (elev > -0.575) refr = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
    else refr = -20.772 / te;
    refr /= 3600;
  }
  elev += refr;
  const az = (Math.atan2(Math.sin(ha * RAD), Math.cos(ha * RAD) * Math.sin(lat * RAD) - Math.tan(decl * RAD) * Math.cos(lat * RAD)) / RAD + 180 + 360) % 360;
  return { elevation: elev, azimuth: az, declination: decl, eqTime };
}

/** Unit vector toward the sun in the renderer's world (X east, Y up, Z south). */
export function sunVector(pos, out = { x: 0, y: 0, z: 0 }) {
  const el = pos.elevation * RAD, az = pos.azimuth * RAD;
  out.x = Math.cos(el) * Math.sin(az);
  out.y = Math.sin(el);
  out.z = -Math.cos(el) * Math.cos(az);
  return out;
}

/** UTC milliseconds for a local clock time (seconds of the day) on the game's date (CET, UTC+1). */
export function utcMs(date, secondsOfDay) {
  return Date.UTC(date.year, date.month - 1, date.day) + (secondsOfDay - date.utcOffset * 3600) * 1000;
}
