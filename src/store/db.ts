// The database as the app sees it: all records in memory, every change written through to a
// Persistence (IndexedDB in the browser, memory in tests). The export format is the data itself.

import { keyOfMs } from '../model/dates.ts';
import type { Counter, DayKey, DbData, Id, Plan, Settings, Tick } from '../model/types.ts';
import { newId } from '../util.ts';

export type RecordKind = 'counter' | 'plan' | 'tick';

/** Where records are kept between sessions. Writes are fire-and-forget; load and replaceAll are awaited. */
export interface Persistence {
  load(): Promise<DbData | null>;
  save(kind: RecordKind, record: Counter | Plan | Tick): void;
  remove(kind: RecordKind, id: Id): void;
  saveSettings(settings: Settings): void;
  replaceAll(data: DbData): Promise<void>;
}

export class MemoryPersistence implements Persistence {
  data: DbData | null = null;
  async load(): Promise<DbData | null> { return this.data; }
  save(): void {}
  remove(): void {}
  saveSettings(): void {}
  async replaceAll(data: DbData): Promise<void> { this.data = structuredClone(data); }
}

export const DEFAULT_SETTINGS: Settings = {
  parts: [
    { id: 'morning', name: 'Morning', start: 5 * 60 },
    { id: 'afternoon', name: 'Afternoon', start: 12 * 60 },
    { id: 'evening', name: 'Evening', start: 18 * 60 },
  ],
};

export const emptyData = (): DbData => ({ format: 'tempo', version: 1, counters: [], plans: [], ticks: [], settings: structuredClone(DEFAULT_SETTINGS) });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Checks that something read from a file is a Tempo database. Throws with a plain message if not. */
export function validate(raw: unknown): DbData {
  if (!isObj(raw) || raw.format !== 'tempo') throw new Error('This file is not a Tempo export.');
  if (raw.version !== 1) throw new Error('This export is from a newer version of Tempo (format ' + String(raw.version) + ').');
  const list = (name: string, ok: (r: Record<string, unknown>) => boolean): Record<string, unknown>[] => {
    const a = raw[name];
    if (!Array.isArray(a)) throw new Error('The export has no "' + name + '" list.');
    a.forEach((r, i) => { if (!isObj(r) || !str(r.id) || !ok(r)) throw new Error('Entry ' + (i + 1) + ' of "' + name + '" is not valid.'); });
    return a as Record<string, unknown>[];
  };
  const counters = list('counters', r => str(r.name) && str(r.color) && str(r.measure) && str(r.intent) && num(r.order) && num(r.createdAt));
  const ids = new Set(counters.map(c => c.id));
  const plans = list('plans', r => str(r.counterId) && ids.has(r.counterId) && str(r.level) && num(r.target) && str(r.clock) && str(r.from));
  const ticks = list('ticks', r => str(r.counterId) && ids.has(r.counterId) && num(r.at));
  const s = raw.settings;
  if (!isObj(s) || !Array.isArray(s.parts) || !s.parts.every(p => isObj(p) && str(p.id) && str(p.name) && num(p.start))) {
    throw new Error('The export has no valid settings.');
  }
  return {
    format: 'tempo', version: 1,
    counters: counters as unknown as Counter[], plans: plans as unknown as Plan[], ticks: ticks as unknown as Tick[],
    settings: s as unknown as Settings,
  };
}

/** What a change touched, so views repaint only that. */
export type Change = { days: DayKey[] } | { all: true };

export class Db {
  counters: Counter[] = [];
  plans: Plan[] = [];
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  private ticks = new Map<Id, Tick>();
  private byDay = new Map<DayKey, Tick[]>();
  private listeners: ((c: Change) => void)[] = [];
  private store: Persistence;

  private constructor(store: Persistence) { this.store = store; }

  /** Opens the database; on a first run, fills it with `seed()` if one is given. */
  static async open(store: Persistence, seed?: () => DbData): Promise<Db> {
    const db = new Db(store);
    let data = await store.load();
    if (!data || !data.counters.length) {
      data = seed ? seed() : emptyData();
      await store.replaceAll(data);
    }
    db.adopt(data);
    return db;
  }

  private adopt(data: DbData): void {
    this.counters = [...data.counters].sort((a, b) => a.order - b.order);   // storage hands records back in id order
    this.plans = data.plans; this.settings = data.settings;
    this.ticks.clear(); this.byDay.clear();
    data.ticks.forEach(t => this.index(t));
  }
  private index(t: Tick): void {
    this.ticks.set(t.id, t);
    const key = keyOfMs(t.at), list = this.byDay.get(key);
    if (list) list.push(t); else this.byDay.set(key, [t]);
  }
  private emit(c: Change): void { this.listeners.forEach(fn => fn(c)); }

  onChange(fn: (c: Change) => void): void { this.listeners.push(fn); }
  ticksOn = (key: DayKey): Tick[] => this.byDay.get(key) ?? [];
  get tickCount(): number { return this.ticks.size; }

  addTick(input: Omit<Tick, 'id'>): Tick {
    const t: Tick = { id: newId('t'), ...input };
    this.index(t); this.store.save('tick', t);
    this.emit({ days: [keyOfMs(t.at)] });
    return t;
  }
  removeTick(id: Id): void {
    const t = this.ticks.get(id); if (!t) return;
    const key = keyOfMs(t.at);
    this.ticks.delete(id);
    this.byDay.set(key, this.ticksOn(key).filter(x => x.id !== id));
    this.store.remove('tick', id);
    this.emit({ days: [key] });
  }

  /** The whole database as plain data: this is also the file a user exports. */
  export(): DbData {
    return { format: 'tempo', version: 1, exportedAt: new Date().toISOString(),
             counters: this.counters, plans: this.plans, ticks: [...this.ticks.values()].sort((a, b) => a.at - b.at), settings: this.settings };
  }
  /** Replaces everything with the content of an export. Validates first, so a bad file changes nothing. */
  async import(raw: unknown): Promise<void> { await this.replace(validate(raw)); }
  async replace(data: DbData): Promise<void> {
    await this.store.replaceAll(data);
    this.adopt(structuredClone(data));
    this.emit({ all: true });
  }
}
