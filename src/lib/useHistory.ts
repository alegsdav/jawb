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
 * Whether an edit may join the previous undo step. Only a quick follow-up (under 1s) on the same
 * coalesce key does: a change on another line (different key) always starts a new step. Callers that
 * pass no key get the old behavior (any quick edit joins). commit=true never joins.
 */
export function joinsPreviousStep(
  prev: { at: number; key?: string },
  now: number,
  commit: boolean,
  key?: string,
): boolean {
  return !commit && prev.at !== 0 && now - prev.at < 1000 && key === prev.key;
}

/**
 * Undo/redo for a document value. Rapid edits (typing) coalesce into one step, but only on the same
 * line: pass a `key` identifying the edit location (e.g. the caret's line) as the third argument of
 * `set`. Structural edits pass commit=true to always create a step.
 * Binds Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y while mounted, but only for keypresses in the
 * document (see isDocUndoTarget); other fields keep the browser's native undo.
 */
export function useHistory<T>() {
  const [s, setS] = useState<State<T>>({ past: [], present: null, future: [] });
  const lastEdit = useRef<{ at: number; key?: string }>({ at: 0 });

  const reset = useCallback((v: T) => setS({ past: [], present: v, future: [] }), []);

  const set = useCallback((next: T | ((prev: T) => T), commit = false, key?: string) => {
    const now = Date.now();
    const coalesce = joinsPreviousStep(lastEdit.current, now, commit, key);
    lastEdit.current = commit ? { at: 0 } : { at: now, key };
    setS((st) => {
      if (st.present === null) return st;
      const v = typeof next === "function" ? (next as (p: T) => T)(st.present) : next;
      if (v === st.present) return st;
      return { past: coalesce ? st.past : [...st.past.slice(-99), st.present], present: v, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    lastEdit.current = { at: 0 };
    setS((st) =>
      st.past.length && st.present !== null
        ? { past: st.past.slice(0, -1), present: st.past[st.past.length - 1], future: [st.present, ...st.future] }
        : st,
    );
  }, []);

  const redo = useCallback(() => {
    lastEdit.current = { at: 0 };
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
