/**
 * The time circuits: three displays (destination, present, last time departed), the keypad,
 * the switch, and the rule of the machine: with the circuits on, a destination set and 1.21
 * gigawatts at the flux capacitor, reaching 88 miles per hour displaces the car to the
 * destination time, at the same place. The present time display then shows the destination,
 * and last time departed the moment it left.
 *
 * Keypad entry, as on the prop: the digits fill the destination display field by field,
 * month (2), day (2), year (4), hour (2, 0-23), minute (2); a complete, valid entry is set.
 * The blank key at the lower left clears, the one at the lower right sets a shorter entry
 * (a date alone means midnight; a date and hour, on the hour).
 *
 * Power: the plutonium chamber holds one charge (a jump empties it); Mr. Fusion (Part II)
 * makes a charge from household waste; a bolt of lightning delivers 1.21 GW once, if it
 * strikes the hook on the pole while the car passes at 88.
 *
 * Times are local Hill Valley times { y, mo, d, h, mi } (see astro.js).
 */
import { daysInMonth, localToUtc, utcToLocal } from '../astro.js';

export const GIGAWATTS = 1.21;
export const TRIGGER_MPH = 88;

export function validTime(t) {
  if (!t) return false;
  const { y, mo, d, h, mi } = t;
  return Number.isInteger(y) && y >= 0 && y <= 9999 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo) && h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}

export function sameMinute(a, b) { return a && b && a.y === b.y && a.mo === b.mo && a.d === b.d && a.h === b.h && a.mi === b.mi; }

export class TimeCircuits {
  constructor({ presentUtc, destination = null, lastDeparted = null, power = 'plutonium', charges = 1 } = {}) {
    this.on = false;
    this.presentUtc = presentUtc;          // the world's clock (ms UTC), advanced by the game
    this.destination = destination;
    this.lastDeparted = lastDeparted;
    this.power = power;                    // 'plutonium' | 'fusion'
    this.charge = charges > 0 ? 1 : 0;     // the chamber: 1 loaded, 0 empty
    this.spare = Math.max(0, charges - 1); // pellets in Doc's case
    this.buffer = '';                      // digits typed so far
    this.entryError = 0;                   // seconds the display flashes a bad entry
    this.lightning = 0;                    // a bolt's charge waiting (seconds left)
    this.events = [];
  }

  get present() { return utcToLocal(this.presentUtc); }

  /** Is there 1.21 GW at the flux capacitor? */
  get powered() { return this.charge > 0 || this.lightning > 0; }

  /** Everything ready but the speed. */
  get armed() { return this.on && !!this.destination && this.powered && this.entryError <= 0 && !this.buffer; }

  toggle(on = !this.on) { this.on = on; this.events.push({ type: on ? 'on' : 'off' }); return on; }

  /** A key on the keypad: '0'..'9', 'clear', 'enter'. */
  key(k) {
    if (!this.on) return false;
    this.events.push({ type: 'key', key: k });
    if (k === 'clear') { this.buffer = ''; return true; }
    if (k === 'enter') return this._commit(true);
    if (!/^[0-9]$/.test(k)) return false;
    if (this.buffer.length < 12) this.buffer += k;
    if (this.buffer.length === 12) return this._commit(false);
    return true;
  }

  /** The destination as the display shows it while typing: typed fields over the old ones. */
  shownDestination() {
    const b = this.buffer;
    if (!b) return this.destination;
    const base = this.destination ?? { y: 0, mo: 1, d: 1, h: 0, mi: 0 };
    const f = (i, n, dflt) => (b.length >= i + n ? Number(b.slice(i, i + n)) : dflt);
    return { mo: f(0, 2, base.mo), d: f(2, 2, base.d), y: f(4, 4, base.y), h: f(8, 2, base.h), mi: f(10, 2, base.mi), partial: b.length };
  }

  _commit(short) {
    const b = this.buffer;
    if (short && b.length < 8) { this._bad(); return false; }
    const t = { mo: Number(b.slice(0, 2)), d: Number(b.slice(2, 4)), y: Number(b.slice(4, 8)), h: b.length >= 10 ? Number(b.slice(8, 10)) : 0, mi: b.length >= 12 ? Number(b.slice(10, 12)) : 0 };
    if (!validTime(t)) { this._bad(); return false; }
    this.destination = t;
    this.buffer = '';
    this.events.push({ type: 'set', destination: t });
    return true;
  }

  _bad() { this.buffer = ''; this.entryError = 1.2; this.events.push({ type: 'error' }); }

  /** Sets the destination directly (the famous dates). */
  setDestination(t) { if (validTime(t)) { this.destination = { ...t }; this.buffer = ''; this.events.push({ type: 'set', destination: this.destination }); } }

  /** Loads a plutonium pellet into the chamber (from Doc's case). */
  load() {
    if (this.charge > 0 || this.spare <= 0) return false;
    this.spare--; this.charge = 1; this.events.push({ type: 'load' });
    return true;
  }

  /** Mr. Fusion: a banana peel, the dregs of a beer can... */
  feedFusion() { if (this.power !== 'fusion' || this.charge > 0) return false; this.charge = 1; this.events.push({ type: 'fusion' }); return true; }

  /** Advances the circuits' own timers (not the clock; the game owns it). */
  tick(dt) {
    this.entryError = Math.max(0, this.entryError - dt);
    this.lightning = Math.max(0, this.lightning - dt);
  }

  /**
   * The displacement: called by the game when the car reaches 88 mph armed. Returns the
   * destination's UTC time, and rolls the displays over.
   */
  displace() {
    const now = this.present;
    const dest = this.destination;
    const arrive = localToUtc({ ...dest, s: now.s ?? 0 });
    this.lastDeparted = { y: now.y, mo: now.mo, d: now.d, h: now.h, mi: now.mi };
    if (this.lightning > 0) this.lightning = 0; else this.charge = 0;
    this.presentUtc = arrive;
    this.events.push({ type: 'displaced', from: this.lastDeparted, to: dest });
    return arrive;
  }

  drain() { const e = this.events; this.events = []; return e; }
}

/** Famous destinations, for the quick-set list. */
export const FAMOUS = [
  { label: 'Peabody farm', t: { y: 1955, mo: 11, d: 5, h: 6, mi: 0 }, note: 'Marty\'s first trip: the day Doc thought up the flux capacitor' },
  { label: 'The lightning', t: { y: 1955, mo: 11, d: 12, h: 21, mi: 30 }, note: 'The night of the Enchantment Under the Sea dance; the bolt strikes the clock tower at 10:04 PM' },
  { label: 'Back to 1985', t: { y: 1985, mo: 10, d: 26, h: 1, mi: 24 }, note: 'Ten minutes before Marty left (Twin Pines Mall)' },
  { label: 'The future', t: { y: 2015, mo: 10, d: 21, h: 16, mi: 29 }, note: 'Wednesday, 4:29 PM: the rain stops in five seconds' },
  { label: 'The Old West', t: { y: 1885, mo: 9, d: 2, h: 8, mi: 0 }, note: 'Hill Valley, a frontier town; the courthouse clock not yet hung' },
  { label: 'Birth of Christ', t: { y: 0, mo: 12, d: 25, h: 0, mi: 0 }, note: 'Doc\'s first example on the display' },
  { label: 'Declaration', t: { y: 1776, mo: 7, d: 4, h: 12, mi: 0 }, note: 'Doc\'s other example' },
];
