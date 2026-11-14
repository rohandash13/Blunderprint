// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Transcript } from "./Transcript";
import type { TranscriptLine } from "./useCoach";

afterEach(cleanup);
const lines = (content: string[]): TranscriptLine[] => content.map((content, id) => ({ id, role: "assistant", content }));

it("groups streamed coach fragments and renders the reported numbered habits as a bold list", () => {
  const { container } = render(<Transcript empty="Empty" lines={lines([
    "Your analysis shows several habits: 1.",
    "**Positional Decisions**: You sometimes miss quiet moves.",
    "2.", "**Hanging Pieces**: Pieces left vulnerable to capture.",
    "3.", "**Time Trouble**: Decisions under pressure.",
    "Which would you like to practice?",
  ])} />);
  expect(screen.getAllByText("Coach")).toHaveLength(1);
  const habits = screen.getByRole("list", { name: "Habits" });
  expect(within(habits).getAllByRole("listitem")).toHaveLength(3);
  expect(container.querySelectorAll("strong")).toHaveLength(3);
  expect(container.textContent).not.toContain("**");
  expect(screen.getByText("Which would you like to practice?")).toBeTruthy();
});

it("formats plain spoken habit labels without requiring markup in speech", () => {
  const { container } = render(<Transcript empty="Empty" lines={lines([
    "Positional decisions: Look for quiet moves.",
    "Hanging pieces: Check what is undefended.",
  ])} />);
  expect(screen.getByRole("list", { name: "Habits" })).toBeTruthy();
  expect([...container.querySelectorAll("strong")].map(el => el.textContent)).toEqual(["Positional decisions", "Hanging pieces"]);
});

it("keeps separate user turns and treats user markup and HTML as literal text", () => {
  const { container } = render(<Transcript empty="Empty" lines={[
    { id: 1, role: "coach", content: "Position ready." },
    { id: 2, role: "assistant", content: "What would you play?" },
    { id: 3, role: "user", content: "**hello** <img src=x onerror=alert(1)>" },
    { id: 4, role: "assistant", content: "Let's try it." },
  ]} />);
  expect(screen.getAllByText("Coach")).toHaveLength(2);
  expect(screen.getAllByText("You")).toHaveLength(1);
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("**hello**");
});

it("preserves negative chess values rather than treating minus signs as list bullets", () => {
  render(<Transcript empty="Empty" lines={lines(["-3 pawns", "- A separate note"])} />);
  expect(screen.getByText("-3 pawns")).toBeTruthy();
  expect(screen.getByText("A separate note")).toBeTruthy();
});
