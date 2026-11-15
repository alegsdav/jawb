"use client";

import { Popover } from "./Menu";
import { RedoIcon, UndoIcon } from "./icons";

/**
 * Slim top bar for editor pages: h-11, hairline bottom border, children laid out left to right.
 * Use `<div className="ml-auto flex items-center gap-1">` for the right-hand group.
 */
export function DocToolbar({
  children,
}: {
  children: React.ReactNode;
  /** Kept for compatibility. Selection actions now float inside the document, so nothing renders here. */
  onSlot?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div className="doc-toolbar sticky top-0 z-10 flex h-11 shrink-0 flex-nowrap items-center gap-1 whitespace-nowrap border-b border-border bg-surface px-3">
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
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function UndoRedo({ undo, redo, canUndo, canRedo }: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }) {
  return (
    <div className="flex items-center gap-0.5">
      <IconButton label="Undo (Ctrl/⌘+Z)" onClick={undo} disabled={!canUndo}>
        <UndoIcon />
      </IconButton>
      <IconButton label="Redo (Ctrl/⌘+Shift+Z)" onClick={redo} disabled={!canRedo}>
        <RedoIcon />
      </IconButton>
    </div>
  );
}

/** Quiet muted text like "2173 words" / "1 page". Over-length is flagged in text-bad. */
export function PageCount({ pages, overflowLines }: { pages: number; overflowLines: number }) {
  if (pages <= 1) return <span className="px-1 text-xs text-muted" title="Fits on one page">1 page</span>;
  return (
    <span className="px-1 text-xs text-bad" title="Most internship resumes should be one page">
      {pages} pages · ~{overflowLines} lines over
    </span>
  );
}

/** Small text toggle that says its state ("Feedback: On"). */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={`rounded-md px-2 py-1 text-xs transition-colors hover:bg-surface-2 hover:text-fg ${
        on ? "font-medium text-fg" : "text-muted"
      }`}
    >
      {toggleLabel(label, on)}
    </button>
  );
}

/** "Feedback: On" / "Feedback: Off": the same words on the toolbar toggle and in the phone's More menu. */
export const toggleLabel = (label: string, on: boolean) => `${label}: ${on ? "On" : "Off"}`;

const Dot = ({ color }: { color: string }) => <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;

/** "?" next to the document: what the dots, bars and highlights mean (kept off the page itself to save room). */
export function FeedbackLegend({ analyzed, changedCount }: { analyzed: boolean; changedCount: number }) {
  return (
    <Popover label="?" title="What the colors mean" buttonClassName="btn btn-sm w-9 border-transparent bg-transparent sm:w-auto" panelClassName="w-72">
      <ul className="space-y-1.5 text-xs">
        {analyzed && (
          <>
            <li className="flex items-center gap-2"><Dot color="#1f8a4c" /> Strong bullet for this job</li>
            <li className="flex items-center gap-2"><Dot color="#c98a12" /> Okay: could be stronger</li>
            <li className="flex items-center gap-2"><Dot color="#c53030" /> Weak: worth rewriting</li>
            <li className="flex items-center gap-2"><Dot color="#9a9a95" /> Updated since the analysis</li>
          </>
        )}
        <li className="flex items-center gap-2">
          <span className="inline-block h-3 w-[3px] shrink-0 rounded bg-[#2f5bd3]" /> Changed from your master resume
          {changedCount ? ` (${changedCount})` : ""}
        </li>
        <li className="flex items-center gap-2">
          <span className="shrink-0 rounded bg-[#ffd84d] px-1 text-[#3d2c00]">[N]</span> Placeholder: put your real number in
        </li>
      </ul>
      <p className="mt-2 text-xs text-muted">Tap a bullet to see its feedback and suggested edits.</p>
    </Popover>
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
