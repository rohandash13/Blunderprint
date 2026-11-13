import type { Level } from "../types";

export function difficultyNote(level: Level, kind: "tactical" | "positional"): string {
  if (level === "slip") return "something you'd usually spot, probably a rushed moment";
  if (level === "deep") {
    return kind === "positional"
      ? "a quiet positional move, the kind that's hard to find even at your level"
      : "a tactic that needs real calculation";
  }
  if (level === "tricky") return kind === "positional" ? "a positional decision worth slowing down for" : "a tactic a few moves deep";
  return "a position from your games";
}
