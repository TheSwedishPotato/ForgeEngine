// "Anything can happen": physical failures and hazards, and how the cabin lives through them.
//
// Nothing here flies the aircraft or makes a decision for the pilots. A failure goes into the
// physics (an engine that stops making thrust or catches fire, a hydraulic system that loses
// pressure, a hole in the pressure hull, a main gear leg that will not lock down) or into the air
// (a clear-air turbulence patch, a microburst, wake from the traffic ahead, a lightning strike).
// The two pilots in crew.js notice it the way real pilots do (ECAM, the feel of the aircraft, the
// radar) and fly the drill; ATC and the traffic do their part; the cabin crew and passengers here
// react to what the flight deck and the aircraft actually do.
//
// Modes: off, realistic (about as rare as real life, slightly boosted so a few flights in a
// hundred see something), eventful (one or two things will happen), chaos (several, including
// serious failures).
import { SPEAKERS } from './speech.js';
import { clamp, lerp, rng, FT, KT, G } from './core.js';

const pa = (speaker, sv, en) => [sv && { text: sv, lang: 'sv', speaker, pa: true }, en && { text: en, lang: 'en', speaker, pa: true }].filter(Boolean);
const CAPT = () => SPEAKERS.captain, PURS = () => SPEAKERS.purser;
const side = (i) => (i === 0 ? ['vänstra', 'left'] : ['högra', 'right']);

