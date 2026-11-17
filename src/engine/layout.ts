/* Layout: a pure function from (depth, focus path, size) to numbers keyed by node id. No DOM.

   One surface, one number: `z` is the depth (0 year, 1 month, 2 week, 3 day, 4 part of day, 5 item).
   Every cell has three states: a mark inside its grandparent, a row inside its parent, and opened.
   `r` is a cell's row-ness, `m` its open-ness.

   A cell opening (m: 0 → 1) moves its children in two beats, so they never pile up:
   travel — each child, still a small mark, goes from the side-by-side strip to the start of its own row;
   unfold — it widens into that row.
   Rows always fit the parent's current height, so the stack is whole from the first frame and simply grows.
   A fractional focus (a drag to a neighbour) is a page turn: both cells stay fully open while the boundary moves. */

import { clamp, lerp, smooth } from '../util.ts';
import type { Cell, ItemNode, PartNode } from './tree.ts';

/** Tunables, settled in the motion study. */
export const P = { strip: 48, d0: 0.15, d1: 0.8, split: 0.5, glide: 460, snap: 0.18 };
export const HEAD = 44, GUT = 78, TITLE = 44, RH = 56, RGAP = 6, PH = 28, PADX = 12, KH = 44, KGAP = 4, KEXP = 116;

export interface Box {
  x: number; y: number; w: number; h: number;
  /** row-ness and open-ness */
  r: number; m: number;
  /** the body: its top inside the cell, and its height */
  by: number; bh: number;
  /** how far we have zoomed past this cell, and its travel beat */
  tz: number; pa: number;
  /** items: mark size and offset, content opacity */
  s: number; mx: number; my: number; co: number;
  /** steps: how much this is the current one. parts of day: opacity of the heading. */
  cur: number; o: number;
}
export type Layout = Record<string, Box>;

export interface LayoutInput {
  z: number;
  /** focused child at each level: month, week, day, part of day, item. May be fractional while sliding. */
  f: [number, number, number, number, number];
  W: number;
  H: number;
  /** per-step "current" weights of an item that has a live run, else null */
  cur: (it: ItemNode) => number[] | null;
}

const box = (p: Partial<Box>): Box => ({ x: 0, y: 0, w: 0, h: 0, r: 0, m: 0, by: 0, bh: 0, tz: 0, pa: 0, s: 0, mx: 0, my: 0, co: 0, cur: 0, o: 0, ...p });
const travel = (m: number): number => smooth(0, P.split + 0.05, m);
const unfold = (m: number): number => smooth(P.split - 0.05, 1, m);
const mix3 = (from: number, anchor: number, row: number, pa: number, pb: number): number => lerp(lerp(from, anchor, pa), row, pb);
/** How much child k counts as the focus: 1 for it, falling to 0 a tenth of a step away. */
const weight = (k: number, f: number, n: number): number => (f < 0 ? 0 : n === 1 ? 1 : clamp(10 - 10 * Math.abs(k - f), 0, 1));

export const stepId = (it: ItemNode, j: number): string => it.id + '#' + j;
export const rulerId = (p: PartNode): string => p.id + '~ruler';
const RULER_GAP = 14;

export function layout(root: Cell, input: LayoutInput): Layout {
  const out: Layout = {}, A = input.H - HEAD;
  out[root.id] = box({ w: input.W, h: A, r: 1, m: 1 });
  layCell(out, input, root, input.W, A, 1, 1, 1);
  return out;
}

interface Rect { x: number; y: number; w: number; h: number }

