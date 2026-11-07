/**
 * Automatic playthroughs: a bot that plays a story at random, to find softlocks, loops and unreachable endings before players do.
 *
 *   const report = fuzzStory(story, { runs: 1500, seed: 1 });
 *   report.softlocks   // [{ seed, node, path }]  places where the bot had nothing it could do
 *   report.loops       // runs that did not end within `maxSteps`
 *   report.endings     // { peace: 412, war: 380, ... }
 *   report.unvisited   // node ids no run ever reached
 */
import { StoryRunner } from './StoryRunner.js';

/** @import { StoryData, NormalizedStory } from './Story.js' */

/**
 * How one random playthrough went.
 * @typedef {object} PlayResult
 * @property {'ended' | 'softlock' | 'loop'} result  it reached an ending, it had nothing left it could do, or it did not end within `maxSteps`
 * @property {string | null} ending   the ending reached
 * @property {number} steps
 * @property {string} node            where it stopped
 * @property {string[]} path          the nodes it went through (the last 30 unless it ended)
 * @property {number} seed
 */

/**
 * What `fuzzStory` found.
 * @typedef {object} FuzzReport
 * @property {number} runs
 * @property {Record<string, number>} endings    how often each ending was reached
 * @property {PlayResult[]} softlocks            the first 10 runs that got stuck
 * @property {PlayResult[]} loops                the first 10 runs that did not end
 * @property {number} longest                    steps of the longest run
 * @property {number} avgSteps
 * @property {Set<string>} visited               every node some run reached
 * @property {string[]} unvisited                node ids no run reached
 * @property {boolean} ok                        no softlocks and no loops
 */

const dice = (seed) => {
  let s = seed | 0;
  return () => { s = (s + 0x9e3779b9) | 0; let t = Math.imul(s ^ (s >>> 16), 0x21f0aaad); t = Math.imul(t ^ (t >>> 15), 0x735a2d97); return ((t ^ (t >>> 15)) >>> 0) / 4294967296; };
};

/**
 * Plays one story to its end (or until it gets stuck) with random decisions.
 * @param {StoryData | NormalizedStory | StoryRunner | null} story  the story (or a runner); null when `runner` is given
 * @param {{ seed?: number, maxSteps?: number, runner?: StoryRunner | null, letTimersRun?: number, failQtes?: number }} [o]
 *   `letTimersRun` is the chance of letting a timer run out, `failQtes` of letting a quick-time event run out
 * @returns {PlayResult}
 */
export function playRandom(story, { seed = 1, maxSteps = 600, runner = null, letTimersRun = 0.25, failQtes = 0.4 } = {}) {
  const r = runner ?? (story instanceof StoryRunner ? story : StoryRunner.from(story, { seed }));
  if (runner || story instanceof StoryRunner) r.reseed(seed);
  const rnd = dice(seed * 7919 + 13);
  r.start();
  let steps = 0;
  while (!r.ended && steps < maxSteps) {
    steps++;
    const v = r.view;
    if (v.type === 'qte') {
      if (rnd() < failQtes) { r.update(60); continue; }                       // wait it out
      const q = v.qte;
      if (q.mode === 'mash') { for (let i = 0; i < q.need && !r.ended && r.node === v.id; i++) r.input(q.key); } else { for (const k of q.keys) { if (r.ended || r.node !== v.id) break; r.input(k); } }
      continue;
    }
    if (v.type === 'timed' && rnd() < letTimersRun) { r.update(v.timer.total + 1); continue; }
    const open = v.choices.filter((c) => c.enabled);
    if (!open.length) return { result: 'softlock', ending: null, steps, node: r.node, path: r.history.slice(-30), seed };
    r.choose(open[Math.floor(rnd() * open.length)].index);
  }
  if (!r.ended) return { result: 'loop', ending: null, steps, node: r.node, path: r.history.slice(-30), seed };
  return { result: 'ended', ending: r.ended.ending, steps, node: r.node, path: r.history.slice(), seed };
}

/**
 * Plays `runs` random games (seeds `seed`, `seed + 1`, ...) and summarises.
 * @param {StoryData | string} story
 * @param {{ runs?: number, seed?: number, maxSteps?: number }} [o]
 * @returns {FuzzReport}
 */
export function fuzzStory(story, { runs = 1000, seed = 1, maxSteps = 600 } = {}) {
  const r = StoryRunner.from(story, { seed });
  const report = { runs, endings: {}, softlocks: [], loops: [], longest: 0, avgSteps: 0, visited: new Set(), unvisited: [] };
  let total = 0;
  for (let i = 0; i < runs; i++) {
    const res = playRandom(null, { seed: seed + i, runner: r, maxSteps });
    total += res.steps;
    report.longest = Math.max(report.longest, res.steps);
    for (const id of Object.keys(r.visits)) report.visited.add(id);
    if (res.result === 'ended') report.endings[res.ending] = (report.endings[res.ending] ?? 0) + 1;
    else if (res.result === 'softlock') { if (report.softlocks.length < 10) report.softlocks.push(res); } else if (report.loops.length < 10) report.loops.push(res);
  }
  report.avgSteps = total / runs;
  report.unvisited = Object.keys(r.story.nodes).filter((id) => !report.visited.has(id));
  report.ok = !report.softlocks.length && !report.loops.length;
  return report;
}
