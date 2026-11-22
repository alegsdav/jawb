"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type TextareaHTMLAttributes } from "react";
import type { Job } from "@/lib/types";
import { formatPosting, splitLinks } from "@/lib/postingFormat";

/** Text with its bare URLs as links. Plain text only: no HTML from the posting is ever rendered. */
function Linked({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((piece, i) =>
        piece.kind === "link" ? (
          <a key={i} href={piece.href} target="_blank" rel="noreferrer" className="break-all underline underline-offset-2 hover:text-muted">
            {piece.text}
          </a>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </>
  );
}

function fitHeight(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/** A borderless textarea that grows with its text, so the page reads as one document (no inner scrolling). */
function GrowTextarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => fitHeight(ref.current));
  useEffect(() => {
    const onResize = () => fitHeight(ref.current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <textarea
      ref={ref}
      rows={1}
      {...props}
      className={`block w-full resize-none overflow-hidden border-0 bg-transparent p-0 placeholder:text-muted focus:outline-none ${className}`}
    />
  );
}

const HEADING = "mt-6 text-[15px] font-semibold text-fg first:mt-0";
const PARA = "mt-2 text-[14px] leading-relaxed text-fg";

/**
 * The Posting tab as a document: the link, then the description laid out by formatPosting, then the notes.
 * "Edit" switches to borderless fields (the URL, the description, the notes) and "Done" back. An empty
 * description opens straight in edit mode.
 */
export function PostingView({ job, onPatch }: { job: Job; onPatch: (p: Partial<Job>) => void }) {
  const [editing, setEditing] = useState(() => !job.description.trim());
  const blocks = useMemo(() => formatPosting(job.description), [job.description]);
  const url = job.url.trim();
  const href = url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`) : "";
  const notes = job.notes.split("\n").map((n) => n.trim()).filter(Boolean);

  return (
    <div>
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              type="url"
              value={job.url}
              placeholder="Posting URL"
              aria-label="Posting URL"
              className="block w-full min-w-0 border-0 bg-transparent p-0 text-[13px] text-muted placeholder:text-muted focus:outline-none"
              onChange={(e) => onPatch({ url: e.target.value })}
            />
          ) : (
            href && (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                title={href}
                className="flex min-w-0 items-center gap-1 text-[13px] text-muted underline underline-offset-2 hover:text-fg"
              >
                <span className="min-w-0 truncate">{url}</span>
                <span aria-hidden className="shrink-0">↗</span>
              </a>
            )
          )}
        </div>
        <button
          type="button"
          className="shrink-0 py-1 text-xs text-muted underline underline-offset-2 hover:text-fg"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {editing ? (
        <div className="mt-4">
          <GrowTextarea
            aria-label="Job description"
            placeholder="Paste the job description here."
            value={job.description}
            className="min-h-[40vh] text-[14px] leading-relaxed text-fg"
            onChange={(e) => onPatch({ description: e.target.value })}
          />
          <h3 className={HEADING}>Notes</h3>
          <GrowTextarea
            aria-label="Notes"
            placeholder="Notes: referral, recruiter name…"
            value={job.notes}
            className="mt-2 text-[14px] leading-relaxed text-fg"
            onChange={(e) => onPatch({ notes: e.target.value })}
          />
        </div>
      ) : (
        <div className="mt-4">
          {blocks.map((b, i) =>
            b.kind === "heading" ? (
              <h3 key={i} className={HEADING}>
                <Linked text={b.text} />
              </h3>
            ) : b.kind === "list" ? (
              <ul key={i} className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-fg">
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Linked text={item} />
                  </li>
                ))}
              </ul>
            ) : (
              <p key={i} className={PARA}>
                <Linked text={b.text} />
              </p>
            ),
          )}
          {blocks.length === 0 && <p className="text-[14px] text-muted">No description yet.</p>}
          {notes.length > 0 && (
            <>
              <h3 className={HEADING}>Notes</h3>
              {notes.map((n, i) => (
                <p key={i} className={PARA}>
                  <Linked text={n} />
                </p>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
