/**
 * BATMAN: VESPER — Episode 1: "First Night"
 *
 * Earth-V. Vesper City, a port that never dries. Noah Vale, heir to Vale Maritime, puts on the
 * suit for the first time. The script is written once against the scene API (src/story/api.md)
 * and played by both theatres: the 3D film (src/theatre3d) and the illustrated story
 * (src/theatre2d). Every choice is recorded for the flowchart; free text goes to Claude, who
 * maps it onto the story or improvises inside it; without Claude the authored options carry it.
 *
 * Chapters:  PROLOGUE  Gargoyle        St. Brigid's roof, 23:47, rain
 *            1         Level B3        Harrow Street parking, the abduction
 *            2         The Ledger      the garage roof: Nadia, Cruz
 *            3         The Fall        the ledge: Rook (if he was taken)
 *            4         Black Water     the harbour, the Nightjar, the storm
 *            5         The Ferryman    the MV Acheron
 *            EPILOGUE  Dawn            St. Brigid's, morning
 */

export const TITLE = { name: 'BATMAN: VESPER', episode: 'EPISODE 1', episodeTitle: 'FIRST NIGHT', tagline: 'Every Earth gets a Batman. This one is just beginning.' };

export const CAST = {
  batman: { name: 'Batman', color: '#cfd8e6', voice: { pitch: 0.75, rate: 0.9, gender: 'm' } },
  rook: { name: 'Rook', color: '#e8b27a', voice: { pitch: 0.9, rate: 1.02, gender: 'm' } },
  nadia: { name: 'Nadia Okafor', color: '#d9a7e8', voice: { pitch: 1.1, rate: 1.04, gender: 'f' } },
  cruz: { name: 'Det. Cruz', color: '#8fd1c4', voice: { pitch: 0.98, rate: 1.0, gender: 'f' } },
  marrow: { name: 'Silas Marrow', color: '#c9c27a', voice: { pitch: 0.7, rate: 0.85, gender: 'm' } },
  kow: { name: 'Kowalski', color: '#e88a7a', voice: { pitch: 0.65, rate: 0.95, gender: 'm' } },
  dez: { name: 'Dez', color: '#9ec3ff', voice: { pitch: 1.05, rate: 1.15, gender: 'm' } },
  deckhand: { name: 'Deckhand', color: '#bbbbbb', voice: { pitch: 0.85, rate: 0.95, gender: 'm' } },
  mags: { name: 'Mags', color: '#f2d38a', radio: true, voice: { pitch: 1.0, rate: 1.0, gender: 'f' } },
  dispatch: { name: 'Dispatch', color: '#9aa4b0', radio: true, voice: { pitch: 1.0, rate: 1.1, gender: 'f' } },
};

export const INITIAL_STATE = () => ({
  code: 100,              // Batman's code: falls with cruelty and lethal force
  legend: 0,              // + hope, - fear (what the city will make of him)
  trust: { mags: 2, cruz: 0, nadia: 0, rook: 0 },
  nadia: 'captive',       // captive | safe | hurt
  rook: 'free',           // free | captured | fled | informant | dead | arrested
  marrow: 'unknown',      // unknown | arrested | dead | escaped
  intel: {},              // schematics, ledger, pier9, marrowName, container, lucia, tracker
  hurt: 0,                // Batman's injuries
  flags: {},
  minutes: 0,             // time lost (the Acheron sails at two)
});

// ---------------------------------------------------------------------------
// PROLOGUE — GARGOYLE

export async function prologue(S) {
  await S.chapter('prologue', 'GARGOYLE', 'St. Brigid\'s Cathedral · 23:47');
  await S.stage('cathedral', { time: 'night' });
  S.weather({ rain: 0.75, wind: 0.6, night: 1, overcast: 0.95, lightning: 0.25 });
  S.music('dread', 0.25);
  S.place('batman', 'perch', 180);
  S.act('batman', { posture: 'perch', emote: 'grim' });
  // the city first: a crane down through the rain onto the gargoyle
  S.cut({ type: 'ews', on: 'batman', angle: 160, height: 6, lens: 24, move: 'drop', amount: 4, dur: 9, still: 'cathedral_wide' });
  await S.caption('Vesper City. Earth-V.', 3.2);
  await S.wait(2.5);
  S.strike(0.3);
  S.cut({ type: 'ecu', on: 'batman', angle: 8, height: 0.02, move: 'push', dur: 5, still: 'batman_ecu' });
  await S.say('mags', 'Your heart rate\'s at one-forty, Noah. On a roof. Sitting still.');
  S.cut({ type: 'cu', on: 'batman', angle: -35, height: -0.1, still: 'batman_cu' });
  await S.say('batman', '...It\'s raining.', { emo: 'grim' });
  await S.say('mags', 'It\'s Vesper. It\'s always raining. That isn\'t an answer.');
  S.cut({ type: 'ws', on: 'batman', angle: 120, height: 0.8, lens: 28, move: 'orbit', orbit: 20, dur: 8, still: 'cathedral_wide' });
  const how = await S.choose({
    id: 'p_ready', prompt: 'Mags is waiting.', timer: 9, default: 'silent',
    options: [
      { id: 'ready', label: '"I\'m ready."' },
      { id: 'unsure', label: '"I don\'t know if I am."' },
      { id: 'quiet', label: '"Stay off the line, Mags."' },
      { id: 'silent', label: '(Say nothing)' },
    ],
    free: { who: 'batman', to: 'mags', context: 'Noah Vale, crouched on a cathedral roof in his first night as Batman, talking by radio to Mags Holloway, his late father\'s friend and his only ally, who has asked if he is ready.' },
  });
  if (how === 'ready') { await S.say('batman', 'I\'m ready.', { emo: 'determined' }); await S.say('mags', 'Then be careful with it. Ready gets people killed as often as scared does.'); }
  else if (how === 'unsure') { await S.say('batman', 'I don\'t know if I am.', { emo: 'worried' }); await S.say('mags', 'Good. The sure ones are the ones I bury.'); S.trust('mags', 1); }
  else if (how === 'quiet') { await S.say('batman', 'Stay off the line, Mags.', { emo: 'cold' }); await S.say('mags', 'Twenty years I\'ve been on this line, Noah. I\'m not getting off it tonight.'); S.trust('mags', -1); }
  else if (how === 'silent') { await S.wait(1.2); await S.say('mags', '...I\'ll take that as a yes.'); }
  else if (how?.free) { await S.improv(how); }
  await S.wait(0.6);
  S.sfx('radio');
  S.cut({ type: 'mcu', on: 'batman', angle: 20, still: 'batman_cu' });
  S.act('batman', { lookAt: [6, -10, 30] });
  await S.say('dispatch', 'All units, ten-two-oh-seven in progress. Harrow Street Municipal Parking, level B3. Female forced into a white van. Shots reported.');
  await S.say('dispatch', 'Nearest unit is eleven minutes out.');
  S.music('tension', 0.4);
  await S.say('mags', 'Eleven minutes. In this city that\'s a body.');
  S.cut({ type: 'cu', on: 'batman', angle: -15, move: 'push', dur: 4, still: 'batman_cu' });
  const go = await S.choose({
    id: 'p_go', prompt: 'A woman is being taken. Eleven minutes.', timer: 12, default: 'glide',
    options: [
      { id: 'glide', label: 'Go. Now.', hint: 'You get there first' },
      { id: 'schematics', label: 'Ask Mags for the garage plans', hint: 'Costs a minute' },
      { id: 'cruz', label: 'Call it in to Detective Cruz', hint: 'Anonymous' },
    ],
    free: { who: 'batman', context: 'Batman just heard a police scanner: a woman forced into a van in a parking garage, level B3, police eleven minutes out. He can go now, ask Mags (his ally on the radio) for building plans first, or tip off Detective Renata Cruz, the one honest cop he has read about.' },
  });
  if (go === 'schematics') {
    await S.say('batman', 'Mags. Harrow Street. I need the building.');
    S.sfx('click');
    await S.say('mags', 'Sending. B3 has a maintenance corridor off the stairwell, and the breaker panel for the whole level is on the east wall. If you want the lights out, that\'s where they live.');
    S.intel('schematics'); S.time(1);
  } else if (go === 'cruz') {
    S.cut({ type: 'cu', on: 'batman', angle: 40, still: 'batman_cu' });
    await S.say('batman', 'Detective Cruz.');
    await S.say('cruz', 'Who is this? How did you get this number?', { radio: true });
    await S.say('batman', 'Harrow Street. Level B3. Be there before the rest of them.');
    await S.say('cruz', 'Why would I—', { radio: true });
    S.sfx('click');
    await S.say('mags', 'You hung up on a police detective. That\'s a start.');
    S.trust('cruz', 1); S.flag('cruzTipped'); S.time(0.5);
  } else if (go?.free) { await S.improv(go); }
  // the leap
  S.music('action', 0.55);
  S.act('batman', { posture: 'idle', lookAt: null });
  S.cut({ type: 'mls', on: 'batman', angle: 200, height: -0.6, lens: 24, still: 'batman_leap' });
  await S.wait(0.8);
  S.sfx('cape');
  await S.special('glide', { from: 'perch', to: 'harrow' });
  S.flow('prologue', 'leap', 'The first leap');
}

