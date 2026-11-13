import type { Example, Level, Report } from "./types";
import type { AnalysisProgress, PlayerStatus, Profile, StartAnalysisResponse } from "./profile/types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const player = (u: string) => `/players/${encodeURIComponent(u)}`;

async function failure(res: Response, what: string): Promise<ApiError> {
  let message = `${what} failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) message = body.error;
  } catch {
    // keep the generic message
  }
  return new ApiError(res.status, message);
}

/** null when the player has no finished run. */
export async function fetchProfile(username: string): Promise<Profile | null> {
  const res = await fetch(`${player(username)}/profile`);
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res, "profile request");
  return (await res.json()) as Profile;
}

export async function fetchStatus(username: string): Promise<PlayerStatus> {
  const res = await fetch(`${player(username)}/status`);
  if (!res.ok) throw await failure(res, "status request");
  return (await res.json()) as PlayerStatus;
}

/** Throws ApiError with the server's message on 404 (no rated games) and 429 (limits). */
export async function startAnalysis(username: string): Promise<StartAnalysisResponse> {
  const res = await fetch("/analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) throw await failure(res, "analysis request");
  return (await res.json()) as StartAnalysisResponse;
}

export async function fetchProgress(runId: string): Promise<AnalysisProgress> {
  const res = await fetch(`/analysis/${encodeURIComponent(runId)}`);
  if (!res.ok) throw await failure(res, "progress request");
  return (await res.json()) as AnalysisProgress;
}

/** One analyzed position so a grid mark can open in the drill; null when it does not exist. */
export async function fetchPosition(username: string, gameId: string, ply: number): Promise<Example | null> {
  const res = await fetch(`${player(username)}/positions/${encodeURIComponent(gameId)}/${ply}`);
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res, "position request");
  return (await res.json()) as Example;
}

export async function fetchReport(username: string, levels: Level[]): Promise<Report | null> {
  const res = await fetch(`${player(username)}/report?levels=${levels.join(",")}`);
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res, "report request");
  return (await res.json()) as Report;
}
