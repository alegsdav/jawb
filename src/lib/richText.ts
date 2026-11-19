/**
 * Pure helpers for inline marks (character ranges of one plain-text field) and paragraph formatting.
 * No React, no DOM. See the Mark and Para types in ./types for the stored shape.
 */
import type { Mark, Para } from "./types";

export const DEFAULT_SIZE = 11;
const MIN_SIZE = 8;
const MAX_SIZE = 28;

/** The format part of a Mark. */
export type Format = { bold?: true; italic?: true; underline?: true; size?: number };
export type Rich = { text: string; marks?: Mark[] };
export type Run = { text: string; bold: boolean; italic: boolean; underline: boolean; size: number };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Stable text key of a format, used to compare formats. Absent flags and absent size compare as "none". */
const formatKey = (f: Format | undefined) =>
  `${f?.bold ? 1 : 0}${f?.italic ? 1 : 0}${f?.underline ? 1 : 0}${f?.size ?? ""}`;

/** Lay `top` over `base`: flags OR together, a size in `top` replaces one in `base`. */
function layer(base: Format, top: Format): Format {
  const f: Format = {};
  if (base.bold || top.bold) f.bold = true;
  if (base.italic || top.italic) f.italic = true;
  if (base.underline || top.underline) f.underline = true;
  const size = top.size ?? base.size;
  if (size !== undefined) f.size = size;
  return f;
}

export function cleanFormat(raw: unknown): Format | undefined {
  if (!isObject(raw)) return undefined;
  const f: Format = {};
  if (raw.bold === true) f.bold = true;
  if (raw.italic === true) f.italic = true;
  if (raw.underline === true) f.underline = true;
  if (typeof raw.size === "number" && Number.isFinite(raw.size) && raw.size >= MIN_SIZE && raw.size <= MAX_SIZE) {
    const size = round1(raw.size);
    if (size !== DEFAULT_SIZE) f.size = size;
  }
  return Object.keys(f).length ? f : undefined;
}

export function cleanMarks(raw: unknown, length: number): Mark[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const parts: { from: number; to: number; fmt: Format }[] = [];
  for (const el of raw) {
    if (!isObject(el) || typeof el.from !== "number" || typeof el.to !== "number") continue;
    if (Number.isNaN(el.from) || Number.isNaN(el.to)) continue;
    const from = Math.max(0, Math.round(el.from));
    const to = Math.min(length, Math.round(el.to));
    if (to <= from) continue;
    const fmt = cleanFormat(el);
    if (!fmt) continue;
    parts.push({ from, to, fmt });
  }
  if (!parts.length) return undefined;

  // Split at every boundary, then give each elementary segment the layered format of all marks covering it.
  const cuts = [...new Set(parts.flatMap((p) => [p.from, p.to]))].sort((a, b) => a - b);
  const out: Mark[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    let fmt: Format = {};
    for (const p of parts) if (p.from <= a && b <= p.to) fmt = layer(fmt, p.fmt);
    if (!Object.keys(fmt).length) continue;
    const last = out[out.length - 1];
    if (last && last.to === a && formatKey(last) === formatKey(fmt)) {
      last.to = b;
    } else {
      out.push({ from: a, to: b, ...fmt });
    }
  }
  return out.length ? out : undefined;
}

export function cleanPara(raw: unknown): Para | undefined {
  if (!isObject(raw)) return undefined;
  const p: Para = {};
  if (raw.align === "center" || raw.align === "right" || raw.align === "justify") p.align = raw.align;
  if (raw.rule === true) p.rule = true;
  if (raw.caps === true) p.caps = true;
  if (typeof raw.spaceBefore === "number" && Number.isFinite(raw.spaceBefore) && raw.spaceBefore > 0 && raw.spaceBefore <= 48) {
    const sb = round1(raw.spaceBefore);
    if (sb > 0) p.spaceBefore = sb;
  }
  return Object.keys(p).length ? p : undefined;
}

export function wholeMarks(text: string, format: Format | undefined): Mark[] | undefined {
  const cleaned = cleanFormat(format);
  if (!text.length || !cleaned) return undefined;
  return [{ from: 0, to: text.length, ...cleaned }];
}

export function shiftMarks(marks: Mark[] | undefined, by: number): Mark[] {
  return (marks ?? []).map((m) => ({ ...m, from: m.from + by, to: m.to + by }));
}

export function joinRich(parts: Rich[]): Rich {
  let text = "";
  const all: Mark[] = [];
  for (const part of parts) {
    all.push(...shiftMarks(part.marks, text.length));
    text += part.text;
  }
  const marks = cleanMarks(all, text.length);
  return marks ? { text, marks } : { text };
}

export function toRuns(text: string, marks?: Mark[]): Run[] {
  if (!text.length) return [];
  const fmts = new Array<Format | undefined>(text.length);
  for (const m of cleanMarks(marks, text.length) ?? []) {
    for (let i = m.from; i < m.to; i++) fmts[i] = m;
  }

  const runs: Run[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || formatKey(fmts[i]) !== formatKey(fmts[start])) {
      const f = fmts[start];
      runs.push({
        text: text.slice(start, i),
        bold: !!f?.bold,
        italic: !!f?.italic,
        underline: !!f?.underline,
        size: f?.size ?? DEFAULT_SIZE,
      });
      start = i;
    }
  }
  return runs;
}
