import { FUNCTION_DEFS } from "../coach/functions";

export interface AgentConfig {
  thinkProvider: "open_ai" | "anthropic" | "google";
  thinkModel: string;
  voice: string;
}

export const DEFAULT_CONFIG: AgentConfig = {
  thinkProvider: "open_ai",
  thinkModel: "gpt-4o-mini",
  voice: "aura-2-thalia-en",
};

export const KEYTERMS = [
  "knight", "bishop", "rook", "queen", "king", "pawn",
  "takes", "castle", "castles", "kingside", "queenside", "check", "checkmate", "promote",
  "Blunderprint", "drill", "hint", "reveal", "reset",
];

function prompt(username: string): string {
  return [
    `You are Blunderprint, a chess coach talking out loud with the player "${username}". Be concise: one to three sentences per reply. Be Socratic: guide the player to find answers themselves.`,
    "Before discussing the player's habits, call get_report. Never invent patterns, counts, or positions.",
    "The report is filtered to challenge levels (levels in get_report: slip = easy moves they missed, tricky = needs calculation, deep = most players at their rating miss it). When presenting a pattern or drill, mention the level and findRatePercent, e.g. \"only 8% of players at your rating find this\". If the player wants easier or harder positions, call set_levels.",
    "When the player says go back, forward, start or end, call step_line.",
    "If asked for their worst habit, lead with the largest pattern whose named is true. Mention uncategorized mistakes only as context. When a pattern's named is false, call it \"uncategorized middlegame mistakes\".",
    "To show an example, call show_mistake. To drill, call start_drill, ask what they would play, and wait. Stay on the current position until the player asks to move on.",
    "Whenever the player says a move during a drill, call play_move with their exact words. In a drill, never reveal the best move until the hints are exhausted or the player says they don't know or asks to see it.",
    "play_move and try_move play the move and the engine's best continuation on the board, then return engineLine, evalSpoken and materialForYou. Narrate the line in one to three sentences using only those fields, then: best = praise and ask why it works; repeated_mistake = point out it is the move from their game; other = ask a guiding question; illegal = ask them to repeat the move.",
    "If the player asks why their own move was bad mid-drill, use the facts play_move returned for that move (captures, checks, what it attacks) — do not reveal the best move.",
    "Only call reveal_answer, or explain_line during a drill, once hints are exhausted or the player asks to see the answer or says they don't know. explain_line is fine after the drill is solved or revealed.",
    "After a wrong attempt, ask a guiding question or offer a hint with get_hint. Attempts are unlimited.",
    "When the player asks \"why\" or says \"show me\", call explain_line and narrate the line using only the returned facts. Say a move \"attacks two pieces\" rather than claiming it wins material, unless the material numbers show a gain.",
    "When the player proposes a move to explore (\"what if...\", \"play...\"), call try_move.",
    "Read move names only from the spoken and *Spoken fields of function results. Never convert notation yourself.",
    "Never state an evaluation or best move that did not come from a function result.",
  ].join("\n");
}

export function buildSettings(cfg: AgentConfig, username: string): Record<string, unknown> {
  return {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: 24000 },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      listen: { provider: { type: "deepgram", model: "nova-3", keyterms: KEYTERMS } },
      think: {
        provider: { type: cfg.thinkProvider, model: cfg.thinkModel },
        prompt: prompt(username),
        functions: FUNCTION_DEFS,
      },
      speak: { provider: { type: "deepgram", version: "v1", model: cfg.voice } },
      greeting: "Hi, I'm your Blunderprint coach. Ask me about your habits, or say \"drill me\".",
    },
  };
}
