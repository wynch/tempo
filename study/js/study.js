/* Tempo — zoom motion study.
   One surface, one number: S.z is the depth (0 year, 1 month, 2 week, 3 day, 4 item).
   Every cell has three states: a mark inside its grandparent, a row inside its parent, and opened.
   layout() is a pure function of (z, focus path); apply() writes it to the DOM.
   Every in-between depth, and every fractional focus, is a real state. */
(() => {
'use strict';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a || 1e-6), 0, 1); return t * t * (3 - 2 * t); };
const ease = u => (u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const mmss = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const gap = m => (m >= 60 ? Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') : m + ' min');
const rng = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

/* ---- tunables ---- */
const P = { strip: 48, d0: 0.15, d1: 0.8, split: 0.5, glide: 460, snap: 0.18, fast: false };

/* ---- sample data: the year 2026, today is Wed 18 Nov, 17:40 ---- */
const NOW_MIN = 17 * 60 + 40, T_MONTH = 10, T_DOM = 18;
const MONTHS = [['Jan', 'uary'], ['Feb', 'ruary'], ['Mar', 'ch'], ['Apr', 'il'], ['May', ''], ['Jun', 'e'], ['Jul', 'y'], ['Aug', 'ust'], ['Sep', 'tember'], ['Oct', 'ober'], ['Nov', 'ember'], ['Dec', 'ember']];
const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PARTS = ['All day', 'Morning', 'Afternoon', 'Evening'];
const WATER_T = [470, 570, 670, 765, 845, 980, 1110, 1240];
const STEPS = 13, CIRCUIT_S = 480;
let uid = 0;
const byId = {}, runs = [];
const reg = n => (byId[n.id] = n);

// What a day's cell shows at coarse depths: one value per counter (0..1, or null when the counter does not apply),
// plus `all`, how well the day went overall. `raw` keeps the plain numbers for the month totals.
const FILTERS = [['all', 'All'], ['water', 'Water'], ['cig', 'Cigs'], ['meds', 'Meds'], ['gym', 'Gym'], ['stretch', 'Stretch']];
function dayVals(day) {
  const v = { all: 0, water: null, cig: null, meds: null, gym: null, stretch: null }, raw = {};
  if (day.past || day.today) {
    let sum = 0, cnt = 0;
    day.kids.forEach(it => {
      const n = it.type === 'avoid' ? (it.kids ? it.kids.length : it.times.length) : it.n;
      const val = it.type === 'count' ? n / it.target : it.type === 'avoid' ? clamp(n / 6, 0, 1) : it.done ? 1 : 0;
      v[it.key] = val; raw[it.key] = it.type === 'count' || it.type === 'avoid' ? n : it.done ? 1 : 0;
      if (!it.optional) { cnt++; sum += it.type === 'avoid' ? clamp(1 - (n - 1) / 6, 0, 1) : val; }
    });
    v.all = sum / cnt;
  }
  day.vals = v; day.raw = raw;
}
const step5 = v => (v == null || v <= 0 ? 0 : v < 0.25 ? 0.22 : v < 0.5 ? 0.45 : v < 0.8 ? 0.7 : 1);   // five clear steps read better than a smooth ramp
function monthSum(m) {
  const k = S.filter, days = []; m.kids.forEach(w => w.kids.forEach(d => { if (!d.out && (d.past || d.today)) days.push(d); }));
  if (!days.length) return '';
  if (k === 'all') return Math.round(days.reduce((a, d) => a + d.vals.all, 0) / days.length * 100) + '%';
  const on = days.filter(d => d.vals[k] != null); if (!on.length) return '';
  const tot = on.reduce((a, d) => a + d.raw[k], 0);
  return k === 'cig' ? String(tot) : k === 'water' ? (tot / on.length).toFixed(1) : tot + '/' + on.length;
}
function paintDay(d) {
  if (!d.el) return;
  d.el.style.setProperty('--sc', step5(d.vals[S.filter]));
  d.el.style.setProperty('--hc', 'var(--' + (S.filter === 'all' ? 'meds' : S.filter) + ')');
}
function setFilter(k) {
  S.filter = k;
  for (const id in byId) { const n = byId[id]; n.sig = ''; if (n.lvl === 3) paintDay(n); else if (n.lvl === 1 && n.sum) n.sum.textContent = monthSum(n); }
  if (root.legend) [...root.legend.children].forEach(b => b.classList.toggle('on', b.dataset.key === k));
  dirty = true;
}
function refreshDay(d) {
  dayVals(d); paintDay(d);
  const m = root.kids[d.mi]; if (m.sum) m.sum.textContent = monthSum(m);
  for (let n = d; n; n = n.parent) n.sig = '';
}

function mkItems(day, doy) {
  const r = rng(doy * 7919), past = day.past, today = day.today, items = [];
  const add = o => { o.id = 'i' + (uid++); o.lvl = 4; o.parent = day; o.k = items.length; o.hasKids = o.type !== 'check'; items.push(reg(o)); };
  add({ key: 'water', name: 'Water', type: 'count', part: 0, target: 8, n: today ? 3 : past ? 3 + Math.floor(r() * 6) : 0 });
  if (past || today) {
    const n = today ? 4 : 1 + Math.floor(r() * 6), times = [];
    for (let j = 0; j < n; j++) times.push(480 + Math.floor(r() * 840));
    add({ key: 'cig', name: 'Cigarettes', type: 'avoid', part: 0, times: today ? [570, 735, 890, 988] : times.sort((a, b) => a - b) });
  }
  const meds = today || (past && r() < 0.9);
  add({ key: 'meds', name: 'Meds', type: 'check', part: 1, done: meds, missed: past && !meds, at: '08:05' });
  if (day.wd === 0 || day.wd === 2 || day.wd === 4) {
    const done = past && r() < 0.78;
    add({ key: 'gym', name: 'Gym circuit', type: 'session', part: 2, done, missed: past && !done });
  }
  const st = past && r() < 0.4;
  add({ key: 'stretch', name: 'Stretch', type: 'check', part: 3, optional: true, done: st, missed: past && !st, at: '21:30' });
  day.kids = items; dayVals(day);
  day.parts = PARTS.map((name, pi) => ({ pi, name, id: day.id + 'p' + pi })).filter(p => items.some(it => it.part === p.pi));
  return items;
}

// steps of a session, slots of a count, ticks of an avoid: built the first time the item is shown
function hydrate(it) {
  if (it.kids) return;
  const mk = o => { o.id = 'k' + (uid++); return o; };
  if (it.type === 'count') it.kids = WATER_T.map((t, j) => mk({ label: j < it.n ? hhmm(t) : '—', right: 'glass ' + (j + 1), p: j < it.n ? 1 : 0 }));
  else if (it.type === 'avoid') it.kids = it.times.map((t, j) => mk({ min: t, label: hhmm(t), right: j ? gap(t - it.times[j - 1]) + ' after' : 'first', p: 1 }));
  else if (it.type === 'session') {
    it.kids = [];
    for (let r = 1; r <= 3; r++) it.kids.push({ label: 'Push-ups', sub: 'round ' + r, d: 40 }, { label: 'Rest', d: 20, rest: 1 }, { label: 'Squats', d: 40 }, { label: 'Rest', d: 20, rest: 1 });
    it.kids.push({ label: 'Cool down', d: 120 });
    it.kids.forEach(s => { mk(s); s.w = s.d; s.right = s.d + ' s'; s.p = it.done ? 1 : 0; });
    it.run = { idx: it.done ? it.kids.length : -1, t: 0, playing: false, cur: it.kids.map(() => 0) };
    runs.push(it);
  } else it.kids = [];
}

const root = reg({ id: 'y', lvl: 0, k: 0, kids: [], label: '<b>2026</b>', crumb: '2026' });
let todayDay = null;
(() => {
  // every day of the year, with its ISO week number (1 Jan 2026 is a Thursday)
  const all = []; let doy = 0, wd = 3;
  MONTHS.forEach((mn, mi) => { for (let dom = 1; dom <= DIM[mi]; dom++) { doy++; all.push({ doy, mi, dom, wd, no: Math.floor((doy - (wd + 1) + 10) / 7) }); wd = (wd + 1) % 7; } });
  const canon = {};
  MONTHS.forEach((mn, mi) => {
    const month = reg({ id: 'm' + mi, lvl: 1, k: mi, parent: root, kids: [], label: '<b>' + mn[0] + '</b><i>' + mn[1] + '</i>', crumb: mn[0], mi });
    root.kids.push(month);
    // a month lists every week it touches; each week holds all of its days.
    // Days of another month are flagged `out`: hidden while the month shows the week as a strip, whole once the week opens.
    [...new Set(all.filter(d => d.mi === mi).map(d => d.no))].forEach(no => {
      const week = reg({ id: 'w' + mi + '_' + no, lvl: 2, k: month.kids.length, parent: month, kids: [], no, crumb: 'W' + no });
      month.kids.push(week);
      all.filter(d => d.no === no).forEach(d => {
        const out = d.mi !== mi, cmp = d.mi * 100 + d.dom - (T_MONTH * 100 + T_DOM);
        const day = reg({ id: 'd' + d.doy + (out ? 'x' : ''), lvl: 3, k: week.kids.length, parent: week, wd: d.wd, dom: d.dom, mi: d.mi, out,
                          past: cmp < 0, today: cmp === 0, crumb: DAY_NAMES[d.wd] + ' ' + d.dom,
                          label: '<b>' + DAY_NAMES[d.wd] + '</b><span>' + d.dom + '</span>' + (out ? '<em>' + MONTHS[d.mi][0] + '</em>' : '') });
        day.kids = mkItems(day, d.doy);
        if (out) day.twin = canon[d.doy]; else canon[d.doy] = day;
        if (day.today && !out) todayDay = day;
        week.kids.push(day);
      });
      week.i0 = week.kids.findIndex(d => !d.out); week.d0 = week.kids[week.i0].dom; week.nIn = week.kids.filter(d => !d.out).length;
      const a = week.kids[0], b = week.kids[week.kids.length - 1];
      week.label = '<b>W' + no + '</b><span>' + a.dom + (a.mi !== b.mi ? ' ' + MONTHS[a.mi][0] : '') + '–' + b.dom + (a.mi !== b.mi ? ' ' + MONTHS[b.mi][0] : '') + '</span>';
    });
  });
  // link the two copies of a straddling week, and of each of its days and items, so they stay in step
  for (const id in byId) {
    const d = byId[id];
    if (d.lvl !== 3 || !d.out) continue;
    if (!d.twin) d.twin = canon[+id.slice(1, -1)];
    d.twin.twin = d;
    d.kids.forEach((it, k) => { it.twin = d.twin.kids[k]; it.twin.twin = it; });
  }
  root.kids.forEach((m, mi) => {
    const next = root.kids[mi + 1]; if (!next) return;
    const a = m.kids[m.kids.length - 1], b = next.kids[0];
    if (a.no === b.no) { a.twinNext = b; b.twinPrev = a; }
  });
})();

/* ---- DOM, built lazily: a node gets its element the first time it is on screen ---- */
const stage = document.getElementById('stage'), surface = document.getElementById('surface');
const nowEl = document.getElementById('now'), ctl = document.getElementById('ctl'), crumbsEl = document.getElementById('crumbs');
const playBtn = ctl.querySelector('.play'), hud = document.getElementById('hud');
const crumbs = [0, 1, 2, 3].map(l => { const b = el('button', 'crumb', crumbsEl); b.dataset.act = 'crumb'; b.dataset.l = l; return b; });

function ensureEl(n) {
  if (n.el) return;
  const host = n.parent ? n.parent.body : surface;
  if (n.lvl < 4) {
    n.el = el('div', 'node l' + n.lvl + (n.today ? ' today' : ''), host);
    el('div', 'bg', n.el);
    if (n.lvl === 3) { n.heat = el('div', 'heat', n.el); if (!n.past && !n.today) n.el.classList.add('future'); }
    n.lab = el('div', 'lab', n.el, n.label);
    n.body = el('div', 'nbody', n.el);
    if (n.lvl === 1) n.sum = el('div', 'sum', n.el, monthSum(n));
    if (n.lvl === 0) {               // the year's title bar carries the counter filter
      n.legend = el('div', 'legend', n.el);
      FILTERS.forEach(([k, name]) => { const b = el('button', k === S.filter ? 'on' : '', n.legend, name); b.dataset.act = 'filter'; b.dataset.key = k; b.style.setProperty('--c', k === 'all' ? 'var(--ink)' : 'var(--' + k + ')'); });
    }
    if (n.lvl === 3) n.parts.forEach(p => (p.el = el('div', 'part', n.body, p.name)));
  } else {
    hydrate(n);
    n.el = el('div', 'item' + (n.hasKids ? ' haskids' : '') + (n.optional ? ' optional' : ''), host);
    n.el.style.setProperty('--c', 'var(--' + n.key + ')');
    el('div', 'card', n.el);
    n.mark = el('div', 'mark', n.el, '<i></i><b></b>');
    el('div', 'name', n.el, n.name);
    n.meas = el('div', 'meas', n.el);
    n.btn = el('button', 'btn' + (n.type === 'check' ? ' fillable' : ''), n.el);
    n.body = el('div', 'item-body', n.el);
    n.body.style.display = 'none';
    sync(n);
  }
  n.el.dataset.id = n.id;
  if (n.lvl === 3) paintDay(n);
}
function mkKidEl(it, k) {
  k.el = el('div', 'kid' + (k.rest ? ' rest' : ''), it.body);
  k.kf = el('div', 'kf', k.el);
  k.lab = el('div', 'kl', k.el, k.label + (k.sub ? '<small>' + k.sub + '</small>' : ''));
  el('div', 'kr', k.el, k.right || '');
  if (it.type === 'session') k.cnt = el('div', 'kc', k.el, '');
}

/* what an item shows about itself: its mark fill, its measure, its action */
function sync(it) {
  hydrate(it);
  let p = 0, meas = '', glyph = '✓', num = '';
  if (it.type === 'check') { p = it.done ? 1 : 0; meas = it.done ? it.at : it.missed ? 'skipped' : it.optional ? 'optional' : ''; }
  if (it.type === 'count') { p = it.n / it.target; meas = it.n + ' / ' + it.target; glyph = '+1'; it.done = it.n >= it.target; }
  if (it.type === 'avoid') {
    const n = it.kids.length, last = n ? it.kids[n - 1].min : 0;
    p = n ? 1 : 0; num = n || ''; glyph = '+1';
    meas = n + (it.parent.today && n ? ' · ' + gap(NOW_MIN - last) + ' since last' : ' that day');
  }
  if (it.type === 'session') {
    const r = it.run, n = STEPS;
    if (r.idx < 0) { p = 0; meas = it.missed ? 'skipped' : CIRCUIT_S / 60 + ' min'; glyph = '▶'; }
    else if (r.idx >= n) { p = 1; meas = 'Done · ' + CIRCUIT_S / 60 + ' min'; glyph = '↺'; }
    else {
      let left = it.kids[r.idx].d - r.t; for (let j = r.idx + 1; j < n; j++) left += it.kids[j].d;
      p = 1 - left / CIRCUIT_S;
      meas = (r.idx < 12 ? 'Round ' + (Math.floor(r.idx / 4) + 1) + '/3' : 'Cool down') + ' · ' + mmss(left);
      glyph = r.playing ? '❚❚' : '▶';
    }
    it.prog = p; it.done = r.idx >= n; if (r.idx >= 0) it.missed = false;
  }
  if (!it.el) return;
  it.el.style.setProperty('--p', p);
  it.el.classList.toggle('done', !!it.done);
  it.el.classList.toggle('missed', !!it.missed && !it.done);
  if (it.meas.textContent !== meas) it.meas.textContent = meas;
  if (it.btn.textContent !== glyph) it.btn.textContent = glyph;
  it.mark.lastChild.textContent = num;
}

/* ---- state: depth, and the focused child at each level (month, week, day, item) ---- */
const S = { filter: 'all', z: 2, f0: T_MONTH, f1: todayDay.parent.k, f2: todayDay.k, f3: 0, rb: 0 };
let W = 0, H = 0, dirty = true, running = null;
const tweens = {};
function glide(key, to, ms) {
  if (Math.abs(S[key] - to) < 1e-4) { delete tweens[key]; return; }
  tweens[key] = { from: S[key], to, t0: performance.now(), ms: ms || P.glide };
}
function setDirect(key, v) { delete tweens[key]; S[key] = v; dirty = true; }
function focusNode(l) {
  let n = root;
  for (let j = 0; j < l; j++) n = n.kids[clamp(Math.round(S['f' + j]), 0, n.kids.length - 1)];
  return n;
}

/* ---- layout: pure, returns numbers keyed by node id ----
   A cell opening (m: 0 -> 1) moves its children in two beats, so they never pile up:
   travel  — each child, still a small mark, goes from the side-by-side strip to the start of its own row;
   unfold  — it widens into that row.
   Rows always fit the parent's current height, so the stack is whole from the first frame and simply grows.
   Text shows only once a row is tall enough to hold it. */
const HEAD = 44, GUT = 78, TITLE = 44, RH = 56, RGAP = 6, PH = 28, PADX = 12, KH = 44, KGAP = 4, KEXP = 116;
const travel = m => smooth(0, P.split + 0.05, m), unfold = m => smooth(P.split - 0.05, 1, m);
const mix3 = (from, anchor, row, pa, pb) => lerp(lerp(from, anchor, pa), row, pb);

function layout() {
  const out = {}, A = H - HEAD;
  out[root.id] = { x: 0, y: 0, w: W, h: A, r: 1, m: 1 };
  layNode(out, root, W, A, 1, 1, 1);
  return out;
}

// where child k sits when its parent is a strip or a mark: side by side
function markRect(pl, c, k, n, bw, bh, r, node) {
  if (pl === 1) {
    // weeks inside a month strip (the year view): days run from the 1st, left-aligned across months,
    // with a small gap between weeks; the right end is kept free for the month's total
    const gap = 4, cw = (bw - 46 - 5 * gap) / 31, hh = Math.max(2, Math.min(bh - 10, 24));
    return { x: (c.d0 - 1) * cw + k * gap, y: (bh - hh) / 2, w: Math.max(1, c.nIn * cw - 1), h: hh };
  }
  if (pl === 2) {
    // days inside a week: packed side by side while the week is a mark, in weekday columns once it is a strip
    const colW = bw / 7, hh = Math.max(2, Math.min(bh - 2, 64));
    const col = { x: c.wd * colW, y: (bh - hh) / 2, w: Math.max(1, colW - Math.min(5, colW * .18)), h: hh };
    if (r >= 1) return col;
    const pk = bw / node.nIn, x = c.out ? (c.k < node.i0 ? 0 : bw) : (c.k - node.i0) * pk, w = c.out ? 0 : Math.max(1, pk - 1);
    return { x: lerp(x, col.x, r), y: lerp(0, col.y, r), w: lerp(w, col.w, r), h: lerp(bh, col.h, r) };
  }
  return { x: 0, y: k * bh / n, w: bw, h: bh / n };
}

// pw: how much this node is the focused one (1 on the focus path, between 0 and 1 while sliding to a neighbour)
function layNode(out, node, w, h, r, m, pw) {
  const lvl = node.lvl, o = out[node.id];
  const tz = pw > 0 ? clamp(S.z - lvl, 0, 1) * pw : 0;      // how far we have zoomed into this node's focused child
  const pa = travel(m), pb = unfold(m);
  const by = TITLE * (1 - tz) * pa;                         // the title bar; it gives way to the breadcrumb as we go deeper
  const lp = lvl === 3 && h > 24 ? Math.min(13, h * .3) : 0;
  const sx = lerp(0, GUT, r), sy = lerp(lp, 0, r), sw = lerp(w, w - GUT - 10, r), sh = h - sy;   // where the marks live
  o.by = by; o.bh = h - by; o.tz = tz; o.pa = pa;
  if (lvl === 3) return layDay(out, node, w, h, sx, sy, sw, sh, by, m, pa, pb, tz, pw);

  const n = node.kids.length, Af = h - by, rest = Af / n;
  const f = pw > 0 ? clamp(S['f' + lvl], 0, n - 1) : -1;
  let hf = rest, hs = rest, y = 0;
  // sliding to a neighbour is a page turn: both cells stay fully open while the boundary between them moves
  const wOf = k => (f < 0 ? 0 : n === 1 ? 1 : clamp(10 - 10 * Math.abs(k - f), 0, 1));
  if (f >= 0 && tz > 0 && n > 1) {
    hf = rest * Math.pow(n, tz);                                    // the focused child grows geometrically, like a pinch
    hs = Math.max((Af - hf) / (n - 1), Math.min(P.strip, rest));    // siblings give up space, then hold at strip height
    const i = Math.min(n - 2, Math.floor(f)), u = f - i, yfAt = j => (j / (n - 1)) * (Af - hf);
    y = lerp(yfAt(i) + hf, yfAt(i + 1), u) - lerp(hs, hf, wOf(i)) - i * hs;
  }
  const cm = smooth(P.d0, P.d1, tz);
  node.kids.forEach((c, k) => {
    const wk = wOf(k);
    const rh = lerp(hs, hf, wk), ry = y; y += rh;
    if (m >= 1 && wk === 0 && Math.abs(k - f) > 1.5 && (ry + rh < -2 || ry > Af + 2)) return;   // far off screen: skip the branch
    let x = 0, yy = ry, cw = w, ch = rh;
    if (m < 1) {
      const mk = markRect(lvl, c, k, n, sw, sh, r, node);
      x = mix3(sx + mk.x, 0, 0, pa, pb); yy = mix3(sy + mk.y - by, ry, ry, pa, pb);
      cw = mix3(mk.w, Math.min(mk.w, clamp(rh, 6, 24)), w, Math.sqrt(pa), pb);     // slim while travelling, so marks do not overlap
      ch = mix3(mk.h, Math.min(mk.h, rh), rh, pa, pb);
    }
    out[c.id] = { x, y: yy, w: cw, h: ch, r: pb, m: cm * wk };
    layNode(out, c, cw, ch, pb, cm * wk, pw * wk);
  });
}

function layDay(out, d, w, h, sx, sy, sw, sh, by, m, pa, pb, tz, pw) {
  if (sw < 14 && m === 0) return;                          // too small for its items: the cell shows its heat instead
  const items = d.kids, n = items.length, full = H - HEAD - TITLE * (1 - tz);   // body height once the day is fully open
  const sc = m > 0 ? clamp((h - by) / full, 0.04, 1) : 1;  // the list is scaled to the room the day has right now
  let cy = 2; const rowY = [], partY = {};
  d.parts.forEach(p => {
    partY[p.pi] = cy; cy += PH;
    items.forEach((it, k) => { if (it.part === p.pi) { rowY[k] = cy; cy += RH + RGAP; } });
  });
  // the focused item takes the body; the others keep their size and slide off
  const f = pw > 0 && tz > 0 ? clamp(S.f3, 0, n - 1) : -1;
  const hf2 = RH * Math.pow(full / RH, tz), grow = hf2 - RH;
  const wOf = k => (f < 0 ? 0 : clamp(10 - 10 * Math.abs(k - f), 0, 1));
  const topAt = i => clamp(rowY[i] / Math.max(1, full - RH), 0, 1) * (full - hf2);     // where item i sits when it is the focus
  let scroll = 0;
  if (f >= 0 && n > 1) {                                                              // a page turn, as for the cells above
    const i = Math.min(n - 2, Math.floor(f)), u = f - i;
    const top = lerp(topAt(i) + hf2 + (rowY[i + 1] - rowY[i] - RH), topAt(i + 1), u);   // top of item i+1
    scroll = rowY[i + 1] + grow * wOf(i) - top;
  } else if (f >= 0) scroll = rowY[0] - topAt(0);
  const pushed = restY => { let e = 0; items.forEach((it, k) => { if (rowY[k] < restY) e += grow * wOf(k); }); return restY + e - scroll; };
  const mi = smooth(P.d0, P.d1, tz);
  const ms = clamp(Math.min(sh, sw / (n * 1.45)), 2, 18);  // mark size follows the room available
  d.parts.forEach(p => {
    out[p.id] = { x: PADX, y: pushed(partY[p.pi]) * sc, w: W - 2 * PADX, h: PH * sc, o: pb * smooth(17, 25, PH * sc) };
  });
  items.forEach((it, k) => {
    const wk = wOf(k), im = mi * wk;
    const rx = lerp(PADX, 0, im), rw = W - 2 * rx, rh = (RH + grow * wk) * sc, ry = pushed(rowY[k]) * sc;
    const sR = Math.min(20, rh * 0.62);                              // the mark's size once it sits in its row
    const ax = rx + 13 * sc, ay = ry + Math.min((rh - sR) / 2, 18);  // and where it sits
    const x = mix3(sx + k * ms * 1.45, ax, rx, pa, pb), y = mix3(sy + (sh - ms) / 2 - by, ay, ry, pa, pb);
    const s = lerp(ms, sR, pa), ww = lerp(s, rw, pb), hh = lerp(s, rh, pb);
    out[it.id] = { x, y, w: ww, h: hh, r: pb, m: im, s, mx: (ax - rx) * pb, my: (ay - ry) * pb, co: pb * smooth(34, 50, rh), by: 0, bh: hh };
    if (it.hasKids && pb > 0.01) { hydrate(it); layKids(out, it, ww, hh, rw, rh, im); }
  });
}

function layKids(out, it, w, h, rw, rh, im) {
  const pa = travel(im), pb = unfold(im), o = out[it.id];
  const by = RH * pa;                                       // the body starts under the head once the item opens
  o.by = by; o.bh = Math.max(0, h - by);
  const miniW = rw - 46 - 60, chFull = H - HEAD - RH, ch = Math.max(0, rh - RH);
  const sc = im > 0 ? clamp(ch / chFull, 0.04, 1) : 1;      // the steps are scaled to the room the item has right now
  const cur = it.run ? it.run.cur : null, tops = [];
  let y = 6, pos = 0;
  it.kids.forEach((k, j) => { const c = cur ? cur[j] : 0; tops[j] = y; pos += c * y; y += KH + KGAP + c * KEXP; });
  const total = y + (it.type === 'session' ? 96 : 12);
  const scroll = cur ? clamp(pos - chFull * 0.2, 0, Math.max(0, total - chFull)) : 0;
  const tot = it.kids.reduce((a, k) => a + (k.w || 1), 0);
  let acc = 0;
  it.kids.forEach((k, j) => {
    let sx, sw;
    if (it.type === 'avoid') { sx = clamp((k.min - 420) / 1020, 0, 1) * (miniW - 4); sw = 4; }
    else { sx = acc / tot * miniW; sw = Math.max(2, (k.w || 1) / tot * miniW - 2); acc += k.w || 1; }
    const c = cur ? cur[j] : 0, ry = (tops[j] - scroll) * sc, rhh = (KH + c * KEXP) * sc;
    out[k.id] = { x: mix3(46 + sx, 12, 12, pa, pb), y: mix3(37 - by, ry, ry, pa, pb), w: mix3(sw, sw, rw - 24, pa, pb), h: mix3(7, Math.min(7, rhh), rhh, pa, pb),
                  m: pb, cur: c, co: pb * smooth(26, 40, rhh) };
  });
}

const compute = layout;

/* ---- apply ---- */
const px = v => (Math.round(v * 10) / 10) + 'px';
function box(e, x, y, w, h) {
  const key = px(x) + ',' + px(y) + '|' + px(Math.max(0, w)) + '|' + px(Math.max(0, h));
  if (e._b === key) return; e._b = key;
  e.style.transform = 'translate(' + px(x) + ',' + px(y) + ')';
  e.style.width = px(Math.max(0, w)); e.style.height = px(Math.max(0, h));
}
function vis(n, on) { if (!!n.off === on) { n.el.style.display = on ? '' : 'none'; n.off = !on; } }
let L = null;

function applyNode(n) {
  const s = L[n.id];
  if (!s) { if (n.el) vis(n, false); return; }
  ensureEl(n); vis(n, true);
  // a closed cell whose own numbers did not move has an unchanged inside: skip the whole branch
  const sig = s.m === 0 && s.tz === 0 ? px(s.x) + px(s.y) + px(s.w) + px(s.h) + s.r.toFixed(3) : '';
  if (sig && sig === n.sig) return;
  n.sig = sig;
  if (n.out) n.el.style.opacity = s.r.toFixed(3);
  box(n.el, s.x, s.y, s.w, s.h);
  n.el.style.setProperty('--r', s.r.toFixed(3)); n.el.style.setProperty('--m', s.m.toFixed(3));
  // the label shows when there is room for it; a title leaves upward and fades as its cell is zoomed past
  const asMark = n.lvl === 3 ? smooth(16, 26, s.w) * smooth(18, 30, s.h) : 0;
  const lo = (n.lvl === 0 ? 1 : lerp(asMark * clamp(1 - s.r * 3, 0, 1), smooth(15, 22, s.h) * smooth(70, 110, s.w), smooth(0.6, 0.95, s.r))) * clamp(1 - s.tz * 1.8, 0, 1);
  n.lab.style.opacity = lo.toFixed(3);
  if (lo > 0.01) n.lab.style.transform = 'translate(' + px(lerp(3, 14, s.r)) + ',' + px(lerp(lerp(1, (s.h - 20) / 2, s.r), 10 - 34 * s.tz, s.pa)) + ')';
  box(n.body, 0, s.by, s.w, s.bh);
  if (n.lvl === 1) {
    const so = s.r * clamp(1 - s.m * 4, 0, 1) * smooth(20, 30, s.h);
    n.sum.style.opacity = so.toFixed(3);
    if (so > 0.01) n.sum.style.transform = 'translateY(' + px((s.h - 16) / 2) + ')';
  }
  if (n.lvl === 0) {
    const lg = clamp(1 - s.tz * 2.5, 0, 1);
    n.legend.style.opacity = lg.toFixed(3); n.legend.style.pointerEvents = lg > 0.5 ? 'auto' : 'none';
    n.legend.style.transform = 'translateY(' + px(-34 * s.tz) + ')';
  }
  if (n.lvl < 3) { n.kids.forEach(applyNode); return; }
  // a day
  const shown = !!L[n.kids[0].id], iv = shown ? smooth(14, 26, s.w) : 0;
  const one = S.filter !== 'all';      // with a counter picked, the cell colour leads and the item pips step back
  n.heat.style.opacity = (clamp(1 - s.r * 3, 0, 1) * (1 - (one ? 0.1 : 0.8) * iv)).toFixed(3);
  if (shown !== !n.bodyOff) { n.body.style.display = shown ? '' : 'none'; n.bodyOff = !shown; }
  if (!shown) return;
  n.body.style.opacity = lerp(iv * (one ? 0.3 : 1), 1, s.r).toFixed(3);
  n.parts.forEach(p => { const q = L[p.id]; box(p.el, q.x, q.y, q.w, q.h); p.el.style.opacity = q.o.toFixed(3); });
  n.kids.forEach(it => {
    const q = L[it.id], st = (ensureEl(it), it.el.style);
    box(it.el, q.x, q.y, q.w, q.h);
    st.setProperty('--r', q.r.toFixed(3)); st.setProperty('--m', q.m.toFixed(3)); st.setProperty('--co', q.co.toFixed(3));
    st.setProperty('--s', px(q.s)); st.setProperty('--sn', q.s.toFixed(1)); st.setProperty('--mx', px(q.mx)); st.setProperty('--my', px(q.my));
    it.el.classList.toggle('row', q.co > 0.6);
    const show = q.co > 0.02 && it.hasKids;
    if (show !== !!it.shown) { it.body.style.display = show ? '' : 'none'; it.shown = show; }
    if (!show) return;
    box(it.body, 0, q.by, q.w, q.bh);
    it.body.style.opacity = q.co.toFixed(3);
    it.kids.forEach(k => {
      const c = L[k.id]; if (!c) return;
      if (!k.el) mkKidEl(it, k);
      box(k.el, c.x, c.y, c.w, c.h);
      k.el.style.setProperty('--m', c.m.toFixed(3)); k.el.style.setProperty('--cur', c.cur.toFixed(3)); k.el.style.setProperty('--co', c.co.toFixed(3));
      // the fill keeps a constant area p while it turns from a left-to-right bar into a top-to-bottom one
      k.kf.style.width = (k.p <= 0 ? 0 : Math.pow(k.p, 1 - c.m) * 100) + '%';
      k.kf.style.height = (k.p <= 0 ? 0 : Math.pow(k.p, c.m) * 100) + '%';
    });
  });
}

function apply() {
  L = compute();
  applyNode(root);
  placeNow();
  placeCtl();
  crumbs.forEach((b, l) => {
    const o = clamp((S.z - l) * 1.7 - 0.35, 0, 1), txt = focusNode(l).crumb;
    b.style.opacity = o; b.style.maxWidth = px(o * 90); b.style.pointerEvents = o > 0.5 ? 'auto' : 'none';
    if (b.textContent !== txt) b.textContent = txt;
  });
  const d = focusNode(3), it = focusNode(4);
  const path = ['2026', MONTHS[focusNode(1).mi][0], focusNode(2).crumb, d.crumb, it.name].slice(0, clamp(Math.round(S.z), 0, 4) + 1);
  hud.innerHTML = 'depth ' + S.z.toFixed(2) + '<small>' + path.join(' › ') + '<br>keys: ← → depth, ↑ ↓ neighbour, space play</small>';
}

/* the single now line: at every level it sits at "how far through this cell we are",
   and hands over to the child cell as that cell opens */
function nowIn(n, top) {
  const s = L[n.id]; if (!s) return null;
  let frac;
  if (n.lvl === 0) frac = (304 + T_DOM - 1 + NOW_MIN / 1440) / 365;
  else if (n.lvl === 1) frac = (T_DOM - 1 + NOW_MIN / 1440) / DIM[n.mi];
  else if (n.lvl === 2) frac = (todayDay.k + NOW_MIN / 1440) / n.kids.length;
  else frac = NOW_MIN / 1440;
  const yFrac = top + frac * s.h;
  if (s.m < 0.001) return yFrac;
  if (n.lvl === 3) return lerp(yFrac, nowInDay(n, top, s), s.m);
  const c = n.lvl === 0 ? todayDay.parent.parent : n.lvl === 1 ? todayDay.parent : todayDay, cs = L[c.id];
  const yc = cs ? nowIn(c, top + s.by + cs.y) : null;
  if (yc == null) return s.m > 0.5 ? null : yFrac;      // today's cell is far off screen: no line
  return lerp(yFrac, yc, s.m);
}
function nowInDay(d, top, s) {
  const before = d.kids.find(it => it.part >= 2 && !it.done) || d.kids[d.kids.length - 1];
  const b = L[before.id]; if (!b) return top;
  const ph = d.kids.find(it => it.part === before.part) === before ? L[d.id + 'p' + before.part] : null;
  let y = top + s.by + (ph ? ph.y + ph.h * 0.25 : b.y - 3);
  const gym = d.kids.find(it => it.type === 'session');
  if (gym && gym.run && S.rb > 0.001) {
    const g = L[gym.id], r = gym.run, iTop = top + s.by + g.y;
    let yRun = iTop + (gym.prog || 0) * g.h;
    const k = gym.kids[clamp(r.idx, 0, gym.kids.length - 1)], c = L[k.id];
    if (c) yRun = lerp(yRun, iTop + g.by + c.y + k.p * c.h, g.m);
    y = lerp(y, yRun, S.rb);
  }
  return y;
}
function placeNow() {
  const y = nowIn(root, HEAD), ds = L[todayDay.id];
  const on = y != null && y > HEAD + 1 && y < H - 1;
  nowEl.style.opacity = on ? 1 : 0;
  if (on) nowEl.style.transform = 'translateY(' + px(y) + ')';
  nowEl.firstChild.style.opacity = ds ? clamp(ds.m * 2 - 1, 0, 1) * (1 - S.rb) : 0;
  // in the year view today's ring is enough: the line itself only appears once the month opens
  const ms = L[todayDay.parent.parent.id];
  nowEl.style.setProperty('--la', (ms ? smooth(0.05, 0.6, ms.m) : 0).toFixed(3));
}
function placeCtl() {
  const it = focusNode(4), o = it.type === 'session' ? smooth(3.5, 3.92, S.z) : 0;
  ctl.style.opacity = o; ctl.style.pointerEvents = o > 0.5 ? 'auto' : 'none';
  const g = it.run && it.run.playing ? '❚❚' : '▶';
  if (playBtn.textContent !== g) playBtn.textContent = g;
}

/* ---- session clock ---- */
function setP(k, p) { k.p = p; }
function startRun(it) {
  const r = it.run;
  if (r.idx < 0 || r.idx >= it.kids.length) { it.kids.forEach(k => setP(k, 0)); r.idx = 0; r.t = 0; }
  if (running && running !== it) running.run.playing = false;
  r.playing = true; running = it; sync(it);
}
function resetRun(it) {
  it.run.playing = false; it.run.idx = -1; it.run.t = 0;
  it.kids.forEach(k => { setP(k, 0); if (k.cnt) k.cnt.textContent = ''; });
  if (running === it) running = null; sync(it);
}
function skipStep(it) { const r = it.run; if (r.idx >= 0 && r.idx < it.kids.length) { r.t = it.kids[r.idx].d; if (!r.playing) stepRun(it, 0); } }
function stepRun(it, dt) {
  const r = it.run, n = it.kids.length;
  r.t += dt * (P.fast ? 8 : 1);
  while (r.idx < n && r.t >= it.kids[r.idx].d) { const k = it.kids[r.idx]; r.t -= k.d; setP(k, 1); r.idx++; }
  if (r.idx >= n) {
    r.playing = false; r.t = 0; sync(it); refreshDay(it.parent);
    if (S.z > 3.5 && focusNode(4) === it) setTimeout(() => glide('z', 3, P.glide * 1.3), 500);   // fold back into the day
    return;
  }
  const k = it.kids[r.idx]; setP(k, r.t / k.d);
  const txt = mmss(k.d - r.t); if (k.cnt && k.cnt.textContent !== txt) k.cnt.textContent = txt;
  sync(it);
}

/* ---- frame loop ---- */
let last = performance.now();
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  for (const key in tweens) {
    const t = tweens[key], u = clamp((now - t.t0) / t.ms, 0, 1);
    S[key] = lerp(t.from, t.to, ease(u)); dirty = true;
    if (u >= 1) delete tweens[key];
  }
  if (running && running.run.playing) { stepRun(running, dt); dirty = true; }
  runs.forEach(it => {            // ease the "current step" weights
    const r = it.run, live = r.idx >= 0 && r.idx < it.kids.length;
    for (let j = 0; j < r.cur.length; j++) {
      const target = live && j === r.idx ? 1 : 0, c = r.cur[j];
      if (Math.abs(target - c) > 0.002) { r.cur[j] = c + (target - c) * Math.min(1, dt * 9); dirty = true; }
      else r.cur[j] = target;
    }
  });
  const g = todayDay.kids.find(it => it.type === 'session');
  const rbT = g && g.run && g.run.idx >= 0 && g.run.idx < g.kids.length ? 1 : 0;
  if (Math.abs(rbT - S.rb) > 0.002) { S.rb += (rbT - S.rb) * Math.min(1, dt * 7); dirty = true; } else S.rb = rbT;
  if (dirty) { dirty = false; apply(); }
  requestAnimationFrame(frame);
}

/* ---- input ---- */
const nodeAt = t => { const e = t && t.closest('[data-id]'); return e ? byId[e.dataset.id] : null; };
const upTo = (n, lvl) => { while (n && n.lvl > lvl) n = n.parent; return n; };

// when a zoom starts at a resting depth, the cell under the fingers becomes the focus
function pickFocus(x, y) {
  const Lc = Math.floor(S.z + 1e-6);
  if (Lc > 3 || S.z - Lc > 0.08) return;
  const open = focusNode(Lc), n = upTo(nodeAt(document.elementFromPoint(x, y)), Lc + 1);
  if (n && n.lvl === Lc + 1 && n.parent === open) setDirect('f' + Lc, n.k);
  else if (Lc === 3) pickDefaultItem();
}
function pickDefaultItem() {
  const d = focusNode(3), cur = d.kids[clamp(Math.round(S.f3), 0, d.kids.length - 1)];
  if (!cur.hasKids) setDirect('f3', Math.max(0, d.kids.findIndex(it => it.type === 'session' || it.hasKids)));
}
function zoomTo(z, x, y) {
  const before = S.z;
  setDirect('z', clamp(z, 0, 4));
  if (Math.floor(S.z + 1e-6) > Math.floor(before + 1e-6)) pickFocus(x, y);
}
function settle() {
  const r = Math.round(S.z);
  if (Math.abs(S.z - r) < P.snap) glide('z', r, 240);
}

let wheelT = 0;
stage.addEventListener('wheel', e => {
  e.preventDefault(); seq++;
  if (!wheelT) pickFocus(e.clientX, e.clientY);
  zoomTo(S.z - e.deltaY * (e.ctrlKey ? 0.012 : 0.0032), e.clientX, e.clientY);
  clearTimeout(wheelT); wheelT = setTimeout(() => { wheelT = 0; settle(); }, 170);
}, { passive: false });

const ptrs = new Map();
let g = null;   // current gesture
const mid = () => { const [a, b] = [...ptrs.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; };
stage.addEventListener('pointerdown', e => {
  seq++;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) g = { mode: 'tap', x: e.clientX, y: e.clientY, t: performance.now(), target: e.target };
  if (ptrs.size === 2) { const c = mid(); pickFocus(c.x, c.y); g = { mode: 'pinch', d0: c.d, z0: S.z }; }
});
window.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId) || !g) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (g.mode === 'pinch' && ptrs.size >= 2) { const c = mid(); zoomTo(g.z0 + Math.log2(c.d / g.d0) * 0.95, c.x, c.y); return; }
  if (g.mode === 'tap' && Math.abs(e.clientY - g.y) > 9) {
    const Lc = Math.round(S.z);
    g.mode = Lc >= 1 ? 'drag' : 'none';
    if (Lc >= 1) { g.key = 'f' + (Lc - 1); g.max = focusNode(Lc - 1).kids.length - 1; g.start = S[g.key]; g.y = e.clientY; }
    return;
  }
  if (g.mode === 'drag') {
    g.dy = e.clientY - g.y;
    setDirect(g.key, clamp(g.start - g.dy / (H * 0.55), 0, g.max));
  }
});
function pointerEnd(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (!g) return;
  if (g.mode === 'pinch') { if (ptrs.size < 2) { settle(); g = { mode: 'none' }; } return; }
  if (g.mode === 'drag') {
    const at = Math.round(S[g.key]), flick = Math.abs(g.dy || 0) > 45 ? (g.dy < 0 ? 1 : -1) : 0;
    if (at === Math.round(g.start) && flick) { setDirect(g.key, at); step(g.key, flick); }
    else glide(g.key, at, 320);
  } else if (g.mode === 'tap' && e.type === 'pointerup' && performance.now() - g.t < 450) tap(g.target);
  g = null;
}
window.addEventListener('pointerup', pointerEnd);
window.addEventListener('pointercancel', pointerEnd);

