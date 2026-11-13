import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "./types";
import { isMissingColumn } from "./db";
import { RETRY_DELAYS, type Timers } from "./saveQueue";

/**
 * Writes for the job list's rows (status, deadline, applied and follow-up dates), as plain logic
 * (createJobWrites, unit-tested) plus a thin React hook (useJobWrites).
 *
 * - The screen updates right away; writes for one row run one at a time, and changes made while one
 *   is in flight (or failing) are merged into the next write.
 * - Every write is conditional on the row's `updated_at`. If another tab or device changed the row
 *   since (0 rows updated), the row is re-read, the other device's values are shown for the fields
 *   this tab didn't change, and only this tab's fields are written again. A phone and a laptop
 *   changing different fields of the same job never overwrite each other.
 * - A failed write keeps its values and retries after 3s, 10s, then every 30s, when the browser comes
 *   back online, and on Retry now. Discard puts the row back to the last saved values.
 * - Pending writes are sent when the page is hidden or left; closing the tab asks first while
 *   anything is unsaved (bindPageLifecycle).
 */

export type DbError = { code?: string; message?: string };

/** "error": a write failed and waits for a retry. "retrying": that retry is running. */
export type RowSaveState = "error" | "retrying";

/** A job row as re-read after a conflict: the columns the page shows, plus `updated_at`. */
export type JobRowValues = Partial<Job> & { updated_at?: string };

export type JobWriteBackend = {
  /**
   * Write `body` to the job, only if its `updated_at` is still `ifUpdatedAt` (null: unconditionally).
   * `matched: false` means no row matched (changed elsewhere, or deleted); `updatedAt` is the new value.
   */
  update(id: string, body: Partial<Job>, ifUpdatedAt: string | null): Promise<{ error: DbError | null; matched: boolean; updatedAt: string | null }>;
  /** Read the job as it is now; `row: null` when it no longer exists. */
  read(id: string): Promise<{ error: DbError | null; row: JobRowValues | null }>;
};

export type JobWritesOptions = {
  backend: JobWriteBackend;
  /** Remove columns the database doesn't have (missing migration). */
  strip?: (p: Partial<Job>) => Partial<Job>;
  /** A write hit a missing column: return true if something new is now stripped (retry at once). */
  onMissingColumn?: (e: DbError, sent: Partial<Job>) => boolean;
  /** Show these values on a row: the saved values (Discard), or another device's changes after a conflict. */
  onRowValues: (id: string, values: JobRowValues) => void;
  /** The job was deleted elsewhere; its unsaved changes are dropped. */
  onGone?: (id: string) => void;
  /** Rows whose write is failing, whenever that changes. */
  onStates?: (states: ReadonlyMap<string, RowSaveState>) => void;
  onError?: (e: unknown) => void;
  timers?: Timers;
  retryDelays?: number[];
  /** Conflicts in a row before backing off like a failure (another device writing constantly). */
  maxConflicts?: number;
};

type Row = {
  /** Fields not yet sent (merged while a write is in flight or failing). */
  pending: Partial<Job> | null;
  /** A write (or the re-read after a conflict) is running. */
  inFlight: boolean;
  /** Last known saved values of every field this row has changed (what Discard rolls back to). */
  server: Record<string, unknown>;
  failures: number;
  conflicts: number;
  timer: unknown;
};

