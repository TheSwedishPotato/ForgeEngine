/**
 * What people remember, and how word gets round.
 *
 * Every person keeps a short list of memories: things they saw, things done
 * to them or for them, things they were told, and things they heard from
 * others. Each has a weight (how much it matters to them, 1–10) and an
 * `about` (the player, or another person's id). Memories fade with time,
 * trifles within hours, grave things over a week or more; half-faded ones
 * come back hazy, and only what is still fresh is worth gossiping about. When two people stand together for a while, the
 * talkative one passes on what she knows that is worth telling, a little
 * weaker each time it is retold, and the listener's opinion of whoever it
 * is about shifts with it. That is how a theft in the market at nine is
 * known in the tavern by supper.
 */

const KEEP = 24;
const KIND_WORD = { saw: 'you saw', done: 'they did to you', got: 'you got from them', gave: 'you gave them', said: 'they told you', met: 'you noted', heard: 'you heard' };

/**
 * How strongly a memory is still held: its weight, halving over a time that
 * grows with how much it mattered (a trifle in about 6 game hours, a theft or
 * a blow in about 6 days, the gravest things over a week).
 */
export function strength(m, t) {
  const half = 6 * Math.pow(m.weight, 1.5);
  return m.weight * Math.pow(0.5, Math.max(0, t - m.t) / half);
}

/** Let what has faded go. */
export function fade(p, t) {
  if (!p.memories?.length) return;
  p.memories = p.memories.filter((m) => strength(m, t) >= 0.6);
}

/** Store a memory. m: {kind, text, about = 'player', weight = 3, src, crime, att}. Returns it. */
export function remember(p, m, t) {
  p.memories ??= [];
  const mem = { t, kind: m.kind ?? 'met', text: String(m.text).slice(0, 160), about: m.about ?? 'player', weight: Math.max(1, Math.min(10, m.weight ?? 3)), src: m.src ?? null, crime: m.crime ?? null, att: m.att ?? 0, told: [] };
  // the same thing heard twice does not count twice
  const dup = p.memories.find((x) => x.text === mem.text && x.about === mem.about);
  if (dup) { dup.weight = Math.max(dup.weight, mem.weight); dup.t = t; return dup; }
  p.memories.push(mem);
  if (p.memories.length > KEEP) {
    // forget the least important, weighing age (a day halves it)
    let worst = 0, ws = Infinity;
    for (const [i, x] of p.memories.entries()) { const s = strength(x, t); if (s < ws) { ws = s; worst = i; } }
    p.memories.splice(worst, 1);
  }
  return mem;
}

/** Memories about someone (default the player), newest last. */
export function about(p, who = 'player') { return (p.memories ?? []).filter((m) => m.about === who); }

/** Has this person witnessed (or heard of) a given crime? */
export function knowsCrime(p, crimeId, firsthand = false) { return (p.memories ?? []).some((m) => m.crime === crimeId && (!firsthand || m.kind === 'saw' || m.kind === 'done')); }

/** A few lines for a prompt: what this person remembers of the player, with where they know it from. */
export function memoryLines(sim, p, max = 10) {
  const list = about(p, 'player').slice().sort((a, b) => a.t - b.t).slice(-max);
  return list.map((m) => {
    const ago = sim.t - m.t, when = ago < 1 ? 'just now' : ago < 20 ? `${Math.round(ago)} hours ago` : `${Math.round(ago / 24)} days ago`;
    const src = m.kind === 'heard' && m.src ? ` (from ${sim.byId[m.src]?.fullName ?? 'someone'})` : '';
    const hazy = strength(m, sim.t) < m.weight * 0.4 ? ' (you only half remember this; you may have details wrong)' : '';
    return `${when}, ${KIND_WORD[m.kind] ?? m.kind}${src}: ${m.text}${hazy}`;
  });
}

/** Short lines for the journal. */
export function memorySummary(p, n = 2) { return about(p, 'player').slice(-n).map((m) => (m.kind === 'heard' ? 'heard: ' : '') + m.text).join('; '); }

/**
 * Gossip: people together pass on what they know about the player (and
 * about each other's crimes). Run every few game minutes.
 */
export function gossip(sim, rng = Math.random) {
  const groups = new Map();
  for (const p of sim.people) fade(p, sim.t);
  for (const p of sim.people) {
    if (!p.alive || p.agent.route.length || /sleep/.test(p.agent.act)) continue;
    const a = p.agent;
    const key = a.inside ? 'in:' + a.inside : `out:${Math.round(a.x / 6)}:${Math.round(a.z / 6)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const passed = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    for (const speaker of g) {
      // the talkative talk; the honest keep secrets less than the sly embroider them, but both talk
      if (rng() > 0.25 + 0.6 * speaker.traits.extraversion) continue;
      const worth = (speaker.memories ?? []).filter((m) => strength(m, sim.t) >= 3 && m.about !== speaker.id).sort((a, b) => b.weight - a.weight || b.t - a.t);
      for (const m of worth.slice(0, 2)) {
        const listener = g.find((q) => q !== speaker && !m.told.includes(q.id) && q.id !== m.about);
        if (!listener) continue;
        m.told.push(listener.id);
        const heard = remember(listener, { kind: 'heard', text: m.kind === 'heard' ? m.text : `${m.kind === 'done' ? `${speaker.name} says ` : m.kind === 'saw' ? `${speaker.name} saw ` : `${speaker.name} says `}${m.text}`, about: m.about, weight: m.weight - 2, src: speaker.id, crime: m.crime, att: m.att * 0.5 }, sim.t);
        if (m.about === 'player' && heard.weight >= 1) listener.attitude = Math.max(-100, Math.min(100, listener.attitude + Math.round(m.att * 0.4)));
        passed.push({ from: speaker, to: listener, m });
      }
    }
  }
  return passed;
}

export function serializeMemories(p) { return (p.memories ?? []).map(({ told, ...m }) => ({ ...m, told: told.slice(-6) })); }
