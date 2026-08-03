import {
  createProgressWriterId,
  loadProgressSyncSnapshot,
  persistProgressReset,
  type PersistedProgressUpdate,
} from "./progress-sync.ts";
import { persistenceHealth } from "./persistence-health.ts";
import {
  STORAGE_KEYS,
  clearAppSessionStorage,
  clearAppStorage,
  writeStoredValue,
} from "./storage.ts";

/**
 * Clear every owned preference/session/cache key while retaining a higher-
 * generation empty progress tombstone. Active tabs can therefore observe the
 * reset and cannot merge their stale pre-reset records back into storage.
 */
export function resetAppData(): PersistedProgressUpdate {
  const progressBeforeReset = loadProgressSyncSnapshot();
  const writerId = createProgressWriterId();
  clearAppStorage();
  const reset = persistProgressReset(
    progressBeforeReset,
    writerId,
  );
  persistenceHealth.report(writeStoredValue(
    STORAGE_KEYS.reset,
    JSON.stringify({ writerId, resetAt: new Date().toISOString() }),
  ));
  return reset;
}

/**
 * Other same-origin tabs receive the retained reset marker after all owned
 * local data and the progress tombstone have been written. Clear their private
 * timers and reload at the hash-free app entry so mounted sessions cannot save
 * pre-reset state again.
 */
export function installCrossTabAppResetListener(): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEYS.reset || event.newValue === null) return;
    clearAppSessionStorage();
    const entry = new URL(window.location.href);
    entry.hash = "";
    entry.searchParams.set("_r", Date.now().toString(36));
    window.addEventListener("beforeunload", clearAppSessionStorage, {
      once: true,
    });
    window.addEventListener("pagehide", clearAppSessionStorage, { once: true });
    window.location.replace(entry.href);
  };
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}
