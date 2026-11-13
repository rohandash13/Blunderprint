import { parseMove } from "../chess/moveParse";

export const COMMANDS = [
  "drill me", "show me", "give me a hint", "i don't know", "next one", "go back", "reset", "show me the answer",
];

export function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Display text for a user transcript line, or null to hide it. Display only: never sent to the agent. */
export function cleanUserLine(text: string, fen: string | null): string | null {
  const trimmed = text.trim();
  if (!/[a-z0-9]/i.test(trimmed)) return null;
  if (fen) {
    const m = parseMove(fen, trimmed);
    if (m) return m.san;
  }
  const norm = trimmed.toLowerCase().replace(/[^a-z' ]/g, "").replace(/\s+/g, " ").trim();
  if (norm.split(" ").length <= 4) {
    let best: { cmd: string; d: number } | null = null;
    for (const cmd of COMMANDS) {
      if (cmd[0] !== norm[0]) continue; // a different first sound is a different phrase
      const d = levenshtein(norm, cmd);
      if (!best || d < best.d) best = { cmd, d };
    }
    if (best && best.d > 0 && best.d <= 3 && best.d <= 0.4 * best.cmd.length) return best.cmd;
    if (best && best.d === 0) return best.cmd;
  }
  return trimmed;
}
