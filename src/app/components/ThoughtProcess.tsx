"use client";

import { ChevronDown } from "lucide-react";
import type { AnswerProcess } from "@/memory/types.ts";

/** "4.2 s", "41 s", "1 min 8 s". */
export function duration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  return `${Math.floor(seconds / 60)} min${rest ? ` ${rest} s` : ""}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What the agent did for this answer: each search, the pages read, repair
 * rounds and the final check, with when each happened. Closed by default.
 */
export function ThoughtProcess({ process }: { process: AnswerProcess }) {
  const meta = [duration(process.ms), process.searches > 0 && plural(process.searches, "search"), process.pages > 0 && plural(process.pages, "page")]
    .filter(Boolean)
    .join(" · ");
  return (
    <details className="process">
      <summary>
        <span className="process-title">Thought process</span>
        <span className="process-meta">{meta}</span>
        <ChevronDown className="process-chevron" size={16} aria-hidden="true" />
      </summary>
      <ol className="process-steps">
        {process.steps.map((step, i) => (
          <li key={`${step.ms}-${i}`}>
            <span>{step.text}</span>
            <span className="step-time">{duration(step.ms)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
