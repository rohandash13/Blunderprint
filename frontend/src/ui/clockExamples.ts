import { fetchReport } from "../api";
import type { Example, Level } from "../types";

/** Returns effect cleanup so older difficulty/player requests cannot overwrite the current plate. */
export function loadClockExamples(username: string, selected: Level[], publish: (examples: Example[]) => void): () => void {
  let cancelled = false;
  const withSlips = (["slip", "tricky", "deep"] as Level[]).filter((l) => l === "slip" || selected.includes(l));
  void fetchReport(username, withSlips).then((report) => {
    if (cancelled) return;
    const examples = report?.patterns.find((p) => p.tag === "time_trouble")?.examples ?? [];
    publish(examples.filter((e) => selected.includes(e.level)));
  }).catch(() => { if (!cancelled) publish([]); });
  return () => { cancelled = true; };
}
