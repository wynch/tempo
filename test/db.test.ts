import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atMinute } from '../src/model/dates.ts';
import { Db, emptyData, MemoryPersistence, validate, type Change } from '../src/store/db.ts';
import { seed } from '../src/store/seed.ts';

const NOW = new Date(2026, 10, 18, 17, 40);
const open = () => Db.open(new MemoryPersistence(), () => seed(NOW));

test('a first run is seeded, a second one is not', async () => {
  const store = new MemoryPersistence();
  const a = await Db.open(store, () => seed(NOW));
  assert.equal(a.counters.length, 5);
  const b = await Db.open(store, () => { throw new Error('must not seed again'); });
  assert.equal(b.tickCount, a.tickCount);
});

test('adding and removing a tick touches exactly its day', async () => {
  const db = await open(), seen: Change[] = [];
  db.onChange(c => seen.push(c));
  const n = db.ticksOn('2026-11-18').length;
  const t = db.addTick({ counterId: 'water', at: atMinute('2026-11-18', 17 * 60) });
  assert.equal(db.ticksOn('2026-11-18').length, n + 1);
  db.removeTick(t.id);
  assert.equal(db.ticksOn('2026-11-18').length, n);
  assert.deepEqual(seen, [{ days: ['2026-11-18'] }, { days: ['2026-11-18'] }]);
});

test('an export can be imported back whole', async () => {
  const a = await open();
  a.addTick({ counterId: 'meds', at: atMinute('2026-11-18', 9 * 60) });
  const file: unknown = JSON.parse(JSON.stringify(a.export()));
  const b = await Db.open(new MemoryPersistence());
  assert.equal(b.counters.length, 0);
  await b.import(file);
  assert.equal(b.tickCount, a.tickCount);
  assert.deepEqual(b.counters.map(c => c.id), a.counters.map(c => c.id));
  assert.deepEqual(b.export().ticks, a.export().ticks);
});

test('a file that is not a Tempo export is refused and changes nothing', async () => {
  const db = await open(), n = db.tickCount;
  await assert.rejects(db.import({ hello: 'world' }), /not a Tempo export/);
  await assert.rejects(db.import({ format: 'tempo', version: 2 }), /newer version/);
  const broken = db.export() as unknown as { ticks: { counterId: string }[] };
  const bad = JSON.parse(JSON.stringify(broken)) as typeof broken;
  bad.ticks[0]!.counterId = 'nobody';
  assert.throws(() => validate(bad), /Entry 1 of "ticks"/);
  assert.equal(db.tickCount, n);
});

test('changing a rhythm starts today and leaves the past as it was', async () => {
  const db = await open(), seen: Change[] = [];
  db.onChange(c => seen.push(c));
  db.setPlan('gym', { level: 'week', target: 3, clock: 'calendar' }, '2026-11-18');
  const gym = db.plans.filter(p => p.counterId === 'gym');
  assert.equal(gym.length, 2);
  assert.equal(gym.find(p => p.level === 'day')!.until, '2026-11-17');
  assert.equal(db.openPlan('gym')!.from, '2026-11-18');
  db.setPlan('gym', { level: 'week', target: 3, clock: 'calendar' }, '2026-11-18');
  assert.equal(db.plans.filter(p => p.counterId === 'gym').length, 2, 'the same rhythm again changes nothing');
  db.setPlan('gym', null, '2026-11-18');
  assert.equal(db.openPlan('gym'), undefined);
  assert.equal(db.plans.filter(p => p.counterId === 'gym').length, 1, 'a plan that never ran a full day is dropped');
  assert.deepEqual(seen, [{ all: true }, { all: true }]);
});

test('a counter can be added, changed and deleted with its history', async () => {
  const db = await open(), n = db.tickCount;
  db.saveCounter({ id: 'read', name: 'Read', color: 'amber', measure: 'count', intent: 'do', unit: 'page', order: 9, createdAt: 1 });
  assert.equal(db.counters.at(-1)!.id, 'read');
  db.saveCounter({ ...db.counters.at(-1)!, name: 'Reading' });
  assert.equal(db.counters.length, 6);
  const water = db.export().ticks.filter(t => t.counterId === 'water').length;
  db.deleteCounter('water');
  assert.equal(db.tickCount, n - water);
  assert.ok(db.plans.every(p => p.counterId !== 'water'));
  assert.ok(db.ticksOn('2026-11-10').every(t => t.counterId !== 'water'));
  validate(JSON.parse(JSON.stringify(db.export())));
});

test('an emptied database stays empty when reopened', async () => {
  const store = new MemoryPersistence();
  const a = await Db.open(store, () => seed(NOW));
  await a.replace(emptyData());
  const b = await Db.open(store, () => { throw new Error('must not seed again'); });
  assert.equal(b.counters.length, 0);
});

test('placements toggle, travel with an export, and go with their counter', async () => {
  const db = await open(), seen: Change[] = [];
  db.onChange(c => seen.push(c));
  assert.equal(db.togglePlacement('gym', '2026-11-19'), true);
  assert.equal(db.togglePlacement('gym', '2026-11-21'), true);
  assert.equal(db.togglePlacement('gym', '2026-11-19'), false, 'a second drop on the same day unpins it');
  assert.deepEqual(db.placements.map(p => p.day), ['2026-11-21']);
  assert.deepEqual(seen.at(-1), { days: ['2026-11-19'] });

  const copy = await Db.open(new MemoryPersistence());
  await copy.import(JSON.parse(JSON.stringify(db.export())));
  assert.deepEqual(copy.placements.map(p => p.day), ['2026-11-21']);

  const old = JSON.parse(JSON.stringify(db.export())) as { placements?: unknown };
  delete old.placements;
  assert.deepEqual(validate(old).placements, [], 'an export from before placements still loads');

  db.deleteCounter('gym');
  assert.equal(db.placements.length, 0);
});
