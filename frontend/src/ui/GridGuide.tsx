import { ChevronRight } from "./Icons";

export function GridGuide() {
  return (
    <section className="grid-guide" aria-labelledby="grid-guide-title">
      <details open>
        <summary id="grid-guide-title">
          How to read your grid
          <ChevronRight />
        </summary>
        <p className="grid-guide-intro">
          Rows are mistake patterns. Each column is one game, oldest on the
          left. Click a dot to open that position.
        </p>
        <ul className="grid-guide-levels" aria-label="Move difficulty">
          <li>
            <i className="mark-key lv-slip" aria-hidden="true" />
            <span>
              <strong>Hollow · Slip</strong>
              <span>Usually within reach at your rating</span>
            </span>
          </li>
          <li>
            <i className="mark-key lv-tricky" aria-hidden="true" />
            <span>
              <strong>Black · Tricky</strong>
              <span>Worth slowing down for</span>
            </span>
          </li>
          <li>
            <i className="mark-key lv-deep" aria-hidden="true" />
            <span>
              <strong>Red · Deep</strong>
              <span>A stretch at your rating</span>
            </span>
          </li>
          <li>
            <i className="mark-key lv-unrated" aria-hidden="true" />
            <span>
              <strong>Dashed · Not yet rated</strong>
              <span>Difficulty unknown; always shown</span>
            </span>
          </li>
        </ul>
        <div className="grid-guide-details">
          <p>
            <span className="guide-sizes" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>
              <strong>Bigger dot = bigger mistake.</strong> Size shows the drop
              in your winning chances.
            </span>
          </p>
          <p>
            <i className="mark-key lv-tricky is-multi" aria-hidden="true" />
            <span>
              <strong>Outer ring = several mistakes.</strong> Same pattern, same
              game. The dot shows the costliest one.
            </span>
          </p>
        </div>
        <div className="grid-guide-meta">
          <p>
            Above each game:{" "}
            <span>
              <i className="side side-white" aria-hidden="true" /> you were
              White
            </span>
            <span>
              <i className="side side-black" aria-hidden="true" /> you were
              Black
            </span>
          </p>
          <p>
            Yellow row = the most frequent pattern at the levels shown. Yellow
            buttons select visible levels.
          </p>
        </div>
      </details>
    </section>
  );
}
