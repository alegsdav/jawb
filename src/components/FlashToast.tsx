"use client";

/**
 * Transient confirmation ("Copied as text", "Filled [N users]…") as a fixed toast, so it never takes
 * room in (or wraps) the document toolbar. Phones: above the bottom tab bar, and above the save-error
 * toast when that one is showing. Desktop: bottom center.
 */
export function FlashToast({
  message, raised = false, onClose, action,
}: {
  message: string;
  raised?: boolean;
  onClose?: () => void;
  /** Optional link-style button, e.g. "See bullet" after filling a placeholder from the Analysis tab. */
  action?: { label: string; onClick: () => void } | null;
}) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed z-40 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md flex items-center gap-3 rounded-xl border border-good/40 bg-surface px-4 py-2.5 text-sm shadow-lg ${
        raised
          ? "bottom-[calc(9rem+env(safe-area-inset-bottom))] sm:bottom-20"
          : "bottom-[calc(4.25rem+env(safe-area-inset-bottom))] sm:bottom-4"
      }`}
    >
      <span className="flex-1 min-w-0 text-good">{message}</span>
      {action && (
        <button
          type="button"
          className="shrink-0 min-h-10 sm:min-h-0 px-1 font-medium text-accent underline underline-offset-2"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
      {onClose && (
        <button type="button" className="shrink-0 text-muted hover:text-fg px-1 min-h-8" aria-label="Dismiss" onClick={onClose}>
          ✕
        </button>
      )}
    </div>
  );
}
