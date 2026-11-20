"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/login/actions";
import { STATUSES, type JobStatus } from "@/lib/types";
import { NAV_JOB_COLS, navJob, recentJobs, searchJobs, type NavJob } from "@/lib/jobNav";
import { UsageMeter } from "./UsageMeter";
import { DocIcon, HomeIcon, LineIcon, Logo, LogoutIcon, PlusIcon, SearchIcon, UserIcon } from "./icons";

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label])) as Record<JobStatus, string>;

/** One row of the sidebar: 28px tall, 13px text, muted until it is the current page. */
const ROW = "flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-[13px] leading-none";
const ROW_IDLE = "text-muted hover:bg-fg/[0.04] hover:text-fg";
const ROW_ACTIVE = "bg-fg/[0.05] font-medium text-fg";
const ICON = "h-[15px] w-[15px] shrink-0";

function JobRow({ j, active }: { j: NavJob; active: boolean }) {
  return (
    <li>
      <Link
        href={`/jobs/${j.id}`}
        aria-current={active ? "page" : undefined}
        className={`${ROW} ${active ? ROW_ACTIVE : ROW_IDLE}`}
      >
        <LineIcon className={`${ICON} ${active ? "text-fg" : "text-muted"}`} />
        <span className="min-w-0 flex-1 truncate">{j.title || "Untitled role"}</span>
        <span className="sr-only">
          {j.company ? `, ${j.company}` : ""}, {STATUS_LABEL[j.status]}
        </span>
      </Link>
    </li>
  );
}

/**
 * Desktop (lg and up) navigation, drawn on the grey window chrome: Dashboard, the master resume and
 * Add job; a search and the recent (or matching) jobs; then the usage meter (only when running low),
 * Account and Sign out.
 * Phones and tablets keep the header and bottom tab bar instead.
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

  const searching = query.trim().length > 0;
  const shown = searching ? searchJobs(jobs, query) : recentJobs(jobs);
  const heading = searching ? `Results (${shown.length})` : "Recent jobs";

  const link = (href: string, label: string, active: boolean, icon: React.ReactNode) => (
    <Link href={href} aria-current={active ? "page" : undefined} className={`${ROW} ${active ? ROW_ACTIVE : ROW_IDLE}`}>
      {icon}
      {label}
    </Link>
  );

  return (
    <nav aria-label="Workspace" className="flex h-dvh flex-col gap-4 overflow-hidden px-3 pb-3 pt-3 text-[13px]">
      <Link href="/" className="flex h-8 items-center gap-2 px-2 text-[13px] font-semibold text-fg">
        <Logo size={18} />
        Jawb
      </Link>

      <div className="space-y-px">
        {link("/", "Dashboard", path === "/", <HomeIcon className={ICON} />)}
        {link("/resume", "Master resume", path.startsWith("/resume"), <DocIcon className={ICON} />)}
        <Link href="/#add-job" className={`${ROW} ${ROW_IDLE}`}>
          <PlusIcon className={ICON} />
          Add job
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <label htmlFor="job-search" className="sr-only">Search jobs</label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            id="job-search"
            type="search"
            className="h-7 w-full rounded-md border border-transparent bg-fg/[0.06] pl-7 pr-2 text-[13px] outline-none placeholder:text-muted focus:border-fg/20"
            placeholder="Search jobs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <h2 className="px-2 pt-1 text-[13px] font-medium text-fg">{heading}</h2>
        <ul className="min-h-0 flex-1 space-y-px overflow-y-auto" aria-label={heading}>
          {shown.map((j) => (
            <JobRow key={j.id} j={j} active={path === `/jobs/${j.id}`} />
          ))}
          {!shown.length && (
            <li className="px-2 text-[13px] text-muted">{searching ? "No jobs match." : "Jobs you add show up here."}</li>
          )}
        </ul>
      </div>

      <div className="space-y-3">
        <UsageMeter />
        <div className="space-y-px">
          {link("/account", "Account", path.startsWith("/account"), <UserIcon className={ICON} />)}
          <form action={signOut}>
            <button className={`${ROW} ${ROW_IDLE} cursor-pointer`}>
              <LogoutIcon className={ICON} />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
