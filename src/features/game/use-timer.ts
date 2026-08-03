import { useCallback, useEffect, useRef, useState } from "react";
import {
  calculateElapsedTime,
  nextTimerUpdateDelay,
} from "./timer-math.ts";

export interface TimerController {
  readonly elapsed: number;
  readonly running: boolean;
  reset(): void;
}

export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function readPersistedTime(key: string | undefined): number {
  if (!key) return 0;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored !== null) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // sessionStorage may be unavailable; silently ignore.
  }
  return 0;
}

export function useTimer(options: {
  paused: boolean;
  persistKey?: string;
  restorePersisted?: boolean;
}): TimerController {
  const { paused, persistKey, restorePersisted = true } = options;
  const [initialElapsed] = useState(() =>
    restorePersisted ? readPersistedTime(persistKey) : 0);
  const [elapsed, setElapsed] = useState(initialElapsed);
  const [running, setRunning] = useState(false);
  const stateRef = useRef<{ accumulated: number; resumedAt: number | null }>(
    null as never,
  );
  // Lazy-init the ref so it matches the restored elapsed value on first render.
  if (stateRef.current === null) {
    stateRef.current = {
      accumulated: initialElapsed,
      resumedAt: null,
    };
  }
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (restorePersisted || !persistKey) return;
    try {
      sessionStorage.removeItem(persistKey);
    } catch {
      // sessionStorage may be unavailable; silently ignore.
    }
  }, [persistKey, restorePersisted]);

  const stopTick = useCallback(() => {
    if (timeoutRef.current === undefined) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = undefined;
  }, []);

  function startTick() {
    const state = stateRef.current;
    stopTick();

    function tick() {
      if (state.resumedAt === null) return;
      const nextElapsed = calculateElapsedTime(
        state.accumulated,
        state.resumedAt,
        performance.now(),
      );
      setElapsed(nextElapsed);
      timeoutRef.current = window.setTimeout(
        tick,
        nextTimerUpdateDelay(nextElapsed),
      );
    }

    if (state.resumedAt === null) return;
    const currentElapsed = calculateElapsedTime(
      state.accumulated,
      state.resumedAt,
      performance.now(),
    );
    timeoutRef.current = window.setTimeout(
      tick,
      nextTimerUpdateDelay(currentElapsed),
    );
  }

  function persistAccumulated() {
    if (!persistKey) return;
    try {
      sessionStorage.setItem(
        persistKey,
        String(stateRef.current.accumulated),
      );
    } catch {
      // sessionStorage may be unavailable; silently ignore.
    }
  }

  useEffect(() => {
    const state = stateRef.current;

    if (paused) {
      if (state.resumedAt !== null) {
        state.accumulated = calculateElapsedTime(
          state.accumulated,
          state.resumedAt,
          performance.now(),
        );
        state.resumedAt = null;
      }
      stopTick();
      setElapsed(state.accumulated);
      setRunning(false);
      persistAccumulated();
    } else {
      state.resumedAt = performance.now();
      startTick();
      setRunning(true);
    }

    return stopTick;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  useEffect(() => {
    const state = stateRef.current;

    function handleVisibility() {
      if (document.hidden && state.resumedAt !== null) {
        state.accumulated = calculateElapsedTime(
          state.accumulated,
          state.resumedAt,
          performance.now(),
        );
        state.resumedAt = null;
        stopTick();
        setElapsed(state.accumulated);
        setRunning(false);
        persistAccumulated();
      } else if (!document.hidden && !paused) {
        state.resumedAt = performance.now();
        startTick();
        setRunning(true);
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  useEffect(() => () => {
    const state = stateRef.current;
    if (state.resumedAt !== null) {
      state.accumulated = calculateElapsedTime(
        state.accumulated,
        state.resumedAt,
        performance.now(),
      );
      state.resumedAt = null;
    }
    stopTick();
    if (!persistKey) return;
    try {
      sessionStorage.setItem(persistKey, String(state.accumulated));
    } catch {
      // sessionStorage may be unavailable; silently ignore.
    }
  }, [persistKey, stopTick]);

  const reset = useCallback(() => {
    stopTick();
    stateRef.current.accumulated = 0;
    stateRef.current.resumedAt = null;
    setElapsed(0);
    setRunning(false);
    if (persistKey) {
      try {
        sessionStorage.removeItem(persistKey);
      } catch {
        // sessionStorage may be unavailable; silently ignore.
      }
    }
  }, [persistKey, stopTick]);

  return { elapsed, running, reset };
}
