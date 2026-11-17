// The running app: state, the DOM view, the session clock and input.
// layout() decides where everything is; this file writes it to the page and turns gestures into state.

import { atMinute, dayOfYear, daysInMonth, daysInYear, keyOfMs, minutesOfDay, MONTHS, parseKey } from '../model/dates.ts';
import { buildDay, monthSummary, partAt, step5, type DayModel } from '../model/derive.ts';
import type { DayKey } from '../model/types.ts';
import type { Db } from '../store/db.ts';
import { seed } from '../store/seed.ts';
import { clamp, ease, hhmm, lerp, mmss, smooth, spanText } from '../util.ts';
import { HEAD, layout, P, stepId, type Box, type Layout } from './layout.ts';
import { buildYear, syncItems, type AnyNode, type Cell, type ItemNode, type KidView } from './tree.ts';

/** A circuit being played. Kept after it ends so its rows can settle; replaced when it is played again. */
interface Run { idx: number; t: number; playing: boolean; cur: number[]; p: number[]; prog: number }
type Key = 'z' | 'f0' | 'f1' | 'f2' | 'f3';
const fKey = (l: number): Key => ('f' + l) as Key;

const el = (tag: string, cls: string, parent: Element | null, html?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};
const byIdEl = (id: string): HTMLElement => document.getElementById(id)!;
const px = (v: number): string => (Math.round(v * 10) / 10) + 'px';
const boxKeys = new WeakMap<HTMLElement, string>();
function place(e: HTMLElement, x: number, y: number, w: number, h: number): void {
  const key = px(x) + ',' + px(y) + '|' + px(Math.max(0, w)) + '|' + px(Math.max(0, h));
  if (boxKeys.get(e) === key) return;
  boxKeys.set(e, key);
  e.style.transform = 'translate(' + px(x) + ',' + px(y) + ')';
  e.style.width = px(Math.max(0, w)); e.style.height = px(Math.max(0, h));
}

