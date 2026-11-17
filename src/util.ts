// Small pure helpers shared by the model and the engine. No DOM here.

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};
export const ease = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** 95 -> "1:35" */
export const mmss = (seconds: number): string => {
  const s = Math.max(0, Math.ceil(seconds));
  return Math.floor(s / 60) + ':' + pad2(s % 60);
};
/** minutes of the day -> "08:05" */
export const hhmm = (minutes: number): string => pad2(Math.floor(minutes / 60)) + ':' + pad2(Math.floor(minutes % 60));
/** a span in minutes -> "2 h 05" or "40 min" */
export const spanText = (minutes: number): string => {
  const m = Math.max(0, Math.round(minutes));
  return m >= 60 ? Math.floor(m / 60) + ' h ' + pad2(m % 60) : m + ' min';
};

/** Deterministic random numbers in [0, 1), for sample data. */
export const rng = (seed: number) => (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

let counter = 0;
/** A short unique id: time, a per-session counter and some randomness, so two devices do not collide. */
export const newId = (prefix: string): string =>
  prefix + Date.now().toString(36) + (counter++).toString(36) + Math.floor(Math.random() * 1e6).toString(36);
