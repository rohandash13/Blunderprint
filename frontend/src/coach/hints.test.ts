import { describe, expect, it } from "vitest";
import { hintLadder } from "./hints";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const SCHOLAR = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
const FORK = "4k3/1r6/8/5N2/8/8/8/6K1 w - - 0 1";
const PAWN_TAKES_DEFENDED = "3qk3/8/8/3n4/4P3/8/8/4K3 w - - 0 1";
const CASTLE = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";

describe("hintLadder", () => {
  it("mate", () => {
    expect(hintLadder(SCHOLAR, "h5f7")).toEqual([
      "There's a forced checkmate here — look at every check.",
      "It's a move with your queen.",
      "Your queen goes to f7.",
    ]);
  });
  it("fork (check+fork is a fork idea unless it captures)", () => {
    expect(hintLadder(FORK, "f5d6")[0]).toBe("Look for a move that attacks two things at once.");
  });
  it("capture", () => {
    expect(hintLadder(PAWN_TAKES_DEFENDED, "e4d5")).toEqual([
      "Something can be won — look for what's loose or under-defended.",
      "It's a move with your pawn.",
      "Your pawn goes to d5.",
    ]);
  });
  it("quiet move", () => {
    expect(hintLadder(START, "e2e4")[0]).toBe(
      "No capture needed — find the move that improves your worst piece or stops your opponent's main idea.",
    );
  });
  it("check without capture or fork", () => {
    expect(hintLadder("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "a1a8")[0]).toBe("Look at forcing moves, especially checks.");
  });
  it("capture with check", () => {
    expect(hintLadder("r3k3/8/8/8/8/8/8/R3K3 w - - 0 1", "a1a8")[0]).toBe("Look for a capture that also gives check.");
  });
  it("castling", () => {
    expect(hintLadder(CASTLE, "e1g1")).toEqual([
      "No capture needed — find the move that improves your worst piece or stops your opponent's main idea.",
      "It involves your king — think about safety.",
      "Castle.",
    ]);
  });
});