// ---------------- announcements ----------------
export const EMERGENCY_PA = {
  seatedNow: () => [{ text: 'Cabin crew, be seated immediately.', lang: 'en', speaker: CAPT(), pa: true }],
  turbApology: () => pa(CAPT(),
    'Mina damer och herrar, det här är kaptenen. Förlåt för det. Vi flög in i ett område med kraftig turbulens i klar luft som inte syns på vår radar. Vi byter höjd för att komma ur den. Har någon skadat sig, tryck på anropsknappen så kommer kabinpersonalen. Håll alltid bältet fastspänt när ni sitter.',
    'Ladies and gentlemen, this is the captain. Sorry about that. We flew into an area of severe clear-air turbulence, which does not show on our weather radar. We are changing altitude to get out of it. If anyone has been hurt, please press your call button and the cabin crew will come to you. Please keep your seatbelt fastened whenever you are seated.'),
  turbModerate: () => pa(CAPT(),
    'Mina damer och herrar, vi har kommit in i ett område med turbulens. Gå till era platser och spänn fast bältet. Kabinpersonalen avbryter servicen tills vidare.',
    'Ladies and gentlemen, we have run into an area of turbulence. Please return to your seats and fasten your seatbelts. The cabin crew will pause the service for now.'),
  goAround: (reason) => {
    const r = {
      runway: ['Det fanns fortfarande ett flygplan på banan när vi närmade oss.', 'There was still an aircraft on the runway as we came in.'],
      unstable: ['Vi var inte helt stabiliserade för landningen, så vi valde att göra ett nytt försök.', 'We were not fully stabilised for the landing, so we chose to try again.'],
      windshear: ['Vi fick en varning om vindskjuvning, en plötslig ändring av vinden nära banan, och steg som vi är tränade att göra.', 'We had a windshear warning, a sudden change in the wind close to the runway, and we climbed away exactly as we are trained to do.'],
      minima: ['Vi kunde inte se banan tillräckligt tidigt i dimman.', 'We could not see the runway early enough in the low cloud and fog.'],
      bounce: ['Vi studsade vid sättningen, så vi valde att starta igen och göra ett nytt försök.', 'We bounced on touchdown, so we chose to take off again and make another approach.'],
      gear: ['Ett av huvudlandningsställen visar inte att det är låst nere, och vi behöver tid att undersöka det.', 'One of the main landing gear legs is not showing locked down, and we need some time to look at it.'],
    }[reason === 'atc' ? 'runway' : reason] || ['', ''];
    return pa(CAPT(), `Mina damer och herrar, det här är kaptenen. Som ni märkte avbröt vi inflygningen. ${r[0]} Det är en helt normal procedur. Vi flyger ett varv och landar om ungefär tio minuter.`,
      `Ladies and gentlemen, this is the captain. As you may have noticed, we discontinued our approach. ${r[1]} This is a completely normal procedure. We will fly a short circuit and land in about ten minutes.`);
  },
  engineReturn: (i, cause) => {
    const [sv, en] = side(i);
    const c = cause === 'bird' ? [`Strax efter starten flög vi in i en fågelflock och en fågel gick in i den ${sv} motorn.`, `Shortly after take-off we flew through a flock of birds and one went into the ${en} engine.`]
      : cause === 'fire' ? [`Vi fick en brandvarning i den ${sv} motorn. Branden är släckt och motorn är avstängd.`, `We had a fire warning in the ${en} engine. The fire is out and the engine is shut down.`]
        : [`Vi har haft ett tekniskt problem med den ${sv} motorn och har stängt av den.`, `We have had a technical problem with the ${en} engine and we have shut it down.`];
    return pa(CAPT(), `Mina damer och herrar, det här är kaptenen. ${c[0]} Flygplanet är konstruerat för att flyga säkert på en motor. Vi återvänder till Stockholm Arlanda och landar om ungefär femton minuter. Räddningstjänsten möter oss som en försiktighetsåtgärd. Följ kabinpersonalens instruktioner.`,
      `Ladies and gentlemen, this is the captain. ${c[1]} The aircraft is designed to fly safely on one engine. We are returning to Stockholm Arlanda and will land in about fifteen minutes. The fire services will meet us as a precaution. Please follow the instructions of the cabin crew.`);
  },
  engineContinue: (i, cause) => {
    const [sv, en] = side(i);
    const c = cause === 'fire' ? [`Vi fick en brandvarning i den ${sv} motorn. Branden är släckt och motorn är avstängd.`, `We had a fire warning in the ${en} engine. The fire is out and the engine is shut down.`]
      : [`Vi har stängt av den ${sv} motorn efter en varning om lågt oljetryck.`, `We have shut down the ${en} engine after a low oil pressure warning.`];
    return pa(CAPT(), `Mina damer och herrar, det här är kaptenen. ${c[0]} Flygplanet flyger säkert på en motor. Köpenhamn är nu närmaste lämpliga flygplats, så vi fortsätter dit på lägre höjd. Räddningstjänsten möter oss som en försiktighetsåtgärd.`,
      `Ladies and gentlemen, this is the captain. ${c[1]} The aircraft flies safely on one engine. Copenhagen is now the closest suitable airport, so we are continuing there at a lower altitude. The fire services will meet us as a precaution.`);
  },
  birdMinor: () => pa(CAPT(), 'Mina damer och herrar, det här är kaptenen. Ni kanske kände en duns. Vi träffade en fågel under stigningen. Motorerna fungerar normalt och vi fortsätter till Köpenhamn. Teknikerna inspekterar flygplanet när vi landat.',
    'Ladies and gentlemen, this is the captain. You may have felt a thump. We hit a bird during the climb. The engines are working normally and we are continuing to Copenhagen. Engineers will inspect the aircraft after we land.'),
  depressAuto: () => pa(PURS(), 'Nödnedstigning. Nödnedstigning. Ta på er syrgasmasken och spänn fast bältet.', 'Emergency descent. Emergency descent. Put on your oxygen mask and fasten your seatbelt.'),
  masksOff: () => pa(CAPT(), 'Mina damer och herrar, det här är kaptenen. Vi förlorade kabintrycket och har gjort en snabb nedstigning till en höjd där ni kan andas normalt. Ni kan ta av er syrgasmaskerna nu. Vi fortsätter till Köpenhamn på lägre höjd. Tack för att ni följde instruktionerna.',
    'Ladies and gentlemen, this is the captain. We lost cabin pressure and made a rapid descent to an altitude where you can breathe normally. You can take off your oxygen masks now. We will continue to Copenhagen at a lower altitude. Thank you for following the instructions.'),
  doctor: () => pa(PURS(), 'Mina damer och herrar, finns det en läkare eller sjuksköterska ombord, vänligen tryck på anropsknappen.', 'Ladies and gentlemen, if there is a doctor or a nurse on board, please make yourself known to the cabin crew by pressing your call button.'),
  medicalCapt: () => pa(CAPT(), 'Mina damer och herrar, det här är kaptenen. En passagerare har blivit sjuk. Vi har begärt prioriterad landning i Köpenhamn och ambulanspersonal möter flygplanet. Sitt kvar när vi kommit fram så att de kan gå ombord först. Tack.',
    'Ladies and gentlemen, this is the captain. A passenger has been taken ill. We have asked for a priority landing in Copenhagen and paramedics will meet the aircraft. When we arrive, please stay seated until they have boarded. Thank you.'),
  medicalReturn: () => pa(CAPT(), 'Mina damer och herrar, det här är kaptenen. En passagerare behöver snabbt komma till sjukhus, så vi vänder tillbaka till Stockholm Arlanda. Ambulans möter flygplanet. Sitt kvar när vi kommit fram så att de kan gå ombord först. Tack för er förståelse.',
    'Ladies and gentlemen, this is the captain. One of our passengers needs to get to a hospital quickly, so we are returning to Stockholm Arlanda. An ambulance will meet the aircraft. When we arrive, please stay seated so the paramedics can board first. Thank you for your understanding.'),
  gearUnsafe: () => pa(CAPT(), 'Mina damer och herrar, det här är kaptenen. Ett av huvudlandningsställen har inte låst sig i nedfällt läge. Vi har gått igenom checklistorna och förbereder oss nu för att landa ändå. Kabinpersonalen går igenom nödlandningsproceduren med er. Räddningstjänsten står beredd vid banan. Lyssna noga på besättningen.',
    'Ladies and gentlemen, this is the captain. One of our main landing gear legs has not locked in the down position. We have been through our checklists and we are now preparing to land with it as it is. The cabin crew will go through the emergency landing procedure with you. The fire services are standing by at the runway. Please listen carefully to the crew.'),
  lightning: () => pa(CAPT(), 'Mina damer och herrar, det här är kaptenen. Som några av er märkte blev vi träffade av blixten. Det är inte ovanligt och flygplanet är byggt för det. Allt fungerar normalt och teknikerna tittar på flygplanet efter landningen.',
    'Ladies and gentlemen, this is the captain. As some of you noticed, we were struck by lightning. That is not unusual and the aircraft is built for it. Everything is working normally and the engineers will have a look after we land.'),
  rto: () => pa(CAPT(), 'Mina damer och herrar, det här är kaptenen. Vi avbröt starten på grund av en varning från en av motorerna. Det är en procedur vi tränar regelbundet. Bromsarna är varma, så räddningstjänsten kontrollerar dem, sedan kör vi tillbaka till gaten så att teknikerna kan titta på motorn. Jag ber om ursäkt för förseningen.',
    'Ladies and gentlemen, this is the captain. We rejected the take-off because of a warning from one of the engines. It is a procedure we practise regularly. The brakes are hot, so the fire services will check them, and then we will taxi back to the gate for the engineers to look at the engine. I am sorry for the delay.'),
  hardLanding: () => pa(CAPT(), 'Förlåt för den hårda landningen, vinden byade precis när vi satte ner.', 'Sorry for the firm landing, the wind gusted just as we touched down.'),
  hydraulic: () => pa(CAPT(), 'Mina damer och herrar, det här är kaptenen. Ett av flygplanets tre hydraulsystem har slutat fungera. De två andra fungerar som de ska och vi kan landa säkert som planerat. Landningsstället fälls ut med tyngdkraften, klaffarna rör sig långsammare och vi bromsar för hand, så inflygningen blir lite längre och ni kommer att höra fler ljud än vanligt. Räddningstjänsten står beredd vid banan, vilket är standard. Vi kan ändå köra in till gaten som vanligt.',
    'Ladies and gentlemen, this is the captain. One of the aircraft\'s three hydraulic systems has stopped working. The other two are working normally and we can land safely as planned. The landing gear will be lowered by gravity, the flaps will move more slowly and we will brake by hand, so the approach will be a little longer and you may hear some unusual noises. As a standard precaution the fire services will be standing by at the runway. We still expect to taxi to the gate as usual.'),
  emergencyLanding: () => pa(PURS(), 'Mina damer och herrar, vi förbereder oss för en nödlandning. Lyssna noga på kabinpersonalen. Spänn fast bältet hårt, ställ ryggstödet upprätt och lägg undan alla lösa föremål. När ni hör "Brace!" böjer ni er fram med huvudet mot stolen framför och håller kvar tills flygplanet har stannat.',
    'Ladies and gentlemen, we are preparing for an emergency landing. Listen carefully to the cabin crew. Fasten your seatbelt tightly, put your seat upright and stow all loose items. When you hear "Brace", lean forward with your head against the seat in front and stay down until the aircraft has stopped.'),
  brace: () => [{ text: 'Brace! Brace! Heads down! Stay down!', lang: 'en', speaker: PURS(), pa: true }, { text: 'Huvudet ner! Håll kvar!', lang: 'sv', speaker: PURS(), pa: true }],
  evacuate: () => [{ text: 'Evacuate! Evacuate! Release your seatbelts! Leave everything! Come this way!', lang: 'en', speaker: PURS(), pa: true }, { text: 'Lossa bältet! Lämna allt! Kom hit!', lang: 'sv', speaker: PURS(), pa: true }],
  stayCalm: () => pa(CAPT(), 'Det här är kaptenen. Flygplanet har stannat. Sitt kvar och lyssna på kabinpersonalen.', 'This is the captain. The aircraft has stopped. Please remain seated and listen to the cabin crew.'),
  arrivalReturn: () => pa(PURS(), 'Mina damer och herrar, vi är tillbaka på Stockholm Arlanda. Sitt kvar tills bältesskylten släcks. SAS personal möter er vid gaten och hjälper er med ombokning. Tack för ert tålamod.',
    'Ladies and gentlemen, we are back at Stockholm Arlanda. Please remain seated until the seatbelt sign has been switched off. SAS staff will meet you at the gate and help you with rebooking. Thank you for your patience.'),
};

