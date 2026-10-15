/**
 * Who is aboard and where each man stands his watch: the General Information Book's complement
 * (seven officers and sixty-nine men), each with his rate, his station in each condition of
 * readiness, and his bunk.
 *
 * Stations (Fleet Type Submarine, chapter 18, "Diving stations"): the diving officer behind the
 * planesmen; the bow and stern planesmen seated at their wheels; the chief of the boat at the
 * hydraulic manifold (the vents, the floods, the main induction); a chief at the air manifold
 * (the blows, the bleed); a motor machinist's mate at the trim manifold; the helmsman and the
 * quartermaster in the conning tower with the captain at the periscope; two electricians at the
 * maneuvering room's cubicle; the engine rooms' motor machinist's mates at their engines' stands
 * (when the engines run); the pump room; a watch in each torpedo room; on the surface the officer
 * of the deck and two lookouts on the bridge.
 */
import { DECK, LEVELS } from '../data/layout.js';
import { COMPARTMENTS, COMPLEMENT } from '../data/boat.js';

const YAW = { fwd: Math.PI / 2, aft: -Math.PI / 2, port: Math.PI, stbd: 0 };
const st = (id, label, level, x, z, face, posture = 'stand', extra = {}) => ({ id, label, level, x, z, yaw: YAW[face] ?? face, posture, ...extra });

export const STATIONS = Object.fromEntries([
  // control room
  st('divingOfficer', 'Diving officer', 'main', 11.55, -0.3, 'port'),
  st('bowPlanes', 'Bow planesman', 'main', 11.95, -0.88, 'port', 'sit'),
  st('sternPlanes', 'Stern planesman', 'main', 11.10, -0.88, 'port', 'sit'),
  st('hydraulic', 'Hydraulic manifold', 'main', 12.85, -1.0, 'port'),
  st('airManifold', 'Air manifold', 'main', 11.75, 1.05, 'stbd'),
  st('trimManifold', 'Trim manifold', 'main', 10.0, -1.05, 'port'),
  st('crHelm', 'Helm (control room)', 'main', 12.85, 0.45, 'fwd'),
  st('radio', 'Radio', 'main', 6.65, 1.15, 'stbd', 'sit'),
  st('crWatch', 'Chief of the watch', 'main', 10.4, 0.35, 'port'),
  // pump room
  st('pumpRoom', 'Pump room', 'pump', 10.2, 0.0, 'port'),
  // conning tower
  st('ctHelm', 'Helmsman', 'ct', 11.8, 0.0, 'fwd'),
  st('quartermaster', 'Quartermaster', 'ct', 9.25, -0.35, 'fwd'),
  st('captain', 'Commanding officer', 'ct', 10.85, 0.75, 'fwd'),
  st('ctOfficer', 'Officer of the deck', 'ct', 10.3, -0.5, 'port'),
  st('sonar', 'Sound', 'ct', 8.8, 0.55, 'stbd', 'sit'),
  st('tdc', 'Assistant approach officer', 'ct', 9.0, -0.4, 'port'),
  // bridge (surfaced)
  st('oodBridge', 'Officer of the deck (bridge)', 'bridge', 11.6, 0.0, 'fwd'),
  st('lookoutP', 'Port lookout', 'bridge', 9.6, -0.55, 2.62),
  st('lookoutS', 'Starboard lookout', 'bridge', 9.6, 0.55, 0.53),
  // engine rooms (each motor machinist's mate at his engine's control stand)
  st('eng1', 'No. 1 engine', 'main', -8.6, 0.3, 'stbd'),
  st('eng2', 'No. 2 engine', 'main', -8.6, -0.3, 'port'),
  st('eng3', 'No. 3 engine', 'main', -16.7, 0.3, 'stbd'),
  st('eng4', 'No. 4 engine', 'main', -16.7, -0.3, 'port'),
  st('auxEngine', 'Auxiliary engine', 'main', -22.2, -0.15, 'port'),
  // maneuvering room
  st('maneuveringP', 'Controllerman (port)', 'main', -28.3, -0.45, 'aft'),
  st('maneuveringS', 'Controllerman (starboard)', 'main', -28.3, 0.45, 'aft'),
  // torpedo rooms, galley
  st('ftrWatch', 'Forward torpedo room watch', 'main', 30.0, 0.0, 'fwd'),
  st('atrWatch', 'After torpedo room watch', 'main', -37.0, 0.0, 'aft'),
  st('galley', 'Galley', 'main', 4.5, -0.25, 'port'),
  st('messCook', 'Mess cook', 'main', 2.8, 0.25, 'stbd'),
].map((s) => [s.id, s]));

