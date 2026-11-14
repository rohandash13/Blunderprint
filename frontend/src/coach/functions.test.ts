import { describe, expect, it, vi } from "vitest";
import { BEST, CURRENT, FUNCTION_DEFS, PLAYED, openPosition, PLAYOUT_PLIES, REPLY, handleFunctionCall, newCoachState, type Arrow, type CoachEffects } from "./functions";
import type { Report } from "../types";
import { describeEval } from "../chess/evalText";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
const AFTER_E4_CJS = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"; // chess.js drops unusable ep squares
const NO_DRILL = { error: "no drill in progress; call start_drill first" };

const REPORT: Report = {
  username: "alice",
  runId: "r1",
  movesAnalyzed: 400,
  mistakes: 30,
  candidates: 12,
  levels: ["tricky", "deep"],
  levelCounts: { slip: 4, tricky: 5, deep: 2, unrated: 0 },
  patterns: [
    {
      tag: "hanging_piece",
      count: 5,
      avgCpl: 412.6,
      examples: [
        { gameId: "g1", ply: 0, fen: START, played: "g1h3", best: "e2e4", cpl: 300, pPlayed: 0.214, pv: ["e2e4", "e7e5", "g1f3"], level: "tricky", kind: "tactical", severity: "mistake", difficultyElo: 1500 },
        { gameId: "g2", ply: 1, fen: AFTER_E4, played: "g8h6", best: "e7e5", cpl: 250, pPlayed: 0.18, pv: [], level: "deep", kind: "positional", severity: "blunder", difficultyElo: 2100 },
      ],
    },
    { tag: "other", count: 2, avgCpl: 100, examples: [] },
  ],
};

type Analysis = { bestUci: string; scoreCp: number; pv: string[] } | null;

function effects(report: Report | null = REPORT, analysis: Analysis = null) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const shown: { fen: string; arrows?: Arrow[] }[] = [];
  const rec = (fn: string, ...args: unknown[]) => calls.push({ fn, args });
  const fx: CoachEffects = {
    fetchProfile: vi.fn(async () => null),
    fetchReport: vi.fn(async (levels) => { rec("fetchReport", levels); return report; }),
    showPosition: (fen, arrows) => { shown.push({ fen, arrows }); rec("showPosition", fen, arrows); },
    animateLine: async (fen, ucis, colors) => { rec("animateLine", fen, ucis, colors); },
    flashMove: async (fen, uci) => { rec("flashMove", fen, uci); },
    analyze: vi.fn(async (fen: string) => { rec("analyze", fen); return analysis; }),
    setLevels: (levels) => { rec("setLevels", levels); },
    step: (dir) => { rec("step", dir); return dir === "back" ? { fen: START, ply: 0, total: 3 } : null; },
  };
  return { fx, calls, shown, of: (fn: string) => calls.filter((c) => c.fn === fn) };
}

