import type { PlayerStatus } from "../profile/types";

export type Step = "landing" | "analyzing" | "profile" | "focus" | "drill";

export interface FlowState {
  step: Step;
  username: string | null;
  runId: string | null;
  error: string | null;
  /** Steps the player may jump to; landing and analyzing are never jump targets. */
  unlocked: { profile: boolean; focus: boolean; drill: boolean };
  focusTag: string | null;
}

export type FlowAction =
  | { type: "submit"; username: string }
  | { type: "existing"; status: PlayerStatus }
  | { type: "started"; runId: string }
  | { type: "done" }
  | { type: "failed"; message: string }
  | { type: "goto"; step: Step }
  | { type: "chooseFocus"; tag: string }
  | { type: "openPosition" }
  | { type: "restart" };

const LOCKED = { profile: false, focus: false, drill: false };

export const initialFlow: FlowState = { step: "landing", username: null, runId: null, error: null, unlocked: LOCKED, focusTag: null };

export function canGo(state: FlowState, step: Step): boolean {
  if (step === "profile" || step === "focus" || step === "drill") return state.unlocked[step];
  return false;
}

const reachProfile = (s: FlowState): FlowState => ({ ...s, step: "profile", error: null, unlocked: { ...s.unlocked, profile: true, focus: true } });

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "submit": {
      const username = action.username.trim();
      if (!username) return state;
      return { step: "analyzing", username, runId: null, error: null, unlocked: LOCKED, focusTag: null };
    }
    case "existing": {
      const { status, runId } = action.status;
      if (status === "DONE" && runId) return reachProfile({ ...state, runId });
      if (status === "none") return { ...state, step: "analyzing", runId: null };
      return { ...state, step: "analyzing", runId };
    }
    case "started":
      return { ...state, runId: action.runId };
    case "done":
      return reachProfile(state);
    case "failed":
      return { ...state, step: "landing", error: action.message, unlocked: LOCKED, focusTag: null };
    case "goto":
      return canGo(state, action.step) ? { ...state, step: action.step } : state;
    case "chooseFocus":
      if (!state.unlocked.focus) return state;
      return { ...state, step: "drill", focusTag: action.tag, unlocked: { ...state.unlocked, drill: true } };
    case "openPosition":
      if (!state.unlocked.profile) return state;
      return { ...state, step: "drill", unlocked: { ...state.unlocked, drill: true } };
    case "restart":
      return initialFlow;
  }
}
