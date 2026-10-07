/**
 * A test reel for tooling only (?demo=1): stands in for Claude so the
 * stage, the streaming, the sheet and the turn loop can be checked
 * headless. Never used in play.
 */
const look = (o) => ({ skin: '#e0b896', hair: '#5a4030', hairStyle: 'short', clothes: '#6a3a2a', accent: '#c8a050', beard: 0, build: 'slim', ...o });
const REELS = [
  {
    scene: { id: 'mint-lane', name: 'The lane below the mint', type: 'street', style: 'bohemian', size: 'medium', floor: 'snow', features: ['well', 'cart', 'stalls'], time: 'dawn', weather: 'snow', mood: 'melancholy', present: ['jitka', 'bence'], new: true, kind: 'establishing', conditions: { temperature: '-6 °C, ears ache' } },
    cast: [
      { id: 'jitka', name: 'Jitka', sex: 'f', age: 52, role: 'a baker\'s widow who feeds the miners\' children', tier: 'core', look: look({ hairStyle: 'veil', build: 'stout' }), voice: { pitch: 1.1, rate: 0.95 }, axes: { trust: 6, respect: 5, fear: 1, affection: 6, suspicion: 2 }, state: 'sweeping her step, watching the soldier', intent: 'to get you indoors', model: { want: 'to keep the oven and the children fed', fear: 'that the soldiers find what is under her oven' } },
      { id: 'bence', name: 'Bence', sex: 'm', age: 28, role: 'a Hungarian soldier quartered in the lane', tier: 'standing', look: look({ skin: '#c48e6a', hair: '#2a1e14', hairStyle: 'cap', clothes: '#3a4a2a', beard: 0.6, build: 'broad' }), voice: { pitch: 0.8 }, axes: { trust: 1, respect: 2, fear: 0, affection: 0, suspicion: 6 }, state: 'cold and bored', intent: 'to find something worth taking' },
    ],
    extras: [{ id: 'x1', label: 'a carter', sex: 'm', age: 40, look: look({ clothes: '#5a4a34', hairStyle: 'hood' }), task: 'sweep' }, { id: 'x2', label: 'a girl with a jug', sex: 'f', age: 12, look: look({ clothes: '#7a6a44', hairStyle: 'braid' }), task: 'water' }],
    remarks: [{ who: 'x1', text: 'Early for a miner\'s brat to be about.' }, { who: 'x2', text: 'The Hungarian took our hen.' }],
    beats: [
      { shot: 'establishing', on: [], move: 'pan-right', narration: 'Snow settles on the roofs of Kutná Hora, and smoke rises from only half the chimneys.' },
      { shot: 'wide', on: ['jitka', 'bence'], move: 'push-in', narration: 'A woman sweeps the step of a shuttered bakery while, across the lane, a soldier stamps his feet against the cold.', acts: [{ who: 'jitka', task: 'sweep' }, { who: 'bence', gesture: 'hips' }] },
      { shot: 'close', on: ['jitka'], who: 'jitka', line: 'Well, you\'re out early, child, and with that one watching.', action: 'leans on her broom', emotion: 'tender', gesture: 'beckon' },
      { shot: 'over-shoulder', on: ['bence'], who: 'bence', line: 'You! What is in the basket?', action: 'points with his whole arm', emotion: 'suspicious', gesture: 'point', moves: [{ who: 'bence', to: 'near:you' }] },
    ],
    choices: [{ kind: 'say', text: 'Only bread, sir. For my mother.', risk: 'he may want to see' }, { kind: 'do', text: 'I hide the basket behind Jitka.', risk: 'drags her in' }, { kind: 'say', text: 'Nothing that belongs to you.', risk: 'pride' }, { kind: 'do', text: 'I stand still and watch his hands.', risk: 'time' }, { kind: 'do', text: 'I run for the alley.', risk: 'he is faster' }],
    turn: { line: 'At dawn Jitka warned Anna, and the soldier Bence wanted the basket.' },
    clock: { date: 'Tuesday 6 February 1403', time: 'dawn', season: 'deep winter, wood dear' },
    sheet: { body: { fatigue: 3, hunger: 14 }, means: { money: '2 groschen, 6 heller', carried: ['a basket of rye bread'] } },
    world: { regional: 'Sigismund\'s men hold the town', mood: 'sullen fear' },
    ledger: [{ action: 'walked the lane with a basket at dawn', witnesses: 'Bence, a carter', pending: [{ horizon: 'ripple', what: 'Bence remembers the face', trigger: 'next time he sees you' }] }],
    threads: { A: { name: 'Who holds the mint', status: 'not yet seen' }, B: { name: 'Your father\'s death', status: 'raw' } },
    silent: { plots: [{ owner: 'the mint-master', want: 'to sell silver to Sigismund\'s captain', ifIgnored: 'the miners go unpaid at Candlemas' }], wrongAbout: ['that Jitka is poor'] },
    places: [{ id: 'black-ox', name: 'The Black Ox', type: 'tavern', style: 'bohemian', features: ['hearth', 'long table', 'benches', 'barrels', 'candles'] }],
    chapter: { title: 'Snow on the Silver Town' },
    summary: 'A cold dawn in Kutná Hora after its taking. Jitka the baker\'s widow warns Anna; a soldier wants to see her basket.',
    memory: '',
  },
  {
    scene: { id: 'black-ox', name: 'The Black Ox', type: 'tavern', style: 'bohemian', walls: 'plaster', floor: 'rushes', features: ['hearth', 'long table', 'benches', 'barrels', 'candles'], time: 'night', weather: 'clear', mood: 'warm', present: ['jitka', 'matej'], new: true },
    cast: [{ id: 'matej', name: 'Old Matěj', sex: 'm', age: 64, role: 'the innkeeper, who has seen three wars', tier: 'core', look: look({ skin: '#d6a882', hair: '#8a8478', hairStyle: 'bald', clothes: '#4a3a28', beard: 0.9, build: 'stout' }), voice: { pitch: 0.75, rate: 0.9 }, axes: { trust: 4, respect: 5, fear: 0, affection: 4, suspicion: 3 } }],
    remarks: [{ who: 'matej', text: 'Shut the door, the heat costs money.' }],
    beats: [
      { shot: 'establishing', on: [], move: 'drift', narration: 'That night the Black Ox smells of smoke and wet wool, and a dog sleeps under the bench.' },
      { shot: 'two-shot', on: ['jitka', 'matej'], who: 'matej', line: 'So this is the one who talked back to a Hungarian. Sit, the beer is thin but it is warm.', action: 'wipes a mug that is already clean', emotion: 'amused', task: 'handwork' },
      { shot: 'close', on: ['jitka'], who: 'jitka', line: 'You were brave today, brave and a fool. Your father was the same.', action: 'turns her cup in her hands', emotion: 'sad', gesture: 'clasp', moves: [{ who: 'jitka', to: 'sit' }] },
      { shot: 'insert', on: [], narration: 'The fire cracks, and a log settles into the embers.' },
    ],
    choices: [{ kind: 'say', text: 'Tell me about my father.' }, { kind: 'do', text: 'I sit by the fire and warm my hands.' }, { kind: 'say', text: 'What is under your oven, Jitka?' }, { kind: 'do', text: 'I listen to the men at the far table.' }, { kind: 'say', text: 'Who will stand against them?' }],
    turn: { line: 'At the Black Ox, Jitka and old Matěj took Anna in.', resolution: { action: 'talk back to the soldier', difficulty: 'Demanding', odds: '55 in 100', band: 'Success at Cost', why: 'he was cold and lazy; but he will remember' } },
    report: { profile: 'Anna, 16 years 4 months · a miner\'s daughter in Kutná Hora, fatherless since the town was taken', emotion: 'Raw grief worn as defiance', environment: 'The Black Ox · night, 6 February 1403 · -8 °C outside', npcs: [{ name: 'Jitka', trust: 6, respect: 5, fear: 1, affection: 7, suspicion: 2, state: 'relieved', intent: 'keep you close' }], inMotion: ['A soldier has learned which door you use.'] },
    summary: 'Anna defied the soldier; that night at the Black Ox, Jitka and old Matěj take her in.',
    memory: 'You defied a Hungarian soldier in the lane.',
  },
];
let n = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const demoSample = {
  async json(prompt, { onText } = {}) {
    if (prompt.includes('careful historian')) { await wait(200); return { title: 'Kutná Hora, February 1403', entries: [{ topic: 'food', text: 'Rye bread, peas, beer; Lent near.' }] }; }
    if (prompt.includes('Build the full character sheet')) { await wait(400); return { sheet: { age: '16 years, 4 months', origin: 'born in the miners\' quarter', hands: 'calloused from the windlass', coreWant: 'to be safe again', coreFear: 'to be helpless', speech: 'plain, quick, Czech with German mining words' }, skills: { Mining: { v: 3, why: 'her father' }, Bargaining: { v: 4, why: 'the market' } }, means: { money: '2 groschen' }, moral: { order: 5, regard: 3 }, emotion: { primary: 'grief turned to anger' } }; }
    if (prompt.includes('A film set in')) { await wait(100); return { topic: 'x', text: 'A plausible note.' }; }
    const reply = JSON.parse(JSON.stringify(REELS[Math.min(n++, REELS.length - 1)]));
    const text = JSON.stringify(reply);
    for (let i = 40; i < text.length; i += 60) { onText?.({ text: text.slice(0, i) }); await wait(25); }
    onText?.({ text });
    return reply;
  },
};
