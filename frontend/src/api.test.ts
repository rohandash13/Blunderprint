import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchPosition, fetchProfile, fetchProgress, fetchReport, fetchStatus, startAnalysis } from "./api";

function mockFetch(status: number, body: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
}
afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("profile: relative URL, encoded name, null on 404", async () => {
    const f = mockFetch(200, { username: "a b" });
    expect(await fetchProfile("a b")).toEqual({ username: "a b" });
    expect(f).toHaveBeenCalledWith("/players/a%20b/profile");
    mockFetch(404, {});
    expect(await fetchProfile("zed")).toBeNull();
    mockFetch(500, {});
    await expect(fetchProfile("zed")).rejects.toBeInstanceOf(ApiError);
  });

  it("status and progress", async () => {
    const f = mockFetch(200, { status: "none", runId: null, queuePosition: null });
    expect((await fetchStatus("alice")).status).toBe("none");
    expect(f).toHaveBeenCalledWith("/players/alice/status");
    const g = mockFetch(200, { status: "RUNNING", totalFens: 10, doneFens: 3, failedFens: 0, queuePosition: 0 });
    expect((await fetchProgress("r/1")).doneFens).toBe(3);
    expect(g).toHaveBeenCalledWith("/analysis/r%2F1");
  });

  it("startAnalysis posts the username and surfaces server error messages", async () => {
    const f = mockFetch(200, { runId: "r1", games: 40, moves: 1200, jobsEnqueued: 0, reused: true, queuePosition: 0 });
    expect(await startAnalysis("alice")).toMatchObject({ runId: "r1", reused: true, queuePosition: 0 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/analysis");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ username: "alice" });

    mockFetch(429, { error: "Daily analysis limit reached" });
    await expect(startAnalysis("alice")).rejects.toMatchObject({ status: 429, message: "Daily analysis limit reached" });
    mockFetch(404, { error: "No rated games found for ghost" });
    await expect(startAnalysis("ghost")).rejects.toMatchObject({ status: 404, message: "No rated games found for ghost" });
    mockFetch(502, "x");
    await expect(startAnalysis("alice")).rejects.toMatchObject({ message: "analysis request failed (502)" });
  });

  it("position and report", async () => {
    const f = mockFetch(200, { gameId: "g1", ply: 4 });
    expect(await fetchPosition("alice", "g1", 4)).toEqual({ gameId: "g1", ply: 4 });
    expect(f).toHaveBeenCalledWith("/players/alice/positions/g1/4");
    mockFetch(404, {});
    expect(await fetchPosition("alice", "g1", 4)).toBeNull();
    const g = mockFetch(200, { username: "alice" });
    await fetchReport("alice", ["tricky", "deep"]);
    expect(g).toHaveBeenCalledWith("/players/alice/report?levels=tricky,deep");
  });
});