export function start(db: Db): void {
  const stage = byIdEl('stage'), surface = byIdEl('surface'), nowEl = byIdEl('now'), ctl = byIdEl('ctl');
  const playBtn = ctl.querySelector<HTMLElement>('.play')!, menu = byIdEl('menu'), fileInput = byIdEl('file') as HTMLInputElement;
  const crumbs = [0, 1, 2, 3].map(l => { const b = el('button', 'crumb', byIdEl('crumbs')); b.dataset.act = 'crumb'; b.dataset.l = String(l); return b; });

  /* ---- the clock and the derived days ---- */
  let nowMs = Date.now(), nowMin = minutesOfDay(nowMs);
  const todayKey = keyOfMs(nowMs), todayDate = parseKey(todayKey);
  const models = new Map<DayKey, DayModel>();
  const modelOf = (key: DayKey): DayModel => {
    let m = models.get(key);
    if (!m) { m = buildDay({ counters: db.counters, plans: db.plans, settings: db.settings, ticksOn: db.ticksOn, todayKey }, key); models.set(key, m); }
    return m;
  };
  const tree = buildYear(todayDate.getFullYear(), todayKey, modelOf);
  const root = tree.root, today = tree.today, todayWeek = today.parent!, todayMonth = todayWeek.parent!;

  /* ---- state: depth, the focused child at each level (month, week, day, item), the filter ---- */
  const S = { filter: 'all', z: 3, f0: todayMonth.k, f1: todayWeek.k, f2: today.k, f3: 0, rb: 0 };
  let W = 0, H = 0, dirty = true, L: Layout = {};
  const tweens: Partial<Record<Key, { from: number; to: number; t0: number; ms: number }>> = {};
  function glide(key: Key, to: number, ms?: number): void {
    if (Math.abs(S[key] - to) < 1e-4) { delete tweens[key]; return; }
    tweens[key] = { from: S[key], to, t0: performance.now(), ms: ms ?? P.glide };
  }
  function setDirect(key: Key, v: number): void { delete tweens[key]; S[key] = v; dirty = true; }
  function focusCell(l: number): Cell {
    let n = root;
    for (let j = 0; j < l && j < 3; j++) n = n.kids[clamp(Math.round(S[fKey(j)]), 0, n.kids.length - 1)]!;
    return n;
  }
  const focusItem = (): ItemNode | undefined => { const d = focusCell(3); return d.items[clamp(Math.round(S.f3), 0, d.items.length - 1)]; };
  /** The open node at a depth: a cell for 0..3, the focused item for 4. */
  const focusAt = (l: number): AnyNode | undefined => (l >= 4 ? focusItem() : focusCell(l));
  const kidCount = (l: number): number => (l >= 3 ? focusCell(3).items.length : focusCell(l).kids.length);
  const clearSigs = (n: Cell | null): void => { for (; n; n = n.parent) n.sig = ''; };

  /* ---- runs ---- */
  const runs = new Map<string, Run>();
  let running: ItemNode | null = null;
  const runOf = (it: ItemNode): Run | undefined => runs.get(it.model.id);
  const live = (r: Run | undefined, it: ItemNode): r is Run => !!r && r.idx >= 0 && r.idx < it.model.steps.length;
  const stepP = (it: ItemNode, j: number): number => runOf(it)?.p[j] ?? it.model.steps[j]!.p;

  /* ---- DOM, built lazily: a node gets its element the first time it is on screen ---- */
  const filters: [string, string, string][] = [['all', 'All', 'var(--ink)'], ...db.counters.map((c): [string, string, string] => [c.id, c.short ?? c.name, 'var(--c-' + c.color + ')'])];
  const colorOf = (filter: string): string => (filter === 'all' ? 'var(--good)' : 'var(--c-' + (db.counters.find(c => c.id === filter)?.color ?? 'slate') + ')');

  function monthText(m: Cell): string {
    const days: DayModel[] = [];
    m.kids.forEach(w => w.kids.forEach(d => { if (!d.out) days.push(d.model!); }));
    return monthSummary(days, S.filter, db.counters);
  }
  function paintDay(d: Cell): void {
    if (!d.el) return;
    d.el.style.setProperty('--sc', String(step5(d.model!.vals[S.filter])));
    d.el.style.setProperty('--hc', colorOf(S.filter));
  }
  function setFilter(k: string): void {
    S.filter = k;
    tree.byId.forEach(n => {
      if (n.lvl === 4) return;
      n.sig = '';
      if (n.lvl === 3) paintDay(n); else if (n.lvl === 1 && n.sum) n.sum.textContent = monthText(n);
    });
    if (root.legend) [...root.legend.children].forEach(b => b.classList.toggle('on', (b as HTMLElement).dataset.key === k));
    dirty = true;
  }

  function ensureCell(n: Cell): void {
    if (n.el) return;
    const future = n.lvl === 3 && !n.model!.past && !n.model!.today;
    n.el = el('div', 'node l' + n.lvl + (n.lvl === 3 && n.model!.today ? ' today' : '') + (future ? ' future' : ''), n.parent ? n.parent.body! : surface);
    el('div', 'bg', n.el);
    if (n.lvl === 3) n.heat = el('div', 'heat', n.el);
    n.lab = el('div', 'lab', n.el, n.label);
    n.body = el('div', 'nbody', n.el);
    if (n.lvl === 1) n.sum = el('div', 'sum', n.el, monthText(n));
    if (n.lvl === 0) {               // the year's title bar carries the counter filter
      n.legend = el('div', 'legend', n.el);
      filters.forEach(([k, name, color]) => {
        const b = el('button', k === S.filter ? 'on' : '', n.legend!, name);
        b.dataset.act = 'filter'; b.dataset.key = k; b.style.setProperty('--c', color);
      });
    }
    n.el.dataset.id = n.id;
    if (n.lvl === 3) paintDay(n);
  }
  function ensureItem(it: ItemNode): void {
    if (it.el) return;
    const c = it.model.counter;
    it.el = el('div', 'item' + (it.hasKids ? ' haskids' : '') + (it.model.optional ? ' optional' : ''), it.parent.body!);
    it.el.style.setProperty('--c', 'var(--c-' + c.color + ')');
    el('div', 'card', it.el);
    it.mark = el('div', 'mark', it.el, '<i></i>');
    it.num = el('b', '', it.mark);
    el('div', 'name', it.el).textContent = c.name;
    it.meas = el('div', 'meas', it.el);
    it.btn = el('button', 'btn' + (it.model.kind === 'check' ? ' fillable' : ''), it.el);
    it.body = el('div', 'item-body', it.el);
    it.body.style.display = 'none';
    it.el.dataset.id = it.id;
    sync(it);
  }
  function ensureKid(it: ItemNode, j: number): KidView {
    let k = it.kids[j];
    if (!k) {
      const e = el('div', 'kid', it.body!);
      e.dataset.j = String(j);
      k = { el: e, fill: el('div', 'kf', e), label: el('div', 'kl', e), right: el('div', 'kr', e), count: it.model.kind === 'session' ? el('div', 'kc', e) : null };
      it.kids[j] = k;
    }
    return k;
  }
  /** Brings an item's step rows in line with its model. */
  function syncKids(it: ItemNode): void {
    if (!it.body) return;
    const steps = it.model.steps;
    steps.forEach((s, j) => {
      const k = ensureKid(it, j);
      k.el.classList.toggle('rest', !!s.rest);
      k.el.classList.toggle('tick', !!s.tickId);
      k.label.textContent = s.label;
      if (s.sub) el('small', '', k.label).textContent = s.sub;
      if (k.right.textContent !== s.right) k.right.textContent = s.right;
    });
    while (it.kids.length > steps.length) it.kids.pop()!.el.remove();
  }

  /** What an item shows about itself: its mark fill, its measure, its action. */
  function sync(it: ItemNode): void {
    const m = it.model, run = runOf(it);
    let p = 0, meas = '', glyph = '✓', num = '';
    if (m.kind === 'check') {
      p = m.done ? 1 : 0;
      meas = m.done ? hhmm(minutesOfDay(m.ticks[0]!.at)) : m.missed ? 'skipped' : m.optional ? 'optional' : '';
    } else if (m.kind === 'count') {
      p = clamp(m.n / Math.max(1, m.target), 0, 1); meas = m.n + ' / ' + m.target; glyph = '+1';
    } else if (m.kind === 'avoid') {
      const last = m.ticks[m.ticks.length - 1];
      p = m.n ? 1 : 0; num = m.n ? String(m.n) : ''; glyph = '+1';
      meas = !last ? 'none' : m.n + (it.parent.model!.today ? ' · ' + spanText((nowMs - last.at) / 60000) + ' since last' : ' that day');
    } else {
      const steps = m.steps, seq = m.counter.sequence!;
      if (live(run, it)) {
        let left = steps[run.idx]!.seconds! - run.t;
        for (let j = run.idx + 1; j < steps.length; j++) left += steps[j]!.seconds!;
        p = run.prog = 1 - left / m.seconds;
        const inRounds = run.idx < seq.rounds * seq.steps.length;
        meas = (inRounds ? 'Round ' + (Math.floor(run.idx / seq.steps.length) + 1) + '/' + seq.rounds : steps[run.idx]!.label) + ' · ' + mmss(left);
        glyph = run.playing ? '❚❚' : '▶';
      } else if (m.done) {
        const took = m.ticks[m.ticks.length - 1]?.seconds ?? m.seconds;
        p = 1; meas = 'Done · ' + Math.round(took / 60) + ' min'; glyph = '↺';
      } else { p = 0; meas = m.missed ? 'skipped' : Math.round(m.seconds / 60) + ' min'; glyph = '▶'; }
    }
    if (!it.el) return;
    it.el.style.setProperty('--p', String(p));
    it.el.classList.toggle('done', m.done);
    it.el.classList.toggle('missed', m.missed && !m.done);
    if (it.meas!.textContent !== meas) it.meas!.textContent = meas;
    if (it.btn!.textContent !== glyph) it.btn!.textContent = glyph;
    it.num!.textContent = num;
    syncKids(it);
  }

  /** A change in the log: rebuild those days, and repaint every place they show. */
  function refreshDays(keys: DayKey[]): void {
    keys.forEach(key => {
      models.delete(key);
      const model = modelOf(key);
      (tree.daysByKey.get(key) ?? []).forEach(d => {
        d.model = model;
        syncItems(d, tree.byId);
        d.items.forEach(it => { it.shown = undefined; if (it.el) sync(it); });
        paintDay(d);
        clearSigs(d);
        const m = d.out ? null : d.parent!.parent!;
        if (m?.sum) m.sum.textContent = monthText(m);
      });
    });
    dirty = true;
  }
  db.onChange(c => { if ('all' in c) location.reload(); else refreshDays(c.days); });

  /* ---- apply: write the layout to the page ---- */
  const vis = (n: Cell, on: boolean): void => { if (!!n.off === on) { n.el!.style.display = on ? '' : 'none'; n.off = !on; } };

  function applyCell(n: Cell): void {
    const s = L[n.id];
    if (!s) { if (n.el) vis(n, false); return; }
    ensureCell(n); vis(n, true);
    const e = n.el!, lab = n.lab!, body = n.body!;
    // a closed cell whose own numbers did not move has an unchanged inside: skip the whole branch
    const sig = s.m === 0 && s.tz === 0 ? px(s.x) + px(s.y) + px(s.w) + px(s.h) + s.r.toFixed(3) : '';
    if (sig && sig === n.sig) return;
    n.sig = sig;
    if (n.out) e.style.opacity = s.r.toFixed(3);
    place(e, s.x, s.y, s.w, s.h);
    e.style.setProperty('--r', s.r.toFixed(3)); e.style.setProperty('--m', s.m.toFixed(3));
    // the label shows when there is room for it; a title leaves upward and fades as its cell is zoomed past
    const asMark = n.lvl === 3 ? smooth(16, 26, s.w) * smooth(18, 30, s.h) : 0;
    const lo = (n.lvl === 0 ? 1 : lerp(asMark * clamp(1 - s.r * 3, 0, 1), smooth(15, 22, s.h) * smooth(70, 110, s.w), smooth(0.6, 0.95, s.r))) * clamp(1 - s.tz * 1.8, 0, 1);
    lab.style.opacity = lo.toFixed(3);
    if (lo > 0.01) lab.style.transform = 'translate(' + px(lerp(3, 14, s.r)) + ',' + px(lerp(lerp(1, (s.h - 20) / 2, s.r), 10 - 34 * s.tz, s.pa)) + ')';
    place(body, 0, s.by, s.w, s.bh);
    if (n.lvl === 1) {
      const so = s.r * clamp(1 - s.m * 4, 0, 1) * smooth(20, 30, s.h);
      n.sum!.style.opacity = so.toFixed(3);
      if (so > 0.01) n.sum!.style.transform = 'translateY(' + px((s.h - 16) / 2) + ')';
    }
    if (n.lvl === 0) {
      const lg = clamp(1 - s.tz * 2.5, 0, 1), legend = n.legend!;
      legend.style.opacity = lg.toFixed(3); legend.style.pointerEvents = lg > 0.5 ? 'auto' : 'none';
      legend.style.transform = 'translateY(' + px(-34 * s.tz) + ')';
    }
    if (n.lvl < 3) { n.kids.forEach(applyCell); return; }
    applyDay(n, s);
  }

  function applyDay(n: Cell, s: Box): void {
    const body = n.body!, first = n.items[0];
    const shown = !!first && !!L[first.id], iv = shown ? smooth(14, 26, s.w) : 0;
    const one = S.filter !== 'all';      // with a counter picked, the cell colour leads and the item pips step back
    n.heat!.style.opacity = (clamp(1 - s.r * 3, 0, 1) * (1 - (one ? 0.1 : 0.8) * iv)).toFixed(3);
    if (shown !== !n.bodyOff) { body.style.display = shown ? '' : 'none'; n.bodyOff = !shown; }
    if (!shown) return;
    body.style.opacity = lerp(iv * (one ? 0.3 : 1), 1, s.r).toFixed(3);
    n.parts.forEach(p => {
      const q = L[p.id]; if (!q) return;
      p.el ??= el('div', 'part', body, p.name);
      place(p.el, q.x, q.y, q.w, q.h); p.el.style.opacity = q.o.toFixed(3);
    });
    n.items.forEach(it => {
      const q = L[it.id]; if (!q) return;
      ensureItem(it);
      const e = it.el!, st = e.style, ib = it.body!;
      place(e, q.x, q.y, q.w, q.h);
      st.setProperty('--r', q.r.toFixed(3)); st.setProperty('--m', q.m.toFixed(3)); st.setProperty('--co', q.co.toFixed(3));
      st.setProperty('--s', px(q.s)); st.setProperty('--sn', q.s.toFixed(1)); st.setProperty('--mx', px(q.mx)); st.setProperty('--my', px(q.my));
      e.classList.toggle('row', q.co > 0.6);
      const show = q.co > 0.02 && it.hasKids;
      if (show !== it.shown) { ib.style.display = show ? '' : 'none'; it.shown = show; }
      if (!show) return;
      place(ib, 0, q.by, q.w, q.bh);
      ib.style.opacity = q.co.toFixed(3);
      it.model.steps.forEach((_, j) => {
        const c = L[stepId(it, j)]; if (!c) return;
        const k = ensureKid(it, j), p = stepP(it, j);
        place(k.el, c.x, c.y, c.w, c.h);
        k.el.style.setProperty('--m', c.m.toFixed(3)); k.el.style.setProperty('--cur', c.cur.toFixed(3)); k.el.style.setProperty('--co', c.co.toFixed(3));
        // the fill keeps a constant area p while it turns from a left-to-right bar into a top-to-bottom one
        k.fill.style.width = (p <= 0 ? 0 : Math.pow(p, 1 - c.m) * 100) + '%';
        k.fill.style.height = (p <= 0 ? 0 : Math.pow(p, c.m) * 100) + '%';
      });
    });
  }

  function apply(): void {
    L = layout(root, { z: S.z, f: [S.f0, S.f1, S.f2, S.f3], W, H, cur: it => runOf(it)?.cur ?? null });
    applyCell(root);
    placeNow();
    const it = focusItem(), o = it?.model.kind === 'session' ? smooth(3.5, 3.92, S.z) : 0;
    ctl.style.opacity = String(o); ctl.style.pointerEvents = o > 0.5 ? 'auto' : 'none';
    const g = it && runOf(it)?.playing ? '❚❚' : '▶';
    if (playBtn.textContent !== g) playBtn.textContent = g;
    crumbs.forEach((b, l) => {
      const co = clamp((S.z - l) * 1.7 - 0.35, 0, 1), txt = focusCell(l).crumb;
      b.style.opacity = String(co); b.style.maxWidth = px(co * 90); b.style.pointerEvents = co > 0.5 ? 'auto' : 'none';
      if (b.textContent !== txt) b.textContent = txt;
    });
  }

  /* the single now line: at every level it sits at "how far through this cell we are",
     and hands over to the child cell as that cell opens */
  function nowIn(n: Cell, top: number): number | null {
    const s = L[n.id]; if (!s) return null;
    const tf = nowMin / 1440, y = todayDate.getFullYear();
    const frac = n.lvl === 0 ? (dayOfYear(todayDate) - 1 + tf) / daysInYear(y)
      : n.lvl === 1 ? (todayDate.getDate() - 1 + tf) / daysInMonth(y, n.mi)
      : n.lvl === 2 ? (today.k + tf) / 7 : tf;
    const yFrac = top + frac * s.h;
    if (s.m < 0.001) return yFrac;
    if (n.lvl === 3) return lerp(yFrac, nowInDay(n, top, s), s.m);
    const c = n.lvl === 0 ? todayMonth : n.lvl === 1 ? todayWeek : today, cs = L[c.id];
    const yc = cs ? nowIn(c, top + s.by + cs.y) : null;
    if (yc == null) return s.m > 0.5 ? null : yFrac;      // today's cell is far off screen: no line
    return lerp(yFrac, yc, s.m);
  }
  function nowInDay(d: Cell, top: number, s: Box): number {
    const part = Math.max(1, partAt(db.settings, nowMin));
    const before = d.items.find(it => it.model.part >= part && !it.model.done), last = d.items[d.items.length - 1];
    let y = top + s.by;
    if (before) {
      const b = L[before.id], firstOfPart = d.items.find(it => it.model.part === before.model.part) === before;
      const ph = firstOfPart ? L[d.id + 'p' + before.model.part] : undefined;
      if (b) y += ph ? ph.y + ph.h * 0.25 : b.y - 3;
    } else if (last && L[last.id]) { const b = L[last.id]!; y += b.y + b.h + 4; }   // everything is done: the line sits after the list
    const playing = d.items.find(it => live(runOf(it), it));
    if (playing && S.rb > 0.001) {
      const g = L[playing.id], r = runOf(playing)!;
      if (g) {
        const iTop = top + s.by + g.y, c = L[stepId(playing, r.idx)];
        let yRun = iTop + r.prog * g.h;
        if (c) yRun = lerp(yRun, iTop + g.by + c.y + (r.p[r.idx] ?? 0) * c.h, g.m);
        y = lerp(y, yRun, S.rb);
      }
    }
    return y;
  }
  function placeNow(): void {
    const y = nowIn(root, HEAD), ds = L[today.id], ms = L[todayMonth.id];
    const on = y != null && y > HEAD + 1 && y < H - 1;
    nowEl.style.opacity = on ? '1' : '0';
    if (on) nowEl.style.transform = 'translateY(' + px(y) + ')';
    const stamp = nowEl.firstElementChild as HTMLElement, txt = hhmm(nowMin);
    if (stamp.textContent !== txt) stamp.textContent = txt;
    stamp.style.opacity = String(ds ? clamp(ds.m * 2 - 1, 0, 1) * (1 - S.rb) : 0);
    // in the year view today's ring is enough: the line itself only appears once the month opens
    nowEl.style.setProperty('--la', (ms ? smooth(0.05, 0.6, ms.m) : 0).toFixed(3));
  }

  /* ---- session clock ---- */
  function startRun(it: ItemNode): void {
    let r = runOf(it);
    if (!live(r, it)) {
      const n = it.model.steps.length;
      r = { idx: 0, t: 0, playing: false, cur: new Array<number>(n).fill(0), p: new Array<number>(n).fill(0), prog: 0 };
      runs.set(it.model.id, r);
    }
    const other = running && runOf(running);
    if (other && running !== it) other.playing = false;
    r.playing = true; running = it; sync(it);
  }
  function resetRun(it: ItemNode): void {
    runs.delete(it.model.id);
    it.kids.forEach(k => { if (k.count) k.count.textContent = ''; });
    if (running === it) running = null;
    sync(it);
  }
  function skipStep(it: ItemNode): void {
    const r = runOf(it);
    if (live(r, it)) { r.t = it.model.steps[r.idx]!.seconds!; if (!r.playing) stepRun(it, 0); }
  }
  function stepRun(it: ItemNode, dt: number): void {
    const r = runOf(it); if (!r) return;
    const steps = it.model.steps, n = steps.length;
    r.t += dt;
    while (r.idx < n && r.t >= steps[r.idx]!.seconds!) { r.t -= steps[r.idx]!.seconds!; r.p[r.idx] = 1; r.idx++; }
    if (r.idx >= n) {
      r.playing = false; r.t = 0; r.prog = 1;
      const day = it.parent.model!;
      // the session goes into the log: now if it is today's, else at midday of the day it was played for
      db.addTick({ counterId: it.model.counter.id, at: day.today ? Date.now() : atMinute(day.key, 12 * 60), seconds: it.model.seconds });
      if (S.z > 3.5 && focusItem() === it) setTimeout(() => glide('z', 3, P.glide * 1.3), 500);   // fold back into the day
      return;
    }
    r.p[r.idx] = r.t / steps[r.idx]!.seconds!;
    const count = it.kids[r.idx]?.count, txt = mmss(steps[r.idx]!.seconds! - r.t);
    if (count && count.textContent !== txt) count.textContent = txt;
    sync(it);
  }

  /* ---- frame loop ---- */
  let last = performance.now();
  function frame(now: number): void {
    const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
    (Object.keys(tweens) as Key[]).forEach(key => {
      const t = tweens[key]!, u = clamp((now - t.t0) / t.ms, 0, 1);
      S[key] = lerp(t.from, t.to, ease(u)); dirty = true;
      if (u >= 1) delete tweens[key];
    });
    const rr = running && runOf(running);
    if (running && rr && rr.playing) { stepRun(running, dt); dirty = true; }
    let todayLive = false;
    runs.forEach((r, id) => {            // ease the "current step" weights
      const isLive = r.idx >= 0 && r.idx < r.cur.length;
      if (isLive && id.endsWith('@' + todayKey)) todayLive = true;
      for (let j = 0; j < r.cur.length; j++) {
        const target = isLive && j === r.idx ? 1 : 0, c = r.cur[j]!;
        if (Math.abs(target - c) > 0.002) { r.cur[j] = c + (target - c) * Math.min(1, dt * 9); dirty = true; }
        else r.cur[j] = target;
      }
    });
    const rbT = todayLive ? 1 : 0;
    if (Math.abs(rbT - S.rb) > 0.002) { S.rb += (rbT - S.rb) * Math.min(1, dt * 7); dirty = true; } else S.rb = rbT;
    if (dirty) { dirty = false; apply(); }
    requestAnimationFrame(frame);
  }
  // the wall clock: move the now line, refresh "since last", and start over at midnight
  setInterval(() => {
    nowMs = Date.now(); nowMin = minutesOfDay(nowMs);
    if (keyOfMs(nowMs) !== todayKey) { location.reload(); return; }
    (tree.daysByKey.get(todayKey) ?? []).forEach(d => d.items.forEach(it => { if (it.el && it.model.kind === 'avoid') sync(it); }));
    dirty = true;
  }, 20000);

  /* ---- input ---- */
  const nodeAt = (t: Element | null): AnyNode | undefined => {
    const e = t?.closest<HTMLElement>('[data-id]');
    return e ? tree.byId.get(e.dataset.id!) : undefined;
  };
  const upTo = (n: AnyNode | undefined, lvl: number): AnyNode | undefined => {
    while (n && n.lvl > lvl) n = n.parent ?? undefined;
    return n;
  };

  // when a zoom starts at a resting depth, the cell under the fingers becomes the focus
  function pickFocus(x: number, y: number): void {
    const Lc = Math.floor(S.z + 1e-6);
    if (Lc > 3 || S.z - Lc > 0.08) return;
    const n = upTo(nodeAt(document.elementFromPoint(x, y)), Lc + 1);
    if (n && n.lvl === Lc + 1 && n.parent === focusAt(Lc)) setDirect(fKey(Lc), n.k);
    else if (Lc === 3) pickDefaultItem();
  }
  function pickDefaultItem(): void {
    const d = focusCell(3), cur = focusItem();
    if (cur && !cur.hasKids) setDirect('f3', Math.max(0, d.items.findIndex(it => it.hasKids)));
  }
  function zoomTo(z: number, x: number, y: number): void {
    const before = S.z;
    setDirect('z', clamp(z, 0, 4));
    if (Math.floor(S.z + 1e-6) > Math.floor(before + 1e-6)) pickFocus(x, y);
  }
  function settle(): void {
    const r = Math.round(S.z);
    if (Math.abs(S.z - r) < P.snap) glide('z', r, 240);
  }

  let seq = 0, wheelT = 0;
  stage.addEventListener('wheel', e => {
    e.preventDefault(); seq++;
    if (!wheelT) pickFocus(e.clientX, e.clientY);
    zoomTo(S.z - e.deltaY * (e.ctrlKey ? 0.012 : 0.0032), e.clientX, e.clientY);
    clearTimeout(wheelT); wheelT = window.setTimeout(() => { wheelT = 0; settle(); }, 170);
  }, { passive: false });

  interface Gesture { mode: 'tap' | 'pinch' | 'drag' | 'none'; x: number; y: number; t: number; target: Element | null; d0: number; z0: number; key: Key; max: number; start: number; dy: number }
  const ptrs = new Map<number, { x: number; y: number }>();
  let g: Gesture | null = null;
  const mid = (): { x: number; y: number; d: number } => {
    const [a, b] = [...ptrs.values()] as [{ x: number; y: number }, { x: number; y: number }];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  };
  const gesture = (p: Partial<Gesture>): Gesture => ({ mode: 'none', x: 0, y: 0, t: 0, target: null, d0: 1, z0: 0, key: 'z', max: 0, start: 0, dy: 0, ...p });
  stage.addEventListener('pointerdown', e => {
    seq++;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) g = gesture({ mode: 'tap', x: e.clientX, y: e.clientY, t: performance.now(), target: e.target as Element });
    if (ptrs.size === 2) { const c = mid(); pickFocus(c.x, c.y); g = gesture({ mode: 'pinch', d0: c.d, z0: S.z }); }
  });
  window.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId) || !g) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.mode === 'pinch' && ptrs.size >= 2) { const c = mid(); zoomTo(g.z0 + Math.log2(c.d / g.d0) * 0.95, c.x, c.y); return; }
    if (g.mode === 'tap' && Math.abs(e.clientY - g.y) > 9) {
      const Lc = Math.round(S.z);
      g.mode = Lc >= 1 ? 'drag' : 'none';
      if (Lc >= 1) { g.key = fKey(Lc - 1); g.max = kidCount(Lc - 1) - 1; g.start = S[g.key]; g.y = e.clientY; }
      return;
    }
    if (g.mode === 'drag') {
      g.dy = e.clientY - g.y;
      setDirect(g.key, clamp(g.start - g.dy / (H * 0.55), 0, Math.max(0, g.max)));
    }
  });
  function pointerEnd(e: PointerEvent): void {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (!g) return;
    if (g.mode === 'pinch') { if (ptrs.size < 2) { settle(); g = gesture({}); } return; }
    if (g.mode === 'drag') {
      const at = Math.round(S[g.key]), flick = Math.abs(g.dy) > 45 ? (g.dy < 0 ? 1 : -1) : 0;
      if (at === Math.round(g.start) && flick) { setDirect(g.key, at); step(g.key, flick); }
      else glide(g.key, at, 320);
    } else if (g.mode === 'tap' && e.type === 'pointerup' && performance.now() - g.t < 450 && g.target) tap(g.target);
    g = null;
  }
  window.addEventListener('pointerup', pointerEnd);
  window.addEventListener('pointercancel', pointerEnd);

  // Step to the neighbouring cell. Weeks cross month ends: a straddling week has a copy in each month,
  // and the two copies look the same once opened, so we swap to the copy and carry on.
  function step(key: Key, dir: number): void {
    const l = Number(key[1]), max = kidCount(l) - 1, to = Math.round(S[key]) + dir;
    if (to >= 0 && to <= max) { glide(key, to, 320); return; }
    if (l === 2) { crossWeek(dir); return; }
    if (l !== 1) { glide(key, clamp(to, 0, Math.max(0, max)), 320); return; }
    const month = focusCell(1), cur = focusCell(2), twin = dir > 0 ? cur.twinNext : cur.twinPrev;
    const nm = root.kids[month.k + dir]; if (!nm) return;      // edge of the year
    const day = Math.round(S.f2);
    setDirect('f0', nm.k);
    setDirect('f1', twin ? twin.k : dir > 0 ? 0 : nm.kids.length - 1);
    setDirect('f2', day);
    if (twin) glide('f1', twin.k + dir, 320);
  }
  // Sunday to Monday (or back): the two days have different parents, so there is no direct slide.
  // Take the honest path instead: out to the week, across to the neighbouring week, back into the day.
  function crossWeek(dir: number): void {
    const wk = focusCell(2), month = wk.parent!;
    if (!month.kids[wk.k + dir] && !root.kids[month.k + dir]) return;      // edge of the year
    const id = ++seq, ms = 240;
    glide('z', 2, ms);
    setTimeout(() => {
      if (id !== seq) return;
      setDirect('z', 2);
      step('f1', dir);
      setDirect('f2', dir > 0 ? 0 : 6);              // invisible at week depth: all days share the height
      setTimeout(() => { if (id === seq) glide('z', 3, ms + 60); }, 340);
    }, ms + 20);
  }

  function tap(t: Element): void {
    const act = t.closest<HTMLElement>('[data-act]');
    if (act) { command(act.dataset.act!, act); return; }
    if (menu.classList.contains('open')) { menu.classList.remove('open'); return; }
    let n = nodeAt(t); if (!n) return;
    const Lc = clamp(Math.round(S.z), 0, 4), open = focusAt(Lc);
    if (t.closest('.btn') && n.lvl === 4 && n.el!.classList.contains('row')) { action(n); return; }
    n = upTo(n, Lc + 1)!;
    if (n.lvl === Lc + 1) {                       // a child of the open cell: go into it
      if (n.parent === open) {
        if (n.lvl === 4 && !n.hasKids) { action(n); return; }
        if (Math.abs(S.z - Lc) < 0.08) setDirect(fKey(Lc), n.k); else glide(fKey(Lc), n.k);
        glide('z', Lc + 1); return;
      }
      n = n.parent!;
    }
    if (n.lvl !== Lc || !open) return;
    if (n !== open) { if (n.parent === open.parent) glide(fKey(Lc - 1), n.k); return; }   // a sibling strip: move to it
    if (n.lvl === 4) {
      const kid = t.closest<HTMLElement>('.kid'), stepModel = kid ? n.model.steps[Number(kid.dataset.j)] : undefined;
      if (!kid) glide('z', 3);
      else if (stepModel?.tickId) db.removeTick(stepModel.tickId);       // tapping a logged row takes it back
      return;
    }
    const lab = t.closest('.lab');
    if (lab && lab.parentNode === n.el && Lc > 0) glide('z', Lc - 1);                      // the title: go back out
  }

  /** The item's own button: tick it, add one, or play it. */
  function action(it: ItemNode): void {
    const m = it.model, day = it.parent.model!;
    if (!day.past && !day.today) return;          // nothing can have happened on a day that has not come
    const at = day.today ? Date.now() : atMinute(day.key, 12 * 60);
    if (m.kind === 'check') {
      if (m.done) m.ticks.forEach(t => db.removeTick(t.id)); else db.addTick({ counterId: m.counter.id, at });
    } else if (m.kind === 'count' || m.kind === 'avoid') {
      db.addTick({ counterId: m.counter.id, at });
    } else {
      const r = runOf(it);
      if (r?.playing) { r.playing = false; sync(it); }
      else { startRun(it); setDirect('f3', it.k); glide('z', 4, P.glide * 1.25); }   // play: the item opens into its steps
    }
    dirty = true;
  }

  function command(a: string, e: HTMLElement): void {
    const it = focusItem();
    if (a !== 'menu') menu.classList.remove('open');
    if (a === 'crumb') glide('z', Number(e.dataset.l));
    else if (a === 'filter') setFilter(e.dataset.key!);
    else if (a === 'now') {
      const near = Math.round(S.f0) === todayMonth.k;
      ([['f0', todayMonth.k], ['f1', todayWeek.k], ['f2', today.k]] as [Key, number][]).forEach(([k, v]) => (near ? glide(k, v) : setDirect(k, v)));
      glide('z', 3);
    } else if (a === 'menu') menu.classList.toggle('open');
    else if (a === 'export') exportData();
    else if (a === 'import') fileInput.click();
    else if (a === 'sample') {
      if (confirm('Replace everything with the sample data? Export first if you want to keep what is here.')) void db.replace(seed(new Date()));
    } else if (it?.model.kind === 'session') {
      const r = runOf(it);
      if (a === 'play') { if (r?.playing) r.playing = false; else startRun(it); sync(it); }
      if (a === 'reset') resetRun(it);
      if (a === 'skip') skipStep(it);
    }
    dirty = true;
  }

  function exportData(): void {
    const blob = new Blob([JSON.stringify(db.export(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'tempo-' + todayKey + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]; if (!file) return;
    fileInput.value = '';
    if (!confirm('Replace everything here with the content of "' + file.name + '"?')) return;
    file.text().then(text => db.import(JSON.parse(text) as unknown))
      .catch((err: unknown) => alert('Import failed. ' + (err instanceof Error ? err.message : String(err))));
  });

  window.addEventListener('keydown', e => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'Enter') { const to = Math.min(4, Math.floor(S.z + 1.001)); if (to === 4) pickDefaultItem(); glide('z', to); }
    else if (k === 'ArrowLeft' || k === 'Escape') glide('z', Math.max(0, Math.ceil(S.z - 1.001)));
    else if (k === 'ArrowDown' || k === 'ArrowUp') {
      const Lc = Math.round(S.z); if (Lc < 1) return;
      step(fKey(Lc - 1), k === 'ArrowDown' ? 1 : -1);
    } else if (k === ' ') command('play', playBtn);
    else return;
    e.preventDefault();
  });

  function resize(): void {
    W = stage.clientWidth; H = stage.clientHeight;
    tree.byId.forEach(n => { if (n.lvl !== 4) n.sig = ''; });
    dirty = true;
  }
  window.addEventListener('resize', resize);
  resize();
  // for poking at it from the console
  (window as unknown as { tempo: unknown }).tempo = { S, db, tree, glide, setDirect, setFilter, apply, frame, monthOf: (i: number) => MONTHS[i], get L() { return L; } };
  requestAnimationFrame(frame);
}
