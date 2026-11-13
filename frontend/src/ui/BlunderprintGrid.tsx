import { useEffect, useMemo, useRef, useState } from "react";
import type { GridGame, GridMark, Profile } from "../profile/types";
import type { Level } from "../types";
import { buildGrid, describeMark, markSize, markVisible, PICK_LEVELS, resultMark, type GridCell } from "./gridLayout";
import { LevelControl } from "./LevelControl";
import { shortDate } from "./format";

interface Props {
  profile: Profile;
  levels: Level[];
  onLevels(levels: Level[]): void;
  onOpen(tag: string, mark: GridMark, game: GridGame): void;
  /** gameId:ply of the mark being opened. */
  opening: string | null;
  error: string | null;
}

const HINT = "Click a mark to drill that position.";

export function BlunderprintGrid({ profile, levels, onLevels, onOpen, opening, error }: Props) {
  // Cells come from every level so marks can fade out and back in as the level control re-marks the sheet.
  const all = useMemo(() => buildGrid(profile, [...PICK_LEVELS]), [profile]);
  const shown = useMemo(() => buildGrid(profile, levels), [profile, levels]);
  const [readout, setReadout] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<{ first: number; last: number } | null>(null);

  /** Which games are in view when the sheet scrolls sideways (phones); null when it all fits. */
  const measure = () => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth + 1) return setRange(null);
    const col = el.querySelector<HTMLElement>(".th-game");
    const name = el.querySelector<HTMLElement>(".th-name");
    const count = el.querySelector<HTMLElement>(".th-count");
    if (!col || !name || !count) return setRange(null);
    const w = col.getBoundingClientRect().width;
    const sticky = name.getBoundingClientRect().width + count.getBoundingClientRect().width;
    const n = profile.grid.length;
    const first = Math.min(n, Math.floor(el.scrollLeft / w + 0.5) + 1);
    const last = Math.min(n, Math.floor((el.scrollLeft + el.clientWidth - sticky) / w + 0.25));
    setRange({ first, last: Math.max(first, last) });
  };

  // When the sheet is wider than the screen, open on the newest games.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = el.scrollWidth;
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [profile]);
  const games = all.games;
  const visibleTotal = shown.rows.reduce((n, r) => n + r.visible, 0);
  const hasUnrated = all.levelCounts.unrated > 0;

  if (games.length === 0) {
    return (
      <section className="panel grid-panel" aria-labelledby="grid-title">
        <div className="panel-head">
          <h2 id="grid-title">Blunderprint grid</h2>
        </div>
        <p className="empty">No analyzed games yet, so there is nothing to chart.</p>
      </section>
    );
  }

  const cellOf = (row: string, col: number) => shown.rows.find((r) => r.tag === row)?.cells.find((c) => c.col === col) ?? null;

  return (
    <section className="panel grid-panel" aria-labelledby="grid-title">
      <div className="panel-head">
        <div>
          <h2 id="grid-title">Blunderprint grid</h2>
          <p className="panel-sub">
            Your last <span className="num">{games.length}</span> games, oldest on the left. Each mark is a mistake, sized by what it cost.
            {profile.analyzed.games > games.length && (
              <>
                {" "}Total counts all <span className="num">{profile.analyzed.games}</span> analyzed games.
              </>
            )}
          </p>
        </div>
        <LevelControl levels={levels} onChange={onLevels} counts={all.levelCounts} />
      </div>

      {range && (
        <p className="grid-range">
          Games <span className="num">{range.first}</span>–<span className="num">{range.last}</span> of <span className="num">{games.length}</span>
          {range.first > 1 ? " · scroll for earlier" : range.last < games.length ? " · scroll for later" : ""}
        </p>
      )}
      <div className="grid-scroll" ref={scrollRef} onScroll={measure}>
        <div className="grid-sheet">
        <table className="bp-grid" style={{ ["--cols" as string]: games.length }}>
          <caption className="sr-only">
            Mistake patterns by game. {visibleTotal} marks shown at the chosen difficulty.
          </caption>
          <colgroup>
            <col className="c-name" />
            <col className="c-count" />
            {games.map((g) => (
              <col key={g.gameId} className="c-game" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="th-name">
                Pattern
              </th>
              <th scope="col" className="th-count">
                Total
              </th>
              {games.map((g, i) => (
                <th key={g.gameId} scope="col" className="th-game" aria-label={`Game ${i + 1}, as ${g.color === "white" ? "White" : "Black"}`}>
                  {(i + 1) % 5 === 0 && <span className="num th-game-n">{i + 1}</span>}
                  <i className={`side side-${g.color}`} aria-hidden="true" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {all.rows.map((row) => {
              const worst = row.tag === shown.worst;
              const muted = row.tag === "other";
              return (
                <tr key={row.tag} className={worst ? "is-worst" : muted ? "is-muted" : undefined}>
                  <th scope="row" className="td-name" title={row.description}>
                    <span className="plate-n">{row.name}</span>
                    <span className="plate-meta">
                      {row.lastSeen ? `${shortDate(row.lastSeen)} · ` : ""}
                      {row.description}
                    </span>
                  </th>
                  <td className="td-count num">{row.count}</td>
                  {games.map((g, col) => {
                    const full = row.cells.find((c) => c.col === col);
                    if (!full) return <td key={g.gameId} className="td-game" />;
                    const vis = cellOf(row.tag, col);
                    const live = vis ?? full;
                    const m = live.marks[0];
                    const on = !!vis && markVisible(m, levels);
                    const key = `${g.gameId}:${m.ply}`;
                    const label = describeMark(row.name, live as GridCell);
                    return (
                      <td key={g.gameId} className="td-game">
                        <button
                          type="button"
                          className={`mark lv-${m.level} sz-${markSize(m.winDrop)}${live.marks.length > 1 ? " is-multi" : ""}${on ? "" : " is-off"}${opening === key ? " is-opening" : ""}`}
                          aria-label={on ? `${label}. Open in the drill.` : undefined}
                          aria-hidden={on ? undefined : true}
                          tabIndex={on ? 0 : -1}
                          disabled={!on || !!opening}
                          onClick={() => onOpen(row.tag, m, g)}
                          onMouseEnter={() => on && setReadout(label)}
                          onFocus={() => setReadout(label)}
                          onMouseLeave={() => setReadout(null)}
                          onBlur={() => setReadout(null)}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="td-name">
                Score
              </th>
              <td className="td-count" />
              {games.map((g) => (
                <td key={g.gameId} className={`td-game score score-${g.result}`}>
                  <span className="num">{resultMark(g.result)}</span>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
        </div>
      </div>

      <div className={error || opening || readout ? "grid-foot is-reading" : "grid-foot"}>
        <p className={error ? "readout is-error" : "readout"} aria-live="polite">
          {error ?? (opening ? "Opening that position…" : readout ?? HINT)}
        </p>
        <ul className="legend" aria-label="Key">
          <li>
            <i className="mark-key lv-deep sz-m" aria-hidden="true" />
            Deep
          </li>
          <li>
            <i className="mark-key lv-tricky sz-m" aria-hidden="true" />
            Tricky
          </li>
          <li>
            <i className="mark-key lv-slip sz-m" aria-hidden="true" />
            Slip
          </li>
          {hasUnrated && (
            <li>
              <i className="mark-key lv-unrated sz-m" aria-hidden="true" />
              Not yet rated
            </li>
          )}
          <li>
            <i className="mark-key lv-tricky sz-m is-multi" aria-hidden="true" />
            Several in one game
          </li>
          <li className="legend-sep">
            <i className="side side-white" aria-hidden="true" />
            White
          </li>
          <li>
            <i className="side side-black" aria-hidden="true" />
            Black
          </li>
        </ul>
      </div>
    </section>
  );
}