/** Show every pending ply, as the coach does with repeated next_move calls. */
async function drain(s: ReturnType<typeof newCoachState>, fx: CoachEffects) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any>[] = [];
  while (s.pending) out.push(await handleFunctionCall("next_move", {}, s, fx) as Record<string, unknown>);
  return out;
}
const shown = (calls: { args: unknown[] }[]) => calls.map((c) => (c.args[1] as string[])[0]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (name: string, args: Record<string, unknown>, s: ReturnType<typeof newCoachState>, fx: CoachEffects) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleFunctionCall(name, args, s, fx) as Promise<Record<string, any>>;

describe("FUNCTION_DEFS", () => {
  it("declares the thirteen client-side functions in order", () => {
    expect(FUNCTION_DEFS.map((f) => f.name)).toEqual([
      "get_profile", "get_report", "show_mistake", "start_drill", "play_move", "get_hint", "reveal_answer", "explain_line", "try_move", "reset_position", "set_levels", "step_line", "next_move",
    ]);
    for (const f of FUNCTION_DEFS) {
      expect(f.parameters.type).toBe("object");
      expect(f.description.length).toBeGreaterThan(20);
    }
  });
  it("exports arrow colors", () => {
    expect([BEST, PLAYED, REPLY, CURRENT]).toEqual(["rgb(40,160,80)", "rgb(200,50,50)", "rgb(50,100,210)", "rgb(215,38,61)"]);
  });
});

describe("report and show_mistake", () => {
  it("get_report fetches once, names patterns and flags named ones", async () => {
    const s = newCoachState();
    const e = effects();
    const r = await call("get_report", {}, s, e.fx);
    await call("get_report", {}, s, e.fx);
    expect(e.fx.fetchReport).toHaveBeenCalledTimes(1);
    expect(r.patterns[0]).toEqual({
      tag: "hanging_piece",
      name: "Hanging pieces",
      description: "Hanging pieces — leaving a piece where it can be taken for free",
      named: true,
      count: 5,
      avgCpl: 413,
      examples: 2,
      level: "tricky",
      kind: "tactical",
      difficultyNote: "a tactic a few moves deep",
      drillable: true,
    });
    expect(r.patterns[1].named).toBe(false);
    expect(r.patterns[1].drillable).toBe(false);          // no examples at these levels: talk about it, don't drill
    expect(r.patterns[1].description).toContain("Uncategorized mistakes");
    expect(r.movesAnalyzed).toBe(400);
  });

  it("get_report notes that difficulty is unavailable when every row is unrated", async () => {
    const unrated: Report = { ...REPORT, levelCounts: { slip: 0, tricky: 0, deep: 0, unrated: 7 } };
    const r = await call("get_report", {}, newCoachState(), effects(unrated).fx);
    expect(r.note).toBe("Difficulty has not been computed for these games yet; levels are unavailable.");
    expect((await call("get_report", {}, newCoachState(), effects().fx)).note).toBeUndefined();
    const mixed: Report = { ...REPORT, levelCounts: { slip: 0, tricky: 1, deep: 0, unrated: 7 } };
    expect((await call("get_report", {}, newCoachState(), effects(mixed).fx)).note).toBeUndefined();
  });

  it("get_report reports a missing report", async () => {
    expect(await call("get_report", {}, newCoachState(), effects(null).fx)).toEqual({ error: "no report yet" });
  });

  it("show_mistake shows arrows and returns spoken moves, not SAN", async () => {
    const e = effects();
    const r = await call("show_mistake", { tag: "hanging_piece", index: 1 }, newCoachState(), e.fx);
    expect(e.shown).toEqual([{ fen: AFTER_E4, arrows: [["g8", "h6", PLAYED], ["e7", "e5", BEST]] }]);
    expect(r).toEqual({
      moveNumber: 1, side: "Black", playedSpoken: "knight to h6", bestSpoken: "pawn to e5", cpl: 250, pPlayed: 0.18, level: "deep", kind: "positional", difficultyNote: "a quiet positional move, the kind that's hard to find even at your level",
    });
  });

  it("show_mistake rejects unknown tags and bad indexes", async () => {
    const s = newCoachState();
    expect(await call("show_mistake", { tag: "nope", index: 0 }, s, effects().fx))
      .toEqual({ error: 'no pattern "nope"', available: ["hanging_piece", "other"] });
    for (const index of [9, undefined, null, "", true, -1, 1.5, "abc"]) {
      expect(await call("show_mistake", { tag: "hanging_piece", index }, s, effects().fx))
        .toEqual({ error: "index out of range", examples: 2 });
    }
    expect((await call("show_mistake", { tag: "hanging_piece", index: "1" }, s, effects().fx)).playedSpoken).toBe("knight to h6");
  });
});

describe("start_drill and play_move", () => {
  it("start_drill hides the answer and resets drill state", async () => {
    const s = newCoachState();
    const e = effects();
    const ready = await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    expect(ready).toEqual({ status: "Position ready, White to move", side: "White", moveNumber: 1, level: "tricky", kind: "tactical", difficultyNote: "a tactic a few moves deep" });
    expect(JSON.stringify(ready)).not.toContain("e4");
    expect(e.shown).toEqual([{ fen: START, arrows: undefined }]);
    expect(s.drill).toMatchObject({ tag: "hanging_piece", attempts: 0, hintsGiven: 0, solved: false, revealed: false, exploreFen: START });
  });

  it("allows unlimited attempts: wrong, wrong, best", async () => {
    const s = newCoachState();
    const e = effects();
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx);

    const a1 = await call("play_move", { move: "knight h3" }, s, e.fx);
    expect(a1).toMatchObject({ verdict: "repeated_mistake", spoken: "knight to h3", attempts: 1, hintsGiven: 0, hintsRemaining: 3 });
    const a2 = await call("play_move", { move: "d4" }, s, e.fx);
    expect(a2).toMatchObject({ verdict: "other", spoken: "pawn to d4", attempts: 2 });
    const a3 = await call("play_move", { move: "e4" }, s, e.fx);
    expect(a3).toMatchObject({ verdict: "best", spoken: "pawn to e4", attempts: 3 });
    expect(a3.facts).toBeDefined();
    expect(s.drill!.solved).toBe(true);
    expect(s.drill!.attempts).toBe(3);

    // each move is flashed; the board is no longer reset after wrong attempts (it stays on the playout)
    expect(e.of("flashMove").map((c) => c.args[1])).toEqual(["g1h3", "d2d4", "e2e4"]);
    expect(e.of("showPosition").map((c) => c.args[0])).toEqual([START]); // start_drill only
  });

  it("a wrong attempt never leaks the best move", async () => {
    const s = newCoachState();
    const e = effects();
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    for (const move of ["knight h3", "d4", "a3"]) {
      const text = JSON.stringify(await call("play_move", { move }, s, e.fx));
      expect(text).not.toContain("e2e4");
      expect(text).not.toContain("pawn to e4");
      expect(text).not.toContain("e4");
      expect(text).not.toContain("bestMove");
    }
  });

  it("illegal moves do not count as attempts or flash", async () => {
    const s = newCoachState();
    const e = effects();
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    const v = await call("play_move", { move: "king e2" }, s, e.fx);
    expect(v.verdict).toBe("illegal");
    expect(typeof v.reason).toBe("string");
    expect(s.drill!.attempts).toBe(0);
    expect(e.of("flashMove")).toEqual([]);
  });

  it("start_drill advances to the next undrilled example after a solve", async () => {
    const s = newCoachState();
    const e = effects();
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    await call("play_move", { move: "e4" }, s, e.fx);
    const next = await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    expect(next).toEqual({ status: "Position ready, Black to move", side: "Black", moveNumber: 1, level: "deep", kind: "positional", difficultyNote: "a quiet positional move, the kind that's hard to find even at your level" });
  });
});

