import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { fetchPosition, fetchProfile } from "./api";
import { flowReducer, initialFlow, type Step } from "./flow/flow";
import type { GridGame, GridMark, Profile as ProfileData } from "./profile/types";
import { Analyzing } from "./ui/Analyzing";
import { Drill } from "./ui/Drill";
import { Focus } from "./ui/Focus";
import { Landing } from "./ui/Landing";
import { Profile } from "./ui/Profile";
import { Rail } from "./ui/Rail";
import { useAnalysis, messageFor } from "./ui/useAnalysis";
import { useCoach } from "./ui/useCoach";

export default function App() {
  const [flow, dispatch] = useReducer(flowReducer, initialFlow);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const [lastName, setLastName] = useState("");
  const username = flow.unlocked.profile ? flow.username ?? "" : "";

  const coach = useCoach(username, { onBoard: () => dispatch({ type: "openPosition" }) });
  const analysis = useAnalysis(flow, dispatch);
  const { setProfile: setCoachProfile, loadReport } = coach.actions;
  const mainRef = useRef<HTMLElement>(null);

  // Load the profile once the player's analysis is done; the report (positions to drill) comes with it.
  const loadProfile = useCallback(async () => {
    if (!username) return;
    setProfileError(null);
    try {
      const p = await fetchProfile(username);
      if (!p) return setProfileError(`No finished analysis for ${username} yet.`);
      setProfile(p);
      setCoachProfile(p);
    } catch (err) {
      setProfileError(messageFor(err));
    }
  }, [username, setCoachProfile]);

  useEffect(() => {
    setProfile(null);
    setMarkError(null);
    if (!username) return;
    void loadProfile();
    void loadReport(coach.levels);
    // levels are read once per player; later changes reload through changeLevels
  }, [username]);

  // Each step starts at the top, and focus moves to its heading for keyboard and screen-reader users.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    const h = mainRef.current?.querySelector("h1");
    if (h instanceof HTMLElement) {
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
    }
  }, [flow.step]);

  const submit = (name: string) => {
    setLastName(name);
    dispatch({ type: "submit", username: name });
  };
  const restart = () => {
    coach.actions.stopVoice();
    dispatch({ type: "restart" });
  };
  const go = (step: Step) => dispatch({ type: "goto", step });

  const drillTag = async (tag: string) => {
    dispatch({ type: "chooseFocus", tag });
    await coach.actions.startDrill(tag);
  };
  const show = async (tag: string) => {
    await coach.actions.showMistake(tag);
  };

  const openMark = async (tag: string, mark: GridMark, game: GridGame) => {
    const key = `${game.gameId}:${mark.ply}`;
    setOpening(key);
    setMarkError(null);
    try {
      const ex = await fetchPosition(username, game.gameId, mark.ply);
      if (!ex) return setMarkError("That position isn't available any more. Try another mark.");
      coach.actions.openExample(tag, ex);
    } catch (err) {
      setMarkError(messageFor(err));
    } finally {
      setOpening(null);
    }
  };

  const changeLevels = async (lv: Parameters<typeof coach.actions.changeLevels>[0]) => {
    const tag = flow.step === "drill" ? coach.drill?.tag ?? flow.focusTag : null;
    await coach.actions.changeLevels(lv);
    if (tag) await coach.actions.startDrill(tag); // stay on the pattern at the new difficulty
  };

  let body: JSX.Element;
  if (flow.step === "landing") {
    body = <Landing error={flow.error} initial={lastName} onSubmit={submit} />;
  } else if (flow.step === "analyzing") {
    body = <Analyzing username={flow.username ?? ""} view={analysis} onCancel={restart} />;
  } else if (!profile) {
    body = (
      <div className="panel loading-panel" aria-busy={!profileError}>
        {profileError ? (
          <>
            <h1>Couldn't open the profile</h1>
            <p className="form-error" role="alert">
              {profileError}
            </p>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => void loadProfile()}>
                Try again
              </button>
              <button type="button" className="btn" onClick={restart}>
                Choose another player
              </button>
            </div>
          </>
        ) : (
          <h1 className="loading-line">Opening {username}'s profile…</h1>
        )}
      </div>
    );
  } else if (flow.step === "profile") {
    body = (
      <Profile
        profile={profile}
        report={coach.report}
        levels={coach.levels}
        onLevels={(lv) => void changeLevels(lv)}
        onOpenMark={(t, m, g) => void openMark(t, m, g)}
        openingMark={opening}
        markError={markError}
        onDrill={(t) => void drillTag(t)}
        onChangePlayer={restart}
      />
    );
  } else if (flow.step === "focus") {
    body = (
      <Focus
        profile={profile}
        report={coach.report}
        reportError={coach.reportError}
        levels={coach.levels}
        onLevels={(lv) => void changeLevels(lv)}
        onDrill={(t) => void drillTag(t)}
        onShow={(t) => void show(t)}
        busy={coach.busy}
      />
    );
  } else {
    body = <Drill coach={coach} onChoose={() => go("focus")} />;
  }

  return (
    <div className="shell">
      <Rail
        flow={flow}
        onGo={go}
        onHome={restart}
        voice={{
          status: coach.status,
          error: coach.voiceError,
          canExport: coach.canExport,
          start: () => void coach.actions.startVoice(),
          stop: coach.actions.stopVoice,
          exportSession: coach.actions.exportSession,
        }}
      />
      <main className={`main step-${flow.step}`} ref={mainRef}>
        {body}
      </main>
    </div>
  );
}
