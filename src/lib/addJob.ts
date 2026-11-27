import { pasteOnlySite } from "@/lib/jobsites";
import type { Job } from "@/lib/types";

/** A whole http(s) link, with nothing else in it. */
const URL_RE = /^https?:\/\/\S+$/i;

/** True when the text (trimmed) is a link: the whole entry, nothing else. */
export function isLinkInput(raw: string): boolean {
  return URL_RE.test(raw.trim());
}

/** A full http(s) address that the browser can parse (the server checks again). */
export function isHttpUrl(s: string): boolean {
  if (!URL_RE.test(s)) return false;
  try {
    return /^https?:$/.test(new URL(s).protocol);
  } catch {
    return false;
  }
}

/** An existing job, for the duplicate check. */
export type ExistingJob = Pick<Job, "id" | "url" | "company" | "title" | "created_at">;

/** What the intake API takes: a link, pasted text, or both (the paste step for a login-walled site). */
export type IntakeBody = { url?: string; text?: string };

/** Why the paste step is showing: a site that needs a login, or a fetch that failed (the message is the instruction). */
export type PasteReason = { site?: string; failed?: string };

/** "Nov 13" for a timestamp, in the user's time zone ("" if it can't be read). */
export function addedOn(createdAt: string): string {
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** What one entry in the single box means when Enter is pressed. */
export type OneBoxInput =
  | { kind: "empty" }
  /** A link to a site the server can't read: go to the paste step with the link kept. */
  | { kind: "site"; url: string; site: string }
  /** A link the server reads. */
  | { kind: "url"; url: string }
  /** A pasted description. */
  | { kind: "text"; text: string }
  /** Something that can't be a job (a half-typed link, a stray word). Nothing is sent. */
  | { kind: "error"; message: string };

/**
 * Sorts what's in the one box. One word with no spaces is never a description: a half-typed link ("http//x",
 * "www.acme") or a stray word would otherwise create an "Untitled role" job and spend an analysis.
 */
export function classifyOneBox(raw: string): OneBoxInput {
  const value = raw.trim();
  if (!value) return { kind: "empty" };
  if (URL_RE.test(value)) {
    const site = pasteOnlySite(value);
    return site ? { kind: "site", url: value, site } : { kind: "url", url: value };
  }
  if (!/\s/.test(value)) {
    const looksLikeLink = /^http/i.test(value) || value.startsWith("www.") || /[./]/.test(value);
    return {
      kind: "error",
      message: looksLikeLink
        ? "That doesn't look like a link. Paste the full address starting with https://"
        : "Paste a link to the posting or the full job description.",
    };
  }
  return { kind: "text", text: value };
}

/** The paste step's fields: the link (optional) and the description (required). */
export function pasteBody(link: string, desc: string): { ok: true; body: IntakeBody } | { ok: false; message: string } {
  const url = link.trim();
  if (url && !isHttpUrl(url)) {
    return { ok: false, message: "That doesn't look like a link. Paste the full address starting with https://" };
  }
  if (!desc.trim()) return { ok: false, message: "Paste the job description first." };
  return { ok: true, body: { ...(url ? { url } : {}), text: desc.trim() } };
}

/** What "Add job" will do, shown under the box. */
export function addHint(mode: "one" | "paste", input: string, link: string): string {
  if (mode === "paste") return link.trim() ? "Saves the description and keeps the link." : "";
  const c = classifyOneBox(input);
  switch (c.kind) {
    case "empty":
      return "";
    case "site":
      return `${c.site} needs a login: paste the text next.`;
    case "url":
      return "Reads the posting from the link.";
    default:
      return "Uses the pasted description.";
  }
}
