"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { STATUSES, type Job, type JobStatus, type Resume } from "@/lib/types";
import { fitOf } from "@/lib/fit";
import { isEmptyResume, normalizeResume } from "@/lib/resume";
import { shouldSnapshot, SUBMITTED_STATUSES } from "@/lib/outcomes";
import { dbErrorMessage, isMissingColumn, MIGRATION_HINT, OPTIONAL_JOB_COLUMNS } from "@/lib/db";
import { localToday, shortDate } from "@/lib/dates";
import { applyStatusChange } from "@/lib/status";
import { RETRY_DELAYS, SaveErrorToast } from "@/lib/useAutosave";
import { FitBadge, StatusSelect } from "@/components/StatusSelect";
import { AddJobForm, stashCapture } from "@/components/AddJobForm";
import { OutcomeStats } from "@/components/OutcomeStats";
import { DeadlineField, deadlineUrgency, isClosingSoon } from "@/components/DeadlineField";

const BASE_COLS = "id, company, title, location, url, status, date_applied, follow_up_date, analysis, created_at";
/** Added by migration 0002. */
const COLS_0002 = "deadline, submitted_at, submitted_tailored";
/** Added by migration 0003. */
const COLS_0003 = "reached_interview";

type Filter = JobStatus | "all" | "closing";
type Sort = "newest" | "deadline";

// ---------- per-row write queue: retries failed writes, rolls back on Discard ----------

type RowWrite = {
  /** Fields not yet sent (merged while a write is in flight or failing). */
  pending: Partial<Job> | null;
  inFlight: boolean;
  /** Last known server values of every field this row has changed (what Discard rolls back to). */
  server: Partial<Job>;
  failures: number;
  timer: ReturnType<typeof setTimeout> | null;
};

/** "error": a write failed and waits for a retry. "retrying": that retry is running. */
type RowSaveState = "error" | "retrying";

/**
 * Writes for tracker rows (status, deadline, applied and follow-up dates). The screen updates right
 * away; writes for one row run one at a time and merge while one is in flight. A failed write keeps
 * its value and retries after 3s, 10s, then every 30s, when the browser comes back online, and on
 * Retry now. Discard puts the row back to the server's values. Pending writes are flushed when the
 * page is hidden or left, and closing the tab asks first while anything is unsaved.
 */
