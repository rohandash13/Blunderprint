import { clockRemaining, type DrillClock } from "../coach/drillClock";

interface Props {
  clock: DrillClock;
  now: number;
  onUntimed(): void;
  onRetry(): void;
  busy: boolean;
}

export function DecisionClock({ clock, now, onUntimed, onRetry, busy }: Props) {
  const left = clockRemaining(clock, now);
  const seconds = Math.ceil(left / 1000);
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const state = clock.status;
  const label =
    state === "ready"
      ? "Your decision clock"
      : state === "expired"
        ? "Time’s up"
        : state === "submitted"
          ? "Move submitted"
          : state === "untimed"
            ? "Untimed practice"
            : "Make your move";
  return (
    <section className={`decision-clock is-${state}${state === "running" && left <= 10000 ? " is-low" : ""}`} aria-label="Decision clock">
      <div className="decision-clock-face">
        <h2>{label}</h2>
        <span role="timer" aria-label="Time remaining" aria-live="off" className="num">
          {state === "untimed" ? "—" : text}
        </span>
      </div>
      <p>
        {state === "submitted"
          ? "Clock stopped on your move. Review the continuation at your own pace."
          : state === "untimed"
            ? "Take your time. Reset to try a timed attempt again."
            : clock.source === "game"
              ? "Practice budget from your game’s recorded post-move clock."
              : "Practice budget: thirty seconds. No usable game clock was recorded."}
      </p>
      <div className="clock-actions">
        {state === "expired" && (
          <button type="button" className="btn btn-primary" onClick={onRetry} disabled={busy}>
            Retry timed attempt
          </button>
        )}
        {(state === "ready" || state === "expired" || state === "running") && (
          <button type="button" className="linkish" onClick={onUntimed} disabled={busy}>
            Practice without clock
          </button>
        )}
      </div>
    </section>
  );
}
