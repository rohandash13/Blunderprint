export interface AnimCtx {
  /** True once the queue was cancelled after this task was enqueued. */
  cancelled(): boolean;
  /** Resolves after `ms`, or immediately if the queue is cancelled meanwhile. */
  sleep(ms: number): Promise<void>;
}

/**
 * Runs board animations one at a time. `cancel()` makes queued tasks skip and
 * wakes any running task's sleep so it can stop early.
 */
export class AnimationQueue {
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;
  private wakers = new Set<() => void>();

  run(task: (ctx: AnimCtx) => Promise<void>): Promise<void> {
    const mine = this.generation;
    const ctx: AnimCtx = {
      cancelled: () => this.generation !== mine,
      sleep: (ms) =>
        new Promise<void>((resolve) => {
          if (this.generation !== mine) return resolve();
          const done = () => {
            clearTimeout(timer);
            this.wakers.delete(done);
            resolve();
          };
          const timer = setTimeout(done, ms);
          this.wakers.add(done);
        }),
    };
    const result = this.tail.then(() => (ctx.cancelled() ? undefined : task(ctx)));
    this.tail = result.catch(() => undefined);
    return result;
  }

  cancel(): void {
    this.generation += 1;
    for (const wake of [...this.wakers]) wake();
  }
}
