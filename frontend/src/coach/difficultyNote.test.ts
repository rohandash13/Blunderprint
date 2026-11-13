import { describe, expect, it } from "vitest";
import { difficultyNote } from "./difficultyNote";

describe("difficultyNote", () => {
  it("maps the five phrases", () => {
    expect(difficultyNote("deep", "positional")).toBe("a quiet positional move, the kind that's hard to find even at your level");
    expect(difficultyNote("deep", "tactical")).toBe("a tactic that needs real calculation");
    expect(difficultyNote("tricky", "positional")).toBe("a positional decision worth slowing down for");
    expect(difficultyNote("tricky", "tactical")).toBe("a tactic a few moves deep");
    expect(difficultyNote("slip", "tactical")).toBe("something you'd usually spot, probably a rushed moment");
    expect(difficultyNote("slip", "positional")).toBe("something you'd usually spot, probably a rushed moment");
  });
  it("falls back for unrated", () => {
    expect(difficultyNote("unrated", "tactical")).toBe("a position from your games");
  });
});
