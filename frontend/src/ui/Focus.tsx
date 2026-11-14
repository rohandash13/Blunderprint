import { patternLabel, sortPatterns } from "../coach/patternLabels";
import type { Profile } from "../profile/types";
import type { Level, Report } from "../types";
import { formatDate } from "./format";
import { LevelControl } from "./LevelControl";
import { buildGrid } from "./gridLayout";

interface Props {
  profile: Profile;
  report: Report | null;
  reportError: string | null;
  levels: Level[];
  onLevels(levels: Level[]): void;
  onDrill(tag: string): void;
  onShow(tag: string): void;
  busy: boolean;
}

export function Focus({ profile, report, reportError, levels, onLevels, onDrill, onShow, busy }: Props) {
  const patterns = sortPatterns(profile.patterns.filter((p) => p.count > 0));
  const worst = buildGrid(profile, levels).worst;
  const levelCounts = patterns.reduce(
    (acc, p) => ({ slip: acc.slip + p.levels.slip, tricky: acc.tricky + p.levels.tricky, deep: acc.deep + p.levels.deep }),
    { slip: 0, tricky: 0, deep: 0 },
  );

  return (
    <div className="focus">
      <header className="focus-head">
        <div>
          <h1>Choose a focus</h1>
          <p className="lede">Pick a pattern to drill. Each position comes from one of your games, with your move hidden.</p>
        </div>
        <LevelControl
          levels={levels}
          onChange={onLevels}
          counts={levelCounts}
          scope={`Counts across all ${profile.analyzed.games} analyzed games`}
        />
      </header>

      {reportError && (
        <p className="form-error" role="alert">
          Couldn't load positions: {reportError}
        </p>
      )}

      {patterns.length === 0 ? (
        <p className="panel empty">No repeating mistakes in these games, so there is nothing to drill yet.</p>
      ) : (
        <ul className="plates">
          {patterns.map((p) => {
            const label = patternLabel(p.tag);
            const clock = p.tag === "time_trouble";
            const loaded = !!report;
            const examples = report?.patterns.find((r) => r.tag === p.tag)?.examples.length ?? 0;
            const ready = loaded && examples > 0;
            const canDrill = ready;
            const why = !loaded ? "Loading positions" : "No positions at this difficulty. Turn on another level.";
            const mixedKinds = p.kinds.positional > 0 && p.kinds.tactical > 0;
            const show = () => onShow(p.tag);
            const isWorst = p.tag === worst;
            return (
              <li key={p.tag} className={`panel plate${isWorst ? " is-worst" : ""}${p.tag === "other" ? " is-muted" : ""}`}>
                <div className="plate-top">
                  <h2 className="plate-name">{label.name}</h2>
                  <span className="num plate-count" aria-label={`${p.count} marks`}>
                    {p.count}
                  </span>
                </div>
                <p className="plate-note">{label.description}</p>
                <dl className="plate-figures">
                  <div>
                    <dt>Last seen</dt>
                    <dd className="num">{formatDate(p.lastSeen)}</dd>
                  </div>
                  <div>
                    <dt>Level mix</dt>
                    <dd className="mix">
                      <span title="Slips">
                        <i className="dot lv-slip" aria-hidden="true" />
                        <span className="num">{p.levels.slip}</span>
                        <span className="sr-only"> slips,</span>
                      </span>
                      <span title="Tricky">
                        <i className="dot lv-tricky" aria-hidden="true" />
                        <span className="num">{p.levels.tricky}</span>
                        <span className="sr-only"> tricky,</span>
                      </span>
                      <span title="Deep">
                        <i className="dot lv-deep" aria-hidden="true" />
                        <span className="num">{p.levels.deep}</span>
                        <span className="sr-only"> deep</span>
                      </span>
                    </dd>
                  </div>
                  {mixedKinds && (
                    <div>
                      <dt>Kind</dt>
                      <dd>
                        <span className="num">{p.kinds.positional}</span> positional · <span className="num">{p.kinds.tactical}</span>{" "}
                        tactical
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="plate-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!canDrill || busy}
                    title={canDrill ? undefined : why}
                    onClick={() => onDrill(p.tag)}
                  >
                    {clock ? "Timed drill" : "Drill"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!ready || busy}
                    title={ready ? "See your game move and the stronger one" : why}
                    onClick={show}
                  >
                    See the mistake
                  </button>
                </div>
                {loaded && !canDrill && <p className="plate-why">{why}</p>}
                {clock && canDrill && (
                  <p className="plate-why">Practice a decision against your recorded game clock, or a short fallback timer.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
