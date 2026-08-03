import assert from "node:assert/strict";
import test from "node:test";
import { PUZZLES, getPuzzleById } from "../../src/catalog/puzzles.ts";
import { move } from "../../src/core/index.ts";
import {
  loadSessionPuzzleId,
  parseSavedSession,
  restoreSession,
  type SavedSession,
} from "../../src/shared/session-persistence.ts";
import { STORAGE_KEYS } from "../../src/shared/storage.ts";

test("parses only versioned and bounded canonical saved sessions", () => {
  const parsed = parseSavedSession(
    JSON.stringify({
      version: 1,
      puzzleId: "first-steps",
      actionLog: "RRD",
      updatedAt: "2026-07-26T12:00:00.000Z",
    }),
  );

  assert.equal(parsed?.actionLog, "RRD");
  assert.equal(parseSavedSession("{"), null);
  assert.equal(
    parseSavedSession(
      JSON.stringify({
        version: 1,
        puzzleId: "first-steps",
        actionLog: "RX",
        updatedAt: "",
      }),
    ),
    null,
  );
});

test("restores attempts by replaying every move through the game engine", () => {
  const puzzle = PUZZLES[0];
  assert.ok(puzzle);
  const live = move(move(move(
    // The first room's opening route is discovered from legal transitions
    // rather than trusting hand-authored snapshot data.
    restoreSession({
      version: 1,
      puzzleId: puzzle.id,
      actionLog: "",
      updatedAt: "",
    }, getPuzzleById)!,
    "right",
  ), "right"), "down");

  const saved: SavedSession = {
    version: 1,
    puzzleId: puzzle.id,
    actionLog: live.actionLog,
    updatedAt: new Date(0).toISOString(),
  };
  const restored = restoreSession(saved, getPuzzleById);

  assert.deepEqual(restored?.snapshot, live.snapshot);
  assert.equal(restored?.history.length, live.history.length);
});

test("rejects unknown puzzles and blocked stored actions", () => {
  assert.equal(
    restoreSession({
      version: 1,
      puzzleId: "missing",
      actionLog: "",
      updatedAt: "",
    }, getPuzzleById),
    null,
  );

  const puzzle = PUZZLES[0];
  assert.ok(puzzle);
  assert.equal(
    restoreSession({
      version: 1,
      puzzleId: puzzle.id,
      actionLog: "U",
      updatedAt: "",
    }, getPuzzleById),
    null,
  );
});

test("reads a known saved puzzle pointer without loading board data", () => {
  const values = new Map<string, string>([
    [STORAGE_KEYS.session, JSON.stringify({
      version: 1,
      puzzleId: "ultra-tiny",
      actionLog: "",
      updatedAt: "2026-08-02T00:00:00.000Z",
    })],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
  } as Storage;
  (globalThis as Record<string, unknown>).window = { localStorage: storage };

  try {
    assert.equal(
      loadSessionPuzzleId((puzzleId) => puzzleId === "ultra-tiny"),
      "ultra-tiny",
    );
    assert.equal(loadSessionPuzzleId(() => false), null);
  } finally {
    Reflect.deleteProperty(globalThis as Record<string, unknown>, "window");
  }
});
