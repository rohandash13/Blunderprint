/** Chess actions require a user turn; narration must finish streaming AND playing. */
export class GuidedPacing {
  private permitted = false;
  private startedAt = 0;
  private speech: { text: string; matched: boolean; audio: boolean; done: boolean } | null = null;
  get speaking() {
    return this.speech !== null;
  }
  get audioMissingSince() {
    return this.speech && !this.speech.audio ? this.startedAt : null;
  }
  userTurn() {
    this.permitted = true;
  }
  consumeTurn() {
    if (this.speaking || !this.permitted) return false;
    this.permitted = false;
    return true;
  }
  begin(text: string) {
    this.startedAt = Date.now();
    this.speech = { text, matched: false, audio: false, done: false };
    this.permitted = false;
  }
  text(content: string) {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (this.speech && normalize(content) === normalize(this.speech.text)) this.speech.matched = true;
  }
  audio() {
    if (this.speech?.matched) this.speech.audio = true;
  }
  audioDone() {
    if (this.speech?.matched && this.speech.audio) this.speech.done = true;
  }
  tick(playbackRemainingMs: number) {
    if (this.speech?.done && playbackRemainingMs <= 0) this.speech = null;
  }
  interrupt() {
    this.speech = null;
    this.permitted = false;
  }
}

export const PACED_FUNCTIONS = new Set([
  "play_move",
  "try_move",
  "next_move",
  "review_attempt",
  "retry_position",
  "reset_position",
  "step_line",
  "get_hint",
  "reveal_answer",
  "explain_line",
  "start_drill",
  "show_mistake",
  "start_clock",
  "untimed_practice",
  "set_levels",
]);
