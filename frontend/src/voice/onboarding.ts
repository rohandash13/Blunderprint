import type { CoachState } from "../coach/functions";

/** A voice toggle introduces the interface; it never resets the coaching session. */
export function voiceOnboarding(state: CoachState) {
  const hello = "Hi, I'm your Blunderprint coach.";
  const drill = state.drill;
  let guidance =
    "I'll help you find recurring mistakes in your games and practice stronger decisions. Ask about your habits, or choose a focus.";
  if (drill?.clock?.status === "ready")
    guidance = "We'll practice making a decision under time pressure. Say ready or click Start clock when you're ready.";
  else if (drill?.clock?.status === "running")
    guidance = "Your decision clock is already running. Drag a piece, type your move, or tell me what you'd play.";
  else if (drill?.clock?.status === "expired")
    guidance = "Time is up on this attempt. We can retry the clock or keep practicing this position without it.";
  else if (drill?.solved || drill?.revealed || state.pending)
    guidance = "We're reviewing this position from your game, one move at a time. Ask about the move on the board, or continue the line.";
  else if (drill)
    guidance =
      "We'll work on this position from your game, one move at a time. You can drag a piece, type your move, or tell me what you'd play.";
  else if (state.lastShown)
    guidance = "We're looking at a position from your game. Ask about the moves shown, or choose to drill this position.";
  const active = !!drill || !!state.lastShown;
  return {
    introduction: `${hello} ${guidance}`,
    context: `Latest voice-start context: ${active ? `A game position is already open${drill ? ` for ${drill.tag}` : ""}. Do not switch to a profile overview unless the player asks. Respond to a greeting with a brief acknowledgement and guide them on this position.` : "The player is choosing what to practice. After a greeting, briefly ask what they want to work on; only discuss profile details when requested."} The app supplies a short coach introduction on each Start voice click; do not add another introduction yourself. Do not restart the drill, clock, board, transcript or conversation. Keep all existing progress and use functions for chess facts.`,
  };
}
