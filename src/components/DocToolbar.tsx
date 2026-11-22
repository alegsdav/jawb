"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Resume } from "@/lib/types";
import { Menu } from "./Menu";
import { RedoIcon, UndoIcon } from "./icons";
import { useSidebar } from "./sidebarState";

/**
 * Editable document targets: the legacy field inputs, and the resume editor's contentEditable root
 * (`.doc-editor`, inside `.doc-canvas`). A focused element inside the editor counts as the editor.
 */
const DOC_FIELD_SELECTOR = "input.doc-field, textarea.doc-field, .doc-editor";

/** The document target that had focus last. Menu clicks don't move focus (see MenuItem), so this stays valid. */
let lastDocField: HTMLElement | null = null;
let docFieldTrackerRefs = 0;

const onDocFocusIn = (e: FocusEvent) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const field = t.closest(DOC_FIELD_SELECTOR);
  if (field instanceof HTMLElement) lastDocField = field;
};

/**
 * Remembers the last focused document target (see DOC_FIELD_SELECTOR) so that menu commands like
 * Cut/Copy/Paste/Select all can act on it. Installs one document listener, shared by all callers.
 */
function useDocFieldTracker(): void {
  useEffect(() => {
    docFieldTrackerRefs += 1;
    if (docFieldTrackerRefs === 1) document.addEventListener("focusin", onDocFocusIn);
    return () => {
      docFieldTrackerRefs -= 1;
      if (docFieldTrackerRefs === 0) {
        document.removeEventListener("focusin", onDocFocusIn);
        lastDocField = null;
      }
    };
  }, []);
}

/**
 * Edit command for the remembered document target. Refocuses it without scrolling, then runs the command.
 * Inputs and textareas use their own select; the contentEditable editor uses execCommand for every command.
 * Paste reads the clipboard and inserts through execCommand, so React's onChange fires as for typing.
 */
export async function docEdit(cmd: "cut" | "copy" | "paste" | "selectAll"): Promise<void> {
  try {
    const el = lastDocField;
    if (!el || !el.isConnected) return;
    el.focus({ preventScroll: true });
    if (cmd === "selectAll") {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
      else document.execCommand("selectAll");
      return;
    }
    if (cmd === "paste") {
      let text: string;
      try {
        text = await navigator.clipboard.readText();
      } catch {
        return;
      }
      document.execCommand("insertText", false, text);
      return;
    }
    document.execCommand(cmd);
  } catch {
    // Command unavailable in this browser: nothing to do.
  }
}

/** Helper text for a menu hint: the editing and print shortcuts of the document. */
export const EDIT_SHORTCUTS =
  "Ctrl/⌘+B / I / U: bold, italic, underline · Ctrl/⌘+Shift+L / E / R / J: align left, center, right, justify · " +
  "Ctrl/⌘+Shift+7 / 8: numbered / bulleted list · Ctrl/⌘+\\: clear formatting · Enter: new paragraph · " +
  "Tab / Shift+Tab: indent or outdent a list item (elsewhere Tab inserts a right-aligned tab) · " +
  "Ctrl/⌘+Z / Ctrl/⌘+Shift+Z: undo / redo · Ctrl/⌘+P: print";

/** Row of menu triggers (File, Edit, View...) for the top bar. */
export function MenuBar({ children }: { children: React.ReactNode }) {
  useDocFieldTracker();
  return (
    <div data-doc-keep-selection className="flex items-center gap-0.5">
      {children}
    </div>
  );
}

/** One menu in the MenuBar: a plain 13px text trigger with a `Menu` popup of `MenuItem`s. */
export function MenuBarMenu({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <Menu label={label} buttonClassName="rounded px-2 py-1 text-[13px] text-fg hover:bg-surface-2">
      {children}
    </Menu>
  );
}

/** Formatting-style toolbar row under the top bar. One row: phones scroll it sideways instead of wrapping. */
export function EditorToolbar({ children }: { children: React.ReactNode }) {
  return (
    <div data-doc-keep-selection className="flex min-h-9 flex-nowrap items-center gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-0.5">
      {children}
    </div>
  );
}

/** Vertical hairline between toolbar groups. */
export function ToolbarSep() {
  return <div aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

/** Zoom levels for the document. 0 means "Fit" (the page computes the scale to fit its column). */
const ZOOM_OPTIONS: { label: string; value: number }[] = [
  { label: "Fit", value: 0 },
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.75 },
  { label: "90%", value: 0.9 },
  { label: "100%", value: 1 },
  { label: "125%", value: 1.25 },
  { label: "150%", value: 1.5 },
];

