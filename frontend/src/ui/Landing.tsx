import { useState, type FormEvent } from "react";

export const SAMPLE_PLAYER = "Knight_ofthelight73";

interface Props {
  error: string | null;
  initial: string;
  onSubmit(username: string): void;
}

export function Landing({ error, initial, onSubmit }: Props) {
  const [name, setName] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSubmit(name.trim());
  };
  return (
    <section className="landing">
      <div className="panel landing-panel">
        <h1>See how you play, then fix it on your own positions</h1>
        <p className="lede">
          Blunderprint reads your recent rated Lichess games, finds the mistakes you keep repeating, and coaches you through those
          positions by voice or by typing.
        </p>
        <form className="landing-form" onSubmit={submit}>
          <label htmlFor="username">Lichess username</label>
          <div className="field-row">
            <input
              id="username"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Your Lichess name"
              aria-invalid={!!error}
              aria-describedby={error ? "landing-error" : "landing-note"}
            />
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
              Analyze
            </button>
          </div>
          {error ? (
            <p id="landing-error" className="form-error" role="alert">
              {error}
            </p>
          ) : (
            <p id="landing-note" className="form-note">
              Up to 40 recent rated games. Players analyzed this week open straight away; a new player takes a few minutes.
            </p>
          )}
        </form>
        <p className="try">
          No account handy?{" "}
          <button type="button" className="linkish" onClick={() => onSubmit(SAMPLE_PLAYER)}>
            Try {SAMPLE_PLAYER}
          </button>
        </p>
      </div>
    </section>
  );
}