// ---------------------------------------------------------------------------
// CHAPTER 1 — LEVEL B3

export async function chapter1(S) {
  await S.chapter('ch1', 'LEVEL B3', 'Harrow Street Municipal Parking · 23:58');
  await S.stage('garage');
  S.space('garage');
  S.weather({ rain: 0, wind: 0, lightning: 0, wetness: 0.35 });
  S.ambience({ garage: 0.9, city: 0.15 });
  S.music('dread', 0.45);
  S.place('batman', 'stairDoor', 90);
  S.place('nadia', 'nadiaStart', 270); S.act('nadia', { posture: 'hands_bound', emote: 'afraid' });
  S.place('kow', 'kowStart', 90); S.act('kow', { posture: 'idle_tense', emote: 'angry' });
  S.place('dez', 'dezStart', 0); S.act('dez', { posture: 'gun_low', emote: 'worried' });
  S.place('rook', 'rookPhone', 200); S.act('rook', { posture: 'phone', emote: 'grim' });
  // establishing: through the stairwell door's wired glass
  S.cut({ type: 'ews', on: 'van', at: 'van', angle: 0, still: 'garage_wide', free: true, pos: 'cam_stairs', target: 'van' });
  await S.wait(2.2);
  S.cut({ type: 'mcu', on: 'rook', angle: 30, still: 'rook_phone' });
  await S.say('rook', 'Yeah. She had it on her. The book.', { emo: 'grim' });
  await S.wait(0.8);
  await S.say('rook', 'No. I didn\'t read it. I don\'t read.');
  await S.wait(0.6);
  S.cut({ type: 'cu', on: 'rook', angle: -20, still: 'rook_cu' });
  await S.say('rook', '...Pier Nine. Two o\'clock. Understood.', { emo: 'worried' });
  S.intel('pier9');
  S.act('rook', { posture: 'idle_tense' });
  S.cut({ type: 'ms', on: 'nadia', with: 'kow', angle: 10, still: 'nadia_kow' });
  S.act('nadia', { lookAt: 'rook' });
  await S.say('nadia', 'Whoever\'s paying you is going to cut you loose the second this is done. You know that.', { emo: 'determined' });
  S.act('kow', { play: 'flinch', lookAt: 'nadia' });
  await S.say('kow', 'Shut your mouth.', { emo: 'angry' });
  S.cut({ type: 'cu', on: 'batman', angle: 15, still: 'batman_dark' });
  S.objective('Save the woman.');
  const options = [
    { id: 'stealth', label: 'Stay in the shadows. Take the one on the ramp first.', hint: 'Quiet' },
    { id: 'walk', label: 'Walk into the light.', hint: 'Let them see you' },
  ];
  if (S.has('schematics')) options.unshift({ id: 'breaker', label: 'Kill the lights at the breaker.', hint: 'From the plans' });
  const plan = await S.choose({
    id: 'c1_approach', prompt: 'Four of them. One gun on the ramp, one on the phone. One woman, zip-tied.', timer: 0,
    options,
    free: { who: 'batman', context: 'Batman watches from a stairwell door in an underground garage: Dez (nervous, pistol, watching the ramp), Kowalski (big, violent, holding the hostage Nadia by the van), Rook (the leader, on the phone). He has to save Nadia.' },
  });
  let approach = typeof plan === 'string' ? plan : plan?.mapped ?? 'stealth';
  if (plan?.free) await S.improv(plan);
  S.flag('approach_' + approach);

  if (approach === 'breaker') {
    S.cut({ type: 'ms', on: 'batman', angle: -70, still: 'garage_breaker' });
    S.act('batman', { walkTo: 'breaker' });
    await S.wait(2.4);
    S.cut({ type: 'insert', at: 'breakerPanel', size: 0.35, still: 'garage_breaker' });
    await S.wait(0.6);
    S.sfx('breaker');
    S.lights('off');
    S.legend(-1);
    await S.say('dez', 'Yo— yo, what was that? Rook?', { emo: 'afraid' });
    await S.say('rook', 'Flashlights. Now.', { emo: 'cold' });
    S.cut({ type: 'cu', on: 'dez', angle: 20, still: 'dez_dark' });
    await S.wait(0.8);
    const q1 = await S.qte({ label: 'Take Dez', keys: ['E'], window: 1.6, still: 'takedown' });
    await S.fight('takedown', 'dez', q1);
    S.cut({ type: 'mls', on: 'kow', angle: 30, still: 'kow_dark' });
    await S.say('kow', 'Where are you?!', { emo: 'fury' });
    const q2 = await S.qte({ label: 'Strike', keys: ['Q', 'E'], window: 1.3, still: 'fight_kow' });
    await S.fight('combo', 'kow', q2);
    if (!q2) { S.hurt(1); const q3 = await S.qte({ label: 'Counter', keys: ['F'], window: 1.0, still: 'fight_kow' }); await S.fight('takedown', 'kow', q3); }
    S.lights('emergency');
  } else if (approach === 'stealth') {
    S.cut({ type: 'mls', on: 'batman', angle: 150, still: 'garage_shadows' });
    S.act('batman', { posture: 'crouch', walkTo: 'pillarB' });
    await S.wait(2.6);
    S.cut({ type: 'ots', over: 'batman', on: 'dez', still: 'dez_ramp' });
    await S.wait(1.0);
    const q1 = await S.qte({ label: 'Take Dez quietly', keys: ['E'], window: 1.4, still: 'takedown' });
    if (q1) { await S.fight('takedown', 'dez', true); S.flag('quiet'); }
    else {
      S.sfx('gunshot'); S.kick(0.8);
      await S.say('dez', 'There\'s something here! There\'s something—', { emo: 'afraid' });
      const q2 = await S.qte({ label: 'Dodge', keys: ['A', 'D'], window: 1.0, still: 'dodge' });
      if (!q2) S.hurt(1);
      await S.fight('takedown', 'dez', true);
    }
    S.cut({ type: 'ms', on: 'kow', angle: 40, still: 'kow_charge' });
    await S.say('kow', 'Hey! HEY!', { emo: 'fury' });
    S.act('kow', { posture: 'guard' });
    const q3 = await S.qte({ label: 'Fight', keys: ['Q', 'E', 'Q'], window: 1.4, still: 'fight_kow' });
    await S.fight('combo', 'kow', q3);
    if (!q3) S.hurt(1);
  } else {
    // walk into the light
    S.act('batman', { posture: 'idle', walkTo: 'lightPool' });
    S.cut({ type: 'ws', on: 'batman', angle: 180, height: -0.4, lens: 28, move: 'push', dur: 4, still: 'batman_light' });
    await S.wait(2.8);
    S.sfx('step');
    S.act('rook', { lookAt: 'batman' }); S.act('kow', { lookAt: 'batman' }); S.act('dez', { lookAt: 'batman', posture: 'gun_aim' });
    S.cut({ type: 'cu', on: 'rook', angle: 10, still: 'rook_sees' });
    await S.say('rook', '...What the hell is that.', { emo: 'surprised' });
    S.cut({ type: 'mcu', on: 'batman', angle: 0, height: -0.15, still: 'batman_light' });
    await S.say('batman', 'Let her go.', { emo: 'cold' });
    S.legend(1);
    S.cut({ type: 'cu', on: 'dez', angle: 15, still: 'dez_aim' });
    await S.say('dez', 'It\'s a guy in a costume. It\'s just a guy in a—', { emo: 'afraid' });
    S.sfx('gunshot'); S.kick(1);
    const q1 = await S.qte({ label: 'Cape', keys: ['SPACE'], window: 0.9, still: 'cape_block' });
    if (!q1) S.hurt(1);
    S.sfx('clang');
    const q2 = await S.qte({ label: 'Batarang', keys: ['R'], window: 1.2, still: 'batarang' });
    await S.fight('batarang', 'dez', q2);
    const q3 = await S.qte({ label: 'Fight', keys: ['Q', 'E', 'Q'], window: 1.4, still: 'fight_kow' });
    await S.fight('combo', 'kow', q3);
    if (!q3) S.hurt(1);
  }
  S.flow('ch1', 'crew', 'The crew');
  // ---- the standoff
  await standoff(S);
}

