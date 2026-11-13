import type { PerfRating } from "../profile/types";

const PERF_ORDER = ["ultraBullet", "bullet", "blitz", "rapid", "classical", "correspondence"];
const PERF_NAME: Record<string, string> = {
  ultraBullet: "UltraBullet",
  bullet: "Bullet",
  blitz: "Blitz",
  rapid: "Rapid",
  classical: "Classical",
  correspondence: "Correspondence",
};

export interface RatingChip {
  perf: string;
  label: string;
  rating: number;
  prog: number;
}

/** A rating from a handful of games says little; it is shown only when nothing better exists. */
const MIN_GAMES = 10;

/** Standard time controls the player has real games in, fastest first. */
export function ratingChips(ratings: Record<string, PerfRating> | null): RatingChip[] {
  if (!ratings) return [];
  const played = PERF_ORDER.filter((p) => ratings[p] && ratings[p].games > 0);
  const solid = played.filter((p) => ratings[p].games >= MIN_GAMES);
  return (solid.length ? solid : played).map((p) => ({ perf: p, label: PERF_NAME[p], rating: ratings[p].rating, prog: ratings[p].prog }));
}

/** "+12", "−3" (true minus), "0". */
export function signed(n: number): string {
  const r = Math.round(n);
  if (r > 0) return `+${r}`;
  if (r < 0) return `−${Math.abs(r)}`;
  return "0";
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "12 Mar 2026"; an em dash when unknown. */
export function formatDate(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
}

/** "12 Mar": for tight spaces where the year is clear from context. */
export function shortDate(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "—";
}

/** "2 Mar – 10 Nov 2026", or across years "2 Dec 2025 – 10 Nov 2026". */
export function dateRange(from: string | null | undefined, to: string | null | undefined): string | null {
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return null;
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = a.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
  return `${left} – ${formatDate(to)}`;
}

export interface ProgressSample {
  /** ms timestamp */
  t: number;
  done: number;
}

/** Seconds left from the recent rate of finished positions; null until there is a rate to go on. */
export function estimateRemaining(samples: ProgressSample[], total: number, windowMs = 90_000): number | null {
  if (samples.length < 2 || total <= 0) return null;
  const last = samples[samples.length - 1];
  const first = samples.find((s) => last.t - s.t <= windowMs) ?? samples[0];
  const dt = (last.t - first.t) / 1000;
  const dd = last.done - first.done;
  if (dt <= 0 || dd <= 0) return null;
  return Math.max(0, (total - last.done) / (dd / dt));
}

export function describeEta(seconds: number | null): string {
  if (seconds === null) return "Working out how long this will take";
  if (seconds < 60) return "Less than a minute left";
  const m = Math.round(seconds / 60);
  return m === 1 ? "About a minute left" : `About ${m} minutes left`;
}
