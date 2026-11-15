"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/login/actions";
import { STATUSES, type JobStatus } from "@/lib/types";
import { NAV_JOB_COLS, navJob, recentJobs, searchJobs, type NavJob } from "@/lib/jobNav";
import { UsageMeter } from "./UsageMeter";
import { DocIcon, HomeIcon, Logo, LogoutIcon, PlusIcon, SearchIcon, UserIcon } from "./icons";
import { STATUS_DOT } from "./StatusSelect";

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label])) as Record<JobStatus, string>;

function JobRow({ j, active }: { j: NavJob; active: boolean }) {
  return (
    <li>
      <Link
        href={`/jobs/${j.id}`}
        aria-current={active ? "page" : undefined}
        className={`flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-sm ${active ? "bg-surface-2" : "hover:bg-surface-2"}`}
      >
        <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_DOT[j.status] }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{j.title || "Untitled role"}</span>
          <span className="block truncate text-xs text-muted">
            {j.company || "—"}
            <span className="sr-only">, {STATUS_LABEL[j.status]}</span>
          </span>
        </span>
        
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
      className={`flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-sm ${active ? "font-semibold text-fg" : "text-muted hover:text-fg"}`}
    >
      {icon}
      {label}
    </Link>
  );

  return (
    <nav aria-label="Workspace" className="flex h-dvh flex-col gap-6 overflow-hidden px-4 py-7">
      <Link href="/" className="flex items-center gap-2.5 px-3 text-lg font-semibold tracking-tight">
        <Logo />
        Job Pipeline
      </Link>
      <div className="space-y-1">
        {link("/", "Dashboard", path === "/", <HomeIcon />)}
        {link("/resume", "Master resume", path.startsWith("/resume"), <DocIcon />)}
        <Link href="/#add-job" className="flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-sm text-muted hover:text-fg">
          <PlusIcon />
          Add job
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <label htmlFor="job-search" className="sr-only">Search jobs</label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            id="job-search"
            type="search"
            className="input w-full rounded-full border-transparent bg-surface-2 py-2 pl-9"
            placeholder="Search jobs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pt-1" aria-label={query.trim() ? `Results (${shown.length})` : "Recent jobs"}>
          {shown.map((j) => (
            <JobRow key={j.id} j={j} active={path === `/jobs/${j.id}`} />
          ))}
          {!shown.length && (
            <li className="px-2 text-xs text-muted">{query.trim() ? "No jobs match." : "Jobs you add show up here."}</li>
          )}
        </ul>
      </div>

      <div className="space-y-3">
        <UsageMeter />
        <div className="space-y-1">
          {link("/account", "Account", path.startsWith("/account"), <UserIcon />)}
          <form action={signOut}>
            <button className="flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-sm text-muted hover:text-fg">
              <LogoutIcon />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
