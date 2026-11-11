import { describe, expect, it } from "vitest";
import { describeMove, lineFacts, material, spokenMove } from "./facts";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const SCHOLAR = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
// White Nf5, black Ke8 + Rb7: Nd6+ forks king and rook (verified with chess.js).
const FORK = "4k3/1r6/8/5N2/8/8/8/6K1 w - - 0 1";
// exd5: pawn takes a knight defended by the queen on d8.
const PAWN_TAKES_DEFENDED = "3qk3/8/8/3n4/4P3/8/8/4K3 w - - 0 1";

describe("spokenMove", () => {
  it("names pieces, pawns, captures, castling and promotion", () => {
    expect(spokenMove(START, "g1f3")).toBe("knight to f3");
    expect(spokenMove(START, "e2e4")).toBe("pawn to e4");
    expect(spokenMove("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2", "e4d5")).toBe("e-pawn takes on d5");
    const castle = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(spokenMove(castle, "e1g1")).toBe("castles kingside");
    expect(spokenMove(castle, "e1c1")).toBe("castles queenside");
    expect(spokenMove("8/P6k/8/8/8/8/8/K7 w - - 0 1", "a7a8q")).toBe("pawn to a8, promoting to a queen");
  });
  it("adds check and checkmate suffixes", () => {
    expect(spokenMove(SCHOLAR, "h5f7")).toBe("queen takes on f7, checkmate");
    expect(spokenMove(FORK, "f5d6")).toBe("knight to d6, check");
  });
  it("returns the UCI text for an illegal move", () => {
    expect(spokenMove(START, "e2e5")).toBe("e2e5");
  });
});

describe("describeMove", () => {
  it("detects a knight fork of king and rook", () => {
    const f = describeMove(FORK, "f5d6")!;
    expect(f.fork).toBe(true);
    expect(f.check).toBe(true);
    expect(f.side).toBe("White");
    expect(f.piece).toBe("knight");
    expect(f.attacks).toEqual(expect.arrayContaining([{ square: "e8", piece: "king" }, { square: "b7", piece: "rook" }]));
  });
  it("a quiet move is not a fork", () => {
    const f = describeMove(FORK, "g1f1")!;
    expect(f.fork).toBe(false);
    expect(f.check).toBe(false);
    expect(f.captured).toBeUndefined();
  });
  it("reports a capture of a defended piece by a cheaper piece", () => {
    const f = describeMove(PAWN_TAKES_DEFENDED, "e4d5")!;
    expect(f.captured).toBe("knight");
    expect(f.piece).toBe("pawn");
    expect(f.fork).toBe(false);
    expect(f.materialAfter).toBe(1 - 9); // white pawn vs black queen
    expect(f.spoken).toBe("e-pawn takes on d5");
  });
  it("reports mate and returns null for an illegal move", () => {
    const f = describeMove(SCHOLAR, "h5f7")!;
    expect(f.mate).toBe(true);
    expect(f.check).toBe(true);
    expect(f.san).toBe("Qxf7#");
    expect(describeMove(START, "e2e5")).toBeNull();
  });
});

describe("material", () => {
  it("counts the start position equally", () => {
    expect(material(START)).toEqual({ white: 39, black: 39, diff: 0 });
  });
  it("diff is white minus black", () => {
    expect(material(PAWN_TAKES_DEFENDED)).toEqual({ white: 1, black: 12, diff: -11 });
  });
});

describe("lineFacts", () => {
  it("applies moves in order and stops at the first illegal one", () => {
    const facts = lineFacts(START, ["e2e4", "e7e5", "e2e4", "g8f6"]);
    expect(facts.map((f) => f.uci)).toEqual(["e2e4", "e7e5"]);
    expect(facts[1].side).toBe("Black");
  });
  it("respects maxPlies", () => {
    expect(lineFacts(START, ["e2e4", "e7e5", "g1f3"], 2)).toHaveLength(2);
  });
});
