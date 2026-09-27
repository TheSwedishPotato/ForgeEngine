// "Anything can happen": abnormal and emergency events, with crew procedures and PAs.
//
// Everything that follows an event is played out by the physics: a clear-air turbulence patch
// is a gust field the aircraft flies through, an engine failure is thrust going away (and the
// yaw that comes with it), a windshear is a microburst the autopilot has to escape from. The
// events decide *what* goes wrong and *what the crew does about it*; the aircraft decides the rest.
//
// Modes: off, realistic (about as rare as real life, slightly boosted so a few flights in a
// hundred see something), eventful (one or two things will happen), chaos (several, including
// serious failures and accidents).
import { SPEAKERS } from './speech.js';
import { buildReturnRoute } from './flight.js';
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
    }[reason] || ['', ''];
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
  lightning: () => pa(CAPT(), 'Mina damer och herrar, det här är kaptenen. Som några av er märkte blev vi träffade av blixten. Det är inte ovanligt och flygplanet är byggt för det. Allt fungerar normalt och teknikerna tittar på flygplanet efter landningen.',
    'Ladies and gentlemen, this is the captain. As some of you noticed, we were struck by lightning. That is not unusual and the aircraft is built for it. Everything is working normally and the engineers will have a look after we land.'),
  rto: () => pa(CAPT(), 'Mina damer och herrar, det här är kaptenen. Vi avbröt starten på grund av en varning från en av motorerna. Det är en procedur vi tränar regelbundet. Bromsarna är varma, så räddningstjänsten kontrollerar dem, sedan kör vi tillbaka till gaten så att teknikerna kan titta på motorn. Jag ber om ursäkt för förseningen.',
    'Ladies and gentlemen, this is the captain. We rejected the take-off because of a warning from one of the engines. It is a procedure we practise regularly. The brakes are hot, so the fire services will check them, and then we will taxi back to the gate for the engineers to look at the engine. I am sorry for the delay.'),
  hardLanding: () => pa(CAPT(), 'Förlåt för den hårda landningen, vinden byade precis när vi satte ner.', 'Sorry for the firm landing, the wind gusted just as we touched down.'),
  hydraulic: () => pa(CAPT(), 'Mina damer och herrar, det här är kaptenen. Vi har förlorat ett av flygplanets tre hydraulsystem. Vi har två kvar och kan landa säkert, men landningsstället fälls ut med tyngdkraften och vi behöver en längre landningssträcka. Räddningstjänsten möter oss och vi blir bogserade från banan.',
    'Ladies and gentlemen, this is the captain. We have lost one of the aircraft\'s three hydraulic systems. We still have two and can land safely, but the landing gear will be lowered by gravity and we will need a longer landing roll. The fire services will meet us and we will be towed off the runway.'),
  emergencyLanding: () => pa(PURS(), 'Mina damer och herrar, vi förbereder oss för en nödlandning. Lyssna noga på kabinpersonalen. Spänn fast bältet hårt, ställ ryggstödet upprätt och lägg undan allt lösa föremål. När ni hör "Brace!" böjer ni er fram med huvudet mot stolen framför och håller kvar tills flygplanet har stannat.',
    'Ladies and gentlemen, we are preparing for an emergency landing. Listen carefully to the cabin crew. Fasten your seatbelt tightly, put your seat upright and stow all loose items. When you hear "Brace", lean forward with your head against the seat in front and stay down until the aircraft has stopped.'),
  brace: () => [{ text: 'Brace! Brace! Heads down! Stay down!', lang: 'en', speaker: PURS(), pa: true }, { text: 'Huvudet ner! Håll kvar!', lang: 'sv', speaker: PURS(), pa: true }],
  evacuate: () => [{ text: 'Evacuate! Evacuate! Release your seatbelts! Leave everything! Come this way!', lang: 'en', speaker: PURS(), pa: true }, { text: 'Lossa bältet! Lämna allt! Kom hit!', lang: 'sv', speaker: PURS(), pa: true }],
  stayCalm: () => pa(CAPT(), 'Det här är kaptenen. Flygplanet har stannat. Sitt kvar och lyssna på kabinpersonalen.', 'This is the captain. The aircraft has stopped. Please remain seated and listen to the cabin crew.'),
  arrivalReturn: () => pa(PURS(), 'Mina damer och herrar, vi är tillbaka på Stockholm Arlanda. Sitt kvar tills bältesskylten släcks. SAS personal möter er vid gaten och hjälper er med ombokning. Tack för ert tålamod.',
    'Ladies and gentlemen, we are back at Stockholm Arlanda. Please remain seated until the seatbelt sign has been switched off. SAS staff will meet you at the gate and help you with rebooking. Thank you for your patience.'),
};

