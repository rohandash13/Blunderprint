import { patternLabel, sortPatterns } from "../coach/patternLabels";
import type { GridGame, GridMark, Profile, ProfilePattern } from "../profile/types";
import type { Level } from "../types";

export type MarkSize = "s" | "m" | "l";
export type PickLevel = Exclude<Level, "unrated">;
export const PICK_LEVELS: PickLevel[] = ["slip", "tricky", "deep"];

/** Win-chance drop is 0..1; tolerate a percentage just in case. */
const asShare = (winDrop: number) => (winDrop > 1 ? winDrop / 100 : Math.max(0, winDrop || 0));

/** Dot size by cost: under a tenth of the winning chances is small, a fifth or more is large. */
export function markSize(winDrop: number): MarkSize {
  const w = asShare(winDrop);
  if (w >= 0.2) return "l";
  if (w >= 0.1) return "m";
  return "s";
}

/** Unrated marks have no level to filter by, so they always stay on the sheet. */
export const markVisible = (m: GridMark, levels: Level[]) => m.level === "unrated" || levels.includes(m.level);

export interface GridCell {
  /** Column index into the games, oldest first. */
  col: number;
  game: GridGame;
  /** Costliest first; the first one is drawn and opened. */
  marks: GridMark[];
}

export interface GridRow {
  tag: string;
  name: string;
  description: string;
  lastSeen: string | null;
  /** All marks of this pattern in the analyzed games. */
  count: number;
  /** Marks shown under the current levels. */
  visible: number;
  cells: GridCell[];
}

export interface GridLayout {
  games: GridGame[];
  rows: GridRow[];
  /** The named row with the most visible marks: highlighted. */
  worst: string | null;
  levelCounts: Record<Level, number>;
}

export function buildGrid(profile: Profile, levels: Level[]): GridLayout {
  const games = profile.grid;
  const levelCounts: Record<Level, number> = { slip: 0, tricky: 0, deep: 0, unrated: 0 };
  const byTag = new Map<string, Map<number, GridMark[]>>();
  games.forEach((g, col) => {
    for (const m of g.marks) {
      levelCounts[m.level] = (levelCounts[m.level] ?? 0) + 1;
      if (!markVisible(m, levels)) continue;
      const cols = byTag.get(m.pattern) ?? new Map<number, GridMark[]>();
      byTag.set(m.pattern, cols);
      cols.set(col, [...(cols.get(col) ?? []), m]);
    }
  });

  const known = new Map<string, ProfilePattern>(profile.patterns.map((p) => [p.tag, p]));
  for (const g of games) {
    for (const m of g.marks) {
      if (!known.has(m.pattern)) {
        known.set(m.pattern, { tag: m.pattern, count: 0, lastSeen: null, levels: { slip: 0, tricky: 0, deep: 0, unrated: 0 }, kinds: { positional: 0, tactical: 0 } });
      }
    }
  }
  const markCount = (tag: string) => games.reduce((n, g) => n + g.marks.filter((m) => m.pattern === tag).length, 0);
  const listed = [...known.values()].map((p) => ({ ...p, count: Math.max(p.count, markCount(p.tag)) })).filter((p) => p.count > 0);
  const ordered = sortPatterns(listed);

  const rows: GridRow[] = ordered.map((p) => {
    const cols = byTag.get(p.tag) ?? new Map<number, GridMark[]>();
    const cells = [...cols.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([col, marks]) => ({ col, game: games[col], marks: [...marks].sort((a, b) => asShare(b.winDrop) - asShare(a.winDrop)) }));
    const label = patternLabel(p.tag);
    return { tag: p.tag, name: label.name, description: label.description, lastSeen: p.lastSeen, count: p.count, visible: cells.reduce((n, c) => n + c.marks.length, 0), cells };
  });

  let worst: GridRow | null = null;
  for (const r of rows) {
    if (r.tag === "other" || r.visible === 0) continue;
    if (!worst || r.visible > worst.visible || (r.visible === worst.visible && r.count > worst.count)) worst = r;
  }
  return { games, rows, worst: worst?.tag ?? null, levelCounts };
}

/** Crosstable score from the player's side. */
export const resultMark = (r: GridGame["result"]) => (r === "w" ? "1" : r === "d" ? "½" : "0");

const RESULT_WORD = { w: "won", d: "drawn", l: "lost" } as const;
const LEVEL_WORD: Record<Level, string> = { slip: "slip", tricky: "tricky", deep: "deep", unrated: "unrated" };
const SIZE_WORD: Record<MarkSize, string> = { s: "small cost", m: "costly", l: "very costly" };

/** Move number from a ply index (ply 0 is White's first move). */
export const moveNumberOf = (ply: number) => Math.floor(ply / 2) + 1;

/** One line naming a mark, for its accessible label and the grid readout. */
export function describeMark(rowName: string, cell: GridCell): string {
  const m = cell.marks[0];
  const more = cell.marks.length > 1 ? `, ${cell.marks.length - 1} more in this game` : "";
  return `${rowName}: game ${cell.col + 1}, as ${cell.game.color === "white" ? "White" : "Black"}, ${RESULT_WORD[cell.game.result]}; move ${moveNumberOf(m.ply)}, ${LEVEL_WORD[m.level]}, ${SIZE_WORD[markSize(m.winDrop)]}${more}`;
}
