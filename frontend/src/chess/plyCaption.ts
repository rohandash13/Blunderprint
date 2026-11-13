import type { MoveFacts } from "./facts";

const VALUE: Record<string, number> = { king: 100, queen: 9, rook: 5, bishop: 3, knight: 3, pawn: 1 };

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * One deterministic sentence about a move, built only from its facts.
 * `you` is the player's side, so targets read "your queen" or "their queen".
 */
export function plyCaption(f: MoveFacts, you: "White" | "Black"): string {
  if (f.san.startsWith("O-O")) {
    const castle = `${f.side} castles ${f.san.startsWith("O-O-O") ? "queenside" : "kingside"}`;
    return f.mate ? `${castle}, checkmate` : f.check ? `${castle}, giving check` : castle;
  }
  const to = f.uci.slice(2, 4);
  let text = f.captured ? `${f.side} takes on ${to} with the ${f.piece}` : `${f.side} moves the ${f.piece} to ${to}`;
  if (f.uci.length === 5) {
    const names: Record<string, string> = { q: "queen", r: "rook", b: "bishop", n: "knight" };
    text += `, promoting to a ${names[f.uci[4]] ?? "piece"}`;
  }
  if (f.mate) return `${text}, checkmate`;

  const owner = f.side === you ? "their" : "your";
  const byValue = (a: string, b: string) => VALUE[b] - VALUE[a];
  if (f.fork) {
    const targets = f.attacks.map((a) => a.piece).sort(byValue);
    return `${text}, forking ${owner} ${list(targets)}`;
  }
  const parts: string[] = [];
  if (f.check) parts.push("giving check");
  const hit = f.attacks.map((a) => a.piece).filter((p) => p !== "king" && p !== "pawn").sort(byValue).slice(0, 2);
  if (hit.length > 0) parts.push(`attacking ${owner} ${list(hit)}`);
  return parts.length > 0 ? `${text}, ${parts.join(" and ")}` : text;
}
