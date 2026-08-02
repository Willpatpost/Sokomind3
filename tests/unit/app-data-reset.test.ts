import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { resetAppData } from "../../src/shared/app-data-reset.ts";
import { recordCompletion, type ProgressData } from "../../src/shared/progress.ts";
import {
  loadProgressSyncSnapshot,
  persistProgressUpdate,
  writeProgressSyncSnapshot,
  type ProgressSyncSnapshot,
} from "../../src/shared/progress-sync.ts";
import {
  APP_STORAGE_KEYS,
  STORAGE_KEYS,
} from "../../src/shared/storage.ts";

function createMockStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function progress(): ProgressData {
  return {
    version: 1,
    completed: {
      old: {
        moves: 10,
        pushes: 3,
        completedAt: "2026-08-01T00:00:00.000Z",
      },
    },
  };
}

let localStorage: Storage;
let sessionStorage: Storage;

beforeEach(() => {
  localStorage = createMockStorage();
  sessionStorage = createMockStorage();
  (globalThis as Record<string, unknown>).window = {
    localStorage,
    sessionStorage,
  };
});

afterEach(() => {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "window");
});

test("app-data reset retains a generation tombstone and clears owned timers", () => {
  const staleSnapshot: ProgressSyncSnapshot = {
    generation: 3,
    revision: 8,
    writerId: "stale-tab",
    progress: progress(),
  };
  writeProgressSyncSnapshot(staleSnapshot);
  for (const key of APP_STORAGE_KEYS) {
    if (key !== STORAGE_KEYS.progress) localStorage.setItem(key, "owned");
  }
  localStorage.setItem("sokomind.future-key", "keep");
  sessionStorage.setItem("sokomind:timer", "1000");
  sessionStorage.setItem("sokomind:timer:ultra-tiny", "2000");
  sessionStorage.setItem("sokomind:timer-adjacent", "keep");

  const reset = resetAppData();

  assert.equal(reset.result.ok, true);
  assert.equal(reset.snapshot.generation, 4);
  assert.deepEqual(reset.snapshot.progress.completed, {});
  for (const key of APP_STORAGE_KEYS) {
    if (key !== STORAGE_KEYS.progress && key !== STORAGE_KEYS.reset) {
      assert.equal(localStorage.getItem(key), null);
    }
  }
  assert.ok(localStorage.getItem(STORAGE_KEYS.reset));
  assert.equal(localStorage.getItem("sokomind.future-key"), "keep");
  assert.equal(sessionStorage.getItem("sokomind:timer"), null);
  assert.equal(sessionStorage.getItem("sokomind:timer:ultra-tiny"), null);
  assert.equal(sessionStorage.getItem("sokomind:timer-adjacent"), "keep");

  const staleUpdate = persistProgressUpdate(
    staleSnapshot,
    "stale-tab",
    (current) => recordCompletion(current, "fresh", 7, 2),
  );
  assert.equal(staleUpdate.snapshot.generation, 4);
  assert.deepEqual(Object.keys(staleUpdate.snapshot.progress.completed), ["fresh"]);
  assert.equal(loadProgressSyncSnapshot().progress.completed.old, undefined);
});
