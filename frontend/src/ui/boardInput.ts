import { Chess } from "chess.js";
import { parseMove } from "../chess/moveParse";
import { uciOf } from "../chess/verdict";
import type { CoachState } from "../coach/functions";

const positionKey = (fen: string) =>
  new Chess(fen).fen().split(" ").slice(0, 4).join(" ");

/** Resolve against what the player actually sees; the voice model never decides legality. */
export function resolveBoardInput(
  state: CoachState,
  fen: string,
  input: string,
) {
  const drill = state.drill;
  if (!drill) return null;
  try {
    const board = new Chess(fen);
    if (board.turn() !== new Chess(drill.example.fen).turn()) return null;
    const move = parseMove(fen, input);
    if (!move) return null;
    const attempt =
      !drill.solved &&
      !drill.revealed &&
      positionKey(fen) === positionKey(drill.example.fen);
    return {
      name: attempt ? ("play_move" as const) : ("try_move" as const),
      uci: uciOf(move),
      fen,
      san: move.san,
    };
  } catch {
    return null;
  }
}

export function droppedMove(
  fen: string,
  from: string,
  to: string,
  promotion = "q",
): string | null {
  try {
    const move = new Chess(fen).move({ from, to, promotion });
    return move ? uciOf(move) : null;
  } catch {
    return null;
  }
}
