import { describe, expect, it } from "vitest";
import { buildGrid, describeMark, markSize, markVisible, moveNumberOf, resultMark } from "./gridLayout";
import { dateRange, describeEta, estimateRemaining, formatDate, ratingChips, shortDate, signed } from "./format";
import { describeResult } from "./coachText";
import { roundUpToCell } from "./useSnapHeight";
import type { GridGame, GridMark, Profile } from "../profile/types";

const mark = (pattern: string, level: GridMark["level"], winDrop = 0.12, ply = 30): GridMark => ({
  ply,
  pattern,
  level,
  kind: "tactical",
  winDrop,
});
const game = (id: string, marks: GridMark[], result: GridGame["result"] = "w", color: GridGame["color"] = "white"): GridGame => ({
  gameId: id,
  playedAt: "2026-10-01T10:00:00Z",
  color,
  result,
  marks,
});
const lv = { slip: 0, tricky: 0, deep: 0, unrated: 0 };

function profile(grid: GridGame[], patterns: Profile["patterns"] = []): Profile {
  return {
    username: "alice",
    ratings: null,
    analyzed: { games: grid.length, moves: 100, from: null, to: null },
    record: { white: { w: 0, d: 0, l: 0 }, black: { w: 0, d: 0, l: 0 } },
    phases: { opening: 0, middlegame: 0, endgame: 0 },
    kinds: { positional: 0, tactical: 0 },
    clock: { underThirtyShare: 0, mistakeRateUnder30: 0, mistakeRateOver30: 0 },
    grid,
    patterns,
  };
}

describe("markSize", () => {
  it("buckets win-chance drop into three dot sizes", () => {
    expect(markSize(0.02)).toBe("s");
    expect(markSize(0.1)).toBe("m");
    expect(markSize(0.19)).toBe("m");
    expect(markSize(0.2)).toBe("l");
    expect(markSize(0.9)).toBe("l");
  });
  it("tolerates percentages and junk", () => {
    expect(markSize(30)).toBe("l");
    expect(markSize(Number.NaN)).toBe("s");
    expect(markSize(-1)).toBe("s");
  });
});

describe("buildGrid", () => {
  const grid = [
    game("g1", [mark("positional", "tricky", 0.3), mark("positional", "slip", 0.05), mark("hanging_piece", "deep")]),
    game("g2", [mark("hanging_piece", "slip"), mark("other", "tricky")], "l", "black"),
    game("g3", [mark("positional", "deep"), mark("time_trouble", "unrated")], "d"),
  ];
  const pats = [
    { tag: "positional", count: 3, lastSeen: null, levels: lv, kinds: { positional: 3, tactical: 0 } },
    { tag: "hanging_piece", count: 2, lastSeen: null, levels: lv, kinds: { positional: 0, tactical: 2 } },
    { tag: "other", count: 1, lastSeen: null, levels: lv, kinds: { positional: 0, tactical: 1 } },
  ];

  it("orders rows by count with other last and adds patterns only seen in marks", () => {
    const g = buildGrid(profile(grid, pats), ["slip", "tricky", "deep"]);
    expect(g.rows.map((r) => r.tag)).toEqual(["positional", "hanging_piece", "time_trouble", "other"]);
  });

  it("filters marks by level, keeps unrated ones, and re-picks the worst row", () => {
    const all = buildGrid(profile(grid, pats), ["slip", "tricky", "deep"]);
    expect(all.worst).toBe("positional");
    const deep = buildGrid(profile(grid, pats), ["deep"]);
    const row = (t: string) => deep.rows.find((r) => r.tag === t)!;
    expect(row("positional").visible).toBe(1);
    expect(row("hanging_piece").visible).toBe(1);
    expect(row("time_trouble").visible).toBe(1);
    expect(row("other").visible).toBe(0);
    // tie on visible marks goes to the larger pattern
    expect(deep.worst).toBe("positional");
    const slips = buildGrid(profile([...grid, game("g4", [mark("hanging_piece", "slip")])], pats), ["slip"]);
    expect(slips.worst).toBe("hanging_piece");
  });

  it("puts several marks in one game into one cell, costliest first", () => {
    const g = buildGrid(profile(grid, pats), ["slip", "tricky", "deep"]);
    const cell = g.rows[0].cells[0];
    expect(cell.col).toBe(0);
    expect(cell.marks.map((m) => m.level)).toEqual(["tricky", "slip"]);
    expect(describeMark("Positional decisions", cell)).toBe(
      "Positional decisions: game 1, as White, won; move 16, tricky, very costly, 1 more in this game",
    );
  });

  it("counts every level regardless of the filter", () => {
    expect(buildGrid(profile(grid, pats), ["deep"]).levelCounts).toEqual({ slip: 2, tricky: 2, deep: 2, unrated: 1 });
  });

  it("has no worst row when nothing named is visible", () => {
    expect(buildGrid(profile([game("g", [mark("other", "deep")])]), ["deep"]).worst).toBeNull();
    expect(buildGrid(profile([]), ["deep"]).rows).toEqual([]);
  });

  it("markVisible, resultMark, moveNumberOf", () => {
    expect(markVisible(mark("x", "unrated"), ["deep"])).toBe(true);
    expect(markVisible(mark("x", "slip"), ["deep"])).toBe(false);
    expect([resultMark("w"), resultMark("d"), resultMark("l")]).toEqual(["1", "½", "0"]);
    expect([moveNumberOf(0), moveNumberOf(1), moveNumberOf(19), moveNumberOf(20)]).toEqual([1, 1, 10, 11]);
  });
});

