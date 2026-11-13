"use client";

import { useLayoutEffect, useRef } from "react";

/** The text with each [placeholder] wrapped in <mark> (for a highlight layer behind a textarea). */
export function markPlaceholders(text: string) {
  return text.split(/(\[[^\]\n]+\])/g).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

/**
 * A growing textarea (no inner scrolling) with every [placeholder] highlighted in place, using the
 * same mirror-layer trick as the resume document: an invisible copy of the text sits in the same grid
 * cell behind the transparent textarea and paints a highlight under each placeholder. The structure
 * never changes while typing, so the iOS keyboard stays up.
 *
 * `boxClassName` styles the box (border, padding, font, min height) and is applied to both layers so
 * they wrap identically.
 */
export function PlaceholderTextarea({
  boxClassName, className = "", ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { boxClassName: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight + 2}px`; // + borders
  });
  return (
    <div className="grid w-full min-w-0">
      <div aria-hidden className={`ph-mirror col-start-1 row-start-1 ${boxClassName}`}>
        {markPlaceholders(String(props.value ?? ""))}
        {"​"}
      </div>
      <textarea
        ref={ref}
        {...props}
        className={`ph-field relative col-start-1 row-start-1 resize-none overflow-hidden bg-transparent ${boxClassName} ${className}`}
      />
    </div>
  );
}
