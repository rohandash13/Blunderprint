import { Chess, type Move, type PieceSymbol } from "chess.js";

const PIECE_WORDS: Record<string, PieceSymbol> = {
  king: "k", queen: "q", rook: "r", bishop: "b", knight: "n", night: "n", pawn: "p",
};
const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8",
};
const PROMO_WORDS = new Set(["promote", "promotes", "promoting", "promotion", "equals"]);

type MoveInput = string | { from: string; to: string; promotion?: string };

function attempt(fen: string, move: MoveInput): Move | null {
  try {
    // chess.js 1.x throws on an illegal move; other versions may return null. Handle both.
    return new Chess(fen).move(move) ?? null;
  } catch {
    return null;
  }
}

/** Lowercase words; "f three" and "f 3" become "f3". */
export function tokenize(input: string): string[] {
  const raw = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => NUMBER_WORDS[t] ?? t);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    const next = raw[i + 1];
    if (/^[a-h]$/.test(t) && next !== undefined && /^[1-8]$/.test(next)) {
      out.push(t + next);
      i++;
    } else {
      out.push(t);
    }
  }
  return out;
}

/** Resolve typed or spoken text to exactly one legal move, or null. */
export function parseMove(fen: string, input: string): Move | null {
  const text = input.trim();
  if (!text) return null;

  const uci = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(text);
  if (uci) {
    return attempt(fen, {
      from: uci[1].toLowerCase(),
      to: uci[2].toLowerCase(),
      promotion: (uci[3] ?? "q").toLowerCase(),
    });
  }
  const san = attempt(fen, text);
  if (san) return san;

  const tokens = tokenize(text);
  const legal = new Chess(fen).moves({ verbose: true });

  if (tokens.some((t) => t.startsWith("castl"))) {
    const long = tokens.some((t) => t === "queenside" || t === "long" || t === "queen");
    const target = long ? "O-O-O" : "O-O";
    return legal.find((m) => m.san.replace(/[+#]/g, "") === target) ?? null;
  }

  const squares = tokens.filter((t) => /^[a-h][1-8]$/.test(t));
  if (squares.length === 0) return null;

  const promoAt = tokens.findIndex((t) => PROMO_WORDS.has(t));
  const promotion =
    promoAt >= 0
      ? tokens.slice(promoAt + 1).map((t) => PIECE_WORDS[t]).find((p) => p && p !== "k" && p !== "p") ?? "q"
      : "q";
  const pieceWord = (promoAt >= 0 ? tokens.slice(0, promoAt) : tokens).map((t) => PIECE_WORDS[t]).find(Boolean);
  const fromFile = tokens.find((t) => /^[a-h]$/.test(t));

  let cands =
    squares.length >= 2
      ? legal.filter((m) => m.from === squares[0] && m.to === squares[1])
      : legal.filter((m) => m.to === squares[0]);
  if (pieceWord) {
    cands = cands.filter((m) => m.piece === pieceWord);
  } else if (squares.length < 2) {
    const pawns = cands.filter((m) => m.piece === "p");
    if (pawns.length > 0) cands = pawns;
  }
  if (fromFile) cands = cands.filter((m) => m.from[0] === fromFile);
  if (cands.some((m) => m.promotion)) cands = cands.filter((m) => m.promotion === promotion);

  return cands.length === 1 ? cands[0] : null;
}
