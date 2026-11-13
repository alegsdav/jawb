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
    // Open toward whichever side has room (the popup is ~16rem wide).
    const r = button.current?.getBoundingClientRect();
    setAlignLeft(!!r && r.right < 272);
    setOpen(true);
    // Keyboard activation (detail 0): move focus into the menu.
    if (e.detail === 0) requestAnimationFrame(() => items()[0]?.focus());
  }

  function onListKey(e: React.KeyboardEvent) {
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
          role="menu"
          onKeyDown={onListKey}
          className={`absolute z-40 mt-1 w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-surface p-1 shadow-lg ${
            alignLeft ? "left-0" : "right-0"
          }`}
        >
          <CloseCtx.Provider value={() => setOpen(false)}>{children}</CloseCtx.Provider>
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onSelect, children, hint, danger, disabled,
}: {
  onSelect: () => void;
  children: React.ReactNode;
  /** Secondary line under the label. */
  hint?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  const close = useContext(CloseCtx);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        close();
        onSelect();
      }}
      className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5 focus:bg-black/5 focus:outline-none active:bg-black/10 disabled:opacity-50 dark:hover:bg-white/10 dark:focus:bg-white/10 ${
        danger ? "text-bad" : ""
      }`}
    >
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </button>
  );
}
