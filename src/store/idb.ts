// Persistence in the browser's IndexedDB: one object store per record kind, plus one for settings.

import type { Counter, DbData, Id, Plan, Settings, Tick } from '../model/types.ts';
import { DEFAULT_SETTINGS, type Persistence, type RecordKind } from './db.ts';

const NAME = 'tempo', VERSION = 1;
const STORES: Record<RecordKind, string> = { counter: 'counters', plan: 'plans', tick: 'ticks' };

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

export class IdbPersistence implements Persistence {
  private db: IDBDatabase;
  private constructor(db: IDBDatabase) { this.db = db; }

  static async open(): Promise<IdbPersistence> {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      Object.values(STORES).forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    return new IdbPersistence(await done(req));
  }

  async load(): Promise<DbData | null> {
    const tx = this.db.transaction([...Object.values(STORES), 'meta'], 'readonly');
    const [counters, plans, ticks, settings] = await Promise.all([
      done(tx.objectStore('counters').getAll() as IDBRequest<Counter[]>),
      done(tx.objectStore('plans').getAll() as IDBRequest<Plan[]>),
      done(tx.objectStore('ticks').getAll() as IDBRequest<Tick[]>),
      done(tx.objectStore('meta').get('settings') as IDBRequest<Settings | undefined>),
    ]);
    if (!counters.length && !ticks.length) return null;
    return { format: 'tempo', version: 1, counters, plans, ticks, settings: settings ?? structuredClone(DEFAULT_SETTINGS) };
  }

  private write(store: string, fn: (s: IDBObjectStore) => void): void {
    const tx = this.db.transaction(store, 'readwrite');
    fn(tx.objectStore(store));
    tx.onerror = () => console.error('Tempo: could not save to ' + store, tx.error);
  }
  save(kind: RecordKind, record: Counter | Plan | Tick): void { this.write(STORES[kind], s => s.put(record)); }
  remove(kind: RecordKind, id: Id): void { this.write(STORES[kind], s => s.delete(id)); }
  saveSettings(settings: Settings): void { this.write('meta', s => s.put(settings, 'settings')); }

  async replaceAll(data: DbData): Promise<void> {
    const tx = this.db.transaction([...Object.values(STORES), 'meta'], 'readwrite');
    const fill = (name: string, records: { id: Id }[]): void => {
      const s = tx.objectStore(name);
      s.clear(); records.forEach(r => s.put(r));
    };
    fill('counters', data.counters); fill('plans', data.plans); fill('ticks', data.ticks);
    tx.objectStore('meta').put(data.settings, 'settings');
    await finished(tx);
  }
}
