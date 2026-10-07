/**
 * The year as it happened, and the calendar of the town.
 *
 * What everyone knows at the start (late September 1403), what news comes
 * in as the weeks pass (a few days after the event, the time a messenger
 * or a carter takes from Prague or Vienna), and the feasts and term days
 * that rule the year: rents fall due on St Gall's day (16 October) and St
 * George's day (24 April), fasts on Fridays and in Advent, the great feasts
 * kept as holy days. Dates are Julian, as used in 1403.
 */
import { START_DATE, weekday } from './data.js';

/** Game hour of a date in 1403 (or early 1404) at hour h. */
export function tOf(m, d, h = 12, y = 1403) {
  const a = Date.UTC(START_DATE.y, START_DATE.m - 1, START_DATE.d), b = Date.UTC(y, m - 1, d);
  return Math.round((b - a) / 864e5) * 24 + h;
}

/** Known to all at the start. */
export const BACKGROUND = [
  'King Wenceslas IV was seized by his brother Sigismund, King of Hungary, at the end of June 1402 and has been held in Vienna since August.',
  'Last winter Sigismund\'s army, many of them Cumans, took Kutná Hora and the country round it, plundering and levying taxes; in the spring they raided widely. After the truce ran out in late May Sigismund could gain nothing more and withdrew. The burned villages and the masterless soldiers they left behind remain, and nobody knows if they will come back.',
  'The lords quarrel among themselves; robber bands of former soldiers haunt the roads.',
  'On 28 May the masters of the Prague university condemned forty-five articles of the Englishman Wyclif; Master Jan Hus goes on preaching in Czech at the Bethlehem Chapel against the sins of the clergy.',
  'The Prague groschen (12 parvi; 60 groschen make a kopa) is not what it was.',
];

/** News that reaches Skalice as the weeks pass: date of the event, days for word to arrive. */
export const NEWS = [
  { m: 10, d: 1, arrive: 6, text: 'Word from Prague: the Pope, Boniface IX, has recognised that King Wenceslas is deposed as King of the Romans. Sigismund\'s friends are glad of it; the king\'s men curse Rome.' },
  { m: 10, d: 24, arrive: 4, text: 'Carters say the king is no longer closely guarded in Vienna, and that his friends among the lords are stirring.' },
  { m: 11, d: 11, arrive: 4, text: 'The king is free! King Wenceslas got away from Vienna on St Martin\'s day, crossed the Danube and came home through Mikulov. There will be a reckoning with those who sided with Sigismund.' },
];

/** Feasts and term days. holy: no work (kept as a Sunday). */
export const CALENDAR = [
  { m: 9, d: 28, name: 'the feast of St Wenceslas', holy: true, text: 'Patron of the land: Mass, a fair, and the joust in the field.' },
  { m: 9, d: 29, name: 'St Michael\'s day (Michaelmas)', holy: true, text: 'Feast of the archangel; servants\' terms begin and end about now.' },
  { m: 10, d: 16, name: 'St Gall\'s day (sv. Havel)', text: 'The half-year rent is due to the lord, as on St George\'s day in spring; the headman collects, and those who cannot pay must beg time or lose a beast.' },
  { m: 10, d: 28, name: 'Sts Simon and Jude', text: 'Autumn sowing should be done by now.' },
  { m: 11, d: 1, name: 'All Saints', holy: true, text: 'A holy day of obligation.' },
  { m: 11, d: 2, name: 'All Souls', text: 'Prayers and candles for the dead in the churchyard.' },
  { m: 11, d: 11, name: 'St Martin\'s day', text: 'New wine is tasted and geese are eaten; servants change masters; another term for dues.' },
  { m: 11, d: 25, name: 'St Catherine', text: 'The last dances before Advent.' },
  { m: 12, d: 6, name: 'St Nicholas', text: 'Gifts for children.' },
  { m: 12, d: 25, name: 'Christmas', holy: true, text: 'The Nativity; the Advent fast ends.' },
  { m: 12, d: 26, name: 'St Stephen', holy: true, text: 'Servants\' wages are paid and new service begins.' },
];

/** Holy days as 'm-d'. */
export const HOLY = new Set(CALENDAR.filter((c) => c.holy).map((c) => `${c.m}-${c.d}`));

/** Advent 1403 begins on the Sunday nearest St Andrew (30 November). */
export function adventStart(y = 1403) {
  for (let off = -3; off <= 3; off++) { const d = 30 + off, m = d > 30 ? 12 : 11, dd = d > 30 ? d - 30 : d; if (weekday(y, m, dd) === 0) return tOf(m, dd, 0, y); }
  return tOf(11, 30, 0, y);
}

/** News that has reached the town by game hour t. */
export function newsKnown(t) { return NEWS.filter((n) => tOf(n.m, n.d) + n.arrive * 24 <= t); }

/** The coming feasts and term days, within `days`. */
export function calendarAhead(t, days = 12) {
  return CALENDAR.filter((c) => { const at = tOf(c.m, c.d, 0); return at + 24 > t && at < t + days * 24; }).map((c) => ({ ...c, inDays: Math.max(0, Math.floor((tOf(c.m, c.d, 0) - t) / 24)) }));
}

/** A paragraph for prompts: the year so far, the latest news, the calendar ahead. */
export function worldText(t) {
  const news = newsKnown(t).map((n) => n.text);
  const cal = calendarAhead(t).map((c) => `${c.inDays === 0 ? 'today' : c.inDays === 1 ? 'tomorrow' : `in ${c.inDays} days`}: ${c.name} (${c.text})`);
  const advent = t >= adventStart() ? ' It is Advent: a time of fasting until Christmas.' : '';
  return `${BACKGROUND.join(' ')}${news.length ? ` Latest news to reach the town: ${news.join(' ')}` : ''}${cal.length ? ` Coming days: ${cal.join('; ')}.` : ''}${advent} You know nothing of anything after today.`;
}
