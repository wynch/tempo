// From records to what a day shows. Pure: same inputs, same output, no clock and no DOM.

import { clamp, hhmm, spanText } from '../util.ts';
import { addDays, dayKey, daysInMonth, minutesOfDay, mondayOf, parseKey, weekday } from './dates.ts';
import type { Counter, DayKey, Id, Placement, Plan, Sequence, Settings, Tick } from './types.ts';

/** How an item behaves on screen. */
export type ItemKind = 'check' | 'count' | 'avoid' | 'session';

export const itemKind = (c: Counter): ItemKind =>
  c.sequence ? 'session' : c.intent === 'avoid' ? 'avoid' : c.measure === 'count' ? 'count' : 'check';

/** One row inside an opened item: a step of a circuit, a slot of a count, or a logged tick. */
export interface StepModel {
  label: string;
  sub?: string;
  right: string;
  /** Share of the mini strip it takes (seconds for a circuit step, 1 otherwise). */
  weight: number;
  /** Minute of the day, for logged ticks. */
  minute?: number;
  seconds?: number;
  rest?: boolean;
  /** 0..1 filled. For a session this is the resting value; a live run overrides it. */
  p: number;
  /** The tick this row stands for, if any. Tapping the row removes it. */
  tickId?: Id;
}

export interface ItemModel {
  /** counter id + day: stable across recomputations. */
  id: string;
  counter: Counter;
  kind: ItemKind;
  day: DayKey;
  /** 0 = all day, 1.. = index into settings.parts + 1. */
  part: number;
  optional: boolean;
  done: boolean;
  missed: boolean;
  /** Units logged that day. */
  n: number;
  /** Floor or ceiling for the day; 0 when there is none. */
  target: number;
  ticks: Tick[];
  steps: StepModel[];
  /** Planned length of a session, in seconds. */
  seconds: number;
  /** The cell the plan counts over. A week or month plan floats: it can be met on any day of its period. */
  span: Span;
  /** Units logged over that whole period (equal to `n` for a day plan). */
  periodN: number;
  /** A floating plan that has been pinned to this day: it then behaves like a plan for the day. */
  placed: boolean;
}
export type Span = 'day' | 'week' | 'month';

/** The days of the week or month a day belongs to. */
export function periodKeys(key: DayKey, span: Span): DayKey[] {
  const d = parseKey(key);
  if (span === 'week') { const m = mondayOf(d); return Array.from({ length: 7 }, (_, i) => dayKey(addDays(m, i))); }
  if (span === 'month') return Array.from({ length: daysInMonth(d.getFullYear(), d.getMonth()) }, (_, i) => dayKey(new Date(d.getFullYear(), d.getMonth(), i + 1)));
  return [key];
}

export interface DayModel {
  key: DayKey;
  past: boolean;
  today: boolean;
  items: ItemModel[];
  /** The groups that have at least one item, in order. */
  parts: { pi: number; name: string }[];
  /** Per counter id: 0..1, or null when the counter does not apply that day. `all` is the day's overall score. */
  vals: Record<string, number | null>;
  /** Per counter id: the plain number (units, or 1/0 for done). */
  raw: Record<string, number>;
}

export interface DeriveInput {
  counters: Counter[];
  plans: Plan[];
  placements?: Placement[];
  settings: Settings;
  ticksOn: (key: DayKey) => Tick[];
  todayKey: DayKey;
}

/** The plan of a counter that is in force on a given day, if any. A day plan may skip some weekdays. */
export function planOn(plans: Plan[], counterId: Id, key: DayKey, wd: number): Plan | undefined {
  return plans.find(p =>
    p.counterId === counterId && p.from <= key && (!p.until || key <= p.until) &&
    (p.level !== 'day' || !p.weekdays || p.weekdays.includes(wd)));
}

/** A circuit written out step by step. */
export function flatten(seq: Sequence): StepModel[] {
  const out: StepModel[] = [];
  for (let r = 1; r <= seq.rounds; r++) {
    seq.steps.forEach((s, j) => out.push({
      label: s.name, sub: j === 0 && seq.rounds > 1 ? 'round ' + r : undefined, right: s.seconds + ' s',
      weight: s.seconds, seconds: s.seconds, rest: s.rest, p: 0,
    }));
  }
  (seq.after ?? []).forEach(s => out.push({ label: s.name, right: s.seconds + ' s', weight: s.seconds, seconds: s.seconds, rest: s.rest, p: 0 }));
  return out;
}

function steps(c: Counter, kind: ItemKind, ticks: Tick[], target: number, done: boolean): StepModel[] {
  if (kind === 'session') return flatten(c.sequence!).map(s => ({ ...s, p: done ? 1 : 0 }));
  if (kind === 'avoid') {
    return ticks.map((t, j) => ({
      label: hhmm(minutesOfDay(t.at)), minute: minutesOfDay(t.at), weight: 1, p: 1, tickId: t.id,
      right: j ? spanText((t.at - ticks[j - 1]!.at) / 60000) + ' after' : 'first',
    }));
  }
  if (kind === 'count') {
    const unit = c.unit ?? 'no.';
    const rows: StepModel[] = ticks.map((t, j) => ({ label: hhmm(minutesOfDay(t.at)), right: unit + ' ' + (j + 1), weight: 1, p: 1, tickId: t.id }));
    for (let j = rows.length; j < target; j++) rows.push({ label: '—', right: unit + ' ' + (j + 1), weight: 1, p: 0 });
    return rows;
  }
  return [];
}

