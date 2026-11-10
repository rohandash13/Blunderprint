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
  "Blunderprint", "drill",
];

function prompt(username: string): string {
  return [
    `You are Blunderprint, a concise, encouraging chess coach talking out loud with the player "${username}".`,
    "Keep replies short: one to three sentences. Speak naturally; say moves the way a person would (\"knight to f3\").",
    "Before discussing the player's habits, call get_report. Never invent patterns, counts, or positions.",
    "To show an example, call show_mistake. To drill, call start_drill, ask what they would play, and wait. Each drill allows one attempt; to retry, call start_drill again.",
    "Whenever the player says a move during a drill, call play_move with their exact words. Base your feedback only on its verdict:",
    "best = they found the engine move; repeated_mistake = the same move they played in the game; other = legal but different; illegal = ask them to repeat it.",
    "Never state a chess evaluation or best move that did not come from a function result.",
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