/**
 * Rook takes Nadia as a shield: the hostage scene. Each turn the player speaks (an option, or
 * free text Claude judges and answers as Rook); Rook's stability moves; at 75 he lets her go,
 * at 0 he fires.
 */
async function standoff(S) {
  S.music('tension', 0.75);
  S.place('rook', 'standoffRook', 270);
  S.place('nadia', 'standoffNadia', 270);
  S.act('rook', { posture: 'hostage_hold', emote: 'desperate', lookAt: 'batman' });
  S.act('nadia', { posture: 'hands_bound', emote: 'afraid' });
  S.place('batman', 'standoffBat', 90);
  S.act('batman', { posture: 'stand_wide', lookAt: 'rook' });
  S.cut({ type: 'two', on: 'rook', with: 'batman', still: 'standoff_wide' });
  await S.say('rook', 'Back off! I swear to God I\'ll do it!', { emo: 'desperate' });
  S.cut({ type: 'cu', on: 'nadia', angle: 20, still: 'nadia_hostage' });
  await S.wait(0.8);
  S.cut({ type: 'insert', at: 'rookWrist', size: 0.25, still: 'rook_tattoo' });
  await S.caption('A tattoo on his wrist: LUCIA · 6.14.18', 2.6);
  S.intel('lucia');
  const result = await S.converse({
    id: 'c1_standoff', who: 'rook', meter: { name: 'ROOK', start: 35, win: 75, lose: 0, label: 'Chance he lets her go' }, turns: 5,
    persona: `Victor "Rook" Salas, 34, ex-boxer from the Narrows, crew muscle turned crew leader for one night. He owes the Ferryman (a harbour boss he has never seen) a debt he can never pay, and the Ferryman has his daughter Lucia's name in his book. He is holding Nadia Okafor, a journalist, at gunpoint as a shield, backing toward a van, terrified of the masked figure in front of him. He is not a killer and does not want to be one, but he is cornered and desperate. Short, rough sentences. He swears. He will not trust threats; he responds to being seen as a person, to talk of his daughter, to a way out.`,
    situation: 'Underground garage, level B3. Two of his crew are down. A masked man (Batman) stands three metres away. Rook\'s gun is at Nadia\'s head.',
    options: [
      { id: 'see', label: '"Look at me. Not at her."', delta: 12, reply: 'Don\'t— don\'t tell me where to look.' },
      { id: 'threat', label: '"Pull that trigger and you never stop falling."', delta: -22, reply: 'You think I\'m scared of you? I\'m scared of HIM.', legend: -1 },
      { id: 'who', label: '"Who are you doing this for?"', delta: 8, reply: 'For someone you don\'t want to meet.' },
      { id: 'lucia', label: '"Lucia needs her father home tonight."', delta: 30, need: 'lucia', reply: 'How do you— how do you know her name?' },
      { id: 'out', label: '"There\'s a way out of this. I\'ll give it to you."', delta: 16, reply: 'There\'s no way out. He finds everybody.' },
      { id: 'batarang', label: 'Throw a batarang', action: true },
    ],
  });
  if (result.action === 'batarang') {
    S.cut({ type: 'cu', on: 'batman', angle: -10, still: 'batarang' });
    const ok = await S.qte({ label: 'Throw', keys: ['R'], window: 0.8, still: 'batarang' });
    if (ok) {
      await S.fight('batarang', 'rook', true);
      S.set('nadia', 'safe'); S.set('rook', 'captured'); S.legend(-1);
      S.notify('Rook disarmed.');
    } else {
      S.sfx('gunshot'); S.kick(1.2);
      S.set('nadia', 'hurt'); S.set('rook', 'fled');
      S.cut({ type: 'cu', on: 'nadia', still: 'nadia_hurt' });
      await S.say('nadia', 'Ah— God—', { emo: 'pained' });
      S.notify('Nadia is hurt.');
    }
  } else if (result.outcome === 'win') {
    S.cut({ type: 'cu', on: 'rook', angle: 15, move: 'push', dur: 4, still: 'rook_breaks' });
    S.act('rook', { posture: 'hands_up', emote: 'sad' });
    await S.say('rook', '...He\'s gonna kill her anyway. He\'s gonna kill me too.', { emo: 'sad' });
    S.set('nadia', 'safe'); S.trust('rook', 2); S.legend(2);
    S.cut({ type: 'mcu', on: 'batman', angle: 10, still: 'batman_cu' });
    const what = await S.choose({
      id: 'c1_rook', prompt: 'Rook has dropped the gun.', timer: 10, default: 'restrain',
      options: [
        { id: 'restrain', label: 'Restrain him', hint: 'He has answers' },
        { id: 'release', label: '"Go home to your daughter."', hint: 'He will owe you' },
      ],
      free: { who: 'batman', context: 'Rook surrendered and let the hostage go. Batman decides what to do with him: tie him up for questioning, or let him go home to his daughter.' },
    });
    if (what === 'release') {
      await S.say('batman', 'Go home to your daughter. Tonight, you never saw her.', { emo: 'grim' });
      await S.say('rook', '...I owe you. I don\'t know what you are, but I owe you.', { emo: 'sad' });
      S.set('rook', 'informant'); S.trust('rook', 2); S.legend(1);
      S.act('rook', { posture: 'idle', walkTo: 'ramp' });
    } else {
      S.sfx('zip');
      S.set('rook', 'captured');
    }
  } else {
    // he fires
    S.cut({ type: 'ecu', on: 'rook', still: 'rook_breaks' });
    await S.say('rook', 'I\'m sorry. I\'m sorry—', { emo: 'desperate' });
    const ok = await S.qte({ label: 'Shield her', keys: ['SPACE'], window: 0.8, still: 'cape_block' });
    S.sfx('gunshot'); S.kick(1.4);
    if (ok) {
      S.hurt(1); S.set('nadia', 'safe'); S.set('rook', 'captured'); S.legend(1);
      S.notify('You took the bullet on the gauntlet.');
      await S.fight('disarm', 'rook', true);
    } else {
      S.set('nadia', 'hurt'); S.set('rook', 'fled');
      S.notify('Nadia is hurt. Rook got away.');
    }
  }
  S.flow('ch1', 'standoff', 'The standoff');
  // the van: her notebook (the ledger copy)
  S.cut({ type: 'ms', on: 'batman', angle: 60, still: 'garage_van' });
  await S.explore({
    id: 'c1_van', objective: 'Search the van', still: 'garage_van',
    spots: [
      { id: 'glovebox', at: 'vanFront', label: 'Glovebox', line: ['batman', 'Her notebook. Shipping numbers, names... and a coin drawn beside every one.'], gives: 'ledger' },
      { id: 'phone', at: 'rookPhone', label: 'Rook\'s phone', line: ['batman', 'One contact. No name. Just a picture of a coin.'], gives: 'coin' },
      ...(S.get('rook') === 'fled' ? [{ id: 'tracker', at: 'van', label: 'Plant a tracker', line: ['mags', 'Got it. If that van moves, I\'ll know where.'], gives: 'tracker' }] : []),
    ],
    need: ['glovebox'],
  });
  if (S.has('cruzTipped')) {
    S.sfx('door');
    S.cut({ type: 'ws', on: 'cruz', at: 'stairDoor', still: 'cruz_arrives' });
    S.place('cruz', 'stairDoor', 90);
    S.act('cruz', { posture: 'gun_aim', emote: 'determined', lookAt: 'batman' });
    await S.say('cruz', 'Vesper PD! Step away from— ...from her.', { emo: 'surprised' });
    await S.say('batman', 'She needs a doctor. They need a cell.', { emo: 'cold' });
    await S.say('cruz', 'And what do you need?', { emo: 'determined' });
    S.trust('cruz', 1);
  }
  S.sfx('door');
  await S.fade(1, 1.2);
}

