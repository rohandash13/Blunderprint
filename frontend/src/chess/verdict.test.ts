import { describe, expect, it } from "vitest";
import { judge, sameMove, sanOf } from "./verdict";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("judge", () => {
  it("returns each verdict", () => {
    expect(judge(START, "e4", "e2e4", "g1h3").verdict).toBe("best");
    expect(judge(START, "knight h3", "e2e4", "g1h3").verdict).toBe("repeated_mistake");
    expect(judge(START, "d4", "e2e4", "g1h3")).toMatchObject({ verdict: "other", san: "d4", uci: "d2d4" });
    const bad = judge(START, "king e2", "e2e4", "g1h3");
    expect(bad.verdict).toBe("illegal");
    expect(bad.reason).toContain("king e2");
  });

  it("treats a missing promotion letter as a queen", () => {
    const fen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
    expect(judge(fen, "a8", "a7a8", "a1b1").verdict).toBe("best");
    expect(sameMove("a7a8q", "a7a8")).toBe(true);
    expect(sameMove("a7a8n", "a7a8")).toBe(false);
  });
});

describe("sanOf", () => {
  it("converts UCI to SAN in a position", () => {
    expect(sanOf(START, "g1f3")).toBe("Nf3");
    expect(sanOf(START, "e2e5")).toBe("e2e5"); // illegal: falls back to the UCI text
  });
});
