import { useMemo } from "react";
import { patternLabel } from "../coach/patternLabels";
import { leaksBeside, profileInsights, recommendedPattern } from "../profile/profileInsights";
import { profileSummaryParts } from "../profile/profileSummary";
import type { GridGame, GridMark, Profile as ProfileData } from "../profile/types";
import type { Level, Report } from "../types";
import { BlunderprintGrid } from "./BlunderprintGrid";
import { dateRange, fmtInt, formatDate, ratingChips, signed } from "./format";
import { ExternalIcon } from "./Icons";
import { useSnapHeight } from "./useSnapHeight";

interface Props {
  profile: ProfileData;
  report: Report | null;
  levels: Level[];
  onLevels(levels: Level[]): void;
  onOpenMark(tag: string, mark: GridMark, game: GridGame): void;
  openingMark: string | null;
  markError: string | null;
  onDrill(tag: string): void;
  onChangePlayer(): void;
}

const LEVEL_WORD: Record<Level, string> = { slip: "slips", tricky: "tricky", deep: "deep", unrated: "not yet rated" };

export function Profile({ profile, report, levels, onLevels, onOpenMark, openingMark, markError, onDrill, onChangePlayer }: Props) {
  const summary = useMemo(() => profileSummaryParts(profile), [profile]);
  const insights = useMemo(() => profileInsights(profile), [profile]);
  const start = useMemo(() => recommendedPattern(profile), [profile]);
  const strengths = insights.strengths;
  const strengthsRef = useSnapHeight<HTMLElement>();
  const leaksRef = useSnapHeight<HTMLElement>();
  const startRef = useSnapHeight<HTMLElement>();
  const leaks = leaksBeside(insights, start?.tag ?? null);
  const chips = ratingChips(profile.ratings);
  const range = dateRange(profile.analyzed.from, profile.analyzed.to);
  const { white, black } = profile.record;

  const startLabel = start ? patternLabel(start.tag) : null;
  const drillable = start && report ? (report.patterns.find((p) => p.tag === start.tag)?.examples.length ?? 0) > 0 : false;
  const atLevels = start ? levels.reduce((n, l) => n + (start.levels[l] ?? 0), 0) : 0;
  const mainLevel = start ? (["deep", "tricky", "slip"] as Level[]).filter((l) => levels.includes(l)).sort((a, b) => start.levels[b] - start.levels[a])[0] : null;

  return (
    <div className="profile">
      <div className="profile-head">
        <header className="player">
          <div className="player-id">
            <h1>{profile.username}</h1>
            <p className="player-sub">
              <a href={`https://lichess.org/@/${encodeURIComponent(profile.username)}`} target="_blank" rel="noreferrer" className="ext">
                Lichess profile
                <ExternalIcon />
              </a>
              <span aria-hidden="true">·</span>
              <button type="button" className="linkish" onClick={onChangePlayer}>
                Change player
              </button>
            </p>
          </div>
          {chips.length > 0 ? (
            <ul className="chips" aria-label="Lichess ratings, change over the last 90 days">
              {chips.map((c) => (
                <li key={c.perf} className="chip">
                  <span className="chip-perf">{c.label}</span>
                  <span className="num chip-rating">{c.rating}</span>
                  <span className={`num chip-trend ${c.prog > 0 ? "is-up" : c.prog < 0 ? "is-down" : ""}`} title="Change over the last 90 days">
                    {signed(c.prog)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="chips-missing">Ratings unavailable: Lichess didn't answer.</p>
          )}
        </header>

        <dl className="facts">
          <div>
            <dt>Games analyzed</dt>
            <dd className="num">{fmtInt(profile.analyzed.games)}</dd>
          </div>
          <div>
            <dt>Moves</dt>
            <dd className="num">{fmtInt(profile.analyzed.moves)}</dd>
          </div>
          <div>
            <dt>As White</dt>
            <dd>
              <span className="num">{white.w}</span>W <span className="num">{white.d}</span>D <span className="num">{white.l}</span>L
            </dd>
          </div>
          <div>
            <dt>As Black</dt>
            <dd>
              <span className="num">{black.w}</span>W <span className="num">{black.d}</span>D <span className="num">{black.l}</span>L
            </dd>
          </div>
          {range && (
            <div>
              <dt>Played</dt>
              <dd className="num">{range}</dd>
            </div>
          )}
        </dl>

        <p className="summary">
          {summary.before}
          {summary.mark && <mark className="hl">{summary.mark}</mark>}
          {summary.after}
        </p>
      </div>

      <div className="profile-grid">
        <BlunderprintGrid profile={profile} levels={levels} onLevels={onLevels} onOpen={onOpenMark} opening={openingMark} error={markError} />
      </div>

      <aside className="profile-side" aria-label="Strengths, leaks and where to start">
        <section className="panel side-card" aria-labelledby="strengths-title" ref={strengthsRef}>
          <div className="snap-inner">
          <h2 id="strengths-title">Strengths</h2>
          {strengths.length ? (
            <ul className="insights">
              {strengths.map((s) => (
                <li key={s.id} className="insight is-strength">
                  <i aria-hidden="true" />
                  <span>
                    <span className="insight-text">{s.text}</span>
                    <span className="insight-note">{s.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">Not enough evidence for a clear strength yet.</p>
          )}
          </div>
        </section>

        <section className="panel side-card" aria-labelledby="leaks-title" ref={leaksRef}>
          <div className="snap-inner">
          <h2 id="leaks-title">Leaks</h2>
          {leaks.length ? (
            <ul className="insights">
              {leaks.map((s) => (
                <li key={s.id} className="insight is-leak">
                  <i aria-hidden="true" />
                  <span>
                    <span className="insight-text">{s.text}</span>
                    <span className="insight-note">{s.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No repeating leak stands out.</p>
          )}
          </div>
        </section>

        {start && startLabel && (
          <section className="panel start-card" aria-labelledby="start-title" ref={startRef}>
          <div className="snap-inner">
            <h2 id="start-title" className="start-title">
              Start with <span className="hl-stroke">{startLabel.name.toLowerCase()}</span>
            </h2>
            <p className="plate-note">{startLabel.description}</p>
            <dl className="plate-figures">
              <div>
                <dt>Marks</dt>
                <dd className="num">{start.count}</dd>
              </div>
              <div>
                <dt title="Marks at the difficulty you picked">At your levels</dt>
                <dd className="num">{atLevels}</dd>
              </div>
              <div>
                <dt>Last seen</dt>
                <dd className="num">{formatDate(start.lastSeen)}</dd>
              </div>
            </dl>
            <button type="button" className="btn btn-primary btn-block" disabled={!drillable} onClick={() => onDrill(start.tag)}>
              Drill this pattern
            </button>
            {!drillable && (
              <p className="form-note">{report ? "No positions at this difficulty. Turn on another level." : "Loading positions…"}</p>
            )}
            {drillable && mainLevel && <p className="form-note">Mostly {LEVEL_WORD[mainLevel]} at the difficulty you picked.</p>}
            </div>
        </section>
        )}
      </aside>
    </div>
  );
}
