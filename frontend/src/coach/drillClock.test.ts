import { afterEach, expect, it, vi } from "vitest";
import { handleFunctionCall, newCoachState, openPosition, type CoachEffects } from "./functions";
import { clockRemaining, newDrillClock } from "./drillClock";
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
  recordedClockCs: 1250,
};
const fx = (): CoachEffects => ({
  fetchProfile: async () => null,
  fetchReport: async () => null,
  showPosition: vi.fn(),
  animateLine: vi.fn(async () => {}),
  flashMove: vi.fn(async () => {}),
  analyze: vi.fn(async () => null),
  setLevels: vi.fn(),
  step: () => null,
});
afterEach(() => vi.useRealTimers());

it("uses a positive recorded game clock, otherwise a labeled thirty-second fallback", () => {
  expect(newDrillClock(1250)).toMatchObject({ budgetMs: 12500, source: "game", status: "ready" });
  for (const value of [null, undefined, 0, -10, NaN, Infinity, 6000])
    expect(newDrillClock(value)).toMatchObject({ budgetMs: 30000, source: "fallback", status: "ready" });
});
it("starts only on readiness, rejects illegal moves without stopping, and stops before engine work", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const state = newCoachState(),
    effects = fx();
  openPosition("time_trouble", ex, state, effects);
  expect(state.drill?.clock?.status).toBe("ready");
  expect(await handleFunctionCall("play_move", { move: "e4" }, state, effects)).toHaveProperty("error");
  await handleFunctionCall("start_clock", {}, state, effects);
  vi.setSystemTime(3500);
  expect(await handleFunctionCall("play_move", { move: "e5" }, state, effects)).toHaveProperty("verdict", "illegal");
  expect(state.drill?.clock?.status).toBe("running");
  effects.analyze = vi.fn(async () => {
    vi.setSystemTime(50000);
    return null;
  });
  await handleFunctionCall("play_move", { move: "e4" }, state, effects);
  expect(state.drill?.clock).toMatchObject({ status: "submitted", remainingMs: 10000 });
  expect(clockRemaining(state.drill!.clock!, 50000)).toBe(10000);
  await handleFunctionCall("reset_position", {}, state, effects);
  expect(state.drill).toMatchObject({ solved: false, revealed: false, attempts: 0, hintsGiven: 0, clock: { status: "ready" } });
});
it("enforces the deadline even before a UI tick and resets without revealing the answer", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const state = newCoachState(),
    effects = fx();
  openPosition("time_trouble", ex, state, effects);
  await handleFunctionCall("start_clock", {}, state, effects);
  vi.setSystemTime(13500);
  expect(await handleFunctionCall("play_move", { move: "e4" }, state, effects)).toHaveProperty("error");
  expect(state.drill?.clock?.status).toBe("expired");
  expect(effects.flashMove).not.toHaveBeenCalled();
  await handleFunctionCall("reset_position", {}, state, effects);
  expect(state.drill?.clock?.status).toBe("ready");
  await handleFunctionCall("untimed_practice", {}, state, effects);
  expect(await handleFunctionCall("play_move", { move: "e4" }, state, effects)).toHaveProperty("verdict", "best");
});
it("does not add a clock to ordinary pattern drills", () => {
  const state = newCoachState();
  openPosition("positional", ex, state, fx());
  expect(state.drill?.clock).toBeUndefined();
});