// ---------------- scenarios ----------------
// p: per-flight probability in "realistic"; tier: 1 = mild, 2 = serious, 3 = accident-level (chaos only)
export const SCENARIOS = [
  { id: 'turb-moderate', label: 'Moderate turbulence', tier: 1, p: 0.18, window: (fm) => ['cruise', 'climb', 'descent'].includes(fm.phase) && fm.h > 5500 },
  { id: 'turb-severe', label: 'Severe clear-air turbulence', tier: 2, p: 0.015, window: (fm) => fm.phase === 'cruise' || (fm.phase === 'descent' && fm.h > 7000) },
  { id: 'wake', label: 'Wake turbulence on approach', tier: 1, p: 0.03, window: (fm) => fm.phase === 'approach' && fm.h > 600 && fm.h < 1800 },
  { id: 'windshear', label: 'Windshear on final', tier: 2, p: 0.01, window: (fm) => fm.phase === 'approach' && fm.m.touchdown - fm.s < 11000 && fm.m.touchdown - fm.s > 7000 },
  { id: 'go-around', label: 'Go-around (runway occupied)', tier: 1, p: 0.02, window: (fm) => fm.phase === 'approach' && fm.agl < 200 && fm.agl > 60 },
  { id: 'bird-minor', label: 'Bird strike (no damage)', tier: 1, p: 0.01, window: (fm) => (fm.phase === 'climb' && fm.h > 150 && fm.h < 900) || (fm.phase === 'approach' && fm.h < 900 && fm.h > 150) },
  { id: 'lightning', label: 'Lightning strike', tier: 1, p: 0.01, window: (fm, S) => ['descent', 'approach', 'climb'].includes(fm.phase) && fm.h > 700 && fm.h < 4500 && (S.world.weather.rain > 0 || S.world.weather.cumulus > 0.5 || S.incidents.mode !== 'realistic') },
  { id: 'medical', label: 'Medical emergency', tier: 1, p: 0.012, window: (fm) => fm.phase === 'cruise' || (fm.phase === 'climb' && fm.h > 4000) },
  { id: 'rto', label: 'Rejected take-off', tier: 2, p: 0.003, window: (fm) => fm.phase === 'takeoff' && fm.ias > 70 && fm.ias < 125 },
  { id: 'bird-engine', label: 'Bird strike, engine failure, return to Arlanda', tier: 2, p: 0.002, window: (fm) => fm.phase === 'climb' && fm.h > 120 && fm.h < 700 },
  { id: 'efato', label: 'Engine failure at take-off, return to Arlanda', tier: 2, p: 0.001, window: (fm) => fm.phase === 'takeoff' && fm.rotating },
  { id: 'engine-fire', label: 'Engine fire', tier: 2, p: 0.001, window: (fm) => (fm.phase === 'climb' && fm.h > 1500) || fm.phase === 'cruise' },
  { id: 'engine-shutdown', label: 'Precautionary engine shutdown in cruise', tier: 2, p: 0.002, window: (fm) => fm.phase === 'cruise' },
  { id: 'depress', label: 'Rapid decompression', tier: 2, p: 0.001, window: (fm) => fm.phase === 'cruise' && fm.h > 9000 },
  { id: 'hydraulic', label: 'Hydraulic failure (green system)', tier: 2, p: 0.002, window: (fm) => fm.phase === 'cruise' || (fm.phase === 'descent' && fm.h > 5000) },
  { id: 'dual-engine', label: 'Bird flock: both engines lost (forced landing)', tier: 3, p: 0, window: (fm) => fm.phase === 'climb' && fm.h > 700 && fm.h < 1100 },
  { id: 'gear-unsafe', label: 'One main gear will not extend', tier: 3, p: 0, window: (fm) => fm.phase === 'approach' && fm.m.touchdown - fm.s < 16000 },
];

