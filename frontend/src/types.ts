export interface Example {
  gameId: string;
  ply: number;
  fen: string;
  played: string; // UCI
  best: string; // UCI
  cpl: number;
  pPlayed: number;
  pv: string[]; // engine best line (UCI) from the position before the mistake
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
