import { describe, expect, it } from "vitest";
import { leaksBeside, profileInsights, recommendedPattern } from "./profileInsights";
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
    expect(ids(profileInsights(profile({ patterns: [pat("hanging_piece", 7), pat("missed_tactic", 1), pat("other", 2)] })).strengths)).toContain("tactics");
    expect(ids(profileInsights(profile()).strengths)).not.toContain("tactics"); // 9 uncategorized tactical errors
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

describe("phase wording and sample size", () => {
  it("speaks of rates, never of a share of mistakes, and keeps 'slip' for the difficulty level", () => {
    const leak = profileInsights(profile()).leaks.find((l) => l.id === "phase:middlegame")!;
    expect(leak.text).toBe("Mistakes are most frequent in the middlegame");
    expect(leak.phrase).toBe("mistakes are most frequent in the middlegame");
    const all = JSON.stringify(profileInsights(profile()));
    expect(all).not.toContain("most of your mistakes");
    expect(all.toLowerCase()).not.toMatch(/\bslip/);
  });

  it("ignores phases with fewer than 30 of the player's moves", () => {
    const r = profileInsights(profile({ phaseMoves: { opening: 200, middlegame: 20, endgame: 150 } }));
    const phaseIds = ids([...r.strengths, ...r.leaks]).filter((i) => i.startsWith("phase:"));
    expect(phaseIds).toEqual(["phase:opening", "phase:endgame"]); // middlegame (highest rate) is excluded
    expect(r.leaks.map((l) => l.id)).toContain("phase:endgame");
    const one = profileInsights(profile({ phaseMoves: { opening: 200, middlegame: 10, endgame: 10 } }));
    expect(ids([...one.strengths, ...one.leaks]).some((i) => i.startsWith("phase:"))).toBe(false);
  });

  it("without phaseMoves a zero-rate phase is not called a strength", () => {
    const r = profileInsights(profile({ phases: { opening: 0, middlegame: 6, endgame: 4 } }));
    expect(ids(r.strengths)).not.toContain("phase:opening");
    const withMoves = profileInsights(profile({ phases: { opening: 0, middlegame: 6, endgame: 4 }, phaseMoves: { opening: 100, middlegame: 100, endgame: 100 } }));
    expect(ids(withMoves.strengths)).toContain("phase:opening");
  });
});

describe("evidence notes", () => {
  it("every insight carries a one-line note in words, no percentages", () => {
    const r = profileInsights(profile({ phaseMoves: { opening: 300, middlegame: 400, endgame: 100 }, clock: { underThirtyShare: 0.2, mistakeRateUnder30: 6, mistakeRateOver30: 2 } }));
    for (const i of [...r.strengths, ...r.leaks]) {
      expect(i.note.length).toBeGreaterThan(10);
      expect(i.note).not.toMatch(/%|\d\.\d/);
    }
    expect(r.leaks.find((l) => l.id === "phase:middlegame")!.note).toBe("More mistakes per move than in any other phase, over 400 middlegame moves");
    expect(r.leaks.find((l) => l.id === "pattern:hanging_piece")!.note).toBe("7 of the 20 mistakes I found");
    expect(r.leaks.find((l) => l.id === "clock")!.note).toMatch(/^Twice as many/);
  });
});

describe("leaksBeside", () => {
  it("never repeats the start pattern: phase, then clock, else the next pattern", () => {
    const withClock = profileInsights(profile({ clock: { underThirtyShare: 0.2, mistakeRateUnder30: 6, mistakeRateOver30: 2 } }));
    expect(ids(leaksBeside(withClock, "hanging_piece"))).toEqual(["phase:middlegame", "clock"]);
    const noClock = profileInsights(profile());
    expect(ids(leaksBeside(noClock, "hanging_piece"))).toEqual(["phase:middlegame", "pattern2:positional"]);
    expect(ids(leaksBeside(noClock, "positional"))).toEqual(["phase:middlegame", "pattern:hanging_piece"]);
  });
});
