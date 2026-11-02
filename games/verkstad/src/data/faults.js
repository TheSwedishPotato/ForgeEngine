/**
 * What can be wrong with a car, and what a customer can ask for. Each entry writes a real failure
 * into the parts' conditions (car/assembly.js); everything the car then does about it (the noise,
 * the codes, the readings, the road test) comes out of the simulation. Fixing it means making the
 * part right again: a new part from the shelf, an adjustment, a top-up. `present` says whether the
 * failure is still there, which is what the customer's road test and the verdict use.
 *
 * where: 'corner' (FL FR RL RR), 'axle' (F R), 'cyl' (1..n), 'side' (L R), or none.
 * lay: what a driver notices, in their words (the offline customers use these; Claude writes its own).
 */

const CORN = ['FL', 'FR', 'RL', 'RR'];
const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];
const pads = (A, k) => ['padI', 'padO'].map((p) => A.part(p + k)).filter(Boolean);
const axleCorners = (ax) => (ax === 'F' ? ['FL', 'FR'] : ['RL', 'RR']);
const ROAD = ['volvo240', 'golf7'];

export const FAULTS = [
  // ---- brakes
  { id: 'pads_worn', title: 'Brake pads worn to the wear limit', sys: 'brake', cars: 'all', where: 'axle', lay: 'a squeal from the brakes when slowing down gently',
    apply(A, ax) { for (const k of axleCorners(ax)) for (const p of pads(A, k)) p.cond.mm = 2.0 + Math.random() * 0.6; },
    present: (A, ax) => axleCorners(ax).some((k) => pads(A, k).some((p) => p.cond.mm < 3)) },
  { id: 'pads_metal', title: 'Pads worn through to the backing plate, disc scored', sys: 'brake', cars: ROAD, where: 'corner', lay: 'a horrible grinding noise when braking that started last week',
    apply(A, k) { const ax = k[0]; for (const c of axleCorners(ax)) for (const p of pads(A, c)) p.cond.mm = c === k ? 0.4 : 2.5; const d = A.part('disc' + k).cond; d.t = d.min - 0.6; d.runout = 0.05; d.scored = true; },
    present: (A, k) => pads(A, k).some((p) => p.cond.mm < 3) || A.part('disc' + k).cond.t < A.part('disc' + k).cond.min },
  { id: 'disc_warped', title: 'Brake discs with excessive runout (thickness variation)', sys: 'brake', cars: ROAD, where: 'axle', lay: 'the steering wheel shakes when braking on the motorway',
    apply(A, ax) { for (const k of axleCorners(ax)) A.part('disc' + k).cond.runout = 0.1 + Math.random() * 0.05; },
    present: (A, ax) => axleCorners(ax).some((k) => A.part('disc' + k).cond.runout > 0.06) },
  { id: 'disc_worn', title: 'Brake discs worn below minimum thickness', sys: 'brake', cars: 'all', where: 'axle', lay: 'nothing much, but the inspection (besiktning) remark says the discs are worn',
    apply(A, ax) { for (const k of axleCorners(ax)) { const d = A.part('disc' + k).cond; d.t = d.min - 0.3 - Math.random() * 0.5; d.lip = true; } },
    present: (A, ax) => axleCorners(ax).some((k) => A.part('disc' + k).cond.t < A.part('disc' + k).cond.min) },
  { id: 'caliper_seized', title: 'Brake caliper piston (or guide pins) seized', sys: 'brake', cars: ROAD, where: 'corner', lay: 'the car pulls to one side when braking, and one wheel smells hot after driving',
    apply(A, k) { A.part('caliper' + k).cond.seized = true; const [i, o] = pads(A, k); if (i) i.cond.mm = 2.8; if (o) o.cond.mm = 7; },
    present: (A, k) => A.part('caliper' + k).cond.seized },
  { id: 'brake_fluid_old', title: 'Brake fluid with too much water in it (over 3 %)', sys: 'brake', cars: ROAD, where: null, lay: 'it is due a brake fluid change, the service book says',
    apply(A) { A.part('reservoir').cond.water = 3.5 + Math.random() * 2; }, present: (A) => A.part('reservoir').cond.water > 3 },
  // ---- tyres and wheels
  { id: 'tyre_nail', title: 'A nail in the tread: slow puncture', sys: 'wheel', cars: ROAD, where: 'corner', lay: 'one tyre keeps going flat; I pump it up every few days',
    apply(A, k) { const c = A.part('wheel' + k).cond; c.nail = true; c.leak = 0.12; c.bar *= 0.72; }, present: (A, k) => A.part('wheel' + k).cond.nail || A.part('wheel' + k).cond.leak > 0 },
  { id: 'tyre_worn', title: 'Tyres below the legal tread depth', sys: 'wheel', cars: ROAD, where: 'axle', lay: 'the car slides about in the wet',
    apply(A, ax) { for (const k of axleCorners(ax)) A.part('wheel' + k).cond.tread = 1.2 + Math.random() * 0.6; }, present: (A, ax) => axleCorners(ax).some((k) => A.part('wheel' + k).cond.tread < 1.6) },
  { id: 'wheel_imbalance', title: 'Wheel out of balance (a weight fell off)', sys: 'wheel', cars: ROAD, where: 'corner', lay: 'a vibration around 100 km/h',
    apply(A, k) { A.part('wheel' + k).cond.imbalance = 35 + Math.random() * 30; }, present: (A, k) => A.part('wheel' + k).cond.imbalance > 15 },
  { id: 'lug_loose', title: 'Wheel nuts not done up after the last tyre change', sys: 'wheel', cars: ROAD, where: 'corner', lay: 'a clicking from one wheel since the tyres were changed at another place',
    apply(A, k) { const fs = A.part('wheel' + k).fasteners.map((f) => A.fast(f)); for (const f of fs.slice(0, 3)) { f.clamp = f.spec * 0.15; f.seize = 0; } },
    present: (A, k) => A.part('wheel' + k).fasteners.map((f) => A.fast(f)).some((f) => f.clamp < f.spec * 0.85) },
  // ---- ignition and fuel
  { id: 'coil_dead', title: 'Ignition coil failed (open secondary)', sys: 'ignition', cars: ['golf7'], where: 'cyl', lay: 'the engine shakes, has no power and the engine light flashes',
    apply(A, c) { A.part('coil' + c).cond.ok = false; }, present: (A, c) => !A.part('coil' + c).cond.ok },
  { id: 'lead_dead', title: 'HT lead broken inside (no spark to one cylinder)', sys: 'ignition', cars: ['volvo240'], where: 'cyl', lay: 'it runs like a tractor and shakes at the traffic lights',
    apply(A, c) { A.part('lead' + c).cond.ok = false; A.part('lead' + c).cond.resistance = 1e6; }, present: (A, c) => !A.part('lead' + c).cond.ok },
  { id: 'distcap_cracked', title: 'Distributor cap cracked (tracking)', sys: 'ignition', cars: ['volvo240'], where: null, lay: 'it misfires, worse on damp mornings',
    apply(A) { A.part('distcap').cond.cracked = true; }, present: (A) => A.part('distcap').cond.cracked },
  { id: 'plugs_worn', title: 'Spark plugs worn out (gaps opened up)', sys: 'ignition', cars: ROAD, where: null, lay: 'it hesitates pulling away and uses more fuel than it did',
    apply(A) { for (const p of A.byKind('plug')) { p.cond.gap = p.cond.spec + 0.55 + Math.random() * 0.2; p.cond.wear = 1; } }, present: (A) => A.byKind('plug').some((p) => p.cond.gap > p.cond.spec + 0.3) },
  { id: 'plug_fouled', title: 'One spark plug oil-fouled', sys: 'ignition', cars: ROAD, where: 'cyl', lay: 'a misfire that comes and goes',
    apply(A, c) { A.part('plug' + c).cond.fouled = true; }, present: (A, c) => A.part('plug' + c).cond.fouled },
  { id: 'vacuum_leak', title: 'Split vacuum/breather hose (unmetered air)', sys: 'air', cars: ROAD, where: null, lay: 'a hissing under the bonnet and the idle goes up and down',
    apply(A) { A.part('vachose').cond.split = true; }, present: (A) => A.part('vachose').cond.split },
  { id: 'airfilter_clogged', title: 'Air filter blocked solid', sys: 'air', cars: ROAD, where: null, lay: 'it feels slow',
    apply(A) { A.part('airfilter').cond.clog = 0.97; }, present: (A) => A.part('airfilter').cond.clog > 0.85 },
  { id: 'o2_dead', title: 'Lambda sensor dead', sys: 'exhaust', cars: ROAD, where: null, lay: 'the engine light is on and the fuel bills went up',
    apply(A) { A.part('o2sensor').cond.ok = false; }, present: (A) => !A.part('o2sensor').cond.ok },
  { id: 'amm_dead', title: 'Air mass meter hot wire failed', sys: 'air', cars: ['volvo240'], where: null, lay: 'it starts and then nearly dies, and runs badly until it is warm',
    apply(A) { A.part('amm').cond.ok = false; }, present: (A) => !A.part('amm').cond.ok },
  // ---- cooling
  { id: 'thermostat_open', title: 'Thermostat stuck open', sys: 'cool', cars: ROAD, where: null, lay: 'the heater only blows lukewarm and the temperature needle hardly moves',
    apply(A) { A.part('thermostat').cond.stuckOpen = true; }, present: (A) => A.part('thermostat').cond.stuckOpen },
  { id: 'coolant_low', title: 'Coolant level low', sys: 'cool', cars: ROAD, where: null, lay: 'the temperature warning came on in a queue',
    apply(A) { A.part('exptank').cond.level = 0.2; }, present: (A) => A.part('exptank').cond.level < 0.5 },
  // ---- charging and starting
  { id: 'battery_weak', title: 'Battery worn out (sulfated, low capacity)', sys: 'elec', cars: ROAD, where: null, lay: 'it struggles to start on cold mornings; it needed a jump twice',
    apply(A) { const c = A.part('battery').cond; c.soh = 0.3; c.soc = 0.5; c.sulfated = true; }, present: (A) => A.part('battery').cond.soh < 0.5 },
  { id: 'alternator_dead', title: 'Alternator not charging (regulator failed)', sys: 'charge', cars: ROAD, where: null, lay: 'a red battery light came on while driving, and now it will not start',
    apply(A) { A.part('alternator').cond.ok = false; A.part('battery').cond.soc = 0.35; }, present: (A) => !A.part('alternator').cond.ok },
  { id: 'belt_glazed', title: 'Auxiliary belt glazed and slipping', sys: 'charge', cars: ROAD, where: null, lay: 'a loud squeal from the front when I start it in the morning',
    apply(A) { const c = A.part('belt').cond; c.glazed = true; c.wear = 0.9; }, present: (A) => A.part('belt').cond.glazed },
  { id: 'starter_solenoid', title: 'Starter solenoid contacts burnt', sys: 'elec', cars: ROAD, where: null, lay: 'turn the key and there is just a click. Sometimes it works after a few tries',
    apply(A) { A.part('starter').cond.solenoid = false; }, present: (A) => !A.part('starter').cond.solenoid },
  // ---- lights and small things
  { id: 'bulb_out', title: 'Dipped-beam bulb blown', sys: 'light', cars: ROAD, where: 'side', lay: 'someone flashed me: one of my headlights is out',
    apply(A, s) { A.part('bulb' + s).cond.ok = false; }, present: (A, s) => !A.part('bulb' + s).cond.ok },
  { id: 'brakebulb_out', title: 'Brake light bulb blown', sys: 'light', cars: ROAD, where: 'side', lay: 'the car behind me honked at me; my wife says a brake light is out',
    apply(A, s) { A.part('brakebulb' + s).cond.ok = false; }, present: (A, s) => !A.part('brakebulb' + s).cond.ok },
  { id: 'fuse_blown', title: 'Fuse blown', sys: 'elec', cars: ROAD, where: null, lay: 'something electrical just stopped working',
    apply(A, _w, r) { const f = pick(A.byKind('fuse').filter((x) => /Lighter|socket|Horn|heater|fan/i.test(x.cond.circuit)), r); f.cond.ok = false; this.lastPick = f.id; return f.id; },
    present: (A, _w, extra) => A.byKind('fuse').some((f) => !f.cond.ok || (extra && f.id === extra && f.cond.short)) },
  { id: 'wipers_worn', title: 'Wiper blades worn and split', sys: 'body', cars: ROAD, where: null, lay: 'the wipers smear and squeak',
    apply(A) { for (const w of A.byKind('wiper')) w.cond.wear = 0.95; }, present: (A) => A.byKind('wiper').some((w) => w.cond.wear > 0.8) },
  // ---- suspension and steering
  { id: 'sway_link', title: 'Anti-roll bar link ball joint worn', sys: 'susp', cars: ROAD, where: 'corner', front: true, lay: 'a clunk from the front over speed bumps',
    apply(A, k) { A.part('link' + k).cond.play = 1.2 + Math.random(); }, present: (A, k) => A.part('link' + k).cond.play > 0.5 },
  { id: 'balljoint', title: 'Lower ball joint worn', sys: 'susp', cars: ['golf7'], where: 'corner', front: true, lay: 'a knocking from the front and the car wanders on the motorway',
    apply(A, k) { A.part('balljoint' + k).cond.play = 1.5 + Math.random(); }, present: (A, k) => A.part('balljoint' + k).cond.play > 0.5 },
  { id: 'wheel_bearing', title: 'Wheel bearing worn (rough, rumbling)', sys: 'susp', cars: ['golf7'], where: 'corner', lay: 'a humming noise that gets louder with speed, like driving on a rough road',
    apply(A, k) { const c = A.part('hub' + k).cond; c.rough = 0.8; c.play = 0.15; }, present: (A, k) => A.part('hub' + k).cond.rough > 0.3 },
  { id: 'cv_boot', title: 'Outer CV boot torn', sys: 'drive', cars: ['golf7'], where: 'corner', front: true, lay: 'the inspection found a torn rubber boot at the front, they said',
    apply(A, k) { A.part('cvboot' + k).cond.torn = true; A.part('cvboot' + k).cond.grease = 0.7; }, present: (A, k) => A.part('cvboot' + k).cond.torn },
  // ---- exhaust and oil
  { id: 'exhaust_hole', title: 'Rear silencer rusted through', sys: 'exhaust', cars: ROAD, where: null, lay: 'it sounds like a rally car all of a sudden',
    apply(A) { A.part('silencer').cond.hole = true; }, present: (A) => A.part('silencer').cond.hole },
  { id: 'oil_low', title: 'Engine oil 1.5 litres low', sys: 'oil', cars: ROAD, where: null, lay: 'the oil light flickered at a roundabout',
    apply(A) { A.part('engine').cond.oil -= 1.6; }, present: (A, _w, _e, spec) => A.part('engine').cond.oil < A.spec.engine.oil.capacity - 0.8 },
  { id: 'drainplug_leak', title: 'Drain plug leaking (old crush washer)', sys: 'oil', cars: ROAD, where: null, lay: 'there are oil spots under the car on my driveway',
    apply(A) { A.part('drainplug').cond.washer = 'leaking'; }, present: (A) => A.part('drainplug').cond.washer === 'leaking' },
  // ---- the F1 car
  { id: 'f1_wing', title: 'Front wing damaged (endplate and flaps)', sys: 'aero', cars: ['f1_2026'], where: null, lay: 'the front wing touched a kerb at the demo run',
    apply(A) { A.part('nose').cond.damage = 1; }, present: (A) => A.part('nose').cond.damage > 0.2 },
  { id: 'f1_pads', title: 'Carbon brake pads worn', sys: 'brake', cars: ['f1_2026'], where: 'axle', lay: 'the driver says the brakes feel long',
    apply(A, ax) { for (const k of axleCorners(ax)) for (const p of pads(A, k)) p.cond.mm = 13 + Math.random() * 3; }, present: (A, ax) => axleCorners(ax).some((k) => pads(A, k).some((p) => p.cond.mm < 20)) },
];

