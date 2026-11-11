"use client";

import { Check } from "lucide-react";

/** The live steps while a turn runs, then a placeholder for the answer. */
export function Working({ steps }: { steps: string[] }) {
  const shown = steps.length > 0 ? steps : ["Reading your message"];
  return (
    <section className="card" aria-live="polite" aria-busy="true" aria-label="Working on your answer">
      <ol className="steps">
        {shown.map((step, i) => {
          const current = i === shown.length - 1;
          return (
            <li className="step" data-current={current} key={`${step}-${i}`}>
              {current ? <span className="spinner" aria-hidden="true" /> : <Check size={16} strokeWidth={2.6} aria-hidden="true" />}
              {step}
            </li>
          );
        })}
      </ol>
      <div className="skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}
