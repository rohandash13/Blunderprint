import { describe, expect, it } from "vitest";
import { flowReducer, initialFlow, canGo, type FlowAction, type FlowState } from "./flow";

const run = (actions: FlowAction[], from: FlowState = initialFlow): FlowState => actions.reduce(flowReducer, from);
const analyzing = (name = "alice") => run([{ type: "submit", username: name }]);
const withRun = (name = "alice", runId = "r1") => run([{ type: "started", username: name, runId }], analyzing(name));
const profile = () => run([{ type: "done", username: "alice", runId: "r1" }], withRun());

describe("flow reducer", () => {
  it("starts on landing with everything locked", () => {
    expect(initialFlow.step).toBe("landing");
    expect(initialFlow.username).toBeNull();
    expect(canGo(initialFlow, "profile")).toBe(false);
  });

  it("landing -> analyzing -> profile -> focus -> drill", () => {
    let s = run([{ type: "submit", username: " Alice " }]);
    expect(s).toMatchObject({ step: "analyzing", username: "Alice", runId: null, error: null });
    s = run([{ type: "started", username: "Alice", runId: "r1" }], s);
    expect(s.runId).toBe("r1");
    s = run([{ type: "done", username: "Alice", runId: "r1" }], s);
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
    const base = analyzing();
    expect(run([{ type: "existing", username: "alice", status: { status: "DONE", runId: "r9", queuePosition: null } }], base)).toMatchObject({ step: "profile", runId: "r9" });
    expect(run([{ type: "existing", username: "alice", status: { status: "RUNNING", runId: "r9", queuePosition: 2 } }], base)).toMatchObject({ step: "analyzing", runId: "r9" });
    expect(run([{ type: "existing", username: "alice", status: { status: "none", runId: null, queuePosition: null } }], base)).toMatchObject({ step: "analyzing", runId: null });
  });

  it("goto only reaches unlocked steps", () => {
    const a = analyzing();
    expect(run([{ type: "goto", step: "profile" }], a)).toBe(a);
    expect(run([{ type: "goto", step: "drill" }], a)).toBe(a);
    const p = profile();
    expect(run([{ type: "goto", step: "drill" }], p)).toBe(p);
    const drill = run([{ type: "openPosition" }], p);
    expect(drill.step).toBe("drill");
    expect(run([{ type: "goto", step: "profile" }], drill).step).toBe("profile");
    expect(run([{ type: "goto", step: "drill" }], run([{ type: "goto", step: "profile" }], drill)).step).toBe("drill");
  });

  it("failure returns to landing with the message and clears unlocks", () => {
    const s = run([{ type: "failed", username: "alice", message: "No rated games found for alice" }], analyzing());
    expect(s).toMatchObject({ step: "landing", error: "No rated games found for alice" });
    expect(canGo(s, "profile")).toBe(false);
  });

  it("restart goes back to landing for a new player", () => {
    expect(run([{ type: "restart" }], profile())).toEqual(initialFlow);
  });

  it("submitting a different player after a profile re-locks later steps", () => {
    const s = run([{ type: "chooseFocus", tag: "x" }, { type: "submit", username: "bob" }], profile());
    expect(s).toMatchObject({ step: "analyzing", username: "bob", focusTag: null });
    expect(canGo(s, "focus")).toBe(false);
  });
});

describe("stale async results are ignored", () => {
  it("started / done / failed / existing for another player change nothing", () => {
    const s = withRun("bob", "r2");
    for (const a of [
      { type: "started", username: "alice", runId: "r1" },
      { type: "done", username: "alice", runId: "r1" },
      { type: "failed", username: "alice", message: "x" },
      { type: "existing", username: "alice", status: { status: "DONE", runId: "r1", queuePosition: null } },
    ] as FlowAction[]) {
      expect(flowReducer(s, a)).toBe(s);
    }
  });

  it("done for an old runId of the same player is ignored", () => {
    const s = withRun("alice", "r2");
    expect(flowReducer(s, { type: "done", username: "alice", runId: "r1" })).toBe(s);
    expect(flowReducer(s, { type: "done", username: "alice", runId: "r2" }).step).toBe("profile");
  });

  it("results outside the analyzing step are ignored", () => {
    const landing = initialFlow;
    expect(flowReducer(landing, { type: "started", username: "alice", runId: "r1" })).toBe(landing);
    expect(flowReducer(landing, { type: "failed", username: "alice", message: "x" })).toBe(landing);
    const p = profile();
    expect(flowReducer(p, { type: "failed", username: "alice", message: "late" })).toBe(p);
    expect(flowReducer(p, { type: "done", username: "alice", runId: "r1" })).toBe(p);
    expect(flowReducer(p, { type: "existing", username: "alice", status: { status: "RUNNING", runId: "r1", queuePosition: 1 } })).toBe(p);
  });
});
