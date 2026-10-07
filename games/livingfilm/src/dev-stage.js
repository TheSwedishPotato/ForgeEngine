// Dev only: a place, three people and every shot, for checking the 3D stage by eye (stage-test.html?place=tavern&time=night).
import { Stage3D } from './stage3d/stage.js';
const q = new URLSearchParams(location.search);
const S = new Stage3D(document.getElementById('c'), { quality: q.get('q') ?? 'high' });
const spec = { id: 'test', name: q.get('name') ?? 'The Black Ox', type: q.get('place') ?? 'tavern', style: q.get('style') ?? 'bohemian', size: 'medium', walls: q.get('walls') ?? 'plaster', floor: q.get('floor') ?? 'rushes', features: (q.get('f') ?? 'hearth,long table,benches,barrels,candles').split(','), time: q.get('time') ?? 'night' };
const cast = {
  jitka: { name: 'Jitka', sex: 'f', age: 52, look: { skin: '#e0b896', hair: '#5a4030', hairStyle: 'veil', clothes: '#6a3a2a', accent: '#c8a050', build: 'stout' } },
  matej: { name: 'Matěj', sex: 'm', age: 64, look: { skin: '#d6a882', hair: '#8a8478', hairStyle: 'bald', clothes: '#4a3a28', accent: '#a07040', beard: 0.9, build: 'stout' } },
  you: { name: 'Anna', sex: 'f', age: 20, look: { skin: '#e8c4a4', hair: '#7a5a32', hairStyle: 'braid', clothes: '#2a3a5a', accent: '#a08040' } },
};
S.enter(spec, { time: spec.time, weather: q.get('weather') ?? 'clear' });
for (const [id, c] of Object.entries(cast)) S.actor(id, c);
S.block(['jitka', 'matej', 'you'], { jitka: 'hearth' });
S.actors.get('you').lookAt = S.actors.get('jitka').pos;
S.actors.get('jitka').lookAt = S.actors.get('you').pos;
S.actors.get('matej').act({ gesture: 'cross' });
const shots = [
  { shot: 'establishing', on: [], who: null, move: 'pan-right' },
  { shot: 'wide', on: ['jitka', 'matej', 'you'], who: null, move: 'push-in' },
  { shot: 'medium', on: ['jitka'], who: 'jitka', move: 'drift', emotion: 'warm', gesture: 'heart' },
  { shot: 'close', on: ['jitka'], who: 'jitka', move: 'push-in', emotion: 'sad' },
  { shot: 'over-shoulder', on: ['matej'], who: 'matej', move: 'static', emotion: 'amused', gesture: 'point' },
  { shot: 'two-shot', on: ['jitka', 'matej'], who: 'matej', move: 'drift', emotion: 'suspicious' },
  { shot: 'insert', on: [], who: null, move: 'push-in' },
];
let i = -1;
window.next = () => {
  i = (i + 1) % shots.length; const b = shots[i];
  for (const a of S.actors.values()) a.act({ talking: a.id === b.who, gesture: a.id === b.who ? b.gesture ?? 'none' : a.id === 'matej' && b.who !== 'matej' ? 'cross' : 'none', emotion: a.id === b.who ? b.emotion : 'neutral' });
  S.shot(b, { dur: 6 });
  return b.shot;
};
window.S = S;
next();
let last = performance.now();
const loop = (now) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; S.frame(dt); requestAnimationFrame(loop); };
requestAnimationFrame(loop);
