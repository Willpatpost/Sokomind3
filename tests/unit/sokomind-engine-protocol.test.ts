import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dispatchEngineCommand,
  isEngineCommand,
  isEngineResult,
  type EnginePayload,
  type EngineRuntime,
  type EngineSearchResult,
} from "../../src/solver/implementations/sokomind-engine/engine-protocol.ts";

describe("Sokomind engine worker protocol", () => {
  it("accepts only supported modes with record payloads", () => {
    for (const mode of ["search", "bidir-forward", "bidir-reverse"] as const) {
      assert.equal(isEngineCommand({ mode, payload: {} }), true);
    }

    assert.equal(isEngineCommand(null), false);
    assert.equal(isEngineCommand([]), false);
    assert.equal(isEngineCommand({ mode: "unknown", payload: {} }), false);
    assert.equal(isEngineCommand({ mode: "search" }), false);
    assert.equal(isEngineCommand({ mode: "search", payload: null }), false);
    assert.equal(isEngineCommand({ mode: "search", payload: [] }), false);
    assert.equal(isEngineCommand({ mode: "search", payload: new Map() }), false);
    assert.equal(isEngineCommand({ mode: "search", payload: new Date() }), false);
  });

  it("validates inbound engine result envelopes", () => {
    assert.equal(isEngineResult({ type: "progress", visited: 12 }), true);
    assert.equal(
      isEngineResult({ type: "done", status: "solved", path: ["Up"] }),
      true,
    );
    assert.equal(isEngineResult({ type: "unknown" }), false);
    assert.equal(isEngineResult({ type: "progress", visited: "12" }), false);
    assert.equal(isEngineResult({ type: "done", path: [42] }), false);
    assert.equal(isEngineResult({ type: "records", records: {} }), false);
  });

  it("turns malformed commands into a bounded failure without calling the engine", () => {
    let calls = 0;
    const runtime: EngineRuntime = {
      search: () => {
        calls += 1;
        return {};
      },
      bidirectionalSide: () => {
        calls += 1;
      },
    };

    assert.deepEqual(dispatchEngineCommand({ mode: "bogus" }, runtime), {
      type: "done",
      status: "failed",
      terminationReason: "invalid-command",
      error: "Malformed engine command.",
      path: null,
      visited: 0,
      generated: 0,
    });
    assert.equal(calls, 0);
  });

  it("preserves search results and bidirectional dispatch semantics", () => {
    const searchPayload: EnginePayload = Object.freeze({ algorithm: "ultimate" });
    const searchResult: EngineSearchResult = {
      status: "solved",
      path: ["Up"],
      visited: 7,
      generated: 11,
    };
    let bidirectionalPayload: EnginePayload | undefined;
    const runtime: EngineRuntime = {
      search: (payload) => {
        assert.equal(payload, searchPayload);
        return searchResult;
      },
      bidirectionalSide: (payload) => {
        bidirectionalPayload = payload;
      },
    };

    assert.deepEqual(
      dispatchEngineCommand(
        { mode: "search", payload: searchPayload },
        runtime,
      ),
      { type: "done", ...searchResult },
    );
    assert.equal(
      dispatchEngineCommand(
        {
          mode: "bidir-reverse",
          payload: { mode: "untrusted", shard: 2 },
        },
        runtime,
      ),
      null,
    );
    assert.deepEqual(bidirectionalPayload, {
      mode: "bidir-reverse",
      shard: 2,
    });
  });

  it("serializes engine exceptions as failed results", () => {
    const runtime: EngineRuntime = {
      search: () => {
        throw new Error("engine exploded");
      },
      bidirectionalSide: () => {},
    };

    assert.deepEqual(
      dispatchEngineCommand({ mode: "search", payload: {} }, runtime),
      {
        type: "done",
        status: "failed",
        terminationReason: "worker-exception",
        error: "engine exploded",
        path: null,
        visited: 0,
        generated: 0,
      },
    );
  });
});
