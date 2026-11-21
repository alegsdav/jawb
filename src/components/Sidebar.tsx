"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/login/actions";
import { STATUSES, type JobStatus } from "@/lib/types";
import {
  NAV_JOB_COLS, navJob, readPins, readVisits, recordVisit, savePins, saveVisits, searchJobs, sidebarJobs,
  withPin, withoutPin, withoutVisit, type NavJob, type Visits,
} from "@/lib/jobNav";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";
import { Menu, MenuItem, MenuSeparator } from "./Menu";
import { UsageMeter } from "./UsageMeter";
import { DocIcon, HomeIcon, LineIcon, Logo, LogoutIcon, MoreIcon, PlusIcon, SearchIcon, SidebarIcon, UserIcon } from "./icons";

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label])) as Record<JobStatus, string>;

/** One row of the sidebar: 28px tall, 13px text, muted until it is the current page. */
const ROW_BASE = "flex h-7 w-full items-center gap-2.5 rounded-md text-[13px] leading-none";
const ROW = `${ROW_BASE} px-2`;
/** A job row keeps room on the right for its ⋯ button, so long titles truncate before it. */
const JOB_ROW = `${ROW_BASE} pl-2 pr-8`;
const ROW_IDLE = "text-muted hover:bg-fg/[0.04] hover:text-fg";
const ROW_ACTIVE = "bg-fg/[0.05] font-medium text-fg";
const ICON = "h-[15px] w-[15px] shrink-0";
/** A control in the collapsed rail: 32px square, icon centred. */
const RAIL_CTRL = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-fg/[0.04] hover:text-fg";
const RAIL_ACTIVE = "bg-fg/[0.05] text-fg";
/**
 * The row's ⋯ button (24px). Hidden until the row is hovered or focused, or its menu is open; always
 * shown on touch screens, which have no hover.
 */
const MORE_BTN =
  "flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted opacity-0 transition-opacity duration-150 hover:bg-fg/[0.06] hover:text-fg focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none";

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

/** What a job row can ask the sidebar to do. */
type RowActions = {
  open: (id: string) => void;
  pin: (id: string) => void;
  rename: (id: string) => void;
  endRename: (id: string, value: string | null) => void;
  remove: (j: NavJob) => void;
};

function JobRow({ j, active, pinned, renaming, a }: { j: NavJob; active: boolean; pinned: boolean; renaming: boolean; a: RowActions }) {
  const title = j.title || "Untitled role";
  return (
    <li data-job-id={j.id} className="group relative">
      {renaming ? (
        <input
          autoFocus
          defaultValue={j.title}
          aria-label="Job title"
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              a.endRename(j.id, e.currentTarget.value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              a.endRename(j.id, null);
            }
          }}
          onBlur={(e) => a.endRename(j.id, e.currentTarget.value)}
          className={`${ROW_BASE} w-full bg-fg/[0.06] px-2 text-fg outline-none ring-1 ring-fg/25`}
        />
      ) : (
        <Link
          href={`/jobs/${j.id}`}
          onClick={() => a.open(j.id)}
          aria-current={active ? "page" : undefined}
          className={`${JOB_ROW} ${active ? ROW_ACTIVE : ROW_IDLE}`}
        >
          <LineIcon className={`${ICON} ${active ? "text-fg" : "text-muted"}`} />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <span className="sr-only">
            {j.company ? `, ${j.company}` : ""}, {STATUS_LABEL[j.status]}
            {pinned ? ", pinned" : ""}
          </span>
        </Link>
      )}
      {!renaming && (
        // The popup is portalled (fixed, in document.body): the sidebar's nav and scrolling job list would clip it.
        <div className="absolute right-1 top-1/2 -translate-y-1/2">
          <Menu label={<MoreIcon className="h-4 w-4" />} title={`More options for ${title}`} buttonClassName={MORE_BTN} portal>
            <MenuItem onSelect={() => a.pin(j.id)}>{pinned ? "Unpin" : "Pin"}</MenuItem>
            <MenuItem onSelect={() => a.rename(j.id)}>Rename</MenuItem>
            <MenuSeparator />
            <MenuItem danger onSelect={() => a.remove(j)}>
              Delete
            </MenuItem>
          </Menu>
        </div>
      )}
    </li>
  );
}

