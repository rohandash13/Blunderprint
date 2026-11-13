import type { Level } from "../types";

export interface PerfRating {
  rating: number;
  games: number;
  /** Rating change over the last 90 days. */
  prog: number;
}

export interface WinDrawLoss {
  w: number;
  d: number;
  l: number;
}

export interface GridMark {
  ply: number;
  pattern: string;
  level: Level;
  kind: "tactical" | "positional";
  winDrop: number;
}

export interface GridGame {
  gameId: string;
  playedAt: string;
  color: "white" | "black";
  /** From the player's side. */
  result: "w" | "d" | "l";
  marks: GridMark[];
}

export interface ProfilePattern {
  tag: string;
  count: number;
  lastSeen: string | null;
  levels: Record<Level, number>;
  kinds: { positional: number; tactical: number };
}

/** GET /players/{u}/profile */
export interface Profile {
  username: string;
  /** perf name (bullet, blitz, rapid, ...) to rating; null when Lichess was unreachable. */
  ratings: Record<string, PerfRating> | null;
  analyzed: { games: number; moves: number; from: string | null; to: string | null };
  record: { white: WinDrawLoss; black: WinDrawLoss };
  /** Candidate mistakes per 100 of the player's moves. */
  phases: { opening: number; middlegame: number; endgame: number };
  kinds: { positional: number; tactical: number };
  clock: { underThirtyShare: number; mistakeRateUnder30: number; mistakeRateOver30: number };
  grid: GridGame[];
  patterns: ProfilePattern[];
}

export type AnalysisStatus = "none" | "RUNNING" | "SCORING" | "DONE";

/** GET /players/{u}/status */
export interface PlayerStatus {
  status: AnalysisStatus;
  runId: string | null;
  queuePosition: number | null;
}

/** POST /analysis */
export interface StartAnalysisResponse {
  runId: string;
  reused?: boolean;
  queuePosition?: number | null;
}

/** GET /analysis/{runId} */
export interface AnalysisProgress {
  status: string;
  done: number;
  total: number;
  queuePosition?: number | null;
  error?: string | null;
}