/** Compact native zoom picker. Value 0 = Fit, 1 = 100%. */
export function ZoomSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const known = ZOOM_OPTIONS.some((o) => o.value === value);
  return (
    <select
      aria-label="Zoom"
      className="rounded px-1.5 py-1 text-[13px] hover:bg-surface-2 bg-transparent"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {!known && <option value={value}>{Math.round(value * 100)}%</option>}
      {ZOOM_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Word-style status bar under the document column: page count, word count, save status, zoom.
 * Fixed height so it never shifts when the save status text changes.
 */
export function StatusBar({
  pages, words, saveStatus, zoom, onZoom,
}: {
  pages: number;
  words: number;
  saveStatus?: React.ReactNode;
  zoom: number;
  onZoom: (z: number) => void;
}) {
  return (
    <div className="h-7 shrink-0 flex items-center gap-3 px-3 border-t border-border bg-surface text-[11px] text-muted">
      <span className="whitespace-nowrap">
        Page 1 of {Math.max(1, pages)} · {words.toLocaleString()} {words === 1 ? "word" : "words"}
      </span>
      {saveStatus != null && <span className="min-w-0 truncate">{saveStatus}</span>}
      <div className="ml-auto shrink-0">
        <ZoomSelect value={zoom} onChange={onZoom} />
      </div>
    </div>
  );
}

const tokens = (s: string | null | undefined) => (s ? (s.match(/\S+/g) ?? []).length : 0);

/** Presentational word count: header, section titles, entry lines and bullet text. */
export function countWords(resume: Resume): number {
  let n = tokens(resume.header.name) + tokens(resume.header.contact);
  for (const s of resume.sections) {
    n += tokens(s.title);
    for (const it of s.items) {
      n += tokens(it.title) + tokens(it.subtitle) + tokens(it.location) + tokens(it.dates);
      for (const b of it.bullets) n += tokens(b.text);
    }
  }
  return n;
}

/** Document-wide shortcuts: Ctrl/Cmd+P prints the page only, Ctrl/Cmd+S saves (no browser dialog). */
export function useEditorShortcuts({ onPrint, onSave }: { onPrint: () => void; onSave?: () => void }) {
  const handlers = useRef({ onPrint, onSave });
  useEffect(() => {
    handlers.current = { onPrint, onSave };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        handlers.current.onPrint();
      } else if (k === "s") {
        e.preventDefault();
        handlers.current.onSave?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

const ZOOM_VALUES = ZOOM_OPTIONS.map((o) => o.value);
const zoomKey = (key: string) => `doc-zoom:${key}`;

/** Document zoom (1 = 100%, 0 = Fit), remembered per document key in localStorage. */
export function useZoom(key: string): [number, (z: number) => void] {
  const [zoom, setZoomState] = useState(0);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(zoomKey(key));
      const v = raw === null ? NaN : Number(raw);
      if (ZOOM_VALUES.includes(v)) setZoomState(v);
    } catch {
      // Storage blocked or unavailable: keep the default.
    }
  }, [key]);
  const setZoom = useCallback(
    (z: number) => {
      setZoomState(z);
      try {
        window.localStorage.setItem(zoomKey(key), String(z));
      } catch {
        // Storage blocked or unavailable: the zoom still applies for this visit.
      }
    },
    [key],
  );
  return [zoom, setZoom];
}

/**
 * Slim top bar for editor pages: h-9 (36px), hairline bottom border, children laid out left to right.
 * Use `<div className="ml-auto flex items-center gap-1">` for the right-hand group.
 */
export function DocToolbar({
  children,
}: {
  children: React.ReactNode;
  /** Kept for compatibility. Selection actions now float inside the document, so nothing renders here. */
  onSlot?: (el: HTMLDivElement | null) => void;
}) {
  // Collapsed, the sidebar's expand button sits in the canvas's top-left corner (16px in, 28px wide, centred on the
  // bar in AppShell): the bar starts clear of it, on lg and up only.
  const { collapsed } = useSidebar();
  return (
    <div
      className={`doc-toolbar sticky top-0 z-10 flex h-9 shrink-0 flex-nowrap items-center gap-1 whitespace-nowrap border-b border-border bg-surface px-2 ${
        collapsed ? "lg:pl-11" : ""
      }`}
    >
      {children}
    </div>
  );
}

/** Ghost icon button (`.icon-btn`, 28px) with an accessible name and a tooltip. */
export function IconButton({
  label, onClick, disabled, children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    // Pressing the button doesn't take focus from the document, so typing right after Undo goes on in the text.
    <button
      type="button" className="icon-btn" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

/** Undo and redo, never greyed out: with nothing to undo the click does nothing (the editor's history decides). */
export function UndoRedo({ undo, redo }: { undo: () => void; redo: () => void }) {
  return (
    <div className="flex items-center gap-0.5">
      <IconButton label="Undo (Ctrl/⌘+Z)" onClick={undo}>
        <UndoIcon />
      </IconButton>
      <IconButton label="Redo (Ctrl/⌘+Shift+Z)" onClick={redo}>
        <RedoIcon />
      </IconButton>
    </div>
  );
}

/** Quiet muted text like "2173 words" / "1 page". Over-length is flagged in text-bad. */
export function PageCount({ pages, overflowLines }: { pages: number; overflowLines: number }) {
  if (pages <= 1) return null;
  return (
    <span className="px-1 text-xs text-bad" title="Most internship resumes should be one page">
      {pages} pages · ~{overflowLines} lines over
    </span>
  );
}

/** Small text toggle that says its state ("Feedback: On"). */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  // Pressed like the B/I/U buttons, so it stays one short word in a crowded row; the title says On/Off.
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title={`${label}: ${on ? "On" : "Off"}`}
      className="h-8 shrink-0 whitespace-nowrap rounded-md px-2 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-fg aria-pressed:bg-surface-2 aria-pressed:font-medium aria-pressed:text-fg"
    >
      {label}
    </button>
  );
}

/** "3 placeholders left": jumps to the first [placeholder] still in the document. Hidden at zero. */
export function PlaceholderCount({ count, onClick }: { count: number; onClick: () => void }) {
  if (!count) return null;
  return (
    <button
      type="button"
      className="btn btn-sm border-[#e0b100] bg-[#fff6d6] text-[#5c4300] hover:border-[#a57f00]"
      onClick={onClick}
      title="Replace each [placeholder] with your real number before you apply"
      aria-label={`${count} placeholder${count > 1 ? "s" : ""} left: go to the first one`}
    >
      <span className="sm:hidden">{count} to fill</span>
      <span className="hidden sm:inline">{count} placeholder{count > 1 ? "s" : ""} left</span>
    </button>
  );
}