/** Collapsed: the job as a 20px badge with the company's initial, labelled "<title> · <company>". */
function JobBadge({ j, active, a }: { j: NavJob; active: boolean; a: RowActions }) {
  const title = j.title || "Untitled role";
  const label = j.company ? `${title} · ${j.company}` : title;
  const initial = j.company.trim()[0]?.toUpperCase() ?? "·";
  return (
    <li data-job-id={j.id}>
      <Rail label={label}>
        <Link
          href={`/jobs/${j.id}`}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          onClick={() => a.open(j.id)}
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

/** Top of every job row in the sidebar, by job id (read before a reorder, to animate from). */
function rowTops(nav: HTMLElement | null): Map<string, number> {
  const tops = new Map<string, number>();
  nav?.querySelectorAll<HTMLElement>("li[data-job-id]").forEach((el) => tops.set(el.dataset.jobId ?? "", el.getBoundingClientRect().top));
  return tops;
}

/**
 * Desktop (lg and up) navigation, drawn on the grey window chrome: Dashboard, the master resume and
 * Add job; a search and the jobs (pinned ones first, then recent, or matching ones); then the usage meter
 * (only when running low), Account and Sign out. It collapses to a 56px icon rail (remembered in a cookie
 * the layout reads, so reloads don't flash). Phones and tablets keep the header and bottom tab bar instead.
 */
export function Sidebar({ initialCollapsed = false }: { initialCollapsed?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const path = usePathname();
  const router = useRouter();
  const [jobs, setJobs] = useState<NavJob[]>([]);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  // Per-device memory (localStorage): when each job was last opened, and the pinned job ids, newest pin first.
  const [visits, setVisits] = useState<Visits>({});
  const [pins, setPins] = useState<string[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // Mirrors renamingId for handlers: Enter unmounts the input, and that blur must not save a second time.
  const renamingRef = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearchOnOpen = useRef(false);
  const navRef = useRef<HTMLElement>(null);
  // Row tops captured by a click, so the reorder it causes can slide each row from where it was.
  const flipFrom = useRef<Map<string, number> | null>(null);

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

  // Load this device's visits and pins (storage is not read during render: the server has none).
  useEffect(() => {
    setVisits(readVisits());
    setPins(readPins());
  }, []);

  // A job page counts as a visit however it was reached (a click already recorded it, a direct load didn't).
  useEffect(() => {
    const m = /^\/jobs\/([^/]+)/.exec(path);
    if (m) setVisits(recordVisit(decodeURIComponent(m[1])));
  }, [path]);

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

  // After a click reorders the rows, slide each moved row from its old place to its new one (FLIP).
  // Runs after every commit, but does nothing unless a click just set flipFrom.
  useLayoutEffect(() => {
    const from = flipFrom.current;
    flipFrom.current = null;
    if (!from || !navRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    navRef.current.querySelectorAll<HTMLElement>("li[data-job-id]").forEach((el) => {
      const old = from.get(el.dataset.jobId ?? "");
      if (old === undefined) return;
      const delta = old - el.getBoundingClientRect().top;
      if (!delta) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${delta}px)`;
      void el.offsetHeight; // commit the start position before the transition begins
      el.style.transition = "transform 220ms cubic-bezier(.2,.8,.2,1)";
      el.style.transform = "";
      el.addEventListener("transitionend", () => (el.style.transition = ""), { once: true });
    });
  });

  /** Clicking a job moves it to the top at once, before the page change finishes. */
  function openJob(id: string) {
    flipFrom.current = rowTops(navRef.current);
    setVisits(recordVisit(id));
  }

  function togglePin(id: string) {
    const next = pins.includes(id) ? withoutPin(pins, id) : withPin(pins, id);
    setPins(next);
    savePins(next);
  }

  function startRename(id: string) {
    renamingRef.current = id;
    setRenamingId(id);
  }

  /** Enter or blur saves (value given), Escape cancels (null). Empty titles cancel too. */
  function endRename(id: string, value: string | null) {
    if (renamingRef.current !== id) return;
    renamingRef.current = null;
    setRenamingId(null);
    const title = value?.trim() ?? "";
    const was = jobs.find((j) => j.id === id);
    if (!title || !was || title === was.title) return;
    void renameJob(id, title, was.title);
  }

  async function renameJob(id: string, title: string, was: string) {
    const show = (t: string, updatedAt?: string) =>
      setJobs((cur) => cur.map((j) => (j.id === id ? { ...j, title: t, updated_at: updatedAt ?? j.updated_at } : j)));
    show(title);
    const { data, error } = await supabase.from("jobs").update({ title }).eq("id", id).select("id, updated_at").single();
    if (error || !data) {
      console.warn("Sidebar: renaming the job failed:", error?.message);
      show(was);
      return;
    }
    show(title, String(data.updated_at));
    window.dispatchEvent(new CustomEvent("jawb:job-renamed", { detail: { id, title } }));
  }

  async function deleteJob(j: NavJob) {
    if (!window.confirm("Delete this job and its tailored copy?")) return;
    const { error } = await supabase.from("jobs").delete().eq("id", j.id);
    if (error) return console.warn("Sidebar: deleting the job failed:", error.message);
    setJobs((cur) => cur.filter((x) => x.id !== j.id));
    const nextPins = withoutPin(readPins(), j.id);
    savePins(nextPins);
    setPins(nextPins);
    const nextVisits = withoutVisit(readVisits(), j.id);
    saveVisits(nextVisits);
    setVisits(nextVisits);
    window.dispatchEvent(new CustomEvent("jawb:jobs-changed", { detail: { id: j.id } }));
    if (path === `/jobs/${j.id}`) router.push("/");
  }

  const actions: RowActions = { open: openJob, pin: togglePin, rename: startRename, endRename, remove: deleteJob };

  // The rail shows no search box, so only an open sidebar searches.
  const searching = !collapsed && query.trim().length > 0;
  const { pinned, recent } = sidebarJobs(jobs, pins, visits);
  const pinnedIds = new Set(pins);
  const shown = searching ? searchJobs(jobs, query, 20, visits) : recent;
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

  const row = (j: NavJob) => (
    <JobRow
      key={j.id}
      j={j}
      active={path === `/jobs/${j.id}`}
      pinned={pinnedIds.has(j.id)}
      renaming={renamingId === j.id}
      a={actions}
    />
  );
  const badge = (j: NavJob) => <JobBadge key={j.id} j={j} active={path === `/jobs/${j.id}`} a={actions} />;

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
      ref={navRef}
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
          </>
        )}

        {collapsed ? (
          <ul className="min-h-0 flex-1 space-y-px overflow-y-auto" aria-label="Jobs">
            {pinned.map(badge)}
            {pinned.length > 0 && recent.length > 0 && <li aria-hidden className="mx-2 my-1 h-px bg-fg/10" />}
            {recent.map(badge)}
          </ul>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {searching ? (
              <section>
                <h2 className="px-2 pt-1 text-[13px] font-medium text-fg">{heading}</h2>
                <ul className="space-y-px" aria-label={heading}>
                  {shown.map(row)}
                  {!shown.length && <li className="px-2 text-[13px] text-muted">No jobs match.</li>}
                </ul>
              </section>
            ) : (
              <>
                {pinned.length > 0 && (
                  <section>
                    <h2 className="px-2 pt-1 text-[13px] font-medium text-fg">Pinned</h2>
                    <ul className="space-y-px" aria-label="Pinned jobs">
                      {pinned.map(row)}
                    </ul>
                  </section>
                )}
                <section>
                  <h2 className="px-2 pt-1 text-[13px] font-medium text-fg">{heading}</h2>
                  <ul className="space-y-px" aria-label={heading}>
                    {recent.map(row)}
                    {!recent.length && !pinned.length && <li className="px-2 text-[13px] text-muted">Jobs you add show up here.</li>}
                  </ul>
                </section>
              </>
            )}
          </div>
        )}
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
