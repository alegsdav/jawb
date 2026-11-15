"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Fact, Resume } from "./types";
import { factIsActive, type FactPatch, type NewFact } from "./facts";
import { deleteFacts, FACTS_MIGRATION_HINT, insertFacts, loadFacts, mirrorFacts, updateFact } from "./factStore";

export type FactsStatus = "loading" | "ready" | "missing" | "error";

/**
 * The student's facts on a page (master resume or a job), with writes that keep the list in step.
 * `mirror` is called from a resume's autosave: it throws on failure so the autosave retries it.
 */
export function useFacts(supabase: SupabaseClient) {
  const [facts, setState] = useState<Fact[]>([]);
  const ref = useRef<Fact[]>([]);
  const [status, setStatus] = useState<FactsStatus>("loading");
  const statusRef = useRef<FactsStatus>("loading");
  const [error, setError] = useState("");

  const set = useCallback((next: Fact[]) => {
    ref.current = next;
    setState(next);
  }, []);
  const mark = useCallback((s: FactsStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const reload = useCallback(async () => {
    const res = await loadFacts(supabase);
    if (res.missing) return mark("missing");
    if (res.error) {
      setError(res.error);
      return mark(ref.current.length ? "ready" : "error");
    }
    set(res.facts);
    setError("");
    mark("ready");
  }, [supabase, set, mark]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Insert facts (deduplicated against the list). Returns the rows added, or null on failure (`error` is set). */
  const add = useCallback(
    async (rows: NewFact[]): Promise<Fact[] | null> => {
      if (statusRef.current === "missing") {
        setError(FACTS_MIGRATION_HINT);
        return null;
      }
      const res = await insertFacts(supabase, rows, ref.current);
      if (!res.ok) {
        setError(res.error);
        return null;
      }
      setError("");
      if (res.value.length) set([...ref.current, ...res.value]);
      return res.value;
    },
    [supabase, set],
  );

  /** Delete facts. Shown gone right away; put back if the delete fails. */
  const remove = useCallback(
    async (ids: string[]): Promise<boolean> => {
      const gone = new Set(ids);
      const before = ref.current;
      set(before.filter((f) => !gone.has(f.id)));
      const res = await deleteFacts(supabase, ids);
      if (!res.ok) {
        const back = before.filter((f) => gone.has(f.id) && !ref.current.some((x) => x.id === f.id));
        set([...ref.current, ...back].sort((a, b) => a.created_at.localeCompare(b.created_at)));
        setError(res.error);
        return false;
      }
      setError("");
      return true;
    },
    [supabase, set],
  );

  /**
   * Edit a fact's text (a blank text deletes it). Editing a fact that mirrors a bullet unlinks it, so
   * the edit isn't overwritten by the bullet's text on the next save.
   */
  const edit = useCallback(
    async (id: string, text: string): Promise<boolean> => {
      const cur = ref.current.find((f) => f.id === id);
      if (!cur) return false;
      const t = text.trim();
      if (!t) return remove([id]);
      if (t === cur.text) return true;
      const patch = { text: t, active: factIsActive(t), ...(cur.bullet_id ? { resume_id: null, bullet_id: null } : {}) };
      set(ref.current.map((f) => (f.id === id ? { ...f, ...patch } : f)));
      const res = await updateFact(supabase, id, patch);
      if (!res.ok) {
        set(ref.current.map((f) => (f.id === id ? cur : f)));
        setError(res.error);
        return false;
      }
      setError("");
      return true;
    },
    [supabase, set, remove],
  );

  /** Undo a delete: insert the same facts again (with new ids), links included. */
  const restore = useCallback(
    (deleted: Fact[]) =>
      add(deleted.map((f) => ({ text: f.text, source: f.source, resume_id: f.resume_id, bullet_id: f.bullet_id, entry_id: f.entry_id }))),
    [add],
  );

  /** Change fields of a fact as they are (no unlinking): e.g. a coached bullet's fact taking its new text. */
  const patch = useCallback(
    async (id: string, p: FactPatch): Promise<boolean> => {
      const cur = ref.current.find((f) => f.id === id);
      if (!cur) return false;
      set(ref.current.map((f) => (f.id === id ? { ...f, ...p } : f)));
      const res = await updateFact(supabase, id, p);
      if (!res.ok) {
        set(ref.current.map((f) => (f.id === id ? cur : f)));
        setError(res.error);
        return false;
      }
      return true;
    },
    [supabase, set],
  );

  /** Add rows the server already inserted (e.g. /api/extract-facts) to the list. */
  const absorb = useCallback(
    (rows: Fact[]) => {
      const have = new Set(ref.current.map((f) => f.id));
      const fresh = rows.filter((f) => !have.has(f.id));
      if (fresh.length) set([...ref.current, ...fresh]);
    },
    [set],
  );

  /** Mirror facts linked to `resumeId` onto `resume` (see planMirror). Throws on failure. */
  const mirror = useCallback(
    async (resumeId: string, resume: Resume) => {
      if (statusRef.current !== "ready") return;
      const next = await mirrorFacts(supabase, ref.current, resumeId, resume);
      if (next !== ref.current) set(next);
    },
    [supabase, set],
  );

  return useMemo(
    () => ({ facts, status, error, setError, add, edit, patch, absorb, remove, restore, mirror, reload, replace: set }),
    [facts, status, error, add, edit, patch, absorb, remove, restore, mirror, reload, set],
  );
}

export type FactsApi = ReturnType<typeof useFacts>;
