/**
 * A tiny, safe expression language for story conditions and effects. No `eval`, no `new Function`: story files are data, and a
 * save file or a downloaded story must never be able to run code.
 *
 *   conditions   "gold >= 5 and not has('key')"     "trust > 2 || visited('temple')"     "d(20) + strength >= 12"
 *   statements   "gold -= 5"   "met_king = true"   "trust = clamp(trust + 2, -10, 10)"   "give key"   "take coin 3"
 *
 * Operators (low to high): ?:  || or  && and  == != === !==  < <= > >=  + -  * / %  ! not -  ( )
 * Literals: numbers, 'text' or "text", true, false, null. Identifiers may contain dots (`king.trust`). An unknown variable reads as 0
 * (so `gold >= 5` is false before `gold` exists) - the story validator reports names that are read but never declared or assigned.
 */

const FUNCS = {
  has: (e, item) => e.items.has(String(item)) && e.items.get(String(item)) > 0,
  count: (e, item) => e.items.get(String(item)) ?? 0,
  visited: (e, node) => (e.visits[String(node)] ?? 0) > 0,
  visits: (e, node) => e.visits[String(node)] ?? 0,
  used: (e, id) => e.used.has(String(id)),
  chance: (e, p) => e.rng() < p,
  d: (e, n) => 1 + Math.floor(e.rng() * Math.max(1, Math.floor(n))),
  rand: (e) => e.rng(),
  min: (e, ...a) => Math.min(...a), max: (e, ...a) => Math.max(...a),
  abs: (e, x) => Math.abs(x), floor: (e, x) => Math.floor(x), ceil: (e, x) => Math.ceil(x), round: (e, x) => Math.round(x),
  clamp: (e, x, a, b) => Math.min(b, Math.max(a, x)),
};

const KEYWORDS = { and: '&&', or: '||', not: '!' };

function tokenize(src) {
  const t = [], re = /\s*(?:(\d+(?:\.\d+)?)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)|(===|!==|==|!=|<=|>=|&&|\|\||[-+*/%<>!?:(),]))/y;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) { if (/^\s*$/.test(src.slice(pos))) break; throw new Error(`unexpected '${src.slice(pos).trim()[0]}' in "${src}"`); }
    pos = re.lastIndex;
    if (m[1] !== undefined) t.push({ k: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) t.push({ k: 'str', v: m[2].slice(1, -1).replace(/\\(.)/g, '$1') });
    else if (m[3] !== undefined) t.push(KEYWORDS[m[3]] ? { k: 'op', v: KEYWORDS[m[3]] } : { k: 'id', v: m[3] });
    else t.push({ k: 'op', v: m[4] });
  }
  return t;
}

const BIN = [['||'], ['&&'], ['==', '!=', '===', '!=='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];

/** Parses to a closure `(env) => value`; `ids` collects the variable names read, `fns` the functions called. */
function parse(src, ids, fns) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i], eat = (v) => { const t = toks[i]; if (t && t.k === 'op' && t.v === v) { i++; return true; } return false; };
  const need = (v) => { if (!eat(v)) throw new Error(`expected '${v}' in "${src}"`); };
  const ternary = () => {
    const c = level(0);
    if (eat('?')) { const a = ternary(); need(':'); const b = ternary(); return (e) => (c(e) ? a(e) : b(e)); }
    return c;
  };
  const level = (n) => {
    if (n >= BIN.length) return unary();
    let l = level(n + 1);
    for (;;) {
      const t = peek();
      if (!(t && t.k === 'op' && BIN[n].includes(t.v))) return l;
      i++;
      const r = level(n + 1), op = t.v, a = l;
      l = op === '||' ? (e) => a(e) || r(e) : op === '&&' ? (e) => a(e) && r(e) : binary(op, a, r);
    }
  };
  const unary = () => {
    if (eat('!')) { const x = unary(); return (e) => !x(e); }
    if (eat('-')) { const x = unary(); return (e) => -x(e); }
    return primary();
  };
  const primary = () => {
    const t = toks[i++];
    if (!t) throw new Error(`unexpected end of "${src}"`);
    if (t.k === 'num' || t.k === 'str') { const v = t.v; return () => v; }
    if (t.k === 'op' && t.v === '(') { const x = ternary(); need(')'); return x; }
    if (t.k === 'id') {
      if (t.v === 'true') return () => true;
      if (t.v === 'false') return () => false;
      if (t.v === 'null') return () => null;
      if (eat('(')) {
        const args = [];
        if (!eat(')')) { do args.push(ternary()); while (eat(',')); need(')'); }
        const name = t.v;
        fns.add(name);
        return (e) => {
          const f = e.fns[name] ?? FUNCS[name];
          if (!f) throw new Error(`unknown function ${name}()`);
          return f(e, ...args.map((a) => a(e)));
        };
      }
      const name = t.v;
      ids.add(name);
      return (e) => e.vars[name] ?? 0;
    }
    throw new Error(`unexpected '${t.v}' in "${src}"`);
  };
  const out = ternary();
  if (i < toks.length) throw new Error(`unexpected '${toks[i].v}' in "${src}"`);
  return out;
}

