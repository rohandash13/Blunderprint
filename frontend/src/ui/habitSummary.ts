import { PATTERN_LABELS } from "../coach/patternLabels";

/** Speak a report overview directly so display formatting never reaches TTS. */
export function habitSummary(question: string, raw: unknown): string | null {
  if (!/\b(habits?|weakness(?:es)?|patterns?|mistakes?)\b/i.test(question) ||
      /\b(drill|show|position|why|reply|again)\b/i.test(question)) return null;
  if (!raw || typeof raw !== "object" || !("patterns" in raw) || !Array.isArray(raw.patterns)) return null;
  const patterns = (raw.patterns as { tag: string; count: number; named?: boolean }[])
    .filter(p => p.count > 0 && p.named !== false && p.tag !== "other" && PATTERN_LABELS[p.tag])
    .sort((a, b) => b.count - a.count).slice(0, 3);
  if (!patterns.length) return "There are no named mistake patterns at the selected levels yet. Try another difficulty level.";
  return ["Here are the main patterns in your analyzed games.", ...patterns.map(p => {
    const label = PATTERN_LABELS[p.tag];
    return `${label.name}: ${label.description}.`;
  }), "Which would you like to practice?"].join("\n");
}
