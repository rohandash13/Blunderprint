import { useEffect, useRef, useState, type FormEvent } from "react";
import { difficultyNote } from "../coach/difficultyNote";
import { LevelControl } from "./LevelControl";
import type { Coach } from "./useCoach";
import type { Level } from "../types";

interface Props {
  coach: Coach;
  onChoose(): void;
  onLevels(levels: Level[]): void;
}

function promptFor(coach: Coach): { head: string; body: string } {
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
  if (d.solved) return { head: "Solved", body: "Step through the line with Next, try other moves, or go on to the next position." };
  if (d.revealed) return { head: "Answer shown", body: "Green is the best move, red is your game move. Try the line yourself, or go on to the next position." };
  const note = difficultyNote(d.example.level, d.example.kind);
  return {
    head: `${side} to move. What would you play?`,
    body: `In the game you played a weaker move here. This one is ${note}.`,
  };
}

export function CoachPanel({ coach, onChoose, onLevels }: Props) {
  const { drill, lines, status, levels, busy, actions } = coach;
  const [move, setMove] = useState("");
  const logRef = useRef<HTMLOListElement>(null);
  const live = status === "live";
  const prompt = promptFor(coach);
  const hintsLeft = drill ? 3 - drill.hintsGiven : 0;
  const open = !!drill && !drill.solved && !drill.revealed;

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = move.trim();
    if (!m) return;
    setMove("");
    void actions.playTyped(m);
  };

  return (
    <section className="panel coach" aria-labelledby="coach-title">
      <div className="coach-prompt">
        <h2 id="coach-title">{prompt.head}</h2>
        <p>{prompt.body}</p>
      </div>

      <div className="coach-actions">
        <button type="button" className="btn" onClick={actions.hint} disabled={!open || hintsLeft === 0 || busy}>
          Hint {drill && <span className="num muted">{hintsLeft} left</span>}
        </button>
        <button type="button" className="btn" onClick={actions.reveal} disabled={!open || busy}>
          Reveal
        </button>
        <button type="button" className="btn" onClick={actions.reset} disabled={!drill || busy}>
          Reset
        </button>
        {drill ? (
          <button type="button" className="btn" onClick={() => void actions.startDrill(drill.tag)} disabled={busy}>
            Next position
          </button>
        ) : coach.lastShown && coach.shownTag && coach.shownTag !== "time_trouble" ? (
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
        <ol className="transcript" ref={logRef} aria-live="polite" aria-label="Transcript">
          {lines.length === 0 && (
            <li className="transcript-empty">{live ? "Say hello, or ask what to work on." : "Moves you try, hints and answers appear here. Start voice in the rail to talk instead."}</li>
          )}
          {lines.map((l) => (
            <li key={l.id} className={`line line-${l.role}`}>
              <span className="line-who">{l.role === "user" ? "You" : "Coach"}</span>
              <span className="line-text">{l.content}</span>
            </li>
          ))}
        </ol>
      </div>

      <form className="move-form" onSubmit={submit}>
        <label htmlFor="move-input" className="sr-only">
          Your move
        </label>
        <input
          id="move-input"
          className="input"
          value={move}
          onChange={(e) => setMove(e.target.value)}
          placeholder={drill ? "Type a move, e.g. Nf3 or knight f3" : "Open a drill to type moves"}
          autoComplete="off"
          spellCheck={false}
          disabled={!drill}
        />
        <button type="submit" className="btn btn-primary" disabled={!drill || !move.trim()}>
          Play
        </button>
      </form>
    </section>
  );
}
