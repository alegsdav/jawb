"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/login/actions";
import { STATUSES, type JobStatus } from "@/lib/types";
import { NAV_JOB_COLS, navJob, recentJobs, searchJobs, type NavJob } from "@/lib/jobNav";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";
import { UsageMeter } from "./UsageMeter";
import { DocIcon, HomeIcon, LineIcon, Logo, LogoutIcon, PlusIcon, SearchIcon, SidebarIcon, UserIcon } from "./icons";

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label])) as Record<JobStatus, string>;

/** One row of the sidebar: 28px tall, 13px text, muted until it is the current page. */
const ROW = "flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-[13px] leading-none";
const ROW_IDLE = "text-muted hover:bg-fg/[0.04] hover:text-fg";
const ROW_ACTIVE = "bg-fg/[0.05] font-medium text-fg";
const ICON = "h-[15px] w-[15px] shrink-0";
/** A control in the collapsed rail: 32px square, icon centred. */
const RAIL_CTRL = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-fg/[0.04] hover:text-fg";
const RAIL_ACTIVE = "bg-fg/[0.05] text-fg";

/**
 * Save the choice in a cookie (a year), so the server renders the sidebar at the right width from the
 * first paint: no flash of the expanded sidebar on reload. Blocked cookies just mean it lasts this page view.
 */
function saveCollapsed(collapsed: boolean) {
  try {
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* blocked cookies */
  }
}

/**
 * Collapsed rail item: a 32px row holding one control, with its label as a tooltip to the right.
 *
 * The tooltip is position: fixed, so no overflow container can clip it (the rail's jobs list has to
 * scroll, and an overflow-y scroll box always clips on x too). A fixed box is positioned against the
 * viewport and skips the clipping of any ancestor that is not its containing block. Its top comes from
 * the row's rect, written on mouse enter or focus, so the tooltip sits level with the row it labels.
 * It shows on hover, or when the control gets keyboard focus (:has keeps it on the row, not the link).
 */
function Rail({ label, children }: { label: string; children: React.ReactNode }) {
  const tip = useRef<HTMLSpanElement>(null);
  const place = (e: React.SyntheticEvent<HTMLSpanElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (tip.current) tip.current.style.top = `${r.top + r.height / 2}px`;
  };
  return (
    <span className="group flex h-8 w-full items-center justify-center" onMouseEnter={place} onFocus={place}>
      {children}
      <span
        ref={tip}
        aria-hidden
        className="pointer-events-none fixed left-16 z-50 -translate-y-1/2 whitespace-nowrap rounded bg-fg px-2 py-1 text-[12px] leading-none text-surface opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 motion-reduce:transition-none"
      >
        {label}
      </span>
    </span>
  );
}

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

/** Collapsed: the job as a 20px badge with the company's initial, labelled "<title> · <company>". */
function JobBadge({ j, active }: { j: NavJob; active: boolean }) {
  const title = j.title || "Untitled role";
  const label = j.company ? `${title} · ${j.company}` : title;
  const initial = j.company.trim()[0]?.toUpperCase() ?? "·";
  return (
    <li>
      <Rail label={label}>
        <Link
          href={`/jobs/${j.id}`}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className={`${RAIL_CTRL} ${active ? RAIL_ACTIVE : ""}`}
        >
          <span aria-hidden className="grid h-5 w-5 place-items-center rounded-md bg-fg/[0.06] text-[11px] font-semibold leading-none text-fg">
            {initial}
          </span>
        </Link>
      </Rail>
    </li>
  );
}

/**
 * Desktop (lg and up) navigation, drawn on the grey window chrome: Dashboard, the master resume and
 * Add job; a search and the recent (or matching) jobs; then the usage meter (only when running low),
 * Account and Sign out. It collapses to a 56px icon rail (remembered in a cookie the layout reads, so reloads don't flash).
 * Phones and tablets keep the header and bottom tab bar instead.
 */
