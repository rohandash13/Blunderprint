import { patternLabel, sortPatterns } from "../coach/patternLabels";
import type { Pattern } from "../types";
import type { Profile, ProfilePattern } from "./types";

export interface Insight {
  id: string;
  /** Capitalised, for the screen. */
  text: string;
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

const asPattern = (p: ProfilePattern) => p as unknown as Pattern;

/** The pattern to start with: the largest named one, "other" last. */
export function recommendedPattern(profile: Profile): ProfilePattern | null {
  const sorted = sortPatterns(profile.patterns.map(asPattern)) as unknown as ProfilePattern[];
  return sorted[0] ?? null;
}

export function profileInsights(profile: Profile): Insights {
  const strengths: Insight[] = [];
  const leaks: Insight[] = [];
  const marks = profile.patterns.reduce((n, p) => n + p.count, 0) + profile.kinds.positional + profile.kinds.tactical;
  if (marks === 0) return { strengths, leaks };

  // A phase counts only with a real sample: 30+ of the player's moves (when the backend says how many).
  const rates = PHASES.filter((ph) => (profile.phaseMoves ? profile.phaseMoves[ph] >= MIN_PHASE_MOVES : true)).map((ph) => ({ ph, rate: profile.phases[ph] }));
  const spread = rates.length >= 2;
  const low = spread ? rates.reduce((a, b) => (b.rate < a.rate ? b : a)) : null;
  const high = spread ? rates.reduce((a, b) => (b.rate > a.rate ? b : a)) : null;
  const differ = !!low && !!high && high.rate > low.rate;
  if (low && differ && (profile.phaseMoves || low.rate > 0)) {
    strengths.push({ id: `phase:${low.ph}`, text: `Steadiest in the ${low.ph}`, phrase: `you're steadiest in the ${low.ph}` });
  }

  const count = (tag: string) => profile.patterns.find((p) => p.tag === tag)?.count ?? 0;
  if (count("missed_tactic") <= 1 && count("other") <= 2) {
    strengths.push({ id: "tactics", text: "Rarely misses forcing wins", phrase: "you rarely miss forcing wins" });
  }

  if (high && differ) {
    leaks.push({ id: `phase:${high.ph}`, text: `You slip most often in the ${high.ph}`, phrase: `you slip most often in the ${high.ph}` });
  }

  const top = (sortPatterns(profile.patterns.map(asPattern)) as unknown as ProfilePattern[]).find((p) => p.tag !== "other" && p.count > 0);
  if (top) {
    const name = patternLabel(top.tag).name;
    leaks.push({ id: `pattern:${top.tag}`, text: `Most common: ${name}`, phrase: `the most common mistake is ${name.toLowerCase()}` });
  }

  const { mistakeRateUnder30: under, mistakeRateOver30: over } = profile.clock;
  if (under > 0 && under >= CLOCK_RATIO * over) {
    leaks.push({ id: "clock", text: "Mistakes rise with under 30 seconds left", phrase: "you slip more with under 30 seconds on the clock" });
  }

  return { strengths, leaks };
}
