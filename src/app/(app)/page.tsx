"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { STATUSES, type Job, type JobStatus, type Resume } from "@/lib/types";
import { fitOf } from "@/lib/fit";
import { isEmptyResume, normalizeResume } from "@/lib/resume";
import { shouldSnapshot } from "@/lib/outcomes";
import { dbErrorMessage, isMissingColumn, MIGRATION_0006_COLUMNS, MIGRATION_HINT, OPTIONAL_JOB_COLUMNS } from "@/lib/db";
import { addDays, localToday, shortDate } from "@/lib/dates";
import { applyStatusChange } from "@/lib/status";
import { useJobWrites, type RowSaveState } from "@/lib/jobWrites";
import { SaveErrorToast } from "@/lib/useAutosave";
import { FitBadge, StatusSelect } from "@/components/StatusSelect";
import { AddJobForm, stashCapture } from "@/components/AddJobForm";
import { OutcomeStats } from "@/components/OutcomeStats";
import { deadlineUrgency, isClosingSoon } from "@/components/DeadlineField";
import { InProgress } from "@/components/dashboard/InProgress";
import { NeedsAttention } from "@/components/dashboard/NeedsAttention";
import { StatStrip } from "@/components/dashboard/Overview";
import { CompanyMark } from "@/components/CompanyMark";

const BASE_COLS = "id, company, title, location, url, status, date_applied, follow_up_date, analysis, created_at, updated_at";
/** Added by migration 0002. */
const COLS_0002 = "deadline, submitted_at, submitted_tailored";
/** Added by migration 0003. */
const COLS_0003 = "reached_interview";
/** Added by migration 0006 (tailoring progress). */
const COLS_0006 = "suggestions_total, suggestions_pending";

/** "Followed up" moves the next follow-up this many days out (with Undo). */
const FOLLOW_UP_AGAIN_DAYS = 7;
/** After this long, "Loading…" says "Still loading…" so a slow phone connection doesn't look stuck. */
const SLOW_MS = 3000;

type Filter = JobStatus | "all" | "closing";

/** A follow-up is due: applied, and the follow-up date is today or past. */
const followUpDue = (j: Job, today: string) => j.status === "applied" && !!j.follow_up_date && j.follow_up_date <= today;

/** True once `active` has stayed true for `ms`. */
function useSlow(active: boolean, ms = SLOW_MS) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return slow;
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

/** "Followed up" on a row whose follow-up is due. */
function FollowedUpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn btn-sm min-h-9 sm:min-h-0 whitespace-nowrap"
      onClick={onClick}
      title={`Mark the follow-up done; the next one is due in ${FOLLOW_UP_AGAIN_DAYS} days`}
    >
      ✓ Followed up
    </button>
  );
}

