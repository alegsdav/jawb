"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { pasteOnlySite } from "@/lib/jobsites";
import { postApi } from "@/lib/api";
import { Bookmarklet } from "./Bookmarklet";

const URL_RE = /^https?:\/\/\S+$/i;
const PENDING_KEY = "jp:pending-capture";

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

/**
 * "Add a job": one box for a link or a pasted description. For sites the server can't read
 * (LinkedIn, Handshake, Workday…) it switches to two fields: the link plus the pasted description.
 */
export function AddJobForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"one" | "paste">("one");
  const [input, setInput] = useState("");
  const [link, setLink] = useState("");
  const [desc, setDesc] = useState("");
  /** Why we're in paste mode. */
  const [reason, setReason] = useState<{ site?: string; captured?: string; failed?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const c = takeCapture();
    if (!c) return;
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
  }

  async function send(body: { url?: string; text?: string }, fromUrl: string | null) {
    setBusy(true);
    setError("");
    const r = await postApi<{ id: string }>("/api/intake", body);
    if (r.data?.id) {
      router.push(`/jobs/${r.data.id}`);
      return;
    }
    setBusy(false);
    if (r.pasteOnly) {
      toPaste(fromUrl ?? link, { site: r.pasteOnly });
    } else if (fromUrl && mode === "one") {
      // Couldn't read the page: keep the link and ask for the text instead.
      toPaste(fromUrl, { failed: true });
      setError(r.error ?? "Couldn't read that page.");
    } else {
      setError(r.error ?? "Something went wrong.");
    }
  }

  function submit() {
    if (busy) return;
    if (mode === "paste") {
      const url = link.trim();
      if (url && !URL_RE.test(url)) return setError("The job link should start with https://");
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
      if (/pdf|word|officedocument/.test(file.type)) {
        setError("PDF/Word files aren't supported yet. Open the file and paste the text instead.");
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
        <h1 className="text-lg font-semibold">Add a job</h1>
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
        ) : (
          <p className="text-sm text-muted">Paste the job description below. The link is kept so you can find it again.</p>
        )}
      </div>

      {mode === "one" ? (
        <textarea
          className="input w-full h-24 sm:h-28"
          placeholder="https://job-boards.greenhouse.io/… or paste the description"
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
              onChange={(e) => setLink(e.target.value)}
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

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="btn btn-primary py-2 w-full sm:w-auto"
          disabled={busy || (mode === "one" ? !input.trim() : !desc.trim())}
          onClick={submit}
        >
          {busy ? "Reading job…" : mode === "one" && isUrl && !site ? "Fetch job" : site && mode === "one" ? "Next" : "Add job"}
        </button>
        {mode === "paste" && (
          <button className="btn py-2 w-full sm:w-auto" onClick={reset} disabled={busy}>
            Cancel
          </button>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>

      <Bookmarklet />
    </div>
  );
}
