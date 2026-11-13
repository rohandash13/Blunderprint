import { describe, expect, it } from "vitest";
import { cleanUserLine, levenshtein } from "./transcript";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("cleanUserLine", () => {
  it("hides empty and punctuation-only lines", () => {
    expect(cleanUserLine("", START)).toBeNull();
    expect(cleanUserLine("  ... ", START)).toBeNull();
  });
  it("corrects near-miss commands", () => {
    expect(cleanUserLine("Drove me.", START)).toBe("drill me");
    expect(cleanUserLine("give me a hunt", START)).toBe("give me a hint");
    expect(cleanUserLine("I don't no", START)).toBe("i don't know");
  });
  it("does not rewrite different words or long sentences", () => {
    expect(cleanUserLine("tell me", START)).toBe("tell me");
    expect(cleanUserLine("Yes.", START)).toBe("Yes.");
    expect(cleanUserLine("can you drill me on endgames please", START)).toBe("can you drill me on endgames please");
  });
  it("renders a spoken move as SAN", () => {
    expect(cleanUserLine("knight f three", START)).toBe("Nf3");
    expect(cleanUserLine("knight f three", null)).toBe("knight f three");
  });
});

describe("levenshtein", () => {
  it("counts edits", () => {
    expect(levenshtein("drove me", "drill me")).toBe(3);
    expect(levenshtein("abc", "abc")).toBe(0);
  });
});
