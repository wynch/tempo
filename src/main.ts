// Entry point: open the database (seeding sample data on a first run), then start the app.

import { start } from './engine/app.ts';
import { Db, MemoryPersistence, type Persistence } from './store/db.ts';
import { IdbPersistence } from './store/idb.ts';
import { seed } from './store/seed.ts';

async function boot(): Promise<void> {
  const note = document.getElementById('boot')!;
  let store: Persistence, kept = true;
  try { store = await IdbPersistence.open(); }
  catch (err) {
    // Private windows and some embedded views have no IndexedDB: run anyway, but say that nothing will be kept.
    console.warn('Tempo: no IndexedDB, using memory only', err);
    store = new MemoryPersistence(); kept = false;
  }
  const db = await Db.open(store, () => seed(new Date()));
  note.remove();
  start(db);
  // offline use and install: the service worker caches the app shell (see web/sw.js)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(err => console.warn('Tempo: no offline support', err));
  if (!kept) alert('This browser window cannot store data. Tempo will work, but nothing will be kept when you close it. Use Export to save your data.');
}

boot().catch((err: unknown) => {
  console.error(err);
  const note = document.getElementById('boot');
  if (note) note.textContent = 'Tempo could not start. ' + (err instanceof Error ? err.message : String(err));
});
