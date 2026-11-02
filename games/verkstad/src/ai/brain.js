/**
 * The customers' minds: Claude.
 *
 * Three kinds of call, all through the Messages API (the official SDK, run in the browser):
 *  - a new customer: who they are, the car they come in with, what is really wrong with it (chosen
 *    from the workshop's fault catalogue, so the simulation can make it real), what happened, what
 *    they will say first. Structured output (a JSON schema), so the game can use it directly;
 *  - the conversation: the customer in character, knowing only what that person would know.
 *    Things you do (show them a worn pad, phone them) come in as [bracketed] events;
 *  - decisions: accepting an estimate, approving extra work, and the verdict at handover (what
 *    they pay, how many stars), again as structured output.
 *
 * How it reaches the API:
 *  - 'proxy': the dev server (vite.config.js) forwards /claude/* to api.anthropic.com with the
 *    ANTHROPIC_API_KEY of the shell that ran `npm run dev`. The key never reaches the page;
 *  - 'key': your own key, kept in this browser's localStorage, sent straight to the API;
 *  - 'offline': no AI. Customers come from ai/offline.js (names, faults and canned lines).
 *
 * The workshop's rules and the catalogue are the same for every call, so they go first and are
 * cached (cache_control); the customer's own card follows.
 */
import Anthropic from '@anthropic-ai/sdk';
import { ALL, forCar } from '../data/faults.js';
import { CARS } from '../data/cars.js';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best customers)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (quicker)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
];

const LS = 'verkstad.ai';
function load() { try { return JSON.parse(localStorage.getItem(LS) ?? '{}'); } catch { return {}; } }
function save(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* private mode */ } }

const RULES = `You play the customers of Verkstan, a small independent car workshop on Hisingen in Gothenburg, Sweden, run by one mechanic (the player). It is a game, a realistic workshop simulator: the cars and their faults are simulated physically, part by part, and the player diagnoses and repairs them with real tools.

How customers work in this game:
- A customer is a real-feeling person with a life: a job, a mood, a history with this car, opinions about mechanics. Make every one different: age, background, temperament, the way they talk. Gothenburg people from everywhere: students at Chalmers, Volvo factory workers, retirees, nurses on night shifts, immigrants who have lived here 30 years, a vicar, a rally hobbyist, a nervous new driver, a sceptic who has been ripped off before, a Formula 1 team's logistics manager whose demo car needs help (rare: only if asked for). Swedish names that fit the person; English dialogue with the odd Swedish word ("hej", "tack", "jättebra", "va?", "besiktning") the way Swedes really drop them.
- The customer does NOT know what is technically wrong. They describe what they notice in their own words: sounds, smells, feelings, lights, when it happens. They can be wrong about the cause, mix up left and right, exaggerate, forget things, or hide things (they hit a kerb, their son borrowed the car, they ignored the light for a month).
- They only learn what is wrong when the mechanic explains it. They believe a clear explanation, more so if shown the worn part.
- Money: Swedish independent workshops charge about 900–1300 SEK per hour plus parts. The Swedish consumer services act (konsumenttjänstlagen) says work beyond the agreed estimate (by more than about 15 %) needs the customer's approval first; customers may refuse to pay for unapproved extra work.
- Messages in [square brackets] are things that happen, not speech: the mechanic showing a part, a phone call starting, the car being handed back. React to them as the person would.
- Keep spoken replies short: one to three sentences, like real talk across a counter or on the phone. No stage directions unless brief and in *asterisks*. Never mention being an AI or a game.`;

function catalogueText() {
  const cars = Object.values(CARS).map((c) => `- ${c.id}: ${c.summary}`).join('\n');
  const faults = ALL.map((f) => `- ${f.id} [${f.cars === 'all' ? 'all cars' : f.cars.join(', ')}]${f.where ? ` where=${f.where}${f.where === 'corner' ? ' (FL FR RL RR' + (f.front ? ', front only' : '') + ')' : f.where === 'axle' ? ' (F or R)' : f.where === 'cyl' ? ' (cylinder number)' : ' (L or R)'}` : ''}: ${f.title}. A driver notices: ${f.lay}.`).join('\n');
  return `The cars the workshop can take (car ids):\n${cars}\n\nThe faults and jobs the simulation can make real (fault ids):\n${faults}`;
}

