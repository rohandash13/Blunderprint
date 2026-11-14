import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, KEYTERMS, buildSettings } from "./settings";

describe("buildSettings", () => {
  const s = buildSettings(DEFAULT_CONFIG, "alice") as any;
  it("leaves legality to code and narrates verified UI moves without replaying them", () => {
    expect(s.agent.think.prompt).toContain("Never reject a move without calling play_move");
    expect(s.agent.think.prompt).toContain("appNarrated true");
    expect(s.agent.think.prompt).toContain("weaknesses");
  });

  it("uses linear16 at 24 kHz both ways", () => {
    expect(s.type).toBe("Settings");
    expect(s.audio.input).toEqual({ encoding: "linear16", sample_rate: 24000 });
    expect(s.audio.output).toEqual({ encoding: "linear16", sample_rate: 24000, container: "none" });
  });

  it("configures nova-3 with chess keyterms, the think model, and an Aura voice", () => {
    expect(s.agent.listen.provider).toEqual({ type: "deepgram", model: "nova-3", keyterms: KEYTERMS });
    expect(KEYTERMS).toContain("knight");
    for (const k of ["hint", "reveal", "reset"]) expect(KEYTERMS).toContain(k);
    expect(s.agent.think.provider).toEqual({ type: "open_ai", model: "gpt-4o-mini" });
    expect(s.agent.speak.provider).toEqual({ type: "deepgram", version: "v1", model: "aura-2-thalia-en" });
    expect("language" in s.agent.speak.provider).toBe(false);
  });

  it("declares the coach functions and names the player in the prompt", () => {
    expect(s.agent.think.functions.map((f: { name: string }) => f.name)).toEqual([
      "review_attempt",
      "retry_position",
      "start_clock",
      "untimed_practice",
      "get_profile",
      "get_report",
      "show_mistake",
      "start_drill",
      "play_move",
      "get_hint",
      "reveal_answer",
      "explain_line",
      "try_move",
      "reset_position",
      "set_levels",
      "step_line",
      "next_move",
    ]);
    expect(s.agent.think.prompt).toContain("alice");
    for (const w of [
      "play_move",
      "get_hint",
      "explain_line",
      "try_move",
      "spoken",
      "uncategorized mistakes",
      "attacks two pieces",
      "set_levels",
      "step_line",
      "get_profile",
      "next_move",
    ]) {
      expect(s.agent.think.prompt).toContain(w);
    }
    expect(s.agent.think.prompt).not.toContain("harderThanPercent");
    expect(s.agent.think.prompt).toContain("difficultyNote");
    expect(s.agent.think.prompt).toContain("never percentages or ratings");
    expect(s.agent.think.prompt).toContain("alternate positional and tactical");
    expect(s.agent.think.prompt).toContain("Only drill or show patterns where drillable is true");
    expect(s.agent.think.prompt).toContain("time_trouble is a timed decision drill");
    expect(s.agent.think.prompt).toContain("A greeting alone is not a request for a profile overview");
    expect(s.agent.think.prompt).toContain("two to three sentence overview");
    expect(s.agent.think.prompt).toContain("offer focus choices");
    expect(s.agent.think.prompt).toContain("Never chain next_move calls");
    expect(s.agent.think.prompt).toContain("never silently fast-forward");
    expect(s.agent.think.prompt).not.toContain("engineLine");
    expect(typeof s.agent.greeting).toBe("string");
  });

  it("honors a different model", () => {
    const c = buildSettings({ ...DEFAULT_CONFIG, thinkProvider: "anthropic", thinkModel: "claude-haiku-5-5" }, "bob") as any;
    expect(c.agent.think.provider).toEqual({ type: "anthropic", model: "claude-haiku-5-5" });
  });
  it("resumes supplied history without a greeting and supports silent text connections", () => {
    const resumed = buildSettings(DEFAULT_CONFIG, "alice", {
      history: [
        { role: "user", content: "Time trouble?" },
        { role: "coach", content: "Let's practice that." },
      ],
      note: "time_trouble ready",
    }) as any;
    expect(resumed.agent.greeting).toBeUndefined();
    expect(resumed.agent.context.messages).toEqual([
      { type: "History", role: "user", content: "Time trouble?" },
      { type: "History", role: "assistant", content: "Let's practice that." },
    ]);
    expect(resumed.agent.think.prompt).toContain("Do not greet");
    expect((buildSettings(DEFAULT_CONFIG, "alice", { silent: true }) as any).agent.greeting).toBeUndefined();
  });
});
