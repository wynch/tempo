# Tempo

Recurring task counters, seen at every scale of time: from a 40-second step of a workout circuit to a whole year.

**Open it: https://wynch.github.io/tempo/**

One surface, one gesture. Pinch or scroll to change depth (year, month, week, day, item); tap to go in; drag to move to a neighbour. A counter is the same thing at every depth: a mark in the year, a row in the day, a list of steps when opened.

- **Check, count, avoid, or play.** Tick a habit, add one to a count, log something you want less of, or run a timed circuit.
- **Any rhythm.** Every day, some weekdays, or so many times a week or a month.
- **Plan loosely, then refine.** "Gym three times this week" floats over the week; drag it onto a day when you know which.
- **Readable at a glance.** The year is one strip per month; filter it by counter to see streaks and gaps.
- **Yours.** Everything stays in your browser. Export it as one JSON file, import it elsewhere. No account, no server.
- **Works offline** and installs to the home screen.

## Develop

```bash
npm install
npm run build     # → dist/
npm run check     # types
npm test          # model, store and layout
```

Serve `dist/` with any static server. Pushing to `main` checks, builds and deploys to GitHub Pages.

[AGENTS.md](AGENTS.md) describes the model, the interface rules and the layout of the code. `study/` holds the original motion study.
