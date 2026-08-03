export const ENGINE_MODES = Object.freeze([
  "search",
  "bidir-forward",
  "bidir-reverse",
] as const);

export type EngineMode = (typeof ENGINE_MODES)[number];
export type EnginePayload = Readonly<Record<string, unknown>>;

export interface EngineCommand {
  readonly mode: EngineMode;
  readonly payload: EnginePayload;
}

export type EngineResultType =
  | "contour"
  | "done"
  | "landmark"
  | "landmarks"
  | "progress"
  | "records"
  | "reverse-starts";

/** Fields returned by search or consumed from incremental worker telemetry. */
export interface EngineResultPayload {
  readonly analysis?: unknown;
  readonly arenaStates?: number;
  readonly compactArenaAllocatedBytes?: number;
  readonly compactPathBytes?: number;
  readonly cutoff?: boolean;
  readonly error?: string;
  readonly frontier?: number;
  readonly generated?: number;
  readonly moveVisited?: number;
  readonly path?: readonly string[] | null;
  readonly peakFrontier?: number;
  readonly performance?: Readonly<Record<string, unknown>>;
  readonly retained?: number;
  readonly status?: string;
  readonly terminationReason?: string;
  readonly visited?: number;
}

export type EngineSearchResult = EngineResultPayload;

export interface EngineResult extends EngineResultPayload {
  readonly type: EngineResultType;
  readonly records?: readonly unknown[];
}

export interface EngineRuntime {
  search(payload: EnginePayload): EngineSearchResult;
  bidirectionalSide(payload: EnginePayload): void;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function isEngineCommand(value: unknown): value is EngineCommand {
  if (!isRecord(value)) return false;
  return (
    ENGINE_MODES.some((mode) => mode === value.mode) &&
    isRecord(value.payload)
  );
}

function hasOptionalNumber(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return value[key] === undefined ||
    (typeof value[key] === "number" && Number.isFinite(value[key]));
}

export function isEngineResult(value: unknown): value is EngineResult {
  if (!isRecord(value)) return false;
  if (!ENGINE_RESULT_TYPES.has(value.type)) return false;
  if (
    !hasOptionalNumber(value, "visited") ||
    !hasOptionalNumber(value, "generated") ||
    !hasOptionalNumber(value, "retained") ||
    !hasOptionalNumber(value, "frontier") ||
    !hasOptionalNumber(value, "peakFrontier")
  ) {
    return false;
  }
  if (
    value.path !== undefined &&
    value.path !== null &&
    (!Array.isArray(value.path) ||
      value.path.some((step) => typeof step !== "string"))
  ) {
    return false;
  }
  if (value.records !== undefined && !Array.isArray(value.records)) return false;
  if (value.status !== undefined && typeof value.status !== "string") return false;
  if (
    value.terminationReason !== undefined &&
    typeof value.terminationReason !== "string"
  ) {
    return false;
  }
  return true;
}

const ENGINE_RESULT_TYPES: ReadonlySet<unknown> = new Set<unknown>([
  "contour",
  "done",
  "landmark",
  "landmarks",
  "progress",
  "records",
  "reverse-starts",
]);

function failedResult(
  terminationReason: "invalid-command" | "worker-exception",
  error: string,
): EngineResult {
  return {
    type: "done",
    status: "failed",
    terminationReason,
    error,
    path: null,
    visited: 0,
    generated: 0,
  };
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Validates and dispatches one worker command. Bidirectional searches publish
 * their own incremental results and therefore return `null` here.
 */
export function dispatchEngineCommand(
  value: unknown,
  runtime: EngineRuntime,
): EngineResult | null {
  try {
    if (!isEngineCommand(value)) {
      return failedResult("invalid-command", "Malformed engine command.");
    }

    if (value.mode === "bidir-forward" || value.mode === "bidir-reverse") {
      runtime.bidirectionalSide({
        ...value.payload,
        mode: value.mode,
      });
      return null;
    }

    return {
      type: "done",
      ...runtime.search(value.payload),
    };
  } catch (error) {
    return failedResult("worker-exception", serializeError(error));
  }
}