export type JobWrites = {
  /** Queue `patch` for `job` (the row as it was before the change, i.e. the saved values and `updated_at`). */
  queue: (job: Pick<Job, "id"> & Partial<Job>, patch: Partial<Job>) => void;
  /** Send everything that's waiting now (Retry now, back online, page hidden). */
  flushAll: () => void;
  /** Abandon a failing row's unsaved change and show the saved values again. False while it's being written. */
  discard: (id: string) => boolean;
  /** True while anything is waiting or being written. */
  busy: () => boolean;
  states: () => ReadonlyMap<string, RowSaveState>;
  /** The last `updated_at` this tab knows for a job. */
  version: (id: string) => string | undefined;
  /** Resolves once nothing is in flight (for tests). */
  idle: () => Promise<void>;
  /** Stop scheduling retries and clear timers (unmount). `start()` resumes. */
  stop: () => void;
  start: () => void;
};

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createJobWrites(opts: JobWritesOptions): JobWrites {
  const timers = opts.timers ?? realTimers;
  const delays = opts.retryDelays?.length ? opts.retryDelays : RETRY_DELAYS;
  const maxConflicts = opts.maxConflicts ?? 3;
  const strip = opts.strip ?? ((p) => p);
  const rows = new Map<string, Row>();
  const versions = new Map<string, string>();
  let active = true;
  let running: Promise<unknown>[] = [];

  const states = () => {
    const out = new Map<string, RowSaveState>();
    for (const [id, r] of rows) if (r.failures > 0) out.set(id, r.inFlight ? "retrying" : "error");
    return out;
  };
  const emit = () => opts.onStates?.(states());
  const track = (p: Promise<unknown>) => {
    running.push(p);
    p.finally(() => (running = running.filter((x) => x !== p)));
  };
  const clearTimer = (r: Row) => {
    if (r.timer !== null) timers.clear(r.timer);
    r.timer = null;
  };

  function fail(id: string, r: Row, sent: Partial<Job>, error: DbError) {
    r.inFlight = false;
    r.pending = { ...sent, ...(r.pending ?? {}) };
    if (isMissingColumn(error) && opts.onMissingColumn?.(error, sent)) return flush(id);
    opts.onError?.(error);
    if (active && r.timer === null) {
      const wait = delays[Math.min(r.failures, delays.length - 1)];
      r.timer = timers.set(() => {
        r.timer = null;
        flush(id);
      }, wait);
    }
    r.failures++;
    emit();
  }

  /** 0 rows matched: re-read, show the other device's values, then write this tab's fields again. */
  function conflict(id: string, r: Row, sent: Partial<Job>) {
    r.pending = { ...sent, ...(r.pending ?? {}) };
    const p = opts.backend.read(id).then(
      ({ error, row }) => {
        if (error) return fail(id, r, {}, error);
        r.inFlight = false;
        if (!row) {
          clearTimer(r);
          rows.delete(id);
          versions.delete(id);
          opts.onGone?.(id);
          return emit();
        }
        if (row.updated_at) versions.set(id, row.updated_at);
        // Their values are now the saved ones (what Discard goes back to)...
        for (const k of Object.keys(r.server)) if (k in row) r.server[k] = (row as Record<string, unknown>)[k] ?? null;
        // ...and they show on screen, except for the fields this tab is about to write.
        const theirs: Record<string, unknown> = { ...row };
        for (const k of Object.keys(r.pending ?? {})) delete theirs[k];
        opts.onRowValues(id, theirs as JobRowValues);
        r.conflicts++;
        if (r.conflicts > maxConflicts) {
          r.conflicts = 0;
          return fail(id, r, {}, { message: "The job keeps changing on another device." });
        }
        flush(id);
      },
      (e: { message?: string }) => fail(id, r, {}, { message: e?.message ?? "network error" }),
    );
    track(p);
  }

  function flush(id: string) {
    const r = rows.get(id);
    if (!r || r.inFlight || !r.pending) return;
    clearTimer(r);
    const sent = r.pending;
    r.pending = null;
    r.inFlight = true;
    emit();
    const body = strip(sent);
    const request = Object.keys(body).length
      ? opts.backend.update(id, body, versions.get(id) ?? null)
      : Promise.resolve({ error: null, matched: true, updatedAt: null });
    const p = Promise.resolve(request).then(
      (res) => {
        if (res.error) return fail(id, r, sent, res.error);
        if (!res.matched) return conflict(id, r, sent);
        r.inFlight = false;
        if (res.updatedAt) versions.set(id, res.updatedAt);
        Object.assign(r.server, sent);
        r.failures = 0;
        r.conflicts = 0;
        if (r.pending) return flush(id);
        rows.delete(id);
        emit();
      },
      (e: { message?: string }) => fail(id, r, sent, { message: e?.message ?? "network error" }),
    );
    track(p);
  }

  const flushAll = () => {
    for (const [id, r] of rows) if (r.pending) flush(id);
  };

  return {
    queue(job, patch) {
      if (job.updated_at && !versions.has(job.id)) versions.set(job.id, job.updated_at);
      let r = rows.get(job.id);
      if (!r) {
        r = { pending: null, inFlight: false, server: {}, failures: 0, conflicts: 0, timer: null };
        rows.set(job.id, r);
      }
      for (const k of Object.keys(patch)) if (!(k in r.server)) r.server[k] = (job as Record<string, unknown>)[k] ?? null;
      r.pending = { ...(r.pending ?? {}), ...patch };
      flush(job.id);
    },
    flushAll,
    discard(id) {
      const r = rows.get(id);
      if (!r || r.inFlight) return false;
      clearTimer(r);
      const back: Record<string, unknown> = {};
      for (const k of Object.keys(r.pending ?? {})) back[k] = r.server[k] ?? null;
      rows.delete(id);
      opts.onRowValues(id, back as JobRowValues);
      emit();
      return true;
    },
    busy: () => [...rows.values()].some((r) => r.pending || r.inFlight),
    states,
    version: (id) => versions.get(id),
    async idle() {
      while (running.length) await Promise.allSettled(running);
    },
    stop() {
      active = false;
      for (const r of rows.values()) clearTimer(r);
    },
    start() {
      active = true;
      // Rows that failed while stopped retry on the normal schedule.
      for (const [id, r] of rows) {
        if (r.pending && !r.inFlight && r.timer === null && r.failures > 0) {
          r.timer = timers.set(() => {
            r.timer = null;
            flush(id);
          }, delays[Math.min(r.failures - 1, delays.length - 1)]);
        }
      }
    },
  };
}