// ---------------------------------------------------------------------------
// CHAPTER 2 — THE LEDGER

export async function chapter2(S) {
  await S.chapter('ch2', 'THE LEDGER', 'Harrow Street, the roof · 00:21');
  await S.stage('garageRoof');
  S.space('open');
  S.weather({ rain: 0.6, wind: 0.5, lightning: 0.2, night: 1 });
  S.ambience({ city: 0.6 });
  S.music('grief', 0.3);
  const nadiaHurt = S.get('nadia') === 'hurt';
  S.place('batman', 'roofLedge', 0);
  S.place('nadia', 'roofNadia', 180);
  S.act('nadia', { posture: nadiaHurt ? 'kneel' : 'arms_crossed', emote: nadiaHurt ? 'pained' : 'worried', lookAt: 'batman' });
  S.act('batman', { posture: 'idle', lookAt: 'nadia' });
  S.cut({ type: 'ws', on: 'nadia', with: 'batman', angle: 70, height: 1.2, lens: 28, still: 'roof_wide' });
  await S.wait(1.5);
  S.cut({ type: 'mcu', on: 'nadia', angle: 25, still: 'nadia_roof' });
  await S.say('nadia', nadiaHurt ? 'It went through the arm. I\'ve had worse editors.' : 'So. Do I thank you, or do I file a story about you?', { emo: nadiaHurt ? 'pained' : 'smirk' });
  if (nadiaHurt) {
    const h = await S.choose({ id: 'c2_hospital', prompt: 'She is bleeding.', timer: 10, default: 'hospital', options: [
      { id: 'hospital', label: 'Get her to Mercy General', hint: 'Lose twenty minutes' },
      { id: 'cruz', label: 'Leave her for the ambulance', hint: 'She is on her own' },
    ] });
    if (h === 'hospital') { S.time(20); S.trust('nadia', 2); await S.say('batman', 'Hold on to me.', { emo: 'grim' }); }
    else { S.trust('nadia', -1); await S.say('nadia', 'Go, then. Whatever you are.', { emo: 'sad' }); }
  }
  S.cut({ type: 'ots', over: 'nadia', on: 'batman', still: 'batman_roof' });
  await S.say('batman', 'The book in your bag. What is it?', { emo: 'cold' });
  // the conversation: Claude plays Nadia; the facts she knows are fixed
  await S.converse({
    id: 'c2_nadia', who: 'nadia', turns: 3,
    persona: 'Nadia Okafor, 31, investigative reporter at the Vesper Ledger. Sharp, funny under pressure, furious rather than frightened now. She was abducted for a notebook she copied from a harbour office: a shipping ledger. Every entry has a person\'s name beside a cargo number, and a small coin drawn next to it. The people in it disappeared. She calls whoever runs it "the Ferryman" because that is what the dockworkers whisper. She knows: the freighter MV Acheron sails from Pier Nine at two o\'clock tonight, and the Acheron, like half the ships in the ledger, is chartered through Vale Maritime, the Vale family\'s company. She does not know who Batman is. She is suspicious of masked men but grateful.',
    situation: 'The roof of the parking garage in the rain, minutes after Batman saved her. She is answering his questions about the notebook.',
    facts: ['the ledger: names beside cargo numbers, a coin drawn beside each', 'the Acheron sails from Pier Nine at two', 'the ships are chartered through Vale Maritime'],
    options: [
      { id: 'ledger', label: '"Who are the names?"', reply: 'People who owed the wrong man. Gamblers, a councilman\'s nephew, a nurse who saw something. They go on a ship and they don\'t come back. The dockers call him the Ferryman.' },
      { id: 'ship', label: '"Which ship?"', reply: 'The Acheron. Pier Nine. It sails at two, and the last three times it sailed, someone in this book was never seen again.' },
      { id: 'vale', label: '"Who charters them?"', reply: 'Vale Maritime. The Vale boy\'s company, the one who inherited it and never shows up. Either he\'s in on it, or he\'s the biggest fool in Vesper.' },
    ],
    always: ['vale'],
  });
  S.intel('ledger'); S.intel('pier9');
  S.cut({ type: 'cu', on: 'batman', angle: -20, move: 'push', dur: 5, still: 'batman_vale' });
  S.music('dread', 0.4);
  const vale = await S.choose({ id: 'c2_vale', prompt: 'Vale Maritime. Your family\'s name.', timer: 10, default: 'silent', options: [
    { id: 'defend', label: '"He isn\'t in on it."' },
    { id: 'silent', label: '(Say nothing)' },
    { id: 'start', label: '"Then I\'ll start with him."' },
  ], free: { who: 'batman', context: 'Nadia just said the ships that make people disappear are chartered through Vale Maritime, the Vale heir\'s company. Batman IS the Vale heir, Noah, in secret. Nadia does not know.' } });
  if (vale === 'defend') { await S.say('batman', 'He isn\'t in on it.', { emo: 'cold' }); await S.say('nadia', 'That\'s a very specific thing to be sure of.', { emo: 'contempt' }); S.flag('nadiaSuspects'); }
  else if (vale === 'start') { await S.say('batman', 'Then I\'ll start with him.', { emo: 'grim' }); await S.say('nadia', 'Get in line.', { emo: 'smirk' }); S.trust('nadia', 1); }
  else if (vale?.free) await S.improv(vale);
  else await S.wait(1.5);
  S.cut({ type: 'mcu', on: 'nadia', angle: 30, still: 'nadia_roof' });
  await S.say('nadia', 'I\'m publishing tonight. If they know I have it, the only safe place for it is the front page.', { emo: 'determined' });
  const pub = await S.choose({ id: 'c2_publish', prompt: 'If she publishes now, the Ferryman knows.', timer: 12, default: 'publish', options: [
    { id: 'publish', label: '"Publish it."', hint: 'The Acheron may sail early' },
    { id: 'hold', label: '"Hold it until morning."', hint: 'She will hate it' },
  ] });
  if (pub === 'publish') { S.flag('published'); S.time(10); await S.say('nadia', 'Finally, a man in a mask with some sense.', { emo: 'smirk' }); S.legend(1); }
  else { S.trust('nadia', -1); await S.say('nadia', 'Until morning. If I\'m dead by morning, that\'s on you.', { emo: 'cold' }); }
  // Cruz
  S.sfx('door');
  S.place('cruz', 'roofDoor', 0);
  S.act('cruz', { posture: 'gun_aim', emote: 'determined', lookAt: 'batman' });
  S.cut({ type: 'ws', on: 'cruz', angle: 10, still: 'cruz_roof' });
  await S.say('cruz', S.has('cruzTipped') ? 'You called me. So start talking.' : 'Vesper PD. Hands where I can see them. Both of you.', { emo: 'determined' });
  S.cut({ type: 'ots', over: 'batman', on: 'cruz', still: 'cruz_roof' });
  const opts = [
    { id: 'talk', label: 'Talk to her', hint: 'She might help' },
    { id: 'vanish', label: 'Vanish', hint: 'Over the ledge' },
  ];
  if (S.get('rook') === 'captured') opts.splice(1, 0, { id: 'hand', label: 'Hand her Rook', hint: 'He goes to a cell' });
  const c = await S.choose({ id: 'c2_cruz', prompt: 'Detective Renata Cruz. The one honest cop in the precinct, they say.', timer: 12, default: 'vanish', options: opts });
  if (c === 'talk') {
    await S.converse({
      id: 'c2_cruz_talk', who: 'cruz', turns: 2,
      persona: 'Detective Renata Cruz, 45, Vesper PD Major Crimes. Honest in a precinct that is not; tired, dry, practical. She has watched three of her own cases vanish into the harbour. She does not trust a masked vigilante, but she trusts results. If he gives her something real (the Acheron at Pier Nine, two o\'clock) she will bring the harbour patrol, quietly, without telling her captain.',
      situation: 'A parking garage roof in the rain. She has her gun on Batman, who just saved a journalist.',
      options: [
        { id: 'acheron', label: '"The Acheron sails at two. Pier Nine. Bring the harbour patrol."', reply: 'And if I tell my captain, the ship sails at one-thirty. ...Fine. Quietly. Me and two boats I trust.', trust: 2 },
        { id: 'stay', label: '"Stay out of my way."', reply: 'It\'s my city. You\'re the one in the way.', trust: -1 },
      ],
    });
    S.flag('cruzKnows');
  } else if (c === 'hand') {
    await S.say('batman', 'Victor Salas. He was holding her. He\'ll talk, if you let him.', { emo: 'cold' });
    await S.say('cruz', '...You\'re giving me a collar. Why?', { emo: 'surprised' });
    S.set('rook', 'arrested'); S.trust('cruz', 2); S.flag('cruzKnows');
  } else {
    S.legend(-1);
  }
  S.act('batman', { posture: 'idle', walkTo: 'roofEdge' });
  S.cut({ type: 'ws', on: 'batman', angle: 160, height: 0.6, still: 'roof_wide' });
  await S.wait(1.4);
  if (S.has('cruzKnows')) await S.say('cruz', 'Hey. ...What do I call you?', { emo: 'worried' });
  S.sfx('cape');
  S.act('batman', { setVisible: false });
  S.cut({ type: 'cu', on: 'cruz', still: 'cruz_roof' });
  await S.wait(1.2);
  await S.say('nadia', 'He does that, apparently.', { emo: 'smirk' });
  S.flow('ch2', 'ledger', 'The ledger');
  await S.fade(1, 1.0);
}

