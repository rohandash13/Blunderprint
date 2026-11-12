import type { Pattern } from "../types";

export const PATTERN_LABELS: Record<string, { name: string; description: string }> = {
  hanging_piece: { name: "Hanging pieces", description: "Leaving a piece where it can be taken for free" },
  missed_tactic: { name: "Missed tactics", description: "A capture or check that wins material was available" },
  opening_error: { name: "Opening mistakes", description: "Mistakes in the first 10 moves" },
  endgame_technique: { name: "Endgame technique", description: "Mistakes with few pieces left" },
  time_trouble: { name: "Time trouble", description: "Mistakes with under 30 seconds on the clock" },
  other: { name: "Uncategorized middlegame mistakes", description: "Positional or strategic errors no rule matched" },
};

export function patternLabel(tag: string): { name: string; description: string } {
  return PATTERN_LABELS[tag] ?? { name: tag.replace(/_/g, " "), description: "" };
}

/** Named patterns by count (descending), "other" always last. */
export function sortPatterns(patterns: Pattern[]): Pattern[] {
  const rank = (p: Pattern) => (p.tag === "other" ? 1 : 0);
  return [...patterns].sort((a, b) => rank(a) - rank(b) || b.count - a.count);
}
