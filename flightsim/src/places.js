// Real-world reference geometry: runways (OurAirports data), airport layouts,
// landmarks and the route flown ARN -> CPH.
import * as THREE from 'three';
import { project, DEG } from './core.js';

// Runway ends [lat, lon] from OurAirports runways.csv.
export const RUNWAYS = {
  ESSA: [
    { ids: ['01L', '19R'], a: [59.637298583984375, 17.91320037841797], b: [59.66640090942383, 17.923799514770508], width: 45 },
    { ids: ['01R', '19L'], a: [59.626399993896484, 17.950700759887695], b: [59.64849853515625, 17.95870018005371], width: 45 },
    { ids: ['08', '26'], a: [59.65840148925781, 17.936100006103516], b: [59.66389846801758, 17.97920036315918], width: 45 },
  ],
  EKCH: [
    { ids: ['04L', '22R'], a: [55.592201, 12.603536], b: [55.616543, 12.641174], width: 45 },
    { ids: ['04R', '22L'], a: [55.60309982299805, 12.633000373840332], b: [55.62540054321289, 12.66759967803955], width: 45 },
    { ids: ['12', '30'], a: [55.626293, 12.633331], b: [55.612522, 12.670532], width: 45 },
  ],
};

export function runwayGeom(r) {
  const A = project(r.a[0], r.a[1]), B = project(r.b[0], r.b[1]);
  const a = new THREE.Vector2(A.x, A.z), b = new THREE.Vector2(B.x, B.z);
  const dir = b.clone().sub(a); const len = dir.length(); dir.divideScalar(len);
  return { a, b, dir, len, width: r.width, ids: r.ids, heading: (Math.atan2(dir.x, -dir.y) / DEG + 360) % 360 };
}

// A runway-aligned frame: u along the landing/take-off direction from threshold,
// v to the right of u. to(u, v) returns world x/z.
export class RunwayFrame {
  constructor(thr, dir) {
    this.o = thr.clone(); this.u = dir.clone().normalize();
    this.v = new THREE.Vector2(-this.u.y, this.u.x); // right-hand (clockwise) perpendicular
    this.heading = (Math.atan2(this.u.x, -this.u.y) / DEG + 360) % 360;
  }
  to(u, v) { return new THREE.Vector2(this.o.x + this.u.x * u + this.v.x * v, this.o.y + this.u.y * u + this.v.y * v); }
  hdg(du, dv) { const x = this.u.x * du + this.v.x * dv, y = this.u.y * du + this.v.y * dv; return (Math.atan2(x, -y) / DEG + 360) % 360; }
}

export const ARN = (() => {
  const rw = runwayGeom(RUNWAYS.ESSA[0]);
  // 19R: threshold is the north end (b), take-off towards a.
  const frame = new RunwayFrame(rw.b, rw.a.clone().sub(rw.b));
  return { icao: 'ESSA', iata: 'ARN', name: 'Stockholm Arlanda', frame, rwy: rw, elevation: 42 };
})();

export const CPH = (() => {
  const rw = runwayGeom(RUNWAYS.EKCH[1]);
  // 22L: threshold is the north-east end (b), landing towards a.
  const frame = new RunwayFrame(rw.b, rw.a.clone().sub(rw.b));
  return { icao: 'EKCH', iata: 'CPH', name: 'Copenhagen Kastrup', frame, rwy: rw, elevation: 5 };
})();

// ---- Ground layouts in runway frames (metres). Negative v at ARN = east of 19R.
export const ARN_LAYOUT = {
  taxiwayZ: -190,           // parallel taxiway east of 01L/19R
  pierF: { u0: 1655, v0: -470, v1: -900, width: 20 },  // pier F runs east from v0 to v1
  terminal5: { u: 1640, v: -1010, len: 330, depth: 70 },
  terminal4: { u: 1180, v: -1140, len: 220, depth: 60 },
  terminal2: { u: 2350, v: -1180, len: 260, depth: 60 },
  pierE: { u0: 1300, v0: -960, v1: -700, width: 18 },
  tower: { u: 1420, v: -1260 },
  startStandV: -560,        // stand we pushed back from
  holdU: -45,               // holding point level with the threshold
};

export const CPH_LAYOUT = {
  parallelV: 300,           // taxiway between 22L and 22R
  terminalV: 1320,
  piers: [ // pier axes run from the terminal (v=vt) towards the runway (v=vt-len)
    { name: 'A', u: 120, len: 430 },
    { name: 'B', u: 430, len: 470 },
    { name: 'C', u: 760, len: 430 },
  ],
  standU: 393,              // our stand (main-gear point): nose ~7 m from pier B (+u)
  standV: 1000,
};

// Landmarks (lat, lon)
export const LANDMARKS = {
  turningTorso: [55.6131, 12.9763],
  oresundBridgeW: [55.5893, 12.7738], // Peberholm end
  oresundBridgeE: [55.5646, 12.9096], // Lernacken end
  peberholm: [[55.6038, 12.7294], [55.6006, 12.7345], [55.5915, 12.7650], [55.5872, 12.7772], [55.5850, 12.7760], [55.5905, 12.7560], [55.5985, 12.7340]],
  saltholm: [[55.6860, 12.7440], [55.6930, 12.7650], [55.6820, 12.7920], [55.6600, 12.8020], [55.6400, 12.7950], [55.6270, 12.7700], [55.6380, 12.7430], [55.6620, 12.7350]],
  middelgrunden: { a: [55.6680, 12.6610], b: [55.7040, 12.6570], bulge: 0.012, n: 20 },
  lillgrund: { c: [55.5086, 12.7770], rows: 8, cols: 6, spacing: 0.0045 },
  copenhagen: [55.6761, 12.5683],
  malmo: [55.6050, 13.0038],
  stockholm: [59.3293, 18.0686],
};

// Ground track waypoints after take-off (lat, lon, turn radius m).
export const ROUTE_AIR = [
  [59.585, 17.8945, 4500],   // runway heading climb-out
  [59.43, 17.60, 9000],      // west of Stockholm
  [59.03, 17.02, 15000],     // Södermanland
  [58.38, 16.10, 20000],     // between Norrköping and Linköping
  [57.28, 14.93, 20000],     // Småland highlands, east of Vättern
  [56.42, 13.93, 15000],     // northern Skåne
  [55.95, 13.19, 6000],      // Skåne, joining the 22L final
];

export const FLIGHT_INFO = {
  airline: 'SAS Scandinavian Airlines',
  aircraft: 'Airbus A320neo',
  engines: 'CFM LEAP-1A26',
  registration: 'SE-ROX',
  name: 'Roar Viking',
  seats: 180,
  cruiseFL: 360,
};

// Departure presets: SK1415 is the real 06:00 rotation; later ones are illustrative.
export const DEPARTURES = [
  { time: 6.0, flight: 'SK1415', label: '06:00 · early morning, low sun' },
  { time: 9.1667, flight: 'SK1417', label: '09:10 · morning' },
  { time: 13.25, flight: 'SK1425', label: '13:15 · midday' },
  { time: 17.5, flight: 'SK1433', label: '17:30 · afternoon' },
  { time: 20.5, flight: 'SK1439', label: '20:30 · sunset' },
  { time: 22.5, flight: 'SK1443', label: '22:30 · late evening, twilight' },
];
