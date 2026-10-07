/**
 * The story as it stands: premise, the player's character, the cast and
 * what they feel, the scene, the running summary, the things never to be
 * forgotten, and the log of what was said and done. Saved in this browser.
 */

export function newStory({ premise, world = '', player }) {
  return {
    v: 1, premise, world,
    player: { name: player.name || 'You', sex: player.sex ?? 'm', who: player.who ?? '', look: { skin: '#d6a882', hair: '#4a3020', clothes: '#5a4a34', accent: '#a08040', hairStyle: 'short', beard: 0, build: 'slim', ...(player.look ?? {}) } },
    cast: {}, scene: null, summary: '', chronicle: [], log: [], suggestions: [], turns: 0, started: Date.now(),
  };
}

/** Fold a cleaned reply (director.cleanReply) and the player's input into the story. */
export function applyReply(state, input, r) {
  if (input) state.log.push({ who: 'you', kind: input.kind, text: input.text });
  state.cast = r.cast;
  state.scene = r.scene;
  for (const b of r.beats) {
    if (b.narration) state.log.push({ who: null, text: b.narration });
    if (b.line) state.log.push({ who: b.who, text: b.line });
  }
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
  if (r.summary) state.summary = r.summary;
  if (r.memory) { state.chronicle.push(r.memory); if (state.chronicle.length > 40) state.chronicle.shift(); }
  state.suggestions = r.suggestions;
  state.turns++;
  return state;
}

const KEY = 'living-film-story';
export function saveStory(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; } }
export function loadStory() { try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return s?.v === 1 ? s : null; } catch { return null; } }
export function clearStory() { try { localStorage.removeItem(KEY); } catch { /* blocked */ } }

/** Openings to choose from (or write your own). Each is a premise the director builds the film from. */
export const OPENINGS = [
  {
    id: 'kutna', title: 'The Silver Town', when: 'Kutná Hora, Bohemia · February 1403',
    premise: 'Kutná Hora, the silver-mining town of the Bohemian kings, in the cold weeks after Sigismund of Hungary\'s army (many of them Cumans) took it in the winter of 1402–03 while King Wenceslas IV sits his prisoner in Vienna. Soldiers are quartered in burghers\' houses, the mint is in foreign hands, people have lost kin and goods, and everyone must decide whom to trust. The player begins on a freezing morning in the town.',
    who: 'A young miner\'s child who lost their father in the taking of the town.',
  },
  {
    id: 'venice', title: 'Fire and Glass', when: 'Murano, Venice · spring 1499',
    premise: 'Murano, the glassmakers\' island of the Venetian Republic, spring 1499. The glassblowers\' secrets are guarded by law: a master who flees with them can be hunted down. War with the Ottomans is coming; the city is rich, proud and watchful. The player begins in a glass workshop as the furnaces are lit before dawn.',
    who: 'An apprentice in a master glassblower\'s workshop.',
  },
  {
    id: 'york', title: 'The Long Winter', when: 'Yorkshire, England · December 1348',
    premise: 'A village in the North Riding of Yorkshire, December 1348. Word has come up the roads of a great pestilence in the south, killing whole villages; nobody knows what it is or how it spreads. Christmas is near. The player begins on the day a stranger arrives at the village from the south.',
    who: 'The reeve\'s grown child, who keeps the village\'s tally sticks.',
  },
  {
    id: 'kyoto', title: 'The Ink Seller\'s Debt', when: 'Kyoto, Japan · autumn 1702',
    premise: 'Kyoto, autumn 1702, in the long peace of the Tokugawa shoguns. Merchants grow rich while samurai grow poor; debts, honour and appearances rule the narrow streets. The player begins in a small ink and paper shop on a rainy evening, the night a ronin comes in asking for a loan.',
    who: 'The ink seller\'s eldest child, who keeps the accounts.',
  },
  {
    id: 'own', title: 'Your own story', when: 'Any time, any place',
    premise: '',
    who: '',
  },
];