describe("format", () => {
  it("rating chips keep standard perfs with games, fastest first", () => {
    const chips = ratingChips({
      rapid: { rating: 2478, games: 40, prog: 3 },
      blitz: { rating: 2508, games: 900, prog: -10 },
      puzzle: { rating: 2900, games: 50, prog: 0 },
      bullet: { rating: 2300, games: 0, prog: 0 },
    });
    expect(chips.map((c) => c.label)).toEqual(["Blitz", "Rapid"]);
    expect(ratingChips(null)).toEqual([]);
    // a perf with a few games is dropped next to real ones, kept when it is all there is
    expect(
      ratingChips({ bullet: { rating: 1758, games: 1, prog: 0 }, blitz: { rating: 2508, games: 389, prog: 10 } }).map((c) => c.label),
    ).toEqual(["Blitz"]);
    expect(ratingChips({ bullet: { rating: 1758, games: 1, prog: 0 } }).map((c) => c.label)).toEqual(["Bullet"]);
  });
  it("signed uses a true minus", () => {
    expect([signed(12), signed(-3), signed(0), signed(0.4)]).toEqual(["+12", "−3", "0", "0"]);
  });
  it("dates", () => {
    expect(formatDate("2026-03-12T08:00:00Z")).toBe("12 Mar 2026");
    expect(formatDate(null)).toBe("—");
    expect(shortDate("2026-11-10T20:10:21Z")).toBe("10 Nov");
    expect(dateRange("2026-03-02", "2026-11-10")).toBe("2 Mar – 10 Nov 2026");
    expect(dateRange("2025-12-02", "2026-11-10")).toBe("2 Dec 2025 – 10 Nov 2026");
    expect(dateRange(null, "2026-11-10")).toBeNull();
  });
  it("estimates time left from the recent rate", () => {
    expect(estimateRemaining([{ t: 0, done: 0 }], 100)).toBeNull();
    expect(
      estimateRemaining(
        [
          { t: 0, done: 10 },
          { t: 10_000, done: 10 },
        ],
        100,
      ),
    ).toBeNull();
    expect(
      estimateRemaining(
        [
          { t: 0, done: 0 },
          { t: 10_000, done: 20 },
        ],
        100,
      ),
    ).toBe(40);
    // only the recent window counts
    expect(
      estimateRemaining(
        [
          { t: 0, done: 0 },
          { t: 200_000, done: 10 },
          { t: 210_000, done: 30 },
        ],
        130,
        60_000,
      ),
    ).toBe(50);
    expect(describeEta(null)).toMatch(/Working out/);
    expect(describeEta(30)).toBe("Less than a minute left");
    expect(describeEta(80)).toBe("About a minute left");
    expect(describeEta(600)).toBe("About 10 minutes left");
  });
});

describe("describeResult", () => {
  it("play_move verdicts", () => {
    expect(describeResult("play_move", { verdict: "best", spoken: "knight to f3", next: { ply: 1 } })).toBe(
      "Knight to f3: that's the best move. Press Next to see the reply.",
    );
    expect(describeResult("play_move", { verdict: "repeated_mistake", spoken: "queen takes b7", next: null })).toBe(
      "Queen takes b7: that's the mistake from your game. Try another move, or choose See why.",
    );
    expect(describeResult("play_move", { verdict: "other", spoken: "pawn to e4" })).toBe(
      "Pawn to e4: there's a stronger move here. Try again, or choose See why.",
    );
    expect(describeResult("play_move", { verdict: "illegal", reason: 'No single legal move matches "Zz9"' })).toBe(
      'No single legal move matches "Zz9".',
    );
  });
  it("next_move caption, with the eval on the last ply", () => {
    expect(describeResult("next_move", { caption: "Black takes on d5 with the knight", done: false })).toBe(
      "Black takes on d5 with the knight. This is the engine's recommended continuation; there is no immediate capture or check. Say next when you're ready to continue.",
    );
    expect(describeResult("next_move", { caption: "White castles kingside", done: true, evalSpoken: "you're a pawn up" })).toBe(
      "White castles kingside. This is the engine's recommended continuation; there is no immediate capture or check. You're a pawn up. Say next when you're ready to continue.",
    );
  });
  it("hints, reveal, errors, unknown", () => {
    expect(describeResult("get_hint", { hint: "Look at checks.", level: 1 })).toBe("Hint 1 of 3: Look at checks.");
    expect(describeResult("get_hint", { hint: null, message: "No hints left. Offer to reveal the answer." })).toBe(
      "No hints left. Offer to reveal the answer.",
    );
    expect(describeResult("reveal_answer", { bestSpoken: "rook to e8", gameMoveSpoken: "king to h1" })).toBe(
      "The best move was rook to e8. In the game you played king to h1.",
    );
    expect(describeResult("next_move", { error: "There is no line to continue." })).toBe("There is no line to continue.");
    expect(describeResult("start_drill", { error: 'pattern "positional" has no examples' })).toBe(
      "No positions for this pattern at this difficulty. Turn on another level.",
    );
    expect(describeResult("start_drill", { status: "Position ready, White to move", difficultyNote: "a tactic a few moves deep" })).toBe(
      "Position ready, White to move.",
    );
    expect(describeResult("step_line", { ply: 1, total: 2 })).toContain("position you requested");
    expect(describeResult("x", null)).toBeNull();
  });
});

describe("roundUpToCell", () => {
  it("rounds a height up to whole cells, tolerating sub-pixel noise", () => {
    expect([
      roundUpToCell(0),
      roundUpToCell(1),
      roundUpToCell(24),
      roundUpToCell(24.004),
      roundUpToCell(131.5),
      roundUpToCell(144),
    ]).toEqual([0, 24, 24, 24, 144, 144]);
  });
});