export class Incidents {
  constructor(S, mode = 'realistic') {
    this.S = S; this.mode = mode; this.r = rng(Math.floor(Math.random() * 1e9));
    this.plan = []; this.active = []; this.log = []; this.t = 0;
    this.hypoxia = 0; this.unconscious = false;
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
    // each planned event fires at a random moment inside its window
    this.plan = pick.map((s) => ({ s, delay: 5 + r() * 90, armed: 0, done: false }));
  }
  _compatible(list, s) {
    const exclusive = ['rto', 'efato', 'bird-engine', 'dual-engine'];
    if (exclusive.includes(s.id) && list.some((x) => exclusive.includes(x.id))) return false;
    if (s.id === 'depress' && list.some((x) => x.id === 'engine-fire')) return false;
    return !list.some((x) => x.id === s.id);
  }

  // Trigger now (the pause menu's "Make something happen"): arm it so it fires as soon as its window opens.
  trigger(id) {
    const s = SCENARIOS.find((x) => x.id === id); if (!s) return false;
    this.plan.push({ s, delay: 0, armed: 0, done: false, manual: true });
    this.S.ui.toast(s.window(this.S.fm, this.S) ? `${s.label}…` : `${s.label}: will happen at the right moment of the flight`, 3);
    return true;
  }

  say(script, opts) { this.S.director.say(script, opts); }
  note(id) { const sc = SCENARIOS.find((x) => x.id === id); this.log.push({ t: this.S.director.t, id, text: sc ? sc.label : id }); }

  update(dt) {
    const S = this.S, fm = S.fm;
    this.t += dt;
    for (const p of this.plan) {
      if (p.done) continue;
      if (p.s.window(fm, S)) { p.armed += dt; if (p.armed >= p.delay) { p.done = true; this._start(p.s.id, p.manual); } }
    }
    for (const a of [...this.active]) { a.t += dt; if (a.step) a.step(dt, a); if (a.done) this.active.splice(this.active.indexOf(a), 1); }
    this._hypoxia(dt);
    this._fog(dt);
    this._evacuation(dt);
  }

