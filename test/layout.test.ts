import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDay } from '../src/model/derive.ts';
import { keyOfMs } from '../src/model/dates.ts';
import { HEAD, layout, rulerId, TITLE, type LayoutInput } from '../src/engine/layout.ts';
import { buildYear } from '../src/engine/tree.ts';
import { seed } from '../src/store/seed.ts';

const NOW = new Date(2026, 10, 18, 17, 40), data = seed(NOW);
const byDay = new Map<string, typeof data.ticks>();
data.ticks.forEach(t => { const k = keyOfMs(t.at); byDay.set(k, [...(byDay.get(k) ?? []), t]); });
const tree = buildYear(2026, '2026-11-18', key =>
  buildDay({ counters: data.counters, plans: data.plans, settings: data.settings, todayKey: '2026-11-18', ticksOn: k => byDay.get(k) ?? [] }, key));
const today = tree.today!;
const W = 430, H = 860, A = H - HEAD;
type Focus = [number, number, number, number, number];      // month, week, day, part of day, item
const at = (z: number, f: Focus = [10, 3, 2, 2, 0]): LayoutInput => ({ z, f, W, H, cur: () => null });
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 0.01, msg + ': ' + a + ' vs ' + b);

test('the tree: twelve months, whole weeks, one today', () => {
  assert.equal(tree.root.kids.length, 12);
  tree.root.kids.forEach(m => m.kids.forEach(w => assert.equal(w.kids.length, 7)));
  assert.equal(today.key, '2026-11-18');
  assert.equal(today.out, false);
  const nov = tree.root.kids[10]!, w44 = nov.kids[0]!;
  assert.deepEqual(w44.kids.map(d => d.out), [true, true, true, true, true, true, false]);   // only Sunday 1 is November's
  assert.equal(w44.twinPrev, tree.root.kids[9]!.kids.at(-1));
  assert.equal(tree.daysByKey.get('2026-10-31')!.length, 2);
  assert.equal(tree.daysByKey.get('2026-11-18')!.length, 1);
});

