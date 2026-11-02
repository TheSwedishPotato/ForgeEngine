import { Theatre2D } from './theatre2d/Theatre2D.js';
import { Runner } from './story/Runner.js';
import { Audio } from '../../../medengine/src/audio/Audio.js';
import { Claude } from '../../../medengine/src/ai/Claude.js';
import './story2d.css';

// The illustrated story (the reference-photo style): same script, same Claude, pictures rendered
// by the Med Engine. ?auto=1 plays itself fast (for the tests).
const P = new URLSearchParams(location.search);
const audio = new Audio();
const claude = new Claude();
const T = new Theatre2D(document.getElementById('stage'), { audio });
if (P.get('auto') === '1') T.speed = 20;
window.story = { T, claude };
const bgObserver = new MutationObserver(() => { document.getElementById('page').style.setProperty('--bgimg', T.bg.style.backgroundImage); });
bgObserver.observe(T.bg, { attributes: true, attributeFilter: ['style'] });

const cstat = document.getElementById('cstat');
claude.ready.then(() => {
  cstat.textContent = claude.available ? `● ${claude.status}: type anything, and the story answers.` : 'Claude is offline: tap the suggestions to play. Add a key to type your own.';
  document.getElementById('keyrow').style.display = claude.mode === 'artifact' || claude.mode === 'proxy' ? 'none' : '';
});
document.getElementById('key').addEventListener('change', (e) => { claude.setKey(e.target.value.trim()); cstat.textContent = claude.available ? `● ${claude.status}` : 'Claude is offline.'; });

async function begin() {
  document.getElementById('start').classList.add('off');
  audio.start();
  const R = new Runner(T, claude, { save: false });
  T.runner = R;
  T.onMenu = () => T._note(`The code ${R.state.code} · Nadia ${R.state.nadia} · Rook ${R.state.rook}`);
  await R.play(P.get('chapter'));
  window.__ended = true;
  if (P.get('auto') === '1') return;
  const more = await T.choose({ prompt: 'The night is over. Vesper is not.', options: [{ id: 'n2', label: 'Night Two (written live by Claude)' }, { id: 'again', label: 'Start again' }] });
  if (more.id === 'n2') await R.continueStory();
  location.reload();
}
document.getElementById('go').onclick = begin;
if (P.get('auto') === '1') { T.choose = ((orig) => async (spec) => ({ id: (spec.options.find((o) => o.id === spec.default) ?? spec.options[0]).id }))(T.choose); T.qte = async () => true; begin(); }
