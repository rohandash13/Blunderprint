import { describe, expect, it } from "vitest";
import { patternLabel, sortPatterns } from "./patternLabels";
import type { Pattern } from "../types";

const p = (tag: string, count: number): Pattern => ({ tag, count, avgCpl: 0, examples: [] });

describe("sortPatterns", () => {
  it("sorts named by count and puts other last even when largest", () => {
    const out = sortPatterns([p("other", 50), p("hanging_piece", 3), p("missed_tactic", 7)]);
    expect(out.map((x) => x.tag)).toEqual(["missed_tactic", "hanging_piece", "other"]);
  });
});

describe("patternLabel", () => {
  it("falls back for unknown tags", () => {
    expect(patternLabel("foo_bar").name).toBe("foo bar");
    expect(patternLabel("other").name).toBe("Uncategorized mistakes");
  });
});