test('a tree for another year has no today, and its edge weeks reach into the next year', () => {
  const y25 = buildYear(2025, '2026-11-18', key =>
    buildDay({ counters: data.counters, plans: data.plans, settings: data.settings, todayKey: '2026-11-18', ticksOn: () => [] }, key));
  assert.equal(y25.today, undefined);
  const last = y25.root.kids[11]!.kids.at(-1)!;
  assert.deepEqual(last.kids.map(d => d.key).slice(-4), ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  assert.ok(Object.values(layout(y25.root, at(0, [0, 0, 0, 0, 0]))).every(b => Number.isFinite(b.h)));
});

test('every depth and every slide gives finite numbers', () => {
  const focuses: Focus[] = [[10, 3, 2, 2, 0], [10, 3, 2.5, 1, 0], [10, 2.5, 2, 0, 0], [9.5, 3, 2, 0, 0], [10, 3, 2, 1.5, 0], [10, 3, 2, 0, 0.5], [0, 0, 0, 0, 0], [11, 4, 6, 1, 1]];
  for (let z = 0; z <= 5.001; z += 0.125) for (const f of focuses) {
    const L = layout(tree.root, at(z, f));
    for (const [id, b] of Object.entries(L)) for (const [k, v] of Object.entries(b)) assert.ok(Number.isFinite(v), `${id}.${k} at z=${z} f=${f}`);
  }
});

test('at rest, the open cell fills the surface and its rows tile it', () => {
  const year = layout(tree.root, at(0));
  const months = tree.root.kids.map(m => year[m.id]!);
  near(months[0]!.y, 0, 'first month at the top');
  near(months.reduce((a, b) => a + b.h, 0), A - TITLE, 'months fill the year');

  const week = layout(tree.root, at(2));
  const wk = today.parent!, days = wk.kids.map(d => week[d.id]!);
  near(week[wk.id]!.h, A, 'the week fills the surface');
  days.forEach((d, i) => { if (i) near(d.y, days[i - 1]!.y + days[i - 1]!.h, 'days are stacked without gaps'); });
  near(days.reduce((a, b) => a + b.h, 0), A - TITLE, 'days fill the week');

  const day = layout(tree.root, at(3));
  near(day[today.id]!.h, A, 'the day fills the surface');
  const rows = today.items.map(it => day[it.id]!);
  rows.forEach((r, i) => { assert.equal(r.r, 1); if (i) assert.ok(r.y >= rows[i - 1]!.y + rows[i - 1]!.h, 'item rows do not overlap'); });
});

test('travel comes before unfold: children are never wide while still on the move', () => {
  for (let z = 2.05; z < 3; z += 0.05) {
    const L = layout(tree.root, at(z)), d = L[today.id]!;
    today.items.forEach(it => { const b = L[it.id]!; if (d.pa < 0.9) assert.ok(b.w < 40, `item still a mark at z=${z.toFixed(2)}`); });
  }
});

test('a slide between neighbours keeps both cells fully open', () => {
  const L = layout(tree.root, at(3, [10, 3, 2.5, 0, 0])), wk = today.parent!;
  assert.equal(L[wk.kids[2]!.id]!.m, 1);
  assert.equal(L[wk.kids[3]!.id]!.m, 1);
  near(L[wk.kids[3]!.id]!.y, L[wk.kids[2]!.id]!.y + L[wk.kids[2]!.id]!.h, 'the two pages touch');
});

test('part of day is a stop of its own between the day and an item', () => {
  // Wednesday 18 November has All day, Morning, Afternoon (the gym) and Evening
  assert.deepEqual(today.parts.map(p => p.name), ['All day', 'Morning', 'Afternoon', 'Evening']);
  const afternoon = today.parts[2]!, gym = afternoon.items[0]!;
  assert.equal(gym.model.counter.id, 'gym');
  assert.equal(gym.parent, afternoon);

  const day = layout(tree.root, at(3)), part = layout(tree.root, at(4)), item = layout(tree.root, at(5));
  // at the day, the headings are stacked with their rows and nothing is zoomed
  assert.ok(day[afternoon.id]!.y > day[today.parts[1]!.id]!.y);
  assert.equal(day[afternoon.id]!.m, 0);
  // at the part, its heading is the title at the top, its rows sit under it, and the next part is off screen
  near(part[afternoon.id]!.y, 0, 'the open part starts at the top');
  assert.equal(part[afternoon.id]!.m, 1);
  near(part[gym.id]!.y, part[afternoon.id]!.h, 'its first row sits under the title');
  near(part[gym.id]!.h, day[gym.id]!.h, 'rows keep their size: the part gains room, the rows do not stretch');
  assert.ok(part[today.parts[3]!.id]!.y >= A, 'the following part has slid off');
  // at the item, it fills the day
  near(item[gym.id]!.y, 0, 'the open item starts at the top');
  near(item[gym.id]!.h, A, 'and fills the surface');
});

test('sliding between two parts keeps their headings in order and their rows attached', () => {
  const L = layout(tree.root, at(4, [10, 3, 2, 1.5, 0])), a = today.parts[1]!, b = today.parts[2]!;
  assert.ok(L[a.id]!.y < L[b.id]!.y);
  assert.ok(L[b.items[0]!.id]!.y >= L[b.id]!.y + L[b.id]!.h - 0.01, 'a row never rides above its own heading');
});

test('an open part has an hour ruler in the room under its rows, and only then', () => {
  const afternoon = today.parts[2]!, gym = afternoon.items[0]!;
  assert.equal(layout(tree.root, at(3))[rulerId(afternoon)], undefined, 'no ruler in the day view');
  const L = layout(tree.root, at(4)), r = L[rulerId(afternoon)]!;
  assert.equal(r.o, 1);
  assert.ok(r.y >= L[gym.id]!.y + L[gym.id]!.h, 'it starts under the last row');
  assert.ok(r.y + r.h <= A, 'and ends inside the surface');
  assert.ok(r.h > 300, 'with real room: ' + r.h);
  assert.equal(L[rulerId(today.parts[1]!)], undefined, 'the other parts have none');
  assert.equal(layout(tree.root, at(5))[rulerId(afternoon)]!.o, 0, 'it is gone once an item is open');
});
