import { expect, it, vi } from "vitest";
import { newCoachState, openPosition, handleFunctionCall, type CoachEffects } from "./functions";
import type { Example } from "../types";
const ex: Example = {
  gameId: "g",
  ply: 0,
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  played: "g1h3",
  best: "e2e4",
  cpl: 200,
  pPlayed: 0.3,
  pv: [],
  level: "tricky",
  kind: "tactical",
  severity: "mistake",
  difficultyElo: 1500,
};
const effects = (): CoachEffects => ({
  fetchProfile: async () => null,
  fetchReport: async () => null,
  showPosition: vi.fn(),
  flashMove: vi.fn(async () => {}),
  animateLine: vi.fn(async () => {}),
  analyze: vi.fn(async () => ({ bestUci: "e7e5", scoreCp: 150, pv: ["e7e5", "h3g5", "g8f6"] })),
  step: () => null,
  setLevels: () => {},
});
it("stops a wrong attempt at the original position and offers review instead of playing a variation", async () => {
  const state = newCoachState(),
    fx = effects();
  openPosition("hanging_piece", ex, state, fx);
  const result = (await handleFunctionCall("play_move", { move: "Nh3" }, state, fx)) as any;
  expect(result).toMatchObject({ verdict: "repeated_mistake", next: null, lineLength: 0, reviewAvailable: true });
  expect(state.pending).toBeNull();
  expect(fx.showPosition).toHaveBeenLastCalledWith(ex.fen);
  expect(await handleFunctionCall("next_move", {}, state, fx)).toHaveProperty("error");
});
it("an explicit See why replays the attempted move and exposes only the first reply", async () => {
  const state = newCoachState(),
    fx = effects();
  openPosition("hanging_piece", ex, state, fx);
  await handleFunctionCall("play_move", { move: "Nh3" }, state, fx);
  const review = (await handleFunctionCall("review_attempt", {}, state, fx)) as any;
  expect(review).toHaveProperty("playedSpoken", "knight to h3");
  expect(state.pending?.plies.map((p) => p.uci)).toEqual(["e7e5"]);
  const reply = (await handleFunctionCall("next_move", {}, state, fx)) as any;
  expect(reply.done).toBe(true);
  expect(reply.retryAvailable).toBe(true);
  expect(await handleFunctionCall("next_move", {}, state, fx)).toHaveProperty("error");
});
it("explaining the best line shows only one move and leaves the rest pending", async () => {
  const state = newCoachState(),
    fx = effects();
  openPosition("hanging_piece", { ...ex, pv: ["e2e4", "e7e5", "g1f3"] }, state, fx);
  await handleFunctionCall("explain_line", {}, state, fx);
  expect(fx.animateLine).toHaveBeenCalledTimes(1);
  expect(fx.animateLine).toHaveBeenLastCalledWith(ex.fen, ["e2e4"], expect.any(String));
  expect(state.pending?.next).toBe(1);
});
