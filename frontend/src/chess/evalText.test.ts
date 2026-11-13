import { describe, expect, it } from "vitest";
import { describeEval } from "./evalText";

describe("describeEval", () => {
  it("bands and sides", () => {
    expect(describeEval(20)).toBe("Roughly equal");
    expect(describeEval(-49)).toBe("Roughly equal");
    expect(describeEval(80)).toBe("You have a slight edge");
    expect(describeEval(-200)).toBe("Your opponent has a clear edge, about 2 pawns");
    expect(describeEval(450)).toBe("You have a winning edge, about 5 pawns");
    expect(describeEval(-900)).toBe("Your opponent has a completely winning position");
  });
  it("mate scores", () => {
    expect(describeEval(9997)).toBe("You have mate in 3");
    expect(describeEval(-9999)).toBe("Your opponent has mate in 1");
  });
});
