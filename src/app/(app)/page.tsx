"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { STATUSES, type Job, type JobStatus } from "@/lib/types";
import { fitOf } from "@/lib/fit";
import { isEmptyResume, normalizeResume } from "@/lib/resume";
import { snapshotPatch, shouldSnapshot } from "@/lib/outcomes";
import { isMissingColumn } from "@/lib/db";
import { FitBadge, StatusSelect, applyDates } from "@/components/StatusSelect";
import { AddJobForm, stashCapture } from "@/components/AddJobForm";
import { OutcomeStats } from "@/components/OutcomeStats";
import { DeadlineField, deadlineUrgency, isClosingSoon, localToday } from "@/components/DeadlineField";

const BASE_COLS = "id, company, title, location, url, status, date_applied, follow_up_date, analysis, created_at";
/** Added by migration 0002. */
const NEW_COLS = "deadline, submitted_at, submitted_tailored";
const MIGRATION_HINT = "Database update needed: run supabase/migrations/0002_deadlines_snapshots.sql in your Supabase SQL editor";


type Filter = JobStatus | "all" | "closing";
type Sort = "newest" | "deadline";

export default function TrackerPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");

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
      const full = await supabase.from("jobs").select(`${BASE_COLS}, ${NEW_COLS}`).order("created_at", { ascending: false });
      let data = full.data as Job[] | null;
      let err = full.error;
      if (err && isMissingColumn(err)) {
        setNeedsMigration(true);
        const base = await supabase.from("jobs").select(BASE_COLS).order("created_at", { ascending: false });
        data = (base.data as Job[] | null)?.map((j) => ({
          ...j, deadline: null, submitted_at: null, submitted_tailored: null, submitted_resume: null,
        })) ?? null;
        err = base.error;
      }
      if (cancelled) return;
      if (err) setError(err.message);
      setJobs(data ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(id: string, patch: Partial<Job>) {
    const { error } = await supabase.from("jobs").update(patch).eq("id", id);
    if (error) setError(isMissingColumn(error) ? MIGRATION_HINT : error.message);
  }

  function setField(id: string, patch: Partial<Job>) {
    setJobs((cur) => cur.map((j) => (j.id === id ? { ...j, ...patch } : j)));
    return save(id, patch);
  }

  /** The first move to Applied/Interview/Offer/Rejected also freezes a copy of exactly what was sent (once), for the outcome stats. */
  async function setStatus(j: Job, status: JobStatus) {
    const sending = shouldSnapshot(status, j.submitted_at);
    const patch: Partial<Job> = { status, ...(sending && !j.date_applied ? applyDates() : {}) };
    setJobs((cur) => cur.map((x) => (x.id === j.id ? { ...x, ...patch } : x)));
    if (sending && !needsMigration) {
      const [tailored, master] = await Promise.all([
        supabase.from("resumes").select("content").eq("job_id", j.id).maybeSingle(),
        supabase.from("resumes").select("content").eq("is_master", true).maybeSingle(),
      ]);
      const m = master.data ? normalizeResume(master.data.content) : null;
      const sent = tailored.data ? normalizeResume(tailored.data.content) : m;
      if (sent) {
        const snap = snapshotPatch(sent, m);
        Object.assign(patch, snap);
        setJobs((cur) => cur.map((x) => (x.id === j.id ? { ...x, ...snap } : x)));
      }
    }
    await save(j.id, patch);
  }

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

  const chips: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    ...(needsMigration ? [] : [{ value: "closing" as const, label: "Closing soon" }]),
    ...STATUSES,
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      {needsMigration && (
        <div className="card border-ok bg-ok-bg p-3 text-sm">
          <strong>Database update needed:</strong> run{" "}
          <code className="break-all">supabase/migrations/0002_deadlines_snapshots.sql</code> in your Supabase SQL editor.
          Deadlines and application snapshots are off until then.
        </div>
      )}

      <AddJobForm />

      {due.length > 0 && (
        <div className="card p-3 border-ok bg-ok-bg/50 text-sm">
          <strong>Follow-ups due:</strong>{" "}
          {due.map((j, i) => (
            <span key={j.id}>
              {i > 0 && ", "}
              <Link href={`/jobs/${j.id}`} className="underline">{j.company || j.title}</Link>
            </span>
          ))}
        </div>
      )}

      <OutcomeStats jobs={jobs} />

      {error && <p className="text-sm text-bad">{error}</p>}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex sm:flex-1 min-w-0 items-center gap-2 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap pb-1">
          {chips.map((s) => (
            <button
              key={s.value}
              onClick={() => setFilter(s.value)}
              className={`chip shrink-0 py-1 ${
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
            <select className="input py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
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
          <p className="text-sm text-muted">{jobs.length ? "No jobs match this filter." : "No jobs yet. Add one above."}</p>
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
                  {!needsMigration && (
                    <DeadlineField
                      compact
                      value={j.deadline}
                      status={j.status}
                      today={today}
                      onChange={(deadline) => setField(j.id, { deadline })}
                    />
                  )}
                  {j.follow_up_date && j.status === "applied" && (
                    <span className={`text-xs ${j.follow_up_date <= today ? "text-ok font-medium" : "text-muted"}`}>
                      Follow up {j.follow_up_date.slice(5)}
                    </span>
                  )}
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
                <td className="p-3 text-muted" colSpan={7}>
                  {jobs.length ? "No jobs match this filter." : "No jobs yet. Add one above."}
                </td>
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
                      <StatusSelect value={j.status} onChange={(status) => setStatus(j, status)} />
                    </td>
                    {!needsMigration && (
                      <td className="p-3">
                        <DeadlineField
                          value={j.deadline}
                          status={j.status}
                          today={today}
                          onChange={(deadline) => setField(j.id, { deadline })}
                        />
                      </td>
                    )}
                    <td className="p-3">
                      <input
                        type="date"
                        aria-label="Date applied"
                        className="ghost-input text-xs"
                        value={j.date_applied ?? ""}
                        onChange={(e) => setField(j.id, { date_applied: e.target.value || null })}
                      />
                    </td>
                    <td className="p-3 hidden md:table-cell">
                      <input
                        type="date"
                        aria-label="Follow-up date"
                        className="ghost-input text-xs"
                        value={j.follow_up_date ?? ""}
                        onChange={(e) => setField(j.id, { follow_up_date: e.target.value || null })}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