  // ---------------- starting an event ----------------
  _start(id, manual) {
    const S = this.S, fm = S.fm, D = S.director, A = S.audio;
    this.note(id);
    const act = (step, data = {}) => { const a = { id, t: 0, step, ...data }; this.active.push(a); return a; };
    switch (id) {
      case 'turb-moderate': {
        S.atmo.addCAT(2.4 + this.r() * 0.8, 70 + this.r() * 60);
        act((dt, a) => {
          if (a.t > 4 && !a.sign) { a.sign = true; D.setSeatbelt(true); this.say(EMERGENCY_PA.turbModerate); }
          if (a.t > 150 && !a.off) { a.off = true; if (fm.phase === 'cruise') D.setSeatbelt(false); a.done = true; }
        });
        break;
      }
      case 'turb-severe': {
        // realistic: a hard jolt (about 0.6 to 1.6 g); eventful: stronger; chaos: a violent negative-g drop
        const [jolt, width] = this.mode === 'chaos' ? [22 + this.r() * 5, 0.15 + this.r() * 0.05] : this.mode === 'eventful' ? [13 + this.r() * 4, 0.3] : [7 + this.r() * 3, 0.35];
        S.atmo.addCAT(4.2, 45, jolt, width);
        act((dt, a) => {
          if (a.t > 0.5 && !a.s1) { a.s1 = true; D.setSeatbelt(true); }
          if (a.t > 19 && !a.s2) { a.s2 = true; S.audio.scream(1); this.say(EMERGENCY_PA.seatedNow, { priority: 3 }); S.people.crewToJumpSeats(() => {}); }
          if (a.t > 70 && !a.s3) { a.s3 = true; this.say(EMERGENCY_PA.turbApology); fm.levelOff = (fm.levelOff ?? 10973) - 610; }
          if (a.t > 140) a.done = true;
        });
        break;
      }
      case 'wake': S.atmo.addWake(0.3 + this.r() * 0.2, 2.5, 5); act((dt, a) => { if (a.t > 0.8 && !a.g) { a.g = true; A.gasp(0.7); } if (a.t > 3) a.done = true; }); break;
      case 'windshear': {
        const p = fm.path.sample(fm.m.touchdown - 3200, {});
        S.atmo.addMicroburst(p.x, p.z, { R: 900 + this.r() * 300, u: 12 + this.r() * 4, w: 9 + this.r() * 3 });
        // reactive windshear detection: a rapid loss of airspeed or a strong downdraft below 1000 ft
        act((dt, a) => {
          const dv = fm.ias - (a.prev ?? fm.ias); a.prev = fm.ias;
          a.loss = dv / Math.max(dt, 1e-3) < -1.2 ? (a.loss || 0) + dt : 0;
          if (!a.ga && fm.phase === 'approach' && fm.agl < 400 && (a.loss > 1.5 || fm.vs < -7)) { a.ga = true; if (fm.goAround('windshear')) { A.gasp(0.6); this._goAroundFollowUp('windshear'); } }
          if (a.t > 240 || fm.onGround) a.done = true;
        });
        break;
      }
      case 'go-around': if (fm.goAround('runway')) this._goAroundFollowUp('runway'); break;
      case 'bird-minor': A.bang(0.35); act((dt, a) => { if (a.t > 2 && !a.m) { a.m = true; S.ui.toast('A faint burnt smell drifts through the cabin.', 5); } if (a.t > 60 && !a.p) { a.p = true; this.say(EMERGENCY_PA.birdMinor); a.done = true; } }); break;
      case 'lightning': S.flash = Math.max(S.flash, 0.9); A.lightning(); A.gasp(0.8); D.flickerLights(); act((dt, a) => { if (a.t > 45) { this.say(EMERGENCY_PA.lightning); a.done = true; } }); break;
      case 'medical': this._medical(); break;
      case 'rto': {
        if (fm.rejectTakeoff()) {
          A.gasp(0.7);
          act((dt, a) => {
            if (fm.phase === 'rto-stop' && !a.pa) { a.pa = true; a.t0 = a.t; setTimeout(() => this.say(EMERGENCY_PA.rto), 4000); }
            if (a.pa && a.t - a.t0 > 60) { a.done = true; this._end('rto'); }
          });
        }
        break;
      }
      case 'bird-engine': case 'efato': this._engineFailure(this.r() < 0.5 ? 0 : 1, id === 'bird-engine' ? 'bird' : 'failure', true); break;
      case 'engine-fire': this._engineFailure(this.r() < 0.5 ? 0 : 1, 'fire', this._nearDeparture()); break;
      case 'engine-shutdown': this._engineFailure(this.r() < 0.5 ? 0 : 1, 'oil', this._nearDeparture()); break;
      case 'depress': this._depressurisation(); break;
      case 'hydraulic': {
        fm.hyd.green = false; fm.abMed = true; A.chime('single');
        fm.stopOnRunway = true;
        act((dt, a) => { if (a.t > 50 && !a.p) { a.p = true; this.say(EMERGENCY_PA.hydraulic); } if (fm.phase === 'runway-stop' && !a.tow) { a.tow = true; setTimeout(() => this._end('towed'), 45000); } if (a.tow || a.t > 5000) a.done = true; });
        break;
      }
      case 'dual-engine': {
        A.bang(1); A.surge(6); A.gasp(1);
        for (const i of [0, 1]) { S.ext.setEngineFx(i, { stall: 2.5, smoke: 0.8 }); fm.failEngine(i, 2); }
        act((dt, a) => {
          if (a.t > 12 && !a.p) { a.p = true; this.say(EMERGENCY_PA.emergencyLanding, { priority: 3 }); D.setSeatbelt(true); S.people.crewToJumpSeats(() => {}); }
          if (fm.agl < 150 && !a.brace && !fm.onGround) { a.brace = true; this._brace(); }
          if (a.t > 30) for (const i of [0, 1]) S.ext.setEngineFx(i, { smoke: 0.2 });
          if (fm.onGround || fm.crashed) a.done = true;
        });
        break;
      }
      case 'gear-unsafe': {
        const g = this.r() < 0.5 ? 1 : 2; fm.gearFailLeg = g;
        act((dt, a) => {
          if (fm.gear > 0.99 && !a.s) { a.s = true; fm.gearCollapsed[g] = true; A.clunk(0.6); }
          if (a.s && a.t > 40 && !a.p) { a.p = true; this.say(EMERGENCY_PA.emergencyLanding, { priority: 3 }); }
          if (fm.agl < 150 && !a.brace && !fm.onGround && a.s) { a.brace = true; this._brace(); }
          if (fm.onGround || fm.crashed || a.t > 1200) a.done = true;
        });
        break;
      }
      default: break;
    }
  }

