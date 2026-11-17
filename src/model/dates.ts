// Calendar arithmetic on local dates. Weeks start on Monday and are numbered the ISO way.

import type { DayKey } from './types.ts';

export const MONTHS: [short: string, rest: string][] = [
  ['Jan', 'uary'], ['Feb', 'ruary'], ['Mar', 'ch'], ['Apr', 'il'], ['May', ''], ['Jun', 'e'],
  ['Jul', 'y'], ['Aug', 'ust'], ['Sep', 'tember'], ['Oct', 'ober'], ['Nov', 'ember'], ['Dec', 'ember'],
];
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad2 = (n: number): string => String(n).padStart(2, '0');

export const dayKey = (d: Date): DayKey => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
export const keyOfMs = (ms: number): DayKey => dayKey(new Date(ms));
export const parseKey = (key: DayKey): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};
export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Monday = 0 … Sunday = 6. */
export const weekday = (d: Date): number => (d.getDay() + 6) % 7;
export const daysInMonth = (year: number, month: number): number => new Date(year, month + 1, 0).getDate();
export const daysInYear = (year: number): number => (new Date(year, 1, 29).getMonth() === 1 ? 366 : 365);
/** 1 for 1 January. */
export const dayOfYear = (d: Date): number =>
  Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 86400000) + 1;
export const mondayOf = (d: Date): Date => addDays(d, -weekday(d));

/** ISO 8601 week: week 1 is the one holding the year's first Thursday. */
export const isoWeek = (d: Date): { year: number; week: number } => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - jan1) / 86400000 + 1) / 7) };
};

export const minutesOfDay = (ms: number): number => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
};
/** The instant at a given minute of a given local day. */
export const atMinute = (key: DayKey, minute: number): number => {
  const d = parseKey(key);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minute).getTime();
};
