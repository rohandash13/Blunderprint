import { expect, it } from "vitest";
import { habitSummary } from "./habitSummary";

const report = { patterns: [
  { tag: "hanging_piece", count: 4, named: true },
  { tag: "positional", count: 30, named: true },
  { tag: "time_trouble", count: 3, named: true },
  { tag: "other", count: 80, named: false },
] };
it("narrates requested habits from verified patterns without any spoken markup", () => {
  const text = habitSummary("What are some of my habits?", report)!;
  expect(text).toContain("Positional decisions:");
  expect(text).toContain("Hanging pieces:");
  expect(text.indexOf("Positional")).toBeLessThan(text.indexOf("Hanging"));
  expect(text).not.toMatch(/[*#]|^\d+\./m);
  expect(text).not.toContain("Uncategorized");
});
it("leaves drill selection and unrelated conversation to their requested flow", () => {
  expect(habitSummary("Drill me on positional decisions", report)).toBeNull();
  expect(habitSummary("Show me a mistake", report)).toBeNull();
  expect(habitSummary("Hello", report)).toBeNull();
  expect(habitSummary("My weaknesses?", { error: "Unavailable" })).toBeNull();
});
