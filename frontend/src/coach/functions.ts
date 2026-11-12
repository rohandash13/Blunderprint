import { describeMove, lineFacts, material, spokenMove, type MoveFacts } from "../chess/facts";
import { parseMove } from "../chess/moveParse";
import { judge, uciOf } from "../chess/verdict";
import { hintLadder } from "./hints";
import type { Example, Report } from "../types";

/** [fromSquare, toSquare, cssColor] */
export type Arrow = [string, string, string];
export const BEST = "rgb(40,160,80)";
export const PLAYED = "rgb(200,50,50)";
export const REPLY = "rgb(50,100,210)";

export interface FunctionDef {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

const NO_ARGS = { type: "object" as const, properties: {} };

export const FUNCTION_DEFS: FunctionDef[] = [
  {
    name: "get_report",
    description: "Get the player's Blunderprint report: their recurring mistake patterns, each with a friendly name, description, count and average centipawn loss. Call this first, before discussing the player's play.",
    parameters: NO_ARGS,
  },
  {
    name: "show_mistake",
    description: "Show one example of a mistake pattern on the board (played move in red, engine best in green) and get spoken-move facts about it. Use when the player wants to see or understand a past mistake, not to drill it.",
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
    description: "Set up a position from one of the player's past mistakes with their move hidden, so they can find the better move. Use when they want to practice a pattern or ask for the next position. Stay on a position until they ask to move on.",
    parameters: {
      type: "object",
      properties: { tag: { type: "string", description: "Pattern tag from get_report" } },
      required: ["tag"],
    },
  },
  {
    name: "play_move",
    description: "Play the move the player said as an attempt at the current drill. Attempts are unlimited. Returns a verdict (best, repeated_mistake, other, illegal) computed by code; wrong attempts never reveal the answer. Say moves using the returned spoken text only.",
    parameters: {
      type: "object",
      properties: { move: { type: "string", description: "The move exactly as the player said it, e.g. 'knight f3' or 'Nf3'" } },
      required: ["move"],
    },
  },
  {
    name: "get_hint",
    description: "Give the next hint (idea, then piece, then square) for the current drill. Use when the player is stuck or asks for a hint. After three hints, offer to reveal the answer.",
    parameters: NO_ARGS,
  },
  {
    name: "reveal_answer",
    description: "Show the engine best move and the player's game move on the board and return them as spoken text. Use only after the hints are used up, or when the player says they do not know or asks to see the answer.",
    parameters: NO_ARGS,
  },
  {
    name: "explain_line",
    description: "Play the engine's best line out on the board and return per-move facts (captures, checks, forks, material). Use when the player asks why a move is best; explain using only the returned facts.",
    parameters: {
      type: "object",
      properties: { plies: { type: "integer", description: "How many moves to play out (default 6)" } },
    },
  },
  {
    name: "try_move",
    description: "Explore a what-if: play any move from the current exploration position, get the engine reply and an evaluation from the player's side. Use for 'what if I play X?'. Does not count as a drill attempt.",
    parameters: {
      type: "object",
      properties: { move: { type: "string", description: "The move as the player said it" } },
      required: ["move"],
    },
  },
  {
    name: "reset_position",
    description: "Put the board back to the drill position after exploring. Use when the player wants to start over or try the original position again.",
    parameters: NO_ARGS,
  },
];

export interface Drill {
  tag: string;
  example: Example;
  attempts: number;
  hintsGiven: number;
  solved: boolean;
  revealed: boolean;
  exploreFen: string;
}

export interface CoachState {
  report: Report | null;
  drill: Drill | null;
  /** Last example put on the board, so explain_line works outside a drill. */
  lastShown: Example | null;
  drilled: Set<string>;
}

export interface EngineAnalysis {
  bestUci: string;
  scoreCp: number; // from the side to move's perspective
  pv: string[];
}

export interface CoachEffects {
  fetchReport(): Promise<Report | null>;
  showPosition(fen: string, arrows?: Arrow[]): void;
  /** Steps the board through the moves, drawing each move's arrow in `color`. */
  animateLine(fen: string, ucis: string[], color: string): Promise<void>;
  /** Red highlight/arrow on the move, then animate it. */
  flashMove(fen: string, uci: string): Promise<void>;
  analyze(fen: string): Promise<EngineAnalysis | null>;
}

export function newCoachState(): CoachState {
  return { report: null, drill: null, lastShown: null, drilled: new Set() };
}

const PATTERN_INFO: Record<string, { name: string; description: string }> = {
  hanging_piece: { name: "Hanging pieces", description: "Hanging pieces — leaving a piece where it can be taken for free" },
  missed_tactic: { name: "Missed tactics", description: "Missed tactics — a capture or check that wins material was available" },
  opening_error: { name: "Opening mistakes", description: "Opening mistakes — in the first 10 moves" },
  endgame_technique: { name: "Endgame technique", description: "Endgame technique — with few pieces left" },
  time_trouble: { name: "Time trouble", description: "Time trouble — under 30 seconds on the clock" },
  other: { name: "Uncategorized middlegame mistakes", description: "Uncategorized middlegame mistakes — positional or strategic errors no rule matched" },
};

const NO_DRILL = { error: "no drill in progress; call start_drill first" };
const side = (fen: string) => (fen.split(" ")[1] === "w" ? "White" : "Black");
const moveNumber = (fen: string) => Number(fen.split(" ")[5] ?? 1);
const keyOf = (e: Example) => `${e.gameId}:${e.ply}`;
const arrow = (uci: string, color: string): Arrow => [uci.slice(0, 2), uci.slice(2, 4), color];

/** Facts safe to hand to the LLM about a move (no FENs, no UCI). */
function factsOut(f: MoveFacts | null) {
  if (!f) return null;
  return {
    piece: f.piece,
    ...(f.captured ? { captured: f.captured } : {}),
    check: f.check,
    mate: f.mate,
    attacks: f.attacks,
    fork: f.fork,
    materialAfter: f.materialAfter,
  };
}

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
  switch (name) {
    case "play_move": return playMove(args, state, fx);
    case "get_hint": return getHint(state, fx);
    case "reveal_answer": return revealAnswer(state, fx);
    case "explain_line": return explainLine(args, state, fx);
    case "try_move": return tryMove(args, state, fx);
    case "reset_position": return resetPosition(state, fx);
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
      patterns: report.patterns.map((p) => ({
        tag: p.tag,
        name: PATTERN_INFO[p.tag]?.name ?? p.tag,
        description: PATTERN_INFO[p.tag]?.description ?? p.tag,
        named: p.tag !== "other",
        count: p.count,
        avgCpl: Math.round(p.avgCpl),
        examples: p.examples.length,
      })),
    };
  }

  const tag = String(args.tag ?? "");
  const pattern = report.patterns.find((p) => p.tag === tag);
  if (!pattern) return { error: `no pattern "${tag}"`, available: report.patterns.map((p) => p.tag) };

  if (name === "show_mistake") {
    const raw = args.index;
    const index = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
    const ex = pattern.examples[index];
    if (!Number.isInteger(index) || !ex) return { error: "index out of range", examples: pattern.examples.length };
    state.lastShown = ex;
    fx.showPosition(ex.fen, [arrow(ex.played, PLAYED), arrow(ex.best, BEST)]);
    return {
      moveNumber: moveNumber(ex.fen),
      side: side(ex.fen),
      playedSpoken: spokenMove(ex.fen, ex.played),
      bestSpoken: spokenMove(ex.fen, ex.best),
      cpl: ex.cpl,
      pPlayed: Math.round(ex.pPlayed * 100) / 100,
    };
  }

  // start_drill
  if (pattern.examples.length === 0) return { error: `pattern "${tag}" has no examples` };
  const ex = pattern.examples.find((e) => !state.drilled.has(keyOf(e))) ?? pattern.examples[0];
  state.drilled.add(keyOf(ex));
  state.lastShown = ex;
  state.drill = { tag, example: ex, attempts: 0, hintsGiven: 0, solved: false, revealed: false, exploreFen: ex.fen };
  fx.showPosition(ex.fen);
  return { status: `Position ready, ${side(ex.fen)} to move`, side: side(ex.fen), moveNumber: moveNumber(ex.fen) };
}

