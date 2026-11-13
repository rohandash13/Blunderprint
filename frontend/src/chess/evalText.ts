/** Plain-language eval from the player's side. cp uses the engine mate encoding: |cp| >= 9000 is mate in 10000-|cp|. */
export function describeEval(cpForYou: number): string {
  const abs = Math.abs(cpForYou);
  const who = cpForYou > 0 ? "You have" : "Your opponent has";
  if (abs >= 9000) return `${who} mate in ${10000 - abs}`;
  if (abs < 50) return "Roughly equal";
  const pawns = Math.round(abs / 100);
  const plural = pawns === 1 ? "pawn" : "pawns";
  if (abs < 150) return `${who} a slight edge`;
  if (abs < 300) return `${who} a clear edge, about ${pawns} ${plural}`;
  if (abs < 700) return `${who} a winning edge, about ${pawns} ${plural}`;
  return `${who} a completely winning position`;
}
