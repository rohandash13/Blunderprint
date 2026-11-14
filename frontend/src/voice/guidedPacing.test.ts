import { expect, it } from "vitest";
import { GuidedPacing } from "./guidedPacing";

it("allows one board action per real user turn, never an autonomous tool-call chain", () => {
  const pace = new GuidedPacing();
  expect(pace.consumeTurn()).toBe(false);
  pace.userTurn();
  expect(pace.consumeTurn()).toBe(true);
  expect(pace.consumeTurn()).toBe(false);
  pace.userTurn();
  expect(pace.consumeTurn()).toBe(true);
});
it("waits for the matching explanation, real audio, stream completion and drained playback", () => {
  const pace = new GuidedPacing();
  pace.begin("Black takes your rook on f7.");
  pace.userTurn();
  pace.text("An unrelated response.");
  pace.audio();
  pace.audioDone();
  pace.tick(0);
  expect(pace.speaking).toBe(true);
  expect(pace.consumeTurn()).toBe(false);
  pace.text("Black takes your rook on f7.");
  pace.audio();
  pace.audioDone();
  pace.tick(500);
  expect(pace.speaking).toBe(true);
  pace.tick(0);
  expect(pace.speaking).toBe(false);
  expect(pace.consumeTurn()).toBe(true);
  expect(pace.consumeTurn()).toBe(false);
});
it("releases the explanation on an explicit user interruption or voice stop", () => {
  const pace = new GuidedPacing();
  pace.begin("A move explanation.");
  pace.interrupt();
  pace.userTurn();
  expect(pace.speaking).toBe(false);
  expect(pace.consumeTurn()).toBe(true);
});
