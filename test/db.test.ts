import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atMinute } from '../src/model/dates.ts';
import { Db, MemoryPersistence, validate, type Change } from '../src/store/db.ts';
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
