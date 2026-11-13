import { useEffect, useRef, useState, type Dispatch } from "react";
import { ApiError, fetchProgress, fetchStatus, startAnalysis } from "../api";
import type { FlowAction, FlowState } from "../flow/flow";
import type { AnalysisProgress } from "../profile/types";
import { estimateRemaining, type ProgressSample } from "./format";

const POLL_MS = 2000;
/** Consecutive failed polls before the screen says the server is not answering. */
const SOFT_FAIL = 3;

export interface AnalysisView {
  progress: AnalysisProgress | null;
  queuePosition: number;
  games: number | null;
  etaSeconds: number | null;
  /** The server stopped answering polls for a while; polling continues. */
  stalled: boolean;
}

const EMPTY: AnalysisView = { progress: null, queuePosition: 0, games: null, etaSeconds: null, stalled: false };

export function messageFor(err: unknown): string {
  if (err instanceof ApiError) return err.message; // the server's own words: unknown user, no rated games, daily limit
  return "Can't reach the Blunderprint server. Check your connection and try again.";
}

/** Drives the analyzing step: status check, start or reuse a run, then poll progress every two seconds. */
export function useAnalysis(flow: FlowState, dispatch: Dispatch<FlowAction>): AnalysisView {
  const [view, setView] = useState<AnalysisView>(EMPTY);
  const samples = useRef<ProgressSample[]>([]);

  useEffect(() => {
    if (flow.step !== "analyzing" || !flow.username) return;
    const u = flow.username;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let misses = 0;
    samples.current = [];
    setView(EMPTY);

    const poll = async (runId: string) => {
      if (stopped) return;
      try {
        const p = await fetchProgress(runId);
        if (stopped) return;
        misses = 0;
        if (p.status === "DONE") return dispatch({ type: "done", username: u, runId });
        if (p.status === "FAILED") return dispatch({ type: "failed", username: u, message: "The analysis stopped on the server. Try again in a few minutes." });
        samples.current = [...samples.current.slice(-60), { t: Date.now(), done: p.doneFens }];
        const eta = p.queuePosition > 0 ? null : estimateRemaining(samples.current, p.totalFens);
        setView((v) => ({ ...v, progress: p, queuePosition: p.queuePosition, etaSeconds: eta, stalled: false }));
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApiError && err.status === 404) {
          return dispatch({ type: "failed", username: u, message: "That analysis no longer exists. Start it again." });
        }
        misses += 1;
        if (misses >= SOFT_FAIL) setView((v) => ({ ...v, stalled: true }));
      }
      timer = setTimeout(() => void poll(runId), POLL_MS);
    };

    void (async () => {
      try {
        const st = await fetchStatus(u);
        if (stopped) return;
        if (st.status === "DONE" && st.runId) return dispatch({ type: "existing", username: u, status: st });
        if (st.status !== "none" && st.runId) {
          dispatch({ type: "existing", username: u, status: st });
          setView((v) => ({ ...v, queuePosition: st.queuePosition ?? 0 }));
          return poll(st.runId);
        }
        const r = await startAnalysis(u);
        if (stopped) return;
        dispatch({ type: "started", username: u, runId: r.runId });
        if (r.reused) return dispatch({ type: "done", username: u, runId: r.runId });
        setView((v) => ({ ...v, queuePosition: r.queuePosition, games: r.games }));
        return poll(r.runId);
      } catch (err) {
        if (!stopped) dispatch({ type: "failed", username: u, message: messageFor(err) });
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [flow.step, flow.username, dispatch]);

  return view;
}
