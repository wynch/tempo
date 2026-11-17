Tempo: recurring task counters seen at every scale of time, from a 40-second circuit step to a year. A static single-page app in TypeScript; data stays in the browser (IndexedDB) and is portable through JSON export and import. This file is the whole working agreement for this folder.

## Run, check, build

| What | How |
|---|---|
| Build | `npm run build` → `dist/` (bundle, `web/` copied in). `npm run watch` rebuilds on change. |
| Type-check | `npm run check` |
| Tests | `npm test` (Node's test runner on the TypeScript sources; no DOM) |
| Preview | any static server on `dist/` (locally: preview config `tempo`, port 8811). Build first. |
| Deploy | push to `main`: `.github/workflows/deploy.yml` checks, builds and publishes `dist/` to GitHub Pages (https://wynch.github.io/tempo/) |
| Icons | `node scripts/icons.mjs` redraws the PNG icons in `web/` |
| Motion study | any static server on `study/` (locally: preview config `tempo-study`, port 8812): the original prototype with its tuning sliders. Reference only. |

Node 24 runs the tests straight from `.ts` files, so imports carry the `.ts` extension, type imports are marked `type`, and there are no enums or parameter properties.

## Files

| Path | Holds |
|---|---|
| `src/model/types.ts` | The records: Counter, Plan, Sequence, Tick, Placement, Settings, and DbData (also the export format) |
| `src/model/dates.ts` | Local-date arithmetic, Monday weeks, ISO week numbers |
| `src/model/derive.ts` | Pure: records → what a day shows (`buildDay`), month totals, colour steps |
| `src/store/db.ts` | `Db`: all records in memory, changes written through a `Persistence`; `validate`, export, import |
| `src/store/idb.ts` | IndexedDB persistence |
| `src/store/seed.ts` | Sample data for a first run: five counters and the year so far |
| `src/engine/tree.ts` | The view tree for one year (year → months → weeks → days → parts of day → items) |
| `src/engine/layout.ts` | Pure: depth and focus → numbers per node. The motion rules live here. |
| `src/engine/app.ts` | State, the DOM view, the session clock, input, the menu |
| `src/ui/editor.ts` | The sheet that lists, creates and edits counters |
| `src/main.ts` | Opens the database, seeds on first run, registers the service worker, starts the app |
| `web/` | `index.html`, `styles.css`, the manifest, icons and `sw.js`, copied to `dist/` (the build stamps `sw.js` with a hash) |
| `test/` | Tests for dates, derivations, the store and the layout |
| `study/` | The motion study (plain JS, sample data). Do not grow it. |

## The model (agreed with the owner, 2026-11-16)

- A loop is a period divided into cells and repeated. A circuit and a week are the same shape; they differ by clock (stopwatch, calendar, or elastic: due some time after the last tick) and by how tightly things sit in a cell.
- Levels are named cells, not divisions of the clock: step, round, session, part of day, day, week, month, season, year.
- A plan lives at the coarsest level where it is true ("gym 3× this week") and may be pushed down to a finer cell. A tick is always an exact instant.
- The log is the source of truth. Streaks, totals, "time since last" and cell colours are derived, never stored.
- A day is derived once (`DayModel`) and may be shown in two places (a week that straddles two months has a view copy under each).
- An item's kind comes from its counter: `session` if it has a sequence, `avoid` if its intent is avoid, else `count` or `check`.

## The interface rules

- One surface and one number: depth `z` (0 year, 1 month, 2 week, 3 day, 4 part of day, 5 item). In-between depths are usable states.
- Every cell has three states: a mark inside its grandparent, a row inside its parent, and opened (`r` row-ness, `m` open-ness).
- Nothing is replaced: a node is the same element at every depth and shows more as it gains room.
- A cell opening moves its children in two beats: travel (small marks go to the start of their rows), then unfold (they widen into rows). Rows always fit the parent's current height. Text shows only once a row is tall and wide enough.
- Sliding to a neighbour is a page turn: both cells stay fully open. Never blend two layouts.
- Time runs downward. The header is the breadcrumb of the cells you are inside. There is one "now" line; it becomes the playhead of a running session and is hidden in the year view.
- The year is one strip per month, left-aligned, five colour steps, a total per row, and filter chips per counter.
- Weeks are cut at month ends only in the month view; an opened week always has seven days.
- Plain 2D only.

## Decisions

- Sync between devices is out for now (owner's decision, 2026-11-17): the target is portability, through export and import of the whole database. Keep `Persistence` as the seam a sync layer could sit behind.
- TypeScript, bundled with esbuild, no UI framework: the surface is driven by `layout()` and direct style writes each frame.

## State of things

Done: model, store, export/import; the engine on real dates; ticking (check, +1, removing a logged row by tapping it); the session player writing to the log; creating, editing and deleting counters, rhythms and circuits; week and month plans with their tray and the refine drag; part of day as a zoom stop; other years; reduced motion; offline install; deploy.

How some of it works:
- Changing a rhythm ends the old plan yesterday and starts a new one today (`Db.setPlan`), so past days keep the plan they had.
- A week or month plan floats: its item sits in every day of the period under "This week" / "This month", is counted over the whole period (`periodN`), and never shows as missed. A tick therefore refreshes every day of its period.
- Refine: dragging a chip from a week's or month's tray onto a day pins the floating plan there (a `Placement`; `Db.togglePlacement`). A pinned item sits with the day's own items, can be missed, and counts in the day's score. Dropping the chip on a pinned day unpins it. Once as many days are pinned as the plan asks for, the plan no longer floats over the other days of the period. Past days refuse the drop. The drag is the `refine` gesture in `app.ts`.
- Direct editing (`hold`, and the `swipe` gesture in `app.ts`): a long press (480 ms) on a row opens its counter, with a ring building on the row while it is held; a long press on the open day's background or on a part-of-day heading starts a new counter there. A row of the open day swipes sideways: right past the threshold runs its own action (Done, Undo, +1, Play), left opens the editor; the row carries the label of what letting go will do. The "+" in the header starts a new counter. The sheet slides up; Cancel returns to where it was opened from.
- Part of day is a level of its own (`PartNode`, depth 4): All day, the parts from the settings, then "This week" and "This month". The day view is unchanged (headings with their rows). Zooming into a part makes it take the day's body, its heading growing into a title with the hours it covers, while the other parts keep their size and slide off; rows keep their size, the part gains room. An item then opens inside its part the same way (`layDay` holds both stops). Tapping an item from the day goes straight to it, past its part. Moving past the last item of a part goes out to the part, across, and back in (`crossPart`).
- Items are positioned in the day's body, not inside their part's element: a part's element is only its heading. Their focus path is part (`f3`) then item (`f4`).
- The breadcrumb shows at most the three nearest ancestors; older crumbs and the brand give way.
- IndexedDB is at version 2 (the `placements` store). An export without `placements` still loads.
- The tree holds one year. Another year is named in the address (`#2025`) and changing year reloads the page.
- A structural change (counter, plan, import) rebuilds every day from the records (`refreshAll`); a tick rebuilds only its days (`refreshDays`).
- The service worker is network-first, so a deploy shows at once and the cache only answers offline.

Not done: holding a dragged chip over a row to spring it open and drop one level deeper; an hour ruler inside an open part, with ticks placed at their times; editing the parts of day (names and boundaries); elastic plans (due some days after the last tick) are in the model but not offered; reordering counters; archiving instead of deleting; reminders (no push server, so nothing can fire while the app is closed). Touch pinch is written but untested on a real phone.

## Rules

- Page copy is English, plain words, short sentences.
- Keep `model/`, `store/db.ts` and `engine/layout.ts` free of the DOM so they stay testable.
- Run `npm run check` and `npm test` before calling a change done.
- The repository is public. No personal data in files or commits: the commit identity is a GitHub no-reply address, set in this repository's own git config.