/** Work the customer asks for (not a failure). present: still to be done. */
export const JOBS = [
  { id: 'oil_service', title: 'Oil and oil filter change', cars: ROAD, lay: 'the service light says it is time for an oil change',
    apply(A) { A.part('engine').cond.oilAge = 14000 + Math.random() * 6000; A.part('oilfilter').cond.age = 15000; }, present: (A) => A.part('engine').cond.oilAge > 2000 || A.part('oilfilter').cond.age > 1000 },
  { id: 'winter_tyres', title: 'Change to the winter tyres (from the tyre hotel)', cars: ROAD, lay: 'it is November: I need my winter tyres on (they are stored with you)',
    apply() {}, present: (A) => ['FL', 'FR', 'RL', 'RR'].some((k) => A.part('wheel' + k).cond.season !== 'winter') },
  { id: 'wiper_service', title: 'New wiper blades', cars: ROAD, lay: 'new wiper blades before the winter please',
    apply(A) { for (const w of A.byKind('wiper')) w.cond.wear = Math.max(w.cond.wear, 0.7); }, present: (A) => A.byKind('wiper').some((w) => w.cond.wear > 0.3) },
  { id: 'f1_tyre_change', title: 'Fit a fresh set of tyres', cars: ['f1_2026'], lay: 'fit the fresh set for the next run',
    apply(A) { for (const k of ['FL', 'FR', 'RL', 'RR']) A.part('wheel' + k).cond.tread = 0.8; }, present: (A) => ['FL', 'FR', 'RL', 'RR'].some((k) => A.part('wheel' + k).cond.tread < 2) },
];