export function Sidebar({ initialCollapsed = false }: { initialCollapsed?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const path = usePathname();
  const [jobs, setJobs] = useState<NavJob[]>([]);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearchOnOpen = useRef(false);

  const setCollapsedAndSave = (next: boolean) => {
    setCollapsed(next);
    saveCollapsed(next);
  };

  // The rail's search button opens the sidebar and puts the caret in the search box.
  useEffect(() => {
    if (!collapsed && focusSearchOnOpen.current) {
      focusSearchOnOpen.current = false;
      searchRef.current?.focus();
    }
  }, [collapsed]);

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

  // The rail shows no search box, so only an open sidebar searches.
  const searching = !collapsed && query.trim().length > 0;
  const shown = searching ? searchJobs(jobs, query) : recentJobs(jobs);
  const heading = searching ? `Results (${shown.length})` : "Recent jobs";

  const link = (href: string, label: string, active: boolean, icon: React.ReactNode) => (
    <Link href={href} aria-current={active ? "page" : undefined} className={`${ROW} ${active ? ROW_ACTIVE : ROW_IDLE}`}>
      {icon}
      {label}
    </Link>
  );

  /** One icon-only item of the collapsed rail. */
  const railLink = (href: string, label: string, active: boolean, icon: React.ReactNode) => (
    <Rail label={label}>
      <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={`${RAIL_CTRL} ${active ? RAIL_ACTIVE : ""}`}>
        {icon}
      </Link>
    </Rail>
  );

  const toggle = (
    <button
      type="button"
      onClick={() => setCollapsedAndSave(!collapsed)}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-fg/[0.04] hover:text-fg ${collapsed ? "" : "ml-auto"}`}
    >
      <SidebarIcon className={ICON} />
    </button>
  );

  return (
    <nav
      aria-label="Workspace"
      className={`flex h-dvh flex-col gap-4 overflow-hidden px-3 pb-3 pt-3 text-[13px] transition-[width] duration-150 motion-reduce:transition-none ${collapsed ? "w-14" : "w-[232px]"}`}
    >
      {collapsed ? (
        <Rail label="Expand sidebar">{toggle}</Rail>
      ) : (
        <div className="flex h-8 items-center">
          <Link href="/" className="flex h-8 items-center gap-2 px-2 text-[13px] font-semibold text-fg">
            <Logo size={18} />
            Jawb
          </Link>
          {toggle}
        </div>
      )}

      {collapsed ? (
        <div className="flex flex-col items-center gap-px">
          {railLink("/", "Dashboard", path === "/", <HomeIcon className={ICON} />)}
          {railLink("/resume", "Master resume", path.startsWith("/resume"), <DocIcon className={ICON} />)}
          {railLink("/#add-job", "Add job", false, <PlusIcon className={ICON} />)}
        </div>
      ) : (
        <div className="space-y-px">
          {link("/", "Dashboard", path === "/", <HomeIcon className={ICON} />)}
          {link("/resume", "Master resume", path.startsWith("/resume"), <DocIcon className={ICON} />)}
          <Link href="/#add-job" className={`${ROW} ${ROW_IDLE}`}>
            <PlusIcon className={ICON} />
            Add job
          </Link>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {collapsed ? (
          <div className="flex flex-col items-center gap-px">
            <Rail label="Search jobs">
              <button
                type="button"
                aria-label="Search jobs"
                onClick={() => {
                  focusSearchOnOpen.current = true;
                  setCollapsedAndSave(false);
                }}
                className={RAIL_CTRL}
              >
                <SearchIcon className={ICON} />
              </button>
            </Rail>
          </div>
        ) : (
          <>
            <label htmlFor="job-search" className="sr-only">Search jobs</label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                ref={searchRef}
                id="job-search"
                type="search"
                className="h-7 w-full rounded-md border border-transparent bg-fg/[0.06] pl-7 pr-2 text-[13px] outline-none placeholder:text-muted focus:border-fg/20"
                placeholder="Search jobs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <h2 className="px-2 pt-1 text-[13px] font-medium text-fg">{heading}</h2>
          </>
        )}
        <ul className="min-h-0 flex-1 space-y-px overflow-y-auto" aria-label={heading}>
          {collapsed
            ? shown.map((j) => <JobBadge key={j.id} j={j} active={path === `/jobs/${j.id}`} />)
            : shown.map((j) => <JobRow key={j.id} j={j} active={path === `/jobs/${j.id}`} />)}
          {!collapsed && !shown.length && (
            <li className="px-2 text-[13px] text-muted">{searching ? "No jobs match." : "Jobs you add show up here."}</li>
          )}
        </ul>
      </div>

      {collapsed ? (
        <div className="flex flex-col items-center gap-px">
          {railLink("/account", "Account", path.startsWith("/account"), <UserIcon className={ICON} />)}
          <form action={signOut} className="w-full">
            <Rail label="Sign out">
              <button aria-label="Sign out" className={RAIL_CTRL}>
                <LogoutIcon className={ICON} />
              </button>
            </Rail>
          </form>
        </div>
      ) : (
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
      )}
    </nav>
  );
}