// Step to the neighbouring cell. Weeks cross month ends: a straddling week has a copy in each month,
// and the two copies look the same once opened, so we swap to the copy and carry on.
function step(key, dir) {
  const l = +key[1], par = focusNode(l), max = par.kids.length - 1, to = Math.round(S[key]) + dir;
  if (to >= 0 && to <= max) return glide(key, to, 320);
  if (l === 2) return crossWeek(dir);
  if (l !== 1) return glide(key, clamp(to, 0, max), 320);
  const cur = par.kids[clamp(Math.round(S.f1), 0, max)], twin = dir > 0 ? cur.twinNext : cur.twinPrev;
  const nm = root.kids[par.k + dir]; if (!nm) return glide(key, clamp(to, 0, max), 320);
  const day = Math.round(S.f2);
  setDirect('f0', nm.k);
  setDirect('f1', twin ? twin.k : dir > 0 ? 0 : nm.kids.length - 1);
  setDirect('f2', day);
  if (twin) glide('f1', twin.k + dir, 320);
}

// Sunday to Monday (or back): the two days have different parents, so there is no direct blend.
// Take the honest path instead: out to the week, across to the neighbouring week, back into the day.
let seq = 0;
function crossWeek(dir) {
  const wk = focusNode(2), month = wk.parent;
  if (!month.kids[wk.k + dir] && !root.kids[month.k + dir]) return;      // edge of the year
  const id = ++seq, ms = 240;
  glide('z', 2, ms);
  setTimeout(() => {
    if (id !== seq) return;
    setDirect('z', 2);
    step('f1', dir);
    const target = focusNode(1).kids[tweens.f1 ? tweens.f1.to : Math.round(S.f1)];
    setDirect('f2', dir > 0 ? 0 : target.kids.length - 1);              // invisible at week depth: all days share the height
    setTimeout(() => { if (id === seq) glide('z', 3, ms + 60); }, 340);
  }, ms + 20);
}

