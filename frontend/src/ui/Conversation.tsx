import { useEffect, useState, type FormEvent } from "react";
import type { Coach } from "./useCoach";
import { Transcript } from "./Transcript";

export function Conversation({
  coach,
  open,
  onClose,
}: {
  coach: Coach;
  open: boolean;
  onClose(): void;
}) {
  const [message, setMessage] = useState("");
  const [present, setPresent] = useState(open);
  const live = coach.status === "live";
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), 160);
    return () => window.clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose, open]);
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (open && message.trim() && coach.actions.sendMessage(message))
      setMessage("");
  };
  if (!present) return null;
  return (
    <section
      className={`panel voice-drawer${open ? "" : " is-closing"}`}
      aria-hidden={!open}
      aria-labelledby="voice-conversation-title"
    >
      <header className="voice-drawer-head">
        <div>
          <h2 id="voice-conversation-title">Coach conversation</h2>
          <p className={`voice-drawer-status is-${coach.status}`}>
            {live
              ? "Listening"
              : coach.status === "connecting"
                ? "Connecting voice…"
                : coach.status === "error"
                  ? "Voice stopped"
                  : "Voice off"}
          </p>
        </div>
        <button
          type="button"
          className="btn"
          aria-label="Hide conversation"
          onClick={onClose}
        >
          Hide
        </button>
      </header>
      <p className="voice-drawer-note">
        Talk about your profile or choose a focus. Your conversation stays with
        you when you open the board.
      </p>
      {coach.voiceError && <p className="form-error">{coach.voiceError}</p>}
      <Transcript
        lines={coach.lines}
        empty={
          live
            ? "Say hello, or ask what to work on."
            : "Your conversation will appear here."
        }
      />
      <form className="move-form" onSubmit={send}>
        <label htmlFor="coach-message" className="sr-only">
          Message your coach
        </label>
        <input
          id="coach-message"
          className="input"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ask your coach a question"
          disabled={!live}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!live || !message.trim()}
        >
          Send
        </button>
      </form>
    </section>
  );
}
