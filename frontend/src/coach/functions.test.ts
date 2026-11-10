import { describe, expect, it, vi } from "vitest";
import { FUNCTION_DEFS, handleFunctionCall, newCoachState, type CoachEffects } from "./functions";
import type { Report } from "../types";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

const REPORT: Report = {
  username: "alice",
  runId: "r1",
  movesAnalyzed: 400,
  mistakes: 30,
  candidates: 12,
  patterns: [
    {
      tag: "hanging_piece",
      count: 5,
      avgCpl: 412.6,
      examples: [
        { gameId: "g1", ply: 0, fen: START, played: "g1h3", best: "e2e4", cpl: 300, pPlayed: 0.214 },
        { gameId: "g2", ply: 1, fen: AFTER_E4, played: "g8h6", best: "e7e5", cpl: 250, pPlayed: 0.18 },
      ],
    },
  ],
};

function effects(report: Report | null = REPORT): CoachEffects & { shown: string[]; played: string[] } {
  const shown: string[] = [];
  const played: string[] = [];
  return {
    shown,
    played,
    fetchReport: vi.fn(async () => report),
    showPosition: (fen) => shown.push(fen),
    playOnBoard: (uci) => played.push(uci),
  };
}

describe("FUNCTION_DEFS", () => {
  it("declares the four client-side functions with JSON-schema parameters", () => {
    expect(FUNCTION_DEFS.map((f) => f.name)).toEqual(["get_report", "show_mistake", "start_drill", "play_move"]);
    for (const f of FUNCTION_DEFS) {
      expect(f.parameters.type).toBe("object");
      expect("endpoint" in f).toBe(false);
    }
  });
});

describe("handleFunctionCall", () => {
  it("get_report fetches once and summarizes", async () => {
    const s = newCoachState();
    const fx = effects();
    const r = (await handleFunctionCall("get_report", {}, s, fx)) as Record<string, unknown>;
    await handleFunctionCall("get_report", {}, s, fx);
    expect(fx.fetchReport).toHaveBeenCalledTimes(1);
    expect(r).toEqual({
      movesAnalyzed: 400, mistakes: 30, candidates: 12,
      patterns: [{ tag: "hanging_piece", count: 5, avgCpl: 413, examples: 2 }],
    });
  });

  it("get_report reports a missing report instead of inventing one", async () => {
    expect(await handleFunctionCall("get_report", {}, newCoachState(), effects(null))).toEqual({ error: "no report yet" });
  });

  it("show_mistake puts the position on the board and returns SAN facts", async () => {
    const fx = effects();
    const r = await handleFunctionCall("show_mistake", { tag: "hanging_piece", index: 1 }, newCoachState(), fx);
    expect(fx.shown).toEqual([AFTER_E4]);
    expect(r).toEqual({ moveNumber: 1, side: "Black", played: "Nh6", best: "e5", cpl: 250, pPlayed: 0.18 });
  });

  it("show_mistake rejects unknown tags and bad indexes", async () => {
    const s = newCoachState();
    expect(await handleFunctionCall("show_mistake", { tag: "nope", index: 0 }, s, effects()))
      .toEqual({ error: 'no pattern "nope"', available: ["hanging_piece"] });
    expect(await handleFunctionCall("show_mistake", { tag: "hanging_piece", index: 9 }, s, effects()))
      .toEqual({ error: "index out of range", examples: 2 });
  });

  it("start_drill hides the answer and play_move judges with code", async () => {
    const s = newCoachState();
    const fx = effects();
    const ready = await handleFunctionCall("start_drill", { tag: "hanging_piece" }, s, fx);
    expect(ready).toEqual({ status: "Position ready, White to move", moveNumber: 1 });
    expect(JSON.stringify(ready)).not.toContain("e4");

    const v = await handleFunctionCall("play_move", { move: "knight h3" }, s, fx);
    expect(v).toEqual({ verdict: "repeated_mistake", san: "Nh3", bestMove: "e4", yourGameMove: "Nh3" });
    expect(fx.played).toEqual(["g1h3"]);

    const next = await handleFunctionCall("start_drill", { tag: "hanging_piece" }, s, fx);
    expect(next).toEqual({ status: "Position ready, Black to move", moveNumber: 1 });
  });

  it("play_move without a drill and with an illegal move", async () => {
    const s = newCoachState();
    expect(await handleFunctionCall("play_move", { move: "e4" }, s, effects()))
      .toEqual({ error: "no drill in progress; call start_drill first" });
    await handleFunctionCall("start_drill", { tag: "hanging_piece" }, s, effects());
    const v = (await handleFunctionCall("play_move", { move: "king e2" }, s, effects())) as Record<string, unknown>;
    expect(v.verdict).toBe("illegal");
  });

  it("unknown function names are reported", async () => {
    expect(await handleFunctionCall("launch_rockets", {}, newCoachState(), effects())).toEqual({ error: "unknown function launch_rockets" });
  });

  it("show_mistake accepts numeric strings but rejects missing or junk indexes", async () => {
    const s = newCoachState();
    const ok = (await handleFunctionCall("show_mistake", { tag: "hanging_piece", index: "1" }, s, effects())) as Record<string, unknown>;
    expect(ok.played).toBe("Nh6");
    for (const index of [undefined, null, "", true, -1, 1.5, "abc"]) {
      expect(await handleFunctionCall("show_mistake", { tag: "hanging_piece", index }, s, effects()))
        .toEqual({ error: "index out of range", examples: 2 });
    }
  });

  it("a drill allows one attempt, then needs start_drill again", async () => {
    const s = newCoachState();
    await handleFunctionCall("start_drill", { tag: "hanging_piece" }, s, effects());
    await handleFunctionCall("play_move", { move: "e4" }, s, effects());
    expect(await handleFunctionCall("play_move", { move: "d4" }, s, effects()))
      .toEqual({ error: "no drill in progress; call start_drill first" });
  });
});

