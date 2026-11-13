import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";

export interface MoveFacts {
  uci: string;
  san: string;
  spoken: string;
  side: "White" | "Black";
  piece: string;
  captured?: string;
  check: boolean;
  mate: boolean;
  attacks: { square: string; piece: string }[];
  /** Pieces attacked that make the move a fork: the king, a more valuable piece, or an undefended one. */
  forkTargets: string[];
  fork: boolean;
  fenAfter: string;
  materialAfter: number;
}

const NAMES: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function material(fen: string): { white: number; black: number; diff: number } {
  let white = 0;
  let black = 0;
  for (const row of new Chess(fen).board()) {
    for (const sq of row) {
      if (!sq) continue;
      if (sq.color === "w") white += VALUES[sq.type];
      else black += VALUES[sq.type];
    }
  }
  return { white, black, diff: white - black };
}

function play(chess: Chess, uci: string) {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  try {
    return uci.length === 5 ? chess.move({ from, to, promotion: uci[4] }) : chess.move({ from, to });
  } catch {
    return null;
  }
}

function spoken(m: { san: string; piece: PieceSymbol; from: string; to: string; captured?: PieceSymbol; promotion?: PieceSymbol }, check: boolean, mate: boolean): string {
  let text: string;
  if (m.san.startsWith("O-O-O")) text = "castles queenside";
  else if (m.san.startsWith("O-O")) text = "castles kingside";
  else {
    if (m.piece === "p") text = m.captured ? `${m.from[0]}-pawn takes on ${m.to}` : `pawn to ${m.to}`;
    else text = `${NAMES[m.piece]} ${m.captured ? "takes on" : "to"} ${m.to}`;
    if (m.promotion) text += `, promoting to a ${NAMES[m.promotion]}`;
  }
  if (mate) text += ", checkmate";
  else if (check) text += ", check";
  return text;
}

export function describeMove(fen: string, uci: string): MoveFacts | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const m = play(chess, uci);
  if (!m) return null;
  const check = chess.isCheck();
  const mate = chess.isCheckmate();
  const moverColor: Color = m.color;
  const oppColor: Color = moverColor === "w" ? "b" : "w";
  const landed = chess.get(m.to as Square)!; // promoted piece if promotion
  const attacks: { square: string; piece: string }[] = [];
  const forkTargets: string[] = [];
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== oppColor) continue;
      if (!chess.attackers(sq.square, moverColor).includes(m.to as Square)) continue;
      attacks.push({ square: sq.square, piece: NAMES[sq.type] });
      const undefended = chess.attackers(sq.square, oppColor).length === 0;
      if (sq.type === "k" || VALUES[sq.type] > VALUES[landed.type] || undefended) forkTargets.push(NAMES[sq.type]);
    }
  }
  const fenAfter = chess.fen();
  return {
    uci,
    san: m.san,
    spoken: spoken(m, check, mate),
    side: moverColor === "w" ? "White" : "Black",
    piece: NAMES[m.piece],
    ...(m.captured ? { captured: NAMES[m.captured] } : {}),
    check,
    mate,
    attacks,
    forkTargets,
    // A king "fork" is not a tactic worth naming, so kings never fork.
    fork: landed.type !== "k" && forkTargets.length >= 2,
    fenAfter,
    materialAfter: material(fenAfter).diff,
  };
}

export function lineFacts(fen: string, ucis: string[], maxPlies = 6): MoveFacts[] {
  const out: MoveFacts[] = [];
  let cur = fen;
  for (const uci of ucis.slice(0, maxPlies)) {
    const f = describeMove(cur, uci);
    if (!f) break;
    out.push(f);
    cur = f.fenAfter;
  }
  return out;
}

export function spokenMove(fen: string, uci: string): string {
  return describeMove(fen, uci)?.spoken ?? uci;
}
