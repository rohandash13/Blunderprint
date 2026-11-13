import { useEffect, useLayoutEffect, useState, type CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import type { Arrow as CbArrow } from "react-chessboard/dist/chessboard/types";
import { patternLabel } from "../coach/patternLabels";
import type { Level } from "../types";
import { CoachPanel } from "./CoachPanel";
import { ChevronLeft, ChevronRight } from "./Icons";
import type { Coach } from "./useCoach";

const LEVEL_WORD: Record<Level, string> = { slip: "Slip", tricky: "Tricky", deep: "Deep", unrated: "Not yet rated" };
const MAX_BOARD = 600;

/** Width of an element that may mount later (the board appears once a position is set). */
function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w] as const;
}

interface Props {
  coach: Coach;
  onChoose(): void;
  onLevels(levels: Level[]): void;
}

export function Drill({ coach, onChoose, onLevels }: Props) {
  const { drill, lastShown, fen, arrows, flash, linePos, pendingLeft, caption, actions } = coach;
  const [wrapRef, wrapW] = useWidth<HTMLDivElement>();
  const ex = drill?.example ?? lastShown;
  const tag = drill?.tag ?? coach.shownTag;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        actions.prev();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        void actions.next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!ex) {
    return (
      <div className="drill-empty panel">
        <h1>Nothing on the board yet</h1>
        <p className="lede">Choose a pattern, or click a mark on your Blunderprint grid, to set up a position from your games.</p>
        <button type="button" className="btn btn-primary" onClick={onChoose}>
          Choose a focus
        </button>
      </div>
    );
  }

  const toMove = ex.fen.split(" ")[1] === "w" ? "White" : "Black";
  const moveNo = Number(ex.fen.split(" ")[5] ?? 1);
  const squareStyles: Record<string, CSSProperties> = {};
  for (const sq of flash) squareStyles[sq] = { background: "rgba(215, 38, 61, 0.42)" };

  const total = (linePos?.total ?? 0) + pendingLeft;
  const ply = linePos?.ply ?? 0;
  const canPrev = ply > 0;
  const canNext = (linePos ? linePos.ply < linePos.total : false) || pendingLeft > 0;
  const boardW = Math.max(240, Math.min(MAX_BOARD, wrapW));
  const title = tag ? patternLabel(tag).name : "A mistake from your game";

  return (
    <div className="drill">
      <section className="board-col" aria-labelledby="drill-title">
        <header className="drill-head">
          <h1 id="drill-title">{title}</h1>
          <p className="drill-sub">
            <span className={`to-move to-move-${toMove.toLowerCase()}`}>
              <i aria-hidden="true" />
              {toMove} to move
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Move <span className="num">{moveNo}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className={`lv-word lv-${ex.level}`}>
              <i className={`dot lv-${ex.level}`} aria-hidden="true" />
              {LEVEL_WORD[ex.level]}, {ex.kind}
            </span>
          </p>
        </header>

        <div className="board-wrap" ref={wrapRef}>
          <div className="board-frame" style={{ width: boardW }}>
            <Chessboard
              id="bp"
              position={fen}
              boardWidth={boardW}
              boardOrientation={toMove === "White" ? "white" : "black"}
              arePiecesDraggable={false}
              animationDuration={260}
              customSquareStyles={squareStyles}
              customArrows={arrows as CbArrow[]}
              customLightSquareStyle={{ backgroundColor: "#F0D9B5" }}
              customDarkSquareStyle={{ backgroundColor: "#B58863" }}
              customBoardStyle={{ borderRadius: "2px" }}
            />
          </div>
        </div>

        <div className="caption-strip" style={{ maxWidth: boardW }}>
          <button type="button" className="btn btn-icon" onClick={actions.prev} disabled={!canPrev} aria-label="Previous move" title="Previous move (Left arrow)">
            <ChevronLeft />
          </button>
          <div className="caption-body">
            <span className="caption-count num" aria-label={total ? `Move ${ply} of ${total} in the line` : "No line yet"}>
              {total ? `${ply} / ${total}` : "0 / 0"}
            </span>
            <p className="caption-text" aria-live="polite">
              {caption?.text ?? "Find the move you should have played. Type it, or say it with voice on."}
            </p>
          </div>
          <button type="button" className="btn btn-next" onClick={() => void actions.next()} disabled={!canNext} title="Next move (Right arrow)">
            Next
            <ChevronRight />
          </button>
        </div>
      </section>

      <CoachPanel coach={coach} onChoose={onChoose} onLevels={onLevels} />
    </div>
  );
}