// ---------------- what can go wrong ----------------
// p: per-flight probability in "realistic"; tier: 1 = mild, 2 = serious, 3 = accident-level (chaos only).
// `window` is when it can physically happen; `inject` puts it into the physics or the air.
export const SCENARIOS = [
  { id: 'turb-moderate', label: 'Moderate clear-air turbulence', tier: 1, p: 0.18, window: (fm) => ['cruise', 'climb', 'descent'].includes(fm.phase) && fm.h > 5500 },
  { id: 'turb-severe', label: 'Severe clear-air turbulence', tier: 2, p: 0.015, window: (fm) => fm.phase === 'cruise' || (fm.phase === 'descent' && fm.h > 7000) },
  { id: 'wake', label: 'Wake turbulence on approach', tier: 1, p: 0.03, window: (fm) => fm.phase === 'approach' && fm.h > 600 && fm.h < 1800 },
  { id: 'windshear', label: 'Microburst on final', tier: 2, p: 0.01, window: (fm) => fm.phase === 'approach' && fm.m.touchdown - fm.s < 14000 && fm.m.touchdown - fm.s > 9000 },
  { id: 'go-around', label: 'Runway still occupied (go-around)', tier: 1, p: 0.02, window: (fm) => fm.phase === 'approach' && fm.m.touchdown - fm.s < 20000 && !fm.airport },
  { id: 'bird-minor', label: 'Bird strike (no damage)', tier: 1, p: 0.01, window: (fm) => (fm.phase === 'climb' && fm.h > 150 && fm.h < 900) || (fm.phase === 'approach' && fm.h < 900 && fm.h > 150) },
  { id: 'lightning', label: 'Lightning strike', tier: 1, p: 0.01, window: (fm, S) => ['descent', 'approach', 'climb'].includes(fm.phase) && fm.h > 700 && fm.h < 4500 && (S.atmo.inCloud || S.atmo.rain > 0.5 || S.incidents.mode !== 'realistic') },
  { id: 'medical', label: 'Passenger taken ill', tier: 1, p: 1 / 604, window: (fm) => fm.phase === 'cruise' || (fm.phase === 'climb' && fm.h > 4000) },
  { id: 'rto', label: 'Engine failure before V1', tier: 2, p: 0.003, window: (fm) => fm.phase === 'takeoff' && fm.ias > 70 && fm.ias < (fm.afs.v1 || 140) - 12 },
  { id: 'efato', label: 'Engine failure after V1', tier: 2, p: 0.001, window: (fm) => fm.phase === 'takeoff' && fm.ias > (fm.afs.v1 || 140) + 2 },
  { id: 'bird-engine', label: 'Bird ingested, engine failure in the climb', tier: 2, p: 0.002, window: (fm) => fm.phase === 'climb' && fm.agl > 120 && fm.agl < 900 },
  { id: 'engine-fire', label: 'Engine fire', tier: 2, p: 0.001, window: (fm) => (fm.phase === 'climb' && fm.h > 1500) || fm.phase === 'cruise' },
  { id: 'engine-shutdown', label: 'Engine oil pressure loss (shutdown)', tier: 2, p: 0.002, window: (fm) => fm.phase === 'cruise' },
  { id: 'depress', label: 'Rapid decompression', tier: 2, p: 0.001, window: (fm) => fm.phase === 'cruise' && fm.h > 9000 },
  { id: 'hydraulic', label: 'Hydraulic failure (green system)', tier: 2, p: 0.002, window: (fm) => fm.phase === 'cruise' || (fm.phase === 'descent' && fm.h > 5000) },
  { id: 'dual-engine', label: 'Bird flock: both engines lost', tier: 3, p: 0, window: (fm) => fm.phase === 'climb' && fm.agl > 700 && fm.agl < 1100 },
  { id: 'gear-unsafe', label: 'A main gear leg will not lock down', tier: 3, p: 0, window: (fm) => ['cruise', 'descent', 'approach'].includes(fm.phase) },
];

