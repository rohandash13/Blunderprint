import { afterEach, expect, it, vi } from "vitest";
import type { Example, Level, Report } from "../types";
import { loadClockExamples } from "./clockExamples";
import { fetchReport } from "../api";

vi.mock("../api", () => ({ fetchReport: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const example = (level: Level) => ({ level } as Example);
const report = (...levels: Level[]) => ({ patterns: [{ tag: "time_trouble", examples: levels.map(example) }] } as Report);

it("includes slips in the request but shows only selected clock examples", async () => {
  vi.mocked(fetchReport).mockResolvedValue(report("slip", "tricky", "deep"));
  const publish = vi.fn();
  loadClockExamples("alice", ["deep"], publish);
  await vi.waitFor(() => expect(publish).toHaveBeenCalledWith([example("deep")]));
  expect(fetchReport).toHaveBeenCalledWith("alice", ["slip", "deep"]);
});

it("ignores an obsolete response after a difficulty change", async () => {
  let resolve!: (r: Report) => void;
  vi.mocked(fetchReport).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  const publish = vi.fn();
  const cancel = loadClockExamples("alice", ["deep"], publish);
  cancel();
  resolve(report("deep"));
  await Promise.resolve();
  expect(publish).not.toHaveBeenCalled();
});

it("ignores an obsolete failure after changing player", async () => {
  let reject!: (e: Error) => void;
  vi.mocked(fetchReport).mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
  const publish = vi.fn();
  const cancel = loadClockExamples("alice", ["deep"], publish);
  cancel();
  reject(new Error("offline"));
  await new Promise((r) => setTimeout(r, 0));
  expect(publish).not.toHaveBeenCalled();
});