describe("hints and reveal", () => {
  it("get_hint walks the ladder then runs out", async () => {
    const s = newCoachState();
    const e = effects();
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    const h1 = await call("get_hint", {}, s, e.fx);
    const h2 = await call("get_hint", {}, s, e.fx);
    const h3 = await call("get_hint", {}, s, e.fx);
    expect([h1.level, h2.level, h3.level]).toEqual([1, 2, 3]);
    expect([h1.hintsRemaining, h2.hintsRemaining, h3.hintsRemaining]).toEqual([2, 1, 0]);
    expect(h1.hint).not.toContain("e4");
    expect(h2.hint).toContain("pawn");
    expect(h3.hint).toContain("e4");
    expect(s.drill!.hintsGiven).toBe(3);
    expect(await call("get_hint", {}, s, e.fx)).toEqual({ hint: null, message: "No hints left. Offer to reveal the answer." });
    // only level 3 draws an arrow (start_drill's showPosition is the first call)
    expect(e.of("showPosition").slice(1)).toEqual([{ fn: "showPosition", args: [START, [["e2", "e4", BEST]]] }]);
  });

  it("wrong attempts report hints given and remaining", async () => {
    const s = newCoachState();
    const e = effects();
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    await call("get_hint", {}, s, e.fx);
    const r = await call("play_move", { move: "d4" }, s, e.fx);
    expect(r).toMatchObject({ hintsGiven: 1, hintsRemaining: 2 });
  });

  it("reveal_answer returns spoken best and game move and draws both arrows", async () => {
    const s = newCoachState();
    const e = effects();
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    const r = await call("reveal_answer", {}, s, e.fx);
    expect(r).toMatchObject({ bestSpoken: "pawn to e4", gameMoveSpoken: "knight to h3", cpl: 300 });
    expect(r.facts).toBeDefined();
    expect(s.drill!.revealed).toBe(true);
    expect(e.shown.at(-1)).toEqual({ fen: START, arrows: [["e2", "e4", BEST], ["g1", "h3", PLAYED]] });
  });
});

describe("explain_line", () => {
  it("uses example.pv, animates it, and returns per-ply facts", async () => {
    const s = newCoachState();
    const e = effects();
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    const r = await call("explain_line", {}, s, e.fx);
    expect(e.of("animateLine")).toEqual([{ fn: "animateLine", args: [START, ["e2e4", "e7e5", "g1f3"], BEST] }]);
    expect(e.of("analyze")).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(r.line.map((l: any) => [l.ply, l.side, l.spoken])).toEqual([
      [1, "White", "pawn to e4"], [2, "Black", "pawn to e5"], [3, "White", "knight to f3"],
    ]);
    expect(r.materialBefore).toBe(0);
    expect(r.materialAfter).toBe(0);
    expect(r.note).toBe("Explain using only these facts.");
  });

  it("limits plies and falls back to analyze when pv is empty", async () => {
    const s = newCoachState();
    const e = effects(REPORT, { bestUci: "e7e5", scoreCp: 20, pv: ["e7e5", "g1f3"] });
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    await call("play_move", { move: "e4" }, s, e.fx);
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx); // second example, pv []
    await call("explain_line", { plies: 1 }, s, e.fx);
    // the earlier play_move analyzed the position after e4; explain_line then analyzes the example FEN
    expect(e.of("analyze").at(-1)).toEqual({ fn: "analyze", args: [AFTER_E4] });
    expect(e.of("animateLine").at(-1)).toEqual({ fn: "animateLine", args: [AFTER_E4, ["e7e5"], BEST] });
  });

  it("returns an error instead of empty facts when no line is available", async () => {
    const s = newCoachState();
    const e = effects(REPORT, null); // analyze returns null (engine down)
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    await call("play_move", { move: "e4" }, s, e.fx);
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx); // second example, pv []
    const r = (await call("explain_line", {}, s, e.fx)) as Record<string, unknown>;
    expect(String(r.error)).toContain("No engine line");
    expect(e.of("animateLine")).toEqual([]);
  });

  it("works on a shown example without a drill; errors with neither", async () => {
    const s = newCoachState();
    const e = effects();
    expect(await call("explain_line", {}, s, e.fx)).toEqual(NO_DRILL);
    await call("show_mistake", { tag: "hanging_piece", index: 0 }, s, e.fx);
    const r = await call("explain_line", {}, s, e.fx);
    expect(r.line.length).toBe(3);
  });
});

