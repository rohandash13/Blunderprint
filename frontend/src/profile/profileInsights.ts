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

  const rates = PHASES.map((ph) => ({ ph, rate: profile.phases[ph] }));
  const low = rates.reduce((a, b) => (b.rate < a.rate ? b : a));
  const high = rates.reduce((a, b) => (b.rate > a.rate ? b : a));
  if (high.rate > low.rate) {
    strengths.push({ id: `phase:${low.ph}`, text: `Steadiest in the ${low.ph}`, phrase: `you're steadiest in the ${low.ph}` });
  }

  const missed = profile.patterns.find((p) => p.tag === "missed_tactic")?.count ?? 0;
  if (missed <= 1) {
    strengths.push({ id: "tactics", text: "Rarely misses forcing wins", phrase: "you rarely miss forcing wins" });
  }

  if (high.rate > low.rate) {
    leaks.push({ id: `phase:${high.ph}`, text: `Most mistakes come in the ${high.ph}`, phrase: `most of your mistakes come in the ${high.ph}` });
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
