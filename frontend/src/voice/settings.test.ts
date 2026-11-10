import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, KEYTERMS, buildSettings } from "./settings";

describe("buildSettings", () => {
  const s = buildSettings(DEFAULT_CONFIG, "alice") as any;

  it("uses linear16 at 24 kHz both ways", () => {
    expect(s.type).toBe("Settings");
    expect(s.audio.input).toEqual({ encoding: "linear16", sample_rate: 24000 });
    expect(s.audio.output).toEqual({ encoding: "linear16", sample_rate: 24000, container: "none" });
  });

  it("configures nova-3 with chess keyterms, the think model, and an Aura voice", () => {
    expect(s.agent.listen.provider).toEqual({ type: "deepgram", model: "nova-3", keyterms: KEYTERMS });
    expect(KEYTERMS).toContain("knight");
    expect(s.agent.think.provider).toEqual({ type: "open_ai", model: "gpt-4o-mini" });
    expect(s.agent.speak.provider).toEqual({ type: "deepgram", version: "v1", model: "aura-2-thalia-en" });
    expect("language" in s.agent.speak.provider).toBe(false);
  });

  it("declares the coach functions and names the player in the prompt", () => {
    expect(s.agent.think.functions.map((f: { name: string }) => f.name)).toEqual(["get_report", "show_mistake", "start_drill", "play_move"]);
    expect(s.agent.think.prompt).toContain("alice");
    expect(s.agent.think.prompt).toContain("play_move");
    expect(typeof s.agent.greeting).toBe("string");
  });

  it("honors a different model", () => {
    const c = buildSettings({ ...DEFAULT_CONFIG, thinkProvider: "anthropic", thinkModel: "claude-haiku-5-5" }, "bob") as any;
    expect(c.agent.think.provider).toEqual({ type: "anthropic", model: "claude-haiku-5-5" });
  });
});
