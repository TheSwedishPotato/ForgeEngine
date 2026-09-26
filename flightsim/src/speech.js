// Public address announcements & spoken lines (Web Speech API) with captions.
import { fmtClock } from './core.js';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

export class Voice {
  constructor(ui, opts) {
    this.ui = ui; this.enabled = opts.voice !== false; this.langs = opts.lang || 'sv+en';
    this.queue = []; this.current = null; this.voices = [];
    this.volume = 1;
    if (synth) { const load = () => { this.voices = synth.getVoices(); }; load(); synth.onvoiceschanged = load; }
  }
  pick(lang, gender) {
    const vs = this.voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith(lang));
    if (!vs.length) return null;
    const female = /female|hedvig|alva|klara|sara|zira|susan|hazel|libby|sonia|serena|kate|samantha|karen|moira|tessa|fiona|google uk english female/i;
    const male = /male|bengt|oskar|mattias|george|ryan|daniel|david|mark|arthur|google uk english male/i;
    const pref = vs.filter((v) => (gender === 'f' ? female : male).test(v.name));
    const gb = (pref.length ? pref : vs).filter((v) => /gb|uk/i.test(v.lang + v.name));
    return (gb[0] || pref[0] || vs[0]);
  }
  // items: [{text, lang:'sv'|'en', speaker:{name, gender, pitch, rate}, pa:true, onStart, volume}]
  say(items, { priority = 1, onDone, channel = 'pa' } = {}) {
    const job = { items: [...items], priority, onDone, channel };
    if (this.current && priority > this.current.priority) { this._cancelCurrent(); this.queue.unshift(job); }
    else if (priority >= 3) this.queue.unshift(job); else this.queue.push(job);
    this._pump();
    return job;
  }
  busy(channel) { return (this.current && (!channel || this.current.channel === channel)) || this.queue.some((j) => !channel || j.channel === channel); }
  clearChannel(channel) {
    this.queue = this.queue.filter((j) => j.channel !== channel);
    if (this.current && this.current.channel === channel) this._cancelCurrent();
  }
  _cancelCurrent() { if (this.current) { this.current.cancelled = true; if (synth) synth.cancel(); clearTimeout(this.current.timer); this.ui.caption(null); this.current = null; } }
  skipAll() { this.queue = []; this._cancelCurrent(); }
  _pump() {
    if (this.current || !this.queue.length) return;
    const job = this.current = this.queue.shift();
    const next = () => {
      if (job.cancelled) return;
      const it = job.items.shift();
      if (!it) { this.current = null; this.ui.caption(null); if (job.onDone) job.onDone(); this._pump(); return; }
      if (it.lang === 'sv' && this.langs === 'en') { next(); return; }
      if (it.onStart) it.onStart();
      this.ui.caption({ who: it.speaker?.name || '', text: it.text, lang: it.lang, pa: it.pa });
      const words = it.text.split(/\s+/).length;
      const est = Math.max(1.6, words / (it.lang === 'sv' ? 2.5 : 2.6) + 0.6) * 1000 / (it.speaker?.rate || 1);
      let finished = false;
      const fin = () => { if (finished || job.cancelled) return; finished = true; clearTimeout(job.timer); job.timer = setTimeout(next, it.gap ?? 450); };
      const v = this.enabled && synth ? this.pick(it.lang === 'sv' ? 'sv' : 'en', it.speaker?.gender || 'f') : null;
      if (v) {
        const u = new SpeechSynthesisUtterance(it.text);
        u.voice = v; u.lang = v.lang; u.rate = (it.speaker?.rate || 1) * (it.lang === 'sv' ? 1.0 : 1.02); u.pitch = it.speaker?.pitch ?? 1;
        u.volume = (it.volume ?? 1) * this.volume;
        u.onend = fin; u.onerror = fin;
        synth.speak(u);
        job.timer = setTimeout(fin, est * 2.2 + 4000); // safety net
      } else {
        job.timer = setTimeout(fin, est);
      }
    };
    next();
  }
}

// ---------------- scripts ----------------
export const SPEAKERS = {
  purser: { name: 'Purser Karin', gender: 'f', pitch: 1.05, rate: 1.0 },
  captain: { name: 'Captain Henrik Lindqvist', gender: 'm', pitch: 0.85, rate: 0.97 },
  crewM: { name: 'Mikkel', gender: 'm', pitch: 1.0, rate: 1.02 },
  crewF: { name: 'Sanna', gender: 'f', pitch: 1.1, rate: 1.02 },
  crewA: { name: 'Amir', gender: 'm', pitch: 0.95, rate: 1.02 },
};

const pa = (speaker, sv, en, extra = {}) => {
  const out = [];
  if (sv) out.push({ text: sv, lang: 'sv', speaker, pa: true, ...extra });
  if (en) out.push({ text: en, lang: 'en', speaker, pa: true, ...extra });
  return out;
};

