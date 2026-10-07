/**
 * Reading Claude's JSON while it is still being written, so the film can
 * start before the reply is finished. The reply is one object whose keys
 * come in a set order (scene, cast, extras, remarks, beats, …): each top
 * level value is handed over the moment its closing bracket arrives, and
 * each element of an array as soon as it is complete, so the first beat
 * plays while the rest are still being written.
 */
export class StreamReader {
  constructor({ onValue = () => {}, onElement = () => {} } = {}) {
    this.onValue = onValue; this.onElement = onElement;
    this.i = 0; this.depth = 0; this.inStr = false; this.esc = false; this.strStart = 0;
    this.key = null; this.topKey = null; this.valStart = -1; this.elemStart = -1; this.started = false;
    this.seen = new Set();
  }

  /** text: the whole reply so far (it only ever grows). */
  feed(text) {
    for (; this.i < text.length; this.i++) {
      const c = text[this.i];
      if (!this.started) { if (c === '{') { this.started = true; this.depth = 1; } continue; }
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (c === '\\') this.esc = true;
        else if (c === '"') { this.inStr = false; if (this.depth === 1) this.key = text.slice(this.strStart + 1, this.i); }
        continue;
      }
      if (c === '"') { this.inStr = true; this.strStart = this.i; continue; }
      if (c === '{' || c === '[') {
        this.depth++;
        if (this.depth === 2) { this.valStart = this.i; this.topKey = this.key; }
        else if (this.depth === 3 && text[this.valStart] === '[') this.elemStart = this.i;
      } else if (c === '}' || c === ']') {
        if (this.depth === 3 && this.elemStart >= 0) { this._emit(this.onElement, this.topKey, text.slice(this.elemStart, this.i + 1)); this.elemStart = -1; }
        else if (this.depth === 2 && this.valStart >= 0) { this._emit(this.onValue, this.topKey, text.slice(this.valStart, this.i + 1)); this.valStart = -1; }
        this.depth--;
      }
    }
  }

  _emit(fn, key, src) {
    try { fn(key, JSON.parse(src)); } catch { /* a malformed piece is left for the full reply */ }
  }
}
