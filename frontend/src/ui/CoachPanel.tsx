import { useState, type FormEvent } from "react";
import { Transcript } from "./Transcript";
import { difficultyNote } from "../coach/difficultyNote";
import { LevelControl } from "./LevelControl";
import type { Coach } from "./useCoach";
import type { Level } from "../types";
import { clockRemaining } from "../coach/drillClock";

interface Props {
  coach: Coach;
  onChoose(): void;
  onLevels(levels: Level[]): void;
}

function promptFor(coach: Coach): { head: string; body: string } {
  if (coach.checkingMove)
    return { head: "Checking the continuation…", body: "Your move is on the board. The coach is checking what follows." };
  const d = coach.drill;
  if (!d) {
    return {
      head: "Your move and the stronger one",
      body:
        coach.shownTag === "time_trouble"
          ? "Red is the move you played with under 30 seconds left; green is the stronger one."
          : "Red is the move you played in the game; green is the stronger one. Drill this position to find it yourself.",
    };
  }
  const side = d.example.fen.split(" ")[1] === "w" ? "White" : "Black";
  if (d.clock?.status === "ready")
    return {
      head: "Get ready for a timed decision",
      body: "Start the clock when you're ready. The position will appear, and you can drag, type or speak your move.",
    };
  if (d.clock?.status === "expired")
    return {
      head: "Time’s up",
      body: "Retry the timed attempt, or keep practicing without the clock. The answer stays hidden until you ask.",
    };
  if (d.solved) return { head: "Solved", body: "Step through the line with Next, try other moves, or go on to the next position." };
  if (d.revealed)
    return {
      head: "Answer shown",
      body: "Green is the best move, red is your game move. Try the line yourself, or go on to the next position.",
    };
  if (d.lastAttempt && coach.fen === d.example.fen && !coach.pendingLeft)
    return {
      head: "Try another move",
      body: "The board is back at the original position. Choose See why if you'd like to examine the first reply before trying again.",
    };
  const note = difficultyNote(d.example.level, d.example.kind);
  return {
    head: `${side} to move. What would you play?`,
    body: `In the game you played a weaker move here. This one is ${note}.`,
  };
}

export function CoachPanel({ coach, onChoose, onLevels }: Props) {
  const { drill, lines, status, levels, actions } = coach;
  const busy = coach.busy || coach.checkingMove || coach.narrating;
  const [move, setMove] = useState("");
  const [question, setQuestion] = useState(false);
  const chatting = question || !drill;
  const live = status === "live";
  const prompt = promptFor(coach);
  const hintsLeft = drill ? 3 - drill.hintsGiven : 0;
  const open = !!drill && !drill.solved && !drill.revealed;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = move.trim();
    if (!m || (!chatting && busy)) return;
    setMove("");
    if (chatting) void actions.sendMessage(m);
    else void actions.playTyped(m);
  };

  return (
    <section className="panel coach" aria-labelledby="coach-title">
      <div className="coach-prompt">
        <h2 id="coach-title">{prompt.head}</h2>
        <p>{prompt.body}</p>
      </div>

      {coach.narrating && <p className="form-note" role="status">The coach is explaining this move. Wait before continuing, or speak to interrupt.</p>}
      <div className="coach-actions">
        <button type="button" className="btn" onClick={actions.hint} disabled={!open || hintsLeft === 0 || busy}>
          Hint {drill && <span className="num muted">{hintsLeft} left</span>}
        </button>
        <button type="button" className="btn" onClick={actions.reveal} disabled={!open || busy}>
          Reveal
        </button>
        <button
          type="button"
          className="btn"
          onClick={drill?.lastAttempt && !drill.solved ? () => void actions.retryPosition() : actions.reset}
          disabled={!drill || busy}
        >
          {drill?.lastAttempt && !drill.solved ? "Try again" : "Reset"}
        </button>
        {drill?.lastAttempt && (
          <button type="button" className="btn" disabled={busy} onClick={() => void actions.reviewAttempt()}>
            See why
          </button>
        )}
        {drill ? (
          <button type="button" className="btn" onClick={() => void actions.startDrill(drill.tag)} disabled={busy}>
            Next position
          </button>
        ) : coach.lastShown && coach.shownTag ? (
          <button type="button" className="btn btn-primary" onClick={() => actions.openExample(coach.shownTag!, coach.lastShown!)}>
            Drill this position
          </button>
        ) : (
          <button type="button" className="btn" onClick={onChoose}>
            Choose a focus
          </button>
        )}
      </div>

      <LevelControl levels={levels} onChange={onLevels} compact />

      <div className="transcript-wrap">
        <h3 className="transcript-title">{live ? "Conversation" : "Coach notes"}</h3>
        {/* The one live region for coach text: typed-mode notes (captions included) and the voice conversation. */}
        <Transcript
          lines={lines}
          empty={
            live
              ? "Say hello, or ask what to work on."
              : "Moves you try, hints and answers appear here. Start voice in the rail to talk instead."
          }
        />
      </div>

      {drill?.clock?.status === "running" && (
        <p className="coach-clock-reminder">
          Time left <strong className="num">{Math.ceil(clockRemaining(drill.clock, coach.clockNow) / 1000)}s</strong> · Submit your move to
          stop the clock.
        </p>
      )}
      <form className="move-form" onSubmit={submit}>
        <label htmlFor="move-input" className="sr-only">
          {chatting ? "Message your coach" : "Your move"}
        </label>
        <input
          id="move-input"
          className="input"
          value={move}
          onChange={(e) => setMove(e.target.value)}
          placeholder={chatting ? "Ask your coach a question" : "Type a move, e.g. Nf3 or knight f3"}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="btn btn-primary" disabled={(!chatting && busy) || !move.trim()}>
          {chatting ? "Send" : "Play"}
        </button>
      </form>
      {drill && (
        <button type="button" className="linkish composer-mode" onClick={() => setQuestion(!question)}>
          {question ? "Type a move instead" : "Ask coach a question"}
        </button>
      )}
    </section>
  );
}