const CUSTOMER_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'age', 'gender', 'occupation', 'personality', 'speech', 'car', 'paint', 'mileage_km', 'faults', 'item', 'opening', 'truth', 'secrets', 'budget_sek', 'patience', 'wants_back', 'looks'],
  properties: {
    name: { type: 'string' }, age: { type: 'integer' }, gender: { type: 'string', enum: ['woman', 'man', 'nonbinary'] },
    occupation: { type: 'string' }, personality: { type: 'string' }, speech: { type: 'string', description: 'How they talk: rhythm, words, quirks' },
    car: { type: 'string', enum: Object.keys(CARS) }, paint: { type: 'string', description: 'Paint colour as #rrggbb' }, mileage_km: { type: 'integer' },
    faults: { type: 'array', description: '1 to 3 entries from the catalogue (faults and/or jobs) that fit the car', items: { type: 'object', additionalProperties: false, required: ['id', 'where'], properties: { id: { type: 'string', enum: ALL.map((f) => f.id) }, where: { type: 'string', description: 'FL/FR/RL/RR, F/R, L/R, a cylinder number, or empty' } } } },
    item: { type: 'object', additionalProperties: false, required: ['label', 'location', 'rattles'], description: 'Something left or lost in the car, or location none', properties: { label: { type: 'string' }, location: { type: 'string', enum: ['none', 'airbox', 'underseat', 'glovebox', 'boot', 'enginebay'] }, rattles: { type: 'boolean' } } },
    opening: { type: 'string', description: 'The first thing they say at the counter' },
    truth: { type: 'string', description: 'Private: what really happened, the story behind the visit' },
    secrets: { type: 'array', items: { type: 'string' }, description: 'Details they reveal only if asked the right question' },
    budget_sek: { type: 'integer' }, patience: { type: 'number', description: '0 (none) to 1 (saint)' }, wants_back: { type: 'string' },
    looks: { type: 'object', additionalProperties: false, required: ['height_cm', 'hair', 'skin', 'beard', 'clothes'], properties: { height_cm: { type: 'integer' }, hair: { type: 'string', enum: ['black', 'dark brown', 'brown', 'blond', 'red', 'grey', 'white', 'none'] }, skin: { type: 'string', enum: ['light', 'medium', 'tan', 'brown', 'dark'] }, beard: { type: 'boolean' }, clothes: { type: 'string', description: 'Main colour of their jacket as #rrggbb' } } },
  },
};
const DECISION_SCHEMA = { type: 'object', additionalProperties: false, required: ['accept', 'says'], properties: { accept: { type: 'boolean' }, says: { type: 'string' } } };
const VERDICT_SCHEMA = { type: 'object', additionalProperties: false, required: ['says', 'pays_sek', 'stars', 'review'], properties: { says: { type: 'string' }, pays_sek: { type: 'integer' }, stars: { type: 'integer', description: '1 to 5' }, review: { type: 'string', description: 'A short online review in their voice' } } };

export class Brain {
  constructor() {
    const s = load();
    this.mode = s.mode ?? 'auto';
    this.key = s.key ?? '';
    this.model = s.model ?? MODELS[0].id;
    this.status = 'unknown';
    this.lastError = null;
    this.usage = { input: 0, output: 0, cached: 0, calls: 0 };
  }

  save() { save({ mode: this.mode, key: this.key, model: this.model }); }

  /** Finds out which way to Claude works here: the dev proxy, a saved key, or none. */
  async probe() {
    if (this.mode === 'offline') return (this.status = 'offline');
    if (this.mode === 'key' || (this.mode === 'auto' && this.key)) return (this.status = this.key ? 'key' : 'offline');
    try {
      const r = await fetch('./claude/__status');
      const j = r.ok ? await r.json() : null;
      if (j?.ok) return (this.status = 'proxy');
    } catch { /* no dev server proxy (the single-file build) */ }
    return (this.status = this.key ? 'key' : 'offline');
  }

  get online() { return this.status === 'proxy' || this.status === 'key'; }

  _client() {
    if (this.status === 'proxy') return new Anthropic({ apiKey: 'held-by-the-dev-proxy', baseURL: new URL('./claude', location.href).href.replace(/\/$/, ''), dangerouslyAllowBrowser: true, maxRetries: 2 });
    return new Anthropic({ apiKey: this.key, dangerouslyAllowBrowser: true, maxRetries: 2 });
  }

