import { describe, expect, it } from "vitest";
import { parseMove, tokenize } from "./moveParse";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("tokenize", () => {
  it("joins spoken file and rank and maps number words", () => {
    expect(tokenize("Knight to F three.")).toEqual(["knight", "to", "f3"]);
    expect(tokenize("e takes d5")).toEqual(["e", "takes", "d5"]);
  });
});

describe("parseMove", () => {
  it("accepts SAN and UCI directly", () => {
    expect(parseMove(START, "e4")?.san).toBe("e4");
    expect(parseMove(START, "Nf3")?.san).toBe("Nf3");
    expect(parseMove(START, "g1f3")?.san).toBe("Nf3");
  });

  it("parses spoken moves", () => {
    expect(parseMove(START, "knight f3")?.san).toBe("Nf3");
    expect(parseMove(START, "Knight to F3.")?.san).toBe("Nf3");
    expect(parseMove(START, "pawn to e four")?.san).toBe("e4");
  });

  it("parses spoken captures with a from-file", () => {
    const fen = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2";
    expect(parseMove(fen, "e takes d5")?.san).toBe("exd5");
  });

  it("parses castling", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(parseMove(fen, "castle kingside")?.san).toBe("O-O");
    expect(parseMove(fen, "castles queenside")?.san).toBe("O-O-O");
  });

  it("handles promotion, defaulting to a queen", () => {
    const fen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
    expect(parseMove(fen, "a8")?.promotion).toBe("q");
    expect(parseMove(fen, "a8 promote to knight")?.promotion).toBe("n");
  });

  it("refuses ambiguous, illegal and nonsense input", () => {
    const twoKnights = "k7/8/8/8/8/8/8/1N3N1K w - - 0 1";
    expect(parseMove(twoKnights, "knight d2")).toBeNull();
    expect(parseMove(twoKnights, "b knight d2")?.san).toBe("Nbd2");
    expect(parseMove(START, "knight e5")).toBeNull();
    expect(parseMove(START, "banana")).toBeNull();
    expect(parseMove(START, "")).toBeNull();
  });
});
