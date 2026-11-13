import { describe, expect, it } from "vitest";
import { flowReducer, initialFlow, canGo, type FlowAction, type FlowState } from "./flow";

const run = (actions: FlowAction[], from: FlowState = initialFlow): FlowState => actions.reduce(flowReducer, from);

describe("flow reducer", () => {
  it("starts on landing with only profile locked", () => {
    expect(initialFlow.step).toBe("landing");
    expect(initialFlow.username).toBeNull();
    expect(canGo(initialFlow, "profile")).toBe(false);
  });

  it("landing -> analyzing -> profile -> focus -> drill", () => {
    let s = run([{ type: "submit", username: " Alice " }]);
    expect(s).toMatchObject({ step: "analyzing", username: "Alice", runId: null, error: null });
    s = run([{ type: "started", runId: "r1" }], s);
    expect(s.runId).toBe("r1");
    s = run([{ type: "done" }], s);
    expect(s.step).toBe("profile");
    expect(canGo(s, "focus")).toBe(true);
    expect(canGo(s, "drill")).toBe(false);
    s = run([{ type: "goto", step: "focus" }], s);
    expect(s.step).toBe("focus");
    s = run([{ type: "chooseFocus", tag: "hanging_piece" }], s);
    expect(s).toMatchObject({ step: "drill", focusTag: "hanging_piece" });
    expect(canGo(s, "drill")).toBe(true);
  });

  it("ignores a blank username", () => {
    expect(run([{ type: "submit", username: "   " }])).toBe(initialFlow);
  });

  it("existing status skips ahead", () => {
    const base = run([{ type: "submit", username: "alice" }]);
    expect(run([{ type: "existing", status: { status: "DONE", runId: "r9", queuePosition: null } }], base)).toMatchObject({ step: "profile", runId: "r9" });
    expect(run([{ type: "existing", status: { status: "RUNNING", runId: "r9", queuePosition: 2 } }], base)).toMatchObject({ step: "analyzing", runId: "r9" });
    expect(run([{ type: "existing", status: { status: "none", runId: null, queuePosition: null } }], base)).toMatchObject({ step: "analyzing", runId: null });
  });

  it("goto only reaches unlocked steps", () => {
    const analyzing = run([{ type: "submit", username: "alice" }]);
    expect(run([{ type: "goto", step: "profile" }], analyzing)).toBe(analyzing);
    expect(run([{ type: "goto", step: "drill" }], analyzing)).toBe(analyzing);
    const profile = run([{ type: "done" }], analyzing);
    expect(run([{ type: "goto", step: "drill" }], profile)).toBe(profile);
    const drill = run([{ type: "openPosition" }], profile);
    expect(drill.step).toBe("drill");
    expect(run([{ type: "goto", step: "profile" }], drill).step).toBe("profile");
    expect(run([{ type: "goto", step: "drill" }], run([{ type: "goto", step: "profile" }], drill)).step).toBe("drill");
  });

  it("failure returns to landing with the message and clears unlocks", () => {
    const s = run([{ type: "submit", username: "alice" }, { type: "failed", message: "No rated games found for alice" }]);
    expect(s).toMatchObject({ step: "landing", error: "No rated games found for alice" });
    expect(canGo(s, "profile")).toBe(false);
  });

  it("restart goes back to landing for a new player", () => {
    const s = run([{ type: "submit", username: "alice" }, { type: "done" }, { type: "restart" }]);
    expect(s).toEqual(initialFlow);
  });

  it("submitting a different player after a profile re-locks later steps", () => {
    const s = run([{ type: "submit", username: "alice" }, { type: "done" }, { type: "chooseFocus", tag: "x" }, { type: "submit", username: "bob" }]);
    expect(s).toMatchObject({ step: "analyzing", username: "bob", focusTag: null });
    expect(canGo(s, "focus")).toBe(false);
  });
});
