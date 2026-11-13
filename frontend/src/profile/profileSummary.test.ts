import { describe, expect, it } from "vitest";
import { profileSummary, profileSummaryParts } from "./profileSummary";
import type { Profile, ProfilePattern } from "./types";

const lv = { slip: 0, tricky: 0, deep: 0, unrated: 0 };
const pat = (tag: string, count: number): ProfilePattern => ({ tag, count, lastSeen: null, levels: lv, kinds: { positional: 0, tactical: count } });
const base: Profile = {
  username: "alice",
  ratings: { blitz: { rating: 1650, games: 300, prog: 12 }, rapid: { rating: 1700, games: 40, prog: -5 } },
  analyzed: { games: 20, moves: 1800, from: "2026-01-01", to: "2026-02-01" },
  record: { white: { w: 5, d: 1, l: 4 }, black: { w: 4, d: 0, l: 6 } },
  phases: { opening: 2, middlegame: 6, endgame: 4 },
  kinds: { positional: 3, tactical: 9 },
  clock: { underThirtyShare: 0.1, mistakeRateUnder30: 3, mistakeRateOver30: 3 },
  grid: [],
  patterns: [pat("hanging_piece", 7), pat("missed_tactic", 1), pat("positional", 3)],
};
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean);

describe("profileSummary", () => {
  it("leads with the leak and its evidence, highlighted, in 3-4 sentences", () => {
    const p = profileSummaryParts(base);
    expect(p.before).toBe("Your recurring leak is ");
    expect(p.mark).toBe("hanging pieces");
    expect(p.after).toMatch(/^: in 7 of the 11 mistakes I found, a piece was left where it could be taken for free\./);
    const s = profileSummary(base);
    expect(sentences(s).length).toBeGreaterThanOrEqual(3);
    expect(sentences(s).length).toBeLessThanOrEqual(4);
  });

  it("does not recite the facts row and mentions one rating once", () => {
    const s = profileSummary(base);
    expect(s).not.toContain("20 games");
    expect(s).not.toMatch(/won|drawn|lost|moves in all/);
    expect(s.match(/1650/g)).toHaveLength(1);
    expect(s).not.toContain("1700");
    expect(s).toContain("blitz");
  });

  it("speaks of rates, not shares, and keeps 'slip' for the difficulty level", () => {
    const s = profileSummary(base);
    expect(s).toContain("Mistakes are most frequent in the middlegame and rarest in the opening.");
    expect(s).not.toMatch(/most of your mistakes/i);
    expect(s.toLowerCase()).not.toMatch(/\bslip/);
  });

  it("formats counts and uses no percentages or decimals", () => {
    const s = profileSummary({ ...base, patterns: [pat("positional", 1234), pat("hanging_piece", 10)] });
    expect(s).toContain("1,234 of the 1,244 mistakes");
    expect(s).not.toMatch(/%/);
    expect(s).not.toMatch(/\d\.\d/);
  });

  it("mentions the clock when it is a leak, and works without ratings", () => {
    const s = profileSummary({ ...base, ratings: null, clock: { underThirtyShare: 0.2, mistakeRateUnder30: 6, mistakeRateOver30: 2 } });
    expect(s).toContain("rise with under 30 seconds");
    expect(s).toMatch(/I'd start there\.$/);
    expect(s).not.toContain("null");
  });

  it("says so when no mistakes were found", () => {
    const p = profileSummaryParts({ ...base, patterns: [], kinds: { positional: 0, tactical: 0 }, phases: { opening: 0, middlegame: 0, endgame: 0 } });
    expect(p.mark).toBeNull();
    expect(p.before).toMatch(/no clear mistakes/i);
    expect(p.before).toContain("last 20 games");
  });
});