async function playMove(args: Record<string, unknown>, state: CoachState, fx: CoachEffects) {
  const d = state.drill;
  if (!d) return NO_DRILL;
  const ex = d.example;
  const j = judge(ex.fen, String(args.move ?? ""), ex.best, ex.played);
  if (j.verdict === "illegal") return { verdict: j.verdict, reason: j.reason };
  d.attempts += 1;
  await fx.flashMove(ex.fen, j.uci!);
  const mine = describeMove(ex.fen, j.uci!);
  const facts = factsOut(mine);
  const spoken = mine?.spoken ?? j.uci!;
  if (j.verdict === "best") {
    d.solved = true;
    d.exploreFen = mine?.fenAfter ?? ex.fen;
    return { verdict: "best", spoken, attempts: d.attempts, facts };
  }
  d.exploreFen = ex.fen;
  fx.showPosition(ex.fen);
  return { verdict: j.verdict, spoken, attempts: d.attempts, hintsGiven: d.hintsGiven, hintsRemaining: 3 - d.hintsGiven, facts };
}

function getHint(state: CoachState, fx: CoachEffects) {
  const d = state.drill;
  if (!d) return NO_DRILL;
  if (d.hintsGiven >= 3) return { hint: null, message: "No hints left. Offer to reveal the answer." };
  const hint = hintLadder(d.example.fen, d.example.best)[d.hintsGiven];
  d.hintsGiven += 1;
  if (d.hintsGiven === 3) fx.showPosition(d.example.fen, [arrow(d.example.best, BEST)]);
  return { hint, level: d.hintsGiven, hintsRemaining: 3 - d.hintsGiven };
}

