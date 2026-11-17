// The sheet where counters are listed, created and edited: name, colour, kind, rhythm, and the steps of a circuit.
// Plain DOM: the sheet is redrawn from a draft whenever its shape changes; typing only updates the draft.

import { DAY_NAMES } from '../model/dates.ts';
import { itemKind, type ItemKind } from '../model/derive.ts';
import type { ColorKey, Counter, DayKey, Id, Plan, Step } from '../model/types.ts';
import type { Db, PlanSpec } from '../store/db.ts';
import { newId } from '../util.ts';

export interface EditorHost {
  db: Db;
  todayKey: DayKey;
  sheet: HTMLElement;
}

const COLORS: ColorKey[] = ['indigo', 'teal', 'green', 'amber', 'rose', 'violet', 'brown', 'slate'];
const KINDS: [ItemKind, string, string][] = [
  ['check', 'Check', 'Something you do, or not.'],
  ['count', 'Count', 'Something you do several times, towards a number.'],
  ['avoid', 'Avoid', 'Something you log when it happens, and want less of.'],
  ['session', 'Circuit', 'Timed steps, played with the clock.'],
];
type Rhythm = 'daily' | 'days' | 'week' | 'month' | 'none';
const RHYTHMS: [Rhythm, string][] = [['daily', 'Every day'], ['days', 'On some days'], ['week', 'Per week'], ['month', 'Per month'], ['none', 'No plan, just log']];

interface Draft {
  id: Id | null;
  name: string; color: ColorKey; kind: ItemKind; unit: string; optional: boolean;
  rhythm: Rhythm; weekdays: number[]; target: number; part: string;
  rounds: number; steps: Step[]; after: Step[];
}

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const per = (r: Rhythm): string => (r === 'week' ? 'week' : r === 'month' ? 'month' : 'day');

/** A rhythm in words, for the list of counters. */
export function rhythmText(c: Counter, plan: Plan | undefined): string {
  const kind = itemKind(c);
  if (!plan) return 'No plan';
  const unit = plan.level, n = plan.target;
  const days = plan.weekdays ? plan.weekdays.map(d => DAY_NAMES[d]).join(', ') : 'every day';
  if (kind === 'avoid') return 'At most ' + n + ' a ' + unit;
  if (kind === 'count') return n + ' a ' + unit + (plan.level === 'day' && plan.weekdays ? ', ' + days : '');
  return plan.level === 'day' ? days.charAt(0).toUpperCase() + days.slice(1) : n + (n === 1 ? ' time a ' : ' times a ') + unit;
}

function draftOf(db: Db, id: Id | null): Draft {
  const c = id ? db.counters.find(x => x.id === id) : undefined, plan = c ? db.openPlan(c.id) : undefined;
  const fresh: Draft = { id: null, name: '', color: COLORS[db.counters.length % COLORS.length]!, kind: 'check', unit: '', optional: false,
                         rhythm: 'daily', weekdays: [0, 1, 2, 3, 4], target: 1, part: '', rounds: 3,
                         steps: [{ name: 'Work', seconds: 40 }, { name: 'Rest', seconds: 20, rest: true }], after: [] };
  if (!c) return fresh;
  return {
    ...fresh, id: c.id, name: c.name, color: c.color, kind: itemKind(c), unit: c.unit ?? '', optional: !!c.optional,
    rhythm: !plan ? 'none' : plan.level === 'day' ? (plan.weekdays ? 'days' : 'daily') : plan.level,
    weekdays: plan?.weekdays ?? fresh.weekdays, target: plan?.target ?? 1, part: plan?.part ?? '',
    rounds: c.sequence?.rounds ?? 3,
    steps: c.sequence ? c.sequence.steps.map(s => ({ ...s })) : fresh.steps,
    after: c.sequence?.after?.map(s => ({ ...s })) ?? [],
  };
}

const stepRows = (list: 'steps' | 'after', steps: Step[]): string => steps.map((s, i) => `
  <div class="steprow">
    <input data-list="${list}" data-i="${i}" data-f="name" value="${esc(s.name)}" placeholder="Step" aria-label="Step name">
    <input data-list="${list}" data-i="${i}" data-f="seconds" type="number" min="1" inputmode="numeric" value="${s.seconds}" aria-label="Seconds">
    <span>s</span>
    <label class="rest"><input data-list="${list}" data-i="${i}" data-f="rest" type="checkbox" ${s.rest ? 'checked' : ''}>rest</label>
    <button data-do="up" data-list="${list}" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
    <button data-do="del" data-list="${list}" data-i="${i}" aria-label="Remove">×</button>
  </div>`).join('') + `<button class="add" data-do="add" data-list="${list}">+ Add a step</button>`;