  _nearDeparture() { const fm = this.S.fm; return !fm.airport && fm.s < 150000; }

  _goAroundFollowUp(reason) {
    const S = this.S;
    this.active.push({ id: 'ga-pa', t: 0, step: (dt, a) => { if (a.t > 45) { this.say(EMERGENCY_PA.goAround(reason)); a.done = true; } } });
    S.ui.toast('Go-around: the engines roar to take-off thrust and the aircraft climbs away', 5);
  }

  // Engine failure, fire or precautionary shutdown. Near Arlanda the crew returns; later on they continue to Copenhagen.
  _engineFailure(i, cause, returnHome) {
    const S = this.S, fm = S.fm, A = S.audio;
    if (cause === 'bird' || cause === 'failure') { A.bang(1.1); A.surge(cause === 'bird' ? 4 : 2); A.gasp(1); S.ext.setEngineFx(i, { stall: 1.8, smoke: 0.9 }); }
    if (cause === 'fire') { A.bang(0.6); S.ext.setEngineFx(i, { fire: 1, smoke: 1 }); }
    if (cause === 'oil') A.clunk(0.4);
    fm.failEngine(i, cause === 'oil' ? 1 : 2);
    if (fm.phase === 'takeoff' || fm.phase === 'climb') fm.toga = true;
    fm.abMed = true;
    // single-engine ceiling: stay low
    fm.levelOff = Math.min(fm.levelOff ?? 10973, returnHome ? 914 : 5800);
    this.active.push({ id: 'engine', t: 0, step: (dt, a) => {
      if (cause === 'fire' && a.t > 12 && !a.ext1) { a.ext1 = true; S.ext.setEngineFx(i, { fire: 0.4 }); }
      if (cause === 'fire' && a.t > 42 && !a.ext2) { a.ext2 = true; S.ext.setEngineFx(i, { fire: 0, smoke: 0.4 }); }
      if (a.t > 90 && !a.smokeOff) { a.smokeOff = true; S.ext.setEngineFx(i, { smoke: 0.08 }); }
      if (a.t > (cause === 'oil' ? 60 : 75) && !a.pa) {
        a.pa = true;
        if (returnHome) {
          const G2 = fm.pos; fm.divert(buildReturnRoute({ x: G2.x, z: G2.z }, { x: fm.V.x, z: fm.V.z }));
          S.director.returned = true; this.say(EMERGENCY_PA.engineReturn(i, cause));
        } else this.say(EMERGENCY_PA.engineContinue(i, cause));
        S.director.setSeatbelt(true);
      }
      // a fire (or chaos) means stopping on the runway for the fire services; chaos may end in an evacuation
      if (a.pa && (cause === 'fire' || this.mode === 'chaos')) fm.stopOnRunway = true;
      if (fm.phase === 'runway-stop' && !a.stopped) {
        a.stopped = true; a.st = a.t;
        this.say(EMERGENCY_PA.stayCalm, { priority: 3 });
        S.ui.toast('Fire engines race up alongside, lights flashing.', 5);
      }
      if (a.stopped && a.t - a.st > 25 && !a.decide) {
        a.decide = true;
        if (cause === 'fire' && (this.mode === 'chaos' || this.r() < 0.3)) { fm.evacuating = true; S.ext.setEngineFx(i, { fire: 0.6, smoke: 1 }); this._startEvacuation('fire'); }
        else setTimeout(() => this._end('towed'), 30000);
      }
      if (fm.phase === 'arrived' || fm.crashed || a.decide) a.done = true;
    } });
  }

