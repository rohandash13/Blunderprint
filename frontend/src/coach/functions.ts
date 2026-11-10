import { judge, sanOf } from "../chess/verdict";
import type { Example, Report } from "../types";

export interface FunctionDef {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export const FUNCTION_DEFS: FunctionDef[] = [
  {
    name: "get_report",
    description: "Get the player's Blunderprint report: their recurring mistake patterns with counts and average centipawn loss. Call this before discussing the player's play.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "show_mistake",
    description: "Show one example position of a mistake pattern on the board and get the facts about it.",
    parameters: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Pattern tag from get_report, e.g. hanging_piece" },
        index: { type: "integer", description: "0-based example index within the pattern" },
      },
      required: ["tag", "index"],
    },
  },
  {
    name: "start_drill",
    description: "Set up a position from one of the player's past mistakes in this pattern, with their move hidden, so they can try again.",
    parameters: {
      type: "object",
      properties: { tag: { type: "string", description: "Pattern tag from get_report" } },
      required: ["tag"],
    },
  },
  {
    name: "play_move",
    description: "Play the move the player said in the current drill. Returns a verdict computed by the engine data: best, repeated_mistake, other, or illegal.",
    parameters: {
      type: "object",
      properties: { move: { type: "string", description: "The move exactly as the player said it, e.g. 'knight f3' or 'Nf3'" } },
      required: ["move"],
    },
  },
];

export interface CoachState {
  report: Report | null;
  drill: { tag: string; example: Example } | null;
  drilled: Set<string>;
}

export interface CoachEffects {
  fetchReport(): Promise<Report | null>;
  showPosition(fen: string, highlight?: { played?: string; best?: string }): void;
  playOnBoard(uci: string): void;
}

export function newCoachState(): CoachState {
  return { report: null, drill: null, drilled: new Set() };
}

const side = (fen: string) => (fen.split(" ")[1] === "w" ? "White" : "Black");
const moveNumber = (fen: string) => Number(fen.split(" ")[5] ?? 1);
const keyOf = (e: Example) => `${e.gameId}:${e.ply}`;

async function ensureReport(state: CoachState, fx: CoachEffects): Promise<Report | null> {
  if (!state.report) state.report = await fx.fetchReport();
  return state.report;
}

export async function handleFunctionCall(
  name: string,
  args: Record<string, unknown>,
  state: CoachState,
  fx: CoachEffects,
): Promise<unknown> {
  if (name === "play_move") {
    if (!state.drill) return { error: "no drill in progress; call start_drill first" };
    const ex = state.drill.example;
    const j = judge(ex.fen, String(args.move ?? ""), ex.best, ex.played);
    if (j.verdict === "illegal") return { verdict: j.verdict, reason: j.reason };
    fx.playOnBoard(j.uci!);
    state.drilled.add(keyOf(ex));
    return { verdict: j.verdict, san: j.san, bestMove: sanOf(ex.fen, ex.best), yourGameMove: sanOf(ex.fen, ex.played) };
  }

  if (name !== "get_report" && name !== "show_mistake" && name !== "start_drill") {
    return { error: `unknown function ${name}` };
  }

  const report = await ensureReport(state, fx);
  if (!report) return { error: "no report yet" };

  if (name === "get_report") {
    return {
      movesAnalyzed: report.movesAnalyzed,
      mistakes: report.mistakes,
      candidates: report.candidates,
      patterns: report.patterns.map((p) => ({ tag: p.tag, count: p.count, avgCpl: Math.round(p.avgCpl), examples: p.examples.length })),
    };
  }

  const tag = String(args.tag ?? "");
  const pattern = report.patterns.find((p) => p.tag === tag);
  if (!pattern) return { error: `no pattern "${tag}"`, available: report.patterns.map((p) => p.tag) };

  if (name === "show_mistake") {
    const index = Number(args.index ?? 0);
    const ex = pattern.examples[index];
    if (!Number.isInteger(index) || !ex) return { error: "index out of range", examples: pattern.examples.length };
    fx.showPosition(ex.fen, { played: ex.played, best: ex.best });
    return {
      moveNumber: moveNumber(ex.fen),
      side: side(ex.fen),
      played: sanOf(ex.fen, ex.played),
      best: sanOf(ex.fen, ex.best),
      cpl: ex.cpl,
      pPlayed: Math.round(ex.pPlayed * 100) / 100,
    };
  }

  // start_drill
  if (pattern.examples.length === 0) return { error: `pattern "${tag}" has no examples` };
  const ex = pattern.examples.find((e) => !state.drilled.has(keyOf(e))) ?? pattern.examples[0];
  state.drill = { tag, example: ex };
  fx.showPosition(ex.fen);
  return { status: `Position ready, ${side(ex.fen)} to move`, moveNumber: moveNumber(ex.fen) };
}
