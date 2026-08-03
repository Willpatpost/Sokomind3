import type { PuzzleDefinition } from "../core/model.ts";
import { getPuzzleMetadataById } from "./puzzle-metadata.ts";

const shardUrls = import.meta.glob<string>("./puzzle-shards/*.json", {
  eager: true,
  import: "default",
  query: "?url",
});
const shardCache = new Map<string, readonly PuzzleDefinition[]>();
const shardRequests = new Map<string, Promise<readonly PuzzleDefinition[]>>();

function shardKey(shard: string): string {
  return `./puzzle-shards/${shard}.json`;
}

async function warmRuntimeCache(url: string): Promise<void> {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
        once: true,
      });
    });
  }
  await fetch(url);
}

export async function loadPuzzleById(
  puzzleId: string,
): Promise<PuzzleDefinition | undefined> {
  const metadata = getPuzzleMetadataById(puzzleId);
  if (!metadata) return undefined;

  const key = shardKey(metadata.shard);
  let puzzles = shardCache.get(key);
  if (!puzzles) {
    const url = shardUrls[key];
    if (!url) throw new Error(`Missing puzzle board shard: ${metadata.shard}`);
    let request = shardRequests.get(key);
    if (!request) {
      request = (async () => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Puzzle board shard request failed: ${response.status}`);
        }
        const parsed: unknown = await response.json();
        if (!Array.isArray(parsed)) {
          throw new Error(`Puzzle board shard is invalid: ${metadata.shard}`);
        }
        return Object.freeze(parsed as PuzzleDefinition[]);
      })();
      shardRequests.set(key, request);
    }
    try {
      puzzles = await request;
    } catch (error) {
      shardRequests.delete(key);
      throw error;
    }
    shardCache.set(key, puzzles);
    void warmRuntimeCache(url).catch(() => {});
  }

  return puzzles.find((puzzle) => puzzle.id === puzzleId);
}
