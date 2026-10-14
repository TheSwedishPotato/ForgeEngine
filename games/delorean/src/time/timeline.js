/**
 * Hill Valley through time: what stands where on any date, and what the traveller changes.
 *
 * The town's history as the films tell it (and, where they are silent, as a California valley
 * town's would run):
 *  - before 1850: oak savanna and grass; no town.
 *  - 1850-1884: the first frame buildings along the trail.
 *  - 1885: the frontier town of Part III; the courthouse is finished and its clock started on
 *    5 September 1885 (the photograph that hangs in it).
 *  - 1900s-1960s: the brick downtown round the courthouse square; Old Man Peabody's farm out
 *    on the county road, two young pines by its gate (planted, here, in 1945).
 *  - 12 November 1955, 10:04 PM: lightning strikes the clock tower; the clock stops for good.
 *  - 1970s-1980s: decline; the courthouse is the "Save the Clock Tower" cause; the farm
 *    becomes the Twin Pines Mall (opened, here, in 1979).
 *  - 2015: the courthouse a mall again round a restored square; the clock still at 10:04.
 *  - the far future: not shown in the films; the town carries on as in 2015.
 *
 * Changes the player makes are stored as events with the moment they happened; any date
 * after that moment shows their consequences (run over one of the twin pines in 1955 and in
 * 1985 the mall is the Lone Pine Mall).
 */
import { localToUtc } from '../astro.js';

const T = (y, mo = 1, d = 1, h = 0, mi = 0) => localToUtc({ y, mo, d, h, mi });

export const MILESTONES = {
  townFounded: T(1850),
  courthouseBuilt: T(1885, 9, 5, 8, 0),
  clockStarted: T(1885, 9, 5, 8, 0),
  lightning: T(1955, 11, 12, 22, 4),
  pinesPlanted: T(1945, 3, 1),
  farmSold: T(1977, 6, 1),
  mallOpened: T(1979, 8, 1),
};

export class Timeline {
  constructor() {
    this.changes = [];          // { at (utc ms), kind, ... }
  }

  /** Records something the traveller did at a moment (utc ms). */
  change(at, kind, data = {}) {
    this.changes.push({ at, kind, ...data });
    this.changes.sort((a, b) => a.at - b.at);
  }

  _changed(kind, before, filter = () => true) { return this.changes.some((c) => c.kind === kind && c.at <= before && filter(c)); }

  /** What the world is like at a moment (utc ms, with the local year for convenience). */
  at(utc, year) {
    const era = year < 1850 ? 'wild' : year < 1885 ? 'settlement' : year < 1905 ? 'frontier' : year < 1966 ? 'classic' : year < 2000 ? 'decline' : 'future';
    const M = MILESTONES;
    // the courthouse and its clock
    let courthouse = 'none';
    if (utc >= M.courthouseBuilt) courthouse = 'built';
    else if (year === 1885 || (year === 1884 && utc >= T(1884, 6))) courthouse = 'building';
    let clock = 'none';
    if (utc >= M.clockStarted) clock = this._changed('lightningAverted', utc) || utc < M.lightning ? 'running' : 'stopped';
    // the twin pines and the farm / the mall
    const pines = [0, 1].map((i) => utc >= M.pinesPlanted && !this._changed('pineDown', utc, (c) => c.pine === i));
    const pinesAt1979 = [0, 1].filter((i) => !this._changed('pineDown', M.mallOpened, (c) => c.pine === i)).length;
    let farm = utc >= T(1905) && utc < M.farmSold;
    let mall = null;
    if (utc >= M.mallOpened) mall = pinesAt1979 === 2 ? 'Twin Pines' : pinesAt1979 === 1 ? 'Lone Pine' : 'No Pines';
    // the night sky's glow over the town: none, oil lamps, the electric age, sodium lights
    const glow = year < 1885 ? 0 : year < 1920 ? 0.08 : year < 1960 ? 0.45 : year < 2010 ? 1.0 : 0.75;
    return { era, year, courthouse, clock, pines, farm, mall, glow, paved: year >= 1920, lamps: year >= 1910 ? (year >= 1965 ? 'sodium' : 'incandescent') : year >= 1885 ? 'gas' : 'none' };
  }
}
