export interface Example {
  gameId: string;
  ply: number;
  fen: string;
  played: string; // UCI
  best: string; // UCI
  cpl: number;
  pPlayed: number;
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
  patterns: Pattern[];
}
