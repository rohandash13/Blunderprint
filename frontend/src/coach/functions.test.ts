import { describe, expect, it, vi } from "vitest";
import { BEST, FUNCTION_DEFS, PLAYED, PLAYOUT_PLIES, REPLY, handleFunctionCall, newCoachState, type Arrow, type CoachEffects } from "./functions";
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
        { gameId: "g1", ply: 0, fen: START, played: "g1h3", best: "e2e4", cpl: 300, pPlayed: 0.214, pv: ["e2e4", "e7e5", "g1f3"], pBest: 0.3, level: "tricky", harderThanPercent: 40 },
        { gameId: "g2", ply: 1, fen: AFTER_E4, played: "g8h6", best: "e7e5", cpl: 250, pPlayed: 0.18, pv: [], pBest: 0.05, level: "deep", harderThanPercent: 90 },
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (name: string, args: Record<string, unknown>, s: ReturnType<typeof newCoachState>, fx: CoachEffects) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleFunctionCall(name, args, s, fx) as Promise<Record<string, any>>;

describe("FUNCTION_DEFS", () => {
  it("declares the eleven client-side functions in order", () => {
    expect(FUNCTION_DEFS.map((f) => f.name)).toEqual([
      "get_report", "show_mistake", "start_drill", "play_move", "get_hint", "reveal_answer", "explain_line", "try_move", "reset_position", "set_levels", "step_line",
    ]);
    for (const f of FUNCTION_DEFS) {
      expect(f.parameters.type).toBe("object");
      expect(f.description.length).toBeGreaterThan(20);
    }
  });
  it("exports arrow colors", () => {
    expect([BEST, PLAYED, REPLY]).toEqual(["rgb(40,160,80)", "rgb(200,50,50)", "rgb(50,100,210)"]);
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
    });
    expect(r.patterns[1].named).toBe(false);
    expect(r.patterns[1].description).toContain("Uncategorized middlegame mistakes");
    expect(r.movesAnalyzed).toBe(400);
  });

  it("get_report reports a missing report", async () => {
    expect(await call("get_report", {}, newCoachState(), effects(null).fx)).toEqual({ error: "no report yet" });
  });

  it("show_mistake shows arrows and returns spoken moves, not SAN", async () => {
    const e = effects();
    const r = await call("show_mistake", { tag: "hanging_piece", index: 1 }, newCoachState(), e.fx);
    expect(e.shown).toEqual([{ fen: AFTER_E4, arrows: [["g8", "h6", PLAYED], ["e7", "e5", BEST]] }]);
    expect(r).toEqual({
      moveNumber: 1, side: "Black", playedSpoken: "knight to h6", bestSpoken: "pawn to e5", cpl: 250, pPlayed: 0.18, level: "deep", harderThanPercent: 90,
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
    expect(ready).toEqual({ status: "Position ready, White to move", side: "White", moveNumber: 1, level: "tricky", harderThanPercent: 40 });
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
    expect(next).toEqual({ status: "Position ready, Black to move", side: "Black", moveNumber: 1, level: "deep", harderThanPercent: 90 });
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
    expect(r.engineLine.map((m: { spoken: string }) => m.spoken)).toEqual(["pawn to e5"]);
    expect(r.evalForYou).toBe(150);
    expect(r.evalSpoken).toBe(describeEval(150));
    expect(r.materialForYou).toBe(0);
    expect(e.of("flashMove")).toEqual([{ fn: "flashMove", args: [START, "e2e4"] }]);
    expect(e.of("analyze")).toEqual([{ fn: "analyze", args: [AFTER_E4_CJS] }]);
    expect(e.of("animateLine")).toEqual([{ fn: "animateLine", args: [AFTER_E4_CJS, ["e7e5"], [REPLY]] }]);
    expect(s.drill!.exploreFen).toBe("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
    expect(s.drill!.attempts).toBe(0);
  });

  it("handles no engine, illegal moves, and continues from the explore position", async () => {
    const s = newCoachState();
    const e = effects(REPORT, null);
    await call("start_drill", { tag: "hanging_piece" }, s, e.fx);
    const r = await call("try_move", { move: "e4" }, s, e.fx);
    expect(r.yourMove).toBe("pawn to e4");
    expect(r.engineLine).toBeNull();
    expect(r.evalForYou).toBeNull();
    expect(r.evalSpoken).toBeNull();
    expect(r.materialForYou).toBe(0);
    expect(r.note).toMatch(/No engine line/);
    expect(s.drill!.exploreFen).toBe(AFTER_E4_CJS);
    const bad = await call("try_move", { move: "e4" }, s, e.fx); // black has no e4 move
    expect(bad.verdict).toBe("illegal");
    const ok = await call("try_move", { move: "e5" }, s, e.fx);
    expect(ok.yourMove).toBe("pawn to e5");
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
    const anim = of("animateLine")[0].args;
    expect(anim[1]).toEqual(["d7d5", "c2c4", "e7e6"]);
    expect(anim[2]).toEqual([REPLY, BEST, REPLY]);
    expect(r.engineLine.map((m: { spoken: string }) => m.spoken)).toHaveLength(3);
    expect(r.evalForYou).toBe(60);
    expect(r.evalSpoken).toBe("You have a slight edge");
    expect(JSON.stringify(r)).not.toContain("e2e4");
    expect(s.drill!.exploreFen).toBe(START);  // next attempt is judged from the drill start
  });

  it("caps the line at PLAYOUT_PLIES and drops an illegal tail", async () => {
    const long = { bestUci: "d7d5", scoreCp: 0, pv: ["d7d5", "c2c4", "d5c4", "e2e4", "e7e5", "g1f3", "e5d4", "f1c4", "g8f6", "e1g1", "b8c6", "c1g5"] };
    const s = newCoachState();
    const { fx, of } = effects(REPORT, long);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    await call("play_move", { move: "d4" }, s, fx);
    expect((of("animateLine")[0].args[1] as string[]).length).toBe(PLAYOUT_PLIES);

    const bad = { bestUci: "d7d5", scoreCp: 0, pv: ["d7d5", "a1a8"] };
    const s2 = newCoachState();
    const e2 = effects(REPORT, bad);
    await call("start_drill", { tag: "hanging_piece" }, s2, e2.fx);
    const r = await call("play_move", { move: "d4" }, s2, e2.fx);
    expect(r.engineLine).toHaveLength(1);
  });

  it("engine down: move still plays, no line, note returned", async () => {
    const s = newCoachState();
    const { fx, of } = effects(REPORT, null);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    const r = await call("play_move", { move: "d4" }, s, fx);
    expect(of("flashMove")).toHaveLength(1);
    expect(of("animateLine")).toHaveLength(0);
    expect(r.engineLine).toBeNull();
    expect(r.note).toMatch(/No engine line/);
  });

  it("try_move plays the full line and moves the explore position to its end", async () => {
    const s = newCoachState();
    const { fx } = effects(REPORT, AFTER_D4_LINE);
    await call("start_drill", { tag: "hanging_piece" }, s, fx);
    const r = await call("try_move", { move: "d4" }, s, fx);
    expect(r.engineLine).toHaveLength(3);
    expect(s.drill!.exploreFen).not.toBe(START);
    expect(s.drill!.exploreFen.split(" ")[1]).toBe("w"); // after 1.d4 d5 2.c4 e6 it is White to move
  });
});

describe("levels", () => {
  it("get_report passes the active levels and returns counts; examples expose level and harderThanPercent", async () => {
    const s = newCoachState();
    const { fx, of } = effects();
    const r = await call("get_report", {}, s, fx);
    expect(of("fetchReport")[0].args[0]).toEqual(["tricky", "deep"]);
    expect(r.levels).toEqual(["tricky", "deep"]);
    expect(r.levelCounts.deep).toBe(2);
    const shown = await call("show_mistake", { tag: "hanging_piece", index: 1 }, s, fx);
    expect(shown.level).toBe("deep");
    expect(shown.harderThanPercent).toBe(90);
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
