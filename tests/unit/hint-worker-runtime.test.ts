import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createHintWorkerConnection,
  HintWorkerTimeoutError,
} from "../../src/features/game/hint-worker-runtime.ts";
import type { SolverWorkerCommand } from "../../src/solver/protocol.ts";

type WorkerEventType = "message" | "error" | "messageerror";
type WorkerListener = (event: { data?: unknown; message?: string }) => void;

class FakeWorker {
  readonly messages: SolverWorkerCommand[] = [];
  readonly listeners = new Map<WorkerEventType, Set<WorkerListener>>([
    ["message", new Set()],
    ["error", new Set()],
    ["messageerror", new Set()],
  ]);
  terminateCount = 0;

  postMessage(message: SolverWorkerCommand): void {
    this.messages.push(message);
  }

  addEventListener(type: WorkerEventType, listener: WorkerListener): void {
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: WorkerEventType, listener: WorkerListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  emitMessage(data: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }

  emitError(message: string): void {
    for (const listener of this.listeners.get("error") ?? []) listener({ message });
  }

  emitMessageError(): void {
    for (const listener of this.listeners.get("messageerror") ?? []) listener({});
  }
}

function controlledTimer() {
  let callback: (() => void) | undefined;
  let clearCount = 0;
  return {
    setTimer(next: () => void) {
      callback = next;
      return "timer";
    },
    clearTimer() {
      clearCount += 1;
    },
    fire() {
      assert.ok(callback, "expected a pending watchdog");
      callback();
    },
    get clearCount() {
      return clearCount;
    },
  };
}

const metadata = Object.freeze({
  id: "classic-astar",
  displayName: "Classic A*",
  description: "Hint runtime test solver",
  version: "1.0.0",
  capabilities: {
    executionTargets: ["web-worker"] as const,
    runtime: "javascript",
    objectives: ["moves"] as const,
    quality: "first-found",
    labeledBoxes: true,
    genericBoxes: true,
    partialState: true,
    reportsProgress: false,
    cooperativeCancellation: true,
    deterministic: true,
  },
});

describe("hint worker connection", () => {
  it("terminates and reports a silent discovery timeout", async () => {
    const worker = new FakeWorker();
    const timer = controlledTimer();
    const failures: Error[] = [];
    const connection = createHintWorkerConnection(worker as unknown as Worker, {
      startupTimeoutMs: 5_000,
      onFailure: (error) => failures.push(error),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    const discovery = connection.discover();
    timer.fire();

    await assert.rejects(discovery, HintWorkerTimeoutError);
    assert.equal(failures.length, 1);
    assert.match(failures[0]?.message ?? "", /did not respond during startup/);
    assert.equal(worker.terminateCount, 1);
    assert.equal(worker.listeners.get("error")?.size, 0);
    assert.equal(worker.listeners.get("messageerror")?.size, 0);
  });

  it("clears the watchdog after successful discovery", async () => {
    const worker = new FakeWorker();
    const timer = controlledTimer();
    const failures: Error[] = [];
    const connection = createHintWorkerConnection(worker as unknown as Worker, {
      startupTimeoutMs: 5_000,
      onFailure: (error) => failures.push(error),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    const discovery = connection.discover();
    worker.emitMessage({
      protocolVersion: 1,
      type: "solver/ready",
      solvers: [metadata],
    });

    assert.deepEqual(await discovery, [metadata]);
    assert.equal(timer.clearCount, 1);
    assert.deepEqual(failures, []);
    assert.equal(worker.terminateCount, 0);
    connection.dispose();
    assert.equal(worker.terminateCount, 1);
  });

  for (const eventType of ["error", "messageerror"] as const) {
    it(`disposes pending discovery after ${eventType}`, async () => {
      const worker = new FakeWorker();
      const failures: Error[] = [];
      const connection = createHintWorkerConnection(worker as unknown as Worker, {
        startupTimeoutMs: 5_000,
        onFailure: (error) => failures.push(error),
      });
      const discovery = connection.discover();

      if (eventType === "error") worker.emitError("worker exploded");
      else worker.emitMessageError();

      await assert.rejects(discovery, /disposed/);
      assert.equal(failures.length, 1);
      assert.match(
        failures[0]?.message ?? "",
        eventType === "error" ? /worker exploded/ : /unreadable message/,
      );
      assert.equal(worker.terminateCount, 1);
    });
  }

  it("disposes silently when the owner cancels startup", async () => {
    const worker = new FakeWorker();
    const failures: Error[] = [];
    const connection = createHintWorkerConnection(worker as unknown as Worker, {
      startupTimeoutMs: 5_000,
      onFailure: (error) => failures.push(error),
    });
    const discovery = connection.discover();

    connection.dispose();

    await assert.rejects(discovery, /disposed/);
    assert.deepEqual(failures, []);
    assert.equal(worker.terminateCount, 1);
  });
});
