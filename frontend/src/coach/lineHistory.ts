import type { Arrow } from "./functions";

export interface Frame {
  fen: string;
  arrows: Arrow[];
}
export type StepDirection = "back" | "forward" | "start" | "end";

/** Board frames of the most recent playout, for stepping back and forward. */
export class LineHistory {
  private frames: Frame[] = [];
  private i = -1;

  reset(frame: Frame): void {
    this.frames = [frame];
    this.i = 0;
  }

  /** Continue the current line if it ends at `fen`, otherwise start a new one there. */
  begin(fen: string): void {
    if (this.last?.fen !== fen) this.reset({ fen, arrows: [] });
  }

  push(frame: Frame): void {
    this.frames = this.frames.slice(0, this.i + 1);
    this.frames.push(frame);
    this.i = this.frames.length - 1;
  }

  step(dir: StepDirection): Frame | null {
    if (this.frames.length === 0) return null;
    const lastIdx = this.frames.length - 1;
    if (dir === "back") this.i = Math.max(0, this.i - 1);
    else if (dir === "forward") this.i = Math.min(lastIdx, this.i + 1);
    else if (dir === "start") this.i = 0;
    else this.i = lastIdx;
    return this.frames[this.i];
  }

  get position(): { ply: number; total: number } {
    return { ply: Math.max(0, this.i), total: Math.max(0, this.frames.length - 1) };
  }

  get last(): Frame | null {
    return this.frames[this.frames.length - 1] ?? null;
  }
}