// time of useful consciousness (s) after a rapid decompression, by cabin altitude (ft)
const TUC = [[10000, 3600], [15000, 1500], [18000, 720], [22000, 300], [25000, 150], [28000, 80], [30000, 45], [35000, 22], [40000, 9], [45000, 6]];
function tucAt(ft) {
  if (ft <= TUC[0][0]) return TUC[0][1];
  for (let i = 1; i < TUC.length; i++) if (ft < TUC[i][0]) { const [a, ta] = TUC[i - 1], [b, tb] = TUC[i]; return lerp(ta, tb, (ft - a) / (b - a)); }
  return TUC[TUC.length - 1][1];
}

export class Incidents {
  constructor(S, mode = 'realistic') {
    this.S = S; this.mode = mode; this.r = rng(Math.floor(Math.random() * 1e9));
    this.plan = []; this.active = []; this.log = []; this.t = 0;
    this.hypoxia = 0; this.unconscious = false;
    this.times = {};
    this._planFlight();
  }

  _planFlight() {
    const r = this.r, mode = this.mode;
    if (mode === 'off') return;
    let pick = [];
    if (mode === 'realistic') pick = SCENARIOS.filter((s) => s.p > 0 && r() < s.p * 2.5);
    else {
      const pool = SCENARIOS.filter((s) => (mode === 'eventful' ? s.tier <= 2 : true));
      const n = mode === 'eventful' ? 1 + (r() < 0.4 ? 1 : 0) : 2 + Math.floor(r() * 2);
      const order = [...pool].sort(() => r() - 0.5);
      // chaos always includes one serious or accident-level event
      if (mode === 'chaos') order.sort((a, b) => (b.tier >= 2 ? 1 : 0) - (a.tier >= 2 ? 1 : 0) || r() - 0.5);
      for (const s of order) { if (pick.length >= n) break; if (this._compatible(pick, s)) pick.push(s); }
    }
    // each planned event happens at a random moment inside its window
    this.plan = pick.map((s) => ({ s, delay: 5 + r() * 90, armed: 0, done: false }));
  }
  _compatible(list, s) {
    const exclusive = ['rto', 'efato', 'bird-engine', 'dual-engine', 'engine-fire', 'engine-shutdown'];
    if (exclusive.includes(s.id) && list.some((x) => exclusive.includes(x.id))) return false;
    if (s.id === 'depress' && list.some((x) => x.id === 'engine-fire')) return false;
    return !list.some((x) => x.id === s.id);
  }

  // The pause menu's "Make something happen": it happens as soon as its window opens.
  trigger(id) {
    const s = SCENARIOS.find((x) => x.id === id); if (!s) return false;
    this.plan.push({ s, delay: 0, armed: 0, done: false, manual: true });
    this.S.ui.toast(s.window(this.S.fm, this.S) ? `${s.label}…` : `${s.label}: will happen when the flight gets there`, 3);
    return true;
  }

  say(script, opts) { this.S.director.say(script, opts); }
  note(id) { const sc = SCENARIOS.find((x) => x.id === id); this.log.push({ t: this.S.director.t, id, text: sc ? sc.label : id }); }
  later(sec, fn) { this.active.push({ id: 'later', t: 0, step: (dt, a) => { if (a.t >= sec) { a.done = true; fn(); } } }); }
  once(key, gap = 1e9) { const t = this.times[key]; if (t != null && this.t - t < gap) return false; this.times[key] = this.t; return true; }

  update(dt) {
    const S = this.S, fm = S.fm;
    this.t += dt;
    for (const p of this.plan) {
      if (p.done) continue;
      if (p.s.window(fm, S)) { p.armed += dt; if (p.armed >= p.delay) { p.done = true; this._inject(p.s.id); } }
    }
    for (const a of [...this.active]) { a.t += dt; if (a.step) a.step(dt, a); if (a.done) this.active.splice(this.active.indexOf(a), 1); }
    this._hypoxia(dt);
    this._fog(dt);
    this._evacuation(dt);
  }

