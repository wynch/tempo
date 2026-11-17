// Knowing when a newer build has been deployed, and switching to it.
// The build writes its own id into the bundle (__BUILD__) and into version.json; a copy that is already open,
// or installed on a home screen and kept alive, compares the two and offers to update.

declare const __BUILD__: string | undefined;
/** The id of the build that is running. "dev" when not built by scripts/build.mjs. */
export const BUILD: string = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

/** Asks the server which build is current. True if it is not this one. Offline, or on any error: false. */
export async function updateAvailable(): Promise<boolean> {
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return false;
    const { version } = await res.json() as { version?: string };
    return typeof version === 'string' && version !== BUILD;
  } catch { return false; }
}

/** Calls `found` once a newer build is seen: shortly after start, whenever the app comes back to the front, and every 15 minutes. */
export function watchForUpdates(found: () => void): void {
  let done = false;
  const check = (): void => { if (!done) void updateAvailable().then(yes => { if (yes && !done) { done = true; found(); } }); };
  setTimeout(check, 3000);
  setInterval(check, 15 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}

/** Loads the newer build. Your data stays where it is: it lives in the browser's database, not in the page. */
export async function applyUpdate(): Promise<void> {
  try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* reload anyway */ }
  location.reload();
}
