import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, atMinute, dayKey, dayOfYear, daysInMonth, daysInYear, isoWeek, keyOfMs, mondayOf, parseKey, weekday } from '../src/model/dates.ts';

test('day keys round-trip through local dates', () => {
  assert.equal(dayKey(new Date(2026, 10, 18)), '2026-11-18');
  assert.equal(dayKey(parseKey('2026-01-05')), '2026-01-05');
  assert.equal(keyOfMs(atMinute('2026-11-18', 17 * 60 + 40)), '2026-11-18');
  assert.equal(dayKey(addDays(new Date(2026, 11, 31), 1)), '2027-01-01');
});

test('weekdays start on Monday', () => {
  assert.equal(weekday(new Date(2026, 10, 16)), 0);   // a Monday
  assert.equal(weekday(new Date(2026, 10, 22)), 6);   // a Sunday
  assert.equal(dayKey(mondayOf(new Date(2026, 10, 18))), '2026-11-16');
});

test('ISO weeks, including the edges of the year', () => {
  assert.deepEqual(isoWeek(new Date(2026, 10, 18)), { year: 2026, week: 47 });
  assert.deepEqual(isoWeek(new Date(2026, 0, 1)), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek(new Date(2025, 11, 29)), { year: 2026, week: 1 });   // Monday of week 1 is in the year before
  assert.deepEqual(isoWeek(new Date(2026, 11, 31)), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek(new Date(2027, 0, 3)), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek(new Date(2027, 0, 4)), { year: 2027, week: 1 });
});

test('lengths of months and years', () => {
  assert.equal(daysInMonth(2026, 1), 28);
  assert.equal(daysInMonth(2028, 1), 29);
  assert.equal(daysInYear(2026), 365);
  assert.equal(daysInYear(2028), 366);
  assert.equal(dayOfYear(new Date(2026, 10, 18)), 322);
});
