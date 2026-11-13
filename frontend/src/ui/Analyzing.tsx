import { describeEta, fmtInt } from "./format";
import type { AnalysisView } from "./useAnalysis";

interface Props {
  username: string;
  view: AnalysisView;
  onCancel(): void;
}

export function Analyzing({ username, view, onCancel }: Props) {
  const p = view.progress;
  const total = p?.totalFens ?? 0;
  const done = p?.doneFens ?? 0;
  const queued = view.queuePosition > 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const scoring = p?.status === "SCORING";

  let headline = `Reading ${username}'s games`;
  if (queued) headline = `${username} is in the queue`;
  else if (scoring) headline = `Sorting ${username}'s mistakes`;

  let detail: string;
  if (queued) detail = view.queuePosition === 1 ? "One analysis is ahead of yours. Yours starts as soon as it finishes." : `${view.queuePosition} analyses are ahead of yours. They run one at a time.`;
  else if (!p) detail = view.games ? `Fetched ${view.games} rated games. Starting the engine.` : "Checking Lichess for recent rated games.";
  else if (scoring) detail = "Every position is checked. Judging how hard each mistake was for your rating.";
  else detail = describeEta(view.etaSeconds);

  return (
    <section className="analyzing">
      <div className="panel analyzing-panel" aria-busy="true">
        <h1>{headline}</h1>
        <p className="lede" aria-live="polite">
          {detail}
        </p>
        <div className="progress">
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Positions analyzed"
            aria-valuemin={0}
            aria-valuemax={total || 100}
            aria-valuenow={total ? done : undefined}
            aria-valuetext={total ? `${fmtInt(done)} of ${fmtInt(total)} positions` : "Waiting to start"}
          >
            <div className={total ? "progress-fill" : "progress-fill is-waiting"} style={{ width: total ? `${pct}%` : undefined }} />
          </div>
          <p className="progress-figures">
            {total ? (
              <>
                <span className="num">{fmtInt(done)}</span> of <span className="num">{fmtInt(total)}</span> positions
                {p && p.failedFens > 0 && (
                  <>
                    {" "}
                    · <span className="num">{fmtInt(p.failedFens)}</span> skipped
                  </>
                )}
              </>
            ) : (
              "Waiting for the engine"
            )}
          </p>
        </div>
        {view.stalled && (
          <p className="form-error" role="status">
            The server isn't answering right now. Still trying every few seconds.
          </p>
        )}
        <p className="analyzing-note">You can leave this tab open; the profile opens on its own when the analysis is done.</p>
        <button type="button" className="btn" onClick={onCancel}>
          Choose another player
        </button>
      </div>
    </section>
  );
}
