import { describe, expect, it } from "vitest";
import { profileSummary } from "./profileSummary";
import type { Profile, ProfilePattern } from "./types";

const lv = { slip: 0, tricky: 0, deep: 0, unrated: 0 };
const pat = (tag: string, count: number): ProfilePattern => ({ tag, count, lastSeen: null, levels: lv, kinds: { positional: 0, tactical: count } });
const base: Profile = {
  username: "alice",
  ratings: { blitz: { rating: 1650, games: 300, prog: 12 }, rapid: { rating: 1700, games: 40, prog: -5 } },
  analyzed: { games: 20, moves: 800, from: "2026-01-01", to: "2026-02-01" },
  record: { white: { w: 5, d: 1, l: 4 }, black: { w: 4, d: 0, l: 6 } },
  phases: { opening: 2, middlegame: 6, endgame: 4 },
  kinds: { positional: 3, tactical: 9 },
  clock: { underThirtyShare: 0.1, mistakeRateUnder30: 3, mistakeRateOver30: 3 },
  grid: [],
  patterns: [pat("hanging_piece", 7), pat("missed_tactic", 1), pat("positional", 3)],
};
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean);

describe("profileSummary", () => {
  it("is 3-4 sentences mentioning games, the main rating and the top pattern by name", () => {
    const s = profileSummary(base);
    expect(sentences(s).length).toBeGreaterThanOrEqual(3);
    expect(sentences(s).length).toBeLessThanOrEqual(4);
    expect(s).toContain("20 games");
    expect(s).toContain("1650");
    expect(s).toContain("blitz");
    expect(s.toLowerCase()).toContain("hanging pieces");
  });

  it("uses no percentages or decimals", () => {
    const s = profileSummary(base);
    expect(s).not.toMatch(/%/);
    expect(s).not.toMatch(/\d\.\d/);
  });

  it("works without ratings", () => {
    const s = profileSummary({ ...base, ratings: null });
    expect(s).toContain("20 games");
    expect(s).not.toContain("null");
  });

  it("says so when no mistakes were found", () => {
    const s = profileSummary({ ...base, patterns: [], kinds: { positional: 0, tactical: 0 }, phases: { opening: 0, middlegame: 0, endgame: 0 } });
    expect(s).toMatch(/no clear mistakes/i);
    expect(sentences(s).length).toBeLessThanOrEqual(4);
  });
});

describe("plurals", () => {
  it("says 1 game and 1 move", () => {
    const s = profileSummary({ ...base, analyzed: { games: 1, moves: 1, from: null, to: null } });
    expect(s).toContain("1 game, 1 move in all");
  });
});