type Listenable = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Never lose a row's change: send pending writes when the page is hidden (iOS app switch, tab close),
 * on `pagehide`, and when the browser comes back online; ask before the tab closes while anything is
 * unsaved. Returns the cleanup, which also sends whatever is still pending (leaving the page).
 */
export function bindPageLifecycle(
  w: Pick<JobWrites, "flushAll" | "busy">,
  env: { window: Listenable; document: Listenable & { visibilityState: string } },
): () => void {
  const flushAll = () => w.flushAll();
  const onVisibility = () => env.document.visibilityState === "hidden" && flushAll();
  const onBeforeUnload = (e: Event) => {
    if (!w.busy()) return;
    flushAll();
    e.preventDefault();
    (e as BeforeUnloadEvent).returnValue = ""; // older Safari/Chrome need this to show the prompt
  };
  env.window.addEventListener("online", flushAll);
  env.window.addEventListener("pagehide", flushAll);
  env.window.addEventListener("beforeunload", onBeforeUnload);
  env.document.addEventListener("visibilitychange", onVisibility);
  return () => {
    env.window.removeEventListener("online", flushAll);
    env.window.removeEventListener("pagehide", flushAll);
    env.window.removeEventListener("beforeunload", onBeforeUnload);
    env.document.removeEventListener("visibilitychange", onVisibility);
    flushAll(); // leaving the page (e.g. opening a job): send what's pending, fire-and-forget
  };
}

/** The Supabase side of createJobWrites: conditional updates of `jobs`, and re-reads with `columns`. */
export function supabaseJobBackend(supabase: SupabaseClient, columns: () => string): JobWriteBackend {
  return {
    async update(id, body, ifUpdatedAt) {
      let q = supabase.from("jobs").update(body).eq("id", id);
      if (ifUpdatedAt) q = q.eq("updated_at", ifUpdatedAt);
      const { data, error } = await q.select("updated_at");
      if (error) return { error, matched: false, updatedAt: null };
      const rows = (data ?? []) as { updated_at: string }[];
      return { error: null, matched: rows.length > 0, updatedAt: rows[0]?.updated_at ?? null };
    },
    async read(id) {
      const { data, error } = await supabase.from("jobs").select(columns()).eq("id", id).maybeSingle();
      return { error, row: (data as JobRowValues | null) ?? null };
    },
  };
}

/** The tracker's hook around createJobWrites: Supabase backend, page lifecycle, and row states for the UI. */
export function useJobWrites(
  supabase: SupabaseClient,
  opts: Omit<JobWritesOptions, "backend" | "onStates" | "timers"> & {
    /** Columns to re-read after a conflict (what the list shows, plus updated_at). */
    columns: () => string;
  },
) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [states, setStates] = useState<ReadonlyMap<string, RowSaveState>>(new Map());
  const ref = useRef<JobWrites | null>(null);
  if (!ref.current) {
    ref.current = createJobWrites({
      backend: supabaseJobBackend(supabase, () => optsRef.current.columns()),
      strip: (p) => optsRef.current.strip?.(p) ?? p,
      onMissingColumn: (e, sent) => optsRef.current.onMissingColumn?.(e, sent) ?? false,
      onRowValues: (id, v) => optsRef.current.onRowValues(id, v),
      onGone: (id) => optsRef.current.onGone?.(id),
      onStates: setStates,
      onError: (e) => console.warn("Job list save failed (will retry):", e),
    });
  }
  useEffect(() => {
    const w = ref.current!;
    w.start();
    const unbind = bindPageLifecycle(w, { window, document });
    return () => {
      unbind();
      w.stop();
    };
  }, []);
  const w = ref.current;
  return { queue: w.queue, retryAll: w.flushAll, discard: w.discard, states };
}