// ---------------------------------------------------------------------------
// CHAPTER 3 — THE FALL (Rook, if he was taken)

export async function chapter3(S) {
  if (S.get('rook') !== 'captured') {
    // no interrogation: the trail goes through the tracker, or the ledger alone
    await S.chapter('ch3', 'THE TRAIL', 'Above Harrow Street · 00:40');
    await S.stage('garageRoof');
    S.weather({ rain: 0.7, wind: 0.6, lightning: 0.3 });
    S.place('batman', 'roofLedge', 0);
    S.act('batman', { posture: 'perch', setVisible: true });
    S.cut({ type: 'ws', on: 'batman', angle: 170, height: 1, still: 'roof_wide' });
    if (S.has('tracker')) { await S.say('mags', 'Your tracker\'s moving. South on Cannery Row. ...It\'s heading for the water, Noah. Pier Nine.'); }
    else { await S.say('mags', 'The ledger says Pier Nine. The ship registry says the Acheron. The weather says you\'re an idiot.'); }
    await S.say('batman', 'Then I\'ll need the boat.', { emo: 'determined' });
    S.flow('ch3', 'trail', 'The trail');
    return;
  }
  await S.chapter('ch3', 'THE FALL', 'Harrow Street, the ledge · 00:40');
  await S.stage('garageRoof');
  S.weather({ rain: 0.85, wind: 0.7, lightning: 0.4 });
  S.music('tension', 0.6);
  S.place('batman', 'ledgeHold', 0);
  S.place('rook', 'ledgeDangle', 180);
  S.act('batman', { posture: 'hold_collar', emote: 'cold', lookAt: 'rook' });
  S.act('rook', { posture: 'dangled', emote: 'afraid', lookAt: 'batman' });
  S.cut({ type: 'ews', on: 'rook', angle: 90, height: -4, lens: 20, still: 'ledge_wide' });
  S.strike(0.2);
  await S.wait(1.8);
  S.cut({ type: 'cu', on: 'rook', angle: 160, still: 'rook_dangle' });
  await S.say('rook', 'Okay! Okay! Pull me up, I\'ll— just pull me up!', { emo: 'afraid' });
  const r = await S.converse({
    id: 'c3_rook', who: 'rook', meter: { name: 'ROOK', start: 30, win: 70, lose: -1, label: 'Willing to talk' }, turns: 4,
    persona: 'Victor "Rook" Salas, held by his collar over a forty-metre drop in the rain by a masked man. He knows: the man he works for is called the Ferryman, and he has never seen his face, but the money comes from the Harbour Commission and once he heard a commissioner\'s voice on the phone, an old man\'s voice, very calm, who called him "son". The people in the ledger go into a container on the Acheron, number VTX-4471, and are "carried across" past the harbour limit. His daughter Lucia\'s name is in the book: that is how the Ferryman owns him. He gives information to someone who promises to protect Lucia, and shuts down if threatened with death.',
    situation: 'The ledge of the parking garage, rain, lightning. Rook is dangling. Batman wants the Ferryman\'s name and the ship\'s cargo.',
    options: [
      { id: 'drop', label: 'Let him slip a little', delta: -15, reply: 'AAH! God! I don\'t know his name! Nobody knows his name!', code: -10, legend: -2 },
      { id: 'lucia', label: '"I\'ll keep Lucia safe. Tell me."', delta: 28, need: 'lucia', reply: '...The book. Her name\'s in the book. That\'s how he owns me. Container VTX-4471. They put them in there.', gives: 'container' },
      { id: 'who', label: '"Who pays you?"', delta: 10, reply: 'The money comes through the Harbour Commission. There\'s a voice on the phone. Old. Calm. Calls me son.', gives: 'marrowHint' },
      { id: 'pull', label: 'Pull him back over the ledge', action: true },
      { id: 'letgo', label: 'Let go.', action: true, danger: true },
    ],
  });
  if (r.action === 'letgo') {
    S.set('rook', 'dead'); S.code(-60); S.legend(-4);
    S.cut({ type: 'ews', on: 'rook', angle: 0, height: 6, still: 'ledge_wide' });
    await S.wait(2.5);
    await S.say('mags', '...Noah. Noah, what did you do?');
  } else {
    S.cut({ type: 'ms', on: 'batman', angle: 40, still: 'ledge_pull' });
    S.place('rook', 'ledgeSafe', 180);
    S.act('rook', { posture: 'kneel', emote: 'sad' });
    if (r.outcome === 'win') { S.intel('container'); S.intel('marrowHint'); }
    const what = await S.choose({ id: 'c3_after', prompt: 'Rook is on his knees on the wet concrete.', timer: 12, default: 'police', options: [
      { id: 'police', label: 'Leave him zip-tied for the police' },
      { id: 'informant', label: '"Go to your daughter. When I call, you answer."', hint: 'An informant' },
    ] });
    if (what === 'informant') { S.set('rook', 'informant'); S.trust('rook', 2); await S.say('rook', 'Yeah. Yeah. Whatever you are... yeah.', { emo: 'sad' }); }
    else S.set('rook', 'arrested');
  }
  S.flow('ch3', 'fall', 'The fall');
  await S.fade(1, 1);
}