  // ---------------- putting a failure or hazard into the world ----------------
  _inject(id) {
    const S = this.S, fm = S.fm, A = S.audio, r = this.r;
    this.note(id);
    const side = r() < 0.5 ? 0 : 1;
    switch (id) {
      // ICAO moderate: accelerometer changes of 0.5 to 1.0 g at the CG
      case 'turb-moderate': S.atmo.addCAT(4.2 + r() * 1.2, 70 + r() * 60); break;
      // ICAO severe: changes of more than 1 g. Realistic: a drop to about +0.1 to +0.3 g, then about 1.8 g;
      // eventful: below zero g; chaos: like SQ321 in May 2024 (+1.35 g to -1.5 g in 0.6 s)
      case 'turb-severe': {
        const [jolt, width] = this.mode === 'chaos' ? [44 + r() * 6, 0.12] : this.mode === 'eventful' ? [27 + r() * 5, 0.18] : [17 + r() * 5, 0.28];
        S.atmo.addCAT(5.0, 45, jolt, width); this.times.severeCAT = this.t;
        break;
      }
      case 'wake': S.atmo.addWake(0.3 + r() * 0.2, 2.5, 5); break;
      case 'windshear': { const p = fm.path.sample(fm.m.touchdown - 3000, {}); S.atmo.addMicroburst(p.x, p.z, { R: 900 + r() * 300, u: 12 + r() * 4, w: 9 + r() * 3 }); break; }
      // something still on the runway when we get there (a slow vacate, a vehicle): ATC sends us around
      case 'go-around': S.atc.blockRunway((fm.m.touchdown - fm.s) / Math.max(fm.gs, 60) + 15 + r() * 30); break;
      case 'bird-minor': A.bang(0.35); fm.thump = Math.max(fm.thump, 0.3); S.crew.later(1.5, () => S.crew.say('pm', 'Bird strike. Engine parameters normal.'));
        this.later(2, () => S.ui.toast('A faint burnt smell drifts through the cabin.', 5)); this.later(60, () => this.say(EMERGENCY_PA.birdMinor)); break;
      case 'lightning': S.atmo.forceStrike = true; break;
      case 'medical': this._medical(); break;
      case 'rto': case 'efato': A.bang(1.1); A.surge(2); S.ext.setEngineFx(side, { stall: 1.8, smoke: 0.9 }); fm.failEngine(side, 2); break;
      case 'bird-engine': A.bang(1.1); A.surge(4); S.ext.setEngineFx(side, { stall: 1.8, smoke: 0.9 }); fm.engCause = 'bird'; fm.failEngine(side, 2); break;
      // the fire warning: the engine keeps running until the crew shuts it down and fires the extinguishers
      case 'engine-fire': A.bang(0.6); S.ext.setEngineFx(side, { fire: 1, smoke: 1 }); fm.engFire[side] = true; fm.engCause = 'fire'; break;
      case 'engine-shutdown': A.clunk(0.4); fm.engCause = 'oil'; fm.failEngine(side, 1); break;
      case 'depress': fm.depressurise(1); break;
      // green system lost: gear by gravity (and it cannot retract), no autobrake (alternate braking on
      // yellow), no reverser on engine 1, flaps and slats at half speed
      case 'hydraulic': fm.hyd.green = false; break;
      case 'dual-engine': A.bang(1); A.surge(6); for (const i of [0, 1]) { S.ext.setEngineFx(i, { stall: 2.5, smoke: 0.8 }); fm.failEngine(i, 2); } fm.engCause = 'bird'; break;
      case 'gear-unsafe': fm.gearFailLeg = 1 + side; break;
      default: break;
    }
  }

  // ---------------- the cabin reacts to the aircraft and to the flight deck ----------------
  onFlightEvent(e) {
    const S = this.S, fm = S.fm, A = S.audio, D = S.director;
    switch (e) {
      case 'crash':
        A.impact(1.2); A.scream(1.2);
        S.flash = 0.6; S.flashRed = 1;
        D.setLights(0.02, '#ffffff', true);
        if (!fm.survivable) { this._crashDark = 0.01; this.crashT = 0; this.fatal = true; }
        break;
      case 'lightning-strike':
        S.flash = Math.max(S.flash, 0.9); A.lightning(); A.gasp(0.8); D.flickerLights();
        if (this.once('ltPA', 600)) this.later(45, () => this.say(EMERGENCY_PA.lightning));
        break;
      case 'turbulence': if (D.serviceRunning() && this.once('turbPA', 300)) this.say(EMERGENCY_PA.turbModerate); break;
      case 'turbulence-severe': A.scream(1); if (this.once('sevPA', 300)) this.later(60, () => this.say(EMERGENCY_PA.turbApology)); break;
      case 'crew-seated': this.say(EMERGENCY_PA.seatedNow, { priority: 3 }); S.people.crewToJumpSeats(() => {}); break;
      case 'windshear': A.gasp(0.6); break;
      case 'go-around': A.gasp(0.6); S.ui.toast('Go-around: the engines roar up to take-off thrust and the aircraft climbs away', 5); break;
      case 'hard-landing': if (!fm.crashed) this.later(9, () => this.say(EMERGENCY_PA.hardLanding)); break;
      case 'engine-failure-1': case 'engine-failure-2': A.gasp(1); break;
      case 'depressurisation': A.decompression(); A.scream(0.8); S.cabinFog = 1; this.later(3, () => S.ui.toast('The oxygen masks have dropped! Press O to pull one down and put it on.', 8)); break;
      case 'emergency-descent': this.say(EMERGENCY_PA.depressAuto, { priority: 3 }); this.later(8, () => S.people.crewToJumpSeats(() => {})); this._roar = true; break;
      case 'emergency-level': this._roar = false; A.roar(0.1); this.later(20, () => this.say(EMERGENCY_PA.masksOff)); this.later(60, () => A.roar(0)); break;
      default: if (e.startsWith('go-around-')) { const why = e.slice(10); this.later(45, () => this.say(EMERGENCY_PA.goAround(why))); } break;
    }
    if (this._roar) A.roar(fm.h > 4000 ? 0.7 : 0.25);
  }

