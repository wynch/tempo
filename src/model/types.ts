// The data model. Everything a user owns is one of these records.
// The log of ticks is the source of truth; streaks, totals and cell colours are derived, never stored.

export type Id = string;
/** A local calendar day, "YYYY-MM-DD". Ticks carry an exact instant; the day is derived from it. */
export type DayKey = string;

/** What a counter measures, and so what its cell shows. */
export type Measure = 'check' | 'count';
/** do: reach a floor. avoid: stay under a ceiling. track: just count, no judgement. */
export type Intent = 'do' | 'avoid' | 'track';
/** Colour names resolved by the stylesheet, so they follow light and dark themes. */
export type ColorKey = 'indigo' | 'teal' | 'green' | 'brown' | 'violet' | 'amber' | 'rose' | 'slate';

export interface Step {
  name: string;
  seconds: number;
  rest?: boolean;
}
/** A played circuit: `rounds` times the steps, then the closing steps once. */
export interface Sequence {
  rounds: number;
  steps: Step[];
  after?: Step[];
}

export interface Counter {
  id: Id;
  name: string;
  /** A shorter name for tight places such as the year filter. */
  short?: string;
  color: ColorKey;
  measure: Measure;
  intent: Intent;
  /** Optional counters never show as missed and do not weigh on a day's score. */
  optional?: boolean;
  /** Present on counters that are played with the clock. */
  sequence?: Sequence;
  /** Word for one unit of a count, e.g. "glass". */
  unit?: string;
  order: number;
  createdAt: number;
  archivedAt?: number;
}

/** A counter's rhythm. A plan lives at the coarsest level where it is true. */
export interface Plan {
  id: Id;
  counterId: Id;
  level: 'day' | 'week' | 'month';
  /** Floor (do) or ceiling (avoid) per cell of that level. */
  target: number;
  /** For day plans: the weekdays it applies to, Monday = 0. Absent means every day. */
  weekdays?: number[];
  /** The part of day it sits in. Absent means all day. */
  part?: Id;
  /** calendar: anchored to dates. elastic: due `everyDays` after the last tick. */
  clock: 'calendar' | 'elastic';
  everyDays?: number;
  from: DayKey;
  until?: DayKey;
}

/** One thing that happened, at an exact instant. */
export interface Tick {
  id: Id;
  counterId: Id;
  /** Milliseconds since the epoch. */
  at: number;
  amount?: number;
  /** For played sessions: how long it lasted. */
  seconds?: number;
}

/** A floating plan pinned to one day of its period: "gym 3× this week" refined to "on Tuesday". */
export interface Placement {
  id: Id;
  counterId: Id;
  day: DayKey;
}

export interface Part {
  id: Id;
  name: string;
  /** Minute of the day at which it starts. */
  start: number;
}
export interface Settings {
  parts: Part[];
}

/** The whole database, also the export format. */
export interface DbData {
  format: 'tempo';
  version: 1;
  exportedAt?: string;
  counters: Counter[];
  plans: Plan[];
  ticks: Tick[];
  /** Absent in exports made before placements existed. */
  placements?: Placement[];
  settings: Settings;
}
