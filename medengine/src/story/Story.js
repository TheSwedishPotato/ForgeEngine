/**
 * Story data: normalising, validating and drawing a story file.
 *
 * `validateStory(data)` reports every problem at once (a dangling `goto`, a scene with no way out, an expression that does not
 * parse, a variable that is read but never set), so a typo in a 400-node story is found by a test, not by a player.
 * `storyGraph` / `toMermaid` / `toDOT` give the flowchart of the whole story for documentation and for the in-game map.
 */
import { compileExpr, compileStatement } from './Expr.js';

/**
 * A story file, as written (see docs/STORY.md for the node types). `validateStory` lists what is wrong with one.
 * @typedef {object} StoryData
 * @property {string} [title]
 * @property {string} start     the id of the first node
 * @property {Record<string, any>} nodes  node id -> node
 * @property {Record<string, any>} [vars]  variables and their starting values
 * @property {string[] | Record<string, number>} [items]  items the player starts with
 * @property {string} [continueText]  the text of the automatic "continue" choice (default 'Continue')
 */

/**
 * A node after `normalizeStory`: its `id` and `type` are set and the defaults of its type are filled in.
 * @typedef {{ id: string, type: string, [key: string]: any }} StoryNode
 */

/**
 * A story after `normalizeStory`: checked, with defaults filled in. This is what a StoryRunner plays.
 * @typedef {object} NormalizedStory
 * @property {string} title
 * @property {string} start
 * @property {Record<string, any>} vars
 * @property {Record<string, number>} items
 * @property {string} continueText
 * @property {Record<string, StoryNode>} nodes
 * @property {string[]} warnings  what `validateStory` found that is probably a mistake
 */

/**
 * @typedef {object} GraphNode
 * @property {string} id
 * @property {string} type   'scene', 'timed', 'qte', 'negotiation', 'explore', 'branch', 'random' or 'end'
 * @property {string} label
 */

/**
 * @typedef {object} GraphEdge
 * @property {string} from
 * @property {string} to
 * @property {string} label
 * @property {string} kind   'choice', 'goto', 'timeout', 'success', 'fail', 'case' or 'random'
 */

/**
 * The flowchart of a whole story.
 * @typedef {{ nodes: GraphNode[], edges: GraphEdge[] }} StoryGraph
 */

/**
 * The flowchart with what has been visited, as `StoryRunner.flowchart()` returns it.
 * @typedef {{ nodes: (GraphNode & { visits: number, current: boolean })[], edges: (GraphEdge & { taken: boolean })[] }} Flowchart
 */

const TYPES = new Set(['scene', 'timed', 'qte', 'negotiation', 'explore', 'branch', 'random', 'end']);

function guessType(n) {
  if (n.type) return n.type;
  if (n.ending !== undefined) return 'end';
  if (n.keys || n.mash) return 'qte';
  if (n.meter) return 'negotiation';
  if (n.spots) return 'explore';
  if (n.cases) return 'branch';
  if (n.options) return 'random';
  if (n.seconds !== undefined) return 'timed';
  return 'scene';
}

/**
 * Where a node leads: `[{ from, to, label, kind }]`.
 * @param {string} id
 * @param {StoryNode} n
 * @returns {GraphEdge[]}
 */
export function edgesOf(id, n) {
  const out = [];
  const add = (to, label, kind) => { if (typeof to === 'string') out.push({ from: id, to, label: label ?? '', kind }); };
  switch (n.type) {
    case 'scene': case 'timed':
      for (const c of n.choices ?? []) {
        if (c.check !== undefined) { add(c.success ?? c.goto, `${c.text} ✓`, 'choice'); add(c.fail ?? c.goto, `${c.text} ✗`, 'choice'); } else add(c.goto, c.text, 'choice');
      }
      add(n.goto, n.choices?.length ? '' : 'continue', 'goto');
      if (n.type === 'timed') add(n.timeout, 'time runs out', 'timeout');
      break;
    case 'qte': add(n.success, 'success', 'success'); add(n.fail, 'fail', 'fail'); break;
    case 'negotiation': add(n.onWin, 'win', 'success'); add(n.onLose, 'lose', 'fail'); add(n.onTimeout, 'rounds out', 'timeout'); break;
    case 'explore': for (const c of n.spots ?? []) add(c.goto, c.text, 'choice'); break;
    case 'branch': for (const c of n.cases ?? []) add(c.goto, c.if, 'case'); add(n.else, 'else', 'case'); break;
    case 'random': {
      // chances are exact only when no option has a condition; with conditions the weights are shown as they are
      const opts = n.options ?? [], total = opts.reduce((s, o) => s + (o.weight ?? 1), 0), plain = opts.every((o) => o.if === undefined);
      for (const o of opts) add(o.goto, plain ? `${Math.round((100 * (o.weight ?? 1)) / total)}%` : `weight ${Math.round((o.weight ?? 1) * 100) / 100}`, 'random');
      break;
    }
    default: break;
  }
  return out;
}