function revealAnswer(state: CoachState, fx: CoachEffects) {
  const d = state.drill;
  if (!d) return NO_DRILL;
  const ex = d.example;
  d.revealed = true;
  d.exploreFen = ex.fen;
  fx.showPosition(ex.fen, [arrow(ex.best, BEST), arrow(ex.played, PLAYED)]);
  return {
    bestSpoken: spokenMove(ex.fen, ex.best),
    gameMoveSpoken: spokenMove(ex.fen, ex.played),
    cpl: ex.cpl,
    facts: factsOut(describeMove(ex.fen, ex.best)),
  };
}

async function explainLine(args: Record<string, unknown>, state: CoachState, fx: CoachEffects) {
  const ex = state.drill?.example ?? state.lastShown;
  if (!ex) return NO_DRILL;
  const n = Number(args.plies);
  const plies = Number.isInteger(n) && n > 0 ? n : 6;
  const full = ex.pv.length > 0 ? ex.pv : ((await fx.analyze(ex.fen))?.pv ?? []);
  const line = lineFacts(ex.fen, full, plies);
  if (line.length > 0) await fx.animateLine(ex.fen, full.slice(0, plies), BEST);
  const before = material(ex.fen).diff;
  return {
    line: line.map((f, i) => ({
      ply: i + 1,
      side: f.side,
      spoken: f.spoken,
      captured: f.captured ?? null,
      check: f.check,
      fork: f.fork,
    })),
    materialBefore: before,
    materialAfter: line.length > 0 ? line[line.length - 1].materialAfter : before,
    note: "Explain using only these facts.",
  };
}

async function tryMove(args: Record<string, unknown>, state: CoachState, fx: CoachEffects) {
  const d = state.drill;
  if (!d) return NO_DRILL;
  const input = String(args.move ?? "");
  const parsed = parseMove(d.exploreFen, input);
  const mine = parsed ? describeMove(d.exploreFen, uciOf(parsed)) : null;
  if (!parsed || !mine) return { verdict: "illegal", reason: `No single legal move matches "${input}"` };
  await fx.flashMove(d.exploreFen, mine.uci);
  d.exploreFen = mine.fenAfter;
  const analysis = mine.mate ? null : await fx.analyze(mine.fenAfter);
  let engineReply: string | null = null;
  if (analysis?.bestUci) {
    const reply = describeMove(mine.fenAfter, analysis.bestUci);
    if (reply) {
      engineReply = reply.spoken;
      await fx.animateLine(mine.fenAfter, [analysis.bestUci], REPLY);
      d.exploreFen = reply.fenAfter;
    }
  }
  return {
    yourMove: mine.spoken,
    engineReply,
    evalForYou: analysis ? -analysis.scoreCp || 0 : null,
    material: material(d.exploreFen).diff,
  };
}

function resetPosition(state: CoachState, fx: CoachEffects) {
  const d = state.drill;
  if (!d) return NO_DRILL;
  d.exploreFen = d.example.fen;
  fx.showPosition(d.example.fen);
  return { status: "Back to the drill position" };
}
