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
import { DocIcon, HomeIcon, Logo, LogoutIcon, PlusIcon, SearchIcon, UserIcon } from "./icons";

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
        className={`flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors ${active ? "bg-accent-soft text-fg" : "hover:bg-surface-2"}`}
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
  const link = (href: string, label: string, active: boolean, icon: React.ReactNode) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
        active ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-2 hover:text-fg"
      }`}
    >
      {icon}
      {label}
    </Link>
  );

  return (
    <nav aria-label="Workspace" className="flex h-full flex-col gap-4 overflow-hidden px-3 py-4">
      <Link href="/" className="flex items-center gap-2.5 px-2 font-semibold tracking-tight">
        <Logo />
        <span className="text-[15px]">Job Pipeline</span>
      </Link>
      <div className="space-y-0.5">
        {link("/", "Dashboard", path === "/", <HomeIcon />)}
        {link("/resume", "Master resume", path.startsWith("/resume"), <DocIcon />)}
      </div>
      <Link href="/#add-job" className="btn btn-primary w-full py-2.5"><PlusIcon className="h-4 w-4" /> Add job</Link>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <label htmlFor="job-search" className="sr-only">Search jobs</label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            id="job-search"
            type="search"
            className="input w-full py-2 pl-9 bg-surface-2"
            placeholder="Search jobs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="px-2 pt-1 text-xs font-semibold text-muted">{query.trim() ? `Results (${shown.length})` : "Recent jobs"}</p>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {shown.map((j) => (
            <JobRow key={j.id} j={j} active={path === `/jobs/${j.id}`} />
          ))}
          {!shown.length && (
            <li className="px-2 text-xs text-muted">{query.trim() ? "No jobs match." : "Jobs you add show up here."}</li>
          )}
        </ul>
      </div>

      <div className="space-y-2">
        <UsageMeter />
        <div className="flex items-center gap-1 text-sm">
          <div className="min-w-0 flex-1">{link("/account", "Account", path.startsWith("/account"), <UserIcon />)}</div>
          <form action={signOut}>
            <button
              className="grid h-9 w-9 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogoutIcon />
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