function useJobWrites(
  supabase: SupabaseClient,
  opts: {
    /** Remove columns the database doesn't have (missing migration). */
    strip: (p: Partial<Job>) => Partial<Job>;
    /** A write hit a missing column: return true if something new is now stripped (retry at once). */
    onMissingColumn: (e: { code?: string; message?: string }, sent: Partial<Job>) => boolean;
    /** Put these server values back on the row (Discard). */
    rollback: (id: string, values: Partial<Job>) => void;
  },
) {
  const rows = useRef(new Map<string, RowWrite>());
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const mounted = useRef(true);
  const [states, setStates] = useState<ReadonlyMap<string, RowSaveState>>(new Map());

  const refresh = useCallback(() => {
    if (!mounted.current) return;
    const next = new Map<string, RowSaveState>();
    for (const [id, r] of rows.current) if (r.failures > 0) next.set(id, r.inFlight ? "retrying" : "error");
    setStates(next);
  }, []);

  const flushRef = useRef<(id: string) => void>(() => {});
  flushRef.current = (id: string) => {
    const r = rows.current.get(id);
    if (!r || r.inFlight || !r.pending) return;
    if (r.timer) {
      clearTimeout(r.timer);
      r.timer = null;
    }
    const sent = r.pending;
    r.pending = null;
    r.inFlight = true;
    refresh();
    const body = optsRef.current.strip(sent);
    const request: PromiseLike<{ error: { code?: string; message?: string } | null }> = Object.keys(body).length
      ? supabase.from("jobs").update(body).eq("id", id)
      : Promise.resolve({ error: null });
    Promise.resolve(request).then(
      ({ error }) => done(id, sent, error),
      (e: { message?: string }) => done(id, sent, { message: e?.message ?? "network error" }),
    );
  };

  function done(id: string, sent: Partial<Job>, error: { code?: string; message?: string } | null) {
    const r = rows.current.get(id);
    if (!r) return;
    r.inFlight = false;
    if (!error) {
      Object.assign(r.server, sent);
      r.failures = 0;
      if (r.pending) return flushRef.current(id);
      rows.current.delete(id);
      return refresh();
    }
    r.pending = { ...sent, ...(r.pending ?? {}) };
    if (isMissingColumn(error) && optsRef.current.onMissingColumn(error, sent)) return flushRef.current(id);
    console.warn("Tracker save failed (will retry):", error);
    if (mounted.current) {
      const wait = RETRY_DELAYS[Math.min(r.failures, RETRY_DELAYS.length - 1)];
      r.timer = setTimeout(() => {
        r.timer = null;
        flushRef.current(id);
      }, wait);
    }
    r.failures++;
    refresh();
  }

  /** Queue `patch` for `job` (pass the row as it was before the change, i.e. the server's values). */
  const queue = useCallback((job: Job, patch: Partial<Job>) => {
    let r = rows.current.get(job.id);
    if (!r) {
      r = { pending: null, inFlight: false, server: {}, failures: 0, timer: null };
      rows.current.set(job.id, r);
    }
    const server = r.server as Record<string, unknown>;
    for (const k of Object.keys(patch)) if (!(k in server)) server[k] = (job as Record<string, unknown>)[k] ?? null;
    r.pending = { ...(r.pending ?? {}), ...patch };
    flushRef.current(job.id);
  }, []);

  const retryAll = useCallback(() => {
    for (const [id, r] of rows.current) if (r.pending) flushRef.current(id);
  }, []);

  /** Abandon a failing row's unsaved change and show the server's values again. */
  const discard = useCallback(
    (id: string) => {
      const r = rows.current.get(id);
      if (!r || r.inFlight) return;
      if (r.timer) clearTimeout(r.timer);
      const back: Record<string, unknown> = {};
      for (const k of Object.keys(r.pending ?? {})) back[k] = (r.server as Record<string, unknown>)[k] ?? null;
      rows.current.delete(id);
      optsRef.current.rollback(id, back as Partial<Job>);
      refresh();
    },
    [refresh],
  );

  useEffect(() => {
    mounted.current = true;
    const map = rows.current;
    const flushAll = () => {
      for (const [id, r] of map) if (r.pending) flushRef.current(id);
    };
    const onVisibility = () => document.visibilityState === "hidden" && flushAll();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (![...map.values()].some((r) => r.pending || r.inFlight)) return;
      flushAll();
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("online", retryAll);
    window.addEventListener("pagehide", flushAll);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", retryAll);
      window.removeEventListener("pagehide", flushAll);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
      mounted.current = false;
      flushAll(); // leaving the page (e.g. opening a job): send what's pending, fire-and-forget
      for (const r of map.values()) if (r.timer) clearTimeout(r.timer);
    };
  }, [retryAll]);

  return { queue, retryAll, discard, states };
}

/** "Not saved · Discard" next to a row whose write is failing. */
function RowSaveNote({ state, onDiscard }: { state: RowSaveState | undefined; onDiscard: () => void }) {
  if (!state) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-bad font-medium">{state === "retrying" ? "Saving…" : "Not saved"}</span>
      <button
        type="button"
        className="underline text-muted hover:text-fg disabled:opacity-50 min-h-8"
        onClick={onDiscard}
        disabled={state === "retrying"}
        title="Undo this change and show the saved value"
      >
        Discard
      </button>
    </span>
  );
}

const RESUME_LOAD_ERROR =
  "Couldn't load your resume to save a copy of what you sent. Check your connection and try again.";

