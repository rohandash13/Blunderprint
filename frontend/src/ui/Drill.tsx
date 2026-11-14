import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import type { Arrow as CbArrow } from "react-chessboard/dist/chessboard/types";
import { patternLabel } from "../coach/patternLabels";
import type { Level } from "../types";
import { CoachPanel } from "./CoachPanel";
import { ChevronLeft, ChevronRight } from "./Icons";
import type { Coach } from "./useCoach";
import { useReducedMotion } from "./useReducedMotion";
import { DecisionClock } from "./DecisionClock";

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
  const reduceMotion = useReducedMotion();
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    setSelected(null);
    setDragFrom(null);
    setPromotion(null);
  }, [fen, drill, drill?.clock?.status]);
  const ex = drill?.example ?? lastShown;
  const tag = drill?.tag ?? coach.shownTag;

  // Left and right arrows step the line; the handler reads the latest actions through a ref.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        actionsRef.current.prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        void actionsRef.current.next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  const clock = drill?.clock;
  const covered = clock?.status === "ready";
  const clockBlocked = covered || clock?.status === "expired";
  const canMove = !!drill && !clockBlocked && !coach.busy && !coach.checkingMove && fen.split(" ")[1] === ex.fen.split(" ")[1];
  const squareStyles: Record<string, CSSProperties> = {};
  const from = dragFrom ?? selected;
  if (from && canMove) {
    try {
      squareStyles[from] = { backgroundColor: "rgba(242,217,78,.55)" };
      for (const move of new Chess(fen).moves({ verbose: true }).filter((move) => move.from === from))
        squareStyles[move.to] = {
          backgroundImage: move.captured
            ? "radial-gradient(circle, transparent 60%, rgba(26,26,26,.42) 62%, rgba(26,26,26,.42) 70%, transparent 72%)"
            : "radial-gradient(circle, rgba(26,26,26,.38) 18%, transparent 20%)",
        };
    } catch {
      /* position changed during the drag */
    }
  }
  for (const sq of flash) squareStyles[sq] = { background: "rgba(215, 38, 61, 0.42)" };

  const total = (linePos?.total ?? 0) + pendingLeft;
  const ply = linePos?.ply ?? 0;
  const canPrev = ply > 0 && !coach.checkingMove;
  const canNext = !coach.checkingMove && ((linePos ? linePos.ply < linePos.total : false) || pendingLeft > 0);
  const boardW = Math.max(240, Math.min(MAX_BOARD, wrapW));
  const title = tag ? patternLabel(tag).name : "A mistake from your game";
  const clickSquare = (square: string) => {
    if (!canMove) {
      setSelected(null);
      return;
    }
    const board = new Chess(fen);
    if (selected) {
      const legal = board.moves({ verbose: true }).filter((move) => move.from === selected && move.to === square);
      if (legal.length) {
        if (legal.some((move) => move.promotion)) setPromotion({ from: selected, to: square });
        else actions.playBoard(selected, square);
        setSelected(null);
        return;
      }
    }
    const piece = board.get(square as Square);
    setSelected(selected === square ? null : piece?.color === board.turn() ? square : null);
  };

  return (
    <div className="drill">
      <section className="board-col" aria-labelledby="drill-title">
        <header className="drill-head">
          <h1 id="drill-title">{title}</h1>
          <p className="drill-sub">
            <span className={`lv-word lv-${ex.level}`}>
              <i className={`dot lv-${ex.level}`} aria-hidden="true" />
              {LEVEL_WORD[ex.level]}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              from your game, move <span className="num">{moveNo}</span>
            </span>
          </p>
        </header>

        <div className="board-wrap" ref={wrapRef}>
          {clock && (
            <DecisionClock
              clock={clock}
              now={coach.clockNow}
              onUntimed={() => void actions.untimedPractice()}
              onRetry={() => void actions.retryClock()}
              busy={coach.busy || coach.checkingMove}
            />
          )}
          <div className="board-frame" style={{ width: boardW }}>
            <div style={{ visibility: covered ? "hidden" : undefined }}>
              <Chessboard
                id="bp"
                position={fen}
                boardWidth={boardW}
                boardOrientation={toMove === "White" ? "white" : "black"}
                arePiecesDraggable={canMove}
                onSquareClick={clickSquare}
                isDraggablePiece={({ piece }) => piece[0] === fen.split(" ")[1]}
                onPieceDragBegin={(_piece, square) => {
                  setSelected(null);
                  setDragFrom(square);
                }}
                onPieceDragEnd={() => setDragFrom(null)}
                onPieceDrop={(from, to) => {
                  setDragFrom(null);
                  setSelected(null);
                  return actions.playBoard(from, to);
                }}
                showPromotionDialog={promotion ? true : undefined}
                promotionToSquare={promotion?.to as Square | undefined}
                onPromotionPieceSelect={(piece, from, to) => {
                  const source = promotion?.from ?? from,
                    target = promotion?.to ?? to;
                  setPromotion(null);
                  return !!piece && !!source && !!target && actions.playBoard(source, target, piece[1].toLowerCase());
                }}
                animationDuration={reduceMotion ? 0 : 260}
                customSquareStyles={squareStyles}
                customArrows={arrows as CbArrow[]}
                customLightSquareStyle={{ backgroundColor: "#F0D9B5" }}
                customDarkSquareStyle={{ backgroundColor: "#B58863" }}
                customBoardStyle={{ borderRadius: "2px" }}
                customNotationStyle={{ color: "#2a1d12", fontWeight: "700", fontSize: "11px" }}
              />
            </div>
            {covered && (
              <div className="clock-ready-cover">
                <h2>Ready for the clock?</h2>
                <p>Find a stronger move before time runs out. Drag, type or speak your move.</p>
                <button type="button" className="btn btn-primary" onClick={() => void actions.startClock()} disabled={coach.busy}>
                  Start clock
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="caption-strip" style={{ maxWidth: boardW }}>
          <button
            type="button"
            className="btn btn-icon"
            onClick={actions.prev}
            disabled={!canPrev}
            aria-label="Previous move"
            title="Previous move (Left arrow)"
          >
            <ChevronLeft />
          </button>
          <div className="caption-body">
            <span className="caption-count num" aria-label={total ? `Move ${ply} of ${total} in the line` : "No line yet"}>
              {total ? `${ply} / ${total}` : "0 / 0"}
            </span>
            <p className="caption-text">
              {caption?.text ??
                (drill
                  ? "Find the stronger move. Drag a piece, type a move, or say it with voice on."
                  : "Your move and the stronger one are shown. Choose Drill this position to play your own moves.")}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-next"
            onClick={() => void actions.next()}
            disabled={!canNext}
            title="Next move (Right arrow)"
          >
            Next
            <ChevronRight />
          </button>
        </div>
      </section>

      <CoachPanel coach={coach} onChoose={onChoose} onLevels={onLevels} />
    </div>
  );
}
