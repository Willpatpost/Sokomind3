import type {
  EnginePayload,
  EngineSearchResult,
} from "./engine-protocol.ts";

export function search(
  payload: EnginePayload,
): EngineSearchResult;

export function bidirectionalSide(
  payload: EnginePayload,
): void;