function binary(op, a, b) {
  switch (op) {
    case '==': return (e) => a(e) == b(e);   // eslint-disable-line eqeqeq
    case '!=': return (e) => a(e) != b(e);   // eslint-disable-line eqeqeq
    case '===': return (e) => a(e) === b(e);
    case '!==': return (e) => a(e) !== b(e);
    case '<': return (e) => a(e) < b(e);
    case '<=': return (e) => a(e) <= b(e);
    case '>': return (e) => a(e) > b(e);
    case '>=': return (e) => a(e) >= b(e);
    case '+': return (e) => a(e) + b(e);
    case '-': return (e) => a(e) - b(e);
    case '*': return (e) => a(e) * b(e);
    case '/': return (e) => { const d = b(e); return d === 0 ? 0 : a(e) / d; };
    case '%': return (e) => { const d = b(e); return d === 0 ? 0 : a(e) % d; };
    default: throw new Error(`bad operator ${op}`);
  }
}

const cache = new Map();

/** @returns {{ run: (env)=>any, ids: Set<string>, fns: Set<string> }} */
export function compileExpr(src) {
  let c = cache.get(src);
  if (c) return c;
  const ids = new Set(), fns = new Set();
  c = { run: parse(String(src), ids, fns), ids, fns };
  cache.set(src, c);
  return c;
}

/** Evaluates an expression string against an environment `{ vars, items, visits, used, rng, fns }`. */
export function evalExpr(src, env) { return compileExpr(src).run(env); }

const STMT = /^\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*(=|\+=|-=|\*=|\/=|%=)\s*([\s\S]*?)\s*$/;
const ITEM = /^\s*(give|take)\s+([A-Za-z_][A-Za-z0-9_.-]*)(?:\s+(\d+))?\s*$/;

/** Parses one effect statement. @returns {{ run: (env)=>void, writes: string[], reads: Set<string> }} */
export function compileStatement(src) {
  const it = ITEM.exec(src);
  if (it) {
    const [, verb, item, n] = it, amount = n ? parseInt(n, 10) : 1;
    return { reads: new Set(), writes: [], items: [item], run: (e) => { const cur = e.items.get(item) ?? 0; const next = Math.max(0, cur + (verb === 'give' ? amount : -amount)); if (next) e.items.set(item, next); else e.items.delete(item); } };
  }
  const m = STMT.exec(src);
  if (!m) throw new Error(`bad statement "${src}" (expected "name = expr", "name += expr", "give item" or "take item")`);
  const [, name, op, rhs] = m;
  if (!rhs) throw new Error(`bad statement "${src}" (nothing after '${op}')`);
  let ex;
  try { ex = compileExpr(rhs); } catch (e) { throw new Error(`bad statement "${src}": ${e.message}`); }
  const run = op === '=' ? (e) => { e.vars[name] = ex.run(e); }
    : (e) => {
      const cur = e.vars[name] ?? 0, v = ex.run(e);
      e.vars[name] = op === '+=' ? cur + v : op === '-=' ? cur - v : op === '*=' ? cur * v : op === '/=' ? (v === 0 ? 0 : cur / v) : (v === 0 ? 0 : cur % v);
    };
  return { run, writes: [name], reads: new Set(ex.ids), items: [] };
}
