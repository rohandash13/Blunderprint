import { Chess, type Move, type PieceSymbol } from "chess.js";

const PIECE_WORDS: Record<string, PieceSymbol> = {
  king: "k", queen: "q", rook: "r", bishop: "b", knight: "n", night: "n", pawn: "p",
  // Single-letter prefixes. "b" is deliberately absent: it is also a file ("b knight d2").
  n: "n", r: "r", q: "q", k: "k",
};
const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8",
};
const PROMO_WORDS = new Set(["promote", "promotes", "promoting", "promotion", "equals"]);
const CAPTURE_WORDS = new Set(["takes", "take", "captures", "capture", "x"]);
const CASTLE_WORDS = new Set(["castle", "castles", "castling", "kingside", "queenside", "short", "long", "side"]);
const FILLER_WORDS = new Set([
  "to", "the", "my", "move", "moves", "play", "plays", "i", "ill", "will", "go", "goes", "with",
  "on", "at", "check", "checkmate", "mate", "please", "and", "then", "um", "uh", "okay", "ok",
  "lets", "let", "s",
]);
const SQUARE = /^[a-h][1-8]$/;
const FILE = /^[a-h]$/;
const SPOKEN_FILES: Record<string, string> = {ay:"a",bee:"b",see:"c",sea:"c",dee:"d",ee:"e",eff:"f",gee:"g",aitch:"h"};

type MoveInput = string | { from: string; to: string; promotion?: string };

function attempt(fen: string, move: MoveInput): Move | null {
  try {
    // chess.js 1.x throws on an illegal move or invalid FEN; other versions may return null.
    return new Chess(fen).move(move) ?? null;
  } catch {
    return null;
  }
}

/** Lowercase words; "f three" and "f 3" become "f3". Apostrophes are dropped ("I'll" -> "ill"). */
export function tokenize(input: string): string[] {
  const raw = input
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => NUMBER_WORDS[t] ?? t);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = /^[1-8]$/.test(raw[i + 1] ?? "") ? SPOKEN_FILES[raw[i]] ?? raw[i] : raw[i];
    const next = raw[i + 1];
    if (FILE.test(t) && next !== undefined && /^[1-8]$/.test(next)) {
      out.push(t + next);
      i++;
    } else {
      out.push(t);
    }
  }
  return out;
}

function isKnownToken(t: string): boolean {
  return (
    SQUARE.test(t) || FILE.test(t) || t in PIECE_WORDS || PROMO_WORDS.has(t) ||
    CAPTURE_WORDS.has(t) || CASTLE_WORDS.has(t) || FILLER_WORDS.has(t)
  );
}

function castle(legal: Move[], side: "O-O" | "O-O-O"): Move | null {
  return legal.find((m) => m.san.replace(/[+#]/g, "") === side) ?? null;
}

/** Resolve typed or spoken text to exactly one legal move, or null. */
export function parseMove(fen: string, input: string): Move | null {
  const text = input.trim();
  if (!text) return null;

  let legal: Move[];
  try {
    legal = new Chess(fen).moves({ verbose: true });
  } catch {
    return null; // invalid FEN
  }

  const compact = text.toLowerCase().replace(/\s+/g, "");
  if (/^(0-0-0|o-o-o)$/.test(compact)) return castle(legal, "O-O-O");
  if (/^(0-0|o-o)$/.test(compact)) return castle(legal, "O-O");

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
  // Anything we do not understand (negations included) means we cannot trust the reading.
  if (tokens.length === 0 || !tokens.every(isKnownToken)) return null;

  // "castle king side" / "castle queen side": king/queen right before "side" is a direction, not a piece.
  const sideDirs = new Set<number>();
  tokens.forEach((t, i) => {
    if (t === "side" && (tokens[i - 1] === "king" || tokens[i - 1] === "queen")) sideDirs.add(i - 1);
  });
  const castleWords = tokens.filter((t) => CASTLE_WORDS.has(t) && t !== "side");
  if (castleWords.length > 0 || tokens.includes("side")) {
    const long =
      castleWords.some((t) => t === "queenside" || t === "long") ||
      [...sideDirs].some((i) => tokens[i] === "queen");
    const short =
      castleWords.some((t) => t === "kingside" || t === "short") ||
      [...sideDirs].some((i) => tokens[i] === "king");
    const rest = tokens.filter((t, i) => !CASTLE_WORDS.has(t) && !FILLER_WORDS.has(t) && !sideDirs.has(i));
    const strayWord = tokens.some((t, i) => t === "side" && !sideDirs.has(i - 1));
    if (castleWords.length === 0 || rest.length > 0 || strayWord || long === short) return null;
    return castle(legal, long ? "O-O-O" : "O-O");
  }

  const squares = tokens.filter((t) => SQUARE.test(t));
  if (squares.length === 0 || squares.length > 2) return null;

  const files = tokens.filter((t) => FILE.test(t));
  if (files.length > 1) return null;
  const fromFile = files[0];

  const promoAt = tokens.findIndex((t) => PROMO_WORDS.has(t));
  const captureAt = tokens.findIndex((t) => CAPTURE_WORDS.has(t));
  // Only piece words before the capture word / promotion name the mover. A piece named after
  // "takes" is the victim ("knight takes bishop e5"); it is allowed but NOT verified, the move
  // only has to be a capture of something.
  const moverEnd = Math.min(...[promoAt, captureAt].filter((i) => i >= 0), tokens.length);
  const pieces = new Set(tokens.slice(0, moverEnd).map((t) => PIECE_WORDS[t]).filter(Boolean));
  if (pieces.size > 1) return null;
  const pieceWord = [...pieces][0];

  let promotion: PieceSymbol = "q";
  if (promoAt >= 0) {
    const promoPieces = new Set(tokens.slice(promoAt + 1).map((t) => PIECE_WORDS[t]).filter(Boolean));
    if (promoPieces.size > 1) return null;
    const asked = [...promoPieces][0];
    if (asked === "k" || asked === "p") return null;
    if (asked) promotion = asked;
  }

  let cands =
    squares.length === 2
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

  if (cands.length !== 1) return null;
  if (tokens.some((t) => CAPTURE_WORDS.has(t)) && !cands[0].captured) return null;
  return cands[0];
}
