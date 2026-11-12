import { describe, expect, it } from "vitest";
import { LineHistory } from "./lineHistory";

const f = (fen: string) => ({ fen, arrows: [] });

describe("LineHistory", () => {
  it("steps within bounds", () => {
    const h = new LineHistory();
    expect(h.step("back")).toBeNull();
    h.reset(f("a"));
    h.push(f("b"));
    h.push(f("c"));
    expect(h.position).toEqual({ ply: 2, total: 2 });
    expect(h.step("back")?.fen).toBe("b");
    expect(h.step("start")?.fen).toBe("a");
    expect(h.step("back")?.fen).toBe("a");
    expect(h.step("end")?.fen).toBe("c");
    expect(h.step("forward")?.fen).toBe("c");
  });
  it("begin continues when the fen matches the last frame, otherwise starts over", () => {
    const h = new LineHistory();
    h.reset(f("a"));
    h.push(f("b"));
    h.begin("b");
    expect(h.position.total).toBe(1);
    h.begin("z");
    expect(h.position).toEqual({ ply: 0, total: 0 });
    expect(h.last?.fen).toBe("z");
  });
  it("push after stepping back drops the frames ahead", () => {
    const h = new LineHistory();
    h.reset(f("a"));
    h.push(f("b"));
    h.step("back");
    h.push(f("x"));
    expect(h.position).toEqual({ ply: 1, total: 1 });
    expect(h.last?.fen).toBe("x");
  });
});
