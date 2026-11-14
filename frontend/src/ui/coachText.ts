/** Plain sentences for coach function results, shown in the caption strip and the typed-mode transcript. */

type R = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sentence = (s: string) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);

export function describeResult(name: string, raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as R;
  if (typeof r.error === "string") {
    if (/has no examples/.test(r.error)) return "No positions for this pattern at this difficulty. Turn on another level.";
    return sentence(cap(r.error));
  }
  const nextHint = r.next ? " Press Next to see the reply." : "";

  switch (name) {
    case "play_move": {
      if (r.verdict === "illegal") return sentence(str(r.reason) || "That move isn't legal here");
      const move = cap(str(r.spoken));
      if (r.verdict === "best") return `${move}: that's the best move.${nextHint}`;
      if (r.verdict === "repeated_mistake") return `${move}: that's the mistake from your game. Try another move, or choose See why.`;
      return `${move}: there's a stronger move here. Try again, or choose See why.`;
    }
    case "try_move":
      if (r.verdict === "illegal") return sentence(str(r.reason) || "That move isn't legal here");
      return `You try ${str(r.yourMove)}.${nextHint}`;
    case "explain_line":
    case "next_move": {
      if (typeof r.status === "string") return sentence(r.status);
      const text = sentence(cap(str(r.caption)));
      const evaluation = r.done && str(r.evalSpoken) ? ` ${sentence(cap(str(r.evalSpoken)))}` : "";
      const retry = r.retryAvailable
        ? " That's the first reply. Choose Try again to return to the position."
        : " Say next when you're ready to continue.";
      const reason =
        !r.captured && !r.check && !r.fork ? " This is the engine's recommended continuation; there is no immediate capture or check." : "";
      return `${text}${reason}${evaluation}${retry}`;
    }
    case "get_hint":
      return typeof r.hint === "string" ? `Hint ${r.level} of 3: ${r.hint}` : sentence(str(r.message));
    case "reveal_answer":
      return `The best move was ${str(r.bestSpoken)}. In the game you played ${str(r.gameMoveSpoken)}.`;
    case "reset_position":
    case "review_attempt":
    case "retry_position":
    case "start_clock":
    case "untimed_practice":
      return sentence(str(r.status));
    case "step_line":
      return "The board is at the position you requested. Ask about this position, or say next to move forward.";
    case "set_levels":
      return "The difficulty selection is updated. Choose a pattern when you're ready.";
    case "start_drill":
    case "open_position":
      // The difficulty note lives in the coach panel's prompt; saying it here too would repeat it.
      return sentence(str(r.status));
    case "show_mistake":
      return `In the game you played ${str(r.playedSpoken)} (red). ${cap(str(r.bestSpoken))} was stronger (green).`;
    default:
      return null;
  }
}