/** Where child k sits when its parent is a strip or a mark: side by side. */
function markRect(parent: Cell, c: Cell, k: number, n: number, bw: number, bh: number, r: number): Rect {
  if (parent.lvl === 1) {
    // weeks inside a month strip (the year view): days run from the 1st, left-aligned across months,
    // with a small gap between weeks; the right end is kept free for the month's total
    const gap = 4, cw = (bw - 46 - 5 * gap) / 31, hh = Math.max(2, Math.min(bh - 10, 24));
    return { x: (c.d0 - 1) * cw + k * gap, y: (bh - hh) / 2, w: Math.max(1, c.nIn * cw - 1), h: hh };
  }
  if (parent.lvl === 2) {
    // days inside a week: packed side by side while the week is a mark, in weekday columns once it is a strip
    const colW = bw / 7, hh = Math.max(2, Math.min(bh - 2, 64));
    const col = { x: c.wd * colW, y: (bh - hh) / 2, w: Math.max(1, colW - Math.min(5, colW * 0.18)), h: hh };
    if (r >= 1) return col;
    const pk = bw / parent.nIn, x = c.out ? (c.k < parent.i0 ? 0 : bw) : (c.k - parent.i0) * pk, w = c.out ? 0 : Math.max(1, pk - 1);
    return { x: lerp(x, col.x, r), y: lerp(0, col.y, r), w: lerp(w, col.w, r), h: lerp(bh, col.h, r) };
  }
  return { x: 0, y: k * bh / n, w: bw, h: bh / n };
}

/** pw: how much this node is the focused one (1 on the focus path, between 0 and 1 while sliding to a neighbour). */
function layCell(out: Layout, inp: LayoutInput, node: Cell, w: number, h: number, r: number, m: number, pw: number): void {
  const lvl = node.lvl, o = out[node.id]!;
  const tz = pw > 0 ? clamp(inp.z - lvl, 0, 1) * pw : 0;   // how far we have zoomed into this node's focused child
  const pa = travel(m), pb = unfold(m);
  const by = TITLE * (1 - tz) * pa;                        // the title bar; it gives way to the breadcrumb as we go deeper
  const lp = lvl === 3 && h > 24 ? Math.min(13, h * 0.3) : 0;
  const sx = lerp(0, GUT, r), sy = lerp(lp, 0, r), sw = lerp(w, w - GUT - 10, r), sh = h - sy;   // where the marks live
  o.by = by; o.bh = h - by; o.tz = tz; o.pa = pa;
  if (lvl === 3) { layDay(out, inp, node, h, sx, sy, sw, sh, by, m, pa, pb, tz, pw); return; }

  const n = node.kids.length, Af = h - by, rest = Af / n;
  const f = pw > 0 ? clamp(inp.f[lvl]!, 0, n - 1) : -1;
  let hf = rest, hs = rest, y = 0;
  if (f >= 0 && tz > 0 && n > 1) {
    hf = rest * Math.pow(n, tz);                                    // the focused child grows geometrically, like a pinch
    hs = Math.max((Af - hf) / (n - 1), Math.min(P.strip, rest));    // siblings give up space, then hold at strip height
    const i = Math.min(n - 2, Math.floor(f)), u = f - i, topAt = (j: number): number => (j / (n - 1)) * (Af - hf);
    y = lerp(topAt(i) + hf, topAt(i + 1), u) - lerp(hs, hf, weight(i, f, n)) - i * hs;
  }
  const cm = smooth(P.d0, P.d1, tz);
  node.kids.forEach((c, k) => {
    const wk = weight(k, f, n);
    const rh = lerp(hs, hf, wk), ry = y; y += rh;
    if (m >= 1 && wk === 0 && Math.abs(k - f) > 1.5 && (ry + rh < -2 || ry > Af + 2)) return;   // far off screen: skip the branch
    let x = 0, yy = ry, cw = w, ch = rh;
    if (m < 1) {
      const mk = markRect(node, c, k, n, sw, sh, r);
      x = mix3(sx + mk.x, 0, 0, pa, pb); yy = mix3(sy + mk.y - by, ry, ry, pa, pb);
      cw = mix3(mk.w, Math.min(mk.w, clamp(rh, 6, 24)), w, Math.sqrt(pa), pb);     // slim while travelling, so marks do not overlap
      ch = mix3(mk.h, Math.min(mk.h, rh), rh, pa, pb);
    }
    out[c.id] = box({ x, y: yy, w: cw, h: ch, r: pb, m: cm * wk });
    layCell(out, inp, c, cw, ch, pb, cm * wk, pw * wk);
  });
}

