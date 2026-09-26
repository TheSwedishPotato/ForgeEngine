// Conversation with the passenger in the next seat, plus their own remarks during the flight.
import { unproject, DEG } from './core.js';
import { GEO } from '../data/geodata.js';
import { project } from './core.js';

const FEATURES = [
  ['Lake Mälaren', 59.40, 17.10, 'lake'], ['Stockholm', 59.33, 18.07, 'city'], ['Södertälje', 59.20, 17.63, 'city'],
  ['Nyköping', 58.75, 17.01, 'city'], ['Norrköping', 58.59, 16.19, 'city'], ['Bråviken bay', 58.63, 16.5, 'sea'],
  ['Linköping', 58.41, 15.62, 'city'], ['Lake Vättern', 58.25, 14.55, 'lake'], ['Jönköping', 57.78, 14.16, 'city'],
  ['Eksjö', 57.67, 14.97, 'city'], ['Vetlanda', 57.43, 15.08, 'city'], ['Växjö', 56.88, 14.81, 'city'], ['Kalmar', 56.66, 16.36, 'city'],
  ['Öland', 56.75, 16.65, 'island'], ['Lake Åsnen', 56.62, 14.7, 'lake'], ['Lake Bolmen', 56.95, 13.68, 'lake'],
  ['Kristianstad', 56.03, 14.16, 'city'], ['Hässleholm', 56.16, 13.77, 'city'], ['Lund', 55.70, 13.19, 'city'],
  ['Malmö', 55.60, 13.00, 'city'], ['the Øresund Bridge', 55.575, 12.84, 'bridge'], ['Copenhagen', 55.676, 12.568, 'city'],
  ['Saltholm', 55.66, 12.77, 'island'], ['the island of Ven', 55.91, 12.69, 'island'], ['Helsingborg', 56.05, 12.69, 'city'],
];

export class Dialogue {
  constructor(people, voice, ui, info) {
    this.people = people; this.voice = voice; this.ui = ui; this.info = info;
    this.n = people.neighbor; this.P = this.n?.P; this.name = this.P?.name;
    this.open = false; this.greeted = false; this.topics = new Set(); this.cool = 20; this.remarked = new Set();
    this.lastT = 0;
  }
  speaker() { return { name: this.name, gender: this.P.app.female ? 'f' : 'm', pitch: this.P.app.female ? 1.08 : 0.92, rate: 1.03 }; }
  say(text, lang = 'en', then) {
    if (!this.n) return;
    this.n.actor.headTarget = this.playerPos ? { x: this.playerPos.x, y: 1.2, z: this.playerPos.z } : null;
    this.n.actor.playGesture(Math.random() < 0.5 ? 'offer' : 'present');
    this.voice.say([{ text, lang, speaker: this.speaker(), volume: 0.9, gap: 250 }], { priority: 1, channel: 'chat', onDone: () => { this.n.actor.headTarget = null; if (then) then(); } });
  }

  where(fm) {
    // nearest notable feature, and which side of the aircraft it is on
    const ll = unproject(fm.pos.x, fm.pos.z);
    let best = null, bd = Infinity;
    for (const [name, lat, lon, kind] of FEATURES) {
      const p = project(lat, lon); const dx = p.x - fm.pos.x, dz = p.z - fm.pos.z; const d = Math.hypot(dx, dz);
      const vis = fm.h > 3000 ? 90000 : 35000;
      if (d < bd && d < vis) { bd = d; best = { name, kind, d, brg: Math.atan2(dx, -dz) }; }
    }
    if (!best) return null;
    let rel = best.brg - fm.heading; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    best.side = Math.abs(rel) < 0.35 ? 'ahead' : Math.abs(rel) > 2.6 ? 'behind us' : rel > 0 ? 'on the right' : 'on the left';
    best.km = Math.round(best.d / 1000);
    return best;
  }

  options(ctx) {
    const o = [];
    const P = this.P;
    if (!this.greeted) o.push({ id: 'hi', text: 'Hej! Hi, how are you?' });
    else {
      if (!this.topics.has('why')) o.push({ id: 'why', text: 'Going to Copenhagen for work or pleasure?' });
      if (this.topics.has('why') && !this.topics.has('job')) o.push({ id: 'job', text: 'What do you do?' });
      if (this.topics.has('why') && !this.topics.has('from')) o.push({ id: 'from', text: 'Where are you from?' });
      if (!ctx.onGround) o.push({ id: 'where', text: 'Do you know what that is down there?' });
      if (ctx.phase === 'taxi-out' || ctx.phase === 'hold' || ctx.phase === 'lineup') o.push({ id: 'nervous', text: 'Do you like flying?' });
      if (!this.topics.has('time')) o.push({ id: 'time', text: 'How long is the flight?' });
      if (ctx.canAskLetOut) o.push({ id: 'letout', text: 'Excuse me, could I get past? I need to stretch my legs.' });
    }
    o.push({ id: 'bye', text: this.greeted ? '(Go back to looking out of the window)' : '(Say nothing)' });
    return o.slice(0, 5);
  }

