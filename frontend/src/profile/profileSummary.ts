import { profileInsights } from "./profileInsights";
import type { Profile } from "./types";

/** The perf with the most games: the rating the player is best known by. */
export function mainRating(profile: Profile): { perf: string; rating: number } | null {
  const entries = Object.entries(profile.ratings ?? {});
  if (entries.length === 0) return null;
  const [perf, r] = entries.reduce((a, b) => (b[1].games > a[1].games ? b : a));
  return { perf, rating: r.rating };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const record = (label: string, r: { w: number; d: number; l: number }) =>
  `${label} ${r.w} won, ${r.d} drawn and ${r.l} lost`;

/**
 * Three to four plain sentences. Counts and ratings only: no percentages or decimals,
 * so the same text is safe to speak. Feeds the profile screen and the get_profile function.
 */
export function profileSummary(profile: Profile): string {
  const { games, moves } = profile.analyzed;
  const out: string[] = [];
  out.push(`I looked at ${plural(games, "game")}, ${plural(moves, "move")} in all.`);

  const main = mainRating(profile);
  const rec = `${record("as White", profile.record.white)}, ${record("as Black", profile.record.black)}`;
  out.push(main ? `You're around ${main.rating} in ${main.perf}; ${rec}.` : `${rec[0].toUpperCase()}${rec.slice(1)}.`);

  const { strengths, leaks } = profileInsights(profile);
  if (strengths.length === 0 && leaks.length === 0) {
    out.push("I found no clear mistakes in these games, so there is nothing to drill yet.");
    return out.join(" ");
  }
  if (strengths.length > 0) out.push(`What's working: ${strengths.map((s) => s.phrase).join(" and ")}.`);
  if (leaks.length > 0) out.push(`Where you leak: ${leaks.map((s) => s.phrase).join("; ")}.`);
  return out.join(" ");
}