/* A day. Its parts of day are stacked groups: a heading, then the rows of its items.
   Two more stops live here. Depth 3 → 4 zooms into a part: it grows to fill the day while the other parts keep
   their size and slide off. Depth 4 → 5 zooms into one item of that part, in the same way. */
function layDay(out: Layout, inp: LayoutInput, d: Cell, h: number, sx: number, sy: number, sw: number, sh: number,
                by: number, m: number, pa: number, pb: number, tz: number, pw: number): void {
  const n = d.items.length, groups = d.parts, G = groups.length, W = inp.W;
  if (!n || (sw < 14 && m === 0)) return;                    // too small for its items: the cell shows its heat instead
  const full = inp.H - HEAD - TITLE * (1 - tz);              // body height once the day is fully open
  const sc = m > 0 ? clamp((h - by) / full, 0.04, 1) : 1;    // the list is scaled to the room the day has right now
  const pitch = RH + RGAP, gy: number[] = [], gh: number[] = [];
  let cy = 2;
  groups.forEach((p, g) => { gy[g] = cy; gh[g] = PH + p.items.length * pitch; cy += gh[g]!; });

  // the focused part takes the body; the others keep their size and slide off
  const fp = pw > 0 && tz > 0 ? clamp(inp.f[3], 0, G - 1) : -1;
  const R = full / RH, gf = tz > 0 ? (Math.pow(R, tz) - 1) / (R - 1) : 0;      // how far the part has grown, geometrically
  const growA = (g: number): number => Math.max(0, full - gh[g]!) * gf;
  const topAtA = (i: number): number => gy[i]! * (1 - gf);                     // where part i sits when it is the focus
  let scrollA = 0;
  if (fp >= 0 && G > 1) {                                                      // a page turn between parts
    const i = Math.min(G - 2, Math.floor(fp)), u = fp - i;
    scrollA = gy[i + 1]! + growA(i) * weight(i, fp, G) - lerp(topAtA(i) + gh[i]! + growA(i), topAtA(i + 1), u);
  } else if (fp >= 0) scrollA = gy[0]! - topAtA(0);
  const groupTop = (g: number): number => {
    let e = 0;
    for (let j = 0; j < g; j++) e += growA(j) * weight(j, fp, G);
    return gy[g]! + e - scrollA;
  };

  const tItem = pw > 0 ? clamp(inp.z - 4, 0, 1) * pw : 0;    // how far we have zoomed into the focused part's focused item
  const ms = clamp(Math.min(sh, sw / (n * 1.45)), 2, 18);    // mark size follows the room available
  groups.forEach((p, g) => {
    const wg = weight(g, fp, G), tb = tItem * wg, nI = p.items.length;
    const headH = lerp(PH, TITLE, gf * wg) * (1 - tb);       // the heading grows into a title, then gives way to the item
    const top = groupTop(g), room = full - headH;            // room for this part's rows once it is open
    // within the part: the focused item takes the room; the others keep their size and slide off
    const fi = tb > 0 ? clamp(inp.f[4], 0, nI - 1) : -1;
    const hf = RH * Math.pow(Math.max(1, room / RH), tb), grow = hf - RH;
    const topAt = (i: number): number => clamp(i * pitch / Math.max(1, room - RH), 0, 1) * (room - hf);
    let scroll = 0;
    if (fi >= 0 && nI > 1) {
      const i = Math.min(nI - 2, Math.floor(fi)), u = fi - i;
      scroll = (i + 1) * pitch + grow * weight(i, fi, nI) - lerp(topAt(i) + hf + RGAP, topAt(i + 1), u);
    } else if (fi >= 0) scroll = -topAt(0);
    const rowTop = (k: number): number => {
      let e = 0;
      for (let j = 0; j < k; j++) e += grow * weight(j, fi, nI);
      return k * pitch + e - scroll;
    };
    const mi = smooth(P.d0, P.d1, tb);
    out[p.id] = box({ y: top * sc, w: W, h: headH * sc, o: pb * smooth(17, 25, headH * sc), m: gf * wg * (1 - tb),
                      bh: (headH + nI * pitch + growA(g) * wg + (fi >= 0 ? grow : 0)) * sc });
    // the room an open part gains under its rows holds its hour ruler
    const rulerH = growA(g) * wg - (headH - PH) - RULER_GAP - 14;      // the title is taller than the heading it grew from
    if (rulerH > 0) out[rulerId(p)] = box({ y: (top + headH + nI * pitch + RULER_GAP) * sc, w: W, h: rulerH * sc, o: pb * gf * wg * (1 - tb) * smooth(110, 170, rulerH) });
    p.items.forEach((it, k) => {
      const wk = weight(k, fi, nI), im = mi * wk;
      const rx = lerp(PADX, 0, im), rw = W - 2 * rx, rh = (RH + grow * wk) * sc, ry = (top + headH + rowTop(k)) * sc;
      const sR = Math.min(20, rh * 0.62);                              // the mark's size once it sits in its row
      const ax = rx + 13 * sc, ay = ry + Math.min((rh - sR) / 2, 18);  // and where it sits
      const x = mix3(sx + it.gk * ms * 1.45, ax, rx, pa, pb), y = mix3(sy + (sh - ms) / 2 - by, ay, ry, pa, pb);
      const s = lerp(ms, sR, pa), ww = lerp(s, rw, pb), hh = lerp(s, rh, pb);
      out[it.id] = box({ x, y, w: ww, h: hh, r: pb, m: im, s, mx: (ax - rx) * pb, my: (ay - ry) * pb, co: pb * smooth(34, 50, rh), bh: hh });
      if (it.hasKids && pb > 0.01) laySteps(out, inp, it, hh, rw, rh, im);
    });
  });
}