// ---------------------------------------------------------------------------
// CHAPTER 4 — BLACK WATER

export async function chapter4(S) {
  await S.chapter('ch4', 'BLACK WATER', 'Vesper Harbour · 01:52');
  await S.stage('harbour');
  S.space('open');
  S.weather({ rain: 1, wind: 0.95, lightning: 0.6, night: 1, overcast: 1 });
  S.ambience({ harbour: 1, engine: 0.9 });
  S.music('action', 0.7);
  const late = S.get('minutes') >= 20 || S.has('published');
  await S.say('mags', late ? 'She\'s already moving, Noah. The Acheron left the pier eight minutes early. Someone warned them.' : 'The Acheron\'s casting off. If she clears the breakwater she\'s in international water and the ledger is just paper.');
  await S.special('boat', { late });
  // steering in the storm: a sequence of reads on the water
  const hits = [];
  for (const [label, key] of [['Wave', 'A'], ['Tug wake', 'D'], ['Buoy', 'A']]) {
    const ok = await S.qte({ label, keys: [key], window: late ? 0.9 : 1.2, still: 'boat_storm' });
    hits.push(ok);
    if (!ok) { S.hurt(0.5); S.kick(1); }
  }
  const closeIn = hits.filter(Boolean).length >= 2;
  await S.say('mags', closeIn ? 'You\'re alongside. Stern ladder, port side.' : 'You\'re losing her— she\'s too fast in this sea—');
  const opts = [
    { id: 'board', label: 'Board from the stern', hint: 'Fast, alone' },
    { id: 'engines', label: 'Cut her engines first', hint: 'Grapple to the stern, an EMP charge' },
  ];
  if (S.has('cruzKnows')) opts.push({ id: 'cruz', label: 'Signal Cruz\'s boats', hint: 'Help is coming' });
  const how = await S.choose({ id: 'c4_board', prompt: 'The Acheron towers over the boat, black on black.', timer: 9, default: 'board', options: opts });
  if (how === 'engines') { S.flag('enginesCut'); S.time(2); await S.say('batman', 'She\'s not going anywhere.', { emo: 'determined' }); S.sfx('breaker'); }
  if (how === 'cruz') { S.flag('patrol'); await S.say('cruz', 'Two boats, three minutes. Don\'t make me regret this.', { radio: true }); }
  if (!closeIn && how !== 'engines') S.flag('lateBoard');
  S.sfx('grapple');
  await S.special('board');
  S.flow('ch4', 'water', 'Black water');
}