export function buildDay(input: DeriveInput, key: DayKey): DayModel {
  const wd = weekday(parseKey(key));
  const past = key < input.todayKey, today = key === input.todayKey, future = !past && !today;
  const dayTicks = input.ticksOn(key);
  const items: ItemModel[] = [];

  [...input.counters].sort((a, b) => a.order - b.order).forEach(c => {
    if (c.archivedAt != null) return;
    const kind = itemKind(c);
    const plan = planOn(input.plans, c.id, key, wd), span: Span = plan?.level ?? 'day';
    const ticks = dayTicks.filter(t => t.counterId === c.id).sort((a, b) => a.at - b.at);
    // An avoid counter is something you log when it happens: it has no place on a future day.
    const shown = ticks.length > 0 || (!!plan && !(kind === 'avoid' && future)) || (kind === 'avoid' && today);
    if (!shown) return;
    const n = kind === 'count' || kind === 'avoid' ? ticks.reduce((a, t) => a + (t.amount ?? 1), 0) : ticks.length;
    const target = plan?.target ?? (kind === 'count' ? 1 : 0);
    // A week or month plan floats over its period, unless it has been pinned to this day ("refined").
    const period = span === 'day' ? [key] : periodKeys(key, span);
    const pins = span === 'day' ? [] : (input.placements ?? []).filter(p => p.counterId === c.id && period.includes(p.day));
    const placed = pins.some(p => p.day === key), floating = span !== 'day' && !placed;
    // Once as many days are pinned as the plan asks for, it no longer floats over the other days.
    if (floating && pins.length >= target && !ticks.length) return;
    // A floating plan is met on whichever days you choose: on a given day, "done" means you did it that day.
    const done = kind === 'avoid' ? false : kind === 'count' && span === 'day' ? n >= target : n > 0;
    const units = (list: Tick[]): number => list.filter(t => t.counterId === c.id).reduce((a, t) => a + (kind === 'count' || kind === 'avoid' ? t.amount ?? 1 : 1), 0);
    const periodN = span === 'day' ? n : period.reduce((a, k) => a + units(input.ticksOn(k)), 0);
    const nParts = input.settings.parts.length;
    const partIndex = floating ? nParts + (span === 'week' ? 1 : 2) : placed ? 0 : plan?.part ? input.settings.parts.findIndex(p => p.id === plan.part) + 1 : 0;
    const st = steps(c, kind, ticks, span === 'day' ? target : 0, done);
    items.push({
      id: c.id + '@' + key, counter: c, kind, day: key, part: Math.max(0, partIndex), optional: !!c.optional,
      done, missed: !floating && past && !done && (kind === 'check' || kind === 'session'), n, target, ticks, steps: st,
      seconds: kind === 'session' ? st.reduce((a, s) => a + (s.seconds ?? 0), 0) : 0, span, periodN, placed,
    });
  });
  items.sort((a, b) => a.part - b.part);

  const names = ['All day', ...input.settings.parts.map(p => p.name), 'This week', 'This month'];
  const parts = names.map((name, pi) => ({ pi, name })).filter(p => items.some(it => it.part === p.pi));

  const vals: Record<string, number | null> = { all: 0 }, raw: Record<string, number> = {};
  if (!future) {
    let sum = 0, cnt = 0;
    items.forEach(it => {
      const ceiling = Math.max(1, it.target);
      const floating = it.span !== 'day' && !it.placed;
      const val = it.span !== 'day' ? (it.n > 0 ? 1 : 0) : it.kind === 'count' ? clamp(it.n / Math.max(1, it.target), 0, 1)
        : it.kind === 'avoid' ? clamp(it.n / (2 * ceiling), 0, 1) : it.done ? 1 : 0;
      vals[it.counter.id] = val;
      raw[it.counter.id] = it.kind === 'count' || it.kind === 'avoid' ? it.n : it.done ? 1 : 0;
      if (it.optional || floating) return;        // a floating plan is judged over its period, not day by day
      cnt++;
      // For something to avoid, a good day is one at or under the ceiling.
      sum += it.kind === 'avoid' ? (it.n <= it.target ? 1 : clamp(1 - (it.n - it.target) / ceiling, 0, 1)) : val;
    });
    vals.all = cnt ? sum / cnt : 0;
  }
  return { key, past, today, items, parts, vals, raw };
}

/** The total shown at the end of a month row, for the current filter. */
export function monthSummary(days: DayModel[], filter: string, counters: Counter[]): string {
  const lived = days.filter(d => (d.past || d.today) && d.items.length);   // days with nothing to count say nothing
  if (!lived.length) return '';
  if (filter === 'all') return Math.round(lived.reduce((a, d) => a + (d.vals.all ?? 0), 0) / lived.length * 100) + '%';
  const c = counters.find(x => x.id === filter);
  const on = lived.filter(d => d.vals[filter] != null);
  if (!c || !on.length) return '';
  const total = on.reduce((a, d) => a + (d.raw[filter] ?? 0), 0);
  const kind = itemKind(c);
  if (on.some(d => d.items.some(it => it.counter.id === filter && it.span !== 'day'))) return String(total);
  return kind === 'avoid' ? String(total) : kind === 'count' ? (total / on.length).toFixed(1) : total + '/' + on.length;
}

/** Five clear steps read better than a smooth ramp. */
export const step5 = (v: number | null | undefined): number =>
  v == null || v <= 0 ? 0 : v < 0.25 ? 0.22 : v < 0.5 ? 0.45 : v < 0.8 ? 0.7 : 1;

/** Which part of the day a minute falls in: 0 before the first part, else index + 1. */
export const partAt = (settings: Settings, minute: number): number => {
  let pi = 0;
  settings.parts.forEach((p, i) => { if (minute >= p.start) pi = i + 1; });
  return pi;
};