export default function TrackerPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  /** Optional job columns this database doesn't have yet (migration 0002/0003 not run). */
  const missing = useRef(new Set<string>());
  const [missingCols, setMissingCols] = useState<ReadonlySet<string>>(new Set());
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  /** Job whose status change is loading its resume (for the snapshot). */
  const [busyId, setBusyId] = useState<string | null>(null);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const markMissing = useCallback((cols: readonly string[]) => {
    let added = false;
    for (const c of cols) {
      if (missing.current.has(c)) continue;
      missing.current.add(c);
      added = true;
    }
    if (added) setMissingCols(new Set(missing.current));
    return added;
  }, []);

  const writes = useJobWrites(supabase, {
    strip: (p) => {
      const out: Record<string, unknown> = { ...p };
      for (const c of missing.current) delete out[c];
      return out as Partial<Job>;
    },
    onMissingColumn: (e, sent) => {
      const named = OPTIONAL_JOB_COLUMNS.filter((c) => (e.message ?? "").includes(c));
      return markMissing(named.length ? named : OPTIONAL_JOB_COLUMNS.filter((c) => c in sent));
    },
    rollback: (id, values) => setJobs((cur) => cur.map((j) => (j.id === id ? { ...j, ...values } : j))),
  });

  useEffect(() => {
    let cancelled = false;
    // Onboarding: nothing to tailor until the master resume exists.
    supabase
      .from("resumes")
      .select("content")
      .eq("is_master", true)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && (!data || isEmptyResume(normalizeResume(data.content)))) {
          stashCapture();
          router.replace("/resume");
          return;
        }
        setReady(true);
      });

    (async () => {
      const select = (cols: string) => supabase.from("jobs").select(cols).order("created_at", { ascending: false });
      let res = await select(`${BASE_COLS}, ${COLS_0002}, ${COLS_0003}`);
      let gone: string[] = [];
      if (res.error && isMissingColumn(res.error)) {
        gone = ["reached_interview"];
        res = await select(`${BASE_COLS}, ${COLS_0002}`);
      }
      if (res.error && isMissingColumn(res.error)) {
        gone = [...OPTIONAL_JOB_COLUMNS];
        res = await select(BASE_COLS);
      }
      if (cancelled) return;
      markMissing(gone);
      if (res.error) {
        console.error("Loading jobs failed:", res.error);
        setLoadError(dbErrorMessage(res.error, "load"));
      }
      const rows = (res.data ?? []) as unknown as Job[];
      setJobs(
        rows.map((j) => ({
          ...j,
          deadline: j.deadline ?? null,
          submitted_at: j.submitted_at ?? null,
          submitted_tailored: j.submitted_tailored ?? null,
          submitted_resume: null,
          reached_interview: j.reached_interview ?? false,
        })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Show the change now and save it in the background (retrying on failure). */
  function setField(j: Job, patch: Partial<Job>) {
    writes.queue(j, patch);
    setJobs((cur) => cur.map((x) => (x.id === j.id ? { ...x, ...patch } : x)));
  }

  /**
   * All status logic lives in applyStatusChange: the first move into a sent status freezes the saved
   * tailored copy (or the master) after a placeholder warning, sets the applied date; moving back
   * offers to clear the submission; Interview/Offer sets reached_interview.
   */
  async function setStatus(j: Job, next: JobStatus) {
    if (next === j.status || busyId === j.id) return;
    setError("");
    let sentResume: Resume | null = null;
    let master: Resume | null = null;
    if (shouldSnapshot(next, j.submitted_at) && !missing.current.has("submitted_resume")) {
      setBusyId(j.id);
      try {
        const [tailored, m] = await Promise.all([
          supabase.from("resumes").select("content").eq("job_id", j.id).maybeSingle(),
          supabase.from("resumes").select("content").eq("is_master", true).maybeSingle(),
        ]);
        if (tailored.error || m.error) throw tailored.error ?? m.error;
        master = m.data ? normalizeResume(m.data.content) : null;
        sentResume = tailored.data ? normalizeResume(tailored.data.content) : null;
      } catch (e) {
        console.warn("Loading resumes for the snapshot failed:", e);
        setError(RESUME_LOAD_ERROR);
        return;
      } finally {
        setBusyId(null);
      }
    }
    const patch = await applyStatusChange({
      job: j,
      next,
      sentResume,
      master,
      confirm: (message) => window.confirm(message),
    });
    if (!patch) return; // cancelled: the select still shows the saved status
    // Use the row as it is now (the user may have edited it while the resumes loaded).
    const current = jobsRef.current.find((x) => x.id === j.id) ?? j;
    setField(current, patch);
  }

  const needsMigration = missingCols.has("deadline");
  const today = localToday();
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: jobs.length, closing: 0 };
    for (const j of jobs) {
      c[j.status] = (c[j.status] ?? 0) + 1;
      if (isClosingSoon(j.deadline, j.status, today)) c.closing++;
    }
    return c;
  }, [jobs, today]);
  const due = jobs.filter((j) => j.follow_up_date && j.follow_up_date <= today && j.status === "applied");
  const shown = useMemo(() => {
    const list =
      filter === "all"
        ? jobs
        : filter === "closing"
          ? jobs.filter((j) => isClosingSoon(j.deadline, j.status, today))
          : jobs.filter((j) => j.status === filter);
    if (sort === "newest") return list;
    // Soonest deadline first; jobs without one go last, newest first among themselves.
    return [...list].sort((a, b) =>
      a.deadline && b.deadline
        ? a.deadline.localeCompare(b.deadline)
        : a.deadline ? -1 : b.deadline ? 1 : b.created_at.localeCompare(a.created_at),
    );
  }, [jobs, filter, sort, today]);

  if (!ready) return <p className="text-muted">Loading…</p>;

  const noJobs = !loading && !loadError && jobs.length === 0;
  const chips: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    ...(needsMigration ? [] : [{ value: "closing" as const, label: "Closing soon" }]),
    ...STATUSES,
  ];
  const anyFailing = writes.states.size > 0;

  const migrationBanner = missingCols.size > 0 && (
    <div role="status" className="card border-ok bg-ok-bg p-3 text-sm">
      {MIGRATION_HINT}
      {needsMigration && " Deadlines and application snapshots are off until then."}
    </div>
  );

  if (noJobs) {
    return (
      <div className="space-y-3 sm:space-y-5">
        {migrationBanner}
        <AddJobForm />
        <p className="text-sm text-muted px-1">Jobs you add show up here, with their status, deadline and follow-ups.</p>
      </div>
    );
  }

  const appliedCell = (j: Job) =>
    SUBMITTED_STATUSES.has(j.status) ? (
      <input
        type="date"
        aria-label="Date applied"
        className="ghost-input text-xs"
        value={j.date_applied ?? ""}
        onChange={(e) => setField(j, { date_applied: e.target.value || null })}
      />
    ) : j.date_applied ? (
      <span className="text-xs text-muted">{shortDate(j.date_applied)}</span>
    ) : (
      <span className="text-muted">–</span>
    );

  return (
    <div className="space-y-3 sm:space-y-5">
      {migrationBanner}

      {/* Once there are jobs (or while they load), "Add a job" is a one-line button so the list starts on the first screen. */}
      <AddJobForm collapsible />

      {due.length > 0 && (
        <div className="card px-3 py-2 border-ok bg-ok-bg/50 text-sm flex items-baseline gap-2 overflow-x-auto whitespace-nowrap">
          <strong className="shrink-0">Follow-ups due ({due.length}):</strong>
          {due.map((j, i) => (
            <span key={j.id} className="shrink-0">
              <Link href={`/jobs/${j.id}`} className="underline">{j.company || j.title}</Link>
              {i < due.length - 1 && ","}
            </span>
          ))}
        </div>
      )}

      <OutcomeStats jobs={jobs} />

      {loadError && (
        <div role="alert" className="card border-bad/40 p-3 text-sm flex flex-wrap items-center gap-3">
          <span className="flex-1 min-w-48 text-bad">{loadError}</span>
          <button className="btn btn-sm min-h-10 sm:min-h-0" onClick={() => location.reload()}>Reload</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex sm:flex-1 min-w-0 items-center gap-2 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap pb-1">
          {chips.map((s) => (
            <button
              key={s.value}
              onClick={() => setFilter(s.value)}
              aria-pressed={filter === s.value}
              className={`chip shrink-0 min-h-10 px-3 sm:min-h-0 sm:px-2 py-1 ${
                filter === s.value
                  ? "bg-fg text-bg border-fg"
                  : s.value === "closing" && counts.closing
                    ? "border-ok text-ok"
                    : "hover:border-fg/40"
              }`}
            >
              {s.label} {counts[s.value] ?? 0}
            </button>
          ))}
        </div>
        {!needsMigration && (
          <label className="shrink-0 pb-1 flex items-center gap-2 self-end sm:self-auto">
            <span className="text-xs text-muted">Sort</span>
            <select className="input py-1 text-xs min-h-10 sm:min-h-0" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="newest">Newest added</option>
              <option value="deadline">Deadline soonest</option>
            </select>
          </label>
        )}
      </div>

      {/* Phones: one card per job */}
      <div className="sm:hidden space-y-2">
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted">{jobs.length ? "No jobs match this filter." : ""}</p>
        ) : (
          shown.map((j) => {
            const urgency = deadlineUrgency(j.deadline, j.status, today);
            const fit = fitOf(j.analysis);
            return (
              <div
                key={j.id}
                className={`card p-3 space-y-2 ${urgency === "overdue" ? "border-l-4 border-l-bad" : urgency === "soon" ? "border-l-4 border-l-ok" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <Link href={`/jobs/${j.id}`} className="flex-1 min-w-0">
                    <div className="font-medium truncate">{j.title || "Untitled role"}</div>
                    <div className="text-sm text-muted truncate">
                      {[j.company, j.location].filter(Boolean).join(" · ")}
                    </div>
                  </Link>
                  {fit && <FitBadge fit={fit} />}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <StatusSelect value={j.status} onChange={(status) => setStatus(j, status)} />
                  {busyId === j.id && <span className="text-xs text-muted">Saving a copy…</span>}
                  {!needsMigration && (
                    <DeadlineField
                      compact
                      value={j.deadline}
                      status={j.status}
                      today={today}
                      onChange={(deadline) => setField(j, { deadline })}
                    />
                  )}
                  {j.date_applied && <span className="text-xs text-muted">Applied {shortDate(j.date_applied)}</span>}
                  {j.follow_up_date && j.status === "applied" && (
                    <span className={`text-xs ${j.follow_up_date <= today ? "text-ok font-medium" : "text-muted"}`}>
                      Follow up {shortDate(j.follow_up_date)}
                    </span>
                  )}
                  <RowSaveNote state={writes.states.get(j.id)} onDiscard={() => writes.discard(j.id)} />
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="card overflow-x-auto hidden sm:block">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr className="border-b border-border">
              <th className="p-3 font-medium">Role</th>
              <th className="p-3 font-medium hidden lg:table-cell">Location</th>
              <th className="p-3 font-medium">Fit</th>
              <th className="p-3 font-medium">Status</th>
              {!needsMigration && <th className="p-3 font-medium">Deadline</th>}
              <th className="p-3 font-medium">Applied</th>
              <th className="p-3 font-medium hidden md:table-cell">Follow up</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-3 text-muted" colSpan={7}>Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr>
                <td className="p-3 text-muted" colSpan={7}>{jobs.length ? "No jobs match this filter." : ""}</td>
              </tr>
            ) : (
              shown.map((j) => {
                const fit = fitOf(j.analysis);
                return (
                  <tr key={j.id} className="border-b border-border last:border-0 hover:bg-bg/60 align-top">
                    <td className="p-3">
                      <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">
                        {j.title || "Untitled role"}
                      </Link>
                      <div className="text-muted">{j.company}</div>
                    </td>
                    <td className="p-3 hidden lg:table-cell text-muted">{j.location}</td>
                    <td className="p-3">{fit ? <FitBadge fit={fit} /> : <span className="text-muted">–</span>}</td>
                    <td className="p-3">
                      <div className="flex flex-col items-start gap-1">
                        <StatusSelect value={j.status} onChange={(status) => setStatus(j, status)} />
                        {busyId === j.id && <span className="text-xs text-muted">Saving a copy…</span>}
                        <RowSaveNote state={writes.states.get(j.id)} onDiscard={() => writes.discard(j.id)} />
                      </div>
                    </td>
                    {!needsMigration && (
                      <td className="p-3">
                        <DeadlineField
                          value={j.deadline}
                          status={j.status}
                          today={today}
                          onChange={(deadline) => setField(j, { deadline })}
                        />
                      </td>
                    )}
                    <td className="p-3">{appliedCell(j)}</td>
                    <td className="p-3 hidden md:table-cell">
                      <input
                        type="date"
                        aria-label="Follow-up date"
                        className="ghost-input text-xs"
                        value={j.follow_up_date ?? ""}
                        onChange={(e) => setField(j, { follow_up_date: e.target.value || null })}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Fixed "Not saved — retrying…" notice while any row's write is failing. */}
      <SaveErrorToast status={anyFailing ? "error" : "saved"} onRetry={writes.retryAll} />
    </div>
  );
}
