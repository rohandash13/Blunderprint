import { describe, expect, it } from "vitest";
import { profileInsights, recommendedPattern } from "./profileInsights";
import type { Profile, ProfilePattern } from "./types";

const lv = { slip: 0, tricky: 0, deep: 0, unrated: 0 };
const pat = (tag: string, count: number): ProfilePattern => ({ tag, count, lastSeen: null, levels: lv, kinds: { positional: 0, tactical: count } });

function profile(over: Partial<Profile> = {}): Profile {
  return {
    username: "alice",
    ratings: null,
    analyzed: { games: 20, moves: 800, from: "2026-01-01", to: "2026-02-01" },
    record: { white: { w: 5, d: 1, l: 4 }, black: { w: 4, d: 0, l: 6 } },
    phases: { opening: 2, middlegame: 6, endgame: 4 },
    kinds: { positional: 3, tactical: 9 },
    clock: { underThirtyShare: 0.1, mistakeRateUnder30: 3, mistakeRateOver30: 3 },
    grid: [],
    patterns: [pat("hanging_piece", 7), pat("missed_tactic", 1), pat("positional", 3), pat("other", 9)],
    ...over,
  };
}

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("profileInsights", () => {
  it("lowest-rate phase is a strength; highest-rate phase and top pattern are leaks", () => {
    const r = profileInsights(profile());
    expect(ids(r.strengths)).toContain("phase:opening");
    expect(ids(r.leaks)).toEqual(expect.arrayContaining(["phase:middlegame", "pattern:hanging_piece"]));
  });

  it("zero or one missed-tactic marks is 'rarely misses forcing wins'", () => {
    expect(ids(profileInsights(profile()).strengths)).toContain("tactics");
    expect(ids(profileInsights(profile({ patterns: [pat("hanging_piece", 5)] })).strengths)).toContain("tactics");
    expect(ids(profileInsights(profile({ patterns: [pat("hanging_piece", 5), pat("missed_tactic", 2)] })).strengths)).not.toContain("tactics");
  });

  it("clock leak needs the under-30 rate at least 1.5x the over-30 rate", () => {
    const at = (u: number, o: number) => ids(profileInsights(profile({ clock: { underThirtyShare: 0.2, mistakeRateUnder30: u, mistakeRateOver30: o } })).leaks);
    expect(at(6, 4)).toContain("clock");
    expect(at(5, 4)).not.toContain("clock");
    expect(at(3, 0)).toContain("clock");
    expect(at(0, 0)).not.toContain("clock");
  });

  it("flat phases give no phase insight; no candidates gives nothing", () => {
    const flat = profileInsights(profile({ phases: { opening: 4, middlegame: 4, endgame: 4 } }));
    expect(ids([...flat.strengths, ...flat.leaks]).some((i) => i.startsWith("phase:"))).toBe(false);
    const none = profileInsights(profile({ patterns: [], kinds: { positional: 0, tactical: 0 }, phases: { opening: 0, middlegame: 0, endgame: 0 } }));
    expect(none).toEqual({ strengths: [], leaks: [] });
  });

  it("an uncategorized top pattern is not named as a leak", () => {
    const r = profileInsights(profile({ patterns: [pat("other", 10), pat("positional", 2)] }));
    expect(ids(r.leaks)).toContain("pattern:positional");
    expect(ids(r.leaks)).not.toContain("pattern:other");
  });
});

describe("recommendedPattern", () => {
  it("is the largest named pattern, other last, null when empty", () => {
    expect(recommendedPattern(profile())?.tag).toBe("hanging_piece");
    expect(recommendedPattern(profile({ patterns: [pat("other", 4)] }))?.tag).toBe("other");
    expect(recommendedPattern(profile({ patterns: [] }))).toBeNull();
  });
});
