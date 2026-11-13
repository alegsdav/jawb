"use client";

import { Popover } from "./Menu";

/** Sticky toolbar above the document, like Google Docs' menu bar. Buttons are 40px tall on phones (globals.css). */
export function DocToolbar({
  children, onSlot,
}: {
  children: React.ReactNode;
  /** Receives the element where the document renders its contextual (move/delete) actions. */
  onSlot?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div className="doc-toolbar sm:sticky sm:top-14 z-10 -mx-3 sm:mx-0 px-3 sm:px-2 py-2 bg-bg/95 sm:backdrop-blur border-b border-border sm:border sm:rounded-xl flex flex-wrap items-center gap-1.5">
      {children}
      {/* Always takes the same height, so selecting something never shifts the page under the pointer. */}
      {onSlot && (
        <div ref={onSlot} className="doc-slot hidden sm:flex items-center min-h-[33px] w-full border-t border-border pt-1.5 mt-0.5 -mb-0.5" />
      )}
    </div>
  );
}

export function UndoRedo({ undo, redo, canUndo, canRedo }: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }) {
  return (
    <div className="flex">
      <button className="btn btn-sm rounded-r-none" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/⌘+Z)" aria-label="Undo">↶</button>
      <button className="btn btn-sm rounded-l-none -ml-px" onClick={redo} disabled={!canRedo} title="Redo (Ctrl/⌘+Shift+Z)" aria-label="Redo">↷</button>
    </div>
  );
}

export function PageCount({ pages, overflowLines }: { pages: number; overflowLines: number }) {
  if (pages <= 1) return <span className="text-xs text-good" title="Fits on one page">1 page ✓</span>;
  return (
    <span className="text-xs text-bad" title="Most internship resumes should be one page">
      {pages} pages · ~{overflowLines} lines over
    </span>
  );
}

/** On/off button that says its state ("Feedback: On"). */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={`btn btn-sm ${on ? "border-accent text-accent bg-accent/5" : "text-muted"}`}
    >
      {label}: {on ? "On" : "Off"}
    </button>
  );
}

const Dot = ({ color }: { color: string }) => <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;

/** "?" next to the document: what the dots, bars and highlights mean (kept off the page itself to save room). */
export function FeedbackLegend({ analyzed, changedCount }: { analyzed: boolean; changedCount: number }) {
  return (
    <Popover label="?" title="What the colors mean" buttonClassName="btn btn-sm w-9 sm:w-auto" panelClassName="w-72">
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
      <span className="sm:hidden">[{count}]</span>
      <span className="hidden sm:inline">{count} placeholder{count > 1 ? "s" : ""} left</span>
    </button>
  );
}
