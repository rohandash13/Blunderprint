import { canGo, type FlowState, type Step } from "../flow/flow";
import { Emblem, MicIcon, StopIcon } from "./Icons";
import type { VoiceStatus } from "./useCoach";

const STEPS: { step: Step; name: string }[] = [
  { step: "profile", name: "Profile" },
  { step: "focus", name: "Choose focus" },
  { step: "drill", name: "Drill" },
];

const STATUS_TEXT: Record<VoiceStatus, string> = {
  idle: "Voice off",
  connecting: "Connecting",
  live: "Listening",
  error: "Voice stopped",
};

interface Props {
  flow: FlowState;
  onGo(step: Step): void;
  onHome(): void;
  voice: {
    status: VoiceStatus;
    error: string | null;
    canExport: boolean;
    start(): void;
    stop(): void;
    exportSession(): void;
  };
}

export function Rail({ flow, onGo, onHome, voice }: Props) {
  const current = flow.step === "landing" || flow.step === "analyzing" ? null : flow.step;
  const live = voice.status === "live";
  const canVoice = !!flow.username && flow.unlocked.profile;
  return (
    <header className="rail">
      <button type="button" className="wordmark" onClick={onHome} aria-label="Blunderprint, start over with a new player">
        <Emblem />
        <span>Blunderprint</span>
      </button>

      <nav className="steps" aria-label="Steps">
        <ol>
          {STEPS.map((s, i) => {
            const open = canGo(flow, s.step);
            const on = current === s.step;
            return (
              <li key={s.step}>
                <button type="button" className="step" aria-current={on ? "step" : undefined} disabled={!open} onClick={() => onGo(s.step)}>
                  <span className="step-n num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="step-name">{s.name}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="voice">
        <p className={`voice-state is-${voice.status}`} aria-live="polite">
          <i aria-hidden="true" />
          {STATUS_TEXT[voice.status]}
        </p>
        {live ? (
          <button type="button" className="btn btn-rail is-live" aria-pressed="true" onClick={voice.stop}>
            <StopIcon />
            Stop voice
          </button>
        ) : (
          <button type="button" className="btn btn-rail" aria-pressed="false" onClick={voice.start} disabled={!canVoice || voice.status === "connecting"} title={canVoice ? "Talk to the coach. Headphones help." : "Load a player first"}>
            <MicIcon />
            {voice.status === "connecting" ? "Connecting…" : voice.status === "error" ? "Reconnect voice" : "Start voice"}
          </button>
        )}
        {voice.error && (
          <p className="voice-error" role="alert">
            {voice.error}
          </p>
        )}
        {voice.canExport && (
          <button type="button" className="linkish rail-link" onClick={voice.exportSession}>
            Export latency
          </button>
        )}
      </div>
    </header>
  );
}