function tap(t) {
  const act = t.closest('[data-act]');
  if (act) return command(act.dataset.act, act);
  let n = nodeAt(t); if (!n) return;
  const Lc = clamp(Math.round(S.z), 0, 4), open = focusNode(Lc);
  if (t.closest('.btn') && n.lvl === 4 && n.el.classList.contains('row')) return action(n);
  n = upTo(n, Lc + 1);
  if (n.lvl === Lc + 1) {                       // a child of the open cell: go into it
    if (n.parent === open) {
      if (n.lvl === 4 && !n.hasKids) return action(n);
      if (Math.abs(S.z - Lc) < 0.08) setDirect('f' + Lc, n.k); else glide('f' + Lc, n.k);
      return glide('z', Lc + 1);
    }
    n = n.parent;
  }
  if (n.lvl !== Lc) return;
  if (n !== open) { if (n.parent === open.parent) glide('f' + (Lc - 1), n.k); return; }   // a sibling strip: move to it
  if (Lc === 4) { if (!t.closest('.kid')) glide('z', 3); return; }
  const lab = t.closest('.lab');
  if (lab && lab.parentNode === n.el && Lc > 0) glide('z', Lc - 1);                        // the title: go back out
}

function action(it, mirrored) {
  for (let n = it.parent; n; n = n.parent) n.sig = '';
  hydrate(it);
  if (it.twin && !mirrored && it.type !== 'session') action(it.twin, true);
  if (it.type === 'check') { it.done = !it.done; it.missed = false; }
  if (it.type === 'count' && it.n < it.target) { const k = it.kids[it.n]; k.p = 1; k.label = hhmm(NOW_MIN); if (k.lab) k.lab.textContent = k.label; it.n++; }
  if (it.type === 'avoid') {
    const prev = it.kids[it.kids.length - 1];
    it.kids.push({ id: 'k' + (uid++), min: NOW_MIN, label: hhmm(NOW_MIN), right: prev ? gap(Math.abs(NOW_MIN - prev.min)) + ' after' : 'first', p: 1 });
  }
  if (it.type === 'session') {
    if (it.run.playing) it.run.playing = false;
    else { startRun(it); setDirect('f3', it.k); glide('z', 4, P.glide * 1.25); }   // play: the item opens into its steps
  }
  sync(it); refreshDay(it.parent); dirty = true;
}