function laySteps(out: Layout, inp: LayoutInput, it: ItemNode, h: number, rw: number, rh: number, im: number): void {
  const pa = travel(im), pb = unfold(im), o = out[it.id]!, steps = it.model.steps;
  const by = RH * pa;                                         // the body starts under the head once the item opens
  o.by = by; o.bh = Math.max(0, h - by);
  const miniW = rw - 46 - 60, chFull = inp.H - HEAD - RH, ch = Math.max(0, rh - RH);
  const sc = im > 0 ? clamp(ch / chFull, 0.04, 1) : 1;        // the steps are scaled to the room the item has right now
  const cur = inp.cur(it), tops: number[] = [];
  let y = 6, pos = 0;
  steps.forEach((_, j) => { const c = cur?.[j] ?? 0; tops[j] = y; pos += c * y; y += KH + KGAP + c * KEXP; });
  const total = y + (it.model.kind === 'session' ? 96 : 12);
  const scroll = cur ? clamp(pos - chFull * 0.2, 0, Math.max(0, total - chFull)) : 0;
  const tot = steps.reduce((a, s) => a + s.weight, 0) || 1;
  let acc = 0;
  steps.forEach((s, j) => {
    let sx: number, sw: number;
    if (it.model.kind === 'avoid') { sx = clamp(((s.minute ?? 0) - 420) / 1020, 0, 1) * (miniW - 4); sw = 4; }
    else { sx = acc / tot * miniW; sw = Math.max(2, s.weight / tot * miniW - 2); acc += s.weight; }
    const c = cur?.[j] ?? 0, ry = (tops[j]! - scroll) * sc, rhh = (KH + c * KEXP) * sc;
    out[stepId(it, j)] = box({
      x: mix3(46 + sx, 12, 12, pa, pb), y: mix3(37 - by, ry, ry, pa, pb), w: mix3(sw, sw, rw - 24, pa, pb), h: mix3(7, Math.min(7, rhh), rhh, pa, pb),
      m: pb, cur: c, co: pb * smooth(26, 40, rhh),
    });
  });
}
