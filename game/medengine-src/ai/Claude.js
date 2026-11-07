/**
 * Claude in the Med Engine: one interface, four ways to reach Claude.
 *
 *   'artifact'  published on claude.ai: the page's `sample` capability, on the viewer's own
 *               Claude account (no key anywhere; the viewer is asked once)
 *   'proxy'     `npm run dev` with ANTHROPIC_API_KEY set: the dev server forwards /claude/*
 *   'key'       the player's own API key, kept in this browser only (localStorage)
 *   'offline'   no Claude: callers fall back to their authored content
 *
 *   const claude = new Claude(); await claude.ready;
 *   const text = await claude.ask(prompt, { tier: 'quick' | 'default', onText });
 *   const data = await claude.json(prompt, { tier });
 */
/**
 * What `claude.ask()` and `claude.json()` take.
 * @typedef {object} AskOptions
 * @property {'quick' | 'default' | 'complex'} [tier]  which model: quick (Haiku), default (Sonnet) or complex (Opus)
 * @property {(update: { text: string, delta?: string }) => void} [onText]  called with the text so far as it streams in
 * @property {AbortSignal} [signal]
 * @property {number} [maxTokens]  longest reply (900; not used in the claude.ai artifact, which sets its own)
 * @property {string} [system]     instructions for the model, before the prompt
 */

const LS = 'medengine.claude';
const PERMANENT = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);
const MODELS = { quick: 'claude-haiku-5-5', default: 'claude-sonnet-5-5', complex: 'claude-opus-5-5' };

function load() { try { return JSON.parse(localStorage.getItem(LS) ?? '{}'); } catch { return {}; } }
function save(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* private mode */ } }

export class Claude {
  constructor() {
    this.mode = 'offline';
    this.settings = load();
    this.status = 'connecting';
    this.lastError = null;
    this.ready = this._detect();
  }

  get available() { return this.mode !== 'offline'; }

  async _detect() {
    // 1. the artifact runtime
    if (window.claude?.use) {
      try {
        const s = await Promise.race([window.claude.use('sample'), new Promise((r) => setTimeout(() => r(null), 10500))]);
        if (s) { this.sample = s; this.mode = 'artifact'; this.status = 'Claude (your claude.ai account)'; return this.mode; }
      } catch { /* not served */ }
    }
    // 2. the dev proxy
    try {
      const r = await fetch('./claude/__status', { cache: 'no-store' });
      if (r.ok && (await r.json()).ok) { this.mode = 'proxy'; this.status = 'Claude (dev server)'; return this.mode; }
    } catch { /* no dev server */ }
    // 3. a key the player gave
    if (this.settings.key) { this.mode = 'key'; this.status = 'Claude (your API key)'; return this.mode; }
    this.status = 'offline';
    return this.mode;
  }

  setKey(key) {
    this.settings.key = key || undefined; save(this.settings);
    if (this.mode !== 'artifact' && this.mode !== 'proxy') { this.mode = key ? 'key' : 'offline'; this.status = key ? 'Claude (your API key)' : 'offline'; }
  }

  /** A failure that holds for the rest of this view: stop asking and use the authored content. */
  _permanent(e) {
    if (PERMANENT.has(e?.code)) { this.mode = 'offline'; this.status = 'offline (Claude not allowed here)'; }
  }

  /**
   * Free text from Claude. Rejects on failure (callers fall back).
   * @param {string} prompt
   * @param {AskOptions} [o]
   * @returns {Promise<string>}
   */
  async ask(prompt, { tier = 'default', onText, signal, maxTokens = 900, system } = {}) {
    if (this.mode === 'artifact') {
      const input = system ? [{ role: 'user', content: system + '\n\n' + prompt }] : prompt;
      try {
        const r = await this.sample(input, sampleOptions({ modelTier: tier, onText, signal }));
        return r.text;
      } catch (e) {
        this.lastError = e?.code ?? 'error';
        this._permanent(e);
        throw e;
      }
    }
    if (this.mode === 'proxy' || this.mode === 'key') {
      const url = this.mode === 'proxy' ? './claude/v1/messages' : 'https://api.anthropic.com/v1/messages';
      const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
      if (this.mode === 'key') { headers['x-api-key'] = this.settings.key; headers['anthropic-dangerous-direct-browser-access'] = 'true'; }
      const body = { model: this.settings.model ?? MODELS[tier] ?? MODELS.default, max_tokens: maxTokens, stream: !!onText, messages: [{ role: 'user', content: prompt }] };
      if (system) body.system = system;
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
      if (!r.ok) { this.lastError = `${r.status}`; throw new Error(`Claude API ${r.status}: ${(await r.text()).slice(0, 200)}`); }
      if (!onText) { const j = await r.json(); return j.content.map((c) => c.text ?? '').join(''); }
      // server-sent events
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '', text = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const ev = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = ev.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try { const d = JSON.parse(line.slice(6)); if (d.type === 'content_block_delta' && d.delta?.text) { text += d.delta.text; onText({ text, delta: d.delta.text }); } } catch { /* keep-alive */ }
        }
      }
      return text;
    }
    throw new Error('offline');
  }

  /**
   * JSON from Claude (tolerant parse).
   * @param {string} prompt
   * @param {AskOptions} [opts]
   * @returns {Promise<any>}
   */
  async json(prompt, opts = {}) {
    if (this.mode === 'artifact' && this.sample.json) {
      try { return await this.sample.json(opts.system ? opts.system + '\n\n' + prompt : prompt, sampleOptions({ modelTier: opts.tier ?? 'default', signal: opts.signal })); } catch (e) {
        this.lastError = e?.code ?? 'error';
        this._permanent(e);
        throw e;
      }
    }
    const text = await this.ask(prompt + '\n\nReply with only the JSON value, no other text.', opts);
    return parseJSON(text);
  }
}

/**
 * Options for the artifact's `sample`: only members that are set (an undefined `signal` or
 * `onText` is a malformed call there), and never cached: every story beat must be asked afresh.
 * @param {{ modelTier?: string, onText?: Function, signal?: AbortSignal }} o
 * @returns {{ modelTier?: string, cache: false, onText?: Function, signal?: AbortSignal }}
 */
export function sampleOptions({ modelTier, onText, signal }) {
  const o = { modelTier, cache: false };
  if (typeof onText === 'function') o.onText = onText;
  if (signal) o.signal = signal;
  return o;
}

/**
 * Reads JSON out of a model reply, tolerating a code fence or text around it. Throws when there is none.
 * @param {string} text
 * @returns {any}
 */
export function parseJSON(text) {
  try { return JSON.parse(text); } catch { /* try harder */ }
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* next */ } }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
  throw new Error('no JSON in reply');
}