// ---------------------------------------------------------------------------
// CHAPTER 5 — THE FERRYMAN

export async function chapter5(S) {
  await S.chapter('ch5', 'THE FERRYMAN', 'MV Acheron · 02:06');
  await S.stage('acheron');
  S.space('deck');
  S.weather({ rain: 1, wind: 1, lightning: 0.7 });
  S.ambience({ harbour: 0.9, engine: S.has('enginesCut') ? 0 : 0.6 });
  S.music('action', 0.8);
  S.place('batman', 'deckAft', 0);
  S.place('deckhand', 'deckGuard', 180);
  S.act('deckhand', { posture: 'guard', emote: 'angry', lookAt: 'batman' });
  S.act('batman', { posture: 'guard', lookAt: 'deckhand' });
  S.cut({ type: 'ws', on: 'batman', with: 'deckhand', angle: 90, still: 'deck_fight' });
  await S.say('deckhand', 'Nobody comes aboard! Nobody!', { emo: 'fury' });
  const q = await S.qte({ label: 'Fight', keys: ['Q', 'E', 'F'], window: 1.3, still: 'deck_fight' });
  await S.fight('combo', 'deckhand', q);
  if (!q) S.hurt(1);
  // the container
  S.cut({ type: 'mls', on: 'batman', angle: -40, still: 'containers' });
  S.sfx('clang'); await S.wait(0.4); S.sfx('clang');
  await S.say('batman', S.has('container') ? 'VTX-4471.' : 'Someone\'s inside.', { emo: 'grim' });
  // Marrow on the bridge wing
  S.place('marrow', 'bridgeWing', 180);
  S.act('marrow', { posture: 'gun_low', emote: 'cold', lookAt: 'batman' });
  S.cut({ type: 'ws', on: 'marrow', angle: 0, height: -3, lens: 35, still: 'marrow_wing' });
  S.strike(0.1);
  S.sting('reveal');
  await S.wait(1.5);
  S.cut({ type: 'cu', on: 'marrow', angle: 15, still: 'marrow_cu' });
  await S.say('marrow', 'They told me the night had grown a new animal.', { emo: 'cold' });
  if (S.has('marrowHint')) await S.say('batman', 'Silas Marrow. Harbour Commissioner.', { emo: 'cold' });
  S.intel('marrowName');
  await S.say('marrow', 'I sign the papers that let the ships come and go. Tonight I am only the ferryman. Everyone pays the ferryman, son.', { emo: 'contempt' });
  S.act('marrow', { play: 'point' });
  await S.say('marrow', 'That container floods in ninety seconds. I opened the valves myself. You can stand in my way, or you can save them. Not both.', { emo: 'cold' });
  S.music('action', 1);
  const patrol = S.has('patrol') || (S.has('cruzKnows') && S.trust('cruz') >= 2);
  const opts = [
    { id: 'save', label: 'Save the people in the container', hint: 'Marrow gets away' },
    { id: 'chase', label: 'Go after Marrow', hint: 'They might drown' },
  ];
  if (patrol) opts.push({ id: 'both', label: '"Cruz. Container forty-four seventy-one."', hint: 'Trust her with it' });
  const pick = await S.choose({ id: 'c5_dilemma', prompt: 'Ninety seconds.', timer: 8, default: 'save', options: opts,
    free: { who: 'batman', context: 'On a freighter deck in a storm, the villain Silas Marrow (the Ferryman) has opened the flood valves on a shipping container with people locked inside. Batman can save them or chase Marrow.' + (patrol ? ' Detective Cruz and two police boats are alongside and could reach the container.' : '') } });
  let caught = false;
  if (pick === 'save' || (pick?.mapped ?? '') === 'save') {
    S.cut({ type: 'mcu', on: 'batman', still: 'container_save' });
    const ok = await S.qte({ label: 'Break the lock', keys: ['E', 'E', 'E'], window: 2.2, still: 'container_save' });
    S.sfx('clang');
    S.flag('saved'); S.legend(2);
    S.notify(ok ? 'Eleven people walk out of the container.' : 'You get them out. Barely.');
    S.set('marrow', 'escaped');
  } else {
    if (pick === 'both') { S.flag('saved'); await S.say('cruz', 'I\'ve got them. Go!', { radio: true }); S.legend(2); S.trust('cruz', 1); }
    else { S.flag('drowned'); S.legend(-2); S.code(-20); }
    S.act('batman', { posture: 'idle', walkTo: 'bridgeStair' });
    S.cut({ type: 'ms', on: 'marrow', angle: 30, still: 'marrow_wing' });
    const ok = await S.qte({ label: 'Close the distance', keys: ['W', 'W'], window: 1.4, still: 'marrow_wing' });
    caught = ok;
  }
  if (S.get('marrow') !== 'escaped') {
    S.place('batman', 'bridgeWingBat', 0);
    S.act('batman', { posture: 'stand_wide', lookAt: 'marrow' });
    S.act('marrow', { posture: 'gun_aim', lookAt: 'batman' });
    S.cut({ type: 'two', on: 'marrow', with: 'batman', still: 'marrow_final' });
    await S.say('marrow', 'Twenty years ago a shipping man named Vale would not carry my cargo. So I carried him. Him, and his wife, off Pier Nine.', { emo: 'cold' });
    S.sting('hit');
    S.cut({ type: 'ecu', on: 'batman', move: 'push', dur: 5, still: 'batman_ecu' });
    await S.wait(2);
    const end = await S.converse({
      id: 'c5_marrow', who: 'marrow', turns: 2,
      persona: 'Silas Marrow, 64, Harbour Commissioner of Vesper, the "Ferryman". Gaunt, courteous, utterly calm; quotes the old myths; believes the city is a river and someone must decide who crosses. He had Noah Vale\'s parents killed off Pier Nine twenty years ago because Thomas Vale refused to smuggle for him. He does not know that the masked man is their son. He is armed, cornered on the wing of the bridge in a storm, and he will goad, never beg.',
      situation: 'The bridge wing of the MV Acheron in a storm. Marrow has a pistol; Batman stands two metres away.',
      options: [
        { id: 'arrest', label: '"You\'re going to stand trial, Silas."', reply: 'Trial. In my city. Before my judges. You are new here.' },
        { id: 'name', label: '"Thomas Vale was my father."', reply: '...Ah. The boy. Then you understand debts better than anyone.', sting: true },
      ],
    });
    void end;
    const fin = await S.choose({ id: 'c5_final', prompt: 'Marrow raises the gun. The rail is behind him.', timer: 7, default: 'take', options: [
      { id: 'take', label: 'Take him alive', hint: 'The code' },
      { id: 'sea', label: 'Let the sea have him', hint: 'No one would know' },
    ] });
    const q2 = await S.qte({ label: fin === 'sea' ? 'Step back' : 'Disarm', keys: fin === 'sea' ? ['S'] : ['Q', 'F'], window: 1.1, still: 'marrow_final' });
    if (fin === 'sea') {
      S.sfx('gunshot'); await S.wait(0.3); S.sfx('splash');
      S.set('marrow', 'dead'); S.code(-40); S.legend(-3);
      await S.say('mags', '...Noah?');
    } else if (q2 || caught) {
      await S.fight('disarm', 'marrow', true);
      S.set('marrow', 'arrested'); S.legend(2);
      await S.say('batman', 'Everyone pays.', { emo: 'cold' });
    } else {
      S.sfx('gunshot'); S.hurt(1); S.kick(1.5);
      S.sfx('splash');
      S.set('marrow', 'escaped');
      await S.say('mags', 'He went over the side. Noah, the current— he\'s gone.');
    }
  }
  S.flow('ch5', 'ferryman', 'The Ferryman');
  await S.fade(1, 1.5);
}