export const ALL = [...FAULTS, ...JOBS];
export const byId = (id) => ALL.find((f) => f.id === id);

/** The faults and jobs that make sense for a car (by spec id). */
export function forCar(carId) { return ALL.filter((f) => f.cars === 'all' || f.cars.includes(carId)); }

/** A `where` that fits the fault on this car. */
export function chooseWhere(f, A, r = Math.random) {
  if (f.where === 'corner') return pick(f.front ? ['FL', 'FR'] : CORN, r);
  if (f.where === 'axle') return pick(['F', 'R'], r);
  if (f.where === 'cyl') return 1 + Math.floor(r() * A.spec.engine.cyl);
  if (f.where === 'side') return pick(['L', 'R'], r);
  return null;
}

/** Applies a fault or job to the car; returns the record kept on the customer's card. */
export function applyFault(A, id, where, r = Math.random) {
  const f = byId(id);
  if (!f) return null;
  if (f.cars !== 'all' && !f.cars.includes(A.spec.id)) return null;
  let w = where ?? chooseWhere(f, A, r);
  // a where that does not exist on this car (a fifth cylinder, a rear anti-roll bar link) is chosen again
  if ((f.where === 'cyl' && !(w >= 1 && w <= A.spec.engine.cyl)) || (f.front && String(w)[0] !== 'F')) w = chooseWhere(f, A, r);
  const extra = f.apply(A, w, r) ?? null;
  return { id, where: w, extra, title: f.title, job: JOBS.includes(f) };
}

export function stillPresent(A, rec) { const f = byId(rec.id); return f ? !!f.present(A, rec.where, rec.extra) : false; }
