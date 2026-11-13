import { patternLabel } from "../coach/patternLabels";
import { profileInsights, recommendedPattern, totalMarks } from "./profileInsights";
import type { Profile } from "./types";

/** The perf with the most games: the rating the player is best known by. */
export function mainRating(profile: Profile): { perf: string; rating: number } | null {
  const entries = Object.entries(profile.ratings ?? {});
  if (entries.length === 0) return null;
  const [perf, r] = entries.reduce((a, b) => (b[1].games > a[1].games ? b : a));
  return { perf, rating: r.rating };
}

/** What the pattern looked like on the board, as a clause after "in N of the M mistakes I found, ...". */
const EVIDENCE: Record<string, string> = {
  positional: "a quiet move was best, with no capture or check, just the right plan",
  hanging_piece: "a piece was left where it could be taken for free",
  missed_tactic: "a capture or check that wins material was there",
  opening_error: "it came in the first 10 moves",
  endgame_technique: "it came with few pieces left",
  time_trouble: "the clock was under 30 seconds",
};

const fmt = (n: number) => n.toLocaleString("en-US");

export interface SummaryParts {
  before: string;
  /** The leak phrase, highlighted on screen. */
  mark: string | null;
  after: string;
}

/**
 * The coach's read of the player in three or four sentences: the leak first with its evidence in words,
 * then where mistakes cluster, what's working, and one rating mention. Counts and ratings only: no
 * percentages or decimals, so the same text is safe to speak. The facts row on screen carries the
 * games, moves and results, so they are not repeated here.
 */
export function profileSummaryParts(profile: Profile): SummaryParts {
  const total = totalMarks(profile);
  const { strengths, leaks } = profileInsights(profile);
  const top = recommendedPattern(profile);
  if (!top || total === 0 || (strengths.length === 0 && leaks.length === 0)) {
    const games = profile.analyzed.games;
    return { before: `I looked at your last ${fmt(games)} game${games === 1 ? "" : "s"} and found no clear mistakes, so there is nothing to drill yet.`, mark: null, after: "" };
  }

  const name = patternLabel(top.tag).name.toLowerCase();
  const evidence = EVIDENCE[top.tag];
  const lead = "Your recurring leak is ";
  const rest: string[] = [];
  rest.push(evidence ? `: in ${fmt(top.count)} of the ${fmt(total)} mistakes I found, ${evidence}.` : `: ${fmt(top.count)} of the ${fmt(total)} mistakes I found.`);

  const phase = leaks.find((l) => l.id.startsWith("phase:"));
  const steady = strengths.find((s) => s.id.startsWith("phase:"));
  const clock = leaks.find((l) => l.id === "clock");
  if (phase) {
    const where = phase.id.slice("phase:".length);
    let s = `Mistakes are most frequent in the ${where}`;
    if (steady) s += ` and rarest in the ${steady.id.slice("phase:".length)}`;
    s += clock ? `, and they rise with under 30 seconds on the clock.` : ".";
    rest.push(` ${s}`);
  } else if (clock) {
    rest.push(" Mistakes rise with under 30 seconds on the clock.");
  }

  const working = strengths.filter((s) => !s.id.startsWith("phase:") || !phase);
  if (working.length > 0) rest.push(` What's working: ${working.map((s) => s.phrase).join(" and ")}.`);

  const main = mainRating(profile);
  rest.push(main ? ` I'd start there; every position is judged against your ${main.perf} rating of ${main.rating}.` : " I'd start there.");
  return { before: lead, mark: name, after: rest.join("") };
}

/** Plain text of the summary, for the voice coach's get_profile. */
export function profileSummary(profile: Profile): string {
  const p = profileSummaryParts(profile);
  return `${p.before}${p.mark ?? ""}${p.after}`;
}
