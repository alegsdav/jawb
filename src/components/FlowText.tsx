"use client";

import { Fragment } from "react";

/** Milliseconds between two words of a FlowText. */
export const WORD_MS = 28;

/** When a FlowText that starts at `start` ms has shown its last word. */
export function flowEndMs(text: string, start: number): number {
  return start + text.split(" ").length * WORD_MS;
}

/**
 * A paragraph whose words fade in one after another (the Overview's verdict). The words are real text, so
 * they select and copy normally; the paragraph's aria-label carries the whole sentence for screen readers.
 * With `animate` off it's plain text, so a revisited tab shows it at once.
 */
export function FlowText({ text, animate, start = 0, className = "" }: { text: string; animate: boolean; start?: number; className?: string }) {
  if (!animate) return <p className={className}>{text}</p>;
  return (
    <p aria-label={text} className={className}>
      {text.split(" ").map((word, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span aria-hidden="true" className="ai-fade inline-block" style={{ animationDelay: `${start + i * WORD_MS}ms` }}>
            {word}
          </span>
        </Fragment>
      ))}
    </p>
  );
}
