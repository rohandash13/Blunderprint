import { useEffect, useRef } from "react";
import type { TranscriptLine } from "./useCoach";
import { PATTERN_LABELS } from "../coach/patternLabels";

const habitNames = Object.values(PATTERN_LABELS).map(p => p.name.toLowerCase());
const inline = (text: string) => text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
  part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
);

/** Display-only formatting: no HTML injection and no markup needed in spoken output. */
function CoachText({ text }: { text: string }) {
  const blocks: ({ paragraph: string } | { habits: { name: string; detail: string }[] })[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/^\s*(?:\d+[.)](?:\s+|$)|[-•]\s+)/, "").replace(/\s+\d+[.)]\s*$/, "").trim();
    if (!line) continue;
    const match = line.match(/^(?:\*\*([^*]+)\*\*:?\s*|([^:]{2,50}):\s+)(.+)$/);
    const name = match?.[1] ?? match?.[2];
    if (match && name && (match[1] || habitNames.includes(name.toLowerCase()))) {
      const habit = { name: name.replace(/:$/, ""), detail: match[3] };
      const last = blocks.at(-1);
      if (last && "habits" in last) last.habits.push(habit);
      else blocks.push({ habits: [habit] });
    } else blocks.push({ paragraph: line });
  }
  return <div className="line-text">{blocks.map((block, i) => "paragraph" in block
    ? <p key={i}>{inline(block.paragraph)}</p>
    : <ul key={i} className="coach-habits" aria-label="Habits">{block.habits.map((habit, j) =>
      <li key={j}><strong>{habit.name}</strong><span>{inline(habit.detail)}</span></li>,
    )}</ul>,
  )}</div>;
}

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
  const turns: TranscriptLine[] = [];
  for (const line of lines) {
    const previous = turns.at(-1);
    if (previous && previous.role !== "user" && line.role !== "user") previous.content += `\n${line.content}`;
    else turns.push({ ...line });
  }
  return (
    <ol
      className="transcript"
      ref={ref}
      aria-live="polite"
      aria-label="Transcript"
    >
      {lines.length === 0 && <li className="transcript-empty">{empty}</li>}
      {turns.map((line) => (
        <li key={line.id} className={`line line-${line.role}`}>
          <span className="line-who">
            {line.role === "user" ? "You" : "Coach"}
          </span>
          {line.role === "user" ? <span className="line-text">{line.content}</span> : <CoachText text={line.content} />}
        </li>
      ))}
    </ol>
  );
}