  _depressurisation() {
    const S = this.S, fm = S.fm, A = S.audio, D = S.director;
    A.decompression(); A.scream(0.8);
    fm.depressurise(1); fm.emergencyDescent(3048);
    S.cabinFog = 1; D.setSeatbelt(true);
    this.active.push({ id: 'depress', t: 0, step: (dt, a) => {
      if (a.t > 3 && !a.pa1) { a.pa1 = true; this.say(EMERGENCY_PA.depressAuto, { priority: 3 }); S.ui.toast('The oxygen masks have dropped! Press O to pull one down and put it on.', 8); }
      if (a.t > 8 && !a.crew) { a.crew = true; S.people.crewToJumpSeats(() => {}); }
      S.audio.roar(fm.h > 4000 ? 0.7 : 0.25);
      if (fm.phase !== 'emergency' && a.t > 30 && !a.pa2) { a.pa2 = true; S.audio.roar(0.1); setTimeout(() => this.say(EMERGENCY_PA.masksOff), 20000); }
      if (a.pa2 && a.t > 400) { S.audio.roar(0); a.done = true; }
    } });
  }

  _medical() {
    const S = this.S, people = S.people;
    const pax = people.pax.filter((p) => !p.away);
    const patient = pax[Math.floor(this.r() * pax.length)];
    if (!patient) return;
    this.say(EMERGENCY_PA.doctor, { priority: 2 });
    const crew = people.crew.filter((c) => !c.seated);
    const helpers = crew.length ? crew.slice(0, 2) : people.crew.slice(0, 2);
    this.active.push({ id: 'medical', t: 0, step: (dt, a) => {
      if (a.t > 8 && !a.go) {
        a.go = true;
        helpers.forEach((c, k) => { c.clear(); c.headTarget = { x: patient.seat.x, y: 0.9, z: patient.seat.z }; c.queue({ type: 'walk', x: 0, z: patient.seat.z - 0.5 + k * 0.9, speed: 1.3 }, { type: 'call', fn: (x) => { x.setProp('l', 'bag'); } }); });
        S.ui.toast(`Two cabin crew hurry down the aisle to row ${patient.seat.row} with the oxygen bottle and the first-aid kit.`, 6);
      }
      if (a.t > 150 && !a.capt) { a.capt = true; this.say(EMERGENCY_PA.medicalCapt); }
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
  // Time of useful consciousness shrinks fast with cabin altitude (FAA figures: 25,000 ft 3-5 min,
  // 30,000 ft 1-2 min, 35,000 ft 30-60 s, 40,000 ft 15-20 s).
  _hypoxia(dt) {
    const S = this.S, fm = S.fm, P = S.player;
    const ft = fm.cabinAlt / FT;
    const tuc = ft < 10000 ? Infinity : ft < 15000 ? lerp(2400, 1800, (ft - 10000) / 5000) : ft < 22000 ? lerp(1800, 480, (ft - 15000) / 7000) : ft < 25000 ? lerp(480, 240, (ft - 22000) / 3000) : ft < 30000 ? lerp(240, 90, (ft - 25000) / 5000) : ft < 35000 ? lerp(90, 45, (ft - 30000) / 5000) : lerp(45, 18, clamp((ft - 35000) / 5000, 0, 1));
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
  onFlightEvent(e) {
    const S = this.S, fm = S.fm, A = S.audio;
    if (e === 'crash') {
      A.impact(1.2); A.scream(1.2);
      S.flash = 0.6; S.flashRed = 1;
      S.director.setLights(0.02, '#ffffff', true);
      if (!fm.survivable) { this._crashDark = 0.01; this.crashT = 0; this.fatal = true; }
    }
    if (e === 'go-around-unstable') this._goAroundFollowUp('unstable');
    if (e === 'hard-landing') setTimeout(() => this.say(EMERGENCY_PA.hardLanding), 9000);
    if (e === 'touchdown' && (fm.hyd && !fm.hyd.green)) this._towAtStop = true;
  }

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
      fatal: { label: 'Accident', title: 'The flight did not arrive', text: `${S.opts.flight} was destroyed in an accident. In reality this is extraordinarily rare: commercial aviation averages well under one fatal accident per million flights, and Airbus A320-family aircraft fly over 10 million flights a year.`, items: [['Time', `${mins} min`], ['Impact speed', `${Math.round((S.fm.crashSpeed || 0) / KT)} kt`], ['Events', this.log.map((l) => l.text).join(', ') || '—']] },
      evacuated: { label: 'Emergency evacuation', title: 'You got out', text: `You left the aircraft ${Math.round(ev?.t || 0)} seconds after the evacuation order. Aircraft are certified so that everyone can get out in 90 seconds with half the exits blocked. ${S.fm.crashed ? 'The aircraft is damaged beyond repair, but it held together — the cabin crew\'s commands and your brace position are what make crashes like this survivable.' : ''}`, items: [['Time on board', `${mins} min`], ['Your evacuation time', `${Math.round(ev?.t || 0)} s`], ['Passengers out before you', String(ev?.out ?? 0)], ['Events', this.log.map((l) => l.text).join(', ') || '—']] },
      towed: { label: S.fm.airport === 'ARN' ? 'Stockholm Arlanda' : 'Copenhagen Kastrup', title: 'Safely on the ground', text: `The aircraft stopped on the runway, the fire services checked it over, and a tug towed you to a stand. ${this.log.length ? 'Your flight had: ' + this.log.map((l) => l.text).join(', ') + '.' : ''} Emergencies like this are trained for in the simulator every six months, and almost always end exactly like this.`, items: [['Time on board', `${mins} min`], ['Landed at', S.fm.airport === 'ARN' ? 'Stockholm Arlanda (returned)' : 'Copenhagen Kastrup']] },
      rto: { label: 'Stockholm Arlanda · runway 19R', title: 'Take-off rejected', text: 'The crew stopped the aircraft on the runway. After the brakes had cooled, you taxied back to the gate and SAS rebooked everyone onto a later flight to Copenhagen.', items: [['Time on board', `${mins} min`], ['Top speed', `${Math.round(S.fm._rtoV || 110)} kt`]] },
    }[kind];
    if (!texts) return;
    S.ended = true;
    setTimeout(() => {
      S.ui.showEnd(texts);
      if (document.pointerLockElement) { S._noPauseOnUnlock = true; document.exitPointerLock(); }
    }, kind === 'fatal' ? 1500 : 3000);
  }
}
