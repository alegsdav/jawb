"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isMissingRelation } from "@/lib/db";
import { signOut } from "@/app/login/actions";
import { STATUSES, type JobStatus } from "@/lib/types";
import {
  NAV_JOB_COLS, clearLocalNav, localNavPresent, navJob, navStateFromRows, readPins, readVisits, recordVisit, savePins,
  saveVisits, searchJobs, sidebarJobs, visitsToUpload, withPin, withVisit, withoutPin, withoutVisit,
  type NavJob, type NavRow, type Visits,
} from "@/lib/jobNav";
import { useSidebar } from "./sidebarState";
import { Menu, MenuItem, MenuSeparator } from "./Menu";
import { useAccount } from "./account";
import { UsageMeter } from "./UsageMeter";
import { DocIcon, HomeIcon, MoreIcon, PlusIcon, SearchIcon, SidebarIcon, Wordmark } from "./icons";

/** Module-wide: the one-time upload of this device's local pins and visits is running (dev StrictMode and a focus
 *  reload can start a second load meanwhile; that one skips the upload). */
let uploadingLocalNav = false;

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label])) as Record<JobStatus, string>;

/** One row of the sidebar: 32px tall, 14px text, muted until it is the current page. */
// leading-5, not leading-none: a 13px line box would cut off descenders (g, y, p) where a title truncates (overflow hidden).
const ROW_BASE = "flex h-8 w-full items-center gap-2.5 rounded-lg text-[14px] leading-5 whitespace-nowrap";
const ROW = `${ROW_BASE} px-2`;
/** A job row keeps room on the right for its ⋯ button, so long titles truncate before it. */
const JOB_ROW = `${ROW_BASE} pl-2 pr-8`;
const ROW_IDLE = "text-muted hover:bg-fg/[0.04] hover:text-fg";
const ROW_ACTIVE = "bg-fg/[0.05] font-medium text-fg";
const ICON = "h-[17px] w-[17px] shrink-0";
/**
 * The row's ⋯ button (26px). Hidden until the row is hovered or focused, or its menu is open; always
 * shown on touch screens, which have no hover.
 */
const MORE_BTN =
  "flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-md text-muted opacity-0 transition-opacity duration-150 hover:bg-fg/[0.06] hover:text-fg focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none";

/** What a job row can ask the sidebar to do. */
type RowActions = {
  open: (id: string) => void;
  pin: (id: string) => void;
  rename: (id: string) => void;
  endRename: (id: string, value: string | null) => void;
  remove: (j: NavJob) => void;
};

