// Sample data for a first run: five counters and a year of plausible history up to `now`.
// Deterministic for a given day, so tests and screenshots are stable.

import { addDays, atMinute, dayKey, dayOfYear, weekday } from '../model/dates.ts';
import type { Counter, DbData, Plan, Tick } from '../model/types.ts';
import { rng } from '../util.ts';
import { DEFAULT_SETTINGS } from './db.ts';

export function seed(now: Date): DbData {
  const year = now.getFullYear(), start = new Date(year, 0, 1), from = dayKey(start), created = start.getTime();
  const counters: Counter[] = [
    { id: 'water', name: 'Water', color: 'teal', measure: 'count', intent: 'do', unit: 'glass', order: 0, createdAt: created },
    { id: 'cig', name: 'Cigarettes', short: 'Cigs', color: 'brown', measure: 'count', intent: 'avoid', order: 1, createdAt: created },
    { id: 'meds', name: 'Meds', color: 'green', measure: 'check', intent: 'do', order: 2, createdAt: created },
    { id: 'gym', name: 'Gym circuit', short: 'Gym', color: 'indigo', measure: 'check', intent: 'do', order: 3, createdAt: created,
      sequence: {
        rounds: 3,
        steps: [{ name: 'Push-ups', seconds: 40 }, { name: 'Rest', seconds: 20, rest: true }, { name: 'Squats', seconds: 40 }, { name: 'Rest', seconds: 20, rest: true }],
        after: [{ name: 'Cool down', seconds: 120 }],
      } },
    { id: 'stretch', name: 'Stretch', color: 'violet', measure: 'check', intent: 'do', optional: true, order: 4, createdAt: created },
  ];
  const plans: Plan[] = [
    { id: 'p-water', counterId: 'water', level: 'day', target: 8, clock: 'calendar', from },
    { id: 'p-cig', counterId: 'cig', level: 'day', target: 3, clock: 'calendar', from },
    { id: 'p-meds', counterId: 'meds', level: 'day', target: 1, part: 'morning', clock: 'calendar', from },
    { id: 'p-gym', counterId: 'gym', level: 'day', target: 1, weekdays: [0, 2, 4], part: 'afternoon', clock: 'calendar', from },
    { id: 'p-stretch', counterId: 'stretch', level: 'day', target: 1, part: 'evening', clock: 'calendar', from },
  ];

  const ticks: Tick[] = [];
  const nowMs = now.getTime(), todayKey = dayKey(now);
  let n = 0;
  const add = (counterId: string, key: string, minute: number, extra: Partial<Tick> = {}): void => {
    const at = atMinute(key, minute);
    if (at <= nowMs) ticks.push({ id: 's' + (n++), counterId, at, ...extra });   // nothing in the future, today included
  };
  for (let d = start; dayKey(d) <= todayKey; d = addDays(d, 1)) {
    const key = dayKey(d), r = rng(year * 1000 + dayOfYear(d)), wd = weekday(d);
    const glasses = 3 + Math.floor(r() * 6);
    for (let j = 0; j < glasses; j++) add('water', key, 450 + j * 100 + Math.floor(r() * 50));
    const cigs = 1 + Math.floor(r() * 6);
    for (let j = 0; j < cigs; j++) add('cig', key, 480 + Math.floor(r() * 840));
    if (r() < 0.9) add('meds', key, 485);
    if ((wd === 0 || wd === 2 || wd === 4) && r() < 0.78) add('gym', key, 17 * 60 + 30 + Math.floor(r() * 60), { seconds: 480 });
    if (r() < 0.4) add('stretch', key, 21 * 60 + 30);
  }
  return { format: 'tempo', version: 1, counters, plans, ticks, settings: structuredClone(DEFAULT_SETTINGS) };
}
