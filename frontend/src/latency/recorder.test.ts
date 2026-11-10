import { describe, expect, it } from "vitest";
import { LatencyRecorder } from "./recorder";

describe("LatencyRecorder", () => {
  it("keeps only LatencyReport events and parses every *_latency field as seconds", () => {
    const r = new LatencyRecorder("gpt-4o-mini");
    r.record({ type: "ConversationText", role: "user", content: "hi" });
    r.record({ type: "LatencyReport", stt_latency: "0.21", total_latency: "0.93", tts_latency: "0.18", note: "x" });
    r.record({ type: "LatencyReport", total_latency: "not-a-number" });
    r.functionCall("get_report");
    const s = r.export();
    expect(s.model).toBe("gpt-4o-mini");
    expect(s.reports).toEqual([{ stt_latency: 0.21, total_latency: 0.93, tts_latency: 0.18 }, {}]);
    expect(s.functionCalls.map((f) => f.name)).toEqual(["get_report"]);
    expect(typeof s.startedAt).toBe("string");
  });
});
