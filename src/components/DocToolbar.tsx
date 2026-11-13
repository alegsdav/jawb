"use client";

/** Sticky toolbar above the document, like Google Docs' menu bar. */
export function DocToolbar({
  children, onSlot,
}: {
  children: React.ReactNode;
  /** Receives the element where the document renders its contextual (move/delete) actions. */
  onSlot?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div className="sm:sticky sm:top-14 z-10 -mx-3 sm:mx-0 px-3 sm:px-2 py-2 bg-bg/95 sm:backdrop-blur border-b border-border sm:border sm:rounded-xl flex flex-wrap items-center gap-1.5">
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

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={`btn btn-sm ${on ? "border-accent text-accent bg-accent/5" : ""}`}
    >
      {label}
    </button>
  );
}
