import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { fetchPosition, fetchProfile } from "./api";
import type { Example, Level } from "./types";
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
import { loadClockExamples } from "./ui/clockExamples";
import { Conversation } from "./ui/Conversation";

export default function App() {
  const [flow, dispatch] = useReducer(flowReducer, initialFlow);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const [lastName, setLastName] = useState("");
  const [conversationOpen, setConversationOpen] = useState(false);
  const username = flow.unlocked.profile ? (flow.username ?? "") : "";

  const coach = useCoach(username, { onBoard: () => dispatch({ type: "openPosition" }) });
  const analysis = useAnalysis(flow, dispatch);
  const { setProfile: setCoachProfile, loadReport } = coach.actions;
  const mainRef = useRef<HTMLElement>(null);

  // Load the profile once the player's analysis is done; the report (positions to drill) comes with it.
  // Responses for a player who is no longer current are dropped (a restart can land mid-request).
  const currentUser = useRef(username);
  currentUser.current = username;
  const isCurrent = (u: string) => currentUser.current === u;

  const loadProfile = useCallback(async () => {
    const u = username;
    if (!u) return;
    setProfileError(null);
    try {
      const p = await fetchProfile(u);
      if (!isCurrent(u)) return;
      if (!p) return setProfileError(`No finished analysis for ${u} yet.`);
      setProfile(p);
      setCoachProfile(p);
    } catch (err) {
      if (isCurrent(u)) setProfileError(messageFor(err));
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

  // Each step starts at the top, and focus moves to its heading for keyboard and screen-reader users;
  // the profile's heading takes focus again once the profile has loaded in place of the loading line.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    const h = mainRef.current?.querySelector("h1");
    if (h instanceof HTMLElement) {
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
    }
  }, [flow.step, profile]);

  const submit = (name: string) => {
    setLastName(name);
    dispatch({ type: "submit", username: name });
  };
  const restart = () => {
    setConversationOpen(false);
    coach.actions.stopVoice();
    dispatch({ type: "restart" });
  };
  const go = (step: Step) => dispatch({ type: "goto", step });

  const drillTag = async (tag: string) => {
    dispatch({ type: "chooseFocus", tag });
    await coach.actions.startDrill(tag);
  };
  // Clock mistakes: the report only carries them with Slips on, so fetch them with Slips added and
  // keep the ones at the selected levels. Same source for the plate's state and its "See the mistake".
  const [clockExamples, setClockExamples] = useState<Example[] | null>(null);
  const levelKey = coach.levels.join(",");
  useEffect(() => {
    setClockExamples(null);
    if (!username) return;
    const selected = levelKey.split(",") as Level[];
    return loadClockExamples(username, selected, setClockExamples);
  }, [username, levelKey]);

  const show = async (tag: string) => {
    await coach.actions.showMistake(tag);
  };

  const openMark = async (tag: string, mark: GridMark, game: GridGame) => {
    const key = `${game.gameId}:${mark.ply}`;
    const u = username;
    setOpening(key);
    setMarkError(null);
    try {
      const ex = await fetchPosition(u, game.gameId, mark.ply);
      if (!isCurrent(u)) return;
      if (!ex) return setMarkError("That position isn't available any more. Try another mark.");
      coach.actions.openExample(tag, ex);
    } catch (err) {
      if (isCurrent(u)) setMarkError(messageFor(err));
    } finally {
      setOpening(null);
    }
  };

  const changeLevels = async (lv: Parameters<typeof coach.actions.changeLevels>[0]) => {
    // Only a running drill restarts at the new levels; an example being shown just clears.
    const tag = flow.step === "drill" ? (coach.drill?.tag ?? null) : null;
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
        clockExamples={clockExamples}
        onShowExample={(t, ex) => coach.actions.showExample(t, ex)}
        busy={coach.busy}
      />
    );
  } else {
    body = <Drill coach={coach} onChoose={() => go("focus")} onLevels={(lv) => void changeLevels(lv)} />;
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
          start: () => {
            setConversationOpen(true);
            void coach.actions.startVoice();
          },
          stop: coach.actions.stopVoice,
          exportSession: coach.actions.exportSession,
          showConversation:
            flow.step !== "drill" && (coach.status !== "idle" || coach.lines.length > 0) ? () => setConversationOpen(true) : undefined,
        }}
      />
      <main className={`main step-${flow.step}`} ref={mainRef}>
        {body}
      </main>
      {username && flow.step !== "drill" && (
        <Conversation
          coach={coach}
          open={conversationOpen}
          onClose={() => {
            setConversationOpen(false);
            document.querySelector<HTMLButtonElement>("[data-conversation-toggle]")?.focus();
          }}
        />
      )}
    </div>
  );
}
