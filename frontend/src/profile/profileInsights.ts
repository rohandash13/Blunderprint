import { patternLabel, sortPatterns } from "../coach/patternLabels";
import type { Profile, ProfilePattern } from "./types";

export interface Insight {
  id: string;
  /** Capitalised, for the screen. */
  text: string;
  /** One line of evidence in words (counts at most, never percentages). */
  note: string;
  /** Lower-case fragment that reads inside a sentence (summary, voice). */
  phrase: string;
}

export interface Insights {
  strengths: Insight[];
  leaks: Insight[];
}

const PHASES = ["opening", "middlegame", "endgame"] as const;
const CLOCK_RATIO = 1.5;
const MIN_PHASE_MOVES = 30;

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** Named patterns by size, "other" last. */
const ranked = (profile: Profile) => sortPatterns(profile.patterns).filter((p) => p.count > 0);

/** The pattern to start with: the largest named one, "other" last. */
export function recommendedPattern(profile: Profile): ProfilePattern | null {
  return sortPatterns(profile.patterns)[0] ?? null;
}

export const totalMarks = (profile: Profile) => profile.patterns.reduce((n, p) => n + p.count, 0);

function patternLeak(p: ProfilePattern, total: number, id: string, lead: string): Insight {
  const name = patternLabel(p.tag).name;
  return {
    id,
    text: `${lead}: ${name}`,
    note: `${p.count} of the ${plural(total, "mistake")} I found`,
    phrase: `${lead === "Most common" ? "the most common mistake is" : "next comes"} ${name.toLowerCase()}`,
  };
}

/**
 * Strengths and leaks in the order they matter. Phase claims are about rates (mistakes per move),
 * so they say "most frequent", never "most of your mistakes".
 */
export function profileInsights(profile: Profile): Insights {
  const strengths: Insight[] = [];
  const leaks: Insight[] = [];
  const total = totalMarks(profile);
  const marks = total + profile.kinds.positional + profile.kinds.tactical;
  if (marks === 0) return { strengths, leaks };

  // A phase counts only with a real sample: 30+ of the player's moves (when the backend says how many).
  const rates = PHASES.filter((ph) => (profile.phaseMoves ? profile.phaseMoves[ph] >= MIN_PHASE_MOVES : true)).map((ph) => ({ ph, rate: profile.phases[ph] }));
  const spread = rates.length >= 2;
  const low = spread ? rates.reduce((a, b) => (b.rate < a.rate ? b : a)) : null;
  const high = spread ? rates.reduce((a, b) => (b.rate > a.rate ? b : a)) : null;
  const differ = !!low && !!high && high.rate > low.rate;
  const over = (ph: string) => (profile.phaseMoves ? `, over ${plural(profile.phaseMoves[ph as keyof typeof profile.phaseMoves], `${ph} move`)}` : "");
  if (low && differ && (profile.phaseMoves || low.rate > 0)) {
    strengths.push({
      id: `phase:${low.ph}`,
      text: `Steadiest in the ${low.ph}`,
      note: `Fewest mistakes per move of any phase${over(low.ph)}`,
      phrase: `you're steadiest in the ${low.ph}`,
    });
  }

  const count = (tag: string) => profile.patterns.find((p) => p.tag === tag)?.count ?? 0;
  if (count("missed_tactic") <= 1 && count("other") <= 2) {
    const missed = count("missed_tactic");
    strengths.push({
      id: "tactics",
      text: "Rarely misses forcing wins",
      note: missed === 0 ? `No missed winning captures or checks in ${plural(profile.analyzed.games, "game")}` : `One missed winning capture or check in ${plural(profile.analyzed.games, "game")}`,
      phrase: "you rarely miss forcing wins",
    });
  }

  if (high && differ) {
    leaks.push({
      id: `phase:${high.ph}`,
      text: `Mistakes are most frequent in the ${high.ph}`,
      note: `More mistakes per move than in any other phase${over(high.ph)}`,
      phrase: `mistakes are most frequent in the ${high.ph}`,
    });
  }

  const named = ranked(profile).filter((p) => p.tag !== "other");
  if (named[0]) leaks.push(patternLeak(named[0], total, `pattern:${named[0].tag}`, "Most common"));

  const { mistakeRateUnder30: under, mistakeRateOver30: overRate } = profile.clock;
  if (under > 0 && under >= CLOCK_RATIO * overRate) {
    leaks.push({
      id: "clock",
      text: "Mistakes rise with under 30 seconds left",
      note: under >= 2 * overRate ? "Twice as many mistakes per move once the clock drops under 30 seconds" : "Clearly more mistakes per move once the clock drops under 30 seconds",
      phrase: "mistakes rise with under 30 seconds on the clock",
    });
  }

  if (named[1]) leaks.push(patternLeak(named[1], total, `pattern2:${named[1].tag}`, "Next most common"));
  return { strengths, leaks };
}

/**
 * The leaks to show beside the "Start with" card: the phase leak first, then the clock leak when it
 * applies, else the next pattern; never the pattern the card already names.
 */
export function leaksBeside(insights: Insights, startTag: string | null, max = 2): Insight[] {
  const usable = insights.leaks.filter((l) => l.id !== `pattern:${startTag}` && l.id !== `pattern2:${startTag}`);
  const pick = (pred: (l: Insight) => boolean) => usable.filter(pred);
  const ordered = [
    ...pick((l) => l.id.startsWith("phase:")),
    ...pick((l) => l.id === "clock"),
    ...pick((l) => l.id.startsWith("pattern:")),
    ...pick((l) => l.id.startsWith("pattern2:")),
  ];
  return ordered.slice(0, max);
}
