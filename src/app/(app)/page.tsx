"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { postApi } from "@/lib/api";
import { STATUSES, type Job, type JobStatus } from "@/lib/types";
import { FitBadge, StatusSelect, applyDates } from "@/components/StatusSelect";

const URL_RE = /^https?:\/\/\S+$/i;

export default function TrackerPage() {
  const supabase = createClient();
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState<JobStatus | "all">("all");

  useEffect(() => {
    supabase
      .from("jobs")
      .select("id, company, title, location, url, status, date_applied, follow_up_date, analysis, created_at")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setJobs((data as Job[]) ?? []);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(raw = input) {
    const value = raw.trim();
    if (!value) return;
    setBusy(true);
    setError("");
    const isUrl = URL_RE.test(value);
    const { data: json, error } = await postApi<{ id: string }>("/api/intake", isUrl ? { url: value } : { text: value });
    if (error || !json) {
      setBusy(false);
      setError(error ?? "Something went wrong.");
      return;
    }
    router.push(`/jobs/${json.id}`);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (/pdf|word|officedocument/.test(file.type)) {
        setError("PDF/Word files aren't supported yet. Open the file and paste the text instead.");
        return;
      }
      const text = await file.text();
      setInput(text);
      return;
    }
    const dropped = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (dropped) setInput(dropped.trim());
  }

  async function setField(id: string, patch: Partial<Job>) {
    setJobs(jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)));
    await supabase.from("jobs").update(patch).eq("id", id);
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: jobs.length };
    for (const j of jobs) c[j.status] = (c[j.status] ?? 0) + 1;
    return c;
  }, [jobs]);
  const today = new Date().toISOString().slice(0, 10);
  const due = jobs.filter((j) => j.follow_up_date && j.follow_up_date <= today && j.status === "applied");
  const shown = filter === "all" ? jobs : jobs.filter((j) => j.status === filter);

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`card p-4 space-y-3 transition ${dragging ? "border-accent ring-2 ring-accent/30" : ""}`}
      >
        <div>
          <h1 className="text-lg font-semibold">Add a job</h1>
          <p className="text-sm text-muted">
            Paste a job link (Greenhouse, Lever, Ashby and most company pages work) or the full description.
            You can also drop a link or text file here. LinkedIn, Handshake and Workday need login, so paste the text for those.
          </p>
        </div>
        <textarea
          className="input w-full h-24 sm:h-28"
          placeholder="https://job-boards.greenhouse.io/… or paste the description"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary py-2 w-full sm:w-auto" disabled={busy || !input.trim()} onClick={() => submit()}>
            {busy ? "Reading job…" : URL_RE.test(input.trim()) ? "Fetch job" : "Add job"}
          </button>
          {error && <p className="text-sm text-bad">{error}</p>}
        </div>
      </div>

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

      <div className="flex items-center gap-2 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap pb-1">
        {(["all", ...STATUSES.map((s) => s.value)] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`chip shrink-0 py-1 ${filter === s ? "bg-fg text-bg border-fg" : "hover:border-fg/40"}`}
          >
            {s === "all" ? "All" : STATUSES.find((x) => x.value === s)!.label} {counts[s] ?? 0}
          </button>
        ))}
      </div>

      {/* Phones: one card per job */}
      <div className="sm:hidden space-y-2">
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted">No jobs yet. Add one above.</p>
        ) : (
          shown.map((j) => (
            <div key={j.id} className="card p-3 space-y-2">
              <div className="flex items-start gap-2">
                <Link href={`/jobs/${j.id}`} className="flex-1 min-w-0">
                  <div className="font-medium truncate">{j.title || "Untitled role"}</div>
                  <div className="text-sm text-muted truncate">
                    {[j.company, j.location].filter(Boolean).join(" · ")}
                  </div>
                </Link>
                {j.analysis && <FitBadge score={j.analysis.fit_score} />}
              </div>
              <div className="flex items-center gap-2">
                <StatusSelect
                  value={j.status}
                  onChange={(status) =>
                    setField(j.id, { status, ...(status === "applied" && !j.date_applied ? applyDates() : {}) })
                  }
                />
                {j.follow_up_date && j.status === "applied" && (
                  <span className={`text-xs ${j.follow_up_date <= today ? "text-ok font-medium" : "text-muted"}`}>
                    Follow up {j.follow_up_date.slice(5)}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card overflow-x-auto hidden sm:block">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr className="border-b border-border">
              <th className="p-3 font-medium">Role</th>
              <th className="p-3 font-medium hidden md:table-cell">Location</th>
              <th className="p-3 font-medium">Fit</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium hidden sm:table-cell">Applied</th>
              <th className="p-3 font-medium hidden sm:table-cell">Follow up</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-3 text-muted" colSpan={6}>Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td className="p-3 text-muted" colSpan={6}>No jobs yet. Add one above.</td></tr>
            ) : (
              shown.map((j) => (
                <tr key={j.id} className="border-b border-border last:border-0 hover:bg-bg/60">
                  <td className="p-3">
                    <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">
                      {j.title || "Untitled role"}
                    </Link>
                    <div className="text-muted">{j.company}</div>
                  </td>
                  <td className="p-3 hidden md:table-cell text-muted">{j.location}</td>
                  <td className="p-3">
                    {j.analysis ? <FitBadge score={j.analysis.fit_score} /> : <span className="text-muted">–</span>}
                  </td>
                  <td className="p-3">
                    <StatusSelect
                      value={j.status}
                      onChange={(status) =>
                        setField(j.id, {
                          status,
                          ...(status === "applied" && !j.date_applied ? applyDates() : {}),
                        })
                      }
                    />
                  </td>
                  <td className="p-3 hidden sm:table-cell">
                    <input
                      type="date"
                      className="ghost-input text-xs"
                      value={j.date_applied ?? ""}
                      onChange={(e) => setField(j.id, { date_applied: e.target.value || null })}
                    />
                  </td>
                  <td className="p-3 hidden sm:table-cell">
                    <input
                      type="date"
                      className="ghost-input text-xs"
                      value={j.follow_up_date ?? ""}
                      onChange={(e) => setField(j.id, { follow_up_date: e.target.value || null })}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
