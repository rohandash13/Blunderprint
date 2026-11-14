import { describe, expect, it } from "vitest";
import { parseMove, tokenize } from "./moveParse";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const QUEEN_FEN = "4k3/8/8/8/8/8/8/3QK3 w - - 0 1";
const KINGS_FEN = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";

describe("tokenize", () => {
  it("joins spoken file and rank and maps number words", () => {
    expect(tokenize("Knight to F three.")).toEqual(["knight", "to", "f3"]);
    expect(tokenize("e takes d5")).toEqual(["e", "takes", "d5"]);
  });
});

describe("parseMove", () => {
  it("accepts Qc2 and its voice transcript in the reported move-12 position", () => {
    const fen = "r4rk1/pp1b2pp/2pbpq2/3p1p2/2PPn3/1P1BP3/PB1N1PPP/R2Q1RK1 w - - 0 12";
    for (const move of ["Qc2", "Queen c two", "Queen see two", "Queen to c2", "I play queen c two"])
      expect(parseMove(fen, move)?.san).toBe("Qc2");
  });
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

  it("reads single-letter piece prefixes", () => {
    expect(parseMove(START, "N f3")?.san).toBe("Nf3");
    expect(parseMove(START, "n f3")?.san).toBe("Nf3");
    expect(parseMove("4k3/8/8/8/8/8/8/R6K w - - 0 1", "R e1")?.san).toMatch(/^Re1/);
    expect(parseMove(QUEEN_FEN, "Q h5")?.san).toMatch(/^Qh5/);
    expect(parseMove(KINGS_FEN, "K e2")?.san).toMatch(/^Ke2/);
    expect(parseMove(KINGS_FEN, "k e2")?.san).toMatch(/^Ke2/);
  });

  it("rejects words it does not understand, including negations", () => {
    expect(parseMove(START, "don't play knight f3")).toBeNull();
    expect(parseMove(START, "dont play knight f3")).toBeNull();
    expect(parseMove(START, "not e4")).toBeNull();
    expect(parseMove(START, "never e4")).toBeNull();
    expect(parseMove(START, "knight banana f3")).toBeNull();
  });

  it("rejects more than two squares", () => {
    expect(parseMove(START, "e2 e4 e5")).toBeNull();
  });

  it("requires a capture when a capture word is spoken", () => {
    const capture = "4k3/8/8/4p3/8/5N2/8/4K3 w - - 0 1";
    const empty = "4k3/8/8/8/8/5N2/8/4K3 w - - 0 1";
    expect(parseMove(capture, "Knight takes e5")?.san).toBe("Nxe5");
    expect(parseMove(empty, "knight e5")?.san).toBe("Ne5");
    expect(parseMove(empty, "knight takes e5")).toBeNull();
  });

  it("refuses promotion to king or pawn", () => {
    const fen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
    expect(parseMove(fen, "a8 promote to king")).toBeNull();
    expect(parseMove(fen, "a8 promote to pawn")).toBeNull();
    expect(parseMove(fen, "a8 promote to")?.promotion).toBe("q");
  });

  it("accepts castling notations and short/long", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    for (const s of ["0-0", "O-O", "o-o", "castle short"]) expect(parseMove(fen, s)?.san).toBe("O-O");
    for (const s of ["0-0-0", "O-O-O", "o-o-o", "castle long"]) expect(parseMove(fen, s)?.san).toBe("O-O-O");
  });

  it("returns null when castling is not legal", () => {
    const noRights = "r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1";
    expect(parseMove(noRights, "castle kingside")).toBeNull();
    expect(parseMove(noRights, "0-0")).toBeNull();
  });

  it("returns null for an invalid FEN instead of throwing", () => {
    expect(parseMove("not a fen", "e4")).toBeNull();
    expect(parseMove("", "Nf3")).toBeNull();
  });

  it("parses realistic phrasings", () => {
    expect(parseMove("4k3/8/8/8/8/8/8/4KB2 w - - 0 1", "bishop to c4 check")?.san).toBe("Bc4");
    expect(parseMove(QUEEN_FEN, "queen h5")?.san).toMatch(/^Qh5/);
    expect(parseMove(START, "night f3")?.san).toBe("Nf3");
    expect(parseMove(START, "I'll play knight to f3")?.san).toBe("Nf3");
  });

  it("allows naming the captured piece after the capture word", () => {
    const bishop = "4k3/8/8/4b3/8/5N2/8/4K3 w - - 0 1";
    expect(parseMove(bishop, "knight takes bishop e5")?.san).toBe("Nxe5");
    expect(parseMove(bishop, "knight takes bishop on e5")?.san).toBe("Nxe5");
    expect(parseMove("4r1k1/8/8/8/8/8/8/Q3K3 w - - 0 1", "queen takes rook e1")).toBeNull();
    expect(parseMove("6k1/8/8/8/8/8/8/Q3r1K1 w - - 0 1", "queen takes rook e1")?.san).toBe("Qxe1");
    // The victim name is not verified: any capture on the square is accepted.
    expect(parseMove("4k3/8/8/4p3/8/5N2/8/4K3 w - - 0 1", "knight takes bishop e5")?.san).toBe("Nxe5");
    // Still fail-closed when nothing is captured.
    expect(parseMove("4k3/8/8/8/8/5N2/8/4K3 w - - 0 1", "knight takes bishop e5")).toBeNull();
  });

  it("accepts two-word castling", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(parseMove(fen, "castle king side")?.san).toBe("O-O");
    expect(parseMove(fen, "castles king side")?.san).toBe("O-O");
    expect(parseMove(fen, "castle queen side")?.san).toBe("O-O-O");
    expect(parseMove(fen, "castle kingside")?.san).toBe("O-O");
    const noRights = "r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1";
    expect(parseMove(noRights, "castle king side")).toBeNull();
    expect(parseMove(fen, "king side")).toBeNull();
    expect(parseMove(fen, "castle king queen side")).toBeNull();
  });
});
