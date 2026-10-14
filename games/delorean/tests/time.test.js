import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimeCircuits, validTime } from '../src/time/timecircuits.js';
import { Timeline, MILESTONES } from '../src/time/timeline.js';
import { localToUtc, utcToLocal, utcOffset, moonPosition, sunPosition } from '../src/astro.js';

const at = (y, mo, d, h, mi) => localToUtc({ y, mo, d, h, mi });

test('keypad: typing 11 05 1955 06 00 sets the destination', () => {
  const tc = new TimeCircuits({ presentUtc: at(1985, 10, 26, 1, 20) });
  assert.equal(tc.key('1'), false, 'off: the keys do nothing');
  tc.toggle(true);
  for (const k of '110519550600') tc.key(k);
  assert.deepEqual(tc.destination, { mo: 11, d: 5, y: 1955, h: 6, mi: 0 });
  assert.ok(tc.armed);
});

test('keypad: a bad date is refused, a short entry needs the set key', () => {
  const tc = new TimeCircuits({ presentUtc: at(1985, 10, 26, 1, 20) });
  tc.toggle(true);
  for (const k of '023019550600') tc.key(k);       // 30 February
  assert.equal(tc.destination, null);
  assert.ok(tc.entryError > 0);
  tc.tick(2);
  for (const k of '07041776') tc.key(k);
  assert.equal(tc.destination, null);
  tc.key('enter');
  assert.deepEqual(tc.destination, { mo: 7, d: 4, y: 1776, h: 0, mi: 0 });
  assert.ok(validTime({ y: 0, mo: 12, d: 25, h: 0, mi: 0 }), 'the display can show year 0000');
});

test('88 mph: the present becomes the destination, last departed the moment left; the chamber is spent', () => {
  const tc = new TimeCircuits({ presentUtc: at(1985, 10, 26, 1, 35) });
  tc.toggle(true);
  tc.setDestination({ y: 1955, mo: 11, d: 5, h: 6, mi: 0 });
  const arrive = tc.displace();
  assert.deepEqual(utcToLocal(arrive).y, 1955);
  assert.deepEqual(tc.lastDeparted, { y: 1985, mo: 10, d: 26, h: 1, mi: 35 });
  assert.equal(tc.present.h, 6);
  assert.equal(tc.powered, false, 'no plutonium for the trip back');
  assert.equal(tc.armed, false);
});

test('the clocks: daylight time in October 1985, standard time in November 1955', () => {
  assert.equal(utcOffset(1985, 10, 26, 1), -7);    // DST ended on 27 October 1985
  assert.equal(utcOffset(1955, 11, 5, 6), -8);
  assert.equal(utcOffset(2015, 10, 21, 16), -7);
  const t = utcToLocal(at(1955, 11, 12, 22, 4));
  assert.deepEqual([t.y, t.mo, t.d, t.h, t.mi], [1955, 11, 12, 22, 4]);
});

test('the sky: night at the mall, dawn at the farm, a nearly full moon in October 1985', () => {
  const s85 = sunPosition(at(1985, 10, 26, 1, 20));
  assert.ok(s85.elevation < -40);
  const s55 = sunPosition(at(1955, 11, 5, 6, 0));
  assert.ok(s55.elevation < 0 && s55.elevation > -12, `dawn: sun at ${s55.elevation}`);
  const m = moonPosition(at(1985, 10, 26, 1, 20));
  assert.ok(m.phase > 0.85, `moon phase ${m.phase}`);   // full moon on 28 October 1985
});

test('the timeline: the clock stops at 10:04 PM; run over a pine and the mall is the Lone Pine Mall', () => {
  const tl = new Timeline();
  assert.equal(tl.at(at(1955, 11, 12, 22, 0), 1955).clock, 'running');
  assert.equal(tl.at(at(1955, 11, 12, 22, 5), 1955).clock, 'stopped');
  assert.equal(tl.at(at(1885, 9, 2, 8, 0), 1885).clock, 'none');
  assert.equal(tl.at(at(1985, 10, 26, 1, 20), 1985).mall, 'Twin Pines');
  tl.change(at(1955, 11, 5, 6, 1), 'pineDown', { pine: 0 });
  assert.equal(tl.at(at(1985, 10, 26, 1, 20), 1985).mall, 'Lone Pine');
  assert.deepEqual(tl.at(at(1955, 11, 5, 6, 0), 1955).pines, [true, true], 'before the crash both stand');
  assert.ok(MILESTONES.lightning > MILESTONES.pinesPlanted);
});