function firstLine(n) {
  const t = Array.isArray(n.text) ? n.text.find((x) => typeof x === 'string' || x?.text) : n.text;
  const s = typeof t === 'string' ? t : t?.text ?? '';
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * `{ nodes: [{id, type, label}], edges: [{from, to, label, kind}] }` for a (normalised or raw) story.
 * @param {StoryData | NormalizedStory} story
 * @returns {StoryGraph}
 */
export function storyGraph(story) {
  const nodes = [], edges = [];
  for (const [id, n0] of Object.entries(story.nodes)) {
    const n = n0.type ? n0 : { ...n0, type: guessType(n0) };
    const text = firstLine(n);
    nodes.push({ id, type: n.type, label: n.title ?? (text.length > 44 ? `${text.slice(0, 43)}…` : text || id) });
    edges.push(...edgesOf(id, n));
  }
  return { nodes, edges };
}

/** Cuts `s` to `n` characters, with an ellipsis when something was cut. */
const clip = (s, n) => { const t = String(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const SHAPES = { scene: ['[', ']'], timed: ['([', '])'], qte: ['{{', '}}'], negotiation: ['[[', ']]'], explore: ['(', ')'], branch: ['{', '}'], random: ['{', '}'], end: ['((', '))'] };
/** Text inside a quoted Mermaid label: entity codes for the characters that would end the label or be read as markup. */
const q = (s) => String(s).replace(/[\n\r]+/g, ' ').replace(/&/g, '#amp;').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;').replace(/\|/g, '#124;');
/** Text inside a quoted DOT string. */
const dq = (s) => String(s).replace(/[\n\r]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * Mermaid flowchart source. With a runner's `flowchart()` result, visited nodes and taken edges are highlighted
 * (the class is called `ending`, not `end`: a bare `end` closes a subgraph in Mermaid and breaks the chart).
 * @param {StoryData | NormalizedStory} story
 * @param {Flowchart | null} [progress]
 * @returns {string}
 */
export function toMermaid(story, progress = null) {
  const g = progress ?? storyGraph(story);
  const lines = ['flowchart TD'];
  const key = (id) => `n_${id.replace(/[^A-Za-z0-9_]/g, '_')}`;
  for (const n of g.nodes) {
    const [a, b] = SHAPES[n.type] ?? SHAPES.scene;
    lines.push(`  ${key(n.id)}${a}"${q(n.label && n.label !== n.id ? `${n.id}: ${n.label}` : n.id)}"${b}`);
  }
  for (const e of g.edges) lines.push(`  ${key(e.from)} ${e.taken ? '==>' : '-->'}${e.label ? `|"${q(clip(e.label, 48))}"|` : ''} ${key(e.to)}`);
  lines.push('  classDef ending fill:#f4d9a8,stroke:#8a5a00;', '  classDef visited fill:#cfe8cf,stroke:#2a6b2a;', '  classDef current fill:#ffd24d,stroke:#000,stroke-width:3px;');
  const ends = g.nodes.filter((n) => n.type === 'end').map((n) => key(n.id));
  if (ends.length) lines.push(`  class ${ends.join(',')} ending;`);
  const vis = g.nodes.filter((n) => n.visits > 0 && !n.current).map((n) => key(n.id));
  if (vis.length) lines.push(`  class ${vis.join(',')} visited;`);
  const cur = g.nodes.find((n) => n.current);
  if (cur) lines.push(`  class ${key(cur.id)} current;`);
  return lines.join('\n');
}

/**
 * Graphviz DOT source.
 * @param {StoryData | NormalizedStory} story
 * @returns {string}
 */
export function toDOT(story) {
  const g = storyGraph(story);
  const out = ['digraph story {', '  rankdir=TB; node [shape=box, fontname="sans-serif"];'];
  for (const n of g.nodes) out.push(`  "${dq(n.id)}" [label="${dq(n.id)}${n.label && n.label !== n.id ? `\\n${dq(n.label)}` : ''}"${n.type === 'end' ? ', shape=doublecircle' : n.type === 'branch' || n.type === 'random' ? ', shape=diamond' : ''}];`);
  for (const e of g.edges) out.push(`  "${dq(e.from)}" -> "${dq(e.to)}"${e.label ? ` [label="${dq(clip(e.label, 48))}"]` : ''};`);
  out.push('}');
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------------------- validation

/**
 * Checks a story file. Never throws on a bad story: returns `{ errors, warnings }` (lists of strings).
 * `errors` would break play (dangling links, dead ends, unparsable expressions); `warnings` are probably mistakes.
 * @param {StoryData | string} data  the story, or its JSON text
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateStory(data) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  const story = typeof data === 'string' ? JSON.parse(data) : data;
  if (!story || typeof story !== 'object') return { errors: ['the story is not an object'], warnings };
  const nodes = story.nodes;
  if (!nodes || typeof nodes !== 'object' || !Object.keys(nodes).length) return { errors: ['the story has no nodes'], warnings };
  if (!story.start || !nodes[story.start]) err(`'start' ${story.start ? `("${story.start}") is not a node` : 'is missing'}`);

  const declared = new Set(Object.keys(story.vars ?? {}));
  const written = new Set(), read = new Map();     // name -> first place it was read
  const noteReads = (ids, where) => { for (const id of ids) if (!read.has(id)) read.set(id, where); };
  const expr = (src, where) => {
    try { const c = compileExpr(src); noteReads(c.ids, where); return true; } catch (e) { err(`${where}: ${e.message}`); return false; }
  };
  const stmts = (list, where) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) { err(`${where}: expected a list of statements`); return; }
    for (const s of list) {
      try { const c = compileStatement(s); for (const w of c.writes) written.add(w); noteReads(c.reads, where); } catch (e) { err(`${where}: ${e.message}`); }
    }
  };
  const texts = (t, where) => {
    for (const l of t === undefined ? [] : Array.isArray(t) ? t : [t]) {
      const s = typeof l === 'string' ? l : l?.text;
      if (l && typeof l === 'object' && l.if !== undefined) expr(l.if, `${where} (line condition)`);
      for (const m of String(s ?? '').matchAll(/\{([^{}]+)\}/g)) { try { noteReads(compileExpr(m[1]).ids, where); } catch { warn(`${where}: {${m[1]}} is not a valid expression`); } }
    }
  };
  const exists = (to, where) => { if (typeof to !== 'string' || !nodes[to]) err(`${where}: leads to '${to}', which is not a node`); };

  const adjacency = new Map();
  for (const [id, raw] of Object.entries(nodes)) {
    const n = { ...raw, type: guessType(raw) };
    const at = `node '${id}'`;
    if (!TYPES.has(n.type)) { err(`${at}: unknown type '${n.type}'`); continue; }
    stmts(n.on, `${at} on`);
    texts(n.text, at);
    const edges = edgesOf(id, n);
    adjacency.set(id, edges.map((e) => e.to));
    for (const e of edges) exists(e.to, `${at} → ${e.kind}${e.label ? ` "${String(e.label).slice(0, 30)}"` : ''}`);
    const listChoices = (list, noun) => {
      const ids = new Set();
      (list ?? []).forEach((c, i) => {
        const w = `${at} ${noun} ${i + 1}${c.text ? ` "${String(c.text).slice(0, 30)}"` : ''}`;
        if (typeof c.text !== 'string') err(`${w}: needs 'text'`);
        else texts(c.text, w);
        if (c.if !== undefined) expr(c.if, `${w} if`);
        if (c.check !== undefined) expr(c.check, `${w} check`);
        stmts(c.do, `${w} do`);
        if (c.say !== undefined) texts(c.say, w);
        if (c.id !== undefined) { if (ids.has(c.id)) err(`${w}: duplicate id '${c.id}'`); ids.add(c.id); }
        if (c.check !== undefined && c.success === undefined && c.goto === undefined) err(`${w}: a check needs 'success' (and 'fail') or 'goto'`);
      });
    };
    switch (n.type) {
      case 'scene': case 'timed':
        listChoices(n.choices, 'choice');
        if (!(n.choices?.length) && n.goto === undefined) err(`${at}: a ${n.type} node needs 'choices' or 'goto' (the player would be stuck)`);
        if (n.type === 'timed') {
          if (!(n.seconds > 0)) err(`${at}: 'seconds' must be above 0`);
          if (n.timeout === undefined) err(`${at}: a timed node needs 'timeout' (a node, or the index of the choice taken when time runs out)`);
          else if (typeof n.timeout === 'number' && !(n.choices?.length > n.timeout)) err(`${at}: timeout ${n.timeout} is not one of its choices`);
        }
        break;
      case 'qte':
        if (n.mash) { if (!n.mash.key || !(n.mash.count > 0) || !(n.mash.seconds > 0)) err(`${at}: 'mash' needs key, count and seconds`); }
        else if (!Array.isArray(n.keys) || !n.keys.length) err(`${at}: a qte needs 'keys' (a list) or 'mash'`);
        if (n.success === undefined || n.fail === undefined) err(`${at}: a qte needs 'success' and 'fail'`);
        break;
      case 'negotiation': {
        const m = n.meter ?? {};
        if (!m.name) err(`${at}: 'meter.name' is missing`);
        else { declared.add(m.name); noteReads(new Set([m.name]), `${at} (meter)`); }
        const min = m.min ?? -10, max = m.max ?? 10;
        if (!(max > min)) err(`${at}: meter max must be above min`);
        if ((n.win ?? max) > max || (n.lose ?? min) < min) err(`${at}: win / lose must lie inside the meter's range`);
        if ((n.win ?? max) <= (n.lose ?? min)) err(`${at}: win must be above lose`);
        if (!n.options?.length) err(`${at}: a negotiation needs 'options'`);
        listChoices(n.options, 'option');
        for (const o of n.options ?? []) if (typeof o.delta !== 'number' && o.risk === undefined) warn(`${at}: option "${o.text}" has no delta`);
        if (n.onWin === undefined || n.onLose === undefined) err(`${at}: a negotiation needs 'onWin' and 'onLose'`);
        break;
      }
      case 'explore':
        if (!n.spots?.length) err(`${at}: an explore node needs 'spots'`);
        else if (!n.spots.some((c) => c.goto !== undefined)) err(`${at}: no spot leads anywhere: the player could never leave`);
        listChoices(n.spots, 'spot');
        break;
      case 'branch':
        if (!n.cases?.length && n.else === undefined) err(`${at}: a branch needs 'cases' or 'else'`);
        (n.cases ?? []).forEach((c, i) => { if (c.if !== undefined) expr(c.if, `${at} case ${i + 1}`); else if (i < n.cases.length - 1) warn(`${at}: case ${i + 1} has no condition, so the cases after it can never run`); stmts(c.do, `${at} case ${i + 1} do`); });
        if (n.else === undefined && !(n.cases ?? []).some((c) => c.if === undefined)) warn(`${at}: no 'else': the story fails if no case matches`);
        break;
      case 'random':
        if (!n.options?.length) err(`${at}: a random node needs 'options'`);
        (n.options ?? []).forEach((o, i) => { if (o.if !== undefined) expr(o.if, `${at} option ${i + 1}`); stmts(o.do, `${at} option ${i + 1} do`); if (o.weight !== undefined && !(o.weight > 0)) err(`${at}: option ${i + 1} weight must be above 0`); });
        break;
      case 'end':
        break;
      default: break;
    }
  }

  // reachability
  if (nodes[story.start]) {
    const seen = new Set([story.start]), stack = [story.start];
    while (stack.length) for (const to of adjacency.get(stack.pop()) ?? []) if (nodes[to] && !seen.has(to)) { seen.add(to); stack.push(to); }
    for (const id of Object.keys(nodes)) if (!seen.has(id)) warn(`node '${id}' can never be reached from '${story.start}'`);
    if (![...seen].some((id) => guessType(nodes[id]) === 'end')) err('no ending can be reached from the start');
  }
  // variables
  for (const [name, where] of read) if (!declared.has(name) && !written.has(name)) warn(`variable '${name}' is read (${where}) but never declared in 'vars' or assigned`);
  for (const [name] of Object.entries(story.vars ?? {})) if (!read.has(name) && !written.has(name)) warn(`variable '${name}' is declared but never used`);
  return { errors, warnings };
}

/**
 * Fills in defaults and checks a story; throws one error listing every problem when it is broken.
 * @param {StoryData | string} data  the story, or its JSON text
 * @returns {NormalizedStory}
 */
export function normalizeStory(data) {
  const raw = typeof data === 'string' ? JSON.parse(data) : data;
  const { errors, warnings } = validateStory(raw);
  if (errors.length) throw new Error(`story "${raw?.title ?? '?'}" has ${errors.length} problem${errors.length > 1 ? 's' : ''}:\n  - ${errors.slice(0, 25).join('\n  - ')}${errors.length > 25 ? `\n  ... and ${errors.length - 25} more` : ''}`);
  const items = Array.isArray(raw.items) ? Object.fromEntries(raw.items.map((i) => [i, 1])) : { ...(raw.items ?? {}) };
  const story = { title: raw.title ?? 'Untitled', start: raw.start, vars: { ...(raw.vars ?? {}) }, items, continueText: raw.continueText ?? 'Continue', nodes: {}, warnings };
  for (const [id, n0] of Object.entries(raw.nodes)) {
    const n = { ...n0, id, type: guessType(n0) };
    n.on ??= [];
    const number = (list) => (list ?? []).map((c, i) => ({ ...c, __i: i }));
    switch (n.type) {
      case 'scene': case 'timed': n.choices = number(n.choices); break;
      case 'explore': n.spots = number(n.spots); break;
      case 'negotiation':
        n.meter = { min: -10, max: 10, start: 0, ...n.meter };
        n.win ??= n.meter.max; n.lose ??= n.meter.min; n.rounds ??= 6;
        n.options = number(n.options);
        break;
      case 'qte': n.window ??= 1.2; n.allowMisses ??= 0; break;
      case 'end': n.ending ??= id; break;
      default: break;
    }
    story.nodes[id] = n;
  }
  return story;
}