  choose(id, ctx) {
    const P = this.P;
    const fm = ctx.fm;
    if (id === 'hi') {
      this.greeted = true;
      if (P.lang === 'sv') this.say(`Hej! Bara bra, tack. Oh — you speak English? No problem. I'm ${P.name}.`, 'en');
      else this.say(`Hi! Doing well, thanks. I'm ${P.name} — first time on SAS actually.`, 'en');
    } else if (id === 'why') { this.topics.add('why'); this.say(`It's ${P.why}.`); }
    else if (id === 'job') { this.topics.add('job'); this.say(`I'm ${P.job}. ${JOBS[this.n.persona] || ''}`); }
    else if (id === 'from') { this.topics.add('from'); this.say(P.from === 'Boston' ? `Boston, Massachusetts. My grandmother was from Småland, so this trip is a bit of a pilgrimage.` : `${P.from}${P.from === 'Malmö' ? ', in Skåne' : ', just outside Stockholm'}. ${FROM[this.n.persona] || ''}`); }
    else if (id === 'time') { this.topics.add('time'); this.say(`About an hour gate to gate. If we're on time we'll be at the gate around ${ctx.eta}.`); }
    else if (id === 'nervous') { this.say(NERVOUS[this.n.persona] || "I'm fine with it. The take-off is the best part."); }
    else if (id === 'where') {
      const w = this.where(fm);
      if (!w) this.say(fm.h > 6000 ? "Honestly? Mostly forest and lakes. That's Småland for you." : "No idea, sorry — somewhere in Sweden.");
      else if (w.kind === 'lake') this.say(`That's ${w.name}, ${w.side}. ${w.name === 'Lake Vättern' ? "Sweden's second largest lake — the water is so clear you can drink it." : ''}`);
      else if (w.kind === 'bridge') this.say(`That's the Øresund Bridge ${w.side}! Almost eight kilometres, and the tunnel part goes under the sea right next to the airport.`);
      else this.say(`I think that's ${w.name} ${w.side}, maybe ${w.km} kilometres away.`);
    }
    else if (id === 'letout') { this.say('Of course!', 'en', () => ctx.letOut && ctx.letOut()); }
    else if (id === 'bye') { this.close(); return; }
    this.cool = 25;
  }

  // unprompted remarks at interesting moments
  event(name, ctx) {
    if (!this.n || this.remarked.has(name) || this.voice.busy('pa') || this.muted) return;
    const P = this.n.persona;
    const lines = {
      'takeoff-roll': { erik: 'Here we go.', ingrid: 'I always hold my breath at this part.', maja: 'I love this bit!', david: 'And we\'re off!' },
      'gear-up': { maja: 'Oh — what was that bang?', ingrid: 'That noise was just the landing gear going up, don\'t worry.', linnea: 'Wheels up.' },
      'seatbelt-off': { erik: 'Coffee time.', jonas: 'Finally, the Wi-Fi.', anders: 'Now I can finally get some work done.', sofia: 'Right, emails.' },
      'turbulence': { ingrid: 'Oh dear, bit bumpy.', maja: 'I hate this part.', david: 'Just a few bumps, right?', anders: 'Nothing to worry about, it\'s always like this over Småland.' },
      'descent': { erik: 'My ears are already popping. Try yawning.', ingrid: 'Already? That went fast.', linnea: 'Can you see the bridge yet?' },
      'bridge': { anders: 'There\'s my bridge! I take the train over it almost every day.', maja: 'Look — the Øresund Bridge!', david: 'Wow, that\'s the bridge from "The Bridge", right? Bron, the TV show.', ingrid: 'Oh look, the bridge. So beautiful from up here.', linnea: 'Look, you can see the bridge and Malmö!', erik: 'The bridge is on your side, have a look.', sofia: 'You can see the bridge from here.', jonas: 'Nice view of the bridge.' },
      'touchdown': { ingrid: 'Nice landing!', david: 'Smooth. Welcome to Denmark, I guess!', maja: 'Phew.', anders: 'Home sweet home. Well, almost.' },
      'parked': { erik: 'Have a nice time in Copenhagen!', maja: 'Nice talking to you. Ha det bra!', ingrid: 'Take care now, and enjoy the city.', david: 'Safe travels!', anders: 'Ha det gott!', jonas: 'Now let\'s see if I make my connection...', linnea: 'Enjoy Copenhagen!', sofia: 'Have a good day.' },
    }[name];
    if (!lines) return;
    const line = lines[P] || (Math.random() < 0.35 ? Object.values(lines)[0] : null);
    this.remarked.add(name);
    if (line && Math.random() < 0.85) setTimeout(() => this.say(line), 600 + Math.random() * 1500);
  }

  close() { this.open = false; this.ui.closeChat(); }
}

const JOBS = {
  erik: 'Bridges and tunnels, mostly — so flying over the Øresund always makes me a bit nerdy.',
  maja: 'Apps for a bank. Very glamorous.',
  linnea: 'At Karolinska. Night shifts, so I might fall asleep on you.',
  jonas: 'Backend stuff. I\'ll probably be on the Wi-Fi the whole flight.',
  ingrid: 'I taught Swedish and history for thirty-five years.',
  david: 'At a medical-device company in Cambridge.',
  sofia: 'Mostly contracts. Not very exciting to talk about.',
  anders: 'Pharmaceuticals. Half of Skåne works in pharma or for Novo across the water.',
};
const FROM = {
  erik: 'Nice and quiet.', maja: 'Best part of town.', linnea: 'Not much happens there, but I like it.',
  jonas: 'Close to Arlanda, which is handy.', ingrid: 'I have lived there all my life.', sofia: 'It\'s very calm.', anders: 'Best city in Sweden, don\'t tell the Stockholmers.',
};
const NERVOUS = {
  erik: 'I don\'t mind it. I know how much engineering goes into these things.',
  maja: 'Honestly? Take-off makes me a bit nervous. I just look out of the window.',
  linnea: 'I fly this route a few times a year, it\'s short and easy.',
  jonas: 'I fly so much for work that I barely notice any more.',
  ingrid: 'I used to be scared, but at my age I just enjoy the view.',
  david: 'Love it. I always try to get a window seat.',
  sofia: 'It\'s mostly just a commute for me.',
  anders: 'Twice a week, every week. The crew know me by name.',
};
