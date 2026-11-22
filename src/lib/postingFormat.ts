/**
 * Turns a pasted job posting into readable blocks: headings, paragraphs and lists. Pure and deterministic
 * (no AI, no network). Pasted text is messy (HTML copied from a page, hard-wrapped lines, "•" bullets), so
 * these are heuristics; tests/posting-format.test.ts pins each one.
 */

export type PostingBlock =
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; items: string[] };

/** A bullet marker at the start of a line. Group 1 is the text after it. */
const BULLET_RE = /^(?:[•●▪◦·]\s*|[-–*]\s+|\d{1,2}[.)]\s+)(.*)$/;
/** Several items on one line, separated by " • ". */
const ITEM_SEP_RE = /\s+[•●▪◦]\s+/;
/** Ends a sentence (or a list lead-in), so a following lowercase line starts a new paragraph. */
const TERMINAL_RE = /[.!?:;]$/;
/** Punctuation that rules a line out as a heading. */
const SENTENCE_PUNCT_RE = /[.!?,;]/;
const MAX_HEADING_CHARS = 60;
const MAX_HEADING_WORDS = 8;

type Entry =
  | { kind: "blank" }
  | { kind: "text"; text: string; indented: boolean; bullet: boolean };

/** Normalizes the text and makes one entry per logical line: blank runs collapse, hard-wrapped lines join. */
function toEntries(input: string): Entry[] {
  const lines = input.replace(/\r\n?/g, "\n").replace(/ /g, " ").split("\n");
  const entries: Entry[] = [];
  let prev = ""; // the previous physical line, trimmed
  for (const raw of lines) {
    const text = raw.trim();
    if (!text) {
      const last = entries[entries.length - 1];
      if (last && last.kind !== "blank") entries.push({ kind: "blank" });
      prev = "";
      continue;
    }
    const last = entries[entries.length - 1];
    // A line that doesn't end a sentence, followed by one that starts lowercase: the same sentence, hard-wrapped.
    if (prev && last?.kind === "text" && !TERMINAL_RE.test(prev) && /^[a-z]/.test(text)) {
      last.text += ` ${text}`;
    } else {
      entries.push({ kind: "text", text, indented: /^[ \t]/.test(raw), bullet: BULLET_RE.test(text) });
    }
    prev = text;
  }
  return entries;
}

/** A heading's text: the line without its trailing ":". */
function headingText(text: string): string {
  return text.replace(/:$/, "").trim();
}

function isHeading(entries: Entry[], i: number, lastText: number): boolean {
  const e = entries[i];
  if (e.kind !== "text") return false;
  const text = e.text;
  if (/^[a-z]/.test(text) || /https?:\/\//i.test(text)) return false;
  const bare = headingText(text);
  if (!bare || bare.length > MAX_HEADING_CHARS || bare.split(/\s+/).length > MAX_HEADING_WORDS) return false;
  if (SENTENCE_PUNCT_RE.test(bare)) return false;
  // ALL CAPS ("WHAT YOU'LL DO") is a heading on its own.
  if (/[A-Z]/.test(bare) && !/[a-z]/.test(bare) && (bare.match(/[A-Za-z]/g)?.length ?? 0) >= 2) return true;
  // Otherwise it's a heading only when more content follows it (a blank line between is fine).
  return i < lastText;
}

function addItems(blocks: PostingBlock[], items: string[]) {
  if (items.length === 0) return;
  const last = blocks[blocks.length - 1];
  if (last?.kind === "list") last.items.push(...items);
  else blocks.push({ kind: "list", items: [...items] });
}

/**
 * The posting as blocks, in order:
 * - Bullet lines ("•", "●", "▪", "◦", "·", "-", "–", "*", "1." or "1)") are list items, marker stripped. Consecutive
 *   items form one list, and blank lines between items don't break it.
 * - A line with two or more " • " separators is split into items.
 * - An indented line right after a line ending in ":" (or after one of its indented items) is a list item.
 * - A short line (at most 60 characters and 8 words, no . ! ? , ;) is a heading when more content follows it, or
 *   when it's ALL CAPS. A trailing ":" is dropped. A URL never makes a heading.
 * - Everything else is a paragraph. A line that doesn't end a sentence, followed by one starting lowercase, is
 *   joined to it with a space.
 */
export function formatPosting(input: string): PostingBlock[] {
  const entries = toEntries(input);
  let lastText = -1;
  entries.forEach((e, i) => {
    if (e.kind === "text") lastText = i;
  });

  const blocks: PostingBlock[] = [];
  // The previous line ended with ":", or is an indented item that followed one: the next indented line is an item too.
  let colonRun: boolean = false;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.kind === "blank") {
      colonRun = false;
      continue;
    }
    const body = e.bullet ? e.text.replace(BULLET_RE, "$1") : e.text;
    const parts = body.split(ITEM_SEP_RE).map((s) => s.trim()).filter(Boolean);
    const isItem: boolean = e.bullet || (colonRun && e.indented);
    if (isItem || parts.length >= 3) {
      addItems(blocks, parts);
    } else if (isHeading(entries, i, lastText)) {
      blocks.push({ kind: "heading", text: headingText(e.text) });
    } else {
      blocks.push({ kind: "para", text: e.text });
    }
    colonRun = e.text.endsWith(":") || (colonRun && isItem && e.indented);
  }
  return blocks;
}

export type LinkPiece = { kind: "text"; text: string } | { kind: "link"; href: string; text: string };

/** Splits text on bare http(s) URLs. Punctuation that closes a sentence after a URL stays out of the link. */
export function splitLinks(text: string): LinkPiece[] {
  const pieces: LinkPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const start = m.index ?? 0;
    const url = m[0].replace(/[.,;:!?)\]]+$/, "");
    if (start > last) pieces.push({ kind: "text", text: text.slice(last, start) });
    pieces.push({ kind: "link", href: url, text: url });
    last = start + url.length;
  }
  if (last < text.length) pieces.push({ kind: "text", text: text.slice(last) });
  return pieces;
}
