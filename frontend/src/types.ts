export type Level = "slip" | "tricky" | "deep" | "unrated";

export interface Example {
  gameId: string;
  ply: number;
  fen: string;
  played: string; // UCI
  best: string; // UCI
  cpl: number;
  pPlayed: number;
  pv: string[]; // engine best line (UCI) from the position before the mistake
  pBest: number | null; // model chance of finding the best move (only meaningful as a ranking)
  level: Level;
  harderThanPercent: number | null; // share of this player's candidate mistakes that are easier
}

export interface Pattern {
  tag: string;
  count: number;
  avgCpl: number;
  examples: Example[];
}

export interface Report {
  username: string;
  runId: string;
  movesAnalyzed: number;
  mistakes: number;
  candidates: number;
  levels: Level[];
  levelCounts: Record<Level, number>;
  patterns: Pattern[];
}
