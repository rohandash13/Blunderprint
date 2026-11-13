import { describe, expect, it } from "vitest";
import { describeMove } from "./facts";
import { plyCaption } from "./plyCaption";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const cap = (fen: string, uci: string, you: "White" | "Black" = "White") => plyCaption(describeMove(fen, uci)!, you);

describe("plyCaption", () => {
  it("quiet moves", () => {
    expect(cap(START, "g1f3")).toBe("White moves the knight to f3");
    expect(cap(START, "e2e4")).toBe("White moves the pawn to e4");
  });

  it("captures name the square and the capturing piece", () => {
    expect(cap("4k3/8/5n2/3P4/8/8/8/3QK3 b - - 0 1", "f6d5")).toBe("Black takes on d5 with the knight");
  });

  it("names a piece the move attacks, from the player's side", () => {
    const fen = "4k3/8/5n2/8/1Q6/8/8/4K3 b - - 0 1"; // Nd5 attacks the queen on b4
    expect(cap(fen, "f6d5", "White")).toBe("Black moves the knight to d5, attacking your queen");
    expect(cap(fen, "f6d5", "Black")).toBe("Black moves the knight to d5, attacking their queen");
  });

  it("check and mate", () => {
    expect(cap("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "a1a8")).toBe("White moves the rook to a8, giving check");
    expect(cap("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1", "a1a8")).toBe("White moves the rook to a8, checkmate");
  });

  it("fork lists the targets, king first", () => {
    expect(cap("r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1", "d5c7")).toBe("White moves the knight to c7, forking their king and rook");
  });

  it("castling and promotion", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(cap(fen, "e1g1")).toBe("White castles kingside");
    expect(cap(fen, "e1c1")).toBe("White castles queenside");
    expect(cap("8/P6k/8/8/8/8/8/4K3 w - - 0 1", "a7a8q")).toBe("White moves the pawn to a8, promoting to a queen");
  });
});
