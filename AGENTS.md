Tempo: recurring task counters seen at every scale of time, from a 40-second circuit step to a year. A static single-page app in TypeScript; data stays in the browser (IndexedDB) and is portable through JSON export and import. This file is the whole working agreement for this folder.

## Run, check, build

| What | How |
|---|---|
| Build | `npm run build` → `dist/` (bundle, `web/` copied in). `npm run watch` rebuilds on change. |
| Type-check | `npm run check` |
| Tests | `npm test` (Node's test runner on the TypeScript sources; no DOM) |
| Preview | any static server on `dist/` (locally: preview config `tempo`, port 8811). Build first. |
| Motion study | any static server on `study/` (locally: preview config `tempo-study`, port 8812): the original prototype with its tuning sliders. Reference only. |

Node 24 runs the tests straight from `.ts` files, so imports carry the `.ts` extension, type imports are marked `type`, and there are no enums or parameter properties.

## Files

| Path | Holds |
|---|---|
| `src/model/types.ts` | The records: Counter, Plan, Sequence, Tick, Settings, and DbData (also the export format) |
| `src/model/dates.ts` | Local-date arithmetic, Monday weeks, ISO week numbers |
| `src/model/derive.ts` | Pure: records → what a day shows (`buildDay`), month totals, colour steps |
| `src/store/db.ts` | `Db`: all records in memory, changes written through a `Persistence`; `validate`, export, import |
| `src/store/idb.ts` | IndexedDB persistence |
| `src/store/seed.ts` | Sample data for a first run: five counters and the year so far |
| `src/engine/tree.ts` | The view tree for one year (year → months → weeks → days → items) |
| `src/engine/layout.ts` | Pure: depth and focus → numbers per node. The motion rules live here. |
| `src/engine/app.ts` | State, the DOM view, the session clock, input, the menu |
| `src/main.ts` | Opens the database, seeds on first run, starts the app |
| `web/` | `index.html` and `styles.css`, copied to `dist/` |
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

- One surface and one number: depth `z` (0 year, 1 month, 2 week, 3 day, 4 item). In-between depths are usable states.
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

Done: model, store, export/import, the engine on real dates, ticking (check, +1, removing a logged row by tapping it), the session player writing to the log.

Not done yet: creating and editing counters, plans and sequences (the app only has the sample counters); week- and month-level plans and the tray with its "refine" drag; part of day as a zoom stop; other years; PWA install and offline; deploy; reminders; reduced-motion fallback. Touch pinch is written but untested on a real phone.

## Rules

- Page copy is English, plain words, short sentences.
- Keep `model/`, `store/db.ts` and `engine/layout.ts` free of the DOM so they stay testable.
- Run `npm run check` and `npm test` before calling a change done.
