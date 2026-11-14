"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/login/actions";
import { FIT_LABEL } from "@/lib/fit";
import { STATUSES, type JobStatus } from "@/lib/types";
import { NAV_JOB_COLS, navJob, recentJobs, searchJobs, type NavJob } from "@/lib/jobNav";
import { UsageMeter } from "./UsageMeter";

const DOT: Record<JobStatus, string> = {
  to_apply: "bg-border ring-1 ring-muted/40",
  applied: "bg-accent",
  interview: "bg-good",
  offer: "bg-good ring-2 ring-good/30",
  rejected: "bg-bad",
  skipped: "bg-muted/50",
};
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label])) as Record<JobStatus, string>;
const FIT_TEXT = { strong: "text-good", possible: "text-ok", stretch: "text-muted" } as const;

function JobRow({ j, active }: { j: NavJob; active: boolean }) {
  return (
    <li>
      <Link
        href={`/jobs/${j.id}`}
        aria-current={active ? "page" : undefined}
        className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${active ? "bg-accent/10 text-fg" : "hover:bg-bg"}`}
      >
        <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[j.status]}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{j.title || "Untitled role"}</span>
          <span className="block truncate text-xs text-muted">
            {j.company || "—"}
            <span className="sr-only">, {STATUS_LABEL[j.status]}</span>
          </span>
        </span>
        {j.fit && <span className={`shrink-0 text-[11px] ${FIT_TEXT[j.fit]}`}>{FIT_LABEL[j.fit]}</span>}
      </Link>
    </li>
  );
}

/**
 * Desktop (lg and up) navigation: Dashboard, the pinned master resume, recent jobs, a search over all
 * jobs, "+ Add job", and the usage meter, Account and Sign out at the bottom. Phones and tablets keep
 * the header and bottom tab bar instead.
 */
export function Sidebar() {
  const supabase = useMemo(() => createClient(), []);
  const path = usePathname();
  const [jobs, setJobs] = useState<NavJob[]>([]);
  const [query, setQuery] = useState("");

  // Re-read on navigation and when the window comes back, so new and renamed jobs show up.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase.from("jobs").select(NAV_JOB_COLS).order("updated_at", { ascending: false });
      if (!alive) return;
      if (error) return console.warn("Sidebar: loading jobs failed:", error.message);
      setJobs(((data ?? []) as unknown as Record<string, unknown>[]).map(navJob));
    };
    void load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, [supabase, path]);

  const shown = query.trim() ? searchJobs(jobs, query) : recentJobs(jobs);
  const link = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${active ? "bg-accent/10 font-medium text-fg" : "text-muted hover:bg-bg hover:text-fg"}`}
    >
      {label}
    </Link>
  );

  return (
    <nav aria-label="Workspace" className="flex h-dvh flex-col gap-4 overflow-hidden px-3 py-4">
      <Link href="/" className="px-2 font-semibold">Job Pipeline</Link>
      <div className="space-y-0.5">
        {link("/", "Dashboard", path === "/")}
        {link("/resume", "📌 Master resume", path.startsWith("/resume"))}
      </div>
      <Link href="/#add-job" className="btn btn-primary w-full">+ Add job</Link>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <label htmlFor="job-search" className="sr-only">Search jobs</label>
        <input
          id="job-search"
          type="search"
          className="input w-full py-1.5"
          placeholder="Search jobs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="label px-2">{query.trim() ? `Results (${shown.length})` : "Recent jobs"}</p>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {shown.map((j) => (
            <JobRow key={j.id} j={j} active={path === `/jobs/${j.id}`} />
          ))}
          {!shown.length && (
            <li className="px-2 text-xs text-muted">{query.trim() ? "No jobs match." : "Jobs you add show up here."}</li>
          )}
        </ul>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="px-2">
          <UsageMeter />
        </div>
        <div className="flex items-center gap-1 text-sm">
          {link("/account", "Account", path.startsWith("/account"))}
          <form action={signOut} className="ml-auto">
            <button className="rounded-lg px-2 py-1.5 text-muted hover:bg-bg hover:text-fg">Sign out</button>
          </form>
        </div>
      </div>
    </nav>
  );
}