/**
 * Who stands which station in each condition:
 *  surfaced:   the cruising watch on the surface (diesels or battery);
 *  submerged:  the submerged watch;
 *  diving:     diving stations (everyone's at his station for diving and surfacing).
 */
export const CONDITIONS = {
  surfaced: ['oodBridge', 'lookoutP', 'lookoutS', 'quartermaster', 'ctHelm', 'crWatch', 'hydraulic', 'radio', 'maneuveringP', 'maneuveringS', 'ftrWatch', 'atrWatch', 'galley', 'messCook'],
  submerged: ['divingOfficer', 'bowPlanes', 'sternPlanes', 'hydraulic', 'trimManifold', 'ctHelm', 'quartermaster', 'ctOfficer', 'sonar', 'radio', 'maneuveringP', 'maneuveringS', 'ftrWatch', 'atrWatch', 'galley', 'messCook'],
  diving: ['divingOfficer', 'bowPlanes', 'sternPlanes', 'hydraulic', 'airManifold', 'trimManifold', 'crWatch', 'ctHelm', 'quartermaster', 'captain', 'ctOfficer', 'sonar', 'tdc', 'radio', 'pumpRoom', 'maneuveringP', 'maneuveringS', 'eng1', 'eng2', 'eng3', 'eng4', 'auxEngine', 'ftrWatch', 'atrWatch', 'galley', 'messCook', 'oodBridge', 'lookoutP', 'lookoutS'],
};

/** Which rates stand which stations (first match free). */
const BILL = {
  captain: ['Commanding Officer'],
  divingOfficer: ['Wardroom Officers'],
  ctOfficer: ['Wardroom Officers'],
  oodBridge: ['Wardroom Officers'],
  tdc: ['Wardroom Officers'],
  hydraulic: ['Chief Torpedoman\'s Mate'],
  airManifold: ['Chief Motor Machinist\'s Mate'],
  trimManifold: ['Motor Machinist\'s Mate 1st Class'],
  crWatch: ['Chief Motor Machinist\'s Mate', 'Torpedoman\'s Mate 1st Class'],
  bowPlanes: ['Seaman 1st Class'], sternPlanes: ['Quartermaster 2nd Class', 'Seaman 1st Class'],
  ctHelm: ['Quartermaster 3rd Class', 'Seaman 1st Class'], crHelm: ['Seaman 1st Class'],
  quartermaster: ['Quartermaster 1st Class'],
  lookoutP: ['Seaman 1st Class', 'Signalman 1st Class'], lookoutS: ['Seaman 1st Class'],
  sonar: ['Radioman 2nd Class'], radio: ['Radioman 1st Class', 'Chief Radioman'],
  pumpRoom: ['Motor Machinist\'s Mate 2nd Class'],
  maneuveringP: ['Electrician\'s Mate 1st Class'], maneuveringS: ['Electrician\'s Mate 1st Class', 'Electrician\'s Mate 2nd Class'],
  eng1: ['Motor Machinist\'s Mate 1st Class'], eng2: ['Motor Machinist\'s Mate 1st Class'], eng3: ['Motor Machinist\'s Mate 1st Class'], eng4: ['Motor Machinist\'s Mate 1st Class', 'Motor Machinist\'s Mate 2nd Class'],
  auxEngine: ['Motor Machinist\'s Mate 2nd Class', 'Fireman 1st Class'],
  ftrWatch: ['Torpedoman\'s Mate 2nd Class'], atrWatch: ['Torpedoman\'s Mate 2nd Class', 'Torpedoman\'s Mate 3rd Class'],
  galley: ['Ship\'s Cook 1st Class'], messCook: ['Seaman 1st Class', 'Steward\'s Mate 1st Class'],
};

