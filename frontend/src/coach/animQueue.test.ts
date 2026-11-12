import { describe, expect, it } from "vitest";
import { AnimationQueue, type AnimCtx } from "./animQueue";

describe("AnimationQueue", () => {
  it("runs tasks sequentially without overlap", async () => {
    const q = new AnimationQueue();
    const log: string[] = [];
    const task = (name: string) => async (c: AnimCtx) => {
      log.push(`start ${name}`);
      await c.sleep(10);
      log.push(`end ${name}`);
    };
    await Promise.all([q.run(task("a")), q.run(task("b"))]);
    expect(log).toEqual(["start a", "end a", "start b", "end b"]);
  });

  it("cancel wakes a running task and skips queued ones", async () => {
    const q = new AnimationQueue();
    const log: string[] = [];
    const first = q.run(async (c) => {
      await c.sleep(10_000);
      log.push(c.cancelled() ? "first cancelled" : "first done");
    });
    const second = q.run(async () => {
      log.push("second ran");
    });
    await new Promise((r) => setTimeout(r, 0));
    q.cancel();
    await Promise.all([first, second]);
    expect(log).toEqual(["first cancelled"]);
  });

  it("runs tasks enqueued after a cancel", async () => {
    const q = new AnimationQueue();
    q.cancel();
    let ran = false;
    await q.run(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("keeps going after a task throws", async () => {
    const q = new AnimationQueue();
    await expect(q.run(async () => { throw new Error("x"); })).rejects.toThrow("x");
    let ran = false;
    await q.run(async () => { ran = true; });
    expect(ran).toBe(true);
  });
});
