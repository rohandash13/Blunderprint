import { Chess } from "chess.js";
import { parseMove } from "./moveParse";

export type Verdict = "illegal" | "best" | "repeated_mistake" | "other";

export interface Judgement {
  verdict: Verdict;
  san?: string;
  uci?: string;
  reason?: string;
}

export function uciOf(m: { from: string; to: string; promotion?: string }): string {
  return m.from + m.to + (m.promotion ?? "");
}

/** Same from/to squares; a missing promotion letter counts as a queen. */
export function sameMove(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.slice(0, 4) === y.slice(0, 4) && (x[4] ?? "q") === (y[4] ?? "q");
}

export function sanOf(fen: string, uci: string): string {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? "q" }).san;
  } catch {
    return uci;
  }
}

export function judge(fen: string, input: string, bestUci: string, playedUci: string): Judgement {
  const move = parseMove(fen, input);
  if (!move) return { verdict: "illegal", reason: `No single legal move matches "${input}"` };
  const uci = uciOf(move);
  const verdict: Verdict = sameMove(uci, bestUci) ? "best" : sameMove(uci, playedUci) ? "repeated_mistake" : "other";
  return { verdict, san: move.san, uci };
}