/** A short confirmation with Undo, above the phone tab bar (and above the save-error notice when it shows). */
function UndoToast({ message, onUndo, onClose, raised }: { message: string; onUndo: () => void; onClose: () => void; raised: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed z-40 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md flex items-center gap-3 rounded-xl border border-good/40 bg-surface px-4 py-2.5 text-[13px] shadow-lg ${
        raised ? "bottom-[calc(9rem+env(safe-area-inset-bottom))] lg:bottom-20" : "bottom-[calc(4.25rem+env(safe-area-inset-bottom))] lg:bottom-4"
      }`}
    >
      <span className="flex-1 min-w-0 text-good">{message}</span>
      <button type="button" className="btn btn-sm shrink-0 min-h-9 sm:min-h-0" onClick={onUndo}>
        Undo
      </button>
      <button type="button" className="shrink-0 text-muted hover:text-fg px-1 min-h-8" aria-label="Dismiss" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

/** A date as plain text, or "–" when there isn't one. */
const dateText = (d: string | null) => (d ? shortDate(d) : "–");
/** Colour for a deadline: overdue red, closing soon green, otherwise the body colour. */
const dateTone = (urgency: ReturnType<typeof deadlineUrgency>) =>
  urgency === "overdue" ? "text-bad font-medium" : urgency === "soon" ? "text-ok font-medium" : "";

const RESUME_LOAD_ERROR =
  "Couldn't load your resume to save a copy of what you sent. Check your connection and try again.";

/** The dashboard: needs attention, add a job, in progress, and all applications. */
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
  /** Job whose status change is loading its resume (for the snapshot). */
  const [busyId, setBusyId] = useState<string | null>(null);
  /** "Followed up" just moved a follow-up date: Undo puts the old one back. */
  const [undo, setUndo] = useState<{ id: string; prev: string | null; message: string } | null>(null);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const slow = useSlow(!ready || loading);

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

  /** The columns to read, without the ones this database doesn't have. */
  const columns = useCallback(() => {
    if (missing.current.has("deadline")) return BASE_COLS;
    if (missing.current.has("reached_interview")) return `${BASE_COLS}, ${COLS_0002}`;
    if (missing.current.has("suggestions_total")) return `${BASE_COLS}, ${COLS_0002}, ${COLS_0003}`;
    return `${BASE_COLS}, ${COLS_0002}, ${COLS_0003}, ${COLS_0006}`;
  }, []);

  // Row writes: retried, merged while in flight, conditional on updated_at (see src/lib/jobWrites.ts).
  const writes = useJobWrites(supabase, {
    columns,
    strip: (p) => {
      const out: Record<string, unknown> = { ...p };
      for (const c of missing.current) delete out[c];
      return out as Partial<Job>;
    },
    onMissingColumn: (e, sent) => {
      const named = OPTIONAL_JOB_COLUMNS.filter((c) => (e.message ?? "").includes(c));
      return markMissing(named.length ? named : OPTIONAL_JOB_COLUMNS.filter((c) => c in sent));
    },
    // Discard (the saved values) or another device's changes after a conflict.
    onRowValues: (id, values) => setJobs((cur) => cur.map((j) => (j.id === id ? { ...j, ...values } : j))),
    onGone: (id) => setJobs((cur) => cur.filter((j) => j.id !== id)),
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
      let res = await select(`${BASE_COLS}, ${COLS_0002}, ${COLS_0003}, ${COLS_0006}`);
      let gone: string[] = [];
      if (res.error && isMissingColumn(res.error)) {
        gone = [...MIGRATION_0006_COLUMNS];
        res = await select(`${BASE_COLS}, ${COLS_0002}, ${COLS_0003}`);
      }
      if (res.error && isMissingColumn(res.error)) {
        gone = ["reached_interview", ...MIGRATION_0006_COLUMNS];
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
          suggestions_total: j.suggestions_total ?? null,
          suggestions_pending: j.suggestions_pending ?? null,
        })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);

  /** Show the change now and save it in the background (retrying on failure). */
  function setField(j: Job, patch: Partial<Job>) {
    writes.queue(j, patch);
    setJobs((cur) => cur.map((x) => (x.id === j.id ? { ...x, ...patch } : x)));
  }

  /** The row as it is on screen now (it may have changed since a handler captured it). */
  const current = (j: Job) => jobsRef.current.find((x) => x.id === j.id) ?? j;

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
    setField(current(j), patch);
  }

  /** "Followed up": the next follow-up is due a week from today, which clears today's flag. Undo puts it back. */
  function followedUp(j: Job) {
    const next = addDays(localToday(), FOLLOW_UP_AGAIN_DAYS);
    setField(j, { follow_up_date: next });
    setUndo({ id: j.id, prev: j.follow_up_date, message: `Followed up. Next follow-up ${shortDate(next)}.` });
  }

  function undoFollowUp() {
    if (!undo) return;
    const j = jobsRef.current.find((x) => x.id === undo.id);
    if (j) setField(j, { follow_up_date: undo.prev });
    setUndo(null);
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
  const due = jobs.filter((j) => followUpDue(j, today));
  // Newest added first (the order the jobs load in).
  const shown = useMemo(
    () =>
      filter === "all"
        ? jobs
        : filter === "closing"
          ? jobs.filter((j) => isClosingSoon(j.deadline, j.status, today))
          : jobs.filter((j) => j.status === filter),
    [jobs, filter, today],
  );
  // A date column shows only when a job in the current list has that date.
  const showDeadline = !needsMigration && shown.some((j) => j.deadline);
  const showApplied = shown.some((j) => j.date_applied);
  const showFollowUp = shown.some((j) => j.follow_up_date);
  const tableCols = 4 + [showDeadline, showApplied, showFollowUp].filter(Boolean).length;

  const loadingText = slow ? "Still loading…" : "Loading…";
  if (!ready) return <p role="status" className="text-muted">{loadingText}</p>;

  const noJobs = !loading && !loadError && jobs.length === 0;
  const allChips: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    ...(needsMigration ? [] : [{ value: "closing" as const, label: "Closing soon" }]),
    ...STATUSES,
  ];
  // Only the filters that have something behind them (and the one in use, so it can be switched off).
  const chips = allChips.filter((c) => c.value === "all" || c.value === filter || (counts[c.value] ?? 0) > 0);
  const anyFailing = writes.states.size > 0;
  const closing = needsMigration
    ? []
    : jobs.filter((j) => isClosingSoon(j.deadline, j.status, today)).sort((x, y) => (x.deadline ?? "").localeCompare(y.deadline ?? ""));

  const migrationBanner = missingCols.size > 0 && (
    <div role="status" className="card border-ok bg-ok-bg p-3 text-[13px]">
      {MIGRATION_HINT}
      {needsMigration && " Deadlines and application snapshots are off until then."}
      {!needsMigration && missingCols.has("suggestions_total") && " Progress in In progress shows once it's run."}
    </div>
  );

  return (
    <div className="space-y-6 px-4 sm:px-6 lg:px-10 py-5 sm:py-6">
      {migrationBanner}
      <h1 className="sr-only">Dashboard</h1>
      {!noJobs && <StatStrip jobs={jobs} attention={due.length + closing.length} />}
      <NeedsAttention followUps={due} closing={closing} today={today} onFollowedUp={followedUp} />

      <div className="grid gap-6 lg:gap-10 lg:grid-cols-12 lg:items-start">
        {/* Phones: Add a job comes first (a one-line button once there are jobs). Desktop: the right column. */}
        <div id="add-job" className="scroll-mt-4 lg:col-span-4 lg:col-start-9 lg:row-start-1">
          <AddJobForm existing={jobs} />
        </div>

        <div className="min-w-0 space-y-6 lg:col-span-8 lg:col-start-1 lg:row-start-1">
          <InProgress jobs={jobs} today={today} loading={loading} />

          <section aria-labelledby="all-apps-heading" className="space-y-3">
            <h2 id="all-apps-heading" className="text-[15px] font-semibold">All applications</h2>
            <OutcomeStats jobs={jobs} />

            {loadError && (
              <div role="alert" className="card border-bad/40 p-3 text-[13px] flex flex-wrap items-center gap-3">
                <span className="flex-1 min-w-48 text-bad">{loadError}</span>
                <button className="btn btn-sm min-h-10 sm:min-h-0" onClick={() => location.reload()}>Reload</button>
              </div>
            )}
            {error && <p role="alert" className="text-[13px] text-bad">{error}</p>}
            {noJobs && <p className="text-[13px] text-muted px-1">Jobs you add show up here, with their status, deadline and follow-ups.</p>}

            <div className="flex min-w-0 items-center gap-2 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap pb-1">
              {chips.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setFilter(s.value)}
                  aria-pressed={filter === s.value}
                  className={`chip shrink-0 min-h-10 px-3 sm:min-h-0 sm:px-2 py-0.5 ${
                    filter === s.value
                      ? "bg-surface-2 border-transparent text-fg font-medium"
                      : "text-muted hover:text-fg"
                  }`}
                >
                  {s.label} {counts[s.value] ?? 0}
                </button>
              ))}
            </div>

            {/* Phones: one card per job */}
            <div className="sm:hidden space-y-2">
              {loading ? (
                <p role="status" className="text-[13px] text-muted">{loadingText}</p>
              ) : shown.length === 0 ? (
                <p className="text-[13px] text-muted">{jobs.length ? "No jobs match this filter." : ""}</p>
              ) : (
                shown.map((j) => {
                  const urgency = deadlineUrgency(j.deadline, j.status, today);
                  const fit = fitOf(j.analysis);
                  const isDue = followUpDue(j, today);
                  return (
                    <div
                      key={j.id}
                      className={`card p-3 space-y-2 ${urgency === "overdue" ? "border-l-4 border-l-bad" : urgency === "soon" ? "border-l-4 border-l-ok" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        <CompanyMark name={j.company} className="h-8 w-8 text-xs" />
                        <Link href={`/jobs/${j.id}`} className="flex-1 min-w-0">
                          <div className="font-medium truncate">{j.title || "Untitled role"}</div>
                          <div className="text-[13px] text-muted truncate">
                            {[j.company, j.location].filter(Boolean).join(" · ")}
                          </div>
                        </Link>
                        {fit && <FitBadge fit={fit} />}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <StatusSelect value={j.status} onChange={(status) => setStatus(j, status)} />
                        {busyId === j.id && <span className="text-xs text-muted">Saving a copy…</span>}
                        {!needsMigration && j.deadline && (
                          <span className={`text-xs ${urgency === "overdue" ? "text-bad font-medium" : urgency === "soon" ? "text-ok font-medium" : "text-muted"}`}>
                            Deadline {shortDate(j.deadline)}
                          </span>
                        )}
                        {j.date_applied && <span className="text-xs text-muted">Applied {shortDate(j.date_applied)}</span>}
                        {j.follow_up_date && j.status === "applied" && (
                          <span className={`text-xs ${isDue ? "text-ok font-medium" : "text-muted"}`}>
                            Follow up {shortDate(j.follow_up_date)}
                          </span>
                        )}
                        {isDue && <FollowedUpButton onClick={() => followedUp(j)} />}
                        <RowSaveNote state={writes.states.get(j.id)} onDiscard={() => writes.discard(j.id)} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="overflow-x-auto hidden sm:block">
              <table className="w-full text-[13px]">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-4 font-medium">Role</th>
                    <th className="py-2 pr-4 font-medium hidden 2xl:table-cell">Location</th>
                    <th className="py-2 pr-4 font-medium">Fit</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    {showDeadline && <th className="py-2 pr-4 font-medium">Deadline</th>}
                    {showApplied && <th className="py-2 pr-4 font-medium">Applied</th>}
                    {showFollowUp && <th className="py-2 pr-4 font-medium hidden md:table-cell">Follow up</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    <tr><td role="status" className="p-3 text-muted" colSpan={tableCols}>{loadingText}</td></tr>
                  ) : shown.length === 0 ? (
                    <tr>
                      <td className="py-2.5 pr-4 text-muted" colSpan={tableCols}>{jobs.length ? "No jobs match this filter." : ""}</td>
                    </tr>
                  ) : (
                    shown.map((j) => {
                      const fit = fitOf(j.analysis);
                      const isDue = followUpDue(j, today);
                      return (
                        <tr key={j.id} className="align-middle">
                          <td className="py-2.5 pr-4">
                            <div className="flex min-w-60 items-center gap-3">
                              <CompanyMark name={j.company} className="h-8 w-8 text-xs" />
                              <div className="min-w-0">
                                <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">
                                  {j.title || "Untitled role"}
                                </Link>
                                <div className="text-muted">{j.company}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 pr-4 hidden 2xl:table-cell text-muted">{j.location}</td>
                          <td className="py-2.5 pr-4">{fit ? <FitBadge fit={fit} /> : <span className="text-muted">–</span>}</td>
                          <td className="py-2.5 pr-4">
                            <div className="flex flex-col items-start gap-1">
                              <StatusSelect value={j.status} onChange={(status) => setStatus(j, status)} />
                              {busyId === j.id && <span className="text-xs text-muted">Saving a copy…</span>}
                              {/* In the status column so it shows at every width (the follow-up column hides below md). */}
                              {isDue && <FollowedUpButton onClick={() => followedUp(j)} />}
                              <RowSaveNote state={writes.states.get(j.id)} onDiscard={() => writes.discard(j.id)} />
                            </div>
                          </td>
                          {showDeadline && (
                            <td className={`py-2.5 pr-4 ${j.deadline ? dateTone(deadlineUrgency(j.deadline, j.status, today)) : "text-muted"}`}>
                              {dateText(j.deadline)}
                            </td>
                          )}
                          {showApplied && <td className="py-2.5 pr-4 text-muted">{dateText(j.date_applied)}</td>}
                          {showFollowUp && (
                            <td className={`py-2.5 pr-4 hidden md:table-cell ${isDue ? "text-ok font-medium" : "text-muted"}`}>{dateText(j.follow_up_date)}</td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

          </section>
        </div>

      </div>

      {undo && <UndoToast message={undo.message} onUndo={undoFollowUp} onClose={() => setUndo(null)} raised={anyFailing} />}
      {/* Fixed "Not saved — retrying…" notice while any row's write is failing. */}
      <SaveErrorToast status={anyFailing ? "error" : "saved"} onRetry={writes.retryAll} />
    </div>
  );
}
