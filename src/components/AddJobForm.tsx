"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { pasteOnlySite } from "@/lib/jobsites";
import { postApi } from "@/lib/api";
import { findDuplicateJob } from "@/lib/status";
import type { Job } from "@/lib/types";
import { Bookmarklet } from "./Bookmarklet";

const URL_RE = /^https?:\/\/\S+$/i;
const PENDING_KEY = "jp:pending-capture";

/** A full http(s) address that the browser can parse (the server checks again). */
function isHttpUrl(s: string): boolean {
  if (!URL_RE.test(s)) return false;
  try {
    return /^https?:$/.test(new URL(s).protocol);
  } catch {
    return false;
  }
}

type Capture = { url?: string; title?: string; text?: string };

function parseCapture(raw: string): Capture | null {
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Capture;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/**
 * If the page was opened by the bookmarklet (`#add=…`), keep the capture for after a redirect
 * (e.g. onboarding sends a brand-new user to /resume first).
 */
export function stashCapture() {
  try {
    if (location.hash.startsWith("#add=")) sessionStorage.setItem(PENDING_KEY, location.hash.slice(5));
  } catch {
    /* storage unavailable: the capture is lost, the user can click the bookmarklet again */
  }
}

/** Read (and clear) a bookmarklet capture from the URL hash or from a stash left before a redirect. */
function takeCapture(): Capture | null {
  if (location.hash.startsWith("#add=")) {
    const c = parseCapture(location.hash.slice(5));
    history.replaceState(history.state, "", location.pathname + location.search);
    return c;
  }
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (raw) {
      sessionStorage.removeItem(PENDING_KEY);
      return parseCapture(raw);
    }
  } catch {
    /* ignore */
  }
  return null;
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
 * With `collapsible` (the job list once it has jobs) it starts as a one-line "+ Add job" button so
 * the job list starts on the first screen of a phone; a bookmarklet capture opens it.
 *
 * Adding a job that's already on the list (same link, or same company and title as the server reads
 * them) asks "You already added this job (added Nov 13). Open it instead?" with Open it / Add anyway.
 * `existing` lets a same-link duplicate be caught before anything is fetched.
 */
export function AddJobForm({ collapsible = false, existing = [] }: { collapsible?: boolean; existing?: readonly ExistingJob[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"one" | "paste">("one");
  const [input, setInput] = useState("");
  const [link, setLink] = useState("");
  const [desc, setDesc] = useState("");
  /** Why we're in paste mode. `failed` carries the message, shown once as the instruction. */
  const [reason, setReason] = useState<{ site?: string; captured?: string; failed?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  /** A job already on the list that matches what's being added. */
  const [dup, setDup] = useState<{ id: string; created_at: string; body: IntakeBody; fromUrl: string | null } | null>(null);

  useEffect(() => {
    const c = takeCapture();
    if (!c) return;
    setOpen(true);
    setMode("paste");
    setLink(c.url ?? "");
    setDesc(c.text ?? "");
    setReason({ captured: c.title?.trim() || c.url || "the page" });
  }, []);

  function toPaste(url: string, why: NonNullable<typeof reason>) {
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
          ? `${site} needs a login: next you'll paste the description.`
          : isUrl
            ? "Reads the posting from the link."
            : "Uses the pasted description.";

  if (collapsible && !open) {
    return (
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Jobs</h1>
        <p className="hidden md:block text-sm text-muted truncate">Paste a link or a description, or use the bookmarklet.</p>
        <button className="btn btn-primary ml-auto min-h-10 px-4" aria-expanded={false} onClick={() => setOpen(true)}>
          ＋ Add job
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`card p-4 space-y-3 transition ${dragging ? "border-accent ring-2 ring-accent/30" : ""}`}
    >
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Add a job</h1>
          {collapsible && (
            <button
              className="btn btn-sm ml-auto min-h-9"
              aria-expanded
              onClick={() => {
                setOpen(false);
                setError("");
                setDup(null);
              }}
              disabled={busy}
            >
              Close
            </button>
          )}
        </div>
        {mode === "one" ? (
          <p className="text-sm text-muted">
            Paste a job link (Greenhouse, Lever, Ashby and most company pages work) or the full description.
          </p>
        ) : reason?.captured ? (
          <p className="text-sm text-good">
            Captured from <strong className="break-words">{reason.captured}</strong> — review and click Add job.
          </p>
        ) : reason?.site ? (
          <p className="text-sm text-muted">
            <strong className="text-fg">{reason.site} needs a login</strong>, so the app can&apos;t read that link. Open the
            posting, copy the job description, and paste it below. The link is kept so you can find it again.
          </p>
        ) : reason?.failed ? (
          // The fetch failed: its message is the instruction, shown once (not repeated by the buttons).
          <p role="alert" className="text-sm text-bad">{reason.failed}</p>
        ) : (
          <p className="text-sm text-muted">Paste the job description below. The link is kept so you can find it again.</p>
        )}
      </div>

      {mode === "one" ? (
        <textarea
          className="input w-full h-24 sm:h-28"
          aria-label="Job link or description"
          autoFocus={collapsible}
          placeholder="https://job-boards.greenhouse.io/… or paste the description"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setDup(null);
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
              className="input w-full"
              placeholder="https://www.linkedin.com/jobs/view/…"
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setDup(null);
              }}
            />
          </label>
          <label className="block space-y-1">
            <span className="label">Paste the job description</span>
            <textarea
              className="input w-full h-40 sm:h-48"
              placeholder="Select the whole posting on the job site, copy, and paste it here"
              value={desc}
              autoFocus={!reason?.captured}
              onChange={(e) => setDesc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
          </label>
        </div>
      )}

      {/* Messages sit above the buttons, so on a phone they're seen before the full-width button. */}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}

      {dup ? (
        <div role="alert" className="rounded-lg border border-ok/50 bg-ok-bg p-3 space-y-2">
          <p className="text-sm">
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            className="btn btn-primary py-2 w-full sm:w-auto"
            disabled={busy || (mode === "one" ? !input.trim() : !desc.trim())}
            onClick={submit}
          >
            {busy ? (isUrl && mode === "one" ? "Reading job…" : "Adding…") : "Add job"}
          </button>
          {mode === "paste" && (
            <button className="btn py-2 w-full sm:w-auto" onClick={reset} disabled={busy}>
              Cancel
            </button>
          )}
          {hint && !busy && <span className="text-xs text-muted">{hint}</span>}
        </div>
      )}

      <Bookmarklet />
    </div>
  );
}
