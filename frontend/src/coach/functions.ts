import { describeMove, lineFacts, material, spokenMove, type MoveFacts } from "../chess/facts";
import { Chess } from "chess.js";
import { parseMove } from "../chess/moveParse";
import { judge, sameMove, uciOf } from "../chess/verdict";
import { describeEval } from "../chess/evalText";
import { hintLadder } from "./hints";
import type { StepDirection } from "./lineHistory";
import { difficultyNote } from "./difficultyNote";
import { plyCaption } from "../chess/plyCaption";
import { patternLabel } from "./patternLabels";
import { profileInsights, recommendedPattern } from "../profile/profileInsights";
import { profileSummary } from "../profile/profileSummary";
import type { Profile } from "../profile/types";
import type { Example, Level, Report } from "../types";

/** [fromSquare, toSquare, cssColor] */
export type Arrow = [string, string, string];
export const BEST = "rgb(40,160,80)";
export const PLAYED = "rgb(200,50,50)";
export const REPLY = "rgb(50,100,210)";
/** Marker red: the ply currently being explained. */
export const CURRENT = "rgb(215,38,61)";

export interface FunctionDef {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

const NO_ARGS = { type: "object" as const, properties: {} };

export const FUNCTION_DEFS: FunctionDef[] = [
  {
    name: "get_profile",
    description: "Get an overview of the player: a written summary, their ratings, strengths, leaks and the pattern worth working on first. Call this first in a session, then give a two to three sentence overview and offer focus choices.",
    parameters: NO_ARGS,
  },
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
    description: "Play the move the player said as an attempt at the current drill. Only the player's move is shown; the engine's continuation waits for next_move. Returns a verdict (best, repeated_mistake, other, illegal) computed by code, the player's move as facts, the first reply as next, and an eval from the player's side. Wrong attempts never reveal the answer. Attempts are unlimited.",
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
    description: "Explore a what-if from the current exploration position: plays the move, returns it as facts with the first reply as next, and holds the engine's continuation for next_move. Does not count as a drill attempt.",
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
  {
    name: "set_levels",
    description: "Change which challenge levels the report and drills use: slip (something they would usually spot at their level), tricky (worth slowing down for), deep (a stretch at their level). Use when the player asks for easier or harder positions.",
    parameters: {
      type: "object",
      properties: { levels: { type: "array", items: { type: "string", enum: ["slip", "tricky", "deep"] }, description: "One or more levels" } },
      required: ["levels"],
    },
  },
  {
    name: "step_line",
    description: "Step the board through the last played line. Use when the player says go back, forward, back to the start, or to the end.",
    parameters: {
      type: "object",
      properties: { direction: { type: "string", enum: ["back", "forward", "start", "end"] } },
      required: ["direction"],
    },
  },
  {
    name: "next_move",
    description: "Show the next move of the line after play_move or try_move: one move at a time, with an arrow. Returns that move's facts and a caption; explain only that move in one sentence. Call again until done is true, unless the player interrupts. The eval comes with the last move.",
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
  /** The last playout ended with the opponent to move because no engine line was available. */
  awaitingReply?: boolean;
}

/** The engine line held back by play_move / try_move and shown one ply per next_move. */
export interface PendingLine {
  /** Position before each ply. */
  fens: string[];
  plies: MoveFacts[];
  you: "White" | "Black";
  /** Index of the next ply to show. */
  next: number;
  evalSpoken: string | null;
  /** Whether the explore position follows the shown plies (try_move, a solved drill). */
  follow: boolean;
}

export interface CoachState {
  report: Report | null;
  profile: Profile | null;
  /** Line waiting for next_move. */
  pending: PendingLine | null;
  drill: Drill | null;
  /** Last example put on the board, so explain_line works outside a drill. */
  lastShown: Example | null;
  drilled: Set<string>;
  levels: Level[];
}

export interface EngineAnalysis {
  bestUci: string;
  scoreCp: number; // from the side to move's perspective
  pv: string[];
}

export interface CoachEffects {
  fetchProfile(): Promise<Profile | null>;
  fetchReport(levels: Level[]): Promise<Report | null>;
  showPosition(fen: string, arrows?: Arrow[]): void;
  /** Steps the board through the moves; `colors` is one color for all moves or one per move. */
  animateLine(fen: string, ucis: string[], colors: string | string[]): Promise<void>;
  /** Red highlight/arrow on the move, then animate it. */
  flashMove(fen: string, uci: string): Promise<void>;
  analyze(fen: string): Promise<EngineAnalysis | null>;
  /** Reflect a level change in the UI chips. */
  setLevels(levels: Level[]): void;
  /** Move through the recorded line; null when there is nothing to step to. */
  step(dir: StepDirection): { fen: string; ply: number; total: number } | null;
}

/** Odd, so the line (opponent, player, ...) ends with the player to move. */
export const PLAYOUT_PLIES = 9;
const PICKABLE: Level[] = ["slip", "tricky", "deep"];

export function newCoachState(): CoachState {
  return { report: null, profile: null, pending: null, drill: null, lastShown: null, drilled: new Set(), levels: ["tricky", "deep"] };
}

const PATTERN_INFO: Record<string, { name: string; description: string }> = {
  hanging_piece: { name: "Hanging pieces", description: "Hanging pieces — leaving a piece where it can be taken for free" },
  missed_tactic: { name: "Missed tactics", description: "Missed tactics — a capture or check that wins material was available" },
  opening_error: { name: "Opening mistakes", description: "Opening mistakes — in the first 10 moves" },
  endgame_technique: { name: "Endgame technique", description: "Endgame technique — with few pieces left" },
  time_trouble: { name: "Time trouble", description: "Time trouble — under 30 seconds on the clock" },
  positional: { name: "Positional decisions", description: "Positional decisions — a quiet move was best, no capture or check, just the right plan" },
  other: { name: "Uncategorized mistakes", description: "Uncategorized mistakes — tactical errors no other rule matched" },
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

const forYou = (diff: number, side: "White" | "Black") => (side === "White" ? diff : -diff);

const sideToMove = (fen: string): "White" | "Black" => (fen.split(" ")[1] === "w" ? "White" : "Black");
const isGameOver = (fen: string) => { try { return new Chess(fen).isGameOver(); } catch { return false; } };
const isOpen = (d: Drill) => !d.solved && !d.revealed;

type Side = "White" | "Black";

/**
 * After the player's move (already flashed), compute the engine continuation without showing it.
 * `you` is the drill side. `hideBest`, when set, cuts the line before the player ply that would play it.
 */
async function playOut(mine: MoveFacts, you: Side, fx: CoachEffects, hideBest: string | null = null) {
  if (mine.mate) {
    return { line: [] as MoveFacts[], evalSpoken: "Checkmate, you win" as string | null, materialForYou: forYou(mine.materialAfter, you), finalFen: mine.fenAfter };
  }
  const a = await fx.analyze(mine.fenAfter);
  if (!a) {
    return { line: [] as MoveFacts[], evalSpoken: null as string | null, materialForYou: forYou(mine.materialAfter, you), finalFen: mine.fenAfter, note: "No engine line available. Do not describe a continuation." };
  }
  let line = lineFacts(mine.fenAfter, a.pv.length > 0 ? a.pv : [a.bestUci], PLAYOUT_PLIES);
  if (hideBest) {
    const cut = line.findIndex((f) => f.side === you && sameMove(f.uci, hideBest));
    if (cut >= 0) line = line.slice(0, cut);
  }
  if (line.length % 2 === 0) line = line.slice(0, -1); // keep the player to move at the end
  const evalForYou = you === mine.side ? -a.scoreCp || 0 : a.scoreCp || 0; // scoreCp is from the side to move after `mine`
  const last = line[line.length - 1];
  return {
    line,
    evalSpoken: describeEval(evalForYou) as string | null,
    materialForYou: forYou(last ? last.materialAfter : mine.materialAfter, you),
    finalFen: last ? last.fenAfter : mine.fenAfter,
  };
}

/** Facts about one ply of the pending line, safe for the LLM (no FEN, no UCI). */
function plyOut(p: PendingLine, i: number) {
  const f = p.plies[i];
  return {
    ply: i + 1,
    total: p.plies.length,
    side: f.side,
    spoken: f.spoken,
    captured: f.captured ?? null,
    check: f.check,
    fork: f.fork,
    caption: plyCaption(f, p.you),
    done: i === p.plies.length - 1,
  };
}

/** Hold the line for next_move; returns the first ply (not yet shown) or null. */
function holdLine(state: CoachState, mine: MoveFacts, play: Awaited<ReturnType<typeof playOut>>, you: Side, follow: boolean) {
  state.pending = null;
  if (play.line.length === 0) return null;
  state.pending = {
    fens: [mine.fenAfter, ...play.line.slice(0, -1).map((f) => f.fenAfter)],
    plies: play.line,
    you,
    next: 0,
    evalSpoken: play.evalSpoken,
    follow,
  };
  return plyOut(state.pending, 0);
}

const lineSummary = (play: Awaited<ReturnType<typeof playOut>>) => ({
  lineLength: play.line.length,
  evalSpoken: play.evalSpoken,
  materialForYou: play.materialForYou,
  ...("note" in play ? { note: play.note } : {}),
});

async function ensureReport(state: CoachState, fx: CoachEffects): Promise<Report | null> {
  if (!state.report) state.report = await fx.fetchReport(state.levels);
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
    case "set_levels": return setLevels(args, state, fx);
    case "step_line": return stepLine(args, state, fx);
    case "next_move": return nextMove(state, fx);
    case "get_profile": return getProfile(state, fx);
  }

  if (name !== "get_report" && name !== "show_mistake" && name !== "start_drill") {
    return { error: `unknown function ${name}` };
  }

  const report = await ensureReport(state, fx);
  if (!report) return { error: "no report yet" };

  if (name === "get_report") {
    const c = report.levelCounts;
    const allUnrated = !!c && c.unrated > 0 && c.unrated === c.slip + c.tricky + c.deep + c.unrated;
    return {
      ...(allUnrated ? { note: "Difficulty has not been computed for these games yet; levels are unavailable." } : {}),
      movesAnalyzed: report.movesAnalyzed,
      mistakes: report.mistakes,
      candidates: report.candidates,
      levels: state.levels,
      levelCounts: report.levelCounts,
      patterns: report.patterns.map((p) => ({
        tag: p.tag,
        name: PATTERN_INFO[p.tag]?.name ?? p.tag,
        description: PATTERN_INFO[p.tag]?.description ?? p.tag,
        named: p.tag !== "other",
        count: p.count,
        avgCpl: Math.round(p.avgCpl),
        examples: p.examples.length,
        drillable: p.examples.length > 0,
        level: p.examples[0]?.level ?? null,
        kind: p.examples[0]?.kind ?? null,
        difficultyNote: p.examples[0] ? difficultyNote(p.examples[0].level, p.examples[0].kind) : null,
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
    state.pending = null;
    fx.showPosition(ex.fen, [arrow(ex.played, PLAYED), arrow(ex.best, BEST)]);
    return {
      moveNumber: moveNumber(ex.fen),
      side: side(ex.fen),
      playedSpoken: spokenMove(ex.fen, ex.played),
      bestSpoken: spokenMove(ex.fen, ex.best),
      cpl: ex.cpl,
      pPlayed: Math.round(ex.pPlayed * 100) / 100,
      level: ex.level,
      kind: ex.kind,
      difficultyNote: difficultyNote(ex.level, ex.kind),
    };
  }

  // start_drill
  if (pattern.examples.length === 0) return { error: `pattern "${tag}" has no examples` };
  const ex = pattern.examples.find((e) => !state.drilled.has(keyOf(e))) ?? pattern.examples[0];
  return beginDrill(tag, ex, state, fx);
}

function beginDrill(tag: string, ex: Example, state: CoachState, fx: CoachEffects) {
  state.drilled.add(keyOf(ex));
  state.lastShown = ex;
  state.pending = null;
  state.drill = { tag, example: ex, attempts: 0, hintsGiven: 0, solved: false, revealed: false, exploreFen: ex.fen };
  fx.showPosition(ex.fen);
  return {
    status: `Position ready, ${side(ex.fen)} to move`,
    side: side(ex.fen),
    moveNumber: moveNumber(ex.fen),
    level: ex.level,
    kind: ex.kind,
    difficultyNote: difficultyNote(ex.level, ex.kind),
  };
}

/** UI helper (not an LLM function): open a specific analyzed position, e.g. a grid mark, as a drill. */
export function openPosition(tag: string, ex: Example, state: CoachState, fx: CoachEffects) {
  return beginDrill(tag, ex, state, fx);
}

async function playMove(args: Record<string, unknown>, state: CoachState, fx: CoachEffects) {
  const d = state.drill;
  if (!d) return NO_DRILL;
  const ex = d.example;
  const j = judge(ex.fen, String(args.move ?? ""), ex.best, ex.played);
  if (j.verdict === "illegal") return { verdict: j.verdict, reason: j.reason };
  d.attempts += 1;
  state.pending = null;
  await fx.flashMove(ex.fen, j.uci!);
  const mine = describeMove(ex.fen, j.uci!);
  const facts = factsOut(mine);
  const spoken = mine?.spoken ?? j.uci!;
  const you = sideToMove(ex.fen);
  const solved = j.verdict === "best";
  if (!mine) {
    d.exploreFen = ex.fen;
    return { verdict: j.verdict, spoken, attempts: d.attempts, facts, lineLength: 0, evalSpoken: null, materialForYou: 0, next: null };
  }
  const play = await playOut(mine, you, fx, isOpen(d) && !solved ? ex.best : null);
  const next = holdLine(state, mine, play, you, solved);
  d.awaitingReply = sideToMove(play.finalFen) !== you;
  if (solved) {
    d.solved = true;
    d.exploreFen = mine.fenAfter; // follows the plies as next_move shows them
    return { verdict: "best", spoken, attempts: d.attempts, facts, ...lineSummary(play), next };
  }
  d.exploreFen = ex.fen; // attempts are always judged from the drill start
  return { verdict: j.verdict, spoken, attempts: d.attempts, hintsGiven: d.hintsGiven, hintsRemaining: 3 - d.hintsGiven, facts, ...lineSummary(play), next };
}

function getHint(state: CoachState, fx: CoachEffects) {
  const d = state.drill;
  if (!d) return NO_DRILL;
  if (d.hintsGiven >= 3) return { hint: null, message: "No hints left. Offer to reveal the answer." };
  const hint = hintLadder(d.example.fen, d.example.best)[d.hintsGiven];
  d.hintsGiven += 1;
  if (d.hintsGiven === 3) {
    d.exploreFen = d.example.fen;
    state.pending = null;
    fx.showPosition(d.example.fen, [arrow(d.example.best, BEST)]);
  }
  return { hint, level: d.hintsGiven, hintsRemaining: 3 - d.hintsGiven };
}

function revealAnswer(state: CoachState, fx: CoachEffects) {
  const d = state.drill;
  if (!d) return NO_DRILL;
  const ex = d.example;
  d.revealed = true;
  d.exploreFen = ex.fen;
  state.pending = null;
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
  if (line.length === 0) {
    return { error: "No engine line is available for this position. Say so; do not explain from memory." };
  }
  await fx.animateLine(ex.fen, line.map((f) => f.uci), BEST);
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
    materialAfter: line[line.length - 1].materialAfter,
    note: "Explain using only these facts.",
  };
}

async function tryMove(args: Record<string, unknown>, state: CoachState, fx: CoachEffects) {
  const d = state.drill;
  if (!d) return NO_DRILL;
  const input = String(args.move ?? "");
  const you = sideToMove(d.example.fen);
  if (isGameOver(d.exploreFen)) return { error: "The game is over in this position. Say reset to go back to the drill." };
  if (sideToMove(d.exploreFen) !== you) {
    if (state.pending) return { error: "The line is still being shown. Call next_move to continue it, or say reset to go back to the drill." };
    if (d.awaitingReply) return { error: "No engine reply is available here. Say reset to go back to the drill." };
    return { error: "It's the opponent's move in this position. Step forward, or reset to the drill." };
  }
  const parsed = parseMove(d.exploreFen, input);
  const mine = parsed ? describeMove(d.exploreFen, uciOf(parsed)) : null;
  if (!parsed || !mine) return { verdict: "illegal", reason: `No single legal move matches "${input}"` };
  await fx.flashMove(d.exploreFen, mine.uci);
  const play = await playOut(mine, you, fx, isOpen(d) ? d.example.best : null);
  const next = holdLine(state, mine, play, you, true);
  d.exploreFen = mine.fenAfter; // follows the plies as next_move shows them
  d.awaitingReply = sideToMove(play.finalFen) !== you;
  return { yourMove: mine.spoken, facts: factsOut(mine), ...lineSummary(play), next };
}

async function nextMove(state: CoachState, fx: CoachEffects) {
  const p = state.pending;
  if (!p) return { error: "There is no line to continue. Say so, or ask the player for a move." };
  const i = p.next;
  const f = p.plies[i];
  await fx.animateLine(p.fens[i], [f.uci], CURRENT);
  p.next += 1;
  if (p.follow && state.drill) state.drill.exploreFen = f.fenAfter;
  const out = plyOut(p, i);
  if (out.done) state.pending = null;
  return { ...out, ...(out.done && p.evalSpoken ? { evalSpoken: p.evalSpoken } : {}) };
}

async function getProfile(state: CoachState, fx: CoachEffects) {
  if (!state.profile) state.profile = await fx.fetchProfile();
  const profile = state.profile;
  if (!profile) return { error: "no profile yet" };
  const { strengths, leaks } = profileInsights(profile);
  const top = recommendedPattern(profile);
  return {
    summary: profileSummary(profile),
    gamesAnalyzed: profile.analyzed.games,
    ratings: profile.ratings ? Object.fromEntries(Object.entries(profile.ratings).map(([k, v]) => [k, v.rating])) : null,
    strengths: strengths.map((x) => x.text),
    leaks: leaks.map((x) => x.text),
    topPattern: top && top.count > 0 ? { tag: top.tag, name: patternLabel(top.tag).name, description: patternLabel(top.tag).description, count: top.count } : null,
  };
}

function resetPosition(state: CoachState, fx: CoachEffects) {
  const d = state.drill;
  if (!d) return NO_DRILL;
  d.exploreFen = d.example.fen;
  d.awaitingReply = false;
  state.pending = null;
  fx.showPosition(d.example.fen);
  return { status: "Back to the drill position" };
}

async function setLevels(args: Record<string, unknown>, state: CoachState, fx: CoachEffects) {
  const raw = Array.isArray(args.levels) ? args.levels.map((l) => String(l).toLowerCase()) : [];
  const levels = PICKABLE.filter((l) => raw.includes(l));
  if (levels.length === 0 || levels.length !== new Set(raw).size) {
    return { error: "levels must be one or more of slip, tricky, deep" };
  }
  state.levels = levels;
  state.report = null;
  state.drill = null;
  state.pending = null;
  fx.setLevels(levels);
  const report = await ensureReport(state, fx);
  if (!report) return { error: "no report yet" };
  return { levels, levelCounts: report.levelCounts, patterns: report.patterns.length };
}

function stepLine(args: Record<string, unknown>, state: CoachState, fx: CoachEffects) {
  const dir = String(args.direction ?? "");
  if (!["back", "forward", "start", "end"].includes(dir)) return { error: "direction must be back, forward, start or end" };
  const r = fx.step(dir as StepDirection);
  if (!r) return { error: "Nothing to step to. Say so." };
  if (state.drill) {
    state.drill.exploreFen = r.fen; // try_move refuses when the opponent is to move there
    state.drill.awaitingReply = false;
  }
  return { ply: r.ply, total: r.total };
}
