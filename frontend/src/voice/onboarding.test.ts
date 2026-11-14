import { expect, it } from "vitest";
import { voiceOnboarding } from "./onboarding";
import { newCoachState, type Drill } from "../coach/functions";

it("introduces the coach's job outside a drill without reciting player statistics", () => {
  const result = voiceOnboarding(newCoachState());
  expect(result.introduction).toContain("I'm your Blunderprint coach");
  expect(result.introduction).toContain("your games");
  expect(result.introduction).not.toContain("107");
});
it("orients an active drill and preserves it instead of returning to the profile", () => {
  const state = newCoachState();
  state.drill = { tag: "positional", solved: false, revealed: false } as Drill;
  const result = voiceOnboarding(state);
  expect(result.introduction).toContain("this position");
  expect(result.context).toContain("Do not switch to a profile overview");
  expect(result.context).toContain("Do not restart");
});
it("explains readiness in a timed drill without starting or resetting its clock", () => {
  const state = newCoachState();
  state.drill = { tag: "time_trouble", clock: { status: "ready" } } as Drill;
  const result = voiceOnboarding(state);
  expect(result.introduction).toContain("Start clock");
  expect(state.drill.clock?.status).toBe("ready");
});
