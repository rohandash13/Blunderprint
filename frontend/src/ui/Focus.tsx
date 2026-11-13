import { patternLabel, sortPatterns } from "../coach/patternLabels";
import type { Profile } from "../profile/types";
import type { Example, Level, Report } from "../types";
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
  /** Clock-mistake examples at the selected levels (fetched with Slips included); null while loading. */
  clockExamples: Example[] | null;
  onShowExample(tag: string, ex: Example): void;
  busy: boolean;
}

export function Focus({ profile, report, reportError, levels, onLevels, onDrill, onShow, clockExamples, onShowExample, busy }: Props) {
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
        <LevelControl levels={levels} onChange={onLevels} counts={levelCounts} scope={`Counts across all ${profile.analyzed.games} analyzed games`} />
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
            // Clock-pressure mistakes are about time, not the position: never drilled, only shown,
            // from their own example list (the report leaves them out unless Slips is on).
            const clock = p.tag === "time_trouble";
            const loaded = clock ? clockExamples !== null : !!report;
            const examples = clock ? clockExamples?.length ?? 0 : report?.patterns.find((r) => r.tag === p.tag)?.examples.length ?? 0;
            const ready = loaded && examples > 0;
            const canDrill = ready && !clock;
            const why = !loaded
              ? "Loading positions"
              : clock
                ? ready
                  ? "Clock mistakes aren't drilled: they're about time, not the position."
                  : "No clock-mistake positions at these levels. They aren't drilled anyway: they're about time, not the position."
                : "No positions at this difficulty";
            const mixedKinds = p.kinds.positional > 0 && p.kinds.tactical > 0;
            const show = () => (clock ? clockExamples?.[0] && onShowExample(p.tag, clockExamples[0]) : onShow(p.tag));
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
                        <span className="num">{p.kinds.positional}</span> positional · <span className="num">{p.kinds.tactical}</span> tactical
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="plate-actions">
                  <button type="button" className="btn btn-primary" disabled={!canDrill || busy} title={canDrill ? undefined : why} onClick={() => onDrill(p.tag)}>
                    Drill
                  </button>
                  <button type="button" className="btn" disabled={!ready || busy} title={ready ? "See your game move and the stronger one" : why} onClick={show}>
                    See the mistake
                  </button>
                </div>
                {loaded && !canDrill && <p className="plate-why">{why}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
