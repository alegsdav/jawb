"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { pasteOnlySite } from "@/lib/jobsites";
import { postApi } from "@/lib/api";
import { findDuplicateJob } from "@/lib/status";
import { useFocusTrap } from "@/lib/useFocusTrap";
import type { Job } from "@/lib/types";
import { LinkIcon, PlusIcon, SparkIcon } from "./icons";
import { Panel, PanelHeader, Pill } from "./dashboard/ui";

const URL_RE = /^https?:\/\/\S+$/i;

/** A full http(s) address that the browser can parse (the server checks again). */
function isHttpUrl(s: string): boolean {
  if (!URL_RE.test(s)) return false;
  try {
    return /^https?:$/.test(new URL(s).protocol);
  } catch {
    return false;
  }
}

/** An existing job, for the duplicate check. */
export type ExistingJob = Pick<Job, "id" | "url" | "company" | "title" | "created_at">;

type IntakeBody = { url?: string; text?: string };

/** "Nov 13" for a timestamp, in the user's time zone ("" if it can't be read). */
function addedOn(createdAt: string): string {
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * "Add a job": one box for a link or a pasted description. For sites the server can't read
 * (LinkedIn, Handshake, Workday…) it switches to two fields: the link plus the pasted description.
 *
 * Adding a job that's already on the list (same link, or same company and title as the server reads
 * them) asks "You already added this job (added Nov 13). Open it instead?" with Open it / Add anyway.
 * `existing` lets a same-link duplicate be caught before anything is fetched.
 */
