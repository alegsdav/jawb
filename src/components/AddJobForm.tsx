"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { addedOn, isLinkInput, type ExistingJob } from "@/lib/addJob";
import { useAddJob } from "@/lib/useAddJob";
import { PlusIcon } from "./icons";

export type { ExistingJob } from "@/lib/addJob";

/**
 * "Add a job": one box for a link or a pasted description. For sites the server can't read (LinkedIn, Handshake,
 * Workday…) it switches to two fields: the link plus the pasted description. The flow itself is `useAddJob`, shared
 * with the sidebar's Add job box.
 *
 * Adding a job that's already on the list (same link, or same company and title as the server reads
 * them) asks "You already added this job (added Nov 13). Open it instead?" with Open it / Add anyway.
 * `existing` lets a same-link duplicate be caught before anything is fetched.
 */
export function AddJobForm({ existing = [] }: { existing?: readonly ExistingJob[] }) {
  const router = useRouter();
  const {
    mode, input, setInput, link, setLink, desc, setDesc, reason, busy, error, setError, dup, setDup,
    closedMsg, hint, isUrl, submit, send, reset, clear,
  } = useAddJob({ existing });
  const [dragging, setDragging] = useState(false);

  // The box grows with what's pasted, from one line up to its old fixed height (then it scrolls).
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [input, mode]);

  // The "Oops" window for a closed posting (or a list of openings): nothing was added, and closing it clears the box.
  const closedOpen = closedMsg !== null;
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  /** Set on close, so focus goes back to the box once it's rendered again. */
  const restoreFocus = useRef(false);
  useFocusTrap(panel, closedOpen);

  const closeOops = useCallback(() => {
    clear();
    restoreFocus.current = true;
  }, [clear]);

  useEffect(() => {
    if (!closedOpen) {
      if (restoreFocus.current) {
        restoreFocus.current = false;
        box.current?.focus();
      }
      return;
    }
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOops();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closedOpen, closeOops]);

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      // A PDF can't be read as text in the browser; text files and dropped links/selections can.
      if (!/^text\//.test(file.type) && !/\.(txt|md)$/i.test(file.name)) {
        setError("Drop a link or text; for a PDF, open it and paste the text.");
        return;
      }
      const text = await file.text();
      if (mode === "paste") setDesc(text);
      else setInput(text);
      return;
    }
    const dropped = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).trim();
    if (!dropped) return;
    if (mode === "paste") {
      if (isLinkInput(dropped)) setLink(dropped);
      else setDesc(dropped);
    } else setInput(dropped);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`rounded-xl bg-surface p-4 space-y-3 border text-[13px] ${dragging ? "border-fg/40" : "border-border"}`}
    >
      <div className="space-y-1">
        <h2 className="text-[15px] font-semibold">Jobs</h2>
        {mode === "one" ? null : reason?.site ? (
          <p className="text-[13px] text-muted">
            <strong className="text-fg">{reason.site} needs a login</strong>, so the app can&apos;t read that link. Open the
            posting, copy the job description, and paste it below. The link is kept so you can find it again.
          </p>
        ) : reason?.failed ? (
          // The fetch failed: its message is the instruction, shown once (not repeated by the buttons).
          <p role="alert" className="text-[13px] text-bad">{reason.failed}</p>
        ) : (
          <p className="text-[13px] text-muted">Paste the job description below. The link is kept so you can find it again.</p>
        )}
      </div>

      {mode === "one" ? (
        <textarea
          ref={box}
          rows={1}
          className="input block w-full resize-none overflow-y-auto rounded-lg text-[13px] leading-5 max-h-24 sm:max-h-28"
          aria-label="Job link or description"
          placeholder="Job link or description"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setDup(null);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
      ) : (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="label">Job link</span>
            <input
              type="url"
              inputMode="url"
              className="input w-full rounded-lg text-[13px]"
              placeholder="https://www.linkedin.com/jobs/view/…"
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setDup(null);
                setError("");
              }}
            />
          </label>
          <label className="block space-y-1">
            <span className="label">Paste the job description</span>
            <textarea
              className="input w-full h-40 sm:h-48 resize-none rounded-lg text-[13px]"
              placeholder="Select the whole posting on the job site, copy, and paste it here"
              value={desc}
              autoFocus
              onChange={(e) => {
                setDesc(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
          </label>
        </div>
      )}

      {dup ? (
        <div role="alert" className="rounded-lg border border-ok/50 bg-ok-bg p-3 space-y-2">
          <p className="text-[13px]">
            You already added this job{addedOn(dup.created_at) ? ` (added ${addedOn(dup.created_at)})` : ""}. Open it instead?
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary py-2 flex-1 sm:flex-none" onClick={() => router.push(`/jobs/${dup.id}`)}>
              Open it
            </button>
            <button className="btn py-2 flex-1 sm:flex-none" disabled={busy} onClick={() => send(dup.body, dup.fromUrl, true)}>
              Add anyway
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {/* The full width of the box above it: black with white text, the one obvious action here. */}
          <button
            type="button"
            className="flex h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-fg text-[13px] font-medium text-surface transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
            disabled={busy || (mode === "one" ? !input.trim() : !desc.trim())}
            onClick={submit}
          >
            {!busy && <PlusIcon className="h-4 w-4" />}
            {busy ? (isUrl && mode === "one" ? "Reading job…" : "Adding…") : "Add job"}
          </button>
          {mode === "paste" && (
            <button type="button" className="h-8 w-full cursor-pointer rounded-lg text-[13px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50" onClick={reset} disabled={busy}>
              Cancel
            </button>
          )}
          {/* One line kept under the button for the hint or an error, so neither moves the button, and a hint showing up
              as you type doesn't push the list below down. */}
          <p role={error ? "alert" : undefined} className={`min-h-4 text-xs leading-4 ${error ? "text-bad" : "text-muted"}`}>
            {error || (busy ? "" : hint)}
          </p>
        </div>
      )}

      <JobMatchesPreview />

      {closedOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => e.target === e.currentTarget && closeOops()}
        >
          <div ref={panel} className="mx-4 w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-5 shadow-xl">
            <div className="space-y-1.5">
              <h2 id={titleId} className="text-[15px] font-semibold">
                {/* LISTING_MESSAGE (fetch-job.ts): the link is a list of openings rather than a closed job. */}
                {closedMsg?.startsWith("That link goes to a list") ? "Oops, that's not one job" : "Oops, this posting is closed"}
              </h2>
              <p className="text-[13px] text-muted">{closedMsg}</p>
            </div>
            <button
              ref={okRef}
              type="button"
              className="flex h-10 w-full cursor-pointer items-center justify-center rounded-lg bg-fg text-[13px] font-medium text-surface transition-opacity hover:opacity-90 motion-reduce:transition-none"
              onClick={closeOops}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Placeholder rows for the job matches to come: grey bars of varied widths, not data, and not animated. */
const PREVIEW_ROWS = [
  { title: "w-3/4", sub: "w-1/2" },
  { title: "w-2/3", sub: "w-2/5" },
  { title: "w-4/5", sub: "w-1/3" },
  { title: "w-3/5", sub: "w-1/2" },
  { title: "w-2/3", sub: "w-2/5" },
];

/** Where matching jobs will be listed. For now a template of empty cards, marked Coming soon. */
function JobMatchesPreview() {
  return (
    <section aria-labelledby="job-matches-heading" className="space-y-2.5 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="job-matches-heading" className="text-[13px] font-medium">Matches for you</h3>
        <span className="rounded-full bg-fg/[0.06] px-2 py-0.5 text-[11px] text-muted">Coming soon</span>
      </div>
      <ul aria-hidden className="space-y-2">
        {PREVIEW_ROWS.map((r, i) => (
          // Phones: two cards, so the template doesn't push the real lists far down.
          <li key={i} className={`items-center gap-3 rounded-lg border border-border p-2.5 ${i < 2 ? "flex" : "hidden lg:flex"}`}>
            <span className="h-8 w-8 shrink-0 rounded-md bg-fg/[0.06]" />
            <span className="min-w-0 flex-1 space-y-1.5">
              <span className={`block h-2.5 rounded-full bg-fg/[0.09] ${r.title}`} />
              <span className={`block h-2 rounded-full bg-fg/[0.05] ${r.sub}`} />
            </span>
            <span className="h-5 w-10 shrink-0 rounded-full bg-fg/[0.05]" />
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">Internships that fit your resume will show up here.</p>
    </section>
  );
}