describe("try_move and reset_position", () => {
  it("returns the engine line spoken and an eval from the player's perspective", async () => {
    const s = newCoachState();
    const e = effects(REPORT, { bestUci: "e7e5", scoreCp: -150, pv: ["e7e5"] });
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    const r = await call("try_move", { move: "e4" }, s, e.fx);
    expect(r.yourMove).toBe("pawn to e4");
    expect(r.lineLength).toBe(1);
    expect(r.next).toMatchObject({ ply: 1, total: 1, side: "Black", spoken: "pawn to e5", done: true });
    expect(r.evalSpoken).toBe(describeEval(150));
    expect(r.materialForYou).toBe(0);
    expect(e.of("flashMove")).toEqual([{ fn: "flashMove", args: [START, "e2e4"] }]);
    expect(e.of("analyze")).toEqual([{ fn: "analyze", args: [AFTER_E4_CJS] }]);
    expect(e.of("animateLine")).toEqual([]); // nothing animated until next_move
    expect(s.drill!.exploreFen).toBe(AFTER_E4_CJS);
    const n = await call("next_move", {}, s, e.fx);
    expect(n).toMatchObject({ ply: 1, total: 1, done: true, evalSpoken: describeEval(150) });
    expect(e.of("animateLine")).toEqual([{ fn: "animateLine", args: [AFTER_E4_CJS, ["e7e5"], CURRENT] }]);
    expect(s.drill!.exploreFen).toBe("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
    expect(s.drill!.attempts).toBe(0);
  });

  it("handles no engine, illegal moves, and continues from the explore position", async () => {
    const s = newCoachState();
    const e = effects(REPORT, null);
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    const r = await call("try_move", { move: "e4" }, s, e.fx);
    expect(r.yourMove).toBe("pawn to e4");
    expect(r.lineLength).toBe(0);
    expect(r.next).toBeNull();
    expect(r.evalSpoken).toBeNull();
    expect(r.materialForYou).toBe(0);
    expect(r.note).toMatch(/No engine line/);
    expect(s.drill!.exploreFen).toBe(AFTER_E4_CJS);
    const wrongSide = await call("try_move", { move: "e5" }, s, e.fx); // engine was down, so it is Black's turn
    expect(wrongSide.error).toMatch(/No engine reply/);
    s.drill!.exploreFen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const bad = await call("try_move", { move: "e5" }, s, e.fx); // white has no e5 move now
    expect(bad.verdict).toBe("illegal");
    const ok = await call("try_move", { move: "Nf3" }, s, e.fx);
    expect(ok.yourMove).toBe("knight to f3");
  });

  it("reset_position restores the drill FEN", async () => {
    const s = newCoachState();
    const e = effects(REPORT, null);
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    await call("try_move", { move: "e4" }, s, e.fx);
    const r = await call("reset_position", {}, s, e.fx);
    expect(r).toEqual({ status: "Back to the drill position" });
    expect(s.drill!.exploreFen).toBe(START);
    expect(e.shown.at(-1)).toEqual({ fen: START, arrows: undefined });
  });
});

describe("no drill in progress", () => {
  it.each(["play_move", "get_hint", "reveal_answer", "explain_line", "try_move", "reset_position"])("%s returns the exact error", async (name) => {
    expect(await call(name, { move: "e4" }, newCoachState(), effects().fx)).toEqual(NO_DRILL);
  });
  it("unknown function names are reported", async () => {
    expect(await call("launch_rockets", {}, newCoachState(), effects().fx)).toEqual({ error: "unknown function launch_rockets" });
  });
});

describe("playout", () => {
  // Drill example 0: START, best e2e4, played g1h3. After a wrong 1.d4 the engine (Black to move) replies.
  const AFTER_D4_LINE = { bestUci: "d7d5", scoreCp: -60, pv: ["d7d5", "c2c4", "e7e6"] };

  it("wrong attempt plays the move then the engine line with per-side colors and an eval", async () => {
    const s = newCoachState();
    const { fx, of } = effects(REPORT, AFTER_D4_LINE);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    const r = await call("play_move", { move: "d4" }, s, fx);
    expect(r.verdict).toBe("other");
    expect(of("flashMove")[0].args[1]).toBe("d2d4");
    expect(of("animateLine")).toHaveLength(0);
    expect(r.lineLength).toBe(3);
    expect(r.next).toMatchObject({ ply: 1, total: 3, side: "Black", done: false });
    const plies = await drain(s, fx);
    expect(shown(of("animateLine"))).toEqual(["d7d5", "c2c4", "e7e6"]);
    expect(of("animateLine").every((c) => c.args[2] === CURRENT)).toBe(true);
    expect(plies.map((x) => x.done)).toEqual([false, false, true]);
    expect(plies[0].evalSpoken).toBeUndefined();
    expect(plies[2].evalSpoken).toBe("You have a slight edge");
    expect(r.evalSpoken).toBe("You have a slight edge");
    expect(JSON.stringify(r)).not.toContain("e2e4");
    expect(s.drill!.exploreFen).toBe(START);  // next attempt is judged from the drill start
  });

  it("caps the line at PLAYOUT_PLIES and drops an illegal tail", async () => {
    const long = { bestUci: "d7d5", scoreCp: 0, pv: ["d7d5", "c2c4", "d5c4", "e2e3", "e7e5", "g1f3", "e5d4", "f1c4", "g8f6", "e1g1", "b8c6", "c1g5"] };
    const s = newCoachState();
    const { fx } = effects(REPORT, long);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    const first = await call("play_move", { move: "d4" }, s, fx);
    expect(first.lineLength).toBe(PLAYOUT_PLIES);

    const bad = { bestUci: "d7d5", scoreCp: 0, pv: ["d7d5", "a1a8"] };
    const s2 = newCoachState();
    const e2 = effects(REPORT, bad);
    await call("start_drill", { tag: "hanging_piece" }, s2, e2.fx);
    const r = await call("play_move", { move: "d4" }, s2, e2.fx);
    expect(r.lineLength).toBe(1);
  });

  it("engine down: move still plays, no line, note returned", async () => {
    const s = newCoachState();
    const { fx, of } = effects(REPORT, null);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    const r = await call("play_move", { move: "d4" }, s, fx);
    expect(of("flashMove")).toHaveLength(1);
    expect(of("animateLine")).toHaveLength(0);
    expect(r.lineLength).toBe(0);
    expect(r.next).toBeNull();
    expect(s.pending).toBeNull();
    expect(r.note).toMatch(/No engine line/);
  });

  it("try_move's explore position follows the shown plies and ends after the full line", async () => {
    const s = newCoachState();
    const { fx } = effects(REPORT, AFTER_D4_LINE);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    const r = await call("try_move", { move: "d4" }, s, fx);
    expect(r.lineLength).toBe(3);
    expect(s.drill!.exploreFen.split(" ")[1]).toBe("b"); // only the player's move so far
    await call("next_move", {}, s, fx);
    expect(s.drill!.exploreFen.split(" ")[1]).toBe("w");
    await drain(s, fx);
    expect(s.drill!.exploreFen).not.toBe(START);
    expect(s.drill!.exploreFen.split(" ")[1]).toBe("w"); // after 1.d4 d5 2.c4 e6 it is White to move
  });
});

describe("levels", () => {
  it("get_report passes the active levels and returns counts; examples expose level, kind and a note, never numbers", async () => {
    const s = newCoachState();
    const { fx, of } = effects();
    const r = await call("get_report", {}, s, fx);
    expect(of("fetchReport")[0].args[0]).toEqual(["tricky", "deep"]);
    expect(r.levels).toEqual(["tricky", "deep"]);
    expect(r.levelCounts.deep).toBe(2);
    const shown = await call("show_mistake", { tag: "hanging_piece", index: 1 }, s, fx);
    expect(shown.level).toBe("deep");
    expect(shown.kind).toBe("positional");
    expect(shown.difficultyNote).toBe("a quiet positional move, the kind that's hard to find even at your level");
    const drill = await call("start_drill", { tag: "hanging_piece" }, s, fx);
    for (const out of [r, shown, drill]) {
      const j = JSON.stringify(out);
      expect(j).not.toContain("difficultyElo");
      expect(j).not.toContain("harderThan");
      expect(j).not.toContain("pBest");
      expect(j).not.toMatch(/\d%/);
    }
    expect(r.patterns[0]).toMatchObject({ level: "tricky", kind: "tactical", difficultyNote: "a tactic a few moves deep" });
    expect(r.patterns[1].kind).toBeNull();
  });

  it("set_levels validates, updates the chips and refetches", async () => {
    const s = newCoachState();
    const { fx, of } = effects();
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    expect((await call("set_levels", { levels: [] }, s, fx)).error).toBeDefined();
    expect((await call("set_levels", { levels: ["hard"] }, s, fx)).error).toBeDefined();
    const r = await call("set_levels", { levels: ["deep"] }, s, fx);
    expect(r.levels).toEqual(["deep"]);
    expect(of("setLevels")[0].args[0]).toEqual(["deep"]);
    expect(of("fetchReport").at(-1)!.args[0]).toEqual(["deep"]);
    expect(s.drill).toBeNull();
  });
});

describe("step_line", () => {
  it("steps through the last line and follows it in the explore position", async () => {
    const s = newCoachState();
    const { fx } = effects();
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    s.drill!.exploreFen = AFTER_E4;
    const r = await call("step_line", { direction: "back" }, s, fx);
    expect(r).toEqual({ ply: 0, total: 3 });
    expect(s.drill!.exploreFen).toBe(START);
    expect((await call("step_line", { direction: "forward" }, s, fx)).error).toBeDefined();
    expect((await call("step_line", { direction: "sideways" }, s, fx)).error).toBeDefined();
  });
});

describe("playout ends with the player to move", () => {
  const LONG = ["d7d5", "c2c4", "e7e6", "b1c3", "g8f6", "g1f3", "f8e7", "e2e3", "e8g8", "f1d3", "c7c5"];

  it("caps at an odd 9 plies and a second try_move works from there", async () => {
    expect(PLAYOUT_PLIES).toBe(9);
    const s = newCoachState();
    const { fx, of } = effects(REPORT, { bestUci: "d7d5", scoreCp: -60, pv: LONG });
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    const r = await call("try_move", { move: "d4" }, s, fx);
    expect(r.lineLength).toBe(9);
    await drain(s, fx);
    expect(of("animateLine")).toHaveLength(9);
    expect(s.drill!.exploreFen.split(" ")[1]).toBe("w");
    const r2 = await call("try_move", { move: "Bd3" }, s, fx);
    expect(r2.error).toBeUndefined();
    expect(r2.yourMove).toBe("bishop to d3");
  });

  it("drops the last ply when truncation leaves an even count", async () => {
    const s = newCoachState();
    const { fx, of } = effects(REPORT, { bestUci: "d7d5", scoreCp: 0, pv: ["d7d5", "c2c4", "e7e6", "b1c3", "a1a8"] });
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    const r = await call("play_move", { move: "d4" }, s, fx);
    await drain(s, fx);
    expect(shown(of("animateLine"))).toEqual(["d7d5", "c2c4", "e7e6"]);
    expect(r.lineLength).toBe(3);
  });

  it("eval and colors follow the drill side (Black drill)", async () => {
    const s = newCoachState();
    const { fx, of } = effects(REPORT, { bestUci: "b1c3", scoreCp: 100, pv: ["b1c3", "b8c6", "g1f3"] });
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    await call("start_drill", { tag: "hanging_piece" }, s, fx); // second example: Black to move
    expect(s.drill!.example.fen).toBe(AFTER_E4);
    const r = await call("try_move", { move: "e5" }, s, fx);
    expect(r.evalSpoken).toBe(describeEval(-100));
    await drain(s, fx);
    expect(of("animateLine")).toHaveLength(3);
  });

  it("try_move refuses when the opponent is to move", async () => {
    const s = newCoachState();
    const { fx, of } = effects(REPORT, null);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    s.drill!.exploreFen = AFTER_E4;
    const r = await call("try_move", { move: "e5" }, s, fx);
    expect(r).toEqual({ error: "It's the opponent's move in this position. Step forward, or reset to the drill." });
    expect(of("flashMove")).toHaveLength(0);
    expect(s.drill!.exploreFen).toBe(AFTER_E4);
  });

  it("step_line to an opponent-to-move frame follows it (try_move refuses there)", async () => {
    const s = newCoachState();
    const { fx } = effects();
    fx.step = () => ({ fen: AFTER_E4, ply: 1, total: 3 });
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    expect(await call("step_line", { direction: "back" }, s, fx)).toEqual({ ply: 1, total: 3 });
    expect(s.drill!.exploreFen).toBe(AFTER_E4);
  });
});

describe("wrong attempts do not reveal the answer", () => {
  // Drill best is e2e4. After 1.d4 d5 the engine line has White playing e4 at a player ply.
  const LEAK = { bestUci: "d7d5", scoreCp: 0, pv: ["d7d5", "e2e4", "d5e4"] };

  it("cuts the line before the best move on play_move and try_move", async () => {
    const s = newCoachState();
    const { fx, of } = effects(REPORT, LEAK);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    const r = await call("play_move", { move: "d4" }, s, fx);
    expect(r.lineLength).toBe(1);
    expect(JSON.stringify(r)).not.toContain("e4");
    await drain(s, fx);
    expect(shown(of("animateLine"))).toEqual(["d7d5"]);
    const t = await call("try_move", { move: "d4" }, s, fx);
    expect(t.lineLength).toBe(1);
    await drain(s, fx);
    expect(shown(of("animateLine"))).toEqual(["d7d5", "d7d5"]);
  });

  it("does not cut once the drill is solved or revealed", async () => {
    const s = newCoachState();
    const { fx, of } = effects(REPORT, LEAK);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    await call("play_move", { move: "e4" }, s, fx); // solved
    await call("play_move", { move: "d4" }, s, fx);
    await drain(s, fx);
    expect(shown(of("animateLine"))).toEqual(["d7d5", "e2e4", "d5e4"]);
    const s2 = newCoachState();
    const e2 = effects(REPORT, LEAK);
    await call("start_drill", { tag: "hanging_piece" }, s2, e2.fx);
    await call("reveal_answer", {}, s2, e2.fx);
    await call("try_move", { move: "d4" }, s2, e2.fx);
    await drain(s2, e2.fx);
    expect(shown(e2.of("animateLine"))).toEqual(["d7d5", "e2e4", "d5e4"]);
  });
});

describe("review follow-ups", () => {
  it("stepping always moves exploreFen; try_move then refuses on the opponent's turn without flashing", async () => {
    const s = newCoachState();
    const { fx, of } = effects();
    fx.step = () => ({ fen: AFTER_E4, ply: 1, total: 3 });
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    await call("step_line", { direction: "back" }, s, fx);
    expect(s.drill!.exploreFen).toBe(AFTER_E4);
    const r = await call("try_move", { move: "e5" }, s, fx);
    expect(r.error).toMatch(/opponent's move/);
    expect(of("flashMove")).toHaveLength(0);
  });

  it("a best verdict is not cut even if the answer repeats later in the pv", async () => {
    const s = newCoachState();
    const { fx, of } = effects(REPORT, { bestUci: "g8f6", scoreCp: 0, pv: ["g8f6", "f3g1", "f6g8", "g1f3", "b8c6"] });
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    s.drill!.example = { ...s.drill!.example, best: "g1f3" };
    const r = await call("play_move", { move: "Nf3" }, s, fx);
    expect(r.verdict).toBe("best");
    await drain(s, fx);
    expect(shown(of("animateLine"))).toEqual(["g8f6", "f3g1", "f6g8", "g1f3", "b8c6"]);
  });

  it("try_move reports a finished game", async () => {
    const s = newCoachState();
    const { fx } = effects(REPORT, null);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    s.drill!.exploreFen = "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"; // stalemate, Black to move
    expect((await call("try_move", { move: "e5" }, s, fx)).error).toBe("The game is over in this position. Say reset to go back to the drill.");
  });

  it("no engine reply message after an engine-down playout", async () => {
    const s = newCoachState();
    const { fx } = effects(REPORT, null);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    await call("try_move", { move: "e4" }, s, fx);
    expect((await call("try_move", { move: "e5" }, s, fx)).error).toBe("No engine reply is available here. Say reset to go back to the drill.");
    await call("reset_position", {}, s, fx);
    expect((await call("try_move", { move: "e4" }, s, fx)).error).toBeUndefined();
  });
});

describe("next_move (coach-paced lines)", () => {
  const LINE = { bestUci: "d7d5", scoreCp: -60, pv: ["d7d5", "c2c4", "e7e6"] };

  it("play_move flashes only the player's move and returns the first ply as next, unanimated", async () => {
    const s = newCoachState();
    const { fx, of } = effects(REPORT, LINE);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    const r = await call("play_move", { move: "d4" }, s, fx);
    expect(of("flashMove")).toHaveLength(1);
    expect(of("animateLine")).toHaveLength(0);
    expect(r.next).toMatchObject({ ply: 1, total: 3, side: "Black", spoken: "pawn to d5", done: false });
    expect(r.next.caption).toBe("Black moves the pawn to d5");
    expect(r.engineLine).toBeUndefined();
    expect(JSON.stringify(r.next)).not.toMatch(/[a-h][1-8][a-h][1-8]/); // no UCI
  });

  it("animates exactly one ply per call from the right position, in marker red", async () => {
    const s = newCoachState();
    const { fx, of } = effects(REPORT, LINE);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    await call("play_move", { move: "d4" }, s, fx);
    const a = await call("next_move", {}, s, fx);
    expect(a).toMatchObject({ ply: 1, total: 3, done: false, spoken: "pawn to d5" });
    expect(of("animateLine")).toHaveLength(1);
    expect(of("animateLine")[0].args[1]).toEqual(["d7d5"]);
    expect(of("animateLine")[0].args[2]).toBe(CURRENT);
    const b = await call("next_move", {}, s, fx);
    expect(b).toMatchObject({ ply: 2, side: "White", done: false });
    expect(of("animateLine")[1].args[1]).toEqual(["c2c4"]);
    expect((of("animateLine")[1].args[0] as string).split(" ")[1]).toBe("w");
    const c = await call("next_move", {}, s, fx);
    expect(c).toMatchObject({ ply: 3, done: true, evalSpoken: "You have a slight edge" });
    expect(a.evalSpoken).toBeUndefined();
    expect(c.caption).toContain("Black");
    // non-best attempts are still judged from the drill start
    expect(s.drill!.exploreFen).toBe(START);
  });

  it("errors when there is no pending line, and after the line is done", async () => {
    const s = newCoachState();
    const { fx } = effects(REPORT, LINE);
    expect((await call("next_move", {}, s, fx)).error).toMatch(/no line/i);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    await call("play_move", { move: "d4" }, s, fx);
    await drain(s, fx);
    expect((await call("next_move", {}, s, fx)).error).toBeDefined();
  });

  it("a new move, reset, hint-reveal, drill and levels all drop the pending line", async () => {
    const s = newCoachState();
    const { fx, of } = effects(REPORT, LINE);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    await call("play_move", { move: "d4" }, s, fx);
    expect(s.pending).not.toBeNull();
    await call("next_move", {}, s, fx);
    await call("play_move", { move: "c4" }, s, fx); // interrupts: replaced by a fresh line
    expect(s.pending!.next).toBe(0);
    await call("reset_position", {}, s, fx);
    expect(s.pending).toBeNull();
    expect((await call("next_move", {}, s, fx)).error).toBeDefined();
    await call("play_move", { move: "d4" }, s, fx);
    await call("reveal_answer", {}, s, fx);
    expect(s.pending).toBeNull();
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    await call("try_move", { move: "e4" }, s, fx);
    await call("show_mistake", { tag: "hanging_piece", index: 0 }, s, fx);
    expect(s.pending).toBeNull();
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    await call("try_move", { move: "e4" }, s, fx);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    expect(s.pending).toBeNull();
    await call("try_move", { move: "e5" }, s, fx);
    await call("set_levels", { levels: ["deep"] }, s, fx);
    expect(s.pending).toBeNull();
    expect(of("animateLine")).toHaveLength(1); // only the one next_move call earlier
  });

  it("a new try_move or play_move interrupts a pending line instead of being refused", async () => {
    const s = newCoachState();
    const { fx, of } = effects(REPORT, LINE);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    await call("try_move", { move: "d4" }, s, fx);
    await call("next_move", {}, s, fx);
    const r = await call("try_move", { move: "e4" }, s, fx);
    expect(r.error).toBeUndefined();
    expect(r.yourMove).toBe("pawn to e4");
    expect(of("flashMove").at(-1)!.args).toEqual([START, "e2e4"]); // played from where the old line began
    expect(s.pending!.next).toBe(0);
    await drain(s, fx);
    expect((await call("try_move", { move: "Nf3" }, s, fx)).error).toBeUndefined();
    // play_move while a try_move line is pending
    await call("reset_position", {}, s, fx);
    await call("try_move", { move: "d4" }, s, fx);
    const p = await call("play_move", { move: "d4" }, s, fx);
    expect(p.error).toBeUndefined();
    expect(p.next).toMatchObject({ ply: 1 });
  });

  it("a solved drill follows the shown plies", async () => {
    const s = newCoachState();
    const { fx } = effects(REPORT, { bestUci: "e7e5", scoreCp: 0, pv: ["e7e5", "g1f3", "b8c6"] });
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    const r = await call("play_move", { move: "e4" }, s, fx);
    expect(r.verdict).toBe("best");
    expect(s.drill!.solved).toBe(true);
    await call("next_move", {}, s, fx);
    expect(s.drill!.exploreFen.split(" ")[1]).toBe("w");
  });
});

describe("get_profile", () => {
  const profile = {
    username: "alice",
    ratings: { blitz: { rating: 1650, games: 300, prog: 12 } },
    analyzed: { games: 20, moves: 800, from: null, to: null },
    record: { white: { w: 5, d: 1, l: 4 }, black: { w: 4, d: 0, l: 6 } },
    phases: { opening: 2, middlegame: 6, endgame: 4 },
    kinds: { positional: 3, tactical: 9 },
    clock: { underThirtyShare: 0.1, mistakeRateUnder30: 3, mistakeRateOver30: 3 },
    grid: [],
    patterns: [{ tag: "hanging_piece", count: 7, lastSeen: null, levels: { slip: 0, tricky: 0, deep: 0, unrated: 0 }, kinds: { positional: 0, tactical: 7 } }],
  };

  it("returns summary, ratings, strengths, leaks and top pattern, fetched once", async () => {
    const s = newCoachState();
    const { fx } = effects();
    fx.fetchProfile = vi.fn(async () => profile);
    const r = await call("get_profile", {}, s, fx);
    await call("get_profile", {}, s, fx);
    expect(fx.fetchProfile).toHaveBeenCalledTimes(1);
    expect(r.summary).toContain("Your recurring weakness is hanging pieces");
    expect(r.ratings).toEqual({ blitz: 1650 });
    expect(r.strengths.length).toBeGreaterThan(0);
    expect(r.leaks.length).toBeGreaterThan(0);
    expect(r.topPattern).toMatchObject({ tag: "hanging_piece", name: "Hanging pieces", count: 7 });
    const j = JSON.stringify(r);
    expect(j).not.toMatch(/%/);
    expect(j).not.toContain("prog");
  });

  it("errors without a profile", async () => {
    expect((await call("get_profile", {}, newCoachState(), effects().fx)).error).toBe("no profile yet");
  });
});

describe("review fixes", () => {
  const LINE = { bestUci: "d7d5", scoreCp: -60, pv: ["d7d5", "c2c4", "e7e6"] };

  it("an interrupt during next_move's animation does not wipe the new line", async () => {
    const s = newCoachState();
    const { fx } = effects(REPORT, LINE);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    await call("play_move", { move: "d4" }, s, fx);
    let release!: () => void;
    fx.animateLine = () => new Promise<void>((r) => { release = r; });
    const pending = call("next_move", {}, s, fx);
    await Promise.resolve();
    await call("reset_position", {}, s, fx); // interrupt
    await call("play_move", { move: "c4" }, s, fx); // a new line
    const fresh = s.pending;
    expect(fresh).not.toBeNull();
    release();
    await pending;
    expect(s.pending).toBe(fresh);
    expect(fresh!.next).toBe(0);
  });

  it("step_line drops the pending line", async () => {
    const s = newCoachState();
    const { fx } = effects(REPORT, LINE);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    await call("try_move", { move: "d4" }, s, fx);
    expect(s.pending).not.toBeNull();
    await call("step_line", { direction: "back" }, s, fx);
    expect(s.pending).toBeNull();
    expect((await call("next_move", {}, s, fx)).error).toBeDefined();
  });

  it("fetch failures come back as errors, not exceptions", async () => {
    const s = newCoachState();
    const { fx } = effects();
    fx.fetchReport = vi.fn(async () => { throw new Error("boom"); });
    fx.fetchProfile = vi.fn(async () => { throw new Error("boom"); });
    expect((await call("get_report", {}, s, fx)).error).toBeDefined();
    expect((await call("get_profile", {}, s, fx)).error).toBeDefined();
  });

  it("get_profile topPattern skips time_trouble and other; get_report no longer says call first", async () => {
    const lv = { slip: 0, tricky: 0, deep: 0, unrated: 0 };
    const mk = (tag: string, count: number) => ({ tag, count, lastSeen: null, levels: lv, kinds: { positional: 0, tactical: count } });
    const s = newCoachState();
    const { fx } = effects();
    fx.fetchProfile = vi.fn(async () => ({
      username: "a", ratings: null, analyzed: { games: 3, moves: 90, from: null, to: null },
      record: { white: { w: 1, d: 0, l: 1 }, black: { w: 1, d: 0, l: 0 } },
      phases: { opening: 1, middlegame: 2, endgame: 3 }, kinds: { positional: 1, tactical: 20 },
      clock: { underThirtyShare: 0, mistakeRateUnder30: 0, mistakeRateOver30: 0 }, grid: [],
      patterns: [mk("time_trouble", 12), mk("other", 9), mk("hanging_piece", 4), mk("positional", 2)],
    }));
    expect((await call("get_profile", {}, s, fx)).topPattern).toMatchObject({ tag: "hanging_piece", count: 4 });
    expect(FUNCTION_DEFS.find((f) => f.name === "get_report")!.description).not.toMatch(/call this first/i);
  });

  it("openPosition starts a drill on a given example (grid click)", async () => {
    const s = newCoachState();
    const { fx, shown } = effects();
    s.pending = { base: START, fens: [], plies: [], you: "White", next: 0, evalSpoken: null, follow: true };
    const ex = REPORT.patterns[0].examples[1];
    const r = openPosition("hanging_piece", ex, s, fx);
    expect(r.status).toBe("Position ready, Black to move");
    expect(s.drill).toMatchObject({ tag: "hanging_piece", example: ex, attempts: 0, exploreFen: AFTER_E4 });
    expect(s.lastShown).toBe(ex);
    expect(s.pending).toBeNull();
    expect(shown.at(-1)!.fen).toBe(AFTER_E4);
    expect(s.drilled.has("g2:1")).toBe(true);
  });
});
