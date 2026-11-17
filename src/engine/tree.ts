// The view tree for one year: year → months → weeks → days → items.
// A month lists every week it touches, and each week holds all seven of its days. Days that belong to
// another month are flagged `out`: hidden while the month shows the week as a strip, whole once the week opens.
// So a straddling week appears under two months; both copies show the same DayModel, which lives once.

import { addDays, DAY_NAMES, dayKey, daysInMonth, isoWeek, mondayOf, MONTHS, weekday } from '../model/dates.ts';
import type { DayModel, ItemModel } from '../model/derive.ts';
import type { DayKey } from '../model/types.ts';

/** A step row inside an opened item. Only view state lives here; the data is ItemModel.steps[j]. */
export interface KidView {
  el: HTMLElement; fill: HTMLElement; label: HTMLElement; right: HTMLElement; count: HTMLElement | null;
}

export interface ItemNode {
  id: string;
  lvl: 4;
  k: number;
  parent: Cell;
  model: ItemModel;
  hasKids: boolean;
  // view state
  el?: HTMLElement; mark?: HTMLElement; num?: HTMLElement; meas?: HTMLElement; btn?: HTMLElement; body?: HTMLElement;
  shown?: boolean;
  kids: KidView[];
}

export interface PartNode { pi: number; id: string; name: string; el?: HTMLElement }

/** A year, month, week or day. */
export interface Cell {
  id: string;
  lvl: 0 | 1 | 2 | 3;
  k: number;
  parent: Cell | null;
  kids: Cell[];
  label: string;
  crumb: string;
  /** month (0-based) for months and days */
  mi: number;
  // week
  i0: number; d0: number; nIn: number;
  twinNext?: Cell; twinPrev?: Cell;
  // day
  key: DayKey; wd: number; dom: number; out: boolean;
  model?: DayModel;
  items: ItemNode[];
  parts: PartNode[];
  // view state
  el?: HTMLElement; lab?: HTMLElement; body?: HTMLElement; heat?: HTMLElement; sum?: HTMLElement; legend?: HTMLElement; tray?: HTMLElement;
  off?: boolean; bodyOff?: boolean; sig?: string;
}

export type AnyNode = Cell | ItemNode;

export interface Tree {
  year: number;
  root: Cell;
  byId: Map<string, AnyNode>;
  /** Every view copy of a calendar day. */
  daysByKey: Map<DayKey, Cell[]>;
  /** The copy of today that sits in its own month; absent when the tree is for another year. */
  today?: Cell;
}

const cell = (p: Partial<Cell> & Pick<Cell, 'id' | 'lvl' | 'k' | 'parent' | 'label' | 'crumb'>): Cell => ({
  kids: [], mi: 0, i0: 0, d0: 1, nIn: 7, key: '', wd: 0, dom: 0, out: false, items: [], parts: [], ...p,
});

export function buildYear(year: number, todayKey: DayKey, modelOf: (key: DayKey) => DayModel): Tree {
  const byId = new Map<string, AnyNode>(), daysByKey = new Map<DayKey, Cell[]>();
  const reg = (c: Cell): Cell => { byId.set(c.id, c); return c; };
  const arrow = (d: number, glyph: string): string => '<button class="yr" data-act="year" data-d="' + d + '" aria-label="' + (d < 0 ? 'Previous' : 'Next') + ' year">' + glyph + '</button>';
  const root = reg(cell({ id: 'y', lvl: 0, k: 0, parent: null, label: arrow(-1, '‹') + '<b>' + year + '</b>' + arrow(1, '›'), crumb: String(year) }));
  let today: Cell | undefined;

  MONTHS.forEach(([short, rest], mi) => {
    const month = reg(cell({ id: 'm' + mi, lvl: 1, k: mi, parent: root, mi, label: '<b>' + short + '</b><i>' + rest + '</i>', crumb: short }));
    root.kids.push(month);
    const seen = new Set<DayKey>();
    for (let dom = 1; dom <= daysInMonth(year, mi); dom++) {
      const monday = mondayOf(new Date(year, mi, dom)), wkKey = dayKey(monday);
      if (seen.has(wkKey)) continue;
      seen.add(wkKey);
      const no = isoWeek(monday).week;
      const week = reg(cell({ id: 'w' + mi + '_' + wkKey, lvl: 2, k: month.kids.length, parent: month, mi, label: '', crumb: 'W' + no, key: wkKey }));
      month.kids.push(week);
      for (let j = 0; j < 7; j++) {
        const date = addDays(monday, j), key = dayKey(date), wd = weekday(date);
        const out = date.getFullYear() !== year || date.getMonth() !== mi;
        const day = reg(cell({
          id: 'd' + key + (out ? '@' + mi : ''), lvl: 3, k: j, parent: week, mi: date.getMonth(), key, wd, dom: date.getDate(), out,
          crumb: DAY_NAMES[wd] + ' ' + date.getDate(),
          label: '<b>' + DAY_NAMES[wd] + '</b><span>' + date.getDate() + '</span>' + (out ? '<em>' + MONTHS[date.getMonth()]![0] + '</em>' : ''),
        }));
        week.kids.push(day);
        const copies = daysByKey.get(key); if (copies) copies.push(day); else daysByKey.set(key, [day]);
        if (!out && key === todayKey) today = day;
        day.model = modelOf(key);
        syncItems(day, byId);
      }
      const inside = week.kids.filter(d => !d.out), a = week.kids[0]!, b = week.kids[6]!;
      week.i0 = week.kids.findIndex(d => !d.out); week.d0 = inside[0]!.dom; week.nIn = inside.length;
      const cross = a.mi !== b.mi;
      week.label = '<b>W' + no + '</b><span>' + a.dom + (cross ? ' ' + MONTHS[a.mi]![0] : '') + '–' + b.dom + (cross ? ' ' + MONTHS[b.mi]![0] : '') + '</span>';
    }
  });
  // link the two copies of a week that straddles two months
  root.kids.forEach((m, mi) => {
    const next = root.kids[mi + 1]; if (!next) return;
    const a = m.kids[m.kids.length - 1]!, b = next.kids[0]!;
    if (a.key === b.key) { a.twinNext = b; b.twinPrev = a; }
  });
  return { year, root, byId, daysByKey, today };
}

/** Brings a day's item and part nodes in line with its model, keeping existing nodes (and their elements) where it can. */
export function syncItems(day: Cell, byId: Map<string, AnyNode>): void {
  const model = day.model!;
  const old = new Map(day.items.map(it => [it.id, it]));
  day.items = model.items.map((m, k) => {
    const id = day.id + '|' + m.counter.id;
    const node: ItemNode = old.get(id) ?? { id, lvl: 4, k, parent: day, model: m, hasKids: m.kind !== 'check', kids: [] };
    node.k = k; node.model = m; node.hasKids = m.kind !== 'check';
    old.delete(id); byId.set(id, node);
    return node;
  });
  old.forEach(gone => { gone.el?.remove(); byId.delete(gone.id); });
  const oldParts = new Map(day.parts.map(p => [p.pi, p]));
  day.parts = model.parts.map(p => {
    const keep = oldParts.get(p.pi);
    oldParts.delete(p.pi);
    return keep ?? { pi: p.pi, id: day.id + 'p' + p.pi, name: p.name };
  });
  oldParts.forEach(gone => gone.el?.remove());
}
