import { useEffect, useState, type FormEvent } from "react";
import { fetchProfile } from "../api";
import type { Profile } from "../profile/types";
import { buildGrid, markSize, PICK_LEVELS } from "./gridLayout";

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
      <div className="landing-row">
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
      <DemoStrip />
      </div>
    </section>
  );
}

const STRIP_ROWS = 5;

/** A read-only glimpse of the sample player's grid, so the product shows itself before the first click. */
function DemoStrip() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let live = true;
    fetchProfile(SAMPLE_PLAYER)
      .then((p) => live && setProfile(p))
      .catch(() => undefined); // no strip when the sample isn't available
    return () => {
      live = false;
    };
  }, []);
  if (!profile || profile.grid.length === 0) return null;
  const grid = buildGrid(profile, [...PICK_LEVELS]);
  const rows = grid.rows.filter((r) => r.tag !== "other").slice(0, STRIP_ROWS);
  if (rows.length === 0) return null;
  return (
    <figure className="panel demo-strip">
      <div className="demo-sheet" aria-hidden="true" style={{ ["--cols" as string]: grid.games.length }}>
        {rows.map((r) => (
          <div key={r.tag} className={r.tag === grid.worst ? "demo-row is-worst" : "demo-row"}>
            <span className="demo-name">{r.name}</span>
            <span className="demo-cells">
              {r.cells.map((c) => (
                <i key={c.col} className={`demo-dot lv-${c.marks[0].level} sz-${markSize(c.marks[0].winDrop)}`} style={{ gridColumn: c.col + 1 }} />
              ))}
            </span>
          </div>
        ))}
      </div>
      <figcaption>
        {SAMPLE_PLAYER}'s last <span className="num">{grid.games.length}</span> games: patterns down the side, games across, every mistake a mark you can open and replay.
      </figcaption>
    </figure>
  );
}