function JobRow({
  j, active, pinned, renaming, a,
}: { j: NavJob; active: boolean; pinned: boolean; renaming: boolean; a: RowActions }) {
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
          className={`${JOB_ROW} overflow-hidden ${active ? ROW_ACTIVE : ROW_IDLE}`}
        >
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

/** Top of every job row in the sidebar, by job id (read before a reorder, to animate from). */
function rowTops(nav: HTMLElement | null): Map<string, number> {
  const tops = new Map<string, number>();
  nav?.querySelectorAll<HTMLElement>("li[data-job-id]").forEach((el) => tops.set(el.dataset.jobId ?? "", el.getBoundingClientRect().top));
  return tops;
}

/** The sidebar's toggle (32px, 18px glyph): collapse in the rail, expand in the peek. */
const TOGGLE =
  "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-fg/[0.06] hover:text-fg";

/**
 * Desktop (lg and up) navigation: Dashboard, the master resume and Add job; a search and the jobs (pinned ones
 * first, then recent, or matching ones); then the usage meter (only when running low) and the profile button
 * (Account and Sign out). Drawn two ways, by AppShell: the rail on the grey window chrome, or, while collapsed, the
 * same contents in the floating glass "peek" that hovering the expand button opens (`peek`; its toggle is white
 * and expands the rail). It stays mounted either way and keeps recording visits. Phones and tablets keep the
 * header and bottom tab bar instead.
 */
export function Sidebar({ peek = false, onExpand }: { peek?: boolean; onExpand?: () => void }) {
  const account = useAccount();
  const supabase = useMemo(() => createClient(), []);
  const path = usePathname();
  const router = useRouter();
  const { setCollapsed } = useSidebar();
  const [jobs, setJobs] = useState<NavJob[]>([]);
  const [query, setQuery] = useState("");
  // Per-device memory (localStorage): when each job was last opened, and the pinned job ids, newest pin first.
  const [visits, setVisits] = useState<Visits>({});
  const [pins, setPins] = useState<string[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // False until the first read: the job list stays empty instead of flashing "Jobs you add show up here."
  const [loaded, setLoaded] = useState(false);
  // Mirrors renamingId for handlers: Enter unmounts the input, and that blur must not save a second time.
  const renamingRef = useRef<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  // Row tops captured by a click, so the reorder it causes can slide each row from where it was.
  const flipFrom = useRef<Map<string, number> | null>(null);
  // Which store holds pins and visits: true once the account's job_nav has been read, false when migration
  // 0009 is missing (this device keeps them, as before), null until the first read.
  const navMode = useRef<boolean | null>(null);
  // Visits opened before navMode was known. They go to the account with the first read, or to this device's log.
  const pendingOpens = useRef<Visits>({});
  // Bumped by every write to job_nav, and counted while in flight: a read that overlaps a write can't put back older state.
  const navWrites = useRef(0);
  const navInFlight = useRef(0);
  // The job a click just recorded, so the path change that click causes doesn't record it again.
  const clickedId = useRef<string | null>(null);

  // Load this device's visits and pins (storage is not read during render: the server has none).
  useEffect(() => {
    setVisits(readVisits());
    setPins(readPins());
  }, []);

  /** Records a job opened: on the account when it is in use (the server's clock), else on this device. */
  const recordOpen = useCallback(
    (id: string) => {
      const now = new Date().toISOString();
      if (navMode.current === false) {
        setVisits(recordVisit(id, now));
        return;
      }
      setVisits((cur) => ({ ...cur, [id]: now }));
      if (navMode.current === null) {
        pendingOpens.current[id] = now;
        return;
      }
      navWrites.current++;
      navInFlight.current++;
      const send = async () => {
        try {
          const { data, error } = await supabase.rpc("record_job_visit", { p_job: id });
          if (error) return console.warn("Sidebar: recording the visit failed:", error.message);
          // The server's time replaces ours, so every device sorts the job the same way.
          if (typeof data === "string") setVisits((cur) => ({ ...cur, [id]: data }));
        } finally {
          navInFlight.current--;
        }
      };
      void send();
    },
    [supabase],
  );

  // A job page counts as a visit however it was reached: a click already recorded it, a direct load didn't.
  useEffect(() => {
    const skip = clickedId.current;
    clickedId.current = null;
    const m = /^\/jobs\/([^/]+)/.exec(path);
    if (!m) return;
    const id = decodeURIComponent(m[1]);
    if (skip !== id) recordOpen(id);
  }, [path, recordOpen]);

  // Re-read on navigation and when the window comes back, so new, renamed, pinned and visited jobs show up on
  // every device. The jobs and the account's visits and pins are read together.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const quiet = navInFlight.current === 0;
      const writes = navWrites.current;
      const [jobsRes, navRes] = await Promise.all([
        supabase.from("jobs").select(NAV_JOB_COLS).order("updated_at", { ascending: false }),
        supabase.from("job_nav").select("job_id, visited_at, pinned_at"),
      ]);
      if (!alive) return;
      if (jobsRes.error) return console.warn("Sidebar: loading jobs failed:", jobsRes.error.message);
      const list = ((jobsRes.data ?? []) as unknown as Record<string, unknown>[]).map(navJob);
      // The jobs go on screen together with the account's pins and visits, so the Pinned section doesn't pop in
      // above the recent list a moment later (and push it down).
      const showJobs = () => {
        setJobs(list);
        setLoaded(true);
      };

      if (navRes.error) {
        if (!isMissingRelation(navRes.error)) return console.warn("Sidebar: loading the job order failed:", navRes.error.message);
        // Migration 0009 isn't run yet: visits and pins stay on this device, as before.
        if (navMode.current !== false) console.info("Sidebar: pins and visit order stay on this device until migration 0009 is run.");
        navMode.current = false;
        showJobs();
        const pending = pendingOpens.current;
        pendingOpens.current = {};
        if (Object.keys(pending).length) {
          let log = readVisits();
          for (const [id, at] of Object.entries(pending)) log = withVisit(log, id, at);
          saveVisits(log);
        }
        return;
      }

      navMode.current = true;
      let rows = (navRes.data ?? []) as NavRow[];
      // This device's own data (from before the account kept it) goes up once, then its keys are removed.
      const pending = { ...pendingOpens.current };
      if (!uploadingLocalNav && (localNavPresent() || Object.keys(pending).length)) {
        uploadingLocalNav = true;
        try {
          const ids = list.map((j) => j.id);
          const known = new Set(ids);
          const account = navStateFromRows(rows);
          const local = { visits: { ...readVisits(), ...pending }, pins: readPins() };
          let ok = true;
          // Oldest pin first, so the newest local pin is also the newest on the account.
          for (const id of local.pins.filter((p) => known.has(p) && !account.pins.includes(p)).reverse()) {
            const { error } = await supabase.rpc("set_job_pinned", { p_job: id, p_pinned: true });
            if (error) {
              ok = false;
              console.warn("Sidebar: moving a pin to the account failed:", error.message);
              break;
            }
          }
          const visitRows = visitsToUpload(local.visits, account.visits, ids);
          if (ok && visitRows.length) {
            const { error } = await supabase.from("job_nav").upsert(visitRows, { onConflict: "job_id", ignoreDuplicates: false });
            if (error) {
              ok = false;
              console.warn("Sidebar: moving visits to the account failed:", error.message);
            }
          }
          if (ok) {
            clearLocalNav();
            pendingOpens.current = {};
            const again = await supabase.from("job_nav").select("job_id, visited_at, pinned_at");
            if (!again.error) rows = (again.data ?? []) as NavRow[];
          }
        } finally {
          uploadingLocalNav = false;
        }
      }

      // Skip the apply if any write overlapped this read: the write's own state is already on screen.
      if (!alive) return;
      if (!quiet || navInFlight.current > 0 || navWrites.current !== writes) return showJobs();
      const state = navStateFromRows(rows);
      showJobs();
      setVisits(state.visits);
      setPins(state.pins);
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
    // Hidden (display:none, sidebar collapsed): every rect reads 0, so there is nothing to slide from.
    if (!from || !navRef.current || navRef.current.getClientRects().length === 0) return;
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
    clickedId.current = id;
    recordOpen(id);
  }

  /** Pin or unpin: the list changes at once, and the account is told in the background. */
  function togglePin(id: string) {
    const pin = !pins.includes(id);
    const next = pin ? withPin(pins, id) : withoutPin(pins, id);
    setPins(next);
    if (navMode.current !== true) {
      savePins(next);
      return;
    }
    navWrites.current++;
    navInFlight.current++;
    const send = async () => {
      try {
        const { error } = await supabase.rpc("set_job_pinned", { p_job: id, p_pinned: pin });
        if (!error) return;
        console.warn("Sidebar: saving the pin failed:", error.message);
        // Put the list back the way it was (an unpin that failed goes back to the top of the pins).
        setPins((cur) => (pin ? withoutPin(cur, id) : withPin(cur, id)));
      } finally {
        navInFlight.current--;
      }
    };
    void send();
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
    // The database cascade removes the job's account row; here it leaves the lists and this device's copy.
    navWrites.current++;
    setJobs((cur) => cur.filter((x) => x.id !== j.id));
    setPins((cur) => withoutPin(cur, j.id));
    setVisits((cur) => withoutVisit(cur, j.id));
    delete pendingOpens.current[j.id];
    if (navMode.current !== true) {
      savePins(withoutPin(readPins(), j.id));
      saveVisits(withoutVisit(readVisits(), j.id));
    }
    window.dispatchEvent(new CustomEvent("jawb:jobs-changed", { detail: { id: j.id } }));
    if (path === `/jobs/${j.id}`) router.push("/");
  }

  const actions: RowActions = { open: openJob, pin: togglePin, rename: startRename, endRename, remove: deleteJob };

  const searching = query.trim().length > 0;
  const { pinned, recent } = sidebarJobs(jobs, pins, visits);
  const pinnedIds = new Set(pins);
  const shown = searching ? searchJobs(jobs, query, 20, visits) : recent;
  const heading = searching ? `Results (${shown.length})` : "Recent jobs";

  /** A nav row: icon, then its label. */
  const link = (href: string, text: string, active: boolean, icon: React.ReactNode) => (
    <Link href={href} aria-current={active ? "page" : undefined} className={`${ROW} overflow-hidden ${active ? ROW_ACTIVE : ROW_IDLE}`}>
      {icon}
      <span>{text}</span>
    </Link>
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
  const sectionHeading = (text: string) => (
    <h2 className="overflow-hidden whitespace-nowrap px-2 pt-1 pb-0.5 text-[13px] font-medium text-muted">{text}</h2>
  );

  return (
    <nav
      ref={navRef}
      aria-label="Workspace"
      className={`flex flex-col gap-4 overflow-hidden px-3 pb-3 pt-3 text-[14px] ${peek ? "h-full w-full" : "h-dvh w-[248px]"}`}
    >
      {peek ? (
        // The toggle sits exactly where the expand button it covers is (AppShell), so the pointer lands on it.
        <div className="flex h-8 items-center gap-3">
          <button type="button" onClick={onExpand} aria-label="Expand sidebar" aria-expanded={false} className={TOGGLE}>
            <SidebarIcon className="h-[18px] w-[18px] shrink-0" />
          </button>
          <Link href="/" className="flex h-8 min-w-0 items-center">
            <Wordmark />
          </Link>
        </div>
      ) : (
        <div className="flex h-8 items-center">
          <Link href="/" className="flex h-8 min-w-0 items-center px-2">
            <Wordmark />
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse sidebar"
            aria-expanded
            className={`ml-auto ${TOGGLE}`}
          >
            <SidebarIcon className="h-[18px] w-[18px] shrink-0" />
          </button>
        </div>
      )}

      <div className="space-y-px">
        {link("/", "Dashboard", path === "/", <HomeIcon className={ICON} />)}
        {link("/resume", "Master resume", path.startsWith("/resume"), <DocIcon className={ICON} />)}
        {link("/#add-job", "Add job", false, <PlusIcon className={ICON} />)}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <label htmlFor="job-search" className="sr-only">Search jobs</label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            id="job-search"
            type="search"
            placeholder="Search jobs"
            className="h-8 w-full rounded-lg border border-transparent bg-fg/[0.06] pl-8 pr-2 text-[14px] outline-none placeholder:text-muted focus:border-fg/20"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden">
          {searching ? (
            <section>
              {sectionHeading(heading)}
              <ul className="space-y-px" aria-label={heading}>
                {shown.map(row)}
                {!shown.length && <li className="px-2 text-[14px] text-muted">No jobs match.</li>}
              </ul>
            </section>
          ) : (
            <>
              {pinned.length > 0 && (
                <section>
                  {sectionHeading("Pinned")}
                  <ul className="space-y-px" aria-label="Pinned jobs">
                    {pinned.map(row)}
                  </ul>
                </section>
              )}
              <section hidden={!loaded}>
                {sectionHeading(heading)}
                <ul className="space-y-px" aria-label={heading}>
                  {recent.map(row)}
                  {loaded && !recent.length && !pinned.length && (
                    <li className="whitespace-nowrap px-2 text-[14px] text-muted">Jobs you add show up here.</li>
                  )}
                </ul>
              </section>
            </>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <UsageMeter />
        {/* The profile: a picture (or initial) and the name. Opens Account and Sign out, words only. */}
        <Menu
          portal
          buttonClassName={`${ROW} ${ROW_IDLE} cursor-pointer overflow-hidden aria-expanded:bg-fg/[0.06] ${
            path.startsWith("/account") ? "bg-fg/[0.05]" : ""
          }`}
          label={
            <>
              <Avatar name={account?.name ?? ""} url={account?.avatarUrl ?? null} />
              <span className="min-w-0 flex-1 truncate text-left font-medium text-fg">{account?.name ?? "Account"}</span>
            </>
          }
        >
          <MenuItem onSelect={() => router.push("/account")}>Account</MenuItem>
          <MenuItem onSelect={() => void signOut()}>Sign out</MenuItem>
        </Menu>
      </div>
    </nav>
  );
}

/** The profile picture: the account's own when it has one, otherwise a circle with the name's first letter. */
function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- a small remote avatar; no image optimisation needed
    return <img src={url} alt="" referrerPolicy="no-referrer" className="h-6 w-6 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-fg/[0.12] text-[11px] font-semibold uppercase text-fg">
      {name.trim().charAt(0) || "?"}
    </span>
  );
}