const FIRST = ['James', 'Robert', 'John', 'William', 'Richard', 'Joseph', 'Thomas', 'Charles', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Steven', 'Paul', 'Andrew', 'Joshua', 'Kenji', 'Kai', 'Keoni', 'Malia', 'Leilani', 'Sarah', 'Maria', 'Ana', 'Grace', 'Emily', 'Hannah', 'Rosa', 'Luis', 'Carlos', 'Miguel', 'Jose', 'Tuan', 'Minh', 'David', 'Samuel', 'Elijah', 'Isaac', 'Noa', 'Kalani', 'Ethan', 'Owen', 'Liam', 'Aiden', 'Mason', 'Logan', 'Ryan', 'Nathan', 'Tyler', 'Brandon', 'Aaliyah', 'Jasmine', 'Megan', 'Rachel', 'Erin', 'Ikaika', 'Makoa', 'Koa', 'Benjamin', 'Henry', 'Walter', 'Frank', 'Edward', 'Arthur', 'Raymond', 'Eugene', 'Ralph', 'Roy', 'Louis', 'Harold'];
const LAST = ['Anderson', 'Kahananui', 'Nakamura', 'Garcia', 'Johnson', 'Martinez', 'Smith', 'Kealoha', 'Tanaka', 'Williams', 'Brown', 'Kim', 'Nguyen', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Thompson', 'Lopez', 'Gonzalez', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'Akana', 'Kekumu', 'Fujimoto', 'Yamada', 'Hernandez', 'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Hill', 'Ramirez', 'Campbell', 'Mitchell', 'Roberts', 'Carter', 'Phillips', 'Evans', 'Turner', 'Torres', 'Parker', 'Collins', 'Edwards', 'Stewart', 'Morris', 'Murphy', 'Cook', 'Rogers', 'Morgan', 'Peterson', 'Cooper', 'Reed', 'Bailey', 'Bell', 'Kahale', 'Palakiko', 'Okimoto', 'Silva', 'Souza', 'Medeiros', 'Ferreira'];

/** The bunks: the same sets the fittings put in the torpedo rooms, officers' country and the crew's berthing. */
export function bunks() {
  const B = [];
  const C = Object.fromEntries(COMPARTMENTS.map((c) => [c.id, c]));
  const add = (x0, x1, side, tiers, y0, gap, inboard, room) => { for (let t = 0; t < tiers; t++) B.push({ room, x: (x0 + x1) / 2, y: y0 + t * gap + 0.12, z: side * (inboard + 0.32), level: 'main', yaw: Math.PI / 2 }); };
  const ftr = C.ftr, atr = C.atr;
  for (const [c, dir] of [[ftr, 1], [atr, -1]]) {
    const end = dir > 0 ? c.x0 : c.x1;
    const xa = dir > 0 ? c.x1 + 0.6 : end + 2.2, xb = dir > 0 ? end - 2.0 : c.x0 - 0.6;
    for (const s of [-1, 1]) { add(xa + 0.2, Math.min(xa + 2.1, xb), s, 3, DECK + 0.75, 0.55, 0.62, c.id); add(Math.min(xa + 2.2, xb - 1.9), xb, s, 3, DECK + 0.75, 0.55, 0.62, c.id); }
  }
  const fb = C.fbr, rooms = [fb.x0 - 0.3, fb.x0 - 2.3, fb.x0 - 4.3, fb.x0 - 6.1, fb.x1 + 0.3];
  for (const s of [-1, 1]) for (let i = 0; i < rooms.length - 1; i++) add(rooms[i + 1] + 0.05, rooms[i + 1] + 1.95, s, 2, DECK + 0.45, 0.8, 1.2, 'fbr');
  const ab = C.abr;
  for (const s of [-1, 1]) for (let x = ab.x1 + 0.3; x < -0.9; x += 2.0) add(x, x + 1.9, s, 3, DECK + 0.3, 0.6, 0.5, 'abr');
  return B;
}

/** The mess tables' seats (crew's mess, after battery compartment). */
export function messSeats() {
  const S = [];
  for (const s of [-1, 1]) for (const x of [0.2, 2.1]) for (const dx of [-1.05, 1.05]) for (const dz of [0.75, 1.15]) S.push({ x: x + dx, z: s * dz, level: 'main', yaw: dx < 0 ? Math.PI / 2 : -Math.PI / 2, y: DECK });
  return S;
}

/** The men: names, rates, the station each stands in each condition, a bunk and a look. */
export function roster(seed = 1942) {
  let s = seed;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const men = [];
  const used = new Set();
  for (const [rate, n] of COMPLEMENT) {
    for (let i = 0; i < n; i++) {
      let name;
      do { name = `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`; } while (used.has(name));
      used.add(name);
      const officer = rate.includes('Officer');
      men.push({ id: men.length, name, rate, officer, female: /Malia|Leilani|Sarah|Maria|Ana|Grace|Emily|Hannah|Rosa|Aaliyah|Jasmine|Megan|Rachel|Erin|Noa/.test(name), seed: r() });
    }
  }
  // stations from the bill: each station to the first free man of a listed rate
  const roleOf = new Map();
  for (const [station, rates] of Object.entries(BILL)) {
    for (const rate of rates) {
      const m = men.find((q) => q.rate === rate && !roleOf.has(q.id));
      if (m) { roleOf.set(m.id, station); m.station = station; break; }
    }
  }
  const B = bunks();
  const officers = B.filter((b) => b.room === 'fbr'), crewB = B.filter((b) => b.room !== 'fbr');
  let oi = 0, ci = 0;
  for (const m of men) m.bunk = m.officer ? officers[oi++ % officers.length] : crewB[ci++ % crewB.length];
  return men;
}

export { YAW, LEVELS };
