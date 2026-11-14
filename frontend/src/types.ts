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
  level: Level;
  kind: "tactical" | "positional";
  severity: "inaccuracy" | "mistake" | "blunder";
  difficultyElo: number | null; // UI only; never given to the LLM
  recordedClockCs?: number | null; // recorded post-move game clock; centiseconds
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
