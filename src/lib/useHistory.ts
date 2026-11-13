"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type State<T> = { past: T[]; present: T | null; future: T[] };

type MaybeElement = { tagName?: string; closest?: (sel: string) => unknown } | null | undefined;

/**
 * Whether a Ctrl/Cmd+Z keypress belongs to the resume document's undo history: the key went to
 * something inside the document (`.doc-canvas`) or its toolbar (`.doc-toolbar`), or nothing is
 * focused (the event targets <body>). Anywhere else (cover letter, notes, facts, answers) the
 * browser's own undo for that field must run, and the hidden resume must not change.
 */
export function isDocUndoTarget(target: EventTarget | MaybeElement): boolean {
  const el = target as MaybeElement;
  if (!el || typeof el.closest !== "function") return true; // window/document
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "BODY" || tag === "HTML") return true;
  if (el.closest(".doc-canvas")) return true;
  // Toolbar buttons (e.g. right after clicking Undo), but never a text field that happens to sit there.
  return !!el.closest(".doc-toolbar") && !["INPUT", "TEXTAREA", "SELECT"].includes(tag);
}

/**
 * Undo/redo for a document value. Rapid edits (typing) coalesce into one step;
 * structural edits pass commit=true to always create a step.
 * Binds Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y while mounted, but only for keypresses in the
 * document (see isDocUndoTarget); other fields keep the browser's native undo.
 */
export function useHistory<T>() {
  const [s, setS] = useState<State<T>>({ past: [], present: null, future: [] });
  const lastEdit = useRef(0);

  const reset = useCallback((v: T) => setS({ past: [], present: v, future: [] }), []);

  const set = useCallback((next: T | ((prev: T) => T), commit = false) => {
    const now = Date.now();
    const coalesce = !commit && now - lastEdit.current < 1000;
    lastEdit.current = commit ? 0 : now;
    setS((st) => {
      if (st.present === null) return st;
      const v = typeof next === "function" ? (next as (p: T) => T)(st.present) : next;
      if (v === st.present) return st;
      return { past: coalesce ? st.past : [...st.past.slice(-99), st.present], present: v, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    lastEdit.current = 0;
    setS((st) =>
      st.past.length && st.present !== null
        ? { past: st.past.slice(0, -1), present: st.past[st.past.length - 1], future: [st.present, ...st.future] }
        : st,
    );
  }, []);

  const redo = useCallback(() => {
    lastEdit.current = 0;
    setS((st) =>
      st.future.length && st.present !== null
        ? { past: [...st.past, st.present], present: st.future[0], future: st.future.slice(1) }
        : st,
    );
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (!isDocUndoTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return {
    value: s.present,
    set,
    reset,
    undo,
    redo,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
  };
}
