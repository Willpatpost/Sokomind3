const TIMER_DISPLAY_INTERVAL_MS = 1_000;

export function calculateElapsedTime(
  accumulatedMs: number,
  resumedAtMs: number | null,
  nowMs: number,
): number {
  return resumedAtMs === null
    ? accumulatedMs
    : accumulatedMs + (nowMs - resumedAtMs);
}

export function nextTimerUpdateDelay(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return TIMER_DISPLAY_INTERVAL_MS;
  }

  const remainder = elapsedMs % TIMER_DISPLAY_INTERVAL_MS;
  return Math.max(1, TIMER_DISPLAY_INTERVAL_MS - remainder);
}
