import { describeMove } from "../chess/facts";

/** [idea, piece, square] — three progressively more specific hints for the best move. */
export function hintLadder(fen: string, bestUci: string): [string, string, string] {
  const f = describeMove(fen, bestUci);
  const castle = f !== null && f.spoken.startsWith("castles");
  let idea: string;
  if (f?.mate) idea = "There's a forced checkmate here — look at every check.";
  else if (f?.captured && f.check) idea = "Look for a capture that also gives check.";
  else if (f?.fork) idea = "Look for a move that attacks two things at once.";
  else if (f?.captured) idea = "Something can be won — look for what's loose or under-defended.";
  else if (f?.check) idea = "Look at forcing moves, especially checks.";
  else idea = "No capture needed — find the move that improves your worst piece or stops your opponent's main idea.";
  if (!f) return [idea, "It's a move with one of your pieces.", `Look at the ${bestUci.slice(2, 4)} square.`];
  if (castle) return [idea, "It involves your king — think about safety.", "Castle."];
  return [idea, `It's a move with your ${f.piece}.`, `Your ${f.piece} goes to ${bestUci.slice(2, 4)}.`];
}
