export interface DrillClock {
  budgetMs: number;
  source: "game" | "fallback";
  status: "ready" | "running" | "submitted" | "expired" | "untimed";
  deadline: number | null;
  remainingMs: number;
}

/** Lichess's stored clock is a post-move reading, used as a practice budget, not reconstructed thinking time. */
export function newDrillClock(recordedCs?: number | null): DrillClock {
  const fromGame = typeof recordedCs === "number" && Number.isFinite(recordedCs) && recordedCs > 0 && recordedCs <= 3000;
  const budgetMs = fromGame ? recordedCs * 10 : 30000;
  return { budgetMs, source: fromGame ? "game" : "fallback", status: "ready", deadline: null, remainingMs: budgetMs };
}

export function clockRemaining(clock: DrillClock, now = Date.now()) {
  return clock.status === "running" ? Math.max(0, (clock.deadline ?? now) - now) : clock.remainingMs;
}

export function expireClock(clock: DrillClock, now = Date.now()) {
  if (clock.status !== "running" || clockRemaining(clock, now) > 0) return false;
  clock.status = "expired";
  clock.remainingMs = 0;
  clock.deadline = null;
  return true;
}

export function clockInputError(clock?: DrillClock) {
  if (!clock) return null;
  expireClock(clock);
  if (clock.status === "ready") return "Start the clock when you're ready, or choose Practice without clock.";
  if (clock.status === "expired") return "Time's up. Reset to retry, or choose Practice without clock.";
  return null;
}

export function submitClock(clock?: DrillClock) {
  if (clock?.status !== "running") return;
  clock.remainingMs = clockRemaining(clock);
  clock.deadline = null;
  clock.status = "submitted";
}
