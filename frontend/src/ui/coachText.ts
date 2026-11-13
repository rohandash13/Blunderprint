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
      if (r.verdict === "repeated_mistake") return `${move}: that's the move from your game. Try another.${nextHint}`;
      return `${move}: there's a stronger move here.${nextHint}`;
    }
    case "try_move":
      if (r.verdict === "illegal") return sentence(str(r.reason) || "That move isn't legal here");
      return `You try ${str(r.yourMove)}.${nextHint}`;
    case "next_move": {
      const text = sentence(cap(str(r.caption)));
      return r.done && str(r.evalSpoken) ? `${text} ${sentence(cap(str(r.evalSpoken)))}` : text;
    }
    case "get_hint":
      return typeof r.hint === "string" ? `Hint ${r.level} of 3: ${r.hint}` : sentence(str(r.message));
    case "reveal_answer":
      return `The best move was ${str(r.bestSpoken)}. In the game you played ${str(r.gameMoveSpoken)}.`;
    case "reset_position":
      return sentence(str(r.status));
    case "start_drill":
    case "open_position":
      return `${sentence(str(r.status))} This one is ${sentence(str(r.difficultyNote))}`;
    case "show_mistake":
      return `In the game you played ${str(r.playedSpoken)} (red). ${cap(str(r.bestSpoken))} was stronger (green).`;
    default:
      return null;
  }
}
