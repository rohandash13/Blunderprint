import type { Level } from "../types";
import { PICK_LEVELS, type PickLevel } from "./gridLayout";

const NAMES: Record<PickLevel, string> = { slip: "Slips", tricky: "Tricky", deep: "Deep" };
const MEANING: Record<PickLevel, string> = {
  slip: "Ones you'd usually spot at your level",
  tricky: "Worth slowing down for",
  deep: "A stretch at your level",
};

interface Props {
  levels: Level[];
  onChange(levels: Level[]): void;
  /** Marks per level, shown beside each name. */
  counts?: Partial<Record<Level, number>>;
  compact?: boolean;
  /** What the counts cover, e.g. "in your last 40 games". */
  scope?: string;
}

/** Slips | Tricky | Deep: a multi-select segmented control; at least one level stays on. */
export function LevelControl({ levels, onChange, counts, compact, scope }: Props) {
  const toggle = (l: PickLevel) => {
    const on = levels.includes(l);
    if (on && levels.length === 1) return;
    onChange(on ? levels.filter((x) => x !== l) : [...levels, l]);
  };
  return (
    <div className={compact ? "levels compact" : "levels"}>
      <span className="levels-label" id={compact ? "levels-label-c" : "levels-label"}>
        Difficulty
      </span>
      <div className="seg" role="group" aria-labelledby={compact ? "levels-label-c" : "levels-label"}>
        {PICK_LEVELS.map((l) => {
          const on = levels.includes(l);
          const last = on && levels.length === 1;
          return (
            <button key={l} type="button" className={`seg-btn lv-${l}`} aria-pressed={on} title={last ? `${MEANING[l]}. At least one level stays on.` : MEANING[l]} onClick={() => toggle(l)}>
              <i className={`dot lv-${l}`} aria-hidden="true" />
              {NAMES[l]}
              {counts && <span className="num">{counts[l] ?? 0}</span>}
            </button>
          );
        })}
      </div>
      {counts && scope && <span className="levels-scope">{scope}</span>}
    </div>
  );
}
