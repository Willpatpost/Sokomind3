import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import {
  STORAGE_KEYS,
  LEGACY_STORAGE_KEYS,
  readStoredValue,
  writeStoredValue,
  removeStoredValue,
} from "../../src/shared/storage.ts";

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function installMockStorage(storage: Storage): void {
  (globalThis as Record<string, unknown>).window = { localStorage: storage };
}

function removeMockStorage(): void {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "window");
}

describe("STORAGE_KEYS", () => {
  it("is frozen", () => {
    assert.ok(Object.isFrozen(STORAGE_KEYS));
  });

  it("contains namespaced keys", () => {
    assert.ok(STORAGE_KEYS.progress.startsWith("sokomind."));
    assert.ok(STORAGE_KEYS.experience.startsWith("sokomind."));
    assert.ok(STORAGE_KEYS.session.startsWith("sokomind."));
    assert.ok(STORAGE_KEYS.optimal.startsWith("sokomind."));
  });
});

describe("LEGACY_STORAGE_KEYS", () => {
  it("is frozen", () => {
    assert.ok(Object.isFrozen(LEGACY_STORAGE_KEYS));
  });
});

describe("readStoredValue", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMockStorage();
    installMockStorage(storage);
  });

  afterEach(() => {
    removeMockStorage();
  });

  it("returns the value for an existing key", () => {
    storage.setItem("test.key", "hello");
    assert.equal(readStoredValue("test.key"), "hello");
  });

  it("returns null for a missing key", () => {
    assert.equal(readStoredValue("nonexistent"), null);
  });

  it("reads JSON strings verbatim", () => {
    const json = JSON.stringify({ level: 5, stars: 3 });
    storage.setItem("data", json);
    assert.equal(readStoredValue("data"), json);
  });

  it("returns null when window is undefined", () => {
    removeMockStorage();
    assert.equal(readStoredValue("any.key"), null);
  });

  it("falls back to legacy keys when primary key is absent", () => {
    storage.setItem("legacy.v1", "old-data");
    const result = readStoredValue("current.v2", ["legacy.v1"]);
    assert.equal(result, "old-data");
  });

  it("migrates legacy value to the current key", () => {
    storage.setItem("legacy.v1", "migrated");
    readStoredValue("current.v2", ["legacy.v1"]);
    assert.equal(storage.getItem("current.v2"), "migrated");
  });

  it("prefers primary key over legacy keys", () => {
    storage.setItem("current", "new-value");
    storage.setItem("legacy", "old-value");
    assert.equal(readStoredValue("current", ["legacy"]), "new-value");
  });

  it("tries legacy keys in order and uses the first match", () => {
    storage.setItem("legacy2", "second");
    const result = readStoredValue("current", ["legacy1", "legacy2"]);
    assert.equal(result, "second");
  });

  it("returns null when all legacy keys are also missing", () => {
    assert.equal(readStoredValue("current", ["legacy1", "legacy2"]), null);
  });

  it("still returns legacy value when migration setItem throws", () => {
    const throwingStorage = createMockStorage();
    const originalSetItem = throwingStorage.setItem.bind(throwingStorage);
    let firstCall = true;
    throwingStorage.setItem = (key: string, value: string) => {
      if (firstCall) {
        originalSetItem(key, value);
        firstCall = false;
        return;
      }
      throw new DOMException("QuotaExceededError");
    };
    throwingStorage.setItem("legacy", "data");
    installMockStorage(throwingStorage);
    const result = readStoredValue("current", ["legacy"]);
    assert.equal(result, "data");
  });

  it("returns null when getItem throws", () => {
    const throwingStorage = createMockStorage();
    throwingStorage.getItem = () => {
      throw new Error("SecurityError");
    };
    installMockStorage(throwingStorage);
    assert.equal(readStoredValue("key"), null);
  });
});

describe("writeStoredValue", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMockStorage();
    installMockStorage(storage);
  });

  afterEach(() => {
    removeMockStorage();
  });

  it("writes a value and returns true", () => {
    const result = writeStoredValue("key", "value");
    assert.equal(result, true);
    assert.equal(storage.getItem("key"), "value");
  });

  it("overwrites an existing value", () => {
    storage.setItem("key", "old");
    writeStoredValue("key", "new");
    assert.equal(storage.getItem("key"), "new");
  });

  it("writes JSON strings", () => {
    const json = JSON.stringify([1, 2, 3]);
    writeStoredValue("arr", json);
    assert.equal(storage.getItem("arr"), json);
  });

  it("returns false when window is undefined", () => {
    removeMockStorage();
    assert.equal(writeStoredValue("key", "value"), false);
  });

  it("returns false when setItem throws", () => {
    const throwingStorage = createMockStorage();
    throwingStorage.setItem = () => {
      throw new DOMException("QuotaExceededError");
    };
    installMockStorage(throwingStorage);
    assert.equal(writeStoredValue("key", "value"), false);
  });
});

describe("removeStoredValue", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMockStorage();
    installMockStorage(storage);
  });

  afterEach(() => {
    removeMockStorage();
  });

  it("removes an existing key and returns true", () => {
    storage.setItem("key", "value");
    const result = removeStoredValue("key");
    assert.equal(result, true);
    assert.equal(storage.getItem("key"), null);
  });

  it("returns true even when key does not exist", () => {
    assert.equal(removeStoredValue("nonexistent"), true);
  });

  it("returns false when window is undefined", () => {
    removeMockStorage();
    assert.equal(removeStoredValue("key"), false);
  });

  it("returns false when removeItem throws", () => {
    const throwingStorage = createMockStorage();
    throwingStorage.removeItem = () => {
      throw new Error("SecurityError");
    };
    installMockStorage(throwingStorage);
    assert.equal(removeStoredValue("key"), false);
  });
});