  // what the crew tells the cabin (crew.js hooks.emergency)
  onCrew(kind, d = {}) {
    const S = this.S, fm = S.fm, A = S.audio, D = S.director;
    switch (kind) {
      case 'engine-drill': {
        // the fire drill: agent 1 puts most engine fires out; if not, agent 2 thirty seconds later
        if (d.fire) {
          const out = this.r() < 0.85 ? 12 : 42;
          this.later(out, () => { fm.engFire[d.i] = false; S.ext.setEngineFx(d.i, { fire: 0, smoke: 0.4 }); if (out > 20) S.crew.say('pm', 'Fire extinguished after agent two.'); });
          this.later(10, () => S.ext.setEngineFx(d.i, { fire: 0.4 }));
        }
        this.later(90, () => S.ext.setEngineFx(d.i, { smoke: 0.08 }));
        break;
      }
      case 'decision': {
        // the captain tells the passengers what happened and what they are doing about it
        D.setSeatbelt(true);
        const i = fm.engFail[0] ? 0 : 1, cause = fm.engCause || 'failure';
        const pa = /medical/.test(d.what) ? (d.back ? EMERGENCY_PA.medicalReturn : EMERGENCY_PA.medicalCapt)
          : /engine/.test(d.what) ? (d.back ? EMERGENCY_PA.engineReturn(i, cause) : EMERGENCY_PA.engineContinue(i, cause))
            : null;
        if (pa) this.later(45, () => this.say(pa));
        if (d.back) D.returned = true;
        break;
      }
      case 'hydraulic': this.later(50, () => this.say(EMERGENCY_PA.hydraulic)); break;
      case 'lightning': break;
      case 'rto': A.gasp(0.7); this.later(4, () => this.say(EMERGENCY_PA.rto)); this.later(64, () => this._end('rto')); break;
      case 'gear-unsafe': this.later(40, () => this.say(EMERGENCY_PA.gearUnsafe, { priority: 3 })); this.later(90, () => { this.say(EMERGENCY_PA.emergencyLanding, { priority: 3 }); }); break;
      case 'dual-engine': this.later(12, () => { this.say(EMERGENCY_PA.emergencyLanding, { priority: 3 }); D.setSeatbelt(true); S.people.crewToJumpSeats(() => {}); }); for (const i of [0, 1]) this.later(30, () => S.ext.setEngineFx(i, { smoke: 0.2 })); break;
      case 'brace': this._brace(); break;
      case 'stopped': {
        this.say(EMERGENCY_PA.stayCalm, { priority: 3 });
        S.ui.toast('Fire engines race up alongside, lights flashing.', 5);
        if (d.forced || fm.crashed) { this._startEvacuation(fm.crashed ? 'crash' : 'forced'); break; }
        // after an engine fire the fire services decide; now and then it ends in an evacuation
        this.later(25, () => {
          if (d.fire && (this.mode === 'chaos' || this.r() < 0.3)) { fm.evacuating = true; S.ext.setEngineFx(fm.engFail[0] ? 0 : 1, { fire: 0.6, smoke: 1 }); this._startEvacuation('fire'); }
          else this.later(30, () => this._end('towed'));
        });
        break;
      }
      default: break;
    }
  }

  _medical() {
    const S = this.S, people = S.people;
    const pax = people.pax.filter((p) => !p.away);
    const patient = pax[Math.floor(this.r() * pax.length)];
    if (!patient) return;
    this.say(EMERGENCY_PA.doctor, { priority: 2 });
    const crew = people.crew.filter((c) => !c.seated);
    const helpers = crew.length ? crew.slice(0, 2) : people.crew.slice(0, 2);
    // a doctor's view after a few minutes: most in-flight medical events are fainting spells and settle
    // (Peterson et al., NEJM 2013: 1 in 604 flights, few end in a diversion); the captain decides with
    // the purser and the doctor
    const serious = this.r() < (this.mode === 'realistic' ? 0.1 : 0.4);
    this.active.push({ id: 'medical', t: 0, step: (dt, a) => {
      if (a.t > 8 && !a.go) {
        a.go = true;
        helpers.forEach((c, k) => { c.clear(); c.headTarget = { x: patient.seat.x, y: 0.9, z: patient.seat.z }; c.queue({ type: 'walk', x: 0, z: patient.seat.z - 0.5 + k * 0.9, speed: 1.3 }, { type: 'call', fn: (x) => { x.setProp('l', 'bag'); } }); });
        S.ui.toast(`Two cabin crew hurry down the aisle to row ${patient.seat.row} with the oxygen bottle and the first-aid kit.`, 6);
      }
      if (a.t > 150 && !a.capt) { a.capt = true; S.crew.medical(serious); }
      if (a.t > 600 || S.fm.onGround) { helpers.forEach((c) => { c.headTarget = null; c.setProp('l', null); }); a.done = true; }
    } });
  }

