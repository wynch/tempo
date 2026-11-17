import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDay, flatten, monthSummary, partAt, step5, type DeriveInput } from '../src/model/derive.ts';
import { atMinute, keyOfMs } from '../src/model/dates.ts';
import type { DbData, Tick } from '../src/model/types.ts';
import { seed } from '../src/store/seed.ts';

const NOW = new Date(2026, 10, 18, 17, 40);   // Wednesday 18 November 2026, 17:40
const data: DbData = seed(NOW);
const input = (extra: Tick[] = []): DeriveInput => {
  const ticks = [...data.ticks, ...extra];
  return { counters: data.counters, plans: data.plans, settings: data.settings, todayKey: '2026-11-18',
           ticksOn: key => ticks.filter(t => keyOfMs(t.at) === key) };
};
const item = (key: string, id: string, extra: Tick[] = []) => buildDay(input(extra), key).items.find(it => it.counter.id === id);

test('the sample data never reaches into the future', () => {
  assert.ok(data.ticks.length > 3000);
  assert.ok(data.ticks.every(t => t.at <= NOW.getTime()));
});

test('a plan decides which days a counter shows on', () => {
  assert.ok(item('2026-11-16', 'gym'), 'gym on a Monday');
  assert.equal(item('2026-11-17', 'gym'), undefined, 'no gym on a Tuesday');
  assert.ok(item('2026-11-20', 'gym'), 'gym planned on a future Friday');
  assert.equal(item('2026-11-20', 'cig'), undefined, 'nothing to avoid is listed on a future day');
  assert.ok(item('2026-11-18', 'cig'), 'but it is there today, to log against');
});

test('items carry their kind, count and steps', () => {
  const water = item('2026-11-18', 'water')!;
  assert.equal(water.kind, 'count');
  assert.equal(water.target, 8);
  assert.equal(water.steps.length, Math.max(8, water.n));
  assert.equal(water.steps.filter(s => s.tickId).length, water.n);
  const gym = item('2026-11-18', 'gym')!;
  assert.equal(gym.kind, 'session');
  assert.equal(gym.steps.length, 13);
  assert.equal(gym.seconds, 480);
  assert.equal(gym.part, 2, 'afternoon');
});

test('a tick changes the day it falls on, and only the reading of it', () => {
  const before = item('2026-11-18', 'stretch')!;
  const tick: Tick = { id: 'x', counterId: 'stretch', at: atMinute('2026-11-18', 17 * 60) };
  const after = item('2026-11-18', 'stretch', before.done ? [] : [tick])!;
  assert.equal(after.done, true);
  assert.equal(after.missed, false);
});

test('missed applies to past days only, never to counts', () => {
  const day = buildDay(input(), '2026-11-10');
  day.items.forEach(it => { if (it.missed) assert.ok(it.kind === 'check' || it.kind === 'session'); });
  assert.ok(buildDay(input(), '2026-11-19').items.every(it => !it.missed));
});

test('day values: null in the future, a score in the past', () => {
  const past = buildDay(input(), '2026-11-10'), future = buildDay(input(), '2026-11-25');
  assert.ok(past.vals.all! > 0 && past.vals.all! <= 1);
  assert.equal(future.vals.water, undefined);
  assert.equal(future.vals.all, 0);
});

test('month totals follow the filter', () => {
  const days = Array.from({ length: 18 }, (_, i) => buildDay(input(), '2026-11-' + String(i + 1).padStart(2, '0')));
  assert.match(monthSummary(days, 'all', data.counters), /^\d+%$/);
  assert.match(monthSummary(days, 'cig', data.counters), /^\d+$/);
  assert.match(monthSummary(days, 'water', data.counters), /^\d+\.\d$/);
  assert.match(monthSummary(days, 'gym', data.counters), /^\d+\/8$/);   // 8 Mondays, Wednesdays and Fridays up to the 18th
  assert.equal(monthSummary([buildDay(input(), '2026-12-05')], 'all', data.counters), '');
});

test('small helpers', () => {
  assert.equal(flatten(data.counters.find(c => c.id === 'gym')!.sequence!).length, 13);
  assert.deepEqual([null, 0, 0.1, 0.3, 0.6, 0.9].map(step5), [0, 0, 0.22, 0.45, 0.7, 1]);
  assert.deepEqual([0, 6 * 60, 13 * 60, 20 * 60].map(m => partAt(data.settings, m)), [0, 1, 2, 3]);
});