function command(a, e) {
  const it = focusNode(4);
  if (a === 'crumb') glide('z', +e.dataset.l);
  if (a === 'filter') setFilter(e.dataset.key);
  if (a === 'now') {
    const near = Math.round(S.f0) === T_MONTH;
    [[0, T_MONTH], [1, todayDay.parent.k], [2, todayDay.k]].forEach(([l, v]) => (near ? glide('f' + l, v) : setDirect('f' + l, v)));
    glide('z', 3);
  }
  if (a === 'tune') document.getElementById('tune').classList.toggle('open');
  if (it.type === 'session' && it.run) {
    if (a === 'play') { if (it.run.playing) it.run.playing = false; else startRun(it); sync(it); }
    if (a === 'reset') resetRun(it);
    if (a === 'skip') skipStep(it);
  }
  dirty = true;
}

window.addEventListener('keydown', e => {
  const k = e.key;
  if (k === 'ArrowRight' || k === 'Enter') { const to = Math.min(4, Math.floor(S.z + 1.001)); if (to === 4) pickDefaultItem(); glide('z', to); }
  else if (k === 'ArrowLeft' || k === 'Escape') glide('z', Math.max(0, Math.ceil(S.z - 1.001)));
  else if (k === 'ArrowDown' || k === 'ArrowUp') {
    const Lc = Math.round(S.z); if (Lc < 1) return;
    step('f' + (Lc - 1), k === 'ArrowDown' ? 1 : -1);
  } else if (k === ' ') command('play');
  else return;
  e.preventDefault();
});

/* ---- tuning panel ---- */
[['strip', v => v + ' px'], ['d0', v => (+v).toFixed(2)], ['d1', v => (+v).toFixed(2)], ['split', v => (+v).toFixed(2)], ['glide', v => v + ' ms'], ['snap', v => (+v).toFixed(2)]]
  .forEach(([k, fmt]) => {
    const inp = document.getElementById('p-' + k), out = document.getElementById('v-' + k);
    inp.value = P[k]; out.textContent = fmt(P[k]);
    inp.addEventListener('input', () => { P[k] = +inp.value; out.textContent = fmt(inp.value); dirty = true; });
  });
document.getElementById('p-fast').addEventListener('change', e => { P.fast = e.target.checked; });

function resize() { W = stage.clientWidth; H = stage.clientHeight; for (const id in byId) byId[id].sig = ''; dirty = true; }
window.addEventListener('resize', resize);
resize();
window.__tempo = { S, P, setFilter, glide, setDirect, root, focusNode, apply, frame, get L() { return L; } };   // for poking at it from the console
requestAnimationFrame(frame);
})();