  _brace() {
    const S = this.S;
    this.say(EMERGENCY_PA.brace, { priority: 4 });
    for (const p of S.people.pax) p.brace = true;
    for (const c of S.people.crew) c.braceSeat = true;
    if (S.people.neighbor) S.people.neighbor.actor.braceSeat = true;
    S.ui.toast('BRACE! Lean forward, head down against the seat in front (press W to lean). Stay down until the aircraft stops.', 8);
  }

  // ---------------- hypoxia ----------------
  // Time of useful consciousness shrinks fast with cabin altitude. FAA AC 61-107B gives 25,000 ft 3-5 min,
  // 30,000 ft 1-2 min, 35,000 ft 30-60 s, 40,000 ft 15-20 s, and a rapid decompression cuts these by up
  // to half, so this uses the lower, halved values (35,000 ft: about 20 s).
  _hypoxia(dt) {
    const S = this.S, fm = S.fm, P = S.player;
    const ft = fm.cabinAlt / FT;
    const tuc = ft < 10000 ? Infinity : tucAt(ft);
    const masked = P.maskOn;
    if (!masked && tuc < Infinity) this.hypoxia += dt / tuc;
    else this.hypoxia = Math.max(0, this.hypoxia - dt * (ft < 12000 ? 0.05 : 0.02));
    if (this.hypoxia > 0.5 && !this._hypoWarn) { this._hypoWarn = true; S.ui.toast('Your vision narrows and your fingers tingle. Put on the oxygen mask! (O)', 6); }
    if (this.hypoxia >= 1 && !this.unconscious) { this.unconscious = true; this.uncT = 0; S.ui.toast('You passed out from a lack of oxygen.', 5); }
    if (this.unconscious) { this.uncT += dt; if (ft < 12000 && this.uncT > 25) { this.unconscious = false; this.hypoxia = 0.4; S.ui.toast('You come round. A passenger has put a mask on your face. Your head is pounding.', 7); P.maskOn = true; } }
    S.hypoxia = clamp(this.hypoxia, 0, 1) * 0.8;
    S.blackout = Math.max(this.unconscious ? 1 : clamp((this.hypoxia - 0.8) * 3, 0, 0.8), this._crashDark || 0);
  }
  _fog(dt) { const S = this.S; if (S.cabinFog > 0) { S.cabinFog = Math.max(0, S.cabinFog - dt / 25); if (S.cabinScene.fog) S.cabinScene.fog.density = S.cabinFog * 0.35; } }

  // ---------------- crash, evacuation, endings ----------------
  _evacuation(dt) {
    const S = this.S, fm = S.fm, A = S.audio;
    if (fm.crashed) {
      // sliding: scrape noise follows the speed
      A.scrape(fm.crashStopped ? 0 : clamp(fm.gs / 60, 0, 1));
      if (this.fatal) {
        this.crashT += dt; this._crashDark = clamp(this.crashT / 1.2, 0, 1);
        if (this.crashT > 3 && !this._ended) this._end('fatal');
        return;
      }
      if (fm.crashStopped && !this.evac) this._startEvacuation();
    }
    if (!this.evac) return;
    const ev = this.evac;
    ev.t += dt;
    if (ev.t > 3 && !ev.doors) {
      ev.doors = true;
      for (const [name, d] of Object.entries(S.cabin.doors)) { if (ev.blocked.includes(name)) continue; d.target = 1; d.fast = true; }
      for (const h of S.cabin.hatches || []) if (h.side !== ev.fireSide) h.mesh.visible = false;
    }
    // slides inflate automatically as each armed door opens (about 6 seconds)
    if (ev.doors && !ev.slides && ev.t > 5.5) { ev.slides = true; for (const name of Object.keys(S.cabin.doors)) if (!ev.blocked.includes(name)) S.ext.deploySlide(name); A.slide(); }
    // passengers leave through the nearest usable exit
    ev.spawnT -= dt;
    if (ev.doors && ev.spawnT <= 0 && S.people.walkers.length < 44) { ev.spawnT = 0.3; this._spawnEvacuee(); }
    for (const w of [...S.people.walkers]) {
      if (!w.evacExit) continue;
      if (!w.task && !w.tasks.length) { w.root.visible = false; S.people.walkers.splice(S.people.walkers.indexOf(w), 1); ev.out++; }
    }
    // the player: reach an open exit and slide
    const P = S.player;
    if (!ev.playerOut && P.state === 'standing' && ev.doors) {
      const ex = this._nearestExit(P.pos.x, P.pos.z);
      // at a door: step into the doorway; at an over-wing exit: climb out from the exit row
      if (ex && Math.abs(P.pos.z - ex.z) < 0.65 && (ex.name === 'hatch' || Math.abs(P.pos.x - ex.x) < 1.0)) { ev.playerOut = true; A.slide(); this._end('evacuated'); }
    }
    if (ev.t > 20 && !ev.nag && !ev.playerOut && P.state === 'seated') { ev.nag = true; S.ui.toast('Get out! B to release your belt, Space to stand, then go to the nearest exit.', 7); }
  }

