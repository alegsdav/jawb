"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type State<T> = { past: T[]; present: T | null; future: T[] };

/**
 * Undo/redo for a document value. Rapid edits (typing) coalesce into one step;
 * structural edits pass commit=true to always create a step.
 * Binds Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y while mounted.
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
