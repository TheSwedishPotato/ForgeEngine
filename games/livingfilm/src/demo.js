/**
 * A test reel for tooling only (?demo=1): stands in for Claude so the
 * renderer and the turn loop can be checked headless. Never used in play.
 */
const REELS = [
  {
    scene: { place: 'street', name: 'Kutná Hora, the lane below the mint', time: 'dawn', weather: 'snow', light: 'overcast', mood: 'melancholy', present: ['jitka', 'soldier'], new: true },
    cast: [
      { id: 'jitka', name: 'Jitka', sex: 'f', age: 52, role: 'a baker\'s widow who feeds the miners\' children', look: { skin: '#e0b896', hair: '#5a4030', hairStyle: 'veil', clothes: '#6a3a2a', accent: '#c8a050', beard: 0, build: 'stout' }, voice: { pitch: 1.1, rate: 0.95 }, feeling: 30, note: 'worried for you', secret: 'she hid a sack of the mint\'s silver under her oven' },
      { id: 'soldier', name: 'Bence', sex: 'm', age: 28, role: 'a Hungarian soldier quartered in the lane', look: { skin: '#c48e6a', hair: '#2a1e14', hairStyle: 'cap', clothes: '#3a4a2a', accent: '#8a6a3a', beard: 0.6, build: 'broad' }, voice: { pitch: 0.8, rate: 1 }, feeling: -10, note: 'bored and cold, looking for trouble', secret: '' },
    ],
    beats: [
      { shot: 'establishing', on: [], move: 'pan-right', narration: 'Snow falls on the roofs of Kutná Hora. Smoke rises from only half the chimneys.', who: null, line: '', emotion: 'neutral' },
      { shot: 'wide', on: ['jitka', 'soldier'], move: 'push-in', narration: 'A woman sweeps the step of a shuttered bakery. Across the lane a soldier stamps his feet against the cold.', who: null, line: '', emotion: 'neutral' },
      { shot: 'close', on: ['jitka'], move: 'push-in', narration: '', who: 'jitka', line: '*leans on her broom* You\'re out early, child. Don\'t let that one see you carrying anything.', emotion: 'tender' },
      { shot: 'over-shoulder', on: ['soldier'], move: 'static', narration: '', who: 'soldier', line: 'You! What is in the basket?', emotion: 'suspicious' },
    ],
    suggestions: [{ kind: 'say', text: 'Only bread, sir. For my mother.' }, { kind: 'do', text: 'I hide the basket behind Jitka.' }, { kind: 'say', text: 'Nothing that belongs to you.' }, { kind: 'do', text: 'I run for the alley.' }],
    summary: 'A cold dawn in Kutná Hora after its taking. Jitka the baker\'s widow warns the player; a soldier wants to see their basket.',
    memory: '',
  },
  {
    scene: { place: 'tavern', name: 'The Black Ox', time: 'night', weather: 'clear', light: 'firelight', mood: 'warm', present: ['jitka', 'host'], new: true },
    cast: [{ id: 'host', name: 'Old Matěj', sex: 'm', age: 64, role: 'the innkeeper, who has seen three wars', look: { skin: '#d6a882', hair: '#8a8478', hairStyle: 'bald', clothes: '#4a3a28', accent: '#a07040', beard: 0.9, build: 'stout' }, voice: { pitch: 0.75, rate: 0.9 }, feeling: 15, note: 'curious about you' }],
    beats: [
      { shot: 'establishing', on: [], move: 'drift', narration: 'That night, the Black Ox. Firelight, smoke, a dog asleep under the bench.', who: null, line: '', emotion: 'neutral' },
      { shot: 'two-shot', on: ['jitka', 'host'], move: 'push-in', narration: '', who: 'host', line: 'So this is the one who talked back to a Hungarian. Sit. The beer is thin, but it is warm.', emotion: 'amused' },
      { shot: 'close', on: ['jitka'], move: 'static', narration: '', who: 'jitka', line: 'You were brave today. Brave and a fool. Your father was the same.', emotion: 'sad' },
      { shot: 'insert', on: [], move: 'push-in', narration: 'The fire cracks. A log settles.', who: null, line: '', emotion: 'neutral' },
    ],
    suggestions: [{ kind: 'say', text: 'Tell me about my father.' }, { kind: 'do', text: 'I sit by the fire and warm my hands.' }, { kind: 'say', text: 'What is under your oven, Jitka?' }, { kind: 'say', text: 'Who will stand against them?' }],
    summary: 'The player defied the soldier; that night at the Black Ox, Jitka and old Matěj take them in.',
    memory: 'You defied a Hungarian soldier in the lane.',
  },
];
let n = 0;
export const demoSample = {
  async json() { await new Promise((r) => setTimeout(r, 300)); return JSON.parse(JSON.stringify(REELS[Math.min(n++, REELS.length - 1)])); },
};