  /** One Messages API call. format: a JSON schema for structured output. Returns text (or the parsed object). */
  async _call({ system, messages, format = null, effort = 'low', maxTokens = 4000 }) {
    const client = this._client();
    const fallback = this.model !== 'claude-haiku-5-5';        // server-side fallback on a refusal (Opus 5.5 / Sonnet 5.5)
    const params = {
      model: this.model, max_tokens: maxTokens,
      system: [{ type: 'text', text: RULES }, { type: 'text', text: catalogueText(), cache_control: { type: 'ephemeral' } }, ...(system ? [{ type: 'text', text: system }] : [])],
      messages,
      output_config: { effort, ...(format ? { format: { type: 'json_schema', schema: format } } : {}) },
    };
    let res;
    try {
      res = fallback
        ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await client.messages.create(params);
    } catch (e) {
      this.lastError = e instanceof Anthropic.AuthenticationError ? 'The API key was not accepted.' : e instanceof Anthropic.RateLimitError ? 'Rate limited: wait a moment.' : e instanceof Anthropic.APIError ? `API error ${e.status}: ${e.message}` : `Could not reach Claude: ${e.message}`;
      throw new Error(this.lastError);
    }
    this.usage.calls++;
    this.usage.input += res.usage?.input_tokens ?? 0; this.usage.output += res.usage?.output_tokens ?? 0; this.usage.cached += res.usage?.cache_read_input_tokens ?? 0;
    if (res.stop_reason === 'refusal') throw new Error('The customer would not say that (refused).');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!format) return text;
    try { return JSON.parse(text); } catch { throw new Error('Claude returned something that was not the expected JSON.'); }
  }

  /** A new customer. ctx: { when, weather, recent: [names], wantCar (optional), allowF1 } */
  async newCustomer(ctx) {
    const recent = ctx.recent?.length ? `Customers so far today (make this one different): ${ctx.recent.join('; ')}.` : 'This is the first customer of the day.';
    const carHint = ctx.wantCar ? `This customer comes in with the ${ctx.wantCar}.` : `Pick the car that suits the person (${ctx.allowF1 ? 'the F1 car only rarely, and only with a story that makes sense' : 'not the F1 car'}).`;
    const prompt = `It is ${ctx.when}. Weather: ${ctx.weather}. ${recent}\n${carHint}\nInvent the next customer who walks in. Choose 1–3 faults or jobs from the catalogue that fit their car and story (vary them: not always brakes). Be specific and surprising: a real person with a real reason to be here today. If something was left or lost in the car, give it a vivid label.`;
    const c = await this._call({ messages: [{ role: 'user', content: prompt }], format: CUSTOMER_SCHEMA, effort: 'medium', maxTokens: 8000 });
    const valid = forCar(c.car).map((f) => f.id);
    c.faults = (c.faults ?? []).filter((f) => valid.includes(f.id)).slice(0, 3);
    if (!c.faults.length) c.faults = [{ id: valid[0], where: '' }];
    return c;
  }

  _persona(cust) {
    const p = cust.profile;
    const hidden = cust.records.map((r) => `${r.title}${r.where ? ` (${r.where})` : ''}`).join('; ');
    return `You are now ${p.name}, ${p.age}, ${p.occupation}. Personality: ${p.personality}. How you speak: ${p.speech}.
Your car: ${CARS[p.car].summary}, ${p.mileage_km.toLocaleString('en')} km on the clock.
What really happened (private, reveal naturally, not all at once): ${p.truth}
Things you only say if asked the right question: ${(p.secrets ?? []).join(' | ') || 'none'}.
Your budget is about ${p.budget_sek} SEK; your patience ${p.patience < 0.35 ? 'is short' : p.patience > 0.7 ? 'is long' : 'is average'}; you want the car back ${p.wants_back}.
What is actually wrong with the car (you do NOT know this; never name it or hint at the technical cause; it only tells you what you have noticed): ${hidden}.
${p.item?.location && p.item.location !== 'none' ? `Lost or left in the car: ${p.item.label} (${p.item.location}); you may or may not remember it.` : ''}
The mechanic speaks to you now. Answer as ${p.name}.`;
  }

  /** The customer's next line in the conversation. */
  async reply(cust) {
    const msgs = toMessages(cust.history);
    return this._call({ system: this._persona(cust), messages: msgs, effort: 'low', maxTokens: 2000 });
  }

  /** Yes or no to a proposal (an estimate, extra work). The question is added to the history as an event. */
  async decide(cust, event) {
    const msgs = toMessages([...cust.history, { who: 'event', text: event + ' Decide now: accept or not, and what you say.' }]);
    return this._call({ system: this._persona(cust), messages: msgs, format: DECISION_SCHEMA, effort: 'low', maxTokens: 2000 });
  }

  /** The handover: the customer drives it, reads the bill, pays (or not) and reviews. */
  async verdict(cust, report) {
    const msgs = toMessages([...cust.history, { who: 'event', text: report }]);
    return this._call({ system: this._persona(cust), messages: msgs, format: VERDICT_SCHEMA, effort: 'medium', maxTokens: 4000 });
  }
}

/** The conversation as API messages: the mechanic's lines and events as user turns, the customer's as assistant turns. */
export function toMessages(history) {
  const out = [];
  for (const h of history) {
    const role = h.who === 'customer' ? 'assistant' : 'user';
    const text = h.who === 'event' ? `[${h.text.replace(/^\[|\]$/g, '')}]` : h.text;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + text;
    else out.push({ role, content: text });
  }
  if (!out.length || out[0].role !== 'user') out.unshift({ role: 'user', content: '[The customer comes up to the counter.]' });
  if (out[out.length - 1].role !== 'user') out.push({ role: 'user', content: '[The mechanic waits for you to go on.]' });
  return out;
}
