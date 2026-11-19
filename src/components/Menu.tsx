"use client";

import { createContext, useContext, useEffect, useId, useRef, useState } from "react";

const CloseCtx = createContext<() => void>(() => {});

/**
 * Small dropdown menu: a button (aria-haspopup/aria-expanded) and a popup of `MenuItem`s.
 * Closes on outside tap/click, Escape, or picking an item. Works with touch (no reliance on
 * focus/blur, which iOS Safari doesn't give buttons) and flips to stay on screen at phone widths.
 */
export function Menu({
  label, children, buttonClassName = "btn btn-sm", title,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  buttonClassName?: string;
  /** Accessible name when `label` isn't text (e.g. "⋯"). */
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [alignLeft, setAlignLeft] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  const items = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(e: React.MouseEvent) {
    if (open) return setOpen(false);
    // Open below the trigger, aligned to its left edge when the ~16rem popup fits to the right;
    // otherwise align to its right edge so it opens toward the room on the left.
    const r = button.current?.getBoundingClientRect();
    const popupWidth = 272;
    setAlignLeft(!r || r.left + popupWidth <= window.innerWidth);
    setOpen(true);
    // Keyboard activation (detail 0): move focus into the menu.
    if (e.detail === 0) requestAnimationFrame(() => items()[0]?.focus());
  }

  function onListKey(e: React.KeyboardEvent) {
    // An open menu takes Escape: nothing underneath (the document, a card) also reacts to it.
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
      return;
    }
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = all.length;
      all[(i + (e.key === "ArrowDown" ? 1 : n - 1) + n) % n]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      all[e.key === "Home" ? 0 : all.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        data-doc-keep-selection
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={title}
        title={title}
        onClick={toggle}
      >
        {label}
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          data-doc-keep-selection
          role="menu"
          onKeyDown={onListKey}
          className={`float-dark absolute top-full z-40 mt-1 min-w-56 max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-8rem)] overflow-y-auto p-1 ${
            alignLeft ? "left-0" : "right-0"
          }`}
        >
          <CloseCtx.Provider value={() => setOpen(false)}>{children}</CloseCtx.Provider>
        </div>
      )}
    </div>
  );
}

/**
 * Small "?"-style popover: a button and a panel of free content (e.g. a legend). Same dismissal rules
 * as Menu (outside tap/click, Escape, or the button again), and it flips to stay on screen on phones.
 */
export function Popover({
  label, title, children, buttonClassName = "btn btn-sm", panelClassName = "w-64",
}: {
  label: React.ReactNode;
  /** Accessible name for the button (e.g. "What the colors mean"). */
  title: string;
  children: React.ReactNode;
  buttonClassName?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [alignLeft, setAlignLeft] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        className={buttonClassName}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={title}
        title={title}
        onClick={() => {
          if (open) return setOpen(false);
          const r = button.current?.getBoundingClientRect();
          setAlignLeft(!!r && r.right < 272);
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={title}
          className={`absolute z-40 mt-1 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-surface p-3 text-sm shadow-lg ${panelClassName} ${
            alignLeft ? "left-0" : "right-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Hairline divider between groups of items in a `Menu`. */
export function MenuSeparator() {
  return <div role="separator" className="float-sep my-1" />;
}

export function MenuItem({
  onSelect, children, hint, shortcut, danger, disabled, className = "",
}: {
  onSelect: () => void;
  children: React.ReactNode;
  /** Extra classes, e.g. "sm:hidden" for an item that only phones need (desktop has a button for it). */
  className?: string;
  /** Secondary line under the label. */
  hint?: React.ReactNode;
  /** Keyboard shortcut shown right-aligned on the same line, e.g. "Ctrl+Z". */
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  const close = useContext(CloseCtx);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      // Keep focus where it is (the document field) while the mouse is pressed; keyboard activation is unaffected.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        close();
        onSelect();
      }}
      className={`float-item w-full flex-col items-start focus:outline-none disabled:opacity-50 ${className}`}
      style={danger ? { color: "#ff8a8a" } : undefined}
    >
      {shortcut ? (
        <span className="flex w-full items-center justify-between gap-6">
          <span>{children}</span>
          <span className="float-muted shrink-0 text-[11px]">{shortcut}</span>
        </span>
      ) : (
        children
      )}
      {hint && <span className="float-muted block text-[11px] leading-snug">{hint}</span>}
    </button>
  );
}
