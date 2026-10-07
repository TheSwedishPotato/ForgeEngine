/**
 * Voices: the browser's own speech, a different voice for each character
 * where the browser has several, pitched and paced as the director asked.
 * Optional; the subtitles carry everything when it is off or missing.
 */
const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
const FEMALE = /female|woman|samantha|victoria|karen|zira|susan|serena|moira|tessa|fiona|kate|hazel|libby|sonia|aria|jenny|emma|amy|joanna|salli|kimberly|ivy|ava|allison/i;
const MALE = /male|man|daniel|alex|fred|george|ryan|guy|david|mark|james|oliver|arthur|thomas|brian|matthew|justin|joey|eric|aaron/i;

let voices = [];
function load() { voices = synth ? synth.getVoices().filter((v) => /^en/i.test(v.lang)) : []; }
if (synth) { load(); synth.addEventListener?.('voiceschanged', load); }

const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export const Voice = {
  enabled: false,
  get available() { return !!synth && voices.length > 0; },

  /** Pick a voice for someone: by their sex where the names tell, varied by who they are. */
  voiceFor(who, sex) {
    if (!voices.length) return null;
    const pool = voices.filter((v) => (sex === 'f' ? FEMALE.test(v.name) : sex === 'm' ? MALE.test(v.name) && !FEMALE.test(v.name) : true));
    const list = pool.length ? pool : voices;
    return list[hash(who) % list.length];
  },

  /** Speak; resolves when done (or at once when voices are off). */
  say(text, { who = 'narrator', sex = null, pitch = 1, rate = 1, volume = 1 } = {}) {
    if (!this.enabled || !synth || !text) return Promise.resolve();
    return new Promise((res) => {
      const u = new SpeechSynthesisUtterance(text.replace(/\*[^*]*\*/g, ''));
      const v = this.voiceFor(who, sex);
      if (v) u.voice = v;
      u.pitch = pitch; u.rate = rate * 0.96; u.volume = volume;
      let done = false; const end = () => { if (!done) { done = true; res(); } };
      u.onend = end; u.onerror = end;
      setTimeout(end, 1500 + text.length * 110);   // never hang on a voice that stalls
      synth.speak(u);
    });
  },

  stop() { synth?.cancel(); },
};
