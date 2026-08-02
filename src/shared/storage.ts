/**
 * The only module that talks directly to Web Storage.
 *
 * GitHub project pages share an origin, so every key is application-namespaced.
 * Reads and writes deliberately fail closed: private browsing, storage quotas,
 * and hardened browser settings must never prevent the game from running.
 */
export const STORAGE_KEYS = Object.freeze({
  progress: "sokomind.progress.v1",
  experience: "sokomind.experience.v1",
  session: "sokomind.session.v1",
  optimal: "sokomind.optimal.v2",
  reset: "sokomind.reset.v1",
});

export const LEGACY_STORAGE_KEYS = Object.freeze({
  progress: "sokomind.progress.v1",
  experience: "sokomind.experience.v1",
  currentPuzzle: "sokomind.current-puzzle.v1",
  optimal: "sokomind.optimal.v1",
});

export const APP_STORAGE_KEYS: readonly string[] = Object.freeze([
  ...new Set([...Object.values(STORAGE_KEYS), ...Object.values(LEGACY_STORAGE_KEYS)]),
]);

export const APP_SESSION_STORAGE_KEYS: readonly string[] = Object.freeze([
  "sokomind:timer",
]);

export const APP_SESSION_STORAGE_PREFIXES: readonly string[] = Object.freeze([
  "sokomind:timer:",
]);

export type StorageMutationOperation = "write" | "remove";
export type StorageFailureReason =
  | "unavailable"
  | "quota-exceeded"
  | "security-error"
  | "unknown";

export interface StorageMutationSuccess {
  readonly ok: true;
  readonly key: string;
  readonly operation: StorageMutationOperation;
}

export interface StorageMutationFailure {
  readonly ok: false;
  readonly key: string;
  readonly operation: StorageMutationOperation;
  readonly reason: StorageFailureReason;
}

export type StorageMutationResult =
  | StorageMutationSuccess
  | StorageMutationFailure;

function storageFailureReason(error: unknown): StorageFailureReason {
  const name = error && typeof error === "object" && "name" in error
    ? String(error.name)
    : "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return "quota-exceeded";
  }
  if (name === "SecurityError") return "security-error";
  return "unknown";
}

function successfulMutation(
  key: string,
  operation: StorageMutationOperation,
): StorageMutationSuccess {
  return { ok: true, key, operation };
}

function failedMutation(
  key: string,
  operation: StorageMutationOperation,
  reason: StorageFailureReason,
): StorageMutationFailure {
  return { ok: false, key, operation, reason };
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function browserSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function readStoredValue(
  key: string,
  legacyKeys: readonly string[] = [],
): string | null {
  const storage = browserStorage();
  if (!storage) return null;

  try {
    const current = storage.getItem(key);
    if (current !== null) return current;

    for (const legacyKey of legacyKeys) {
      const legacy = storage.getItem(legacyKey);
      if (legacy === null) continue;

      try {
        storage.setItem(key, legacy);
      } catch {
        // The legacy value is still usable for this page load.
      }
      return legacy;
    }
  } catch {
    return null;
  }

  return null;
}

export function writeStoredValue(
  key: string,
  value: string,
): StorageMutationResult {
  const storage = browserStorage();
  if (!storage) return failedMutation(key, "write", "unavailable");

  try {
    storage.setItem(key, value);
    return successfulMutation(key, "write");
  } catch (error) {
    return failedMutation(key, "write", storageFailureReason(error));
  }
}

export function removeStoredValue(key: string): StorageMutationResult {
  const storage = browserStorage();
  if (!storage) return failedMutation(key, "remove", "unavailable");

  try {
    storage.removeItem(key);
    return successfulMutation(key, "remove");
  } catch (error) {
    return failedMutation(key, "remove", storageFailureReason(error));
  }
}

export function clearAppStorage(): void {
  const storage = browserStorage();
  if (storage) {
    for (const key of APP_STORAGE_KEYS) {
      try {
        storage.removeItem(key);
      } catch {
        // Keep attempting the remaining owned keys if one removal is blocked.
      }
    }
  }

  clearAppSessionStorage();
}

export function clearAppSessionStorage(): void {
  const session = browserSessionStorage();
  if (!session) return;

  try {
    const ownedDynamicKeys: string[] = [];
    for (let index = 0; index < session.length; index += 1) {
      const key = session.key(index);
      if (
        key &&
        APP_SESSION_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
      ) {
        ownedDynamicKeys.push(key);
      }
    }
    for (const key of [...APP_SESSION_STORAGE_KEYS, ...ownedDynamicKeys]) {
      session.removeItem(key);
    }
  } catch {
    // sessionStorage may be blocked independently of localStorage.
  }
}