  _startEvacuation(reason = 'crash') {
    const S = this.S, fm = S.fm, A = S.audio;
    // a fire on one side (the engine that failed, or random after a crash) blocks those exits
    const fireSide = fm.engFail[0] ? -1 : fm.engFail[1] ? 1 : this.r() < 0.5 ? -1 : 1;
    const blocked = reason === 'crash' ? (fireSide < 0 ? ['L4'] : ['R4']) : [];
    this.evac = { t: 0, out: 0, spawnT: 1, blocked, fireSide, reason, total: S.people.pax.filter((p) => !p.away).length };
    S.director.setLights(0.03, '#ffffff', true);
    S.cabin.setEmergency?.(true);
    S.director.setSeatbelt(false, false);
    this.say(EMERGENCY_PA.evacuate, { priority: 5 });
    A.gasp(1.2);
    S.people.crew.forEach((c) => { c.braceSeat = false; });
    for (const p of S.people.pax) p.brace = false;
    S.ui.toast('EVACUATE! Release your seatbelt (B), stand up (Space) and get to an exit. Leave your bag!', 9);
    if (S.fm.engFail.some(Boolean) || reason === 'crash') S.ext.setEngineFx(fireSide < 0 ? 0 : 1, { fire: 0.7, smoke: 1 });
  }

  exits() {
    const ev = this.evac, D = this.S.cabin.doors;
    const list = [];
    for (const [name, d] of Object.entries(D)) if (!ev || !ev.blocked.includes(name)) list.push({ name, x: d.side * 1.3, z: d.z });
    for (const h of this.S.cabin.hatches || []) if (!ev || h.side !== ev.fireSide) list.push({ name: 'hatch', x: h.side * 1.4, z: h.z });
    return list;
  }
  _nearestExit(x, z) { let best = null, bd = 1e9; for (const e of this.exits()) { const d = Math.abs(e.z - z) + Math.abs(e.x - x) * 0.3; if (d < bd) { bd = d; best = e; } } return best; }

  _spawnEvacuee() {
    const S = this.S, people = S.people, ev = this.evac;
    const seated = people.pax.filter((p) => !p.away);
    if (!seated.length) return;
    // aisle seats first, spread along the cabin
    seated.sort((a, b) => (a.seat.letter === 'C' || a.seat.letter === 'D' ? -1 : 0) - (b.seat.letter === 'C' || b.seat.letter === 'D' ? -1 : 0) || this.r() - 0.5);
    const p = seated[0];
    const ex = this._nearestExit(p.seat.x, p.seat.z);
    const act = people.spawnWalker(p);
    act.evacExit = ex;
    const hatch = ex.name === 'hatch';
    act.queue({ type: 'walk', x: Math.sign(p.seat.x) * 0.1, z: p.seat.z - 0.2, speed: 1.6 }, { type: 'walk', x: 0, z: ex.z, speed: 1.8 }, { type: 'walk', x: hatch ? ex.x * 0.7 : ex.x, z: ex.z, speed: 1.4 });
  }

  // ---------------- endings ----------------
  _end(kind) {
    if (this._ended) return; this._ended = true;
    const S = this.S, D = S.director, ev = this.evac;
    const mins = Math.round(D.t / 60);
    const texts = {
      fatal: { label: 'Accident', title: 'The flight did not arrive', text: `${S.opts.flight} was destroyed in an accident. In reality this is extraordinarily rare: in 2024 there were 7 fatal accidents in 40.6 million flights worldwide (IATA), and the Airbus A320 family has flown more than 176 million flights since 1988.`, items: [['Time', `${mins} min`], ['Impact speed', `${Math.round((S.fm.crashSpeed || 0) / KT)} kt`], ['Events', this.log.map((l) => l.text).join(', ') || '—']] },
      evacuated: { label: 'Emergency evacuation', title: 'You got out', text: `You left the aircraft ${Math.round(ev?.t || 0)} seconds after the evacuation order. Aircraft are certified so that everyone can get out in 90 seconds with half the exits blocked. ${S.fm.crashed ? 'The aircraft is damaged beyond repair, but it held together — the cabin crew\'s commands and your brace position are what make crashes like this survivable.' : ''}`, items: [['Time on board', `${mins} min`], ['Your evacuation time', `${Math.round(ev?.t || 0)} s`], ['Passengers out before you', String(ev?.out ?? 0)], ['Events', this.log.map((l) => l.text).join(', ') || '—']] },
      towed: { label: S.fm.airport === 'ARN' ? 'Stockholm Arlanda' : 'Copenhagen Kastrup', title: 'Safely on the ground', text: `The aircraft stopped on the runway, the fire services checked it over, and a tug towed you to a stand. ${this.log.length ? 'Your flight had: ' + this.log.map((l) => l.text).join(', ') + '.' : ''} Emergencies like this are trained for in the simulator every six months, and almost always end exactly like this.`, items: [['Time on board', `${mins} min`], ['Landed at', S.fm.airport === 'ARN' ? 'Stockholm Arlanda (returned)' : 'Copenhagen Kastrup']] },
      rto: { label: `Stockholm Arlanda · runway ${S.atc?.depRwy || '19R'}`, title: 'Take-off rejected', text: 'The crew stopped the aircraft on the runway. After the brakes had cooled, you taxied back to the gate and SAS rebooked everyone onto a later flight to Copenhagen.', items: [['Time on board', `${mins} min`], ['Top speed', `${Math.round(S.fm._rtoV || 110)} kt`]] },
    }[kind];
    if (!texts) return;
    S.ended = true;
    setTimeout(() => {
      S.ui.showEnd(texts);
      if (document.pointerLockElement) { S._noPauseOnUnlock = true; document.exitPointerLock(); }
    }, kind === 'fatal' ? 1500 : 3000);
  }
}
