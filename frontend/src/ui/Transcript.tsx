import { useEffect, useRef } from "react";
import type { TranscriptLine } from "./useCoach";

export function Transcript({
  lines,
  empty,
}: {
  lines: TranscriptLine[];
  empty: string;
}) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <ol
      className="transcript"
      ref={ref}
      aria-live="polite"
      aria-label="Transcript"
    >
      {lines.length === 0 && <li className="transcript-empty">{empty}</li>}
      {lines.map((line) => (
        <li key={line.id} className={`line line-${line.role}`}>
          <span className="line-who">
            {line.role === "user" ? "You" : "Coach"}
          </span>
          <span className="line-text">{line.content}</span>
        </li>
      ))}
    </ol>
  );
}