export function AddJobForm({ existing = [] }: { existing?: readonly ExistingJob[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"one" | "paste">("one");
  const [input, setInput] = useState("");
  const [link, setLink] = useState("");
  const [desc, setDesc] = useState("");
  /** Why we're in paste mode. `failed` carries the message, shown once as the instruction. */
  const [reason, setReason] = useState<{ site?: string; failed?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  /** A job already on the list that matches what's being added. */
  const [dup, setDup] = useState<{ id: string; created_at: string; body: IntakeBody; fromUrl: string | null } | null>(null);

  // The box grows with what's pasted, from one line up to its old fixed height (then it scrolls).
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [input, mode]);

  // The "Oops" window for a closed posting (or a list of openings): nothing was added, and closing it clears the box.
  const [closedMsg, setClosedMsg] = useState<string | null>(null);
  const closedOpen = closedMsg !== null;
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  /** Set on close, so focus goes back to the box once it's rendered again. */
  const restoreFocus = useRef(false);
  useFocusTrap(panel, closedOpen);

  const closeOops = useCallback(() => {
    setClosedMsg(null);
    setMode("one");
    setInput("");
    setLink("");
    setDesc("");
    setReason(null);
    setError("");
    setDup(null);
    restoreFocus.current = true;
  }, []);

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

  function toPaste(url: string, why: NonNullable<typeof reason>) {
    setError("");
    setMode("paste");
    setLink(url);
    setDesc("");
    setReason(why);
  }

  function reset() {
    setMode("one");
    setInput(link);
    setLink("");
    setDesc("");
    setReason(null);
    setError("");
    setDup(null);
  }

  async function send(body: IntakeBody, fromUrl: string | null, force = false) {
    setError("");
    setDup(null);
    if (!force && body.url) {
      const same = findDuplicateJob(existing, { url: body.url });
      if (same) return setDup({ id: same.id, created_at: same.created_at, body, fromUrl });
    }
    setBusy(true);
    const r = await postApi<{ id: string }>("/api/intake", force ? { ...body, force: true } : body);
    if (r.data?.id) {
      router.push(`/jobs/${r.data.id}`);
      return;
    }
    setBusy(false);
    if (r.closed) {
      // Closed, or a list of openings: nothing was saved. Said in the window, not the line under the button.
      setClosedMsg(r.error ?? "This link doesn't lead to an open job posting.");
      return;
    }
    if (r.duplicate) {
      setDup({ ...r.duplicate, body, fromUrl });
    } else if (r.pasteOnly) {
      toPaste(fromUrl ?? link, { site: r.pasteOnly });
    } else if (fromUrl && mode === "one") {
      // Couldn't read the page: keep the link and ask for the text instead (the message says so once).
      toPaste(fromUrl, { failed: r.error ?? "Couldn't read that page. Paste the job description and keep the link." });
    } else {
      setError(r.error ?? "Something went wrong.");
    }
  }

  function submit() {
    if (busy) return;
    if (mode === "paste") {
      const url = link.trim();
      if (url && !isHttpUrl(url)) return setError("That doesn't look like a link. Paste the full address starting with https://");
      if (!desc.trim()) return setError("Paste the job description first.");
      return send({ ...(url ? { url } : {}), text: desc.trim() }, null);
    }
    const value = input.trim();
    if (!value) return;
    if (URL_RE.test(value)) {
      const site = pasteOnlySite(value);
      if (site) return toPaste(value, { site });
      return send({ url: value }, value);
    }
    // One word with no spaces is never a description: a half-typed link ("http//x", "www.acme") or a stray
    // word would otherwise create an "Untitled role" job and spend an analysis.
    if (!/\s/.test(value)) {
      const looksLikeLink = /^http/i.test(value) || value.startsWith("www.") || /[./]/.test(value);
      return setError(
        looksLikeLink
          ? "That doesn't look like a link. Paste the full address starting with https://"
          : "Paste a link to the posting or the full job description.",
      );
    }
    return send({ text: value }, null);
  }

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
      if (URL_RE.test(dropped)) setLink(dropped);
      else setDesc(dropped);
    } else setInput(dropped);
  }

  const isUrl = URL_RE.test(input.trim());
  const site = isUrl ? pasteOnlySite(input.trim()) : null;
  /** What "Add job" will do, under the button. */
  const hint =
    mode === "paste"
      ? link.trim()
        ? "Saves the description and keeps the link."
        : ""
      : !input.trim()
        ? ""
        : site
          ? `${site} needs a login: paste the text next.`
          : isUrl
            ? "Reads the posting from the link."
            : "Uses the pasted description.";

  return (
    <Panel
      as="div"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`space-y-3 text-[13px] transition-colors motion-reduce:transition-none ${dragging ? "border-dashed border-fg/30 bg-surface-2/40" : ""}`}
    >
      <div className="space-y-1.5">
        <PanelHeader icon={<LinkIcon />} tint="green" title="Add a job" />
        {mode === "one" ? (
          <p className="text-[13px] text-muted">Paste a job link or the full description.</p>
        ) : reason?.site ? (
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
          className="input block w-full min-h-[76px] resize-none overflow-y-auto rounded-xl bg-surface-2/50 text-[13px] leading-5 focus:bg-surface max-h-24 sm:max-h-28"
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
      ) : null}
      {mode === "one" ? (
        <ul aria-label="Supported sources" className="-mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted">
          {["Greenhouse", "Lever", "Ashby", "any page"].map((s) => (
            <li key={s} className="rounded-full bg-surface-2 px-2 py-0.5">{s}</li>
          ))}
        </ul>
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
    </Panel>
  );
}

/** Placeholder rows for the job matches to come: job-card shapes in waiting (grey, not data, not animated). */
const PREVIEW_ROWS = [
  { title: "w-3/4", sub: "w-1/2" },
  { title: "w-2/3", sub: "w-2/5" },
  { title: "w-4/5", sub: "w-1/3" },
];

/** Where matching jobs will be listed. For now a template of empty cards, marked Coming soon. */
function JobMatchesPreview() {
  return (
    <section aria-labelledby="job-matches-heading" className="space-y-2.5 border-t border-border pt-4">
      <PanelHeader
        id="job-matches-heading"
        icon={<SparkIcon />}
        tint="violet"
        title="Matches for you"
        action={<Pill tint="violet">Coming soon</Pill>}
      />
      <ul aria-hidden className="space-y-2">
        {PREVIEW_ROWS.map((r, i) => (
          // Phones: two cards, so the template doesn't push the real lists far down.
          <li key={i} className={`items-center gap-3 rounded-xl border border-border p-2.5 ${i < 2 ? "flex" : "hidden lg:flex"}`}>
            <span className="h-9 w-9 shrink-0 rounded-lg bg-fg/[0.06]" />
            <span className="min-w-0 flex-1 space-y-1.5">
              <span className={`block h-2.5 rounded-full bg-fg/[0.09] ${r.title}`} />
              <span className={`block h-2 rounded-full bg-fg/[0.05] ${r.sub}`} />
            </span>
            <span className="h-5 w-12 shrink-0 rounded-full bg-fg/[0.05]" />
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">Internships that fit your resume will show up here.</p>
    </section>
  );
}
