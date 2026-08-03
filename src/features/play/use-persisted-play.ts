import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSession,
  isShareableActionLog,
  replayActionLog,
  type GameSession,
  type PuzzleDefinition,
} from "@/src/core";
import {
  recordCompletion,
  type ProgressData,
  type PuzzleRecord,
} from "@/src/shared/progress";
import {
  createProgressWriterId,
  loadProgressSyncSnapshot,
  parseProgressSyncSnapshot,
  persistProgressImport,
  persistProgressReset,
  persistProgressUpdate,
  reconcileProgressSnapshots,
  writeProgressSyncSnapshot,
  type ProgressSyncSnapshot,
} from "@/src/shared/progress-sync";
import { STORAGE_KEYS } from "@/src/shared/storage";
import {
  loadSession,
  saveSession,
} from "@/src/shared/session-persistence";

export interface CompletionRecordUpdate {
  readonly previousBest?: PuzzleRecord;
  readonly newBest: boolean;
}

function createInitialSession(
  puzzle: PuzzleDefinition,
  actionLog?: string,
): { readonly session: GameSession; readonly restored: boolean } {
  if (actionLog !== undefined) {
    if (!isShareableActionLog(actionLog)) {
      throw new Error("Cannot replay an invalid or oversized shared route.");
    }
    try {
      return { session: replayActionLog(puzzle, actionLog), restored: false };
    } catch {
      return { session: createSession(puzzle), restored: false };
    }
  }

  const stored = loadSession((puzzleId) =>
    puzzleId === puzzle.id ? puzzle : undefined);
  if (stored && stored.session.puzzle.id === puzzle.id) {
    return { session: stored.session, restored: stored.resumed };
  }

  return { session: createSession(puzzle), restored: false };
}

export function usePersistedPlay(
  puzzle: PuzzleDefinition,
  actionLog?: string,
  onSessionRestored?: (moves: number) => void,
) {
  const [initialSession] = useState(() =>
    createInitialSession(puzzle, actionLog));
  const [session, setSession] = useState<GameSession>(initialSession.session);
  const [sessionRestored, setSessionRestored] = useState(
    initialSession.restored,
  );
  const [writerId] = useState(createProgressWriterId);
  const [initialProgressSnapshot] = useState(loadProgressSyncSnapshot);
  const progressSyncRef = useRef(initialProgressSnapshot);
  const [progress, setProgress] = useState<ProgressData>(
    initialProgressSnapshot.progress,
  );
  const sessionRef = useRef(session);
  const initializedRef = useRef(false);

  const commitSession = useCallback((next: GameSession) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const commitProgressSnapshot = useCallback((next: ProgressSyncSnapshot) => {
    progressSyncRef.current = next;
    setProgress(next.progress);
  }, []);

  useEffect(() => {
    if (initializedRef.current) {
      const next = createInitialSession(puzzle, actionLog);
      commitSession(next.session);
      setSessionRestored(next.restored);
    }
    initializedRef.current = true;
  }, [puzzle, actionLog, commitSession]);

  useEffect(() => {
    if (sessionRestored && session.actionLog.length > 0) {
      onSessionRestored?.(session.moves);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = `${session.puzzle.title} · Sokomind`;
  }, [session.puzzle.title]);

  useEffect(() => {
    saveSession(session);
  }, [session]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      const current = progressSyncRef.current;
      if (event.key !== STORAGE_KEYS.progress || !current) return;

      if (event.newValue === null) {
        const reset = persistProgressReset(current, writerId);
        commitProgressSnapshot(reset.snapshot);
        return;
      }

      const incoming = parseProgressSyncSnapshot(event.newValue);
      if (!incoming) return;

      const reconciliation = reconcileProgressSnapshots(
        current,
        incoming,
        writerId,
      );
      commitProgressSnapshot(reconciliation.snapshot);
      if (reconciliation.shouldPersist) {
        writeProgressSyncSnapshot(reconciliation.snapshot);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [commitProgressSnapshot, writerId]);

  const recordSolvedSession = useCallback(
    (solved: GameSession): CompletionRecordUpdate => {
      const current = progressSyncRef.current ?? loadProgressSyncSnapshot();
      const update = persistProgressUpdate(
        current,
        writerId,
        (stored) => recordCompletion(
          stored,
          solved.puzzle.id,
          solved.moves,
          solved.pushes,
        ),
      );
      commitProgressSnapshot(update.snapshot);
      return Object.freeze({
        previousBest: update.previous.completed[solved.puzzle.id],
        newBest: update.changed,
      });
    },
    [commitProgressSnapshot, writerId],
  );

  const importProgress = useCallback((imported: ProgressData) => {
    const current = progressSyncRef.current ?? loadProgressSyncSnapshot();
    const update = persistProgressImport(
      current,
      writerId,
      imported,
    );
    commitProgressSnapshot(update.snapshot);
  }, [commitProgressSnapshot, writerId]);

  const resetProgress = useCallback(() => {
    const current = progressSyncRef.current ?? loadProgressSyncSnapshot();
    const update = persistProgressReset(current, writerId);
    commitProgressSnapshot(update.snapshot);
  }, [commitProgressSnapshot, writerId]);

  return {
    session,
    sessionRestored,
    sessionRef,
    progress,
    commitSession,
    recordSolvedSession,
    importProgress,
    resetProgress,
  } as const;
}
