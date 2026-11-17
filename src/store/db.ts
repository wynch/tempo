// The database as the app sees it: all records in memory, every change written through to a
// Persistence (IndexedDB in the browser, memory in tests). The export format is the data itself.

import { addDays, dayKey, keyOfMs, parseKey } from '../model/dates.ts';
import type { Counter, DayKey, DbData, Id, Placement, Plan, Settings, Tick } from '../model/types.ts';
import { newId } from '../util.ts';

export type RecordKind = 'counter' | 'plan' | 'tick' | 'placement';

/** Where records are kept between sessions. Writes are fire-and-forget; load and replaceAll are awaited. */
export interface Persistence {
  load(): Promise<DbData | null>;
  save(kind: RecordKind, record: Counter | Plan | Tick | Placement): void;
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

export const emptyData = (): DbData => ({ format: 'tempo', version: 1, counters: [], plans: [], ticks: [], placements: [], settings: structuredClone(DEFAULT_SETTINGS) });

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
  const placements = raw.placements === undefined ? [] : list('placements', r => str(r.counterId) && ids.has(r.counterId) && str(r.day));
  const s = raw.settings;
  if (!isObj(s) || !Array.isArray(s.parts) || !s.parts.every(p => isObj(p) && str(p.id) && str(p.name) && num(p.start))) {
    throw new Error('The export has no valid settings.');
  }
  return {
    format: 'tempo', version: 1,
    counters: counters as unknown as Counter[], plans: plans as unknown as Plan[], ticks: ticks as unknown as Tick[],
    placements: placements as unknown as Placement[],
    settings: s as unknown as Settings,
  };
}

/** A rhythm as the editor describes it: a plan without its identity and dates. */
export type PlanSpec = Omit<Plan, 'id' | 'counterId' | 'from' | 'until'>;
const samePlan = (p: Plan, s: PlanSpec): boolean =>
  p.level === s.level && p.target === s.target && p.clock === s.clock && (p.part ?? '') === (s.part ?? '') &&
  (p.weekdays ?? []).join() === (s.weekdays ?? []).join();

/** What a change touched, so views repaint only that. */
export type Change = { days: DayKey[] } | { all: true };

export class Db {
  counters: Counter[] = [];
  plans: Plan[] = [];
  placements: Placement[] = [];
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
    if (!data) {                      // nothing stored at all: a first run
      data = seed ? seed() : emptyData();
      await store.replaceAll(data);
    }
    db.adopt(data);
    return db;
  }

  private adopt(data: DbData): void {
    this.counters = [...data.counters].sort((a, b) => a.order - b.order);   // storage hands records back in id order
    this.plans = data.plans; this.placements = data.placements ?? []; this.settings = data.settings;
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

  /** Adds a counter, or replaces the one with the same id. */
  saveCounter(c: Counter): void {
    const i = this.counters.findIndex(x => x.id === c.id);
    if (i >= 0) this.counters[i] = c; else this.counters.push(c);
    this.counters.sort((a, b) => a.order - b.order);
    this.store.save('counter', c);
    this.emit({ all: true });
  }
  /** Removes a counter with its plans and everything logged against it. */
  deleteCounter(id: Id): void {
    this.counters = this.counters.filter(c => c.id !== id);
    this.plans.filter(p => p.counterId === id).forEach(p => this.store.remove('plan', p.id));
    this.plans = this.plans.filter(p => p.counterId !== id);
    this.placements.filter(p => p.counterId === id).forEach(p => this.store.remove('placement', p.id));
    this.placements = this.placements.filter(p => p.counterId !== id);
    [...this.ticks.values()].filter(t => t.counterId === id).forEach(t => {
      this.ticks.delete(t.id); this.store.remove('tick', t.id);
      const key = keyOfMs(t.at);
      this.byDay.set(key, this.ticksOn(key).filter(x => x.id !== t.id));
    });
    this.store.remove('counter', id);
    this.emit({ all: true });
  }
  /** Pins a floating plan to a day, or unpins it if it was already there. Returns whether it is now pinned. */
  togglePlacement(counterId: Id, day: DayKey): boolean {
    const old = this.placements.find(p => p.counterId === counterId && p.day === day);
    if (old) { this.placements = this.placements.filter(p => p !== old); this.store.remove('placement', old.id); }
    else { const p: Placement = { id: newId('l'), counterId, day }; this.placements.push(p); this.store.save('placement', p); }
    this.emit({ days: [day] });
    return !old;
  }
  /** The plan of a counter that is still running (no end date). */
  openPlan(counterId: Id): Plan | undefined { return this.plans.find(p => p.counterId === counterId && !p.until); }
  /** Changes a counter's rhythm from `today` on. The past keeps the plan it had, so history is not rewritten. */
  setPlan(counterId: Id, spec: PlanSpec | null, today: DayKey): void {
    const old = this.openPlan(counterId);
    if (old && spec && samePlan(old, spec)) return;
    if (old) {
      if (old.from >= today) { this.plans = this.plans.filter(p => p !== old); this.store.remove('plan', old.id); }
      else { old.until = dayKey(addDays(parseKey(today), -1)); this.store.save('plan', old); }
    }
    if (spec) {
      const p: Plan = { id: newId('p'), counterId, from: today, ...spec };
      this.plans.push(p); this.store.save('plan', p);
    }
    this.emit({ all: true });
  }

  /** The whole database as plain data: this is also the file a user exports. */
  export(): DbData {
    return { format: 'tempo', version: 1, exportedAt: new Date().toISOString(),
             counters: this.counters, plans: this.plans, ticks: [...this.ticks.values()].sort((a, b) => a.at - b.at),
             placements: this.placements, settings: this.settings };
  }
  /** Replaces everything with the content of an export. Validates first, so a bad file changes nothing. */
  async import(raw: unknown): Promise<void> { await this.replace(validate(raw)); }
  async replace(data: DbData): Promise<void> {
    await this.store.replaceAll(data);
    this.adopt(structuredClone(data));
    this.emit({ all: true });
  }
}