// ---------------------------------------------------------------------------
// EPILOGUE — DAWN

export async function epilogue(S) {
  await S.chapter('epilogue', 'DAWN', 'St. Brigid\'s Cathedral · 06:12');
  await S.stage('cathedral', { time: 'dawn' });
  S.weather({ rain: 0, wind: 0.3, lightning: 0, night: 0.1, overcast: 0.4, wetness: 0.8 });
  S.ambience({ city: 0.7 });
  S.music('dawn', 0.3);
  S.place('batman', 'perch', 200);
  S.act('batman', { posture: 'perch', setVisible: true, emote: 'tired' });
  S.cut({ type: 'ews', on: 'batman', angle: 150, height: 4, lens: 24, move: 'crane', dur: 10, still: 'dawn_wide' });
  await S.wait(3);
  const st = S.state;
  const headline = st.marrow === 'arrested' ? 'HARBOUR COMMISSIONER ARRESTED ABOARD SMUGGLING SHIP'
    : st.marrow === 'dead' ? 'HARBOUR CHIEF MISSING, PRESUMED DROWNED'
      : st.flags.saved ? 'ELEVEN RESCUED FROM SHIPPING CONTAINER; SUSPECT AT LARGE' : 'BODIES RECOVERED NEAR BREAKWATER';
  const byline = st.flags.published ? 'by Nadia Okafor · The Ferryman\'s Manifest, part one' : st.nadia === 'hurt' ? 'Vesper Ledger staff · reporter recovering at Mercy General' : 'Vesper Ledger staff';
  await S.headline(headline, byline);
  S.cut({ type: 'cu', on: 'batman', angle: -25, still: 'dawn_cu' });
  await S.say('mags', st.code >= 80 ? 'You did more good tonight than this city\'s seen in a year. Come home. Eat something.' : st.code >= 40 ? 'It\'s done. Some of it. Come home, Noah.' : 'I don\'t know who came back from that ship. Come home, and we\'ll find out.');
  if (S.trust('cruz') >= 2) {
    S.cut({ type: 'insert', at: 'gargoylePhone', size: 0.3, still: 'burner' });
    await S.caption('Wedged in the gargoyle\'s jaw: a cheap phone, and a note. "If you\'re real, call. — R.C."', 3.6);
    S.flag('burner');
  }
  S.cut({ type: 'mcu', on: 'batman', angle: 10, move: 'push', dur: 6, still: 'dawn_cu' });
  const last = await S.choose({ id: 'ep_last', prompt: 'The sun comes up over Vesper. What does this city need?', timer: 0, options: [
    { id: 'guardian', label: '"A guardian."' },
    { id: 'fear', label: '"Something to fear."' },
    { id: 'truth', label: '"The truth."' },
  ], free: { who: 'batman', context: 'The last line of the episode: Batman at dawn on the cathedral roof, after his first night, saying what Vesper City needs.' } });
  const lines = { guardian: 'A guardian. Someone who stays.', fear: 'Something to fear. Every night.', truth: 'The truth. Whatever it costs.' };
  if (typeof last === 'string') await S.say('batman', lines[last], { emo: 'determined' });
  else if (last?.free) await S.improv(last);
  S.flag('identity_' + (typeof last === 'string' ? last : 'own'));
  S.cut({ type: 'ews', on: 'batman', angle: 180, height: 2, lens: 20, move: 'pull', dur: 8, still: 'dawn_wide' });
  await S.wait(2);
  S.act('batman', { setVisible: false });
  S.sfx('cape');
  await S.wait(2.5);
  await S.endCard();
  S.flow('epilogue', 'dawn', 'Dawn');
}

/** The order of play. Each returns nothing; branching lives inside, state carries across. */
export const EPISODE = [prologue, chapter1, chapter2, chapter3, chapter4, chapter5, epilogue];
export const CHAPTERS = [
  { id: 'prologue', title: 'GARGOYLE' }, { id: 'ch1', title: 'LEVEL B3' }, { id: 'ch2', title: 'THE LEDGER' },
  { id: 'ch3', title: 'THE FALL' }, { id: 'ch4', title: 'BLACK WATER' }, { id: 'ch5', title: 'THE FERRYMAN' }, { id: 'epilogue', title: 'DAWN' },
];
