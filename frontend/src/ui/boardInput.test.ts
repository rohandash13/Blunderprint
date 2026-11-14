import { expect, it } from "vitest";
import { Chess } from "chess.js";
import { newCoachState } from "../coach/functions";
import type { Example } from "../types";
import { resolveBoardInput, droppedMove } from "./boardInput";

export const REPORTED_FEN =
  "r4rk1/pp1b2pp/2pbpq2/3p1p2/2PPn3/1P1BP3/PB1N1PPP/R2Q1RK1 w - - 0 12";
const example = { fen: REPORTED_FEN } as Example;
function state() {
  const s = newCoachState();
  s.drill = {
    tag: "positional",
    example,
    attempts: 0,
    hintsGiven: 0,
    solved: false,
    revealed: false,
    exploreFen: REPORTED_FEN,
  };
  return s;
}

it("validates typed Qc2 against the board before the voice model sees it", () => {
  expect(resolveBoardInput(state(), REPORTED_FEN, "Queen c two")).toMatchObject(
    { name: "play_move", uci: "d1c2" },
  );
  expect(droppedMove(REPORTED_FEN, "d1", "c2")).toBe("d1c2");
  expect(droppedMove(REPORTED_FEN, "d1", "d8")).toBeNull();
});

it("explores from the visible position after a line, rather than judging the old drill board", () => {
  const s = state();
  const board = new Chess(REPORTED_FEN);
  board.move("Qc2");
  board.move("a6");
  const visible = board.fen();
  const result = resolveBoardInput(s, visible, "Qb1");
  expect(result).toMatchObject({ name: "try_move", uci: "c2b1", fen: visible });
});

it("rejects the opponent's turn and invalid drops without changing the drill", () => {
  const s = state();
  const board = new Chess(REPORTED_FEN);
  board.move("Qc2");
  expect(resolveBoardInput(s, board.fen(), "a6")).toBeNull();
  expect(s.drill?.exploreFen).toBe(REPORTED_FEN);
});

it("carries the selected underpromotion through a drop", () => {
  expect(droppedMove("8/P6k/8/8/8/8/8/K7 w - - 0 1", "a7", "a8", "n")).toBe(
    "a7a8n",
  );
});