function formHtml(d: Draft, parts: { id: string; name: string }[]): string {
  const dayLevel = d.rhythm === 'daily' || d.rhythm === 'days';
  const needsTarget = d.rhythm !== 'none' && (d.kind === 'count' || d.kind === 'avoid' || !dayLevel);
  const targetLabel = d.kind === 'avoid' ? 'At most, a ' + per(d.rhythm) : d.kind === 'count' ? 'How many a ' + per(d.rhythm) : 'Times a ' + per(d.rhythm);
  const total = d.rounds * d.steps.reduce((a, s) => a + s.seconds, 0) + d.after.reduce((a, s) => a + s.seconds, 0);
  return `
  <header><h2>${d.id ? 'Edit counter' : 'New counter'}</h2><button data-do="close" aria-label="Close">×</button></header>
  <div class="fields">
    <label class="field"><span>Name</span><input data-f="name" value="${esc(d.name)}" placeholder="Water, Gym, Call mum…" autocomplete="off"></label>
    <div class="field"><span>Colour</span><div class="swatches">${COLORS.map(c =>
      `<button data-do="color" data-v="${c}" class="${c === d.color ? 'on' : ''}" style="--c:var(--c-${c})" aria-label="${c}"></button>`).join('')}</div></div>
    <div class="field"><span>Kind</span><div class="seg">${KINDS.map(([k, name]) =>
      `<button data-do="kind" data-v="${k}" class="${k === d.kind ? 'on' : ''}">${name}</button>`).join('')}</div>
      <small>${KINDS.find(k => k[0] === d.kind)![2]}</small></div>
    ${d.kind === 'count' ? `<label class="field"><span>Unit</span><input data-f="unit" value="${esc(d.unit)}" placeholder="glass, page, km…" autocomplete="off"></label>` : ''}
    ${d.kind === 'session' ? `
    <div class="field"><span>Steps</span>
      <label class="inline">Repeat <input data-f="rounds" type="number" min="1" inputmode="numeric" value="${d.rounds}"> times</label>
      ${stepRows('steps', d.steps)}
    </div>
    <div class="field"><span>Then, once</span>${stepRows('after', d.after)}
      <small>Total: ${Math.floor(total / 60)} min ${total % 60} s</small></div>` : ''}
    <label class="field"><span>Rhythm</span><select data-f="rhythm">${RHYTHMS.map(([r, name]) =>
      `<option value="${r}" ${r === d.rhythm ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
    ${d.rhythm === 'days' ? `<div class="field"><span>Days</span><div class="seg days">${DAY_NAMES.map((n, i) =>
      `<button data-do="wd" data-v="${i}" class="${d.weekdays.includes(i) ? 'on' : ''}">${n[0]}</button>`).join('')}</div></div>` : ''}
    ${needsTarget ? `<label class="field"><span>${targetLabel}</span><input data-f="target" type="number" min="1" inputmode="numeric" value="${d.target}"></label>` : ''}
    ${dayLevel ? `<label class="field"><span>Part of day</span><select data-f="part"><option value="">All day</option>${parts.map(p =>
      `<option value="${p.id}" ${p.id === d.part ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
    ${d.kind !== 'avoid' ? `<label class="check"><input data-f="optional" type="checkbox" ${d.optional ? 'checked' : ''}>Optional: never shows as skipped</label>` : ''}
    <p class="err" role="alert"></p>
  </div>
  <footer>${d.id ? '<button class="danger" data-do="delete">Delete</button>' : ''}<span></span>
    <button data-do="close">Cancel</button><button class="primary" data-do="save">Save</button></footer>`;
}

/** Slides the sheet away; its content is cleared once it is out of sight. */
export function closeSheet(host: EditorHost): void {
  host.sheet.classList.remove('open');
  setTimeout(() => { if (!sheetOpen(host)) host.sheet.replaceChildren(); }, 320);
}
export const sheetOpen = (host: EditorHost): boolean => host.sheet.classList.contains('open');

function panel(host: EditorHost): HTMLElement {
  host.sheet.replaceChildren();
  const p = document.createElement('div');
  p.className = 'panel';
  host.sheet.appendChild(p);
  void host.sheet.offsetHeight;          // let the browser see the panel off screen first, so it slides up
  host.sheet.classList.add('open');
  host.sheet.onclick = e => { if (e.target === host.sheet) closeSheet(host); };
  return p;
}

/** The list of counters, with a way to add one. */
export function openCounters(host: EditorHost): void {
  const p = panel(host), db = host.db;
  p.innerHTML = `
  <header><h2>Counters</h2><button data-do="close" aria-label="Close">×</button></header>
  <div class="list">${db.counters.map(c => `
    <button class="crow" data-do="edit" data-id="${esc(c.id)}"><i style="--c:var(--c-${c.color})"></i>
      <b>${esc(c.name)}</b><small>${esc(rhythmText(c, db.openPlan(c.id)))}</small></button>`).join('')
    || '<p class="empty">No counters yet. Add the first thing you want to keep count of.</p>'}</div>
  <footer><span></span><button class="primary" data-do="new">+ New counter</button></footer>`;
  p.onclick = e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-do]'); if (!b) return;
    if (b.dataset.do === 'close') closeSheet(host);
    else if (b.dataset.do === 'new') openEditor(host, null, {}, true);
    else if (b.dataset.do === 'edit') openEditor(host, b.dataset.id!, {}, true);
  };
}

/** The form for one counter; `id` null makes a new one. */
export function openEditor(host: EditorHost, id: Id | null, preset: { part?: string } = {}, fromList = false): void {
  const p = panel(host), db = host.db, d = { ...draftOf(db, id), ...(id ? {} : preset) };
  const draw = (): void => { p.innerHTML = formHtml(d, db.settings.parts); };
  const listOf = (e: HTMLElement): Step[] => (e.dataset.list === 'after' ? d.after : d.steps);
  draw();
  if (!id) p.querySelector<HTMLInputElement>('[data-f="name"]')?.focus();

  // typing updates the draft without redrawing, so the caret stays put
  p.oninput = e => {
    const t = e.target as HTMLInputElement | HTMLSelectElement, f = t.dataset.f; if (!f) return;
    const num = (): number => Math.max(1, Math.round(Number(t.value)) || 1);
    if (t.dataset.list) {
      const s = listOf(t)[Number(t.dataset.i)]!;
      if (f === 'name') s.name = t.value; else if (f === 'seconds') s.seconds = num(); else s.rest = (t as HTMLInputElement).checked || undefined;
    } else if (f === 'name') d.name = t.value;
    else if (f === 'unit') d.unit = t.value;
    else if (f === 'rounds') d.rounds = num();
    else if (f === 'target') d.target = num();
    else if (f === 'part') d.part = t.value;
    else if (f === 'optional') d.optional = (t as HTMLInputElement).checked;
    else if (f === 'rhythm') { d.rhythm = t.value as Rhythm; draw(); }
  };
  p.onclick = e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-do]'); if (!b) return;
    const act = b.dataset.do!, i = Number(b.dataset.i);
    if (act === 'close') { if (fromList) openCounters(host); else closeSheet(host); return; }      // back to where it was opened from
    if (act === 'color') d.color = b.dataset.v as ColorKey;
    else if (act === 'kind') { d.kind = b.dataset.v as ItemKind; if (d.kind === 'avoid' && d.rhythm === 'days') d.rhythm = 'daily'; }
    else if (act === 'wd') { const v = Number(b.dataset.v); d.weekdays = d.weekdays.includes(v) ? d.weekdays.filter(x => x !== v) : [...d.weekdays, v].sort(); }
    else if (act === 'add') listOf(b).push({ name: '', seconds: 30 });
    else if (act === 'del') listOf(b).splice(i, 1);
    else if (act === 'up') { const l = listOf(b); [l[i - 1], l[i]] = [l[i]!, l[i - 1]!]; }
    else if (act === 'delete') {
      if (confirm('Delete "' + d.name + '" and everything logged for it? This cannot be undone.')) { db.deleteCounter(id!); closeSheet(host); }
      return;
    } else if (act === 'save') { const err = save(host, d); if (err) p.querySelector('.err')!.textContent = err; else closeSheet(host); return; }
    draw();
  };
}

/** Writes the draft to the database. Returns a message if it cannot be saved. */
function save(host: EditorHost, d: Draft): string | null {
  const db = host.db, name = d.name.trim();
  if (!name) return 'Give it a name.';
  if (d.kind === 'session') {
    if (!d.steps.length) return 'A circuit needs at least one step.';
    if ([...d.steps, ...d.after].some(s => !s.name.trim())) return 'Every step needs a name.';
  }
  if (d.rhythm === 'days' && !d.weekdays.length) return 'Pick at least one day.';
  const old = d.id ? db.counters.find(c => c.id === d.id) : undefined;
  const clean = (l: Step[]): Step[] => l.map(s => ({ name: s.name.trim(), seconds: s.seconds, ...(s.rest ? { rest: true } : {}) }));
  const c: Counter = {
    id: old?.id ?? newId('c'), order: old?.order ?? db.counters.reduce((a, x) => Math.max(a, x.order), -1) + 1, createdAt: old?.createdAt ?? Date.now(),
    name, color: d.color, measure: d.kind === 'count' || d.kind === 'avoid' ? 'count' : 'check', intent: d.kind === 'avoid' ? 'avoid' : 'do',
    ...(old?.short && old.name === name ? { short: old.short } : {}),
    ...(d.optional && d.kind !== 'avoid' ? { optional: true } : {}),
    ...(d.kind === 'count' && d.unit.trim() ? { unit: d.unit.trim() } : {}),
    ...(d.kind === 'session' ? { sequence: { rounds: d.rounds, steps: clean(d.steps), ...(d.after.length ? { after: clean(d.after) } : {}) } } : {}),
  };
  const dayLevel = d.rhythm === 'daily' || d.rhythm === 'days';
  const spec: PlanSpec | null = d.rhythm === 'none' ? null : {
    level: dayLevel ? 'day' : d.rhythm as 'week' | 'month', clock: 'calendar',
    target: dayLevel && (d.kind === 'check' || d.kind === 'session') ? 1 : Math.max(1, d.target),
    ...(d.rhythm === 'days' ? { weekdays: [...d.weekdays].sort() } : {}),
    ...(dayLevel && d.part ? { part: d.part } : {}),
  };
  db.saveCounter(c);
  db.setPlan(c.id, spec, host.todayKey);
  return null;
}