export function greeting(h) { return h < 10 ? ['god morgon', 'good morning'] : h < 17 ? ['god dag', 'good afternoon'] : ['god kväll', 'good evening']; }

export const SCRIPTS = {
  welcome: (c) => pa(SPEAKERS.purser,
    `Mina damer och herrar, ${greeting(c.hour)[0]} och välkomna ombord på SAS flight ${c.flightSv} till Köpenhamn. Vi taxar nu ut mot startbanan. Se till att säkerhetsbältet är fastspänt, att ryggstödet är i upprätt läge och att bordet är uppfällt.`,
    `Ladies and gentlemen, ${greeting(c.hour)[1]}, and welcome on board SAS flight ${c.flightEn} to Copenhagen. We are now taxiing out to the runway. Please make sure your seatbelt is fastened, your seat back is upright and your tray table is stowed.`),
  demo: [
    { g: 'present', sv: 'Vi ber nu om er uppmärksamhet för en genomgång av säkerhetsinstruktionerna, även om ni reser ofta.', en: 'We now ask for your attention for our safety demonstration, even if you are a frequent traveller.' },
    { g: 'belt', sv: 'Säkerhetsbältet spänns fast genom att ni för in metalltungan i spännet och drar åt. Öppna genom att lyfta på spännets lock. Vi rekommenderar att ni har bältet löst fastspänt under hela resan.', en: 'To fasten your seatbelt, insert the metal tip into the buckle and tighten the strap. To release, lift the top of the buckle. We recommend that you keep your seatbelt loosely fastened throughout the flight.' },
    { g: 'exits', sv: 'Det här flygplanet har åtta nödutgångar: två dörrar fram, fyra fönsterutgångar över vingarna och två dörrar bak. Ta en stund och lokalisera närmaste utgång. Kom ihåg att den kan finnas bakom er.', en: 'This aircraft has eight emergency exits: two doors at the front, four window exits over the wings and two doors at the rear. Please take a moment to locate your nearest exit, keeping in mind that it may be behind you.' },
    { g: 'floor', sv: 'I en nödsituation leder ljuslister i golvet er till utgångarna.', en: 'In an emergency, lighting strips in the floor will guide you to the exits.' },
    { g: 'mask', sv: 'Om kabintrycket skulle falla, kommer syrgasmasker automatiskt att falla ned från panelen ovanför er. Dra masken mot er, placera den över näsa och mun och andas normalt. Sätt på er egen mask innan ni hjälper andra.', en: 'Should the cabin pressure drop, oxygen masks will fall automatically from the panel above you. Pull the mask towards you, place it over your nose and mouth and breathe normally. Put on your own mask before helping others.' },
    { g: 'vest', sv: 'Flytvästen finns under er stol. Trä den över huvudet, för banden runt midjan och spänn fast dem framtill. Blås upp västen genom att dra i de röda handtagen när ni lämnar flygplanet. Vid behov kan ni fylla på den genom munstyckena.', en: 'Your life jacket is under your seat. Place it over your head, pass the straps around your waist and fasten them at the front. Inflate it by pulling the red tabs as you leave the aircraft. If necessary, top it up by blowing into the mouthpieces.' },
    { g: 'card', sv: 'Läs gärna säkerhetsinstruktionerna i fickan framför er. Rökning, även elektroniska cigaretter, är förbjuden ombord. Ställ in all elektronisk utrustning i flygläge. Tack för er uppmärksamhet.', en: 'Please read the safety card in the seat pocket in front of you. Smoking, including electronic cigarettes, is not permitted on board. Please switch all electronic devices to flight mode. Thank you for your attention.' },
  ],
  seatsTakeoff: () => [{ text: 'Cabin crew, seats for take-off.', lang: 'en', speaker: SPEAKERS.captain, pa: true }],
  captainClimb: (c) => pa(SPEAKERS.captain,
    `Mina damer och herrar, ${greeting(c.hour)[0]} från cockpit. Det är kapten Henrik Lindqvist som talar, och med mig har jag styrman Sofie Madsen. Vi stiger nu mot vår marschhöjd på trettiosex tusen fot, ungefär elva kilometer. Flygtiden till Köpenhamn blir cirka femtio minuter och vi beräknar att landa klockan ${c.etaSv}. I Köpenhamn är det ${c.wxSv} och ${c.tempCph} grader. Säkerhetsbältesskylten är nu släckt, men vi rekommenderar att ni har bältet fastspänt när ni sitter ner. Luta er tillbaka och njut av resan.`,
    `Ladies and gentlemen, ${greeting(c.hour)[1]} from the flight deck. This is Captain Henrik Lindqvist speaking, and with me is First Officer Sofie Madsen. We're climbing to our cruising altitude of thirty-six thousand feet, about eleven kilometres. Our flight time to Copenhagen is around fifty minutes, and we expect to land at ${c.etaEn} local time. The weather in Copenhagen is ${c.wxEn} and ${c.tempCph} degrees. The seatbelt sign is now off, but we recommend you keep your seatbelt fastened while seated. Sit back, relax and enjoy the flight.`),
  service: () => pa(SPEAKERS.purser,
    'Om en liten stund kommer vi ut i kabinen med vår service. Kaffe och te bjuder vi på, och från vår meny kan ni köpa smörgåsar, snacks och dryck. Vi tar endast kort. Flygplanet har också Starlink-wifi, som är gratis för EuroBonus-medlemmar.',
    'In a few minutes we will come through the cabin with our onboard service. Coffee and tea are complimentary, and from our menu you can buy sandwiches, snacks and drinks. We accept card payments only. This aircraft also has high-speed Starlink Wi-Fi, free of charge for EuroBonus members.'),
  descent: (c) => pa(SPEAKERS.captain,
    `Mina damer och herrar, vi har nu påbörjat inflygningen mot Köpenhamn och beräknar att landa om cirka ${c.mins} minuter. Vi landar på bana två-två vänster, så ni som sitter till vänster får en fin utsikt över Öresundsbron och Malmö. Tack för att ni flyger med oss i dag.`,
    `Ladies and gentlemen, we have now started our descent into Copenhagen and expect to land in about ${c.mins} minutes. We'll be landing on runway two-two left, so those of you on the left-hand side should get a nice view of the Øresund Bridge and Malmö. Thank you for flying with us today.`),
  prepareLanding: () => pa(SPEAKERS.purser,
    'Mina damer och herrar, vi närmar oss Köpenhamn. Återgå till era platser och spänn fast säkerhetsbältet. Se till att ryggstödet är upprätt, att bordet är uppfällt och att fönsterluckan är öppen, och lägg undan större elektronisk utrustning. Toaletterna är nu stängda.',
    'Ladies and gentlemen, we are approaching Copenhagen. Please return to your seats and fasten your seatbelt. Make sure your seat back is upright, your tray table is stowed and your window blind is open, and please put larger electronic devices away. The lavatories are now closed.'),
  seatsLanding: () => [{ text: 'Cabin crew, seats for landing.', lang: 'en', speaker: SPEAKERS.captain, pa: true }],
  arrival: (c) => pa(SPEAKERS.purser,
    `Mina damer och herrar, välkomna till Köpenhamn, där klockan är ${c.timeSv} och temperaturen ${c.tempCph} grader. Sitt kvar med bältet fastspänt tills flygplanet har stannat helt och bältesskylten har släckts. Var försiktiga när ni öppnar bagageutrymmena, eftersom saker kan ha flyttat sig under resan. Tack för att ni flög med SAS, medlem i SkyTeam. Vi hoppas att få se er ombord igen snart.`,
    `Ladies and gentlemen, welcome to Copenhagen, where the local time is ${c.timeEn} and the temperature is ${c.tempCph} degrees. Please remain seated with your seatbelt fastened until the aircraft has come to a complete stop and the seatbelt sign has been switched off. Please take care when opening the overhead bins, as items may have moved during the flight. Thank you for flying SAS, a member of SkyTeam. We hope to see you on board again soon.`),
  disarm: () => [{ text: 'Cabin crew, disarm doors and cross-check.', lang: 'en', speaker: SPEAKERS.purser, pa: true }],
  turbulence: () => pa(SPEAKERS.captain, 'Mina damer och herrar, vi väntar lite turbulens framöver. Återgå till era platser och spänn fast bältet.', 'Ladies and gentlemen, we are expecting some turbulence ahead. Please return to your seats and fasten your seatbelts.'),
};

export function context(opts, clockH, etaH) {
  const wx = { clear: ['klart väder', 'clear skies'], fair: ['växlande molnighet', 'a few clouds'], broken: ['mulet med uppehåll', 'mostly cloudy but dry'], rain: ['lätt regn', 'light rain'], fog: ['soligt', 'sunny'] }[opts.weather] || ['växlande molnighet', 'a few clouds'];
  const [, tCph] = opts.temps || [14, 15];
  const toSv = (h) => fmtClock(h).replace(':', '.');
  return {
    hour: clockH, flightSv: spellFlight(opts.flight, 'sv'), flightEn: spellFlight(opts.flight, 'en'),
    etaSv: toSv(etaH), etaEn: fmtClock(etaH), wxSv: wx[0], wxEn: wx[1], tempCph: tCph,
    timeSv: toSv(clockH), timeEn: fmtClock(clockH), mins: 20,
  };
}

function spellFlight(f, lang) {
  const n = f.replace(/\D/g, '');
  return lang === 'sv' ? `S K ${n.split('').join(' ')}` : `S K ${n.split('').join(' ')}`;
}
