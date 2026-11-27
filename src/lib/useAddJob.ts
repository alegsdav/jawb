"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { postApi } from "@/lib/api";
import { findDuplicateJob } from "@/lib/status";
import {
  addHint, classifyOneBox, isLinkInput, pasteBody, type ExistingJob, type IntakeBody, type PasteReason,
} from "@/lib/addJob";

/** A job already on the list that the entry matches: waiting for "Open it" or "Add anyway". */
export type AddJobDup = { id: string; created_at: string; body: IntakeBody; fromUrl: string | null };

type Options = {
  /** Jobs already on the list, for the duplicate check before anything is fetched (the server checks again). */
  existing?: readonly ExistingJob[];
  /** After a job is added: the router has been told to open it. */
  onAdded?: (id: string) => void;
};

/**
 * The add-a-job flow shared by the dashboard's Jobs box and the sidebar's Add job box: one entry for a link or a
 * pasted description; for a site the server can't read, a paste step with the link kept; duplicate detection;
 * the closed-posting message; errors. State and actions only: each component draws its own UI.
 */
export function useAddJob({ existing = [], onAdded }: Options = {}) {
  const router = useRouter();
  const [mode, setMode] = useState<"one" | "paste">("one");
  const [input, setInput] = useState("");
  const [link, setLink] = useState("");
  const [desc, setDesc] = useState("");
  const [reason, setReason] = useState<PasteReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dup, setDup] = useState<AddJobDup | null>(null);
  /** The posting is closed, or the link is a list of openings: nothing was added. */
  const [closedMsg, setClosedMsg] = useState<string | null>(null);

  function toPaste(url: string, why: PasteReason) {
    setError("");
    setMode("paste");
    setLink(url);
    setDesc("");
    setReason(why);
  }

  /** Back to the one box, keeping the link as the entry (the paste step's Cancel). */
  function reset() {
    setMode("one");
    setInput(link);
    setLink("");
    setDesc("");
    setReason(null);
    setError("");
    setDup(null);
  }

  /** Everything cleared, nothing kept: after a job is added, or to close a notice. */
  const clear = useCallback(() => {
    setClosedMsg(null);
    setMode("one");
    setInput("");
    setLink("");
    setDesc("");
    setReason(null);
    setError("");
    setDup(null);
    setBusy(false);
  }, []);

  async function send(body: IntakeBody, fromUrl: string | null, force = false): Promise<void> {
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
      onAdded?.(r.data.id);
      return;
    }
    setBusy(false);
    if (r.closed) {
      // Closed, or a list of openings: nothing was saved. Said in the notice, not the line under the button.
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

  /** Enter: send what's in the box (or the paste step). */
  function submit() {
    if (busy) return;
    if (mode === "paste") {
      const p = pasteBody(link, desc);
      if (!p.ok) return setError(p.message);
      return send(p.body, null);
    }
    const c = classifyOneBox(input);
    switch (c.kind) {
      case "empty":
        return;
      case "site":
        return toPaste(c.url, { site: c.site });
      case "url":
        return send({ url: c.url }, c.url);
      case "error":
        return setError(c.message);
      case "text":
        return send({ text: c.text }, null);
    }
  }

  return {
    mode,
    input, setInput,
    link, setLink,
    desc, setDesc,
    reason,
    busy,
    error, setError,
    dup, setDup,
    closedMsg, setClosedMsg,
    /** The line under the box: what Add job will do. */
    hint: addHint(mode, input, link),
    /** The entry is a link (a site that needs a login included), so the button says "Reading job…". */
    isUrl: isLinkInput(input),
    submit,
    /** Sends a body as given; `force` adds a job even though it's already on the list ("Add anyway"). */
    send,
    reset,
    clear,
  };
}
